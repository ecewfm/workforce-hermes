import { ConvexHttpClient } from "convex/browser";
import { anyApi as api } from "convex/server";

/**
 * Task API — programmatic read/write access to a task's bugs, features,
 * notes/updates, and system links. It is self-documenting: open any GET URL in
 * a browser and it returns a short usage guide (with example URLs for THIS
 * environment) instead of a wall of raw fields.
 *
 *   GET    /api/task                                → usage guide + task list
 *   GET    /api/task?taskId=X                        → usage guide + full task
 *   POST   /api/task?taskId=X&resource=bug           → report a bug   { name, description?, author }
 *   POST   /api/task?taskId=X&resource=feature       → add a feature  { name, description?, author }
 *   POST   /api/task?taskId=X&resource=note          → add an update  { text, author }
 *   PATCH  /api/task?taskId=X&resource=feature&id=F  → edit/complete  { name?, description?, status?, author }
 *   PATCH  /api/task?taskId=X&resource=links         → set links      { appscriptLink?, webappLink?, projectLink? }
 *   DELETE /api/task?taskId=X&resource=feature&id=F  → delete a feature/bug
 *
 * Auth: reads of task DATA and all writes need the TASK_API_KEY, sent as
 * `x-api-key: <key>` or `Authorization: Bearer <key>`. A GET with no key still
 * returns the usage guide (docs), just no data.
 *
 * ATTRIBUTION: always pass `author` (your name). Updates are recorded under it —
 * shown as the note writer / feature "suggested by". Do NOT post as "API",
 * "Claude Code" or any bot name; use the real person's name.
 */

const EST_DATE_OPTS = {
  timeZone: "America/New_York",
  year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit",
};

function estNow() {
  return new Date().toLocaleString("en-US", EST_DATE_OPTS);
}

function getApiKey(req) {
  const bearer = (req.headers["authorization"] || "").replace(/^Bearer\s+/i, "");
  return req.headers["x-api-key"] || bearer || "";
}

