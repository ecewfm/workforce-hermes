import { query, mutation, internalMutation } from "./_generated/server";
import { v } from "convex/values";

const DAY_MS = 24 * 60 * 60 * 1000;

// Tasks are per-workspace. `workspace` defaults to "workforce" for backward
// compat with any caller not yet threading it (pre-existing data was all WFM).
const DEFAULT_WS = "workforce";

/**
 * Fetch a workspace's tasks. For the default "workforce" workspace we also
 * include legacy rows that have NO workspace tag yet (pre-backfill), so WFM
 * never sees an empty board in the window between deploying and running the
 * migrations:backfillWorkspaces job. Other workspaces use the index directly.
 */
async function tasksForWorkspace(ctx: any, ws: string) {
  if (ws === DEFAULT_WS) {
    const all = await ctx.db.query("tasks").collect();
    return all.filter((t: any) => !t.workspace || t.workspace === DEFAULT_WS);
  }
  return await ctx.db
    .query("tasks")
    .withIndex("by_workspace", (q: any) => q.eq("workspace", ws))
    .collect();
}

// --- QUERIES ---

export const getTasks = query({
  args: { workspace: v.optional(v.string()) },
  handler: async (ctx, args) => {
    return await tasksForWorkspace(ctx, args.workspace || DEFAULT_WS);
  },
});

/**
 * Lightweight version of getTasks that excludes heavy nested fields.
 * Dramatically reduces bandwidth for the Kanban and List views.
 */
export const getTasksLight = query({
  args: { workspace: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const tasks = await tasksForWorkspace(ctx, args.workspace || DEFAULT_WS);
    return tasks.map(({ notes, features, adminCredentials, ...light }) => {
      const notesList = notes || [];
      const featuresList = features || [];

      return {
        ...light,
        notesCount: notesList.length,
        featuresCount: featuresList.length,
        completedMilestones: light.completedMilestones || 0,
        // Most recent timestamps for badge calculations without full data
        lastNoteTimestamp: notesList.reduce((max, n) => Math.max(max, n.timestamp || 0), 0),
        lastFeatureTimestamp: featuresList.reduce((max, f) => Math.max(max, f.createdAtTime || 0), 0),
      };
    });
  },
});

// Admin-only (enforced client-side, matching the app's trust model): pin or
// clear an explicit completion deadline. Pass null to restore the computed
// milestone-based date. Deliberately does NOT touch lastUpdated — that value
// anchors computed milestone deadlines and must not shift on a deadline edit.
export const setTaskDeadline = mutation({
  args: {
    taskId: v.id("tasks"),
    deadline: v.union(v.number(), v.null()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.taskId, {
      deadlineOverride: args.deadline === null ? undefined : args.deadline,
    });
  },
});

// --- Obfuscation Helpers ---
// These are used to hide plain text from casual observation in the Convex DB browser.
// They are reversible so that the user can still reveal them in the modal.
function obfuscate(str: string | undefined) {
  if (!str) return str;
  try {
    const encoded = btoa(str);
    return "obf_" + encoded.split('').reverse().join('');
  } catch (e) {
    return str;
  }
}

function deobfuscate(str: string | undefined) {
  if (!str || typeof str !== "string") return str;
  const s = str.trim();
  if (!s.startsWith("obf_")) return s;
  try {
    const reversed = s.substring(4);
    let encoded = reversed.split('').reverse().join('').trim();
    // Strip any potential whitespace or non-base64 characters
    encoded = encoded.replace(/[^A-Za-z0-9+/=]/g, "");

    if (typeof atob === 'function') {
      try {
        return decodeURIComponent(escape(atob(encoded)));
      } catch (e) {
        return atob(encoded);
      }
    }
    return s;
  } catch (e) {
    return s;
  }
}

/**
 * Check if the actor (by email) is one of the task assignees.
 * Used to suppress project_change notifications when the owner makes routine changes.
 */
function isActorAssignee(actorEmail: string, assigneeString: string, allStaff: any[]): boolean {
  if (!actorEmail || !assigneeString) return false;
  const lowerActor = actorEmail.toLowerCase();
  const assigneeNames = assigneeString.split(",").map(n => n.trim().toLowerCase()).filter(Boolean);
  
  // Find the actor's staff record
  const actorStaff = allStaff.find(s => s.email.toLowerCase() === lowerActor);
  if (!actorStaff) return false;
  
  const actorName = actorStaff.name.toLowerCase();
  return assigneeNames.some(a => actorName.includes(a) || a.includes(actorName));
}

/**
 * Insert a notification for each Manager (oversight role). Used to keep Managers
 * aware of activity across ALL projects — new features/bugs, completions, late
 * projects and stalled projects.
 *
 *  - Skips the manager who performed the action (by email, or by name when only
 *    a writer name is available).
 *  - When `assigneeString` is provided, skips managers who are assignees of the
 *    task (they already receive the normal assignee notification, avoiding dupes).
 *  - `actorName` defaults to "Project Monitor" for system/cron-generated alerts.
 */
