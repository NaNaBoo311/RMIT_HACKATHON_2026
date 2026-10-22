"use client";
// Small UI kit (Tailwind). Shared by every page so the app looks like one product.
import type { ButtonHTMLAttributes, ReactNode } from "react";

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" | "ghost" }) {
  const styles = {
    primary: "bg-teal-700 text-white hover:bg-teal-800",
    secondary: "bg-white text-slate-800 border border-slate-300 hover:bg-slate-50",
    danger: "bg-rose-600 text-white hover:bg-rose-700",
    ghost: "text-slate-600 hover:bg-slate-100",
  }[variant];
  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${styles} ${className}`}
    />
  );
}

export function Card({ title, actions, children, className = "" }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-lg border border-slate-200 bg-white p-4 shadow-sm ${className}`}>
      {(title || actions) && (
        <div className="mb-3 flex items-center justify-between gap-2">
          {title && <h2 className="text-base font-semibold text-slate-900">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

const BADGE: Record<string, string> = {
  green: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  amber: "bg-amber-50 text-amber-800 ring-amber-600/20",
  red: "bg-rose-50 text-rose-700 ring-rose-600/20",
  slate: "bg-slate-50 text-slate-700 ring-slate-500/20",
  blue: "bg-sky-50 text-sky-700 ring-sky-600/20",
};

export function Badge({ color = "slate", children }: { color?: keyof typeof BADGE; children: ReactNode }) {
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${BADGE[color]}`}>{children}</span>;
}

const STATUS_COLOR: Record<string, keyof typeof BADGE> = {
  active: "green",
  approved: "green",
  completed: "slate",
  pending: "amber",
  pending_consent: "amber",
  awaiting_cosign: "blue",
  awaiting_activation: "amber",
  pending_signature: "blue",
  declined: "red",
  revoked: "red",
  expired: "slate",
};

export function StatusBadge({ status }: { status: string }) {
  return <Badge color={STATUS_COLOR[status] ?? "slate"}>{status.replace(/_/g, " ")}</Badge>;
}

/** Shown when the Tide network refuses to decrypt an item. */
export function LockedCard({
  title,
  reason,
  message = "Locked – Tide network refused to decrypt",
}: {
  title: ReactNode;
  reason?: string;
  message?: string;
}) {
  return (
    <div className="rounded-md border border-dashed border-rose-300 bg-rose-50/60 p-3">
      <div className="flex items-center gap-2 text-sm font-semibold text-rose-800">
        <span aria-hidden>🔒</span> {title}
      </div>
      <p className="mt-1 text-sm text-rose-700">{message}</p>
      {reason && <p className="mt-1 break-all font-mono text-[11px] text-rose-500">{reason}</p>}
    </div>
  );
}

/** Diagonal watermark over decrypted content: who is viewing, and when. */
export function Watermark({ text, children }: { text: string; children: ReactNode }) {
  return (
    <div className="relative overflow-hidden">
      {children}
      <div className="pointer-events-none absolute inset-0 flex select-none flex-wrap content-start gap-x-16 gap-y-10 overflow-hidden p-4 opacity-[0.07]">
        {Array.from({ length: 24 }).map((_, i) => (
          <span key={i} className="-rotate-12 whitespace-nowrap text-sm font-bold text-slate-900">
            {text}
          </span>
        ))}
      </div>
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-slate-700">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

export const inputClass =
  "w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 shadow-sm focus:border-teal-600 focus:outline-none focus:ring-1 focus:ring-teal-600";

export function Notice({ kind = "info", children }: { kind?: "info" | "error" | "success" | "warning"; children: ReactNode }) {
  const styles = {
    info: "border-sky-200 bg-sky-50 text-sky-800",
    error: "border-rose-200 bg-rose-50 text-rose-800",
    success: "border-emerald-200 bg-emerald-50 text-emerald-800",
    warning: "border-amber-200 bg-amber-50 text-amber-900",
  }[kind];
  return <div className={`rounded-md border px-3 py-2 text-sm ${styles}`}>{children}</div>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="text-sm text-slate-500">{children}</p>;
}

export const fmtTime = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" }) : "–";
