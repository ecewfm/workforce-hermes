import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

// Local only: serve the repo-root /api/*.js serverless functions the way
// Vercel does (req.body / req.query / res.status().json()), so sign-in, the
// Task API and Caddy all work under plain `npm run dev` and `vite preview`.
function vercelApiDev(env) {
  const apiDir = fileURLToPath(new URL("../api/", import.meta.url));
  const install = (server) => {
    for (const [k, v] of Object.entries(env)) if (process.env[k] === undefined) process.env[k] = v;
    server.middlewares.use(async (req, res, next) => {
      const m = req.url.match(/^\/api\/([a-zA-Z0-9_-]+)(\?.*)?$/);
      const file = m && `${apiDir}${m[1]}.js`;
      if (!file || !fs.existsSync(file)) return next();
      let raw = "";
      for await (const chunk of req) raw += chunk;
      try { req.body = raw ? JSON.parse(raw) : undefined; } catch { req.body = raw; }
      req.query = Object.fromEntries(new URL(req.url, "http://localhost").searchParams);
      res.status = (code) => { res.statusCode = code; return res; };
      res.json = (obj) => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(obj)); return res; };
      res.send = (body) => { res.end(body); return res; };
      try {
        const mod = await import(`${pathToFileURL(file).href}?t=${fs.statSync(file).mtimeMs}`);
        await mod.default(req, res);
      } catch (err) {
        console.error(`[api/${m[1]}]`, err);
        if (!res.writableEnded) res.status(500).json({ error: "Local API error — see the dev server console." });
      }
    });
  };
  return { name: "vercel-api-dev", configureServer: install, configurePreviewServer: install };
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), vercelApiDev(loadEnv(mode, process.cwd(), ""))],
}));
