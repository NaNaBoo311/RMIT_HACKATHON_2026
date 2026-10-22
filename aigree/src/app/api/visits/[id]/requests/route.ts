// POST /api/visits/:id/requests [bac_si owner] body { specialty } -> { request }
// During a visit the doctor asks the patient for one more compartment (read-only). Nothing is granted
// here: the patient decides (POST /api/requests/:id/decide), then the hospital co-signs.
import { route, ok, readJson, HttpError } from "@/lib/http";
import { db, must } from "@/lib/db";
import { expireStale } from "@/lib/grants";
import { isSpecialty } from "@/lib/tags";
import type { AccessRequestRow, VisitRow } from "@/lib/types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const POST = route<{ id: string }>(
  async (req, { user, params }) => {
    const me = user.profile!;
    const { specialty } = await readJson<{ specialty?: unknown }>(req);
    if (!isSpecialty(specialty)) throw new HttpError(400, "Unknown specialty");
    if (!UUID.test(params.id)) throw new HttpError(404, "Visit not found");
    await expireStale();

    const visit = must(
      await db().from("visits").select("*").eq("id", params.id).maybeSingle(),
      "visit",
    ) as VisitRow | null;
    if (!visit) throw new HttpError(404, "Visit not found");
    if (visit.doctor_profile_id !== me.id) throw new HttpError(403, "Not your visit");
    if (visit.status !== "awaiting_cosign" && visit.status !== "active") {
      throw new HttpError(409, "Extra access can only be requested during an approved visit");
    }
    if (new Date(visit.ends_at).getTime() <= Date.now()) throw new HttpError(409, "This visit has already ended");
    if (visit.specialties.includes(specialty)) throw new HttpError(409, "That specialty is already part of this visit");

    const existing = must(
      await db()
        .from("access_requests")
        .select("id")
        .eq("visit_id", visit.id)
        .eq("specialty", specialty)
        .in("status", ["pending", "approved"]),
      "existing requests",
    ) as { id: string }[];
    if (existing.length) throw new HttpError(409, "You already requested that specialty for this visit");

    const request = must(
      await db().from("access_requests").insert({ visit_id: visit.id, specialty, status: "pending" }).select("*").single(),
      "create request",
    ) as AccessRequestRow;

    return ok({ request }, 201);
  },
  { roles: ["bac_si"] },
);