async function insertManagerNotifs(
  ctx: any,
  managers: any[],
  opts: {
    type: string;
    message: string;
    taskId?: any;
    taskTitle?: string;
    actorEmail?: string;
    actorName?: string;
    assigneeString?: string;
    workspace?: string;
  }
) {
  const lowerActorEmail = (opts.actorEmail || "").toLowerCase();
  const lowerActorName = (opts.actorName || "").toLowerCase();
  const assigneeNames = (opts.assigneeString || "")
    .split(",").map((n) => n.trim().toLowerCase()).filter(Boolean);

  for (const m of managers) {
    const mEmail = (m.email || "").toLowerCase();
    const mName = (m.name || "").toLowerCase();
    // Don't notify the person who triggered it
    if (lowerActorEmail && mEmail === lowerActorEmail) continue;
    if (!lowerActorEmail && lowerActorName && mName === lowerActorName) continue;
    // Don't double-notify a manager who's also an assignee on this task
    if (assigneeNames.length && assigneeNames.some((a) => mName.includes(a) || a.includes(mName))) continue;

    await ctx.db.insert("notifications", {
      workspace: (opts.workspace || DEFAULT_WS) as any,
      type: opts.type,
      targetEmail: mEmail,
      actorEmail: lowerActorEmail || "system",
      actorName: opts.actorName || "Project Monitor",
      message: opts.message,
      taskId: opts.taskId,
      taskTitle: opts.taskTitle,
      read: false,
      createdAt: Date.now(),
    });
  }
}

/** Query managers then notify them. For one-off event hooks. */
async function notifyManagers(ctx: any, opts: any) {
  const allStaff = await ctx.db.query("staff").collect();
  const managers = allStaff.filter((s: any) => s.role === "Manager");
  if (managers.length === 0) return;
  await insertManagerNotifs(ctx, managers, opts);
}

/**
 * Compute a project's completion deadline (mirrors src/utils/deadlines.js).
 * Returns the ms timestamp when all remaining milestones are due, or null.
 * An admin-pinned deadlineOverride takes precedence.
 */
function computeCompletionDue(task: any): { completionDue: number | null; complete: boolean } {
  const ms = task.milestones || [];
  const override = task.deadlineOverride || null;
  if (ms.length === 0 && !override) return { completionDue: null, complete: false };

  const idx = ms.findIndex((m: any) => !m.completed);
  if (ms.length > 0 && idx === -1) return { completionDue: override || null, complete: true };

  let computed: number | null = null;
  if (idx !== -1) {
    const active = ms[idx];
    const anchor =
      (idx > 0 ? (ms[idx - 1].completedAtTime || ms[idx - 1].createdAtTime) : active.createdAtTime) ||
      task.lastUpdated;
    if (anchor) {
      const remainingDays = ms.slice(idx).reduce((s: number, m: any) => s + (m.days || 0), 0);
      computed = anchor + remainingDays * DAY_MS;
    }
  }
  return { completionDue: override || computed, complete: false };
}

/**
 * Targeted query for fetching full details of a single task.
 * Used for the TaskModal to avoid fetching all tasks' notes/features.
 */
export const getTaskById = query({
  args: { taskId: v.id("tasks") },
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId);
    if (!task) return null;
    
    // Deobfuscate sensitive fields before sending to client
    if (task.adminCredentials) {
      return {
        ...task,
        adminCredentials: {
          email: deobfuscate(task.adminCredentials.email),
          password: deobfuscate(task.adminCredentials.password),
        }
      };
    }
    
    return task;
  },
});

export const getProjectStats = query({
  args: { workspace: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const tasks = await tasksForWorkspace(ctx, args.workspace || DEFAULT_WS);

    interface WorkloadInfo {
      name: string;
      active: number;
      pending: number;
    }

    const stats: Record<string, any> = {
      todo: 0,
      pending: 0,
      development: 0,
      testing: 0,
      done: 0,
      scrapyard: 0,
      implemented: 0,
      overallCompletion: 0,
      staffWorkload: [] as WorkloadInfo[],
    };

    if (tasks.length === 0) return stats;

    let totalProg = 0;
    const workloadMap: Record<string, WorkloadInfo> = {};

    tasks.forEach((t) => {
      const status = (t.status || "").toLowerCase();
      if (status in stats && typeof stats[status] === "number") {
        stats[status]++;
      } else if (status === "inprogress") {
        stats.development++;
      }

      const milestones = t.milestones || [];
      const totalM = milestones.length > 0 ? milestones.length : 10;
      const prog = totalM > 0 ? (t.completedMilestones || 0) / totalM : 0;
      totalProg += prog;

      const isActive = status === "development" || status === "inprogress";
      const isPending = status === "pending";
      if (isActive || isPending) {
        const assignees = (t.assignee || "")
          .split(",")
          .map((n) => n.trim())
          .filter((n) => n);
        assignees.forEach((name) => {
          if (!workloadMap[name])
            workloadMap[name] = { name, active: 0, pending: 0 };
          if (isActive) workloadMap[name].active++;
          if (isPending) workloadMap[name].pending++;
        });
      }
    });

    stats.overallCompletion = Math.round((totalProg / tasks.length) * 100);
    stats.staffWorkload = (Object.values(workloadMap) as WorkloadInfo[]).sort(
      (a, b) => b.active + b.pending - (a.active + a.pending)
    );

    stats.projectsWithLinks = tasks
      .filter(t => t.appscriptLink || t.webappLink || t.projectLink)
      .map(t => ({
        id: t._id,
        title: t.title,
        description: t.description,
        appscriptLink: t.appscriptLink,
        webappLink: t.webappLink || t.projectLink
      }));

    return stats;
  },
});

