// SERVER ONLY. Grant bookkeeping. A grant row is a RelationshipAttestation:1 policy naming one user
// and one compartment tag. The server can only create it as `pending_signature`; it becomes usable
// when the hospital account's Tide enclave signs it (POST /api/grants/sign). Revoking stops the
// server handing the policy out; the network itself refuses it after `expires_at`.
import { db, must } from "./db";
import type { GrantAccess, LogAction, PolicyGrantRow } from "./types";

export interface NewGrants {
  subjectProfileId: string;
  patientCode: string;
  tags: { tag: string; access: GrantAccess }[];
  expiresAt: string | Date;
  visitId?: string | null;
  accessRequestId?: string | null;
  emergencyId?: string | null;
}

export async function createPendingGrants(g: NewGrants, actorProfileId: string | null): Promise<PolicyGrantRow[]> {
  if (!g.tags.length) return [];
  const expires = new Date(g.expiresAt).toISOString();
  const rows = g.tags.map((t) => ({
    subject_profile_id: g.subjectProfileId,
    patient_code: g.patientCode,
    tag: t.tag,
    access: t.access,
    status: "pending_signature",
    expires_at: expires,
    visit_id: g.visitId ?? null,
    access_request_id: g.accessRequestId ?? null,
    emergency_id: g.emergencyId ?? null,
  }));
  const created = must(await db().from("policy_grants").insert(rows).select("*"), "create grants") as PolicyGrantRow[];
  await logAccess(
    created.map((r) => ({
      patientCode: r.patient_code,
      actorProfileId,
      action: "grant" as const,
      tag: r.tag,
      visitId: r.visit_id,
    })),
  );
  return created;
}

/** Revoke grants matching the filter (pending or active). Returns the revoked rows. */
export async function revokeGrants(
  filter: { ids?: string[]; visitId?: string; emergencyId?: string; accessRequestId?: string },
  actorProfileId: string | null,
): Promise<PolicyGrantRow[]> {
  let q = db()
    .from("policy_grants")
    .update({ status: "revoked", revoked_at: new Date().toISOString() })
    .in("status", ["pending_signature", "active"]);
  if (filter.ids) q = q.in("id", filter.ids);
  else if (filter.visitId) q = q.eq("visit_id", filter.visitId);
  else if (filter.emergencyId) q = q.eq("emergency_id", filter.emergencyId);
  else if (filter.accessRequestId) q = q.eq("access_request_id", filter.accessRequestId);
  else throw new Error("revokeGrants needs a filter");
  const revoked = must(await q.select("*"), "revoke grants") as PolicyGrantRow[];
  await logAccess(
    revoked.map((r) => ({ patientCode: r.patient_code, actorProfileId, action: "revoke" as const, tag: r.tag, visitId: r.visit_id })),
  );
  return revoked;
}

/**
 * Lazy expiry, called from list routes. Marks grants past `expires_at` expired, visits past
 * `ends_at` expired (revoking their grants), and approved emergencies past `expires_at` expired.
 */
export async function expireStale(): Promise<void> {
  const now = new Date().toISOString();
  await db()
    .from("policy_grants")
    .update({ status: "expired" })
    .in("status", ["pending_signature", "active"])
    .lt("expires_at", now);

  const stale = must(
    await db()
      .from("visits")
      .update({ status: "expired" })
      .in("status", ["pending_consent", "awaiting_cosign", "active"])
      .lt("ends_at", now)
      .select("id"),
    "expire visits",
  ) as { id: string }[];
  for (const v of stale) await revokeGrants({ visitId: v.id }, null);

  await db()
    .from("emergency_requests")
    .update({ status: "expired" })
    .in("status", ["pending", "approved"])
    .lt("expires_at", now);
}

/**
 * Active, unexpired grants for a user, optionally for one patient. Visit grants count only once
 * the visit has started: a Tide policy has an expiry but no not-before, so this is the guard.
 */
export async function activeGrantsFor(profileId: string, patientCode?: string): Promise<PolicyGrantRow[]> {
  const now = new Date().toISOString();
  let q = db()
    .from("policy_grants")
    .select("*")
    .eq("subject_profile_id", profileId)
    .eq("status", "active")
    .gt("expires_at", now);
  if (patientCode) q = q.eq("patient_code", patientCode);
  const grants = must(await q, "active grants") as PolicyGrantRow[];

  const visitIds = [...new Set(grants.map((g) => g.visit_id).filter((x): x is string => !!x))];
  if (!visitIds.length) return grants;
  const started = must(
    await db().from("visits").select("id").in("id", visitIds).lte("starts_at", now),
    "started visits",
  ) as { id: string }[];
  const startedIds = new Set(started.map((v) => v.id));
  return grants.filter((g) => !g.visit_id || startedIds.has(g.visit_id));
}

/**
 * After grants are signed: a visit whose grants are all active becomes `active`; a patient whose
 * own registration grants are all active becomes `active`.
 */
export async function settleAfterSign(grants: PolicyGrantRow[]): Promise<void> {
  const visitIds = [...new Set(grants.map((g) => g.visit_id).filter((x): x is string => !!x))];
  for (const visitId of visitIds) {
    const pending = must(
      await db()
        .from("policy_grants")
        .select("id")
        .eq("visit_id", visitId)
        .is("access_request_id", null)
        .eq("status", "pending_signature"),
      "pending visit grants",
    ) as { id: string }[];
    if (!pending.length) {
      await db().from("visits").update({ status: "active" }).eq("id", visitId).eq("status", "awaiting_cosign");
    }
  }

  const ownGrantPatients = [
    ...new Set(grants.filter((g) => !g.visit_id && !g.emergency_id && !g.access_request_id).map((g) => g.patient_code)),
  ];
  for (const code of ownGrantPatients) {
    const patient = must(
      await db().from("patients").select("code, profile_id").eq("code", code).maybeSingle(),
      "patient",
    ) as { code: string; profile_id: string } | null;
    if (!patient) continue;
    const pending = must(
      await db()
        .from("policy_grants")
        .select("id")
        .eq("patient_code", code)
        .eq("subject_profile_id", patient.profile_id)
        .eq("status", "pending_signature"),
      "pending patient grants",
    ) as { id: string }[];
    if (!pending.length) {
      await db().from("patients").update({ status: "active" }).eq("code", code).eq("status", "awaiting_activation");
    }
  }
}

export interface LogEntry {
  patientCode: string | null;
  actorProfileId: string | null;
  action: LogAction;
  tag?: string | null;
  visitId?: string | null;
}

export async function logAccess(entries: LogEntry | LogEntry[]): Promise<void> {
  const list = Array.isArray(entries) ? entries : [entries];
  if (!list.length) return;
  const { error } = await db()
    .from("access_logs")
    .insert(
      list.map((e) => ({
        patient_code: e.patientCode,
        actor_profile_id: e.actorProfileId,
        action: e.action,
        tag: e.tag ?? null,
        visit_id: e.visitId ?? null,
      })),
    );
  if (error) console.error("[access_logs]", error.message);
}

export async function getBreachDrill(): Promise<boolean> {
  const { data } = await db().from("demo_settings").select("value").eq("key", "hacker_mode").maybeSingle();
  return data?.value === true || data?.value === "true";
}
