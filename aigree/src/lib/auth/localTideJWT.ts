// SERVER ONLY. Which TideCloak the API trusts, and the verifier for local stand-in tokens.
//
// The server reads TIDE_MODE once. It accepts ONLY that mode's tokens: a stand-in token is never
// valid in live mode (different key, and the `tide_local` claim is refused), and vice versa. Unset = live.
//
// Stand-in tokens are verified like real Tide tokens: local JWKS only (no remote fetch), then
// iss / azp / exp. The JWKS is the public half tide-local/server.mjs writes to data/tidecloak.local.json.
import { readFileSync, statSync } from "fs";
import { join } from "path";
import { createLocalJWKSet, jwtVerify, importJWK, compactVerify, type JWK, type JWTPayload } from "jose";

export const SERVER_TIDE_MODE: "live" | "local" = process.env.TIDE_MODE === "local" ? "local" : "live";

interface SimAdapter {
  realm: string;
  "auth-server-url": string;
  resource: string;
  jwk: { keys: JWK[] };
  policyJwk: JWK;
}

const ADAPTER_PATH = join(process.cwd(), "data", "tidecloak.local.json");
let cache: { mtime: number; adapter: SimAdapter; jwks: ReturnType<typeof createLocalJWKSet> } | null = null;

function simAdapter() {
  let mtime: number;
  try {
    mtime = statSync(ADAPTER_PATH).mtimeMs;
  } catch {
    throw new Error("data/tidecloak.local.json missing: start the local Tide stand-in (npm run tide:local)");
  }
  if (!cache || cache.mtime !== mtime) {
    const adapter = JSON.parse(readFileSync(ADAPTER_PATH, "utf-8")) as SimAdapter;
    cache = { mtime, adapter, jwks: createLocalJWKSet(adapter.jwk) };
  }
  return cache;
}

export async function verifyLocalJWT(token: string): Promise<JWTPayload> {
  const { adapter, jwks } = simAdapter();
  const { payload } = await jwtVerify(token, jwks, {
    issuer: `${adapter["auth-server-url"].replace(/\/+$/, "")}/realms/${adapter.realm}`,
  });
  if (payload.azp !== adapter.resource) throw new Error("Token azp does not match client");
  if (payload.tide_local !== true) throw new Error("Not a local stand-in token");
  return payload;
}

/** Verify a stand-in signed policy (tide-local format) and return its fields, or throw. */
export async function readLocalPolicy(policyB64: string): Promise<{
  contractId: string;
  subjectId: string;
  assignmentId: string;
  roles: string;
  expiry: number | null;
  signed: boolean;
}> {
  const { adapter } = simAdapter();
  const env = JSON.parse(Buffer.from(policyB64, "base64url").toString("utf-8")) as {
    policy: { contractId: string; subjectId: string; assignmentId: string; roles: string; expiry: number };
    sig: string;
  };
  const key = await importJWK(adapter.policyJwk, "ES256");
  const { payload } = await compactVerify(env.sig, key);
  const signedPolicy = JSON.parse(new TextDecoder().decode(payload));
  if (JSON.stringify(signedPolicy) !== JSON.stringify(env.policy)) throw new Error("policy does not match its signature");
  return {
    contractId: env.policy.contractId,
    subjectId: env.policy.subjectId,
    assignmentId: env.policy.assignmentId,
    roles: env.policy.roles,
    expiry: typeof env.policy.expiry === "number" ? env.policy.expiry : null,
    signed: true,
  };
}
