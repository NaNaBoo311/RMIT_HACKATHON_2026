"use client";
import Link from "next/link";
import { useTideCloak } from "@/lib/tide/client";
import { useSession } from "@/lib/session";
import { Badge, Button, Notice } from "./ui";
import type { ProfileRole } from "@/lib/types";

const ROLE_LABEL: Record<ProfileRole, string> = {
  benh_nhan: "Patient",
  bac_si: "Doctor",
  benh_vien: "Hospital account",
};

const NAV: Record<ProfileRole, { href: string; label: string }[]> = {
  benh_nhan: [{ href: "/patient", label: "My records" }],
  bac_si: [{ href: "/doctor", label: "My visits" }],
  benh_vien: [{ href: "/hospital", label: "Hospital" }],
};

export function AppShell({ children }: { children: React.ReactNode }) {
  const { login, logout } = useTideCloak();
  const { authenticated, profile, error } = useSession();

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <Link href="/" className="flex items-center gap-2 font-semibold text-teal-800">
            <span aria-hidden className="text-lg">⛨</span> AIgree
          </Link>
          <nav className="flex flex-wrap gap-4 text-sm text-slate-600">
            {profile && NAV[profile.role].map((n) => (
              <Link key={n.href} href={n.href} className="hover:text-teal-700">
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm">
            {profile && (
              <>
                <span className="text-slate-700">{profile.display_name}</span>
                <Badge color="blue">{ROLE_LABEL[profile.role]}</Badge>
              </>
            )}
            {authenticated ? (
              <Button variant="secondary" onClick={() => logout()}>
                Log out
              </Button>
            ) : (
              <Button onClick={() => login()}>Login with TideCloak</Button>
            )}
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">
        {error && (
          <div className="mb-4">
            <Notice kind="error">Session problem: {error}</Notice>
          </div>
        )}
        {children}
      </main>
    </div>
  );
}

/** Client-side gate for a page. Convenience only: the API enforces roles on the server. */
export function RoleGate({ role, children }: { role: ProfileRole | ProfileRole[]; children: React.ReactNode }) {
  const { login } = useTideCloak();
  const { ready, authenticated, profile } = useSession();
  const roles = Array.isArray(role) ? role : [role];

  if (!ready) return <p className="text-sm text-slate-500">Loading…</p>;
  if (!authenticated)
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <p className="mb-4 text-slate-600">Please sign in to continue.</p>
        <Button onClick={() => login()}>Login with TideCloak</Button>
      </div>
    );
  if (!profile || !roles.includes(profile.role))
    return <Notice kind="warning">This page is for {roles.map((r) => ROLE_LABEL[r]).join(" / ")} accounts.</Notice>;
  return <>{children}</>;
}
