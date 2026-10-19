// Per-workspace Kanban column configuration.
//
// A column is { id, label, color, limit? }:
//   • id    — stable status key stored on each task (task.status === column.id)
//   • label — display name (editable by managers)
//   • color — hex accent for the column header / top border / totals value
//   • limit — optional WIP cap (max tasks); the board flags a column that's over
//
// Managers edit these per workspace in Settings → Workspace Defaults. When no
// custom config is saved, the board falls back to DEFAULT_COLUMNS below so
// existing boards are unchanged.

export const DEFAULT_COLUMNS = [
  { id: "todo", label: "To Do", color: "#065f46" },
  { id: "pending", label: "Pending", color: "#10b981" },
  { id: "development", label: "In Development", color: "#059669" },
  { id: "testing", label: "In Testing", color: "#34d399" },
  { id: "done", label: "Done", color: "#064e3b" },
  { id: "implemented", label: "Implemented", color: "#047857" },
  { id: "scrapped", label: "Scrapped Yard", color: "#94a3b8" },
];

// Operations / Executives: business projects, not software releases.
export const OPERATIONS_COLUMNS = [
  { id: "todo", label: "To Do", color: "#065f46" },
  { id: "pending", label: "Pending", color: "#10b981" },
  { id: "development", label: "Work In Progress", color: "#059669" },
  { id: "done", label: "Done", color: "#064e3b" },
  { id: "scrapped", label: "Archived", color: "#94a3b8" },
];
export const EXECUTIVES_COLUMNS = [
  { id: "todo", label: "To Do", color: "#065f46" },
  { id: "pending", label: "Pending", color: "#10b981" },
  { id: "development", label: "Work In Progress", color: "#059669" },
  { id: "done", label: "Done", color: "#064e3b" },
  { id: "implemented", label: "Implemented", color: "#047857" },
  { id: "scrapped", label: "Archived", color: "#94a3b8" },
];

/** The built-in columns for a workspace (what "Restore Default Columns" brings back). */
export function defaultColumnsFor(workspace) {
  const src = workspace === "operations" ? OPERATIONS_COLUMNS : workspace === "executives" ? EXECUTIVES_COLUMNS : DEFAULT_COLUMNS;
  return src.map((c) => ({ ...c }));
}

/** Archived projects (right-click → Archive, or Delete) carry this status. */
export const ARCHIVED_STATUS = "scrapped";

// Palette offered when a manager adds/recolors a column.
export const COLUMN_COLOR_PRESETS = [
  "#065f46", "#10b981", "#059669", "#34d399", "#047857",
  "#0ea5e9", "#6366f1", "#8b5cf6", "#f59e0b", "#ef4444", "#ec4899", "#94a3b8",
];

// The status the "development" column historically also matched. Kept so old
// tasks stored as "inprogress" still land in a development-style column.
// "scrapyard" was the old archive status (now "scrapped" everywhere).
export const LEGACY_STATUS_ALIASES = { development: ["inprogress"], scrapped: ["scrapyard"] };

/** Is this an archived project's status? */
export const isArchivedStatus = (status) => statusesForColumn(ARCHIVED_STATUS).includes((status || "").toLowerCase());

/**
 * Resolve the columns to render for a workspace: the saved config if present
 * and non-empty, otherwise that workspace's defaults. Always returns a sanitized array of
 * { id, label, color, limit }.
 */
export function resolveColumns(configColumns, workspace) {
  const src = Array.isArray(configColumns) && configColumns.length > 0 ? configColumns : defaultColumnsFor(workspace);
  return src
    .filter((c) => c && c.id)
    .map((c) => ({
      id: String(c.id),
      label: c.label || c.id,
      color: c.color || "#10b981",
      limit: typeof c.limit === "number" && c.limit > 0 ? c.limit : undefined,
    }));
}

/** Statuses a given column should collect (its id plus any legacy aliases). */
export function statusesForColumn(columnId) {
  return [columnId, ...(LEGACY_STATUS_ALIASES[columnId] || [])];
}

/** Does a task's status belong in this column? */
export function taskInColumn(status, columnId) {
  const s = (status || "").toLowerCase();
  return statusesForColumn(columnId).includes(s);
}

// Generate a stable-ish id for a newly created column from its label.
export function makeColumnId(label, existingIds = []) {
  const base = (label || "column")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24) || "column";
  let id = base;
  let n = 2;
  while (existingIds.includes(id)) id = `${base}-${n++}`;
  return id;
}
