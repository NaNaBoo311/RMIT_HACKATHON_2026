"use client";
// Home: sends each signed-in person to their own main page (doctors: My visits). Signed-out
// visitors go straight to sign-in.
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTideCloak } from "@/lib/tide/client";
import { useSession } from "@/lib/session";
import { Notice } from "@/components/ui";
import type { ProfileRole } from "@/lib/types";

const HOME: Record<ProfileRole, string> = {
  bac_si: "/doctor",
  benh_nhan: "/patient",
  benh_vien: "/hospital",
};

export default function Home() {
  const router = useRouter();
  const { login } = useTideCloak();
  const { ready, authenticated, profile, error } = useSession();

  useEffect(() => {
    if (!ready) return;
    if (!authenticated) void login();
    else if (profile) router.replace(HOME[profile.role]);
  }, [ready, authenticated, profile, login, router]);

  if (ready && authenticated && !profile && error) {
    return <Notice kind="error">Your account has no AIgree role yet. Ask an administrator to assign one.</Notice>;
  }
  return <p className="text-sm text-slate-500">Loading…</p>;
}
