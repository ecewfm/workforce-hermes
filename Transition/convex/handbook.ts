import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

/**
 * The handbook is ONE document PER WORKSPACE (was a single shared singleton).
 * We keep exactly one row per workspace in the `handbook` table; `getHandbook`
 * returns the active workspace's row (or null when never saved) and
 * `saveHandbook` upserts it, keyed by workspace.
 *
 * Edit permission is enforced on the client (Admin+ only). These functions do
 * not re-check roles server-side, matching the existing trust model. `workspace`
 * defaults to "workforce" for backward compat with any caller not yet threading it.
 */

const DEFAULT_WS = "workforce";

export const getHandbook = query({
  args: { workspace: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const ws = args.workspace || DEFAULT_WS;
    const doc = await ctx.db
      .query("handbook")
      .withIndex("by_workspace", (q) => q.eq("workspace", ws as any))
      .first();
    return doc || null;
  },
});

export const saveHandbook = mutation({
  args: {
    workspace: v.optional(v.string()),
    blocks: v.array(v.any()),
    updatedBy: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const ws = args.workspace || DEFAULT_WS;
    const existing = await ctx.db
      .query("handbook")
      .withIndex("by_workspace", (q) => q.eq("workspace", ws as any))
      .first();

    const payload = {
      blocks: args.blocks,
      updatedAt: Date.now(),
      updatedBy: args.updatedBy || "",
    };
    if (existing) {
      await ctx.db.patch(existing._id, payload);
      return existing._id;
    }
    return await ctx.db.insert("handbook", { workspace: ws, ...payload } as any);
  },
});
