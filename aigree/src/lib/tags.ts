// Tags. A tag is a patient compartment, e.g. "bn_7f3k9x_mat". It is also the RelationshipAttestation
// policy's assignmentId, and the ONLY tag on every encrypted item. Never put a CCCD in a tag.

export const KINDS = ["mat", "noitiet", "thietyeu", "dinhdanh"] as const;
export type Kind = (typeof KINDS)[number];

/** Kinds stored in the records table (identity lives on the patients row). */
export const RECORD_KINDS = ["mat", "noitiet", "thietyeu"] as const;

/** Specialties a visit can cover: they have their own record compartment. */
export const SPECIALTIES = ["mat", "noitiet"] as const;
export type Specialty = (typeof SPECIALTIES)[number];

export const KIND_LABEL: Record<Kind, string> = {
  mat: "Eye",
  noitiet: "Endocrine",
  thietyeu: "Essentials",
  dinhdanh: "Identity",
};

export const SPECIALTY_LABEL: Record<string, string> = {
  mat: "Ophthalmology",
  noitiet: "Endocrinology",
  capcuu: "Emergency",
};

export function tagFor(patientCode: string, kind: Kind): string {
  return `${patientCode}_${kind}`;
}

export function kindOfTag(tag: string): Kind | null {
  const k = tag.slice(tag.lastIndexOf("_") + 1);
  return (KINDS as readonly string[]).includes(k) ? (k as Kind) : null;
}

export function isSpecialty(s: unknown): s is Specialty {
  return typeof s === "string" && (SPECIALTIES as readonly string[]).includes(s);
}

/** A random internal patient code, e.g. "bn_7f3k9x". Carries no personal data. */
export function newPatientCode(): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return "bn_" + Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}
