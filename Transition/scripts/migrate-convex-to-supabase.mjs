#!/usr/bin/env node
// ── Convex → Supabase data migration ────────────────────────────────────────
//
// Copies EVERYTHING from a Convex snapshot export into the Supabase schema in
// supabase/migrations/20261019000000_initial_schema.sql: every table, plus the
// uploaded feature images (into the private "feature-images" storage bucket).
//
//   1. npx convex export --path <somewhere>/convex-export.zip --include-file-storage
//      (keep it OUT of the repo — it contains password hashes)
//   2. node scripts/migrate-convex-to-supabase.mjs <export.zip | unzipped dir> [--dry-run] [--prune]
//
// Reads SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from .env.local (or the env).
//
// Safe to re-run: every row has a stable id, so a re-run updates in place.
// Convex stays the source of truth until the app switches over, so run it
// once more at cutover. --prune also deletes Supabase rows that no longer
// exist in the export (rows deleted in Convex since the last run). NEVER use
// --prune after the app writes to Supabase directly — it would delete that data.
//
// Transformations (see the schema file for the why):
//   • nested milestones / notes / replies / reactions / features / images → own tables
//   • text dates ("4/7/2026, 8:27 PM") → timestamps, read as America/New_York
//     (verified: matches every row that also has an exact timestamp)
//   • plain-text passwords → SHA-256 hex (the format the login already accepts);
//     security answers → SHA-256 of trim(lower(answer))
//   • per-project admin logins are de-obfuscated into task_credentials
//   • dropped: tasks.completedMilestones (derived), staff.lastSeen / resetCode /
//     resetCodeExpiry (legacy, unused), text `date` on notebook ideas (created_at is exact)

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { pathToFileURL, fileURLToPath } from "node:url";

const BUCKET = "feature-images";
const DEPARTMENTS = ["Executives", "Operations", "Workforce"];
const WORKSPACES = ["executives", "operations", "workforce"];
const ROLES = ["Programmer", "Admin", "Admin+", "Manager", "Pending", "Revoked"];

// Load order respects foreign keys; [table, conflict columns for upsert/prune].
export const TABLES = [
  ["staff", ["id"]],
  ["staff_credentials", ["staff_id"]],
  ["presence", ["email"]],
  ["tasks", ["id"]],
  ["task_credentials", ["task_id"]],
  ["task_milestones", ["id"]],
  ["task_notes", ["id"]],
  ["note_replies", ["id"]],
  ["note_reactions", ["note_id", "user_email", "reaction"]],
  ["task_features", ["id"]],
  ["feature_images", ["id"]],
  ["task_views", ["task_id", "user_email"]],
  ["notebook_ideas", ["id"]],
  ["announcements", ["id"]],
  ["announcement_views", ["announcement_id", "user_email"]],
  ["handbooks", ["workspace"]],
  ["workspace_settings", ["workspace"]],
  ["workspace_passwords", ["workspace"]],
  ["notifications", ["id"]],
  ["security_logs", ["id"]],
];

// ── Helpers ─────────────────────────────────────────────────────────────────

const sha256 = (s) => crypto.createHash("sha256").update(s, "utf8").digest("hex");
const isSha256 = (s) => typeof s === "string" && /^[0-9a-f]{64}$/.test(s);

/** Deterministic UUID (v5-style, SHA-1) — the same input always gives the same id. */
export function stableUuid(key) {
  const h = crypto.createHash("sha1").update(`hermes-migration:${key}`).digest("hex");
  const variant = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

const iso = (ms) => (ms == null || !Number.isFinite(Number(ms)) ? null : new Date(Math.floor(Number(ms))).toISOString());

// Offset (ms) of a time zone from UTC at a given instant.
function tzOffsetMs(ts, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(new Date(ts)).map((p) => [p.type, p.value])
  );
  return Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second) - Math.floor(ts / 1000) * 1000;
}

