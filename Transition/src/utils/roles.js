/**
 * Role model & permission helpers.
 *
 * Hierarchy (ascending power):
 *   Programmer  →  Admin  →  Admin+  →  Manager
 *
 * "Manager" is the top role: it can do everything Admin+ can, plus unrestricted
 * card editing (Admin/Admin+ can only edit cards they're assigned to; a Manager
 * can edit ANY card). Use these helpers instead of inline string comparisons so
 * permission rules stay consistent across the app.
 *
 * Note on the two role values used in the UI:
 *   • actualRole — the user's real role from the database (use for permissions)
 *   • userRole   — the currently *viewed* role (Admin/Admin+/Manager all view as
 *                  "Admin" by default and can switch to the "Programmer" view)
 */

export const ROLES = {
  PROGRAMMER: "Programmer",
  ADMIN: "Admin",
  ADMIN_PLUS: "Admin+",
  MANAGER: "Manager",
};

// Roles an admin can assign in the staff-management dropdowns (ascending power).
export const ASSIGNABLE_ROLES = ["Programmer", "Admin", "Admin+", "Manager"];

export function isManager(role) {
  return role === "Manager";
}

/**
 * Admin+ OR Manager. Use for anything previously gated to Admin+:
 * announcements, handbook editing, workspace defaults, staff management,
 * production-deadline editing, etc.
 */
export function isAdminPlusOrAbove(role) {
  return role === "Admin+" || role === "Manager";
}

/** Any administrative role — sees admin views and manages tasks. */
export function isAdminLevel(role) {
  return role === "Admin" || role === "Admin+" || role === "Manager";
}

/**
 * Managers bypass the "assignee only" restriction that limits Admin/Admin+ to
 * editing cards they're assigned to. A Manager can edit any card.
 */
export function canEditAnyCard(role) {
  return role === "Manager";
}

/**
 * The role's default "viewed" role. Admin+/Manager land in the Admin view (and
 * can switch to the Programmer view); everyone else views as themselves.
 */
export function defaultViewRole(role) {
  return isAdminPlusOrAbove(role) ? "Admin" : role;
}

/** Label shown on the header role badge. */
export function roleBadgeLabel(actualRole, userRole) {
  if (actualRole === "Manager") return "Manager";
  if (actualRole === "Admin+") return "Admin+";
  return userRole;
}
