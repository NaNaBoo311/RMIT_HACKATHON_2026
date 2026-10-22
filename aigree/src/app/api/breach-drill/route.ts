// GET  /api/breach-drill [any]       -> { enabled }
// POST /api/breach-drill [benh_vien] body { enabled } -> { enabled }
// Breach drill makes GET /api/records misbehave on purpose: it returns all ciphertext and hands out
// the patient's own policies. The Tide network still refuses, which is what the drill proves.
import { route, ok, readJson, HttpError } from "@/lib/http";
import { db, must } from "@/lib/db";
import { getBreachDrill } from "@/lib/grants";

export const GET = route(async () => ok({ enabled: await getBreachDrill() }));

export const POST = route(
  async (req) => {
    const body = await readJson<{ enabled?: unknown }>(req);
    if (typeof body.enabled !== "boolean") throw new HttpError(400, "enabled must be true or false");
    must(
      await db().from("demo_settings").upsert({ key: "hacker_mode", value: body.enabled }, { onConflict: "key" }),
      "breach drill",
    );
    return ok({ enabled: body.enabled });
  },
  { roles: ["benh_vien"] },
);
