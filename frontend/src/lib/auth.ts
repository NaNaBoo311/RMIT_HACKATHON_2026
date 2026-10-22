// Auth is isolated in this file. Everything else calls getAuthHeaders() / useCurrentUser().
import { useSyncExternalStore } from "react";

export const AUTH_MODE = (process.env.NEXT_PUBLIC_AUTH_MODE ?? "dev") as "dev" | "tide";

export type DevUser = { name: string; roles: string[]; label: string };

export const DEV_USERS: DevUser[] = [
  { name: "alice", roles: ["agent-operator", "approver"], label: "Alice (operator + approver)" },
  { name: "bob", roles: ["approver"], label: "Bob (approver)" },
  { name: "carol", roles: ["approver"], label: "Carol (approver)" },
];

const KEY = "qg_dev_user";
const EVT = "qg-user-change";

function readName(): string {
  try {
    return localStorage.getItem(KEY) ?? DEV_USERS[0].name;
  } catch {
    return DEV_USERS[0].name;
  }
}

export function setDevUser(name: string) {
  try {
    localStorage.setItem(KEY, name);
  } catch {}
  window.dispatchEvent(new Event(EVT));
}

export function getDevUser(): DevUser {
  return DEV_USERS.find((u) => u.name === readName()) ?? DEV_USERS[0];
}

function subscribe(cb: () => void) {
  window.addEventListener(EVT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(EVT, cb);
    window.removeEventListener("storage", cb);
  };
}

/** Name of the active dev user (server snapshot = first user to avoid hydration mismatch). */
export function useCurrentUser(): DevUser {
  const name = useSyncExternalStore(subscribe, readName, () => DEV_USERS[0].name);
  return DEV_USERS.find((u) => u.name === name) ?? DEV_USERS[0];
}

export async function getAuthHeaders(): Promise<Record<string, string>> {
  if (AUTH_MODE === "tide") {
    // TIDE: TODO - log in with the TideCloak SDK (see TideCloak Next.js quickstart / Tide MCP)
    // and return { Authorization: `Bearer ${token}` } using the access token.
    // The backend verifies this token; never trust roles sent from the browser in this mode.
    return {};
  }
  const u = getDevUser();
  return { "X-Dev-User": u.name, "X-Dev-Roles": u.roles.join(",") };
}
