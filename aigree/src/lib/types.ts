// Row shapes shared by server routes and client pages. No plaintext medical data ever lives here.

export type ProfileRole = "benh_nhan" | "bac_si" | "benh_vien";

export interface Profile {
  id: string;
  tide_user_key: string | null;
  tide_user_id: string;
  role: ProfileRole;
  display_name: string;
  specialties: string[];
  created_at: string;
}

export interface PatientRow {
  code: string;
  profile_id: string;
  cccd_hmac: string;
  cccd_ciphertext: string | null;
  status: "awaiting_activation" | "active";
  created_at: string;
}

export type RecordKind = "mat" | "noitiet" | "thietyeu";

export interface RecordRow {
  id: string;
  patient_code: string;
  kind: RecordKind;
  tag: string;
  ciphertext: string;
  author_profile_id: string | null;
  visit_id: string | null;
  created_at: string;
}

export type VisitStatus = "pending_consent" | "awaiting_cosign" | "active" | "declined" | "completed" | "expired";

export interface VisitRow {
  id: string;
  patient_code: string;
  doctor_profile_id: string;
  specialties: string[];
  starts_at: string;
  ends_at: string;
  status: VisitStatus;
  created_at: string;
}

export interface AccessRequestRow {
  id: string;
  visit_id: string;
  specialty: string;
  status: "pending" | "approved" | "declined";
  created_at: string;
  decided_at: string | null;
}

export interface EmergencyRequestRow {
  id: string;
  patient_code: string;
  doctor_profile_id: string;
  reason: string;
  status: "pending" | "approved" | "expired";
  expires_at: string | null;
  created_at: string;
}

export type ApproverType = "doctor" | "hospital" | "family";

export interface EmergencyApprovalRow {
  request_id: string;
  approver_profile_id: string;
  approver_type: ApproverType;
  approved_at: string;
}

export type GrantAccess = "read" | "read-write";
export type GrantStatus = "pending_signature" | "active" | "revoked" | "expired";

export interface PolicyGrantRow {
  id: string;
  subject_profile_id: string;
  patient_code: string;
  tag: string;
  access: GrantAccess;
  status: GrantStatus;
  policy_b64: string | null;
  expires_at: string;
  visit_id: string | null;
  access_request_id: string | null;
  emergency_id: string | null;
  signed_by: string | null;
  created_at: string;
  signed_at: string | null;
  revoked_at: string | null;
}

export type LogAction = "decrypt" | "encrypt" | "denied" | "emergency" | "grant" | "revoke" | "sign";

export interface AccessLogRow {
  id: string;
  patient_code: string | null;
  actor_profile_id: string | null;
  action: LogAction;
  tag: string | null;
  visit_id: string | null;
  created_at: string;
}

/** What GET /api/records returns: ciphertext plus the policies the browser needs to try decryption. */
export interface RecordsResponse {
  records: Pick<RecordRow, "id" | "kind" | "tag" | "ciphertext" | "created_at" | "author_profile_id" | "visit_id">[];
  /** tag -> signed policy (base64). Normally only the caller's own active grants. */
  policies: Record<string, string>;
  breachDrill: boolean;
  /** The patient's encrypted CCCD (tag <code>_dinhdanh), only when the caller holds that grant (or breach drill). */
  identity?: { tag: string; ciphertext: string } | null;
}

/** Plaintext of a record, JSON.stringify'd before encryption. */
export interface RecordPlain {
  title: string;
  body: string;
  /** ISO date of the clinical event. */
  date: string;
}

export type DecryptedRecord = Pick<RecordRow, "id" | "kind" | "tag" | "created_at" | "author_profile_id" | "visit_id"> &
  ({ ok: true; data: RecordPlain } | { ok: false; error: string });

export interface VisitView extends VisitRow {
  doctor_name: string;
  patient_name: string;
  requests: AccessRequestRow[];
}

/** A grant as shown to people (never includes policy bytes). */
export interface GrantView extends Omit<PolicyGrantRow, "policy_b64"> {
  subject_name: string;
}

export interface EmergencyView extends EmergencyRequestRow {
  patient_name: string;
  doctor_name: string;
  approvals: ApproverType[];
  /** The approver type the caller could add now, or null. */
  canApproveAs: ApproverType | null;
}

/** A grant waiting for the hospital's Tide enclave signature, as GET /api/grants returns it. */
export interface PendingGrant {
  id: string;
  tag: string;
  access: GrantAccess;
  expires_at: string;
  patient_code: string;
  subject_profile_id: string;
  subject_name: string;
  /** The grantee's tideuserkey: the policy's subjectId. */
  subject_key: string | null;
  visit_id: string | null;
  access_request_id: string | null;
  emergency_id: string | null;
  reason: string;
}
