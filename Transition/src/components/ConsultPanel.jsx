import { useState, useEffect, useRef } from "react";
import { consultTaskPlan } from "../utils/taskPlanner";

/**
 * ConsultPanel — the AI-first step of New Task (rendered inline, not a modal).
 * The person describes what they're planning; the AI proposes task-specific
 * milestones with day estimates. "Use this plan" hands the plan to the parent,
 * which reveals the prefilled details form for final touches. "Start blank"
 * skips straight to the manual form (fallback when AI is off / not wanted).
 */
export default function ConsultPanel({ department, workspaceLabel, onApply, onSkip }) {
  const [brief, setBrief] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [plan, setPlan] = useState(null);
  const [refinement, setRefinement] = useState("");
  const historyRef = useRef([]);
  const briefRef = useRef(null);

  useEffect(() => { setTimeout(() => briefRef.current?.focus(), 80); }, []);

  const todayISO = new Date().toISOString().slice(0, 10);
  const totalDays = plan ? plan.milestones.reduce((s, m) => s + m.days, 0) : 0;
  const weeks = totalDays ? Math.round(totalDays / 7) : 0;

  async function generate(isRefine) {
    const text = isRefine ? refinement.trim() : brief.trim();
    if (!text) return;
    setLoading(true); setError("");
    try {
      const { plan: newPlan, contents } = await consultTaskPlan({
        department,
        workspaceLabel,
        brief: brief.trim(),
        startDateISO: "",
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

  return (
    <div className="consult-panel-wrap">
      <div className="section-card consult-panel">
        <div className="consult-head">
          <div className="consult-badge">✦ AI</div>
          <div>
            <h1 className="consult-title">Plan a new task</h1>
            <p className="consult-sub">
              Describe what you're planning — the AI knows how <strong>{workspaceLabel}</strong> work gets done and will
              propose milestones and a timeline tailored to it. You'll set assignees and make final touches next.
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
                  {plan.milestones.length} steps · {totalDays} days{weeks ? ` (~${weeks} wk)` : ""}
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
                <button className="consult-regen" onClick={() => { setPlan(null); historyRef.current = []; }} disabled={loading}>
                  Start over
                </button>
                <button className="btn-primary consult-apply" onClick={() => onApply(plan)} disabled={loading}>
                  Use this plan →
                </button>
              </div>
            </div>
          )}
        </div>

        <button className="consult-skip" onClick={onSkip} disabled={loading}>
          Skip AI · start from a blank task
        </button>
      </div>
    </div>
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
