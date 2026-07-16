import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

/**
 * Per-workspace configuration — ONE row per workspace (was an org-wide
 * singleton). Stores that workspace's defaults:
 *
 *   • defaultMilestones    — the milestone template pre-filled when creating
 *                            a new project (name + days rows)
 *   • productionDeadline   — ms timestamp for when this workspace ships to
 *                            full production (shown on the Dashboard)
 *
 * Each workspace configures these independently. Edit permission is enforced on
 * the client (Admin+ only), matching the trust model used by the rest of this
 * app's mutations. `workspace` defaults to "workforce" for backward compat with
 * any caller not yet threading it.
 */

const DEFAULT_WS = "workforce";

export const getAppConfig = query({
  args: { workspace: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const ws = args.workspace || DEFAULT_WS;
    const doc = await ctx.db
      .query("appConfig")
      .withIndex("by_workspace", (q) => q.eq("workspace", ws as any))
      .first();
    return doc || null;
  },
});

export const saveAppConfig = mutation({
  args: {
    workspace: v.optional(v.string()),
    // null clears the deadline; undefined leaves it untouched
    productionDeadline: v.optional(v.union(v.number(), v.null())),
    defaultMilestones: v.optional(
      v.array(v.object({ name: v.string(), days: v.number() }))
    ),
    updatedBy: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const ws = args.workspace || DEFAULT_WS;
    const existing = await ctx.db
      .query("appConfig")
      .withIndex("by_workspace", (q) => q.eq("workspace", ws as any))
      .first();

    const patch: Record<string, unknown> = {
      updatedAt: Date.now(),
      updatedBy: args.updatedBy || "",
    };
    if (args.productionDeadline !== undefined) {
      // patching with undefined removes the field (clears the deadline)
      patch.productionDeadline =
        args.productionDeadline === null ? undefined : args.productionDeadline;
    }
    if (args.defaultMilestones !== undefined) {
      patch.defaultMilestones = args.defaultMilestones;
    }

    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return existing._id;
    }
    return await ctx.db.insert("appConfig", { workspace: ws, ...patch } as any);
  },
});
