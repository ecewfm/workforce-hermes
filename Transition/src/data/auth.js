// Sign-in flows. These run on the SERVER (/api/auth) because they touch
// password hashes and Supabase Auth accounts. The result shapes match the old
// Convex staff.* functions so Login / SetPassword / App didn't need rewriting.
//
// Passwords: everyone keeps their current one. The first time someone signs in
// here, /api/auth checks it against their old hash and moves it into a real
// Supabase Auth account (then the old hash is deleted).
import { supabase } from "./supabase";
import { invalidateAll, resetRealtime } from "./store";

// Short-lived server-signed token that authorizes setting a password (issued
// when an account has none yet, or after a correct security answer).
let setupToken = null;

async function call(action, body = {}, withSession = false) {
  const headers = { "Content-Type": "application/json" };
  if (withSession) {
    const { data } = await supabase.auth.getSession();
    if (data.session) headers.Authorization = `Bearer ${data.session.access_token}`;
  }
  let res;
  try {
    res = await fetch("/api/auth", { method: "POST", headers, body: JSON.stringify({ action, ...body }) });
  } catch {
    throw new Error("Couldn't reach the server. Check your connection and try again.");
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status}).`);
  return json;
}

async function adoptSession(session) {
  if (!session) return;
  const { error } = await supabase.auth.setSession(session);
  if (error) throw new Error(error.message);
  resetRealtime();
  invalidateAll();
}

export const authApi = {
  async checkEmailStatus({ email }) {
    const r = await call("status", { email });
    setupToken = r.setupToken || null;
    return r;
  },
  async login({ email, password }) {
    const r = await call("login", { email, password });
    if (r.setupToken) setupToken = r.setupToken;
    await adoptSession(r.session);
    return r;
  },
  async setPassword({ email, password }) {
    const r = await call("set-password", { email, password, setupToken });
    setupToken = null;
    await adoptSession(r.session);
    return r;
  },
  getSecurityQuestion: ({ email }) => call("get-question", { email }),
  async verifySecurityAnswer({ email, answer }) {
    const r = await call("verify-answer", { email, answer });
    setupToken = r.setupToken || null;
    return r;
  },
  setSecurityQuestion: ({ question, answer }) => call("set-question", { question, answer }, true),
  async changePassword({ currentPassword, newPassword }) {
    const r = await call("change-password", { currentPassword, newPassword }, true);
    await adoptSession(r.session);
    return r;
  },
  resetPassword: ({ targetEmail }) => call("admin-reset", { targetEmail }, true),
};

export async function signOut() {
  setupToken = null;
  try { await supabase.auth.signOut(); } catch { /* already signed out */ }
  resetRealtime();
  invalidateAll();
}
