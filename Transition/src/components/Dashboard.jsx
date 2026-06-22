import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { getProjectDeadlines, deadlineTone, fmtDate, DAY_MS } from "../utils/deadlines";
import { isAdminPlusOrAbove } from "../utils/roles";

export default function Dashboard({ onShowAllLinks, actualRole, userName, openTaskModal }) {
  const stats = useQuery(api.tasks.getProjectStats);
  const tasks = useQuery(api.tasks.getTasksLight);
  const appConfig = useQuery(api.appConfig.getAppConfig);
  const saveAppConfigMut = useMutation(api.appConfig.saveAppConfig);

  const isAdminPlus = isAdminPlusOrAbove(actualRole);
  const [editingDeadline, setEditingDeadline] = useState(false);
  const [deadlineDraft, setDeadlineDraft] = useState("");
  const [showAllDeadlines, setShowAllDeadlines] = useState(false);

  async function saveProductionDeadline() {
    if (!deadlineDraft) return;
    const ts = new Date(`${deadlineDraft}T23:59:59`).getTime();
    await saveAppConfigMut({ productionDeadline: ts, updatedBy: userName });
    setEditingDeadline(false);
  }

  if (!stats) {
    return (
      <div className="container">
        <p style={{ color: "#94a3b8", fontStyle: "italic", textAlign: "center" }}>Loading...</p>
      </div>
    );
  }

  const visibleProjects = (stats.projectsWithLinks || []).slice(0, 8);

  // ---- Production deadline (the tool's full-production launch) ----
  const prodDeadline = appConfig?.productionDeadline || null;
  const prodDaysLeft = prodDeadline ? Math.ceil((prodDeadline - Date.now()) / DAY_MS) : null;
  const prodTone = prodDaysLeft !== null ? deadlineTone(prodDaysLeft) : null;

  // ---- Per-project deadlines (active projects, most urgent first) ----
  const CLOSED = new Set(["done", "implemented", "scrapyard", "scrapped"]);
  const deadlineRows = (tasks || [])
    .filter((t) => !CLOSED.has((t.status || "").toLowerCase()))
    .map((t) => ({ task: t, dl: getProjectDeadlines(t) }))
    .filter((r) => r.dl && !r.dl.complete && r.dl.completionDue)
    .sort((a, b) => a.dl.completionDue - b.dl.completionDue);

  // Overview keeps only the at-risk projects (≤30 days out or overdue), capped
  // at 4 — the expand modal lists everything that has a deadline.
  const atRiskRows = deadlineRows
    .filter((r) => deadlineTone(Math.ceil((r.dl.completionDue - Date.now()) / DAY_MS)) !== "ok")
    .slice(0, 4);

  function renderDeadlineRow({ task: t, dl }, closeModalFirst = false) {
    const completionLeft = Math.ceil((dl.completionDue - Date.now()) / DAY_MS);
    const tone = deadlineTone(completionLeft);
    const pct = dl.count > 0 ? Math.round((dl.doneCount / dl.count) * 100) : 0;
    return (
      <div
        key={t._id}
        className="deadline-row"
        onClick={() => {
          if (closeModalFirst) setShowAllDeadlines(false);
          if (openTaskModal) openTaskModal(t._id);
        }}
      >
        <div className="deadline-row-info">
          <div className="deadline-row-title">{t.title}</div>
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

  return (
    <div id="dashboard-view" className="view-section">
      <div className="container">
        {/* ── Full Production Deployment deadline — only shown once one is set
               (Admin+ sets it in Settings → Workspace Defaults or here) ── */}
        {prodDeadline && (
          <div className={`deadline-hero ${prodTone || ""}`}>
            <div className="deadline-hero-main">
              <div className="deadline-hero-label">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
                  <path d="M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" />
                  <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" />
                  <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" />
                </svg>
                Full Production Deployment
              </div>
              <div className="deadline-hero-date">{fmtDate(prodDeadline)}</div>
              <div className="deadline-hero-sub">Target date for Workforce Hermes to be fully deployed in production.</div>
            </div>

            <div className="deadline-hero-countdown">
              <div className="deadline-hero-days">{prodDaysLeft < 0 ? Math.abs(prodDaysLeft) : prodDaysLeft}</div>
              <div className="deadline-hero-days-label">{prodDaysLeft < 0 ? "days overdue" : "days left"}</div>
            </div>

            {isAdminPlus && (
              <div className="deadline-hero-edit">
                {editingDeadline ? (
                  <div className="deadline-edit-row">
                    <input
                      type="date"
                      className="deadline-edit-input"
                      value={deadlineDraft}
                      onChange={(e) => setDeadlineDraft(e.target.value)}
                      autoFocus
                    />
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
              <h2 style={{ fontWeight: 900, margin: 0, textTransform: "uppercase", fontSize: "1.2rem", color: "var(--color-text-secondary)", display: "flex", alignItems: "center", gap: 10, letterSpacing: "0.5px" }}>
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
            <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 880, height: "auto", maxHeight: "85vh" }}>
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

        {/* Consolidated System Links */}
        {stats.projectsWithLinks && stats.projectsWithLinks.length > 0 ? (
          <div className="section-card" style={{ marginBottom: 25, background: "var(--color-card-bg)", border: "1.5px solid var(--glass-border)", boxShadow: "var(--shadow-sm)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 15, flexWrap: "wrap", gap: 10 }}>
              <h2 style={{ fontWeight: 900, margin: 0, textTransform: "uppercase", fontSize: "1.2rem", color: "var(--color-text-secondary)", display: "flex", alignItems: "center", gap: 10, letterSpacing: "0.5px" }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                  <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                </svg>
                Consolidated System Links
              </h2>
              {stats.projectsWithLinks.length > 8 && (
                <button
                  onClick={onShowAllLinks}
                  title="View All Projects"
                  style={{
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
                  }}
                  onMouseOver={(e) => e.currentTarget.style.opacity = 0.85}
                  onMouseOut={(e) => e.currentTarget.style.opacity = 1}
                >
                  Show All ({stats.projectsWithLinks.length})
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
                        href={p.webappLink.startsWith("http") ? p.webappLink : `https://${p.webappLink}`} 
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
                        href={p.appscriptLink.startsWith("http") ? p.appscriptLink : `https://${p.appscriptLink}`} 
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
          <div className="section-card" style={{ textAlign: "center", padding: "40px 20px" }}>
            <p style={{ color: "#94a3b8", fontStyle: "italic", fontSize: "1.1rem" }}>No project links available yet.</p>
          </div>
        )}

        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-value" style={{ color: "var(--col-todo)" }}>{stats.todo || 0}</div>
            <div className="stat-label">Queue</div>
          </div>
          <div className="stat-card">
            <div className="stat-value" style={{ color: "var(--color-accent)" }}>{stats.development || 0}</div>
            <div className="stat-label">Active</div>
          </div>
          <div className="stat-card">
            <div className="stat-value" style={{ color: "var(--col-test)" }}>{stats.done || 0}</div>
            <div className="stat-label">Deployed</div>
          </div>
          <div className="stat-card">
            <div className="stat-value" style={{ color: "var(--color-brand-text)" }}>{stats.overallCompletion || 0}%</div>
            <div className="stat-label">Efficiency</div>
          </div>
        </div>

        <div className="section-card">
          <h2 style={{ fontWeight: 900, marginTop: 0, textTransform: "uppercase", fontSize: "1.2rem", letterSpacing: "-0.5px", display: "flex", alignItems: "center", gap: 10 }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
              <line x1="8" y1="21" x2="16" y2="21" />
              <line x1="12" y1="17" x2="12" y2="21" />
            </svg>
            System Overview
          </h2>
          <div style={{ color: "var(--color-text-secondary)", fontSize: "0.9rem", lineHeight: 1.6 }}>
            <p style={{ marginBottom: 10 }}>
              <strong>Workforce Hermes</strong> is the central hub for managing team workload, monitoring project development phases, and maintaining administrative control.
            </p>
            <p>
              Use the navigation above to switch between tracking active engineering <strong>Tasks</strong>, managing <strong>Staff</strong> roles and access, taking notes in the <strong>Notebook</strong>, or broadcasting updates via <strong>Announcements</strong>.
            </p>
          </div>
        </div>

        <div className="section-card" style={{ marginTop: 20 }}>
          <h2 style={{ fontWeight: 900, marginTop: 0, textTransform: "uppercase", fontSize: "1rem", color: "var(--color-text-primary)", marginBottom: 20 }}>
            👥 Programmer Workload — Active & Pending
          </h2>
          <div>
            {(stats.staffWorkload || []).length === 0 ? (
              <p style={{ color: "#94a3b8", fontStyle: "italic", textAlign: "center" }}>
                No active or pending tasks right now.
              </p>
            ) : (
              stats.staffWorkload.map((w) => (
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
                        Active: {w.active}
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
