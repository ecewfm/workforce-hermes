import { useState, useEffect, useRef, useLayoutEffect } from "react";
import { gsap } from "gsap";
import { useQuery, useMutation, prefetchQuery } from "../data/react";
import { api } from "../data/api";
import { getProjectDeadlines, deadlineTone, DAY_MS, milestoneAnchor } from "../utils/deadlines";
import { notifyTaskUpdated, notifyMilestoneCompleted, notifyNoteAdded } from "../utils/notifications";
import { useWorkspace } from "../utils/workspaceContext";
import { resolveColumns, taskInColumn, isArchivedStatus } from "../utils/columns";
import { termsFor } from "../utils/workspaceTerms";
import { useAccountUi } from "../utils/accountScope";
import { morphOriginFrom } from "../utils/modalOrigin";
import ColumnGather from "./ColumnGather";

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
  const anchor = milestoneAnchor(t, firstIncompleteIdx);
  if (!anchor) return false; // not started (To Do) → never overdue
  const elapsedDays = (Date.now() - anchor) / DAY_MS;
  return elapsedDays > m.days;
};

const getMilestoneDeadline = (t, idx) => {
  if (t.status === "scrapped") return null;
  const milestones = t.milestones || [];
  const m = milestones[idx];
  if (!m || !m.days) return null;
  const anchor = milestoneAnchor(t, idx);
  return anchor ? anchor + m.days * DAY_MS : null;
};


