// POST /api/profile/sync [any signed-in user]
// Create or update the caller's profiles row from the verified token, then report whether the
// caller is a registered patient. Called by the session provider after every login.
import { route, ok, HttpError } from "@/lib/http";
import { db, must } from "@/lib/db";
import type { PatientRow, Profile } from "@/lib/types";

export const POST = route(
  async (_req, { user }) => {
    if (!user.appRole) throw new HttpError(403, "Your account has no AIgree role (benh_nhan, bac_si or benh_vien)");

    const row: Record<string, unknown> = {
      tide_user_id: user.sub,
      role: user.appRole,
      display_name: user.displayName,
      specialties: user.specialties,
    };
    // Never overwrite a known Tide key with null (an old token may lack the claim).
    if (user.tideUserKey) row.tide_user_key = user.tideUserKey;

    const profile = must(
      await db().from("profiles").upsert(row, { onConflict: "tide_user_id" }).select("*").single(),
      "sync profile",
    ) as Profile;

    const patient = must(
      await db().from("patients").select("code, status, cccd_ciphertext").eq("profile_id", profile.id).maybeSingle(),
      "patient",
    ) as Pick<PatientRow, "code" | "status" | "cccd_ciphertext"> | null;

    return ok({
      profile,
      patient: patient ? { code: patient.code, status: patient.status, hasCccd: !!patient.cccd_ciphertext } : null,
    });
  },
  { requireProfile: false },
);