// --- MUTATIONS ---

export const addTask = mutation({
  args: {
    workspace: v.optional(v.string()),
    title: v.string(),
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
    startDate: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("tasks", {
      workspace: (args.workspace || DEFAULT_WS) as any,
      title: args.title,
      status: "todo",
      assignee: args.assignee,
      description: args.description || "",
      milestones: args.milestones.map((m) => ({ ...m, createdAtTime: Date.now() })),
      completedMilestones: 0,
      notes: [],
      startDate: args.startDate,
      lastUpdated: Date.now(),
    });
  },
});

export const updateTaskStatus = mutation({
  args: {
    taskId: v.id("tasks"),
    newStatus: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.taskId, {
      status: args.newStatus,
      lastUpdated: Date.now(),
    });
  },
});

export const updateTaskMilestones = mutation({
  args: {
    taskId: v.id("tasks"),
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
    completedCount: v.number(),
    actorEmail: v.optional(v.string()),
    actorName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId);
    if (!task) throw new Error("Task not found");

    // Check if a milestone was completed in this update
    const prevMilestones = task.milestones || [];
    const newCompletedMilestone = args.milestones.find((m, i) => 
      m.completed && (!prevMilestones[i] || !prevMilestones[i].completed)
    );

    await ctx.db.patch(args.taskId, {
      milestones: args.milestones,
      completedMilestones: args.completedCount,
      lastUpdated: Date.now(),
    });

    // --- Notification: notify task assignees about milestone completion ---
    // Skip if the actor is an assignee (owner) of the project
    if (newCompletedMilestone && args.actorEmail) {
      const actorEmail = args.actorEmail.toLowerCase();
      const allStaff = await ctx.db.query("staff").collect();
      const assigneeNames = (task.assignee || "").split(",").map(n => n.trim().toLowerCase()).filter(Boolean);
      
      // Don't notify when owner makes changes to their own project
      if (!isActorAssignee(actorEmail, task.assignee || "", allStaff)) {
        for (const staff of allStaff) {
          if (staff.email.toLowerCase() === actorEmail) continue;
          const nameMatch = assigneeNames.some(a => staff.name.toLowerCase().includes(a) || a.includes(staff.name.toLowerCase()));
          if (nameMatch) {
            await ctx.db.insert("notifications", {
              workspace: ((task as any).workspace || DEFAULT_WS) as any,
              type: "project_change",
              targetEmail: staff.email.toLowerCase(),
              actorEmail,
              actorName: args.actorName || actorEmail,
              message: `completed milestone "${newCompletedMilestone.name}" on "${task.title}"`,
              taskId: args.taskId,
              taskTitle: task.title,
              read: false,
              createdAt: Date.now(),
            });
          }
        }
      }
    }
  },
});

export const addNoteToTask = mutation({
  args: {
    taskId: v.id("tasks"),
    noteText: v.string(),
    writer: v.string(),
    writerEmail: v.optional(v.string()),
    date: v.string(),
  },
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId);
    if (!task) throw new Error("Task not found");

    const notes = [...(task.notes || [])];
    notes.push({
      text: args.noteText,
      date: args.date,
      timestamp: Date.now(),
      writer: args.writer,
    });

    await ctx.db.patch(args.taskId, {
      notes,
      lastUpdated: Date.now(),
    });

    // --- Notifications ---
    const actorEmail = (args.writerEmail || "").toLowerCase();
    const allStaff = await ctx.db.query("staff").collect();

    // Notify task assignees (project change) — skip if actor is an assignee (owner)
    const assigneeNames = (task.assignee || "").split(",").map(n => n.trim().toLowerCase()).filter(Boolean);
    if (!isActorAssignee(actorEmail, task.assignee || "", allStaff)) {
      for (const staff of allStaff) {
        if (staff.email.toLowerCase() === actorEmail) continue;
        const nameMatch = assigneeNames.some(a => staff.name.toLowerCase().includes(a) || a.includes(staff.name.toLowerCase()));
        if (nameMatch) {
          await ctx.db.insert("notifications", {
            workspace: ((task as any).workspace || DEFAULT_WS) as any,
            type: "project_change",
            targetEmail: staff.email.toLowerCase(),
            actorEmail,
            actorName: args.writer,
            message: `added a note on "${task.title}"`,
            taskId: args.taskId,
            taskTitle: task.title,
            read: false,
            createdAt: Date.now(),
          });
        }
      }
    }

    // Parse @mentions from note text
    const mentions = args.noteText.match(/@([\w\s]+?)(?=[@,.]|$)/g);
    if (mentions) {
      for (const mention of mentions) {
        const mentionedName = mention.substring(1).trim().toLowerCase();
        for (const staff of allStaff) {
          if (staff.email.toLowerCase() === actorEmail) continue;
          if (staff.name.toLowerCase().includes(mentionedName) || mentionedName.includes(staff.name.toLowerCase().split(" ")[0])) {
            await ctx.db.insert("notifications", {
              workspace: ((task as any).workspace || DEFAULT_WS) as any,
              type: "mention",
              targetEmail: staff.email.toLowerCase(),
              actorEmail,
              actorName: args.writer,
              message: `mentioned you in a note on "${task.title}"`,
              taskId: args.taskId,
              taskTitle: task.title,
              read: false,
              createdAt: Date.now(),
            });
          }
        }
      }
    }

    return notes;
  },
});

