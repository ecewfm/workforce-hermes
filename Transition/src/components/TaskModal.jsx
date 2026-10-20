import { useState, useEffect, useRef, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { useQuery, useMutation } from "../data/react";
import { api } from "../data/api";
import { notifyNoteAdded, notifyMilestoneCompleted } from "../utils/notifications";
import { isAdminPlusOrAbove, isAdminLevel as isAdminLevelRole, canEditAnyCard } from "../utils/roles";
import { milestoneAnchor, DAY_MS } from "../utils/deadlines";
import FeatureModal from "./FeatureModal";
import { createCardMorph } from "../utils/cardMorph";
import { useWorkspace } from "../utils/workspaceContext";
import { termsFor, itemWords } from "../utils/workspaceTerms";
import { authApi } from "../data/auth";
import Select from "./ui/Select";
import { useOutsideClose } from "./ui/Popover";
import { useAccountUi } from "../utils/accountScope";

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


// How each sidebar kind looks (feature = the neutral default).
const KIND_LOOK = {
  feature: { pill: "var(--color-bg-subtle)", pillFg: "var(--color-text-secondary)", addBg: "#f8fafc", addFg: "#475569", addBorder: "#e2e8f0" },
  bug: {
    pill: "rgba(239, 68, 68, 0.15)", pillFg: "#ef4444", addBg: "#fef2f2", addFg: "#dc2626", addBorder: "#fca5a5",
    stripe: "#ef4444", iconBg: "#fef2f2", iconFg: "#ef4444", badgeBg: "#fee2e2", badgeFg: "#ef4444",
  },
  roadblock: {
    pill: "rgba(245, 158, 11, 0.16)", pillFg: "#b45309", addBg: "#fffbeb", addFg: "#b45309", addBorder: "#fcd34d",
    stripe: "#f59e0b", iconBg: "#fffbeb", iconFg: "#d97706", badgeBg: "#fef3c7", badgeFg: "#b45309",
  },
};

// What kind of document a link is (a small coloured label in the list).
function docKind(url) {
  const u = String(url || "").toLowerCase();
  if (u.includes("docs.google.com/document")) return { label: "DOC", bg: "#dbeafe", fg: "#1d4ed8" };
  if (u.includes("docs.google.com/spreadsheets")) return { label: "SHEET", bg: "#dcfce7", fg: "#15803d" };
  if (u.includes("docs.google.com/presentation")) return { label: "SLIDES", bg: "#fef3c7", fg: "#b45309" };
  if (u.includes("docs.google.com/forms") || u.includes("forms.gle")) return { label: "FORM", bg: "#ede9fe", fg: "#6d28d9" };
  if (u.includes("drive.google.com")) return { label: "DRIVE", bg: "#e0f2fe", fg: "#0369a1" };
  if (u.includes("sharepoint.com") || u.includes("onedrive") || u.includes("1drv.ms")) return { label: "OFFICE", bg: "#dbeafe", fg: "#0364b8" };
  if (/\.pdf($|[?#])/.test(u)) return { label: "PDF", bg: "#fee2e2", fg: "#b91c1c" };
  if (/\.(xlsx?|csv)($|[?#])/.test(u)) return { label: "SHEET", bg: "#dcfce7", fg: "#15803d" };
  if (/\.(docx?)($|[?#])/.test(u)) return { label: "DOC", bg: "#dbeafe", fg: "#1d4ed8" };
  if (/\.(pptx?)($|[?#])/.test(u)) return { label: "SLIDES", bg: "#fef3c7", fg: "#b45309" };
  return { label: "LINK", bg: "var(--color-bg-subtle)", fg: "var(--color-text-secondary)" };
}

function KindIcon({ kind, size = 16 }) {
  const common = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2.5, style: { flexShrink: 0 } };
  if (kind === "bug") {
    return (
      <svg {...common}>
        <path d="M20.9 9.1C21.7 8.3 21.7 7 20.9 6.2c-.8-.8-2.1-.8-2.9 0L17.5 6.7m-11 0L6 6.2C5.2 5.4 3.9 5.4 3.1 6.2c-.8.8-.8 2.1 0 2.9l.5.5m0 6L3.1 16.1C2.3 16.9 2.3 18.2 3.1 19c.8.8 2.1.8 2.9 0l.5-.5m11 0l.5.5c.8.8 2.1.8 2.9 0 .8-.8.8-2.1 0-2.9l-.5-.5" />
        <path d="M12 2v2m0 16v2m7-9h2M3 12h2M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" />
      </svg>
    );
  }
  if (kind === "roadblock") {
    // A road barrier.
    return (
      <svg {...common}>
        <rect x="2" y="7" width="20" height="6" rx="1.5" />
        <path d="M7 7l-3 6M13 7l-3 6M19 7l-3 6M5 13v6M19 13v6" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </svg>
  );
}

export default function TaskModal({ taskId, isEditMode, initialNotesOpen, userRole, actualRole, userName, staff, onClose, showModal, showInputModal, onViewProfile, originRect, seedTask, rehearsal, onRehearsed }) {
  // rehearsal: an invisible, side-effect-free render the app does once when
  // it's idle, so the first real open doesn't pay the browser's one-time
  // warm-up (style/layout caches, text shaping, GPU shaders) — see App.jsx.
  const workspace = useWorkspace();
  const accUi = useAccountUi(workspace, actualRole, userRole);
  const terms = termsFor(workspace);
  const liveTask = useQuery(api.tasks.getTaskById, rehearsal ? "skip" : { taskId });
  // The board hands us its (light) copy of the task so the modal can render —
  // and the morph can start — on the very click frame, instead of waiting a
  // network round-trip. Light tasks lack notes/features; the live query
  // replaces the seed once it resolves.
  //
  // While the open morph plays, the modal keeps showing what it opened with:
  // swapping the full task in mid-flight re-lays-out the whole modal (notes,
  // features…) and would land a long frame in the middle of the motion. The
  // full task goes in the moment the morph settles.
  const [settled, setSettled] = useState(false);
  const seedRef = useRef(null);
  if (seedTask && !seedRef.current) seedRef.current = { ...seedTask, notes: seedTask.notes || [], features: seedTask.features || [], _seed: true };
  const heldRef = useRef(undefined);
  let task;
  if (seedRef.current && (!settled || liveTask === undefined)) task = seedRef.current;
  else if (!settled && heldRef.current) task = heldRef.current; // no seed: hold the first full copy
  else task = liveTask;
  heldRef.current = task;
  // Notes/features aren't in the board's light copy — say "loading", not "none".
  const detailsLoading = !!task?._seed;
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
  const taskViewHistoryTime = useQuery(api.tasks.getTaskViewHistory, rehearsal ? "skip" : { taskId, userEmail: localStorage.getItem("wf_email") || "" });
  const accounts = useQuery(api.accounts.getAccounts, terms.accounts && !rehearsal ? { workspace } : "skip");
  const setTaskAccount = useMutation(api.tasks.setTaskAccount);
  const addAccount = useMutation(api.accounts.addAccount);
  const updateTaskDocuments = useMutation(api.tasks.updateTaskDocuments);
  const updateTaskPlanNotes = useMutation(api.tasks.updateTaskPlanNotes);

  const [selectedAssignees, setSelectedAssignees] = useState(new Set());
  const [showOptions, setShowOptions] = useState(false);
  // The assignee list closes when you click anywhere else (it used to stay open over the fields below).
  const multiRef = useRef(null);
  useOutsideClose(showOptions, [multiRef], () => setShowOptions(false));
  const [editedTitle, setEditedTitle] = useState("");
  const [editedDesc, setEditedDesc] = useState("");
  const [editedAppscriptLink, setEditedAppscriptLink] = useState("");
  const [editedWebappLink, setEditedWebappLink] = useState("");
  const [featureModalConfig, setFeatureModalConfig] = useState(null);
  const [featureContextMenu, setFeatureContextMenu] = useState(null);
  const [editedMilestones, setEditedMilestones] = useState([]);
  // Sidebar kind on show: Workforce has Features + Bugs tabs; Ops/Exec one Roadblocks list.
  const itemKinds = terms.itemKinds;
  const [featureView, setFeatureView] = useState(itemKinds[0]);
  const [noteInputText, setNoteInputText] = useState("");
  const [notesFullscreen, setNotesFullscreen] = useState(!!initialNotesOpen);
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
  // "⋯" menu holding System Links, API Access and Admin Credentials (Workforce, Admin-level).
  const [accessOpen, setAccessOpen] = useState(false);
  const accessRef = useRef(null);
  useEffect(() => {
    if (!accessOpen) return undefined;
    const onDown = (e) => {
      // Clicks in the "confirm it's you" password dialog don't count as outside.
      if (accessRef.current?.contains(e.target) || e.target.closest?.(".custom-modal-overlay")) return;
      setAccessOpen(false);
    };
    const onKey = (e) => { if (e.key === "Escape" && !document.querySelector(".custom-modal-overlay")) setAccessOpen(false); };
    document.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onDown, true); window.removeEventListener("keydown", onKey); };
  }, [accessOpen]);
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
    // Re-enter YOUR OWN password (checked by the server). There used to be a
    // shared master password written into the app's code — anyone could read it.
    showInputModal({
      title: "Confirm it's you",
      message: "Enter your Hermes password to reveal these credentials.",
      fields: [{ name: "pass", label: "Your password", type: "password", placeholder: "••••••••" }],
      onConfirm: async (data) => {
        try {
          await authApi.verifyPassword(data.pass || "");
          setPasswordRevealed(true);
        } catch (err) {
          showModal({ title: "Access Denied", message: err?.message || "That password isn't right.", type: "alert" });
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

  // ── Open/close motion: the clicked card itself morphs into this modal and
  // back (src/utils/cardMorph.js — Web Animations, so the compositor plays it
  // even while React is busy). No CSS keyframes on this modal (see the
  // .task-modal-overlay exclusions in index.css); the seeded task means the
  // morph starts on the click's own frame. ───────────────────────────────────
  const overlayRef = useRef(null);
  const backdropRef = useRef(null); // dim+blur layer behind the box
  const contentRef = useRef(null);
  const closingRef = useRef(false);
  const morphRef = useRef(null);
  if (!morphRef.current) morphRef.current = createCardMorph();
  const appView = () => document.querySelector(".view-stage");

  const hasTask = !!task;
  useLayoutEffect(() => {
    if (!hasTask || rehearsal) return;
    const morph = morphRef.current;
    morph.open({
      box: contentRef.current,
      backdrop: backdropRef.current,
      origin: originRect,
      stage: appView(),
      onSettled: () => setSettled(true),
    });
    // Unmount by any path (incl. StrictMode's rehearsal): never leave the
    // stage zoomed or the card hidden.
    return () => morph.dispose(appView());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasTask]);

  // The card to land on when closing: the one we opened from if it's still
  // on the board, else that task's card wherever it sits now (it may have
  // re-rendered or moved column), else wherever we came from (a dashboard row).
  const landingCard = () => {
    const from = originRect?.node;
    if (from?.isConnected && from.classList?.contains("task-card")) return from;
    const onBoard = appView()?.querySelector(`.task-card[data-id="${CSS.escape(String(taskId))}"]`);
    return onBoard || (from?.isConnected ? from : null);
  };

  const doClose = () => {
    if (closingRef.current) return;
    closingRef.current = true;
    morphRef.current.close({
      box: contentRef.current,
      backdrop: backdropRef.current,
      overlay: overlayRef.current,
      stage: appView(),
      card: landingCard(),
      onDone: () => {
        document.documentElement.classList.remove("wf-modal-open");
        onClose();
      },
    });
  };

  // While any task modal is open, the cursor-follow camera stands down
  // (CameraFollow checks this class) — the modal's own camera owns the
  // stage. Layout effect: the claim must land BEFORE paint so the cursor
  // camera's mutation observer can never race in and kill the flight. On a
  // doClose the class outlives the unmount until the pull-back finishes
  // (doClose's onDone removes it).
  useLayoutEffect(() => {
    if (rehearsal) return;
    document.documentElement.classList.add("wf-modal-open");
    return () => { if (!closingRef.current) document.documentElement.classList.remove("wf-modal-open"); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Rehearsal: let the browser lay out, paint and draw it (a few frames),
  // then hand control back so the app unmounts it.
  useEffect(() => {
    if (!rehearsal || !hasTask) return;
    let raf = requestAnimationFrame(() => { raf = requestAnimationFrame(() => { raf = requestAnimationFrame(() => onRehearsed?.()); }); });
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasTask]);

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
      if (taskId && !rehearsal) {
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

  // ── Plan notes, documents, account ───────────────────────────────────────
  const watchOuts = Array.isArray(task?.watchOuts) ? task.watchOuts : [];
  const assumptions = Array.isArray(task?.assumptions) ? task.assumptions : [];
  const documents = Array.isArray(task?.documents) ? task.documents : [];
  const fail = (title) => (err) => showModal({ title, message: err?.message || "Please try again.", type: "alert" });

  function addPlanNote(field) {
    const isWatch = field === "watchOuts";
    showInputModal({
      title: isWatch ? "Add a watch-out" : "Add an assumption",
      message: isWatch ? "A risk that could slow this project down — and how you'll handle it." : "Something this plan relies on that should be confirmed.",
      fields: [{ name: "text", label: isWatch ? "Watch out for" : "Assumption", placeholder: isWatch ? "e.g. Agents may resist the new SOP — brief team leads first" : "e.g. One site, about 40 agents" }],
      onConfirm: (d) => {
        const text = (d.text || "").trim();
        if (!text) return;
        const list = [...(isWatch ? watchOuts : assumptions), text];
        updateTaskPlanNotes({ taskId, [field]: list }).catch(fail("Couldn't save"));
      },
    });
  }

  function removePlanNote(field, idx) {
    const list = (field === "watchOuts" ? watchOuts : assumptions).filter((_, i) => i !== idx);
    updateTaskPlanNotes({ taskId, [field]: list }).catch(fail("Couldn't save"));
  }

  function handleAddDocument() {
    showInputModal({
      title: "Add a document",
      message: "Link anything this project relies on — an SOP, a deck, a sheet, a brief.",
      fields: [
        { name: "name", label: "Name", placeholder: "e.g. Escalation SOP v2" },
        { name: "url", label: "Link", placeholder: "https://docs.google.com/…" },
      ],
      onConfirm: (d) => {
        let url = (d.url || "").trim();
        if (!url) return;
        if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
        const name = (d.name || "").trim() || url;
        updateTaskDocuments({ taskId, documents: [...documents, { name, url }] }).catch(fail("Couldn't add the document"));
      },
    });
  }

  function handleRemoveDocument(idx) {
    const doc = documents[idx];
    showModal({
      title: "Remove document",
      message: `Remove "${doc?.name}" from this project? (The document itself isn't touched.)`,
      type: "confirm",
      onConfirm: () => updateTaskDocuments({ taskId, documents: documents.filter((_, i) => i !== idx) }).catch(fail("Couldn't remove the document")),
    });
  }

  function handleAccountChange(value) {
    if (value === "__new") {
      showInputModal({
        title: "New account",
        message: "Create a client account for this workspace and put this project in it.",
        fields: [{ name: "name", label: "Account name", placeholder: "e.g. Walmart" }],
        onConfirm: async (d) => {
          const name = (d.name || "").trim();
          if (!name) return;
          try {
            const id = await addAccount({ workspace, name });
            await setTaskAccount({ taskId, accountId: id });
          } catch (err) {
            fail("Couldn't create the account")(err);
          }
        },
      });
      return;
    }
    setTaskAccount({ taskId, accountId: value || null }).catch(fail("Couldn't change the account"));
  }

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
      updated[idx].completedAtTime = Date.now(); // the next milestone's countdown starts here
      notifyMilestoneCompleted(task.title, updated[idx].name);
    } else {
      delete updated[idx].completedAt;
      delete updated[idx].completedAtTime;
    }
    const completedCount = updated.filter((m) => m.completed).length;
    updateTaskMilestones({
      taskId,
      milestones: updated,
      completedCount,
      actorEmail: currentUserEmail,
      actorName: userName
    }).catch((err) => showModal({ title: "Milestone not saved", message: err?.message || "Please try again.", type: "alert" }));
  }

  function handleAddNote() {
    const text = noteInputText.trim();
    if (!text) return;
    const estDate = new Date().toLocaleString("en-US", {
      timeZone: "America/New_York",
      year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit",
    });
    addNoteToTask({ taskId, noteText: text, writer: userName, writerEmail: currentUserEmail, date: estDate });
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
      noteId: threadModal.note?.id,
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
      message: `Move "${task.title}" to the archive? It leaves the board. An Admin can restore it — or delete it for good — in Settings → Archived Projects.`,
      type: "confirm",
      onConfirm: () => { deleteTask({ taskId, actorEmail: currentUserEmail, actorName: userName, source: "modal" }); onClose(); }
    });
  }

  function handleSaveEdits() {
    // Send each milestone's own times back: a renamed milestone used to get
    // fresh timestamps, which moved every later deadline.
    const newMilestones = editedMilestones.map((m) => ({
      name: (m.name || "").trim() || "Unnamed",
      days: parseInt(m.days) || 0,
      completed: m.completed || false,
      completedAt: m.completedAt,
      ...(m.completedAtTime ? { completedAtTime: m.completedAtTime } : {}),
      ...(m.createdAtTime ? { createdAtTime: m.createdAtTime } : {}),
      hint: (m.hint || "").trim(),
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
    doClose(); // morph back into the card like every other close
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
      title: `Delete ${itemWords(f.type).title}`,
      message: `Are you sure you want to permanently delete the ${itemWords(f.type).one} "${f.name}"?`,
      type: "confirm",
      onConfirm: () => { deleteTaskFeature({ taskId, featureId: f.id }); }
    });
  }

  function handleBulkDelete(type) {
    switch (type) {
      case 'features':
        if (selectedFeatures.size === 0) return;
        showModal({
          title: `Bulk Delete ${itemWords(featureView === "bug" ? "feature" : featureView).heading}`,
          message: `Are you sure you want to permanently delete ${selectedFeatures.size} ${selectedFeatures.size > 1 ? itemWords(featureView === "bug" ? "feature" : featureView).many : itemWords(featureView === "bug" ? "feature" : featureView).one}?`,
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
            // Selection holds note ids (positions shift if someone else deletes meanwhile).
            const picked = Array.from(selectedNotes);
            deleteNotesBulk({ taskId, indices: picked.filter((k) => typeof k === "number"), noteIds: picked.filter((k) => typeof k === "string") });
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
        else setSelectedNotes(new Set(items.map((n, i) => n.id || i)));
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

  return createPortal(
    <div
      className="modal-overlay task-modal-overlay tm-backdrop-delegated"
      ref={overlayRef}
      onClick={(e) => { if (e.target === e.currentTarget) doClose(); }}
      {...(rehearsal ? { "data-rehearsal": "", "aria-hidden": true, style: { opacity: 0.002, pointerEvents: "none" } } : {})}
    >
      <div className="task-modal-backdrop" ref={backdropRef} />
      <div className="modal-content task-modal-content" ref={contentRef} onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={doClose}>×</button>

        <div className="modal-grid-3">

          {/* ── Sidebar: Features & Bugs (Workforce) · Roadblocks (Operations, Executives) ── */}
          {(() => {
            const W = itemWords(featureView);
            const look = KIND_LOOK[featureView] || KIND_LOOK.feature;
            const items = (task.features || []).filter((f) => (f.type || "feature") === featureView);
            const openCount = items.filter((f) => f.status === "pending").length;
            const [selected, setSelected] = featureView === "bug" ? [selectedBugs, setSelectedBugs] : [selectedFeatures, setSelectedFeatures];
            const bulkKey = featureView === "bug" ? "bugs" : "features";
            return (
          <div className={`features-sidebar kind-${featureView}`} style={{ display: "flex", flexDirection: "column", height: "100%" }}>
            <div className="features-header" style={{ flexShrink: 0, paddingBottom: 12, borderBottom: "1px solid #f1f5f9", marginBottom: 14 }}>

              {/* ── View Tabs (only when there's more than one kind) ── */}
              {itemKinds.length > 1 && (
                <div className="taskmodal-tabs" role="tablist" aria-label="Item tabs">
                  {itemKinds.map((kind) => {
                    const badge = !isProgrammer ? 0 : kind === "bug" ? newBugs : kind === "feature" ? newFeatures : 0;
                    return (
                      <button
                        key={kind}
                        type="button"
                        role="tab"
                        aria-selected={featureView === kind}
                        className={`taskmodal-tab ${featureView === kind ? "active" : ""}`}
                        onClick={() => {
                          setFeatureView(kind);
                          clearBadge(kind === "bug" ? "bugs" : "features");
                        }}
                        style={{ position: "relative" }}
                      >
                        <KindIcon kind={kind} size={10} />
                        {itemWords(kind).tab}
                        {badge > 0 && <span className="tm-tab-badge">{badge}</span>}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* ── Row: title + open count + add button ── */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "7px" }}>
                  {itemKinds.length === 1 && <span className="tm-kind-icon" style={{ color: look.fg }}><KindIcon kind={featureView} size={13} /></span>}
                  <h3 style={{ margin: 0, fontSize: "0.82rem", fontWeight: 800, color: "var(--color-text-primary)", letterSpacing: "-0.2px" }}>
                    {W.heading}
                  </h3>
                  {openCount > 0 && (
                    <span style={{
                      background: look.pill,
                      color: look.pillFg,
                      fontSize: "0.58rem", padding: "2px 7px", borderRadius: "20px", fontWeight: 800, letterSpacing: "0.4px",
                    }}>
                      {openCount} OPEN
                    </span>
                  )}
                </div>
                {canManageFeatures && (
                  <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                    {selected.size > 0 && (
                      <button className="select-all-btn" onClick={() => handleSelectAll(bulkKey, items)}>
                        Select All
                      </button>
                    )}
                    <button
                      className="btn-add-feature"
                      style={{
                        background: look.addBg,
                        color: look.addFg,
                        border: `1.5px solid ${look.addBorder}`,
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
              {selected.size > 0 && (
                <div className="bulk-action-bar">
                  <span>{selected.size} selected</span>
                  <button className="btn-bulk-delete" onClick={() => handleBulkDelete(bulkKey)}>
                    Delete Selected
                  </button>
                </div>
              )}
              {/* Newest first */}
              {[...items].reverse().map((f) => {
                const isSelected = selected.has(f.id);
                const open = f.status !== "completed";
                return (
                  <div
                    key={f.id}
                    className={`feature-card ${f.status === "completed" ? "completed" : ""} ${isSelected ? "bulk-selected-item" : ""}`}
                    onClick={(e) => handleRowClickToggle(e, setSelected, f.id)}
                    onContextMenu={(e) => handleFeatureContextMenu(e, f)}
                    style={{ cursor: "pointer", userSelect: "none", borderLeft: look.stripe && open ? `3px solid ${look.stripe}` : undefined, display: "flex", alignItems: "center" }}
                  >
                    <div style={{ flex: 1, display: "flex", gap: "12px", alignItems: "flex-start" }} onClick={(e) => {
                      if (e.ctrlKey || e.metaKey) return;
                      setFeatureModalConfig({ mode: "view", feature: f, type: featureView });
                    }}>
                      <div className="feature-icon-box" style={{ background: look.iconBg, color: look.iconFg }}>
                        <KindIcon kind={featureView} size={16} />
                      </div>
                      <div className="feature-info" style={{ flex: 1 }}>
                        <h4>{f.name}</h4>
                        <p>{f.description}</p>
                        <div style={{ display: "flex", gap: "8px", fontSize: "0.65rem", color: "#64748b", marginBottom: "4px" }}>
                          <span>{featureView === "roadblock" ? "Raised" : "Created"}: {f.createdAt || "N/A"}</span>
                          {f.completedAt && <span>{featureView === "roadblock" ? "Cleared" : "Completed"}: {f.completedAt}</span>}
                        </div>
                        <span className={`feature-badge ${f.status}`} style={{ background: open ? look.badgeBg : undefined, color: open ? look.badgeFg : undefined }}>
                          {open ? W.open : W.done}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
              {detailsLoading ? (
                <div className="tm-loading-rows" aria-label={`Loading ${W.many}`}><span /><span /></div>
              ) : items.length === 0 && (
                <div className="tm-empty-items" style={{ textAlign: "center", color: "#94a3b8", fontStyle: "italic", fontSize: "0.8rem", marginTop: 20 }}>
                  {W.empty}
                </div>
              )}
            </div>
          </div>
            );
          })()}

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
                    {terms.tech && (task.webappLink || task.projectLink) && (
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
                    {terms.tech && task.appscriptLink && (
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
                    {terms.tech && (userRole === "Admin" || userRole === "Admin+") && (
                      <div className="tm-more" ref={accessRef}>
                        <button
                          type="button"
                          className={`tm-more-btn${accessOpen ? " open" : ""}`}
                          onClick={() => setAccessOpen((o) => !o)}
                          aria-expanded={accessOpen}
                          aria-label="System links, API access and admin login"
                          title="System links · API access · Admin login"
                        >
                          <span /><span /><span />
                        </button>
                        {accessOpen && (
                          <div className="tm-more-pop" role="dialog" aria-label="Project access">
                            <div className="tm-more-head">
                              Project access
                              <span>Admins only</span>
                            </div>

                            <section className="tm-acc system-links-box">
                              <div className="tm-acc-title">
                                <span className="tm-acc-icon links">
                                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" aria-hidden="true">
                                    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                                    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                                  </svg>
                                </span>
                                System links
                              </div>
                              <div className="tm-acc-grid">
                                <span className="tm-acc-key">Appscript</span>
                                {task.appscriptLink ? (
                                  <a className="tm-acc-link" href={task.appscriptLink.startsWith("http") ? task.appscriptLink : `https://${task.appscriptLink}`} target="_blank" rel="noopener noreferrer">{task.appscriptLink}</a>
                                ) : <span className="tm-acc-empty">Not set</span>}
                                <span className="tm-acc-key">Webapp</span>
                                {(task.webappLink || task.projectLink) ? (
                                  <a className="tm-acc-link" href={(task.webappLink || task.projectLink).startsWith("http") ? (task.webappLink || task.projectLink) : `https://${(task.webappLink || task.projectLink)}`} target="_blank" rel="noopener noreferrer">{task.webappLink || task.projectLink}</a>
                                ) : <span className="tm-acc-empty">Not set</span>}
                              </div>
                            </section>

                            <section className="tm-acc api-access-box">
                              <div className="tm-acc-title">
                                <span className="tm-acc-icon api">
                                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" aria-hidden="true">
                                    <polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" />
                                  </svg>
                                </span>
                                API access
                              </div>
                              <div className="tm-acc-api">
                                <input readOnly value={`${window.location.origin}/api/task?taskId=${taskId}`} onFocus={(e) => e.target.select()} aria-label="API URL" />
                                <button
                                  type="button"
                                  className={`tm-copy-btn${apiCopied ? " copied" : ""}`}
                                  onClick={() => {
                                    navigator.clipboard.writeText(`${window.location.origin}/api/task?taskId=${taskId}`);
                                    setApiCopied(true);
                                    setTimeout(() => setApiCopied(false), 1500);
                                  }}
                                >
                                  {apiCopied ? "Copied!" : "Copy"}
                                </button>
                              </div>
                              <div className="tm-acc-hint">
                                GET reads this project · POST <code>resource=bug|feature|note</code> · PATCH <code>resource=links</code> sets system links. Auth: <code>x-api-key</code> header — see <b>TASK-API.md</b>.
                              </div>
                            </section>

                            <section className="tm-acc admin-creds-box">
                              <div className="tm-acc-title">
                                <span className="tm-acc-icon creds">
                                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" aria-hidden="true">
                                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
                                  </svg>
                                </span>
                                Admin login
                                <span className="tm-acc-tag">Sensitive</span>
                              </div>
                              <div className="tm-acc-grid mono">
                                <span className="tm-acc-key">Email</span>
                                <span className={passwordRevealed ? "tm-acc-secret shown" : "tm-acc-secret"}>{passwordRevealed ? (deobfuscate(task.adminCredentials?.email) || "—") : "••••••••••••"}</span>
                                <span className="tm-acc-key">Password</span>
                                <span className={passwordRevealed ? "tm-acc-secret shown" : "tm-acc-secret"}>{passwordRevealed ? (deobfuscate(task.adminCredentials?.password) || "—") : "••••••••"}</span>
                              </div>
                              {!passwordRevealed && (
                                <button type="button" className="tm-reveal-btn" onClick={handleRevealPassword}>
                                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" />
                                  </svg>
                                  Reveal — confirm it's you
                                </button>
                              )}
                            </section>
                          </div>
                        )}
                      </div>
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
                    <div className="custom-multiselect" ref={multiRef}>
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

              {accUi.show && (
                <div className="tm-account-row">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                    <path d="M3 21h18M5 21V7l7-4 7 4v14M9 9h1m4 0h1M9 13h1m4 0h1M9 17h1m4 0h1" />
                  </svg>
                  <span className="tm-account-label">Account</span>
                  {canManageFeatures ? (
                    <Select
                      size="sm"
                      className="tm-account-select"
                      value={task.accountId || ""}
                      onChange={(v) => handleAccountChange(v)}
                      ariaLabel="Account"
                      menuWidth={220}
                      options={[
                        ...(accUi.full ? [{ value: "", label: "No account" }] : []),
                        ...accUi.limit(accounts).map((a) => ({ value: a._id, label: a.name })),
                        ...(task.accountId && !(accounts || []).some((a) => a._id === task.accountId) ? [{ value: task.accountId, label: task.account || "…" }] : []),
                        ...(accUi.full ? [{ value: "__new", label: "+ New account…", action: true }] : []),
                      ]}
                    />
                  ) : (
                    <span className="tm-account-pill">{task.account || "No account"}</span>
                  )}
                </div>
              )}

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
                  <label htmlFor="priority-checkbox" className="tm-priority-label" style={{ fontSize: "0.75rem", fontWeight: 700, cursor: "pointer", userSelect: "none" }}>
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
                    {terms.tech && <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 15, marginBottom: 15 }}>
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
                    </div>}
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
              {(watchOuts.length > 0 || assumptions.length > 0 || (!terms.tech && canEditMilestone && !isEditMode)) && (
                <div className="tm-plan-notes">
                  {(watchOuts.length > 0 || (!terms.tech && canEditMilestone)) && (
                    <section className="tm-plan-section tm-watch">
                      <div className="tm-plan-head">
                        <span className="tm-plan-icon" aria-hidden="true">
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
                        </span>
                        <h4>Watch out for</h4>
                        {canEditMilestone && <button type="button" className="tm-plan-add" onClick={() => addPlanNote("watchOuts")}>+ Add</button>}
                      </div>
                      {watchOuts.length > 0 ? (
                        <ul>
                          {watchOuts.map((w, i) => (
                            <li key={i}>
                              <span>{w}</span>
                              {canEditMilestone && <button type="button" className="tm-plan-x" title="Remove" onClick={() => removePlanNote("watchOuts", i)}>×</button>}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="tm-plan-empty">Note the risks that could slow this project down — and how you'll handle them.</p>
                      )}
                    </section>
                  )}
                  {assumptions.length > 0 && (
                    <section className="tm-plan-section tm-assume">
                      <div className="tm-plan-head">
                        <span className="tm-plan-icon" aria-hidden="true">
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10" /><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
                        </span>
                        <h4>Assumptions</h4>
                        {canEditMilestone && <button type="button" className="tm-plan-add" onClick={() => addPlanNote("assumptions")}>+ Add</button>}
                      </div>
                      <ul>
                        {assumptions.map((a, i) => (
                          <li key={i}>
                            <span>{a}</span>
                            {canEditMilestone && <button type="button" className="tm-plan-x" title="Remove" onClick={() => removePlanNote("assumptions", i)}>×</button>}
                          </li>
                        ))}
                      </ul>
                    </section>
                  )}
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
                          <input
                            type="text"
                            className="form-input edit-m-hint"
                            value={m.hint || ""}
                            onChange={(e) => {
                              const next = [...editedMilestones];
                              next[idx] = { ...next[idx], hint: e.target.value };
                              setEditedMilestones(next);
                            }}
                            placeholder="What this step means / done when… (optional)"
                          />
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
                          {m.hint && <div className="milestone-hint">{m.hint}</div>}
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

            {!terms.tech && (
              <div className="documents-box">
                <div className="documents-header">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" />
                  </svg>
                  DOCUMENTS{documents.length > 0 ? ` (${documents.length})` : ""}
                  {canManageFeatures && (
                    <button type="button" className="documents-add" onClick={handleAddDocument}>+ ADD</button>
                  )}
                </div>
                <div className="documents-list">
                  {documents.length === 0 ? (
                    <div className="documents-empty">No documents yet — add the SOP, deck, sheet or brief this project relies on.</div>
                  ) : documents.map((d, i) => {
                    const k = docKind(d.url);
                    return (
                      <div className="document-row" key={`${d.url}-${i}`}>
                        <span className="document-kind" style={{ background: k.bg, color: k.fg }}>{k.label}</span>
                        <a href={d.url} target="_blank" rel="noopener noreferrer" className="document-name" title={d.url}>{d.name}</a>
                        {canManageFeatures && (
                          <button type="button" className="document-remove" title="Remove" onClick={() => handleRemoveDocument(i)}>×</button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
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
            <div className="notes-list" style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "0 5px", marginBottom: 10 }}>
              {selectedNotes.size > 0 && (
                <div className="bulk-action-bar">
                  <span>{selectedNotes.size} selected</span>
                  <button className="btn-bulk-delete" onClick={() => handleBulkDelete('notes')}>
                    Delete Selected
                  </button>
                </div>
              )}
              {/* Newest first; `i` stays the note's real position (reactions, replies, selection use it). */}
              {(task.notes || []).map((n, i) => [n, i]).reverse().map(([n, i]) => {
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
                    className={`note-item ${selectedNotes.has(n.id || i) ? "bulk-selected-item" : ""}`}
                    onClick={(e) => handleRowClickToggle(e, setSelectedNotes, n.id || i)}
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
                                toggleNoteReaction({ taskId, noteIndex: i, noteId: n.id, reactionType: key, userEmail: currentUserEmail, userName });
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
              {detailsLoading ? (
                <div className="tm-loading-rows" aria-label="Loading updates"><span /><span /><span /></div>
              ) : (task.notes || []).length === 0 && (
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
    </div>,
    document.body
  );
}
