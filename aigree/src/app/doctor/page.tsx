"use client";
// Doctor home: my visits (today / upcoming / past), book a visit by CCCD, and, for emergency
// doctors, the break-glass request. Lists poll every 5 s. The CCCD only ever travels in POST bodies.
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { RoleGate } from "@/components/AppShell";
import { Badge, Button, Card, Empty, Field, Notice, StatusBadge, fmtTime, inputClass } from "@/components/ui";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { KIND_LABEL, SPECIALTY_LABEL, isSpecialty, type Specialty } from "@/lib/tags";
import type { ApproverType, EmergencyView, VisitView } from "@/lib/types";

interface LookupResult {
  code: string;
  display_name: string;
  masked_cccd: string;
  status: "awaiting_activation" | "active";
}

const ENDED = ["completed", "expired", "declined"];
const POLL_MS = 5000;

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Run `fn` now and every `ms`, never overlapping, stopping on unmount. */
function usePoll(fn: () => Promise<void>, ms: number, enabled = true) {
  const fnRef = useRef(fn);
  useEffect(() => {
    fnRef.current = fn;
  });
  useEffect(() => {
    if (!enabled) return;
    let busy = false;
    const tick = async () => {
      if (busy) return;
      busy = true;
      try {
        await fnRef.current();
      } finally {
        busy = false;
      }
    };
    void tick();
    const t = setInterval(tick, ms);
    return () => clearInterval(t);
  }, [ms, enabled]);
}

/** Date -> value for <input type="datetime-local"> in local time. */
function toLocalInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

const specialtyNames = (list: string[]) => list.map((s) => SPECIALTY_LABEL[s] ?? s).join(", ");

export default function DoctorPage() {
  return (
    <RoleGate role="bac_si">
      <DoctorHome />
    </RoleGate>
  );
}

function DoctorHome() {
  const { profile } = useSession();
  const [visits, setVisits] = useState<VisitView[] | null>(null);
  const [visitsError, setVisitsError] = useState<string | null>(null);
  const isEmergencyDoctor = (profile?.specialties ?? []).includes("capcuu");

  const loadVisits = useCallback(async () => {
    try {
      const r = await api<{ visits: VisitView[] }>("/api/visits");
      setVisits(r.visits);
      setVisitsError(null);
    } catch (e) {
      setVisitsError(errMsg(e));
    }
  }, []);
  usePoll(loadVisits, POLL_MS);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">My visits</h1>
        <p className="text-sm text-slate-600">
          You can read a patient&apos;s records only during a visit they approved, only for that visit&apos;s specialties.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
        <VisitLists visits={visits} error={visitsError} />
        <div className="space-y-6">
          <BookVisit onBooked={loadVisits} />
          {isEmergencyDoctor && <EmergencyAccess />}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Visit lists

function VisitLists({ visits, error }: { visits: VisitView[] | null; error: string | null }) {
  if (!visits) {
    return (
      <Card title="Visits">{error ? <Notice kind="error">{error}</Notice> : <Empty>Loading visits…</Empty>}</Card>
    );
  }

  const now = Date.now();
  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);
  const isPast = (v: VisitView) => ENDED.includes(v.status) || new Date(v.ends_at).getTime() < now;
  const byStart = (a: VisitView, b: VisitView) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime();

  const open = visits.filter((v) => !isPast(v)).sort(byStart);
  const today = open.filter((v) => new Date(v.starts_at) <= endOfToday);
  const upcoming = open.filter((v) => new Date(v.starts_at) > endOfToday);
  const past = visits.filter(isPast).sort((a, b) => byStart(b, a));

  return (
    <div className="space-y-6">
      {error && <Notice kind="error">{error}</Notice>}
      <Card title="Today">
        <VisitList visits={today} empty="No visits today." />
      </Card>
      <Card title="Upcoming">
        <VisitList visits={upcoming} empty="No upcoming visits." />
      </Card>
      <Card title="Past">
        <VisitList visits={past.slice(0, 20)} empty="No past visits." />
      </Card>
    </div>
  );
}

