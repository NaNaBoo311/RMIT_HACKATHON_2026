import type { Action, Label } from "@/lib/api";

const LABEL_STYLE: Record<Label, string> = {
  BENIGN: "bg-emerald-500",
  JAILBREAK: "bg-orange-500",
  PROMPT_INJECTION: "bg-red-500",
};

export function ProbBars({ probs }: { probs: Record<Label, number> }) {
  return (
    <div className="space-y-1.5">
      {(Object.keys(LABEL_STYLE) as Label[]).map((l) => {
        const p = probs?.[l] ?? 0;
        return (
          <div key={l} className="flex items-center gap-2 text-xs">
            <span className="w-32 font-mono text-slate-600">{l}</span>
            <div className="h-2.5 flex-1 overflow-hidden rounded bg-slate-100">
              <div className={`h-full ${LABEL_STYLE[l]}`} style={{ width: `${(p * 100).toFixed(1)}%` }} />
            </div>
            <span className="w-12 text-right tabular-nums">{(p * 100).toFixed(1)}%</span>
          </div>
        );
      })}
    </div>
  );
}

const TIER_TEXT = {
  auto: ["Auto-execute", "bg-emerald-100 text-emerald-800"],
  single: ["1 approver", "bg-amber-100 text-amber-800"],
  quorum: ["Quorum", "bg-red-100 text-red-800"],
} as const;

export function TierBadge({ a }: { a: Action }) {
  const [t, c] = TIER_TEXT[a.tier];
  const extra = a.tier === "auto" ? "" : ` (${a.required_approvals} approvals)`;
  return <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${c}`}>{t}{extra}</span>;
}

const STATUS = {
  executed: "bg-emerald-600 text-white",
  pending: "bg-amber-500 text-white",
  rejected: "bg-slate-700 text-white",
} as const;

export function StatusBadge({ status }: { status: Action["status"] }) {
  return <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase ${STATUS[status]}`}>{status}</span>;
}

export function Offline({ message }: { message?: string }) {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
      <p className="font-semibold">Backend offline</p>
      <p>{message ?? "Cannot reach the API."} Start it with the backend service (port 8000) and this page will recover automatically.</p>
    </div>
  );
}

export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-slate-200 bg-white p-5 shadow-sm ${className}`}>{children}</div>;
}
