import { useState, useEffect } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { getProjectDeadlines, deadlineTone, DAY_MS } from "../utils/deadlines";
import { notifyTaskUpdated, notifyMilestoneCompleted, notifyNoteAdded } from "../utils/notifications";
import { useWorkspace } from "../utils/workspaceContext";

const cleanConvexError = (errorMessage) => {
  if (!errorMessage) return "An unexpected error occurred.";
  const match = errorMessage.match(/Uncaught Error:\s*([^\n]+)/);
  if (match && match[1]) {
    return match[1].replace(/\s*at\s+handler.*/i, "").trim();
  }
  return errorMessage.replace(/\[CONVEX[^\]]*\]/g, "").replace(/Server/gi, "").trim();
};

const isTaskOverdue = (t) => {
  if (t.status === "scrapped") return false;
  const milestones = t.milestones || [];
  const firstIncompleteIdx = milestones.findIndex((ms) => !ms.completed);
  if (firstIncompleteIdx === -1) return false;
  const m = milestones[firstIncompleteIdx];
  if (!m || !m.days) return false;
  let lastTime = 0;
  if (firstIncompleteIdx > 0) {
    lastTime = milestones[firstIncompleteIdx - 1].completedAtTime || milestones[firstIncompleteIdx - 1].createdAtTime || t.lastUpdated;
  } else {
    lastTime = m.createdAtTime || t.lastUpdated;
  }
  if (lastTime) {
    const elapsedDays = (Date.now() - lastTime) / (1000 * 60 * 60 * 24);
    return elapsedDays > m.days;
  }
  return false;
};

const getMilestoneDeadline = (t, idx) => {
  if (t.status === "scrapped") return null;
  const milestones = t.milestones || [];
  const m = milestones[idx];
  if (!m || !m.days) return null;
  let lastTime = 0;
  if (idx > 0) {
    lastTime = milestones[idx - 1].completedAtTime || milestones[idx - 1].createdAtTime || t.lastUpdated;
  } else {
    lastTime = m.createdAtTime || t.lastUpdated;
  }
  if (lastTime) {
    return lastTime + (m.days * 24 * 60 * 60 * 1000);
  }
  return null;
};


