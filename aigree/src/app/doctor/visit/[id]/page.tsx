"use client";
// One visit, doctor's view. Polls the visit every 5 s; when it becomes active (hospital co-signed)
// or the set of active grants changes, refreshes the token and reloads the records, which are
// decrypted HERE in the browser with the doctor's own signed policies. New notes are encrypted
// here too. The chatbot only ever receives records this browser already decrypted.
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTideCloak } from "@/lib/tide/client";
import { RoleGate } from "@/components/AppShell";
import { RecordsViewer } from "@/components/RecordsViewer";
import { Badge, Button, Card, Empty, Field, Notice, StatusBadge, fmtTime, inputClass } from "@/components/ui";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { encryptForTag } from "@/lib/tide/sealed";
import { KIND_LABEL, SPECIALTIES, SPECIALTY_LABEL, kindOfTag, tagFor, type Specialty } from "@/lib/tags";
import type { DecryptedRecord, GrantView, RecordPlain, RecordsResponse, VisitView } from "@/lib/types";

interface VisitResponse {
  visit: VisitView;
  grants: GrantView[];
  breachDrill: boolean;
}

interface ChatAnswer {
  question: string;
  answer: string;
  citations: string[];
}

const POLL_MS = 5000;
const OPEN = ["pending_consent", "awaiting_cosign", "active"];

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

const STATUS_TEXT: Record<string, string> = {
  pending_consent: "Waiting for the patient to approve",
  awaiting_cosign: "Patient approved – waiting for the hospital to co-sign with Tide",
  active: "Visit active – you can read this visit's compartments until it ends",
  completed: "Visit ended – access revoked",
  expired: "Visit ended – access revoked",
  declined: "The patient declined this visit",
};

// Words that suggest a question needs a specialty compartment.
const SPECIALTY_HINTS: Record<Specialty, RegExp> = {
  mat: /\b(eyes?|ophthalm\w*|vision|visual|retina\w*|retinopathy|glaucoma|cataract\w*|intraocular|iop|cornea\w*|optic\w*|macula\w*)\b/i,
  noitiet: /\b(endocrin\w*|diabet\w*|thyroid\w*|insulin|glucose|hba1c|a1c|hormone\w*|metformin|blood sugar|thyrox\w*|tsh)\b/i,
};

export default function DoctorVisitPage() {
  return (
    <RoleGate role="bac_si">
      <DoctorVisit />
    </RoleGate>
  );
}

function DoctorVisit() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { profile } = useSession();
  const { forceRefreshToken } = useTideCloak();

  const [data, setData] = useState<VisitResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [policies, setPolicies] = useState<Record<string, string>>({});
  const [decrypted, setDecrypted] = useState<DecryptedRecord[]>([]);

  // Last seen status / active grant set / breach drill: a change triggers a token refresh + reload.
  const seen = useRef<string | null>(null);
  const refreshRef = useRef(forceRefreshToken);
  useEffect(() => {
    refreshRef.current = forceRefreshToken;
  });

  const load = useCallback(async () => {
    try {
      const r = await api<VisitResponse>(`/api/visits/${id}`);
      setData(r);
      setError(null);
      const activeIds = r.grants
        .filter((g) => g.status === "active")
        .map((g) => g.id)
        .sort()
        .join(",");
      const key = `${r.visit.status}|${activeIds}|${r.breachDrill}`;
      const prev = seen.current;
      seen.current = key;
      if (prev !== null && prev !== key) {
        try {
          // Never let a hung refresh stall the poll loop.
          await Promise.race([refreshRef.current(), new Promise((r) => setTimeout(r, 5000))]);
        } catch {
          // best effort: policies, not token roles, gate decryption
        }
        setRefreshKey((k) => k + 1);
      }
    } catch (e) {
      setError(errMsg(e));
    }
  }, [id]);

  // Poll every 5 s without overlapping requests.
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

  // Stable identity: RecordsViewer may list it in an effect's dependencies.
  const onLoaded = useCallback((resp: RecordsResponse, recs: DecryptedRecord[]) => {
    setPolicies(resp.policies ?? {});
    setDecrypted(recs);
  }, []);

  const requestAccess = useCallback(
    async (specialty: Specialty) => {
      await api(`/api/visits/${id}/requests`, { body: { specialty } });
      await load();
    },
    [id, load],
  );

  if (!data) {
    return error ? <Notice kind="error">{error}</Notice> : <p className="text-sm text-slate-500">Loading visit…</p>;
  }

  const { visit, grants, breachDrill } = data;
  const isOpen = OPEN.includes(visit.status);
  const readable = decrypted.filter((r): r is DecryptedRecord & { ok: true; data: RecordPlain } => r.ok);

  return (
    <div className="space-y-6">
      {error && <Notice kind="error">Refresh failed: {error}</Notice>}
      {breachDrill && (
        <div className="rounded-md border-2 border-rose-500 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          <strong>Breach drill is ON.</strong> The server is deliberately misbehaving: it returns every record and hands
          out the patient&apos;s own policies. Watch the Tide network refuse anything this visit was not granted.
        </div>
      )}

      <VisitHeader visit={visit} />

      {readable.length > 0 && (
        <ChatPanel visit={visit} visitId={id} records={readable} onRequestAccess={requestAccess} />
      )}

      <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
        <div className="min-w-0 space-y-6">
          <RecordsViewer
            patientCode={visit.patient_code}
            visitId={id}
            viewerLabel={`Dr ${profile?.display_name ?? ""}`}
            refreshKey={refreshKey}
            onLoaded={onLoaded}
          />
        </div>

        <div className="space-y-6">
          <GrantsPanel grants={grants} />
          {visit.status === "active" && (
            <AddRecord visit={visit} grants={grants} policies={policies} onSaved={() => setRefreshKey((k) => k + 1)} />
          )}
          <ExtraSpecialty visit={visit} onRequest={requestAccess} />
          {isOpen && <EndVisit visitId={id} onEnded={load} />}
        </div>
      </div>
    </div>
  );
}

