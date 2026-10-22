"use client";
// Patient dashboard: consent to visits and extra-specialty requests, see and revoke who has access,
// read my own records (decrypted in this browser), emergency notices and family approvals, family
// links, and the full access log. Every action is re-checked by the API on the server.
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { RoleGate } from "@/components/AppShell";
import { RecordsViewer } from "@/components/RecordsViewer";
import { Badge, Button, Card, Empty, Field, Notice, StatusBadge, fmtTime, inputClass } from "@/components/ui";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { decryptItems } from "@/lib/tide/sealed";
import { KIND_LABEL, SPECIALTY_LABEL, kindOfTag } from "@/lib/tags";
import type { AccessLogRow, EmergencyView, GrantView, Profile, RecordsResponse, VisitView } from "@/lib/types";

export default function PatientPage() {
  return (
    <RoleGate role="benh_nhan">
      <PatientHome />
    </RoleGate>
  );
}

// ---------- helpers ----------

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const drName = (name: string) => (/^dr\.?\s/i.test(name) ? name : `Dr ${name}`);
const kindLabel = (k: string) => (KIND_LABEL as Record<string, string>)[k] ?? k;
const tagLabel = (tag: string | null) => {
  const k = tag ? kindOfTag(tag) : null;
  return k ? KIND_LABEL[k] : "–";
};
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
const ddmm = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit" });
const joinAnd = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

/** "Dr Lê Minh (Ophthalmology) requests your Eye records and Essentials, 08:00–10:00 22/10" */
function describeVisit(v: VisitView) {
  const specs = v.specialties.map((s) => SPECIALTY_LABEL[s] ?? s).join(", ");
  const kinds = joinAnd(v.specialties.map(kindLabel));
  return `${drName(v.doctor_name)} (${specs}) requests your ${kinds} records and Essentials, ${hhmm(v.starts_at)}–${hhmm(v.ends_at)} ${ddmm(v.starts_at)}`;
}

/** GET a path now and every `ms`; `path = null` pauses. */
function usePolling<T>(path: string | null, ms: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    const load = async () => {
      try {
        const d = await api<T>(path);
        if (!cancelled) {
          setData(d);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(errMsg(e));
      }
    };
    void load();
    const t = setInterval(load, ms);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [path, ms, tick]);
  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { data, error, reload };
}

/** Run one button action at a time, remembering which one is busy and the last error. */
function useActions() {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async (key: string, fn: () => Promise<unknown>, after?: () => void) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
      after?.();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  }, []);
  return { busy, error, run };
}

// ---------- page ----------

function PatientHome() {
  const { profile, patient, refresh } = useSession();
  const ready = !!patient && patient.status === "active" && patient.hasCccd;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-semibold">My records</h1>
        {patient && (
          <span className="text-sm text-slate-500">
            Patient code <span className="font-mono">{patient.code}</span>
          </span>
        )}
      </div>

      {!patient && (
        <Card title="Set up your sealed record">
          <p className="mb-3 text-sm text-slate-600">
            Register once with your CCCD. Your records are encrypted in your browser; nobody at the hospital can
            read them without your consent.
          </p>
          <Link href="/patient/register" className="rounded-md bg-teal-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-800">
            Register
          </Link>
        </Card>
      )}

      {patient?.status === "awaiting_activation" && (
        <div className="space-y-2">
          <Notice kind="warning">Waiting for the hospital to co-sign your record keys.</Notice>
          <Button variant="secondary" onClick={() => void refresh()}>
            Refresh
          </Button>
        </div>
      )}

      {patient?.status === "active" && !patient.hasCccd && (
        <Notice kind="info">
          Your keys are active. <Link href="/patient/register" className="font-medium underline">Finish registration</Link>{" "}
          by encrypting your CCCD.
        </Notice>
      )}

      {ready && profile ? (
        <Dashboard code={patient.code} profile={profile} />
      ) : (
        // Family members may not have a record of their own but can still co-approve emergencies.
        <EmergencySection code={null} />
      )}
    </div>
  );
}

function Dashboard({ code, profile }: { code: string; profile: Profile }) {
  const visits = usePolling<{ visits: VisitView[] }>("/api/visits", 5000);
  const grants = usePolling<{ grants: GrantView[] }>("/api/grants?scope=patient", 5000);
  const { reload: reloadVisits } = visits;
  const { reload: reloadGrants } = grants;
  const reloadAll = useCallback(() => {
    reloadVisits();
    reloadGrants();
  }, [reloadVisits, reloadGrants]);

  return (
    <div className="space-y-6">
      <PendingSection visits={visits.data?.visits ?? null} error={visits.error} onChanged={reloadAll} />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <MyRecords code={code} profile={profile} />
          <AccessLog code={code} />
        </div>
        <div className="space-y-6">
          <AccessSection grants={grants.data?.grants ?? null} error={grants.error} onChanged={reloadAll} />
          <EmergencySection code={code} />
          <FamilySection />
        </div>
      </div>
    </div>
  );
}

