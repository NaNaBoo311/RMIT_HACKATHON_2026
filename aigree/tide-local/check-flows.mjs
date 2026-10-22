// End-to-end check of AIgree's API against the local TideCloak stand-in (no browser). Needs:
//   npm run tide:local     (tide-local on :8090)
//   npm run dev            (app on :3000, with TIDE_MODE=local in .env.local)
// Plays every role through the same calls the pages make, and asserts the Tide-style refusals.
// It creates rows in the configured Supabase project.
const APP = process.env.APP_URL || "http://localhost:3000";
const SIM = process.env.TIDE_LOCAL_URL || "http://localhost:8090";
let failures = 0;

const check = (name, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? `  (${extra})` : ""}`);
  if (!cond) failures++;
};

async function http(base, path, { token, body, method } = {}) {
  const res = await fetch(base + path, {
    method: method ?? (body === undefined ? "GET" : "POST"),
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}
const sim = (p, o) => http(SIM, p, o);
const app = (p, o) => http(APP, p, o);

async function login(username) {
  const r = await sim("/login", { body: { username } });
  if (r.status !== 200) throw new Error(`login ${username}: ${JSON.stringify(r.data)}`);
  const token = r.data.access_token;
  const sync = await app("/api/profile/sync", { token, body: {} });
  if (sync.status !== 200) throw new Error(`sync ${username}: ${sync.status} ${JSON.stringify(sync.data)}`);
  return { token, ...sync.data };
}

/** Hospital: sign every pending grant through the Tide stand-in, then store them (what /hospital does). */
async function cosignAll(hospital) {
  const { data } = await app("/api/grants?scope=pending", { token: hospital.token });
  const items = [];
  for (const g of data.grants ?? []) {
    const roles = JSON.stringify(g.access === "read" ? ["_tide_decryptor"] : ["_tide_encryptor", "_tide_decryptor"]);
    const policy = { contractId: "RelationshipAttestation:1", subjectType: "User", subjectId: g.subject_key, assignmentId: g.tag, roles, expiry: Math.floor(Date.parse(g.expires_at) / 1000) };
    const s = await sim("/policies/sign", { token: hospital.token, body: { policy } });
    if (s.status !== 200) throw new Error(`sign ${g.tag}: ${JSON.stringify(s.data)}`);
    items.push({ id: g.id, policy_b64: s.data.policyB64 });
  }
  if (!items.length) return 0;
  const r = await app("/api/grants/sign", { token: hospital.token, body: { items } });
  if (r.status !== 200) throw new Error(`grants/sign: ${r.status} ${JSON.stringify(r.data)}`);
  return r.data.signed;
}

const run = async () => {
  const hospital = await login("admin");
  const lan = await login("lan");
  const minh = await login("minh");
  check("profiles synced with roles", hospital.profile.role === "benh_vien" && lan.profile.role === "benh_nhan" && minh.profile.role === "bac_si");

  // --- patient registration ---------------------------------------------------------------
  const CCCD = "079301001234";
  let code = lan.patient?.code;
  if (!code) {
    const prep = await app("/api/patients/register?step=prepare", { token: lan.token, body: { cccd: CCCD } });
    check("register prepare", prep.status === 200, JSON.stringify(prep.data));
    code = prep.data.code;
  }
  const signedReg = await cosignAll(hospital);
  check("hospital co-signs registration grants", signedReg >= 0, `signed ${signedReg}`);

  let recs = await app(`/api/records?patient=${code}`, { token: lan.token });
  check("patient gets own policies", Object.keys(recs.data.policies ?? {}).length === 4, Object.keys(recs.data.policies ?? {}).join(","));
  const pol = recs.data.policies;
  const lanState = (await app("/api/profile/sync", { token: lan.token, body: {} })).data.patient;
  if (!lanState.hasCccd) {
    const enc = await sim("/encrypt", { token: lan.token, body: { items: [{ data: CCCD, tags: [`${code}_dinhdanh`] }], policyB64: pol[`${code}_dinhdanh`] } });
    const done = await app("/api/patients/register?step=complete", { token: lan.token, body: { cccd: CCCD, cccd_ciphertext: enc.data.ciphertexts[0] } });
    check("register complete (CCCD encrypted in 'browser')", done.status === 200, JSON.stringify(done.data));
  }

  // seed one Eye + one Endocrine record if empty
  if (!(recs.data.records ?? []).length) {
    for (const kind of ["mat", "noitiet", "thietyeu"]) {
      const tag = `${code}_${kind}`;
      const plain = JSON.stringify({ title: `Clinical note (${kind})`, body: `Visit summary for the ${kind} compartment.`, date: new Date().toISOString() });
      const enc = await sim("/encrypt", { token: lan.token, body: { items: [{ data: plain, tags: [tag] }], policyB64: pol[tag] } });
      const r = await app("/api/records", { token: lan.token, body: { patient_code: code, kind, ciphertext: enc.data.ciphertexts[0] } });
      check(`seed ${kind}`, r.status === 201 || r.status === 200, String(r.status));
    }
    recs = await app(`/api/records?patient=${code}`, { token: lan.token });
  }
  const eye = recs.data.records.find((r) => r.kind === "mat");
  const own = await sim("/decrypt", { token: lan.token, body: { items: [{ encrypted: eye.ciphertext, tags: [eye.tag] }], policyB64: pol[eye.tag] } });
  check("patient decrypts own Eye record", own.status === 200, own.data.error);

  // --- visit ----------------------------------------------------------------------------------
  const lookup = await app("/api/patients/lookup", { token: minh.token, body: { cccd: CCCD } });
  check("doctor looks up patient by CCCD (masked)", lookup.status === 200 && /••••/.test(lookup.data.masked_cccd ?? ""), JSON.stringify(lookup.data));
  let before = await app(`/api/records?patient=${code}`, { token: minh.token });
  check("before consent: server sends doctor nothing", (before.data.records ?? []).length === 0);

  const now = Date.now();
  const v = await app("/api/visits", { token: minh.token, body: { patient_code: code, specialties: ["mat"], starts_at: new Date(now - 60_000).toISOString(), ends_at: new Date(now + 3600_000).toISOString() } });
  check("doctor books Eye visit", v.status === 201 || v.status === 200, JSON.stringify(v.data).slice(0, 120));
  const visitId = v.data.visit.id;
  const c = await app(`/api/visits/${visitId}/consent`, { token: lan.token, body: { decision: "approve" } });
  check("patient consents", c.status === 200 && c.data.visit.status === "awaiting_cosign", c.data.visit?.status);
  const blocked = await app(`/api/records?patient=${code}`, { token: minh.token });
  check("consented but not co-signed: still nothing", (blocked.data.records ?? []).length === 0);
  await cosignAll(hospital);
  const vv = await app(`/api/visits/${visitId}`, { token: minh.token });
  check("visit active after hospital co-sign", vv.data.visit?.status === "active", vv.data.visit?.status);

  const docRecs = await app(`/api/records?patient=${code}`, { token: minh.token });
  const tags = Object.keys(docRecs.data.policies ?? {});
  check("doctor gets Eye + Essentials policies only", tags.length === 2 && tags.includes(`${code}_mat`) && tags.includes(`${code}_thietyeu`), tags.join(","));
  const de = await sim("/decrypt", { token: minh.token, body: { items: [{ encrypted: eye.ciphertext, tags: [eye.tag] }], policyB64: docRecs.data.policies[eye.tag] } });
  check("doctor decrypts Eye record during visit", de.status === 200 && de.data.plaintexts?.length === 1, de.data.error);
  const endo = recs.data.records.find((r) => r.kind === "noitiet");
  const stolen = await sim("/decrypt", { token: minh.token, body: { items: [{ encrypted: endo.ciphertext, tags: [endo.tag] }], policyB64: pol[endo.tag] } });
  check("doctor with the PATIENT's Endocrine policy: refused", stolen.status === 403 && /subjectId does not match/.test(stolen.data.error), stolen.data.error);
  const hosp = await sim("/decrypt", { token: hospital.token, body: { items: [{ encrypted: eye.ciphertext, tags: [eye.tag] }], policyB64: pol[eye.tag] } });
  check("hospital decrypt: refused", hosp.status === 403, hosp.data.error);
  const forged = await app("/api/grants/sign", { token: minh.token, body: { items: [{ id: visitId, policy_b64: "abc" }] } });
  check("doctor cannot store signed grants", forged.status === 403, String(forged.status));

  // --- hacker mode ------------------------------------------------------------------------------
  await app("/api/breach-drill", { token: hospital.token, body: { enabled: true } });
  const hm = await app(`/api/records?patient=${code}`, { token: minh.token });
  const endoH = hm.data.records.find((r) => r.kind === "noitiet");
  const hmTry = await sim("/decrypt", { token: minh.token, body: { items: [{ encrypted: endoH.ciphertext, tags: [endoH.tag] }], policyB64: hm.data.policies[endoH.tag] } });
  check("hacker mode: ciphertext + patient's policy handed out, network refuses", hm.data.hackerMode && hmTry.status === 403, hmTry.data.error);
  await app("/api/breach-drill", { token: hospital.token, body: { enabled: false } });

  // --- end visit --------------------------------------------------------------------------------
  const end = await app(`/api/visits/${visitId}/end`, { token: minh.token, body: {} });
  check("doctor ends visit", end.status === 200, end.data.visit?.status);
  const after = await app(`/api/records?patient=${code}`, { token: minh.token });
  check("after end: server sends doctor nothing", (after.data.records ?? []).length === 0 && !Object.keys(after.data.policies ?? {}).length);

  // --- tokens -----------------------------------------------------------------------------------
  const bad = await app("/api/visits", { token: minh.token.slice(0, -4) + "AAAA" });
  check("tampered token rejected", bad.status === 401, String(bad.status));

  console.log(failures ? `\n${failures} check(s) FAILED` : "\nALL PASS");
  process.exit(failures ? 1 : 0);
};

run().catch((e) => {
  console.error("ERROR", e.message);
  process.exit(2);
});
