import { useState, useEffect, useMemo, useRef } from "react";
import { applySettings, loadSettings, saveSettings } from "./utils/settingsManager";
import { getProjectDeadlines, fmtDate } from "./utils/deadlines";
import { isAdminLevel, isAdminPlusOrAbove, isManager, defaultViewRole, roleBadgeLabel } from "./utils/roles";
import { useQuery, useMutation } from "convex/react";
import { api } from "../convex/_generated/api";
import { initNotifications } from "./utils/notifications";
import Dashboard from "./components/Dashboard";
import KanbanBoard from "./components/KanbanBoard";
import TaskEntry from "./components/TaskEntry";
import Notebook from "./components/Notebook";
import AdminPanel from "./components/AdminPanel";
import TaskModal from "./components/TaskModal";
import Login from "./components/Login";
import SetPassword from "./components/SetPassword";
import CustomModal from "./components/CustomModal";
import InputModal from "./components/InputModal";
import IntroAnimation from "./components/IntroAnimation";
import AnnouncementPopup from "./components/AnnouncementPopup";
import AnnouncementComposer from "./components/AnnouncementComposer";
import TaskNotificationPopup from "./components/TaskNotificationPopup";
import Settings from "./components/Settings";
import NotificationBell from "./components/NotificationBell";
import Handbook from "./components/Handbook";

const ACTIVITY_EVENTS = ["mousemove", "keydown", "click", "scroll", "touchstart"];

// Session expires only after this much *continuous inactivity* (no mouse, key,
// click, scroll or touch). Set to 7 hours.
const SESSION_EXPIRY_MS = 7 * 60 * 60 * 1000;
// Don't rewrite localStorage on every mousemove — at most once per minute.
const ACTIVITY_WRITE_THROTTLE_MS = 60 * 1000;

