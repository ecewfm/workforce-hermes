// Server-side proxy for the Gemini API so the key NEVER reaches the browser.
// The client (src/utils/geminiClient.js) POSTs { model, body, stream? }; this
// function adds the key (a SERVER-only env var) and forwards to Gemini.
//   • stream: false (default) → generateContent, JSON passed straight through
//   • stream: true            → streamGenerateContent (SSE), piped through as it
//                               arrives so the planner can show thinking live
//
// Set the key in Vercel (and .env.local for `vercel dev`) as GEMINI_API_KEY —
// do NOT use the VITE_ prefix, or it would be exposed in the client bundle.

// Only real Gemini model ids — keeps the proxy from being pointed at anything else.
const MODEL_RE = /^gemini-[a-z0-9][a-z0-9.\-]*$/i;

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
