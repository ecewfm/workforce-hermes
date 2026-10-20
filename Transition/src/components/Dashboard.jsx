import { useState } from "react";
import DatePicker from "./ui/DatePicker";
import { useQuery, useMutation } from "../data/react";
import { api } from "../data/api";
import { getProjectDeadlines, deadlineTone, fmtDate, DAY_MS } from "../utils/deadlines";
import { isAdminPlusOrAbove } from "../utils/roles";
import { useWorkspace } from "../utils/workspaceContext";
import { morphOriginFrom } from "../utils/modalOrigin";
import { resolveColumns, isArchivedStatus, taskInColumn } from "../utils/columns";
import { termsFor } from "../utils/workspaceTerms";
import { useAccountUi } from "../utils/accountScope";
import "../styles/overview-extra.css";

// Which stage of the journey a board column stands for. Read off the
// workspace's REAL columns (managers can rename, add and remove them in
// Settings), so the Overview's numbers always match what the board shows.
//   queue   — the intake column (first column / "To Do")
//   pending — parked or waiting ("Pending", "On Hold", …)
//   active  — being worked on (everything in between)
//   done    — finished ("Done", "Implemented", "Completed", …)
const DONE_IDS = new Set(["done", "implemented"]);
const DONE_WORDS = /\b(done|complete|completed|implemented|deployed|finished|closed|delivered|live)\b/i;
const PENDING_WORDS = /\b(pending|on hold|waiting|blocked|paused)\b/i;

function columnPhase(col, index) {
  if (DONE_IDS.has(col.id) || DONE_WORDS.test(col.label)) return "done";
  if (index === 0 || col.id === "todo") return "queue";
  if (col.id === "pending" || PENDING_WORDS.test(col.label)) return "pending";
  return "active";
}

/** Share of a project's milestones that are ticked off (0–1). */
function milestoneRatio(t) {
  const total = (t.milestones || []).length;
  return total ? Math.min(1, (t.completedMilestones || 0) / total) : 0;
}

const linkHref = (u) => (u.startsWith("http") ? u : `https://${u}`);

