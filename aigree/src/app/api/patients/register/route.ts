// POST /api/patients/register?step=prepare|complete [benh_nhan]
//
// prepare  { cccd } -> { code, status }
//   Creates the patient row (lookup key = HMAC of the CCCD, never the CCCD itself) and four pending
//   self-grants, one per compartment. The hospital account co-signs them ("activate"), which turns
//   the patient `active` (settleAfterSign).
// complete { cccd, cccd_ciphertext } -> { ok: true }
//   After activation the browser encrypts the CCCD under <code>_dinhdanh with the patient's own
//   policy and sends the ciphertext. The raw CCCD is only used to re-check the HMAC.
import { route, ok, readJson, HttpError } from "@/lib/http";
import { db, must } from "@/lib/db";
import { hmacCccd, normalizeCccd } from "@/lib/crypto";
import { createPendingGrants, logAccess } from "@/lib/grants";
import { KINDS, newPatientCode, tagFor } from "@/lib/tags";
import type { PatientRow, Profile } from "@/lib/types";

const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

function cccdFrom(body: { cccd?: unknown }): string {
  try {
    return normalizeCccd(body.cccd);
  } catch {
    throw new HttpError(400, "CCCD must be 12 digits");
  }
}

async function ownPatient(profileId: string): Promise<PatientRow | null> {
  return must(
    await db().from("patients").select("*").eq("profile_id", profileId).maybeSingle(),
    "patient",
  ) as PatientRow | null;
}

/** The four read-write self-grants (one per compartment) that registration asks the hospital to sign. */
async function createSelfGrants(profile: Profile, code: string) {
  await createPendingGrants(
    {
      subjectProfileId: profile.id,
      patientCode: code,
      tags: KINDS.map((k) => ({ tag: tagFor(code, k), access: "read-write" as const })),
      expiresAt: new Date(Date.now() + YEAR_MS),
    },
    profile.id,
  );
}

async function prepare(profile: Profile, body: { cccd?: unknown }) {
  const existing = await ownPatient(profile.id);
  if (existing) {
    // Self-heal a half-finished registration: re-create self-grants if none are pending or active.
    if (existing.status === "awaiting_activation") {
      const live = must(
        await db()
          .from("policy_grants")
          .select("id")
          .eq("patient_code", existing.code)
          .eq("subject_profile_id", profile.id)
          .in("status", ["pending_signature", "active"]),
        "self grants",
      ) as { id: string }[];
      if (!live.length) await createSelfGrants(profile, existing.code);
    }
    return ok({ code: existing.code, status: existing.status });
  }

  if (!profile.tide_user_key) throw new HttpError(400, "Sign in again so your Tide key is on your profile");

  const cccdHmac = hmacCccd(cccdFrom(body));
  const taken = must(
    await db().from("patients").select("code").eq("cccd_hmac", cccdHmac).maybeSingle(),
    "cccd lookup",
  );
  if (taken) throw new HttpError(409, "This CCCD is already registered");

  const res = await db()
    .from("patients")
    .insert({ code: newPatientCode(), profile_id: profile.id, cccd_hmac: cccdHmac, status: "awaiting_activation" })
    .select("*")
    .single();
  // 23505 = unique violation: a concurrent request registered the same CCCD or profile.
  if (res.error?.code === "23505") throw new HttpError(409, "This CCCD or account is already registered");
  const patient = must(res, "create patient") as PatientRow;

  await createSelfGrants(profile, patient.code);
  return ok({ code: patient.code, status: patient.status });
}

async function complete(profile: Profile, body: { cccd?: unknown; cccd_ciphertext?: unknown }) {
  const patient = await ownPatient(profile.id);
  if (!patient) throw new HttpError(404, "Register first");
  if (patient.status !== "active") throw new HttpError(409, "Waiting for the hospital to activate your record");
  if (hmacCccd(cccdFrom(body)) !== patient.cccd_hmac) {
    throw new HttpError(400, "This CCCD does not match the one you registered with");
  }
  const ciphertext = body.cccd_ciphertext;
  if (typeof ciphertext !== "string" || !ciphertext || ciphertext.length > 100_000) {
    throw new HttpError(400, "cccd_ciphertext is required");
  }

  must(
    await db().from("patients").update({ cccd_ciphertext: ciphertext }).eq("code", patient.code).select("code"),
    "store cccd ciphertext",
  );
  await logAccess({
    patientCode: patient.code,
    actorProfileId: profile.id,
    action: "encrypt",
    tag: tagFor(patient.code, "dinhdanh"),
  });
  return ok({ ok: true });
}

export const POST = route(
  async (req, { user }) => {
    const profile = user.profile!;
    const step = req.nextUrl.searchParams.get("step");
    const body = await readJson<{ cccd?: unknown; cccd_ciphertext?: unknown }>(req);
    if (step === "prepare") return prepare(profile, body);
    if (step === "complete") return complete(profile, body);
    throw new HttpError(400, "step must be prepare or complete");
  },
  { roles: ["benh_nhan"] },
);
