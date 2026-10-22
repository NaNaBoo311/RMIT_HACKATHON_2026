"use client";
// Sign-in for local mode (NEXT_PUBLIC_TIDE_MODE=local): choose an account and the local TideCloak
// stand-in (tide-local) issues a signed access token with that account's realm roles. Live mode never
// shows this page: it signs in through TideCloak. One account per browser tab.
import { useEffect, useState } from "react";
import { Button, Card, Notice } from "@/components/ui";
import { TIDE_LOCAL } from "@/lib/tide/mode";
import { localCall, localLogin } from "@/lib/tide/localTide";

interface AccountRow {
  username: string;
  displayName: string;
  roles: string[];
}

const APP_ROLES: Record<string, string> = { benh_nhan: "Patient", bac_si: "Doctor", benh_vien: "Hospital account" };
const SPECIALTY: Record<string, string> = { khoa_mat: "Ophthalmology", khoa_noitiet: "Endocrinology", khoa_capcuu: "Emergency" };

function describe(roles: string[]) {
  const role = ["benh_vien", "bac_si", "benh_nhan"].find((r) => roles.includes(r));
  const specs = roles.filter((r) => SPECIALTY[r]).map((r) => SPECIALTY[r]);
  return [role ? APP_ROLES[role] : "No app role", ...specs].join(" · ");
}

export default function SimLoginPage() {
  const [users, setUsers] = useState<AccountRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    localCall<{ users: AccountRow[] }>("/users", undefined, null)
      .then((r) => setUsers(r.users))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  async function signIn(username: string) {
    setBusy(username);
    setError(null);
    try {
      await localLogin(username);
      const back = new URLSearchParams(window.location.search).get("return");
      window.location.assign(back && back.startsWith("/") && !back.startsWith("//") ? back : "/");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(null);
    }
  }

  if (!TIDE_LOCAL) return <Notice kind="info">Sign in with TideCloak from the top-right button.</Notice>;

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <Card title="Sign in to AIgree">
        <p className="mb-4 text-sm text-slate-600">
          Choose your account. Each browser tab keeps its own session.
        </p>
        {error && (
          <div className="mb-3">
            <Notice kind="error">{error}</Notice>
          </div>
        )}
        {!users && !error && <p className="text-sm text-slate-500">Loading accounts…</p>}
        <ul className="divide-y divide-slate-100">
          {users?.map((u) => (
            <li key={u.username} className="flex items-center justify-between gap-3 py-2">
              <div>
                <div className="font-medium text-slate-900">{u.displayName}</div>
                <div className="text-xs text-slate-500">{describe(u.roles)}</div>
              </div>
              <Button disabled={!!busy} onClick={() => void signIn(u.username)}>
                {busy === u.username ? "Signing in…" : "Sign in"}
              </Button>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
