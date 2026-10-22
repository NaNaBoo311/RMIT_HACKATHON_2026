"use client";
// AIgree's browser-side Tide helpers, built on the pack's relationship.ts
// (RelationshipAttestation:1). Everything here runs in the signed-in user's browser: the server
// never encrypts, decrypts or signs.
import { IAMService } from "@tidecloak/js";
import { Models } from "@tideorg/js";
import { PolicySignRequest } from "heimdall-tide";
import { buildRelationshipPolicy, type RelationshipAccess } from "./relationship";
import { TIDE_LOCAL } from "./mode";
import { localCall, localEnclaveConfirm } from "./localTide";

export const toBase64 = (b: Uint8Array) => {
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
};
export const fromBase64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

interface TideClient {
  createTideRequest(encodedRequest: Uint8Array): Promise<Uint8Array>;
  requestTideOperatorApproval(
    requests: { id: string; request: Uint8Array }[],
  ): Promise<{ id: string; request: Uint8Array; status: "approved" | "denied" | "pending" }[]>;
  executeSignRequest(request: Uint8Array, waitForAll?: boolean): Promise<Uint8Array[]>;
}

function tc(): TideClient {
  const client = (IAMService as unknown as { _tc: TideClient | null })._tc;
  if (!client) throw new Error("TideCloak is not initialised: sign in first");
  return client;
}

/**
 * A network refusal arrives as TIDE-TIDEJS-NET-THRESHOLD_FAILURE ("Could not reach enough VVK
 * ORKs"). That IS the refusal, not an outage (AP-RA18): the contract's message is in `cause`.
 */
export function describeTideError(err: unknown): string {
  const parts: string[] = [];
  let e: unknown = err;
  for (let depth = 0; e && depth < 5; depth++) {
    if (e instanceof Error) parts.push(e.message);
    else parts.push(String(e));
    e = (e as { cause?: unknown })?.cause;
  }
  const text = parts.join(" | ");
  const known = [
    "subjectId does not match",
    "Tags do not contain assignmentId",
    "not found in list of roles",
    "role not found for this",
    "has expired",
    "expired",
    "voucher",
  ].find((m) => text.includes(m));
  return known ? `${known} (${text.slice(0, 300)})` : text.slice(0, 400);
}

export interface GrantToSign {
  id: string;
  /** The GRANTEE's tideuserkey (never the signer's). */
  subjectKey: string;
  tag: string;
  access: RelationshipAccess;
  expiresAt: string;
}

// heimdall-tide matches an enclave reply to its waiting call by message type only (no request id),
// so two concurrent doDecrypt/createTideRequest calls can resolve with each other's replies.
// Every request-enclave call therefore goes through this one queue.
let chain: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const p = chain.then(fn, fn);
  chain = p.catch(() => {});
  return p;
}

/** The policy fields RelationshipAttestation:1 reads (the local stand-in signs exactly these). */
interface LocalPolicy {
  contractId: "RelationshipAttestation:1";
  subjectType: "User";
  subjectId: string;
  assignmentId: string;
  roles: string;
  expiry: number;
}

export type PreparedGrant =
  | { mode: "live"; grant: GrantToSign; policy: ReturnType<typeof buildRelationshipPolicy>; initialised: Uint8Array; reqId: string }
  | { mode: "local"; grant: GrantToSign; policy: LocalPolicy };

const rolesFor = (access: RelationshipAccess) =>
  JSON.stringify(access === "read" ? ["_tide_decryptor"] : access === "write" ? ["_tide_encryptor"] : ["_tide_encryptor", "_tide_decryptor"]);

/**
 * Step 1 of co-signing: build each grant's policy and initialise its sign request with the network.
 * Takes a few seconds per grant, so it runs BEFORE the approval click (the popup in step 2 must open
 * within the browser's user-activation window).
 */
export async function prepareGrants(grants: GrantToSign[], vendorId: string): Promise<PreparedGrant[]> {
  if (TIDE_LOCAL) {
    return grants.map((g) => ({
      mode: "local" as const,
      grant: g,
      policy: {
        contractId: "RelationshipAttestation:1",
        subjectType: "User",
        subjectId: g.subjectKey,
        assignmentId: g.tag,
        roles: rolesFor(g.access),
        expiry: Math.floor(new Date(g.expiresAt).getTime() / 1000),
      },
    }));
  }
  const prepared: PreparedGrant[] = [];
  for (const g of grants) {
    const policy = buildRelationshipPolicy({
      vendorId,
      subject: { type: "User", id: g.subjectKey },
      recordId: g.tag,
      access: g.access,
      expiry: Math.floor(new Date(g.expiresAt).getTime() / 1000),
    });
    const request = PolicySignRequest.New(policy);
    request.setCustomExpiry(604800);
    const initialised = await serial(() => tc().createTideRequest(request.encode()));
    const reqId = Models.BaseTideRequest.decode(initialised).getUniqueId();
    prepared.push({ mode: "live", grant: g, policy, initialised, reqId });
  }
  return prepared;
}

/**
 * Step 2: ONE Tide enclave approval popup for the whole batch (hospital account = tide-realm-admin),
 * then the network signs each approved policy. Call it straight from a click handler, or the popup
 * is blocked. Returns signed policies (base64) per grant id, plus per-grant errors; grants the admin
 * denied are in neither list.
 */
