// SERVER ONLY. Never import this from a client component: it holds the Supabase service-role key.
// The browser never talks to Supabase; RLS is on with no policies, so the anon key reads nothing.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let _db: SupabaseClient | null = null;

export function db(): SupabaseClient {
  if (typeof window !== "undefined") throw new Error("db() is server-only");
  if (!_db) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local");
    }
    _db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  }
  return _db;
}

/** Throw on a Supabase error, return data otherwise. */
export function must<T>(res: { data: T; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data;
}
