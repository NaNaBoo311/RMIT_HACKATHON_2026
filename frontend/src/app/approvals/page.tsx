"use client";
import { useCallback, useEffect, useState } from "react";
import { api, ApiError, type Action } from "@/lib/api";
import { useCurrentUser } from "@/lib/auth";
import { Card, Offline, ProbBars, StatusBadge, TierBadge } from "@/components/ui";

function blocked(a: Action, user: string): string | null {
  if (a.status !== "pending") return `Action already ${a.status}.`;
  if (a.created_by === user) return "You created this action - you cannot approve your own action.";
  if (a.approvals.some((v) => v.user === user)) return "You already approved this action. Waiting for other approvers.";
  if (a.rejections.some((v) => v.user === user)) return "You already rejected this action.";
  return null;
}

export default function Approvals() {
  const user = useCurrentUser();
  const [items, setItems] = useState<Action[] | null>(null);
  const [offline, setOffline] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(() => {
    api.list()
      .then((l) => { setItems(l); setOffline(false); })
      .catch((e: ApiError) => { if (e.status === 0) setOffline(true); else setMsg(e.message); });
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [load, user.name]);

  const act = async (a: Action, kind: "approve" | "reject") => {
    setMsg(null);
    try {
      await api[kind](a.id);
    } catch (e) {
      setMsg(e instanceof ApiError ? `${e.status === 0 ? "Backend offline" : e.status}: ${e.message}` : "Error");
    }
    load();
  };

  const shown = (items ?? []).filter((a) => showAll || a.status === "pending");

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Approval queue</h1>
          <p className="text-sm text-slate-500">Acting as <b>{user.name}</b> ({user.roles.join(", ")})</p>
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> show history
        </label>
      </div>
      {offline && <Offline />}
      {msg && <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{msg}</div>}
      {!offline && items && shown.length === 0 && <p className="text-sm text-slate-400">Nothing pending.</p>}
      {shown.map((a) => {
        const why = blocked(a, user.name);
        return (
          <Card key={a.id}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-bold">{a.action_type}</span>
              <span className="font-mono text-xs text-slate-500">{JSON.stringify(a.payload)}</span>
              <span className="ml-auto flex gap-2"><TierBadge a={a} /><StatusBadge status={a.status} /></span>
            </div>
            <p className="mt-1 text-xs text-slate-500">by {a.created_by} - {new Date(a.created_at).toLocaleTimeString()} - {a.classification.label}</p>
            <pre className="mt-3 max-h-28 overflow-auto whitespace-pre-wrap rounded-md bg-slate-100 p-3 text-xs">{a.source_text}</pre>
            <div className="mt-3 grid gap-4 md:grid-cols-2">
              <ProbBars probs={a.classification.probs} />
              <div className="text-sm">
                {a.required_approvals > 0 && (
                  <>
                    <div className="mb-1 font-semibold">Approvals {a.approvals.length} / {a.required_approvals}</div>
                    <div className="mb-2 h-2 overflow-hidden rounded bg-slate-100">
                      <div className="h-full bg-emerald-500" style={{ width: `${Math.min(100, (a.approvals.length / a.required_approvals) * 100)}%` }} />
                    </div>
                  </>
                )}
                {a.approvals.map((v) => <div key={v.user} className="text-emerald-700">approved by {v.user}</div>)}
                {a.rejections.map((v) => <div key={v.user} className="text-red-700">rejected by {v.user}</div>)}
              </div>
            </div>
            <div className="mt-4 flex items-center gap-3">
              <button disabled={!!why} onClick={() => act(a, "approve")}
                className="rounded-md bg-emerald-600 px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-40">Approve</button>
              <button disabled={!!why} onClick={() => act(a, "reject")}
                className="rounded-md bg-red-600 px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-40">Reject</button>
              {why && <span className="text-sm text-slate-500">{why}</span>}
            </div>
          </Card>
        );
      })}
    </div>
  );
}
