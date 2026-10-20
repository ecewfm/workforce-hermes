import { useState } from "react";
import Select from "./ui/Select";
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

  const setPasswordMut = useMutation(api.staff.setPassword);
  const setSecurityQuestionMut = useMutation(api.staff.setSecurityQuestion);

  const handlePasswordSubmit = async (e) => {
    e.preventDefault();
    if (newPassword.length < 4) {
      setError("Password must be at least 4 characters.");
      return;
    }
    if (newPassword !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setIsLoading(true);
    setError("");
    try {
      await setPasswordMut({ email, password: newPassword });
      // Move to security question step
      setStep("security");
    } catch (err) {
      setError("Failed to set password. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSecuritySubmit = async (e) => {
    e.preventDefault();
    if (!selectedQuestion) {
      setError("Please select a security question.");
      return;
    }
    if (!securityAnswer.trim()) {
      setError("Please provide an answer.");
      return;
    }
    if (securityAnswer.trim().length < 2) {
      setError("Answer must be at least 2 characters.");
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
      setError("Failed to save security question. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="login-container">
      <div className="header-box" style={{ marginBottom: 30 }}>
        <img src="https://i.imgur.com/BRd5lrB.png" alt="ECE Logo" className="header-logo" />
        <div className="header-text-content">
          <h1>HERMES</h1>
          <p>ECE Project Database · Workforce · Operations · Executives</p>
        </div>
      </div>
      <div className="login-box">
        {step === "password" && (
          <>
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#4355f1" strokeWidth="2" style={{ marginBottom: 20 }}>
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
            <h2 style={{ color: "#1e293b", marginBottom: 10, fontWeight: 900 }}>Set Your Password</h2>
            <p style={{ color: "#64748b", fontSize: "0.9rem", marginBottom: 5 }}>
              Welcome! Create a secure password for
            </p>
            <p style={{ color: "#4355f1", fontWeight: 700, fontSize: "0.85rem", marginBottom: 20, wordBreak: "break-all" }}>
              {email}
            </p>

            {/* Step indicator */}
            <div className="login-step-indicator">
              <div className="login-step-dot active" />
              <div className="login-step-dot" />
            </div>

            <form onSubmit={handlePasswordSubmit} style={{ width: "100%" }}>
              <div className="form-group" style={{ marginBottom: "15px" }}>
                <input
                  type="password"
                  className="form-input"
                  placeholder="New password"
                  value={newPassword}
                  onChange={(e) => { setNewPassword(e.target.value); setError(""); }}
                  required
                  autoFocus
                />
              </div>
              <div className="form-group" style={{ marginBottom: "20px" }}>
                <input
                  type="password"
                  className={`form-input ${error ? "input-error" : ""}`}
                  placeholder="Confirm password"
                  value={confirm}
                  onChange={(e) => { setConfirm(e.target.value); setError(""); }}
                  required
                />
                {error && <div className="error-text">{error}</div>}
              </div>
              <button type="submit" className="btn-primary" style={{ width: "100%" }} disabled={isLoading}>
                {isLoading ? "Saving..." : "Set Password & Continue"}
              </button>
            </form>
          </>
        )}

        {step === "security" && (
          <>
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2" style={{ marginBottom: 20 }}>
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
            <h2 style={{ color: "#1e293b", marginBottom: 10, fontWeight: 900 }}>Security Question</h2>
            <p style={{ color: "#64748b", fontSize: "0.9rem", marginBottom: 5 }}>
              Choose a question for account recovery.
            </p>
            <p style={{ color: "#4355f1", fontWeight: 700, fontSize: "0.8rem", marginBottom: 20 }}>
              This will be used if you forget your password.
            </p>

            {/* Step indicator */}
            <div className="login-step-indicator">
              <div className="login-step-dot completed" />
              <div className="login-step-dot active" />
            </div>

            <form onSubmit={handleSecuritySubmit} style={{ width: "100%" }}>
              <div className="form-group" style={{ marginBottom: "15px" }}>
                <Select
                  className="security-question-select"
                  value={selectedQuestion}
                  onChange={(v) => { setSelectedQuestion(v); setError(""); }}
                  placeholder="Select a security question..."
                  options={SECURITY_QUESTIONS.map((q) => ({ value: q, label: q }))}
                  ariaLabel="Security question"
                  required
                />
              </div>
              <div className="form-group" style={{ marginBottom: "20px" }}>
                <input
                  type="text"
                  className={`form-input ${error ? "input-error" : ""}`}
                  placeholder="Your answer"
                  value={securityAnswer}
                  onChange={(e) => { setSecurityAnswer(e.target.value); setError(""); }}
                  required
                  autoFocus
                />
                {error && <div className="error-text">{error}</div>}
              </div>
              <button type="submit" className="btn-primary" style={{ width: "100%" }} disabled={isLoading}>
                {isLoading ? "Saving..." : "Complete Setup"}
              </button>
              {mode === "security-only" && (
                <button 
                  type="button" 
                  className="btn-secondary" 
                  style={{ width: "100%", marginTop: "12px", background: "none", border: "1px solid #e2e8f0" }} 
                  onClick={onComplete}
                >
                  Skip for now
                </button>
              )}
            </form>
          </>
        )}
      </div>
    </div>
  );
}
