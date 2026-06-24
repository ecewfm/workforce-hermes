import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  tasks: defineTable({
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
  }),

  staff: defineTable({
    name: v.string(),
    email: v.string(),
    role: v.string(),
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
    name: v.string(),
    description: v.string(),
    pros: v.optional(v.string()),
    cons: v.optional(v.string()),
    details: v.optional(v.string()),
    date: v.string(),
    taker: v.optional(v.string()),
  }),

  taskViewHistory: defineTable({
    taskId: v.id("tasks"),
    userEmail: v.string(),
    lastViewedAt: v.number(),
  }).index("by_task_user", ["taskId", "userEmail"]),

  announcements: defineTable({
    title: v.string(),
    body: v.string(),
    postedBy: v.string(),
    postedByEmail: v.string(),
    createdAt: v.number(),
    seenBy: v.array(v.string()),
  }),

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
    .index("by_target_read", ["targetEmail", "read"]),

  // Presence/Heartbeat data — separated to reduce bandwidth on main staff query
  heartbeats: defineTable({
    email: v.string(),
    lastSeen: v.number(),
  }).index("by_email", ["email"]),

  // Handbook — a single shared, admin-editable page built from layout blocks.
  // `blocks` is intentionally loose (v.any) so the builder can evolve block
  // shapes without schema migrations; the client validates/normalizes shape.
  handbook: defineTable({
    blocks: v.array(v.any()),
    updatedAt: v.number(),
    updatedBy: v.optional(v.string()),
  }),

  // Workspace-wide configuration — a singleton row (same pattern as handbook).
  // Holds org-level defaults editable by Admin+: the milestone template used
  // when creating new projects and the full-production deployment deadline.
  appConfig: defineTable({
    productionDeadline: v.optional(v.number()), // ms timestamp
    defaultMilestones: v.optional(
      v.array(v.object({ name: v.string(), days: v.number() }))
    ),
    updatedAt: v.number(),
    updatedBy: v.optional(v.string()),
  }),
});
