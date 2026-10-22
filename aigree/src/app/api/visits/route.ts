// GET  /api/visits [any] -> { visits: VisitView[] }
//   Patient: visits on their own patient record. Doctor: their own visits. Hospital: all (newest 100).
// POST /api/visits [bac_si] body { patient_code, specialties, starts_at, ends_at } -> { visit }
//   Books a visit as `pending_consent`. No grant exists until the patient approves and the hospital
//   co-signs, so booking alone gives the doctor nothing.
import { route, ok, readJson, HttpError } from "@/lib/http";
import { db, must } from "@/lib/db";
import { expireStale } from "@/lib/grants";
import { isSpecialty } from "@/lib/tags";
import type { AccessRequestRow, PatientRow, VisitRow, VisitView } from "@/lib/types";

const MAX_VISIT_MS = 12 * 60 * 60 * 1000;

/** Attach doctor/patient display names and access requests (separate queries: no embedded joins). */
async function toViews(visits: VisitRow[]): Promise<VisitView[]> {
  if (!visits.length) return [];
  const codes = [...new Set(visits.map((v) => v.patient_code))];
  const patients = must(
    await db().from("patients").select("code, profile_id").in("code", codes),
    "visit patients",
  ) as Pick<PatientRow, "code" | "profile_id">[];
  const profileIds = [...new Set([...visits.map((v) => v.doctor_profile_id), ...patients.map((p) => p.profile_id)])];
  const profiles = must(
    await db().from("profiles").select("id, display_name").in("id", profileIds),
    "visit profiles",
  ) as { id: string; display_name: string }[];
  const requests = must(
    await db()
      .from("access_requests")
      .select("*")
      .in("visit_id", visits.map((v) => v.id))
      .order("created_at", { ascending: true }),
    "visit requests",
  ) as AccessRequestRow[];

  const nameOf = new Map(profiles.map((p) => [p.id, p.display_name]));
  const patientProfile = new Map(patients.map((p) => [p.code, p.profile_id]));
  return visits.map((v) => ({
    ...v,
    doctor_name: nameOf.get(v.doctor_profile_id) ?? "Unknown doctor",
    patient_name: nameOf.get(patientProfile.get(v.patient_code) ?? "") ?? "Unknown patient",
    requests: requests.filter((r) => r.visit_id === v.id),
  }));
}

export const GET = route(async (_req, { user }) => {
  await expireStale();
  const me = user.profile!;

  let q = db().from("visits").select("*");
  if (user.appRole === "benh_vien") {
    q = q.order("created_at", { ascending: false }).limit(100);
  } else if (user.appRole === "bac_si") {
    q = q.eq("doctor_profile_id", me.id).order("starts_at", { ascending: false });
  } else {
    const patient = must(
      await db().from("patients").select("code").eq("profile_id", me.id).maybeSingle(),
      "own patient",
    ) as { code: string } | null;
    // Not registered yet: nothing to show (pages poll this before registration).
    if (!patient) return ok({ visits: [] });
    q = q.eq("patient_code", patient.code).order("starts_at", { ascending: false });
  }

  const visits = must(await q, "visits") as VisitRow[];
  return ok({ visits: await toViews(visits) });
});

export const POST = route(
  async (req, { user }) => {
    const me = user.profile!;
    const body = await readJson<{ patient_code?: unknown; specialties?: unknown; starts_at?: unknown; ends_at?: unknown }>(req);

    const patientCode = typeof body.patient_code === "string" ? body.patient_code.trim() : "";
    if (!patientCode) throw new HttpError(400, "patient_code is required");

    // Specialties: non-empty, known, and each one the doctor actually holds (khoa_* role in the token).
    if (!Array.isArray(body.specialties) || !body.specialties.length) {
      throw new HttpError(400, "Choose at least one specialty");
    }
    const specialties = [...new Set(body.specialties)];
    for (const s of specialties) {
      if (!isSpecialty(s)) throw new HttpError(400, `Unknown specialty: ${String(s)}`);
      if (!user.specialties.includes(s)) throw new HttpError(403, `You do not hold the ${s} specialty`);
    }

    const startsAt = new Date(String(body.starts_at ?? ""));
    const endsAt = new Date(String(body.ends_at ?? ""));
    if (isNaN(startsAt.getTime()) || isNaN(endsAt.getTime())) {
      throw new HttpError(400, "starts_at and ends_at must be valid dates");
    }
    if (endsAt <= startsAt) throw new HttpError(400, "The visit must end after it starts");
    if (endsAt.getTime() - startsAt.getTime() > MAX_VISIT_MS) throw new HttpError(400, "A visit can last at most 12 hours");
    if (endsAt.getTime() <= Date.now()) throw new HttpError(400, "The visit must end in the future");

    const patient = must(
      await db().from("patients").select("code, status").eq("code", patientCode).maybeSingle(),
      "patient",
    ) as Pick<PatientRow, "code" | "status"> | null;
    if (!patient) throw new HttpError(404, "Patient not found");
    if (patient.status !== "active") {
      throw new HttpError(409, "This patient's record is not activated yet (waiting for the hospital to co-sign)");
    }

    const visit = must(
      await db()
        .from("visits")
        .insert({
          patient_code: patient.code,
          doctor_profile_id: me.id,
          specialties,
          starts_at: startsAt.toISOString(),
          ends_at: endsAt.toISOString(),
          status: "pending_consent",
        })
        .select("*")
        .single(),
      "create visit",
    ) as VisitRow;

    return ok({ visit }, 201);
  },
  { roles: ["bac_si"] },
);
