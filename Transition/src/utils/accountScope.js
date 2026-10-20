// Client-account access (Operations): everyone below Admin+ only sees their
// own accounts' projects (plus projects they're assigned to). With NO account
// they're locked out until an Admin+ or Manager adds them to one. The
// database enforces it; this just lets screens match.
import { useQuery } from "../data/react";
import { api } from "../data/api";
import { usesAccounts } from "./workspaceTerms";
import { isAdminPlusOrAbove } from "./roles";

export function useAccountScope(workspace, actualRole) {
  const on = usesAccounts(workspace);
  const rows = useQuery(api.accounts.getStaffAccounts, on ? { workspace } : "skip");
  const me = (localStorage.getItem("wf_email") || "").toLowerCase();
  const accountIds = on ? (rows || []).filter((r) => r.email === me).map((r) => r.accountId) : [];
  const scoped = on && !isAdminPlusOrAbove(actualRole);
  // rows === undefined while loading — don't flash the "locked" notice.
  return { scoped, accountIds, locked: scoped && rows !== undefined && accountIds.length === 0 };
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
  const { scoped, accountIds, locked } = useAccountScope(workspace, actualRole);
  const on = usesAccounts(workspace);
  const full = on && isAdminPlusOrAbove(actualRole) && userRole !== "Programmer";
  const show = on && (full || accountIds.length > 1);
  const limit = (list) => (full ? list || [] : (list || []).filter((a) => accountIds.includes(a._id)));
  return { on, full, show, scoped, locked, accountIds, limit };
}
