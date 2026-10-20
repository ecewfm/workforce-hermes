import { useLayoutEffect, useRef, useState } from "react";
import { WORKSPACE_META } from "../utils/departments";

/**
 * A responsive grid of selectable workspace cards. Shared by the post-login
 * WorkspaceSelect gate and the in-app picker (opened from the header title).
 *
 * Transition: when `transitioningTo` is set, the OTHER cards drop away and
 * the ACTUAL selected card (not a clone) lifts and flies to the centre of the
 * screen, showing "Loading workspace…". When `transitionPhase === "out"` its
 * content fades and the card swells until it covers the screen — the parent
 * switches workspace under that cover, then fades a matching curtain away
 * (App.jsx "ws-curtain"). Web Animations on transform/opacity; the parents
 * drive the phases.
 */
const reducedMotion = () => !!window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
const SPRING = "cubic-bezier(0.34, 1.25, 0.64, 1)";
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
  const shift = useRef(null);

  useLayoutEffect(() => {
    const sel = transitioningTo && cardRefs.current[transitioningTo];
    if (!sel || reducedMotion()) return;
    if (transitionPhase === "loading") {
      // Others drop away, one after another.
      workspaces.filter((k) => k !== transitioningTo).forEach((k, i) => {
        cardRefs.current[k]?.animate(
          [{ opacity: 1, transform: "none" }, { opacity: 0, transform: `translateY(36px) scale(0.86) rotate(${i % 2 ? 3 : -3}deg)` }],
          { duration: 420, delay: i * 70, easing: "cubic-bezier(0.4, 0, 1, 1)", fill: "forwards" },
        );
      });
      // The chosen one lifts and flies to the centre of the screen.
      const r = sel.getBoundingClientRect();
      const dx = window.innerWidth / 2 - (r.left + r.width / 2);
      const dy = window.innerHeight / 2 - (r.top + r.height / 2);
      shift.current = { dx, dy, w: r.width, h: r.height };
      sel.animate(
        [
          { transform: "none" },
          { transform: `translate(${dx * 0.35}px, ${dy * 0.35 - 18}px) scale(1.04) rotate(-1.5deg)`, offset: 0.35 },
          { transform: `translate(${dx}px, ${dy}px) scale(1.08)` },
        ],
        { duration: 720, easing: SPRING, fill: "forwards" },
      );
      sel.querySelector(".workspace-card-icon")?.animate(
        [{ transform: "rotate(0deg) scale(1)" }, { transform: "rotate(-200deg) scale(1.15)", offset: 0.6 }, { transform: "rotate(-180deg) scale(1)" }],
        { duration: 900, easing: "cubic-bezier(0.2, 0, 0, 1)", fill: "forwards" },
      );
    } else if (transitionPhase === "out" && shift.current) {
      // Content fades, then the card swells to cover the screen.
      const { dx, dy, w, h } = shift.current;
      const cover = Math.max(window.innerWidth / w, window.innerHeight / h) * 1.25;
      [...sel.children].forEach((c) => c.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, easing: "ease-in", fill: "forwards" }));
      sel.animate(
        [{ transform: `translate(${dx}px, ${dy}px) scale(1.08)` }, { transform: `translate(${dx}px, ${dy}px) scale(${cover})` }],
        { duration: 440, delay: 90, easing: "cubic-bezier(0.7, 0, 0.84, 0)", fill: "forwards" },
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transitioningTo, transitionPhase]);

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

        // During a transition the motion itself is Web Animations (above).
        let dynamic = {};
        if (isOther) dynamic = { pointerEvents: "none" };
        else if (isTransitioning) {
          dynamic = { zIndex: 10, position: "relative", boxShadow: "0 30px 70px rgba(0,0,0,0.4)", pointerEvents: "none" };
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
              transition: transitioningTo ? "box-shadow 0.5s ease" : "transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1), scale 0.2s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.2s, border-color 0.15s",
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
  // Same fly-to-center transition as the in-app picker: the chosen card flies to
  // the viewport center, shows "Loading workspace…", shrinks to zero, then we
  // hand off to onSelect (which enters the app / plays the intro).
  const [transitioningTo, setTransitioningTo] = useState(null);
  const [transitionPhase, setTransitionPhase] = useState(null);

  function handlePick(key) {
    if (transitioningTo) return;
    setTransitioningTo(key);
    setTransitionPhase("loading");
    setTimeout(() => setTransitionPhase("out"), 1050);
    setTimeout(() => onSelect && onSelect(key), 1560);
  }

  return (
    <div className="login-container">
      <div className="header-box" style={{ marginBottom: 30, opacity: transitioningTo ? 0 : 1, transition: "opacity 0.4s ease" }}>
        <img src="https://i.imgur.com/BRd5lrB.png" alt="ECE Logo" className="header-logo" />
        <div className="header-text-content">
          <h1>HERMES</h1>
          <p>ECE Project Database · Workforce · Operations · Executives</p>
        </div>
      </div>

      {/* No wrapper card — the title and cards float directly on the background. */}
      <div style={{ maxWidth: 720, width: "100%", textAlign: "center" }}>
        {/* Stays in the layout (just fades) so the cards don't jump when you pick one. */}
        <div style={{ opacity: transitioningTo ? 0 : 1, transform: transitioningTo ? "translateY(-10px)" : "none", transition: "opacity 0.3s ease, transform 0.3s ease" }}>
          <h2 style={{ color: "var(--color-text-primary)", marginBottom: 6 }}>Choose a workspace</h2>
          <p style={{ color: "var(--color-text-secondary)", lineHeight: 1.6, marginBottom: 28 }}>
            {userName ? `Welcome back, ${userName}. ` : ""}
            Select where you'd like to go — you can switch anytime from the header.
          </p>
        </div>

        <WorkspaceCards
          workspaces={workspaces}
          onSelect={handlePick}
          transitioningTo={transitioningTo}
          transitionPhase={transitionPhase}
        />

        {onLogout && !transitioningTo && (
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
