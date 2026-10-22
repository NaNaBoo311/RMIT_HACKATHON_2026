import { NextRequest } from "next/server";
import type { JWTPayload } from "jose";
import { verifyTideJWT, extractToken } from "./auth/tideJWT";
import { verifyDpop } from "./auth/verifyDpop";
import { SERVER_TIDE_MODE, verifyLocalJWT } from "./auth/localTideJWT";
import { db } from "./db";
import { HttpError } from "./http";
import type { Profile } from "./types";

export type AppRole = "benh_nhan" | "bac_si" | "benh_vien";

export interface AuthedUser {
  sub: string;
  /** The `tideuserkey` claim, verbatim. The subject of every User policy for this user. */
  tideUserKey: string | null;
  realmRoles: string[];
  /** Primary app role derived from realm roles (benh_vien > bac_si > benh_nhan), or null. */
  appRole: AppRole | null;
  /** Specialty codes from khoa_* roles, e.g. ["mat", "noitiet"]. */
  specialties: string[];
  displayName: string;
  jwt: JWTPayload;
  /** The caller's profiles row. Null only when requireProfile is false and sync has not run. */
  profile: Profile | null;
}

export function appRoleFrom(roles: string[]): AppRole | null {
  if (roles.includes("benh_vien")) return "benh_vien";
  if (roles.includes("bac_si")) return "bac_si";
  if (roles.includes("benh_nhan")) return "benh_nhan";
  return null;
}

/** NFC + single spaces, so names typed with different input methods still match. */
export const normalizeName = (s: string) => s.normalize("NFC").replace(/\s+/g, " ").trim();

export function displayNameFrom(jwt: JWTPayload): string {
  return normalizeName(rawDisplayName(jwt));
}

function rawDisplayName(jwt: JWTPayload): string {
  const given = typeof jwt.given_name === "string" ? jwt.given_name : "";
  const family = typeof jwt.family_name === "string" ? jwt.family_name : "";
  // Vietnamese order: family name first.
  if (given || family) return `${family} ${given}`.trim();
  if (typeof jwt.name === "string" && jwt.name) return jwt.name;
  if (typeof jwt.preferred_username === "string") return jwt.preferred_username;
  return "Unknown user";
}

/**
 * Verify the caller's TideCloak access token and DPoP proof, check roles, load the profile.
 * Throws HttpError(401/403). Roles are read only from the verified token, never from the body.
 */
export async function requireUser(
  req: NextRequest,
  roles?: AppRole[],
  opts: { requireProfile?: boolean } = {},
): Promise<AuthedUser> {
  let jwt: JWTPayload;
  try {
    const token = extractToken(req.headers.get("authorization"));
    if (SERVER_TIDE_MODE === "local") {
      // Local stand-in: signature, iss, azp, exp against its local JWKS. No DPoP in local mode.
      jwt = await verifyLocalJWT(token);
    } else {
      jwt = await verifyTideJWT(token);
      if (jwt.tide_local) throw new Error("Local stand-in tokens are not accepted in live mode");
      await verifyDpop(req, token, jwt as { cnf?: { jkt?: string } });
    }
  } catch (err) {
    throw new HttpError(401, err instanceof Error ? err.message : "Unauthorized");
  }
  if (!jwt.sub) throw new HttpError(401, "Token has no subject");

  const realmRoles: string[] = ((jwt.realm_access as { roles?: string[] } | undefined)?.roles ?? []).map(String);
  if (roles && roles.length && !roles.some((r) => realmRoles.includes(r))) {
    throw new HttpError(403, `Requires role: ${roles.join(" or ")}`);
  }

  const { data: profile } = await db()
    .from("profiles")
    .select("*")
    .eq("tide_user_id", jwt.sub)
    .maybeSingle();
  if (opts.requireProfile !== false && !profile) {
    throw new HttpError(409, "Profile not synced. Call POST /api/profile/sync first.");
  }

  return {
    sub: jwt.sub,
    tideUserKey: typeof jwt.tideuserkey === "string" ? jwt.tideuserkey : null,
    realmRoles,
    appRole: appRoleFrom(realmRoles),
    specialties: realmRoles.filter((r) => r.startsWith("khoa_")).map((r) => r.slice(5)),
    displayName: displayNameFrom(jwt),
    jwt,
    profile: (profile as Profile | null) ?? null,
  };
}
