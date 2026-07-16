import { WORKSPACE_META } from "../utils/departments";

/**
 * A responsive grid of selectable workspace cards. Shared by the post-login
 * WorkspaceSelect gate and the in-app picker (opened from the header title).
 */
export function WorkspaceCards({ workspaces = [], activeWorkspace = null, onSelect }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: workspaces.length > 1 ? "repeat(auto-fit, minmax(180px, 1fr))" : "1fr",
        gap: 16,
      }}
    >
      {workspaces.map((key) => {
        const meta = WORKSPACE_META[key] || { label: key, blurb: "" };
        const isActive = key === activeWorkspace;
        return (
          <button
            key={key}
            onClick={() => onSelect && onSelect(key)}
            className={`workspace-select-card${isActive ? " is-active" : ""}`}
            data-workspace-card={key}
            style={{
              padding: "24px 18px",
              borderRadius: 16,
              border: isActive ? "2px solid var(--color-accent, #4355f1)" : "1px solid var(--glass-border, #e2e8f0)",
              background: "var(--color-card-bg, #fff)",
              cursor: "pointer",
              textAlign: "left",
              transition: "transform 0.15s, box-shadow 0.15s, border-color 0.15s",
              boxShadow: "0 4px 12px rgba(0,0,0,0.04)",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = "translateY(-3px)";
              e.currentTarget.style.boxShadow = "0 10px 20px rgba(0,0,0,0.1)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = "translateY(0)";
              e.currentTarget.style.boxShadow = "0 4px 12px rgba(0,0,0,0.04)";
            }}
          >
            <div
              className="workspace-card-icon"
              style={{
                width: 42,
                height: 42,
                borderRadius: 12,
                background: "linear-gradient(135deg, var(--color-accent, #4355f1), var(--color-nav-bg, #2b3a8c))",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                marginBottom: 14,
              }}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.2">
                <rect x="3" y="3" width="7" height="7" rx="1.5" />
                <rect x="14" y="3" width="7" height="7" rx="1.5" />
                <rect x="3" y="14" width="7" height="7" rx="1.5" />
                <rect x="14" y="14" width="7" height="7" rx="1.5" />
              </svg>
            </div>
            <div style={{ fontWeight: 900, fontSize: "1.05rem", color: "var(--color-text-primary)" }}>
              {meta.label}
              {isActive && <span style={{ fontSize: "0.65rem", marginLeft: 8, color: "var(--color-accent)", fontWeight: 800 }}>• CURRENT</span>}
            </div>
            <div style={{ fontSize: "0.78rem", color: "#64748b", marginTop: 4 }}>{meta.blurb}</div>
          </button>
        );
      })}
    </div>
  );
}

/**
 * Post-login workspace picker gate. Shown only when the signed-in user can
 * access 2+ workspaces (a single-workspace user is auto-entered).
 */
export default function WorkspaceSelect({ workspaces = [], userName = "", onSelect, onLogout }) {
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

      {/* No wrapper card — the title and cards float directly on the background. */}
      <div style={{ maxWidth: 720, width: "100%", textAlign: "center" }}>
        <h2 style={{ color: "var(--color-text-primary)", marginBottom: 6 }}>Choose a workspace</h2>
        <p style={{ color: "var(--color-text-secondary)", lineHeight: 1.6, marginBottom: 28 }}>
          {userName ? `Welcome back, ${userName}. ` : ""}
          Select where you'd like to go — you can switch anytime from the header.
        </p>

        <WorkspaceCards workspaces={workspaces} onSelect={onSelect} />

        {onLogout && (
          <button
            className="btn-secondary"
            style={{ marginTop: 28, padding: "10px 24px", background: "var(--color-logout)" }}
            onClick={onLogout}
          >
            Log out
          </button>
        )}
      </div>
    </div>
  );
}
