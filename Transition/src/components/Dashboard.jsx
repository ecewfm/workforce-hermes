import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";

export default function Dashboard({ onShowAllLinks }) {
  const stats = useQuery(api.tasks.getProjectStats);

  if (!stats) {
    return (
      <div className="container">
        <p style={{ color: "#94a3b8", fontStyle: "italic", textAlign: "center" }}>Loading...</p>
      </div>
    );
  }

  const visibleProjects = (stats.projectsWithLinks || []).slice(0, 8);

  return (
    <div id="dashboard-view" className="view-section">
      <div className="container">
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
                    <div style={{ fontWeight: 900, fontSize: "0.95rem", color: "var(--color-nav-bg)", borderBottom: "2px solid #f1f5f9", paddingBottom: 8, marginBottom: 8, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
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
            <div className="stat-value" style={{ color: "var(--color-nav-bg)" }}>{stats.overallCompletion || 0}%</div>
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
