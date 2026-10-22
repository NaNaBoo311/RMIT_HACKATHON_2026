// POST /api/logs [any] body { entries: { patient_code, action: "decrypt"|"denied", tag?, visit_id? }[] } -> { ok: true }
//   Decrypt and denied events happen in the browser, so the browser reports them. The actor is
//   always the verified caller, never a body field.
// GET  /api/logs?patient=<code> [benh_nhan owner] -> { logs: (AccessLogRow & { actor_name, actor_role })[] }
import { route, ok, readJson, HttpError } from "@/lib/http";
import { db, must } from "@/lib/db";
import { getBreachDrill, logAccess, type LogEntry } from "@/lib/grants";
import { kindOfTag } from "@/lib/tags";
import type { AccessLogRow } from "@/lib/types";

const CLIENT_ACTIONS = ["decrypt", "denied"] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_ENTRIES = 50;

interface ClientEntry {
  patient_code?: unknown;
  action?: unknown;
  tag?: unknown;
  visit_id?: unknown;
}

export const POST = route(async (req, { user }) => {
  const body = await readJson<{ entries?: unknown }>(req);
  if (!Array.isArray(body.entries)) throw new HttpError(400, "entries must be an array");
  if (body.entries.length > MAX_ENTRIES) throw new HttpError(400, `At most ${MAX_ENTRIES} entries`);

  const entries: LogEntry[] = [];
  for (const raw of body.entries as ClientEntry[]) {
    const code = raw?.patient_code;
    if (typeof code !== "string" || !code) throw new HttpError(400, "patient_code is required");
    if (!(CLIENT_ACTIONS as readonly unknown[]).includes(raw.action)) throw new HttpError(400, "action must be decrypt or denied");
    let tag: string | null = null;
    if (raw.tag !== undefined && raw.tag !== null) {
      // A tag must be one of this patient's compartments.
      if (typeof raw.tag !== "string" || !raw.tag.startsWith(`${code}_`) || !kindOfTag(raw.tag)) {
        throw new HttpError(400, "Invalid tag");
      }
      tag = raw.tag;
    }
    const visitId = typeof raw.visit_id === "string" && UUID.test(raw.visit_id) ? raw.visit_id : null;
    entries.push({
      patientCode: code,
      actorProfileId: user.profile!.id,
      action: raw.action as (typeof CLIENT_ACTIONS)[number],
      tag,
      visitId,
    });
  }
  if (!entries.length) return ok({ ok: true });

  // Keep entries only for patients the caller has a real relationship with: their own record, or
  // one they hold (or held) a grant on. In breach drill anyone may hit any record, and the resulting
  // "denied" entries are exactly what the patient should see. Unknown codes are dropped too
  // (access_logs.patient_code is a foreign key).
  const codes = [...new Set(entries.map((e) => e.patientCode as string))];
  const known = must(
    await db().from("patients").select("code, profile_id").in("code", codes),
    "patients",
  ) as { code: string; profile_id: string }[];
  const breachDrill = await getBreachDrill();
  const granted = must(
    await db().from("policy_grants").select("patient_code").eq("subject_profile_id", user.profile!.id).in("patient_code", codes),
    "caller grants",
  ) as { patient_code: string }[];
  const grantedSet = new Set(granted.map((g) => g.patient_code));
  const allowed = new Set(
    known
      .filter((p) => breachDrill || p.profile_id === user.profile!.id || grantedSet.has(p.code))
      .map((p) => p.code),
  );
  await logAccess(entries.filter((e) => allowed.has(e.patientCode as string)));
  return ok({ ok: true });
});

export const GET = route(
  async (req, { user }) => {
    const code = req.nextUrl.searchParams.get("patient");
    if (!code) throw new HttpError(400, "patient is required");
    const patient = must(
      await db().from("patients").select("code, profile_id").eq("code", code).maybeSingle(),
      "patient",
    ) as { code: string; profile_id: string } | null;
    if (!patient) throw new HttpError(404, "Patient not found");
    if (patient.profile_id !== user.profile!.id) throw new HttpError(403, "Only the patient can read this access log");

    const logs = must(
      await db()
        .from("access_logs")
        .select("*")
        .eq("patient_code", code)
        .order("created_at", { ascending: false })
        .limit(200),
      "access logs",
    ) as AccessLogRow[];

    const actorIds = [...new Set(logs.map((l) => l.actor_profile_id).filter((x): x is string => !!x))];
    const actors = actorIds.length
      ? (must(
          await db().from("profiles").select("id, display_name, role").in("id", actorIds),
          "log actors",
        ) as { id: string; display_name: string; role: string }[])
      : [];
    const byId = new Map(actors.map((a) => [a.id, a]));

    return ok({
      logs: logs.map((l) => {
        const actor = l.actor_profile_id ? byId.get(l.actor_profile_id) : undefined;
        return {
          ...l,
          actor_name: actor?.display_name ?? (l.actor_profile_id ? "Unknown user" : "System"),
          actor_role: actor?.role ?? "system",
        };
      }),
    });
  },
  { roles: ["benh_nhan"] },
);
