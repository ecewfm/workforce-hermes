/**
 * Shared deadline math for projects.
 *
 * Two different deadlines exist per project:
 *   • milestoneDue  — when the ACTIVE milestone is due (shown in the task modal)
 *   • completionDue — when ALL remaining milestone days run out = project
 *                     completion (highlighted on dashboards / kanban cards)
 *
 * Admins can pin an explicit completion deadline on a task
 * (task.deadlineOverride, set via right-click → Edit Deadline). When present
 * it replaces the computed completion date.
 */

export const DAY_MS = 24 * 60 * 60 * 1000;

export function fmtDate(ts) {
  return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/**
 * The timestamp a milestone's countdown starts from:
 *   • A project that has never left "To Do" → null (the clock hasn't started;
 *     project creation must NOT begin the countdown). Once it has been moved to
 *     Pending (t.pendingStartedAt is set), the clock keeps running even if it's
 *     moved back to To Do.
 *   • First milestone → when the project entered "Pending" (t.pendingStartedAt);
 *     legacy projects with no such stamp fall back to t.lastUpdated.
 *   • Later milestones → when the PREVIOUS milestone was completed (so each
 *     milestone's window only opens after the prior one finishes).
 * Returns null when no start time is known.
 */
export function milestoneAnchor(t, idx) {
  if ((t.status || "").toLowerCase() === "todo" && !t.pendingStartedAt) return null;
  const ms = t.milestones || [];
  const projectStart = t.pendingStartedAt || t.lastUpdated || null;
  if (idx <= 0) return projectStart;
  const prev = ms[idx - 1];
  return prev?.completedAtTime || prev?.createdAtTime || projectStart;
}

export function getProjectDeadlines(t) {
  const ms = t.milestones || [];
  const override = t.deadlineOverride || null;
  if (ms.length === 0 && !override) return null;

  const totalDays = ms.reduce((s, m) => s + (m.days || 0), 0);
  const idx = ms.findIndex((m) => !m.completed);
  if (ms.length > 0 && idx === -1) return { complete: true, totalDays };

  let milestoneDue = null;
  let computedCompletion = null;
  let activeName = null;

  if (idx !== -1) {
    const active = ms[idx];
    activeName = active.name;
    // Countdown anchor — null while the project is still in To Do, otherwise
    // the Pending-start (first milestone) or previous completion (later ones).
    const anchor = milestoneAnchor(t, idx);
    if (anchor) {
      const remainingDays = ms.slice(idx).reduce((s, m) => s + (m.days || 0), 0);
      milestoneDue = anchor + (active.days || 0) * DAY_MS;
      computedCompletion = anchor + remainingDays * DAY_MS;
    }
  }

  const completionDue = override || computedCompletion;
  if (!completionDue) return null;

  return {
    totalDays,
    activeName,
    milestoneDue,
    completionDue,
    overridden: !!override,
    doneCount: idx === -1 ? ms.length : idx,
    count: ms.length,
  };
}

/* Days-left tone: overdue → red, ≤7d → orange, ≤30d → amber, else brand */
export function deadlineTone(daysLeft) {
  if (daysLeft < 0) return "overdue";
  if (daysLeft <= 7) return "urgent";
  if (daysLeft <= 30) return "soon";
  return "ok";
}

// ── Planning to a deadline (New Task) ──────────────────────────────────────
/** Calendar days from one "YYYY-MM-DD" to another (null if either is missing). */
export function daysBetweenISO(fromISO, toISO) {
  const p = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(s || "") ? s.split("-").map(Number) : null);
  const a = p(fromISO), b = p(toISO);
  if (!a || !b) return null;
  return Math.round((Date.UTC(b[0], b[1] - 1, b[2]) - Date.UTC(a[0], a[1] - 1, a[2])) / DAY_MS);
}

/**
 * Re-size milestones so their days add up to exactly `targetDays`, keeping
 * their proportions (largest-remainder rounding, at least 1 day each).
 * The deadline is fixed; the milestones are the steps that get you there.
 */
export function fitMilestonesToDays(milestones, targetDays) {
  const list = milestones || [];
  if (!list.length || !(targetDays > 0)) return list;
  const days = list.map((m) => Math.max(1, Number(m.days) || 1));
  const total = days.reduce((a, b) => a + b, 0);
  const target = Math.max(targetDays, list.length); // can't go below 1 day each
  const raw = days.map((d) => (d * target) / total);
  const out = raw.map((x) => Math.max(1, Math.floor(x)));
  let diff = target - out.reduce((a, b) => a + b, 0);
  const byRemainder = raw.map((x, i) => [x - Math.floor(x), i]).sort((a, b) => b[0] - a[0]).map(([, i]) => i);
  for (let k = 0; diff > 0; k++) { out[byRemainder[k % out.length]] += 1; diff--; }
  while (diff < 0) {
    const i = out.indexOf(Math.max(...out));
    if (out[i] <= 1) break;
    out[i] -= 1; diff++;
  }
  return list.map((m, i) => ({ ...m, days: out[i] }));
}