export const deleteTask = mutation({
  args: {
    taskId: v.id("tasks"),
    actorEmail: v.optional(v.string()),
    actorName: v.optional(v.string()),
    source: v.optional(v.string()), // "kanban" | "modal" | "archive" | "context-menu"
  },
  handler: async (ctx, args) => {
    // Capture task info before deletion for audit log
    const task = await ctx.db.get(args.taskId);
    if (!task) return;
    const taskTitle = task.title || "Unknown Project";
    const taskAssignee = task.assignee || "Unassigned";

    const actorEmail = (args.actorEmail || "unknown").toLowerCase();

    if (args.source === "archive") {
      // PERMANENT PHYSICAL DELETE
      await ctx.db.delete(args.taskId);

      await ctx.db.insert("securityLogs", {
        action: "PROJECT_DELETED_PERMANENTLY",
        userEmail: actorEmail,
        targetEmail: actorEmail,
        details: `Permanently deleted project "${taskTitle}" (assignee: ${taskAssignee}) from archive.`,
        timestamp: Date.now(),
      });
    } else {
      // SOFT DELETE (MOVE TO SCRAPPED / ARCHIVE)
      await ctx.db.patch(args.taskId, {
        status: "scrapped",
        lastUpdated: Date.now(),
      });

      await ctx.db.insert("securityLogs", {
        action: "PROJECT_ARCHIVED",
        userEmail: actorEmail,
        targetEmail: actorEmail,
        details: `Archived/Soft-deleted project "${taskTitle}" (assignee: ${taskAssignee}) from ${args.source || "unknown"}.`,
        timestamp: Date.now(),
      });
    }
  },
});

export const updateTaskDetails = mutation({
  args: {
    taskId: v.id("tasks"),
    newTitle: v.string(),
    newDescription: v.optional(v.string()),
    newAssignee: v.string(),
    newAppscriptLink: v.optional(v.string()),
    newWebappLink: v.optional(v.string()),
    newMilestones: v.array(
      v.object({
        name: v.string(),
        days: v.number(),
        completed: v.optional(v.boolean()),
        completedAt: v.optional(v.string()),
        completedAtTime: v.optional(v.number()),
        createdAtTime: v.optional(v.number()),
      })
    ),
    actorEmail: v.optional(v.string()),
    actorName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId);
    if (!task) throw new Error("Task not found");

    const completedCount = args.newMilestones.filter(
      (m) => m.completed
    ).length;

    await ctx.db.patch(args.taskId, {
      title: args.newTitle,
      description: args.newDescription || "",
      assignee: args.newAssignee,
      appscriptLink: args.newAppscriptLink,
      webappLink: args.newWebappLink,
      milestones: args.newMilestones.map(m => ({ ...m, createdAtTime: m.createdAtTime || Date.now() })),
      completedMilestones: completedCount,
      lastUpdated: Date.now(),
    });

    // --- Notification: notify task assignees about detail changes ---
    // Skip if the actor is an assignee (owner) of the project
    if (args.actorEmail) {
      const actorEmail = args.actorEmail.toLowerCase();
      const allStaff = await ctx.db.query("staff").collect();
      
      // We notify BOTH the old assignees and the new assignees (union)
      const oldAssignees = (task.assignee || "").split(",").map(n => n.trim().toLowerCase()).filter(Boolean);
      const newAssignees = (args.newAssignee || "").split(",").map(n => n.trim().toLowerCase()).filter(Boolean);
      const notifySet = new Set([...oldAssignees, ...newAssignees]);

      if (!isActorAssignee(actorEmail, task.assignee || "", allStaff)) {
        for (const staff of allStaff) {
          if (staff.email.toLowerCase() === actorEmail) continue;
          const nameMatch = Array.from(notifySet).some(a => staff.name.toLowerCase().includes(a) || a.includes(staff.name.toLowerCase()));
          if (nameMatch) {
            await ctx.db.insert("notifications", {
              workspace: ((task as any).workspace || DEFAULT_WS) as any,
              type: "project_change",
              targetEmail: staff.email.toLowerCase(),
              actorEmail,
              actorName: args.actorName || actorEmail,
              message: `updated project details for "${args.newTitle}"`,
              taskId: args.taskId,
              taskTitle: args.newTitle,
              read: false,
              createdAt: Date.now(),
            });
          }
        }
      }
    }
  },
});

