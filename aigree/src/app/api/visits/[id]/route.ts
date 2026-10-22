// GET /api/visits/:id [doctor owner | patient owner | benh_vien] -> { visit: VisitView, grants: GrantView[], breachDrill }
// Polled by the doctor's visit page every few seconds, so it also runs lazy expiry.
import { route, ok, HttpError } from "@/lib/http";
import { db, must } from "@/lib/db";
import { expireStale, getBreachDrill } from "@/lib/grants";
import type { AccessRequestRow, GrantView, PatientRow, VisitRow, VisitView } from "@/lib/types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Every policy_grants column except the signed policy bytes.
const GRANT_COLUMNS =
  "id, subject_profile_id, patient_code, tag, access, status, expires_at, visit_id, access_request_id, emergency_id, signed_by, created_at, signed_at, revoked_at";

export const GET = route<{ id: string }>(async (_req, { user, params }) => {
  if (!UUID.test(params.id)) throw new HttpError(404, "Visit not found");
  await expireStale();
  const me = user.profile!;

  const visit = must(
    await db().from("visits").select("*").eq("id", params.id).maybeSingle(),
    "visit",
  ) as VisitRow | null;
  if (!visit) throw new HttpError(404, "Visit not found");

  const patient = must(
    await db().from("patients").select("code, profile_id").eq("code", visit.patient_code).maybeSingle(),
    "visit patient",
  ) as Pick<PatientRow, "code" | "profile_id"> | null;

  const allowed =
    user.appRole === "benh_vien" || visit.doctor_profile_id === me.id || (!!patient && patient.profile_id === me.id);
  if (!allowed) throw new HttpError(403, "Not your visit");

  const grantRows = must(
    await db().from("policy_grants").select(GRANT_COLUMNS).eq("visit_id", visit.id).order("created_at", { ascending: true }),
    "visit grants",
  ) as Omit<GrantView, "subject_name">[];
  const requests = must(
    await db().from("access_requests").select("*").eq("visit_id", visit.id).order("created_at", { ascending: true }),
    "visit requests",
  ) as AccessRequestRow[];

  const profileIds = [
    ...new Set([visit.doctor_profile_id, ...(patient ? [patient.profile_id] : []), ...grantRows.map((g) => g.subject_profile_id)]),
  ];
  const profiles = must(
    await db().from("profiles").select("id, display_name").in("id", profileIds),
    "visit profiles",
  ) as { id: string; display_name: string }[];
  const nameOf = new Map(profiles.map((p) => [p.id, p.display_name]));

  const view: VisitView = {
    ...visit,
    doctor_name: nameOf.get(visit.doctor_profile_id) ?? "Unknown doctor",
    patient_name: (patient && nameOf.get(patient.profile_id)) || "Unknown patient",
    requests,
  };
  const grants: GrantView[] = grantRows.map((g) => ({ ...g, subject_name: nameOf.get(g.subject_profile_id) ?? "Unknown" }));

  return ok({ visit: view, grants, breachDrill: await getBreachDrill() });
});
