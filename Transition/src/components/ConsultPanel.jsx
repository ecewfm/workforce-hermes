import { useState, useEffect, useRef, useMemo } from "react";
import { useQuery } from "../data/react";
import { api } from "../data/api";
import { planTask } from "../utils/taskPlanner";
import { DAY_MS } from "../utils/deadlines";

/**
 * ConsultPanel — the AI-first step of New Task (rendered inline, not a modal).
 *
 *  1. The person describes what they're planning (+ an optional start date).
 *  2. The AI thinks — its reasoning streams in live as a step list — then the
 *     plan streams in: project type, size, then milestones one by one.
 *  3. The plan is fully editable here (rename, re-time, add, remove, reorder),
 *     with the timeline, assumptions and risks laid out. "Refine" re-plans
 *     from the CURRENT (edited) plan + their feedback.
 *  4. "Use this plan" hands everything to the details form. "Skip AI" goes
 *     straight to the manual form on the workspace's default template.
 *
 * `seed` ({ brief, nonce }) lets Caddy open the planner with a brief and start
 * planning automatically; onSeedUsed tells the owner to clear it so it doesn't
 * re-fire the next time New Task opens.
 */
export default function ConsultPanel({ department, workspace, workspaceLabel, template, onApply, onSkip, seed, onSeedUsed }) {
  const [brief, setBrief] = useState(seed?.brief || "");
  const [startDate, setStartDate] = useState("");
  const [phase, setPhase] = useState("idle"); // "idle" | "thinking" | "ready"
  const [busyLabel, setBusyLabel] = useState("Planning");
  const [steps, setSteps] = useState([]); // live thought steps
  const [draft, setDraft] = useState(null); // partial plan while it streams
  const [plan, setPlan] = useState(null); // the finished, editable plan
  const [reasoning, setReasoning] = useState([]); // thought steps behind `plan`
  const [error, setError] = useState("");
  const [refinement, setRefinement] = useState("");
  const abortRef = useRef(null);
  const briefRef = useRef(null);

  // Same subscription the app header already holds — no extra bandwidth.
  const tasks = useQuery(api.tasks.getTasksLight, { workspace });
  const recentProjects = useMemo(
    () =>
      (Array.isArray(tasks) ? tasks : [])
        .filter((t) => (t.milestones || []).length)
        .sort((a, b) => (b.lastUpdated || 0) - (a.lastUpdated || 0))
        .slice(0, 10)
        .map((t) => ({
          title: t.title,
          milestones: t.milestones.length,
          totalDays: t.milestones.reduce((s, m) => s + (m.days || 0), 0),
          status: t.status,
        })),
    [tasks]
  );

  useEffect(() => { setTimeout(() => briefRef.current?.focus(), 80); }, []);
  useEffect(() => () => abortRef.current?.abort(), []);

  // Caddy handed us a brief → fill it in and start planning right away.
  useEffect(() => {
    if (!seed?.brief) return;
    setBrief(seed.brief);
    run({ text: seed.brief });
    onSeedUsed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed?.nonce]);

  async function run({ feedback = "", text } = {}) {
    const theBrief = (text ?? brief).trim();
    if (!theBrief) return;
    const isRefine = !!feedback && !!plan;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setBusyLabel(isRefine ? "Revising the plan" : "Planning");
    setPhase("thinking");
    setError("");
    setSteps([]);
    setDraft(null);
    try {
      const { plan: next, thoughts } = await planTask({
        department,
        workspaceLabel,
        brief: theBrief,
        startDateISO: startDate,
        currentPlan: isRefine ? { ...plan, milestones: plan.milestones.filter((m) => m.name.trim()) } : null,
        feedback: isRefine ? feedback : "",
        template: (template || []).map(({ name, days }) => ({ name, days })),
        recentProjects,
        signal: ctrl.signal,
        onThinking: (s) => setSteps(s),
        onPartial: (p) => setDraft(p),
        onRestart: () => { setSteps([]); setDraft(null); },
      });
      if (ctrl.signal.aborted) return;
      setPlan(next);
      setReasoning(thoughts);
      setRefinement("");
      setPhase("ready");
    } catch (err) {
      if (ctrl.signal.aborted) return;
      setError(err?.message || "Couldn't generate a plan. Try again.");
      setPhase(plan ? "ready" : "idle");
    }
  }

  function cancel() {
    abortRef.current?.abort();
    setPhase(plan ? "ready" : "idle");
  }

  function startOver() {
    abortRef.current?.abort();
    setPlan(null);
    setReasoning([]);
    setDraft(null);
    setSteps([]);
    setError("");
    setPhase("idle");
    setTimeout(() => briefRef.current?.focus(), 50);
  }

  // ── Editing the finished plan ──
  // `edited` marks rows the person changed by hand, so a refine keeps them.
  function editMilestone(i, field, value) {
    setPlan((p) => {
      const ms = [...p.milestones];
      ms[i] = { ...ms[i], edited: true, [field]: field === "days" ? Math.max(0, parseInt(value, 10) || 0) : value };
      return { ...p, milestones: ms };
    });
  }
  function moveMilestone(i, dir) {
    setPlan((p) => {
      const j = i + dir;
      if (j < 0 || j >= p.milestones.length) return p;
      const ms = [...p.milestones];
      [ms[i], ms[j]] = [ms[j], ms[i]];
      return { ...p, milestones: ms };
    });
  }
  function removeMilestone(i) {
    setPlan((p) => ({ ...p, milestones: p.milestones.filter((_, k) => k !== i) }));
  }
  function addMilestone() {
    setPlan((p) => ({ ...p, milestones: [...p.milestones, { name: "", days: 5, doneWhen: "", edited: true }] }));
  }

  function apply() {
    const milestones = plan.milestones
      .filter((m) => m.name.trim())
      .map((m) => ({ ...m, name: m.name.trim(), days: m.days || 1 }));
    if (!milestones.length) {
      setError("Add at least one named milestone first.");
      return;
    }
    onApply({ ...plan, milestones }, startDate);
  }

  const totalDays = plan ? plan.milestones.reduce((s, m) => s + (m.days || 0), 0) : 0;
  const finish = startDate && totalDays ? new Date(new Date(`${startDate}T00:00:00`).getTime() + totalDays * DAY_MS) : null;
  const busy = phase === "thinking";

  return (
    <div className="consult-panel-wrap">
      <div className="section-card consult-panel">
        <div className="consult-head">
          <div className="consult-badge">✦ AI</div>
          <div>
            <h1 className="consult-title">Plan a new task</h1>
            <p className="consult-sub">
              Describe what you're planning. The AI works out what kind of <strong>{workspaceLabel}</strong> project it
              is, thinks it through, and proposes milestones with a realistic timeline. You can edit everything before
              it's created.
            </p>
          </div>
        </div>

        <div className="consult-body">
          {/* ── Brief ── */}
          {phase === "idle" || !plan ? (
            <>
              <label className="consult-label" htmlFor="consult-brief">What are you planning to do?</label>
              <textarea
                id="consult-brief"
                ref={briefRef}
                className="consult-textarea"
                value={brief}
                onChange={(e) => setBrief(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && brief.trim() && !busy) run(); }}
                placeholder={placeholderFor(department)}
                disabled={busy}
              />
              {!busy && !brief.trim() && (
                <div className="consult-examples">
                  <span className="consult-examples-label">Try:</span>
                  {examplesFor(department).map((ex) => (
                    <button key={ex.label} type="button" className="consult-chip" onClick={() => { setBrief(ex.text); briefRef.current?.focus(); }}>
                      {ex.label}
                    </button>
                  ))}
                </div>
              )}
              <div className="consult-start-row">
                <label htmlFor="consult-start">Start date <span>(optional)</span></label>
                <input id="consult-start" type="date" className="consult-date" value={startDate} onChange={(e) => setStartDate(e.target.value)} disabled={busy} />
              </div>
              {phase === "idle" && (
                <button className="consult-generate" onClick={() => run()} disabled={!brief.trim()}>
                  ✦ Think it through &amp; propose a plan
                </button>
              )}
            </>
          ) : (
            <div className="consult-brief-recap">
              <span className="consult-brief-recap-label">Your brief</span>
              <p>{brief}</p>
            </div>
          )}

          {error && <div className="consult-error" role="alert">{error}</div>}

          {/* ── Live thinking + the plan streaming in ── */}
          {busy && (
            <>
              <ThinkingCard label={busyLabel} steps={steps} writing={!!draft?.milestones?.length} onCancel={cancel} />
              {draft && <DraftPreview draft={draft} />}
            </>
          )}

          {/* ── Finished, editable plan ── */}
          {phase === "ready" && plan && (
            <div className="consult-result">
              <div className="consult-summary">
                {plan.projectType && <span className="cs-chip cs-chip--type">{plan.projectType}</span>}
                {plan.size && <span className={`cs-chip cs-chip--size cs-size-${plan.size.toLowerCase()}`}>{plan.size}</span>}
                <span className="cs-chip">{plan.milestones.length} steps · {totalDays} days{totalDays >= 7 ? ` (~${Math.round(totalDays / 7)} wk)` : ""}</span>
              </div>

              {plan.title && <h2 className="consult-plan-title">{plan.title}</h2>}
              {plan.description && <p className="consult-plan-desc">{plan.description}</p>}
              {plan.successMeasure && (
                <p className="consult-goal"><span>Goal</span>{plan.successMeasure}</p>
              )}

              <TimelineBar milestones={plan.milestones} total={totalDays} />
              <div className="consult-dates">
                <label htmlFor="consult-start-2">Start</label>
                <input id="consult-start-2" type="date" className="consult-date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                <span className="consult-dates-arrow">→</span>
                <span className="consult-finish">
                  {finish
                    ? <>Finish ≈ <strong>{finish.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</strong></>
                    : "Pick a start date to see the finish date"}
                </span>
              </div>

              <div className="consult-plan-head">
                <span>Milestones</span>
                <span className="consult-plan-meta">Edit anything — names, days, order</span>
              </div>
              <ol className="cms-list">
                {plan.milestones.map((m, i) => (
                  <li key={i} className="cms-row">
                    <span className="cms-num">{i + 1}</span>
                    <div className="cms-main">
                      <input
                        className="cms-name"
                        value={m.name}
                        placeholder="Milestone name"
                        aria-label={`Milestone ${i + 1} name`}
                        onChange={(e) => editMilestone(i, "name", e.target.value)}
                      />
                      {m.doneWhen && <span className="cms-done">Done when: {m.doneWhen}</span>}
                    </div>
                    <label className="cms-days">
                      <input
                        type="number"
                        min="1"
                        value={m.days}
                        aria-label={`Milestone ${i + 1} days`}
                        onChange={(e) => editMilestone(i, "days", e.target.value)}
                      />
                      <span>d</span>
                    </label>
                    <div className="cms-tools">
                      <button type="button" title="Move up" onClick={() => moveMilestone(i, -1)} disabled={i === 0}>↑</button>
                      <button type="button" title="Move down" onClick={() => moveMilestone(i, 1)} disabled={i === plan.milestones.length - 1}>↓</button>
                      <button type="button" title="Remove" className="cms-del" onClick={() => removeMilestone(i)}>×</button>
                    </div>
                  </li>
                ))}
              </ol>
              <button type="button" className="consult-add-ms" onClick={addMilestone}>+ Add a milestone</button>

              {(plan.assumptions.length > 0 || plan.risks.length > 0) && (
                <div className="consult-notes">
                  {plan.assumptions.length > 0 && (
                    <div className="cn-box">
                      <div className="cn-title">Assumed</div>
                      <ul>{plan.assumptions.map((a, i) => <li key={i}>{a}</li>)}</ul>
                      <div className="cn-hint">Wrong? Say so below and refine.</div>
                    </div>
                  )}
                  {plan.risks.length > 0 && (
                    <div className="cn-box cn-box--risk">
                      <div className="cn-title">Watch out for</div>
                      <ul>{plan.risks.map((r, i) => <li key={i}>{r}</li>)}</ul>
                    </div>
                  )}
                </div>
              )}

              {(plan.rationale || reasoning.length > 0) && (
                <details className="consult-why">
                  <summary>Why this plan · how the AI thought it through</summary>
                  {plan.rationale && <p className="consult-rationale">{plan.rationale}</p>}
                  {reasoning.length > 0 && (
                    <ol className="consult-reasoning">
                      {reasoning.map((s, i) => (
                        <li key={i}><strong>{s.title}</strong>{s.body && <p>{s.body}</p>}</li>
                      ))}
                    </ol>
                  )}
                </details>
              )}

              <div className="consult-refine-chips">
                {refineChipsFor(department).map((c) => (
                  <button key={c} type="button" className="consult-chip" onClick={() => run({ feedback: c })}>{c}</button>
                ))}
              </div>
              <div className="consult-refine">
                <input
                  className="consult-refine-input"
                  value={refinement}
                  onChange={(e) => setRefinement(e.target.value)}
                  placeholder="Or say what to change… e.g. “it's only one site”, “client sign-off takes 2 weeks”"
                  onKeyDown={(e) => { if (e.key === "Enter" && refinement.trim()) run({ feedback: refinement.trim() }); }}
                />
                <button className="consult-refine-btn" onClick={() => run({ feedback: refinement.trim() })} disabled={!refinement.trim()}>
                  Refine
                </button>
              </div>

              <div className="consult-actions">
                <button className="consult-regen" onClick={startOver}>Start over</button>
                <button className="btn-primary consult-apply" onClick={apply}>Use this plan →</button>
              </div>
            </div>
          )}
        </div>

        <button className="consult-skip" onClick={onSkip} disabled={busy}>
          Skip AI · start from the {workspaceLabel} default milestones
        </button>
      </div>
    </div>
  );
}