// A number that rolls to its new value (board totals). Text only — cheap.
function CountUp({ value, duration = 650 }) {
  const [shown, setShown] = useState(0);
  const fromRef = useRef(0);
  useEffect(() => {
    const from = fromRef.current;
    if (from === value || window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) {
      fromRef.current = value;
      setShown(value);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const step = (now) => {
      const p = Math.min(1, (now - t0) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setShown(Math.round(from + (value - from) * eased));
      if (p < 1) raf = requestAnimationFrame(step);
      else fromRef.current = value;
    };
    raf = requestAnimationFrame(step);
    return () => { cancelAnimationFrame(raf); fromRef.current = value; };
  }, [value, duration]);
  return <span className="count-up">{shown}</span>;
}

// Board totals tilt toward the pointer (transform only, via CSS variables).
function tiltTotalCard(e) {
  if (e.pointerType !== "mouse") return;
  const el = e.currentTarget;
  const r = el.getBoundingClientRect();
  const x = (e.clientX - r.left) / r.width - 0.5;
  const y = (e.clientY - r.top) / r.height - 0.5;
  el.style.setProperty("--tc-rx", `${(-y * 10).toFixed(2)}deg`);
  el.style.setProperty("--tc-ry", `${(x * 12).toFixed(2)}deg`);
  el.style.setProperty("--tc-gx", `${((x + 0.5) * 100).toFixed(1)}%`);
}
function untiltTotalCard(e) {
  const el = e.currentTarget;
  el.style.setProperty("--tc-rx", "0deg");
  el.style.setProperty("--tc-ry", "0deg");
}

// Hover stretch: how tall the move strip is (varies per card) and which side
// the info column opens on.
function measureStretch(e) {
  const shell = e.currentTarget;
  const bottom = shell.querySelector(".tf-wing-bottom")?.offsetHeight;
  if (bottom) shell.style.setProperty("--tf-b", `${bottom}px`);
  // Open the info column to the right, or to the left when the card is near the right edge.
  const r = shell.getBoundingClientRect();
  shell.dataset.side = r.right + 200 > window.innerWidth ? "left" : "right";
}

export default function KanbanBoard({ userRole, actualRole, userName, openTaskModal, openNotesModal, onContextMenu, showModal, staff, searchQuery, filterStaff, onOpenProfile, onClearFilter }) {
  const workspace = useWorkspace();
  const tasks = useQuery(api.tasks.getTasksLight, { workspace });
  const appConfig = useQuery(api.appConfig.getAppConfig, { workspace });
  const terms = termsFor(workspace);
  // Operations: projects belong to client accounts; the board can show one.
  const accounts = useQuery(api.accounts.getAccounts, terms.accounts ? { workspace } : "skip");
  // Account bar/pills: Admin+ see every account; others only when they have several.
  const accUi = useAccountUi(workspace, actualRole, userRole);
  const addAccount = useMutation(api.accounts.addAccount);
  const accountKey = `wf_account_filter_${workspace}`;
  const [accountFilter, setAccountFilterState] = useState(() => {
    try { return localStorage.getItem(accountKey) || "all"; } catch { return "all"; }
  });
  useEffect(() => {
    try { setAccountFilterState(localStorage.getItem(accountKey) || "all"); } catch { setAccountFilterState("all"); }
  }, [accountKey]);
  const setAccountFilter = (v) => {
    setAccountFilterState(v);
    try { localStorage.setItem(accountKey, v); } catch { /* private mode */ }
  };
  const [newAccountOpen, setNewAccountOpen] = useState(false);
  const [newAccountName, setNewAccountName] = useState("");
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
  // A board total was clicked: that column's cards gather to the front.
  const [gather, setGather] = useState(null); // { column, sourceEl, cardWidth }
  const [storageRefresh, setStorageRefresh] = useState(0); // Trigger re-render when tasks are viewed
  const warmTimer = useRef(null); // hover → prefetch the full task (see the card's onPointerEnter)
  useEffect(() => () => clearTimeout(warmTimer.current), []);

  // ── GSAP board entrance: cards trickle into each column right after the
  // column itself lands (columns cascade via CSS at 0.06s + 0.05s·i). The old
  // CSS nth-child stagger couldn't see through the .tf-shell wrapper, so every
  // card popped on the same beat — GSAP staggers the real card wrappers.
  // Runs ONCE per board mount, after the tasks query first resolves.
  const boardRef = useRef(null);
  const entranceRan = useRef(false);
  useLayoutEffect(() => {
    if (entranceRan.current || !tasks || !boardRef.current) return;
    entranceRan.current = true;
    // GSAP doesn't honor prefers-reduced-motion by itself — appear in place.
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) return;
    const cols = boardRef.current.querySelectorAll(".kanban-col");
    cols.forEach((col, ci) => {
      const cards = col.querySelectorAll(".col-content > *");
      if (!cards.length) return;
      gsap.fromTo(
        cards,
        // transition:"none" while GSAP drives transform — .tf-shell's hover
        // spring transition would otherwise re-ease every tweened frame.
        { y: 16, autoAlpha: 0, transition: "none" },
        {
          y: 0,
          autoAlpha: 1,
          duration: 0.42,
          ease: "power3.out",
          delay: 0.26 + ci * 0.05,
          stagger: 0.06,
          clearProps: "transform,opacity,visibility,transition",
        }
      );
    });
  }, [tasks]);
  
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
    
    return { newNotes, newFeatures, newBugs, hasBadges, total };
  };
  

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

  // Totals: a card bumps when its number changes (a project moved in or out).
  // The numbers are recorded during render (liveTotals) and compared after each
  // commit — declared here, above the loading return, so hook order never changes.
  const liveTotals = useRef(null);
  const prevTotals = useRef(null);
  useEffect(() => {
    const now = liveTotals.current;
    if (!now) return;
    const prev = prevTotals.current;
    prevTotals.current = now;
    if (!prev || window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) return;
    for (const id of Object.keys(now)) {
      if ((prev[id] || 0) === (now[id] || 0)) continue;
      const el = boardRef.current?.parentElement?.querySelector(`.total-card[data-col="${CSS.escape(id)}"]`);
      el?.animate(
        [{ transform: "scale(1)" }, { transform: "scale(1.07)", offset: 0.35 }, { transform: "scale(0.98)", offset: 0.7 }, { transform: "scale(1)" }],
        { duration: 520, easing: "ease-out", composite: "add" },
      );
    }
  });

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

  // Per-workspace column config (manager-editable in Settings → Workspace
  // Defaults). Falls back to that workspace's default columns when none is saved.
  const columnDefs = resolveColumns(appConfig?.columns, workspace);
  const columns = columnDefs.map((c) => c.id);
  const columnById = Object.fromEntries(columnDefs.map((c) => [c.id, c]));
  const columnLabel = (id) => columnById[id]?.label || id;
  // Every task resolves to exactly ONE column: the one matching its status, or
  // the first column as a fallback so a task whose column was removed (or a new
  // task whose default status has no column) is never lost. Archived projects
  // are the exception: with no archive column on this board they stay off it
  // (Settings → Archived Projects) instead of falling into the first column.
  const columnForTask = (status) => {
    const match = columnDefs.find((c) => taskInColumn(status, c.id));
    if (match) return match.id;
    return isArchivedStatus(status) ? null : columns[0];
  };
  // Size the grid to the ACTUAL number of columns so a board with few columns
  // fills the space with properly-sized, centered columns instead of leaving
  // empty tracks. Each column caps at 340px so 2–3 columns don't stretch huge.
  const boardGridStyle = {
    gridTemplateColumns: `repeat(${Math.max(1, columnDefs.length)}, minmax(0, 340px))`,
    justifyContent: "center",
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

  // Account filter (Operations). A remembered account that was deleted since
  // falls back to "All accounts".
  const accountView = !accUi.show ? "all"
    : accountFilter === "all" || (accountFilter === "none" && accUi.full) || !Array.isArray(accounts) || accUi.limit(accounts).some((a) => a._id === accountFilter)
      ? accountFilter : "all";
  const accountCounts = { all: filtered.length, none: 0 };
  if (terms.accounts) {
    for (const t of filtered) {
      const k = t.accountId || "none";
      accountCounts[k] = (accountCounts[k] || 0) + 1;
    }
    if (accountView !== "all") {
      filtered = filtered.filter((t) => (accountView === "none" ? !t.accountId : t.accountId === accountView));
    }
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
    totals[c] = filtered.filter((t) => columnForTask(t.status) === c).length;
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
    // "gather": the board card itself, shown in the gathered front view —
    // same look, but not draggable and without the hover wings.
    const gathered = isFullView === "gather";
    if (gathered) isFullView = false;
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
    const isDefaultCard = !isFullView && !isProgrammerView && !gathered;
    const badges = getTaskBadges(t); // compute once, reused in the header below

    // ── Hover-wing data (default board card only) ──
    const wFirstIncomplete = milestones.findIndex((ms) => !ms.completed);
    const wCurrentM = wFirstIncomplete !== -1 ? milestones[wFirstIncomplete] : null;
    // Dot grid is a simplified model: first `doneM` read complete, so the dot
    // at index `doneM` is the current one in progress.
    const wCurrentDotIdx = doneM < totalM ? doneM : -1;
    const wDaysLabel =
      (t.status || "").toLowerCase() === "todo" ? "Starts when work begins"
      : completionLeft === null ? "No deadline set"
      : completionLeft < 0 ? `${Math.abs(completionLeft)} days overdue`
      : completionLeft === 0 ? "Due today"
      : `${completionLeft} day${completionLeft === 1 ? "" : "s"} remaining`;
    const wNoteText = (t.lastNoteText || "").trim();
    const wNoteWriter = (t.lastNoteWriter || "").trim();
    const wNotesCount = t.notesCount || 0;
    const W_MOVES = columns; // the workspace's configured columns
    const wMoveLabel = (id) => columnLabel(id);

    // Is the current (active) milestone overdue? Mirrors the programmer view:
    // elapsed time since the previous milestone finished exceeds its day budget.
    let wCurrentOverdue = false;
    if (wCurrentM && (wCurrentM.days || 0) > 0) {
      const anchor = milestoneAnchor(t, wFirstIncomplete);
      if (anchor && (Date.now() - anchor) / DAY_MS > wCurrentM.days) wCurrentOverdue = true;
    }

    // Rest body = the original detailed design.
    const oldDesignBody = (
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
        {wCurrentM && (
          <div style={{ fontSize: "0.68rem", color: "var(--color-text-secondary)", margin: "8px 0 2px 0", fontWeight: 700 }}>
            Current: <span style={{ color: "var(--color-text-primary)", fontWeight: 800 }}>{wCurrentM.name}</span>
          </div>
        )}
        <div className="card-actions">
          {W_MOVES.map((s) => (
            <div key={s} className="action-btn" title={`Move to ${wMoveLabel(s)}`} onClick={(e) => { e.stopPropagation(); handleMoveTask(t._id, s); }}>
              {wMoveLabel(s)}
            </div>
          ))}
        </div>
      </>
    );

    // Hover body = focused current-milestone pill (the "first image").
    const focusPill = wCurrentM ? (
      <div className={`tf-focus-milestone ${wCurrentOverdue ? "overdue" : ""}`}>
        <div className="tf-focus-info">
          <span className="tf-focus-name">
            {wCurrentM.name} <span className="tf-focus-days">({wCurrentM.days} days)</span>
          </span>
          {wCurrentOverdue && <span className="tf-focus-badge">OVERDUE</span>}
        </div>
        {canEditMilestone && (
          <button
            className="tf-focus-complete"
            onClick={(e) => { e.stopPropagation(); toggleMilestone(t._id, wFirstIncomplete, t); }}
          >
            Complete
          </button>
        )}
      </div>
    ) : (
      <div className="tf-focus-done">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>
        All milestones complete
      </div>
    );

    const cardEl = (
      <div
        key={t._id}
        className={cardClass}
        draggable={!isFullView && !gathered}
        data-id={t._id}
        onDragStart={(e) => {
          if (isFullView || gathered) return;
          e.dataTransfer.setData("taskId", t._id);
          e.currentTarget.classList.add("dragging");
        }}
        onDragEnd={(e) => !isFullView && !gathered && e.currentTarget.classList.remove("dragging")}
        onClick={(e) => {
          // The card exactly as it looks right now (hover pop included) plus
          // the task data we already hold: the modal paints on this same
          // click and grows out of this very card.
          openTaskModal(t._id, false, false, morphOriginFrom(e.currentTarget), t);
        }}
        // Hovering a card warms its full task (notes, features), so the
        // modal usually has it by the time it lands.
        onPointerEnter={() => {
          clearTimeout(warmTimer.current);
          warmTimer.current = setTimeout(() => prefetchQuery(api.tasks.getTaskById, { taskId: t._id }), 120);
        }}
        onPointerLeave={() => clearTimeout(warmTimer.current)}
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
              {accUi.show && t.account && <span className="card-account-pill" title="Account">{t.account}</span>}
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
                className="priority-pill"
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
            {(userRole === "Programmer" || actualRole === "Programmer") && badges.hasBadges && (
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
                {badges.total}
              </div>
            )}
          </div>
        </div>
        
        {isFullView && (
          <div className="rounded-task-tag">
            {String(columnLabel(columnForTask(t.status)) || t.status).toUpperCase()}
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

                  // Check if overdue (no countdown until the project leaves To Do)
                  let isOverdue = false;
                  if (status === "active" && m.days > 0) {
                    const anchor = milestoneAnchor(t, idx);
                    if (anchor && (Date.now() - anchor) / DAY_MS > m.days) isOverdue = true;
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
        ) : isDefaultCard ? (
          <div className="tf-swap">
            <div className="tf-swap-detail"><div className="tf-swap-inner">{oldDesignBody}</div></div>
            <div className="tf-swap-focus"><div className="tf-swap-inner">{focusPill}</div></div>
          </div>
        ) : (
          oldDesignBody
        )}
      </div>
    );

    if (!isDefaultCard) return cardEl;

    // Default board card: on hover it STRETCHES into a two-column panel — an
    // info column (time left, milestones, latest note) opens beside it and the
    // move buttons slide out below. See .tf-surface in index.css.
    return (
      <div className="tf-shell" key={t._id} onPointerEnter={measureStretch}>
        <div className="tf-surface" aria-hidden="true" />
        <div className="tf-wing tf-wing-side">
          <div className="tf-side-sec">
            <span className="tf-wing-cap">Time left</span>
            <span className={`tf-days ${completionTone || ""}`}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
              {wDaysLabel}
            </span>
          </div>
          <div className="tf-side-sec" aria-hidden="true">
            <span className="tf-wing-cap">Milestones <b>{doneM}/{totalM}</b></span>
            <div className="tf-wing-dots">
              {Array.from({ length: totalM }, (_, i) => (
                <div key={i} className={`milestone-dot ${i < doneM ? "active" : ""} ${i === wCurrentDotIdx ? "current" : ""}`}>
                  {i + 1}
                </div>
              ))}
            </div>
          </div>
          <div
            className="tf-side-note"
            title="Open notes"
            onClick={(e) => { e.stopPropagation(); openNotesModal(t._id); }}
          >
            <span className="tf-wing-cap">Latest note</span>
            <div className="tf-note-body">
              {wNoteText ? (
                <>
                  <p className="tf-note-text">{wNoteText}</p>
                  {wNoteWriter && <span className="tf-note-writer">— {wNoteWriter}</span>}
                </>
              ) : wNotesCount > 0 ? (
                <p className="tf-note-text">{wNotesCount} note{wNotesCount === 1 ? "" : "s"} — click to view</p>
              ) : (
                <p className="tf-note-empty">No notes yet</p>
              )}
            </div>
            <div className="tf-note-add">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
              Add note
            </div>
          </div>
        </div>
        <div className="tf-wing tf-wing-bottom">
          <span className="tf-wing-cap">Move to</span>
          <div className="card-actions" onClick={(e) => e.stopPropagation()}>
            {W_MOVES.map((st) => (
              <div key={st} className="action-btn" title={`Move to ${wMoveLabel(st)}`} onClick={(e) => { e.stopPropagation(); handleMoveTask(t._id, st); }}>
                {wMoveLabel(st)}
              </div>
            ))}
          </div>
        </div>
        {cardEl}
      </div>
    );
  }

  liveTotals.current = { ...totals };

  return (
    <div id="kanban-view" className="view-section">
      {accUi.locked && (
        <div className="account-locked-note" role="status">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
          <div>
            <b>You're not on a client account yet.</b>
            <span>{terms.label} projects show up here once an Admin+ or Manager adds you to an account. Your other workspaces aren't affected.</span>
          </div>
        </div>
      )}
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
      {accUi.show && (
        <div className="account-bar" role="toolbar" aria-label="Filter by account">
          <span className="account-bar-label">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><path d="M3 21h18M5 21V7l7-4 7 4v14M9 9h1m4 0h1M9 13h1m4 0h1M9 17h1m4 0h1" /></svg>
            Account
          </span>
          {[{ _id: "all", name: accUi.full ? "All accounts" : "All my accounts" }, ...accUi.limit(accounts), ...(accUi.full ? [{ _id: "none", name: "No account" }] : [])].map((a, i) => (
            <button
              key={a._id}
              type="button"
              className={`account-chip ${accountView === a._id ? "active" : ""}`}
              style={{ animationDelay: `${Math.min(i, 10) * 35}ms` }}
              onClick={() => setAccountFilter(a._id)}
            >
              {a.name}
              <span className="account-chip-count">{accountCounts[a._id] || 0}</span>
            </button>
          ))}
          {accUi.full && (newAccountOpen ? (
            <form
              className="account-new-form"
              onSubmit={async (e) => {
                e.preventDefault();
                const name = newAccountName.trim();
                if (!name) { setNewAccountOpen(false); return; }
                try {
                  const id = await addAccount({ workspace, name });
                  setNewAccountName("");
                  setNewAccountOpen(false);
                  if (id) setAccountFilter(String(id));
                } catch (err) {
                  showModal({ title: "Couldn't create the account", message: err?.message || "Please try again.", type: "alert" });
                }
              }}
            >
              <input
                autoFocus
                value={newAccountName}
                onChange={(e) => setNewAccountName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Escape") { setNewAccountOpen(false); setNewAccountName(""); } }}
                onBlur={() => { if (!newAccountName.trim()) setNewAccountOpen(false); }}
                placeholder="New account name"
                maxLength={80}
              />
              <button type="submit">Add</button>
            </form>
          ) : (
            <button type="button" className="account-chip account-chip-new" onClick={() => setNewAccountOpen(true)} title="Create a client account (Admin+)">
              + New account
            </button>
          ))}
        </div>
      )}
      <div className="kanban-totals-bar" style={{ gap: "15px", padding: "15px 120px", marginBottom: "15px", ...boardGridStyle }}>
        {columnDefs.map((cd) => {
          const over = cd.limit && totals[cd.id] > cd.limit;
          return (
            <div
              className="total-card"
              key={cd.id}
              data-col={cd.id}
              onClick={(e) => {
                const boardCardEl = boardRef.current?.querySelector(".task-card, .programmer-card");
                setGather({ column: cd, sourceEl: e.currentTarget, cardWidth: Math.max(boardCardEl?.offsetWidth || 260, 240) });
              }}
              onPointerMove={tiltTotalCard}
              onPointerLeave={untiltTotalCard}
              style={{ padding: "15px", borderRadius: "var(--radius-md)", border: over ? "1px solid #fecaca" : "1px solid #f1f5f9", boxShadow: "var(--shadow-sm)", "--tc-accent": cd.color }}
            >
              <div className="total-value" style={{ fontSize: "1.4rem", color: cd.color }}>
                <CountUp value={totals[cd.id] || 0} />
                {cd.limit ? <span style={{ fontSize: "0.8rem", color: over ? "#ef4444" : "#94a3b8", fontWeight: 700 }}> / {cd.limit}</span> : null}
              </div>
              <div className="total-label" style={{ fontSize: "0.6rem", letterSpacing: "1.2px" }}>{cd.label}</div>
            </div>
          );
        })}
      </div>

      <div className="kanban-container" style={boardGridStyle} ref={boardRef}>
        {columnDefs.map((cd) => {
          const col = cd.id;
          const over = cd.limit && totals[col] > cd.limit;
          return (
          <div
            key={col}
            className="kanban-col"
            style={{ borderTopColor: cd.color, background: `linear-gradient(to bottom, ${cd.color}14, var(--color-card-bg))` }}
            onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add("drag-over"); }}
            onDragLeave={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              if (e.clientX <= rect.left || e.clientX >= rect.right || e.clientY <= rect.top || e.clientY >= rect.bottom) {
                e.currentTarget.classList.remove("drag-over");
              }
            }}
            onDrop={(e) => { e.currentTarget.classList.remove("drag-over"); handleDrop(e, col); }}
          >
            <div className="col-header" style={{ padding: "10px", letterSpacing: "0.8px", fontSize: "0.75rem", background: cd.color }}>
              {cd.label}{cd.limit ? <span style={{ opacity: 0.85, marginLeft: 4 }}>({totals[col]}/{cd.limit})</span> : null}
            </div>
            <div className="col-content">
              {over && (
                <div style={{ margin: "8px 8px 0", fontSize: "0.58rem", fontWeight: 800, color: "#ef4444", textAlign: "center", background: "#fee2e2", borderRadius: 6, padding: "3px 6px" }}>
                  Over limit ({totals[col]}/{cd.limit})
                </div>
              )}
              {filtered
                .filter((t) => columnForTask(t.status) === col)
                .slice(0, 5) // Show only latest 5
                .map((t) => renderTaskCard(t, false, !isSearchMatch(t)))}
            </div>
          </div>
          );
        })}
      </div>

      {/* Board total clicked → its cards gather to the front (ColumnGather). */}
      {gather && (
        <ColumnGather
          key={gather.column.id}
          column={gather.column}
          tasks={filtered.filter((t) => columnForTask(t.status) === gather.column.id)}
          renderCard={(t) => renderTaskCard(t, "gather", !isSearchMatch(t))}
          sourceEl={gather.sourceEl}
          cardWidth={gather.cardWidth}
          onClose={() => setGather(null)}
        />
      )}
    </div>
  );
}