function VisitList({ visits, empty }: { visits: VisitView[]; empty: string }) {
  if (!visits.length) return <Empty>{empty}</Empty>;
  return (
    <ul className="divide-y divide-slate-100">
      {visits.map((v) => {
        const pendingRequests = v.requests.filter((r) => r.status === "pending").length;
        return (
          <li key={v.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-slate-900">{v.patient_name}</span>
                <StatusBadge status={v.status} />
                {pendingRequests > 0 && <Badge color="amber">{pendingRequests} request pending</Badge>}
              </div>
              <div className="mt-0.5 text-xs text-slate-500">
                {specialtyNames(v.specialties)} · {fmtTime(v.starts_at)} – {fmtTime(v.ends_at)}
              </div>
            </div>
            <Link
              href={`/doctor/visit/${v.id}`}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-50"
            >
              Open
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

// ---------------------------------------------------------------------------------------------
// Patient lookup by CCCD (POST body only; the input is cleared after a successful lookup)

function PatientLookup({ onFound, label = "Patient CCCD" }: { onFound: (p: LookupResult) => void; label?: string }) {
  const [cccd, setCccd] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function lookup(e: React.FormEvent) {
    e.preventDefault();
    const digits = cccd.replace(/\D/g, "");
    if (digits.length !== 12) {
      setError("A CCCD has 12 digits.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const found = await api<LookupResult>("/api/patients/lookup", { body: { cccd: digits } });
      setCccd("");
      onFound(found);
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={lookup} className="space-y-2">
      <Field label={label} hint="12 digits. Sent only in the request body, never stored or logged.">
        <div className="flex gap-2">
          <input
            className={inputClass}
            inputMode="numeric"
            autoComplete="off"
            placeholder="079212341234"
            value={cccd}
            onChange={(e) => setCccd(e.target.value)}
          />
          <Button type="submit" variant="secondary" disabled={busy || !cccd.trim()}>
            {busy ? "Finding…" : "Find"}
          </Button>
        </div>
      </Field>
      {error && <Notice kind="error">{error}</Notice>}
    </form>
  );
}

function PatientCard({ patient, onClear }: { patient: LookupResult; onClear: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-md border border-slate-200 bg-slate-50 p-3">
      <div className="min-w-0 flex-1">
        <div className="font-medium text-slate-900">{patient.display_name}</div>
        <div className="font-mono text-xs text-slate-500">CCCD {patient.masked_cccd}</div>
      </div>
      <StatusBadge status={patient.status} />
      <Button variant="ghost" onClick={onClear}>
        Change
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Book a visit

function BookVisit({ onBooked }: { onBooked: () => Promise<void> }) {
  const { profile } = useSession();
  const mySpecialties = (profile?.specialties ?? []).filter(isSpecialty) as Specialty[];

  const [patient, setPatient] = useState<LookupResult | null>(null);
  const [chosen, setChosen] = useState<Specialty[]>(mySpecialties.slice(0, 1));
  const [startsAt, setStartsAt] = useState(() => toLocalInput(new Date()));
  const [endsAt, setEndsAt] = useState(() => toLocalInput(new Date(Date.now() + 2 * 60 * 60 * 1000)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  function toggle(s: Specialty) {
    setChosen((c) => (c.includes(s) ? c.filter((x) => x !== s) : [...c, s]));
  }

  function resetTimes() {
    setStartsAt(toLocalInput(new Date()));
    setEndsAt(toLocalInput(new Date(Date.now() + 2 * 60 * 60 * 1000)));
  }

  async function book(e: React.FormEvent) {
    e.preventDefault();
    if (!patient) return;
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      await api("/api/visits", {
        body: {
          patient_code: patient.code,
          specialties: chosen,
          starts_at: new Date(startsAt).toISOString(),
          ends_at: new Date(endsAt).toISOString(),
        },
      });
      setDone(`Visit booked for ${patient.display_name}. Waiting for the patient to approve.`);
      setPatient(null);
      resetTimes();
      await onBooked();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Book a visit">
      {!mySpecialties.length ? (
        <Notice kind="warning">
          Your account has no visit specialty (Ophthalmology or Endocrinology), so you cannot book visits.
        </Notice>
      ) : (
        <div className="space-y-4">
          {done && <Notice kind="success">{done}</Notice>}
          {!patient ? (
            <PatientLookup
              onFound={(p) => {
                setPatient(p);
                setDone(null);
                setError(null);
              }}
            />
          ) : (
            <form onSubmit={book} className="space-y-4">
              <PatientCard patient={patient} onClear={() => setPatient(null)} />
              {patient.status !== "active" && (
                <Notice kind="warning">This patient&apos;s record is not activated by the hospital yet.</Notice>
              )}
              <fieldset>
                <legend className="mb-1 text-sm font-medium text-slate-700">Specialties for this visit</legend>
                <div className="flex flex-wrap gap-4">
                  {mySpecialties.map((s) => (
                    <label key={s} className="flex items-center gap-2 text-sm text-slate-800">
                      <input type="checkbox" checked={chosen.includes(s)} onChange={() => toggle(s)} />
                      {SPECIALTY_LABEL[s]} <span className="text-xs text-slate-500">({KIND_LABEL[s]} records)</span>
                    </label>
                  ))}
                </div>
                <p className="mt-1 text-xs text-slate-500">Essentials (allergies, blood type) are always included read-only.</p>
              </fieldset>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Starts">
                  <input type="datetime-local" className={inputClass} value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
                </Field>
                <Field label="Ends" hint="At most 12 hours. Access ends automatically then.">
                  <input type="datetime-local" className={inputClass} value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
                </Field>
              </div>
              {error && <Notice kind="error">{error}</Notice>}
              <Button type="submit" disabled={busy || !chosen.length || !startsAt || !endsAt}>
                {busy ? "Booking…" : "Book visit"}
              </Button>
            </form>
          )}
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------
// Emergency access (doctors with khoa_capcuu)

const APPROVER_LABEL: Record<ApproverType, string> = { doctor: "Doctor", hospital: "Hospital", family: "Family" };

function EmergencyAccess() {
  const { profile } = useSession();
  const [patient, setPatient] = useState<LookupResult | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [list, setList] = useState<EmergencyView[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api<{ emergencies: EmergencyView[] }>("/api/emergency");
      setList(r.emergencies);
      setListError(null);
    } catch (e) {
      setListError(errMsg(e));
    }
  }, []);
  usePoll(load, POLL_MS);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!patient || !reason.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api("/api/emergency", { body: { patient_code: patient.code, reason: reason.trim() } });
      setPatient(null);
      setReason("");
      await load();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  const mine = (list ?? [])
    .filter((e) => e.doctor_profile_id === profile?.id)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  return (
    <Card title={<span className="text-rose-700">Emergency access</span>}>
      <div className="space-y-4">
        <p className="text-xs text-slate-600">
          Break-glass access needs 2 of 3 approvals: you, the hospital account, a linked family member. Access lasts 60
          minutes and is logged for the patient.
        </p>
        {!patient ? (
          <PatientLookup onFound={setPatient} label="Patient CCCD (emergency)" />
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <PatientCard patient={patient} onClear={() => setPatient(null)} />
            <Field label="Reason">
              <textarea
                className={`${inputClass} min-h-20`}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Unconscious on arrival, suspected diabetic emergency…"
              />
            </Field>
            {error && <Notice kind="error">{error}</Notice>}
            <Button type="submit" variant="danger" disabled={busy || !reason.trim()}>
              {busy ? "Requesting…" : "Request emergency access"}
            </Button>
          </form>
        )}

        <div>
          <h3 className="mb-2 text-sm font-semibold text-slate-800">My emergency requests</h3>
          {listError && <Notice kind="error">{listError}</Notice>}
          {!list ? (
            <Empty>Loading…</Empty>
          ) : !mine.length ? (
            <Empty>No emergency requests.</Empty>
          ) : (
            <ul className="divide-y divide-slate-100">
              {mine.map((e) => (
                <li key={e.id} className="space-y-1 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-slate-900">{e.patient_name}</span>
                    <StatusBadge status={e.status} />
                    {e.approvals.map((a) => (
                      <Badge key={a} color="green">
                        ✓ {APPROVER_LABEL[a]}
                      </Badge>
                    ))}
                  </div>
                  <div className="text-xs text-slate-500">
                    {e.approvals.length}/2 approvals · requested {fmtTime(e.created_at)}
                    {e.expires_at && ` · expires ${fmtTime(e.expires_at)}`}
                  </div>
                  {e.status === "approved" && (
                    <Link href={`/doctor/emergency/${e.id}`} className="text-sm font-medium text-rose-700 hover:underline">
                      Open emergency records →
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Card>
  );
}
