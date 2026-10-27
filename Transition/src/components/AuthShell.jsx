import "../styles/auth.css";

const POINTS = [
  {
    title: "Plan with AI to a real deadline",
    text: "Describe the work and pick the dates; Hermes lays out the steps to get there.",
    icon: <path d="M12 3l1.9 4.6L18.5 9l-4.6 1.9L12 15.5l-1.9-4.6L5.5 9l4.6-1.4zM19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z" />,
  },
  {
    title: "Built around each account",
    text: "Every client account's SOPs shape the plans made for it.",
    icon: <><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></>,
  },
  {
    title: "Nothing slips quietly",
    text: "Late and nearly-late projects reach their owners on Cliq every weekday.",
    icon: <><circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12 15.5 14" /></>,
  },
];

/**
 * The frame every sign-in screen sits in: Hermes' brand panel on the left
 * (a band on top on phones) and the form card on the right.
 */
export default function AuthShell({ children, busy = false, cardKey, help }) {
  return (
    <div className="auth">
      <aside className="auth-brand">
        <span className="auth-orb auth-orb--a" aria-hidden="true" />
        <span className="auth-orb auth-orb--b" aria-hidden="true" />
        <div className="auth-brand-inner">
          <img src="/ece-logo-light.png" alt="ECE Contact Centers" className="auth-logo" />
          <div className="auth-wordmark">HERMES</div>
          <p className="auth-tagline">Projects, plans and progress for Workforce, Operations and Executives.</p>
          <ul className="auth-points">
            {POINTS.map((p, i) => (
              <li key={p.title} style={{ "--i": i }}>
                <span className="auth-point-icon" aria-hidden="true">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{p.icon}</svg>
                </span>
                <span><b>{p.title}.</b> {p.text}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="auth-brand-foot">ECEnterprises Group Manila Inc. · Extraordinary Customer Experience</div>
      </aside>
      <main className="auth-main">
        <div className={`auth-card ${busy ? "busy" : ""}`} aria-busy={busy}>
          <span className="auth-progress" aria-hidden="true" />
          <div className="auth-step" key={cardKey}>{children}</div>
        </div>
        {help && <p className="auth-help">{help}</p>}
      </main>
    </div>
  );
}

/** A primary button that shows a spinner and its busy label while working. */
export function AuthButton({ busy, busyLabel, children, className = "", disabled, ...rest }) {
  return (
    <button {...rest} className={`auth-btn ${className} ${busy ? "busy" : ""}`} disabled={busy || disabled}>
      {busy && <span className="auth-spinner" aria-hidden="true" />}
      <span>{busy ? busyLabel : children}</span>
    </button>
  );
}

/** Text input with an icon, an optional show/hide toggle and an error state. */
export function AuthField({ icon, error, reveal, onReveal, revealed, ...input }) {
  return (
    <div className={`auth-field ${error ? "error" : ""}`}>
      {icon && <span className="auth-field-icon" aria-hidden="true">{icon}</span>}
      <input {...input} />
      {reveal && (
        <button type="button" className="auth-reveal" onClick={onReveal} aria-label={revealed ? "Hide password" : "Show password"} tabIndex={-1}>
          {revealed ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.9 17.9A10.4 10.4 0 0 1 12 20c-7 0-11-8-11-8a18.5 18.5 0 0 1 5.1-5.9M9.9 4.2A9.1 9.1 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.2 3.2M1 1l22 22" /><path d="M14.1 14.1a3 3 0 1 1-4.2-4.2" /></svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
          )}
        </button>
      )}
    </div>
  );
}

export const MailIcon = <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="16" rx="2" /><path d="M22 7l-10 6L2 7" /></svg>;
export const LockIcon = <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>;
export const KeyIcon = <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="7.5" cy="15.5" r="4.5" /><path d="M10.7 12.3L21 2M16 7l3 3M14 9l2 2" /></svg>;

/** The error line under a field (role=alert so screen readers hear it). */
export function AuthError({ children }) {
  if (!children) return null;
  return (
    <div className="auth-error" role="alert">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
      <span>{children}</span>
    </div>
  );
}
