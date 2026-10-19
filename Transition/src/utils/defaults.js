/**
 * Built-in fallback milestone templates, PER WORKSPACE.
 *
 * The live milestone template is stored in Convex (appConfig.defaultMilestones,
 * editable by Admin+ under Settings → Workspace Defaults). These constants are
 * the fallback used before the config loads or when a workspace hasn't saved
 * one yet — and what "Restore Original" resets to. Use fallbackMilestonesFor()
 * rather than picking a constant directly.
 *
 * Mirrored server-side in convex/notebook.ts (used when a notebook idea is
 * turned into a project) — keep the two in sync.
 */

// Workforce (WFM web developers) — software delivery lifecycle, 180 days.
export const FALLBACK_MILESTONES = [
  { name: "Project Planning & Design", days: 22 },
  { name: "Project Setup & Database", days: 6 },
  { name: "Core Feature Development (Phase 1)", days: 25 },
  { name: "Core Feature Development (Phase 2)", days: 20 },
  { name: "API Integration", days: 8 },
  { name: "Internal Testing & Bug Fixes", days: 15 },
  { name: "User Testing & Refinement", days: 20 },
  { name: "Final Polish & Optimization", days: 15 },
  { name: "Deployment & Soft Launch", days: 17 },
  { name: "Post-Launch Support", days: 22 },
];

// Operations — a GENERAL rollout lifecycle that fits any kind of operations
// project (SOP/process change, campaign launch, tool rollout, training program,
// staffing change, audit, event…). 8 steps, 56 days (~8 weeks) — a medium-sized
// initiative; the AI planner tailors this per task, this is the no-AI default.
// `hint` explains what each generic step means so it's easy to apply to any
// project (shown in New Task; not stored on the task).
export const OPERATIONS_FALLBACK_MILESTONES = [
  { name: "Scope & Goals", days: 5, hint: "Agree the problem, the goal, how success will be measured, and who's involved." },
  { name: "Plan & Design", days: 7, hint: "Map the approach: the steps or process, owners, resources, timeline and budget." },
  { name: "Review & Sign-off", days: 3, hint: "Walk the leads and stakeholders through the plan and get approval to proceed." },
  { name: "Prepare & Set Up", days: 7, hint: "Get everything ready: tools, templates, SOPs, schedules, access and materials." },
  { name: "Pilot / Test Run", days: 10, hint: "Try it small (one team, site or shift) for about two weeks and fix what breaks." },
  { name: "Train & Communicate", days: 5, hint: "Train the people affected and announce what's changing, when, and why." },
  { name: "Go-Live / Full Rollout", days: 5, hint: "Launch for everyone in scope — in waves by site or team if it's large." },
  { name: "Monitor & Hand Over", days: 14, hint: "Track results against the goal, fix gaps, document it, and hand it to the day-to-day owner." },
];

const FALLBACKS_BY_WORKSPACE = {
  workforce: FALLBACK_MILESTONES,
  operations: OPERATIONS_FALLBACK_MILESTONES,
};

/** The built-in default template for a workspace (fresh copies, safe to mutate). */
export function fallbackMilestonesFor(workspace) {
  return (FALLBACKS_BY_WORKSPACE[workspace] || FALLBACK_MILESTONES).map((m) => ({ ...m }));
}

/**
 * Re-attach the built-in `hint` text to template rows by milestone name. Saved
 * templates only store { name, days }, so this restores the explanations for
 * any step that still matches a built-in one (renamed steps simply have none).
 */
export function withTemplateHints(rows, workspace) {
  const hints = new Map(fallbackMilestonesFor(workspace).map((m) => [m.name.toLowerCase(), m.hint]));
  return (rows || []).map((m) => {
    const hint = m.hint || hints.get(String(m.name || "").toLowerCase());
    return hint ? { ...m, hint } : { ...m };
  });
}
