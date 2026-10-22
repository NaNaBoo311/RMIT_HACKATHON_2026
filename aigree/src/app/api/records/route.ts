// GET  /api/records?patient=<code> [benh_nhan (own only), bac_si, benh_vien] -> RecordsResponse
//   Normally returns only ciphertext and policies for compartments the caller holds an ACTIVE grant
//   on. In breach drill the server misbehaves on purpose: it returns every record and hands out the
//   patient's own policies; the Tide network still refuses because the policy names someone else.
// POST /api/records [bac_si, benh_nhan] body { patient_code, kind, ciphertext, visit_id? } -> { record }
//   Stores ciphertext the browser produced. The caller must hold an ACTIVE read-write grant on the tag.
import { route, ok, readJson, HttpError } from "@/lib/http";
import { db, must } from "@/lib/db";
import { activeGrantsFor, expireStale, getBreachDrill, logAccess } from "@/lib/grants";
import { KINDS, RECORD_KINDS, tagFor } from "@/lib/tags";
import type { PatientRow, PolicyGrantRow, RecordKind, RecordsResponse } from "@/lib/types";

const RECORD_COLUMNS = "id, kind, tag, ciphertext, created_at, author_profile_id, visit_id";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function loadPatient(code: string): Promise<PatientRow> {
  const patient = must(
    await db().from("patients").select("*").eq("code", code).maybeSingle(),
    "patient",
  ) as PatientRow | null;
  if (!patient) throw new HttpError(404, "Patient not found");
  return patient;
}

/** tag -> policy, preferring read-write over read, then the later expiry (encryption needs read-write). */
function policyMap(grants: PolicyGrantRow[]): Record<string, string> {
  const rank = (g: PolicyGrantRow) => (g.access === "read-write" ? 1 : 0);
  const sorted = [...grants].sort(
    (a, b) => rank(a) - rank(b) || new Date(a.expires_at).getTime() - new Date(b.expires_at).getTime(),
  );
  const out: Record<string, string> = {};
  for (const g of sorted) if (g.policy_b64) out[g.tag] = g.policy_b64; // later entries win
  return out;
}

export const GET = route(
  async (req, { user }) => {
    await expireStale();
    const code = req.nextUrl.searchParams.get("patient");
    if (!code) throw new HttpError(400, "patient is required");
    const patient = await loadPatient(code);
    const me = user.profile!;

    // Patients read only their own record, breach drill or not.
    if (user.appRole === "benh_nhan" && patient.profile_id !== me.id) {
      throw new HttpError(403, "You can only open your own record");
    }

    const breachDrill = await getBreachDrill();
    const policies = policyMap(await activeGrantsFor(me.id, code));
    const identityTag = tagFor(code, "dinhdanh");

    const grantedTags = Object.keys(policies);
    let records: RecordsResponse["records"] = [];
    if (breachDrill || grantedTags.length) {
      let q = db().from("records").select(RECORD_COLUMNS).eq("patient_code", code).order("created_at", { ascending: false });
      if (!breachDrill) q = q.in("tag", grantedTags);
      records = must(await q, "records") as RecordsResponse["records"];
    }

    if (breachDrill) {
      // Deliberately leak the PATIENT's own policies for every compartment the caller lacks.
      const patientPolicies = policyMap(await activeGrantsFor(patient.profile_id, code));
      for (const kind of KINDS) {
        const tag = tagFor(code, kind);
        if (!policies[tag] && patientPolicies[tag]) policies[tag] = patientPolicies[tag];
      }
    }

    const canSeeIdentity = breachDrill || !!policies[identityTag];
    const identity =
      canSeeIdentity && patient.cccd_ciphertext ? { tag: identityTag, ciphertext: patient.cccd_ciphertext } : null;

    const body: RecordsResponse = { records, policies, breachDrill, identity };
    return ok(body);
  },
  { roles: ["benh_nhan", "bac_si", "benh_vien"] },
);

export const POST = route(
  async (req, { user }) => {
    const me = user.profile!;
    const body = await readJson<{ patient_code?: unknown; kind?: unknown; ciphertext?: unknown; visit_id?: unknown }>(req);

    if (typeof body.patient_code !== "string" || !body.patient_code) throw new HttpError(400, "patient_code is required");
    if (typeof body.kind !== "string" || !(RECORD_KINDS as readonly string[]).includes(body.kind)) {
      throw new HttpError(400, `kind must be one of ${RECORD_KINDS.join(", ")}`);
    }
    if (typeof body.ciphertext !== "string" || !body.ciphertext || body.ciphertext.length > 1_000_000) {
      throw new HttpError(400, "ciphertext is required");
    }
    const kind = body.kind as RecordKind;
    const patient = await loadPatient(body.patient_code);
    const tag = tagFor(patient.code, kind);

    const grants = await activeGrantsFor(me.id, patient.code);
    if (!grants.some((g) => g.tag === tag && g.access === "read-write")) {
      throw new HttpError(403, "No write grant for this compartment");
    }

    let visitId: string | null = null;
    if (body.visit_id !== undefined && body.visit_id !== null && body.visit_id !== "") {
      if (typeof body.visit_id !== "string" || !UUID.test(body.visit_id)) throw new HttpError(400, "Invalid visit_id");
      const visit = must(
        await db().from("visits").select("id, patient_code, doctor_profile_id").eq("id", body.visit_id).maybeSingle(),
        "visit",
      ) as { id: string; patient_code: string; doctor_profile_id: string } | null;
      if (!visit || visit.patient_code !== patient.code || visit.doctor_profile_id !== me.id) {
        throw new HttpError(400, "Unknown visit for this patient");
      }
      visitId = visit.id;
    }

    const record = must(
      await db()
        .from("records")
        .insert({ patient_code: patient.code, kind, tag, ciphertext: body.ciphertext, author_profile_id: me.id, visit_id: visitId })
        .select("id, patient_code, kind, tag, created_at, author_profile_id, visit_id")
        .single(),
      "create record",
    );
    await logAccess({ patientCode: patient.code, actorProfileId: me.id, action: "encrypt", tag, visitId });
    return ok({ record });
  },
  { roles: ["bac_si", "benh_nhan"] },
);
