// Which TideCloak the BROWSER talks to. Build-time constant (NEXT_PUBLIC_*), so hook choice is stable.
//   live      -> real TideCloak + Tide network (@tidecloak/nextjs, IAMService, RelationshipAttestation:1)
//   local     -> tide-local/server.mjs, a local stand-in (see tide-local/PROTOCOL.md). Unset means live.
// The SERVER reads its own TIDE_MODE (src/lib/auth/simJWT.ts) and accepts only that mode's tokens.
export const TIDE_MODE: "live" | "local" = process.env.NEXT_PUBLIC_TIDE_MODE === "local" ? "local" : "live";
export const TIDE_LOCAL = TIDE_MODE === "local";
export const TIDE_LOCAL_URL = (process.env.NEXT_PUBLIC_TIDE_LOCAL_URL || "http://localhost:8090").replace(/\/+$/, "");
