import { useState, useEffect } from "react";
import { useMutation } from "../data/react";
import { api } from "../data/api";
import AuthShell, { AuthButton, AuthField, AuthError, MailIcon, LockIcon, KeyIcon } from "./AuthShell";

const LAST_EMAIL = "hermes_last_email";
const readLastEmail = () => { try { return localStorage.getItem(LAST_EMAIL) || ""; } catch { return ""; } };

export default function Login({ onLogin, externalError = "", onResetSuccess, onNewUserSetup }) {
  const [mode, setMode] = useState("email"); // "email" | "password" | "forgot" | "verify"
  const [email, setEmail] = useState(readLastEmail);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [securityQuestion, setSecurityQuestion] = useState("");
  const [securityAnswer, setSecurityAnswer] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(0);

  const fetchQuestionMut = useMutation(api.staff.getSecurityQuestion);
  const verifyAnswerMut = useMutation(api.staff.verifySecurityAnswer);
  const checkEmailMut = useMutation(api.staff.checkEmailStatus);

  const displayError = error || (mode === "password" ? externalError : "");
  // A new error nudges the card so it's noticed.
  useEffect(() => { if (displayError) setShake((n) => n + 1); }, [displayError]);

  const cleanEmail = () => email.trim().toLowerCase();
  const go = (next) => { setMode(next); setError(""); };

  // Step 1: who are you?
  const handleEmailSubmit = async (e) => {
    e.preventDefault();
    if (!email.trim() || !email.includes("@")) { setError("Enter your work email address."); return; }
    setBusy(true);
    setError("");
    try {
      const result = await checkEmailMut({ email: cleanEmail() });
      if (result.revoked) { setError("Your access has been revoked. Ask an administrator if you think that's a mistake."); return; }
      try { localStorage.setItem(LAST_EMAIL, cleanEmail()); } catch { /* private mode */ }
      // Signed up but never set a password → straight to setting one.
      if (result.exists && !result.hasPassword) { onNewUserSetup?.(cleanEmail()); return; }
      go("password");
    } catch {
      setError("Couldn't check that email. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  // Step 2: password. App does the sign-in; we just show it working.
  const handlePasswordSubmit = async (e) => {
    e.preventDefault();
    if (!password) { setError("Enter your password."); return; }
    setBusy(true);
    setError("");
    try {
      await onLogin(cleanEmail(), password);
    } finally {
      setBusy(false); // still here → it didn't work, and App passed the reason in externalError
    }
  };

  const handleFetchQuestion = async (e) => {
    e.preventDefault();
    if (!email.trim() || !email.includes("@")) { setError("Enter your work email address."); return; }
    setBusy(true);
    setError("");
    try {
      const res = await fetchQuestionMut({ email: cleanEmail() });
      if (res?.question) { setSecurityQuestion(res.question); go("verify"); }
      else setError("There's no security question on this account. Ask an Admin+ or Manager to reset your password.");
    } catch (err) {
      setError(err.message || "Couldn't find that account.");
    } finally {
      setBusy(false);
    }
  };

  const handleVerifyAnswer = async (e) => {
    e.preventDefault();
    if (!securityAnswer.trim()) { setError("Type your answer."); return; }
    setBusy(true);
    setError("");
    try {
      const res = await verifyAnswerMut({ email: cleanEmail(), answer: securityAnswer });
      if (res.success) onResetSuccess?.(cleanEmail());
    } catch (err) {
      setError(err.message || "That answer doesn't match.");
    } finally {
      setBusy(false);
    }
  };

  const watchCaps = (e) => setCapsLock(!!e.getModifierState?.("CapsLock"));
  const steps = mode === "email" || mode === "password" ? 2 : 0;
  const stepNo = mode === "password" ? 2 : 1;

  return (
    <AuthShell busy={busy} cardKey={mode} help="Can't get in? An Admin+ or Manager can reset your password from Settings → Staff Management.">
      <div className={`auth-shake-${shake % 2}`}>
        {steps > 0 && (
          <div className="auth-steps" aria-label={`Step ${stepNo} of ${steps}`}>
            <span className={stepNo >= 1 ? "on" : ""} /><span className={stepNo >= 2 ? "on" : ""} />
          </div>
        )}

        {mode === "email" && (
          <form onSubmit={handleEmailSubmit} noValidate>
            <div className="auth-eyebrow">Sign in</div>
            <h1 className="auth-title">Welcome back</h1>
            <p className="auth-sub">Use your ECE work email to get into Hermes.</p>
            <label className="auth-label" htmlFor="auth-email">Work email</label>
            <AuthField
              id="auth-email"
              icon={MailIcon}
              error={!!error}
              type="email"
              placeholder="name@ececontactcenters.com"
              value={email}
              onChange={(e) => { setEmail(e.target.value); setError(""); }}
              autoFocus
              autoComplete="username"
              disabled={busy}
            />
            <AuthError>{error}</AuthError>
            <AuthButton type="submit" busy={busy} busyLabel="Checking…">Continue</AuthButton>
          </form>
        )}

        {mode === "password" && (
          <form onSubmit={handlePasswordSubmit} noValidate>
            <div className="auth-eyebrow">Sign in</div>
            <h1 className="auth-title">Enter your password</h1>
            <div className="auth-who">
              <span className="auth-who-avatar" aria-hidden="true">{(cleanEmail()[0] || "?").toUpperCase()}</span>
              <span className="auth-who-email">{cleanEmail()}</span>
              <button type="button" className="auth-link" onClick={() => { setPassword(""); go("email"); }} disabled={busy}>Change</button>
            </div>
            <label className="auth-label" htmlFor="auth-password">
              Password
              <button type="button" className="auth-link" onClick={() => { setPassword(""); go("forgot"); }} disabled={busy}>Forgot it?</button>
            </label>
            <AuthField
              id="auth-password"
              icon={LockIcon}
              error={!!displayError}
              type={showPassword ? "text" : "password"}
              placeholder="Your password"
              value={password}
              onChange={(e) => { setPassword(e.target.value); setError(""); }}
              onKeyDown={watchCaps}
              onKeyUp={watchCaps}
              autoFocus
              autoComplete="current-password"
              disabled={busy}
              reveal
              revealed={showPassword}
              onReveal={() => setShowPassword((v) => !v)}
            />
            {capsLock && !displayError && <div className="auth-hint">Caps Lock is on.</div>}
            <AuthError>{displayError}</AuthError>
            <AuthButton type="submit" busy={busy} busyLabel="Signing in…">Sign in</AuthButton>
          </form>
        )}

        {mode === "forgot" && (
          <form onSubmit={handleFetchQuestion} noValidate>
            <div className="auth-eyebrow">Forgot your password</div>
            <h1 className="auth-title">Reset your password</h1>
            <p className="auth-sub">Answer your security question and you can set a new password right away.</p>
            <label className="auth-label" htmlFor="auth-forgot-email">Work email</label>
            <AuthField
              id="auth-forgot-email"
              icon={MailIcon}
              error={!!error}
              type="email"
              placeholder="name@ececontactcenters.com"
              value={email}
              onChange={(e) => { setEmail(e.target.value); setError(""); }}
              autoFocus
              disabled={busy}
            />
            <AuthError>{error}</AuthError>
            <AuthButton type="submit" busy={busy} busyLabel="Finding your account…">Find my account</AuthButton>
            <button type="button" className="auth-back" onClick={() => go(email ? "password" : "email")} disabled={busy}>← Back to sign in</button>
          </form>
        )}

        {mode === "verify" && (
          <form onSubmit={handleVerifyAnswer} noValidate>
            <div className="auth-eyebrow">Forgot your password</div>
            <h1 className="auth-title">Security question</h1>
            <p className="auth-question">{securityQuestion}</p>
            <label className="auth-label" htmlFor="auth-answer">Your answer</label>
            <AuthField
              id="auth-answer"
              icon={KeyIcon}
              error={!!error}
              type="text"
              placeholder="Your answer"
              value={securityAnswer}
              onChange={(e) => { setSecurityAnswer(e.target.value); setError(""); }}
              autoFocus
              autoComplete="off"
              disabled={busy}
            />
            <AuthError>{error}</AuthError>
            <AuthButton type="submit" busy={busy} busyLabel="Checking…">Check my answer</AuthButton>
            <button type="button" className="auth-back" onClick={() => { setSecurityAnswer(""); go("forgot"); }} disabled={busy}>← Back</button>
          </form>
        )}
      </div>
    </AuthShell>
  );
}
