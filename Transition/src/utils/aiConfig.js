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

// Stronger model used for action / "do a task" requests (creating or editing
// projects, features, bugs, notes…) which benefit from better descriptions and
// multi-step tool use. Plain questions stay on the lighter, higher-quota model
// (the free tier gives lite far more headroom). Override via env; it's tried
// FIRST for task requests, then falls back through the normal chain.
export const TASK_MODEL = (import.meta.env.VITE_GEMINI_TASK_MODEL || "gemini-3-flash-preview").trim();

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

// Models for the New Task planner, tried in order before the normal chain.
// Planning is infrequent and quality matters more than speed, so it leads with
// stronger models (each still falls back on rate-limit/error). Override with a
// comma-separated VITE_GEMINI_PLANNER_MODELS.
const DEFAULT_PLANNER_MODELS = ["gemini-3.5-flash", "gemini-3-flash-preview"];
export function getPlannerModels() {
  const custom = String(import.meta.env.VITE_GEMINI_PLANNER_MODELS || "")
    .split(",").map((m) => m.trim()).filter(Boolean);
  return [...new Set([...(custom.length ? custom : DEFAULT_PLANNER_MODELS), ...getGeminiModels()])];
}

/**
 * The thinkingConfig to send for a model, or null if it can't think.
 *   • Gemini 3+ take a qualitative thinkingLevel ("low" | "medium" | "high").
 *   • Gemini 2.5 take a token budget instead (a level there is a 400 error).
 * includeThoughts asks for short thought SUMMARIES, which the planner streams
 * into the UI so people can watch the reasoning happen.
 */
export function thinkingConfigFor(model, level = "high", includeThoughts = true) {
  const m = String(model || "");
  if (/^gemini-2\.5/.test(m) || /^gemini-(flash|flash-lite|pro)-latest$/.test(m)) {
    const budget = { low: 1024, medium: 4096, high: 8192 }[level] ?? -1;
    return { thinkingBudget: budget, includeThoughts };
  }
  if (/^gemini-([3-9]|\d{2,})/.test(m)) return { thinkingLevel: level, includeThoughts };
  return null;
}

// Google Search grounding lets Caddy research the web — but it draws on a
// SEPARATE grounding quota that the free tier barely allows, so leaving it on
// causes 429s even when token/RPD usage is tiny. OFF by default; set
// VITE_GEMINI_WEB_SEARCH=true once you have billing/quota for grounding.
export const ENABLE_WEB_SEARCH = String(import.meta.env.VITE_GEMINI_WEB_SEARCH || "").toLowerCase() === "true";

// Rough intent check: is the user asking Caddy to DO something (create/modify a
// project, feature, bug, roadblock, note, milestone, column…) rather than just
// answer a question? Action requests get routed to TASK_MODEL for higher-quality
// tool use; queries stay on the lighter model. Verb + task-noun keeps false
// positives low (a miss just means the lighter model — the current default).
// Covers every workspace's words: Workforce's features/bugs and Operations/
// Executives' roadblocks, accounts and documents.
const TASK_VERB = /\b(create|make|add|new|set\s?up|setup|start|build|log|file|flag|raise|open|register|schedule|assign|update|change|jot|post|mark|complete|move|rename|remove|delete)\b/i;
const TASK_NOUN = /\b(project|task|feature|bug|roadblocks?|blockers?|issues?|requests?|accounts?|documents?|note|idea|milestone|deadline|column|status|ticket|assignment)\b/i;
export function isTaskRequest(text) {
  const t = String(text || "");
  return TASK_VERB.test(t) && TASK_NOUN.test(t);
}

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
