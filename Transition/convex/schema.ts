import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// Workspace enum — the data-isolation key stamped on every workspace-scoped row.
// Kept OPTIONAL on every table so pre-existing documents (which have no value)
// stay valid until the one-time backfill stamps them "workforce". New writes
// always supply a value. See src/utils/departments.js for the client mirror.
const workspaceField = v.optional(
  v.union(v.literal("executives"), v.literal("operations"), v.literal("workforce"))
);

export default defineSchema({
  tasks: defineTable({
    // Data-isolation key: which workspace this task belongs to.
    workspace: workspaceField,
    title: v.string(),
    status: v.string(),
    assignee: v.string(),
    description: v.optional(v.string()),
    milestones: v.array(
      v.object({
        name: v.string(),
        days: v.number(),
        completed: v.optional(v.boolean()),
        completedAt: v.optional(v.string()),
        completedAtTime: v.optional(v.number()),
        createdAtTime: v.optional(v.number()),
      })
    ),
    completedMilestones: v.number(),
    notes: v.array(
      v.object({
        text: v.string(),
        date: v.string(),
        timestamp: v.optional(v.number()),
        writer: v.optional(v.string()),
        reactions: v.optional(
          v.object({
            like: v.optional(v.array(v.string())),
            wow: v.optional(v.array(v.string())),
            heart: v.optional(v.array(v.string())),
            haha: v.optional(v.array(v.string())),
          })
        ),
        replies: v.optional(
          v.array(
            v.object({
              text: v.string(),
              date: v.string(),
              timestamp: v.number(),
              writer: v.string(),
            })
          )
        ),
      })
    ),
    startDate: v.optional(v.string()),
    projectLink: v.optional(v.string()),
    appscriptLink: v.optional(v.string()),
    webappLink: v.optional(v.string()),
    adminCredentials: v.optional(v.any()),
    lastUpdated: v.number(),
    features: v.optional(
      v.array(
        v.object({
          id: v.string(),
          name: v.string(),
          description: v.string(),
          status: v.string(),
          suggestedBy: v.optional(v.string()),
          imageStorageIds: v.optional(v.array(v.string())),
          type: v.optional(v.string()),
          createdAt: v.optional(v.string()),
          createdAtTime: v.optional(v.number()),
          completedAt: v.optional(v.string()),
          completedAtTime: v.optional(v.number()),
        })
      )
    ),
    isPrioritized: v.optional(v.boolean()),
    // Admin-pinned completion deadline (ms). Overrides the computed
    // milestone-based completion date everywhere it's displayed.
    deadlineOverride: v.optional(v.number()),
    // Dedup markers for the daily manager project scan (see tasks.scanProjectsForManagers).
    // Prevent re-notifying managers about the same overdue/stale episode every run.
    managerLateNotifiedAt: v.optional(v.number()),
    managerStaleNotifiedAt: v.optional(v.number()),
  }).index("by_workspace", ["workspace"]),

  staff: defineTable({
    name: v.string(),
    email: v.string(),
    role: v.string(),
    // Department membership — the orthogonal RBAC axis that gates which
    // workspaces a user may enter. Optional array so existing rows stay valid;
    // backfilled to ["Workforce"]. See src/utils/departments.js.
    departments: v.optional(v.array(v.string())),
    password: v.optional(v.string()),
    avatarUrl: v.optional(v.union(v.string(), v.null())),
    bio: v.optional(v.union(v.string(), v.null())),
    country: v.optional(v.union(v.string(), v.null())),
    status: v.optional(v.union(v.string(), v.null())),
    lastSeen: v.optional(v.number()),
    securityQuestion: v.optional(v.string()),
    securityAnswer: v.optional(v.string()),
    // Legacy fields — kept for backward compatibility with existing documents
    resetCode: v.optional(v.string()),
    resetCodeExpiry: v.optional(v.number()),
  }).index("by_email", ["email"]),

  notebook: defineTable({
    workspace: workspaceField,
    name: v.string(),
    description: v.string(),
    pros: v.optional(v.string()),
    cons: v.optional(v.string()),
    details: v.optional(v.string()),
    date: v.string(),
    taker: v.optional(v.string()),
  }).index("by_workspace", ["workspace"]),

  taskViewHistory: defineTable({
    taskId: v.id("tasks"),
    userEmail: v.string(),
    lastViewedAt: v.number(),
  }).index("by_task_user", ["taskId", "userEmail"]),

  announcements: defineTable({
    workspace: workspaceField,
    title: v.string(),
    body: v.string(),
    postedBy: v.string(),
    postedByEmail: v.string(),
    createdAt: v.number(),
    seenBy: v.array(v.string()),
  }).index("by_workspace", ["workspace"]),

  // Security audit logs — visible only in Convex dashboard
  securityLogs: defineTable({
    action: v.string(),        // e.g. "PASSWORD_RESET", "SECURITY_QUESTION_SET"
    userEmail: v.string(),     // who performed the action
    targetEmail: v.string(),   // who was affected
    details: v.optional(v.string()), // additional context
    timestamp: v.number(),
    ip: v.optional(v.string()),
  })
    .index("by_user", ["userEmail"])
    .index("by_target", ["targetEmail"])
    .index("by_action", ["action"]),

  // Notifications — consolidated bell icon system
  notifications: defineTable({
    workspace: workspaceField, // which workspace this notification belongs to
    type: v.string(),           // "mention" | "project_change" | "reaction"
    targetEmail: v.string(),    // who receives the notification
    actorEmail: v.string(),     // who triggered it
    actorName: v.string(),      // display name of actor
    message: v.string(),        // human-readable description
    taskId: v.optional(v.id("tasks")),
    taskTitle: v.optional(v.string()),
    read: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_target", ["targetEmail"])
    .index("by_target_read", ["targetEmail", "read"])
    .index("by_workspace_target", ["workspace", "targetEmail"])
    .index("by_workspace_target_read", ["workspace", "targetEmail", "read"]),

  // Presence/Heartbeat data — separated to reduce bandwidth on main staff query
  heartbeats: defineTable({
    email: v.string(),
    lastSeen: v.number(),
  }).index("by_email", ["email"]),

  // Handbook — one admin-editable page PER WORKSPACE, built from layout blocks.
  // `blocks` is intentionally loose (v.any) so the builder can evolve block
  // shapes without schema migrations; the client validates/normalizes shape.
  // (Was a single shared singleton; now keyed by workspace.)
  handbook: defineTable({
    workspace: workspaceField,
    blocks: v.array(v.any()),
    updatedAt: v.number(),
    updatedBy: v.optional(v.string()),
  }).index("by_workspace", ["workspace"]),

  // Per-workspace configuration — one row per workspace (was an org-wide
  // singleton). Holds that workspace's defaults editable by Admin+: the
  // milestone template used when creating new projects and the full-production
  // deployment deadline.
  appConfig: defineTable({
    workspace: workspaceField,
    productionDeadline: v.optional(v.number()), // ms timestamp
    defaultMilestones: v.optional(
      v.array(v.object({ name: v.string(), days: v.number() }))
    ),
    updatedAt: v.number(),
    updatedBy: v.optional(v.string()),
  }).index("by_workspace", ["workspace"]),
});
