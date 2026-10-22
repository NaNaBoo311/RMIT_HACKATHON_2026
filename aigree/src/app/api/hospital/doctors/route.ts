// GET /api/hospital/doctors [benh_vien] -> { doctors: { id, display_name, specialties }[] }
// Doctors who have signed in at least once (profiles are synced on first login).
import { route, ok } from "@/lib/http";
import { db, must } from "@/lib/db";

export const GET = route(
  async () => {
    const doctors = must(
      await db()
        .from("profiles")
        .select("id, display_name, specialties")
        .eq("role", "bac_si")
        .order("display_name", { ascending: true }),
      "doctors",
    ) as { id: string; display_name: string; specialties: string[] | null }[];
    return ok({ doctors: doctors.map((d) => ({ ...d, specialties: d.specialties ?? [] })) });
  },
  { roles: ["benh_vien"] },
);
