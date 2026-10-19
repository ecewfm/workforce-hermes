// The app's data API — same names, arguments and result shapes as the old
// Convex functions (api.tasks.getTasksLight, api.staff.addStaff, …), now backed
// by Supabase. Components import this instead of convex/_generated/api.
//
// Each entry: { name, run(args) → Promise, reads: [tables] | writes: [tables] }
//   • reads  — tables a query depends on (it refetches when they change)
//   • writes — tables a mutation touches (those queries refresh right after)
//
// Permission checks and side effects (notifications, @mentions, manager alerts)
// happen server-side in the database functions — see
// supabase/migrations/20261019010000_app_logic.sql. Sign-in flows go through
// /api/auth (see ./auth.js).
import { supabase } from "./supabase";
import { authApi } from "./auth";

const WS = (w) => w || "workforce";
const TASK_TABLES = ["tasks", "task_milestones", "task_notes", "note_replies", "note_reactions", "task_features", "feature_images", "workspace_accounts", "staff_accounts"];
export const FEATURE_BUCKET = "feature-images";

async function rpc(fn, params) {
  const { data, error } = await supabase.rpc(fn, params);
  if (error) throw new Error(error.message || `${fn} failed`);
  return data;
}

/** Keep only keys that were actually passed (undefined = "leave unchanged"). */
function defined(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
}

const query = (name, reads, run) => ({ name, kind: "query", reads, run });
const mutation = (name, writes, run) => ({ name, kind: "mutation", writes, run });

// Mirrors the old Convex getProjectStats (computed from the board payload).
function projectStats(tasks) {
  const stats = { todo: 0, pending: 0, development: 0, testing: 0, done: 0, scrapyard: 0, implemented: 0, overallCompletion: 0, staffWorkload: [] };
  if (!tasks.length) return stats;
  let totalProg = 0;
  const workload = {};
  for (const t of tasks) {
    const status = (t.status || "").toLowerCase();
    if (status in stats && typeof stats[status] === "number") stats[status]++;
    else if (status === "inprogress") stats.development++;
    const totalM = (t.milestones || []).length || 10;
    totalProg += (t.completedMilestones || 0) / totalM;
    const isActive = status === "development" || status === "inprogress";
    const isPending = status === "pending";
    if (isActive || isPending) {
      for (const name of (t.assignee || "").split(",").map((n) => n.trim()).filter(Boolean)) {
        workload[name] ||= { name, active: 0, pending: 0 };
        if (isActive) workload[name].active++;
        if (isPending) workload[name].pending++;
      }
    }
  }
  stats.overallCompletion = Math.round((totalProg / tasks.length) * 100);
  stats.staffWorkload = Object.values(workload).sort((a, b) => b.active + b.pending - (a.active + a.pending));
  stats.projectsWithLinks = tasks
    .filter((t) => t.appscriptLink || t.webappLink || t.projectLink)
    .map((t) => ({ id: t._id, title: t.title, description: t.description, appscriptLink: t.appscriptLink, webappLink: t.webappLink || t.projectLink }));
  return stats;
}

/** Upload one screenshot for a feature/bug; returns its storage path (the "storageId"). */
export async function uploadFeatureImage(file) {
  const ext = (file.name?.split(".").pop() || file.type?.split("/").pop() || "png").toLowerCase().replace(/[^a-z0-9]/g, "");
  const path = `${crypto.randomUUID()}.${ext || "png"}`;
  const { error } = await supabase.storage.from(FEATURE_BUCKET).upload(path, file, { contentType: file.type || undefined });
  if (error) throw new Error(`Upload failed for ${file.name}: ${error.message}`);
  return path;
}