export default function App() {
  // --- Refs ---
  const hasSetInitialView = useRef(false);
  const sessionExpiredRef = useRef(false); // ensures the expiry prompt fires only once

  // --- Auth state ---
  const [authStage, setAuthStage] = useState(() => {
    // "login" | "set-password" | "authenticated" | "denied"
    if (localStorage.getItem("wf_authenticated") === "true") {
      const email = localStorage.getItem("wf_email");
      if (!email) {
        localStorage.clear();
        return "login";
      }
      return "authenticated";
    }
    return "login";
  });
  const [pendingEmail, setPendingEmail] = useState(""); // used during set-password flow
  const [loginError, setLoginError] = useState("");     // error passed back to Login

  // --- App state ---
  const [currentView, setCurrentView] = useState("dashboard");
  const [userRole, setUserRole] = useState("Admin");
  const [actualRole, setActualRole] = useState("Admin");
  const [userName, setUserName] = useState("");
  const [isMainAdmin, setIsMainAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [userAvatar, setUserAvatar] = useState("");
  const [modalTaskId, setModalTaskId] = useState(null);
  const [modalEditMode, setModalEditMode] = useState(false);
  const [contextMenu, setContextMenu] = useState({ visible: false, x: 0, y: 0, task: null });
  const [showIntro, setShowIntro] = useState(() => {
    // Show intro on auto-login (user didn't log out)
    return localStorage.getItem("wf_authenticated") === "true";
  });
  const [showSettings, setShowSettings] = useState(false);
  const [showHandbook, setShowHandbook] = useState(false);
  const [viewingStaff, setViewingStaff] = useState(null);

  const [showLoginNotifications, setShowLoginNotifications] = useState(false);
  const [showAllProjects, setShowAllProjects] = useState(false);
  const [showRoleSwitcherPopup, setShowRoleSwitcherPopup] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
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

  // --- Convex (Optimized for Bandwidth) ---
  const [staff, setStaff] = useState([]);
  const tasks = useQuery(api.tasks.getTasksLight);
  const convexStaff = useQuery(api.staff.getStaff);

  // Fetch staff list via Vercel Proxy (with Edge Caching to save Convex Bandwidth)
  const fetchStaff = async () => {
    try {
      const resp = await fetch("/api/getStaff");
      if (resp.ok) {
        const data = await resp.json();
        setStaff(data);
      } else if (convexStaff) {
        setStaff(convexStaff);
      }
    } catch (err) {
      console.error("Failed to fetch staff from proxy:", err);
      if (convexStaff) setStaff(convexStaff);
    }
  };

  useEffect(() => {
    if (staff.length === 0 && convexStaff) {
      setStaff(convexStaff);
    }
  }, [convexStaff, staff.length]);

  useEffect(() => {
    fetchStaff();
    // Refresh staff list every 5 minutes (instead of every second) to save bandwidth
    const interval = setInterval(fetchStaff, 5 * 60 * 1000);
    return () => clearInterval(interval);
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
  const setTaskDeadlineMut = useMutation(api.tasks.setTaskDeadline);
  console.log("DEBUG: updateTaskDetailsMut is defined:", !!updateTaskDetailsMut);

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

    if (staff === undefined) return; // still loading from Convex

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

    // --- Apply default view from settings ---
    const viewMap = { "Dashboard": "dashboard", "Projects": "kanban", "Activity Feed": "entry", "Notebook": "notebook" };
    const mappedView = viewMap[settings.defaultView] || "dashboard";

    if (mainAdmin) {
      setUserName(user?.name || "Main Admin");
      setUserAvatar(user?.avatarUrl || "");
      setIsMainAdmin(true);
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
    if (user) {
      if (user.role === "Revoked") {
        logout();
        return;
      }

      // Always use the database as the source of truth for profile data
      setUserName(user.name || "User");
      setUserAvatar(user.avatarUrl || "");

      setActualRole(user.role);
      // Admin+ and Manager see the Admin view by default (they have all Admin privileges)
      setUserRole(defaultViewRole(user.role));
      if (!hasSetInitialView.current) {
        if (user.role === "Programmer") {
          setCurrentView("kanban");
        } else {
          setCurrentView(mappedView);
        }
        hasSetInitialView.current = true;
      }
    } else if (staff.length > 0 && !mainAdmin) {
      // User is authenticated but not found in the staff list.
      // Could happen if they were deleted.
      console.warn("Authenticated user not found in staff list:", email);
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
    if (authStage !== "authenticated" || loading || showIntro) return;
    if (isSessionExpired()) triggerSessionExpired("deferred check (app now visible)");
  }, [authStage, loading, showIntro]);

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
        setShowIntro(true);
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
    setShowIntro(true);
    setAuthStage("authenticated");
  }

  // -------------------------------------------------------
  // New user setup complete (password + security question done)
  // Routes back to login so they can authenticate normally.
  // -------------------------------------------------------
  function handleSetupComplete() {
    setPendingEmail("");
    setAuthStage("login");
    setLoginError("");
  }

  function logout() {
    localStorage.removeItem("wf_authenticated");
    localStorage.removeItem("wf_email");
    localStorage.removeItem("wf_last_activity");
    sessionExpiredRef.current = false;
    setAuthStage("login");
    setLoading(true);
    setUserName("");
    setActualRole("Admin");
    setUserRole("Admin");
    setCurrentView("dashboard");
    hasSetInitialView.current = false;
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

  function openTaskModal(taskId, editMode = false) {
    setModalTaskId(taskId);
    setModalEditMode(editMode);
  }

  function closeTaskModal() {
    setModalTaskId(null);
    setModalEditMode(false);
  }

  function handleContextMenu(e, task) {
    e.preventDefault();
    setContextMenu({ visible: true, x: e.pageX, y: e.pageY, task });
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
          setShowIntro(true);
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
            <p>Workforce Programming Project Database</p>
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

  if (loading) {
    return (
      <div className="loading-overlay">
        <div className="loader"></div>
        <div className="loading-text">LOADING...</div>
      </div>
    );
  }

  // -------------------------------------------------------
  // Main app
  // -------------------------------------------------------
  return (
    <>
      {/* Header */}
      <header>
        <div className="header-container">
          <div className="user-profile" style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: "12px", width: "auto", minWidth: 200 }}>
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
                  {roleBadgeLabel(actualRole, userRole)}
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
                        Programmer View
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
            <NotificationBell
              userEmail={localStorage.getItem("wf_email") || ""}
              onOpenTask={(taskId) => openTaskModal(taskId)}
            />
            <button
              className="btn-settings-header"
              onClick={() => setShowSearch(!showSearch)}
              title="Search"
              style={{ padding: "8px", borderRadius: "50%", marginLeft: "0px" }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <circle cx="11" cy="11" r="8"></circle>
                <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
              </svg>
            </button>
            <div style={{ display: "flex", alignItems: "center", position: "relative" }}>
              <div 
                style={{ 
                  display: "flex", 
                  alignItems: "center", 
                  width: showSearch ? "210px" : "0px", 
                  opacity: showSearch ? 1 : 0, 
                  overflow: "visible", 
                  transition: "width 0.3s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.2s ease, visibility 0.3s",
                  marginLeft: showSearch ? "8px" : "0px",
                  marginRight: showSearch ? "8px" : "0px",
                  pointerEvents: showSearch ? "auto" : "none",
                  visibility: showSearch ? "visible" : "hidden"
                }}
              >
                <input
                  type="text"
                  placeholder="Search tasks, people..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  autoFocus={showSearch}
                  style={{
                    width: "200px",
                    padding: "8px 12px",
                    borderRadius: "16px",
                    border: "1px solid var(--color-accent)",
                    outline: "none",
                    fontSize: "0.8rem",
                    background: "var(--color-card-bg)",
                    color: "var(--color-text-primary)",
                    boxShadow: "0 4px 12px rgba(0,0,0,0.05)",
                    boxSizing: "border-box"
                  }}
                />
                {showSearch && searchQuery.trim().length > 0 && (
                  <div style={{
                    position: "absolute",
                    top: "100%",
                    left: 0,
                    width: "250px",
                    background: "var(--color-card-bg)",
                    borderRadius: "12px",
                    border: "1px solid var(--glass-border)",
                    boxShadow: "0 10px 25px rgba(0,0,0,0.1)", 
                    marginTop: "8px", 
                    maxHeight: "300px", 
                    overflowY: "auto", 
                    padding: "8px",
                    zIndex: 2000,
                    animation: "slideDown 0.2s ease-out"
                  }}>
                    {/* Staff matches */}
                    {staff?.filter(s => s.name.toLowerCase().includes(searchQuery.toLowerCase()) || s.email.toLowerCase().includes(searchQuery.toLowerCase())).map(s => (
                      <div key={s._id || s.email} style={{ padding: "8px", cursor: "pointer", borderRadius: "6px", fontSize: "0.8rem", display: "flex", alignItems: "center", gap: "8px" }}
                        onMouseEnter={e => e.currentTarget.style.background = "var(--color-bg-subtle)"}
                        onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                        onClick={() => { setViewingStaff(s); setShowSearch(false); setSearchQuery(""); }}
                      >
                        <div style={{ width: "20px", height: "20px", borderRadius: "50%", background: "var(--color-accent)", color: "white", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.6rem" }}>{s.name.charAt(0)}</div>
                        <span>{s.name} (Profile)</span>
                      </div>
                    ))}
                    {/* Task matches */}
                    {tasks?.filter(t => t.title.toLowerCase().includes(searchQuery.toLowerCase()) || (searchQuery.toLowerCase() === "priority" && t.isPrioritized)).map(t => (
                      <div key={t._id} style={{ padding: "8px", cursor: "pointer", borderRadius: "6px", fontSize: "0.8rem", display: "flex", flexDirection: "column" }}
                        onMouseEnter={e => e.currentTarget.style.background = "var(--color-bg-subtle)"}
                        onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                        onClick={() => { openTaskModal(t._id); setShowSearch(false); setSearchQuery(""); }}
                      >
                        <div style={{ fontWeight: 800 }}>{t.title}</div>
                        <div style={{ fontSize: "0.65rem", color: "#64748b" }}>{t.assignee || "Unassigned"}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
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
            <div className="header-text-content" style={{ whiteSpace: "nowrap" }}>
              <h1 style={{ fontSize: "1.6rem", letterSpacing: "-1.2px" }}>WORKFORCE HERMES</h1>
              <p style={{ fontSize: "0.75rem", letterSpacing: "0.8px", color: "var(--color-text-secondary)", fontWeight: 700 }}>Workforce Programming Project Database</p>
            </div>
            <img src="https://i.imgur.com/ycmU6oP.png" alt="WFM Logo" className="header-logo" style={{ height: "45px" }} />
            <div style={{ width: "1px", height: "30px", background: "var(--glass-border)", margin: "0 10px" }}></div>
            <button
              className="btn-project-consolidation"
              onClick={() => setShowHandbook(true)}
              title="Open the Programming Handbook"
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
              title="View All Project Links"
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
              PROJECT LINKS
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

      {/* Views — keyed stage so switching views (or the intro lifting) replays
          the entrance choreography */}
      <main className="view-stage" key={`${currentView}${showIntro ? "-intro" : ""}`}>
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
            onContextMenu={handleContextMenu}
            showModal={showModal}
            staff={staff || []}
            searchQuery={searchQuery}
          />
        )}
        {currentView === "entry" && (
          <TaskEntry
            staff={staff || []}
            userRole={userRole}
            userName={userName}
            onCreated={() => switchView("kanban")}
            showModal={showModal}
          />
        )}
        {currentView === "notebook" && (
          <Notebook userRole={userRole} userName={userName} showModal={showModal} />
        )}
        {currentView === "admin" && isAdminPlusOrAbove(actualRole) && (
          <AdminPanel staff={staff} showModal={showModal} onViewProfile={(s) => setViewingStaff(s)} />
        )}

        {currentView === "announcements" && isAdminPlusOrAbove(actualRole) && (
          <AnnouncementComposer userName={userName} showModal={showModal} />
        )}
      </main>

      {/* Task Modal */}
      {modalTaskId && (
        <TaskModal
          taskId={modalTaskId}
          isEditMode={modalEditMode}
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

      {/* Context Menu */}
      {contextMenu.visible && (
        <div
          className="context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <div
            className="context-menu-item"
            onClick={() => {
              openTaskModal(contextMenu.task._id, true);
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
          {(isManager(actualRole) || isMainAdmin || contextMenu.task.assignee.toLowerCase().includes(userName.toLowerCase())) && (
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
                      console.log("DEBUG: onConfirm called for Webapp Link. data:", data);
                      if (!contextMenu.task) return;
                      updateTaskDetailsMut({
                        taskId: contextMenu.task._id,
                        newTitle: contextMenu.task.title,
                        newDescription: contextMenu.task.description || "",
                        newAssignee: contextMenu.task.assignee,
                        newWebappLink: data.link,
                        newAppscriptLink: contextMenu.task.appscriptLink,
                        newMilestones: contextMenu.task.milestones || []
                      }).catch(err => console.error("Webapp Link Mutation Error:", err));
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
                      console.log("DEBUG: onConfirm called for Appscript Link. data:", data);
                      if (!contextMenu.task) return;
                      updateTaskDetailsMut({
                        taskId: contextMenu.task._id,
                        newTitle: contextMenu.task.title,
                        newDescription: contextMenu.task.description || "",
                        newAssignee: contextMenu.task.assignee,
                        newWebappLink: contextMenu.task.webappLink,
                        newAppscriptLink: data.link,
                        newMilestones: contextMenu.task.milestones || []
                      }).catch(err => console.error("Appscript Link Mutation Error:", err));
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
              <div
                className="context-menu-item"
                onClick={() => {
                  if (!contextMenu.task || !contextMenu.task._id) return;
                  showInputModal({
                    title: "Admin Credentials",
                    message: "Provide login details for administrative access.",
                    fields: [
                      { name: "email", label: "Email / Username", placeholder: "email@example.com", initialValue: contextMenu.task.adminCredentials?.email },
                      { name: "password", label: "Password", placeholder: "••••••••", type: "password", initialValue: contextMenu.task.adminCredentials?.password }
                    ],
                    onConfirm: (data) => {
                      console.log("Saving Admin Creds for ID:", contextMenu.task._id, data);
                      updateAdminCredentials({ taskId: contextMenu.task._id, email: data.email, password: data.password })
                        .catch(err => console.error("Admin Cred Mutation Error:", err));
                    }
                  });
                  setContextMenu((prev) => ({ ...prev, visible: false }));
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
                {contextMenu.task.adminCredentials ? "Edit Admin Credentials" : "Add Admin Credentials"}
              </div>
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
                    await updateTaskStatus({ taskId: contextMenu.task._id, newStatus: "scrapyard" });
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
                message: "Are you sure you want to permanently delete this project? This action cannot be undone.",
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
          onOpenTask={(taskId) => {
            openTaskModal(taskId);
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
        <div className="profile-popover-overlay" onClick={() => setViewingStaff(null)}>
          <div className="profile-popover-content" onClick={(e) => e.stopPropagation()}>
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
              <button className="profile-popover-close" onClick={() => setViewingStaff(null)}>×</button>
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
                      onClick={() => { setShowUserProjectsModal(false); setViewingStaff(null); openTaskModal(t._id); }}
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
                                let lastTime = 0;
                                if (idx > 0) {
                                  lastTime = t.milestones[idx - 1].completedAtTime || t.milestones[idx - 1].createdAtTime || t.lastUpdated;
                                } else {
                                  lastTime = m.createdAtTime || t.lastUpdated;
                                }
                                if (lastTime) {
                                  const deadlineTime = lastTime + (m.days * 24 * 60 * 60 * 1000);
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
              <span>Consolidated Project Links</span>
            </h2>
            
            <div className="full-kanban-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "20px" }}>
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
            </div>
          </div>
        </div>
      )}

      {/* Intro Animation Overlay */}
      {showIntro && <IntroAnimation onDone={() => {
        setShowIntro(false);
      }} />}
    </>
  );
}