// ---------- (1) pending requests ----------

function PendingSection({ visits, error, onChanged }: { visits: VisitView[] | null; error: string | null; onChanged: () => void }) {
  const { busy, error: actionError, run } = useActions();
  const list = visits ?? [];
  const pendingVisits = list.filter((v) => v.status === "pending_consent");
  // Only requests on visits that are still running can be decided.
  const pendingRequests = list
    .filter((v) => v.status === "awaiting_cosign" || v.status === "active")
    .flatMap((v) => v.requests.filter((r) => r.status === "pending").map((r) => ({ v, r })));
  const current = list.filter((v) => v.status === "awaiting_cosign" || v.status === "active");

  const consent = (id: string, decision: "approve" | "decline") =>
    run(`visit:${id}`, () => api(`/api/visits/${id}/consent`, { body: { decision } }), onChanged);
  const decide = (id: string, decision: "approve" | "decline") =>
    run(`req:${id}`, () => api(`/api/requests/${id}/decide`, { body: { decision } }), onChanged);

  return (
    <Card title="Requests waiting for you">
      <div className="space-y-3">
        {error && <Notice kind="error">{error}</Notice>}
        {actionError && <Notice kind="error">{actionError}</Notice>}
        {visits && !pendingVisits.length && !pendingRequests.length && <Empty>No pending requests.</Empty>}

        {pendingVisits.map((v) => (
          <div key={v.id} className="flex flex-col gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-slate-800">{describeVisit(v)}</p>
            <div className="flex shrink-0 gap-2">
              <Button onClick={() => void consent(v.id, "approve")} disabled={busy !== null}>
                Approve
              </Button>
              <Button variant="secondary" onClick={() => void consent(v.id, "decline")} disabled={busy !== null}>
                Decline
              </Button>
            </div>
          </div>
        ))}

        {pendingRequests.map(({ v, r }) => (
          <div key={r.id} className="flex flex-col gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-slate-800">
              {drName(v.doctor_name)} asks for read access to your {kindLabel(r.specialty)} records during the visit{" "}
              {hhmm(v.starts_at)}–{hhmm(v.ends_at)} {ddmm(v.starts_at)}.
            </p>
            <div className="flex shrink-0 gap-2">
              <Button onClick={() => void decide(r.id, "approve")} disabled={busy !== null}>
                Approve
              </Button>
              <Button variant="secondary" onClick={() => void decide(r.id, "decline")} disabled={busy !== null}>
                Decline
              </Button>
            </div>
          </div>
        ))}

        {current.length > 0 && (
          <div className="border-t border-slate-100 pt-3">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Approved visits</h3>
            <ul className="space-y-1 text-sm">
              {current.map((v) => (
                <li key={v.id} className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={v.status} />
                  <span>
                    {drName(v.doctor_name)} · {joinAnd(v.specialties.map(kindLabel))} and Essentials · {hhmm(v.starts_at)}–
                    {hhmm(v.ends_at)} {ddmm(v.starts_at)}
                  </span>
                  {v.status === "awaiting_cosign" && <span className="text-xs text-slate-500">waiting for hospital co-signature</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Card>
  );
}

// ---------- (2) active access ----------

function AccessSection({ grants, error, onChanged }: { grants: GrantView[] | null; error: string | null; onChanged: () => void }) {
  const { busy, error: actionError, run } = useActions();
  const [showPast, setShowPast] = useState(false);
  const list = grants ?? [];
  const live = list.filter((g) => g.status === "active" || g.status === "pending_signature");
  const past = list.filter((g) => !(g.status === "active" || g.status === "pending_signature"));
  const shown = showPast ? [...live, ...past] : live;

  const revoke = (id: string) => run(id, () => api(`/api/grants/${id}/revoke`, { method: "POST", body: {} }), onChanged);

  return (
    <Card
      title="Who can access my records"
      actions={
        past.length > 0 && (
          <Button variant="ghost" onClick={() => setShowPast((s) => !s)}>
            {showPast ? "Hide past" : `Past (${past.length})`}
          </Button>
        )
      }
    >
      <div className="space-y-2">
        {error && <Notice kind="error">{error}</Notice>}
        {actionError && <Notice kind="error">{actionError}</Notice>}
        {grants && !shown.length && <Empty>Nobody else has access right now.</Empty>}
        <ul className="divide-y divide-slate-100">
          {shown.map((g) => (
            <li key={g.id} className="flex items-start justify-between gap-2 py-2 text-sm">
              <div className="min-w-0">
                <div className="font-medium text-slate-900">{g.subject_name}</div>
                <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-600">
                  <span>{tagLabel(g.tag)}</span>
                  <Badge color={g.access === "read-write" ? "blue" : "slate"}>{g.access}</Badge>
                  <StatusBadge status={g.status} />
                  {g.emergency_id && <Badge color="red">emergency</Badge>}
                </div>
                <div className="text-xs text-slate-500">until {fmtTime(g.expires_at)}</div>
              </div>
              {(g.status === "active" || g.status === "pending_signature") && (
                <Button variant="danger" className="shrink-0" onClick={() => void revoke(g.id)} disabled={busy !== null}>
                  {busy === g.id ? "Revoking…" : "Revoke"}
                </Button>
              )}
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}

// ---------- (3) my records + identity ----------

function MyRecords({ code, profile }: { code: string; profile: Profile }) {
  const [identity, setIdentity] = useState<{ masked?: string; error?: string } | null>(null);

  const onLoaded = useCallback(
    async (resp: RecordsResponse) => {
      const id = resp.identity;
      if (!id) return setIdentity({ error: "unavailable" });
      const policy = resp.policies[id.tag];
      const [res] = await decryptItems([{ id: "identity", tag: id.tag, ciphertext: id.ciphertext }], policy ? { [id.tag]: policy } : {});
      if (res?.ok) {
        const d = res.plaintext.replace(/\D/g, "");
        setIdentity({ masked: d.length >= 8 ? `${d.slice(0, 4)}••••${d.slice(-4)}` : "••••" });
      } else {
        setIdentity({ error: res && !res.ok ? res.error : "Not decrypted" });
      }
      api("/api/logs", {
        method: "POST",
        body: { entries: [{ patient_code: code, action: res?.ok ? "decrypt" : "denied", tag: id.tag }] },
      }).catch(() => {});
    },
    [code],
  );

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm shadow-sm">
        <span>
          <span className="font-medium text-slate-700">Identity: CCCD</span>{" "}
          {identity?.masked ? (
            <span className="font-mono">{identity.masked}</span>
          ) : identity?.error ? (
            <span className="text-rose-600">locked</span>
          ) : (
            <span className="text-slate-400">decrypting…</span>
          )}
        </span>
        <Link href="/patient/import" className="text-xs text-teal-700 hover:underline">
          Add earlier records
        </Link>
      </div>
      <RecordsViewer patientCode={code} viewerLabel={profile.display_name} title="My records" onLoaded={onLoaded} />
    </div>
  );
}

// ---------- (4) emergencies ----------

function EmergencySection({ code }: { code: string | null }) {
  const { data, error, reload } = usePolling<{ emergencies: EmergencyView[] }>("/api/emergency", 5000);
  const { busy, error: actionError, run } = useActions();
  const list = data?.emergencies ?? [];
  const mine = code ? list.filter((e) => e.patient_code === code) : [];
  const family = list.filter((e) => e.patient_code !== code);

  const approve = (id: string) => run(id, () => api(`/api/emergency/${id}/approve`, { method: "POST", body: {} }), reload);

  if (!code && !family.length && !error) return null;

  return (
    <Card title="Emergencies">
      <div className="space-y-3">
        {error && <Notice kind="error">{error}</Notice>}
        {actionError && <Notice kind="error">{actionError}</Notice>}

        {code && (
          <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">On my record</h3>
            {!mine.length && <Empty>No emergency access to your record.</Empty>}
            {mine.map((e) => (
              <div key={e.id} className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">
                Emergency access by {drName(e.doctor_name)}, reason “{e.reason}”, status <StatusBadge status={e.status} />
                {e.expires_at && <>, until {fmtTime(e.expires_at)}</>}.
                <div className="mt-1 text-xs text-rose-700">
                  Approved by: {e.approvals.length ? e.approvals.join(", ") : "nobody yet"} · requested {fmtTime(e.created_at)}
                </div>
              </div>
            ))}
          </div>
        )}

        {family.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Family members</h3>
            {family.map((e) => (
              <div key={e.id} className="space-y-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm">
                <p>
                  {drName(e.doctor_name)} requests emergency access to <span className="font-medium">{e.patient_name}</span>’s
                  records: “{e.reason}”.
                </p>
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                  <StatusBadge status={e.status} />
                  <span>Approvals: {e.approvals.join(", ") || "none"} (2 of 3 needed)</span>
                </div>
                {e.canApproveAs === "family" && (
                  <Button onClick={() => void approve(e.id)} disabled={busy !== null}>
                    {busy === e.id ? "Approving…" : "Approve as family"}
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}

// ---------- (5) family ----------

function FamilySection() {
  const [links, setLinks] = useState<{ family_profile_id: string; display_name: string; relation: string }[] | null>(null);
  const [name, setName] = useState("");
  const [relation, setRelation] = useState("");
  const { busy, error, run } = useActions();
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await api<{ links: { family_profile_id: string; display_name: string; relation: string }[] }>("/api/family");
      setLinks(d.links);
      setLoadError(null);
    } catch (e) {
      setLoadError(errMsg(e));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  function add(e: React.FormEvent) {
    e.preventDefault();
    void run("add", () => api("/api/family", { body: { display_name: name.trim(), relation: relation.trim() } }), () => {
      setName("");
      setRelation("");
      void load();
    });
  }

  return (
    <Card title="Family">
      <div className="space-y-3">
        <p className="text-xs text-slate-500">A linked family member can co-approve emergency access to your records.</p>
        {loadError && <Notice kind="error">{loadError}</Notice>}
        {error && <Notice kind="error">{error}</Notice>}
        {links && !links.length && <Empty>No family members linked.</Empty>}
        <ul className="space-y-1 text-sm">
          {links?.map((l) => (
            <li key={l.family_profile_id}>
              {l.display_name} {l.relation && <span className="text-slate-500">({l.relation})</span>}
            </li>
          ))}
        </ul>
        <form onSubmit={add} className="space-y-2">
          <Field label="Exact account name">
            <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="Nguyễn Văn Nam" />
          </Field>
          <Field label="Relation">
            <input className={inputClass} value={relation} onChange={(e) => setRelation(e.target.value)} placeholder="brother" />
          </Field>
          <Button type="submit" variant="secondary" disabled={busy !== null || !name.trim()}>
            {busy ? "Linking…" : "Link family member"}
          </Button>
        </form>
      </div>
    </Card>
  );
}

// ---------- (6) access log ----------

type LogView = AccessLogRow & { actor_name: string; actor_role: string };

const ROLE_LABEL: Record<string, string> = { benh_nhan: "Patient", bac_si: "Doctor", benh_vien: "Hospital", system: "System" };
const ACTION_COLOR: Record<string, "green" | "red" | "blue" | "amber" | "slate"> = {
  decrypt: "green",
  denied: "red",
  encrypt: "blue",
  grant: "amber",
  sign: "blue",
  revoke: "slate",
  emergency: "red",
};

function AccessLog({ code }: { code: string }) {
  const { data, error, reload } = usePolling<{ logs: LogView[] }>(`/api/logs?patient=${encodeURIComponent(code)}`, 10000);
  const logs = data?.logs ?? [];

  return (
    <Card
      title="Access log"
      actions={
        <Button variant="ghost" onClick={reload}>
          Reload
        </Button>
      }
    >
      {error && <Notice kind="error">{error}</Notice>}
      {data && !logs.length && <Empty>No activity yet.</Empty>}
      {logs.length > 0 && (
        <div className="max-h-96 overflow-auto">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-white text-xs uppercase text-slate-500">
              <tr>
                <th className="py-1 pr-3 font-medium">Time</th>
                <th className="py-1 pr-3 font-medium">Who</th>
                <th className="py-1 pr-3 font-medium">Role</th>
                <th className="py-1 pr-3 font-medium">Action</th>
                <th className="py-1 font-medium">Compartment</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {logs.map((l) => (
                <tr key={l.id}>
                  <td className="whitespace-nowrap py-1 pr-3 text-slate-600">{fmtTime(l.created_at)}</td>
                  <td className="py-1 pr-3">{l.actor_name}</td>
                  <td className="py-1 pr-3 text-slate-600">{ROLE_LABEL[l.actor_role] ?? l.actor_role}</td>
                  <td className="py-1 pr-3">
                    <Badge color={ACTION_COLOR[l.action] ?? "slate"}>{l.action}</Badge>
                  </td>
                  <td className="py-1 text-slate-600">{tagLabel(l.tag)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
