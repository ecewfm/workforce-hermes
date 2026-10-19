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
