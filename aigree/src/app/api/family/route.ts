// GET  /api/family [benh_nhan] -> { links: { family_profile_id, display_name, relation }[] }
// POST /api/family [benh_nhan] body { display_name, relation } -> { link }
//   Links an existing patient account (exact display name) to the caller's record, so that person
//   can co-approve emergency access.
import { route, ok, readJson, HttpError } from "@/lib/http";
import { db, must } from "@/lib/db";
import { normalizeName } from "@/lib/requireUser";

async function ownPatientCode(profileId: string): Promise<string | null> {
  const row = must(
    await db().from("patients").select("code").eq("profile_id", profileId).maybeSingle(),
    "patient",
  ) as { code: string } | null;
  return row?.code ?? null;
}

export const GET = route(
  async (_req, { user }) => {
    const code = await ownPatientCode(user.profile!.id);
    if (!code) return ok({ links: [] });

    const links = must(
      await db().from("family_links").select("family_profile_id, relation").eq("patient_code", code),
      "family links",
    ) as { family_profile_id: string; relation: string | null }[];
    const ids = links.map((l) => l.family_profile_id);
    const people = ids.length
      ? (must(await db().from("profiles").select("id, display_name").in("id", ids), "family profiles") as {
          id: string;
          display_name: string;
        }[])
      : [];
    const nameOf = new Map(people.map((p) => [p.id, p.display_name]));

    return ok({
      links: links.map((l) => ({
        family_profile_id: l.family_profile_id,
        display_name: nameOf.get(l.family_profile_id) ?? "Unknown",
        relation: l.relation ?? "",
      })),
    });
  },
  { roles: ["benh_nhan"] },
);

export const POST = route(
  async (req, { user }) => {
    const me = user.profile!;
    const code = await ownPatientCode(me.id);
    if (!code) throw new HttpError(400, "Register your patient record first");

    const body = await readJson<{ display_name?: unknown; relation?: unknown }>(req);
    const name = typeof body.display_name === "string" ? normalizeName(body.display_name) : "";
    const relation = typeof body.relation === "string" ? body.relation.trim().slice(0, 40) : "";
    if (!name) throw new HttpError(400, "display_name is required");

    const matches = must(
      await db().from("profiles").select("id, display_name").eq("role", "benh_nhan").eq("display_name", name).limit(2),
      "family lookup",
    ) as { id: string; display_name: string }[];
    if (!matches.length) throw new HttpError(404, "No patient account with exactly that name");
    if (matches.length > 1) throw new HttpError(409, "Several accounts have that name");
    const target = matches[0];
    if (target.id === me.id) throw new HttpError(400, "You cannot link yourself");

    must(
      await db()
        .from("family_links")
        .upsert({ patient_code: code, family_profile_id: target.id, relation: relation || null }, {
          onConflict: "patient_code,family_profile_id",
        })
        .select("patient_code"),
      "link family",
    );
    return ok({ link: { family_profile_id: target.id, display_name: target.display_name, relation } });
  },
  { roles: ["benh_nhan"] },
);
