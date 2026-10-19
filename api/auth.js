// ── Sign-in API (server-only) ───────────────────────────────────────────────
//
// POST /api/auth  { action, ... }
//   status        { email }                         → { exists, revoked?, hasPassword, hasSecurityQuestion, setupToken? }
//   login         { email, password }               → { success, stage, role?, hasSecurityQuestion?, session?, setupToken?, error? }
//   set-password  { email, password, setupToken }   → { success, session }
//   get-question  { email }                         → { question }
//   verify-answer { email, answer }                 → { success, setupToken }
//   set-question  { question, answer }   + Bearer   → { success }
//   change-password { currentPassword, newPassword } + Bearer → { success, session }
//   admin-reset   { targetEmail }        + Bearer   → { success }   (Admin+ / Manager)
//
// Everyone keeps their CURRENT password. On first sign-in here the password is
// checked against the old SHA-256 hash and moved into a Supabase Auth account
// (then the old hash is deleted). What's stored in Supabase Auth is a peppered
// HMAC of the password (AUTH_PASSWORD_PEPPER, server-only): short old passwords
// still meet Supabase's minimum length, and the stored hash is useless without
// the pepper. Because of that, ALL sign-ins go through this endpoint.
//
// Accounts are stamped app_metadata.hermes = true; the database only treats
// stamped accounts as staff, so self-made Supabase sign-ups get nothing.
//
// Env: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, AUTH_PASSWORD_PEPPER
import crypto from "node:crypto";

const MAIN_ADMIN = "wmt@ececontactcenters.com";
const SETUP_TOKEN_TTL_MS = 15 * 60 * 1000;
const MAX_FAILURES = 8; // per email, per 15 minutes

const env = () => {
  const e = {
    url: (process.env.SUPABASE_URL || "").replace(/\/$/, ""),
    anon: process.env.SUPABASE_ANON_KEY || "",
    service: process.env.SUPABASE_SERVICE_ROLE_KEY || "",
    pepper: process.env.AUTH_PASSWORD_PEPPER || "",
  };
  if (!e.url || !e.anon || !e.service || !e.pepper) throw httpError(503, "Sign-in isn't configured on the server (Supabase env vars / AUTH_PASSWORD_PEPPER).");
  return e;
};

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

const sha256 = (s) => crypto.createHash("sha256").update(s, "utf8").digest("hex");
const derivedPassword = (E, email, password) =>
  crypto.createHmac("sha256", E.pepper).update(`${email}\n${password}`).digest("base64url");
const cleanEmail = (e) => String(e || "").trim().toLowerCase();

