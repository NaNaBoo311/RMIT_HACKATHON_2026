// POST /api/requests/:id/decide [benh_nhan owner] body { decision: "approve" | "decline" } -> { request }
// Approve creates ONE pending `read` grant for the doctor on the requested compartment, expiring at
// the visit's end. The hospital still has to co-sign it before the doctor can decrypt anything.
import { route, ok, readJson, HttpError } from "@/lib/http";
import { db, must } from "@/lib/db";
import { createPendingGrants, expireStale } from "@/lib/grants";
import { isSpecialty, tagFor } from "@/lib/tags";
import type { AccessRequestRow, PatientRow, Profile, VisitRow } from "@/lib/types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OPEN = ["pending_consent", "awaiting_cosign", "active"];

export const POST = route<{ id: string }>(
  async (req, { user, params }) => {
    const me = user.profile!;
    const { decision } = await readJson<{ decision?: unknown }>(req);
    if (decision !== "approve" && decision !== "decline") {
      throw new HttpError(400, 'decision must be "approve" or "decline"');
    }
    if (!UUID.test(params.id)) throw new HttpError(404, "Request not found");
    await expireStale();

    const request = must(
      await db().from("access_requests").select("*").eq("id", params.id).maybeSingle(),
      "request",
    ) as AccessRequestRow | null;
    if (!request) throw new HttpError(404, "Request not found");

    const visit = must(
      await db().from("visits").select("*").eq("id", request.visit_id).maybeSingle(),
      "request visit",
    ) as VisitRow | null;
    if (!visit) throw new HttpError(404, "Visit not found");

    const patient = must(
      await db().from("patients").select("code, profile_id").eq("code", visit.patient_code).maybeSingle(),
      "visit patient",
    ) as Pick<PatientRow, "code" | "profile_id"> | null;
    if (!patient || patient.profile_id !== me.id) throw new HttpError(403, "Not your request");

    if (request.status !== "pending") throw new HttpError(409, `This request is already ${request.status}`);
    if (!OPEN.includes(visit.status) || new Date(visit.ends_at).getTime() <= Date.now()) {
      throw new HttpError(409, "The visit has ended");
    }

    let doctor: Pick<Profile, "id" | "tide_user_key"> | null = null;
    if (decision === "approve") {
      if (!isSpecialty(request.specialty)) throw new HttpError(409, "Unknown specialty on this request");
      doctor = must(
        await db().from("profiles").select("id, tide_user_key").eq("id", visit.doctor_profile_id).maybeSingle(),
        "doctor profile",
      ) as Pick<Profile, "id" | "tide_user_key"> | null;
      if (!doctor?.tide_user_key) throw new HttpError(409, "The doctor's Tide key is unknown; try again later");
    }

    // Claim the decision first so a double click cannot create two grants.
    const updated = must(
      await db()
        .from("access_requests")
        .update({ status: decision === "approve" ? "approved" : "declined", decided_at: new Date().toISOString() })
        .eq("id", request.id)
        .eq("status", "pending")
        .select("*")
        .maybeSingle(),
      "decide request",
    ) as AccessRequestRow | null;
    if (!updated) throw new HttpError(409, "The request changed; reload and try again");

    if (decision === "approve" && doctor && isSpecialty(request.specialty)) {
      try {
        await createPendingGrants(
          {
            subjectProfileId: doctor.id,
            patientCode: patient.code,
            tags: [{ tag: tagFor(patient.code, request.specialty), access: "read" }],
            expiresAt: visit.ends_at,
            visitId: visit.id,
            accessRequestId: request.id,
          },
          me.id,
        );
      } catch (err) {
        await db().from("access_requests").update({ status: "pending", decided_at: null }).eq("id", request.id);
        throw err;
      }
    }

    return ok({ request: updated });
  },
  { roles: ["benh_nhan"] },
);
