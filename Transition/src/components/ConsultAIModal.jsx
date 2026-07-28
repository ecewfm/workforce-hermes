import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { consultTaskPlan } from "../utils/taskPlanner";

/**
 * ConsultAIModal — the "Consult with AI" planner for New Task. The user
 * describes what they're building; the AI (department-aware) proposes a set
 * of task-specific milestones with day estimates and a derived completion
 * deadline. They can refine, then apply the plan to prefill the form.
 *
 * Portaled to <body> so the cursor-camera transform on .view-stage can never
 * displace or clip it.
 */
export default function ConsultAIModal({ open, onClose, department, workspaceLabel, startDateISO, onApply }) {
  const [brief, setBrief] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [plan, setPlan] = useState(null);
  const [refinement, setRefinement] = useState("");
  const historyRef = useRef([]);
  const briefRef = useRef(null);

  // Reset everything each time the modal is (re)opened.
  useEffect(() => {
    if (open) {
      setBrief(""); setError(""); setPlan(null); setRefinement(""); setLoading(false);
      historyRef.current = [];
      setTimeout(() => briefRef.current?.focus(), 60);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onEsc = (e) => { if (e.key === "Escape" && !loading) onClose(); };
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [open, loading, onClose]);

  if (!open) return null;

  const todayISO = new Date().toISOString().slice(0, 10);
  const totalDays = plan ? plan.milestones.reduce((s, m) => s + m.days, 0) : 0;

  const completionDate = () => {
    const base = startDateISO ? new Date(startDateISO + "T00:00:00") : new Date();
    if (isNaN(base.getTime())) return null;
    const d = new Date(base);
    d.setDate(d.getDate() + totalDays);
    return d;
  };
  const fmt = (d) => d?.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  async function generate(isRefine) {
    const text = isRefine ? refinement.trim() : brief.trim();
    if (!text) return;
    setLoading(true); setError("");
    try {
      const { plan: newPlan, contents } = await consultTaskPlan({
        department,
        workspaceLabel,
        brief: brief.trim(),
        startDateISO,
        todayISO,
        history: isRefine ? historyRef.current : [],
        refinement: isRefine ? refinement.trim() : "",
      });
      historyRef.current = contents;
      setPlan(newPlan);
      setRefinement("");
    } catch (err) {
      setError(err?.message || "Couldn't generate a plan. Try again.");
    } finally {
      setLoading(false);
    }
  }

  const comp = completionDate();

  return createPortal(
    <div className="modal-overlay consult-overlay" onClick={(e) => { if (e.target === e.currentTarget && !loading) onClose(); }}>
      <div className="consult-modal">
        <button className="modal-close" onClick={onClose} disabled={loading}>×</button>

        <div className="consult-head">
          <div className="consult-badge">✦ AI</div>
          <div>
            <h2 className="consult-title">Consult with AI</h2>
            <p className="consult-sub">
              Describe what you're planning — the AI knows how <strong>{workspaceLabel}</strong> work gets done and will
              propose milestones and a timeline tailored to it.
            </p>
          </div>
        </div>

        <div className="consult-body">
          <label className="consult-label">What are you planning to build or do?</label>
          <textarea
            ref={briefRef}
            className="consult-textarea"
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            placeholder={placeholderFor(department)}
            disabled={loading}
          />

          {!plan && (
            <button className="consult-generate" onClick={() => generate(false)} disabled={loading || !brief.trim()}>
              {loading ? "Planning…" : "✦ Propose a plan"}
            </button>
          )}

          {error && <div className="consult-error">{error}</div>}

          {plan && (
            <div className="consult-result">
              {plan.rationale && <p className="consult-rationale">{plan.rationale}</p>}

              <div className="consult-plan-head">
                <span>Proposed milestones</span>
                <span className="consult-plan-meta">
                  {plan.milestones.length} steps · {totalDays} days{comp ? ` · done by ${fmt(comp)}` : ""}
                </span>
              </div>

              <ol className="consult-milestones">
                {plan.milestones.map((m, i) => (
                  <li key={i}>
                    <span className="cm-name">{m.name}</span>
                    <span className="cm-days">{m.days}d</span>
                  </li>
                ))}
              </ol>

              <div className="consult-refine">
                <input
                  className="consult-refine-input"
                  value={refinement}
                  onChange={(e) => setRefinement(e.target.value)}
                  placeholder="Refine it… e.g. “tighter timeline”, “add a security review”"
                  disabled={loading}
                  onKeyDown={(e) => { if (e.key === "Enter" && refinement.trim()) generate(true); }}
                />
                <button className="consult-refine-btn" onClick={() => generate(true)} disabled={loading || !refinement.trim()}>
                  {loading ? "…" : "Refine"}
                </button>
              </div>

              <div className="consult-actions">
                <button className="btn-secondary" onClick={onClose} disabled={loading}>Cancel</button>
                <button className="btn-primary consult-apply" onClick={() => { onApply(plan); onClose(); }} disabled={loading}>
                  Use this plan →
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

function placeholderFor(department) {
  if (department === "Operations")
    return "e.g. Roll out a new adherence-monitoring process for the RTA team across all sites, with a pilot before full rollout.";
  if (department === "Executives")
    return "e.g. Evaluate and propose consolidating our three reporting tools into one, with a business case for the board.";
  if (department === "Workforce")
    return "e.g. Build an internal dashboard that pulls Zoho ticket data and shows SLA breaches with email alerts.";
  return "Describe the task: what needs to happen, any constraints, and roughly how big it is.";
}
