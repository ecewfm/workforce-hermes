import { useState } from "react";
import Select from "./ui/Select";
import AuthShell, { AuthButton, AuthField, AuthError, LockIcon, KeyIcon } from "./AuthShell";
import { useMutation } from "../data/react";
import { api } from "../data/api";

const SECURITY_QUESTIONS = [
  "What was the name of your first pet?",
  "What city were you born in?",
  "What is your mother's maiden name?",
  "What was the name of your first school?",
  "What is your favorite movie?",
  "What was the make of your first car?",
  "What is the name of the street you grew up on?",
  "What was your childhood nickname?",
];

export default function SetPassword({ email, onSet, onComplete, mode = "onboarding" }) {
  const [step, setStep] = useState(mode === "security-only" ? "security" : "password"); // "password" | "security"
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [selectedQuestion, setSelectedQuestion] = useState("");
  const [securityAnswer, setSecurityAnswer] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [show, setShow] = useState(false);

  const setPasswordMut = useMutation(api.staff.setPassword);
  const setSecurityQuestionMut = useMutation(api.staff.setSecurityQuestion);

  const handlePasswordSubmit = async (e) => {
    e.preventDefault();
    if (newPassword.length < 4) {
      setError("Use at least 4 characters (8 or more is safer).");
      return;
    }
    if (newPassword !== confirm) {
      setError("The two passwords don't match.");
      return;
    }
    setIsLoading(true);
    setError("");
    try {
      await setPasswordMut({ email, password: newPassword });
      // Move to security question step
      setStep("security");
    } catch (err) {
      setError("Couldn't save your password. Try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSecuritySubmit = async (e) => {
    e.preventDefault();
    if (!selectedQuestion) {
      setError("Pick a security question.");
      return;
    }
    if (!securityAnswer.trim()) {
      setError("Type your answer.");
      return;
    }
    if (securityAnswer.trim().length < 2) {
      setError("Use at least 2 characters.");
      return;
    }
    setIsLoading(true);
    setError("");
    try {
      await setSecurityQuestionMut({
        email,
        question: selectedQuestion,
        answer: securityAnswer.trim(),
      });
      // Done — route back to login
      if (onComplete) {
        onComplete();
      } else if (onSet) {
        onSet(newPassword);
      }
    } catch (err) {
      setError("Couldn't save your security question. Try again.");
    } finally {
      setIsLoading(false);
    }
  };

  // How strong the new password looks (a nudge, not a rule).
  const strength = !newPassword ? 0 : newPassword.length < 8 ? 1 : /[A-Z]/.test(newPassword) && /\d/.test(newPassword) && newPassword.length >= 10 ? 3 : 2;
  const strengthLabel = ["", "Short — 8 or more characters is safer", "Good", "Strong"][strength];
  const onboarding = mode !== "security-only";

  return (
    <AuthShell busy={isLoading} cardKey={step}>
      {onboarding && (
        <div className="auth-steps" aria-label={`Step ${step === "password" ? 1 : 2} of 2`}>
          <span className="on" /><span className={step === "security" ? "on" : ""} />
        </div>
      )}

      {step === "password" && (
        <form onSubmit={handlePasswordSubmit} noValidate>
          <div className="auth-eyebrow">Set up your account</div>
          <h1 className="auth-title">Create your password</h1>
          <p className="auth-sub">You'll use it with <b>{email}</b> to sign in to Hermes.</p>
          <label className="auth-label" htmlFor="sp-new">New password</label>
          <AuthField id="sp-new" icon={LockIcon} type={show ? "text" : "password"} placeholder="New password" value={newPassword}
            onChange={(e) => { setNewPassword(e.target.value); setError(""); }} autoFocus autoComplete="new-password" disabled={isLoading}
            reveal revealed={show} onReveal={() => setShow((v) => !v)} />
          {strength > 0 && (
            <div className={`auth-strength s${strength}`}><span /><span /><span /><em>{strengthLabel}</em></div>
          )}
          <label className="auth-label" htmlFor="sp-confirm">Confirm password</label>
          <AuthField id="sp-confirm" icon={LockIcon} error={!!error} type={show ? "text" : "password"} placeholder="Confirm password" value={confirm}
            onChange={(e) => { setConfirm(e.target.value); setError(""); }} autoComplete="new-password" disabled={isLoading} />
          <AuthError>{error}</AuthError>
          <AuthButton type="submit" busy={isLoading} busyLabel="Saving…">Save password</AuthButton>
        </form>
      )}

      {step === "security" && (
        <form onSubmit={handleSecuritySubmit} noValidate>
          <div className="auth-eyebrow">{onboarding ? "Set up your account" : "One more thing"}</div>
          <h1 className="auth-title">Pick a security question</h1>
          <p className="auth-sub">If you ever forget your password, answering it lets you set a new one yourself.</p>
          <label className="auth-label">Question</label>
          <div className="auth-select">
            <Select
              className="security-question-select"
              value={selectedQuestion}
              onChange={(v) => { setSelectedQuestion(v); setError(""); }}
              placeholder="Choose a question…"
              options={SECURITY_QUESTIONS.map((q) => ({ value: q, label: q }))}
              ariaLabel="Security question"
              required
            />
          </div>
          <label className="auth-label" htmlFor="sp-answer">Your answer</label>
          <AuthField id="sp-answer" icon={KeyIcon} error={!!error} type="text" placeholder="Your answer" value={securityAnswer}
            onChange={(e) => { setSecurityAnswer(e.target.value); setError(""); }} autoComplete="off" disabled={isLoading} />
          <AuthError>{error}</AuthError>
          <AuthButton type="submit" busy={isLoading} busyLabel="Saving…">{onboarding ? "Finish setup" : "Save question"}</AuthButton>
          {!onboarding && <button type="button" className="auth-back" onClick={onComplete} disabled={isLoading}>Skip for now</button>}
        </form>
      )}
    </AuthShell>
  );
}
