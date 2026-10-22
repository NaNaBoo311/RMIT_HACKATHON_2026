"use client";
// Client-side API helper. Live mode: every call goes through IAMService.secureFetch, which swaps the
// Bearer token for a DPoP-bound Authorization header plus a fresh DPoP proof (the realm issues DPoP
// tokens, and the server's route() verifies both). Local mode: a plain Bearer call with the
// stand-in token (no DPoP in local mode).
import { IAMService } from "@tidecloak/js";
import { TIDE_LOCAL } from "./tide/mode";
import { localGetToken } from "./tide/localTide";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function api<T = unknown>(
  path: string,
  opts: { method?: string; body?: unknown } = {},
): Promise<T> {
  const token = TIDE_LOCAL ? localGetToken() : await IAMService.getToken();
  if (TIDE_LOCAL && !token) throw new ApiError(401, "Your session has expired. Please sign in again.");
  const url = new URL(path, window.location.origin).toString();
  const doFetch = TIDE_LOCAL ? fetch : IAMService.secureFetch.bind(IAMService);
  const res = await doFetch(url, {
    method: opts.method ?? (opts.body === undefined ? "GET" : "POST"),
    headers: {
      Authorization: `Bearer ${token}`,
      ...(opts.body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { error: text };
  }
  if (!res.ok) {
    const msg = (data as { error?: string } | null)?.error ?? `HTTP ${res.status}`;
    throw new ApiError(res.status, msg);
  }
  return data as T;
}