export async function approveAndSign(
  prepared: PreparedGrant[],
  adminPolicy: Uint8Array,
): Promise<{ signed: { id: string; policyB64: string }[]; errors: { id: string; error: string }[] }> {
  const signed: { id: string; policyB64: string }[] = [];
  const errors: { id: string; error: string }[] = [];

  if (TIDE_LOCAL) {
    const approvedByAdmin = await localEnclaveConfirm(
      `Sign ${prepared.length} access polic${prepared.length === 1 ? "y" : "ies"} (RelationshipAttestation:1)?`,
      prepared.map((p) => `${p.grant.tag} · ${p.grant.access} · until ${new Date(p.grant.expiresAt).toLocaleString("en-GB")}`),
    );
    if (!approvedByAdmin) return { signed, errors };
    for (const p of prepared) {
      try {
        const { policyB64 } = await localCall<{ policyB64: string }>("/policies/sign", { policy: p.policy });
        signed.push({ id: p.grant.id, policyB64 });
      } catch (err) {
        errors.push({ id: p.grant.id, error: describeTideError(err) });
      }
    }
    return { signed, errors };
  }

  const live = prepared.filter((p): p is Extract<PreparedGrant, { mode: "live" }> => p.mode === "live");
  const approvals = await tc().requestTideOperatorApproval(
    live.map((p) => ({ id: p.reqId, request: p.initialised })),
  );

  for (const p of live) {
    const approval = approvals.find((a) => a.id === p.reqId);
    if (!approval || approval.status !== "approved") continue;
    try {
      const approved = Models.BaseTideRequest.decode(approval.request);
      approved.addPolicy(adminPolicy);
      const signatures = await serial(() => tc().executeSignRequest(approved.encode(), true));
      if (!signatures?.[0]) throw new Error("the network returned no signature");
      p.policy.signature = signatures[0];
      signed.push({ id: p.grant.id, policyB64: toBase64(p.policy.toBytes()) });
    } catch (err) {
      errors.push({ id: p.grant.id, error: describeTideError(err) });
    }
  }
  return { signed, errors };
}

/** Encrypt items under one signed policy: the real Tide network (live) or the local stand-in (local mode). */
export async function encryptRaw(items: { data: string; tags: string[] }[], policyB64: string): Promise<string[]> {
  if (TIDE_LOCAL) return (await localCall<{ ciphertexts: string[] }>("/encrypt", { items, policyB64 })).ciphertexts;
  const out = await serial(() => IAMService.doEncrypt(items, fromBase64(policyB64)));
  return out.map((v) => (typeof v === "string" ? v : toBase64(v)));
}

/** Decrypt items under one signed policy: the real Tide network (live) or the local stand-in (local mode). */
export async function decryptRaw(items: { encrypted: string; tags: string[] }[], policyB64: string): Promise<string[]> {
  if (TIDE_LOCAL) return (await localCall<{ plaintexts: string[] }>("/decrypt", { items, policyB64 })).plaintexts;
  const out = await serial(() => IAMService.doDecrypt(items, fromBase64(policyB64)));
  return out.map((v) => (typeof v === "string" ? v : new TextDecoder().decode(v)));
}

export interface EncryptedItem {
  id: string;
  tag: string;
  ciphertext: string;
}

export type DecryptResult =
  | { id: string; ok: true; plaintext: string }
  | { id: string; ok: false; error: string };

/**
 * Decrypt items in one network call per compartment (each compartment has its own policy).
 * Items with no policy, or that the network refuses, come back as { ok: false }.
 */
export async function decryptItems(items: EncryptedItem[], policies: Record<string, string>): Promise<DecryptResult[]> {
  const byTag = new Map<string, EncryptedItem[]>();
  for (const it of items) byTag.set(it.tag, [...(byTag.get(it.tag) ?? []), it]);

  const results: DecryptResult[] = [];
  // One compartment at a time: see serial() above.
  for (const [tag, group] of byTag) {
    const policy = policies[tag];
    if (!policy) {
      for (const it of group) results.push({ id: it.id, ok: false, error: "No grant for this compartment" });
      continue;
    }
    try {
      const out = await decryptRaw(
        group.map((it) => ({ encrypted: it.ciphertext, tags: [tag] })),
        policy,
      );
      if (!Array.isArray(out) || out.length !== group.length) throw new Error("Unexpected decrypt response size");
      group.forEach((it, i) => results.push({ id: it.id, ok: true, plaintext: out[i] }));
    } catch (err) {
      const msg = describeTideError(err);
      for (const it of group) results.push({ id: it.id, ok: false, error: msg });
    }
  }
  return results;
}

/** Encrypt one item for a compartment. The tag is the ONLY tag (the contract rejects a second). */
export async function encryptForTag(plaintext: string, tag: string, policyB64: string): Promise<string> {
  const [out] = await encryptRaw([{ data: plaintext, tags: [tag] }], policyB64);
  return out;
}

/** The realm's vendorId, from the adapter config the provider loaded. */
export function vendorIdFromConfig(config: Record<string, unknown>): string {
  const v = config["vendorId"];
  if (typeof v !== "string" || !v) throw new Error("tidecloak.json has no vendorId");
  return v;
}
