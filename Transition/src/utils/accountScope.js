// Client-account access (Operations): someone tied to accounts — and below
// Admin+ — only sees those accounts' projects. The database enforces it; this
// just lets screens match (e.g. no "No account" choice for them).
import { useQuery } from "../data/react";
import { api } from "../data/api";
import { usesAccounts } from "./workspaceTerms";
import { isAdminPlusOrAbove } from "./roles";

export function useAccountScope(workspace, actualRole) {
  const on = usesAccounts(workspace);
  const rows = useQuery(api.accounts.getStaffAccounts, on ? { workspace } : "skip");
  const me = (localStorage.getItem("wf_email") || "").toLowerCase();
  const accountIds = on ? (rows || []).filter((r) => r.email === me).map((r) => r.accountId) : [];
  return { scoped: on && !isAdminPlusOrAbove(actualRole) && accountIds.length > 0, accountIds };
}

/**
 * Should this screen show client accounts at all, and which?
 * - Admin+ and Managers (in their admin view) see every account.
 * - Everyone else — Users and Admins, and an Admin+ previewing the User
 *   view — only sees account controls when they're tied to SEVERAL accounts,
 *   and then only those accounts. With one account (or none) there's nothing
 *   to choose, so the account UI stays out of the way.
 */
export function useAccountUi(workspace, actualRole, userRole) {
  const { scoped, accountIds } = useAccountScope(workspace, actualRole);
  const on = usesAccounts(workspace);
  const full = on && isAdminPlusOrAbove(actualRole) && userRole !== "Programmer";
  const show = on && (full || accountIds.length > 1);
  const limit = (list) => (full ? list || [] : (list || []).filter((a) => accountIds.includes(a._id)));
  return { on, full, show, scoped, accountIds, limit };
}