export const updateTaskLinks = mutation({
  args: {
    taskId: v.id("tasks"),
    appscriptLink: v.optional(v.string()),
    webappLink: v.optional(v.string()),
    projectLink: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId);
    if (!task) throw new Error("Task not found");

    const patch: any = { lastUpdated: Date.now() };
    if (args.appscriptLink !== undefined) patch.appscriptLink = args.appscriptLink;
    if (args.webappLink !== undefined) patch.webappLink = args.webappLink;
    if (args.projectLink !== undefined) patch.projectLink = args.projectLink;

    await ctx.db.patch(args.taskId, patch);
    return { appscriptLink: patch.appscriptLink ?? task.appscriptLink, webappLink: patch.webappLink ?? task.webappLink, projectLink: patch.projectLink ?? task.projectLink };
  },
});

export const updateProjectLink = mutation({
  args: {
    taskId: v.id("tasks"),
    projectLink: v.string(),
  },
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId);
    if (!task) throw new Error("Task not found");
    await ctx.db.patch(args.taskId, {
      projectLink: args.projectLink,
      lastUpdated: Date.now(),
    });
  },
});

export const updateAdminCredentials = mutation({
  args: {
    taskId: v.id("tasks"),
    email: v.string(),
    password: v.string(),
  },
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId);
    if (!task) throw new Error("Task not found");
    await ctx.db.patch(args.taskId, {
      adminCredentials: {
        email: obfuscate(args.email),
        password: obfuscate(args.password),
      },
      lastUpdated: Date.now(),
    });
  },
});

export const toggleTaskPriority = mutation({
  args: {
    taskId: v.id("tasks"),
    isPrioritized: v.boolean(),
  },
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId);
    if (!task) throw new Error("Task not found");

    if (args.isPrioritized) {
      const assignees = (task.assignee || "").split(",").map(n => n.trim().toLowerCase()).filter(Boolean);
      // Cap is per-workspace: only count prioritized tasks in the same workspace
      // (tasksForWorkspace also folds in untagged legacy rows for workforce).
      const taskWs = (task as any).workspace || DEFAULT_WS;
      const allTasks = await tasksForWorkspace(ctx, taskWs);

      for (const assignee of assignees) {
        let prioritizedCount = 0;
        for (const t of allTasks) {
          if (t._id === args.taskId) continue;
          if (t.isPrioritized) {
            const tAssignees = (t.assignee || "").split(",").map(n => n.trim().toLowerCase()).filter(Boolean);
            if (tAssignees.includes(assignee)) {
              prioritizedCount++;
            }
          }
        }
        if (prioritizedCount >= 3) {
          throw new Error(`Cannot prioritize: Assignee "${assignee}" already has 3 prioritized projects.`);
        }
      }
    }

    await ctx.db.patch(args.taskId, {
      isPrioritized: args.isPrioritized,
      lastUpdated: Date.now(),
    });
  },
});

export const generateUploadUrl = mutation(async (ctx) => {
  return await ctx.storage.generateUploadUrl();
});

export const getFeatureImageUrls = query({
  args: { storageIds: v.array(v.id("_storage")) },
  handler: async (ctx, args) => {
    const urls = [];
    for (const id of args.storageIds) {
      urls.push(await ctx.storage.getUrl(id));
    }
    return urls;
  },
});

