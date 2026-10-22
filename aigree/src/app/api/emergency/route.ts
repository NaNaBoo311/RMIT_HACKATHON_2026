// GET  /api/emergency [any]  -> { emergencies: EmergencyView[] }
//   doctor: own requests; hospital: all; patient: requests on their own record + records they are
//   linked to as family (those they can approve).
// POST /api/emergency [bac_si with khoa_capcuu] body { patient_code, reason } -> { emergency }
//   Creating the request counts as the doctor's approval (1 of the 2 needed). The approval window
//   is 30 minutes; once approved, access lasts 60 minutes.
import { route, ok, readJson, HttpError } from "@/lib/http";
import { db, must } from "@/lib/db";
import { expireStale, logAccess } from "@/lib/grants";
import type { ApproverType, EmergencyApprovalRow, EmergencyRequestRow, EmergencyView } from "@/lib/types";

const APPROVAL_WINDOW_MIN = 30;

const uniq = (xs: (string | null | undefined)[]) => [...new Set(xs.filter((x): x is string => !!x))];

export const GET = route(async (_req, { user }) => {
  await expireStale();
  const me = user.profile!;
  const role = user.appRole;

  // Which requests the caller may see, and which patient codes they are family for.
  let rows: EmergencyRequestRow[] = [];
  let familyCodes: string[] = [];
  if (role === "benh_vien") {
    rows = must(
      await db().from("emergency_requests").select("*").order("created_at", { ascending: false }).limit(100),
      "emergencies",
    ) as EmergencyRequestRow[];
  } else if (role === "bac_si") {
    rows = must(
      await db()
        .from("emergency_requests")
        .select("*")
        .eq("doctor_profile_id", me.id)
        .order("created_at", { ascending: false }),
      "emergencies",
    ) as EmergencyRequestRow[];
  } else if (role === "benh_nhan") {
    const own = must(
      await db().from("patients").select("code").eq("profile_id", me.id).maybeSingle(),
      "patient",
    ) as { code: string } | null;
    const links = must(
      await db().from("family_links").select("patient_code").eq("family_profile_id", me.id),
      "family links",
    ) as { patient_code: string }[];
    familyCodes = links.map((l) => l.patient_code);
    const codes = uniq([own?.code, ...familyCodes]);
    if (codes.length) {
      rows = must(
        await db()
          .from("emergency_requests")
          .select("*")
          .in("patient_code", codes)
          .order("created_at", { ascending: false }),
        "emergencies",
      ) as EmergencyRequestRow[];
    }
  }
  if (!rows.length) return ok({ emergencies: [] });

  const approvals = must(
    await db().from("emergency_approvals").select("*").in("request_id", rows.map((r) => r.id)),
    "approvals",
  ) as EmergencyApprovalRow[];
  const patients = must(
    await db().from("patients").select("code, profile_id").in("code", uniq(rows.map((r) => r.patient_code))),
    "patients",
  ) as { code: string; profile_id: string }[];
  const profileIds = uniq([...patients.map((p) => p.profile_id), ...rows.map((r) => r.doctor_profile_id)]);
  const people = profileIds.length
    ? (must(await db().from("profiles").select("id, display_name").in("id", profileIds), "profiles") as {
        id: string;
        display_name: string;
      }[])
    : [];
  const nameOf = (id: string | null | undefined) => people.find((p) => p.id === id)?.display_name ?? "unknown";

  const emergencies: EmergencyView[] = rows.map((r) => {
    const types = [...new Set(approvals.filter((a) => a.request_id === r.id).map((a) => a.approver_type))] as ApproverType[];
    const open = r.status === "pending" && (!r.expires_at || new Date(r.expires_at).getTime() > Date.now());
    let canApproveAs: ApproverType | null = null;
    if (open && role === "benh_vien" && !types.includes("hospital")) canApproveAs = "hospital";
    if (open && role === "benh_nhan" && familyCodes.includes(r.patient_code) && !types.includes("family")) {
      canApproveAs = "family";
    }
    return {
      ...r,
      patient_name: nameOf(patients.find((p) => p.code === r.patient_code)?.profile_id),
      doctor_name: nameOf(r.doctor_profile_id),
      approvals: types,
      canApproveAs,
    };
  });
  return ok({ emergencies });
});

export const POST = route(
  async (req, { user }) => {
    if (!user.specialties.includes("capcuu")) throw new HttpError(403, "Only emergency doctors (khoa_capcuu) can open an emergency request");
    const me = user.profile!;
    if (!me.tide_user_key) throw new HttpError(409, "Your profile has no Tide user key yet: sign out and in again");

    const body = await readJson<{ patient_code?: unknown; reason?: unknown }>(req);
    const code = typeof body.patient_code === "string" ? body.patient_code.trim() : "";
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (!code) throw new HttpError(400, "patient_code is required");
    if (!reason) throw new HttpError(400, "reason is required");
    if (reason.length > 500) throw new HttpError(400, "reason must be at most 500 characters");

    const patient = must(
      await db().from("patients").select("code, profile_id").eq("code", code).maybeSingle(),
      "patient",
    ) as { code: string; profile_id: string } | null;
    if (!patient) throw new HttpError(404, "Patient not found");

    const expiresAt = new Date(Date.now() + APPROVAL_WINDOW_MIN * 60_000).toISOString();
    const emergency = must(
      await db()
        .from("emergency_requests")
        .insert({ patient_code: code, doctor_profile_id: me.id, reason, status: "pending", expires_at: expiresAt })
        .select("*")
        .single(),
      "create emergency",
    ) as EmergencyRequestRow;
    must(
      await db()
        .from("emergency_approvals")
        .insert({ request_id: emergency.id, approver_profile_id: me.id, approver_type: "doctor" }),
      "doctor approval",
    );
    await logAccess({ patientCode: code, actorProfileId: me.id, action: "emergency" });

    const patientProfile = must(
      await db().from("profiles").select("display_name").eq("id", patient.profile_id).maybeSingle(),
      "patient profile",
    ) as { display_name: string } | null;
    const view: EmergencyView = {
      ...emergency,
      patient_name: patientProfile?.display_name ?? "unknown",
      doctor_name: me.display_name,
      approvals: ["doctor"],
      canApproveAs: null,
    };
    return ok({ emergency: view }, 201);
  },
  { roles: ["bac_si"] },
);
