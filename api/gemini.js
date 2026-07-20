// Server-side proxy for the Gemini API so the key NEVER reaches the browser.
// The client (src/utils/geminiClient.js) POSTs { model, body }; this function
// adds the key (a SERVER-only env var) and forwards to Gemini.
//
// Set the key in Vercel (and .env.local for `vercel dev`) as GEMINI_API_KEY —
// do NOT use the VITE_ prefix, or it would be exposed in the client bundle.
export default async function handler(req, res) {
  const key = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY || "";

  // Health check: a plain GET confirms this function is actually DEPLOYED and
  // whether the server key is configured. Never returns the key itself. This
  // is how we verify a Vercel deploy picked up the function (GET -> 200 JSON;
  // a missing function returns Vercel's HTML 404 instead).
  if (req.method === "GET") {
    res.status(200).json({ ok: true, service: "gemini-proxy", keyConfigured: !!key });
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

  let payload = req.body;
  if (typeof payload === "string") {
    try { payload = JSON.parse(payload); } catch { payload = null; }
  }
  const model = payload?.model;
  const body = payload?.body;
  if (!model || !body) {
    res.status(400).json({ error: "Request must include { model, body }." });
    return;
  }

  try {
    const upstream = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
    );
    // Pass Gemini's status + JSON straight through so the client keeps its
    // model-fallback + error handling.
    const text = await upstream.text();
    res.status(upstream.status);
    res.setHeader("Content-Type", "application/json");
    res.send(text);
  } catch (err) {
    res.status(502).json({ error: "Failed to reach Gemini upstream." });
  }
}
