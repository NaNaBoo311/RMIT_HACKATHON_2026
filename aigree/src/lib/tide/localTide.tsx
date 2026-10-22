"use client";
// Local TideCloak stand-in for the browser (NEXT_PUBLIC_TIDE_MODE=local). Talks to tide-local/server.mjs,
// which stands in for TideCloak sign-in and for the Tide network's RelationshipAttestation:1 checks.
// Same shape as the parts of useTideCloak() the app uses, so pages don't know which one they got.
// The token lives in sessionStorage: one account per browser tab.
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { TIDE_LOCAL_URL } from "./mode";

const TOKEN_KEY = "aigree.session";
const VENDOR_ID = "aigree-local";

interface SimClaims {
  exp: number;
  realm_access?: { roles?: string[] };
}

function decodeClaims(token: string): SimClaims | null {
  try {
    const part = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(decodeURIComponent(escape(atob(part)))) as SimClaims;
  } catch {
    return null;
  }
}

/** The current stand-in access token, or null when signed out or expired. */
export function localGetToken(): string | null {
  if (typeof window === "undefined") return null;
  let token: string | null = null;
  try {
    token = sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
  const claims = token ? decodeClaims(token) : null;
  if (!token || !claims || claims.exp * 1000 <= Date.now()) return null;
  return token;
}

/** Call the local Tide stand-in. Refusals come back as Error(<contract message>). */
export async function localCall<T>(path: string, body?: unknown, token: string | null = localGetToken()): Promise<T> {
  const res = await fetch(`${TIDE_LOCAL_URL}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).catch(() => {
    throw new Error(`Sign-in service unreachable at ${TIDE_LOCAL_URL} (run: npm run tide:local)`);
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(data.error || `Sign-in service: HTTP ${res.status}`);
  return data as T;
}

export async function localLogin(username: string): Promise<void> {
  const { access_token } = await localCall<{ access_token: string }>("/login", { username }, null);
  sessionStorage.setItem(TOKEN_KEY, access_token);
  window.dispatchEvent(new Event("aigree-auth"));
}

export function localLogout(): void {
  try {
    sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event("aigree-auth"));
}

/**
 * The local Tide enclave dialog: an in-page dialog the hospital must approve. (Live mode opens
 * Tide's real enclave window instead.) Resolves true on Approve, false on Deny.
 */
export function localEnclaveConfirm(title: string, lines: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.setAttribute("role", "dialog");
    overlay.style.cssText =
      "position:fixed;inset:0;z-index:9999;background:rgba(15,23,42,.55);display:flex;align-items:center;justify-content:center;padding:16px";
    const box = document.createElement("div");
    box.style.cssText =
      "background:#fff;max-width:520px;width:100%;border-radius:12px;padding:20px;box-shadow:0 20px 50px rgba(0,0,0,.3);font:14px system-ui,sans-serif;color:#0f172a";
    const h = document.createElement("div");
    h.textContent = "Tide enclave";
    h.style.cssText = "font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:#0f766e;font-weight:700";
    const t = document.createElement("div");
    t.textContent = title;
    t.style.cssText = "margin:6px 0 10px;font-size:16px;font-weight:600";
    const ul = document.createElement("ul");
    ul.style.cssText = "margin:0 0 16px;padding-left:18px;max-height:240px;overflow:auto;color:#334155";
    for (const line of lines) {
      const li = document.createElement("li");
      li.textContent = line;
      ul.appendChild(li);
    }
    const row = document.createElement("div");
    row.style.cssText = "display:flex;gap:8px;justify-content:flex-end";
    const mk = (label: string, primary: boolean, value: boolean) => {
      const b = document.createElement("button");
      b.textContent = label;
      b.style.cssText = `padding:8px 14px;border-radius:8px;font-weight:600;cursor:pointer;border:1px solid ${primary ? "#0f766e" : "#cbd5e1"};background:${primary ? "#0f766e" : "#fff"};color:${primary ? "#fff" : "#0f172a"}`;
      b.onclick = () => {
        overlay.remove();
        resolve(value);
      };
      return b;
    };
    row.append(mk("Deny", false, false), mk("Approve", true, true));
    box.append(h, t, ul, row);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
  });
}

// --- provider + hook (subset of useTideCloak) -----------------------------------------------

export interface TideHook {
  authenticated: boolean;
  isInitializing: boolean;
  login: () => void | Promise<void>;
  logout: () => void | Promise<void>;
  getVendorId: () => string;
  getConfig: () => Record<string, unknown>;
  forceRefreshToken: () => Promise<boolean>;
  hasRealmRole: (role: string) => boolean;
}

const SimCtx = createContext<TideHook | null>(null);

export function LocalTideProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const sync = () => setToken(localGetToken());
    sync();
    setReady(true);
    window.addEventListener("aigree-auth", sync);
    const t = setInterval(sync, 30_000); // notice expiry
    return () => {
      window.removeEventListener("aigree-auth", sync);
      clearInterval(t);
    };
  }, []);

  const login = useCallback(() => {
    const back = window.location.pathname === "/login" ? "/" : window.location.pathname;
    window.location.assign(`/login?return=${encodeURIComponent(back)}`);
  }, []);
  const logout = useCallback(() => {
    localLogout();
    window.location.assign("/");
  }, []);

  const value: TideHook = {
    authenticated: !!token,
    isInitializing: !ready,
    login,
    logout,
    getVendorId: () => VENDOR_ID,
    getConfig: () => ({ vendorId: VENDOR_ID, local: true }),
    forceRefreshToken: async () => true,
    hasRealmRole: (role) => !!token && (decodeClaims(token)?.realm_access?.roles ?? []).includes(role),
  };
  return <SimCtx.Provider value={value}>{children}</SimCtx.Provider>;
}

export function useLocalTide(): TideHook {
  const v = useContext(SimCtx);
  if (!v) throw new Error("useLocalTide outside LocalTideProvider");
  return v;
}
