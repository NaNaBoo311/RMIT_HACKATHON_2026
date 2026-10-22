// GET /api/grants?scope=pending  [benh_vien] -> { grants: PendingGrant[] }   (the co-sign queue)
// GET /api/grants?scope=patient  [benh_nhan] -> { grants: GrantView[] }      (who can read my record)
// Never returns policy bytes: a pending grant has none, and a patient only needs to see who holds one.
import { route, ok, HttpError } from "@/lib/http";
import { db, must } from "@/lib/db";
import { expireStale } from "@/lib/grants";
import { SPECIALTY_LABEL } from "@/lib/tags";
import type {
  AccessRequestRow,
  EmergencyRequestRow,
  GrantView,
  PendingGrant,
  PolicyGrantRow,
  VisitRow,
} from "@/lib/types";

type NameRow = { id: string; display_name: string; tide_user_key: string | null };

const uniq = (xs: (string | null | undefined)[]) => [...new Set(xs.filter((x): x is string => !!x))];

/** Profiles by id (one query; skipped when there is nothing to look up). */
async function profilesById(ids: string[]): Promise<Map<string, NameRow>> {
  if (!ids.length) return new Map();
  const rows = must(
    await db().from("profiles").select("id, display_name, tide_user_key").in("id", ids),
    "profiles",
  ) as NameRow[];
  return new Map(rows.map((r) => [r.id, r]));
}

export const GET = route(
  async (req, { user }) => {
    const scope = req.nextUrl.searchParams.get("scope") ?? "pending";
    const me = user.profile!;

    if (scope === "pending") {
      if (!user.realmRoles.includes("benh_vien")) throw new HttpError(403, "Requires role: benh_vien");
      await expireStale();
      const grants = must(
        await db()
          .from("policy_grants")
          .select("*")
          .eq("status", "pending_signature")
          .order("created_at", { ascending: false }),
        "pending grants",
      ) as PolicyGrantRow[];
      if (!grants.length) return ok({ grants: [] });

      // Context for the human-readable reason. Separate queries, mapped in JS (no embedded joins).
      const visitIds = uniq(grants.map((g) => g.visit_id));
      const requestIds = uniq(grants.map((g) => g.access_request_id));
      const emergencyIds = uniq(grants.map((g) => g.emergency_id));
      const codes = uniq(grants.map((g) => g.patient_code));

      const visits = visitIds.length
        ? (must(await db().from("visits").select("*").in("id", visitIds), "visits") as VisitRow[])
        : [];
      const requests = requestIds.length
        ? (must(await db().from("access_requests").select("*").in("id", requestIds), "requests") as AccessRequestRow[])
        : [];
      const emergencies = emergencyIds.length
        ? (must(await db().from("emergency_requests").select("*").in("id", emergencyIds), "emergencies") as EmergencyRequestRow[])
        : [];
      const patients = must(
        await db().from("patients").select("code, profile_id").in("code", codes),
        "patients",
      ) as { code: string; profile_id: string }[];

      // Request rows point at a visit that may not have a grant of its own in this batch.
      const extraVisitIds = uniq(requests.map((r) => r.visit_id)).filter((id) => !visitIds.includes(id));
      if (extraVisitIds.length) {
        visits.push(...(must(await db().from("visits").select("*").in("id", extraVisitIds), "visits") as VisitRow[]));
      }

      const people = await profilesById(
        uniq([
          ...grants.map((g) => g.subject_profile_id),
          ...patients.map((p) => p.profile_id),
          ...visits.map((v) => v.doctor_profile_id),
          ...emergencies.map((e) => e.doctor_profile_id),
        ]),
      );
      const nameOf = (id: string | null | undefined) => (id && people.get(id)?.display_name) || "unknown";
      const patientName = (code: string) => nameOf(patients.find((p) => p.code === code)?.profile_id);
      const visitById = new Map(visits.map((v) => [v.id, v]));

      const reasonFor = (g: PolicyGrantRow): string => {
        const patient = patientName(g.patient_code);
        if (g.emergency_id) {
          const e = emergencies.find((x) => x.id === g.emergency_id);
          return `EMERGENCY: Dr ${nameOf(e?.doctor_profile_id)} → ${patient} – 2 of 3 approved`;
        }
        if (g.access_request_id) {
          const r = requests.find((x) => x.id === g.access_request_id);
          const v = r ? visitById.get(r.visit_id) : undefined;
          const label = r ? SPECIALTY_LABEL[r.specialty] ?? r.specialty : "specialty";
          return `Extra specialty ${label} for Dr ${nameOf(v?.doctor_profile_id)} – patient approved`;
        }
        if (g.visit_id) {
          const v = visitById.get(g.visit_id);
          const specs = (v?.specialties ?? []).map((s) => SPECIALTY_LABEL[s] ?? s).join(", ");
          return `Visit: Dr ${nameOf(v?.doctor_profile_id)} → ${patient}, ${specs || "visit"} – patient consented`;
        }
        return `Activate patient record: ${patient}`;
      };

      const out: PendingGrant[] = grants.map((g) => ({
        id: g.id,
        tag: g.tag,
        access: g.access,
        expires_at: g.expires_at,
        patient_code: g.patient_code,
        subject_profile_id: g.subject_profile_id,
        subject_name: nameOf(g.subject_profile_id),
        subject_key: people.get(g.subject_profile_id)?.tide_user_key ?? null,
        visit_id: g.visit_id,
        access_request_id: g.access_request_id,
        emergency_id: g.emergency_id,
        reason: reasonFor(g),
      }));
      return ok({ grants: out });
    }

    if (scope === "patient") {
      if (!user.realmRoles.includes("benh_nhan")) throw new HttpError(403, "Requires role: benh_nhan");
      await expireStale();
      const patient = must(
        await db().from("patients").select("code").eq("profile_id", me.id).maybeSingle(),
        "patient",
      ) as { code: string } | null;
      if (!patient) return ok({ grants: [] });

      const rows = must(
        await db()
          .from("policy_grants")
          .select("*")
          .eq("patient_code", patient.code)
          .neq("subject_profile_id", me.id)
          .order("created_at", { ascending: false }),
        "patient grants",
      ) as PolicyGrantRow[];
      const people = await profilesById(uniq(rows.map((g) => g.subject_profile_id)));
      const out: GrantView[] = rows.map(({ policy_b64: _omit, ...g }) => ({
        ...g,
        subject_name: people.get(g.subject_profile_id)?.display_name ?? "unknown",
      }));
      return ok({ grants: out });
    }

    throw new HttpError(400, "scope must be 'pending' or 'patient'");
  },
  { roles: ["benh_vien", "benh_nhan"] },
);
