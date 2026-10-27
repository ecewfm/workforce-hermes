import { useState, useRef, useEffect, useMemo } from "react";
import DatePicker from "./ui/DatePicker";
import Select from "./ui/Select";
import MultiSelect from "./ui/MultiSelect";
import { useAccountUi } from "../utils/accountScope";
import { useQuery, useMutation } from "../data/react";
import { api } from "../data/api";
import { loadSettings, saveSettings, applySettings, DEFAULT_SETTINGS, SKINS } from "../utils/settingsManager";
import { fallbackMilestonesFor } from "../utils/defaults";
import { isAdminPlusOrAbove, isAdminLevel, isManager, ASSIGNABLE_ROLES } from "../utils/roles";
import { useWorkspace } from "../utils/workspaceContext";
import { DEPARTMENTS, WORKSPACE_META, workspaceLabel, MAIN_ADMIN_EMAIL } from "../utils/departments";
import { hashPassword, markWorkspaceUnlocked } from "../utils/workspacePassword";
import { COLUMN_COLOR_PRESETS, ARCHIVED_STATUS, defaultColumnsFor, resolveColumns, isArchivedStatus, taskInColumn, makeColumnId } from "../utils/columns";
import { getGeminiModels, getDeepModels, getPlannerModels, isCaddyEnabled, setCaddyEnabled } from "../utils/aiConfig";
import { getFxPrefs, setFxPref } from "../utils/fxPrefs";
import { termsFor, usesAccounts, roleLabel } from "../utils/workspaceTerms";
import AnnouncementComposer from "./AnnouncementComposer";
import AccountKnowledge from "./AccountKnowledge";
import "../styles/settings-extra.css";

const ACCENT_COLORS = [
  { name: "Emerald", value: "#10b981" },
  { name: "Indigo", value: "#6366f1" },
  { name: "Rose", value: "#f43f5e" },
  { name: "Amber", value: "#f59e0b" },
  { name: "Cyan", value: "#06b6d4" },
];

const FONT_SIZES = ["Standard", "Large", "Extra Large"];
// Stored values are what App.jsx maps to a screen (keep them as-is); the
// labels match the nav button each one actually opens.
const DEFAULT_VIEWS = [
  { value: "Dashboard", label: "Overview" },
  { value: "Projects", label: "Dashboard (project board)" },
  { value: "Activity Feed", label: "New Task" },
  { value: "Notebook", label: "Notebook" },
];

const BASE_SECTIONS = [
  { id: "appearance", label: "Appearance & UI", icon: "palette" },
  { id: "general", label: "General Preferences", icon: "sliders" },
  { id: "account", label: "Account & Profile", icon: "user" },
  { id: "notifications", label: "Notifications", icon: "bell" },
  { id: "archive", label: "Archived Projects", icon: "archive" },
];

