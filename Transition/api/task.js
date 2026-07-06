import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";

/**
 * Task API — programmatic read/write access to a task's bugs, features,
 * notes/updates, and system links. One endpoint per task:
 *
 *   GET    /api/task                                      → list tasks (id, title, status, assignee)
 *   GET    /api/task?taskId=X                             → full task (features, bugs, notes, links)
 *   POST   /api/task?taskId=X&resource=bug                → report a bug        { name, description?, suggestedBy? }
 *   POST   /api/task?taskId=X&resource=feature            → add a feature       { name, description?, suggestedBy? }
 *   PATCH  /api/task?taskId=X&resource=feature&id=F       → edit a feature/bug  { name?, description?, status? ("pending"|"completed") }
 *   DELETE /api/task?taskId=X&resource=feature&id=F       → delete a feature/bug
 *   POST   /api/task?taskId=X&resource=note               → add a note/update   { text, writer?, writerEmail? }
 *   PATCH  /api/task?taskId=X&resource=links              → set system links    { appscriptLink?, webappLink?, projectLink? }
 *
 * Auth: every request must send the key from the TASK_API_KEY env var,
 * either as `x-api-key: <key>` or `Authorization: Bearer <key>`.
 * Writes go through the same Convex mutations the app uses, so
 * notifications (assignees, managers, @mentions) still fire.
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

  const expectedKey = process.env.TASK_API_KEY;
  if (!expectedKey) {
    return res.status(503).json({ error: "Task API is not configured. Set the TASK_API_KEY environment variable in Vercel." });
  }
  if (getApiKey(req) !== expectedKey) {
    return res.status(401).json({ error: "Invalid or missing API key. Send it as 'x-api-key' or 'Authorization: Bearer <key>'." });
  }

  const convexUrl = process.env.VITE_CONVEX_URL || "https://aware-leopard-887.convex.cloud";
  const client = new ConvexHttpClient(convexUrl);

  const { taskId, resource, id: featureId } = req.query;
  const body = parseBody(req);

  try {
    // ── GET: list tasks or read one task ─────────────────────────────
    if (req.method === "GET") {
      if (!taskId) {
        const tasks = await client.query(api.tasks.getTasksLight);
        return res.status(200).json(
          (tasks || []).map((t) => ({ taskId: t._id, title: t.title, status: t.status, assignee: t.assignee }))
        );
      }
      const task = await client.query(api.tasks.getTaskById, { taskId });
      if (!task) return res.status(404).json({ error: "Task not found." });

      const features = task.features || [];
      return res.status(200).json({
        ...sanitizeTask(task),
        taskId: task._id,
        bugs: features.filter((f) => f.type === "bug"),
        features: features.filter((f) => f.type !== "bug"),
        systemLinks: {
          appscriptLink: task.appscriptLink || null,
          webappLink: task.webappLink || task.projectLink || null,
        },
      });
    }

    if (!taskId) return res.status(400).json({ error: "Missing 'taskId' query parameter." });

    // ── POST: add bug / feature / note ───────────────────────────────
    if (req.method === "POST") {
      if (resource === "bug" || resource === "feature") {
        if (!body.name || !String(body.name).trim()) {
          return res.status(400).json({ error: "Missing 'name' in body." });
        }
        const feature = {
          id: (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`),
          name: String(body.name).trim(),
          description: String(body.description || "").trim(),
          status: "pending",
          suggestedBy: body.suggestedBy || body.writer || "API",
          type: resource,
          createdAt: estNow(),
        };
        await client.mutation(api.tasks.addTaskFeature, {
          taskId,
          feature,
          actorEmail: body.actorEmail || undefined,
          actorName: body.actorName || body.suggestedBy || "API",
        });
        return res.status(201).json({ ok: true, [resource]: feature });
      }

      if (resource === "note") {
        if (!body.text || !String(body.text).trim()) {
          return res.status(400).json({ error: "Missing 'text' in body." });
        }
        const notes = await client.mutation(api.tasks.addNoteToTask, {
          taskId,
          noteText: String(body.text).trim(),
          writer: body.writer || "API",
          writerEmail: body.writerEmail || undefined,
          date: estNow(),
        });
        return res.status(201).json({ ok: true, note: notes[notes.length - 1] });
      }

      return res.status(400).json({ error: "POST requires resource=bug, resource=feature, or resource=note." });
    }

    // ── PATCH: edit feature/bug, or set system links ─────────────────
    if (req.method === "PATCH") {
      if (resource === "feature" || resource === "bug") {
        if (!featureId) return res.status(400).json({ error: "Missing 'id' query parameter (the feature/bug id)." });

        const task = await client.query(api.tasks.getTaskById, { taskId });
        if (!task) return res.status(404).json({ error: "Task not found." });
        const existing = (task.features || []).find((f) => f.id === featureId);
        if (!existing) return res.status(404).json({ error: "Feature/bug not found on this task." });

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
            return res.status(400).json({ error: "'status' must be 'pending' or 'completed'." });
          }
          await client.mutation(api.tasks.updateFeatureStatus, {
            taskId,
            featureId,
            status: body.status,
            writer: body.writer || body.actorName || "API",
          });
        }

        return res.status(200).json({ ok: true });
      }

      if (resource === "links") {
        if (body.appscriptLink === undefined && body.webappLink === undefined && body.projectLink === undefined) {
          return res.status(400).json({ error: "Provide at least one of: appscriptLink, webappLink, projectLink." });
        }
        const links = await client.mutation(api.tasks.updateTaskLinks, {
          taskId,
          appscriptLink: body.appscriptLink !== undefined ? String(body.appscriptLink) : undefined,
          webappLink: body.webappLink !== undefined ? String(body.webappLink) : undefined,
          projectLink: body.projectLink !== undefined ? String(body.projectLink) : undefined,
        });
        return res.status(200).json({ ok: true, systemLinks: links });
      }

      return res.status(400).json({ error: "PATCH requires resource=feature, resource=bug, or resource=links." });
    }

    // ── DELETE: remove a feature/bug ─────────────────────────────────
    if (req.method === "DELETE") {
      if (resource !== "feature" && resource !== "bug") {
        return res.status(400).json({ error: "DELETE requires resource=feature or resource=bug." });
      }
      if (!featureId) return res.status(400).json({ error: "Missing 'id' query parameter (the feature/bug id)." });

      const task = await client.query(api.tasks.getTaskById, { taskId });
      if (!task) return res.status(404).json({ error: "Task not found." });
      if (!(task.features || []).some((f) => f.id === featureId)) {
        return res.status(404).json({ error: "Feature/bug not found on this task." });
      }

      await client.mutation(api.tasks.deleteTaskFeature, { taskId, featureId });
      return res.status(200).json({ ok: true, deleted: featureId });
    }

    res.setHeader("Allow", "GET, POST, PATCH, DELETE, OPTIONS");
    return res.status(405).json({ error: `Method ${req.method} not allowed.` });
  } catch (error) {
    console.error("Task API error:", error);
    const message = error?.message || "Internal error";
    const status = /not found/i.test(message) ? 404 : 500;
    return res.status(status).json({ error: message });
  }
}
