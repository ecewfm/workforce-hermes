import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { notifyNoteAdded, notifyMilestoneCompleted } from "../utils/notifications";
import { isAdminPlusOrAbove, isAdminLevel as isAdminLevelRole, canEditAnyCard } from "../utils/roles";
import { milestoneAnchor, DAY_MS } from "../utils/deadlines";
import FeatureModal from "./FeatureModal";

function deobfuscate(str) {
  if (!str || typeof str !== "string") return str;
  const s = str.trim();
  if (!s.startsWith("obf_")) return s;
  try {
    const reversed = s.substring(4);
    let encoded = reversed.split('').reverse().join('').trim();
    // Strip any potential whitespace or non-base64 characters that might have crept in
    encoded = encoded.replace(/[^A-Za-z0-9+/=]/g, "");
    
    // Use a more robust atob call and handle potential encoding issues
    return decodeURIComponent(escape(atob(encoded)));
  } catch (e) {
    try {
      const reversed = s.substring(4);
      let encoded = reversed.split('').reverse().join('').trim();
      encoded = encoded.replace(/[^A-Za-z0-9+/=]/g, "");
      return atob(encoded);
    } catch (err) {
      console.error("Deobfuscation failed:", err);
      return s;
    }
  }
}


export default function TaskModal({ taskId, isEditMode, initialNotesOpen, userRole, actualRole, userName, staff, onClose, showModal, showInputModal, onViewProfile }) {
  const task = useQuery(api.tasks.getTaskById, { taskId });
  const updateTaskMilestones = useMutation(api.tasks.updateTaskMilestones);
  const addNoteToTask = useMutation(api.tasks.addNoteToTask);
  const deleteTask = useMutation(api.tasks.deleteTask);
  const updateTaskDetails = useMutation(api.tasks.updateTaskDetails);
  const deleteTaskFeature = useMutation(api.tasks.deleteTaskFeature);
  const markTaskAsViewed = useMutation(api.tasks.markTaskAsViewed);
  const toggleNoteReaction = useMutation(api.tasks.toggleNoteReaction);
  const deleteNotesBulk = useMutation(api.tasks.deleteTaskNotesBulk);
  const deleteFeaturesBulk = useMutation(api.tasks.deleteTaskFeaturesBulk);
  const deleteMilestonesBulk = useMutation(api.tasks.deleteTaskMilestonesBulk);
  const addNoteReply = useMutation(api.tasks.addNoteReply);
  const toggleTaskPriority = useMutation(api.tasks.toggleTaskPriority);
  const currentUserEmail = (localStorage.getItem("wf_email") || "").toLowerCase();
  const taskViewHistoryTime = useQuery(api.tasks.getTaskViewHistory, { taskId, userEmail: localStorage.getItem("wf_email") || "" });

  const [selectedAssignees, setSelectedAssignees] = useState(new Set());
  const [showOptions, setShowOptions] = useState(false);
  const [editedTitle, setEditedTitle] = useState("");
  const [editedDesc, setEditedDesc] = useState("");
  const [editedAppscriptLink, setEditedAppscriptLink] = useState("");
  const [editedWebappLink, setEditedWebappLink] = useState("");
  const [featureModalConfig, setFeatureModalConfig] = useState(null);
  const [featureContextMenu, setFeatureContextMenu] = useState(null);
  const [editedMilestones, setEditedMilestones] = useState([]);
  const [featureView, setFeatureView] = useState("feature"); // 'feature' or 'bug'
  const [noteInputText, setNoteInputText] = useState("");
  const [notesFullscreen, setNotesFullscreen] = useState(!!initialNotesOpen);
  const [noteContextMenu, setNoteContextMenu] = useState(null); // { index, noteRect }
  const noteRefs = useRef({});
  const milestoneListRef = useRef(null);
  const dragFromRef = useRef(null);
  const dragOverRef = useRef(null);
  const [threadModal, setThreadModal] = useState(null); // { index, note }
  const [replyInputText, setReplyInputText] = useState("");

  const [selectedNotes, setSelectedNotes] = useState(new Set());
  const [selectedFeatures, setSelectedFeatures] = useState(new Set());
  const [selectedBugs, setSelectedBugs] = useState(new Set());
  const [selectedMilestones, setSelectedMilestones] = useState(new Set());
  const [passwordRevealed, setPasswordRevealed] = useState(false);
  const [apiCopied, setApiCopied] = useState(false);
  const [descExpanded, setDescExpanded] = useState(false);

  // Mentions logic
  const [mentionConfig, setMentionConfig] = useState(null); // { query: string, index: number, target: 'note' | 'reply' }
  const [mentionIndex, setMentionIndex] = useState(0);
  const noteTextareaRef = useRef(null);
  const replyTextareaRef = useRef(null);

  const filteredStaff = mentionConfig 
    ? (staff || []).filter(s => s.name.toLowerCase().includes(mentionConfig.query.toLowerCase()))
    : [];

  const handleMentionSelect = (staffMember) => {
    if (!mentionConfig) return;
    const isNote = mentionConfig.target === 'note';
    const text = isNote ? noteInputText : replyInputText;
    const ref = isNote ? noteTextareaRef : replyTextareaRef;
    const setFn = isNote ? setNoteInputText : setReplyInputText;

    const before = text.substring(0, mentionConfig.index);
    const after = text.substring(ref.current.selectionStart);
    const newText = before + "@" + staffMember.name + " " + after;
    
    setFn(newText);
    setMentionConfig(null);

    setTimeout(() => {
      if (ref.current) {
        ref.current.focus();
        const newPos = before.length + staffMember.name.length + 2;
        ref.current.setSelectionRange(newPos, newPos);
      }
    }, 0);
  };

  const handleTextareaChange = (e, target) => {
    const val = e.target.value;
    const setFn = target === 'note' ? setNoteInputText : setReplyInputText;
    setFn(val);

    const cursor = e.target.selectionStart;
    const textBefore = val.substring(0, cursor);
    const lastAt = textBefore.lastIndexOf("@");

    if (lastAt !== -1) {
      const query = textBefore.substring(lastAt + 1);
      if (!query.includes(" ") && !query.includes("\n")) {
        setMentionConfig({ query, index: lastAt, target });
        setMentionIndex(0);
        return;
      }
    }
    setMentionConfig(null);
  };

  const handleTextareaKeyDown = (e, target) => {
    if (mentionConfig && mentionConfig.target === target) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMentionIndex(prev => (prev + 1) % filteredStaff.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setMentionIndex(prev => (prev - 1 + filteredStaff.length) % filteredStaff.length);
      } else if (e.key === "Enter" || e.key === "Tab") {
        if (filteredStaff.length > 0) {
          e.preventDefault();
          handleMentionSelect(filteredStaff[mentionIndex]);
        }
      } else if (e.key === "Escape") {
        setMentionConfig(null);
      }
    } else if (e.key === "Enter" && target === 'note' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleAddNote();
    } else if (e.key === "Enter" && target === 'reply' && !e.shiftKey) {
      e.preventDefault();
      handleAddReply();
    }
  };

  const handleRevealPassword = () => {
    if (passwordRevealed) {
      setPasswordRevealed(false);
      return;
    }
    showInputModal({
      title: "Security Check",
      message: "Please enter the master password to reveal these credentials.",
      fields: [{ name: "pass", label: "Master Password", type: "password", placeholder: "••••" }],
      onConfirm: (data) => {
        if (data.pass === "wfm1234") {
          setPasswordRevealed(true);
        } else {
          showModal({ title: "Access Denied", message: "Incorrect master password.", type: "alert" });
        }
      }
    });
  };

  const handleRowClickToggle = (e, setFn, id) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      e.stopPropagation();
      setFn(prev => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    }
  };

  const handleCheckboxToggle = (setFn, id) => {
    setFn(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const [refreshBadges, setRefreshBadges] = useState(0);

  // 1. Pure effects (no state dependencies other than taskId)
  useEffect(() => {
    const handleEsc = (e) => {
      if (e.key === "Escape") {
        setSelectedNotes(new Set());
        setSelectedFeatures(new Set());
        setSelectedBugs(new Set());
        setSelectedMilestones(new Set());
      }
    };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, []);

  useEffect(() => {
    const markViewed = () => {
      if (taskId) {
        const userEmail = localStorage.getItem("wf_email") || "";
        const nowStr = Date.now().toString();
        localStorage.setItem(`task_viewed_${taskId}`, nowStr);
        localStorage.setItem(`task_viewed_features_${taskId}`, nowStr);
        localStorage.setItem(`task_viewed_bugs_${taskId}`, nowStr);
        localStorage.setItem(`task_viewed_notes_${taskId}`, nowStr);
        localStorage.setItem(`task_viewed_milestones_${taskId}`, nowStr);
        window.dispatchEvent(new Event("task-viewed"));
        markTaskAsViewed({ taskId, userEmail });
      }
    };
    return () => markViewed();
  }, [taskId, markTaskAsViewed]);

  // 2. Effects depending on task data
  useEffect(() => {
    if (task) {
      setEditedTitle(task.title || "");
      setEditedDesc(task.description || "");
      setEditedAppscriptLink(task.appscriptLink || "");
      setEditedWebappLink(task.webappLink || "");
      const initialAssignees = (task.assignee || "")
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s);
      setSelectedAssignees(new Set(initialAssignees));
      if (isEditMode) {
        setEditedMilestones(task.milestones ? JSON.parse(JSON.stringify(task.milestones)) : []);
      }
    }
  }, [task?._id, isEditMode]);

  // Derived programmer status for badge logic
  const isProgrammer = actualRole === "Programmer" || userRole === "Programmer";
  const globalLS = parseInt(localStorage.getItem(`task_viewed_${taskId}`) || "0", 10);
  const globalDB = typeof taskViewHistoryTime === 'number' ? taskViewHistoryTime : 0;
  const globalTime = Math.max(globalLS, globalDB);

  const lastViewedFeatures = isProgrammer ? Math.max(parseInt(localStorage.getItem(`task_viewed_features_${taskId}`) || "0", 10), globalTime) : 0;
  const lastViewedBugs = isProgrammer ? Math.max(parseInt(localStorage.getItem(`task_viewed_bugs_${taskId}`) || "0", 10), globalTime) : 0;
  const lastViewedNotes = isProgrammer ? Math.max(parseInt(localStorage.getItem(`task_viewed_notes_${taskId}`) || "0", 10), globalTime) : 0;
  const lastViewedMilestones = isProgrammer ? Math.max(parseInt(localStorage.getItem(`task_viewed_milestones_${taskId}`) || "0", 10), globalTime) : 0;

  const newNotes = isProgrammer ? (task?.notes || []).filter((n) => {
    const noteTime = n.timestamp || 0;
    return noteTime > 0 && noteTime > lastViewedNotes;
  }).length : 0;

  const newFeatures = isProgrammer ? (task?.features || []).filter((f) => {
    if ((f.type || "feature") !== "feature") return false;
    const featureTime = f.createdAtTime || 0;
    return featureTime > 0 && featureTime > lastViewedFeatures;
  }).length : 0;

  const newBugs = isProgrammer ? (task?.features || []).filter((f) => {
    if ((f.type || "feature") !== "bug") return false;
    const featureTime = f.createdAtTime || 0;
    return featureTime > 0 && featureTime > lastViewedBugs;
  }).length : 0;

  const newMilestonesBadge = isProgrammer ? (task?.milestones || []).filter((m) => {
    const milestoneTime = m.createdAtTime || 0;
    return milestoneTime > 0 && milestoneTime > lastViewedMilestones;
  }).length : 0;

  useEffect(() => {
    if (isProgrammer && task) {
      console.log("📊 BADGE DEBUG:", { isProgrammer, globalTime, newNotes, newFeatures, newBugs, newMilestonesBadge });
    }
  }, [task?._id, isProgrammer, globalTime, newNotes, newFeatures, newBugs, newMilestonesBadge]);

  const clearBadge = (type) => {
    if (isProgrammer) {
      localStorage.setItem(`task_viewed_${type}_${taskId}`, Date.now().toString());
      setRefreshBadges(r => r + 1);
      window.dispatchEvent(new Event("task-viewed"));
    }
  };

  const milestones = task?.milestones || [];
  const doneM = task?.completedMilestones || 0;
  const progressPercent = milestones.length > 0 ? Math.round((doneM / milestones.length) * 100) : 0;

  const isAdminPlus = isAdminPlusOrAbove(actualRole);   // Admin+ or Manager
  const isAdminLevel = isAdminLevelRole(actualRole);    // Admin, Admin+, Manager

  let canEditMilestone = true;
  // Admin/Admin+ may only edit cards they're assigned to. Managers bypass this
  // entirely (they can edit ANY card); Programmers are unrestricted as before.
  if ((actualRole === "Admin" || actualRole === "Admin+") && !canEditAnyCard(actualRole)) {
    const assigneeVal = (task?.assignee || "").toLowerCase();
    const userNameVal = (userName || "").toLowerCase();
    if (!assigneeVal.includes(userNameVal)) canEditMilestone = false;
  }

  const canManageFeatures = isAdminLevel || canEditMilestone;

  function toggleAssignee(name) {
    setSelectedAssignees((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function handleToggleMilestone(idx) {
    const updated = JSON.parse(JSON.stringify(milestones));
    const isNowCompleted = !updated[idx].completed;
    updated[idx].completed = isNowCompleted;
    if (isNowCompleted) {
      updated[idx].completedAt = new Date().toLocaleString("en-US", {
        timeZone: "America/New_York",
        year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit",
      });
      notifyMilestoneCompleted(task.title, updated[idx].name);
    } else {
      delete updated[idx].completedAt;
    }
    const completedCount = updated.filter((m) => m.completed).length;
    updateTaskMilestones({ 
      taskId, 
      milestones: updated, 
      completedCount,
      actorEmail: currentUserEmail,
      actorName: userName
    });
  }

  function handleAddNote() {
    const text = noteInputText.trim();
    if (!text) return;
    const estDate = new Date().toLocaleString("en-US", {
      timeZone: "America/New_York",
      year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit",
    });
    console.log("📝 Adding note:", { taskId, text: text.substring(0, 30), writer: userName });
    addNoteToTask({ taskId, noteText: text, writer: userName, writerEmail: currentUserEmail, date: estDate });
    console.log("🔔 Calling notifyNoteAdded:", { taskTitle: task.title, notePreview: text.substring(0, 30) });
    notifyNoteAdded(task.title, text);
    setNoteInputText("");
    setNotesFullscreen(false);
  }

  function handleAddReply() {
    if (!threadModal) return;
    const text = replyInputText.trim();
    if (!text) return;
    const estDate = new Date().toLocaleString("en-US", {
      timeZone: "America/New_York",
      year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit",
    });
    addNoteReply({
      taskId,
      noteIndex: threadModal.index,
      replyText: text,
      writer: userName,
      writerEmail: currentUserEmail,
      date: estDate
    });
    setReplyInputText("");
  }

  function getStaffByName(writerName) {
    if (!staff || !writerName) return null;
    return staff.find(s => (s.name || "").toLowerCase() === writerName.toLowerCase());
  }

  function renderAvatar(writerName, size = 32) {
    const member = getStaffByName(writerName);
    if (member?.avatarUrl) {
      return (
        <img
          src={member.avatarUrl}
          alt={writerName}
          style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover", flexShrink: 0, cursor: "pointer" }}
          onClick={(e) => { e.stopPropagation(); if (member && onViewProfile) onViewProfile(member); }}
        />
      );
    }
    return (
      <div
        style={{ width: size, height: size, borderRadius: "50%", background: "var(--color-accent)", display: "flex", alignItems: "center", justifyContent: "center", color: "white", fontSize: `${size * 0.4}px`, fontWeight: 900, flexShrink: 0, cursor: "pointer" }}
        onClick={(e) => { e.stopPropagation(); if (member && onViewProfile) onViewProfile(member); }}
      >
        {writerName?.charAt(0).toUpperCase()}
      </div>
    );
  }

  function handleDelete() {
    showModal({
      title: "Delete Project",
      message: "Are you sure you want to permanently delete this project? This action cannot be undone.",
      type: "confirm",
      onConfirm: () => { deleteTask({ taskId, actorEmail: currentUserEmail, actorName: userName, source: "modal" }); onClose(); }
    });
  }

  function handleSaveEdits() {
    const newMilestones = editedMilestones.map((m) => ({
      name: (m.name || "").trim() || "Unnamed",
      days: parseInt(m.days) || 0,
      completed: m.completed || false,
      completedAt: m.completedAt,
    }));
    updateTaskDetails({
      taskId,
      newTitle: editedTitle,
      newDescription: editedDesc,
      newAssignee: Array.from(selectedAssignees).join(", "),
      newAppscriptLink: editedAppscriptLink,
      newWebappLink: editedWebappLink,
      newMilestones,
      actorEmail: currentUserEmail,
      actorName: userName
    });
    onClose();
  }

  function appendEditableMilestone() {
    setEditedMilestones(prev => [...prev, { name: "", days: 0 }]);
  }

  function handleFeatureContextMenu(e, f) {
    if (!canManageFeatures) return;
    e.preventDefault();
    e.stopPropagation();
    setFeatureContextMenu({ x: e.clientX, y: e.clientY, feature: f });
  }

  function handleFeatureEdit(f) {
    setFeatureModalConfig({ mode: "edit", feature: f });
    setFeatureContextMenu(null);
  }

  function handleFeatureDelete(f) {
    setFeatureContextMenu(null);
    showModal({
      title: `Delete ${f.type === "bug" ? "Bug" : "Feature"}`,
      message: `Are you sure you want to permanently delete the ${f.type === "bug" ? "bug" : "feature"} "${f.name}"?`,
      type: "confirm",
      onConfirm: () => { deleteTaskFeature({ taskId, featureId: f.id }); }
    });
  }

  function handleBulkDelete(type) {
    switch (type) {
      case 'features':
        if (selectedFeatures.size === 0) return;
        showModal({
          title: "Bulk Delete Features",
          message: `Are you sure you want to permanently delete ${selectedFeatures.size} feature${selectedFeatures.size > 1 ? 's' : ''}?`,
          type: "confirm",
          onConfirm: () => {
            deleteFeaturesBulk({ taskId, featureIds: Array.from(selectedFeatures) });
            setSelectedFeatures(new Set());
          }
        });
        break;
      case 'bugs':
        if (selectedBugs.size === 0) return;
        showModal({
          title: "Bulk Delete Bugs",
          message: `Are you sure you want to permanently delete ${selectedBugs.size} bug${selectedBugs.size > 1 ? 's' : ''}?`,
          type: "confirm",
          onConfirm: () => {
            deleteFeaturesBulk({ taskId, featureIds: Array.from(selectedBugs) });
            setSelectedBugs(new Set());
          }
        });
        break;
      case 'notes':
        if (selectedNotes.size === 0) return;
        showModal({
          title: "Bulk Delete Notes",
          message: `Are you sure you want to permanently delete ${selectedNotes.size} note${selectedNotes.size > 1 ? 's' : ''}?`,
          type: "confirm",
          onConfirm: () => {
            deleteNotesBulk({ taskId, indices: Array.from(selectedNotes) });
            setSelectedNotes(new Set());
          }
        });
        break;
      case 'milestones':
        if (selectedMilestones.size === 0) return;
        showModal({
          title: "Bulk Delete Milestones",
          message: `Are you sure you want to permanently delete ${selectedMilestones.size} milestone${selectedMilestones.size > 1 ? 's' : ''}?`,
          type: "confirm",
          onConfirm: () => {
            deleteMilestonesBulk({ taskId, indices: Array.from(selectedMilestones) });
            setSelectedMilestones(new Set());
          }
        });
        break;
    }
  }

  function handleSelectAll(type, items) {
    switch (type) {
      case 'features':
        if (selectedFeatures.size === items.length) setSelectedFeatures(new Set());
        else setSelectedFeatures(new Set(items.map(f => f.id)));
        break;
      case 'bugs':
        if (selectedBugs.size === items.length) setSelectedBugs(new Set());
        else setSelectedBugs(new Set(items.map(b => b.id)));
        break;
      case 'notes':
        if (selectedNotes.size === items.length) setSelectedNotes(new Set());
        else setSelectedNotes(new Set(items.map((_, i) => i)));
        break;
      case 'milestones':
        if (selectedMilestones.size === items.length) setSelectedMilestones(new Set());
        else setSelectedMilestones(new Set(items.map((_, i) => i)));
        break;
    }
  }

  // ── Pure DOM drag-and-drop (no React state during drag) ─────────────────────
  // We mutate DOM styles directly for visual feedback; only call setEditedMilestones
  // once on pointerup. This avoids all React re-render / listener teardown issues.
  function startMilestoneDrag(fromIdx) {
    dragFromRef.current = fromIdx;
    dragOverRef.current = fromIdx;

    function getRows() {
      return milestoneListRef.current
        ? [...milestoneListRef.current.querySelectorAll(".ms-drag-row")]
        : [];
    }

    function applyVisuals(overIdx) {
      getRows().forEach((r, i) => {
        r.style.opacity = i === fromIdx ? "0.35" : "1";
        r.style.borderTop = "";
        r.style.borderBottom = "";
      });
      const rows = getRows();
      if (overIdx !== fromIdx && rows[overIdx]) {
        if (overIdx < fromIdx) {
          rows[overIdx].style.borderTop = "3px solid #3b82f6";
        } else {
          rows[overIdx].style.borderBottom = "3px solid #3b82f6";
        }
      }
    }

    function clearVisuals() {
      getRows().forEach(r => {
        r.style.opacity = "";
        r.style.borderTop = "";
        r.style.borderBottom = "";
      });
    }

    applyVisuals(fromIdx);

    function onMove(e) {
      const rows = getRows();
      let found = dragOverRef.current;
      for (let i = 0; i < rows.length; i++) {
        const rect = rows[i].getBoundingClientRect();
        if (e.clientY >= rect.top && e.clientY <= rect.bottom) {
          found = i;
          break;
        }
      }
      if (found !== dragOverRef.current) {
        dragOverRef.current = found;
        applyVisuals(found);
      }
    }

    function onUp() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      clearVisuals();
      const from = dragFromRef.current;
      const to = dragOverRef.current;
      dragFromRef.current = null;
      dragOverRef.current = null;
      if (from !== null && to !== null && from !== to) {
        setEditedMilestones(prev => {
          const next = [...prev];
          const [moved] = next.splice(from, 1);
          next.splice(to, 0, moved);
          return next;
        });
      }
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  if (!task) return null;

  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-content task-modal-content" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>×</button>

        <div className="modal-grid-3">

          {/* ── Features & Bugs sidebar ── */}
          <div className="features-sidebar" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
            <div className="features-header" style={{ flexShrink: 0, paddingBottom: 12, borderBottom: "1px solid #f1f5f9", marginBottom: 14 }}>

              {/* ── View Tabs ── */}
              <div className="taskmodal-tabs" role="tablist" aria-label="Feature view tabs">
                <button
                  type="button"
                  role="tab"
                  aria-selected={featureView === "feature"}
                  className={`taskmodal-tab ${featureView === "feature" ? "active" : ""}`}
                  onClick={() => {
                    setFeatureView("feature");
                    clearBadge("features");
                  }}
                  style={{ position: "relative" }}
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ flexShrink: 0 }}>
                    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                  </svg>
                  Features
                  {isProgrammer && newFeatures > 0 && (
                    <span style={{
                      position: "absolute",
                      top: "-6px",
                      right: "-8px",
                      background: "radial-gradient(circle, #ef4444 0%, #dc2626 100%)",
                      color: "white",
                      fontSize: "0.55rem",
                      fontWeight: 900,
                      padding: "1px 5px",
                      borderRadius: "10px",
                      minWidth: "16px",
                      textAlign: "center",
                      boxShadow: "0 0 8px 2px rgba(239, 68, 68, 0.4)",
                      zIndex: 10,
                    }}>
                      {newFeatures}
                    </span>
                  )}
                </button>

                <button
                  type="button"
                  role="tab"
                  aria-selected={featureView === "bug"}
                  className={`taskmodal-tab ${featureView === "bug" ? "active" : ""}`}
                  onClick={() => {
                    setFeatureView("bug");
                    clearBadge("bugs");
                  }}
                  style={{ position: "relative" }}
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ flexShrink: 0 }}>
                    <circle cx="12" cy="12" r="4" />
                    <path d="M12 2v2m0 16v2m7-7h2M3 12h2M16.95 7.05l1.41-1.41M5.64 18.36l1.41-1.41M16.95 16.95l1.41 1.41M5.64 5.64l1.41 1.41" />
                  </svg>
                  Bugs
                  {isProgrammer && newBugs > 0 && (
                    <span style={{
                      position: "absolute",
                      top: "-6px",
                      right: "-8px",
                      background: "radial-gradient(circle, #ef4444 0%, #dc2626 100%)",
                      color: "white",
                      fontSize: "0.55rem",
                      fontWeight: 900,
                      padding: "1px 5px",
                      borderRadius: "10px",
                      minWidth: "16px",
                      textAlign: "center",
                      boxShadow: "0 0 8px 2px rgba(239, 68, 68, 0.4)",
                      zIndex: 10,
                    }}>
                      {newBugs}
                    </span>
                  )}
                </button>
              </div>

              {/* ── Row: title + pending badge + add button ── */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "7px" }}>
                  <h3 style={{ margin: 0, fontSize: "0.82rem", fontWeight: 800, color: "var(--color-text-primary)", letterSpacing: "-0.2px" }}>
                    {featureView === "feature" ? "Features" : "Bug Reports"}
                  </h3>
                  {(task.features || []).filter(f => (f.type || "feature") === featureView && f.status === "pending").length > 0 && (
                    <span style={{
                      background: featureView === "bug" ? "rgba(239, 68, 68, 0.15)" : "var(--color-bg-subtle)",
                      color: featureView === "bug" ? "#ef4444" : "var(--color-text-secondary)",
                      fontSize: "0.58rem", padding: "2px 7px", borderRadius: "20px", fontWeight: 800, letterSpacing: "0.4px",
                    }}>
                      {(task.features || []).filter(f => (f.type || "feature") === featureView && f.status === "pending").length} OPEN
                    </span>
                  )}
                </div>
                {canManageFeatures && (
                  <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                    {(featureView === "feature" ? selectedFeatures.size : selectedBugs.size) > 0 && (
                      <button
                        className="select-all-btn"
                        onClick={() => handleSelectAll(featureView === "feature" ? "features" : "bugs", (task.features || []).filter(f => (f.type || "feature") === featureView))}
                      >
                        Select All
                      </button>
                    )}
                    <button
                      className="btn-add-feature"
                      style={{
                        background: featureView === "bug" ? "#fef2f2" : "#f8fafc",
                        color: featureView === "bug" ? "#dc2626" : "#475569",
                        border: `1.5px solid ${featureView === "bug" ? "#fca5a5" : "#e2e8f0"}`,
                        transition: "all 0.2s ease",
                      }}
                      onClick={() => setFeatureModalConfig({ mode: "add", type: featureView })}
                    >
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                        <path d="M12 5v14M5 12h14" />
                      </svg>
                      ADD
                    </button>
                  </div>
                )}
              </div>
            </div>
            <div className="features-list" style={{ flex: 1, overflowY: "auto", padding: "5px" }}>
              {featureView === "feature" && selectedFeatures.size > 0 && (
                <div className="bulk-action-bar">
                  <span>{selectedFeatures.size} selected</span>
                  <button className="btn-bulk-delete" onClick={() => handleBulkDelete('features')}>
                    Delete Selected
                  </button>
                </div>
              )}
              {featureView === "bug" && selectedBugs.size > 0 && (
                <div className="bulk-action-bar">
                  <span>{selectedBugs.size} selected</span>
                  <button className="btn-bulk-delete" onClick={() => handleBulkDelete('bugs')}>
                    Delete Selected
                  </button>
                </div>
              )}
              {(task.features || []).filter(f => (f.type || "feature") === featureView).map((f) => {
                const isSelected = featureView === "feature" ? selectedFeatures.has(f.id) : selectedBugs.has(f.id);
                const setFn = featureView === "feature" ? setSelectedFeatures : setSelectedBugs;
                return (
                  <div
                    key={f.id}
                    className={`feature-card ${f.status === "completed" ? "completed" : ""} ${isSelected ? "bulk-selected-item" : ""}`}
                    onClick={(e) => handleRowClickToggle(e, setFn, f.id)}
                    onContextMenu={(e) => handleFeatureContextMenu(e, f)}
                    style={{ cursor: "pointer", userSelect: "none", borderLeft: featureView === "bug" && f.status !== "completed" ? "3px solid #ef4444" : undefined, display: "flex", alignItems: "center" }}
                  >
                    <div style={{ flex: 1, display: "flex", gap: "12px", alignItems: "flex-start" }} onClick={(e) => {
                      if (e.ctrlKey || e.metaKey) return;
                      setFeatureModalConfig({ mode: "view", feature: f, type: featureView });
                    }}>
                      <div className="feature-icon-box" style={{ background: featureView === "bug" ? "#fef2f2" : undefined, color: featureView === "bug" ? "#ef4444" : undefined }}>
                        {featureView === "bug" ? (
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <path d="M20.9 9.1C21.7 8.3 21.7 7 20.9 6.2c-.8-.8-2.1-.8-2.9 0L17.5 6.7m-11 0L6 6.2C5.2 5.4 3.9 5.4 3.1 6.2c-.8.8-.8 2.1 0 2.9l.5.5m0 6L3.1 16.1C2.3 16.9 2.3 18.2 3.1 19c.8.8 2.1.8 2.9 0l.5-.5m11 0l.5.5c.8.8 2.1.8 2.9 0 .8-.8.8-2.1 0-2.9l-.5-.5" />
                            <path d="M12 2v2m0 16v2m7-9h2M3 12h2M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" />
                          </svg>
                        ) : (
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                          </svg>
                        )}
                      </div>
                      <div className="feature-info" style={{ flex: 1 }}>
                        <h4>{f.name}</h4>
                        <p>{f.description}</p>
                        <div style={{ display: "flex", gap: "8px", fontSize: "0.65rem", color: "#64748b", marginBottom: "4px" }}>
                          <span>Created: {f.createdAt || "N/A"}</span>
                          {f.completedAt && <span>Completed: {f.completedAt}</span>}
                        </div>
                        <span className={`feature-badge ${f.status}`} style={{ background: featureView === "bug" && f.status === "pending" ? "#fee2e2" : undefined, color: featureView === "bug" && f.status === "pending" ? "#ef4444" : undefined }}>
                          {f.status === "completed" ? "COMPLETED" : "PENDING"}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
              {(task.features || []).filter(f => (f.type || "feature") === featureView).length === 0 && (
                <div style={{ textAlign: "center", color: "#94a3b8", fontStyle: "italic", fontSize: "0.8rem", marginTop: 20 }}>
                  No {featureView === "bug" ? "bugs" : "features"} added yet.
                </div>
              )}
            </div>
          </div>

          {/* ── Main column ── */}
          <div className="modal-main-column" style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
            <div className="modal-fixed-top" style={{ paddingBottom: 15, borderBottom: "1px solid #f1f5f9" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 15 }}>
                {isEditMode ? (
                  <input
                    type="text"
                    className="form-input"
                    value={editedTitle}
                    onChange={(e) => setEditedTitle(e.target.value)}
                    style={{ fontSize: "1.2rem", fontWeight: 900, padding: "6px 10px", width: "100%", marginRight: 15, borderRadius: "var(--radius-md)" }}
                  />
                ) : (
                  <h1 className="modal-title" style={{ marginBottom: 0, fontSize: "1.3rem", letterSpacing: "-0.5px" }}>{task.title}</h1>
                )}
                {isEditMode ? (
                  <button className="btn-modern btn-modern-save" onClick={handleSaveEdits}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                      <polyline points="17 21 17 13 7 13 7 21" />
                      <polyline points="7 3 7 8 15 8" />
                    </svg>
                    Save Changes
                  </button>
                ) : (
                  <div style={{ display: "flex", gap: 10 }}>
                    {(task.webappLink || task.projectLink) && (
                      <a
                        href={(task.webappLink || task.projectLink).startsWith("http") ? (task.webappLink || task.projectLink) : `https://${(task.webappLink || task.projectLink)}`}
                        target="_blank" rel="noopener noreferrer"
                        className="btn-modern btn-modern-project"
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                          <polyline points="15 3 21 3 21 9" />
                          <line x1="10" y1="14" x2="21" y2="3" />
                        </svg>
                        View Project
                      </a>
                    )}
                    {task.appscriptLink && (
                      <a
                        href={task.appscriptLink.startsWith("http") ? task.appscriptLink : `https://${task.appscriptLink}`}
                        target="_blank" rel="noopener noreferrer"
                        className="btn-modern btn-modern-appscript"
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                          <polyline points="16 18 22 12 16 6" />
                          <polyline points="8 6 2 12 8 18" />
                        </svg>
                        View Appscript
                      </a>
                    )}
                    {userRole === "Admin" && (
                      <button className="btn-modern btn-modern-delete" onClick={handleDelete}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                          <polyline points="3 6 5 6 21 6" />
                          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                          <line x1="10" y1="11" x2="10" y2="17" />
                          <line x1="14" y1="11" x2="14" y2="17" />
                        </svg>
                        Delete Task
                      </button>
                    )}
                  </div>
                )}
              </div>

              <div 
                className="modal-assignee" 
                style={{ 
                  marginBottom: 15, 
                  display: "flex", 
                  alignItems: "center", 
                  gap: 8,
                  cursor: "pointer",
                  transition: "opacity 0.2s"
                }}
                onClick={() => {
                  if (isEditMode) return;
                  const found = (staff || []).find(s => s.name === task.assignee);
                  if (found) onViewProfile(found);
                }}
                onMouseEnter={(e) => { if (!isEditMode) e.currentTarget.style.opacity = 0.7; }}
                onMouseLeave={(e) => { e.currentTarget.style.opacity = 1; }}
              >
                {(() => {
                  const assigneeName = task.assignee || "";
                  const found = (staff || []).find(s => s.name === assigneeName);
                  const avatarUrl = found?.avatarUrl;
                  if (avatarUrl) {
                    return <img src={avatarUrl} alt={assigneeName} style={{ width: 22, height: 22, borderRadius: "50%", objectFit: "cover", border: "1px solid var(--color-accent)" }} />;
                  }
                  return (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                      <circle cx="12" cy="7" r="4" />
                    </svg>
                  );
                })()}
                {isEditMode ? (
                  <div style={{ flex: 1, marginLeft: 8 }}>
                    <div className="custom-multiselect">
                      <div className="multiselect-trigger" onClick={() => setShowOptions(!showOptions)} style={{ color: selectedAssignees.size > 0 ? "#1e293b" : "#64748b", padding: "4px 8px", fontSize: "0.8rem" }}>
                        {selectedAssignees.size > 0 ? Array.from(selectedAssignees).join(", ") : "Select Assignees..."}
                      </div>
                      <div className={`multiselect-options ${showOptions ? "show" : ""}`} style={{ fontSize: "0.8rem" }}>
                        {(staff || []).map((s) => (
                          <div key={s.email} className="multiselect-option" onClick={(e) => e.stopPropagation()}>
                            <input type="checkbox" id={`modal-staff-${s.email}`} checked={selectedAssignees.has(s.name)} onChange={() => toggleAssignee(s.name)} />
                            <label htmlFor={`modal-staff-${s.email}`}>{s.name}</label>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : (
                  <span style={{ fontSize: "0.8rem", fontWeight: 700 }}>Assigned to: {task.assignee || "Unassigned"}</span>
                )}
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input
                    type="checkbox"
                    id="priority-checkbox"
                    checked={task?.isPrioritized || false}
                    onChange={() => {
                      toggleTaskPriority({ taskId, isPrioritized: !task?.isPrioritized })
                        .catch(err => {
                          showModal({ title: "Priority Error", message: err.message || "Failed to update priority.", type: "alert" });
                        });
                    }}
                    style={{ cursor: "pointer", width: 16, height: 16 }}
                  />
                  <label htmlFor="priority-checkbox" style={{ fontSize: "0.75rem", fontWeight: 700, cursor: "pointer", userSelect: "none" }}>
                    Mark as Priority
                  </label>
                </div>
              </div>

              <div className="modal-desc" style={{ marginTop: 20 }}>
                <h3 style={{ fontWeight: 900, textTransform: "uppercase", fontSize: "0.65rem", color: "var(--color-text-secondary)", marginBottom: 8, letterSpacing: "1px" }}>Project Description</h3>
                {isEditMode ? (
                  <>
                    <textarea
                      className="form-input"
                      value={editedDesc}
                      onChange={(e) => setEditedDesc(e.target.value)}
                      style={{ width: "100%", height: 80, fontSize: "0.85rem", padding: 12, borderRadius: "var(--radius-md)", marginBottom: 15 }}
                      placeholder="Enter project description..."
                    />
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 15, marginBottom: 15 }}>
                      <div>
                        <label style={{ fontSize: "0.6rem", fontWeight: 900, color: "var(--color-text-secondary)", textTransform: "uppercase", display: "block", marginBottom: 4 }}>Appscript Link</label>
                        <input
                          type="text"
                          className="form-input"
                          value={editedAppscriptLink}
                          onChange={(e) => setEditedAppscriptLink(e.target.value)}
                          style={{ width: "100%", padding: "6px 10px", borderRadius: "var(--radius-md)", fontSize: "0.8rem" }}
                          placeholder="Google Appscript URL"
                        />
                      </div>
                      <div>
                        <label style={{ fontSize: "0.6rem", fontWeight: 900, color: "var(--color-text-secondary)", textTransform: "uppercase", display: "block", marginBottom: 4 }}>Webapp (Exec) Link</label>
                        <input
                          type="text"
                          className="form-input"
                          value={editedWebappLink}
                          onChange={(e) => setEditedWebappLink(e.target.value)}
                          style={{ width: "100%", padding: "6px 10px", borderRadius: "var(--radius-md)", fontSize: "0.8rem" }}
                          placeholder="Deployed Webapp URL"
                        />
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <div style={{
                      fontSize: "0.85rem",
                      color: "var(--color-text-primary)",
                      lineHeight: 1.5,
                      ...((task.description || "").length > 280 && !descExpanded ? {
                        display: "-webkit-box",
                        WebkitLineClamp: 3,
                        WebkitBoxOrient: "vertical",
                        overflow: "hidden",
                      } : {}),
                    }}>
                      {task.description || "No description provided."}
                    </div>
                    {(task.description || "").length > 280 && (
                      <button
                        onClick={() => setDescExpanded(!descExpanded)}
                        style={{ marginTop: 4, padding: 0, background: "none", border: "none", cursor: "pointer", fontSize: "0.7rem", fontWeight: 800, color: "var(--color-accent)", letterSpacing: "0.5px" }}
                      >
                        {descExpanded ? "▲ See less" : "▼ See more"}
                      </button>
                    )}
                  </>
                )}
              </div>

              <div style={{ background: "var(--color-bg-subtle)", border: "1px solid var(--glass-border)", borderRadius: "10px", padding: "15px 20px", boxShadow: "var(--shadow-sm)", marginTop: 15 }}>
                <div style={{ marginBottom: 12 }}>
                  <span style={{ fontSize: "0.8rem", color: "var(--color-text-secondary)", letterSpacing: "0.5px", fontWeight: 800 }}>
                    Milestones: {doneM} / {milestones.length} ({progressPercent}%)
                  </span>
                </div>
                <div className="progress-container" style={{ height: 10, marginBottom: 0, borderRadius: 10 }}>
                  <div className="progress-fill" style={{ width: `${progressPercent}%`, borderRadius: 10 }}></div>
                </div>
              </div>
            </div>

            {/* ── Milestone list ── */}
            <div className="milestone-scroll-area" style={{ flex: 1, minHeight: 0, overflowY: "auto", paddingRight: "5px", marginTop: "10px" }}>
              {!isEditMode && canEditMilestone && (
                <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "8px" }}>
                  {selectedMilestones.size > 0 && (
                    <button
                      className="select-all-btn"
                      onClick={() => handleSelectAll("milestones", task.milestones || [])}
                    >
                      Select All
                    </button>
                  )}
                </div>
              )}
              {!isEditMode && selectedMilestones.size > 0 && (
                <div className="bulk-action-bar">
                  <span>{selectedMilestones.size} selected</span>
                  <button className="btn-bulk-delete" onClick={() => handleBulkDelete('milestones')}>
                    Delete Selected
                  </button>
                </div>
              )}
              <div className="milestone-vertical-list" style={{ marginTop: 10, padding: "5px" }} ref={milestoneListRef}>
                {isEditMode ? (
                  <>
                    {editedMilestones.map((m, idx) => (
                      <div
                        key={idx}
                        className="milestone-list-item edit-mode-item ms-drag-row"
                        style={{ padding: 10, gap: 10, userSelect: "none" }}
                      >
                        {/* ⋮⋮ handle: pointerdown triggers pure-DOM drag */}
                        <div
                          className="drag-handle"
                          style={{ fontSize: "1.1rem", color: "#94a3b8", cursor: "grab", padding: "0 6px", flexShrink: 0, userSelect: "none", touchAction: "none" }}
                          onPointerDown={(e) => {
                            e.preventDefault();
                            // Release implicit pointer capture so pointermove fires
                            // on whatever element the cursor is over (and bubbles to window)
                            e.currentTarget.releasePointerCapture(e.pointerId);
                            startMilestoneDrag(idx);
                          }}
                        >⋮⋮</div>
                        <div className="milestone-list-content">
                          <div className="milestone-name-row" style={{ gap: 10 }}>
                            <input
                              type="text"
                              className="form-input edit-m-name"
                              value={m.name}
                              onChange={(e) => {
                                const next = [...editedMilestones];
                                next[idx] = { ...next[idx], name: e.target.value };
                                setEditedMilestones(next);
                              }}
                              placeholder="Milestone Name"
                              style={{ flex: 2, padding: "4px 8px", fontSize: "0.8rem" }}
                            />
                            <input
                              type="number"
                              className="form-input edit-m-days"
                              value={m.days}
                              onChange={(e) => {
                                const next = [...editedMilestones];
                                next[idx] = { ...next[idx], days: e.target.value };
                                setEditedMilestones(next);
                              }}
                              placeholder="Days"
                              style={{ flex: 1, padding: "4px 8px", fontSize: "0.8rem" }}
                            />
                            <button
                              type="button"
                              className="btn-remove-milestone"
                              style={{ padding: "4px 8px", fontSize: "0.8rem" }}
                              onClick={() => setEditedMilestones(prev => prev.filter((_, i) => i !== idx))}
                            >×</button>
                          </div>
                        </div>
                      </div>
                    ))}
                    <button
                      type="button"
                      className="btn-primary"
                      style={{ marginTop: 10, alignSelf: "flex-start", width: "auto", padding: "6px 12px", fontSize: "0.75rem", background: "var(--color-bg-subtle)", color: "var(--color-brand-text)", border: "2px dashed var(--color-accent-lighter)" }}
                      onClick={appendEditableMilestone}
                    >
                      + ADD MILESTONE
                    </button>
                  </>
                ) : (
                  milestones.map((m, idx) => {
                    let status = "waiting";
                    const firstIncompleteIdx = milestones.findIndex((ms) => !ms.completed);
                    if (m.completed) status = "completed";
                    else if (idx === firstIncompleteIdx) status = "active";

                    // Check if overdue (no countdown until the project leaves To Do)
                    let isOverdue = false;
                    let deadlineTime = null;
                    if (task.status !== "scrapped" && status === "active" && m.days > 0) {
                      const anchor = milestoneAnchor(task, idx);
                      if (anchor) {
                        deadlineTime = anchor + m.days * DAY_MS;
                        if ((Date.now() - anchor) / DAY_MS > m.days) isOverdue = true;
                      }
                    }

                    let actionBtn;
                    if (canEditMilestone) {
                      if (status === "completed") actionBtn = <button className="btn-milestone-undo" onClick={() => handleToggleMilestone(idx)}>Undo</button>;
                      else if (status === "active") actionBtn = <button className="btn-milestone-complete" onClick={() => handleToggleMilestone(idx)}>Complete</button>;
                      else actionBtn = <span className="badge-waiting">Waiting</span>;
                    } else {
                      if (status === "completed") actionBtn = <span className="badge-completed">Completed</span>;
                      else if (status === "active") actionBtn = <span className="badge-active">Active</span>;
                      else actionBtn = <span className="badge-waiting">Waiting</span>;
                    }

                    return (
                      <div
                        key={idx}
                        className={`milestone-list-item ${status} ${selectedMilestones.has(idx) ? "bulk-selected-item" : ""} ${isOverdue ? "overdue" : ""}`}
                        onClick={(e) => {
                          if (userRole === "Admin" || userRole === "Admin+") {
                            handleRowClickToggle(e, setSelectedMilestones, idx);
                          }
                        }}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          cursor: (userRole === "Admin" || userRole === "Admin+") ? "pointer" : "default",
                          border: isOverdue ? "1px solid #ef4444" : undefined,
                          boxShadow: isOverdue ? "0 0 10px rgba(239, 68, 68, 0.45)" : undefined,
                          background: isOverdue ? "rgba(239, 68, 68, 0.05)" : undefined
                        }}
                      >
                        <div className="drag-handle">⋮⋮</div>
                        <div className="milestone-list-content">
                          <div className="milestone-name-row">
                            <span className={`m-name ${m.completed ? "strike" : ""}`} style={{ color: isOverdue ? "#ef4444" : undefined }}>
                              {m.name} <span style={{ fontWeight: "normal", color: isOverdue ? "#ef4444" : "#94a3b8" }}>({m.days} days)</span>
                              {isOverdue && <span style={{ marginLeft: 6, fontSize: "0.6rem", fontWeight: "bold", color: "white", background: "#ef4444", padding: "2px 6px", borderRadius: "8px", textDecoration: "none", display: "inline-block" }}>OVERDUE</span>}
                            </span>
                            {actionBtn}
                          </div>
                          {status === "active" && deadlineTime && (
                            <div className="milestone-date" style={{ color: isOverdue ? "#ef4444" : "#10b981", display: "flex", alignItems: "center", gap: 4, marginTop: 4 }}>
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                                <line x1="16" y1="2" x2="16" y2="6" />
                                <line x1="8" y1="2" x2="8" y2="6" />
                                <line x1="3" y1="10" x2="21" y2="10" />
                              </svg>
                              Due: {new Date(deadlineTime).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                            </div>
                          )}
                          {m.completed && m.completedAt && (
                            <div className="milestone-date">
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                                <path d="M20 6L9 17l-5-5" />
                              </svg>
                              Completed {m.completedAt}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {(userRole === "Admin" || userRole === "Admin+") && (
              <>
                <div className="system-links-box" style={{ flexShrink: 0, marginTop: 10, background: "var(--color-bg-subtle)", border: "2px solid #3b82f6", borderRadius: "8px", overflow: "hidden", boxShadow: "var(--shadow-sm)" }}>
                  <div className="creds-header" style={{ background: "#3b82f6", padding: "6px 12px", color: "white", fontSize: "0.6rem", fontWeight: 900, display: "flex", alignItems: "center", gap: "8px", letterSpacing: "1px" }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                    </svg>
                    SYSTEM LINKS
                  </div>
                  <div className="creds-content" style={{ padding: "8px 12px", color: "var(--color-brand-text)" }}>
                    <div style={{ display: "grid", gridTemplateColumns: "100px 1fr", gap: "4px 10px", alignItems: "center" }}>
                      <span style={{ fontSize: "0.6rem", fontWeight: 900, textTransform: "uppercase", color: "#3b82f6" }}>Appscript:</span>
                      {task.appscriptLink ? (
                        <a href={task.appscriptLink.startsWith("http") ? task.appscriptLink : `https://${task.appscriptLink}`} target="_blank" rel="noopener noreferrer" style={{ fontWeight: 700, fontSize: "0.75rem", color: "var(--color-accent)", textDecoration: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{task.appscriptLink}</a>
                      ) : <span style={{ color: "#94a3b8", fontSize: "0.75rem" }}>—</span>}
                      
                      <span style={{ fontSize: "0.6rem", fontWeight: 900, textTransform: "uppercase", color: "#3b82f6" }}>Webapp:</span>
                      {(task.webappLink || task.projectLink) ? (
                        <a href={(task.webappLink || task.projectLink).startsWith("http") ? (task.webappLink || task.projectLink) : `https://${(task.webappLink || task.projectLink)}`} target="_blank" rel="noopener noreferrer" style={{ fontWeight: 700, fontSize: "0.75rem", color: "var(--color-accent)", textDecoration: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{task.webappLink || task.projectLink}</a>
                      ) : <span style={{ color: "#94a3b8", fontSize: "0.75rem" }}>—</span>}
                    </div>
                  </div>
                </div>

                <div className="api-access-box" style={{ flexShrink: 0, marginTop: 10, background: "var(--color-bg-subtle)", border: "2px solid #8b5cf6", borderRadius: "8px", overflow: "hidden", boxShadow: "var(--shadow-sm)" }}>
                  <div className="creds-header" style={{ background: "#8b5cf6", padding: "6px 12px", color: "white", fontSize: "0.6rem", fontWeight: 900, display: "flex", alignItems: "center", gap: "8px", letterSpacing: "1px" }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                      <polyline points="16 18 22 12 16 6" />
                      <polyline points="8 6 2 12 8 18" />
                    </svg>
                    API ACCESS
                  </div>
                  <div className="creds-content" style={{ padding: "8px 12px", color: "var(--color-brand-text)" }}>
                    <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                      <input
                        readOnly
                        value={`${window.location.origin}/api/task?taskId=${taskId}`}
                        onFocus={(e) => e.target.select()}
                        style={{ flex: 1, minWidth: 0, padding: "5px 8px", fontSize: "0.68rem", fontFamily: "monospace", background: "var(--color-bg-primary)", border: "1px solid var(--glass-border)", borderRadius: "4px", color: "var(--color-brand-text)" }}
                      />
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(`${window.location.origin}/api/task?taskId=${taskId}`);
                          setApiCopied(true);
                          setTimeout(() => setApiCopied(false), 1500);
                        }}
                        style={{ flexShrink: 0, padding: "5px 10px", fontSize: "0.55rem", fontWeight: 900, background: apiCopied ? "#22c55e" : "#8b5cf6", border: "none", color: "white", borderRadius: "4px", cursor: "pointer", letterSpacing: "0.5px" }}
                      >
                        {apiCopied ? "COPIED!" : "COPY"}
                      </button>
                    </div>
                    <div style={{ marginTop: 6, fontSize: "0.58rem", color: "#94a3b8", lineHeight: 1.5 }}>
                      GET reads this project · POST <code>resource=bug|feature|note</code> · PATCH <code>resource=links</code> to set system links. Auth: <code>x-api-key</code> header. See <b>TASK-API.md</b>.
                    </div>
                  </div>
                </div>

                <div className="admin-creds-box" style={{ flexShrink: 0, marginTop: 10, background: "var(--color-bg-subtle)", border: "2px solid var(--color-accent)", borderRadius: "8px", overflow: "hidden", boxShadow: "var(--shadow-sm)" }}>
                  <div className="creds-header" style={{ background: "var(--color-accent)", padding: "6px 12px", color: "white", fontSize: "0.6rem", fontWeight: 900, display: "flex", alignItems: "center", gap: "8px", letterSpacing: "1px" }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                    </svg>
                    ADMIN CREDENTIALS (SENSITIVE)
                  </div>
                  <div className="creds-content" style={{ padding: "8px 12px", color: "var(--color-brand-text)" }}>
                    <div style={{ display: "grid", gridTemplateColumns: "80px 1fr", gap: "2px 10px", alignItems: "center" }}>
                      <span style={{ fontSize: "0.6rem", fontWeight: 900, textTransform: "uppercase", color: "var(--color-accent)" }}>Email:</span>
                      <span style={{ fontWeight: 700, fontSize: "0.8rem", fontFamily: "monospace" }}>
                        {passwordRevealed ? (deobfuscate(task.adminCredentials?.email) || "—") : "••••••••••••"}
                      </span>
                      <span style={{ fontSize: "0.6rem", fontWeight: 900, textTransform: "uppercase", color: "var(--color-accent)" }}>Pass:</span>
                      <span style={{ fontWeight: 700, fontSize: "0.8rem", fontFamily: "monospace" }}>
                        {passwordRevealed ? (deobfuscate(task.adminCredentials?.password) || "—") : "••••••••"}
                      </span>
                    </div>
                    {!passwordRevealed && (
                      <button 
                        onClick={handleRevealPassword}
                        style={{ marginTop: 8, width: "100%", padding: "4px", fontSize: "0.55rem", fontWeight: 900, background: "var(--color-bg-primary)", border: "1px dashed var(--color-accent)", color: "var(--color-accent)", borderRadius: "4px", cursor: "pointer" }}
                      >
                        CLICK TO REVEAL
                      </button>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>

          {/* ── Notes column ── */}
          <div 
            onClick={() => clearBadge("notes")}
            style={{ background: "var(--color-bg-subtle)", border: "1px solid var(--glass-border)", padding: "15px 20px", borderRadius: "var(--radius-lg)", alignSelf: "stretch", display: "flex", flexDirection: "column", height: "100%", minHeight: 0, overflow: "hidden" }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: 10, position: "relative", flexShrink: 0 }}>
              <h3 style={{ fontWeight: 900, textTransform: "uppercase", fontSize: "0.7rem", color: "var(--color-text-secondary)", letterSpacing: "1px", margin: 0 }}>Notes & Updates</h3>
              {isProgrammer && newNotes > 0 && (
                <span style={{
                  position: "absolute",
                  left: "135px",
                  top: "-5px",
                  background: "radial-gradient(circle, #ef4444 0%, #dc2626 100%)",
                  color: "white",
                  fontSize: "0.55rem",
                  fontWeight: 900,
                  padding: "1px 5px",
                  borderRadius: "10px",
                  minWidth: "16px",
                  textAlign: "center",
                  boxShadow: "0 0 8px 2px rgba(239, 68, 68, 0.4)",
                  zIndex: 10,
                }}>
                  {newNotes}
                </span>
              )}
              <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                {selectedNotes.size > 0 && (
                  <button
                    className="select-all-btn"
                    onClick={() => handleSelectAll("notes", task.notes || [])}
                  >
                    Select All
                  </button>
                )}
              </div>
            </div>
            <div className="notes-list" onClick={() => setNoteContextMenu(null)} style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "0 5px", marginBottom: 10 }}>
              {selectedNotes.size > 0 && (
                <div className="bulk-action-bar">
                  <span>{selectedNotes.size} selected</span>
                  <button className="btn-bulk-delete" onClick={() => handleBulkDelete('notes')}>
                    Delete Selected
                  </button>
                </div>
              )}
              {(task.notes || []).map((n, i) => {
                const reactions = n.reactions || {};
                const reactionTypes = [
                  { key: "heart", emoji: "❤️", label: "Heart" },
                  { key: "haha", emoji: "😆", label: "Haha" },
                  { key: "wow", emoji: "😮", label: "Wow" },
                  { key: "sad", emoji: "😢", label: "Sad" },
                  { key: "angry", emoji: "😡", label: "Angry" },
                  { key: "like", emoji: "👍", label: "Like" },
                ];
                
                const replyCount = (n.replies || []).length;

                return (
                  <div
                    key={i}
                    ref={(el) => { noteRefs.current[i] = el; }}
                    className={`note-item ${selectedNotes.has(i) ? "bulk-selected-item" : ""}`}
                    onClick={(e) => handleRowClickToggle(e, setSelectedNotes, i)}
                    style={{ 
                      background: "var(--color-card-bg)", 
                      padding: 12, 
                      borderRadius: "var(--radius-md)", 
                      border: "1px solid var(--glass-border)", 
                      marginBottom: 8, 
                      boxShadow: "var(--shadow-sm)", 
                      display: "flex", 
                      gap: "10px", 
                      alignItems: "flex-start", 
                      cursor: "pointer", 
                      position: "relative",
                      transition: "all 0.3s cubic-bezier(0.16, 1, 0.3, 1)"
                    }}
                  >
                    <div style={{ flex: 1 }}>
                      <div className="note-date" style={{ color: "var(--color-accent)", marginBottom: 4, fontSize: "0.65rem", fontWeight: 700 }}>
                        {n.date} {n.writer && <span style={{ color: "var(--color-brand-text)", fontWeight: 900 }}>- {n.writer}</span>}
                      </div>
                      <div className="note-text" style={{ fontSize: "0.8rem", lineHeight: 1.4, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{n.text}</div>
                      
                      {/* Active Reactions Only */}
                      <div className="note-reactions-display" style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginTop: "8px" }}>
                        {reactionTypes.map(({ key, emoji, label }) => {
                          const arr = reactions[key] || [];
                          if (arr.length === 0) return null;
                          const isActive = arr.includes(currentUserEmail);
                          return (
                            <div 
                              key={key} 
                              className={`reaction-pill-display ${isActive ? 'active' : ''}`}
                              title={`${label}: ${arr.join(', ')}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleNoteReaction({ taskId, noteIndex: i, reactionType: key, userEmail: currentUserEmail, userName });
                              }}
                              style={{ 
                                display: "flex", 
                                alignItems: "center", 
                                gap: "4px", 
                                background: isActive ? "var(--color-accent-lighter)" : "rgba(0,0,0,0.05)", 
                                padding: "2px 6px", 
                                borderRadius: "12px", 
                                fontSize: "0.65rem",
                                border: isActive ? "1px solid var(--color-accent)" : "1px solid transparent"
                              }}
                            >
                              <span>{emoji}</span>
                              <span style={{ fontWeight: 800 }}>{arr.length}</span>
                            </div>
                          );
                        })}
                      </div>

                      {/* Reply Button (Appears on Hover via CSS) */}
                      <div className="note-hover-actions">
                        <button 
                          className="btn-reply-hover"
                          onClick={(e) => {
                            e.stopPropagation();
                            setThreadModal({ index: i, note: n });
                          }}
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                          </svg>
                          <span>Reply</span>
                        </button>
                      </div>

                      {/* Thread Link (Always visible if replies exist) */}
                      { replyCount > 0 && (
                        <div style={{ marginTop: 8 }}>
                          <button 
                            className="btn-thread-link"
                            onClick={(e) => {
                              e.stopPropagation();
                              setThreadModal({ index: i, note: n });
                            }}
                            style={{ 
                              background: "none", 
                              border: "none", 
                              color: "var(--color-accent)", 
                              fontSize: "0.7rem", 
                              fontWeight: 800, 
                              cursor: "pointer", 
                              padding: 0,
                              display: "flex",
                              alignItems: "center",
                              gap: "4px"
                            }}
                          >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                            </svg>
                            {`${replyCount} ${replyCount === 1 ? 'reply' : 'replies'}`}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
              {(task.notes || []).length === 0 && (
                <div style={{ textAlign: "center", color: "var(--color-text-secondary)", fontStyle: "italic", marginTop: 40, fontSize: "0.8rem" }}>No updates yet.</div>
              )}
            </div>
            <div className="note-input-group" style={{ display: "flex", gap: 8, paddingTop: 10, borderTop: "1px solid var(--glass-border)", flexShrink: 0 }}>
              <input
                type="text"
                className="note-input"
                id="modal-note-input"
                placeholder="Share an update... (click to expand)"
                value={noteInputText}
                onChange={(e) => setNoteInputText(e.target.value)}
                style={{ flex: 1, padding: "10px 12px", borderRadius: "8px", border: "1px solid #cbd5e1", fontSize: "0.8rem", cursor: "pointer" }}
                onClick={() => setNotesFullscreen(true)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleAddNote(); } }}
                readOnly
              />
              <button className="btn-add-note" style={{ background: "var(--color-nav-bg)", color: "white", padding: "0 15px", borderRadius: "8px", fontWeight: 800, fontSize: "0.75rem" }} onClick={() => setNotesFullscreen(true)}>Add</button>
            </div>

            {/* Fullscreen Notes Editor Overlay */}
            {notesFullscreen && (
              <div className="notes-fullscreen-overlay" onClick={() => setNotesFullscreen(false)}>
                <div className="notes-fullscreen-card" onClick={(e) => e.stopPropagation()}>
                  <div className="notes-fullscreen-header">
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                      </svg>
                      <span>COMPOSE UPDATE</span>
                    </div>
                    <button className="announcement-close-btn" onClick={() => setNotesFullscreen(false)}>×</button>
                  </div>
                  <div style={{ padding: 20, flex: 1, display: "flex", flexDirection: "column", position: "relative" }}>
                    <textarea
                      ref={noteTextareaRef}
                      className="notes-fullscreen-textarea"
                      placeholder="Write your update here...\n\nSupports @mentions for team members."
                      value={noteInputText}
                      onChange={(e) => handleTextareaChange(e, 'note')}
                      autoFocus
                      onKeyDown={(e) => handleTextareaKeyDown(e, 'note')}
                    />
                    {mentionConfig && mentionConfig.target === 'note' && filteredStaff.length > 0 && (
                      <div className="mention-list" style={{ position: 'absolute', top: '10px', left: '20px', zIndex: 10002 }}>
                        {filteredStaff.map((s, i) => (
                          <div 
                            key={s.email} 
                            className={`mention-item ${i === mentionIndex ? 'selected' : ''}`}
                            onClick={() => handleMentionSelect(s)}
                          >
                            <div className="mention-avatar">
                              {s.name.charAt(0).toUpperCase()}
                            </div>
                            {s.name}
                          </div>
                        ))}
                      </div>
                    )}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12 }}>
                      <span style={{ fontSize: "0.65rem", color: "#94a3b8" }}>Ctrl+Enter to send</span>
                      <div style={{ display: "flex", gap: 8 }}>
                        <button
                          style={{ background: "#f1f5f9", color: "#475569", border: "none", padding: "10px 20px", borderRadius: 10, fontSize: "0.75rem", fontWeight: 800, cursor: "pointer" }}
                          onClick={() => setNotesFullscreen(false)}
                        >Cancel</button>
                        <button
                          style={{ background: "var(--color-nav-bg)", color: "white", border: "none", padding: "10px 24px", borderRadius: 10, fontSize: "0.75rem", fontWeight: 800, cursor: "pointer" }}
                          onClick={handleAddNote}
                        >Post Update</button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

        </div>
      </div>

      {/* Note Context Menu with Emoji Picker — fixed position anchored to note */}
      {noteContextMenu && (() => {
        const rect = noteContextMenu.noteRect;
        // Position: centered horizontally on the note, just above it
        const menuWidth = 280;
        const menuLeft = Math.max(8, Math.min(rect.left + (rect.width / 2) - (menuWidth / 2), window.innerWidth - menuWidth - 8));
        const menuTop = Math.max(8, rect.top - 8); // just above the note, with transform to shift up
        return (
          <>
            <div
              style={{ position: "fixed", inset: 0, zIndex: 9998 }}
              onClick={() => setNoteContextMenu(null)}
              onContextMenu={(e) => { e.preventDefault(); setNoteContextMenu(null); }}
            />
            <div
              className="note-context-menu"
              style={{
                position: "fixed",
                top: menuTop,
                left: menuLeft,
                transform: "translateY(-100%)",
                background: "#1a1a1a",
                padding: "8px",
                borderRadius: "16px",
                boxShadow: "0 10px 40px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.08)",
                zIndex: 9999,
                border: "1px solid rgba(255,255,255,0.1)",
                width: menuWidth,
                animation: "fadeInUp 0.15s ease-out",
              }}
            >
              {/* Emoji Row */}
              <div style={{ display: "flex", gap: "2px", marginBottom: "6px", background: "rgba(255,255,255,0.05)", padding: "6px 4px", borderRadius: "12px", justifyContent: "center" }}>
                {[
                  { key: "heart", emoji: "❤️" },
                  { key: "haha", emoji: "😆" },
                  { key: "wow", emoji: "😮" },
                  { key: "sad", emoji: "😢" },
                  { key: "angry", emoji: "😡" },
                  { key: "like", emoji: "👍" },
                ].map(({ key, emoji }) => (
                  <button
                    key={key}
                    onClick={() => {
                      toggleNoteReaction({ taskId, noteIndex: noteContextMenu.index, reactionType: key, userEmail: currentUserEmail, userName });
                      setNoteContextMenu(null);
                    }}
                    style={{
                      background: "none",
                      border: "none",
                      fontSize: "1.3rem",
                      padding: "6px 8px",
                      cursor: "pointer",
                      borderRadius: "8px",
                      transition: "all 0.15s",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center"
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.15)"; e.currentTarget.style.transform = "scale(1.25)"; }}
                    onMouseLeave={e => { e.currentTarget.style.background = "none"; e.currentTarget.style.transform = "scale(1)"; }}
                  >
                    {emoji}
                  </button>
                ))}
              </div>

              <div style={{ height: 1, background: "rgba(255,255,255,0.08)", margin: "4px 0" }} />
              
              <button
                style={{ width: "100%", padding: "10px 14px", textAlign: "left", background: "none", border: "none", fontSize: "0.82rem", cursor: "pointer", display: "flex", alignItems: "center", gap: 10, color: "white", fontWeight: 700, borderRadius: "10px" }}
                onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,0.1)"}
                onMouseLeave={e => e.currentTarget.style.background = "none"}
                onClick={() => {
                  setThreadModal({ index: noteContextMenu.index, note: task.notes[noteContextMenu.index] });
                  setNoteContextMenu(null);
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                </svg>
                Reply in Thread
              </button>
            </div>
          </>
        );
      })()}

      {/* Thread Modal */}
      {threadModal && (
        <div className="modal-overlay" style={{ zIndex: 10001 }} onClick={() => setThreadModal(null)}>
          <div 
            className="thread-modal-content" 
            onClick={(e) => e.stopPropagation()}
            style={{ 
              position: "relative",
              width: "100%", 
              maxWidth: "500px", 
              background: "var(--color-bg-primary)", 
              borderRadius: "24px", 
              display: "flex", 
              flexDirection: "column", 
              maxHeight: "85vh",
              boxShadow: "0 20px 50px rgba(0,0,0,0.3)",
              overflow: "hidden",
              border: "1px solid var(--glass-border)"
            }}
          >
            <div style={{ padding: "20px 24px", borderBottom: "1px solid var(--glass-border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h2 style={{ margin: 0, fontSize: "1rem", fontWeight: 900 }}>Thread</h2>
              <button onClick={() => setThreadModal(null)} style={{ background: "none", border: "none", fontSize: "1.5rem", cursor: "pointer", color: "var(--color-text-secondary)" }}>×</button>
            </div>

            <div style={{ flex: 1, overflowY: "auto", padding: "24px" }}>
              {/* Parent Note */}
              <div style={{ background: "var(--color-bg-subtle)", padding: "16px", borderRadius: "16px", marginBottom: "24px", borderLeft: "4px solid var(--color-accent)", display: "flex", gap: "12px" }}>
                {renderAvatar(threadModal.note.writer, 36)}
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
                    <span
                      style={{ fontSize: "0.85rem", fontWeight: 900, cursor: "pointer", color: "var(--color-text-primary)" }}
                      onClick={(e) => {
                        e.stopPropagation();
                        const member = getStaffByName(threadModal.note.writer);
                        if (member && onViewProfile) onViewProfile(member);
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.textDecoration = "underline"}
                      onMouseLeave={(e) => e.currentTarget.style.textDecoration = "none"}
                    >
                      {threadModal.note.writer}
                    </span>
                    <span style={{ fontSize: "0.65rem", color: "var(--color-text-secondary)" }}>{threadModal.note.date}</span>
                  </div>
                  <div style={{ fontSize: "0.9rem", lineHeight: 1.5 }}>{threadModal.note.text}</div>
                </div>
              </div>

              <div style={{ height: "1px", background: "var(--glass-border)", marginBottom: "24px" }} />

              {/* Replies */}
              <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                {(task.notes[threadModal.index].replies || []).map((reply, ridx) => (
                  <div key={ridx} style={{ display: "flex", gap: "12px" }}>
                    {renderAvatar(reply.writer, 32)}
                    <div style={{ flex: 1 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                        <span
                          style={{ fontSize: "0.8rem", fontWeight: 900, cursor: "pointer" }}
                          onClick={(e) => {
                            e.stopPropagation();
                            const member = getStaffByName(reply.writer);
                            if (member && onViewProfile) onViewProfile(member);
                          }}
                          onMouseEnter={(e) => e.currentTarget.style.textDecoration = "underline"}
                          onMouseLeave={(e) => e.currentTarget.style.textDecoration = "none"}
                        >
                          {reply.writer}
                        </span>
                        <span style={{ fontSize: "0.65rem", color: "var(--color-text-secondary)" }}>{reply.date}</span>
                      </div>
                      <div style={{ fontSize: "0.85rem", lineHeight: 1.4, color: "var(--color-text-primary)" }}>{reply.text}</div>
                    </div>
                  </div>
                ))}
                {(task.notes[threadModal.index].replies || []).length === 0 && (
                  <div style={{ textAlign: "center", padding: "20px", color: "var(--color-text-secondary)", fontStyle: "italic", fontSize: "0.85rem" }}>
                    No replies yet. Start the conversation!
                  </div>
                )}
              </div>
            </div>

            {/* Reply Input */}
            <div style={{ padding: "20px 24px", borderTop: "1px solid var(--glass-border)", background: "var(--color-bg-subtle)", position: "relative" }}>
              <div style={{ display: "flex", gap: "12px" }}>
                <textarea 
                  ref={replyTextareaRef}
                  placeholder="Reply... (use @ to mention)"
                  value={replyInputText}
                  onChange={(e) => handleTextareaChange(e, 'reply')}
                  onKeyDown={(e) => handleTextareaKeyDown(e, 'reply')}
                  style={{ 
                    flex: 1, 
                    background: "var(--color-bg-primary)", 
                    border: "1px solid var(--glass-border)", 
                    borderRadius: "12px", 
                    padding: "10px 12px", 
                    fontSize: "0.85rem", 
                    resize: "none",
                    height: "40px"
                  }}
                />
                <button 
                  onClick={handleAddReply}
                  style={{ 
                    background: "var(--color-accent)", 
                    color: "white", 
                    border: "none", 
                    borderRadius: "12px", 
                    padding: "0 16px", 
                    fontWeight: 900, 
                    fontSize: "0.75rem",
                    cursor: "pointer"
                  }}
                >
                  Reply
                </button>
              </div>
              {mentionConfig && mentionConfig.target === 'reply' && filteredStaff.length > 0 && (
                <div className="mention-list" style={{ position: 'absolute', bottom: 'calc(100% + 5px)', left: '24px', zIndex: 10002 }}>
                  {filteredStaff.map((s, i) => (
                    <div 
                      key={s.email} 
                      className={`mention-item ${i === mentionIndex ? 'selected' : ''}`}
                      onClick={() => handleMentionSelect(s)}
                    >
                      <div className="mention-avatar">
                        {s.name.charAt(0).toUpperCase()}
                      </div>
                      {s.name}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      {/* Feature Modal */}
      {featureModalConfig && (
        <FeatureModal
          mode={featureModalConfig.mode}
          feature={featureModalConfig.feature}
          taskId={taskId}
          onClose={() => setFeatureModalConfig(null)}
          canEdit={canManageFeatures}
          userName={userName}
          type={featureModalConfig.type || featureModalConfig.feature?.type || "feature"}
          taskTitle={task.title}
          showModal={showModal}
        />
      )}

      {/* Feature Context Menu — backdrop closes on outside click */}
      {featureContextMenu && (
        <>
          <div
            style={{ position: "fixed", inset: 0, zIndex: 9998 }}
            onClick={() => setFeatureContextMenu(null)}
            onContextMenu={(e) => { e.preventDefault(); setFeatureContextMenu(null); }}
          />
          <div
            style={{
              position: "fixed",
              top: featureContextMenu.y,
              left: featureContextMenu.x,
              background: "var(--color-card-bg)",
              padding: "4px 0",
              borderRadius: 10,
              boxShadow: "var(--shadow-lg)",
              zIndex: 9999,
              border: "1px solid var(--glass-border)",
              minWidth: 160,
              overflow: "hidden",
            }}
          >
            <button
              style={{ width: "100%", padding: "9px 16px", textAlign: "left", background: "none", border: "none", fontSize: "0.82rem", cursor: "pointer", display: "flex", alignItems: "center", gap: 8, color: "var(--color-text-primary)", fontWeight: 700 }}
              onMouseEnter={e => e.currentTarget.style.background = "var(--color-bg-subtle)"}
              onMouseLeave={e => e.currentTarget.style.background = "none"}
              onClick={() => handleFeatureEdit(featureContextMenu.feature)}
            >
              ✏️ {featureContextMenu.feature?.type === "bug" ? "Edit Bug" : "Edit Feature"}
            </button>
            <div style={{ height: 1, background: "var(--glass-border)", margin: "2px 0" }} />
            <button
              style={{ width: "100%", padding: "9px 16px", textAlign: "left", background: "none", border: "none", fontSize: "0.82rem", cursor: "pointer", display: "flex", alignItems: "center", gap: 8, color: "#ef4444", fontWeight: 700 }}
              onMouseEnter={e => e.currentTarget.style.background = "#fef2f2"}
              onMouseLeave={e => e.currentTarget.style.background = "none"}
              onClick={() => handleFeatureDelete(featureContextMenu.feature)}
            >
              🗑️ {featureContextMenu.feature?.type === "bug" ? "Delete Bug" : "Delete Feature"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
