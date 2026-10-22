// POST /api/visits/:id/end [bac_si owner] -> { visit }
// Revokes every grant of the visit (pending or active), so the server stops handing out those
// policies, and marks the visit completed. The network itself refuses them after `ends_at` anyway.
import { route, ok, HttpError } from "@/lib/http";
import { db, must } from "@/lib/db";
import { revokeGrants } from "@/lib/grants";
import type { VisitRow } from "@/lib/types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OPEN = ["pending_consent", "awaiting_cosign", "active"];

export const POST = route<{ id: string }>(
  async (_req, { user, params }) => {
    const me = user.profile!;
    if (!UUID.test(params.id)) throw new HttpError(404, "Visit not found");

    const visit = must(
      await db().from("visits").select("*").eq("id", params.id).maybeSingle(),
      "visit",
    ) as VisitRow | null;
    if (!visit) throw new HttpError(404, "Visit not found");
    if (visit.doctor_profile_id !== me.id) throw new HttpError(403, "Not your visit");
    if (!OPEN.includes(visit.status)) {
      throw new HttpError(409, `This visit is already ${visit.status.replace(/_/g, " ")}`);
    }

    await revokeGrants({ visitId: visit.id }, me.id);
    const updated = must(
      await db()
        .from("visits")
        .update({ status: "completed" })
        .eq("id", visit.id)
        .in("status", OPEN)
        .select("*")
        .maybeSingle(),
      "end visit",
    ) as VisitRow | null;

    // Unanswered extra-specialty requests die with the visit.
    await db().from("access_requests").update({ status: "declined", decided_at: new Date().toISOString() }).eq("visit_id", visit.id).eq("status", "pending");

    return ok({ visit: updated ?? { ...visit, status: "completed" } });
  },
  { roles: ["bac_si"] },
);
