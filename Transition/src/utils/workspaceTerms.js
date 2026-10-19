/**
 * What each workspace calls things.
 *
 * Hermes started as the programming team's tracker (the "workforce"
 * workspace), so its original vocabulary is software: features and bugs,
 * Appscript/Webapp "system links", an API panel, project admin logins, a
 * "Programmer" access type. Operations and Executives run business projects,
 * so the same screens speak their language instead:
 *   • features & bugs  → Roadblocks (one list: what's blocking progress)
 *   • system links     → Documents (any number of named links)
 *   • API access / project admin logins → hidden
 *   • "Programmer"     → "User" (same access type; Admin, Admin+ and Manager keep their names)
 *   • Operations projects belong to a client Account (Admin+ manage the list)
 *
 * Use these helpers instead of checking workspace ids inline.
 */
import { WORKSPACE_META } from "./departments";

/** The programming team's workspace (the original, technical vocabulary). */
export const isTechWorkspace = (ws) => !ws || ws === "workforce";

/** Workspaces whose projects are tagged with a client account. */
export const usesAccounts = (ws) => ws === "operations";

/** Words for each kind of sidebar item (task_features.type). */
export const ITEM_WORDS = {
  feature: {
    kind: "feature", one: "feature", many: "features", title: "Feature", heading: "Features", tab: "Features",
    add: "Add Feature", nameLabel: "Feature Name", placeholder: "e.g. Advanced Analytics",
    describe: "Describe the feature...", by: "Suggested By", open: "PENDING", done: "COMPLETED", empty: "No features added yet.",
  },
  bug: {
    kind: "bug", one: "bug", many: "bugs", title: "Bug", heading: "Bug Reports", tab: "Bugs",
    add: "Report Bug", nameLabel: "Bug Name", placeholder: "e.g. Broken login button",
    describe: "Describe the bug...", by: "Reported By", open: "PENDING", done: "COMPLETED", empty: "No bugs added yet.",
  },
  roadblock: {
    kind: "roadblock", one: "roadblock", many: "roadblocks", title: "Roadblock", heading: "Roadblocks", tab: "Roadblocks",
    add: "Add Roadblock", nameLabel: "What's blocking progress?", placeholder: "e.g. Waiting on client sign-off",
    describe: "What's blocked, who can unblock it, and what's needed...", by: "Raised By", open: "OPEN", done: "CLEARED",
    empty: "No roadblocks — nothing is in the way.",
  },
};

export const itemWords = (kind) => ITEM_WORDS[kind] || ITEM_WORDS.feature;

/** Everything a screen needs to know to speak a workspace's language. */
export function termsFor(ws) {
  const tech = isTechWorkspace(ws);
  const label = WORKSPACE_META[ws]?.label || "Workforce";
  return {
    tech,
    label,
    accounts: usesAccounts(ws),
    appSubtitle: tech ? "Workforce Programming Project Database" : `${label} Project Database`,
    handbookTitle: tech ? "Programming Handbook" : `${label} Handbook`,
    /** Item kinds the task sidebar offers, in tab order. */
    itemKinds: tech ? ["feature", "bug"] : ["roadblock"],
    /** Display name of the "Programmer" access type here. */
    memberRole: tech ? "Programmer" : "User",
    links: tech ? "System Links" : "Documents",
    projectLinks: tech ? "Project Links" : "Project Documents",
    showApiAccess: tech,
    showAdminCredentials: tech,
    workload: tech ? "Programmer Workload" : "Team Workload",
  };
}

/** A role as shown to people in this workspace (stored values never change). */
export function roleLabel(role, ws) {
  return role === "Programmer" && !isTechWorkspace(ws) ? "User" : role;
}
