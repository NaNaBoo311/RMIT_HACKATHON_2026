// SERVER ONLY. CCCD lookup key: HMAC-SHA256 with a server secret. Never plain SHA-256: a 12-digit
// CCCD is trivially brute-forced. The raw CCCD is never stored or logged.
import { createHmac } from "crypto";

export function normalizeCccd(input: unknown): string {
  const digits = String(input ?? "").replace(/\D/g, "");
  if (digits.length !== 12) throw new Error("CCCD must be 12 digits");
  return digits;
}

export function hmacCccd(cccd: string): string {
  const secret = process.env.CCCD_HMAC_SECRET;
  if (!secret || secret.length < 32) throw new Error("CCCD_HMAC_SECRET must be set (32+ chars)");
  return createHmac("sha256", secret).update(normalizeCccd(cccd)).digest("hex");
}

/** "079212341234" -> "0792••••1234" */
export function maskCccd(cccd: string): string {
  const d = normalizeCccd(cccd);
  return `${d.slice(0, 4)}••••${d.slice(-4)}`;
}