export const addTaskFeature = mutation({
  args: {
    taskId: v.id("tasks"),
    feature: v.object({
      id: v.string(),
      name: v.string(),
      description: v.string(),
      status: v.string(),
      suggestedBy: v.optional(v.string()),
      imageStorageIds: v.optional(v.array(v.string())),
      type: v.optional(v.string()),
      createdAt: v.optional(v.string()),
    }),
    actorEmail: v.optional(v.string()),
    actorName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    console.log("Adding feature to task:", args.taskId, args.feature);
    const task = await ctx.db.get(args.taskId);
    if (!task) throw new Error("Task not found");
    const features = [...(task.features || [])];
    const featureWithTimestamp = {
      ...args.feature,
      createdAt: args.feature.createdAt || new Date().toLocaleString("en-US", {
        timeZone: "America/New_York",
        year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit",
      }),
      createdAtTime: Date.now(),
    };
    features.push(featureWithTimestamp);
    await ctx.db.patch(args.taskId, { features, lastUpdated: Date.now() });

    // --- Notification: notify task assignees ---
    // Skip if the actor is an assignee (owner) of the project
    if (args.actorEmail) {
      const actorEmail = args.actorEmail.toLowerCase();
      const allStaff = await ctx.db.query("staff").collect();
      const assigneeNames = (task.assignee || "").split(",").map(n => n.trim().toLowerCase()).filter(Boolean);
      if (!isActorAssignee(actorEmail, task.assignee || "", allStaff)) {
        for (const staff of allStaff) {
          if (staff.email.toLowerCase() === actorEmail) continue;
          const nameMatch = assigneeNames.some(a => staff.name.toLowerCase().includes(a) || a.includes(staff.name.toLowerCase()));
          if (nameMatch) {
            await ctx.db.insert("notifications", {
              workspace: ((task as any).workspace || DEFAULT_WS) as any,
              type: "project_change",
              targetEmail: staff.email.toLowerCase(),
              actorEmail,
              actorName: args.actorName || actorEmail,
              message: `added ${args.feature.type === "bug" ? "a bug" : "a feature"} "${args.feature.name}" to "${task.title}"`,
              taskId: args.taskId,
              taskTitle: task.title,
              read: false,
              createdAt: Date.now(),
            });
          }
        }
      }
    }

    // --- Manager oversight: notify all Managers of new features/bugs ---
    const isBug = args.feature.type === "bug";
    await notifyManagers(ctx, {
      workspace: (task as any).workspace || DEFAULT_WS,
      type: isBug ? "manager_bug" : "manager_feature",
      message: isBug
        ? `reported a bug "${args.feature.name}" on "${task.title}"`
        : `added a feature "${args.feature.name}" to "${task.title}"`,
      taskId: args.taskId,
      taskTitle: task.title,
      actorEmail: args.actorEmail,
      actorName: args.actorName || "A teammate",
      assigneeString: task.assignee || "",
    });
  },
});

export const updateFeatureStatus = mutation({
  args: {
    taskId: v.id("tasks"),
    featureId: v.string(),
    status: v.string(),
    writer: v.string(),
  },
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId);
    if (!task) throw new Error("Task not found");
    const features = [...(task.features || [])];
    const featIndex = features.findIndex(f => f.id === args.featureId);
    if (featIndex === -1) return;
    
    if (features[featIndex].status === args.status) return;

    features[featIndex].status = args.status;
    const updates: any = { features, lastUpdated: Date.now() };

    if (args.status === "completed") {
      features[featIndex].completedAt = new Date().toLocaleString("en-US", {
        timeZone: "America/New_York",
        year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit",
      });
      features[featIndex].completedAtTime = Date.now();
    } else {
      delete features[featIndex].completedAt;
      delete features[featIndex].completedAtTime;
    }

    await ctx.db.patch(args.taskId, updates);

    // --- Manager oversight: notify all Managers when a feature/bug is completed ---
    if (args.status === "completed") {
      const feat = features[featIndex];
      const isBug = feat.type === "bug";
      await notifyManagers(ctx, {
        workspace: (task as any).workspace || DEFAULT_WS,
        type: "manager_feature",
        message: `completed the ${isBug ? "bug fix" : "feature"} "${feat.name}" on "${task.title}"`,
        taskId: args.taskId,
        taskTitle: task.title,
        actorName: args.writer,
      });
    }
  },
});

/**
 * Daily scan (see convex/crons.ts) that flags projects to Managers:
 *   • Overdue — the completion deadline has passed
 *   • Stalled — no movement (no notes, no milestone/status change, nothing) for 5+ days
 *
 * Dedup markers on each task prevent re-notifying about the same episode every
 * run. A late flag clears once the project is no longer overdue; a stale flag
 * clears implicitly once the project moves again (lastUpdated advances past it).
 */
export const scanProjectsForManagers = internalMutation({
  args: {},
  handler: async (ctx) => {
    const allStaff = await ctx.db.query("staff").collect();
    const managers = allStaff.filter((s: any) => s.role === "Manager");
    if (managers.length === 0) return;

    const now = Date.now();
    const CLOSED = new Set(["done", "implemented", "scrapped", "scrapyard"]);
    const tasks = await ctx.db.query("tasks").collect();

    for (const task of tasks) {
      const status = (task.status || "").toLowerCase();
      if (CLOSED.has(status)) continue;

      // ── Overdue detection ──
      const { completionDue, complete } = computeCompletionDue(task);
      const isLate = !complete && completionDue !== null && completionDue < now;
      const lateMarker = (task as any).managerLateNotifiedAt;

      if (isLate && !lateMarker) {
        const dateStr = new Date(completionDue as number).toLocaleDateString("en-US", {
          month: "short", day: "numeric", year: "numeric",
        });
        const overdueDays = Math.floor((now - (completionDue as number)) / DAY_MS);
        await insertManagerNotifs(ctx, managers, {
          workspace: (task as any).workspace || DEFAULT_WS,
          type: "manager_overdue",
          message: `flagged "${task.title}" as overdue — completion was due ${dateStr}${overdueDays > 0 ? ` (${overdueDays}d late)` : ""}`,
          taskId: task._id,
          taskTitle: task.title,
        });
        await ctx.db.patch(task._id, { managerLateNotifiedAt: now });
      } else if (!isLate && lateMarker) {
        // No longer overdue — clear so a future late episode notifies again
        await ctx.db.patch(task._id, { managerLateNotifiedAt: undefined });
      }

      // ── Stalled detection (no movement for 5+ days) ──
      const lastUpdated = task.lastUpdated || 0;
      const isStale = lastUpdated > 0 && (now - lastUpdated) >= 5 * DAY_MS;
      const staleMarker = (task as any).managerStaleNotifiedAt || 0;
      // Notify only if we've never flagged it, or it has moved since our last flag
      if (isStale && staleMarker < lastUpdated) {
        const days = Math.floor((now - lastUpdated) / DAY_MS);
        await insertManagerNotifs(ctx, managers, {
          workspace: (task as any).workspace || DEFAULT_WS,
          type: "manager_stale",
          message: `flagged "${task.title}" — no activity for ${days} days (no notes or milestone movement)`,
          taskId: task._id,
          taskTitle: task.title,
        });
        await ctx.db.patch(task._id, { managerStaleNotifiedAt: now });
      }
    }
  },
});

