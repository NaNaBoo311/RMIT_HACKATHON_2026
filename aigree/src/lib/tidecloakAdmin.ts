// SERVER ONLY. The realm's signed admin policy (tide-realm-admin, "M0"). It authorises the hospital's
// enclave to sign RelationshipAttestation policies; it is NOT a key and decrypts nothing.
//
// The init script exports it once, after the firstAdmin -> multiAdmin flip, to data/admin-policy.json
// (GET /admin/realms/{realm}/iga/role-policies[/name/tide-realm-admin]). That keeps master-admin and
// service-account credentials out of the app server entirely: in this design the server never creates,
// assigns or removes roles, so it needs no TideCloak admin account at all.
import { readFileSync } from "fs";
import { join } from "path";

let cached: string | null = null;

/** The admin policy as base64, from data/admin-policy.json (object, or the list endpoint's array). */
export function getAdminPolicyB64(): string {
  if (cached) return cached;
  const raw = JSON.parse(readFileSync(join(process.cwd(), "data", "admin-policy.json"), "utf-8"));
  const pick = (o: unknown): string | null =>
    o && typeof o === "object" && typeof (o as { policy?: unknown }).policy === "string"
      ? ((o as { policy: string }).policy)
      : null;
  let policy = pick(raw);
  if (!policy && Array.isArray(raw)) {
    const admin = raw.find((p: { name?: string }) => p?.name === "tide-realm-admin") ?? raw[0];
    policy = pick(admin);
  }
  if (!policy) throw new Error("data/admin-policy.json has no `policy` field. Re-run the export in docs/TIDECLOAK_SETUP.md");
  cached = policy;
  return policy;
}
