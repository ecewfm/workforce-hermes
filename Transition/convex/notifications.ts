import { query, mutation, internalMutation } from "./_generated/server";
import { v } from "convex/values";

// Notifications are per-workspace: the bell shows only the active workspace's
// notifications. `workspace` defaults to "workforce" for backward compat.
const DEFAULT_WS = "workforce";

/**
 * Get all notifications for a user in a workspace, latest first.
 * Caps at 50 to save bandwidth.
 */
export const getNotifications = query({
  args: { email: v.string(), workspace: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const lowerEmail = args.email.toLowerCase();
    const ws = args.workspace || DEFAULT_WS;
    const all = await ctx.db
      .query("notifications")
      .withIndex("by_workspace_target", (q) =>
        q.eq("workspace", ws as any).eq("targetEmail", lowerEmail)
      )
      .collect();

    // Sort latest first and cap at 50
    return all.sort((a, b) => b.createdAt - a.createdAt).slice(0, 50);
  },
});

/**
 * Get count of unread notifications for badge display (per workspace).
 */
export const getUnreadCount = query({
  args: { email: v.string(), workspace: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const lowerEmail = args.email.toLowerCase();
    const ws = args.workspace || DEFAULT_WS;
    const unread = await ctx.db
      .query("notifications")
      .withIndex("by_workspace_target_read", (q) =>
        q.eq("workspace", ws as any).eq("targetEmail", lowerEmail).eq("read", false)
      )
      .collect();
    return unread.length;
  },
});

/**
 * Mark a single notification as read.
 */
export const markRead = mutation({
  args: { notificationId: v.id("notifications") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.notificationId, { read: true });
  },
});

/**
 * Mark all notifications for a user (in a workspace) as read.
 */
export const markAllRead = mutation({
  args: { email: v.string(), workspace: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const lowerEmail = args.email.toLowerCase();
    const ws = args.workspace || DEFAULT_WS;
    const unread = await ctx.db
      .query("notifications")
      .withIndex("by_workspace_target_read", (q) =>
        q.eq("workspace", ws as any).eq("targetEmail", lowerEmail).eq("read", false)
      )
      .collect();

    for (const n of unread) {
      await ctx.db.patch(n._id, { read: true });
    }
  },
});

/**
 * Create a notification. Called by other mutations. `workspace` is stamped so
 * the notification only surfaces in the workspace it was generated in.
 */
export const createNotification = mutation({
  args: {
    workspace: v.optional(v.string()),
    type: v.string(),
    targetEmail: v.string(),
    actorEmail: v.string(),
    actorName: v.string(),
    message: v.string(),
    taskId: v.optional(v.id("tasks")),
    taskTitle: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Don't notify yourself
    if (args.targetEmail.toLowerCase() === args.actorEmail.toLowerCase()) return;

    await ctx.db.insert("notifications", {
      workspace: (args.workspace || DEFAULT_WS) as any,
      type: args.type,
      targetEmail: args.targetEmail.toLowerCase(),
      actorEmail: args.actorEmail.toLowerCase(),
      actorName: args.actorName,
      message: args.message,
      taskId: args.taskId,
      taskTitle: args.taskTitle,
      read: false,
      createdAt: Date.now(),
    });
  },
});
/**
 * Get the single latest notification for a user (in a workspace).
 */
export const getLatestNotification = query({
  args: { email: v.string(), workspace: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const lowerEmail = args.email.toLowerCase();
    const ws = args.workspace || DEFAULT_WS;
    const latest = await ctx.db
      .query("notifications")
      .withIndex("by_workspace_target", (q) =>
        q.eq("workspace", ws as any).eq("targetEmail", lowerEmail)
      )
      .order("desc")
      .first();
    return latest;
  },
});
