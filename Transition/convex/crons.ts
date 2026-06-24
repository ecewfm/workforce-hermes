import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

/**
 * Scheduled jobs.
 *
 * Once a day, scan every active project and alert Managers about ones that are
 * overdue or have stalled (no movement for 5+ days). Event-based manager alerts
 * (new feature/bug, completion) are created inline by the task mutations.
 *
 * Runs at 01:00 UTC (~09:00 PH time) so the flags are waiting at the start of
 * the workday.
 */
const crons = cronJobs();

crons.daily(
  "manager project scan",
  { hourUTC: 1, minuteUTC: 0 },
  internal.tasks.scanProjectsForManagers
);

export default crons;
