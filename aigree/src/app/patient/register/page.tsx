"use client";
// First-time patient setup:
//  1. Enter CCCD -> server stores only its HMAC and asks the hospital to co-sign 4 self-grants.
//  2. Wait for the hospital account to activate (co-sign) the record keys.
//  3. Encrypt the CCCD in this browser under <code>_dinhdanh and store the ciphertext.
// The CCCD lives only in component state and POST bodies: never in the URL, storage or console.
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { RoleGate } from "@/components/AppShell";
import { Button, Card, Field, Notice, inputClass } from "@/components/ui";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { encryptForTag } from "@/lib/tide/sealed";
import { tagFor } from "@/lib/tags";
import type { RecordsResponse } from "@/lib/types";

export default function RegisterPage() {
  return (
    <RoleGate role="benh_nhan">
      <Register />
    </RoleGate>
  );
}

const digitsOnly = (s: string) => s.replace(/\D/g, "").slice(0, 12);

function Register() {
  const { patient, refresh } = useSession();
  const [cccd, setCccd] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // True when the CCCD in state was typed in step 1 of this visit (so step 3 can finish by itself).
  const carried = useRef(false);

  const step = !patient ? 1 : patient.status === "awaiting_activation" ? 2 : !patient.hasCccd ? 3 : 4;

  // Step 2: poll the session until the hospital has co-signed.
  useEffect(() => {
    if (step !== 2) return;
    const t = setInterval(() => void refresh(), 5000);
    return () => clearInterval(t);
  }, [step, refresh]);

  async function prepare(e: React.FormEvent) {
    e.preventDefault();
    if (cccd.length !== 12) return setError("CCCD must be 12 digits");
    setBusy(true);
    setError(null);
    try {
      await api("/api/patients/register?step=prepare", { body: { cccd } });
      carried.current = true;
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const complete = useCallback(async () => {
    if (!patient || cccd.length !== 12) return;
    setBusy(true);
    setError(null);
    try {
      const data = await api<RecordsResponse>(`/api/records?patient=${encodeURIComponent(patient.code)}`);
      const tag = tagFor(patient.code, "dinhdanh");
      const policy = data.policies[tag];
      if (!policy) throw new Error("Your Identity key is not active yet. Ask the hospital to activate your record.");
      const ciphertext = await encryptForTag(cccd, tag, policy);
      await api("/api/patients/register?step=complete", { body: { cccd, cccd_ciphertext: ciphertext } });
      setCccd("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [patient, cccd, refresh]);

  // Step 3: if the CCCD is still in memory from step 1, finish automatically once activated.
  useEffect(() => {
    if (step === 3 && cccd.length === 12 && carried.current) {
      carried.current = false;
      void complete();
    }
  }, [step, cccd, complete]);

  const cccdInput = (
    <Field label="CCCD (citizen ID, 12 digits)" hint="Sent only in an encrypted HTTPS body. The server keeps a keyed hash, never the number.">
      <div className="flex gap-2">
        <input
          className={inputClass}
          type={show ? "text" : "password"}
          inputMode="numeric"
          autoComplete="off"
          value={cccd}
          onChange={(e) => setCccd(digitsOnly(e.target.value))}
          placeholder="079xxxxxxxxx"
        />
        <Button type="button" variant="secondary" onClick={() => setShow((s) => !s)}>
          {show ? "Hide" : "Show"}
        </Button>
      </div>
    </Field>
  );

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <h1 className="text-xl font-semibold">Set up your sealed record</h1>
      <ol className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-3">
        {["Enter your CCCD", "Hospital activates your keys", "Encrypt your identity"].map((label, i) => (
          <li
            key={label}
            className={`rounded-md border px-3 py-2 ${
              step > i + 1
                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                : step === i + 1
                  ? "border-teal-300 bg-teal-50 font-medium text-teal-900"
                  : "border-slate-200 bg-white text-slate-500"
            }`}
          >
            {i + 1}. {label}
          </li>
        ))}
      </ol>

      {error && <Notice kind="error">{error}</Notice>}

      {step === 1 && (
        <Card title="Step 1 · Your CCCD">
          <form onSubmit={prepare} className="space-y-3">
            {cccdInput}
            <Button type="submit" disabled={busy || cccd.length !== 12}>
              {busy ? "Registering…" : "Register"}
            </Button>
          </form>
        </Card>
      )}

      {step === 2 && (
        <Card title="Step 2 · Waiting for the hospital">
          <div className="space-y-3">
            <Notice kind="warning">
              Waiting for the hospital to co-sign your record keys. This page checks every 5 seconds.
            </Notice>
            <p className="text-sm text-slate-600">
              Your patient code is <span className="font-mono">{patient?.code}</span>. The hospital signs your keys in
              its Tide enclave; it can never read your records.
            </p>
            <Button variant="secondary" onClick={() => void refresh()}>
              Check now
            </Button>
          </div>
        </Card>
      )}

      {step === 3 && (
        <Card title="Step 3 · Encrypt your identity">
          <div className="space-y-3">
            <p className="text-sm text-slate-600">
              Your keys are active. Your CCCD is now encrypted in this browser under your Identity compartment.
            </p>
            {cccd.length !== 12 && (
              <Notice kind="info">Please re-enter your CCCD (it is never stored in this browser).</Notice>
            )}
            {cccdInput}
            <Button onClick={() => void complete()} disabled={busy || cccd.length !== 12}>
              {busy ? "Encrypting via Tide…" : "Encrypt & finish"}
            </Button>
          </div>
        </Card>
      )}

      {step === 4 && (
        <Card title="All set">
          <div className="space-y-3">
            <Notice kind="success">Your record is active and your CCCD is stored only as ciphertext.</Notice>
            <div className="flex flex-wrap gap-2">
              <Link href="/patient" className="rounded-md bg-teal-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-800">
                Go to my records
              </Link>
              <Link
                href="/patient/import"
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-50"
              >
                Add earlier records
              </Link>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
