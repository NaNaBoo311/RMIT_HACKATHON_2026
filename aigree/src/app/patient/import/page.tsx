"use client";
// Add an earlier record (e.g. from a previous clinic) to the patient's own history. Encryption only
// happens in a browser holding the right policy, so the patient encrypts it here with their OWN
// policy for that compartment; the server stores only ciphertext.
import { useState } from "react";
import Link from "next/link";
import { RoleGate } from "@/components/AppShell";
import { Button, Card, Field, Notice, inputClass } from "@/components/ui";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { encryptForTag } from "@/lib/tide/sealed";
import { KIND_LABEL, RECORD_KINDS, tagFor } from "@/lib/tags";
import type { RecordKind, RecordPlain, RecordsResponse } from "@/lib/types";

export default function ImportPage() {
  return (
    <RoleGate role="benh_nhan">
      <ImportForm />
    </RoleGate>
  );
}

function ImportForm() {
  const { patient } = useSession();
  const [kind, setKind] = useState<RecordKind>("mat");
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string[]>([]);

  if (!patient || patient.status !== "active") {
    return (
      <Notice kind="warning">
        Your patient record must be active before you can add records.{" "}
        <Link href="/patient/register" className="underline">
          Finish registration
        </Link>
      </Notice>
    );
  }
  const code = patient.code;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !body.trim()) {
      setError("Title and notes are required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const tag = tagFor(code, kind);
      const { policies } = await api<RecordsResponse>(`/api/records?patient=${encodeURIComponent(code)}`);
      if (!policies[tag]) throw new Error(`No active ${KIND_LABEL[kind]} policy on your record`);
      const plain: RecordPlain = { title: title.trim(), body: body.trim(), date: new Date(date).toISOString() };
      const ciphertext = await encryptForTag(JSON.stringify(plain), tag, policies[tag]);
      await api("/api/records", { body: { patient_code: code, kind, ciphertext } });
      setSaved((s) => [`${KIND_LABEL[kind]}: ${plain.title}`, ...s]);
      setTitle("");
      setBody("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-xl font-semibold">Add an earlier record</h1>
      <p className="text-sm text-slate-600">
        Bring results from another clinic into your history. The record is encrypted in this browser for its compartment;
        AIgree stores only ciphertext, and doctors see it only during visits you approve.
      </p>
      {error && <Notice kind="error">{error}</Notice>}
      <Card>
        <form onSubmit={save} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Compartment">
              <select className={inputClass} value={kind} onChange={(e) => setKind(e.target.value as RecordKind)}>
                {RECORD_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABEL[k]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Date">
              <input type="date" className={inputClass} value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
          </div>
          <Field label="Title">
            <input className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
          </Field>
          <Field label="Notes">
            <textarea className={`${inputClass} min-h-32`} value={body} onChange={(e) => setBody(e.target.value)} />
          </Field>
          <div className="flex justify-end">
            <Button type="submit" disabled={busy}>
              {busy ? "Encrypting…" : "Encrypt and save"}
            </Button>
          </div>
        </form>
      </Card>
      {saved.length > 0 && (
        <Notice kind="success">
          Saved: {saved.join("; ")}.{" "}
          <Link href="/patient" className="underline">
            View my records
          </Link>
        </Notice>
      )}
    </div>
  );
}
