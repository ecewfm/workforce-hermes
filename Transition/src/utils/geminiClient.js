import { getGeminiModels, TASK_MODEL, ENABLE_WEB_SEARCH } from "./aiConfig";

// Safety cap on how many tool-call rounds a single request may take.
const MAX_TURNS = 10;

// Remember which models just rate-limited (429) so we skip them for a short
// cooldown instead of re-hitting the same capped model on every message. This
// makes Caddy fall straight to a model that still has quota.
const rateLimitedUntil = {}; // model id -> timestamp
const COOLDOWN_MS = 60_000;

function firstAvailableIdx(models) {
  const now = Date.now();
  for (let i = 0; i < models.length; i++) {
    if (!(rateLimitedUntil[models[i]] > now)) return i;
  }
  return 0; // all cooling down — try the first anyway
}

/**
 * Run one assistant turn with Gemini function-calling.
 *
 * @param {object}   opts
 * @param {Array}    opts.history   prior conversation as Gemini `contents` (role/parts)
 * @param {string}   opts.userText  the new user message
 * @param {Array}    opts.tools     [{ name, description, parameters }] function declarations
 * @param {string}   opts.systemInstruction
 * @param {(name:string,args:object)=>Promise<any>} opts.executeTool  runs a tool, returns JSON-able result
 * @param {(phase:string, label:string)=>void} opts.onStatus  progress indicator hook
 * @returns {Promise<{text:string, contents:Array}>} final text + updated contents (for history)
 */
export async function runAssistant({ history = [], userText, tools = [], systemInstruction, executeTool, onStatus, taskMode = false }) {
  let models = getGeminiModels();
  // For action/"do a task" requests, try the stronger TASK_MODEL first, then
  // fall back through the normal chain (dedup so it isn't tried twice).
  if (taskMode && TASK_MODEL) {
    models = [TASK_MODEL, ...models.filter((m) => m !== TASK_MODEL)];
  }
  // Start on the first model that isn't in a rate-limit cooldown.
  let modelIdx = firstAvailableIdx(models);

  // Local `npm run dev` (Vite) has no /api routes, so fall back to calling Gemini
  // directly with a DEV-ONLY key. This whole branch is compiled out of production
  // builds (import.meta.env.DEV === false), so the key never ships — prod always
  // goes through the /api/gemini proxy. Don't set VITE_GEMINI_API_KEY on Vercel.
  const DEV_KEY = import.meta.env.DEV ? (import.meta.env.VITE_GEMINI_API_KEY || "").trim() : "";
  // Google Search grounding (only when enabled — see aiConfig) alongside our
  // own function tools.
  const toolDecls = [
    ...(ENABLE_WEB_SEARCH ? [{ google_search: {} }] : []),
    ...(tools.length ? [{ functionDeclarations: tools.map(({ name, description, parameters }) => ({ name, description, parameters })) }] : []),
  ];

  // One generateContent call, transparently falling back to the backup model on
  // a retryable failure (missing model / rate limit / server error / network).
  async function generate(body) {
    while (true) {
      const model = models[modelIdx];
      let res;
      try {
        if (DEV_KEY) {
          // Local dev only — direct call.
          res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(DEV_KEY)}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
        } else {
          // Production — server proxy keeps the key server-side.
          res = await fetch("/api/gemini", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ model, body }),
          });
        }
      } catch {
        if (modelIdx < models.length - 1) { modelIdx++; onStatus?.("thinking", "Switching to backup model…"); continue; }
        throw new Error("Couldn't reach the assistant service (network error). Check your connection.");
      }
      if (res.ok) return res.json();
      const errText = await res.text().catch(() => "");
      // A 404 from our OWN proxy route (Vercel serves an HTML 404) means
      // /api/gemini isn't deployed. A Gemini model-not-found 404 comes back as
      // JSON through the proxy — let that fall through to the model-retry below.
      if (!DEV_KEY && res.status === 404) {
        let routeMissing = true;
        try { JSON.parse(errText); routeMissing = false; } catch { routeMissing = true; }
        if (routeMissing) {
          throw new Error("The AI endpoint /api/gemini returned 404 — the server function isn't deployed yet. Redeploy the latest build to Vercel.");
        }
      }
      // Put a rate-limited model on cooldown so later messages skip it.
      if (res.status === 429) rateLimitedUntil[model] = Date.now() + COOLDOWN_MS;
      if (modelIdx < models.length - 1 && isRetryable(res.status)) {
        modelIdx++;
        onStatus?.("thinking", "That model's busy — switching to backup…");
        continue;
      }
      throw new Error(parseGeminiError(res.status, errText, model));
    }
  }

  const contents = [...history, { role: "user", parts: [{ text: userText }] }];
  onStatus?.("analyzing", "Analyzing request…");

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const body = {
      contents,
      ...(systemInstruction ? { systemInstruction: { parts: [{ text: systemInstruction }] } } : {}),
      ...(toolDecls.length ? { tools: toolDecls } : {}),
      generationConfig: { temperature: 0.4 },
    };

    onStatus?.("thinking", "Thinking…");
    const data = await generate(body);
    const modelContent = data?.candidates?.[0]?.content || { role: "model", parts: [] };
    const parts = modelContent.parts || [];
    const functionCalls = parts.filter((p) => p.functionCall).map((p) => p.functionCall);

    if (functionCalls.length === 0) {
      const text = parts.filter((p) => p.text).map((p) => p.text).join("").trim();
      return { text: text || "Done.", contents };
    }

    // Push the model's EXACT turn back into history (preserving thoughtSignature
    // and call ids) — Gemini 3.x needs the thought signatures echoed for correct
    // multi-step tool reasoning. Then run each tool and feed the results back.
    contents.push(modelContent);
    const responseParts = [];
    for (const fc of functionCalls) {
      onStatus?.("working", toolStatusLabel(fc.name));
      let result;
      try {
        result = await executeTool(fc.name, fc.args || {});
      } catch (err) {
        result = { error: err?.message || "Tool failed." };
      }
      responseParts.push({ functionResponse: { name: fc.name, ...(fc.id ? { id: fc.id } : {}), response: { result } } });
    }
    contents.push({ role: "user", parts: responseParts });
    onStatus?.("thinking", "Working through it…");
  }

  return { text: "That took more steps than I could complete — try narrowing the request.", contents };
}

function toolStatusLabel(name) {
  const map = {
    get_project_updates: "Reading project activity…",
    list_projects: "Looking up projects…",
    create_project: "Creating the project…",
    add_note: "Posting the update…",
    set_project_description: "Writing the description…",
    add_notebook_idea: "Saving to the notebook…",
    add_feature: "Adding the feature…",
    add_bug: "Logging the bug…",
    update_setting: "Updating settings…",
  };
  return map[name] || "Working…";
}

// Statuses where trying the backup model could help.
function isRetryable(status) {
  return status === 404 || status === 429 || status >= 500;
}

function parseGeminiError(status, text, model) {
  let msg = "";
  try { msg = JSON.parse(text)?.error?.message || ""; } catch { /* not json */ }
  if (status === 400 && /api key|api_key/i.test(msg)) return "Invalid Gemini API key. Check it in Settings → AI Assistant.";
  if (status === 403) return "Gemini rejected the key (403). Verify the key and that the Generative Language API is enabled for it.";
  if (status === 429) return "Gemini rate limit reached (primary + backup). Give it a moment and try again.";
  if (status === 404) return `Model "${model}" wasn't found. Set a valid model id in .env.local (VITE_GEMINI_MODEL / _FALLBACK).`;
  return msg || `Gemini request failed (${status}).`;
}