/** "4/7/2026, 8:27:36 PM" / "4/18/2026, 05:57 PM" (America/New_York) → epoch ms, or null. */
export function parseLegacyDate(text, timeZone = "America/New_York") {
  const m = String(text || "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}),\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AP]M)$/i);
  if (!m) return null;
  let [, mo, d, y, h, mi, s = "0", ap] = m;
  h = (+h % 12) + (ap.toUpperCase() === "PM" ? 12 : 0);
  const guess = Date.UTC(+y, +mo - 1, +d, h, +mi, +s);
  let utc = guess - tzOffsetMs(guess, timeZone);
  const second = guess - tzOffsetMs(utc, timeZone); // DST edge correction
  if (second !== utc) utc = second;
  return utc;
}

/** Undo the old reversible "obf_" + reversed-base64 masking. */
function deobfuscate(s) {
  if (typeof s !== "string" || !s.trim().startsWith("obf_")) return s ?? null;
  const b64 = s.trim().slice(4).split("").reverse().join("").replace(/[^A-Za-z0-9+/=]/g, "");
  return Buffer.from(b64, "base64").toString("utf8");
}

function readTable(dir, table) {
  const f = path.join(dir, table, "documents.jsonl");
  if (!fs.existsSync(f)) return [];
  return fs.readFileSync(f, "utf8").split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
}

function validWorkspace(ws, where) {
  const w = ws || "workforce";
  if (!WORKSPACES.includes(w)) throw new Error(`${where}: unknown workspace "${ws}"`);
  return w;
}

/**
 * One-per-workspace tables (handbook, appConfig) can hold a legacy UNTAGGED
 * row next to a tagged "workforce" one. The live app only ever read the
 * tagged row (index lookup on workspace), so that one wins; an untagged row is
 * used only when no tagged row exists. Ties → most recently updated.
 */
function onePerWorkspace(docs, table, warnings) {
  const pick = new Map();
  for (const d of docs) {
    const ws = validWorkspace(d.workspace, table);
    const cur = pick.get(ws);
    const score = (x) => [x.workspace ? 1 : 0, x.updatedAt ?? x._creationTime ?? 0];
    const better = !cur || (() => { const [a1, a2] = score(d), [b1, b2] = score(cur); return a1 !== b1 ? a1 > b1 : a2 > b2; })();
    if (cur) warnings.push(`${table}: two rows for "${ws}" — keeping the ${better ? "newer/tagged" : "existing"} one (${(better ? d : cur)._id}), skipping ${(better ? cur : d)._id}`);
    if (better) pick.set(ws, d);
  }
  return [...pick.values()];
}

// ── Transform: Convex export → rows per Supabase table ──────────────────────

export function buildRows(dir) {
  const out = Object.fromEntries(TABLES.map(([t]) => [t, []]));
  const warnings = [];

  // Staff + credentials
  const staff = readTable(dir, "staff");
  const staffIdByEmail = new Map();
  for (const s of staff) {
    const email = String(s.email).trim().toLowerCase();
    if (!ROLES.includes(s.role)) throw new Error(`staff ${email}: unknown role "${s.role}"`);
    staffIdByEmail.set(email, s._id);
    const depts = Array.isArray(s.departments) ? s.departments : ["Workforce"]; // getStaff's default
    out.staff.push({
      id: s._id, email, name: s.name, role: s.role,
      departments: depts.filter((d) => DEPARTMENTS.includes(d)),
      avatar_url: s.avatarUrl ?? null, bio: s.bio ?? null, country: s.country ?? null, status: s.status ?? null,
      created_at: iso(s._creationTime),
    });
    if (s.password || s.securityQuestion || s.securityAnswer) {
      out.staff_credentials.push({
        staff_id: s._id,
        password_hash: s.password ? (isSha256(s.password) ? s.password : sha256(s.password)) : null,
        security_question: s.securityQuestion ?? null,
        security_answer_hash: s.securityAnswer ? sha256(String(s.securityAnswer).trim().toLowerCase()) : null,
        updated_at: new Date().toISOString(),
      });
    }
  }

  for (const h of readTable(dir, "heartbeats")) {
    out.presence.push({ email: String(h.email).toLowerCase(), last_seen_at: iso(h.lastSeen) });
  }

  // Tasks and everything nested in them
  const tasks = readTable(dir, "tasks");
  const taskIds = new Set(tasks.map((t) => t._id));
  for (const t of tasks) {
    const created = Math.floor(t._creationTime);
    out.tasks.push({
      id: t._id,
      workspace: validWorkspace(t.workspace, `task ${t._id}`),
      title: t.title, status: t.status || "todo", assignee: t.assignee || "", description: t.description || "",
      start_date: /^\d{4}-\d{2}-\d{2}$/.test(t.startDate || "") ? t.startDate : null,
      project_link: t.projectLink || null, appscript_link: t.appscriptLink || null, webapp_link: t.webappLink || null,
      is_prioritized: !!t.isPrioritized,
      deadline_override: iso(t.deadlineOverride), pending_started_at: iso(t.pendingStartedAt),
      manager_late_notified_at: iso(t.managerLateNotifiedAt), manager_stale_notified_at: iso(t.managerStaleNotifiedAt),
      last_updated_at: iso(t.lastUpdated ?? created), created_at: iso(created),
    });

    if (t.adminCredentials) {
      out.task_credentials.push({
        task_id: t._id,
        login_email: deobfuscate(t.adminCredentials.email) || null,
        login_password: deobfuscate(t.adminCredentials.password) || null,
        updated_at: new Date().toISOString(),
      });
    }

    (t.milestones || []).forEach((m, i) => {
      const completedAt = m.completedAtTime ?? (m.completed && m.completedAt ? parseLegacyDate(m.completedAt) : null);
      if (m.completed && m.completedAt && completedAt == null) warnings.push(`unparsed milestone date "${m.completedAt}" (task ${t._id})`);
      out.task_milestones.push({
        id: stableUuid(`ms:${t._id}:${i}`), task_id: t._id, position: i,
        name: m.name, days: Math.max(0, Math.round(Number(m.days) || 0)), completed: !!m.completed,
        completed_at: m.completed ? iso(completedAt) : null, created_at: iso(m.createdAtTime),
      });
    });

    (t.notes || []).forEach((n, i) => {
      const noteId = stableUuid(`note:${t._id}:${i}`);
      const at = n.timestamp ?? parseLegacyDate(n.date);
      if (at == null) warnings.push(`unparsed note date "${n.date}" (task ${t._id}) — using task creation time`);
      out.task_notes.push({
        id: noteId, task_id: t._id, position: i, text: n.text ?? "", writer: n.writer || null,
        created_at: iso(at ?? created),
      });
      (n.replies || []).forEach((r, j) => {
        out.note_replies.push({
          id: stableUuid(`reply:${noteId}:${j}`), note_id: noteId, position: j, text: r.text ?? "",
          writer: r.writer || "Unknown", created_at: iso(r.timestamp ?? parseLegacyDate(r.date) ?? at ?? created),
        });
      });
      for (const [reaction, emails] of Object.entries(n.reactions || {})) {
        for (const e of new Set((emails || []).map((x) => String(x).toLowerCase()))) {
          out.note_reactions.push({ note_id: noteId, user_email: e, reaction, created_at: iso(at ?? created) });
        }
      }
    });

    (t.features || []).forEach((f, i) => {
      if (!["pending", "completed", undefined, null, ""].includes(f.status)) throw new Error(`feature ${f.id}: unknown status "${f.status}"`);
      const createdAt = f.createdAtTime ?? parseLegacyDate(f.createdAt);
      const completedAt = f.status === "completed" ? (f.completedAtTime ?? parseLegacyDate(f.completedAt)) : null;
      out.task_features.push({
        id: f.id, task_id: t._id, position: i, type: f.type === "bug" ? "bug" : "feature",
        name: f.name, description: f.description || "", status: f.status === "completed" ? "completed" : "pending",
        suggested_by: f.suggestedBy || null, created_at: iso(createdAt), completed_at: iso(completedAt),
      });
      (f.imageStorageIds || []).forEach((sid, k) => {
        out.feature_images.push({
          id: stableUuid(`img:${f.id}:${k}`), feature_id: f.id, position: k,
          storage_path: null /* filled in from the file list below */, legacy_storage_id: sid,
        });
      });
    });
  }

  for (const v of readTable(dir, "taskViewHistory")) {
    if (!taskIds.has(v.taskId)) { warnings.push(`view history for missing task ${v.taskId} skipped`); continue; }
    out.task_views.push({ task_id: v.taskId, user_email: String(v.userEmail).toLowerCase(), last_viewed_at: iso(v.lastViewedAt) });
  }

  for (const n of readTable(dir, "notebook")) {
    out.notebook_ideas.push({
      id: n._id, workspace: validWorkspace(n.workspace, `idea ${n._id}`), name: n.name, description: n.description || "",
      pros: n.pros || "", cons: n.cons || "", details: n.details || "", taker: n.taker || null, created_at: iso(n._creationTime),
    });
  }

  for (const a of readTable(dir, "announcements")) {
    out.announcements.push({
      id: a._id, workspace: validWorkspace(a.workspace, `announcement ${a._id}`), title: a.title, body: a.body,
      posted_by: a.postedBy, posted_by_email: String(a.postedByEmail).toLowerCase(), created_at: iso(a.createdAt ?? a._creationTime),
    });
    for (const e of new Set((a.seenBy || []).map((x) => String(x).toLowerCase()))) {
      out.announcement_views.push({ announcement_id: a._id, user_email: e, seen_at: iso(a.createdAt ?? a._creationTime) });
    }
  }

  for (const h of onePerWorkspace(readTable(dir, "handbook"), "handbook", warnings)) {
    out.handbooks.push({
      workspace: validWorkspace(h.workspace, "handbook"), blocks: h.blocks || [],
      updated_at: iso(h.updatedAt ?? h._creationTime), updated_by: h.updatedBy || null,
    });
  }

  for (const c of onePerWorkspace(readTable(dir, "appConfig"), "appConfig", warnings)) {
    const ws = validWorkspace(c.workspace, "appConfig");
    out.workspace_settings.push({
      workspace: ws, production_deadline: iso(c.productionDeadline),
      default_milestones: c.defaultMilestones ?? null, columns: c.columns ?? null,
      updated_at: iso(c.updatedAt ?? c._creationTime), updated_by: c.updatedBy || null,
    });
    if (c.workspacePasswordHash) {
      out.workspace_passwords.push({ workspace: ws, password_hash: c.workspacePasswordHash, updated_at: iso(c.updatedAt ?? c._creationTime) });
    }
  }

  for (const n of readTable(dir, "notifications")) {
    out.notifications.push({
      id: n._id, workspace: validWorkspace(n.workspace, `notification ${n._id}`), type: n.type,
      target_email: String(n.targetEmail).toLowerCase(), actor_email: n.actorEmail, actor_name: n.actorName,
      message: n.message, task_id: n.taskId && taskIds.has(n.taskId) ? n.taskId : null, task_title: n.taskTitle ?? null,
      read: !!n.read, created_at: iso(n.createdAt ?? n._creationTime),
    });
  }

  for (const l of readTable(dir, "securityLogs")) {
    out.security_logs.push({
      id: l._id, action: l.action, user_email: l.userEmail, target_email: l.targetEmail,
      details: l.details ?? null, ip: l.ip ?? null, created_at: iso(l.timestamp ?? l._creationTime),
    });
  }

  // Storage files: <export>/_storage/<id>.<ext>, metadata in _storage/documents.jsonl
  const storageMeta = new Map(readTable(dir, "_storage").map((s) => [s._id, s]));
  const storageDir = path.join(dir, "_storage");
  const files = (fs.existsSync(storageDir) ? fs.readdirSync(storageDir) : [])
    .filter((f) => f !== "documents.jsonl")
    .map((f) => {
      const id = f.replace(/\.[^.]+$/, "");
      return { id, file: path.join(storageDir, f), storagePath: f, contentType: storageMeta.get(id)?.contentType || "application/octet-stream" };
    });
  const pathById = new Map(files.map((f) => [f.id, f.storagePath]));
  out.feature_images = out.feature_images.filter((img) => {
    img.storage_path = pathById.get(img.legacy_storage_id);
    if (!img.storage_path) warnings.push(`feature image ${img.legacy_storage_id} has no file in the export — skipped`);
    return !!img.storage_path;
  });

  return { rows: out, files, warnings };
}

// ── Supabase (REST, service role) ───────────────────────────────────────────

function loadEnv() {
  const env = { ...process.env };
  const f = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", ".env.local");
  if (fs.existsSync(f)) {
    for (const line of fs.readFileSync(f, "utf8").split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && env[m[1]] === undefined) env[m[1]] = m[2].trim().replace(/^"|"$/g, "");
    }
  }
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (in .env.local).");
  return { url: env.SUPABASE_URL.replace(/\/$/, ""), key: env.SUPABASE_SERVICE_ROLE_KEY };
}

