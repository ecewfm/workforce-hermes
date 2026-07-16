/**
 * Department & workspace model — the SECOND, orthogonal RBAC axis.
 *
 * This is intentionally kept separate from src/utils/roles.js:
 *   • roles.js  — ACCESS TYPE (Programmer/Admin/Admin+/Manager): *what* a user
 *                 can do (edit cards, see admin views, edit defaults). GLOBAL —
 *                 a user's access type is the same in every workspace.
 *   • this file — DEPARTMENT + WORKSPACE: *which* workspaces a user may enter
 *                 and *which* data rows they see.
 *
 * A "workspace" is a fully data-isolated space. Each workspace has its own
 * Kanban tasks, notebook, announcements, handbook, and config — but the exact
 * same UI. The set is fixed (mirrors the three departments), so it's a string
 * enum rather than a dynamic table.
 *
 * NOTE ON NAMING: the codebase historically used "workspace" to mean the whole
 * org (e.g. appConfig "workspace-wide config", the Settings "Workspace Defaults"
 * tab). That config is now genuinely per-workspace, so the old label is now
 * literally correct. "workspace" appears only in comments/labels historically —
 * never as an identifier — so the new field/state below introduces no clash.
 */

// Department labels stored on staff.departments (human-facing, capitalized).
export const DEPARTMENTS = ["Executives", "Operations", "Workforce"];

// Workspace enum values stamped on every data row (lowercase keys).
export const WORKSPACES = ["executives", "operations", "workforce"];

// The default/fallback workspace. All pre-existing (un-tagged) data lives here,
// so WFM keeps everything it had before workspaces existed.
export const DEFAULT_WORKSPACE = "workforce";

// Human-facing metadata for each workspace (labels, ordering, blurb).
export const WORKSPACE_META = {
  executives: { key: "executives", label: "Executives", department: "Executives", blurb: "Executive leadership space" },
  operations: { key: "operations", label: "Operations", department: "Operations", blurb: "Operations department space" },
  workforce: { key: "workforce", label: "Workforce", department: "Workforce", blurb: "Workforce Management space" },
};

/**
 * Access model (per stakeholder decision):
 *   • Executives → all workspaces
 *   • Workforce  → all workspaces
 *   • Operations → the Operations workspace only
 * Each department grants access to the list of workspaces below.
 */
const DEPARTMENT_ACCESS = {
  Executives: ["executives", "operations", "workforce"],
  Workforce: ["executives", "operations", "workforce"],
  Operations: ["operations"],
};

/** The Main Admin implicitly has all-access regardless of department tags. */
export const MAIN_ADMIN_EMAIL = "wmt@ececontactcenters.com";

/** Normalize whatever is stored on staff.departments into a clean array. */
export function normalizeDepartments(departments) {
  if (!departments) return [];
  if (Array.isArray(departments)) return departments.filter(Boolean);
  if (typeof departments === "string") return [departments];
  return [];
}

/**
 * The workspaces a user may enter, given their departments (and email for the
 * Main Admin all-access rule). Returned in canonical WORKSPACES order.
 */
export function accessibleWorkspaces(departments, email) {
  if (email && email.toLowerCase() === MAIN_ADMIN_EMAIL) return [...WORKSPACES];
  const set = new Set();
  for (const dept of normalizeDepartments(departments)) {
    (DEPARTMENT_ACCESS[dept] || []).forEach((w) => set.add(w));
  }
  return WORKSPACES.filter((w) => set.has(w));
}

/** Whether a user (by departments/email) may access a given workspace key. */
export function canAccessWorkspace(departments, email, workspace) {
  return accessibleWorkspaces(departments, email).includes(workspace);
}

/** True when a user belongs to a given department label. */
export function isInDepartment(departments, dept) {
  return normalizeDepartments(departments).includes(dept);
}

/** Display label for a workspace key (falls back to the key itself). */
export function workspaceLabel(workspace) {
  return WORKSPACE_META[workspace]?.label || workspace || "";
}

/** True if the value is a recognized workspace key. */
export function isValidWorkspace(workspace) {
  return WORKSPACES.includes(workspace);
}
