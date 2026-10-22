// POST /api/visits/:id/consent [benh_nhan owner] body { decision: "approve" | "decline" } -> { visit }
// Approve creates PENDING grants for the doctor (visit specialties read-write, Essentials read, all
// expiring at the visit's end). They do nothing until the hospital's Tide enclave co-signs them.
import { route, ok, readJson, HttpError } from "@/lib/http";
import { db, must } from "@/lib/db";
import { createPendingGrants, expireStale } from "@/lib/grants";
import { isSpecialty, tagFor } from "@/lib/tags";
import type { GrantAccess, PatientRow, Profile, VisitRow } from "@/lib/types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const POST = route<{ id: string }>(
  async (req, { user, params }) => {
    const me = user.profile!;
    const { decision } = await readJson<{ decision?: unknown }>(req);
    if (decision !== "approve" && decision !== "decline") {
      throw new HttpError(400, 'decision must be "approve" or "decline"');
    }
    if (!UUID.test(params.id)) throw new HttpError(404, "Visit not found");
    await expireStale(); // a visit past its end is expired before we look at it

    const visit = must(
      await db().from("visits").select("*").eq("id", params.id).maybeSingle(),
      "visit",
    ) as VisitRow | null;
    if (!visit) throw new HttpError(404, "Visit not found");

    const patient = must(
      await db().from("patients").select("code, profile_id").eq("code", visit.patient_code).maybeSingle(),
      "visit patient",
    ) as Pick<PatientRow, "code" | "profile_id"> | null;
    if (!patient || patient.profile_id !== me.id) throw new HttpError(403, "Not your visit");

    if (visit.status !== "pending_consent") {
      throw new HttpError(409, `This visit is ${visit.status.replace(/_/g, " ")}, not waiting for your consent`);
    }
    if (new Date(visit.ends_at).getTime() <= Date.now()) throw new HttpError(409, "This visit has already ended");

    if (decision === "decline") {
      const updated = must(
        await db()
          .from("visits")
          .update({ status: "declined" })
          .eq("id", visit.id)
          .eq("status", "pending_consent")
          .select("*")
          .maybeSingle(),
        "decline visit",
      ) as VisitRow | null;
      if (!updated) throw new HttpError(409, "The visit changed; reload and try again");
      return ok({ visit: updated });
    }

    // The grant's subject is the doctor's tideuserkey; without it the hospital cannot build the policy.
    const doctor = must(
      await db().from("profiles").select("id, tide_user_key").eq("id", visit.doctor_profile_id).maybeSingle(),
      "doctor profile",
    ) as Pick<Profile, "id" | "tide_user_key"> | null;
    if (!doctor?.tide_user_key) {
      throw new HttpError(409, "The doctor's Tide key is unknown (the doctor must sign in once); try again later");
    }

    // Claim the transition first so a double click cannot create two sets of grants.
    const claimed = must(
      await db()
        .from("visits")
        .update({ status: "awaiting_cosign" })
        .eq("id", visit.id)
        .eq("status", "pending_consent")
        .select("*")
        .maybeSingle(),
      "approve visit",
    ) as VisitRow | null;
    if (!claimed) throw new HttpError(409, "The visit changed; reload and try again");

    const tags: { tag: string; access: GrantAccess }[] = [
      ...visit.specialties.filter(isSpecialty).map((s) => ({ tag: tagFor(patient.code, s), access: "read-write" as const })),
      { tag: tagFor(patient.code, "thietyeu"), access: "read" },
    ];
    try {
      await createPendingGrants(
        { subjectProfileId: doctor.id, patientCode: patient.code, tags, expiresAt: visit.ends_at, visitId: visit.id },
        me.id,
      );
    } catch (err) {
      // Put the visit back so the patient can retry.
      await db().from("visits").update({ status: "pending_consent" }).eq("id", visit.id);
      throw err;
    }

    return ok({ visit: claimed });
  },
  { roles: ["benh_nhan"] },
);
