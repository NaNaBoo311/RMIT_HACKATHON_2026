// POST /api/emergency/:id/approve [benh_vien, or benh_nhan linked as family] -> { emergency, grantsCreated }
// 2 of 3: the doctor's request already counts, so one more approver type (hospital or family) unlocks
// it. Then the server creates PENDING read grants for the doctor (Essentials, Eye, Endocrine, 60 min).
// They still need the hospital's Tide enclave signature before the doctor can decrypt anything.
import { route, ok, HttpError } from "@/lib/http";
import { db, must } from "@/lib/db";
import { createPendingGrants, logAccess } from "@/lib/grants";
import { tagFor } from "@/lib/tags";
import type { ApproverType, EmergencyRequestRow } from "@/lib/types";

const ACCESS_MIN = 60;

export const POST = route<{ id: string }>(
  async (_req, { user, params }) => {
    const me = user.profile!;
    const request = must(
      await db().from("emergency_requests").select("*").eq("id", params.id).maybeSingle(),
      "emergency",
    ) as EmergencyRequestRow | null;
    if (!request) throw new HttpError(404, "Emergency request not found");

    // The requesting doctor already counts once; they cannot fill a second slot.
    if (request.doctor_profile_id === me.id) throw new HttpError(403, "The requesting doctor cannot approve again");

    // Who is approving. The patient themselves is not an approver.
    let approverType: ApproverType;
    if (user.realmRoles.includes("benh_vien")) {
      approverType = "hospital";
    } else {
      const link = must(
        await db()
          .from("family_links")
          .select("patient_code")
          .eq("patient_code", request.patient_code)
          .eq("family_profile_id", me.id)
          .maybeSingle(),
        "family link",
      );
      if (!link) throw new HttpError(403, "Only the hospital or a linked family member can approve");
      approverType = "family";
    }

    if (request.status !== "pending") throw new HttpError(409, `Request is already ${request.status}`);
    if (request.expires_at && new Date(request.expires_at).getTime() <= Date.now()) {
      throw new HttpError(409, "The approval window has closed");
    }

    const { error } = await db()
      .from("emergency_approvals")
      .insert({ request_id: request.id, approver_profile_id: me.id, approver_type: approverType });
    if (error) {
      if ((error as { code?: string }).code === "23505") throw new HttpError(409, `Already approved as ${approverType}`);
      throw new Error(`approve emergency: ${error.message}`);
    }

    const approvals = must(
      await db().from("emergency_approvals").select("approver_type").eq("request_id", request.id),
      "approvals",
    ) as { approver_type: ApproverType }[];
    const types = [...new Set(approvals.map((a) => a.approver_type))];

    let emergency: EmergencyRequestRow = request;
    let grantsCreated = 0;
    if (types.length >= 2) {
      const expiresAt = new Date(Date.now() + ACCESS_MIN * 60_000).toISOString();
      // Status guard: if two approvers race, only one flips it and creates grants.
      const flipped = must(
        await db()
          .from("emergency_requests")
          .update({ status: "approved", expires_at: expiresAt })
          .eq("id", request.id)
          .eq("status", "pending")
          .select("*"),
        "approve emergency",
      ) as EmergencyRequestRow[];
      if (flipped[0]) {
        emergency = flipped[0];
        const grants = await createPendingGrants(
          {
            subjectProfileId: request.doctor_profile_id,
            patientCode: request.patient_code,
            tags: (["thietyeu", "mat", "noitiet"] as const).map((k) => ({ tag: tagFor(request.patient_code, k), access: "read" as const })),
            expiresAt,
            emergencyId: request.id,
          },
          me.id,
        );
        grantsCreated = grants.length;
        await logAccess({ patientCode: request.patient_code, actorProfileId: me.id, action: "emergency" });
      } else {
        emergency = (must(
          await db().from("emergency_requests").select("*").eq("id", request.id).single(),
          "emergency",
        ) as EmergencyRequestRow);
      }
    }

    return ok({ emergency: { ...emergency, approvals: types }, grantsCreated });
  },
  { roles: ["benh_vien", "benh_nhan"] },
);
