// ── Gemini AI assistant configuration ───────────────────────────────────────
//
// The API KEY is NEVER in the browser. The client calls our server proxy
// (/api/gemini), which reads the SERVER-only env var GEMINI_API_KEY (set it in
// Vercel, and in .env.local as GEMINI_API_KEY — NOT VITE_ — for `vercel dev`).
//
// Only non-secret config (model names, feature flags) lives here on the client.

// Model tier — primary + a backup used automatically if the primary is
// rate-limited / erroring. Override in env via VITE_GEMINI_MODEL / _FALLBACK
// (model names aren't secret, so VITE_ is fine for these).
const DEFAULT_MODEL = "gemini-flash-lite-latest";
const DEFAULT_FALLBACK = "gemini-flash-latest";

export const GEMINI_MODEL = (import.meta.env.VITE_GEMINI_MODEL || DEFAULT_MODEL).trim();
export const GEMINI_MODEL_FALLBACK = (import.meta.env.VITE_GEMINI_MODEL_FALLBACK || DEFAULT_FALLBACK).trim();

// Ordered, de-duplicated model chain the client tries in turn (dropping to the
// next on rate-limit/error). Provide ANY number via a comma-separated
// VITE_GEMINI_MODELS (highest priority); otherwise it's just the primary +
// backup pair above.
//   e.g. VITE_GEMINI_MODELS=gemini-3.1-flash-lite,gemini-3.5-flash,gemini-2.5-flash
export function getGeminiModels() {
  // Forgiving: accept a comma-separated list in EITHER VITE_GEMINI_MODEL or
  // VITE_GEMINI_MODELS, plus the backup and optional numbered vars. Every source
  // is split on commas, trimmed, de-duplicated, and tried in order.
  //   e.g. VITE_GEMINI_MODEL=gemini-3.1-flash-lite, gemini-3.5-flash, gemini-3-flash
  const sources = [
    import.meta.env.VITE_GEMINI_MODELS,
    import.meta.env.VITE_GEMINI_MODEL,
    import.meta.env.VITE_GEMINI_MODEL_FALLBACK,
    import.meta.env.VITE_GEMINI_MODEL_2,
    import.meta.env.VITE_GEMINI_MODEL_3,
    import.meta.env.VITE_GEMINI_MODEL_4,
  ];
  const chain = sources
    .flatMap((v) => String(v || "").split(","))
    .map((m) => m.trim())
    .filter(Boolean);
  return [...new Set(chain.length ? chain : [DEFAULT_MODEL, DEFAULT_FALLBACK])];
}

// Google Search grounding lets Caddy research the web — but it draws on a
// SEPARATE grounding quota that the free tier barely allows, so leaving it on
// causes 429s even when token/RPD usage is tiny. OFF by default; set
// VITE_GEMINI_WEB_SEARCH=true once you have billing/quota for grounding.
export const ENABLE_WEB_SEARCH = String(import.meta.env.VITE_GEMINI_WEB_SEARCH || "").toLowerCase() === "true";

// ── Enable / disable the whole Caddy assistant ──────────────────────────────
const ENABLED_STORAGE = "wf_caddy_enabled";

export function isCaddyEnabled() {
  try {
    return localStorage.getItem(ENABLED_STORAGE) !== "false"; // default ON
  } catch {
    return true;
  }
}

export function setCaddyEnabled(on) {
  try {
    localStorage.setItem(ENABLED_STORAGE, on ? "true" : "false");
  } catch {
    /* ignore */
  }
  // Let the app react live (App listens for this to show/hide the launcher).
  try { window.dispatchEvent(new Event("caddy-enabled-changed")); } catch { /* ssr */ }
}