export const updateTaskFeature = mutation({
  args: {
    taskId: v.id("tasks"),
    featureId: v.string(),
    updates: v.object({
      name: v.string(),
      description: v.string(),
      imageStorageIds: v.optional(v.array(v.string())),
    }),
  },
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId);
    if (!task) throw new Error("Task not found");

    const features = [...(task.features || [])];
    const featIndex = features.findIndex(f => f.id === args.featureId);
    if (featIndex === -1) return;

    features[featIndex] = {
      ...features[featIndex],
      ...args.updates,
    };

    await ctx.db.patch(args.taskId, { features, lastUpdated: Date.now() });
  },
});

export const deleteTaskFeature = mutation({
  args: {
    taskId: v.id("tasks"),
    featureId: v.string(),
  },
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId);
    if (!task) throw new Error("Task not found");

    const features = (task.features || []).filter(f => f.id !== args.featureId);
    await ctx.db.patch(args.taskId, { features, lastUpdated: Date.now() });
  },
});

export const markTaskAsViewed = mutation({
  args: {
    taskId: v.id("tasks"),
    userEmail: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("taskViewHistory")
      .withIndex("by_task_user", (q) => q.eq("taskId", args.taskId).eq("userEmail", args.userEmail))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, { lastViewedAt: Date.now() });
    } else {
      await ctx.db.insert("taskViewHistory", {
        taskId: args.taskId,
        userEmail: args.userEmail,
        lastViewedAt: Date.now(),
      });
    }
  },
});

export const getTaskViewHistory = query({
  args: {
    taskId: v.id("tasks"),
    userEmail: v.string(),
  },
  handler: async (ctx, args) => {
    const record = await ctx.db
      .query("taskViewHistory")
      .withIndex("by_task_user", (q) => q.eq("taskId", args.taskId).eq("userEmail", args.userEmail))
      .first();

    return record ? record.lastViewedAt : 0;
  },
});

export const toggleNoteReaction = mutation({
  args: {
    taskId: v.id("tasks"),
    noteIndex: v.number(),
    reactionType: v.string(), // "like" | "wow" | "heart" | "haha"
    userEmail: v.string(),
    userName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId);
    if (!task) throw new Error("Task not found");

    const notes = [...(task.notes || [])];
    if (args.noteIndex < 0 || args.noteIndex >= notes.length) return;

    const note = { ...notes[args.noteIndex] };
    const reactions = note.reactions
      ? { ...note.reactions }
      : { like: [], wow: [], heart: [], haha: [] };

    const key = args.reactionType as "like" | "wow" | "heart" | "haha";
    const arr = [...(reactions[key] || [])];
    const lowerEmail = args.userEmail.toLowerCase();
    const idx = arr.indexOf(lowerEmail);

    let isAdding = false;
    if (idx >= 0) {
      arr.splice(idx, 1); // remove reaction
    } else {
      arr.push(lowerEmail); // add reaction
      isAdding = true;
    }

    reactions[key] = arr;
    note.reactions = reactions;
    notes[args.noteIndex] = note;

    await ctx.db.patch(args.taskId, { notes });

    // --- Notification: notify the note author about the reaction ---
    if (isAdding && note.writer) {
      const allStaff = await ctx.db.query("staff").collect();
      const emojiMap: Record<string, string> = { like: "👍", wow: "😮", heart: "❤️", haha: "😂" };
      // Find the note author's email
      const writerName = note.writer.toLowerCase();
      for (const staff of allStaff) {
        if (staff.email.toLowerCase() === lowerEmail) continue;
        if (staff.name.toLowerCase() === writerName || staff.name.toLowerCase().includes(writerName)) {
          await ctx.db.insert("notifications", {
            workspace: ((task as any).workspace || DEFAULT_WS) as any,
            type: "reaction",
            targetEmail: staff.email.toLowerCase(),
            actorEmail: lowerEmail,
            actorName: args.userName || lowerEmail,
            message: `reacted ${emojiMap[key] || key} to your note on "${task.title}"`,
            taskId: args.taskId,
            taskTitle: task.title,
            read: false,
            createdAt: Date.now(),
          });
          break;
        }
      }
    }
  },
});

