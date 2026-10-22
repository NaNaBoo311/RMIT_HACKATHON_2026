"use client";
// Hospital account dashboard. This account is the realm's tide-realm-admin: it co-signs grants in its
// Tide enclave, but holds no _tide_decryptor role, so it can never read a record itself.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTideCloak } from "@/lib/tide/client";
import { RoleGate } from "@/components/AppShell";
import { RecordsViewer } from "@/components/RecordsViewer";
import { Badge, Button, Card, Empty, Field, Notice, StatusBadge, fmtTime, inputClass } from "@/components/ui";
import { api } from "@/lib/api";
import { approveAndSign, describeTideError, fromBase64, prepareGrants, vendorIdFromConfig, type PreparedGrant } from "@/lib/tide/sealed";
import { KIND_LABEL, SPECIALTY_LABEL, kindOfTag } from "@/lib/tags";
import type { EmergencyView, PendingGrant, VisitView } from "@/lib/types";

const POLL_MS = 5000;
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export default function HospitalPage() {
  return (
    <RoleGate role="benh_vien">
      <HospitalDashboard />
    </RoleGate>
  );
}

function HospitalDashboard() {
  // Bumped after an emergency approval so the co-sign queue picks up the new grants at once.
  const [queueKey, setQueueKey] = useState(0);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Hospital account</h1>
        <p className="text-sm text-slate-600">Co-sign access grants, approve emergencies, and run breach drills.</p>
      </div>
      <CoSignQueue refreshKey={queueKey} />
      <EmergencyApprovals onApproved={() => setQueueKey((k) => k + 1)} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Doctors />
        <BreachDrill />
      </div>
      <TryToRead />
      <RecentVisits />
    </div>
  );
}

// --- (1) Co-sign queue ------------------------------------------------------------------------