export const api = {
  // ── Projects ──────────────────────────────────────────────────────────────
  tasks: {
    getTasksLight: query("tasks.getTasksLight", TASK_TABLES, ({ workspace }) => rpc("get_tasks_light", { p_workspace: WS(workspace) })),
    getTasks: query("tasks.getTasks", TASK_TABLES, ({ workspace }) => rpc("get_tasks_full", { p_workspace: WS(workspace) })),
    getTaskById: query("tasks.getTaskById", TASK_TABLES, ({ taskId }) =>
      String(taskId || "").startsWith("optimistic-") ? Promise.resolve(null) : rpc("get_task", { p_task_id: taskId })),
    getProjectStats: query("tasks.getProjectStats", TASK_TABLES, async ({ workspace }) =>
      projectStats((await rpc("get_tasks_light", { p_workspace: WS(workspace) })) || [])),
    getTaskViewHistory: query("tasks.getTaskViewHistory", ["task_views"], ({ taskId }) =>
      rpc("get_task_view_history", { p_task_id: taskId })),
    getFeatureImageUrls: query("tasks.getFeatureImageUrls", ["feature_images"], async ({ storageIds }) => {
      if (!storageIds?.length) return [];
      const { data, error } = await supabase.storage.from(FEATURE_BUCKET).createSignedUrls(storageIds, 60 * 60);
      if (error) throw new Error(error.message);
      const byPath = new Map((data || []).map((d) => [d.path, d.signedUrl]));
      return storageIds.map((id) => byPath.get(id) || null);
    }),

    addTask: mutation("tasks.addTask", TASK_TABLES, (a) => rpc("add_task", {
      p_workspace: WS(a.workspace), p_title: a.title, p_assignee: a.assignee || "", p_description: a.description || "",
      p_milestones: a.milestones || [], p_start_date: a.startDate || null,
      p_account_id: a.accountId || null, p_documents: a.documents || null,
      p_watch_outs: a.watchOuts || null, p_assumptions: a.assumptions || null,
    })),
    updateTaskStatus: mutation("tasks.updateTaskStatus", ["tasks"], (a) => rpc("update_task_status", { p_task_id: a.taskId, p_status: a.newStatus })),
    updateTaskMilestones: mutation("tasks.updateTaskMilestones", TASK_TABLES, (a) => rpc("update_task_milestones", {
      p_task_id: a.taskId, p_milestones: a.milestones, p_actor_name: a.actorName || null,
    })),
    addNoteToTask: mutation("tasks.addNoteToTask", TASK_TABLES, async (a) => {
      const note = await rpc("add_note_to_task", { p_task_id: a.taskId, p_text: a.noteText, p_writer: a.writer || null });
      return [note]; // Convex returned the notes array; callers read the last item
    }),
    deleteTask: mutation("tasks.deleteTask", TASK_TABLES, (a) => rpc("delete_task", { p_task_id: a.taskId, p_source: a.source || null })),
    updateTaskDetails: mutation("tasks.updateTaskDetails", TASK_TABLES, (a) => rpc("update_task_details", {
      p_task_id: a.taskId, p_title: a.newTitle, p_description: a.newDescription ?? "", p_assignee: a.newAssignee ?? "",
      p_appscript_link: a.newAppscriptLink ?? null, p_webapp_link: a.newWebappLink ?? null,
      p_milestones: a.newMilestones || [], p_actor_name: a.actorName || null,
    })),
    updateTaskLinks: mutation("tasks.updateTaskLinks", ["tasks"], (a) => rpc("update_task_links", {
      p_task_id: a.taskId, p_links: defined({ appscriptLink: a.appscriptLink, webappLink: a.webappLink, projectLink: a.projectLink }),
    })),
    // Operations/Executives: a list of named links ({ name, url }) — returns the cleaned list.
    updateTaskDocuments: mutation("tasks.updateTaskDocuments", ["tasks"], (a) => rpc("update_task_documents", { p_task_id: a.taskId, p_documents: a.documents || [] })),
    // The plan's "watch out for" risks and assumptions (send either or both).
    updateTaskPlanNotes: mutation("tasks.updateTaskPlanNotes", ["tasks"], (a) => rpc("update_task_plan_notes", {
      p_task_id: a.taskId, p_watch_outs: a.watchOuts ?? null, p_assumptions: a.assumptions ?? null,
    })),
    setTaskAccount: mutation("tasks.setTaskAccount", ["tasks"], (a) => rpc("set_task_account", { p_task_id: a.taskId, p_account_id: a.accountId || null })),
    updateProjectLink: mutation("tasks.updateProjectLink", ["tasks"], (a) => rpc("update_project_link", { p_task_id: a.taskId, p_project_link: a.projectLink })),
    updateAdminCredentials: mutation("tasks.updateAdminCredentials", ["tasks"], (a) => rpc("update_admin_credentials", {
      p_task_id: a.taskId, p_email: a.email ?? "", p_password: a.password ?? "",
    })),
    toggleTaskPriority: mutation("tasks.toggleTaskPriority", ["tasks"], (a) => rpc("toggle_task_priority", { p_task_id: a.taskId, p_is_prioritized: !!a.isPrioritized })),
    setTaskDeadline: mutation("tasks.setTaskDeadline", ["tasks"], (a) => rpc("set_task_deadline", {
      p_task_id: a.taskId, p_deadline_ms: a.deadline == null ? null : Math.round(a.deadline),
    })),
    addTaskFeature: mutation("tasks.addTaskFeature", TASK_TABLES, (a) => rpc("add_task_feature", {
      p_task_id: a.taskId, p_feature: a.feature, p_actor_name: a.actorName || null,
    })),
    updateFeatureStatus: mutation("tasks.updateFeatureStatus", TASK_TABLES, (a) => rpc("update_feature_status", {
      p_task_id: a.taskId, p_feature_id: a.featureId, p_status: a.status, p_writer: a.writer || null,
    })),
    updateTaskFeature: mutation("tasks.updateTaskFeature", TASK_TABLES, (a) => rpc("update_task_feature", {
      p_task_id: a.taskId, p_feature_id: a.featureId, p_updates: a.updates,
    })),
    deleteTaskFeature: mutation("tasks.deleteTaskFeature", TASK_TABLES, (a) => rpc("delete_task_feature", { p_task_id: a.taskId, p_feature_id: a.featureId })),
    deleteTaskFeaturesBulk: mutation("tasks.deleteTaskFeaturesBulk", TASK_TABLES, (a) => rpc("delete_task_features_bulk", { p_task_id: a.taskId, p_feature_ids: a.featureIds })),
    deleteTaskNotesBulk: mutation("tasks.deleteTaskNotesBulk", TASK_TABLES, (a) => rpc("delete_task_notes_bulk", {
      p_task_id: a.taskId, p_indices: a.indices || [], p_note_ids: a.noteIds?.length ? a.noteIds : null,
    })),
    deleteTaskMilestonesBulk: mutation("tasks.deleteTaskMilestonesBulk", TASK_TABLES, (a) => rpc("delete_task_milestones_bulk", { p_task_id: a.taskId, p_indices: a.indices })),
    markTaskAsViewed: mutation("tasks.markTaskAsViewed", ["task_views"], (a) => rpc("mark_task_viewed", { p_task_id: a.taskId })),
    toggleNoteReaction: mutation("tasks.toggleNoteReaction", TASK_TABLES, (a) => rpc("toggle_note_reaction", {
      p_task_id: a.taskId, p_note_index: a.noteIndex ?? 0, p_reaction: a.reactionType, p_note_id: a.noteId || null,
    })),
    addNoteReply: mutation("tasks.addNoteReply", TASK_TABLES, (a) => rpc("add_note_reply", {
      p_task_id: a.taskId, p_note_index: a.noteIndex ?? 0, p_text: a.replyText, p_writer: a.writer || null, p_note_id: a.noteId || null,
    })),
    // Uploads now go straight to Supabase Storage — see uploadFeatureImage().
    generateUploadUrl: mutation("tasks.generateUploadUrl", [], async () => {
      throw new Error("generateUploadUrl was replaced by uploadFeatureImage(file).");
    }),
  },

  // ── Accounts (client accounts a workspace's projects belong to — Operations) ─
  accounts: {
    getAccounts: query("accounts.getAccounts", ["workspace_accounts", "tasks"], ({ workspace }) => rpc("get_accounts", { p_workspace: WS(workspace) })),
    addAccount: mutation("accounts.addAccount", ["workspace_accounts"], (a) => rpc("add_account", { p_workspace: WS(a.workspace), p_name: a.name })),
    renameAccount: mutation("accounts.renameAccount", ["workspace_accounts", "tasks"], (a) => rpc("rename_account", { p_account_id: a.accountId, p_name: a.name })),
    deleteAccount: mutation("accounts.deleteAccount", ["workspace_accounts", "tasks"], (a) => rpc("delete_account", { p_account_id: a.accountId })),
    // Who belongs to which account. Someone tied to accounts (below Admin+) only
    // sees those accounts' projects — enforced by the database.
    getStaffAccounts: query("accounts.getStaffAccounts", ["staff_accounts", "workspace_accounts", "staff"], ({ workspace }) => rpc("get_staff_accounts", { p_workspace: WS(workspace) })),
    setStaffAccounts: mutation("accounts.setStaffAccounts", ["staff_accounts", "workspace_accounts"], (a) =>
      rpc("set_staff_accounts", { p_email: a.email, p_workspace: WS(a.workspace), p_account_ids: a.accountIds || [] })),
  },

  // ── Staff ─────────────────────────────────────────────────────────────────
  staff: {
    getStaff: query("staff.getStaff", ["staff"], () => rpc("get_staff")),
    getStaffByEmail: query("staff.getStaffByEmail", ["staff"], () => rpc("get_my_profile")),
    addStaff: mutation("staff.addStaff", ["staff"], (a) => rpc("add_staff", {
      p_name: a.name, p_email: a.email, p_role: a.role, p_departments: a.departments || null,
    })),
    updateStaffRole: mutation("staff.updateStaffRole", ["staff"], (a) => rpc("update_staff_role", { p_staff_email: a.staffEmail, p_new_role: a.newRole })),
    // Pending request → member of the workspace it was approved from.
    approveStaff: mutation("staff.approveStaff", ["staff"], (a) => rpc("approve_staff", { p_email: a.email, p_workspace: WS(a.workspace) })),
    updateStaffDepartment: mutation("staff.updateStaffDepartment", ["staff"], (a) => rpc("update_staff_department", {
      p_staff_email: a.staffEmail, p_departments: a.departments || [],
    })),
    deleteStaff: mutation("staff.deleteStaff", ["staff"], (a) => rpc("delete_staff", { p_email: a.email })),
    // Your own profile only — the email argument is ignored server-side.
    updateProfile: mutation("staff.updateProfile", ["staff"], (a) => rpc("update_profile", {
      p_fields: defined({ name: a.name, bio: a.bio, avatarUrl: a.avatarUrl, country: a.country, status: a.status }),
    })),
    // Sign-in flows (server-side, /api/auth)
    login: mutation("staff.login", ["staff"], authApi.login),
    checkEmailStatus: mutation("staff.checkEmailStatus", [], authApi.checkEmailStatus),
    setPassword: mutation("staff.setPassword", ["staff"], authApi.setPassword),
    getSecurityQuestion: mutation("staff.getSecurityQuestion", [], authApi.getSecurityQuestion),
    verifySecurityAnswer: mutation("staff.verifySecurityAnswer", [], authApi.verifySecurityAnswer),
    setSecurityQuestion: mutation("staff.setSecurityQuestion", ["staff"], authApi.setSecurityQuestion),
    changePassword: mutation("staff.changePassword", [], authApi.changePassword),
    resetPassword: mutation("staff.resetPassword", ["staff"], authApi.resetPassword),
  },

  // ── Workspace settings ────────────────────────────────────────────────────
  appConfig: {
    getAppConfig: query("appConfig.getAppConfig", ["workspace_settings"], ({ workspace }) => rpc("get_app_config", { p_workspace: WS(workspace) })),
    saveAppConfig: mutation("appConfig.saveAppConfig", ["workspace_settings"], ({ workspace, ...fields }) =>
      rpc("save_app_config", { p_workspace: WS(workspace), p_fields: defined(fields) })),
    verifyWorkspacePassword: mutation("appConfig.verifyWorkspacePassword", [], ({ workspace, passwordHash }) =>
      rpc("verify_workspace_password", { p_workspace: WS(workspace), p_password_hash: passwordHash })),
  },

  // ── Notebook ──────────────────────────────────────────────────────────────
  notebook: {
    getIdeas: query("notebook.getIdeas", ["notebook_ideas"], ({ workspace }) => rpc("get_ideas", { p_workspace: WS(workspace) })),
    addIdea: mutation("notebook.addIdea", ["notebook_ideas"], (a) => rpc("add_idea", {
      p_workspace: WS(a.workspace), p_name: a.name, p_description: a.description || "", p_pros: a.pros || "", p_cons: a.cons || "", p_details: a.details || "",
    })),
    deleteIdea: mutation("notebook.deleteIdea", ["notebook_ideas"], (a) => rpc("delete_idea", { p_idea_id: a.ideaId })),
    takeIdea: mutation("notebook.takeIdea", ["notebook_ideas", ...TASK_TABLES], (a) => rpc("take_idea", { p_idea_id: a.ideaId, p_taker_name: a.takerName || null })),
  },

  // ── Announcements ─────────────────────────────────────────────────────────
  announcements: {
    getAnnouncements: query("announcements.getAnnouncements", ["announcements", "announcement_views"], ({ workspace }) =>
      rpc("get_announcements", { p_workspace: WS(workspace) })),
    getUnseenAnnouncement: query("announcements.getUnseenAnnouncement", ["announcements", "announcement_views"], ({ workspace }) =>
      rpc("get_unseen_announcement", { p_workspace: WS(workspace) })),
    postAnnouncement: mutation("announcements.postAnnouncement", ["announcements"], (a) =>
      rpc("post_announcement", { p_workspace: WS(a.workspace), p_title: a.title, p_body: a.body })),
    markAnnouncementSeen: mutation("announcements.markAnnouncementSeen", ["announcement_views"], (a) =>
      rpc("mark_announcement_seen", { p_announcement_id: a.announcementId })),
    deleteAnnouncement: mutation("announcements.deleteAnnouncement", ["announcements"], (a) =>
      rpc("delete_announcement", { p_announcement_id: a.announcementId })),
  },

  // ── Handbook ──────────────────────────────────────────────────────────────
  handbook: {
    getHandbook: query("handbook.getHandbook", ["handbooks"], ({ workspace }) => rpc("get_handbook", { p_workspace: WS(workspace) })),
    // baseUpdatedAt: the version you started editing — the server refuses to
    // overwrite a newer save. Returns the new version (ms).
    saveHandbook: mutation("handbook.saveHandbook", ["handbooks"], (a) => rpc("save_handbook", {
      p_workspace: WS(a.workspace), p_blocks: a.blocks || [], p_base_updated_at: a.baseUpdatedAt ?? null,
    })),
  },

  // ── Notifications (always the signed-in user's own) ───────────────────────
  notifications: {
    getNotifications: query("notifications.getNotifications", ["notifications"], ({ workspace }) =>
      rpc("get_notifications", { p_workspace: WS(workspace) })),
    getUnreadCount: query("notifications.getUnreadCount", ["notifications"], ({ workspace }) =>
      rpc("get_unread_count", { p_workspace: WS(workspace) })),
    getLatestNotification: query("notifications.getLatestNotification", ["notifications"], async ({ workspace }) =>
      ((await rpc("get_notifications", { p_workspace: WS(workspace) })) || [])[0] ?? null),
    markRead: mutation("notifications.markRead", ["notifications"], (a) => rpc("mark_notification_read", { p_notification_id: a.notificationId })),
    markAllRead: mutation("notifications.markAllRead", ["notifications"], (a) => rpc("mark_all_notifications_read", { p_workspace: WS(a.workspace) })),
  },
};
