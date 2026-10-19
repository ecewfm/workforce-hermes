// Server-side proxy for the Gemini API so the key NEVER reaches the browser.
// The client (src/utils/geminiClient.js) POSTs { model, body, stream? }; this
// function adds the key (a SERVER-only env var) and forwards to Gemini.
//   • stream: false (default) → generateContent, JSON passed straight through
//   • stream: true            → streamGenerateContent (SSE), piped through as it
//                               arrives so the planner can show thinking live
//
// Set the key in Vercel (and .env.local for `vercel dev`) as GEMINI_API_KEY —
// do NOT use the VITE_ prefix, or it would be exposed in the client bundle.
//
// Only signed-in Hermes staff may use it: the client sends its Supabase access
// token as `Authorization: Bearer …`, checked the same way /api/auth does
// (a real Supabase user stamped app_metadata.hermes, with an approved staff
// row). Each user gets RATE_MAX calls per RATE_WINDOW_MS, counted in
// security_logs (action AI_REQUEST) so the limit holds across instances.
//
// Env: GEMINI_API_KEY, SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY

// Only real Gemini model ids — keeps the proxy from being pointed at anything else.
const MODEL_RE = /^gemini-[a-z0-9][a-z0-9.\-]*$/i;

// One Caddy message can take several model calls (tool rounds, fallbacks), so
// the cap is generous for real use and still stops anyone draining the quota.
const RATE_MAX = 150;
const RATE_WINDOW_MS = 10 * 60 * 1000;

const cleanEmail = (e) => String(e || "").trim().toLowerCase();
const approved = (role) => role && role !== "Pending" && role !== "Revoked";

function supabaseEnv() {
  const e = {
    url: (process.env.SUPABASE_URL || "").replace(/\/$/, ""),
    anon: process.env.SUPABASE_ANON_KEY || "",
    service: process.env.SUPABASE_SERVICE_ROLE_KEY || "",
  };
  return e.url && e.anon && e.service ? e : null;
}

// Supabase REST/Auth call (service role unless `key`/`token` say otherwise).
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

/**
 * Who is calling, and how many AI calls they've made in the current window.
 * Returns null unless the bearer token belongs to an approved Hermes user.
 */
async function caller(E, req) {
  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  const u = await sb(E, "/auth/v1/user", { key: E.anon, token });
  if (!u.ok || u.data?.app_metadata?.hermes !== true) return null;
  const email = cleanEmail(u.data.email);
  if (!email) return null;
  const since = new Date(Date.now() - RATE_WINDOW_MS).toISOString();
  const [staff, recent] = await Promise.all([
    sb(E, `/rest/v1/staff?email=eq.${encodeURIComponent(email)}&select=role`),
    sb(E, `/rest/v1/security_logs?select=id&user_email=eq.${encodeURIComponent(email)}&action=eq.AI_REQUEST&created_at=gte.${encodeURIComponent(since)}&limit=${RATE_MAX}`),
  ]);
  const role = staff.ok && Array.isArray(staff.data) ? staff.data[0]?.role : null;
  if (!approved(role)) return null;
  // If the count query fails, don't lock everyone out of Caddy.
  return { email, used: recent.ok && Array.isArray(recent.data) ? recent.data.length : 0 };
}

export default async function handler(req, res) {
  const key = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY || "";

  // Health check: a plain GET confirms this function is actually DEPLOYED and
  // whether the server key is configured. Never returns the key itself. This
  // is how we verify a Vercel deploy picked up the function (GET -> 200 JSON;
  // a missing function returns Vercel's HTML 404 instead).
  if (req.method === "GET") {
    res.status(200).json({ ok: true, service: "gemini-proxy", keyConfigured: !!key, streaming: true });
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed. Use POST." });
    return;
  }

  if (!key) {
    res.status(500).json({ error: "Gemini API key is not configured on the server (set GEMINI_API_KEY in Vercel)." });
    return;
  }

  const E = supabaseEnv();
  if (!E) {
    res.status(503).json({ error: "Caddy isn't configured on the server (Supabase env vars)." });
    return;
  }
  let who;
  try {
    who = await caller(E, req);
  } catch {
    res.status(502).json({ error: "Couldn't check your sign-in. Please try again." });
    return;
  }
  if (!who) {
    res.status(401).json({ error: "Sign in to use Caddy." });
    return;
  }

  let payload = req.body;
  if (typeof payload === "string") {
    try { payload = JSON.parse(payload); } catch { payload = null; }
  }
  const model = payload?.model;
  const body = payload?.body;
  const stream = payload?.stream === true;
  if (!model || !body) {
    res.status(400).json({ error: "Request must include { model, body }." });
    return;
  }
  if (!MODEL_RE.test(model)) {
    res.status(400).json({ error: "Unknown model id." });
    return;
  }

  // Per-user rate limit. Refused calls aren't logged, so waiting it out works.
  if (who.used >= RATE_MAX) {
    res.setHeader("Retry-After", String(Math.ceil(RATE_WINDOW_MS / 1000)));
    res.status(429).json({ error: "Caddy is getting a lot of requests — try again in a few minutes." });
    return;
  }
  await sb(E, "/rest/v1/security_logs", {
    method: "POST",
    body: { action: "AI_REQUEST", user_email: who.email, target_email: who.email, details: `${model}${stream ? " (stream)" : ""}` },
    prefer: "return=minimal",
  }).catch(() => {});

  // Stop paying for tokens nobody will read if the browser goes away.
  const upstreamAbort = new AbortController();
  res.on("close", () => { if (!res.writableEnded) upstreamAbort.abort(); });

  const method = stream ? "streamGenerateContent?alt=sse&" : "generateContent?";
  try {
    const upstream = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:${method}key=${encodeURIComponent(key)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: upstreamAbort.signal,
      }
    );

    if (stream && upstream.ok && upstream.body) {
      res.status(200);
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders?.();
      for await (const chunk of upstream.body) res.write(chunk);
      res.end();
      return;
    }

    // Pass Gemini's status + JSON straight through so the client keeps its
    // model-fallback + error handling.
    const text = await upstream.text();
    res.status(upstream.status);
    res.setHeader("Content-Type", "application/json");
    res.send(text);
  } catch (err) {
    if (upstreamAbort.signal.aborted) return; // client left — nothing to send
    if (res.headersSent) { res.end(); return; }
    res.status(502).json({ error: "Failed to reach Gemini upstream." });
  }
}
