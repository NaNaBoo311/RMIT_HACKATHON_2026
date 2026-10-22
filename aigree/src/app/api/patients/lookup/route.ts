// POST /api/patients/lookup [bac_si, benh_vien]  body { cccd } -> { code, display_name, masked_cccd, status }
// The CCCD travels only in the POST body; it is matched by HMAC and never stored or logged.
import { route, ok, readJson, HttpError } from "@/lib/http";
import { db, must } from "@/lib/db";
import { hmacCccd, maskCccd, normalizeCccd } from "@/lib/crypto";
import type { PatientRow } from "@/lib/types";

export const POST = route(
  async (req) => {
    const body = await readJson<{ cccd?: unknown }>(req);
    let cccd: string;
    try {
      cccd = normalizeCccd(body.cccd);
    } catch {
      throw new HttpError(400, "CCCD must be 12 digits");
    }

    const patient = must(
      await db().from("patients").select("code, profile_id, status").eq("cccd_hmac", hmacCccd(cccd)).maybeSingle(),
      "patient lookup",
    ) as Pick<PatientRow, "code" | "profile_id" | "status"> | null;
    if (!patient) throw new HttpError(404, "No patient with that CCCD");

    const profile = must(
      await db().from("profiles").select("display_name").eq("id", patient.profile_id).maybeSingle(),
      "patient profile",
    ) as { display_name: string } | null;

    return ok({
      code: patient.code,
      display_name: profile?.display_name ?? "Unknown patient",
      masked_cccd: maskCccd(cccd),
      status: patient.status,
    });
  },
  { roles: ["bac_si", "benh_vien"] },
);