function VisitHeader({ visit }: { visit: VisitView }) {
  const ended = ["completed", "expired", "declined"].includes(visit.status);
  return (
    <Card>
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold text-slate-900">{visit.patient_name}</h1>
          <p className="mt-1 text-sm text-slate-600">
            {visit.specialties.map((s) => SPECIALTY_LABEL[s] ?? s).join(", ")} · {fmtTime(visit.starts_at)} –{" "}
            {fmtTime(visit.ends_at)}
          </p>
        </div>
        <StatusBadge status={visit.status} />
      </div>
      <div className="mt-3">
        <Notice kind={visit.status === "active" ? "success" : ended ? "warning" : "info"}>
          {STATUS_TEXT[visit.status] ?? visit.status}
        </Notice>
      </div>
    </Card>
  );
}

function GrantsPanel({ grants }: { grants: GrantView[] }) {
  return (
    <Card title="Grants for this visit">
      {!grants.length ? (
        <Empty>No grants yet. They are created when the patient approves.</Empty>
      ) : (
        <ul className="divide-y divide-slate-100">
          {grants.map((g) => {
            const kind = kindOfTag(g.tag);
            return (
              <li key={g.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                <span className="font-medium text-slate-900">{kind ? KIND_LABEL[kind] : g.tag}</span>
                <Badge color={g.access === "read-write" ? "blue" : "slate"}>{g.access}</Badge>
                {g.access_request_id && <Badge color="amber">extra</Badge>}
                <StatusBadge status={g.status} />
                <span className="ml-auto text-xs text-slate-500">expires {fmtTime(g.expires_at)}</span>
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-3 text-xs text-slate-500">
        Each grant is a Tide policy naming you and one compartment. It works only after the hospital co-signs it, and
        the network refuses it after it expires.
      </p>
    </Card>
  );
}

function AddRecord({
  visit,
  grants,
  policies,
  onSaved,
}: {
  visit: VisitView;
  grants: GrantView[];
  policies: Record<string, string>;
  onSaved: () => void;
}) {
  const writable = (SPECIALTIES as readonly Specialty[]).filter(
    (s) =>
      visit.specialties.includes(s) &&
      grants.some((g) => g.tag === tagFor(visit.patient_code, s) && g.status === "active" && g.access === "read-write"),
  );
  const [kind, setKind] = useState<Specialty | "">(writable[0] ?? "");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const selected = kind && writable.includes(kind) ? kind : writable[0];
  if (!writable.length) return null;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!selected || !title.trim() || !body.trim()) return;
    const tag = tagFor(visit.patient_code, selected);
    const policy = policies[tag];
    if (!policy) {
      setError("Your policy for this compartment has not loaded yet. Wait for the records to load and try again.");
      return;
    }
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const plain: RecordPlain = { title: title.trim(), body: body.trim(), date: new Date().toISOString() };
      const ciphertext = await encryptForTag(JSON.stringify(plain), tag, policy);
      await api("/api/records", { body: { patient_code: visit.patient_code, kind: selected, ciphertext, visit_id: visit.id } });
      setTitle("");
      setBody("");
      setSaved(true);
      onSaved();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Add record">
      <form onSubmit={save} className="space-y-3">
        <Field label="Compartment">
          <select className={inputClass} value={selected} onChange={(e) => setKind(e.target.value as Specialty)}>
            {writable.map((s) => (
              <option key={s} value={s}>
                {KIND_LABEL[s]} ({SPECIALTY_LABEL[s]})
              </option>
            ))}
          </select>
        </Field>
        <Field label="Title">
          <input className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Follow-up exam" />
        </Field>
        <Field label="Note" hint="Encrypted in this browser before it is sent. The server stores only ciphertext.">
          <textarea className={`${inputClass} min-h-28`} value={body} onChange={(e) => setBody(e.target.value)} />
        </Field>
        {error && <Notice kind="error">{error}</Notice>}
        {saved && <Notice kind="success">Record encrypted and saved.</Notice>}
        <Button type="submit" disabled={busy || !title.trim() || !body.trim()}>
          {busy ? "Encrypting…" : "Encrypt & save"}
        </Button>
      </form>
    </Card>
  );
}

function ExtraSpecialty({ visit, onRequest }: { visit: VisitView; onRequest: (s: Specialty) => Promise<void> }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const extra = (SPECIALTIES as readonly Specialty[]).filter((s) => !visit.specialties.includes(s));
  const canRequest = visit.status === "awaiting_cosign" || visit.status === "active";

  if (!extra.length && !visit.requests.length) return null;

  async function request(s: Specialty) {
    setBusy(s);
    setError(null);
    try {
      await onRequest(s);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card title="Request extra specialty">
      <div className="space-y-3">
        {extra.map((s) => {
          const latest = [...visit.requests].reverse().find((r) => r.specialty === s);
          const blocked = latest && (latest.status === "pending" || latest.status === "approved");
          return (
            <div key={s} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium text-slate-900">{SPECIALTY_LABEL[s]}</span>
              <span className="text-xs text-slate-500">({KIND_LABEL[s]} records, read-only)</span>
              {latest && <StatusBadge status={latest.status} />}
              <Button
                variant="secondary"
                className="ml-auto"
                disabled={!canRequest || !!blocked || busy === s}
                onClick={() => request(s)}
              >
                {busy === s ? "Requesting…" : "Request"}
              </Button>
            </div>
          );
        })}
        {!canRequest && <p className="text-xs text-slate-500">Extra access can be requested only during an approved visit.</p>}
        {error && <Notice kind="error">{error}</Notice>}
        {visit.requests.length > 0 && (
          <ul className="space-y-1 border-t border-slate-100 pt-2 text-xs text-slate-600">
            {visit.requests.map((r) => (
              <li key={r.id} className="flex items-center gap-2">
                {SPECIALTY_LABEL[r.specialty] ?? r.specialty} <StatusBadge status={r.status} />
                <span className="ml-auto">{fmtTime(r.decided_at ?? r.created_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

function EndVisit({ visitId, onEnded }: { visitId: string; onEnded: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function end() {
    if (!window.confirm("End this visit? Your access to the patient's records is revoked immediately.")) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/api/visits/${visitId}/end`, { method: "POST", body: {} });
      await onEnded();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <div className="space-y-2">
        <Button variant="danger" onClick={end} disabled={busy} className="w-full">
          {busy ? "Ending…" : "End visit"}
        </Button>
        {error && <Notice kind="error">{error}</Notice>}
      </div>
    </Card>
  );
}

function ChatPanel({
  visit,
  visitId,
  records,
  onRequestAccess,
}: {
  visit: VisitView;
  visitId: string;
  records: (DecryptedRecord & { ok: true; data: RecordPlain })[];
  onRequestAccess: (s: Specialty) => Promise<void>;
}) {
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Only the latest answer, in memory. Chat history is never stored.
  const [result, setResult] = useState<ChatAnswer | null>(null);
  const [reqBusy, setReqBusy] = useState<string | null>(null);
  const [reqError, setReqError] = useState<string | null>(null);

  async function ask(e: React.FormEvent) {
    e.preventDefault();
    const q = question.trim();
    if (!q) return;
    setBusy(true);
    setError(null);
    try {
      // Only what this browser decrypted, and never the patient's name or CCCD.
      const payload = records.map((r) => ({
        id: r.id,
        kind: r.kind,
        title: r.data.title,
        body: r.data.body,
        date: r.data.date,
      }));
      const r = await api<{ answer: string; citations: string[] }>("/api/chat", {
        body: { question: q, records: payload, visit_id: visitId },
      });
      setResult({ question: q, answer: r.answer, citations: r.citations });
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  async function requestAccess(s: Specialty) {
    setReqBusy(s);
    setReqError(null);
    try {
      await onRequestAccess(s);
    } catch (e) {
      setReqError(errMsg(e));
    } finally {
      setReqBusy(null);
    }
  }

  // Specialties the question touches that this visit does not cover.
  const missing = result
    ? (SPECIALTIES as readonly Specialty[]).filter((s) => !visit.specialties.includes(s) && SPECIALTY_HINTS[s].test(result.question))
    : [];
  const titleOf = new Map(records.map((r) => [r.id, r.data.title]));

  return (
    <Card title="Ask about these records">
      <div className="space-y-3">
        <Notice kind="warning">Assistive only – not a diagnosis.</Notice>
        <form onSubmit={ask} className="space-y-2">
          <textarea
            className={`${inputClass} min-h-36 resize-y text-base leading-relaxed`}
            onKeyDown={(e) => {
              // Ctrl/Cmd+Enter sends.
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) e.currentTarget.form?.requestSubmit();
            }}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Summarise the latest findings and current medications"
          />
          <div className="flex items-center gap-2">
            <Button type="submit" disabled={busy || !question.trim()}>
              {busy ? "Thinking…" : "Ask"}
            </Button>
            <span className="text-xs text-slate-500">Sends only the {records.length} decrypted record(s) shown below. Ctrl+Enter to send.</span>
          </div>
        </form>
        {error && <Notice kind="error">{error}</Notice>}

        {result && (
          <div className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs font-medium text-slate-500">Q: {result.question}</p>
            <div className="whitespace-pre-wrap text-sm leading-relaxed text-slate-900">
              {renderAnswer(result.answer, result.citations)}
            </div>
            {result.citations.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {result.citations.map((c, i) => (
                  <Badge key={c} color="blue">
                    [{i + 1}] {titleOf.get(c) ?? "record"}
                  </Badge>
                ))}
              </div>
            )}
            {missing.map((s) => {
              const latest = [...visit.requests].reverse().find((r) => r.specialty === s);
              const pending = latest?.status === "pending";
              const approved = latest?.status === "approved";
              return (
                <div key={s} className="flex flex-wrap items-center gap-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-sm text-amber-900">
                  <span>
                    This question may need {SPECIALTY_LABEL[s]} ({KIND_LABEL[s]}) records, which are locked for this visit.
                  </span>
                  {approved ? (
                    <Badge color="green">patient approved – see grants</Badge>
                  ) : pending ? (
                    <Badge color="amber">request pending</Badge>
                  ) : (
                    <Button variant="secondary" disabled={reqBusy === s} onClick={() => requestAccess(s)}>
                      {reqBusy === s ? "Requesting…" : "Request access from patient"}
                    </Button>
                  )}
                </div>
              );
            })}
            {reqError && <Notice kind="error">{reqError}</Notice>}
          </div>
        )}
        <p className="text-xs text-slate-500">Assistive only – not a diagnosis. Questions and answers are not stored.</p>
      </div>
    </Card>
  );
}

/**
 * Render an assistant answer: **bold** becomes bold, and record citations ([rec:<id>], possibly
 * shortened or grouped) become numbered references matching the citation badges.
 */
function renderAnswer(answer: string, citations: string[]) {
  const num = (cited: string) => {
    const i = citations.findIndex((c) => c === cited || (cited.length >= 6 && c.startsWith(cited)));
    return i >= 0 ? `[${i + 1}]` : "";
  };
  const text = answer
    .replace(/\[((?:\s*,?\s*(?:rec|r):[A-Za-z0-9_-]+)+)\s*\]/g, (_, ids: string) =>
      [...ids.matchAll(/(?:rec|r):([A-Za-z0-9_-]+)/g)].map((m) => num(m[1])).join(""),
    )
    .replace(/\b(?:rec|r):([A-Za-z0-9_-]{6,})/g, (_, id: string) => num(id));
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? <strong key={i}>{part.slice(2, -2)}</strong> : <span key={i}>{part}</span>,
  );
}