export default function Dashboard({ onShowAllLinks, actualRole, userName, openTaskModal }) {
  const workspace = useWorkspace();
  const terms = termsFor(workspace);
  const tech = terms.tech;
  // Accounts on the Overview: Admin+ see every account; an Admin only when they have several (just theirs).
  const accUi = useAccountUi(workspace, actualRole);
  const showAccounts = accUi.show;
  const tasks = useQuery(api.tasks.getTasksLight, { workspace });
  const appConfig = useQuery(api.appConfig.getAppConfig, { workspace });
  const accountsAll = useQuery(api.accounts.getAccounts, terms.accounts ? { workspace } : "skip");
  const accounts = accountsAll === undefined ? undefined : accUi.limit(accountsAll);
  const saveAppConfigMut = useMutation(api.appConfig.saveAppConfig);

  const isAdminPlus = isAdminPlusOrAbove(actualRole);
  const [editingDeadline, setEditingDeadline] = useState(false);
  const [deadlineDraft, setDeadlineDraft] = useState("");
  const [showAllDeadlines, setShowAllDeadlines] = useState(false);
  const [showAllDocs, setShowAllDocs] = useState(false);

  async function saveProductionDeadline() {
    if (!deadlineDraft) return;
    const ts = new Date(`${deadlineDraft}T23:59:59`).getTime();
    await saveAppConfigMut({ workspace, productionDeadline: ts, updatedBy: userName });
    setEditingDeadline(false);
  }

  if (tasks === undefined) {
    return (
      <div className="container">
        <p style={{ color: "#94a3b8", fontStyle: "italic", textAlign: "center" }}>Loading...</p>
      </div>
    );
  }

  const allTasks = Array.isArray(tasks) ? tasks : [];

  // ---- Board stages, from this workspace's real columns (archive excluded) ----
  const columns = resolveColumns(appConfig?.columns, workspace).filter((c) => !isArchivedStatus(c.id));
  const phaseByColumn = Object.fromEntries(columns.map((c, i) => [c.id, columnPhase(c, i)]));
  // Same placement rule as the board: the matching column, else the first one.
  const phaseOf = (status) => {
    const col = columns.find((c) => taskInColumn(status, c.id)) || columns[0];
    return col ? phaseByColumn[col.id] : "queue";
  };
  const liveTasks = allTasks.filter((t) => !isArchivedStatus(t.status));
  const phaseOfTask = new Map(liveTasks.map((t) => [t._id, phaseOf(t.status)]));

  const counts = { queue: 0, pending: 0, active: 0, done: 0 };
  liveTasks.forEach((t) => { counts[phaseOfTask.get(t._id)]++; });
  const overallCompletion = liveTasks.length
    ? Math.round((liveTasks.reduce((s, t) => s + milestoneRatio(t), 0) / liveTasks.length) * 100)
    : 0;

  // ---- Who's carrying what (in-progress + pending projects) ----
  const workloadByName = {};
  for (const t of liveTasks) {
    const phase = phaseOfTask.get(t._id);
    if (phase !== "active" && phase !== "pending") continue;
    for (const name of (t.assignee || "").split(",").map((n) => n.trim()).filter(Boolean)) {
      workloadByName[name] ||= { name, active: 0, pending: 0 };
      workloadByName[name][phase]++;
    }
  }
  const staffWorkload = Object.values(workloadByName).sort((a, b) => b.active + b.pending - (a.active + a.pending));
  const activeWord = tech ? "Active" : "In Progress";

  // ---- Workforce: system links (same list the "Show All" modal uses) ----
  const projectsWithLinks = allTasks
    .filter((t) => t.appscriptLink || t.webappLink || t.projectLink)
    .map((t) => ({ id: t._id, title: t.title, description: t.description, appscriptLink: t.appscriptLink, webappLink: t.webappLink || t.projectLink }));
  const visibleProjects = projectsWithLinks.slice(0, 8);

  // ---- Operations / Executives: each project's named documents ----
  const projectsWithDocs = liveTasks
    .map((t) => ({ task: t, docs: (Array.isArray(t.documents) ? t.documents : []).filter((d) => d && d.url) }))
    .filter((p) => p.docs.length > 0)
    .sort((a, b) => (b.task.lastUpdated || 0) - (a.task.lastUpdated || 0));

  // ---- Production / key target date (the workspace's big date) ----
  const prodDeadline = appConfig?.productionDeadline || null;
  const prodDaysLeft = prodDeadline ? Math.ceil((prodDeadline - Date.now()) / DAY_MS) : null;
  const prodTone = prodDaysLeft !== null ? deadlineTone(prodDaysLeft) : null;

  // ---- Per-project deadlines (unfinished projects, most urgent first) ----
  const deadlineRows = liveTasks
    .filter((t) => phaseOfTask.get(t._id) !== "done")
    .map((t) => ({ task: t, dl: getProjectDeadlines(t) }))
    .filter((r) => r.dl && !r.dl.complete && r.dl.completionDue)
    .sort((a, b) => a.dl.completionDue - b.dl.completionDue);

  // Overview keeps only the at-risk projects (≤30 days out or overdue), capped
  // at 4 — the expand modal lists everything that has a deadline.
  const atRiskRows = deadlineRows
    .filter((r) => deadlineTone(Math.ceil((r.dl.completionDue - Date.now()) / DAY_MS)) !== "ok")
    .slice(0, 4);

  // ---- Operations: projects per client account ----
  const accountRows = [];
  if (showAccounts) {
    const byId = new Map();
    for (const a of Array.isArray(accounts) ? accounts : []) byId.set(a._id, { key: a._id, name: a.name, tasks: [] });
    const unassigned = { key: "__none", name: "No account", tasks: [], none: true };
    for (const t of liveTasks) {
      let row = unassigned;
      if (t.accountId) {
        if (!byId.has(t.accountId)) {
          if (!accUi.full) continue; // only your own accounts are listed
          byId.set(t.accountId, { key: t.accountId, name: t.account || "Unknown account", tasks: [] });
        }
        row = byId.get(t.accountId);
      }
      row.tasks.push(t);
    }
    const summarize = (row) => {
      const tally = { queue: 0, pending: 0, active: 0, done: 0 };
      row.tasks.forEach((t) => { tally[phaseOfTask.get(t._id)]++; });
      const pct = row.tasks.length ? Math.round((row.tasks.reduce((s, t) => s + milestoneRatio(t), 0) / row.tasks.length) * 100) : 0;
      return { ...row, total: row.tasks.length, tally, pct };
    };
    accountRows.push(...[...byId.values()].map(summarize).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name)));
    if (unassigned.tasks.length > 0 && accUi.full) accountRows.push(summarize(unassigned));
  }

  function openProject(e, t, closeModal) {
    const origin = morphOriginFrom(e.currentTarget);
    if (closeModal) closeModal();
    if (openTaskModal) openTaskModal(t._id, false, false, origin, t);
  }

  function renderDeadlineRow({ task: t, dl }, closeModalFirst = false) {
    const completionLeft = Math.ceil((dl.completionDue - Date.now()) / DAY_MS);
    const tone = deadlineTone(completionLeft);
    const pct = dl.count > 0 ? Math.round((dl.doneCount / dl.count) * 100) : 0;
    return (
      <div
        key={t._id}
        className="deadline-row"
        onClick={(e) => openProject(e, t, closeModalFirst ? () => setShowAllDeadlines(false) : null)}
      >
        <div className="deadline-row-info">
          <div className="deadline-row-title">
            {t.title}
            {showAccounts && t.account && <span className="ov-account-pill" title="Account">{t.account}</span>}
          </div>
          <div className="deadline-row-meta">
            {t.assignee || "Unassigned"} · {dl.doneCount}/{dl.count} milestones · {dl.totalDays}d total timeline
          </div>
          <div className="deadline-row-progress">
            <div className="deadline-row-progress-fill" style={{ width: `${pct}%` }} />
          </div>
        </div>
        <div className="deadline-row-dates">
          <div className={`deadline-chip completion ${tone}`} title={dl.overridden ? "Completion deadline pinned by an admin" : "Completion deadline — when every remaining milestone is due"}>
            <span className="deadline-chip-label">Completion{dl.overridden ? " 📌" : ""}</span>
            <span className="deadline-chip-date">{fmtDate(dl.completionDue)}</span>
            <span className="deadline-chip-left">{completionLeft < 0 ? `${Math.abs(completionLeft)}d overdue` : `${completionLeft}d left`}</span>
          </div>
        </div>
      </div>
    );
  }

  function renderDocCard({ task: t, docs }, idx, closeModal = null) {
    const shown = docs.slice(0, 4);
    return (
      <div key={t._id} className="ov-doc-card" style={{ "--i": idx }}>
        <div className="ov-doc-head">
          <button type="button" className="ov-doc-title" title="Open project" onClick={(e) => openProject(e, t, closeModal)}>
            {t.title}
          </button>
          {showAccounts && t.account && <span className="ov-account-pill" title="Account">{t.account}</span>}
        </div>
        <ul className="ov-doc-list">
          {shown.map((d, i) => (
            <li key={`${d.url}-${i}`}>
              <a className="ov-doc-link" href={linkHref(d.url)} target="_blank" rel="noopener noreferrer" title={d.url}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                </svg>
                <span className="ov-doc-name">{d.name || d.url}</span>
                <svg className="ov-doc-ext" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                  <polyline points="15 3 21 3 21 9" />
                  <line x1="10" y1="14" x2="21" y2="3" />
                </svg>
              </a>
            </li>
          ))}
        </ul>
        {docs.length > shown.length && (
          <button type="button" className="ov-doc-more" onClick={(e) => openProject(e, t, closeModal)}>
            +{docs.length - shown.length} more in this project
          </button>
        )}
      </div>
    );
  }

  const sectionTitleStyle = { fontWeight: 900, margin: 0, textTransform: "uppercase", fontSize: "1.2rem", color: "var(--color-text-secondary)", display: "flex", alignItems: "center", gap: 10, letterSpacing: "0.5px" };
  const showAllBtnStyle = {
    padding: "6px 14px",
    borderRadius: "8px",
    border: "1.5px solid var(--color-accent)",
    background: "var(--color-accent)",
    color: "white",
    fontSize: "0.75rem",
    fontWeight: 900,
    cursor: "pointer",
    boxShadow: "0 2px 5px rgba(0,0,0,0.1)",
    transition: "opacity 0.2s ease"
  };
  const linkIcon = (
    <>
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </>
  );
  const docsIcon = (
    <>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
    </>
  );

  return (
    <div id="dashboard-view" className="view-section">
      <div className="container">
        {/* ── The workspace's big date (Workforce: Full Production Deployment;
               Operations/Executives: Key Target Date) — only shown once one is
               set (Admin+ sets it in Settings → Workspace Defaults or here) ── */}
        {prodDeadline && (
          <div className={`deadline-hero ${prodTone || ""}`}>
            <div className="deadline-hero-main">
              <div className="deadline-hero-label">
                {tech ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
                    <path d="M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" />
                    <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" />
                    <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" />
                  </svg>
                ) : (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="2" />
                  </svg>
                )}
                {tech ? "Full Production Deployment" : "Key Target Date"}
              </div>
              <div className="deadline-hero-date">{fmtDate(prodDeadline)}</div>
              <div className="deadline-hero-sub">
                {tech
                  ? "Target date for Hermes to be fully deployed in production."
                  : `The date the ${terms.label} team is working toward.`}
              </div>
            </div>

            <div className="deadline-hero-countdown">
              <div className="deadline-hero-days">{prodDaysLeft < 0 ? Math.abs(prodDaysLeft) : prodDaysLeft}</div>
              <div className="deadline-hero-days-label">{prodDaysLeft < 0 ? "days overdue" : "days left"}</div>
            </div>

            {isAdminPlus && (
              <div className="deadline-hero-edit">
                {editingDeadline ? (
                  <div className="deadline-edit-row">
                    <DatePicker className="deadline-edit-picker" value={deadlineDraft} onChange={setDeadlineDraft} placeholder="Pick a date" />
                    <button className="deadline-edit-btn save" onClick={saveProductionDeadline} title="Save deadline">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>
                    </button>
                    <button className="deadline-edit-btn" onClick={() => setEditingDeadline(false)} title="Cancel">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                    </button>
                  </div>
                ) : (
                  <button
                    className="deadline-edit-btn"
                    title="Edit deadline (Admin+)"
                    onClick={() => {
                      const d = new Date(prodDeadline);
                      setDeadlineDraft(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
                      setEditingDeadline(true);
                    }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                    </svg>
                    Edit
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Project completion deadlines (top 4 at-risk; expand for all) ── */}
        {deadlineRows.length > 0 && (
          <div className="section-card" style={{ marginBottom: 25 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 6 }}>
              <h2 style={sectionTitleStyle}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
                </svg>
                Project Deadlines
              </h2>
              <button className="deadline-expand-btn" onClick={() => setShowAllDeadlines(true)}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" />
                  <line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" />
                </svg>
                View All ({deadlineRows.length})
              </button>
            </div>
            <p style={{ margin: "0 0 18px 0", fontSize: "0.78rem", color: "var(--color-text-secondary)" }}>
              Projects closest to their <strong>completion deadline</strong> (within 30 days or overdue). Open a task to see its current milestone deadline.
            </p>
            <div className="deadline-board">
              {atRiskRows.length > 0 ? (
                atRiskRows.map((r) => renderDeadlineRow(r))
              ) : (
                <div className="deadline-calm">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
                  </svg>
                  No projects are close to their completion deadline. All timelines are healthy.
                </div>
              )}
            </div>
          </div>
        )}

        {/* All deadlines modal */}
        {showAllDeadlines && (
          <div className="modal-overlay" style={{ alignItems: "center", zIndex: 4000 }} onClick={() => setShowAllDeadlines(false)}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 1100, height: "auto", maxHeight: "85vh" }}>
              <button className="modal-close" onClick={() => setShowAllDeadlines(false)}>×</button>
              <h2 style={{ fontWeight: 900, textTransform: "uppercase", margin: "0 0 6px 0", fontSize: "1.15rem", display: "flex", alignItems: "center", gap: 10, color: "var(--color-text-primary)" }}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
                </svg>
                All Project Deadlines ({deadlineRows.length})
              </h2>
              <p style={{ margin: "0 0 16px 0", fontSize: "0.78rem", color: "var(--color-text-secondary)" }}>
                Every active project with a deadline, most urgent first. Click a project to open it.
              </p>
              <div className="deadline-board" style={{ overflowY: "auto", paddingRight: 6 }}>
                {deadlineRows.map((r) => renderDeadlineRow(r, true))}
              </div>
            </div>
          </div>
        )}

        {tech ? (
          /* Consolidated System Links (Workforce) */
          projectsWithLinks.length > 0 ? (
            <div className="section-card" style={{ marginBottom: 25, background: "var(--color-card-bg)", border: "1.5px solid var(--glass-border)", boxShadow: "var(--shadow-sm)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 15, flexWrap: "wrap", gap: 10 }}>
                <h2 style={sectionTitleStyle}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">{linkIcon}</svg>
                  Consolidated System Links
                </h2>
                {projectsWithLinks.length > 8 && (
                  <button
                    onClick={onShowAllLinks}
                    title="View All Projects"
                    className="dash-showall-btn"
                    style={showAllBtnStyle}
                  >
                    Show All ({projectsWithLinks.length})
                  </button>
                )}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 15 }}>
                {visibleProjects.map(p => (
                  <div key={p.id} style={{ background: "var(--color-bg-subtle)", padding: "15px 20px", borderRadius: 12, border: "1px solid var(--glass-border)", transition: "transform 0.2s ease, box-shadow 0.2s ease", display: "flex", flexDirection: "column", gap: 12 }}>
                    <div>
                      <div style={{ fontWeight: 900, fontSize: "0.95rem", color: "var(--color-brand-text)", borderBottom: "2px solid var(--glass-border)", paddingBottom: 8, marginBottom: 8, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {p.title}
                      </div>
                      <div style={{ fontSize: "0.8rem", color: "var(--color-text-secondary)", display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden", lineHeight: 1.4 }}>
                        {p.description || <span style={{ fontStyle: "italic", opacity: 0.7 }}>No description provided for this project. Update the task to add details.</span>}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 10, marginTop: "auto" }}>
                      {p.webappLink && (
                        <a
                          href={linkHref(p.webappLink)}
                          target="_blank" rel="noopener noreferrer"
                          className="btn-modern btn-modern-project"
                          style={{ flex: 1, padding: "8px 0" }}
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                            <polyline points="15 3 21 3 21 9" />
                            <line x1="10" y1="14" x2="21" y2="3" />
                          </svg>
                          View Project
                        </a>
                      )}
                      {p.appscriptLink && (
                        <a
                          href={linkHref(p.appscriptLink)}
                          target="_blank" rel="noopener noreferrer"
                          className="btn-modern btn-modern-appscript"
                          style={{ flex: 1, padding: "8px 0" }}
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                            <polyline points="16 18 22 12 16 6" />
                            <polyline points="8 6 2 12 8 18" />
                          </svg>
                          Appscript
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="section-card" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, padding: "14px 20px", marginBottom: 20 }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2.2">{linkIcon}</svg>
              <p style={{ color: "#94a3b8", fontStyle: "italic", fontSize: "0.9rem", margin: 0 }}>No project links available yet.</p>
            </div>
          )
        ) : (
          /* Project Documents (Operations / Executives) — each project's named links */
          projectsWithDocs.length > 0 ? (
            <div className="section-card" style={{ marginBottom: 25, background: "var(--color-card-bg)", border: "1.5px solid var(--glass-border)", boxShadow: "var(--shadow-sm)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 15, flexWrap: "wrap", gap: 10 }}>
                <h2 style={sectionTitleStyle}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">{docsIcon}</svg>
                  {terms.projectLinks}
                </h2>
                {projectsWithDocs.length > 8 && (
                  <button
                    onClick={() => setShowAllDocs(true)}
                    title="View every project's documents"
                    className="dash-showall-btn"
                    style={showAllBtnStyle}
                  >
                    Show All ({projectsWithDocs.length})
                  </button>
                )}
              </div>
              <div className="ov-doc-grid">
                {projectsWithDocs.slice(0, 8).map((p, i) => renderDocCard(p, i))}
              </div>
            </div>
          ) : (
            <div className="section-card" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, padding: "14px 20px", marginBottom: 20 }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2.2">{docsIcon}</svg>
              <p style={{ color: "#94a3b8", fontStyle: "italic", fontSize: "0.9rem", margin: 0 }}>No project documents yet. Add documents to a project and they'll be listed here.</p>
            </div>
          )
        )}

        {/* All project documents modal (Operations / Executives) */}
        {showAllDocs && (
          <div className="modal-overlay" style={{ alignItems: "center", zIndex: 4000 }} onClick={() => setShowAllDocs(false)}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 1400, height: "auto", maxHeight: "85vh" }}>
              <button className="modal-close" onClick={() => setShowAllDocs(false)}>×</button>
              <h2 style={{ fontWeight: 900, textTransform: "uppercase", margin: "0 0 6px 0", fontSize: "1.15rem", display: "flex", alignItems: "center", gap: 10, color: "var(--color-text-primary)" }}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">{docsIcon}</svg>
                All {terms.projectLinks} ({projectsWithDocs.length})
              </h2>
              <p style={{ margin: "0 0 16px 0", fontSize: "0.78rem", color: "var(--color-text-secondary)" }}>
                Every project with documents, most recently updated first. Click a project's name to open it.
              </p>
              <div className="ov-doc-grid" style={{ overflowY: "auto", paddingRight: 6 }}>
                {projectsWithDocs.map((p, i) => renderDocCard(p, Math.min(i, 12), () => setShowAllDocs(false)))}
              </div>
            </div>
          </div>
        )}

        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-value" style={{ color: "var(--col-todo)" }}>{counts.queue}</div>
            <div className="stat-label">Queue</div>
          </div>
          <div className="stat-card">
            <div className="stat-value" style={{ color: "var(--color-accent)" }}>{counts.active}</div>
            <div className="stat-label">{activeWord}</div>
          </div>
          <div className="stat-card">
            <div className="stat-value" style={{ color: "var(--col-test)" }}>{counts.done}</div>
            <div className="stat-label">{tech ? "Deployed" : "Completed"}</div>
          </div>
          <div className="stat-card">
            <div className="stat-value" style={{ color: "var(--color-brand-text)" }}>{overallCompletion}%</div>
            <div className="stat-label">Efficiency</div>
          </div>
        </div>

        {/* ── Accounts breakdown (Operations) — projects per client account ── */}
        {showAccounts && accountRows.length > 0 && (
          <div className="section-card" style={{ marginBottom: 20 }}>
            <h2 style={{ ...sectionTitleStyle, marginBottom: 6 }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
                <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
              </svg>
              Accounts
            </h2>
            <p style={{ margin: "0 0 18px 0", fontSize: "0.78rem", color: "var(--color-text-secondary)" }}>
              Projects per client account (archived projects left out). Progress is the share of milestones completed.
            </p>
            <div className="ov-account-list">
              {accountRows.map((r, i) => (
                <div key={r.key} className={`ov-account-row${r.none ? " is-none" : ""}${r.total === 0 ? " is-empty" : ""}`} style={{ "--i": i }}>
                  <div className="ov-account-info">
                    <div className="ov-account-name">{r.name}</div>
                    <div className="ov-account-meta">
                      {r.total === 0 ? (
                        "No projects yet"
                      ) : (
                        <>
                          {r.total} project{r.total === 1 ? "" : "s"}
                          {r.tally.active > 0 && <> · {r.tally.active} in progress</>}
                          {r.tally.pending > 0 && <> · {r.tally.pending} pending</>}
                          {r.tally.queue > 0 && <> · {r.tally.queue} queued</>}
                          {r.tally.done > 0 && <> · {r.tally.done} completed</>}
                        </>
                      )}
                    </div>
                  </div>
                  <div className="ov-account-progress" title={`${r.pct}% of milestones completed`}>
                    <div className="ov-account-track">
                      <div className="ov-account-fill" style={{ width: `${r.pct}%` }} />
                    </div>
                    <span className="ov-account-pct">{r.pct}%</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="section-card">
          <h2 style={{ fontWeight: 900, marginTop: 0, textTransform: "uppercase", fontSize: "1.2rem", letterSpacing: "-0.5px", display: "flex", alignItems: "center", gap: 10 }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
              <line x1="8" y1="21" x2="16" y2="21" />
              <line x1="12" y1="17" x2="12" y2="21" />
            </svg>
            {tech ? "System Overview" : "Workspace Overview"}
          </h2>
          {tech ? (
            <div style={{ color: "var(--color-text-secondary)", fontSize: "0.9rem", lineHeight: 1.6 }}>
              <p style={{ marginBottom: 10 }}>
                <strong>Hermes</strong> is the central hub for managing team workload, monitoring project development phases, and maintaining administrative control.
              </p>
              <p>
                Use the navigation above to switch between tracking active engineering <strong>Tasks</strong>, managing <strong>Staff</strong> roles and access, taking notes in the <strong>Notebook</strong>, or broadcasting updates via <strong>Announcements</strong>.
              </p>
            </div>
          ) : (
            <div style={{ color: "var(--color-text-secondary)", fontSize: "0.9rem", lineHeight: 1.6 }}>
              <p style={{ marginBottom: 10 }}>
                <strong>Hermes</strong> is the {terms.label} team's central hub for planning projects, following each one's milestones and deadlines, and keeping the team's workload balanced.
                {showAccounts && <> Every project can be tagged with the client <strong>Account</strong> it serves.</>}
              </p>
              <p>
                Use the navigation above to switch between tracking <strong>Projects</strong> on the board, managing <strong>Staff</strong> access, capturing ideas in the <strong>Notebook</strong>, or broadcasting updates via <strong>Announcements</strong>.
              </p>
            </div>
          )}
        </div>

        <div className="section-card" style={{ marginTop: 20 }}>
          <h2 style={{ fontWeight: 900, marginTop: 0, textTransform: "uppercase", fontSize: "1rem", color: "var(--color-text-primary)", marginBottom: 20 }}>
            👥 {terms.workload} — {activeWord} & Pending
          </h2>
          <div>
            {staffWorkload.length === 0 ? (
              <p style={{ color: "#94a3b8", fontStyle: "italic", textAlign: "center" }}>
                {tech ? "No active or pending tasks right now." : "No projects in progress or pending right now."}
              </p>
            ) : (
              staffWorkload.map((w) => (
                <div
                  key={w.name}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "12px 15px",
                    borderRadius: 12,
                    background: "var(--color-bg-subtle)",
                    marginBottom: 10,
                    border: "1px solid var(--glass-border)",
                  }}
                >
                  <div style={{ fontWeight: 900, color: "var(--color-text-primary) !important", fontSize: "0.9rem" }}>{w.name}</div>
                  <div style={{ display: "flex", gap: 10 }}>
                    {w.active > 0 && (
                      <span style={{ background: "linear-gradient(135deg, var(--color-nav-bg), var(--color-accent))", color: "white", padding: "3px 10px", borderRadius: 12, fontSize: "0.75rem", fontWeight: 900 }}>
                        {activeWord}: {w.active}
                      </span>
                    )}
                    {w.pending > 0 && (
                      <span style={{ background: "linear-gradient(135deg, var(--color-nav-bg), #475569)", color: "white", padding: "3px 10px", borderRadius: 12, fontSize: "0.75rem", fontWeight: 900 }}>
                        Pending: {w.pending}
                      </span>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