function parseBody(req) {
  if (!req.body) return {};
  if (typeof req.body === "string") {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return req.body;
}

// The base URL for THIS environment (localhost when run locally, the vercel
// domain in production) — so example URLs in the guide are copy-paste ready.
function baseUrl(req) {
  const proto = (req.headers["x-forwarded-proto"] || "https").split(",")[0].trim();
  const host = req.headers["host"] || "workforce-hermes.vercel.app";
  return `${proto}://${host}`;
}

// Whoever is posting — attribute updates to a real person, never a bot.
function resolveAuthor(body) {
  const a = body.author || body.writer || body.suggestedBy || body.actorName;
  return (a && String(a).trim()) || "External Update";
}

// Short, self-documenting usage guide with example URLs for this environment.
function buildUsage(base, taskId) {
  const id = taskId || "<TASK_ID>";
  const t = `${base}/api/task?taskId=${id}`;
  return {
    about:
      "Programmatic read/write for a task's bugs, features and updates. " +
      "Send your key as the 'x-api-key' header. ALWAYS pass \"author\" (your real name) — " +
      "updates are attributed to it, not to 'API' or any bot.",
    auth: 'Header:  x-api-key: <TASK_API_KEY>   (or  Authorization: Bearer <TASK_API_KEY>)',
    howTo: {
      reportBug: `POST ${t}&resource=bug     body: { "name": "Login button dead", "description": "...", "author": "Jomari" }`,
      addFeature: `POST ${t}&resource=feature body: { "name": "Dark mode", "description": "...", "author": "Jomari" }`,
      addUpdate: `POST ${t}&resource=note    body: { "text": "Deployed v2 to staging", "author": "Jomari" }`,
      completeItem: `PATCH ${t}&resource=feature&id=<ITEM_ID>  body: { "status": "completed", "author": "Jomari" }`,
      editItem: `PATCH ${t}&resource=feature&id=<ITEM_ID>  body: { "name": "...", "description": "...", "author": "Jomari" }`,
      deleteItem: `DELETE ${t}&resource=feature&id=<ITEM_ID>`,
      setLinks: `PATCH ${t}&resource=links   body: { "webappLink": "https://...", "appscriptLink": "https://..." }`,
      listTasks: `GET ${base}/api/task           (Workforce/WFM tasks: id, title, status, assignee)`,
      readTask: `GET ${t}                         (full task, any workspace — needs the key)`,
    },
    curlExample:
      `curl -X POST "${t}&resource=note" ` +
      `-H "x-api-key: $TASK_API_KEY" -H "Content-Type: application/json" ` +
      `-d '{"text":"Fixed the SLA export bug","author":"Jomari"}'`,
    notes: [
      "author is how the update shows up in the app (note writer / 'suggested by'). Use the person's name.",
      "resource must be one of: bug, feature, note (for POST); feature/bug or links (for PATCH).",
      "status (PATCH on a feature/bug) is 'pending' or 'completed'.",
      "Writes fire the same notifications as the app (assignees, managers, @mentions).",
    ],
  };
}

// Never expose credentials through the API, even to key holders.
function sanitizeTask(task) {
  if (!task) return task;
  const { adminCredentials, ...safe } = task;
  return safe;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-api-key, Authorization");
  if (req.method === "OPTIONS") return res.status(204).end();

  const { taskId, resource, id: featureId } = req.query;
  const base = baseUrl(req);
  const usage = buildUsage(base, taskId);

  const expectedKey = process.env.TASK_API_KEY;
  const hasValidKey = !!expectedKey && getApiKey(req) === expectedKey;

  // A GET with no valid key returns the DOCS (never data) — so opening the URL
  // in a browser shows how to use it instead of an error or raw fields.
  if (req.method === "GET" && !hasValidKey) {
    return res.status(200).json({
      authenticated: false,
      hint: "Add your API key (x-api-key header) to read task data or post updates. This page is the usage guide.",
      usage,
    });
  }

  // Everything else needs the key.
  if (!expectedKey) {
    return res.status(503).json({ error: "Task API is not configured. Set the TASK_API_KEY environment variable.", usage });
  }
  if (!hasValidKey) {
    return res.status(401).json({ error: "Invalid or missing API key. Send it as 'x-api-key' or 'Authorization: Bearer <key>'.", usage });
  }

  const convexUrl = process.env.VITE_CONVEX_URL || "https://honorable-ostrich-665.convex.cloud";
  const client = new ConvexHttpClient(convexUrl);
  const body = parseBody(req);
  const author = resolveAuthor(body);

  try {
    // ── GET: usage guide + task list, or usage guide + one task ──────
    if (req.method === "GET") {
      if (!taskId) {
        // The list is scoped to the Workforce (WFM) workspace. Per-task
        // operations by taskId still work across every workspace (fetched by id).
        const tasks = await client.query(api.tasks.getTasksLight, { workspace: "workforce" });
        return res.status(200).json({
          usage,
          workspace: "workforce",
          tasks: (tasks || []).map((t) => ({ taskId: t._id, title: t.title, status: t.status, assignee: t.assignee })),
        });
      }
      const task = await client.query(api.tasks.getTaskById, { taskId });
      if (!task) return res.status(404).json({ error: "Task not found.", usage });

      const features = task.features || [];
      return res.status(200).json({
        usage,
        taskId: task._id,
        ...sanitizeTask(task),
        bugs: features.filter((f) => f.type === "bug"),
        features: features.filter((f) => f.type !== "bug"),
        systemLinks: {
          appscriptLink: task.appscriptLink || null,
          webappLink: task.webappLink || task.projectLink || null,
        },
      });
    }

    if (!taskId) return res.status(400).json({ error: "Missing 'taskId' query parameter.", usage });

    // ── POST: add bug / feature / note ───────────────────────────────
    if (req.method === "POST") {
      if (resource === "bug" || resource === "feature") {
        if (!body.name || !String(body.name).trim()) {
          return res.status(400).json({ error: "Missing 'name' in body.", usage });
        }
        const feature = {
          id: (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`),
          name: String(body.name).trim(),
          description: String(body.description || "").trim(),
          status: "pending",
          suggestedBy: author,
          type: resource,
          createdAt: estNow(),
        };
        await client.mutation(api.tasks.addTaskFeature, {
          taskId,
          feature,
          actorEmail: body.actorEmail || undefined,
          actorName: author,
        });
        return res.status(201).json({ ok: true, [resource]: feature, attributedTo: author });
      }

      if (resource === "note") {
        if (!body.text || !String(body.text).trim()) {
          return res.status(400).json({ error: "Missing 'text' in body.", usage });
        }
        const notes = await client.mutation(api.tasks.addNoteToTask, {
          taskId,
          noteText: String(body.text).trim(),
          writer: author,
          writerEmail: body.writerEmail || undefined,
          date: estNow(),
        });
        return res.status(201).json({ ok: true, note: notes[notes.length - 1], attributedTo: author });
      }

      return res.status(400).json({ error: "POST requires resource=bug, resource=feature, or resource=note.", usage });
    }

    // ── PATCH: edit feature/bug, or set system links ─────────────────
    if (req.method === "PATCH") {
      if (resource === "feature" || resource === "bug") {
        if (!featureId) return res.status(400).json({ error: "Missing 'id' query parameter (the feature/bug id).", usage });

        const task = await client.query(api.tasks.getTaskById, { taskId });
        if (!task) return res.status(404).json({ error: "Task not found.", usage });
        const existing = (task.features || []).find((f) => f.id === featureId);
        if (!existing) return res.status(404).json({ error: "Feature/bug not found on this task.", usage });

        if (body.name !== undefined || body.description !== undefined) {
          await client.mutation(api.tasks.updateTaskFeature, {
            taskId,
            featureId,
            updates: {
              name: body.name !== undefined ? String(body.name).trim() : existing.name,
              description: body.description !== undefined ? String(body.description).trim() : existing.description,
              imageStorageIds: existing.imageStorageIds,
            },
          });
        }

        if (body.status !== undefined) {
          if (!["pending", "completed"].includes(body.status)) {
            return res.status(400).json({ error: "'status' must be 'pending' or 'completed'.", usage });
          }
          await client.mutation(api.tasks.updateFeatureStatus, {
            taskId,
            featureId,
            status: body.status,
            writer: author,
          });
        }

        return res.status(200).json({ ok: true, attributedTo: author });
      }

      if (resource === "links") {
        if (body.appscriptLink === undefined && body.webappLink === undefined && body.projectLink === undefined) {
          return res.status(400).json({ error: "Provide at least one of: appscriptLink, webappLink, projectLink.", usage });
        }
        const links = await client.mutation(api.tasks.updateTaskLinks, {
          taskId,
          appscriptLink: body.appscriptLink !== undefined ? String(body.appscriptLink) : undefined,
          webappLink: body.webappLink !== undefined ? String(body.webappLink) : undefined,
          projectLink: body.projectLink !== undefined ? String(body.projectLink) : undefined,
        });
        return res.status(200).json({ ok: true, systemLinks: links });
      }

      return res.status(400).json({ error: "PATCH requires resource=feature, resource=bug, or resource=links.", usage });
    }

    // ── DELETE: remove a feature/bug ─────────────────────────────────
    if (req.method === "DELETE") {
      if (resource !== "feature" && resource !== "bug") {
        return res.status(400).json({ error: "DELETE requires resource=feature or resource=bug.", usage });
      }
      if (!featureId) return res.status(400).json({ error: "Missing 'id' query parameter (the feature/bug id).", usage });

      const task = await client.query(api.tasks.getTaskById, { taskId });
      if (!task) return res.status(404).json({ error: "Task not found.", usage });
      if (!(task.features || []).some((f) => f.id === featureId)) {
        return res.status(404).json({ error: "Feature/bug not found on this task.", usage });
      }

      await client.mutation(api.tasks.deleteTaskFeature, { taskId, featureId });
      return res.status(200).json({ ok: true, deleted: featureId });
    }

    res.setHeader("Allow", "GET, POST, PATCH, DELETE, OPTIONS");
    return res.status(405).json({ error: `Method ${req.method} not allowed.`, usage });
  } catch (error) {
    console.error("Task API error:", error);
    const message = error?.message || "Internal error";
    const status = /not found/i.test(message) ? 404 : 500;
    return res.status(status).json({ error: message, usage });
  }
}