// ── Supabase calls (service role) ──
async function sb(E, path, { method = "GET", body, key = E.service, token, prefer } = {}) {
  const res = await fetch(`${E.url}${path}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${token || key}`,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(prefer ? { Prefer: prefer } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { ok: res.ok, status: res.status, data };
}

async function getStaff(E, email) {
  const r = await sb(E, `/rest/v1/staff?email=eq.${encodeURIComponent(email)}&select=id,name,role,staff_credentials(password_hash,security_question,security_answer_hash,auth_user_id)`);
  const s = r.ok && Array.isArray(r.data) ? r.data[0] : null;
  if (!s) return null;
  const c = Array.isArray(s.staff_credentials) ? s.staff_credentials[0] : s.staff_credentials;
  return { ...s, creds: c || null };
}

async function authUserId(E, email, creds) {
  if (creds?.auth_user_id) return creds.auth_user_id;
  const r = await sb(E, "/rest/v1/rpc/auth_account_status", { method: "POST", body: { p_email: email } });
  return r.ok ? r.data?.authUserId || null : null;
}

async function saveCreds(E, staffId, patch) {
  await sb(E, "/rest/v1/staff_credentials?on_conflict=staff_id", {
    method: "POST",
    body: { staff_id: staffId, ...patch, updated_at: new Date().toISOString() },
    prefer: "resolution=merge-duplicates,return=minimal",
  });
}

async function log(E, action, userEmail, targetEmail, details) {
  await sb(E, "/rest/v1/security_logs", {
    method: "POST", body: { action, user_email: userEmail, target_email: targetEmail, details }, prefer: "return=minimal",
  });
}

async function tooManyFailures(E, email) {
  const since = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const r = await sb(E, `/rest/v1/security_logs?select=id&target_email=eq.${encodeURIComponent(email)}&action=in.(LOGIN_FAILED,SECURITY_ANSWER_FAILED)&created_at=gte.${encodeURIComponent(since)}`,
    { prefer: "count=exact" });
  return Array.isArray(r.data) && r.data.length >= MAX_FAILURES;
}

/** Create or update the staff member's Supabase Auth account with this password. */
async function upsertAuthUser(E, staff, email, password) {
  const existing = await authUserId(E, email, staff.creds);
  const payload = { password: derivedPassword(E, email, password), email_confirm: true, app_metadata: { hermes: true } };
  const r = existing
    ? await sb(E, `/auth/v1/admin/users/${existing}`, { method: "PUT", body: payload })
    : await sb(E, "/auth/v1/admin/users", { method: "POST", body: { email, ...payload } });
  if (!r.ok) throw httpError(500, `Couldn't save the account (${r.data?.msg || r.data?.message || r.status}).`);
  await saveCreds(E, staff.id, { password_hash: null, auth_user_id: r.data.id });
  return r.data.id;
}

async function removeAuthPassword(E, staff, email) {
  const id = await authUserId(E, email, staff.creds);
  if (id) await sb(E, `/auth/v1/admin/users/${id}`, { method: "DELETE" });
  await saveCreds(E, staff.id, { password_hash: null, auth_user_id: null });
}

async function signIn(E, email, password) {
  const r = await sb(E, "/auth/v1/token?grant_type=password", {
    method: "POST", key: E.anon, body: { email, password: derivedPassword(E, email, password) },
  });
  return r.ok ? { access_token: r.data.access_token, refresh_token: r.data.refresh_token } : null;
}

async function userFromBearer(E, req) {
  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) throw httpError(401, "Please sign in again.");
  const r = await sb(E, "/auth/v1/user", { key: E.anon, token });
  if (!r.ok || r.data?.app_metadata?.hermes !== true) throw httpError(401, "Please sign in again.");
  return cleanEmail(r.data.email);
}

// Short-lived signed token: "you may set a password for <email>".
function makeSetupToken(E, email) {
  const exp = Date.now() + SETUP_TOKEN_TTL_MS;
  const sig = crypto.createHmac("sha256", E.pepper).update(`setup|${email}|${exp}`).digest("base64url");
  return `${exp}.${sig}`;
}
function checkSetupToken(E, email, token) {
  const [exp, sig] = String(token || "").split(".");
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  const want = crypto.createHmac("sha256", E.pepper).update(`setup|${email}|${exp}`).digest("base64url");
  return want.length === sig.length && crypto.timingSafeEqual(Buffer.from(want), Buffer.from(sig));
}

const approved = (role) => role && role !== "Pending" && role !== "Revoked";

// ── Actions ──
const actions = {
  async status(E, { email }) {
    email = cleanEmail(email);
    const s = await getStaff(E, email);
    if (!s) return { exists: false, hasPassword: false, hasSecurityQuestion: false };
    if (s.role === "Revoked") return { exists: true, revoked: true, hasPassword: false, hasSecurityQuestion: false };
    const hasPassword = email === MAIN_ADMIN || !!s.creds?.password_hash || !!(await authUserId(E, email, s.creds));
    const out = { exists: true, hasPassword, hasSecurityQuestion: !!s.creds?.security_question };
    if (!hasPassword && approved(s.role)) out.setupToken = makeSetupToken(E, email);
    return out;
  },

  async login(E, { email, password }) {
    email = cleanEmail(email);
    password = String(password || "");
    if (!email || !password) return { success: false, error: "Enter your email and password." };
    if (await tooManyFailures(E, email)) return { success: false, error: "Too many attempts. Wait 15 minutes and try again." };

    const s = await getStaff(E, email);
    if (!s) {
      // Unchanged from before: the default password registers you as Pending.
      if (password === "admin" && email !== MAIN_ADMIN) {
        await sb(E, "/rest/v1/staff", { method: "POST", prefer: "return=minimal",
          body: { email, name: email.split("@")[0], role: "Pending", departments: ["Workforce"] } });
        await log(E, "ACCESS_REQUESTED", email, email, "Registered with the default password; awaiting approval.");
        return { success: true, stage: "denied" };
      }
      return { success: false, error: "You are not registered. Use the default password to register." };
    }
    if (s.role === "Pending") return { success: true, stage: "denied" };
    if (s.role === "Revoked") return { success: false, error: "Your access has been revoked by an administrator." };

    const ok = (session) => ({ success: true, stage: "authenticated", role: s.role, hasSecurityQuestion: !!s.creds?.security_question, session });

    // 1. Already moved to Supabase Auth?
    let session = await signIn(E, email, password);
    if (session) return ok(session);

    // 2. First sign-in since the move: check the old hash, then move it over.
    //    Only while no Supabase Auth account exists yet — once someone has
    //    one, a leftover old hash (e.g. restored by a re-sync) must never win.
    const hasAuth = !!(await authUserId(E, email, s.creds));
    if (!hasAuth && email !== MAIN_ADMIN && s.creds?.password_hash && sha256(password) === s.creds.password_hash) {
      await upsertAuthUser(E, s, email, password);
      await log(E, "PASSWORD_MIGRATED", email, email, "Password moved to Supabase Auth on first sign-in.");
      session = await signIn(E, email, password);
      if (session) return ok(session);
      return { success: false, error: "Signed in, but couldn't start a session. Please try again." };
    }

    // 3. No password set yet.
    if (!hasAuth && !s.creds?.password_hash) {
      if (email === MAIN_ADMIN) return { success: false, error: "The Main Admin password hasn't been set yet — run scripts/set-staff-password.mjs." };
      if (password === "admin") return { success: true, stage: "set-password", setupToken: makeSetupToken(E, email) };
    }
    await log(E, "LOGIN_FAILED", email, email, "Incorrect password.");
    return { success: false, error: "Incorrect password." };
  },

  async "set-password"(E, { email, password, setupToken }) {
    email = cleanEmail(email);
    if (email === MAIN_ADMIN) throw httpError(403, "The Main Admin password can only be set with scripts/set-staff-password.mjs.");
    if (!checkSetupToken(E, email, setupToken)) throw httpError(403, "This password link expired. Go back to sign in and try again.");
    if (String(password || "").length < 4) throw httpError(400, "Password must be at least 4 characters.");
    const s = await getStaff(E, email);
    if (!s || !approved(s.role)) throw httpError(403, "This account can't set a password.");
    await upsertAuthUser(E, s, email, password);
    await log(E, "PASSWORD_SET", email, email, "User set a new password.");
    return { success: true, session: await signIn(E, email, password) };
  },

  async "get-question"(E, { email }) {
    email = cleanEmail(email);
    const s = await getStaff(E, email);
    if (!s || s.role === "Revoked") throw httpError(404, "Account not found or revoked.");
    if (!s.creds?.security_question) throw httpError(404, "No security question is set for this account. Please ask assistance to an admin to reset password.");
    return { question: s.creds.security_question };
  },

  async "verify-answer"(E, { email, answer }) {
    email = cleanEmail(email);
    if (email === MAIN_ADMIN) throw httpError(403, "The Main Admin password can only be reset with scripts/set-staff-password.mjs.");
    if (await tooManyFailures(E, email)) throw httpError(429, "Too many attempts. Wait 15 minutes and try again.");
    const s = await getStaff(E, email);
    if (!s || s.role === "Revoked") throw httpError(404, "Account not found.");
    if (!s.creds?.security_answer_hash) throw httpError(404, "No security question is set for this account.");
    if (sha256(String(answer || "").trim().toLowerCase()) !== s.creds.security_answer_hash) {
      await log(E, "SECURITY_ANSWER_FAILED", email, email, "Incorrect answer to security question.");
      throw httpError(401, "Incorrect answer to the security question.");
    }
    await removeAuthPassword(E, s, email);
    await log(E, "PASSWORD_RESET_VIA_SECURITY_QUESTION", email, email, "Password cleared after answering security question correctly.");
    return { success: true, setupToken: makeSetupToken(E, email) };
  },

  async "set-question"(E, { question, answer }, req) {
    const email = await userFromBearer(E, req);
    if (!String(question || "").trim() || String(answer || "").trim().length < 2) throw httpError(400, "Pick a question and give an answer (2+ characters).");
    const s = await getStaff(E, email);
    if (!s) throw httpError(404, "Account not found.");
    await saveCreds(E, s.id, { security_question: String(question).trim(), security_answer_hash: sha256(String(answer).trim().toLowerCase()) });
    await log(E, "SECURITY_QUESTION_SET", email, email, `Security question updated to: "${String(question).trim()}"`);
    return { success: true };
  },

  // Change your OWN password (Settings → Account). Needs the session AND the
  // current password, so a left-open laptop can't be used to lock you out.
  async "change-password"(E, { currentPassword, newPassword }, req) {
    const email = await userFromBearer(E, req);
    if (email === MAIN_ADMIN) throw httpError(403, "Change the Main Admin password with scripts/set-staff-password.mjs.");
    if (String(newPassword || "").length < 6) throw httpError(400, "New password must be at least 6 characters.");
    if (await tooManyFailures(E, email)) throw httpError(429, "Too many attempts. Wait 15 minutes and try again.");
    if (!(await signIn(E, email, String(currentPassword || "")))) {
      await log(E, "LOGIN_FAILED", email, email, "Wrong current password on password change.");
      throw httpError(401, "Your current password is incorrect.");
    }
    if (newPassword === currentPassword) throw httpError(400, "Pick a password different from your current one.");
    const s = await getStaff(E, email);
    if (!s || !approved(s.role)) throw httpError(403, "This account can't change its password.");
    await upsertAuthUser(E, s, email, String(newPassword));
    await log(E, "PASSWORD_CHANGED", email, email, "User changed their password in Settings.");
    return { success: true, session: await signIn(E, email, String(newPassword)) };
  },

  async "admin-reset"(E, { targetEmail }, req) {
    const actor = await userFromBearer(E, req);
    const target = cleanEmail(targetEmail);
    const me = await getStaff(E, actor);
    if (!(actor === MAIN_ADMIN || ["Admin+", "Manager"].includes(me?.role))) throw httpError(403, "Only Admin+ and Managers can reset passwords.");
    if (target === actor) throw httpError(400, "Use Settings to change your own password.");
    if (target === MAIN_ADMIN) throw httpError(403, "The Main Admin password can only be reset with scripts/set-staff-password.mjs.");
    const s = await getStaff(E, target);
    if (!s) throw httpError(404, "Account not found.");
    await removeAuthPassword(E, s, target);
    await log(E, "PASSWORD_RESET_BY_ADMIN", actor, target, "Admin reset password for user.");
    return { success: true };
  },
};

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST." });
  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  const fn = actions[body?.action];
  if (!fn) return res.status(400).json({ error: "Unknown action." });
  try {
    const E = env();
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json(await fn(E, body, req));
  } catch (err) {
    if (!err.status) console.error("auth error:", err);
    return res.status(err.status || 500).json({ error: err.status ? err.message : "Something went wrong. Please try again." });
  }
}

// Exposed for scripts/set-staff-password.mjs (same derivation as sign-in).
export const _internal = { upsertAuthUser, getStaff, env, log };
