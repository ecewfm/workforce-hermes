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

// Fallback milestone template (mirrors src/utils/defaults.js FALLBACK_MILESTONES),
// used to seed a converted project when the workspace has no saved template.
const FALLBACK_MILESTONES = [
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

/**
 * Take an idea: convert it into a project (Kanban task) assigned to whoever took
 * it, in the same workspace, then REMOVE it from the notebook. Done in one
 * transactional mutation so the idea never lingers after conversion. The new
 * project is seeded with the workspace's milestone template (or the fallback).
 */
export const takeIdea = mutation({
  args: {
    ideaId: v.id("notebook"),
    takerName: v.string(),
    workspace: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const idea = await ctx.db.get(args.ideaId);
    if (!idea) return;
    const ws = args.workspace || (idea as any).workspace || DEFAULT_WS;

    // Seed with the workspace's milestone template.
    const cfg = await ctx.db
      .query("appConfig")
      .withIndex("by_workspace", (q) => q.eq("workspace", ws as any))
      .first();
    const template =
      cfg?.defaultMilestones && cfg.defaultMilestones.length
        ? cfg.defaultMilestones
        : FALLBACK_MILESTONES;
    const now = Date.now();
    const milestones = template.map((m) => ({ name: m.name, days: m.days, createdAtTime: now }));

    // Carry the idea's context into the project description.
    let description = idea.description || "";
    const extra: string[] = [];
    if (idea.pros) extra.push(`Pros: ${idea.pros}`);
    if (idea.cons) extra.push(`Cons: ${idea.cons}`);
    if (idea.details) extra.push(idea.details);
    if (extra.length) description += (description ? "\n\n" : "") + extra.join("\n\n");

    await ctx.db.insert("tasks", {
      workspace: ws as any,
      title: idea.name,
      status: "todo",
      assignee: args.takerName,
      description,
      milestones,
      completedMilestones: 0,
      notes: [],
      lastUpdated: now,
    });

    // Remove the idea from the notebook now that it's a project.
    await ctx.db.delete(args.ideaId);
  },
});
