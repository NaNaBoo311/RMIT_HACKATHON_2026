"use client";
// Fetches a patient's ciphertext + the caller's policies from GET /api/records and decrypts in the
// browser via Tide (one network call per compartment). The server never sees plaintext: whatever it
// hands out, the Tide network decides what decrypts. Decrypt/denied outcomes are reported to
// POST /api/logs (one entry per compartment per load).
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { decryptItems } from "@/lib/tide/sealed";
import { KIND_LABEL, RECORD_KINDS, tagFor } from "@/lib/tags";
import type { DecryptedRecord, RecordPlain, RecordsResponse } from "@/lib/types";
import { Button, Card, Empty, LockedCard, Notice, Watermark, fmtTime } from "./ui";

export interface RecordsViewerProps {
  patientCode: string;
  viewerLabel: string;
  visitId?: string;
  refreshKey?: number;
  title?: string;
  onLoaded?: (resp: RecordsResponse, decrypted: DecryptedRecord[]) => void;
}

/** Parse decrypted plaintext; tolerate items that are not RecordPlain JSON. */
function toPlain(text: string, fallbackDate: string): RecordPlain {
  try {
    const v = JSON.parse(text) as Partial<RecordPlain>;
    if (v && typeof v === "object" && typeof v.body === "string") {
      return { title: String(v.title ?? "Untitled"), body: v.body, date: String(v.date ?? fallbackDate) };
    }
  } catch {
    /* plain text */
  }
  return { title: "Untitled", body: text, date: fallbackDate };
}

const fmtDate = (iso: string) => {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
};

export function RecordsViewer({ patientCode, viewerLabel, visitId, refreshKey, title, onLoaded }: RecordsViewerProps) {
  const [resp, setResp] = useState<RecordsResponse | null>(null);
  const [items, setItems] = useState<DecryptedRecord[]>([]);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewedAt, setViewedAt] = useState("");
  const [reloadTick, setReloadTick] = useState(0);
  const reload = useCallback(() => setReloadTick((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setWorking(true);
      setError(null);
      try {
        const data = await api<RecordsResponse>(`/api/records?patient=${encodeURIComponent(patientCode)}`);
        if (cancelled) return;
        const results = await decryptItems(
          data.records.map((r) => ({ id: r.id, tag: r.tag, ciphertext: r.ciphertext })),
          data.policies,
        );
        if (cancelled) return;

        const byId = new Map(results.map((r) => [r.id, r]));
        const decrypted: DecryptedRecord[] = data.records.map((r) => {
          const meta = {
            id: r.id,
            kind: r.kind,
            tag: r.tag,
            created_at: r.created_at,
            author_profile_id: r.author_profile_id,
            visit_id: r.visit_id,
          };
          const res = byId.get(r.id);
          if (res?.ok) return { ...meta, ok: true as const, data: toPlain(res.plaintext, r.created_at) };
          return { ...meta, ok: false as const, error: res && !res.ok ? res.error : "Not decrypted" };
        });

        setResp(data);
        setItems(decrypted);
        setViewedAt(fmtTime(new Date().toISOString()));
        onLoaded?.(data, decrypted);

        // One log entry per compartment: decrypt if the network released it, denied otherwise.
        const perTag = new Map<string, boolean>();
        for (const d of decrypted) perTag.set(d.tag, (perTag.get(d.tag) ?? true) && d.ok);
        const entries = [...perTag.entries()].map(([tag, okAll]) => ({
          patient_code: patientCode,
          action: okAll ? "decrypt" : "denied",
          tag,
          ...(visitId ? { visit_id: visitId } : {}),
        }));
        if (entries.length) {
          api("/api/logs", { method: "POST", body: { entries } }).catch(() => {
            /* logging is best-effort */
          });
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setWorking(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // onLoaded is intentionally not a dependency: callers often pass an inline function.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientCode, visitId, refreshKey, reloadTick]);

  return (
    <Card
      title={title ?? "Records"}
      actions={
        <Button variant="ghost" onClick={reload} disabled={working}>
          Reload
        </Button>
      }
    >
      <div className="space-y-4">
        {resp?.breachDrill && (
          <div className="rounded-md bg-rose-600 px-3 py-2 text-sm font-medium text-white">
            Breach drill is ON: the server is handing out every ciphertext and policies you were never granted.
            Only the Tide network decides what decrypts.
          </div>
        )}
        {working && <p className="text-sm text-teal-700">Decrypting in your browser via Tide…</p>}
        {error && <Notice kind="error">Could not load records: {error}</Notice>}

        {resp &&
          RECORD_KINDS.map((kind) => {
            const group = items.filter((i) => i.kind === kind);
            const hasPolicy = !!resp.policies[tagFor(patientCode, kind)];
            return (
              <div key={kind}>
                <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">{KIND_LABEL[kind]}</h3>
                {group.length === 0 ? (
                  hasPolicy ? (
                    <Empty>No records</Empty>
                  ) : (
                    <LockedCard
                      title={`${KIND_LABEL[kind]} compartment`}
                      message="Locked – no grant from the patient for this compartment"
                      reason="The server sends no ciphertext without a signed grant, and the Tide network would refuse it anyway."
                    />
                  )
                ) : (
                  <div className="space-y-2">
                    {group.map((r) =>
                      r.ok ? (
                        <Watermark key={r.id} text={`${viewerLabel} · ${viewedAt}`}>
                          <article className="rounded-md border border-slate-200 bg-white p-3">
                            <div className="flex flex-wrap items-baseline justify-between gap-2">
                              <h4 className="font-medium text-slate-900">{r.data.title}</h4>
                              <span className="text-xs text-slate-500">{fmtDate(r.data.date)}</span>
                            </div>
                            <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{r.data.body}</p>
                            <p className="mt-2 text-[11px] text-slate-400">Saved {fmtTime(r.created_at)}</p>
                          </article>
                        </Watermark>
                      ) : (
                        <LockedCard
                          key={r.id}
                          title={`${KIND_LABEL[kind]} record · ${fmtTime(r.created_at)}`}
                          reason={r.error}
                        />
                      ),
                    )}
                  </div>
                )}
              </div>
            );
          })}
      </div>
    </Card>
  );
}