function client({ url, key }) {
  const headers = { apikey: key, Authorization: `Bearer ${key}` };
  async function req(method, p, { body, extraHeaders = {}, raw = false } = {}) {
    const res = await fetch(`${url}${p}`, {
      method,
      headers: { ...headers, ...(body !== undefined && !raw ? { "Content-Type": "application/json" } : {}), ...extraHeaders },
      body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${method} ${p} → ${res.status}: ${text.slice(0, 400)}`);
    return { res, data: text ? (() => { try { return JSON.parse(text); } catch { return text; } })() : null };
  }
  return {
    async upsert(table, rows, conflict) {
      for (let i = 0; i < rows.length; i += 200) {
        await req("POST", `/rest/v1/${table}?on_conflict=${conflict.join(",")}`, {
          body: rows.slice(i, i + 200),
          extraHeaders: { Prefer: "resolution=merge-duplicates,return=minimal" },
        });
      }
    },
    async keys(table, conflict) {
      const { data } = await req("GET", `/rest/v1/${table}?select=${conflict.join(",")}&limit=100000`);
      return data;
    },
    async remove(table, conflict, key) {
      const filter = conflict.map((c) => `${c}=eq.${encodeURIComponent(key[c])}`).join("&");
      await req("DELETE", `/rest/v1/${table}?${filter}`);
    },
    async count(table) {
      const { res } = await req("HEAD", `/rest/v1/${table}?select=*`, { extraHeaders: { Prefer: "count=exact" } });
      return Number((res.headers.get("content-range") || "").split("/")[1] || 0);
    },
    async ensureBucket(name) {
      const { data } = await req("GET", "/storage/v1/bucket");
      if (!data.some((b) => b.name === name)) {
        await req("POST", "/storage/v1/bucket", { body: { id: name, name, public: false } });
        return "created";
      }
      return "exists";
    },
    async upload(bucket, objectPath, filePath, contentType) {
      await req("POST", `/storage/v1/object/${bucket}/${objectPath}`, {
        body: fs.readFileSync(filePath), raw: true,
        extraHeaders: { "Content-Type": contentType, "x-upsert": "true" },
      });
    },
    async listObjects(bucket) {
      const { data } = await req("POST", `/storage/v1/object/list/${bucket}`, { body: { prefix: "", limit: 10000 } });
      return data;
    },
  };
}

// ── Main ────────────────────────────────────────────────────────────────────

function resolveExport(input) {
  if (!input) throw new Error("Usage: node scripts/migrate-convex-to-supabase.mjs <export.zip | unzipped dir> [--dry-run] [--prune]");
  if (fs.statSync(input).isDirectory()) return { dir: input, cleanup: () => {} };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "convex-export-"));
  // bsdtar reads .zip. On Windows use the system one — Git Bash's GNU tar can't.
  const winTar = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe");
  execFileSync(process.platform === "win32" && fs.existsSync(winTar) ? winTar : "tar", ["-xf", input, "-C", dir]);
  // The unzipped copy holds password hashes — always remove it afterwards.
  return { dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

async function main() {
  const args = process.argv.slice(2);
  const { dir, cleanup } = resolveExport(args.find((a) => !a.startsWith("--")));
  try {
    await migrate(dir, { dryRun: args.includes("--dry-run"), prune: args.includes("--prune") });
  } finally {
    cleanup();
  }
}

async function migrate(dir, { dryRun, prune }) {
  const { rows, files, warnings } = buildRows(dir);

  console.log("Rows to migrate:");
  for (const [t] of TABLES) console.log(`  ${t.padEnd(20)} ${rows[t].length}`);
  console.log(`  ${"storage files".padEnd(20)} ${files.length}`);
  warnings.forEach((w) => console.warn("  ! " + w));
  if (dryRun) return console.log("\nDry run — nothing written.");

  const sb = client(loadEnv());
  console.log(`\nBucket "${BUCKET}": ${await sb.ensureBucket(BUCKET)}`);
  for (const f of files) await sb.upload(BUCKET, f.storagePath, f.file, f.contentType);
  console.log(`Uploaded ${files.length} files.`);

  // Prune BEFORE loading: a stale row can share a unique key (e.g. a staff
  // email) with an incoming row that has a different id. Children first
  // (reverse FK order) so parents can be removed cleanly.
  if (prune) {
    for (const [t, conflict] of [...TABLES].reverse()) {
      const want = new Set(rows[t].map((r) => conflict.map((c) => String(r[c])).join("|")));
      const stale = (await sb.keys(t, conflict)).filter((k) => !want.has(conflict.map((c) => String(k[c])).join("|")));
      for (const k of stale) await sb.remove(t, conflict, k);
      if (stale.length) console.log(`Pruned ${stale.length} stale row(s) from ${t}.`);
    }
  }

  for (const [t, conflict] of TABLES) {
    if (rows[t].length) await sb.upsert(t, rows[t], conflict);
  }
  console.log("Upserted all tables.");

  console.log("\nVerify (Supabase row count vs export):");
  let ok = true;
  for (const [t] of TABLES) {
    const n = await sb.count(t);
    const match = prune ? n === rows[t].length : n >= rows[t].length;
    ok &&= match;
    console.log(`  ${match ? "✓" : "✗"} ${t.padEnd(20)} ${n} / ${rows[t].length}`);
  }
  const objects = await sb.listObjects(BUCKET);
  const haveAll = files.every((f) => objects.some((o) => o.name === f.storagePath));
  ok &&= haveAll;
  console.log(`  ${haveAll ? "✓" : "✗"} ${"storage files".padEnd(20)} ${objects.length} / ${files.length}`);
  console.log(ok ? "\nMigration complete ✓" : "\nSome counts don't match — check the output above.");
  if (!ok) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((e) => { console.error(e.message || e); process.exit(1); });
}
