import { mutation } from "./_generated/server";

/**
 * One-time (idempotent) backfill for the workspaces + departments feature.
 *
 * Stamps every pre-existing, un-tagged row with the "workforce" workspace so
 * WFM keeps 100% of the data it had before workspaces existed, and defaults
 * every staff member's department membership to ["Workforce"]. Executives and
 * Operations start completely blank.
 *
 * Run this from the Convex dashboard (or `npx convex run migrations:backfillWorkspaces`)
 * BEFORE the workspace-filtered queries go live. Safe to re-run: only rows that
 * are still missing the field are touched.
 *
 * Model: staff.ts:migrateAllPasswordsToHashes.
 */
export const backfillWorkspaces = mutation({
  args: {},
  handler: async (ctx) => {
    const WS = "workforce" as const;
    const counts: Record<string, number> = {
      tasks: 0,
      notebook: 0,
      announcements: 0,
      notifications: 0,
      handbook: 0,
      appConfig: 0,
      staff: 0,
    };

    // --- Workspace-scoped data tables: stamp "workforce" where missing ---
    for (const table of [
      "tasks",
      "notebook",
      "announcements",
      "notifications",
      "handbook",
      "appConfig",
    ] as const) {
      const rows = await ctx.db.query(table).collect();
      for (const row of rows) {
        if ((row as any).workspace === undefined) {
          await ctx.db.patch(row._id, { workspace: WS } as any);
          counts[table]++;
        }
      }
    }

    // --- Staff: default department membership to ["Workforce"] where missing ---
    const staff = await ctx.db.query("staff").collect();
    for (const s of staff) {
      const depts = (s as any).departments;
      if (depts === undefined || (Array.isArray(depts) && depts.length === 0)) {
        await ctx.db.patch(s._id, { departments: ["Workforce"] } as any);
        counts.staff++;
      }
    }

    return { ok: true, patched: counts };
  },
});
