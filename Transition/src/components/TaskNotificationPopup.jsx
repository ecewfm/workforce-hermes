import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useWorkspace } from "../utils/workspaceContext";
import { morphOriginFrom } from "../utils/modalOrigin";

/**
 * TaskNotificationPopup — shows on login for Programmers.
 * Lists tasks that have new notes, features, bugs, or milestones since last viewed.
 */
export default function TaskNotificationPopup({ userName, onDismiss, onOpenTask }) {
  const workspace = useWorkspace();
  const tasks = useQuery(api.tasks.getTasksLight, { workspace });
  const userEmail = (localStorage.getItem("wf_email") || "").toLowerCase();

  if (!tasks) return null;

  // Find tasks assigned to this user with unseen updates
  const userNameLower = (userName || "").toLowerCase();

  const tasksWithUpdates = tasks
    .filter((t) => {
      const assignees = (t.assignee || "").toLowerCase();
      return assignees.includes(userNameLower);
    })
    .map((t) => {
      const globalLS = parseInt(localStorage.getItem(`task_viewed_${t._id}`) || "0", 10);
      const lastViewed = globalLS;

      // Use pre-computed timestamps from getTasksLight to save bandwidth
      const newNotes = (t.lastNoteTimestamp || 0) > lastViewed ? 1 : 0;
      const newFeatures = (t.lastFeatureTimestamp || 0) > lastViewed ? 1 : 0;
      const newBugs = 0; // Covered by lastFeatureTimestamp for bandwidth efficiency

      const newMilestones = (t.milestones || []).filter((m) => {
        const milestoneTime = m.createdAtTime || 0;
        return milestoneTime > 0 && milestoneTime > lastViewed;
      }).length;

      const total = newNotes + newFeatures + newBugs + newMilestones;
      return { task: t, newNotes, newFeatures, newBugs, newMilestones, total };
    })
    .filter((x) => x.total > 0);

  // If nothing new, don't show anything
  if (tasksWithUpdates.length === 0) {
    // Auto-dismiss since there's nothing to show
    if (onDismiss) onDismiss();
    return null;
  }

  return (
    <div className="announcement-overlay" onClick={onDismiss}>
      <div className="task-notif-popup" onClick={(e) => e.stopPropagation()}>

        {/* Header */}
        <div className="task-notif-header">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              <circle cx="18" cy="4" r="3" fill="#ef4444" stroke="#ef4444" />
            </svg>
            <span>TASK UPDATES</span>
          </div>
          <span style={{ fontSize: "0.65rem", color: "rgba(255,255,255,0.7)", fontWeight: 600 }}>
            {tasksWithUpdates.length} project{tasksWithUpdates.length !== 1 ? "s" : ""} with updates
          </span>
        </div>

        {/* List */}
        <div className="task-notif-list">
          {tasksWithUpdates.map(({ task, newNotes, newFeatures, newBugs, newMilestones }) => (
            <div
              key={task._id}
              className="task-notif-item"
              onClick={(e) => {
                onOpenTask(task._id, morphOriginFrom(e.currentTarget));
                onDismiss();
              }}
            >
              <div className="task-notif-item-left">
                <div className="task-notif-icon-box">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                  </svg>
                </div>
                <div>
                  <h4 style={{ margin: 0, fontWeight: 800, fontSize: "0.82rem", color: "#0f172a" }}>{task.title}</h4>
                  <div className="task-notif-badges">
                    {newNotes > 0 && (
                      <span className="task-notif-badge notif-notes">
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                        {newNotes} note{newNotes !== 1 ? "s" : ""}
                      </span>
                    )}
                    {newFeatures > 0 && (
                      <span className="task-notif-badge notif-features">
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
                        {newFeatures} feature{newFeatures !== 1 ? "s" : ""}
                      </span>
                    )}
                    {newBugs > 0 && (
                      <span className="task-notif-badge notif-bugs">
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><circle cx="12" cy="12" r="4"/></svg>
                        {newBugs} bug{newBugs !== 1 ? "s" : ""}
                      </span>
                    )}
                    {newMilestones > 0 && (
                      <span className="task-notif-badge notif-milestones">
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                        {newMilestones} milestone{newMilestones !== 1 ? "s" : ""}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2.5" style={{ flexShrink: 0 }}>
                <polyline points="9 18 15 12 9 6"/>
              </svg>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="task-notif-footer">
          <button className="task-notif-dismiss-btn" onClick={onDismiss}>
            Dismiss All
          </button>
        </div>
      </div>
    </div>
  );
}