function CoSignQueue({ refreshKey }: { refreshKey: number }) {
  const { getVendorId, getConfig } = useTideCloak();
  const [grants, setGrants] = useState<PendingGrant[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [signError, setSignError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [policyError, setPolicyError] = useState<string | null>(null);
  // Prefetched so the approval click reaches the enclave popup with as few awaits as possible.
  const adminPolicy = useRef<Uint8Array | null>(null);
  // Step 1 output: sign requests initialised with the network, waiting for the approval click.
  const [prepared, setPrepared] = useState<{ items: PreparedGrant[]; skipped: number } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api<{ grants: PendingGrant[] }>("/api/grants?scope=pending");
      setGrants(res.grants);
      setLoadError(null);
    } catch (e) {
      setLoadError(errText(e));
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(t);
  }, [load, refreshKey]);

  useEffect(() => {
    api<{ policyB64: string }>("/api/tide/admin-policy")
      .then((r) => (adminPolicy.current = fromBase64(r.policyB64)))
      .catch((e) => setPolicyError(errText(e)));
  }, []);

  const groups = useMemo(() => {
    const m = new Map<string, PendingGrant[]>();
    for (const g of grants) m.set(g.reason, [...(m.get(g.reason) ?? []), g]);
    return [...m.entries()];
  }, [grants]);

  // Step 1: initialise one sign request per grant with the network. This takes a few seconds per
  // grant, so it happens BEFORE the approval click: a popup opened later than ~5 s after a click
  // is blocked by the browser.
  async function prepare(selection: PendingGrant[]) {
    const list = [...selection]; // the 5 s poll replaces state while we work
    setSignError(null);
    setMessage(null);
    let vendorId = "";
    try {
      vendorId = getVendorId?.() || "";
    } catch {
      /* older SDK: fall back to the adapter config */
    }
    try {
      vendorId ||= vendorIdFromConfig(getConfig());
    } catch (e) {
      setSignError(`No vendorId: ${errText(e)}`);
      return;
    }
    const signable = list.filter((g) => g.subject_key);
    if (!signable.length) {
      setSignError("Nothing to sign: every grantee here must sign in once first.");
      return;
    }
    setBusy(true);
    try {
      if (!adminPolicy.current) {
        adminPolicy.current = fromBase64((await api<{ policyB64: string }>("/api/tide/admin-policy")).policyB64);
      }
      const items = await prepareGrants(
        signable.map((g) => ({ id: g.id, subjectKey: g.subject_key!, tag: g.tag, access: g.access, expiresAt: g.expires_at })),
        vendorId,
      );
      setPrepared({ items, skipped: list.length - signable.length });
    } catch (e) {
      setSignError(describeTideError(e));
    } finally {
      setBusy(false);
    }
  }

  // Step 2: runs straight from the click so the Tide enclave popup is not blocked.
  async function approve() {
    if (!prepared || !adminPolicy.current) return;
    const { items, skipped } = prepared;
    setSignError(null);
    setBusy(true);
    try {
      const { signed, errors } = await approveAndSign(items, adminPolicy.current);
      setPrepared(null);
      if (signed.length) {
        const res = await api<{ signed: number }>("/api/grants/sign", {
          body: { items: signed.map((r) => ({ id: r.id, policy_b64: r.policyB64 })) },
        });
        setMessage(
          `Signed ${res.signed} grant${res.signed === 1 ? "" : "s"} in the Tide enclave.` +
            (skipped ? ` ${skipped} skipped (grantee has not signed in).` : ""),
        );
      }
      if (errors.length) setSignError(errors.map((e) => e.error).join(" | "));
      else if (!signed.length) setSignError("Nothing was signed: the request was denied or cancelled in the Tide enclave.");
      await load();
    } catch (e) {
      setSignError(describeTideError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title="Co-sign queue (Tide enclave)"
      actions={
        grants.length > 0 && (
          <Button disabled={busy || !!prepared} onClick={() => void prepare(grants)}>
            {busy && !prepared ? "Preparing…" : `Co-sign all (${grants.length})`}
          </Button>
        )
      }
    >
      <p className="mb-3 text-sm text-slate-600">
        The server cannot grant access on its own: every grant is a policy only this account&apos;s Tide enclave can sign.
        This account holds no decrypt role, so it still cannot read anything.
      </p>
      <div className="space-y-3">
        {policyError && <Notice kind="warning">Admin policy not available yet: {policyError}</Notice>}
        {loadError && <Notice kind="error">Could not load the queue: {loadError}</Notice>}
        {signError && <Notice kind="error">Signing failed: {signError}</Notice>}
        {message && <Notice kind="success">{message}</Notice>}
        {prepared && (
          <div className="flex flex-wrap items-center gap-3 rounded-md border border-teal-300 bg-teal-50 p-3 text-sm">
            <span className="text-teal-900">
              {prepared.items.length} sign request{prepared.items.length === 1 ? "" : "s"} ready. Approve them in the Tide enclave
              (one popup).
            </span>
            <Button disabled={busy} onClick={() => void approve()}>
              {busy ? "Waiting for Tide…" : "Approve in Tide enclave"}
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => setPrepared(null)}>
              Cancel
            </Button>
          </div>
        )}
        {loaded && !loadError && !groups.length && <Empty>Nothing waiting for a signature.</Empty>}
        {!loaded && <Empty>Loading…</Empty>}
        {groups.map(([reason, list]) => (
          <div
            key={reason}
            className={`rounded-md border p-3 ${reason.startsWith("EMERGENCY") ? "border-rose-300 bg-rose-50/50" : "border-slate-200"}`}
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <p className="text-sm font-medium text-slate-900">{reason}</p>
              <Button disabled={busy || !!prepared} onClick={() => void prepare(list)}>
                Co-sign with Tide
              </Button>
            </div>
            <ul className="mt-2 divide-y divide-slate-100 text-sm">
              {list.map((g) => {
                const kind = kindOfTag(g.tag);
                return (
                  <li key={g.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5">
                    <span className="font-medium text-slate-800">{kind ? KIND_LABEL[kind] : g.tag}</span>
                    <Badge color={g.access === "read-write" ? "blue" : "slate"}>{g.access}</Badge>
                    <span className="text-slate-600">for {g.subject_name}</span>
                    <span className="font-mono text-xs text-slate-400">{g.tag}</span>
                    <span className="text-xs text-slate-500">until {fmtTime(g.expires_at)}</span>
                    {!g.subject_key && <Badge color="amber">grantee must sign in once</Badge>}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </Card>
  );
}

// --- (2) Emergency approvals ------------------------------------------------------------------

function EmergencyApprovals({ onApproved }: { onApproved: () => void }) {
  const [items, setItems] = useState<EmergencyView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setItems((await api<{ emergencies: EmergencyView[] }>("/api/emergency")).emergencies);
      setError(null);
    } catch (e) {
      setError(errText(e));
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  async function approve(id: string) {
    setBusyId(id);
    setMessage(null);
    setError(null);
    try {
      const res = await api<{ grantsCreated: number }>(`/api/emergency/${id}/approve`, { method: "POST", body: {} });
      setMessage(
        res.grantsCreated
          ? `Approved: 2 of 3 reached. ${res.grantsCreated} read grants are now in the co-sign queue above.`
          : "Approval recorded.",
      );
      onApproved();
      await load();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Card title="Emergency approvals">
      <p className="mb-3 text-sm text-slate-600">
        Emergency access needs 2 of 3: the emergency doctor (by opening the request), the hospital, and a linked family member.
      </p>
      <div className="space-y-2">
        {error && <Notice kind="error">{error}</Notice>}
        {message && <Notice kind="success">{message}</Notice>}
        {!items.length && !error && <Empty>No emergency requests.</Empty>}
        {items.map((e) => (
          <div key={e.id} className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-slate-200 p-3">
            <div className="min-w-0 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-slate-900">
                  Dr {e.doctor_name} → {e.patient_name}
                </span>
                <StatusBadge status={e.status} />
              </div>
              <p className="mt-1 break-words text-slate-700">“{e.reason}”</p>
              <p className="mt-1 text-xs text-slate-500">
                Opened {fmtTime(e.created_at)} · {e.status === "approved" ? "access until" : "window closes"} {fmtTime(e.expires_at)} ·
                approvals: {e.approvals.join(", ") || "none"} ({e.approvals.length}/3)
              </p>
            </div>
            {e.canApproveAs === "hospital" && (
              <Button variant="danger" disabled={busyId === e.id} onClick={() => void approve(e.id)}>
                {busyId === e.id ? "Approving…" : "Approve"}
              </Button>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}

// --- (3) Doctors ------------------------------------------------------------------------------

function Doctors() {
  const [doctors, setDoctors] = useState<{ id: string; display_name: string; specialties: string[] }[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ doctors: { id: string; display_name: string; specialties: string[] }[] }>("/api/hospital/doctors")
      .then((r) => setDoctors(r.doctors))
      .catch((e) => setError(errText(e)));
  }, []);

  return (
    <Card title="Doctors and specialties">
      {error && <Notice kind="error">{error}</Notice>}
      {!doctors && !error && <Empty>Loading…</Empty>}
      {doctors && !doctors.length && <Empty>No doctor has signed in yet.</Empty>}
      {doctors && doctors.length > 0 && (
        <ul className="divide-y divide-slate-100 text-sm">
          {doctors.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-2 py-2">
              <span className="font-medium text-slate-900">Dr {d.display_name}</span>
              {d.specialties.length ? (
                d.specialties.map((s) => (
                  <Badge key={s} color={s === "capcuu" ? "red" : "blue"}>
                    {SPECIALTY_LABEL[s] ?? s}
                  </Badge>
                ))
              ) : (
                <span className="text-xs text-slate-500">no specialty</span>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-xs text-slate-500">Specialties come from the doctors&apos; khoa_* realm roles in TideCloak.</p>
    </Card>
  );
}

// --- (4) Breach drill --------------------------------------------------------------------------

function BreachDrill() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ enabled: boolean }>("/api/breach-drill")
      .then((r) => setEnabled(r.enabled))
      .catch((e) => setError(errText(e)));
  }, []);

  async function toggle() {
    setBusy(true);
    setError(null);
    try {
      setEnabled((await api<{ enabled: boolean }>("/api/breach-drill", { body: { enabled: !enabled } })).enabled);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title="Breach drill"
      actions={enabled !== null && <Badge color={enabled ? "red" : "slate"}>{enabled ? "ON" : "off"}</Badge>}
    >
      <p className="text-sm text-slate-600">
        Rehearses a compromised server: the records API returns <strong>all</strong> ciphertext for a patient and even hands out
        the patient&apos;s own policies. The browser tries to decrypt and the Tide network refuses (&quot;subjectId does not
        match&quot;), so the records stay locked. The server cannot leak data even when it misbehaves.
      </p>
      {error && (
        <div className="mt-3">
          <Notice kind="error">{error}</Notice>
        </div>
      )}
      <div className="mt-3">
        <Button variant={enabled ? "secondary" : "danger"} disabled={busy || enabled === null} onClick={() => void toggle()}>
          {enabled ? "Turn breach drill off" : "Turn breach drill on"}
        </Button>
      </div>
    </Card>
  );
}

// --- (5) The hospital tries to read --------------------------------------------------------------

interface Lookup {
  code: string;
  display_name: string;
  masked_cccd: string;
  status: string;
}

function TryToRead() {
  const [cccd, setCccd] = useState("");
  const [found, setFound] = useState<Lookup | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);

  async function lookup(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFound(null);
    try {
      // CCCD only ever travels in a POST body.
      setFound(await api<Lookup>("/api/patients/lookup", { body: { cccd } }));
      setCccd("");
      setAttempt((n) => n + 1);
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Try to read a patient's records as the hospital">
      <p className="mb-3 text-sm text-slate-600">
        The hospital can find a patient and fetch their ciphertext, but it is never the subject of any policy and has no decrypt
        role. Every record should show as locked.
      </p>
      <form onSubmit={lookup} className="flex flex-wrap items-end gap-2">
        <div className="w-full max-w-xs">
          <Field label="Patient CCCD (12 digits)">
            <input
              className={inputClass}
              value={cccd}
              onChange={(e) => setCccd(e.target.value)}
              inputMode="numeric"
              autoComplete="off"
              placeholder="079…"
            />
          </Field>
        </div>
        <Button type="submit" disabled={busy || cccd.replace(/\D/g, "").length !== 12}>
          {busy ? "Looking up…" : "Find patient"}
        </Button>
      </form>
      {error && (
        <div className="mt-3">
          <Notice kind="error">{error}</Notice>
        </div>
      )}
      {found && (
        <div className="mt-4 space-y-3">
          <p className="text-sm text-slate-700">
            <span className="font-medium">{found.display_name}</span> · CCCD {found.masked_cccd} ·{" "}
            <span className="font-mono text-xs">{found.code}</span> <StatusBadge status={found.status} />
          </p>
          <RecordsViewer key={`${found.code}-${attempt}`} patientCode={found.code} viewerLabel="Hospital account" />
        </div>
      )}
    </Card>
  );
}

// --- (6) Recent visits ------------------------------------------------------------------------

function RecentVisits() {
  const [visits, setVisits] = useState<VisitView[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = () =>
      api<{ visits: VisitView[] }>("/api/visits")
        .then((r) => {
          setVisits(r.visits);
          setError(null);
        })
        .catch((e) => setError(errText(e)));
    void load();
    const t = setInterval(load, POLL_MS * 3);
    return () => clearInterval(t);
  }, []);

  return (
    <Card title="Recent visits">
      {error && <Notice kind="error">Could not load visits: {error}</Notice>}
      {!visits && !error && <Empty>Loading…</Empty>}
      {visits && !visits.length && <Empty>No visits yet.</Empty>}
      {visits && visits.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead className="text-xs uppercase text-slate-500">
              <tr>
                <th className="py-2 pr-3 font-medium">Doctor</th>
                <th className="py-2 pr-3 font-medium">Patient</th>
                <th className="py-2 pr-3 font-medium">Specialties</th>
                <th className="py-2 pr-3 font-medium">Window</th>
                <th className="py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visits.slice(0, 30).map((v) => (
                <tr key={v.id}>
                  <td className="py-2 pr-3">Dr {v.doctor_name}</td>
                  <td className="py-2 pr-3">{v.patient_name}</td>
                  <td className="py-2 pr-3">{v.specialties.map((s) => SPECIALTY_LABEL[s] ?? s).join(", ")}</td>
                  <td className="py-2 pr-3 text-xs text-slate-600">
                    {fmtTime(v.starts_at)} – {fmtTime(v.ends_at)}
                  </td>
                  <td className="py-2">
                    <StatusBadge status={v.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
