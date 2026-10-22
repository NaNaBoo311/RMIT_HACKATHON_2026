"use client";
// Signed-in session for pages: syncs the profile once after login (POST /api/profile/sync) and
// exposes it with the caller's role. UI checks here are convenience only; every API route
// re-verifies the token and roles on the server.
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useTideCloak } from "@/lib/tide/client";
import { api } from "./api";
import type { Profile } from "./types";

export interface SyncResponse {
  profile: Profile;
  /** Set when the caller is a registered patient. */
  patient: { code: string; status: "awaiting_activation" | "active"; hasCccd: boolean } | null;
}

interface SessionValue {
  ready: boolean;
  authenticated: boolean;
  profile: Profile | null;
  patient: SyncResponse["patient"];
  error: string | null;
  refresh: () => Promise<void>;
}

const SessionCtx = createContext<SessionValue>({
  ready: false,
  authenticated: false,
  profile: null,
  patient: null,
  error: null,
  refresh: async () => {},
});

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const { authenticated, isInitializing } = useTideCloak();
  const [data, setData] = useState<SyncResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [synced, setSynced] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setError(null);
      setData(await api<SyncResponse>("/api/profile/sync", { method: "POST", body: {} }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSynced(true);
    }
  }, []);

  useEffect(() => {
    if (authenticated) void refresh();
    else {
      setData(null);
      setSynced(false);
    }
  }, [authenticated, refresh]);

  const value: SessionValue = {
    ready: !isInitializing && (!authenticated || synced),
    authenticated,
    profile: data?.profile ?? null,
    patient: data?.patient ?? null,
    error,
    refresh,
  };
  return <SessionCtx.Provider value={value}>{children}</SessionCtx.Provider>;
}

export const useSession = () => useContext(SessionCtx);