export const addNoteReply = mutation({
  args: {
    taskId: v.id("tasks"),
    noteIndex: v.number(),
    replyText: v.string(),
    writer: v.string(),
    writerEmail: v.optional(v.string()),
    date: v.string(),
  },
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId);
    if (!task) throw new Error("Task not found");

    const notes = [...(task.notes || [])];
    if (args.noteIndex < 0 || args.noteIndex >= notes.length) return;

    const note = { ...notes[args.noteIndex] };
    const replies = [...(note.replies || [])];

    replies.push({
      text: args.replyText,
      writer: args.writer,
      date: args.date,
      timestamp: Date.now(),
    });

    note.replies = replies;
    notes[args.noteIndex] = note;

    await ctx.db.patch(args.taskId, { notes });

    // --- Notification: notify original note author of reply ---
    const actorEmail = (args.writerEmail || "").toLowerCase();
    if (note.writer) {
      const allStaff = await ctx.db.query("staff").collect();
      const writerName = note.writer.toLowerCase();
      for (const staff of allStaff) {
        if (staff.email.toLowerCase() === actorEmail) continue;
        if (staff.name.toLowerCase() === writerName || staff.name.toLowerCase().includes(writerName)) {
          await ctx.db.insert("notifications", {
            workspace: ((task as any).workspace || DEFAULT_WS) as any,
            type: "project_change",
            targetEmail: staff.email.toLowerCase(),
            actorEmail,
            actorName: args.writer,
            message: `replied to your note on "${task.title}"`,
            taskId: args.taskId,
            taskTitle: task.title,
            read: false,
            createdAt: Date.now(),
          });
          break;
        }
      }
    }

    // Parse @mentions from reply text
    const mentions = args.replyText.match(/@([\w\s]+?)(?=[@,.]|$)/g);
    if (mentions) {
      const allStaff = await ctx.db.query("staff").collect();
      for (const mention of mentions) {
        const mentionedName = mention.substring(1).trim().toLowerCase();
        for (const staff of allStaff) {
          if (staff.email.toLowerCase() === actorEmail) continue;
          if (staff.name.toLowerCase().includes(mentionedName) || mentionedName.includes(staff.name.toLowerCase().split(" ")[0])) {
            await ctx.db.insert("notifications", {
              workspace: ((task as any).workspace || DEFAULT_WS) as any,
              type: "mention",
              targetEmail: staff.email.toLowerCase(),
              actorEmail,
              actorName: args.writer,
              message: `mentioned you in a reply on "${task.title}"`,
              taskId: args.taskId,
              taskTitle: task.title,
              read: false,
              createdAt: Date.now(),
            });
          }
        }
      }
    }

    return replies;
  },
});

// ==========================================
// BULK DELETIONS
// ==========================================

export const deleteTaskNotesBulk = mutation({
  args: {
    taskId: v.id("tasks"),
    indices: v.array(v.number()),
  },
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId);
    if (!task) throw new Error("Task not found");
    const currentNotes = task.notes || [];
    const indicesSet = new Set(args.indices);
    const updatedNotes = currentNotes.filter((_, i) => !indicesSet.has(i));
    await ctx.db.patch(args.taskId, {
      notes: updatedNotes,
      lastUpdated: Date.now(),
    });
  },
});

export const deleteTaskFeaturesBulk = mutation({
  args: {
    taskId: v.id("tasks"),
    featureIds: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId);
    if (!task) throw new Error("Task not found");
    const idSet = new Set(args.featureIds);
    const updatedFeatures = (task.features || []).filter((f) => !idSet.has(f.id));
    await ctx.db.patch(args.taskId, {
      features: updatedFeatures,
      lastUpdated: Date.now(),
    });
  },
});

export const deleteTaskMilestonesBulk = mutation({
  args: {
    taskId: v.id("tasks"),
    indices: v.array(v.number()),
  },
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId);
    if (!task) throw new Error("Task not found");
    const indicesSet = new Set(args.indices);
    const updatedMilestones = (task.milestones || []).filter((_, i) => !indicesSet.has(i));
    
    const completedCount = updatedMilestones.filter(m => m.completed).length;
    await ctx.db.patch(args.taskId, {
      milestones: updatedMilestones,
      completedMilestones: completedCount,
      lastUpdated: Date.now(),
    });
  },
});

export const migrateAllAdminCredentials = mutation({
  args: {},
  handler: async (ctx) => {
    const tasks = await ctx.db.query("tasks").collect();
    let count = 0;
    for (const task of tasks) {
      if (task.adminCredentials && !task.adminCredentials.password.startsWith("obf_")) {
        await ctx.db.patch(task._id, {
          adminCredentials: {
            email: obfuscate(task.adminCredentials.email),
            password: obfuscate(task.adminCredentials.password)
          }
        });
        count++;
      }
    }
    return { migrated: count };
  },
});
