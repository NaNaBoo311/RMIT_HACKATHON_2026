// GET /api/tide/admin-policy [benh_vien] -> { policyB64 }
// The realm's signed admin policy. The hospital's enclave attaches it when signing grants. It is not
// a key and decrypts nothing; it only proves the signer is the realm admin.
import { route, ok, HttpError } from "@/lib/http";
import { getAdminPolicyB64 } from "@/lib/tidecloakAdmin";
import { SERVER_TIDE_MODE } from "@/lib/auth/localTideJWT";

export const GET = route(
  async () => {
    // Local mode: the stand-in checks the signer's tide-realm-admin role itself; no admin policy exists.
    if (SERVER_TIDE_MODE === "local") return ok({ policyB64: Buffer.from("local-admin-policy").toString("base64") });
    try {
      return ok({ policyB64: getAdminPolicyB64() });
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err);
      throw new HttpError(
        500,
        `Admin policy unavailable (data/admin-policy.json): ${why}. Export it once with the init script (see docs/TIDECLOAK_SETUP.md).`,
      );
    }
  },
  { roles: ["benh_vien"] },
);
