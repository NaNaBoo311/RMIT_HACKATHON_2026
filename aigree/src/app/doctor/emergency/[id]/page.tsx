"use client";
// Emergency (break-glass) view for the requesting ER doctor. Polls the request every 5 s. Once it is
// approved (2 of 3 approver types) and the hospital has co-signed the 60-minute read grants, the
// records decrypt in this browser with a watermark marking the access as an emergency.
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTideCloak } from "@/lib/tide/client";
import { RoleGate } from "@/components/AppShell";
import { RecordsViewer } from "@/components/RecordsViewer";
import { Badge, Button, Card, Notice, StatusBadge, fmtTime } from "@/components/ui";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { tagFor } from "@/lib/tags";
import type { ApproverType, DecryptedRecord, EmergencyView, RecordsResponse } from "@/lib/types";

const POLL_MS = 5000;
const EMERGENCY_KINDS = ["thietyeu", "mat", "noitiet"] as const;
const APPROVER_LABEL: Record<ApproverType, string> = { doctor: "Emergency doctor", hospital: "Hospital", family: "Family" };

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export default function DoctorEmergencyPage() {
  return (
    <RoleGate role="bac_si">
      <DoctorEmergency />
    </RoleGate>
  );
}

function DoctorEmergency() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { profile } = useSession();
  const { forceRefreshToken } = useTideCloak();

  const [emergency, setEmergency] = useState<EmergencyView | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [policyTags, setPolicyTags] = useState<string[] | null>(null);

  const lastStatus = useRef<string | null>(null);
  // Tags we hold a policy for after the last records load (null = not loaded yet), and whether a
  // reload we asked for is still in flight (retried after 20 s if it never reports back). Grants are invisible here, so the policies returned with
  // the records tell us when the hospital has co-signed.
  const loadedTags = useRef<string[] | null>(null);
  const awaitingSince = useRef(0);
  const refreshRef = useRef(forceRefreshToken);
  useEffect(() => {
    refreshRef.current = forceRefreshToken;
  });

  const bump = useCallback(() => {
    awaitingSince.current = Date.now();
    setRefreshKey((k) => k + 1);
  }, []);

  const load = useCallback(async () => {
    try {
      const r = await api<{ emergencies: EmergencyView[] }>("/api/emergency");
      const e = r.emergencies.find((x) => x.id === id) ?? null;
      setEmergency(e);
      setNotFound(!e);
      setError(null);
      if (!e) return;

      const prev = lastStatus.current;
      lastStatus.current = e.status;
      if (prev !== null && prev !== e.status) {
        try {
          // Never let a hung refresh stall the poll loop.
          await Promise.race([refreshRef.current(), new Promise((r) => setTimeout(r, 5000))]);
        } catch {
          // best effort
        }
        bump();
        return;
      }

      // Approved but not all emergency grants usable yet: re-fetch records until they are.
      if (e.status === "approved" && loadedTags.current && Date.now() - awaitingSince.current > 20_000) {
        const expected = EMERGENCY_KINDS.map((k) => tagFor(e.patient_code, k));
        // Only while nothing is usable yet (co-sign pending). A partial set means some grants were
        // revoked: reloading then would just re-decrypt and flood the patient's access log.
        if (!expected.some((t) => loadedTags.current!.includes(t))) bump();
      }
    } catch (err) {
      setError(errMsg(err));
    }
  }, [id, bump]);

  useEffect(() => {
    let busy = false;
    const tick = async () => {
      if (busy) return;
      busy = true;
      try {
        await load();
      } finally {
        busy = false;
      }
    };
    void tick();
    const t = setInterval(tick, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  // Stable identity so RecordsViewer does not reload on every render.
  const onLoaded = useCallback((resp: RecordsResponse, _recs: DecryptedRecord[]) => {
    const tags = Object.keys(resp.policies ?? {});
    loadedTags.current = tags;
    awaitingSince.current = Date.now();
    setPolicyTags(tags);
  }, []);

  if (notFound) {
    return (
      <Notice kind="warning">
        Emergency request not found. <Link href="/doctor" className="underline">Back to my visits</Link>
      </Notice>
    );
  }
  if (!emergency) {
    return error ? <Notice kind="error">{error}</Notice> : <p className="text-sm text-slate-500">Loading emergency request…</p>;
  }

  const expected = EMERGENCY_KINDS.map((k) => tagFor(emergency.patient_code, k));
  const cosigned = !!policyTags && expected.every((t) => policyTags.includes(t));
  const minutesLeft = emergency.expires_at
    ? Math.max(0, Math.round((new Date(emergency.expires_at).getTime() - Date.now()) / 60000))
    : null;

  return (
    <div className="space-y-6">
      {error && <Notice kind="error">Refresh failed: {error}</Notice>}
      <Card>
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-rose-700">Emergency access</p>
            <h1 className="text-xl font-semibold text-slate-900">{emergency.patient_name}</h1>
            <p className="mt-1 text-sm text-slate-600">Reason: {emergency.reason}</p>
            <p className="mt-1 text-xs text-slate-500">
              Requested {fmtTime(emergency.created_at)}
              {emergency.expires_at && ` · expires ${fmtTime(emergency.expires_at)}`}
              {emergency.status === "approved" && minutesLeft !== null && ` (${minutesLeft} min left)`}
            </p>
          </div>
          <StatusBadge status={emergency.status} />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-slate-600">Approvals ({emergency.approvals.length}/2 needed):</span>
          {(["doctor", "hospital", "family"] as ApproverType[]).map((a) => (
            <Badge key={a} color={emergency.approvals.includes(a) ? "green" : "slate"}>
              {emergency.approvals.includes(a) ? "✓" : "·"} {APPROVER_LABEL[a]}
            </Badge>
          ))}
        </div>
        <div className="mt-3">
          {emergency.status === "pending" && (
            <Notice kind="info">Waiting for a second approval: the hospital account or a linked family member.</Notice>
          )}
          {emergency.status === "approved" && !cosigned && (
            <Notice kind="info">Approved – waiting for the hospital to co-sign the 60-minute grants with Tide.</Notice>
          )}
          {emergency.status === "approved" && cosigned && (
            <Notice kind="success">Emergency access active. Every view is logged and shown to the patient.</Notice>
          )}
          {emergency.status === "expired" && <Notice kind="warning">Emergency access ended – access revoked.</Notice>}
        </div>
      </Card>

      {emergency.status === "approved" && (
        <div className="space-y-2">
          <div className="flex justify-end">
            <Button variant="secondary" onClick={bump}>
              Reload records
            </Button>
          </div>
          <RecordsViewer
            patientCode={emergency.patient_code}
            viewerLabel={`Dr ${profile?.display_name ?? ""} · EMERGENCY`}
            title="Emergency records"
            refreshKey={refreshKey}
            onLoaded={onLoaded}
          />
        </div>
      )}
    </div>
  );
}