// Live "the AI is thinking" card: each thought-summary heading becomes a step.
// (The model doesn't always send summaries — the timer keeps it honest then.)
function ThinkingCard({ label, steps, writing, onCancel }) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const last = steps[steps.length - 1];
  return (
    <div className="consult-thinking" aria-live="polite">
      <div className="ct-head">
        <span className="ct-orb" aria-hidden="true" />
        <span className="ct-label">{label}…</span>
        <span className="ct-timer">{seconds}s</span>
        <button type="button" className="ct-cancel" onClick={onCancel}>Cancel</button>
      </div>
      <ol className="ct-steps">
        <li className={steps.length || writing ? "done" : "active"}>{steps.length || writing ? "Read your brief" : "Reading your brief & thinking it through"}</li>
        {steps.map((s, i) => (
          <li key={`${i}-${s.title}`} className={i === steps.length - 1 && !writing ? "active" : "done"}>{s.title}</li>
        ))}
        {writing && <li className="active">Writing the milestones</li>}
      </ol>
      {last?.body && !writing && <p className="ct-live">{last.body}</p>}
    </div>
  );
}

// The plan as it streams in. The last milestone may be half-written, so it's
// held back until the next one starts (or the stream ends).
function DraftPreview({ draft }) {
  const shown = draft.milestones.slice(0, -1);
  if (!draft.projectType && !draft.title && !shown.length) return null;
  return (
    <div className="consult-draft">
      <div className="consult-summary">
        {draft.projectType && <span className="cs-chip cs-chip--type">{draft.projectType}</span>}
        {draft.size && <span className={`cs-chip cs-chip--size cs-size-${draft.size.toLowerCase()}`}>{draft.size}</span>}
      </div>
      {draft.title && <h2 className="consult-plan-title">{draft.title}</h2>}
      {shown.length > 0 && (
        <ol className="cms-list cms-list--draft">
          {shown.map((m, i) => (
            <li key={i} className="cms-row">
              <span className="cms-num">{i + 1}</span>
              <div className="cms-main">
                <span className="cms-name-static">{m.name}</span>
                {m.doneWhen && <span className="cms-done">Done when: {m.doneWhen}</span>}
              </div>
              <span className="cms-days-static">{m.days}d</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

// Proportional bar of the milestones — shows where the time goes at a glance.
function TimelineBar({ milestones, total }) {
  if (!total) return null;
  return (
    <div className="consult-timeline" role="img" aria-label={`Timeline: ${total} days across ${milestones.length} milestones`}>
      {milestones.map((m, i) => (
        <div
          key={i}
          className="ctl-seg"
          style={{ flexGrow: Math.max(1, m.days || 0), "--seg-i": i }}
          title={`${i + 1}. ${m.name || "Unnamed"} — ${m.days || 0} days`}
        >
          <span>{i + 1}</span>
        </div>
      ))}
    </div>
  );
}

function placeholderFor(department) {
  if (department === "Operations")
    return "e.g. Roll out a new adherence-monitoring process for the RTA team across all 3 sites, with a pilot before full rollout.";
  if (department === "Executives")
    return "e.g. Evaluate and propose consolidating our three reporting tools into one, with a business case for the board.";
  if (department === "Workforce")
    return "e.g. Build an internal dashboard that pulls Zoho ticket data and shows SLA breaches with email alerts.";
  return "Describe the task: what needs to happen, any constraints, and roughly how big it is.";
}

// One-click starter briefs, so people see what a good description looks like.
function examplesFor(department) {
  if (department === "Operations")
    return [
      { label: "Campaign launch", text: "Launch a new inbound customer-support campaign for a US retail client: hire and train 40 agents, set up dialer and CRM access, and go live in about 2 months." },
      { label: "SOP update", text: "Update the billing team's escalation SOP so tier-2 handoffs happen within 10 minutes, and train all team leads on it." },
      { label: "KPI improvement", text: "Bring average handle time on the tech-support line down from 9 to 7 minutes without hurting CSAT." },
      { label: "Tool rollout", text: "Replace the QA team's scoring spreadsheet with a new QA tool for all analysts across our 3 sites." },
      { label: "Schedule change", text: "Move the night-shift team to a 4x10 schedule, including HR review and advance notice to employees." },
    ];
  if (department === "Executives")
    return [
      { label: "Business case", text: "Build a business case for opening a fourth site, with cost modeling and a board recommendation." },
      { label: "Tool consolidation", text: "Evaluate consolidating our three reporting tools into one and present a recommendation to leadership." },
    ];
  if (department === "Workforce")
    return [
      { label: "Dashboard", text: "Build an internal dashboard that pulls Zoho ticket data and shows SLA breaches with email alerts." },
      { label: "Apps Script tool", text: "Automate the daily attendance report with Google Apps Script so team leads get it by 8 AM." },
    ];
  return [];
}

function refineChipsFor(department) {
  if (department === "Operations")
    return ["Tighter timeline", "Add a pilot first", "Roll out site by site", "Fewer, bigger steps", "More detail"];
  return ["Tighter timeline", "More buffer", "Fewer, bigger steps", "More detail"];
}