function SectionIcon({ icon, size = 18 }) {
  const s = { width: size, height: size, strokeWidth: 2, fill: "none", stroke: "currentColor" };
  switch (icon) {
    case "palette":
      return (<svg viewBox="0 0 24 24" {...s}><circle cx="13.5" cy="6.5" r="0.5" fill="currentColor" stroke="none" /><circle cx="17.5" cy="10.5" r="0.5" fill="currentColor" stroke="none" /><circle cx="8.5" cy="7.5" r="0.5" fill="currentColor" stroke="none" /><circle cx="6.5" cy="12.5" r="0.5" fill="currentColor" stroke="none" /><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z" /></svg>);
    case "sliders":
      return (<svg viewBox="0 0 24 24" {...s}><line x1="4" y1="21" x2="4" y2="14" /><line x1="4" y1="10" x2="4" y2="3" /><line x1="12" y1="21" x2="12" y2="12" /><line x1="12" y1="8" x2="12" y2="3" /><line x1="20" y1="21" x2="20" y2="16" /><line x1="20" y1="12" x2="20" y2="3" /><line x1="1" y1="14" x2="7" y2="14" /><line x1="9" y1="8" x2="15" y2="8" /><line x1="17" y1="16" x2="23" y2="16" /></svg>);
    case "user":
      return (<svg viewBox="0 0 24 24" {...s}><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>);
    case "bell":
      return (<svg viewBox="0 0 24 24" {...s}><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></svg>);
    case "shield":
      return (<svg viewBox="0 0 24 24" {...s}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>);
    case "archive":
      return (<svg viewBox="0 0 24 24" {...s}><polyline points="21 8 21 21 3 21 3 8" /><rect x="1" y="3" width="22" height="5" /><line x1="10" y1="12" x2="14" y2="12" /></svg>);
    case "target":
      return (<svg viewBox="0 0 24 24" {...s}><circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="2" /></svg>);
    case "megaphone":
      return (<svg viewBox="0 0 24 24" {...s}><path d="M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1z" /><path d="M15.5 8.5a5 5 0 0 1 0 7" /><path d="M18.5 5.5a9 9 0 0 1 0 13" /></svg>);
    case "book":
      return (<svg viewBox="0 0 24 24" {...s}><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /><path d="M9 7h7M9 11h5" /></svg>);
    case "briefcase":
      return (<svg viewBox="0 0 24 24" {...s}><rect x="2" y="7" width="20" height="14" rx="2" ry="2" /><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" /></svg>);
    default: return null;
  }
}

export default function Settings({ userName, userEmail, onClose, showModal, onLogout, actualRole, onViewProfile, initialSection }) {
  // Caddy can open Settings on a given tab (e.g. Announcements).
  const [activeSection, setActiveSection] = useState(initialSection || "appearance");
  const [hasChanges, setHasChanges] = useState(false);
  // Admin+ and Manager share the elevated settings (workspace defaults, staff management)
  const isAdminPlus = isAdminPlusOrAbove(actualRole);
  // Department membership is editable by MANAGERS only (and the Main Admin);
  // Admin/Admin+ can view it but not change it.
  const isMainAdmin = (userEmail || "").toLowerCase() === MAIN_ADMIN_EMAIL;
  const canEditDepartments = isManager(actualRole) || isMainAdmin;
  const workspace = useWorkspace();
  // Workspace vocabulary (Workforce keeps its original software wording)
  const terms = termsFor(workspace);
  const hasAccounts = usesAccounts(workspace);
  // What a board card is called here (Workforce's board holds "tasks")
  const cardWord = terms.tech ? "task" : "project";
  // App.jsx always opens Programmers / Users on the board, so the
  // Default View setting only applies to admin-level people.
  const showDefaultView = isAdminLevel(actualRole) || isMainAdmin;
  // Permanent delete from the archive is Admin-level only (enforced server-side)
  const canDeleteArchived = isAdminLevel(actualRole) || isMainAdmin;
  // Client Accounts tab: Admin+ manage every account; others only see it when they have several.
  const accUi = useAccountUi(workspace, actualRole);
  const SECTIONS = useMemo(() => {
    const accountsSection = [
      ...(hasAccounts && (isAdminPlus || accUi.show) ? [{ id: "accounts", label: "Client Accounts", icon: "briefcase" }] : []),
      // Each account's SOPs and notes for the AI — for anyone on an account.
      ...(hasAccounts && (isAdminPlus || accUi.accountIds.length > 0) ? [{ id: "knowledge", label: "Account Knowledge", icon: "book" }] : []),
    ];
    return isAdminPlus
      ? [
          ...BASE_SECTIONS.filter(s => s.id !== "archive"),
          { id: "announcements", label: "Announcements", icon: "megaphone" },
          { id: "workspace", label: "Workspace Defaults", icon: "target" },
          ...accountsSection,
          { id: "staff", label: "Staff Management", icon: "shield" },
          { id: "archive", label: "Archived Projects", icon: "archive" },
        ]
      : [...BASE_SECTIONS.filter(s => s.id !== "archive"), ...accountsSection, ...BASE_SECTIONS.filter(s => s.id === "archive")];
  }, [isAdminPlus, hasAccounts, accUi.show, accUi.accountIds.length]);

  const contentRef = useRef(null);
  const savedRef = useRef(null); // snapshot of settings before edits

  // Load saved settings on mount
  const saved = loadSettings();
  if (!savedRef.current) savedRef.current = { ...saved };

  // --- Appearance state ---
  const [theme, setTheme] = useState(saved.theme);
  const [skin, setSkin] = useState(saved.skin || "default");
  const [accentColor, setAccentColor] = useState(saved.accentColor);
  const [fontSize, setFontSize] = useState(saved.fontSize);

  // --- Theme default prompt state ---
  // defaultSkin mirrors what's persisted; sessionOnlySkin remembers a skin the
  // user chose to keep "just for this session" so we don't re-ask for it.
  const [defaultSkin, setDefaultSkin] = useState(saved.skin || "default");
  const [sessionOnlySkin, setSessionOnlySkin] = useState(null);
  const [justSetDefault, setJustSetDefault] = useState(false);

  function selectSkin(id) {
    setSkin(id);
    previewAppearance({ skin: id });
    markChanged();
    setSessionOnlySkin(null);
    setJustSetDefault(false);
  }

  function makeSkinDefault() {
    const merged = { ...loadSettings(), skin, skinChosen: true };
    saveSettings(merged);
    savedRef.current = { ...savedRef.current, skin, skinChosen: true };
    setDefaultSkin(skin);
    setSessionOnlySkin(null);
    setJustSetDefault(true);
  }

  // Live-preview the skin/theme as the user clicks. Merge current in-progress
  // selections (not just stored values) so changing one doesn't reset another.
  // Reverted on cancel via savedRef.current.
  function previewAppearance(next) {
    applySettings({ ...loadSettings(), theme, skin, accentColor, fontSize, ...next });
  }

  // --- AI Assistant (Caddy) state ---
  const [caddyEnabled, setCaddyEnabledState] = useState(isCaddyEnabled());

  // --- Motion & fun effects state ---
  const [fxPrefs, setFxPrefsState] = useState(getFxPrefs());
  const toggleFx = (key, value) => setFxPrefsState(setFxPref(key, value));

  // --- General Preferences state ---
  const [defaultView, setDefaultView] = useState(saved.defaultView);

  // --- Account state: load from the DATABASE for the logged-in user ---
  const currentUserProfile = useQuery(api.staff.getStaffByEmail, userEmail ? { email: userEmail } : "skip");

  const [avatarUrl, setAvatarUrl] = useState(null);
  const [username, setUsername] = useState(userName || "");
  const [bio, setBio] = useState("");
  const [country, setCountry] = useState("");
  const [status, setStatus] = useState("");
  const [email, setEmail] = useState(userEmail || "");

  // Sync profile fields when the database data arrives or the user changes
  useEffect(() => {
    if (currentUserProfile) {
      setUsername(currentUserProfile.name || userName || "");
      setBio(currentUserProfile.bio || "");
      setAvatarUrl(currentUserProfile.avatarUrl || null);
      setCountry(currentUserProfile.country || "");
      setStatus(currentUserProfile.status || "");
      setEmail(currentUserProfile.email || userEmail || "");
    }
  }, [currentUserProfile, userEmail]);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [securityQuestion, setSecurityQuestion] = useState("");
  const [securityAnswer, setSecurityAnswer] = useState("");

  const updateProfile = useMutation(api.staff.updateProfile);
  const resetPasswordMut = useMutation(api.staff.resetPassword);
  const updateStaffRole = useMutation(api.staff.updateStaffRole);
  const approveStaffMut = useMutation(api.staff.approveStaff);
  const deleteStaffMut = useMutation(api.staff.deleteStaff);
  const addStaffMut = useMutation(api.staff.addStaff);
  const setSecurityQuestionMut = useMutation(api.staff.setSecurityQuestion);
  const changePasswordMut = useMutation(api.staff.changePassword);
  const [changingPassword, setChangingPassword] = useState(false);
  const updateStaffDepartmentMut = useMutation(api.staff.updateStaffDepartment);
  // Staff Management sub-tab: "access" (role) | "department" (workspace access)
  // Workspace entry password (per-workspace appConfig.workspacePasswordHash).
  const [wsPwInput, setWsPwInput] = useState("");
  const [savingWsPw, setSavingWsPw] = useState(false);

  const allStaff = useQuery(api.staff.getStaff);

  // Archive: fetch all tasks to filter archived ones (active workspace only)
  const allTasks = useQuery(api.tasks.getTasksLight, { workspace });
  const updateTaskStatus = useMutation(api.tasks.updateTaskStatus);
  const archivedTasks = (allTasks || []).filter(t => isArchivedStatus(t.status));
  const deleteTask = useMutation(api.tasks.deleteTask);

  const handleUpdateSecurityQuestion = async () => {
    if (!securityQuestion.trim() || !securityAnswer.trim()) {
      showModal({ title: "Error", message: "Both question and answer are required.", type: "alert" });
      return;
    }
    try {
      await setSecurityQuestionMut({ email, question: securityQuestion.trim(), answer: securityAnswer.trim() });
      // The card now shows the saved question; don't leave the answer on screen
      setSecurityQuestion(""); setSecurityAnswer("");
      showModal({ title: "Success", message: "Security question updated successfully.", type: "success" });
    } catch (err) {
      showModal({ title: "Error", message: err.message || "Failed to update security question.", type: "alert" });
    }
  };

  // --- Workspace Defaults state (Admin+ — per-workspace settings in Supabase) ---
  const appConfig = useQuery(api.appConfig.getAppConfig, { workspace });
  const saveAppConfigMut = useMutation(api.appConfig.saveAppConfig);
  const [templateRows, setTemplateRows] = useState(() => fallbackMilestonesFor(workspace).map(({ name, days }) => ({ name, days })));
  const templateDirty = useRef(false);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [prodDeadlineInput, setProdDeadlineInput] = useState("");

  // The board as it's currently saved (not the editor's draft) — used to find
  // where a restored archived project goes and what the archive column is called.
  const boardColumns = useMemo(() => resolveColumns(appConfig?.columns, workspace), [appConfig, workspace]);
  const restoreColumn = boardColumns.find((c) => !isArchivedStatus(c.id)) || { id: "todo", label: "To Do" };

  // --- Board Columns editor state (per-workspace) ---
  const [columnRows, setColumnRows] = useState(() => defaultColumnsFor(workspace));
  const columnsDirty = useRef(false);
  const [savingColumns, setSavingColumns] = useState(false);
  // Task count per column id (for blocking removal of non-empty columns)
  const columnTaskCounts = useMemo(() => {
    const counts = {};
    (allTasks || []).forEach((t) => {
      columnRows.forEach((c) => { if (taskInColumn(t.status, c.id)) counts[c.id] = (counts[c.id] || 0) + 1; });
    });
    return counts;
  }, [allTasks, columnRows]);

  // Kanban columns (and the milestone template) are configured PER WORKSPACE.
  // If the active workspace changes while Settings is open, drop any unsaved
  // edits so the editors re-hydrate from the new workspace's own config.
  // (Declared before the hydrate effect so it runs first on a switch.)
  useEffect(() => {
    columnsDirty.current = false;
    templateDirty.current = false;
    setProdDeadlineInput("");
  }, [workspace]);

  // Hydrate the editor from the shared config once it loads (unless mid-edit)
  useEffect(() => {
    if (appConfig === undefined) return;
    if (!templateDirty.current) {
      const src = appConfig?.defaultMilestones?.length ? appConfig.defaultMilestones : fallbackMilestonesFor(workspace);
      setTemplateRows(src.map(({ name, days }) => ({ name, days })));
    }
    if (!columnsDirty.current) {
      setColumnRows(resolveColumns(appConfig?.columns, workspace).map((c) => ({ ...c })));
    }
    if (appConfig?.productionDeadline) {
      // Format in LOCAL time — toISOString would shift the date for US timezones
      const d = new Date(appConfig.productionDeadline);
      setProdDeadlineInput(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
    }
  }, [appConfig, workspace]);

  const templateTotalDays = templateRows.reduce((sum, m) => sum + (Number(m.days) || 0), 0);

  function updateTemplateRow(idx, field, value) {
    templateDirty.current = true;
    setTemplateRows((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: field === "days" ? (parseInt(value) || 0) : value };
      return next;
    });
  }

  async function handleSaveTemplate(rows) {
    const cleaned = rows
      .map((m) => ({ name: (m.name || "").trim(), days: Number(m.days) || 0 }))
      .filter((m) => m.name);
    if (cleaned.length === 0) {
      showModal({ title: "Error", message: "Add at least one named milestone before saving.", type: "alert" });
      return;
    }
    setSavingTemplate(true);
    try {
      await saveAppConfigMut({ workspace, defaultMilestones: cleaned, updatedBy: userName });
      templateDirty.current = false;
      setTemplateRows(cleaned.map((m) => ({ ...m })));
      showModal({ title: "Template Saved", message: `New ${terms.label} projects will now start from this milestone template when the AI planner isn't used.`, type: "success" });
    } catch (err) {
      showModal({ title: "Error", message: err.message || "Failed to save the milestone template.", type: "alert" });
    } finally {
      setSavingTemplate(false);
    }
  }

  async function handleSaveProdDeadline() {
    if (!prodDeadlineInput) {
      showModal({ title: "Error", message: "Pick a date first.", type: "alert" });
      return;
    }
    try {
      // End of the selected day, local time
      const ts = new Date(`${prodDeadlineInput}T23:59:59`).getTime();
      await saveAppConfigMut({ workspace, productionDeadline: ts, updatedBy: userName });
      // It shows on the Overview (the nav's "Dashboard" is the project board)
      showModal(terms.tech
        ? { title: "Deadline Set", message: "The full-production deadline is now shown at the top of the Overview.", type: "success" }
        : { title: "Target Date Set", message: "The key target date is now shown at the top of the Overview.", type: "success" });
    } catch (err) {
      showModal({ title: "Error", message: err.message || (terms.tech ? "Failed to save the deadline." : "Failed to save the target date."), type: "alert" });
    }
  }

  // --- Board Columns handlers ---
  function updateColumnRow(idx, field, value) {
    columnsDirty.current = true;
    setColumnRows((prev) => {
      const next = [...prev];
      let v = value;
      if (field === "limit") v = value === "" ? undefined : Math.max(0, parseInt(value) || 0) || undefined;
      next[idx] = { ...next[idx], [field]: v };
      return next;
    });
  }

  function addColumnRow() {
    columnsDirty.current = true;
    setColumnRows((prev) => {
      const id = makeColumnId("column", prev.map((c) => c.id));
      const color = COLUMN_COLOR_PRESETS[prev.length % COLUMN_COLOR_PRESETS.length];
      return [...prev, { id, label: "New Column", color }];
    });
  }

  function moveColumnRow(idx, dir) {
    columnsDirty.current = true;
    setColumnRows((prev) => {
      const next = [...prev];
      const j = idx + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[idx], next[j]] = [next[j], next[idx]];
      return next;
    });
  }

  function removeColumnRow(idx) {
    const col = columnRows[idx];
    const count = columnTaskCounts[col.id] || 0;
    if (count > 0) {
      showModal({
        title: "Column Not Empty",
        message: `"${col.label}" still has ${count} ${cardWord}${count === 1 ? "" : "s"}. Move ${count === 1 ? "it" : "them"} to another column first, then remove this one.`,
        type: "alert",
      });
      return;
    }
    if (columnRows.length <= 1) {
      showModal({ title: "Error", message: "A board needs at least one column.", type: "alert" });
      return;
    }
    columnsDirty.current = true;
    setColumnRows((prev) => prev.filter((_, i) => i !== idx));
  }

  async function handleSaveColumns() {
    const cleaned = columnRows
      .map((c) => ({
        id: c.id,
        label: (c.label || "").trim() || "Untitled",
        color: c.color || "#10b981",
        ...(typeof c.limit === "number" && c.limit > 0 ? { limit: c.limit } : {}),
      }))
      .filter((c) => c.id);
    if (cleaned.length === 0) {
      showModal({ title: "Error", message: "Add at least one column before saving.", type: "alert" });
      return;
    }
    setSavingColumns(true);
    try {
      await saveAppConfigMut({ workspace, columns: cleaned, updatedBy: userName });
      columnsDirty.current = false;
      showModal({ title: "Board Saved", message: terms.tech ? "This workspace's Kanban columns have been updated." : `The ${terms.label} board columns have been updated.`, type: "success" });
    } catch (err) {
      showModal({ title: "Error", message: err.message || "Failed to save the board columns.", type: "alert" });
    } finally {
      setSavingColumns(false);
    }
  }

  // --- Client Accounts (Operations — everyone sees them, Admin+/Manager manage) ---
  // Accounts belong to Operations, but Staff Management can set them from any
  // workspace — as long as the person managing staff can open Operations.
  const ACCOUNT_WS = "operations";
  const myRow = (allStaff || []).find((p) => (p.email || "").toLowerCase() === (userEmail || "").toLowerCase());
  const viewerHasOps = isMainAdmin || (Array.isArray(myRow?.departments) && myRow.departments.includes(WORKSPACE_META[ACCOUNT_WS].department));
  const staffAccountsUi = hasAccounts || (isAdminPlus && viewerHasOps);
  const accounts = useQuery(api.accounts.getAccounts, staffAccountsUi ? { workspace: ACCOUNT_WS } : "skip");
  const staffAccounts = useQuery(api.accounts.getStaffAccounts, staffAccountsUi ? { workspace: ACCOUNT_WS } : "skip");
  const setStaffAccountsMut = useMutation(api.accounts.setStaffAccounts);
  const accountsByEmail = useMemo(() => {
    const m = {};
    (staffAccounts || []).forEach((r) => { (m[r.email] = m[r.email] || []).push(r.accountId); });
    return m;
  }, [staffAccounts]);
  const addAccountMut = useMutation(api.accounts.addAccount);
  const renameAccountMut = useMutation(api.accounts.renameAccount);
  const deleteAccountMut = useMutation(api.accounts.deleteAccount);
  const [newAccountName, setNewAccountName] = useState("");
  const [addingAccount, setAddingAccount] = useState(false);
  const [editingAccount, setEditingAccount] = useState(null); // { id, name } while renaming inline

  async function handleAddAccount() {
    const name = newAccountName.trim();
    if (!name || addingAccount) return;
    setAddingAccount(true);
    try {
      await addAccountMut({ workspace, name });
      setNewAccountName("");
    } catch (err) {
      showModal({ title: "Couldn't Add Account", message: err.message || "Failed to add the account.", type: "alert" });
    } finally {
      setAddingAccount(false);
    }
  }

  async function handleRenameAccount() {
    if (!editingAccount) return;
    const name = editingAccount.name.trim();
    const current = (accounts || []).find((a) => a._id === editingAccount.id);
    if (!name || name === current?.name) { setEditingAccount(null); return; }
    try {
      await renameAccountMut({ accountId: editingAccount.id, name });
      setEditingAccount(null);
    } catch (err) {
      showModal({ title: "Couldn't Rename Account", message: err.message || "Failed to rename the account.", type: "alert" });
    }
  }

  function handleDeleteAccount(acct) {
    const n = Number(acct.projects) || 0;
    showModal({
      title: "Delete Account",
      message: `Delete the account "${acct.name}"?${n > 0 ? ` It has ${n} project${n === 1 ? "" : "s"}.` : ""} Projects in it keep working and become "No account".`,
      type: "confirm",
      onConfirm: async () => {
        try {
          await deleteAccountMut({ accountId: acct._id });
        } catch (err) {
          showModal({ title: "Couldn't Delete Account", message: err.message || "Failed to delete the account.", type: "alert" });
        }
      },
    });
  }

  // Staff management state — a new person defaults to the department of the
  // workspace you're managing from (Operations staff get added from Operations).
  const defaultNewStaffDept = WORKSPACE_META[workspace]?.department || "Workforce";
  const [newStaffName, setNewStaffName] = useState("");
  const [newStaffEmail, setNewStaffEmail] = useState("");
  const [newStaffRole, setNewStaffRole] = useState("Programmer");
  const [newStaffDepartments, setNewStaffDepartments] = useState([defaultNewStaffDept]);
  useEffect(() => {
    setNewStaffDepartments([defaultNewStaffDept]);
    setEditingAccount(null);
  }, [workspace, defaultNewStaffDept]);

  // A tab can disappear on a workspace switch (Client Accounts is Operations-only)
  useEffect(() => {
    if (!SECTIONS.some((s) => s.id === activeSection)) setActiveSection(SECTIONS[0].id);
  }, [SECTIONS, activeSection]);

  const activeStaff = (allStaff || []).filter(s => s.role !== "Pending");
  const pendingRequests = (allStaff || []).filter(s => s.role === "Pending");

  // --- Notifications state ---
  const [notificationsEnabled, setNotificationsEnabled] = useState(saved.notificationsEnabled);
  // Cliq reminders (Admin+ / Managers): one server-side switch for every workspace, saved on click.
  const cliqReminders = useQuery(api.cliq.getReminders, isAdminPlus ? {} : "skip");
  const setCliqReminders = useMutation(api.cliq.setReminders);
  const [cliqSaving, setCliqSaving] = useState(false);
  async function toggleCliqReminders(enabled) {
    setCliqSaving(true);
    try {
      await setCliqReminders({ enabled });
      showModal({
        title: enabled ? "Cliq reminders are on" : "Cliq reminders are off",
        message: enabled
          ? "Owners and Managers get their late-project reminders on Cliq again, starting the next weekday at 9:00 AM."
          : "Nobody gets Cliq reminders until this is turned back on. The in-app notifications aren't affected.",
        type: "success",
      });
    } catch (err) {
      showModal({ title: "Couldn't change it", message: err.message || "Please try again.", type: "alert" });
    } finally {
      setCliqSaving(false);
    }
  }
  const fmtDay = (ms) => new Date(ms).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  const fmtTime = (ms) => new Date(ms).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

  const avatarInputRef = useRef(null);
  const markChanged = () => setHasChanges(true);

  // Show only the selected section (tabbed — no continuous scroll through all
  // sections). Reset the panel scroll so each tab opens at its heading.
  function goToSection(sectionId) {
    setActiveSection(sectionId);
    if (contentRef.current) contentRef.current.scrollTop = 0;
  }

  function handleAvatarUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => { setAvatarUrl(ev.target.result); markChanged(); };
    reader.readAsDataURL(file);
  }

  function buildSettingsObject() {
    // Only visual/UI preferences go to localStorage — profile data is per-user in the database.
    // skinChosen marks an explicit theme choice so the liquid-glass default migration won't override it.
    return { theme, skin, skinChosen: true, accentColor, fontSize, defaultView, notificationsEnabled };
  }

  async function handleSave() {
    const settings = buildSettingsObject();
    
    // Save locally
    saveSettings(settings);
    applySettings(settings);
    savedRef.current = { ...settings };
    setHasChanges(false);
    setDefaultSkin(settings.skin); // saving makes the current theme the default
    setSessionOnlySkin(null);

    // Sync to backend if we have an email
    if (email) {
      try {
        await updateProfile({
          email: email,
          name: username,
          bio: bio,
          avatarUrl: avatarUrl,
          country: country,
          status: status,
        });
      } catch (err) {
        console.error("Failed to sync profile to backend:", err);
      }
    }

    showModal({ title: "Settings Saved", message: "Your preferences have been applied successfully.", type: "success" });
  }

  function handleCancel() {
    if (hasChanges) {
      showModal({
        title: "Discard Changes?",
        message: "You have unsaved changes. Are you sure you want to discard them?",
        type: "confirm",
        onConfirm: () => {
          // Revert to previously saved settings
          applySettings(savedRef.current);
          setHasChanges(false);
          onClose();
        },
      });
    } else {
      onClose();
    }
  }

  // Esc closes Settings (same as the × — asks first if there are unsaved
  // changes), unless a dialog or dropdown on top of it is open.
  const cancelRef = useRef(handleCancel);
  cancelRef.current = handleCancel;
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (document.querySelector(".custom-modal-overlay, .ui-popover, .profile-popover-overlay, .announcement-overlay, .kb-sheet-overlay")) return;
      cancelRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  async function handleChangePassword() {
    if (!currentPassword) { showModal({ title: "Error", message: "Please enter your current password.", type: "alert" }); return; }
    if (newPassword.length < 6) { showModal({ title: "Error", message: "New password must be at least 6 characters.", type: "alert" }); return; }
    if (newPassword !== confirmPassword) { showModal({ title: "Error", message: "New passwords do not match.", type: "alert" }); return; }
    if (changingPassword) return;
    setChangingPassword(true);
    try {
      await changePasswordMut({ currentPassword, newPassword });
      showModal({ title: "Password Updated", message: "Your password has been changed. Use the new one next time you sign in.", type: "success" });
      setCurrentPassword(""); setNewPassword(""); setConfirmPassword("");
    } catch (err) {
      showModal({ title: "Couldn't change password", message: err.message || "Please try again.", type: "alert" });
    } finally {
      setChangingPassword(false);
    }
  }

  return (
    <div className="settings-overlay">
      <div className="settings-panel">
        {/* Header */}
        <div className="settings-header">
          <div className="settings-header-left">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
            <h2>Settings</h2>
          </div>
          <button className="settings-close-btn" onClick={handleCancel} title="Close Settings">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>

        <div className="settings-body">
          {/* Sidebar */}
          <nav className="settings-sidebar">
            {SECTIONS.map((sec) => (
              <button key={sec.id} className={`settings-nav-item ${activeSection === sec.id ? "active" : ""}`} onClick={() => goToSection(sec.id)}>
                <SectionIcon icon={sec.icon} size={18} /><span>{sec.label}</span>
              </button>
            ))}
            <div className="settings-sidebar-footer"><div className="settings-sidebar-version">Hermes v1.0</div></div>
          </nav>

          {/* Content */}
          <div className="settings-content" ref={contentRef}>
            {/* ─── APPEARANCE ─── */}
            <section id="settings-section-appearance" className="settings-section" style={{ display: activeSection === "appearance" ? undefined : "none" }}>
              <div className="settings-section-header"><SectionIcon icon="palette" size={20} /><h3>Appearance & UI</h3></div>
              <p className="settings-section-desc">Customize how Hermes looks on this device — it applies in every workspace.</p>

              <div className="settings-card">
                <label className="settings-field-label">Mode</label>
                <div className="settings-segmented-control">
                  {[{ id: "light", label: "Light", icon: "☀️" }, { id: "dark", label: "Dark", icon: "🌙" }, { id: "system", label: "System", icon: "💻" }].map((opt) => (
                    <button key={opt.id} className={`segmented-btn ${theme === opt.id ? "active" : ""}`} onClick={() => { setTheme(opt.id); previewAppearance({ theme: opt.id }); markChanged(); }}>
                      <span className="segmented-icon">{opt.icon}</span><span>{opt.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="settings-card">
                <label className="settings-field-label">Theme Style</label>
                <p className="settings-field-hint">Choose the overall surface style for the entire app — cards, modals and panels.</p>
                <div className="skin-picker-grid">
                  {SKINS.map((sk) => (
                    <button
                      key={sk.id}
                      className={`skin-card skin-card--${sk.id} ${skin === sk.id ? "active" : ""}`}
                      onClick={() => selectSkin(sk.id)}
                      title={sk.desc}
                    >
                      <span className="skin-card-preview" aria-hidden="true">
                        <span className="skin-chip skin-chip-1" />
                        <span className="skin-chip skin-chip-2" />
                      </span>
                      <span className="skin-card-meta">
                        <span className="skin-card-name">
                          {sk.label}
                          <span className="skin-graphics-badge" data-level={sk.graphics}>{sk.graphics} graphics</span>
                        </span>
                        <span className="skin-card-desc">{sk.desc}</span>
                      </span>
                      {skin === sk.id && (
                        <span className="skin-card-check">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>
                        </span>
                      )}
                    </button>
                  ))}
                </div>

                {/* Ask whether the newly chosen theme should become the default */}
                {skin !== defaultSkin && sessionOnlySkin !== skin && (
                  <div className="skin-default-prompt" key={skin}>
                    <span className="skin-default-prompt-text">
                      <span aria-hidden="true">{SKINS.find((s) => s.id === skin)?.icon}</span>
                      Make <strong>{SKINS.find((s) => s.id === skin)?.label}</strong> your default theme?
                    </span>
                    <span className="skin-default-prompt-actions">
                      <button className="skin-prompt-btn ghost" onClick={() => setSessionOnlySkin(skin)}>Just this session</button>
                      <button className="skin-prompt-btn solid" onClick={makeSkinDefault}>Set as default</button>
                    </span>
                  </div>
                )}
                {justSetDefault && skin === defaultSkin && (
                  <span className="skin-default-saved">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>
                    {SKINS.find((s) => s.id === skin)?.label} is now your default theme
                  </span>
                )}
              </div>

              <div className="settings-card">
                <label className="settings-field-label">Accent Color</label>
                <p className="settings-field-hint">Choose a primary brand color for highlights and accents.</p>
                <div className="accent-color-row">
                  {ACCENT_COLORS.map((c) => (
                    <button key={c.value} className={`accent-swatch ${accentColor === c.value ? "active" : ""}`} style={{ "--swatch-color": c.value }} onClick={() => { setAccentColor(c.value); previewAppearance({ accentColor: c.value }); markChanged(); }} title={c.name}>
                      {accentColor === c.value && (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>)}
                    </button>
                  ))}
                </div>
              </div>

              <div className="settings-card">
                <label className="settings-field-label">Text / Font Size</label>
                <Select className="settings-select-ui" value={fontSize} onChange={(v) => { setFontSize(v); previewAppearance({ fontSize: v }); markChanged(); }}
                  options={FONT_SIZES.map((fs) => ({ value: fs, label: fs }))} ariaLabel="Font size" />
              </div>
            </section>

            {/* ─── GENERAL PREFERENCES ─── */}
            <section id="settings-section-general" className="settings-section" style={{ display: activeSection === "general" ? undefined : "none" }}>
              <div className="settings-section-header"><SectionIcon icon="sliders" size={20} /><h3>General Preferences</h3></div>
              <p className="settings-section-desc">
                {showDefaultView ? "Configure your start page, the assistant and motion effects." : "Configure the assistant and motion effects."}
              </p>

              {showDefaultView && (
                <div className="settings-card">
                  <label className="settings-field-label">Default View</label>
                  <p className="settings-field-hint">Choose the page that opens when you sign in.</p>
                  <Select className="settings-select-ui" value={defaultView} onChange={(v) => { setDefaultView(v); markChanged(); }}
                    options={DEFAULT_VIEWS} ariaLabel="Default view" />
                </div>
              )}

              <div className="settings-card">
                <label className="settings-field-label">AI Assistant (Caddy)</label>
                {terms.tech ? (
                  <p className="settings-field-hint">
                    <strong>Caddy</strong> (the Caduceus assistant). The Gemini API key is configured
                    securely on the server — it's never exposed in the app. Everyday questions and edits: <strong>{getGeminiModels()[0]}</strong>; bigger jobs (a new project, several steps, many projects): <strong>{getDeepModels()[0]}</strong>; the New Task planner: <strong>{getPlannerModels()[0]}</strong>. Each falls back to the next model if one is busy.
                  </p>
                ) : (
                  <p className="settings-field-hint">
                    <strong>Caddy</strong> (the Caduceus assistant) is the built-in helper — ask it where
                    things are in Hermes or for a hand with your projects.
                  </p>
                )}
                <div className="settings-toggle-row">
                  <div className="toggle-info">
                    <span className="toggle-label">Enable Caddy assistant</span>
                    <span className="toggle-desc">Show the floating ✦ launcher, its pop-up tips and the chat panel, and start New Task with the “Plan with AI” step.</span>
                  </div>
                  <label className="toggle-switch">
                    <input
                      type="checkbox"
                      checked={caddyEnabled}
                      onChange={(e) => { setCaddyEnabled(e.target.checked); setCaddyEnabledState(e.target.checked); }}
                    />
                    <span className="toggle-slider" />
                  </label>
                </div>
              </div>

              <div className="settings-card">
                <label className="settings-field-label">Motion & Fun Effects</label>
                <p className="settings-field-hint">
                  The playful robotic touches. Each one is yours to keep or kill — changes apply instantly.
                </p>
                <div className="settings-toggle-row">
                  <div className="toggle-info">
                    <span className="toggle-label">Camera follows the cursor</span>
                    <span className="toggle-desc">The view zooms in and follows your pointer over the content, and zooms back out at the header — like a camera adjusting its aim. Also zooms the board toward a card as you open it.</span>
                  </div>
                  <label className="toggle-switch">
                    <input type="checkbox" checked={fxPrefs.cameraFollow} onChange={(e) => toggleFx("cameraFollow", e.target.checked)} />
                    <span className="toggle-slider" />
                  </label>
                </div>
                <div className="settings-toggle-row">
                  <div className="toggle-info">
                    <span className="toggle-label">Robotic arms on the nav buttons</span>
                    <span className="toggle-desc">Hovering a nav button makes robotic arms reach out and try (and fail) to catch your cursor.</span>
                  </div>
                  <label className="toggle-switch">
                    <input type="checkbox" checked={fxPrefs.roboArms} onChange={(e) => toggleFx("roboArms", e.target.checked)} />
                    <span className="toggle-slider" />
                  </label>
                </div>
                <div className="settings-toggle-row">
                  <div className="toggle-info">
                    <span className="toggle-label">Robotic hand cursor</span>
                    <span className="toggle-desc">Your cursor is a robotic hand — open while roaming, grabbing over nav buttons, a fist while clicking.</span>
                  </div>
                  <label className="toggle-switch">
                    <input type="checkbox" checked={fxPrefs.roboCursor} onChange={(e) => toggleFx("roboCursor", e.target.checked)} />
                    <span className="toggle-slider" />
                  </label>
                </div>
              </div>
            </section>

            {/* ─── ACCOUNT & PROFILE ─── */}
            <section id="settings-section-account" className="settings-section" style={{ display: activeSection === "account" ? undefined : "none" }}>
              <div className="settings-section-header"><SectionIcon icon="user" size={20} /><h3>Account & Profile</h3></div>
              <p className="settings-section-desc">Manage your personal information, password and security question.</p>

              <div className="settings-card">
                <label className="settings-field-label">Profile Details</label>
                <div className="profile-details-row">
                  <div className="avatar-section">
                    <div className="avatar-wrapper" onClick={() => avatarInputRef.current?.click()}>
                      {avatarUrl ? (<img src={avatarUrl} alt="Avatar" className="avatar-img" />) : (
                        <div className="avatar-placeholder"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg></div>
                      )}
                      <div className="avatar-overlay"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" /></svg><span>Change</span></div>
                      <input ref={avatarInputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handleAvatarUpload} />
                    </div>
                    {avatarUrl && (
                      <button className="avatar-remove-btn" onClick={(e) => { e.stopPropagation(); setAvatarUrl(null); markChanged(); }}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18m-2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                        Remove
                      </button>
                    )}
                  </div>
                  <div className="profile-fields">
                    <div className="settings-field">
                      <label className="settings-input-label">Username</label>
                      <input type="text" className="settings-input" value={username} onChange={(e) => { setUsername(e.target.value); markChanged(); }} placeholder="Your display name" />
                    </div>
                    <div className="settings-field">
                      <label className="settings-input-label">Bio <span className="char-count">{bio.length}/150</span></label>
                      <textarea className="settings-textarea" value={bio} onChange={(e) => { if (e.target.value.length <= 150) { setBio(e.target.value); markChanged(); } }} placeholder="Tell us a little about yourself..." rows={2} maxLength={150} />
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                      <div className="settings-field">
                        <label className="settings-input-label">Country</label>
                        <input type="text" className="settings-input" value={country} onChange={(e) => { setCountry(e.target.value); markChanged(); }} placeholder="e.g. Philippines" />
                      </div>
                      <div className="settings-field">
                        <label className="settings-input-label">Status</label>
                        <input type="text" className="settings-input" value={status} onChange={(e) => { setStatus(e.target.value); markChanged(); }} placeholder="e.g. Working from home" />
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="settings-card">
                <label className="settings-field-label">Email Address</label>
                <p className="settings-field-hint">This is the email you sign in with, and it can't be changed in the app. If it's wrong, ask a Manager to add you under the right email (Staff Management) and remove the old account.</p>
                <div className="email-update-row">
                  <input type="email" className="settings-input settings-input--locked" value={email} readOnly aria-readonly="true" title="Sign-in email changes are done by an admin" />
                </div>
              </div>

              <div className="settings-card">
                <label className="settings-field-label">Password Management</label>
                <p className="settings-field-hint">Ensure your account remains secure by using a strong password.</p>
                <div className="password-fields">
                  <div className="settings-field"><label className="settings-input-label">Current Password</label><input type="password" className="settings-input" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} placeholder="••••••••" /></div>
                  <div className="password-new-row">
                    <div className="settings-field"><label className="settings-input-label">New Password</label><input type="password" className="settings-input" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="Min. 6 characters" /></div>
                    <div className="settings-field"><label className="settings-input-label">Confirm New Password</label><input type="password" className="settings-input" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Re-enter new password" /></div>
                  </div>
                  <button className="settings-btn-primary" onClick={handleChangePassword} disabled={changingPassword}>{changingPassword ? "Changing…" : "Change Password"}</button>
                </div>
              </div>

              <div className="settings-card">
                <label className="settings-field-label">Security Question</label>
                <p className="settings-field-hint">
                  Used by “Forgot Password?” on the sign-in screen.
                  {currentUserProfile?.securityQuestion
                    ? <> Your current question: <strong>“{currentUserProfile.securityQuestion}”</strong> — enter a new question and answer below to replace it.</>
                    : currentUserProfile !== undefined && " You haven't set one yet."}
                </p>
                <div className="password-fields">
                  <div className="settings-field">
                    <label className="settings-input-label">Your Secret Question</label>
                    <input type="text" className="settings-input" value={securityQuestion} onChange={(e) => setSecurityQuestion(e.target.value)} placeholder="e.g. What was the name of your first pet?" />
                  </div>
                  <div className="settings-field" style={{ marginTop: 10 }}>
                    <label className="settings-input-label">Your Secret Answer</label>
                    <input type="text" className="settings-input" value={securityAnswer} onChange={(e) => setSecurityAnswer(e.target.value)} placeholder="Type your answer here..." />
                  </div>
                  <button className="settings-btn-primary" onClick={handleUpdateSecurityQuestion} style={{ marginTop: 15 }}>Update Security Question</button>
                </div>
              </div>

              <div className="settings-card">
                <label className="settings-field-label">Session</label>
                <p className="settings-field-hint">
                  Sign out of Hermes on this device. Need your account removed? An Admin+ or Manager can do that in Settings → Staff Management.
                </p>
                <div style={{ display: "flex", gap: "10px" }}>
                  <button
                    className="settings-btn-outline" 
                    onClick={onLogout}
                    style={{ borderColor: "var(--color-logout)", color: "var(--color-logout)" }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>
                    LOGOUT
                  </button>
                </div>
              </div>
            </section>

            {/* ─── NOTIFICATIONS ─── */}
            <section id="settings-section-notifications" className="settings-section" style={{ display: activeSection === "notifications" ? undefined : "none" }}>
              <div className="settings-section-header"><SectionIcon icon="bell" size={20} /><h3>Notifications</h3></div>
              <p className="settings-section-desc">Control how and when you receive alerts.</p>

              <div className="settings-card notification-master">
                <div className="settings-toggle-row">
                  <div className="toggle-info">
                    <span className="toggle-label master">Push / Desktop Notifications</span>
                    <span className="toggle-desc">
                      Browser pop-ups on this device for mentions, project updates, milestones, notes and {terms.tech ? "new features and bugs" : "roadblocks flagged or cleared"}.
                      Turning this off only silences the pop-ups — the bell in the header still lists everything.
                    </span>
                  </div>
                  <label className="toggle-switch large"><input type="checkbox" checked={notificationsEnabled} onChange={(e) => { setNotificationsEnabled(e.target.checked); markChanged(); }} /><span className="toggle-slider" /></label>
                </div>
              </div>

              {isAdminPlus && (
                <div className="settings-card cliq-reminders-card">
                  <div className="settings-toggle-row">
                    <div className="toggle-info">
                      <span className="toggle-label master">Cliq reminders for late projects</span>
                      <span className="toggle-desc">
                        Weekdays at 9:00 AM (Manila), Hermes messages people on Zoho Cliq: each project owner about their projects that are
                        overdue or due in the next 3 days, and each Manager about every overdue project. One switch for every workspace;
                        it saves as soon as you flip it.
                      </span>
                      {cliqReminders && (
                        <span className={`cliq-status ${cliqReminders.enabled ? "on" : "off"}`}>
                          {!cliqReminders.enabled
                            ? `Off${cliqReminders.updatedBy ? ` since ${fmtDay(cliqReminders.updatedAt)} (${cliqReminders.updatedBy})` : ""}. Nobody gets Cliq reminders until it's turned back on.`
                            : cliqReminders.lastRun
                              ? `Last sent ${fmtDay(cliqReminders.lastRun.at)} at ${fmtTime(cliqReminders.lastRun.at)} to ${cliqReminders.lastRun.sent} ${cliqReminders.lastRun.sent === 1 ? "person" : "people"}${cliqReminders.lastRun.failed ? ` (${cliqReminders.lastRun.failed} couldn't be reached on Cliq)` : ""}.`
                              : "On. The first reminders go out the next weekday at 9:00 AM."}
                        </span>
                      )}
                    </div>
                    <label className="toggle-switch large">
                      <input
                        type="checkbox"
                        aria-label="Cliq reminders for late projects"
                        checked={cliqReminders?.enabled ?? true}
                        disabled={cliqReminders === undefined || cliqSaving}
                        onChange={(e) => toggleCliqReminders(e.target.checked)}
                      />
                      <span className="toggle-slider" />
                    </label>
                  </div>
                </div>
              )}
            </section>

            {/* ─── ACCOUNT KNOWLEDGE (Operations — anyone on an account) ─── */}
            {SECTIONS.some((x) => x.id === "knowledge") && (
              <section id="settings-section-knowledge" className="settings-section" style={{ display: activeSection === "knowledge" ? undefined : "none" }}>
                <div className="settings-section-header"><SectionIcon icon="book" size={20} /><h3>Account Knowledge</h3></div>
                <p className="settings-section-desc">
                  Each client account's SOPs and notes. When someone plans a project for an account, the AI reads these first and builds the
                  milestones around how that account actually works. Anyone on an account can add and edit; Admins (or whoever added it) can delete.
                </p>
                <AccountKnowledge showModal={showModal} userName={userName} />
              </section>
            )}

            {/* ─── ANNOUNCEMENTS (Admin+ only) ─── */}
            {isAdminPlus && (
              <section id="settings-section-announcements" className="settings-section" style={{ display: activeSection === "announcements" ? undefined : "none" }}>
                <div className="settings-section-header"><SectionIcon icon="megaphone" size={20} /><h3>Announcements</h3></div>
                <p className="settings-section-desc">
                  Post a message to everyone in {terms.label}. It pops up once for each person, and you can see who has read it.
                  Other workspaces keep their own announcements.
                </p>
                <AnnouncementComposer showModal={showModal} staff={allStaff || []} />
              </section>
            )}

            {/* ─── WORKSPACE DEFAULTS (Admin+ only) ─── */}
            {isAdminPlus && (
              <section id="settings-section-workspace" className="settings-section" style={{ display: activeSection === "workspace" ? undefined : "none" }}>
                <div className="settings-section-header"><SectionIcon icon="target" size={20} /><h3>Workspace Defaults</h3></div>
                <p className="settings-section-desc">
                  Standards shared by everyone in {terms.label} — the milestone template for new projects,
                  the {terms.tech ? "production deadline" : "key target date"}, the board columns and the workspace password.
                  Other workspaces keep their own.
                </p>

                {/* Default milestone template */}
                <div className="settings-card">
                  <label className="settings-field-label">Default Milestone Template</label>
                  <p className="settings-field-hint">
                    New projects start from these milestones (and their day counts) when someone picks “Skip AI” on New Task or
                    Caddy is off, and the AI planner uses them as its reference for naming and typical timing. Saving applies to everyone in {terms.label}.
                  </p>
                  <div className="template-rows">
                    {templateRows.map((m, idx) => (
                      <div key={idx} className="template-row">
                        <span className="template-row-num">M{idx + 1}</span>
                        <input
                          type="text"
                          className="settings-input"
                          value={m.name}
                          placeholder="Milestone name"
                          onChange={(e) => updateTemplateRow(idx, "name", e.target.value)}
                        />
                        <input
                          type="number"
                          min="0"
                          className="settings-input template-days-input"
                          value={m.days}
                          onChange={(e) => updateTemplateRow(idx, "days", e.target.value)}
                        />
                        <span className="template-days-suffix">days</span>
                        <button
                          className="template-row-remove"
                          title="Remove milestone"
                          onClick={() => { templateDirty.current = true; setTemplateRows((prev) => prev.filter((_, i) => i !== idx)); }}
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                  <div className="template-toolbar">
                    <button
                      className="settings-btn-outline"
                      onClick={() => { templateDirty.current = true; setTemplateRows((prev) => [...prev, { name: "", days: 0 }]); }}
                    >
                      + Add Milestone
                    </button>
                    <span className="template-total">
                      Total: <strong>{templateTotalDays} days</strong> (~{(templateTotalDays / 30).toFixed(1)} months)
                    </span>
                  </div>
                  <div style={{ display: "flex", gap: 10, marginTop: 16, flexWrap: "wrap" }}>
                    <button className="settings-btn-primary" disabled={savingTemplate} onClick={() => handleSaveTemplate(templateRows)}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>
                      {savingTemplate ? "Saving…" : "Save Template for Everyone"}
                    </button>
                    <button
                      className="settings-btn-ghost"
                      onClick={() => {
                        showModal({
                          title: "Restore Original Template",
                          message: `Reset the template to the original ${fallbackMilestonesFor(workspace).reduce((s, m) => s + m.days, 0)}-day standard for this workspace? This saves immediately for everyone.`,
                          type: "confirm",
                          onConfirm: () => handleSaveTemplate(fallbackMilestonesFor(workspace)),
                        });
                      }}
                    >
                      Restore Original
                    </button>
                  </div>
                </div>

                {/* Full production deadline (Workforce) / key target date (other workspaces) */}
                <div className="settings-card">
                  <label className="settings-field-label">{terms.tech ? "Full Production Deadline" : "Key Target Date"}</label>
                  <p className="settings-field-hint">
                    {terms.tech
                      ? "The target date for Hermes to be deployed in full production."
                      : `The date the ${terms.label} team is working toward.`}
                    {" "}Shown at the top of the Overview.
                  </p>
                  <div className="email-update-row">
                    <DatePicker className="settings-date-picker" value={prodDeadlineInput} onChange={setProdDeadlineInput} placeholder="Pick a date" />
                    <button className="settings-btn-primary" onClick={handleSaveProdDeadline}>{terms.tech ? "Set Deadline" : "Set Date"}</button>
                    {appConfig?.productionDeadline && (
                      <button
                        className="settings-btn-outline"
                        onClick={() => {
                          showModal({
                            title: terms.tech ? "Clear Deadline" : "Clear Target Date",
                            message: terms.tech ? "Remove the production deadline from the Overview?" : "Remove the key target date from the Overview?",
                            type: "confirm",
                            onConfirm: async () => {
                              await saveAppConfigMut({ workspace, productionDeadline: null, updatedBy: userName });
                              setProdDeadlineInput("");
                            },
                          });
                        }}
                      >
                        Clear
                      </button>
                    )}
                  </div>
                </div>

                {/* Kanban board columns */}
                <div className="settings-card">
                  <label className="settings-field-label">Board Columns</label>
                  <p className="settings-field-hint">
                    {terms.tech
                      ? "Customize this workspace's Kanban columns — rename, recolor, reorder, set an optional max (WIP) limit, add new columns, or remove empty ones."
                      : `Customize the ${terms.label} board's columns — rename, recolor, reorder, set an optional max number of projects per column, add new columns, or remove empty ones.`}
                    {" "}A column that still has {cardWord}s can't be removed until it's emptied.
                  </p>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {columnRows.map((c, idx) => {
                      const count = columnTaskCounts[c.id] || 0;
                      return (
                        <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 8, background: "var(--color-bg-subtle)", border: "1px solid var(--glass-border)", borderRadius: 10, padding: "8px 10px" }}>
                          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                            <button title="Move up" disabled={idx === 0} onClick={() => moveColumnRow(idx, -1)} style={{ border: "none", background: "none", cursor: idx === 0 ? "default" : "pointer", opacity: idx === 0 ? 0.3 : 0.7, fontSize: "0.6rem", lineHeight: 1, padding: 0 }}>▲</button>
                            <button title="Move down" disabled={idx === columnRows.length - 1} onClick={() => moveColumnRow(idx, 1)} style={{ border: "none", background: "none", cursor: idx === columnRows.length - 1 ? "default" : "pointer", opacity: idx === columnRows.length - 1 ? 0.3 : 0.7, fontSize: "0.6rem", lineHeight: 1, padding: 0 }}>▼</button>
                          </div>
                          <input type="color" value={c.color} onChange={(e) => updateColumnRow(idx, "color", e.target.value)} title="Column color" style={{ width: 32, height: 32, border: "none", background: "none", cursor: "pointer", padding: 0, flexShrink: 0 }} />
                          <input type="text" className="settings-input" value={c.label} placeholder="Column name" onChange={(e) => updateColumnRow(idx, "label", e.target.value)} style={{ flex: 1, minWidth: 0 }} />
                          <input type="number" min="0" className="settings-input" value={c.limit ?? ""} placeholder="∞" title={terms.tech ? "Max tasks (WIP limit) — blank = no limit" : "Max projects in this column — blank = no limit"} onChange={(e) => updateColumnRow(idx, "limit", e.target.value)} style={{ width: 62, flexShrink: 0 }} />
                          <span title={terms.tech ? "Tasks currently in this column" : "Projects currently in this column"} style={{ fontSize: "0.62rem", fontWeight: 800, color: count > 0 ? "var(--color-accent)" : "#94a3b8", minWidth: 46, textAlign: "center", flexShrink: 0 }}>{count} {cardWord}{count === 1 ? "" : "s"}</span>
                          <button className="template-row-remove" title={count > 0 ? "Empty this column first" : "Remove column"} onClick={() => removeColumnRow(idx)} style={{ opacity: count > 0 ? 0.4 : 1, flexShrink: 0 }}>×</button>
                        </div>
                      );
                    })}
                  </div>
                  <div className="template-toolbar" style={{ marginTop: 12 }}>
                    <button className="settings-btn-outline" onClick={addColumnRow}>+ Add Column</button>
                  </div>
                  <div style={{ display: "flex", gap: 10, marginTop: 16, flexWrap: "wrap" }}>
                    <button className="settings-btn-primary" disabled={savingColumns} onClick={handleSaveColumns}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>
                      {savingColumns ? "Saving…" : "Save Board Columns"}
                    </button>
                    <button
                      className="settings-btn-ghost"
                      onClick={() => {
                        const defaults = defaultColumnsFor(workspace);
                        // Same rule as removing one column: a column that still holds
                        // cards can't disappear (they'd be pushed into the first column).
                        const stranded = columnRows
                          .filter((c) => !defaults.some((d) => d.id === c.id))
                          .map((c) => ({ c, n: (allTasks || []).filter((t) => taskInColumn(t.status, c.id) && !defaults.some((d) => taskInColumn(t.status, d.id))).length }))
                          .filter((x) => x.n > 0);
                        if (stranded.length) {
                          showModal({
                            title: "Columns Not Empty",
                            message: `These columns aren't in the standard board and still have ${cardWord}s: ${stranded.map((x) => `"${x.c.label}" (${x.n})`).join(", ")}. Move them to another column first, then restore the defaults.`,
                            type: "alert",
                          });
                          return;
                        }
                        showModal({
                          title: "Restore Default Columns",
                          message: `Reset this workspace's board to its standard ${defaults.length} columns (${defaults.map((c) => c.label).join(" → ")})? Existing ${cardWord}s keep their statuses. Click "Save Board Columns" afterwards to apply it.`,
                          type: "confirm",
                          onConfirm: () => { columnsDirty.current = true; setColumnRows(defaultColumnsFor(workspace)); },
                        });
                      }}
                    >
                      Restore Default Columns
                    </button>
                  </div>
                </div>

                {/* Workspace entry password */}
                <div className="settings-card">
                  <label className="settings-field-label">Workspace Password</label>
                  <p className="settings-field-hint">
                    Require a password to open this workspace. Leave blank for open access —
                    {appConfig?.workspacePasswordHash
                      ? " a password is currently set."
                      : " no password is set, so anyone with access can enter."}
                    {" "}The Main Admin can always enter, and people already inside keep access until they leave.
                  </p>
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                    <input
                      type="password"
                      className="settings-input"
                      autoComplete="new-password"
                      placeholder={appConfig?.workspacePasswordHash ? "Enter a new password to change it" : "Set a password"}
                      value={wsPwInput}
                      onChange={(e) => setWsPwInput(e.target.value)}
                      style={{ flex: 1, minWidth: 220 }}
                    />
                    <button
                      className="settings-btn-primary"
                      disabled={savingWsPw || !wsPwInput.trim()}
                      onClick={async () => {
                        const pw = wsPwInput.trim();
                        if (!pw) return;
                        setSavingWsPw(true);
                        try {
                          const workspacePasswordHash = await hashPassword(pw);
                          await saveAppConfigMut({ workspace, workspacePasswordHash, updatedBy: userName });
                          // Keep the setter in this workspace — don't gate them on the password they just set.
                          markWorkspaceUnlocked(workspace);
                          setWsPwInput("");
                          showModal({ title: "Password Set", message: `${workspaceLabel(workspace)} now requires this password to enter.`, type: "success" });
                        } catch (err) {
                          showModal({ title: "Couldn't Save", message: err.message || "Failed to set the workspace password.", type: "alert" });
                        } finally {
                          setSavingWsPw(false);
                        }
                      }}
                    >
                      {savingWsPw ? "Saving…" : (appConfig?.workspacePasswordHash ? "Change Password" : "Set Password")}
                    </button>
                    {appConfig?.workspacePasswordHash && (
                      <button
                        className="settings-btn-ghost"
                        disabled={savingWsPw}
                        onClick={() => {
                          showModal({
                            title: "Remove Workspace Password",
                            message: `Remove the password on ${workspaceLabel(workspace)}? Anyone with access will be able to enter without a password.`,
                            type: "confirm",
                            onConfirm: async () => {
                              setSavingWsPw(true);
                              try {
                                await saveAppConfigMut({ workspace, workspacePasswordHash: null, updatedBy: userName });
                                showModal({ title: "Password Removed", message: `${workspaceLabel(workspace)} is now open (no password required).`, type: "success" });
                              } catch (err) {
                                showModal({ title: "Couldn't Remove", message: err.message || "Failed to remove the password.", type: "alert" });
                              } finally {
                                setSavingWsPw(false);
                              }
                            },
                          });
                        }}
                      >
                        Remove Password
                      </button>
                    )}
                  </div>
                </div>
              </section>
            )}

            {/* ─── CLIENT ACCOUNTS (Operations — everyone sees, Admin+/Manager manage) ─── */}
            {hasAccounts && (
              <section id="settings-section-accounts" className="settings-section" style={{ display: activeSection === "accounts" ? undefined : "none" }}>
                <div className="settings-section-header"><SectionIcon icon="briefcase" size={20} /><h3>Client Accounts</h3></div>
                <p className="settings-section-desc">
                  Every {terms.label} project can belong to a client account — pick it when you create or edit a project.
                </p>

                <div className="settings-card acct-card">
                  <label className="settings-field-label" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    Accounts
                    {accounts?.length > 0 && <span className="acct-total">{accounts.length}</span>}
                  </label>
                  <p className="settings-field-hint">
                    {isAdminPlus
                      ? "Add, rename or delete the accounts projects are filed under. Deleting an account never deletes its projects — they just become \"No account\"."
                      : "Only Admin+ can create accounts. Ask an Admin+ or Manager if the one you need is missing."}
                  </p>

                  {isAdminPlus && (
                    <form className="acct-add-row" onSubmit={(e) => { e.preventDefault(); handleAddAccount(); }}>
                      <input
                        type="text"
                        className="settings-input"
                        value={newAccountName}
                        maxLength={80}
                        placeholder="New account name, e.g. Acme Health"
                        aria-label="New account name"
                        onChange={(e) => setNewAccountName(e.target.value)}
                      />
                      <button type="submit" className="settings-btn-primary" disabled={addingAccount || !newAccountName.trim()}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                        {addingAccount ? "Adding…" : "Add Account"}
                      </button>
                    </form>
                  )}

                  {accounts === undefined ? (
                    <div className="acct-empty">Loading accounts…</div>
                  ) : accounts.length === 0 ? (
                    <div className="acct-empty">No accounts yet.{isAdminPlus ? " Add the first one above." : ""}</div>
                  ) : (
                    <div className="staff-management-list acct-list">
                      {accounts.map((a, i) => {
                        const editing = editingAccount?.id === a._id;
                        const n = Number(a.projects) || 0;
                        return (
                          <div key={a._id} className="staff-mgmt-row acct-row" style={{ "--i": i }}>
                            <span className="acct-avatar" aria-hidden="true">{(a.name || "?").trim().charAt(0).toUpperCase()}</span>
                            <div className="staff-mgmt-info" style={{ flex: 1, minWidth: 0 }}>
                              {editing ? (
                                <input
                                  type="text"
                                  className="settings-input acct-rename-input"
                                  value={editingAccount.name}
                                  maxLength={80}
                                  autoFocus
                                  aria-label={`New name for ${a.name}`}
                                  onChange={(e) => setEditingAccount({ id: a._id, name: e.target.value })}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") handleRenameAccount();
                                    if (e.key === "Escape") setEditingAccount(null);
                                  }}
                                />
                              ) : (
                                <span className="staff-mgmt-name">{a.name}</span>
                              )}
                              <span className="staff-mgmt-email">{n} project{n === 1 ? "" : "s"}</span>
                            </div>
                            {isAdminPlus && (
                              <div className="staff-mgmt-actions">
                                {editing ? (
                                  <>
                                    <button className="staff-action-btn approve" onClick={handleRenameAccount}>Save</button>
                                    <button className="staff-action-btn acct-cancel" onClick={() => setEditingAccount(null)}>Cancel</button>
                                  </>
                                ) : (
                                  <>
                                    <button className="staff-action-btn reset-pw" title="Rename this account" onClick={() => setEditingAccount({ id: a._id, name: a.name })}>
                                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" /></svg>
                                      Rename
                                    </button>
                                    <button className="staff-action-btn revoke" title="Delete this account" onClick={() => handleDeleteAccount(a)}>
                                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                                      Delete
                                    </button>
                                  </>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </section>
            )}

            {/* ─── STAFF MANAGEMENT (Admin+ only) ─── */}
            {isAdminPlus && (
              <section id="settings-section-staff" className="settings-section" style={{ display: activeSection === "staff" ? undefined : "none" }}>
                <div className="settings-section-header"><SectionIcon icon="shield" size={20} /><h3>Staff Management</h3></div>
                <p className="settings-section-desc">Manage team members, approve access requests, and reset credentials.</p>

                {/* Pending Access Requests */}
                <div className="settings-card">
                  <label className="settings-field-label" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" strokeWidth="2.5"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
                    Pending Access Requests
                    {pendingRequests.length > 0 && (
                      <span style={{ background: "var(--color-logout)", color: "white", borderRadius: "20px", padding: "2px 10px", fontSize: "0.7rem", fontWeight: 800, marginLeft: "4px" }}>{pendingRequests.length}</span>
                    )}
                  </label>
                  {pendingRequests.length > 0 ? (
                    <div className="staff-management-list">
                      {pendingRequests.map((s) => (
                        <div key={s.email} className="staff-mgmt-row pending">
                          <div className="staff-mgmt-avatar" onClick={() => onViewProfile && onViewProfile(s)}>
                            {s.avatarUrl ? <img src={s.avatarUrl} alt={s.name} /> : (
                              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
                            )}
                          </div>
                          <div className="staff-mgmt-info">
                            <span className="staff-mgmt-name">{s.name}</span>
                            <span className="staff-mgmt-email">{s.email}</span>
                          </div>
                          <div className="staff-mgmt-actions">
                            <button
                              className="staff-action-btn approve"
                              onClick={async () => {
                                try {
                                  // Approved INTO this workspace (the request itself doesn't say which).
                                  await approveStaffMut({ email: s.email, workspace });
                                  showModal({ title: "Approved", message: `${s.name} can now sign in to ${terms.label} as ${roleLabel("Programmer", workspace)}.${hasAccounts ? " Pick their client account(s) below if they should only see those." : ""}`, type: "success" });
                                } catch (err) {
                                  showModal({ title: "Error", message: err.message, type: "alert" });
                                }
                              }}
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>
                              Approve
                            </button>
                            <button
                              className="staff-action-btn reject"
                              onClick={async () => {
                                try {
                                  await deleteStaffMut({ email: s.email });
                                  showModal({ title: "Rejected", message: `Access for ${s.name} has been rejected.`, type: "success" });
                                } catch (err) {
                                  showModal({ title: "Error", message: err.message, type: "alert" });
                                }
                              }}
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                              Reject
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div style={{ textAlign: "center", color: "var(--color-text-secondary)", fontStyle: "italic", padding: "24px", background: "var(--color-bg-subtle)", borderRadius: "var(--radius-md)", border: "1px dashed var(--glass-border)", fontSize: "0.85rem" }}>
                      No pending access requests.
                    </div>
                  )}
                </div>

                {/* Active Staff */}
                <div className="settings-card">
                  <label className="settings-field-label">Team Members</label>
                  <p className="settings-field-hint">
                    Everyone's access in one place: their <b>role</b> (Access Type), the <b>workspaces</b> they can open (Department Membership — exactly what's lit up)
                    {staffAccountsUi ? <>, and their <b>client accounts</b> in Operations</> : null}. Reset passwords or revoke access from the same row.
                    {!canEditDepartments && " Workspaces are view-only for you — only Managers can change them."}
                  </p>
                  {staffAccountsUi && (
                    <p className="settings-field-hint staff-acc-hint">
                      <b>Client accounts (Operations):</b> Users and Admins only see the projects of the accounts they're on — being assigned to a project in another account doesn't open it. With <b>no account they're locked out</b> of Operations projects until you add them to one. Admin+ and Managers always see every account.
                    </p>
                  )}
                  <div className="staff-management-list">
                    {activeStaff.map((s) => (
                      <div key={s.email} className="staff-mgmt-row staff-row-merged">
                        <div className="staff-mgmt-avatar" onClick={() => onViewProfile && onViewProfile(s)} style={{ cursor: "pointer" }}>
                          {s.avatarUrl ? <img src={s.avatarUrl} alt={s.name} /> : (
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
                          )}
                        </div>
                        <div className="staff-mgmt-info">
                          <span className="staff-mgmt-name" onClick={() => onViewProfile && onViewProfile(s)} style={{ cursor: "pointer" }}>{s.name}</span>
                          <span className="staff-mgmt-email">{s.email}</span>
                          <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                            <span style={{ fontSize: "0.6rem", color: "#94a3b8", display: "flex", alignItems: "center", gap: 3 }}>
                              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
                              Pass: <span style={{ color: s.password ? "var(--color-accent)" : "#94a3b8" }}>{s.password || "None"}</span>
                            </span>
                          </div>
                        </div>
                        <div className="staff-mgmt-actions">
                          <button
                            className="staff-action-btn reset-pw"
                            title="Reset password — user will need to set a new one on next login"
                            onClick={() => {
                              showModal({
                                title: "Reset Password",
                                message: `Are you sure you want to reset the password for ${s.name}? They will need to set a new password on their next login using the default password.`,
                                type: "confirm",
                                onConfirm: async () => {
                                  try {
                                    await resetPasswordMut({ targetEmail: s.email });
                                    showModal({ title: "Password Reset", message: `Password for ${s.name} has been reset successfully.`, type: "success" });
                                  } catch (err) {
                                    showModal({ title: "Error", message: err.message, type: "alert" });
                                  }
                                },
                              });
                            }}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
                            Reset PW
                          </button>
                          <button
                            className="staff-action-btn revoke"
                            title="Revoke this user's access"
                            onClick={() => {
                              showModal({
                                title: "Revoke Access",
                                message: `Are you sure you want to revoke access for ${s.name}? They will no longer be able to log in.`,
                                type: "confirm",
                                onConfirm: async () => {
                                  try {
                                    await deleteStaffMut({ email: s.email });
                                    showModal({ title: "Access Revoked", message: `Successfully removed access for ${s.name}.`, type: "success" });
                                  } catch (err) {
                                    showModal({ title: "Error", message: err.message, type: "alert" });
                                  }
                                },
                              });
                            }}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                            Revoke
                          </button>
                        </div>
                        {/* Everything this person can do, in one strip: role, workspaces, client accounts. */}
                        <div className="staff-access-strip">
                          <div className="staff-access-group staff-mgmt-role">
                            <span className="staff-access-cap">Role</span>
                              {(() => {
                                const isSelf = s.email.toLowerCase() === (userEmail || "").toLowerCase();
                                return (
                                  <Select
                                    size="sm"
                                    className="staff-role-select-ui"
                                    value={s.role}
                                    disabled={isSelf}
                                    ariaLabel={isSelf ? "You can't change your own role" : `Role for ${s.name}`}
                                    options={ASSIGNABLE_ROLES.map((r) => ({ value: r, label: roleLabel(r, workspace) }))}
                                    onChange={async (newRole) => {
                                      try {
                                        await updateStaffRole({ staffEmail: s.email, newRole, actorEmail: userEmail });
                                        showModal({ title: "Role Updated", message: `${s.name}'s role has been changed to ${roleLabel(newRole, workspace)}.`, type: "success" });
                                      } catch (err) {
                                        showModal({ title: "Action Blocked", message: err.message || "Could not change role.", type: "alert" });
                                      }
                                    }}
                                  />
                                );
                              })()}
                          </div>
                          <div className="staff-access-group">
                            <span className="staff-access-cap">Workspaces</span>
                              {/* Workspaces (Department Membership): Managers toggle, never their own. */}
                              {(() => {
                                const isSelf = s.email.toLowerCase() === (userEmail || "").toLowerCase();
                                const current = Array.isArray(s.departments) ? s.departments : [];
                                const locked = isSelf || !canEditDepartments;
                                return (
                                  <div className="staff-dept-row" role="group" aria-label={`Workspaces for ${s.name}`}>
                                    {DEPARTMENTS.map((dept) => {
                                      const on = current.includes(dept);
                                      return (
                                        <button
                                          key={dept}
                                          type="button"
                                          className={`staff-dept-chip ${on ? "on" : ""}`}
                                          aria-pressed={on}
                                          disabled={locked}
                                          title={isSelf ? "You can't change your own workspaces" : (!canEditDepartments ? "Only Managers can change workspaces" : on ? `Remove ${dept}` : `Give access to ${dept}`)}
                                          onClick={async () => {
                                            const next = on ? current.filter((d) => d !== dept) : [...current, dept];
                                            try {
                                              await updateStaffDepartmentMut({ staffEmail: s.email, departments: next, actorEmail: userEmail });
                                            } catch (err) {
                                              showModal({ title: "Action Blocked", message: err.message || "Could not update workspaces.", type: "alert" });
                                            }
                                          }}
                                        >
                                          {on && <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" aria-hidden="true"><polyline points="20 6 9 17 4 12" /></svg>}
                                          {dept}
                                        </button>
                                      );
                                    })}
                                  </div>
                                );
                              })()}
                          </div>
                          {staffAccountsUi && (Array.isArray(s.departments) && s.departments.includes(WORKSPACE_META[ACCOUNT_WS].department)) && (
                            <div className="staff-access-group">
                              <span className="staff-access-cap">Client accounts</span>
                              {(() => {
                                if (s.role === "Admin+" || s.role === "Manager") {
                                  return <span className="staff-acc-all" title="Admin+ and Managers always see every account">All accounts</span>;
                                }
                                const mine = accountsByEmail[s.email] || [];
                                if (!isAdminPlus) {
                                  const names = (accounts || []).filter((a) => mine.includes(a._id)).map((a) => a.name);
                                  return <span className="staff-acc-all">{names.length ? names.join(", ") : "None — locked"}</span>;
                                }
                                return (
                                  <MultiSelect
                                    size="sm"
                                    className="staff-acc-select"
                                    values={mine}
                                    options={(accounts || []).map((a) => ({ value: a._id, label: a.name }))}
                                    allLabel="None — locked"
                                    emptyText={hasAccounts ? "No client accounts yet — add one under Client Accounts." : "No client accounts yet — add one in Operations → Settings → Client Accounts."}
                                    ariaLabel={`Client accounts for ${s.name}`}
                                    onChange={async (ids) => {
                                      try {
                                        await setStaffAccountsMut({ email: s.email, workspace: ACCOUNT_WS, accountIds: ids });
                                      } catch (err) {
                                        showModal({ title: "Couldn't change accounts", message: err.message || "Please try again.", type: "alert" });
                                      }
                                    }}
                                  />
                                );
                              })()}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Add New Staff */}
                <div className="settings-card">
                  <label className="settings-field-label">Add New Staff Member</label>
                  <p className="settings-field-hint">Register a new team member with their email and assigned role.</p>
                  <div className="add-staff-form">
                    <div className="settings-field">
                      <label className="settings-input-label">Full Name</label>
                      <input type="text" className="settings-input" value={newStaffName} onChange={(e) => setNewStaffName(e.target.value)} placeholder="e.g. John Doe" />
                    </div>
                    <div className="settings-field">
                      <label className="settings-input-label">Email Address</label>
                      <input type="email" className="settings-input" value={newStaffEmail} onChange={(e) => setNewStaffEmail(e.target.value)} placeholder="e.g. jdoe@company.com" />
                    </div>
                    <div className="settings-field">
                      <label className="settings-input-label">Role</label>
                      <Select className="settings-select-ui" value={newStaffRole} onChange={setNewStaffRole}
                        options={ASSIGNABLE_ROLES.map((r) => ({ value: r, label: roleLabel(r, workspace) }))} ariaLabel="Role" />
                    </div>
                    <div className="settings-field">
                      <label className="settings-input-label">Department(s) — which workspaces they can access</label>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 14, paddingTop: 4 }}>
                        {DEPARTMENTS.map((dept) => {
                          const checked = newStaffDepartments.includes(dept);
                          return (
                            <label key={dept} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.8rem", fontWeight: 700, cursor: "pointer" }}>
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(e) =>
                                  setNewStaffDepartments((prev) =>
                                    e.target.checked ? [...prev, dept] : prev.filter((d) => d !== dept)
                                  )
                                }
                              />
                              {dept}
                            </label>
                          );
                        })}
                      </div>
                    </div>
                    <button
                      className="settings-btn-primary"
                      style={{ marginTop: "8px" }}
                      onClick={async () => {
                        if (!newStaffName.trim() || !newStaffEmail.trim()) {
                          showModal({ title: "Error", message: "Please fill in both name and email.", type: "alert" });
                          return;
                        }
                        if (newStaffDepartments.length === 0) {
                          showModal({ title: "Error", message: "Select at least one department, otherwise the user can't access any workspace.", type: "alert" });
                          return;
                        }
                        try {
                          await addStaffMut({ name: newStaffName.trim(), email: newStaffEmail.trim(), role: newStaffRole, departments: newStaffDepartments });
                          showModal({ title: "Staff Added", message: `${newStaffName} has been registered successfully.`, type: "success" });
                          setNewStaffName("");
                          setNewStaffEmail("");
                          setNewStaffRole("Programmer");
                          setNewStaffDepartments([defaultNewStaffDept]);
                        } catch (err) {
                          showModal({ title: "Error", message: err.message, type: "alert" });
                        }
                      }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                      Register Staff Member
                    </button>
                  </div>
                </div>
              </section>
            )}

            {/* ─── ARCHIVED PROJECTS ─── */}
            <section id="settings-section-archive" className="settings-section" style={{ display: activeSection === "archive" ? undefined : "none" }}>
              <div className="settings-section-header"><SectionIcon icon="archive" size={20} /><h3>Archived Projects</h3></div>
              <p className="settings-section-desc">
                {terms.tech ? "Scrapped" : "Archived"} projects are stored here.
                {canDeleteArchived ? " Restore them or delete permanently." : " Restore one to put it back on the board — only Admins can delete permanently."}
              </p>

              <div className="settings-card">
                <label className="settings-field-label" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-secondary)" strokeWidth="2.5"><polyline points="21 8 21 21 3 21 3 8" /><rect x="1" y="3" width="22" height="5" /><line x1="10" y1="12" x2="14" y2="12" /></svg>
                  {terms.tech ? "Scrapped / Archived" : (boardColumns.find((c) => c.id === ARCHIVED_STATUS)?.label || "Archived")}
                  {archivedTasks.length > 0 && (
                    <span style={{ background: "#94a3b8", color: "white", borderRadius: "20px", padding: "2px 10px", fontSize: "0.7rem", fontWeight: 800, marginLeft: "4px" }}>{archivedTasks.length}</span>
                  )}
                </label>
                {archivedTasks.length > 0 ? (
                  <div className="staff-management-list" style={{ maxHeight: 400, overflowY: "auto" }}>
                    {archivedTasks.map((t) => (
                      <div key={t._id} className="staff-mgmt-row" style={{ padding: "12px 14px" }}>
                        <div className="staff-mgmt-info" style={{ flex: 1 }}>
                          <span className="staff-mgmt-name" style={{ fontSize: "0.82rem" }}>{t.title}</span>
                          <span className="staff-mgmt-email">{t.assignee || "Unassigned"}</span>
                          <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                            <span style={{ fontSize: "0.6rem", color: "#94a3b8" }}>
                              Milestones: {t.completedMilestones || 0} / {(t.milestones || []).length}
                            </span>
                          </div>
                        </div>
                        <div className="staff-mgmt-actions" style={{ gap: 6 }}>
                          <button
                            className="staff-action-btn approve"
                            title={`Restore to ${restoreColumn.label}`}
                            onClick={() => {
                              // Restores into the board's first (non-archive) column
                              const target = restoreColumn;
                              showModal({
                                title: "Restore Project",
                                message: `Restore "${t.title}" back to the ${target.label} column?`,
                                type: "confirm",
                                onConfirm: async () => {
                                  try {
                                    await updateTaskStatus({ taskId: t._id, newStatus: target.id });
                                    showModal({ title: "Restored", message: `"${t.title}" has been moved back to ${target.label}.`, type: "success" });
                                  } catch (err) {
                                    showModal({ title: "Error", message: err.message, type: "alert" });
                                  }
                                },
                              });
                            }}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="1 4 1 10 7 10" /><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" /></svg>
                            Restore
                          </button>
                          {canDeleteArchived && (
                            <button
                              className="staff-action-btn revoke"
                              title="Permanently delete"
                              onClick={() => {
                                showModal({
                                  title: "Delete Permanently",
                                  message: `Are you sure you want to permanently delete "${t.title}"? This cannot be undone.`,
                                  type: "confirm",
                                  onConfirm: async () => {
                                    try {
                                      await deleteTask({ taskId: t._id, actorEmail: userEmail, actorName: userName, source: "archive" });
                                      showModal({ title: "Deleted", message: `"${t.title}" has been permanently deleted.`, type: "success" });
                                    } catch (err) {
                                      showModal({ title: "Error", message: err.message, type: "alert" });
                                    }
                                  },
                                });
                              }}
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                              Delete
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ textAlign: "center", color: "var(--color-text-secondary)", fontStyle: "italic", padding: "24px", background: "var(--color-bg-subtle)", borderRadius: "var(--radius-md)", border: "1px dashed var(--glass-border)", fontSize: "0.85rem" }}>
                    No archived projects.
                  </div>
                )}
              </div>
            </section>
          </div>
        </div>

        {/* Sticky Footer */}
        <div className={`settings-footer ${hasChanges ? "show" : ""}`}>
          <span className="settings-footer-hint">You have unsaved changes</span>
          <div className="settings-footer-actions">
            <button className="settings-btn-ghost" onClick={handleCancel}>Cancel</button>
            <button className="settings-btn-save" onClick={handleSave}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>Save Changes</button>
          </div>
        </div>
      </div>
    </div>
  );
}
