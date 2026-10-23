// ── Gemini AI assistant configuration ───────────────────────────────────────
//
// The API KEY is NEVER in the browser. The client calls our server proxy
// (/api/gemini), which reads the SERVER-only env var GEMINI_API_KEY (set it in
// Vercel, and in .env.local as GEMINI_API_KEY — NOT VITE_ — for `vercel dev`).
//
// Only non-secret config (model names, feature flags) lives here on the client.

// ── Which Gemini model does what ────────────────────────────────────────────
// Three tiers (model ids checked against the Gemini API, Oct 2026). Each list
// is tried in order, dropping to the next on a rate limit or outage, and every
// tier ends on the everyday models so Caddy still answers when the big ones
// are busy.
//   • Everyday — Caddy questions and simple edits: Gemini 3.5 Flash Lite.
//   • Deep — bigger Caddy jobs (a new project, several steps at once, many
//     projects, analysis, long messages): Gemini 3.6 Flash, thinking hard.
//   • Planner — the New Task planner, a whole project plan: Gemini 3.8 Flash.
// Model names aren't secret; override any tier with a comma-separated
// VITE_GEMINI_MODELS / VITE_GEMINI_DEEP_MODELS / VITE_GEMINI_PLANNER_MODELS.
const EVERYDAY_MODELS = ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite"];
const DEEP_MODELS = ["gemini-3.6-flash", "gemini-3.8-flash"];
const PLANNER_MODELS = ["gemini-3.8-flash", "gemini-3.6-flash"];

const modelList = (envValue, fallback) => {
  const list = String(envValue || "").split(",").map((m) => m.trim()).filter(Boolean);
  return list.length ? list : fallback;
};
const chain = (...lists) => [...new Set(lists.flat())];

/** Everyday chain (Caddy's default). */
export function getGeminiModels() {
  return chain(modelList(import.meta.env.VITE_GEMINI_MODELS, EVERYDAY_MODELS));
}

/** Deep chain: bigger Caddy jobs, then the everyday models as a last resort. */
export function getDeepModels() {
  return chain(modelList(import.meta.env.VITE_GEMINI_DEEP_MODELS, DEEP_MODELS), getGeminiModels());
}

/** The New Task planner's chain, strongest first. */
export function getPlannerModels() {
  return chain(modelList(import.meta.env.VITE_GEMINI_PLANNER_MODELS, PLANNER_MODELS), getGeminiModels());
}

/** True for the models that only do the big jobs (they get thinking set high). */
export function isDeepModel(model) {
  return [...getDeepModels(), ...getPlannerModels()].includes(model) && !getGeminiModels().includes(model);
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

// Is this a bigger job for the deep model? A miss just means the everyday
// model, which still uses every tool — so this only catches the clear cases:
//   • a long message (a pasted brief, a list of things to do);
//   • starting a new project (Caddy plans its milestones);
//   • planning / analysis / reporting work;
//   • anything across many projects ("all overdue projects", "the whole board");
//   • several actions in one go ("add a note to X and move Y to Done").
const PLAN_WORDS = /\b(plan|planning|break\s+(it|this|that)?\s*down|analy[sz]e|analysis|compare|summari[sz]e|summary|report|review|assess|audit|prioriti[sz]e|estimate|forecast|strategy|recommend|root\s+cause|trade-?offs?|step[-\s]by[-\s]step)\b/i;
const WIDE_SCOPE = /\b(all|every|each|across|whole|entire)\b[^.?!]{0,40}\b(projects?|tasks?|board|team|workspace|accounts?|milestones?)\b|\b(overdue|late|behind|stalled|stuck|at[-\s]risk)\b[^.?!]{0,20}\b(projects?|tasks?)\b|\b(projects?|tasks?)\b[^.?!]{0,25}\b(overdue|late|behind|stalled|stuck|at[-\s]risk)\b/i;
const NEW_PROJECT = /\b(create|make|start|set\s?up|setup|build|launch|kick\s?off|new)\b[^.?!]{0,40}\b(project|task)\b/i;
const ACTION = /\b(create|make|add|set\s?up|start|log|file|flag|raise|assign|update|change|post|mark|complete|move|rename|remove|delete|close|reopen)\b/gi;
export function isDeepRequest(text) {
  const t = String(text || "").trim();
  if (t.length > 500 || t.split(/\n/).filter((l) => l.trim()).length > 5) return true;
  if (PLAN_WORDS.test(t) || WIDE_SCOPE.test(t) || NEW_PROJECT.test(t)) return true;
  const actions = t.match(ACTION) || [];
  return new Set(actions.map((a) => a.toLowerCase())).size >= 2 && /\b(and|then|also)\b|[,;]/i.test(t);
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
