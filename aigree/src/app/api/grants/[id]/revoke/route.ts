// POST /api/grants/:id/revoke [benh_nhan who owns the record, or benh_vien] -> { ok: true }
// Revoking stops the server handing the policy out. The network itself refuses it after expires_at.
// A patient cannot revoke their own self-grants here (that would lock them out of their own record).
import { route, ok, HttpError } from "@/lib/http";
import { db, must } from "@/lib/db";
import { revokeGrants } from "@/lib/grants";
import type { PolicyGrantRow } from "@/lib/types";

export const POST = route<{ id: string }>(
  async (_req, { user, params }) => {
    const me = user.profile!;
    const grant = must(
      await db().from("policy_grants").select("*").eq("id", params.id).maybeSingle(),
      "grant",
    ) as PolicyGrantRow | null;
    if (!grant) throw new HttpError(404, "Grant not found");

    if (!user.realmRoles.includes("benh_vien")) {
      const patient = must(
        await db().from("patients").select("profile_id").eq("code", grant.patient_code).maybeSingle(),
        "patient",
      ) as { profile_id: string } | null;
      if (!patient || patient.profile_id !== me.id) throw new HttpError(403, "Not your record");
      if (grant.subject_profile_id === me.id) throw new HttpError(403, "You cannot revoke your own access");
    }

    if (grant.status !== "pending_signature" && grant.status !== "active") {
      throw new HttpError(409, `Grant is already ${grant.status}`);
    }
    await revokeGrants({ ids: [grant.id] }, me.id);
    if (grant.visit_id) {
      // A visit whose grants were all revoked before co-signing would otherwise wait forever.
      const live = must(
        await db().from("policy_grants").select("id").eq("visit_id", grant.visit_id).in("status", ["pending_signature", "active"]),
        "live visit grants",
      ) as { id: string }[];
      if (!live.length) {
        await db().from("visits").update({ status: "completed" }).eq("id", grant.visit_id).eq("status", "awaiting_cosign");
      }
    }
    return ok({ ok: true });
  },
  { roles: ["benh_nhan", "benh_vien"] },
);
