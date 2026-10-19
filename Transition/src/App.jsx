import { useState, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { applySettings, loadSettings, saveSettings } from "./utils/settingsManager";
import { getProjectDeadlines, fmtDate } from "./utils/deadlines";
import { isAdminLevel, isAdminPlusOrAbove, isManager, defaultViewRole, roleBadgeLabel } from "./utils/roles";
import { accessibleWorkspaces, DEFAULT_WORKSPACE, DEPARTMENTS, workspaceLabel } from "./utils/departments";
import { WorkspaceContext } from "./utils/workspaceContext";
import { termsFor, roleLabel } from "./utils/workspaceTerms";
import { workspaceNeedsPassword, markWorkspaceUnlocked, clearWorkspaceUnlocks, hashPassword } from "./utils/workspacePassword";
import { morphOriginFrom } from "./utils/modalOrigin";
import { useQuery, useMutation, useConvex } from "./data/react";
import { api } from "./data/api";
import { supabase, hasStoredSession } from "./data/supabase";
import { signOut, authApi } from "./data/auth";
import { initNotifications } from "./utils/notifications";
import WorkspaceSelect, { WorkspaceCards } from "./components/WorkspaceSelect";
import WorkspacePasswordGate from "./components/WorkspacePasswordGate";
import Dashboard from "./components/Dashboard";
import KanbanBoard from "./components/KanbanBoard";
import TaskEntry from "./components/TaskEntry";
import Notebook from "./components/Notebook";
import TaskModal from "./components/TaskModal";
import NotesModal from "./components/NotesModal";
import RoboHand from "./components/RoboHand";
import CameraFollow from "./components/CameraFollow";
import AIAssistant from "./components/AIAssistant";
import { isCaddyEnabled } from "./utils/aiConfig";
import { milestoneAnchor, DAY_MS } from "./utils/deadlines";
import Login from "./components/Login";
import SetPassword from "./components/SetPassword";
import CustomModal from "./components/CustomModal";
import InputModal from "./components/InputModal";
import AnnouncementPopup from "./components/AnnouncementPopup";
import AnnouncementComposer from "./components/AnnouncementComposer";
import TaskNotificationPopup from "./components/TaskNotificationPopup";
import Settings from "./components/Settings";
import NotificationBell from "./components/NotificationBell";
import Handbook from "./components/Handbook";
import HeaderSearch from "./components/HeaderSearch";

const ACTIVITY_EVENTS = ["mousemove", "keydown", "click", "scroll", "touchstart"];

// Minimum time the branded loading video stays on screen (so it's actually seen
// even when data resolves in milliseconds).
const SPLASH_MIN_MS = 2500;

// Session expires only after this much *continuous inactivity* (no mouse, key,
// click, scroll or touch). Set to 7 hours.
const SESSION_EXPIRY_MS = 7 * 60 * 60 * 1000;
// Don't rewrite localStorage on every mousemove — at most once per minute.
const ACTIVITY_WRITE_THROTTLE_MS = 60 * 1000;

export default function App() {
  // --- Refs ---
  const hasSetInitialView = useRef(false);
  const sessionExpiredRef = useRef(false); // ensures the expiry prompt fires only once
  const splashTimerRef = useRef(null);      // minimum-display timer for the loading video

  // --- Auth state ---
  const [authStage, setAuthStage] = useState(() => {
    // "login" | "set-password" | "set-security-question" | "select-workspace" | "authenticated" | "denied"
    // A real signed-in session is required — the old localStorage flag alone
    // (e.g. left over from before the Supabase move) sends you to the login.
    if (localStorage.getItem("wf_authenticated") === "true") {
      const email = localStorage.getItem("wf_email");
      if (!email || !hasStoredSession()) {
        localStorage.removeItem("wf_authenticated");
        return "login";
      }
      return "authenticated";
    }
    return "login";
  });
  const [pendingEmail, setPendingEmail] = useState(""); // used during set-password flow
  const [loginError, setLoginError] = useState("");     // error passed back to Login

  // --- Workspace state (department RBAC / data isolation) ---
  // The active workspace scopes every workspace-filtered query. Persisted
  // under wf_workspace and validated against the user's department access on
  // every auth resolve. userDepartments feeds the post-login workspace picker.
  const [activeWorkspace, setActiveWorkspace] = useState(() => localStorage.getItem("wf_workspace") || null);
  const [, setWsUnlockBump] = useState(0); // bump to re-render after unlocking a password-gated workspace
  const [userDepartments, setUserDepartments] = useState([]);
  const [showWorkspacePicker, setShowWorkspacePicker] = useState(false);
  // Workspace-switch transition: the target key being switched to, and the
  // animation phase ("loading" = centered card + spinner, "out" = shrink to 0).
  const [transitioningTo, setTransitioningTo] = useState(null);
  const [wsCurtain, setWsCurtain] = useState(false);
  const [transitionPhase, setTransitionPhase] = useState(null);

  // --- App state ---
  const [currentView, setCurrentView] = useState("dashboard");
  const [userRole, setUserRole] = useState("Admin");
  const [actualRole, setActualRole] = useState("Admin");
  const [userName, setUserName] = useState("");
  const [isMainAdmin, setIsMainAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  // Keeps the branded loading video on screen for a minimum beat even when data
  // resolves instantly (init true on auto-login so the video shows on refresh).
  const [splashActive, setSplashActive] = useState(() => localStorage.getItem("wf_authenticated") === "true");
  const [userAvatar, setUserAvatar] = useState("");
  const [modalTaskId, setModalTaskId] = useState(null);
  const [modalOriginRect, setModalOriginRect] = useState(null); // card rect the modal morphs from (GSAP)
  const [modalSeedTask, setModalSeedTask] = useState(null); // board's light task — lets the modal paint instantly
  const [modalEditMode, setModalEditMode] = useState(false);
  const [modalOpenNotes, setModalOpenNotes] = useState(false);
  const [notesModalTaskId, setNotesModalTaskId] = useState(null);
  const [showAI, setShowAI] = useState(false);
  const [caddyOn, setCaddyOn] = useState(isCaddyEnabled());
  const [caddyHint, setCaddyHint] = useState(null);
  const caddyHintIdx = useRef(0);

  // React live when Caddy is toggled on/off in Settings.
  useEffect(() => {
    const onChange = () => setCaddyOn(isCaddyEnabled());
    window.addEventListener("caddy-enabled-changed", onChange);
    return () => window.removeEventListener("caddy-enabled-changed", onChange);
  }, []);

  // Periodically nudge the user with a Caddy tip when the panel is closed.
  useEffect(() => {
    if (showAI || !caddyOn) { setCaddyHint(null); return; }
    const HINTS = [
      "Hi, I'm Caddy 👋 Ask me for a project's updates.",
      "Need a task logged? Just tell me about it.",
      terms.tech ? "I can jot ideas to the notebook or file a bug for you." : "I can jot ideas to the notebook or flag a roadblock for you.",
      "Try: “What's the latest project with updates?”",
    ];
    let hideTimer;
    const show = () => {
      setCaddyHint(HINTS[caddyHintIdx.current % HINTS.length]);
      caddyHintIdx.current += 1;
      hideTimer = window.setTimeout(() => setCaddyHint(null), 9000);
    };
    const first = window.setTimeout(show, 7000);
    const interval = window.setInterval(show, 85000);
    return () => { window.clearTimeout(first); window.clearTimeout(hideTimer); window.clearInterval(interval); };
  }, [showAI, caddyOn, activeWorkspace]);
  const [contextMenu, setContextMenu] = useState({ visible: false, x: 0, y: 0, task: null });
  const [showSettings, setShowSettings] = useState(false);
  const [showHandbook, setShowHandbook] = useState(false);
  const [viewingStaff, setViewingStaff] = useState(null);
  // When set, the Kanban board is filtered to this person's projects (chosen from search)
  const [kanbanFilterStaff, setKanbanFilterStaff] = useState(null);
  // A brief Caddy handed to the New Task planner ({ brief, nonce }); cleared once used.
  const [plannerSeed, setPlannerSeed] = useState(null);

  const [showLoginNotifications, setShowLoginNotifications] = useState(false);
  const [showAllProjects, setShowAllProjects] = useState(false);
  const [showRoleSwitcherPopup, setShowRoleSwitcherPopup] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [showUserProjectsModal, setShowUserProjectsModal] = useState(false);
  const [activeProjectsTab, setActiveProjectsTab] = useState("overview");
  const [modalConfig, setModalConfig] = useState({
    isOpen: false,
    title: "",
    message: "",
    type: "alert",
    onConfirm: () => { },
    onCancel: () => { },
  });
  const [inputModal, setInputModal] = useState({
    isOpen: false,
    title: "",
    message: "",
    fields: [],
    onConfirm: () => { },
  });

  // --- Data (Supabase, live) ---
  const [staff, setStaff] = useState([]);
  // Header search + modals read the active workspace's tasks.
  const tasks = useQuery(api.tasks.getTasksLight, { workspace: activeWorkspace || DEFAULT_WORKSPACE });
  // Where the last click/tap happened — profile cards grow out of that point.
  const lastPointer = useRef(null);
  useEffect(() => {
    const onDown = (e) => { lastPointer.current = { x: e.clientX, y: e.clientY }; };
    window.addEventListener("pointerdown", onDown, true);
    return () => window.removeEventListener("pointerdown", onDown, true);
  }, []);
  const profileRef = useRef(null);
  const profileFrom = useRef(null);
  const profileOpen = !!viewingStaff;
  useLayoutEffect(() => {
    const card = profileRef.current;
    if (!profileOpen || !card || window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) return;
    const r = card.getBoundingClientRect();
    const p = lastPointer.current || { x: r.left + r.width / 2, y: r.top - 40 };
    const dx = p.x - (r.left + r.width / 2), dy = p.y - (r.top + r.height / 2);
    profileFrom.current = { dx, dy };
    card.style.animation = "none"; // the generic CSS pop would fight this
    card.animate(
      [{ opacity: 0, transform: `translate(${dx}px, ${dy}px) scale(0.18)` }, { opacity: 1, transform: "none" }],
      { duration: 520, easing: "cubic-bezier(0.34, 1.4, 0.64, 1)" },
    );
    card.querySelector(".profile-popover-header")?.animate(
      [{ transform: "scale(1.18)" }, { transform: "none" }],
      { duration: 700, easing: "cubic-bezier(0.2, 0, 0, 1)" },
    );
    card.querySelector(".profile-popover-avatar-large")?.animate(
      [{ opacity: 0, transform: "scale(0.3) rotate(-12deg)" }, { opacity: 1, transform: "none" }],
      { duration: 560, delay: 110, easing: "cubic-bezier(0.34, 1.7, 0.64, 1)", fill: "backwards" },
    );
    const rows = card.querySelectorAll(".profile-popover-main > *, .profile-popover-body > :not(.profile-popover-main)");
    [...rows].slice(0, 10).forEach((el, i) =>
      el.animate(
        [{ opacity: 0, transform: "translateY(12px)" }, { opacity: 1, transform: "none" }],
        { duration: 380, delay: 170 + i * 45, easing: "cubic-bezier(0.2, 0, 0, 1)", fill: "backwards" },
      ));
  }, [profileOpen]);
  // Workspace picker (click the WORKFORCE HERMES title): the cards deal out of
  // the title, spinning into place, and fly back into it when it closes.
  const wsTitleRef = useRef(null);
  const wsPickerRef = useRef(null);
  const wsPickerClosing = useRef(false);
  const wsPickerOpenedAt = useRef(0);
  const wsCardPaths = () => {
    const root = wsPickerRef.current;
    const t = wsTitleRef.current?.getBoundingClientRect();
    const cards = root ? [...root.querySelectorAll(".workspace-select-card")] : [];
    const mid = (cards.length - 1) / 2;
    return cards.map((el, i) => {
      const r = el.getBoundingClientRect();
      const dx = t ? t.left + t.width / 2 - (r.left + r.width / 2) : 0;
      const dy = t ? t.top + t.height / 2 - (r.top + r.height / 2) : -window.innerHeight / 2;
      return { el, i, from: `translate(${dx}px, ${dy}px) scale(0.12) rotate(${(i - mid) * 12}deg)` };
    });
  };
  useLayoutEffect(() => {
    const root = wsPickerRef.current;
    if (!showWorkspacePicker || !root) return;
    wsPickerClosing.current = false;
    wsPickerOpenedAt.current = performance.now();
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) return;
    root.style.animation = "none"; // replaced by the motion below
    root.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 320, easing: "ease-out" });
    root.querySelector(".ws-picker-head")?.animate(
      [{ opacity: 0, transform: "translateY(-30px) scale(0.94)" }, { opacity: 1, transform: "none" }],
      { duration: 560, delay: 120, easing: "cubic-bezier(0.34, 1.4, 0.64, 1)", fill: "backwards" },
    );
    for (const { el, i, from } of wsCardPaths()) {
      el.animate(
        [{ opacity: 0, transform: from }, { opacity: 1, offset: 0.3 }, { opacity: 1, transform: "none" }],
        { duration: 760, delay: 60 + i * 85, easing: "cubic-bezier(0.34, 1.22, 0.64, 1)", fill: "backwards" },
      );
      el.querySelector(".workspace-card-icon")?.animate(
        [{ transform: "scale(0.4) rotate(-90deg)" }, { transform: "none" }],
        { duration: 700, delay: 260 + i * 85, easing: "cubic-bezier(0.34, 1.7, 0.64, 1)", fill: "backwards" },
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showWorkspacePicker]);
  function openWorkspacePicker() {
    if (myWorkspaces.length <= 1) return;
    wsTitleRef.current?.animate(
      [{ transform: "scale(1)" }, { transform: "scale(0.93)", offset: 0.35 }, { transform: "scale(1)" }],
      { duration: 360, easing: "cubic-bezier(0.34, 1.56, 0.64, 1)" },
    );
    setShowWorkspacePicker(true);
  }
  function closeWorkspacePicker() {
    const root = wsPickerRef.current;
    if (!root || wsPickerClosing.current || window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) { setShowWorkspacePicker(false); return; }
    wsPickerClosing.current = true;
    const paths = wsCardPaths();
    for (const { el, i, from } of paths) {
      el.animate(
        [{ opacity: 1, transform: getComputedStyle(el).transform === "none" ? "none" : getComputedStyle(el).transform }, { opacity: 0, transform: from }],
        { duration: 400, delay: (paths.length - 1 - i) * 50, easing: "cubic-bezier(0.55, 0, 0.75, 0.2)", fill: "forwards" },
      );
    }
    root.querySelector(".ws-picker-head")?.animate(
      [{ opacity: 1 }, { opacity: 0, transform: "translateY(-18px)" }],
      { duration: 220, easing: "ease-in", fill: "forwards" },
    );
    // The title "catches" the cards.
    wsTitleRef.current?.animate(
      [{ transform: "scale(1)" }, { transform: "scale(1.08)", offset: 0.5 }, { transform: "scale(1)" }],
      { duration: 380, delay: 300, easing: "cubic-bezier(0.34, 1.56, 0.64, 1)" },
    );
    const done = () => { wsPickerClosing.current = false; setShowWorkspacePicker(false); };
    root.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 260, delay: 240, easing: "ease-in", fill: "forwards" }).finished.then(done, done);
  }
  // Esc closes the picker (not mid-switch).
  useEffect(() => {
    if (!showWorkspacePicker || transitioningTo) return undefined;
    const onKey = (e) => { if (e.key === "Escape") closeWorkspacePicker(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showWorkspacePicker, transitioningTo]);

  const profileClosing = useRef(false);
  function closeProfile() {
    const card = profileRef.current;
    const from = profileFrom.current;
    if (!card || profileClosing.current || window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) { setViewingStaff(null); return; }
    profileClosing.current = true;
    const done = () => { profileClosing.current = false; setViewingStaff(null); };
    card.closest(".profile-popover-overlay")?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 220, easing: "ease-in", fill: "forwards" });
    card.animate(
      [{ opacity: 1, transform: "none" }, { opacity: 0, transform: from ? `translate(${from.dx * 0.6}px, ${from.dy * 0.6}px) scale(0.4)` : "scale(0.9)" }],
      { duration: 240, easing: "cubic-bezier(0.4, 0, 1, 1)", fill: "forwards" },
    ).finished.then(done, done);
  }

  // How this workspace names things (Workforce = the programming team's words).
  const terms = termsFor(activeWorkspace || DEFAULT_WORKSPACE);
  const convex = useConvex();

  // First-open warm-up: once the app is up and the browser is idle, render the
  // task modal ONCE, invisibly and without side effects (TaskModal
  // "rehearsal"). The very first real open otherwise pays the browser's
  // one-time costs — style/layout caches, text shaping, GPU shaders — as a
  // ~150ms hitch right on the click. Measured: after one rehearsal, the first
  // real open has no long frames at all.
  const [rehearsalTask, setRehearsalTask] = useState(null);
  const rehearsedRef = useRef(false);
  useEffect(() => {
    if (rehearsedRef.current || authStage !== "authenticated" || !tasks?.length) return;
    const t = window.setTimeout(() => {
      const go = () => {
        if (rehearsedRef.current) return;
        rehearsedRef.current = true;
        setRehearsalTask(tasks[0]);
      };
      if (window.requestIdleCallback) window.requestIdleCallback(go, { timeout: 2500 });
      else go();
    }, 1500);
    return () => window.clearTimeout(t);
  }, [tasks, authStage]);
  // Staff list (live — role/department changes show up without a reload).
  const liveStaff = useQuery(api.staff.getStaff);
  // Active workspace's config — read here to gate entry when a password is set.
  const activeWsConfig = useQuery(api.appConfig.getAppConfig, { workspace: activeWorkspace || DEFAULT_WORKSPACE });
  const verifyWorkspacePassword = useMutation(api.appConfig.verifyWorkspacePassword);

  useEffect(() => {
    if (Array.isArray(liveStaff)) setStaff(liveStaff);
  }, [liveStaff]);

  // The session is the source of truth for who you are: keep wf_email in sync
  // with it, and drop back to the login if it ends (expired / signed out).
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      const email = data.session?.user?.email?.toLowerCase();
      if (email && localStorage.getItem("wf_email") !== email) localStorage.setItem("wf_email", email);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT" && localStorage.getItem("wf_authenticated") === "true") logout();
    });
    return () => sub.subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addStaffMutation = useMutation(api.staff.addStaff);
  const setPasswordMutation = useMutation(api.staff.setPassword);
  const loginMutation = useMutation(api.staff.login);
  const deleteStaffMutation = useMutation(api.staff.deleteStaff);
  const deleteTask = useMutation(api.tasks.deleteTask);
  const updateTaskStatus = useMutation(api.tasks.updateTaskStatus);
  const updateProjectLink = useMutation(api.tasks.updateProjectLink);
  const updateAdminCredentials = useMutation(api.tasks.updateAdminCredentials);
  const updateTaskDetailsMut = useMutation(api.tasks.updateTaskDetails);
  const updateTaskLinksMut = useMutation(api.tasks.updateTaskLinks);
  const updateTaskDocumentsMut = useMutation(api.tasks.updateTaskDocuments);
  const setTaskDeadlineMut = useMutation(api.tasks.setTaskDeadline);

  const activeProfile = useMemo(() => {
    if (!viewingStaff) return null;
    return staff?.find(s => s.email.toLowerCase() === viewingStaff.email.toLowerCase()) || viewingStaff;
  }, [viewingStaff, staff]);

  // --- Resolve user once authenticated and staff loaded ---
  useEffect(() => {
    if (authStage !== "authenticated") {
      setLoading(false);
      return;
    }

    // Wait until the staff list has actually loaded. getStaff always returns at
    // least the seed users, so an empty list means "still loading" — resolving
    // now would misidentify the user and clobber their stored workspace choice.
    if (staff.length === 0) return;

    const email = localStorage.getItem("wf_email") || "";
    if (!email) {
      localStorage.removeItem("wf_authenticated");
      setAuthStage("login");
      setLoading(false);
      return;
    }

    const settings = loadSettings();
    const mainAdmin = email === "wmt@ececontactcenters.com";
    const user = staff.find((s) => (s.email || "").toLowerCase() === email);
    // Keep the main-admin flag authoritative on every resolve so it can never
    // leak to a different user later in the same browser session.
    setIsMainAdmin(mainAdmin);

    // --- Gate non-approved / unknown accounts BEFORE resolving a workspace ---
    if (!mainAdmin) {
      if (!user) {
        // Authenticated email is no longer in the staff list (deleted/unknown).
        logout();
        return;
      }
      if (user.role === "Revoked") {
        logout();
        return;
      }
      if (user.role === "Pending") {
        // Not yet approved — show Access Restricted (also blocks refresh bypass).
        setAuthStage("denied");
        setLoading(false);
        return;
      }
    }

    // --- Resolve accessible workspaces & the active workspace ---
    // Departments gate which workspaces a user can enter; the active workspace
    // scopes their data. Main Admin has implicit all-access.
    const depts = mainAdmin ? DEPARTMENTS : (user?.departments || []);
    setUserDepartments(depts);
    const accessible = accessibleWorkspaces(depts, email);

    // A non-admin with NO department has no workspace access — fail closed
    // (do NOT default to workforce) and show Access Restricted.
    if (!mainAdmin && accessible.length === 0) {
      setAuthStage("denied");
      setLoading(false);
      return;
    }

    const storedWs = localStorage.getItem("wf_workspace");
    let resolvedWs = null;
    if (storedWs && accessible.includes(storedWs)) resolvedWs = storedWs;
    else if (accessible.length === 1) resolvedWs = accessible[0];

    if (!resolvedWs) {
      // 2+ options and none chosen yet — show the picker.
      setAuthStage("select-workspace");
      setLoading(false);
      return;
    }
    setActiveWorkspace(resolvedWs);
    localStorage.setItem("wf_workspace", resolvedWs);

    // --- Apply default view from settings ---
    const viewMap = { "Dashboard": "dashboard", "Projects": "kanban", "Activity Feed": "entry", "Notebook": "notebook" };
    const mappedView = viewMap[settings.defaultView] || "dashboard";

    if (mainAdmin) {
      setUserName(user?.name || "Main Admin");
      setUserAvatar(user?.avatarUrl || "");
      const dbRole = user?.role || "Admin";
      setActualRole(dbRole);
      setUserRole(defaultViewRole(dbRole));
      if (!hasSetInitialView.current) {
        setCurrentView(mappedView);
        hasSetInitialView.current = true;
      }
      setLoading(false);
      return;
    }

    // --- Normal approved user ---
    setUserName(user.name || "User");
    setUserAvatar(user.avatarUrl || "");
    setActualRole(user.role);
    // Admin+ and Manager see the Admin view by default (they have all Admin privileges)
    setUserRole(defaultViewRole(user.role));
    if (!hasSetInitialView.current) {
      if (user.role === "Programmer") setCurrentView("kanban");
      else setCurrentView(mappedView);
      hasSetInitialView.current = true;
    }
    setLoading(false);
  }, [staff, authStage, showSettings]);

  // --- Initialize notifications on authentication ---
  useEffect(() => {
    if (authStage !== "authenticated") return;

    initNotifications();

    return () => {
    };
  }, [authStage]);

  // --- Apply saved settings on mount ---
  useEffect(() => {
    applySettings();
  }, []);

  // Show the loading video for at least SPLASH_MIN_MS, then let it clear.
  function startSplash() {
    setSplashActive(true);
    if (splashTimerRef.current) clearTimeout(splashTimerRef.current);
    splashTimerRef.current = setTimeout(() => setSplashActive(false), SPLASH_MIN_MS);
  }

  // On mount (auto-login) the splash is already active — start its timer.
  useEffect(() => {
    if (splashActive) {
      if (splashTimerRef.current) clearTimeout(splashTimerRef.current);
      splashTimerRef.current = setTimeout(() => setSplashActive(false), SPLASH_MIN_MS);
    }
    return () => { if (splashTimerRef.current) clearTimeout(splashTimerRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Body scroll lock (Unified) ---
  useEffect(() => {
    const isModalOpen = !!modalTaskId || modalConfig.isOpen || inputModal.isOpen || showHandbook;
    const authRestricted = authStage !== "authenticated";

    if (isModalOpen || authRestricted) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }

    return () => { document.body.style.overflow = ""; };
  }, [authStage, modalTaskId, modalConfig.isOpen, inputModal.isOpen, showHandbook]);

  // --- Role class on body ---
  useEffect(() => {
    document.body.classList.remove("role-admin", "role-programmer", "role-admin+");
    document.body.classList.add("role-" + userRole.toLowerCase().replace("+", "plus"));
  }, [userRole]);

  // --- Active-workspace attribute on body (drives per-workspace theming,
  //     e.g. the Executives gold accents in index.css) ---
  useEffect(() => {
    if (activeWorkspace) document.body.setAttribute("data-workspace", activeWorkspace);
    else document.body.removeAttribute("data-workspace");
    return () => document.body.removeAttribute("data-workspace");
  }, [activeWorkspace]);

  // --- Context menu close ---
  useEffect(() => {
    const handler = () => setContextMenu((prev) => ({ ...prev, visible: false }));
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, []);

  // Fires the "Session Expired" prompt exactly once (guarded by a ref so the
  // periodic check, the deferred check and tab-focus checks can't stack it).
  function triggerSessionExpired(reason) {
    if (sessionExpiredRef.current) return;
    sessionExpiredRef.current = true;
    console.warn("Session expired — " + reason);
    showModal({
      title: "Session Expired",
      message: "You've been inactive for a while, so your session has expired. Please log in again.",
      type: "alert",
      onConfirm: () => { logout(); },
    });
  }

  // True only when the stored last-activity timestamp is older than the window.
  // A missing/zero timestamp is treated as "active now" (never a false expiry).
  function isSessionExpired() {
    const lastActivity = parseInt(localStorage.getItem("wf_last_activity") || "0", 10);
    if (!lastActivity) return false;
    return Date.now() - lastActivity > SESSION_EXPIRY_MS;
  }

  // --- Session Inactivity Tracker ---
  useEffect(() => {
    if (authStage !== "authenticated") return;

    // A fresh authenticated session is, by definition, active right now.
    sessionExpiredRef.current = false;
    if (!localStorage.getItem("wf_last_activity")) {
      localStorage.setItem("wf_last_activity", Date.now().toString());
    }

    // Throttled activity stamp — at most once per ACTIVITY_WRITE_THROTTLE_MS.
    let lastWrite = 0;
    const updateActivity = () => {
      const now = Date.now();
      if (now - lastWrite < ACTIVITY_WRITE_THROTTLE_MS) return;
      lastWrite = now;
      localStorage.setItem("wf_last_activity", now.toString());
    };
    ACTIVITY_EVENTS.forEach((event) => document.addEventListener(event, updateActivity, { passive: true }));

    // Re-check whenever the tab regains focus/visibility (catches laptops that
    // were asleep without the interval running) — and on a 60s heartbeat.
    const checkSession = () => { if (isSessionExpired()) triggerSessionExpired("inactivity check"); };
    const onVisible = () => { if (document.visibilityState === "visible") checkSession(); };

    const interval = setInterval(checkSession, 60 * 1000);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", checkSession);

    return () => {
      ACTIVITY_EVENTS.forEach((event) => document.removeEventListener(event, updateActivity));
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", checkSession);
    };
  }, [authStage]);

  // --- Deferred session expiry check: only runs once the app is fully visible ---
  useEffect(() => {
    if (authStage !== "authenticated" || loading) return;
    if (isSessionExpired()) triggerSessionExpired("deferred check (app now visible)");
  }, [authStage, loading]);

  // -------------------------------------------------------
  // Login handler — this is called when the user submits
  // the login form with their email and password.
  // -------------------------------------------------------
  async function handleLogin(email, password) {
    setLoginError("");
    const lowerEmail = email.toLowerCase();

    // Must wait for staff to be loaded
    if (staff === undefined) {
      setLoginError("System is still loading. Please wait a moment and try again.");
      return;
    }

    try {
      const result = await loginMutation({ email: lowerEmail, password });

      if (!result.success) {
        setLoginError(result.error || "Login failed.");
        return;
      }

      // Server validated credentials — handle the stage
      if (result.stage === "denied") {
        localStorage.setItem("wf_authenticated", "true");
        localStorage.setItem("wf_email", lowerEmail);
        setAuthStage("denied");
        return;
      }

      if (result.stage === "set-password") {
        setPendingEmail(lowerEmail);
        setAuthStage("set-password");
        return;
      }

      if (result.stage === "authenticated") {
        localStorage.setItem("wf_authenticated", "true");
        localStorage.setItem("wf_email", lowerEmail);
        localStorage.setItem("wf_last_activity", Date.now().toString());

        // New: If no security question AND user hasn't been prompted before, redirect to setup
        const alreadyPrompted = localStorage.getItem(`wf_sq_prompted_${lowerEmail}`);
        if (!result.hasSecurityQuestion && !alreadyPrompted) {
          setPendingEmail(lowerEmail);
          setAuthStage("set-security-question");
          return;
        }

        setLoading(true);
        startSplash();
        setAuthStage("authenticated");
        // Trigger notification popup for programmers after login
        if (result.role === "Programmer") {
          setShowLoginNotifications(true);
        }
      }
    } catch (err) {
      setLoginError("Login failed. Please try again.");
    }
  }

  // -------------------------------------------------------
  // Set-password handler (legacy — used when onSet is passed)
  // -------------------------------------------------------
  async function handleSetPassword(newPassword) {
    await setPasswordMutation({ email: pendingEmail, password: newPassword });
    localStorage.setItem("wf_authenticated", "true");
    localStorage.setItem("wf_email", pendingEmail);
    setLoading(true);
    startSplash();
    setAuthStage("authenticated");
  }

  // -------------------------------------------------------
  // New user setup complete (password + security question done)
  // Routes back to login so they can authenticate normally.
  // -------------------------------------------------------
  function handleSetupComplete() {
    signOut(); // end the setup session; they sign in with the new password
    setPendingEmail("");
    setAuthStage("login");
    setLoginError("");
  }

  function logout() {
    signOut();
    localStorage.removeItem("wf_authenticated");
    localStorage.removeItem("wf_email");
    localStorage.removeItem("wf_last_activity");
    localStorage.removeItem("wf_workspace");
    clearWorkspaceUnlocks();
    sessionExpiredRef.current = false;
    setAuthStage("login");
    setLoading(true);
    setUserName("");
    setActualRole("Admin");
    setUserRole("Admin");
    setCurrentView("dashboard");
    setActiveWorkspace(null);
    setUserDepartments([]);
    setIsMainAdmin(false);
    setSplashActive(false);
    if (splashTimerRef.current) clearTimeout(splashTimerRef.current);
    hasSetInitialView.current = false;
    setKanbanFilterStaff(null);
  }

  // Chosen from the post-login WorkspaceSelect gate: enter the app with the
  // intro playing once.
  function handleSelectWorkspace(key) {
    localStorage.setItem("wf_workspace", key);
    setActiveWorkspace(key);
    hasSetInitialView.current = false;
    setLoading(true);
    startSplash();
    setAuthStage("authenticated");
  }

  // Commit the switch: swap the active workspace (queries re-fire via
  // WorkspaceContext) and tear down the picker/transition state.
  function commitWorkspaceSwitch(key) {
    localStorage.setItem("wf_workspace", key);
    setActiveWorkspace(key);
    setKanbanFilterStaff(null);
    setShowWorkspacePicker(false);
    setTransitioningTo(null);
    setTransitionPhase(null);
  }

  // From the in-app picker: play the transition (others blur, selected centers
  // and shows "Loading workspace…", then shrinks to zero) before committing.
  function beginWorkspaceTransition(key) {
    if (transitioningTo) return; // a transition is already running
    if (key === activeWorkspace) { closeWorkspacePicker(); return; }
    setTransitioningTo(key);
    setTransitionPhase("loading");
    setTimeout(() => setTransitionPhase("out"), 1050); // hold, then the card swells over the screen
    setTimeout(() => {
      commitWorkspaceSwitch(key); // switch under the cover…
      setWsCurtain(true); // …then a matching curtain fades away to reveal it
      setTimeout(() => setWsCurtain(false), 700);
    }, 1560);
  }

  function changeRole(role) {
    setUserRole(role);
    if (role === "Programmer") setCurrentView("kanban");
    if (role === "Admin" || role === "Admin+") setCurrentView("dashboard");
  }

  function switchView(viewId) {
    const adminViews = ["admin", "dashboard", "announcements"];
    if (userRole === "Programmer" && adminViews.includes(viewId)) return;
    setCurrentView(viewId);
  }

  function openTaskModal(taskId, editMode = false, openNotes = false, originRect = null, seedTask = null) {
    setModalOriginRect(originRect);
    setModalSeedTask(seedTask && seedTask._id === taskId ? seedTask : null);
    setModalTaskId(taskId);
    setModalEditMode(editMode);
    setModalOpenNotes(openNotes);
  }

  function closeTaskModal() {
    setModalTaskId(null);
    setModalEditMode(false);
    setModalOpenNotes(false);
    setModalOriginRect(null);
    setModalSeedTask(null);
  }

  // Opens ONLY the notes modal (no full task modal behind it)
  function openNotesModal(taskId) {
    setNotesModalTaskId(taskId);
  }

  // What Caddy can do on screen. Each closes the chat panel so the result is
  // visible; returns a small result object for the model.
  const caddyUiActions = {
    openProject: (taskId) => {
      setShowAI(false);
      openTaskModal(taskId);
    },
    planNewTask: (brief) => {
      setShowAI(false);
      setPlannerSeed({ brief, nonce: Date.now() });
      switchView("entry");
    },
    goTo: (place) => {
      const adminOnly = { overview: "dashboard", announcements: "announcements" };
      const views = { board: "kanban", new_task: "entry", notebook: "notebook", ...adminOnly };
      if (place === "overview" && userRole === "Programmer") return { error: "The Overview is only in the Admin view." };
      if (place === "announcements" && !isAdminPlusOrAbove(actualRole)) return { error: "Announcements are for Admin+ and Managers only." };
      if (views[place]) { setShowAI(false); switchView(views[place]); return { done: true, place }; }
      if (place === "handbook") { setShowAI(false); setShowHandbook(true); return { done: true, place }; }
      if (place === "settings") { setShowAI(false); setShowSettings(true); return { done: true, place }; }
      if (place === "project_links") { setShowAI(false); setShowAllProjects(true); return { done: true, place }; }
      return { error: `Unknown place "${place}".` };
    },
  };

  function handleContextMenu(e, task) {
    e.preventDefault();
    // Keep the right-clicked card as the morph origin — "Edit" opens the
    // task modal out of that card, same as a left-click would.
    setContextMenu({ visible: true, x: e.pageX, y: e.pageY, task, origin: morphOriginFrom(e.currentTarget) });
  }

  /**
   * Shows a custom alert or confirmation modal.
   * @param {Object} options { title, message, type, onConfirm, onCancel }
   */
  function showModal({ title, message, type = "alert", onConfirm, onCancel }) {
    setModalConfig({
      isOpen: true,
      title,
      message,
      type,
      onConfirm: () => {
        if (onConfirm) onConfirm();
        setModalConfig((prev) => ({ ...prev, isOpen: false }));
      },
      onCancel: () => {
        if (onCancel) onCancel();
        else if (type === "alert" && onConfirm) onConfirm();
        setModalConfig((prev) => ({ ...prev, isOpen: false }));
      },
    });
  }

  function showInputModal({ title, message, fields, onConfirm }) {
    setInputModal({
      isOpen: true,
      title,
      message,
      fields,
      onConfirm: (data) => {
        onConfirm(data);
        setInputModal(prev => ({ ...prev, isOpen: false }));
      }
    });
  }

  // -------------------------------------------------------
  // Render stages
  // -------------------------------------------------------
  if (authStage === "login") {
    return <Login
      onLogin={handleLogin}
      externalError={loginError}
      onResetSuccess={(email) => { setPendingEmail(email); setAuthStage("set-password"); }}
      onNewUserSetup={(email) => { setPendingEmail(email); setAuthStage("set-password"); }}
    />;
  }

  if (authStage === "set-password") {
    return <SetPassword email={pendingEmail} onSet={handleSetPassword} onComplete={handleSetupComplete} />;
  }

  if (authStage === "set-security-question") {
    return (
      <SetPassword 
        email={pendingEmail} 
        mode="security-only" 
        onComplete={() => {
          // Mark as prompted so we don't ask again on future logins
          localStorage.setItem(`wf_sq_prompted_${pendingEmail.toLowerCase()}`, "true");
          setLoading(true);
          startSplash();
          setAuthStage("authenticated");
        }} 
      />
    );
  }

  if (authStage === "denied") {
    return (
      <div className="login-container">
        <div className="header-box" style={{ marginBottom: 30 }}>
          <img src="https://i.imgur.com/BRd5lrB.png" alt="ECE Logo" className="header-logo" />
          <div className="header-text-content">
            <h1>WORKFORCE HERMES</h1>
            <p>ECE Project Database · Workforce · Operations · Executives</p>
          </div>
          <img src="https://i.imgur.com/ycmU6oP.png" alt="WFM Logo" className="header-logo" />
        </div>
        <div style={{ background: "white", padding: 40, borderRadius: 24, boxShadow: "0 10px 25px rgba(0,0,0,0.1)", maxWidth: 420, textAlign: "center" }}>
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" strokeWidth="2" style={{ marginBottom: 20 }}>
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <h2 style={{ color: "var(--color-text-primary)", marginBottom: 10 }}>Access Restricted</h2>
          <p style={{ color: "#64748b", lineHeight: 1.6 }}>
            {staff?.find(s => s.email.toLowerCase() === localStorage.getItem("wf_email")?.toLowerCase())?.role === "Revoked"
              ? "Your access has been revoked. Please contact an administrator if you believe this is an error."
              : "Your email has been registered. Please wait for an administrator to approve your access."}
          </p>
          <p style={{ marginTop: 15, fontWeight: 700, color: "#4355f1", fontSize: "0.85rem" }}>
            {localStorage.getItem("wf_email")}
          </p>
          <button
            className="btn-secondary"
            style={{ marginTop: 25, padding: "10px 24px", background: "var(--color-logout)" }}
            onClick={logout}
          >
            Back to Login
          </button>
        </div>
      </div>
    );
  }

  if (authStage === "select-workspace") {
    const email = localStorage.getItem("wf_email") || "";
    const accessible = accessibleWorkspaces(userDepartments, email);
    const list = accessible.length ? accessible : [DEFAULT_WORKSPACE];
    return (
      <WorkspaceSelect
        workspaces={list}
        userName={userName}
        onSelect={handleSelectWorkspace}
        onLogout={logout}
      />
    );
  }

  if (loading || splashActive) {
    return (
      <div className="brand-loading">
        <video
          className="brand-loading-video"
          src="/logo%20animation.mp4"
          autoPlay
          muted
          loop
          playsInline
        />
        <div className="brand-loading-text">Loading…</div>
      </div>
    );
  }

  // --- Workspace entry password gate ---------------------------------------
  // If the active workspace has a password and the user hasn't unlocked it this
  // session, hold the app behind a password screen. Main Admin bypasses. Wait
  // for the config query to resolve first so the app doesn't flash.
  if (authStage === "authenticated" && activeWorkspace && !isMainAdmin) {
    if (activeWsConfig === undefined) {
      return (
        <div className="brand-loading">
          <video className="brand-loading-video" src="/logo%20animation.mp4" autoPlay muted loop playsInline />
          <div className="brand-loading-text">Loading…</div>
        </div>
      );
    }
    if (workspaceNeedsPassword({ passwordHash: activeWsConfig?.workspacePasswordHash, workspace: activeWorkspace, isMainAdmin })) {
      return (
        <WorkspacePasswordGate
          workspace={activeWorkspace}
          onSubmit={async (pw) => {
            // Checked server-side — the hash never reaches the browser.
            const ok = await verifyWorkspacePassword({ workspace: activeWorkspace, passwordHash: await hashPassword(pw) }).catch(() => false);
            if (ok) {
              markWorkspaceUnlocked(activeWorkspace);
              setWsUnlockBump((n) => n + 1);
              return true;
            }
            return false;
          }}
          onBack={() => {
            setActiveWorkspace(null);
            localStorage.removeItem("wf_workspace");
            setAuthStage("select-workspace");
          }}
        />
      );
    }
  }

  // -------------------------------------------------------
  // Main app
  // -------------------------------------------------------
  // Workspaces this user may switch between (drives the header switcher).
  const myWorkspaces = accessibleWorkspaces(userDepartments, localStorage.getItem("wf_email") || "");
  return (
    <WorkspaceContext.Provider value={activeWorkspace || DEFAULT_WORKSPACE}>
      {/* Header */}
      <header>
        <div className="header-container">
          <div className="user-profile" style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: "12px", width: "auto", minWidth: 200, flexShrink: 0, marginRight: 16 }}>
            <div 
              className="header-avatar-container"
              onClick={() => {
                const settings = loadSettings();
                const user = staff?.find(s => s.email.toLowerCase() === (localStorage.getItem("wf_email") || "").toLowerCase());
                setViewingStaff(user || {
                  name: userName,
                  email: localStorage.getItem("wf_email"),
                  role: actualRole,
                  avatarUrl: userAvatar,
                  bio: settings.bio,
                  country: settings.country,
                  status: settings.status
                });
              }}
              style={{ cursor: "pointer", position: "relative" }}
            >
              {userAvatar ? (
                <img src={userAvatar} alt="Profile" style={{ width: 40, height: 40, borderRadius: "50%", objectFit: "cover", border: "2px solid var(--color-accent)" }} />
              ) : (
                <div style={{ width: 40, height: 40, borderRadius: "50%", background: "var(--color-bg-primary)", display: "flex", alignItems: "center", justifyContent: "center", border: "2px solid var(--color-accent)" }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
                </div>
              )}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "2px", alignItems: "flex-start" }}>
              <div style={{ fontSize: "0.85rem", fontWeight: 900, color: "var(--color-text-primary)" }}>{userName}</div>
              <div style={{ display: "flex", alignItems: "center", gap: "6px", position: "relative" }}>
                <div
                  className={`role-badge ${actualRole === "Manager" ? "role-badge--manager" : ""}`}
                  style={{
                    padding: "2px 8px",
                    borderRadius: "6px",
                    fontSize: "0.6rem",
                    letterSpacing: "0.5px",
                    cursor: (!isMainAdmin && isAdminLevel(actualRole)) ? "pointer" : "default",
                    display: "flex",
                    alignItems: "center"
                  }}
                  onClick={() => {
                    if (!isMainAdmin && isAdminLevel(actualRole)) {
                      setShowRoleSwitcherPopup(!showRoleSwitcherPopup);
                    }
                  }}
                  title={(!isMainAdmin && isAdminLevel(actualRole)) ? "Click to switch view" : ""}
                >
                  {roleLabel(roleBadgeLabel(actualRole, userRole), activeWorkspace)}
                  {(!isMainAdmin && isAdminLevel(actualRole)) && (
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" style={{ marginLeft: 4 }}><path d="M6 9l6 6 6-6"/></svg>
                  )}
                </div>
                
                {showRoleSwitcherPopup && (
                  <>
                    <div 
                      style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, zIndex: 90 }} 
                      onClick={() => setShowRoleSwitcherPopup(false)} 
                    />
                    <div style={{ position: "absolute", top: "100%", left: 0, marginTop: "6px", background: "var(--color-bg-primary)", border: "1px solid var(--glass-border)", borderRadius: "8px", boxShadow: "var(--shadow-md)", zIndex: 100, minWidth: "140px", overflow: "hidden", display: "flex", flexDirection: "column" }}>
                      <div 
                        style={{ padding: "8px 12px", fontSize: "0.75rem", cursor: "pointer", background: userRole === "Admin" ? "var(--color-bg-subtle)" : "transparent", color: userRole === "Admin" ? "var(--color-accent)" : "var(--color-text-primary)", fontWeight: userRole === "Admin" ? 800 : 500, transition: "background 0.2s" }}
                        onClick={() => { changeRole("Admin"); setShowRoleSwitcherPopup(false); }}
                        onMouseEnter={(e) => { if(userRole !== "Admin") e.currentTarget.style.background = "var(--glass-bg)" }}
                        onMouseLeave={(e) => { if(userRole !== "Admin") e.currentTarget.style.background = "transparent" }}
                      >
                        Admin View
                      </div>
                      <div 
                        style={{ padding: "8px 12px", fontSize: "0.75rem", cursor: "pointer", background: userRole === "Programmer" ? "var(--color-bg-subtle)" : "transparent", color: userRole === "Programmer" ? "var(--color-accent)" : "var(--color-text-primary)", fontWeight: userRole === "Programmer" ? 800 : 500, transition: "background 0.2s" }}
                        onClick={() => { changeRole("Programmer"); setShowRoleSwitcherPopup(false); }}
                        onMouseEnter={(e) => { if(userRole !== "Programmer") e.currentTarget.style.background = "var(--glass-bg)" }}
                        onMouseLeave={(e) => { if(userRole !== "Programmer") e.currentTarget.style.background = "transparent" }}
                      >
                        {terms.memberRole} View
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
            <NotificationBell
              userEmail={localStorage.getItem("wf_email") || ""}
              onOpenTask={(taskId, origin) => openTaskModal(taskId, false, false, origin || null)}
            />
            <HeaderSearch
              staff={staff}
              tasks={tasks}
              onQueryChange={setSearchQuery}
              onPickStaff={(st) => { setKanbanFilterStaff(st); switchView("kanban"); }}
              onPickTask={(t, origin) => openTaskModal(t._id, false, false, origin, t)}
            />
            <button
              className="btn-settings-header"
              onClick={() => setShowSettings(true)}
              title="Settings"
              style={{ padding: "8px", borderRadius: "50%", marginLeft: "0px" }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1-2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            </button>
          </div>
          <div className="header-box" style={{ maxWidth: 1280, padding: "12px 40px", gap: 28, borderRadius: "20px", border: "1px solid var(--glass-border)", background: "var(--glass-bg)", boxShadow: "var(--shadow-md)" }}>
            <img src="https://i.imgur.com/BRd5lrB.png" alt="ECE Logo" className="header-logo" style={{ height: "45px" }} />
            <div
              ref={wsTitleRef}
              className={`header-text-content${myWorkspaces.length > 1 ? " can-switch" : ""}`}
              style={{ whiteSpace: "nowrap", cursor: myWorkspaces.length > 1 ? "pointer" : "default" }}
              onClick={openWorkspacePicker}
              title={myWorkspaces.length > 1 ? "Switch workspace" : ""}
            >
              <h1 style={{ fontSize: "1.6rem", letterSpacing: "-1.2px" }}>WORKFORCE HERMES</h1>
              <p style={{ fontSize: "0.75rem", letterSpacing: "0.8px", color: "var(--color-text-secondary)", fontWeight: 700 }}>{terms.appSubtitle}</p>
            </div>
            <img src="https://i.imgur.com/ycmU6oP.png" alt="WFM Logo" className="header-logo" style={{ height: "45px" }} />
            <div style={{ width: "1px", height: "30px", background: "var(--glass-border)", margin: "0 10px" }}></div>
            <button
              className="btn-project-consolidation"
              onClick={() => setShowHandbook(true)}
              data-handbook-launcher
              title={`Open the ${terms.handbookTitle}`}
              style={{
                padding: "8px 16px",
                borderRadius: "12px",
                border: "1px solid var(--color-brand-text)",
                background: "var(--color-card-bg)",
                color: "var(--color-brand-text)",
                fontSize: "0.7rem",
                fontWeight: 900,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "8px",
                marginRight: "10px",
                boxShadow: "0 4px 12px rgba(0,0,0,0.06)"
              }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
              </svg>
              HANDBOOK
            </button>
            <button
              className="btn-project-consolidation"
              onClick={() => setShowAllProjects(true)}
              title={`View all ${terms.projectLinks.toLowerCase()}`}
              style={{ 
                padding: "8px 16px", 
                borderRadius: "12px", 
                border: "1px solid var(--color-accent)", 
                background: "linear-gradient(135deg, var(--color-accent), var(--color-nav-bg))",
                color: "white",
                fontSize: "0.7rem",
                fontWeight: 900,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "8px",
                boxShadow: "0 4px 12px rgba(0,0,0,0.1)"
              }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5">
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
              </svg>
              {terms.projectLinks.toUpperCase()}
            </button>
          </div>
        </div>

        <div className="nav-bar" style={{ padding: "12px 0 20px 0" }}>
          <div className="nav-label" style={{ marginBottom: "12px", fontSize: "0.65rem", letterSpacing: "3px", opacity: 0.6 }}>NAVIGATION &amp; QUICK ACTIONS</div>
          <div className="nav-links">
            {(userRole === "Admin" || userRole === "Admin+") && (
              <div
                className={`nav-btn ${currentView === "dashboard" ? "active" : ""}`}
                onClick={() => switchView("dashboard")}
              >
                OVERVIEW
              </div>
            )}
            <div
              className={`nav-btn ${currentView === "kanban" ? "active" : ""}`}
              onClick={() => switchView("kanban")}
            >
              DASHBOARD
            </div>
            <div
              className={`nav-btn highlight ${currentView === "entry" ? "active" : ""}`}
              onClick={() => switchView("entry")}
            >
              NEW TASK
            </div>
            <div
              className={`nav-btn ${currentView === "notebook" ? "active" : ""}`}
              onClick={() => switchView("notebook")}
            >
              NOTEBOOK
            </div>

            {isAdminPlusOrAbove(actualRole) && (
              <div
                className={`nav-btn ${currentView === "announcements" ? "active" : ""}`}
                onClick={() => switchView("announcements")}
                style={{ display: "flex", alignItems: "center", gap: 5 }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                  <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                </svg>
                ANNOUNCEMENTS
              </div>
            )}

          </div>
        </div>
      </header>

      {/* Views — keyed stage so switching views replays the entrance choreography */}
      <main className="view-stage" key={currentView}>
        {currentView === "dashboard" && (
          <Dashboard
            onShowAllLinks={() => setShowAllProjects(true)}
            actualRole={actualRole}
            userName={userName}
            openTaskModal={openTaskModal}
          />
        )}
        {currentView === "kanban" && (
          <KanbanBoard
            userRole={userRole}
            actualRole={actualRole}
            userName={userName}
            openTaskModal={openTaskModal}
            openNotesModal={openNotesModal}
            onContextMenu={handleContextMenu}
            showModal={showModal}
            staff={staff || []}
            searchQuery={searchQuery}
            filterStaff={kanbanFilterStaff}
            onOpenProfile={() => kanbanFilterStaff && setViewingStaff(kanbanFilterStaff)}
            onClearFilter={() => setKanbanFilterStaff(null)}
          />
        )}
        {currentView === "entry" && (
          <TaskEntry
            staff={staff || []}
            userRole={userRole}
            actualRole={actualRole}
            userName={userName}
            onCreated={() => switchView("kanban")}
            showModal={showModal}
            plannerSeed={plannerSeed}
            onPlannerSeedUsed={() => setPlannerSeed(null)}
          />
        )}
        {currentView === "notebook" && (
          <Notebook userRole={userRole} userName={userName} showModal={showModal} />
        )}
        {currentView === "announcements" && isAdminPlusOrAbove(actualRole) && (
          <AnnouncementComposer userName={userName} showModal={showModal} />
        )}
      </main>

      {/* Robotic hand that reaches for the cursor on the nav buttons */}
      <RoboHand />
      {/* The screen-as-camera that keeps aiming at the cursor */}
      <CameraFollow />

      {/* The one-time invisible warm-up (see rehearsalTask above). */}
      {rehearsalTask && !modalTaskId && (
        <TaskModal
          rehearsal
          taskId={rehearsalTask._id}
          seedTask={rehearsalTask}
          userRole={userRole}
          actualRole={actualRole}
          userName={userName}
          staff={staff || []}
          onClose={() => {}}
          onRehearsed={() => setRehearsalTask(null)}
          showModal={showModal}
          showInputModal={showInputModal}
          onViewProfile={() => {}}
        />
      )}

      {/* Task Modal */}
      {modalTaskId && (
        <TaskModal
          taskId={modalTaskId}
          originRect={modalOriginRect}
          seedTask={modalSeedTask}
          isEditMode={modalEditMode}
          initialNotesOpen={modalOpenNotes}
          userRole={userRole}
          actualRole={actualRole}
          userName={userName}
          staff={staff || []}
          onClose={closeTaskModal}
          showModal={showModal}
          showInputModal={showInputModal}
          onViewProfile={(s) => setViewingStaff(s)}
        />
      )}

      {/* Notes-only modal (opened from a card's note wing) */}
      {notesModalTaskId && (
        <NotesModal
          taskId={notesModalTaskId}
          userName={userName}
          onClose={() => setNotesModalTaskId(null)}
          showModal={showModal}
        />
      )}

      {/* Hermes AI assistant (Caddy) — hidden entirely when disabled in Settings */}
      {caddyOn && !showAI && (
        <>
          {caddyHint && (
            <div className="ai-hint" onClick={() => { setShowAI(true); setCaddyHint(null); }}>
              <button className="ai-hint-x" title="Dismiss" onClick={(e) => { e.stopPropagation(); setCaddyHint(null); }}>×</button>
              <span className="ai-hint-orb" aria-hidden="true" />
              <span className="ai-hint-text">{caddyHint}</span>
            </div>
          )}
          <button className="ai-launcher" title="Caddy — ask Caduceus" onClick={() => setShowAI(true)}>
            <span className="ai-launcher-orb" aria-hidden="true" />
          </button>
          <span className="ai-launcher-pulse" aria-hidden="true" />
        </>
      )}
      {caddyOn && (
        <AIAssistant
          open={showAI}
          onClose={() => setShowAI(false)}
          userName={userName}
          userEmail={localStorage.getItem("wf_email") || ""}
          actualRole={actualRole}
          uiActions={caddyUiActions}
        />
      )}

      {/* Context Menu */}
      {contextMenu.visible && (
        <div
          className="context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <div
            className="context-menu-item"
            onClick={() => {
              openTaskModal(contextMenu.task._id, true, false, contextMenu.origin || null, contextMenu.task);
              setContextMenu((prev) => ({ ...prev, visible: false }));
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
            Edit Task
          </div>

          {isAdminLevel(actualRole) && (
            <div
              className="context-menu-item"
              onClick={() => {
                const task = contextMenu.task;
                if (!task || !task._id) return;
                const dl = getProjectDeadlines(task);
                const current = task.deadlineOverride || (dl && !dl.complete ? dl.completionDue : null);
                let initialDate = "";
                if (current) {
                  const d = new Date(current);
                  initialDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
                }
                showInputModal({
                  title: "Edit Completion Deadline",
                  message: task.deadlineOverride
                    ? `This project has an admin-set deadline (${fmtDate(task.deadlineOverride)}). Pick a new date, or clear the field to restore the computed milestone timeline.`
                    : "Pin a completion deadline for this project. It overrides the computed milestone timeline everywhere. Clear the field to go back to the computed date.",
                  fields: [{ name: "deadline", label: "Completion Deadline", type: "date", initialValue: initialDate }],
                  onConfirm: (data) => {
                    const value = (data.deadline || "").trim();
                    setTaskDeadlineMut({
                      taskId: task._id,
                      deadline: value ? new Date(`${value}T23:59:59`).getTime() : null,
                    }).catch((err) => console.error("Set deadline error:", err));
                  },
                });
                setContextMenu((prev) => ({ ...prev, visible: false }));
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                <line x1="16" y1="2" x2="16" y2="6" />
                <line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
              </svg>
              {contextMenu.task.deadlineOverride ? "Edit Deadline 📌" : "Edit Deadline"}
            </div>
          )}

          {/* Managers (and the main admin) edit links/credentials on ANY card,
              like the owner; everyone else only on cards they're assigned to. */}
          {!terms.tech && (isManager(actualRole) || isMainAdmin || contextMenu.task.assignee.toLowerCase().includes(userName.toLowerCase())) && (
            <div
              className="context-menu-item"
              onClick={() => {
                const t = contextMenu.task;
                if (!t?._id) return;
                showInputModal({
                  title: "Add a document",
                  message: `Link a document to "${t.title}" — an SOP, a deck, a sheet, a brief.`,
                  fields: [
                    { name: "name", label: "Name", placeholder: "e.g. Escalation SOP v2" },
                    { name: "url", label: "Link", placeholder: "https://docs.google.com/…" },
                  ],
                  onConfirm: (data) => {
                    let url = (data.url || "").trim();
                    if (!url) return;
                    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
                    updateTaskDocumentsMut({ taskId: t._id, documents: [...(t.documents || []), { name: (data.name || "").trim() || url, url }] })
                      .catch((err) => showModal({ title: "Couldn't add the document", message: err.message, type: "alert" }));
                  },
                });
                setContextMenu((prev) => ({ ...prev, visible: false }));
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="12" y1="18" x2="12" y2="12" /><line x1="9" y1="15" x2="15" y2="15" />
              </svg>
              Add Document{(contextMenu.task.documents || []).length ? ` (${contextMenu.task.documents.length})` : ""}
            </div>
          )}

          {terms.tech && (isManager(actualRole) || isMainAdmin || contextMenu.task.assignee.toLowerCase().includes(userName.toLowerCase())) && (
            <>
              <div
                className="context-menu-item"
                onClick={() => {
                  if (!contextMenu.task || !contextMenu.task._id) return;
                  showInputModal({
                    title: "Deployed Webapp Link",
                    message: "Enter the deployed URL for this web application.",
                    fields: [{ name: "link", label: "Webapp URL", placeholder: "https://...", initialValue: contextMenu.task.webappLink || contextMenu.task.projectLink }],
                    onConfirm: (data) => {
                      if (!contextMenu.task) return;
                      // Patch just the link (re-sending the whole task risked its milestones).
                      updateTaskLinksMut({ taskId: contextMenu.task._id, webappLink: data.link || "" })
                        .catch((err) => showModal({ title: "Couldn't save the link", message: err.message, type: "alert" }));
                    }
                  });
                  setContextMenu((prev) => ({ ...prev, visible: false }));
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                  <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                </svg>
                {contextMenu.task.webappLink ? "Edit Webapp Link" : "Add Webapp Link"}
              </div>

              <div
                className="context-menu-item"
                onClick={() => {
                  if (!contextMenu.task || !contextMenu.task._id) return;
                  showInputModal({
                    title: "Google Appscript Link",
                    message: "Enter the URL for the Google Apps Script project.",
                    fields: [{ name: "link", label: "Appscript URL", placeholder: "https://script.google.com/...", initialValue: contextMenu.task.appscriptLink }],
                    onConfirm: (data) => {
                      if (!contextMenu.task) return;
                      updateTaskLinksMut({ taskId: contextMenu.task._id, appscriptLink: data.link || "" })
                        .catch((err) => showModal({ title: "Couldn't save the link", message: err.message, type: "alert" }));
                    }
                  });
                  setContextMenu((prev) => ({ ...prev, visible: false }));
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4285f4" strokeWidth="2.5">
                  <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                  <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                </svg>
                {contextMenu.task.appscriptLink ? "Edit Appscript Link" : "Add Appscript Link"}
              </div>
              {isAdminLevel(actualRole) && <div
                className="context-menu-item"
                onClick={async () => {
                  const t = contextMenu.task;
                  if (!t || !t._id) return;
                  setContextMenu((prev) => ({ ...prev, visible: false }));
                  // Same rule as revealing them in the task modal: confirm it's you first.
                  showInputModal({
                    title: "Confirm it's you",
                    message: "Enter your Hermes password to view or change this project's admin login.",
                    fields: [{ name: "pass", label: "Your password", type: "password", placeholder: "••••••••" }],
                    onConfirm: async (d) => {
                      try { await authApi.verifyPassword(d.pass || ""); }
                      catch (err) { showModal({ title: "Access Denied", message: err?.message || "That password isn't right.", type: "alert" }); return; }
                      // The board's copy never carries credentials — read the full task.
                      let creds;
                      try { creds = (await convex.query(api.tasks.getTaskById, { taskId: t._id }))?.adminCredentials || {}; }
                      catch (err) { showModal({ title: "Couldn't load the login", message: err?.message || "Please try again.", type: "alert" }); return; }
                      showInputModal({
                        title: "Admin Credentials",
                        message: "Provide login details for administrative access.",
                        fields: [
                          { name: "email", label: "Email / Username", placeholder: "email@example.com", initialValue: creds.email },
                          { name: "password", label: "Password", placeholder: "••••••••", type: "password", initialValue: creds.password }
                        ],
                        onConfirm: (data) => {
                          updateAdminCredentials({ taskId: t._id, email: data.email, password: data.password })
                            .catch((err) => showModal({ title: "Couldn't save the login", message: err.message, type: "alert" }));
                        }
                      });
                    },
                  });
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
                Admin Credentials
              </div>}
            </>
          )}

          <div
            className="context-menu-item"
            style={{ color: "var(--color-text-secondary)" }}
            onClick={() => {
              if (!contextMenu.task || !contextMenu.task._id) return;
              showModal({
                title: "Archive Project",
                message: `Are you sure you want to move "${contextMenu.task.title}" to the Archive?`,
                type: "confirm",
                onConfirm: async () => {
                  try {
                    await updateTaskStatus({ taskId: contextMenu.task._id, newStatus: "scrapped" });
                    showModal({ title: "Archived", message: `"${contextMenu.task.title}" has been archived successfully.`, type: "success" });
                  } catch (err) {
                    showModal({ title: "Error", message: err.message, type: "alert" });
                  }
                }
              });
              setContextMenu((prev) => ({ ...prev, visible: false }));
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="21 8 21 21 3 21 3 8" />
              <rect x="1" y="3" width="22" height="5" />
              <line x1="10" y1="12" x2="14" y2="12" />
            </svg>
            Archive Task
          </div>

          <div
            className="context-menu-item delete-option"
            onClick={() => {
              showModal({
                title: "Delete Project",
                message: `Move "${contextMenu.task.title}" to the archive? It leaves the board. An Admin can restore it — or delete it for good — in Settings → Archived Projects.`,
                type: "confirm",
                onConfirm: () => deleteTask({ taskId: contextMenu.task._id, actorEmail: localStorage.getItem("wf_email") || "", actorName: userName, source: "context-menu" })
              });
              setContextMenu((prev) => ({ ...prev, visible: false }));
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            </svg>
            Delete Task
          </div>
        </div>
      )}

      {/* Custom Alert/Confirm Modal */}
      <CustomModal
        isOpen={modalConfig.isOpen}
        title={modalConfig.title}
        message={modalConfig.message}
        type={modalConfig.type}
        onConfirm={modalConfig.onConfirm}
        onCancel={modalConfig.onCancel}
      />

      <InputModal
        isOpen={inputModal.isOpen}
        title={inputModal.title}
        message={inputModal.message}
        fields={inputModal.fields}
        onConfirm={inputModal.onConfirm}
        onCancel={() => setInputModal(prev => ({ ...prev, isOpen: false }))}
      />

      {/* Announcement Popup — real-time, shows for all authenticated users */}
      <AnnouncementPopup />

      {/* Task Notification Popup — shows on login for Programmers */}
      {showLoginNotifications && (
        <TaskNotificationPopup
          userName={userName}
          onDismiss={() => setShowLoginNotifications(false)}
          onOpenTask={(taskId, origin) => {
            openTaskModal(taskId, false, false, origin || null);
            setShowLoginNotifications(false);
          }}
        />
      )}

      {/* Programming Handbook — shared, Admin+ editable */}
      {showHandbook && (
        <Handbook
          onClose={() => setShowHandbook(false)}
          canEdit={isAdminPlusOrAbove(actualRole)}
          userName={userName}
          showModal={showModal}
        />
      )}

      {/* Settings Panel */}
      {showSettings && (
        <Settings
          userName={userName}
          userEmail={localStorage.getItem("wf_email") || ""}
          onClose={() => setShowSettings(false)}
          showModal={showModal}
          onLogout={logout}
          actualRole={actualRole}
          onViewProfile={(s) => setViewingStaff(s)}
        />
      )}

      {/* Profile Popover */}
      {activeProfile && (
        <div className="profile-popover-overlay" onClick={closeProfile}>
          <div className="profile-popover-content" ref={profileRef} onClick={(e) => e.stopPropagation()}>
            <div className="profile-popover-header" style={{ backgroundImage: activeProfile.avatarUrl ? `url(${activeProfile.avatarUrl})` : "none" }}>
              <div className="profile-popover-avatar-large">
                {activeProfile.avatarUrl ? (
                  <img src={activeProfile.avatarUrl} alt={activeProfile.name} />
                ) : (
                  <div className="avatar-placeholder-large">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                      <circle cx="12" cy="7" r="4" />
                    </svg>
                  </div>
                )}
              </div>
              <button className="profile-popover-close" onClick={closeProfile}>×</button>
            </div>
            <div className="profile-popover-body">
              <div className="profile-popover-main">
                <div className="profile-popover-name-row">
                  <div className="status-indicator active" />
                  <h3>{activeProfile.name}</h3>
                </div>
                <div className="profile-popover-email">
                  {activeProfile.email}
                </div>
                <div className="profile-popover-badges" style={{ display: "flex", gap: "10px", marginBottom: "15px", flexWrap: "wrap" }}>
                  <div className="profile-popover-status location" style={{ marginBottom: 0, background: "var(--color-bg-subtle)", color: "var(--color-text-primary)", border: "1px solid var(--color-border)" }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                      <circle cx="12" cy="10" r="3" />
                    </svg>
                    {activeProfile.country || "Philippines"}
                  </div>
                  <div className="profile-popover-status" style={{ marginBottom: 0 }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                    </svg>
                    {activeProfile.status || "At work"}
                  </div>
                </div>

                <button
                  onClick={() => setShowUserProjectsModal(true)}
                  style={{ width: "100%", padding: "10px", background: "var(--color-accent)", color: "white", border: "none", borderRadius: "8px", fontWeight: "bold", cursor: "pointer", marginBottom: "15px", transition: "0.2s" }}
                  onMouseEnter={e => e.currentTarget.style.background = "var(--color-accent-hover)"}
                  onMouseLeave={e => e.currentTarget.style.background = "var(--color-accent)"}
                >
                  View Projects
                </button>

                {activeProfile.bio && (
                  <div className="profile-popover-bio">
                    {activeProfile.bio}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
      {showUserProjectsModal && activeProfile && (
        <div className="modal-overlay" style={{ zIndex: 4000 }} onClick={() => setShowUserProjectsModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: "1000px", height: "calc(100vh - 150px)", maxHeight: "90vh", display: "flex", flexDirection: "column" }}>
            <button className="modal-close" onClick={() => setShowUserProjectsModal(false)}>×</button>
            <h2 style={{ fontSize: "1.2rem", fontWeight: 900, marginBottom: "15px" }}>Projects assigned to {activeProfile.name}</h2>
            
            {/* TABS */}
            <div style={{ display: "flex", gap: "8px", marginBottom: "15px", borderBottom: "1px solid #e2e8f0", paddingBottom: "10px" }}>
              {["overview", "priority", "overdue", "shared"].map(tab => (
                <button
                  key={tab}
                  onClick={() => setActiveProjectsTab(tab)}
                  style={{
                    padding: "6px 12px",
                    borderRadius: "8px",
                    border: "none",
                    background: activeProjectsTab === tab ? "var(--color-accent)" : "transparent",
                    color: activeProjectsTab === tab ? "white" : "var(--color-text-secondary)",
                    fontWeight: "bold",
                    cursor: "pointer",
                    textTransform: "uppercase",
                    fontSize: "0.7rem",
                    transition: "all 0.2s"
                  }}
                >
                  {tab}
                </button>
              ))}
            </div>

            {/* PROJECTS LIST */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "16px", overflowY: "auto", flex: 1, paddingRight: "5px" }}>
              {(() => {
                const helperIsTaskOverdue = (t) => {
                  if (t.status === "scrapped") return false;
                  const milestones = t.milestones || [];
                  const firstIncompleteIdx = milestones.findIndex((ms) => !ms.completed);
                  if (firstIncompleteIdx === -1) return false;
                  const m = milestones[firstIncompleteIdx];
                  if (!m || !m.days) return false;
                  const anchor = milestoneAnchor(t, firstIncompleteIdx);
                  if (!anchor) return false; // not started (To Do) → never overdue
                  return (Date.now() - anchor) / DAY_MS > m.days;
                };

                const allAssigned = tasks?.filter(t => (t.assignee || "").toLowerCase().includes(activeProfile.name.toLowerCase().split(" ")[0])) || [];
                
                const filtered = allAssigned.filter(t => {
                  if (activeProjectsTab === "priority") return t.isPrioritized;
                  if (activeProjectsTab === "overdue") return helperIsTaskOverdue(t);
                  if (activeProjectsTab === "shared") return (t.assignee || "").split(",").map(a => a.trim()).filter(Boolean).length > 1;
                  return true; // overview
                });

                if (filtered.length === 0) {
                  return (
                    <div style={{ gridColumn: "span 2", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", flex: 1, color: "#94a3b8", gap: "12px", padding: "40px 0" }}>
                      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <circle cx="12" cy="12" r="10" />
                        <line x1="12" y1="8" x2="12" y2="12" />
                        <line x1="12" y1="16" x2="12.01" y2="16" />
                      </svg>
                      <span style={{ fontSize: "0.85rem", fontWeight: "bold", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                        No projects found under {activeProjectsTab}
                      </span>
                    </div>
                  );
                }

                return filtered.map(t => {
                  const assigneesList = (t.assignee || "").split(",").map(a => a.trim()).filter(Boolean);
                  const isShared = assigneesList.length > 1;
                  const isOverdue = helperIsTaskOverdue(t);
                  const completedCount = t.completedMilestones || 0;
                  const totalCount = t.milestones?.length || 0;
                  const percent = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

                  return (
                    <div 
                      key={t._id} 
                      style={{
                        background: "var(--color-card-bg)",
                        padding: "16px",
                        borderRadius: "16px",
                        border: isOverdue ? "1px solid #fca5a5" : "1px solid var(--glass-border)",
                        boxShadow: isOverdue ? "0 0 10px rgba(239, 68, 68, 0.1)" : "0 4px 12px rgba(0,0,0,0.03)",
                        cursor: "pointer", 
                        transition: "all 0.2s" 
                      }} 
                      onClick={(e) => { const origin = morphOriginFrom(e.currentTarget); setShowUserProjectsModal(false); setViewingStaff(null); openTaskModal(t._id, false, false, origin, t); }}
                      onMouseEnter={e => e.currentTarget.style.transform = "translateY(-2px)"}
                      onMouseLeave={e => e.currentTarget.style.transform = "translateY(0)"}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                        <div style={{ fontWeight: 800, fontSize: "0.95rem", color: "var(--color-text-primary)" }}>{t.title}</div>
                        <div style={{ display: "flex", gap: "6px" }}>
                          {t.isPrioritized && <span style={{ background: "#fef08a", color: "#854d0e", fontSize: "0.6rem", padding: "2px 8px", borderRadius: "12px", fontWeight: 800 }}>PRIORITY</span>}
                          {isShared && <span style={{ background: "#bfdbfe", color: "#1e3a8a", fontSize: "0.6rem", padding: "2px 8px", borderRadius: "12px", fontWeight: 800 }}>SHARED</span>}
                          {isOverdue && <span style={{ background: "#fee2e2", color: "#991b1b", fontSize: "0.6rem", padding: "2px 8px", borderRadius: "12px", fontWeight: 800 }}>OVERDUE</span>}
                        </div>
                      </div>

                      {/* Percent completion bar */}
                      <div style={{ display: "flex", alignItems: "center", gap: "10px", margin: "10px 0" }}>
                        <div style={{ flex: 1, height: "6px", background: "#f1f5f9", borderRadius: "10px", overflow: "hidden" }}>
                          <div style={{ height: "100%", width: `${percent}%`, background: isOverdue ? "#ef4444" : "var(--color-accent)", borderRadius: "10px" }} />
                        </div>
                        <div style={{ fontSize: "0.7rem", fontWeight: "bold", color: "#64748b" }}>{percent}%</div>
                      </div>

                      {/* Milestones grid */}
                      {t.milestones && t.milestones.length > 0 && (
                        <div style={{ marginTop: "12px", background: "var(--color-bg-subtle)", padding: "10px", borderRadius: "10px" }}>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                            {t.milestones.map((m, idx) => {
                              const activeIdx = t.milestones.findIndex(ms => !ms.completed);
                              const isMilestoneOverdue = isOverdue && !m.completed && (activeIdx === idx);
                              let dueStr = "";
                              if (t.status !== "scrapped" && activeIdx === idx && m.days > 0) {
                                const anchor = milestoneAnchor(t, idx);
                                if (anchor) {
                                  const deadlineTime = anchor + m.days * DAY_MS;
                                  dueStr = ` (Due: ${new Date(deadlineTime).toLocaleDateString("en-US", { month: "short", day: "numeric" })})`;
                                }
                              }
                              return (
                                <span 
                                  key={idx} 
                                  style={{ 
                                    fontSize: "0.65rem", 
                                    padding: "3px 8px", 
                                    borderRadius: "6px", 
                                    background: m.completed ? "#d1fae5" : isMilestoneOverdue ? "#fee2e2" : "#f1f5f9", 
                                    color: m.completed ? "#065f46" : isMilestoneOverdue ? "#991b1b" : "#64748b",
                                    fontWeight: "bold",
                                    border: isMilestoneOverdue ? "1px solid #ef4444" : "1px solid transparent"
                                  }}
                                >
                                  {m.name} ({m.days}d){dueStr}
                                </span>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                });
              })()}
            </div>
          </div>
        </div>
      )}

      {/* All Projects Modal */}
      {showAllProjects && (
        <div className="modal-overlay" onClick={() => setShowAllProjects(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 1200, height: "auto", maxHeight: "80vh" }}>
            <button className="modal-close" onClick={() => setShowAllProjects(false)}>×</button>
            <h2 style={{ 
              fontWeight: 900, 
              textTransform: "uppercase", 
              marginBottom: 25, 
              paddingBottom: 15,
              borderBottom: "1px solid #f1f5f9",
              color: "var(--color-text-primary)",
              display: "flex",
              alignItems: "center",
              gap: "12px"
            }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
              </svg>
              <span>{terms.tech ? "Consolidated Project Links" : terms.projectLinks}</span>
            </h2>

            {!terms.tech && (
              <div className="full-kanban-grid project-docs-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "20px" }}>
                {(tasks || []).filter((t) => (t.documents || []).length > 0).map((t, i) => (
                  <div key={t._id} className="programmer-card project-docs-card" style={{ borderTop: "6px solid #0ea5e9", animationDelay: `${Math.min(i, 12) * 40}ms` }}>
                    <div className="card-header" style={{ cursor: "pointer" }} onClick={(e) => { setShowAllProjects(false); openTaskModal(t._id, false, false, null, t); }}>
                      <h4 style={{ color: "var(--color-text-primary)" }}>{t.title}</h4>
                      {t.account && <span className="project-docs-account">{t.account}</span>}
                    </div>
                    <div className="project-docs-list">
                      {(t.documents || []).map((d, j) => (
                        <a key={`${d.url}-${j}`} href={d.url} target="_blank" rel="noopener noreferrer" className="project-docs-link" title={d.url}>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
                          <span>{d.name}</span>
                        </a>
                      ))}
                    </div>
                  </div>
                ))}
                {(tasks || []).filter((t) => (t.documents || []).length > 0).length === 0 && (
                  <div style={{ gridColumn: "1 / -1", textAlign: "center", padding: "40px", color: "#94a3b8" }}>
                    No documents yet. Open a project and use “+ ADD” under Documents — or right-click a card → Add Document.
                  </div>
                )}
              </div>
            )}

            {terms.tech && <div className="full-kanban-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "20px" }}>
              {tasks?.filter(t => t.webappLink || t.appscriptLink || t.projectLink).map(t => (
                <div 
                  key={t._id} 
                  className="programmer-card" 
                  onClick={() => {
                    const primaryLink = t.webappLink || t.projectLink || t.appscriptLink;
                    if (primaryLink) window.open(primaryLink.startsWith("http") ? primaryLink : `https://${primaryLink}`, "_blank");
                  }}
                  style={{ 
                    borderTop: "6px solid var(--color-accent)",
                    transition: "transform 0.2s, box-shadow 0.2s",
                    cursor: "pointer"
                  }}
                >
                  <div className="card-header">
                    <h4 style={{ color: "var(--color-text-primary)" }}>{t.title}</h4>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" strokeWidth="3">
                      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                      <polyline points="15 3 21 3 21 9" />
                      <line x1="10" y1="14" x2="21" y2="3" />
                    </svg>
                  </div>
                  <p style={{ fontSize: "0.75rem", color: "#64748b", margin: "5px 0 15px 0", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                    {t.description || "No description provided."}
                  </p>
                  <div style={{ display: "flex", gap: 10 }}>
                    {(t.webappLink || t.projectLink) && (
                      <div style={{ flex: 1, fontSize: "0.65rem", fontWeight: 800, color: "var(--color-accent)", textTransform: "uppercase", letterSpacing: "0.5px", background: "var(--color-bg-subtle)", padding: "6px", borderRadius: "6px", textAlign: "center", border: "1px solid var(--color-accent)" }}>
                        Webapp
                      </div>
                    )}
                    {t.appscriptLink && (
                      <div style={{ flex: 1, fontSize: "0.65rem", fontWeight: 800, color: "#4285f4", textTransform: "uppercase", letterSpacing: "0.5px", background: "var(--color-bg-subtle)", padding: "6px", borderRadius: "6px", textAlign: "center", border: "1px solid #4285f4" }}>
                        Appscript
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {tasks?.filter(t => t.webappLink || t.appscriptLink || t.projectLink).length === 0 && (
                <div style={{ gridColumn: "1 / -1", textAlign: "center", padding: "40px", color: "#94a3b8" }}>
                  No projects with links found.
                </div>
              )}
            </div>}
          </div>
        </div>
      )}

      {/* Workspace Picker — opened by clicking the WORKFORCE HERMES title.
          Big cards float on a hard-blurred, dimmed backdrop (no wrapper card). */}
      {showWorkspacePicker && (
        <div
          ref={wsPickerRef}
          className="modal-overlay ws-picker-overlay"
          style={{
            zIndex: 5000,
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(10, 15, 30, 0.62)",
            backdropFilter: "blur(28px)",
            WebkitBackdropFilter: "blur(28px)",
            padding: 20,
          }}
          onClick={() => {
            // A click that misses a card while they are still dealing out doesn't close it.
            if (!transitioningTo && performance.now() - wsPickerOpenedAt.current > 800) closeWorkspacePicker();
          }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ maxWidth: 2000, width: "96%", textAlign: "center", position: "relative" }}>
            {/* Stays in the layout (just fades) so the cards don't jump when you pick one. */}
            <div className="ws-picker-head" style={{ opacity: transitioningTo ? 0 : 1, transform: transitioningTo ? "translateY(-12px)" : "none", transition: "opacity 0.3s ease, transform 0.3s ease" }}>
              <h2 style={{ fontWeight: 900, margin: "0 15px 8px 0", fontSize: "2.5rem", color: "#000000", textShadow: "0 2px 10px rgba(0,0,0,0.4)" }}>Please Choose a Workspace</h2>
              <p style={{ margin: "0 0 36px 0", fontSize: "1.25rem", color: "rgba(0, 0, 0, 0.85)" }}>
                Choose where you'd like to go — each workspace has its own separate data.
              </p>
            </div>

            {/* The real selected card flies to center (FLIP), others blur out,
                then it shrinks to zero — all handled inside WorkspaceCards. */}
            <WorkspaceCards
              workspaces={myWorkspaces}
              activeWorkspace={activeWorkspace}
              onSelect={beginWorkspaceTransition}
              large
              transitioningTo={transitioningTo}
              transitionPhase={transitionPhase}
            />
          </div>
        </div>
      )}
      {/* Workspace switched under the swelling card — this fades away to show it. */}
      {wsCurtain && <div className="ws-curtain" aria-hidden="true" />}
    </WorkspaceContext.Provider>
  );
}
