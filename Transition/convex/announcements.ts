import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

// Announcements are per-workspace. `workspace` defaults to "workforce" for
// backward compat with any caller not yet threading it.
const DEFAULT_WS = "workforce";

/**
 * Get all announcements for a workspace, latest first.
 */
export const getAnnouncements = query({
  args: { workspace: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const ws = args.workspace || DEFAULT_WS;
    const all = await ctx.db
      .query("announcements")
      .withIndex("by_workspace", (q) => q.eq("workspace", ws as any))
      .collect();
    return all.sort((a, b) => b.createdAt - a.createdAt);
  },
});

/**
 * Get the first unseen announcement for a specific user in a workspace.
 * Returns null if all announcements have been seen.
 */
export const getUnseenAnnouncement = query({
  args: { userEmail: v.string(), workspace: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const ws = args.workspace || DEFAULT_WS;
    const all = await ctx.db
      .query("announcements")
      .withIndex("by_workspace", (q) => q.eq("workspace", ws as any))
      .collect();
    // Return the oldest unseen announcement first (so user sees them in order)
    const unseen = all
      .filter((a) => !a.seenBy.includes(args.userEmail.toLowerCase()))
      .sort((a, b) => a.createdAt - b.createdAt);
    return unseen.length > 0 ? unseen[0] : null;
  },
});

/**
 * Post a new announcement (Admin+ only — enforced on frontend).
 */
export const postAnnouncement = mutation({
  args: {
    workspace: v.optional(v.string()),
    title: v.string(),
    body: v.string(),
    postedBy: v.string(),
    postedByEmail: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("announcements", {
      workspace: (args.workspace || DEFAULT_WS) as any,
      title: args.title,
      body: args.body,
      postedBy: args.postedBy,
      postedByEmail: args.postedByEmail.toLowerCase(),
      createdAt: Date.now(),
      seenBy: [],
    });
  },
});

/**
 * Mark an announcement as seen by a user.
 */
export const markAnnouncementSeen = mutation({
  args: {
    announcementId: v.id("announcements"),
    userEmail: v.string(),
  },
  handler: async (ctx, args) => {
    const announcement = await ctx.db.get(args.announcementId);
    if (!announcement) return;

    const lowerEmail = args.userEmail.toLowerCase();
    if (announcement.seenBy.includes(lowerEmail)) return;

    await ctx.db.patch(args.announcementId, {
      seenBy: [...announcement.seenBy, lowerEmail],
    });
  },
});

/**
 * Delete an announcement.
 */
export const deleteAnnouncement = mutation({
  args: { announcementId: v.id("announcements") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.announcementId);
  },
});
