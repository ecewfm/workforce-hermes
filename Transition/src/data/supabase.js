// The one Supabase client the whole app shares.
//
// Only the PUBLIC (anon) key ships to the browser — it can do nothing on its
// own: every table is behind row-level security and every function checks
// the signed-in user. The session (from /api/auth) lives in localStorage
// under SESSION_KEY and refreshes itself.
import { createClient } from "@supabase/supabase-js";

export const SESSION_KEY = "wf_sb_session";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
if (!url || !anonKey) {
  console.error("Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY — the app can't reach its database.");
}

export const supabase = createClient(url, anonKey, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: SESSION_KEY, detectSessionInUrl: false },
});

/** True when a saved session exists (synchronous — used on first paint). */
export function hasStoredSession() {
  try {
    return !!localStorage.getItem(SESSION_KEY);
  } catch {
    return false;
  }
}
