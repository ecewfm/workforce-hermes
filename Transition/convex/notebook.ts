import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

// Notebook ideas are per-workspace. `workspace` defaults to "workforce" for
// backward compat with any caller not yet threading it.
const DEFAULT_WS = "workforce";

export const getIdeas = query({
  args: { workspace: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const ws = args.workspace || DEFAULT_WS;
    return await ctx.db
      .query("notebook")
      .withIndex("by_workspace", (q) => q.eq("workspace", ws as any))
      .collect();
  },
});

export const addIdea = mutation({
  args: {
    workspace: v.optional(v.string()),
    name: v.string(),
    description: v.string(),
    pros: v.optional(v.string()),
    cons: v.optional(v.string()),
    details: v.optional(v.string()),
    date: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("notebook", {
      workspace: (args.workspace || DEFAULT_WS) as any,
      name: args.name,
      description: args.description,
      pros: args.pros || "",
      cons: args.cons || "",
      details: args.details || "",
      date: args.date,
    });
  },
});

export const deleteIdea = mutation({
  args: { ideaId: v.id("notebook") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.ideaId);
  },
});

export const takeIdea = mutation({
  args: {
    ideaId: v.id("notebook"),
    takerName: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.ideaId, {
      taker: args.takerName,
    });
  },
});
