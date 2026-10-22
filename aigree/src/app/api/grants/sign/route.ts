// POST /api/grants/sign [benh_vien] body { items: { id, policy_b64 }[] } -> { signed }
// The hospital's browser signed these policies in its Tide enclave; this route only stores the bytes.
// It cannot forge one: the network checks the signature on every encrypt/decrypt. We still check that
// each policy names the grant's subject and tag, so a mix-up is caught here and not at decrypt time.
// All items are validated first; the batch is written only if every item passes.
import { route, ok, readJson, HttpError } from "@/lib/http";
import { db, must } from "@/lib/db";
import { logAccess, settleAfterSign } from "@/lib/grants";
import type { PolicyGrantRow } from "@/lib/types";
import { SERVER_TIDE_MODE, readLocalPolicy } from "@/lib/auth/localTideJWT";

const RELATIONSHIP_CONTRACT_ID = "RelationshipAttestation:1";
const B64 = /^[A-Za-z0-9+/]+={0,2}$/;
const B64URL = /^[A-Za-z0-9_-]+$/; // local stand-in policies are base64url

interface Item {
  id: string;
  policy_b64: string;
}

/**
 * Read contractId / subjectId / assignmentId from signed policy bytes with the Tide SDK.
 * Returns null when the SDK cannot be loaded or parse on the server (then we skip the check:
 * the network still verifies everything at use time).
 */
async function readPolicy(b64: string): Promise<{
  contractId: string;
  subjectId: string;
  assignmentId: string;
  roles: string;
  expiry: number | null;
  signed: boolean;
} | null> {
  if (SERVER_TIDE_MODE === "local") {
    try {
      return await readLocalPolicy(b64);
    } catch (err) {
      throw new HttpError(400, `policy is not a valid signed policy: ${err instanceof Error ? err.message : err}`);
    }
  }
  try {
    const { Models } = await import("@tideorg/js");
    // Copy into a fresh Uint8Array: Buffers from Node's pool have a non-zero byteOffset.
    const p = Models.Policy.from(new Uint8Array(Buffer.from(b64, "base64")));
    const param = (k: string) => String(p.params.entries.get(k) ?? "");
    return {
      contractId: p.contractId,
      subjectId: param("subjectId"),
      assignmentId: param("assignmentId"),
      roles: param("roles"),
      expiry: p.expiry === undefined ? null : Number(p.expiry),
      signed: !!p.signature && p.signature.length > 0,
    };
  } catch (err) {
    console.warn("[grants/sign] could not parse policy on the server; skipping check:", err instanceof Error ? err.message : err);
    return null;
  }
}

export const POST = route(
  async (req, { user }) => {
    const body = await readJson<{ items?: unknown }>(req);
    if (!Array.isArray(body.items) || !body.items.length) throw new HttpError(400, "items must be a non-empty array");
    const items: Item[] = body.items.map((raw) => {
      const it = raw as Partial<Item>;
      if (typeof it?.id !== "string" || !it.id) throw new HttpError(400, "each item needs an id");
      const b64 = typeof it.policy_b64 === "string" ? it.policy_b64.trim() : "";
      const wellFormed = SERVER_TIDE_MODE === "local" ? B64URL.test(b64) : b64.length % 4 === 0 && B64.test(b64);
      if (!b64 || !wellFormed) throw new HttpError(400, `grant ${it.id}: policy_b64 is not base64`);
      return { id: it.id, policy_b64: b64 };
    });
    const ids = [...new Set(items.map((i) => i.id))];

    const grants = must(await db().from("policy_grants").select("*").in("id", ids), "grants") as PolicyGrantRow[];
    const subjectIds = [...new Set(grants.map((g) => g.subject_profile_id))];
    const subjects = subjectIds.length
      ? (must(await db().from("profiles").select("id, tide_user_key").in("id", subjectIds), "subjects") as {
          id: string;
          tide_user_key: string | null;
        }[])
      : [];

    const now = Date.now();
    // Grants revoked or expired while the popup was open are skipped, not fatal: the rest of the
    // batch was signed in the same enclave approval and should still be stored.
    const fresh: Item[] = [];
    for (const it of items) {
      const g = grants.find((x) => x.id === it.id);
      if (!g) throw new HttpError(404, `grant ${it.id} not found`);
      if (g.status !== "pending_signature" || new Date(g.expires_at).getTime() <= now) continue;
      fresh.push(it);

      const parsed = await readPolicy(it.policy_b64);
      if (!parsed) continue;
      const subjectKey = subjects.find((s) => s.id === g.subject_profile_id)?.tide_user_key ?? null;
      if (parsed.contractId !== RELATIONSHIP_CONTRACT_ID) {
        throw new HttpError(400, `grant ${it.id}: policy contract is ${parsed.contractId || "missing"}`);
      }
      if (parsed.assignmentId !== g.tag) throw new HttpError(400, `grant ${it.id}: policy tag does not match the grant`);
      if (!subjectKey || parsed.subjectId !== subjectKey) {
        throw new HttpError(400, `grant ${it.id}: policy subject does not match the grantee`);
      }
      if (!parsed.signed) throw new HttpError(400, `grant ${it.id}: policy is not signed`);
      const wantRoles = JSON.stringify(g.access === "read" ? ["_tide_decryptor"] : ["_tide_encryptor", "_tide_decryptor"]);
      if (parsed.roles !== wantRoles) throw new HttpError(400, `grant ${it.id}: policy access does not match the grant`);
      if (!parsed.expiry || parsed.expiry > Math.ceil(new Date(g.expires_at).getTime() / 1000) + 60) {
        throw new HttpError(400, `grant ${it.id}: policy must expire no later than the grant`);
      }
    }

    // Write. The status guard makes a double submit harmless.
    const signedAt = new Date().toISOString();
    const updated: PolicyGrantRow[] = [];
    for (const it of fresh) {
      const rows = must(
        await db()
          .from("policy_grants")
          .update({ status: "active", policy_b64: it.policy_b64, signed_by: user.profile!.id, signed_at: signedAt })
          .eq("id", it.id)
          .eq("status", "pending_signature")
          .gt("expires_at", signedAt)
          .select("*"),
        "sign grant",
      ) as PolicyGrantRow[];
      updated.push(...rows);
    }

    await logAccess(
      updated.map((g) => ({
        patientCode: g.patient_code,
        actorProfileId: user.profile!.id,
        action: "sign" as const,
        tag: g.tag,
        visitId: g.visit_id,
      })),
    );
    await settleAfterSign(updated);
    return ok({ signed: updated.length });
  },
  { roles: ["benh_vien"] },
);
