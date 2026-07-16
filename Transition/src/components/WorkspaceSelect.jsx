import { useEffect, useRef, useState } from "react";
import { WORKSPACE_META } from "../utils/departments";

/**
 * A responsive grid of selectable workspace cards. Shared by the post-login
 * WorkspaceSelect gate and the in-app picker (opened from the header title).
 *
 * Transition (in-app picker): when `transitioningTo` is set, the OTHER cards
 * blur/fade away and the ACTUAL selected card (a real FLIP transform, not a
 * clone) flies to the viewport center, shows "Loading workspace…", then — when
 * `transitionPhase === "out"` — shrinks to zero. App.jsx drives the phases.
 */
export function WorkspaceCards({
  workspaces = [],
  activeWorkspace = null,
  onSelect,
  large = false,
  transitioningTo = null,
  transitionPhase = null,
}) {
  // Sizing scales up for the in-app picker ("large") vs the compact login gate.
  const sz = large
    ? { min: 300, gap: 28, pad: "52px 34px", icon: 76, iconRadius: 20, svg: 38, title: "1.9rem", blurb: "1rem", mb: 22 }
    : { min: 180, gap: 16, pad: "24px 18px", icon: 42, iconRadius: 12, svg: 22, title: "1.05rem", blurb: "0.78rem", mb: 14 };

  const cardRefs = useRef({});
  // The translate needed to move the selected card from its grid spot to the
  // viewport center. Measured AFTER paint (useEffect) so the card renders at its
  // original spot first, then transitions to center (a real FLIP move, no jump).
  const [centerShift, setCenterShift] = useState(null);

  useEffect(() => {
    if (!transitioningTo) {
      setCenterShift(null);
      return;
    }
    const el = cardRefs.current[transitioningTo];
    if (!el) return;
    const r = el.getBoundingClientRect();
    const dx = window.innerWidth / 2 - (r.left + r.width / 2);
    const dy = window.innerHeight / 2 - (r.top + r.height / 2);
    setCenterShift({ dx, dy });
  }, [transitioningTo]);

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: workspaces.length > 1 ? `repeat(auto-fit, minmax(${sz.min}px, 1fr))` : "1fr",
        gap: sz.gap,
      }}
    >
      {workspaces.map((key) => {
        const meta = WORKSPACE_META[key] || { label: key, blurb: "" };
        const isActive = key === activeWorkspace;
        const isTransitioning = transitioningTo === key;
        const isOther = transitioningTo && !isTransitioning;

        // Per-card transition styling.
        let dynamic = {};
        if (isOther) {
          dynamic = { opacity: 0, filter: "blur(12px)", transform: "scale(0.88)", pointerEvents: "none" };
        } else if (isTransitioning) {
          const shift = centerShift ? `translate(${centerShift.dx}px, ${centerShift.dy}px)` : "";
          dynamic = {
            transform: transitionPhase === "out" ? `${shift} scale(0)` : `${shift} scale(1.06)`,
            opacity: transitionPhase === "out" ? 0 : 1,
            zIndex: 10,
            position: "relative",
            boxShadow: "0 30px 70px rgba(0,0,0,0.4)",
            pointerEvents: "none",
          };
        }

        return (
          <button
            key={key}
            ref={(el) => { cardRefs.current[key] = el; }}
            onClick={() => onSelect && onSelect(key)}
            className={`workspace-select-card${isActive ? " is-active" : ""}`}
            data-workspace-card={key}
            style={{
              padding: sz.pad,
              borderRadius: large ? 24 : 16,
              border: isActive ? "2px solid var(--color-accent, #4355f1)" : "1px solid var(--glass-border, #e2e8f0)",
              background: "var(--color-card-bg, #fff)",
              cursor: "pointer",
              textAlign: "left",
              transformOrigin: "center center",
              transition: transitioningTo
                ? "transform 0.6s cubic-bezier(0.65, 0, 0.35, 1), opacity 0.5s ease, filter 0.5s ease, box-shadow 0.5s ease"
                : "transform 0.15s, box-shadow 0.15s, border-color 0.15s",
              boxShadow: large ? "0 12px 32px rgba(0,0,0,0.18)" : "0 4px 12px rgba(0,0,0,0.04)",
              ...dynamic,
            }}
            onMouseEnter={(e) => {
              if (transitioningTo) return;
              e.currentTarget.style.transform = "translateY(-4px)";
              e.currentTarget.style.boxShadow = large ? "0 20px 44px rgba(0,0,0,0.28)" : "0 10px 20px rgba(0,0,0,0.1)";
            }}
            onMouseLeave={(e) => {
              if (transitioningTo) return;
              e.currentTarget.style.transform = "translateY(0)";
              e.currentTarget.style.boxShadow = large ? "0 12px 32px rgba(0,0,0,0.18)" : "0 4px 12px rgba(0,0,0,0.04)";
            }}
          >
            <div
              className="workspace-card-icon"
              style={{
                width: sz.icon,
                height: sz.icon,
                borderRadius: sz.iconRadius,
                background: "linear-gradient(135deg, var(--color-accent, #4355f1), var(--color-nav-bg, #2b3a8c))",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                marginBottom: sz.mb,
              }}
            >
              <svg width={sz.svg} height={sz.svg} viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.2">
                <rect x="3" y="3" width="7" height="7" rx="1.5" />
                <rect x="14" y="3" width="7" height="7" rx="1.5" />
                <rect x="3" y="14" width="7" height="7" rx="1.5" />
                <rect x="14" y="14" width="7" height="7" rx="1.5" />
              </svg>
            </div>
            <div style={{ fontWeight: 900, fontSize: sz.title, color: "var(--color-text-primary)" }}>
              {meta.label}
              {isActive && !isTransitioning && <span style={{ fontSize: large ? "0.8rem" : "0.65rem", marginLeft: 8, color: "var(--color-accent)", fontWeight: 800 }}>• CURRENT</span>}
            </div>
            <div style={{ fontSize: sz.blurb, color: "#64748b", marginTop: large ? 8 : 4 }}>{meta.blurb}</div>

            {/* When this is the flying card, show the loading state inside it */}
            {isTransitioning && (
              <div style={{ marginTop: 18, display: "flex", alignItems: "center", gap: 12, color: "var(--color-text-secondary)", fontSize: "0.95rem", fontWeight: 700 }}>
                <span className="ws-loading-spinner" />
                Loading workspace…
              </div>
            )}
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
