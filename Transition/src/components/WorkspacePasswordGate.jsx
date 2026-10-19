import { useState } from "react";
import { workspaceLabel } from "../utils/departments";
import { termsFor } from "../utils/workspaceTerms";

/**
 * Full-screen gate shown when the active workspace has an entry password that
 * the user hasn't unlocked this session. `onSubmit(pw)` returns a Promise<bool>
 * (validated by the parent against the stored hash); on true the parent unlocks
 * and unmounts this. `onBack` returns to the workspace picker.
 */
export default function WorkspacePasswordGate({ workspace, onSubmit, onBack }) {
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const label = workspaceLabel(workspace);

  async function submit(e) {
    e?.preventDefault?.();
    if (!pw || busy) return;
    setBusy(true);
    setErr("");
    try {
      const ok = await onSubmit(pw);
      if (!ok) {
        setErr("Incorrect password. Please try again.");
        setPw("");
      }
      // On success the parent marks the workspace unlocked and unmounts us.
    } catch {
      setErr("Couldn't verify the password. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-container">
      <div className="header-box" style={{ marginBottom: 30 }}>
        <img src="https://i.imgur.com/BRd5lrB.png" alt="ECE Logo" className="header-logo" />
        <div className="header-text-content">
          <h1>WORKFORCE HERMES</h1>
          <p>{termsFor(workspace).appSubtitle}</p>
        </div>
        <img src="https://i.imgur.com/ycmU6oP.png" alt="WFM Logo" className="header-logo" />
      </div>

      <div
        style={{
          maxWidth: 420,
          width: "100%",
          background: "var(--color-card-bg, #fff)",
          border: "1px solid var(--glass-border, #e2e8f0)",
          borderRadius: 20,
          padding: "40px 34px",
          textAlign: "center",
          boxShadow: "0 20px 50px rgba(0,0,0,0.18)",
        }}
      >
        <div
          style={{
            width: 64,
            height: 64,
            borderRadius: 18,
            margin: "0 auto 18px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "linear-gradient(135deg, var(--color-accent, #4355f1), var(--color-nav-bg, #2b3a8c))",
          }}
        >
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.2">
            <rect x="3" y="11" width="18" height="11" rx="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        </div>

        <h2 style={{ color: "var(--color-text-primary)", margin: "0 0 6px" }}>{label} is locked</h2>
        <p style={{ color: "var(--color-text-secondary)", lineHeight: 1.6, margin: "0 0 22px", fontSize: "0.9rem" }}>
          This workspace requires a password. Enter it to continue.
        </p>

        <form onSubmit={submit}>
          <input
            type="password"
            className="login-input"
            placeholder="Workspace password"
            value={pw}
            autoFocus
            disabled={busy}
            onChange={(e) => { setPw(e.target.value); if (err) setErr(""); }}
            style={{ width: "100%", marginBottom: 12 }}
          />
          {err && (
            <div style={{ color: "#dc2626", fontSize: "0.8rem", fontWeight: 700, marginBottom: 12 }}>{err}</div>
          )}
          <button
            type="submit"
            className="btn-primary"
            disabled={busy || !pw}
            style={{ width: "100%", padding: "11px 0", opacity: busy || !pw ? 0.6 : 1 }}
          >
            {busy ? "Checking…" : "Unlock workspace"}
          </button>
        </form>

        {onBack && (
          <button
            className="btn-secondary"
            onClick={onBack}
            style={{ marginTop: 16, padding: "9px 20px", background: "var(--color-logout)" }}
          >
            Choose another workspace
          </button>
        )}
      </div>
    </div>
  );
}
