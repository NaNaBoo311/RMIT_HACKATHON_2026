"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { AUTH_MODE, DEV_USERS, setDevUser, useCurrentUser } from "@/lib/auth";

export default function Header() {
  const path = usePathname();
  const user = useCurrentUser();
  const [health, setHealth] = useState<"loading" | "offline" | "ok" | "ai-down">("loading");

  useEffect(() => {
    const check = () =>
      api
        .health()
        .then((h) => setHealth(h.core_ai === "up" ? "ok" : "ai-down"))
        .catch(() => setHealth("offline"));
    check();
    const t = setInterval(check, 5000);
    return () => clearInterval(t);
  }, []);

  const tab = (href: string, label: string) => (
    <Link
      href={href}
      className={`rounded-md px-3 py-1.5 text-sm font-medium ${
        path === href ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-200"
      }`}
    >
      {label}
    </Link>
  );
  const dot = { loading: "bg-slate-300", ok: "bg-emerald-500", "ai-down": "bg-amber-500", offline: "bg-red-500" }[health];
  const text = { loading: "...", ok: "backend + AI up", "ai-down": "backend up, AI down", offline: "backend offline" }[health];

  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-4 px-4 py-3">
        <span className="text-lg font-bold tracking-tight">QuorumGate <span className="text-slate-400">for Agents</span></span>
        <nav className="flex gap-1">{tab("/", "Agent console")}{tab("/approvals", "Approvals")}</nav>
        <div className="ml-auto flex items-center gap-4 text-sm">
          <span className="flex items-center gap-1.5 text-slate-500"><span className={`h-2 w-2 rounded-full ${dot}`} />{text}</span>
          {AUTH_MODE === "dev" ? (
            <label className="flex items-center gap-2 text-slate-600">
              Dev user
              <select
                value={user.name}
                onChange={(e) => setDevUser(e.target.value)}
                className="rounded-md border border-slate-300 bg-white px-2 py-1"
              >
                {DEV_USERS.map((u) => (
                  <option key={u.name} value={u.name}>{u.label}</option>
                ))}
              </select>
            </label>
          ) : (
            <span className="text-slate-500">TideCloak login (TODO)</span>
          )}
        </div>
      </div>
    </header>
  );
}
