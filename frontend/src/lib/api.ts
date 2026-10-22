import { getAuthHeaders } from "./auth";

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export type Label = "BENIGN" | "JAILBREAK" | "PROMPT_INJECTION";
export type Tier = "auto" | "single" | "quorum";
export type Status = "executed" | "pending" | "rejected";

export interface Vote {
  user: string;
  at: string;
  comment?: string | null;
}

export interface Action {
  id: string;
  created_at: string;
  created_by: string;
  source_text: string;
  action_type: string;
  payload: Record<string, unknown>;
  classification: { label: Label; probs: Record<Label, number>; model: string };
  risk_score: number;
  tier: Tier;
  required_approvals: number;
  approvals: Vote[];
  rejections: Vote[];
  status: Status;
}

export interface Health {
  status: string;
  core_ai: "up" | "down";
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** status 0 = backend unreachable */
async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...(await getAuthHeaders()), ...init.headers },
    });
  } catch {
    throw new ApiError(0, "Backend offline");
  }
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const j = await res.json();
      detail = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail ?? j);
    } catch {}
    throw new ApiError(res.status, detail);
  }
  return res.json() as Promise<T>;
}

export const api = {
  health: () => req<Health>("/api/health"),
  me: () => req<{ user: string; roles: string[] }>("/api/me"),
  list: () => req<Action[]>("/api/actions"),
  get: (id: string) => req<Action>(`/api/actions/${id}`),
  create: (b: { source_text: string; action_type: string; payload: Record<string, unknown> }) =>
    req<Action>("/api/actions", { method: "POST", body: JSON.stringify(b) }),
  approve: (id: string, comment?: string) =>
    req<Action>(`/api/actions/${id}/approve`, { method: "POST", body: JSON.stringify({ comment }) }),
  reject: (id: string, comment?: string) =>
    req<Action>(`/api/actions/${id}/reject`, { method: "POST", body: JSON.stringify({ comment }) }),
};
