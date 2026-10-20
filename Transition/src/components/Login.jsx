import { useState } from "react";
import { useMutation } from "../data/react";
import { api } from "../data/api";

export default function Login({ onLogin, externalError = "", onResetSuccess, onNewUserSetup }) {
  const [mode, setMode] = useState("email"); // "email", "password", "forgot", "verify"
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [securityQuestion, setSecurityQuestion] = useState("");
  const [securityAnswer, setSecurityAnswer] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const fetchQuestionMut = useMutation(api.staff.getSecurityQuestion);
  const verifyAnswerMut = useMutation(api.staff.verifySecurityAnswer);
  const checkEmailMut = useMutation(api.staff.checkEmailStatus);

  const displayError = externalError || error;

  // Step 1: Check email and determine next step
  const handleEmailSubmit = async (e) => {
    e.preventDefault();
    if (!email.trim() || !email.includes("@")) {
      setError("Please enter a valid email address.");
      return;
    }
    setIsLoading(true);
    setError("");
    try {
      const result = await checkEmailMut({ email: email.trim().toLowerCase() });
      
      if (result.revoked) {
        setError("Your access has been revoked. Please contact an administrator.");
        setIsLoading(false);
        return;
      }

      if (!result.exists) {
        // New user — they can try registering with the default password
        setMode("password");
        setIsLoading(false);
        return;
      }

      if (!result.hasPassword) {
        // User exists but no password — route to set-password flow
        if (onNewUserSetup) {
          onNewUserSetup(email.trim().toLowerCase());
        }
        setIsLoading(false);
        return;
      }

      // User has a password — show password input
      setMode("password");
      setIsLoading(false);
    } catch (err) {
      setError("Failed to check email. Please try again.");
      setIsLoading(false);
    }
  };

  // Step 2: Submit password for authentication
  const handlePasswordSubmit = (e) => {
    e.preventDefault();
    if (!password) {
      setError("Please enter a password.");
      return;
    }
    onLogin(email.trim().toLowerCase(), password);
  };

  const handleFetchQuestion = async (e) => {
    e.preventDefault();
    if (!email.trim() || !email.includes("@")) {
      setError("Please enter a valid email address.");
      return;
    }
    setIsLoading(true);
    setError("");
    try {
      const res = await fetchQuestionMut({ email: email.trim().toLowerCase() });
      if (res && res.question) {
        setSecurityQuestion(res.question);
        setMode("verify");
      }
    } catch (err) {
      setError(err.message || "Failed to find account or question.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyAnswer = async (e) => {
    e.preventDefault();
    if (!securityAnswer.trim()) {
      setError("Please provide an answer.");
      return;
    }
    setIsLoading(true);
    setError("");
    try {
      const res = await verifyAnswerMut({ email: email.trim().toLowerCase(), answer: securityAnswer });
      if (res.success) {
        // Pass control to App.jsx to drop user into the set-password flow
        if (onResetSuccess) {
          onResetSuccess(email.trim().toLowerCase());
        }
      }
    } catch (err) {
      setError(err.message || "Incorrect answer.");
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
        {mode === "email" && (
          <>
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#4355f1" strokeWidth="2" style={{ marginBottom: 20 }}>
              <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
              <polyline points="22,6 12,13 2,6" />
            </svg>
            <h2 style={{ color: "#1e293b", marginBottom: 10, fontWeight: 900 }}>Welcome Back</h2>
            <p style={{ color: "#64748b", fontSize: "0.9rem", marginBottom: 25 }}>
              Enter your email address to continue.
            </p>

            {/* Step indicator */}
            <div className="login-step-indicator">
              <div className="login-step-dot active" />
              <div className="login-step-dot" />
            </div>

            <form onSubmit={handleEmailSubmit} style={{ width: "100%" }}>
              <div className="form-group" style={{ marginBottom: "20px" }}>
                <input
                  type="email"
                  className={`form-input ${error ? "input-error" : ""}`}
                  placeholder="Email address"
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); setError(""); }}
                  required
                  autoFocus
                  autoComplete="username"
                />
                {error && <div className="error-text">{error}</div>}
              </div>
              <button type="submit" className="btn-primary" style={{ width: "100%" }} disabled={isLoading}>
                {isLoading ? "Checking..." : "Continue"}
              </button>
            </form>
          </>
        )}

        {mode === "password" && (
          <>
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#4355f1" strokeWidth="2" style={{ marginBottom: 20 }}>
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
            </svg>
            <h2 style={{ color: "#1e293b", marginBottom: 10, fontWeight: 900 }}>Enter Password</h2>
            <p style={{ color: "#64748b", fontSize: "0.85rem", marginBottom: 5 }}>
              Signing in as
            </p>
            <p style={{ color: "#4355f1", fontWeight: 700, fontSize: "0.85rem", marginBottom: 20, wordBreak: "break-all" }}>
              {email}
            </p>

            {/* Step indicator */}
            <div className="login-step-indicator">
              <div className="login-step-dot completed" />
              <div className="login-step-dot active" />
            </div>

            <form onSubmit={handlePasswordSubmit} style={{ width: "100%" }}>
              <div className="form-group" style={{ marginBottom: "8px" }}>
                <input
                  type="password"
                  className={`form-input ${displayError ? "input-error" : ""}`}
                  placeholder="Password"
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setError(""); }}
                  required
                  autoFocus
                  autoComplete="current-password"
                />
                {displayError && <div className="error-text">{displayError}</div>}
              </div>
              <div style={{ textAlign: "right", marginBottom: "20px" }}>
                <button
                  type="button"
                  style={{ background: "none", border: "none", color: "var(--color-accent)", fontSize: "0.8rem", fontWeight: 700, cursor: "pointer", padding: 0 }}
                  onClick={() => { setMode("forgot"); setError(""); setPassword(""); }}
                >
                  Forgot Password?
                </button>
              </div>
              <button type="submit" className="btn-primary" style={{ width: "100%", marginBottom: "12px" }}>
                Secure Access
              </button>
              <button
                type="button"
                className="btn-secondary"
                style={{ width: "100%", padding: "10px", fontSize: "0.8rem" }}
                onClick={() => { setMode("email"); setPassword(""); setError(""); }}
              >
                ← Use a different email
              </button>
            </form>
          </>
        )}

        {mode === "forgot" && (
          <>
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#4355f1" strokeWidth="2" style={{ marginBottom: 20 }}>
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
            </svg>
            <h2 style={{ color: "#1e293b", marginBottom: 10, fontWeight: 900 }}>Reset Password</h2>
            <p style={{ color: "#64748b", fontSize: "0.9rem", marginBottom: 25 }}>
              Enter your email to answer your security question.
            </p>

            <form onSubmit={handleFetchQuestion} style={{ width: "100%" }}>
              <div className="form-group" style={{ marginBottom: "20px" }}>
                <input
                  type="email"
                  className={`form-input ${error ? "input-error" : ""}`}
                  placeholder="Email address"
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); setError(""); }}
                  required
                  autoFocus
                />
                {error && <div className="error-text">{error}</div>}
              </div>
              <button type="submit" className="btn-primary" style={{ width: "100%", marginBottom: "15px" }} disabled={isLoading}>
                {isLoading ? "Searching..." : "Find Account"}
              </button>
              <button
                type="button"
                className="btn-secondary"
                style={{ width: "100%" }}
                onClick={() => { setMode("password"); setError(""); }}
              >
                Back to Login
              </button>
            </form>
          </>
        )}

        {mode === "verify" && (
          <>
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2" style={{ marginBottom: 20 }}>
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
              <polyline points="22 4 12 14.01 9 11.01"></polyline>
            </svg>
            <h2 style={{ color: "#1e293b", marginBottom: 10, fontWeight: 900 }}>Security Question</h2>
            <p style={{ color: "#64748b", fontSize: "0.95rem", marginBottom: 20, fontWeight: 600 }}>
              {securityQuestion}
            </p>

            <form onSubmit={handleVerifyAnswer} style={{ width: "100%" }}>
              <div className="form-group" style={{ marginBottom: "20px" }}>
                <input
                  type="text"
                  className={`form-input ${error ? "input-error" : ""}`}
                  placeholder="Your Answer"
                  value={securityAnswer}
                  onChange={(e) => { setSecurityAnswer(e.target.value); setError(""); }}
                  required
                  autoFocus
                />
                {error && <div className="error-text" style={{ marginTop: 5 }}>{error}</div>}
              </div>
              <button type="submit" className="btn-primary" style={{ width: "100%", marginBottom: "15px" }} disabled={isLoading}>
                {isLoading ? "Verifying..." : "Submit Answer"}
              </button>
              <button
                type="button"
                className="btn-secondary"
                style={{ width: "100%" }}
                onClick={() => { setMode("forgot"); setError(""); setSecurityAnswer(""); }}
              >
                Back
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