export default function KanbanBoard({ userRole, actualRole, userName, openTaskModal, onContextMenu, showModal, staff, searchQuery, filterStaff, onOpenProfile, onClearFilter }) {
  const workspace = useWorkspace();
  const tasks = useQuery(api.tasks.getTasksLight, { workspace });
  const toggleTaskPriority = useMutation(api.tasks.toggleTaskPriority);
  // The args object is part of the query cache key — the optimistic getQuery/
  // setQuery keys MUST match the useQuery key ({ workspace }) or drag-and-drop
  // silently no-ops.
  const updateTaskStatus = useMutation(api.tasks.updateTaskStatus).withOptimisticUpdate(
    (localStore, { taskId, newStatus }) => {
      const allTasks = localStore.getQuery(api.tasks.getTasksLight, { workspace });
      if (!Array.isArray(allTasks)) return;
      const task = allTasks.find((t) => t._id === taskId);
      if (task) {
        localStore.setQuery(api.tasks.getTasksLight, { workspace }, (prevTasks) => {
          if (!Array.isArray(prevTasks)) return prevTasks;
          return prevTasks.map((t) => (t._id === taskId ? { ...t, status: newStatus, lastUpdated: Date.now() } : t));
        });
      }
    }
  );
  const updateTaskMilestones = useMutation(api.tasks.updateTaskMilestones);
  const addNoteToTask = useMutation(api.tasks.addNoteToTask);
  const deleteTask = useMutation(api.tasks.deleteTask);

  const [expandedCards, setExpandedCards] = useState({});
  const [draggedMilestoneIdx, setDraggedMilestoneIdx] = useState(null);
  const [lastKnownTasks, setLastKnownTasks] = useState([]);
  const [fullViewColumn, setFullViewColumn] = useState(null);
  const [storageRefresh, setStorageRefresh] = useState(0); // Trigger re-render when tasks are viewed
  
  // Listen for custom event when tasks are marked as viewed (in same tab)
  useEffect(() => {
    const handleTaskViewed = () => {
      console.log("🔄 Task viewed event received, refreshing badges");
      setStorageRefresh(prev => prev + 1);
    };
    window.addEventListener("task-viewed", handleTaskViewed);
    return () => window.removeEventListener("task-viewed", handleTaskViewed);
  }, []);
  
  // For Programmer: calculate badge counts
  const isProgrammer = actualRole === "Programmer";
  const userEmail = localStorage.getItem("wf_email") || "";
  
  // Helper to calculate badges for a single task
  // Show badges if user is in Programmer view OR has Programmer role
  const getTaskBadges = (task) => {
    const canSeeBadges = userRole === "Programmer" || actualRole === "Programmer";
    if (!canSeeBadges || !task) {
      return { newNotes: 0, newFeatures: 0, newBugs: 0, hasBadges: false };
    }
    
    const globalViewedTime = parseInt(localStorage.getItem(`task_viewed_${task._id}`) || "0", 10);
    
    // Check specific timestamps or fallback to global
    const lastViewedFeatures = Math.max(parseInt(localStorage.getItem(`task_viewed_features_${task._id}`) || "0", 10), globalViewedTime);
    const lastViewedBugs = Math.max(parseInt(localStorage.getItem(`task_viewed_bugs_${task._id}`) || "0", 10), globalViewedTime);
    const lastViewedNotes = Math.max(parseInt(localStorage.getItem(`task_viewed_notes_${task._id}`) || "0", 10), globalViewedTime);
    const lastViewedMilestones = Math.max(parseInt(localStorage.getItem(`task_viewed_milestones_${task._id}`) || "0", 10), globalViewedTime);

    // Use pre-computed timestamps from getTasksLight to save bandwidth
    const newNotes = (task.lastNoteTimestamp || 0) > lastViewedNotes ? 1 : 0;
    
    // For features/bugs, we use lastFeatureTimestamp
    // Note: We can't distinguish between feature and bug without the full data,
    // so we'll just show the badge if there's any new feature/bug.
    const hasNewFeatureOrBug = (task.lastFeatureTimestamp || 0) > Math.min(lastViewedFeatures, lastViewedBugs);
    const newFeatures = hasNewFeatureOrBug ? 1 : 0;
    const newBugs = 0; // Simplified for bandwidth
    
    const newMilestones = (task.milestones || [])
      .filter(m => {
        const mTime = m.createdAtTime || 0;
        return mTime > 0 && mTime > lastViewedMilestones;
      }).length;
      
    const hasBadges = newNotes > 0 || newFeatures > 0 || newBugs > 0 || newMilestones > 0;
    const total = newNotes + newFeatures + newBugs + newMilestones;
    
    if (hasBadges || total > 0) {
      console.log(`📌 Badge calc for ${task.title} (${task._id}):`, { 
        hasBadges, 
        total,
        lastViewedTime: globalViewedTime,
        lastViewString: globalViewedTime > 0 ? new Date(globalViewedTime).toLocaleString() : "Never Viewed",
        notesCount: (task.notes || []).length,
        notesDetail: (task.notes || []).map(n => ({ 
          text: n.text?.slice(0,15), 
          hasTimestamp: !!n.timestamp,
          timestamp: n.timestamp,
          isNew: (n.timestamp || 0) > lastViewedNotes
        })),
        newNotes, 
        newFeatures, 
        newBugs,
      });
    }
    
    return { newNotes, newFeatures, newBugs, hasBadges, total };
  };
  
  // Body scroll lock for full column view
  useEffect(() => {
    if (fullViewColumn) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
  }, [fullViewColumn]);

  // Reset the anti-flicker cache when the workspace changes, so we never show
  // the previous workspace's projects while the new workspace's query loads.
  useEffect(() => {
    setLastKnownTasks([]);
  }, [workspace]);

  useEffect(() => {
    // Cache the latest server result — INCLUDING an empty list. Switching to a
    // blank workspace must clear the board, not keep the prior workspace's tasks.
    if (Array.isArray(tasks)) {
      setLastKnownTasks(tasks);
    }
  }, [tasks]);

  if (!tasks && lastKnownTasks.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: 40 }}>
        <p style={{ color: "#94a3b8" }}>Loading kanban...</p>
      </div>
    );
  }

  // Use the live result whenever it has loaded (even if empty); only fall back
  // to the cache while the query is still undefined (mid-load).
  const displayTasks = Array.isArray(tasks) ? tasks : lastKnownTasks;

  const columns = ["todo", "pending", "development", "testing", "done", "implemented", "scrapped"];
  const columnLabels = {
    todo: "To Do",
    pending: "Pending",
    development: "In Development",
    testing: "In Testing",
    done: "Done",
    implemented: "Implemented",
    scrapped: "Scrapped Yard",
  };
  const columnClasses = {
    todo: "col-todo",
    pending: "col-pending",
    development: "col-dev",
    testing: "col-test",
    done: "col-done",
    implemented: "col-implemented",
    scrapped: "col-scrap",
  };

  const sorted = [...(Array.isArray(displayTasks) ? displayTasks : [])].sort((a, b) => b.lastUpdated - a.lastUpdated);
  let filtered = sorted;
  if (userRole === "Programmer") {
    filtered = sorted.filter(
      (t) => t.assignee && t.assignee.toLowerCase().includes(userName.toLowerCase())
    );
  }

  // Person filter (chosen from header search): show only this person's projects.
  // Assignees are stored as full names joined by ", ", so a full-name substring
  // match is precise; we fall back to the first-name token for robustness.
  if (filterStaff?.name) {
    const fullName = filterStaff.name.toLowerCase();
    const firstName = fullName.split(" ")[0];
    filtered = filtered.filter((t) => {
      const a = (t.assignee || "").toLowerCase();
      return a.includes(fullName) || (firstName.length > 1 && a.includes(firstName));
    });
  }

  // Search is visual-only on the board — doesn't filter cards out
  const searchActive = searchQuery && searchQuery.trim().length > 0;
  const sq = searchActive ? searchQuery.toLowerCase().trim() : "";
  const isSearchMatch = (t) => !searchActive || 
    (t.title && t.title.toLowerCase().includes(sq)) || 
    (t.assignee && t.assignee.toLowerCase().includes(sq));

  // Count per column
  const totals = {};
  columns.forEach((c) => {
    totals[c] = filtered.filter((t) => {
      const s = (t.status || "").toLowerCase();
      if (c === "development") return s === "development" || s === "inprogress";
      return s === c;
    }).length;
  });

  function handleDrop(e, newStatus) {
    e.preventDefault();
    const taskId = e.dataTransfer.getData("taskId");
    if (taskId) {
      updateTaskStatus({ taskId, newStatus })
        .catch(err => {
          showModal({ title: "Error", message: cleanConvexError(err.message), type: "alert" });
        });
    }
  }

  function handleMoveTask(taskId, newStatus) {
    const task = lastKnownTasks.find((t) => t._id === taskId);
    if (task) {
      notifyTaskUpdated(task.title);
    }
    updateTaskStatus({ taskId, newStatus })
      .catch(err => {
        showModal({ title: "Error", message: cleanConvexError(err.message), type: "alert" });
      });
  }

  function toggleMilestone(taskId, milestoneIdx, task) {
    const milestones = JSON.parse(JSON.stringify(task.milestones));
    const isNowCompleted = !milestones[milestoneIdx].completed;
    milestones[milestoneIdx].completed = isNowCompleted;
    if (isNowCompleted) {
      milestones[milestoneIdx].completedAt = new Date().toLocaleString("en-US", {
        timeZone: "America/New_York",
        year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit",
      });
      milestones[milestoneIdx].completedAtTime = Date.now();
      notifyMilestoneCompleted(task.title, milestones[milestoneIdx].name);
    } else {
      delete milestones[milestoneIdx].completedAt;
      delete milestones[milestoneIdx].completedAtTime;
    }
    const completedCount = milestones.filter((m) => m.completed).length;
    updateTaskMilestones({ taskId, milestones, completedCount })
      .catch(err => {
        showModal({ title: "Error", message: cleanConvexError(err.message), type: "alert" });
      });
  }

  function handleAddNote(taskId, inputId) {
    const input = document.getElementById(inputId);
    const text = input?.value?.trim();
    if (!text) return;
    const task = lastKnownTasks.find((t) => t._id === taskId);
    const estDate = new Date().toLocaleString("en-US", {
      timeZone: "America/New_York",
      year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit",
    });
    addNoteToTask({ taskId, noteText: text, writer: userName, writerEmail: (localStorage.getItem("wf_email") || "").toLowerCase(), date: estDate })
      .catch(err => {
        showModal({ title: "Error", message: cleanConvexError(err.message), type: "alert" });
      });
    if (task) {
      notifyNoteAdded(task.title, text);
    }
    input.value = "";
  }

  function toggleMilestoneView(taskId) {
    setExpandedCards((prev) => ({ ...prev, [taskId]: !prev[taskId] }));
  }

  function handleMilestoneDrop(e, taskId, targetIdx, task) {
    e.preventDefault();
    e.stopPropagation();
    if (draggedMilestoneIdx === null || draggedMilestoneIdx === targetIdx) return;
    const milestones = [...task.milestones];
    const [moved] = milestones.splice(draggedMilestoneIdx, 1);
    milestones.splice(targetIdx, 0, moved);
    const completedCount = milestones.filter((m) => m.completed).length;
    updateTaskMilestones({ taskId, milestones, completedCount })
      .catch(err => {
        showModal({ title: "Error", message: cleanConvexError(err.message), type: "alert" });
      });
    setDraggedMilestoneIdx(null);
  }

  function renderTaskCard(t, isFullView = false, dimmed = false) {
    const milestones = t.milestones || [];
    const totalM = milestones.length > 0 ? milestones.length : 10;
    const doneM = t.completedMilestones || 0;
    const progressPercent = Math.round((doneM / totalM) * 100);

    const isOverdue = isTaskOverdue(t);

    // Cards show the project's COMPLETION date; the per-milestone deadline
    // only appears inside the task modal.
    const dl = getProjectDeadlines(t);
    const completionDue = dl && !dl.complete ? dl.completionDue : null;
    const completionLeft = completionDue ? Math.ceil((completionDue - Date.now()) / DAY_MS) : null;
    const completionTone = completionLeft !== null ? deadlineTone(completionLeft) : null;

    let canEditMilestone = true;
    if (actualRole === "Admin") {
      const assigneeVal = (t.assignee || "").toLowerCase();
      const userNameVal = (userName || "").toLowerCase();
      if (!assigneeVal.includes(userNameVal)) canEditMilestone = false;
    }

    const isProgrammerView = userRole === "Programmer";
    const cardClass = isFullView ? "rounded-task-card" : (isProgrammerView ? "programmer-card" : "task-card");

    return (
      <div
        key={t._id}
        className={cardClass}
        draggable={!isFullView}
        data-id={t._id}
        onDragStart={(e) => {
          if (isFullView) return;
          e.dataTransfer.setData("taskId", t._id);
          e.currentTarget.classList.add("dragging");
        }}
        onDragEnd={(e) => !isFullView && e.currentTarget.classList.remove("dragging")}
        onClick={() => { setFullViewColumn(null); openTaskModal(t._id); }}
        onContextMenu={(e) => onContextMenu(e, t)}
        style={{
          boxShadow: isOverdue ? "0 0 15px rgba(239, 68, 68, 0.35)" : undefined,
          border: isOverdue ? "1px solid #fee2e2" : undefined,
          position: "relative",
          opacity: dimmed ? 0.35 : 1,
          filter: dimmed ? "grayscale(0.4)" : undefined,
          transition: "opacity 0.2s, filter 0.2s"
        }}
      >
        <div className="card-header" style={{ marginBottom: 12, display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <h4 style={{ fontSize: "0.85rem", fontWeight: 900, letterSpacing: "-0.4px", display: "flex", alignItems: "center", gap: "6px" }}>
              {t.title}
            </h4>
            <div style={{ fontSize: "0.6rem", color: "#94a3b8", fontWeight: 800, letterSpacing: "0.8px", display: "flex", gap: "6px", alignItems: "center", marginTop: "4px" }}>
              {((t.assignee || "").split(",").filter(a => a.trim()).length > 1) ? (
                <>
                  <span style={{ background: "#dbeafe", color: "#1e40af", padding: "2px 8px", borderRadius: "12px" }}>
                    SHARED
                  </span>
                  <span>#{(t._id || "").slice(-4).toUpperCase()}</span>
                </>
              ) : (
                <span>#{(t._id || "").slice(-4).toUpperCase()}</span>
              )}
              {completionDue && (
                <span
                  className={`card-completion-chip ${completionTone}`}
                  title={`Project completion deadline${dl.overridden ? " (set by admin)" : ""} — ${completionLeft < 0 ? `${Math.abs(completionLeft)} days overdue` : `${completionLeft} days left`}`}
                >
                  {completionTone === "overdue" ? "LATE" : "DONE BY"}: {new Date(completionDue).toLocaleDateString("en-US", { month: "short", day: "numeric" }).toUpperCase()}
                  {dl.overridden && " 📌"}
                </span>
              )}
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
            {t.isPrioritized && (
              <span 
                style={{ background: "#fef9c3", color: "#854d0e", padding: "4px 10px", borderRadius: "8px", cursor: "pointer", fontSize: "0.6rem", fontWeight: 900, letterSpacing: "0.5px" }}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleTaskPriority({ taskId: t._id, isPrioritized: false })
                    .catch(err => {
                      showModal({ title: "Priority Error", message: cleanConvexError(err.message), type: "alert" });
                    });
                }}
                title="Remove Priority"
              >
                PRIORITY
              </span>
            )}
            {(userRole === "Programmer" || actualRole === "Programmer") && getTaskBadges(t).hasBadges && (
              <div style={{
                background: "#ef4444",
                color: "white",
                fontSize: "0.65rem",
                fontWeight: 900,
                padding: "3px 7px",
                borderRadius: "12px",
                minWidth: "24px",
                textAlign: "center",
                whiteSpace: "nowrap",
              }}>
                {getTaskBadges(t).total}
              </div>
            )}
          </div>
        </div>
        
        {isFullView && (
          <div className="rounded-task-tag">
            {t.status.toUpperCase()}
          </div>
        )}

        <div className="card-assignee" style={{ marginBottom: 12, fontSize: "0.7rem", color: "var(--color-text-secondary)", display: "flex", alignItems: "center", gap: 6 }}>
          {(() => {
            const assigneeName = t.assignee || "";
            const found = (staff || []).find(s => s.name === assigneeName);
            const avatarUrl = found?.avatarUrl;
            if (avatarUrl) {
              return <img src={avatarUrl} alt={assigneeName} style={{ width: 16, height: 16, borderRadius: "50%", objectFit: "cover" }} />;
            }
            return (
              <svg className="assignee-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ width: 14, height: 14 }}>
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
            );
          })()}
          {t.assignee || "Unassigned"}
        </div>

        {(isProgrammerView && !isFullView) ? (
          <>
            <div style={{ background: "var(--color-bg-subtle)", border: "1px solid var(--glass-border)", borderRadius: 12, padding: 15, marginBottom: 20 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontWeight: 800, color: "#1e293b", marginBottom: 10 }}>
                <span style={{ fontSize: "0.75rem", color: "#64748b" }}>
                  Milestones: {doneM} / {totalM} ({progressPercent}%)
                </span>
                <button
                  type="button"
                  className="btn-secondary"
                  style={{ padding: "2px 8px", fontSize: "0.7rem", borderRadius: 6 }}
                  onClick={(e) => { e.stopPropagation(); toggleMilestoneView(t._id); }}
                >
                  {expandedCards[t._id] ? "Collapse" : "Expand"}
                </button>
              </div>
              <div className="progress-container" style={{ height: 8, marginBottom: 15, borderRadius: 10 }}>
                <div className="progress-fill" style={{ width: `${progressPercent}%`, borderRadius: 10 }}></div>
              </div>
              <div className={`milestone-vertical-list ${expandedCards[t._id] ? "" : "collapsed-view"}`}>
                {milestones.map((m, idx) => {
                  const allCompleted = milestones.every((ms) => ms.completed);
                  let status = "waiting";
                  const firstIncompleteIdx = milestones.findIndex((ms) => !ms.completed);
                  if (m.completed) status = "completed";
                  else if (idx === firstIncompleteIdx) status = "active";

                  // Check if overdue
                  let isOverdue = false;
                  if (status === "active" && m.days > 0) {
                    let lastTime = 0;
                    if (idx > 0) {
                      lastTime = milestones[idx - 1].completedAtTime || milestones[idx - 1].createdAtTime || t.lastUpdated;
                    } else {
                      lastTime = m.createdAtTime || t.lastUpdated;
                    }
                    if (lastTime) {
                      const elapsedDays = (Date.now() - lastTime) / (1000 * 60 * 60 * 24);
                      if (elapsedDays > m.days) {
                        isOverdue = true;
                      }
                    }
                  }

                  let actionBtn;
                  if (canEditMilestone) {
                    if (status === "completed") {
                      actionBtn = <button className="btn-milestone-undo" onClick={(e) => { e.stopPropagation(); toggleMilestone(t._id, idx, t); }}>Undo</button>;
                    } else if (status === "active") {
                      actionBtn = <button className="btn-milestone-complete" onClick={(e) => { e.stopPropagation(); toggleMilestone(t._id, idx, t); }}>Complete</button>;
                    } else {
                      actionBtn = <span className="badge-waiting">Waiting</span>;
                    }
                  } else {
                    if (status === "completed") actionBtn = <span className="badge-completed">Completed</span>;
                    else if (status === "active") actionBtn = <span className="badge-active">Active</span>;
                    else actionBtn = <span className="badge-waiting">Waiting</span>;
                  }

                  let visibilityClass = "";
                  if (status === "active" || (allCompleted && idx === milestones.length - 1)) {
                    visibilityClass = "m-active-or-last";
                  }

                  const deadlineTime = status === "active" ? getMilestoneDeadline(t, idx) : null;

                  return (
                    <div
                      key={idx}
                      className={`milestone-list-item ${status} ${visibilityClass} ${isOverdue ? "overdue" : ""}`}
                      style={{ 
                        padding: 10, 
                        gap: 10,
                        border: isOverdue ? "1px solid #ef4444" : undefined,
                        boxShadow: isOverdue ? "0 0 8px rgba(239, 68, 68, 0.4)" : undefined,
                        background: isOverdue ? "rgba(239, 68, 68, 0.05)" : undefined,
                      }}
                      draggable={canEditMilestone}
                      onDragStart={(e) => { e.stopPropagation(); setDraggedMilestoneIdx(idx); }}
                      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }}
                      onDrop={(e) => handleMilestoneDrop(e, t._id, idx, t)}
                    >
                      <div className="drag-handle" style={{ fontSize: "1rem" }}>⋮⋮</div>
                      <div className="milestone-list-content">
                        <div className="milestone-name-row">
                          <span className={`m-name ${m.completed ? "strike" : ""}`} style={{ fontSize: "0.75rem", color: isOverdue ? "#ef4444" : undefined }}>
                            {m.name} <span style={{ fontWeight: "normal", color: isOverdue ? "#ef4444" : "#94a3b8" }}>({m.days} days)</span>
                            {isOverdue && <span style={{ marginLeft: 6, fontSize: "0.6rem", fontWeight: "bold", color: "white", background: "#ef4444", padding: "2px 6px", borderRadius: "8px" }}>OVERDUE</span>}
                          </span>
                          {actionBtn}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        ) : (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
              <span style={{ fontSize: "0.7rem", fontWeight: 900, color: "var(--color-text-secondary)", letterSpacing: "0.5px" }}>
                Progress
              </span>
              <span style={{ fontSize: "0.7rem", fontWeight: 900, color: "var(--color-accent)" }}>
                {progressPercent}%
              </span>
            </div>
            <div className="progress-container" style={{ height: 6, borderRadius: 10 }}>
              <div className="progress-fill" style={{ width: `${progressPercent}%`, borderRadius: 10 }}></div>
            </div>
            <div className="milestones-grid" style={{ marginTop: 10 }}>
              {Array.from({ length: totalM }, (_, i) => (
                <div key={i} className={`milestone-dot ${i < doneM ? "active" : ""}`}>
                  {i + 1}
                </div>
              ))}
            </div>
            {(() => {
              const firstIncompleteIdx = milestones.findIndex((ms) => !ms.completed);
              if (firstIncompleteIdx !== -1 && milestones[firstIncompleteIdx]) {
                const currentM = milestones[firstIncompleteIdx];
                return (
                  <div style={{ fontSize: "0.68rem", color: "var(--color-text-secondary)", margin: "8px 0 2px 0", fontWeight: 700 }}>
                    Current: <span style={{ color: "var(--color-text-primary)", fontWeight: 800 }}>{currentM.name}</span>
                  </div>
                );
              }
              return null;
            })()}
            <div className="card-actions">
              {["todo", "pending", "development", "testing", "done", "implemented", "scrapped"].map((s) => (
                <div key={s} className="action-btn" onClick={(e) => { e.stopPropagation(); handleMoveTask(t._id, s); }}>
                  {s === "development" ? "Dev" : s === "testing" ? "Test" : s === "implemented" ? "Impl" : s === "scrapped" ? "Scrap" : s.charAt(0).toUpperCase() + s.slice(1)}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div id="kanban-view" className="view-section">
      {filterStaff && (
        <div className="kanban-filter-banner">
          <div className="kfb-person">
            {filterStaff.avatarUrl ? (
              <img src={filterStaff.avatarUrl} alt={filterStaff.name} className="kfb-avatar" />
            ) : (
              <div className="kfb-avatar kfb-avatar-fallback">{(filterStaff.name || "?").charAt(0)}</div>
            )}
            <div className="kfb-text">
              <div className="kfb-title">
                Showing <strong>{filterStaff.name}</strong>'s projects
                <span className="kfb-count">{filtered.length}</span>
              </div>
              <div className="kfb-sub">Filtered from search · open their profile for full details</div>
            </div>
          </div>
          <div className="kfb-actions">
            <button className="kfb-btn kfb-btn-profile" onClick={() => onOpenProfile && onOpenProfile()}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
              </svg>
              Open Profile
            </button>
            <button className="kfb-btn kfb-btn-clear" onClick={() => onClearFilter && onClearFilter()} title="Clear filter">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
              Clear
            </button>
          </div>
        </div>
      )}
      {filterStaff && filtered.length === 0 && (
        <div className="kfb-empty">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><line x1="9" y1="9" x2="15" y2="15" /><line x1="15" y1="9" x2="9" y2="15" />
          </svg>
          <span>No projects assigned to {filterStaff.name}.</span>
        </div>
      )}
      <div className="kanban-totals-bar" style={{ gap: "15px", padding: "15px 20px", marginBottom: "15px" }}>
        {columns.map((c) => (
          <div className="total-card" key={c} onClick={() => setFullViewColumn(c)} style={{ padding: "15px", borderRadius: "var(--radius-md)", border: "1px solid #f1f5f9", boxShadow: "var(--shadow-sm)" }}>
            <div className="total-value" style={{ fontSize: "1.4rem", color: `var(--${columnClasses[c].replace("col-", "col-")})` }}>
              {totals[c]}
            </div>
            <div className="total-label" style={{ fontSize: "0.6rem", letterSpacing: "1.2px" }}>{columnLabels[c]}</div>
          </div>
        ))}
      </div>

      <div className="kanban-container">
        {columns.map((col) => (
          <div
            key={col}
            className={`kanban-col ${columnClasses[col]}`}
            onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add("drag-over"); }}
            onDragLeave={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              if (e.clientX <= rect.left || e.clientX >= rect.right || e.clientY <= rect.top || e.clientY >= rect.bottom) {
                e.currentTarget.classList.remove("drag-over");
              }
            }}
            onDrop={(e) => { e.currentTarget.classList.remove("drag-over"); handleDrop(e, col); }}
          >
            <div className="col-header" style={{ padding: "10px", letterSpacing: "0.8px", fontSize: "0.75rem" }}>{columnLabels[col]}</div>
            <div className="col-content">
              {filtered
                .filter((t) => {
                  const s = (t.status || "").toLowerCase();
                  if (col === "development") return s === "development" || s === "inprogress";
                  return s === col;
                })
                .slice(0, 5) // Show only latest 5
                .map((t) => renderTaskCard(t, false, !isSearchMatch(t)))}
            </div>
          </div>
        ))}
      </div>

      {/* Full View Modal */}
      {fullViewColumn && (
        <div className="modal-overlay" onClick={() => setFullViewColumn(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 1400 }}>
            <button className="modal-close" onClick={() => setFullViewColumn(null)}>×</button>
            <h2 style={{ 
              fontWeight: 900, 
              textTransform: "uppercase", 
              marginBottom: 25, 
              paddingBottom: 15,
              borderBottom: "1px solid #f1f5f9",
              color: "var(--color-text-primary)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between"
            }}>
              <span>All Tasks: {columnLabels[fullViewColumn]} ({totals[fullViewColumn]})</span>
            </h2>
            <div className="full-kanban-grid">
              {filtered
                .filter((t) => {
                  const s = (t.status || "").toLowerCase();
                  if (fullViewColumn === "development") return s === "development" || s === "inprogress";
                  return s === fullViewColumn;
                })
                .map((t) => renderTaskCard(t, true, !isSearchMatch(t)))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
