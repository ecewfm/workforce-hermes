import { useState, useEffect, useRef, useMemo } from "react";
import DatePicker from "./ui/DatePicker";
import MultiSelect from "./ui/MultiSelect";
import EditableText from "./ui/EditableText";
import { useQuery } from "../data/react";
import { api } from "../data/api";
import { planTask } from "../utils/taskPlanner";
import { daysBetweenISO, fitMilestonesToDays } from "../utils/deadlines";

/**
 * ConsultPanel — the AI-first step of New Task (rendered inline, not a modal).
 *
 *  1. The person describes what they're planning and picks the start date and
 *     the deadline (both required before the AI plans: the milestones are the
 *     steps to reach the deadline, and each shows its due date).
 *  2. The AI thinks — its reasoning streams in live as a step list — then the
 *     plan streams in: project type, size, then milestones one by one.
 *  3. The plan is fully editable here (rename, re-time, add, remove, reorder),
 *     with the timeline, assumptions and risks laid out. "Refine" re-plans
 *     from the CURRENT (edited) plan + their feedback.
 *  4. Beside the plan, a setup panel takes the start date and assignees
 *     (both required) and shows the expected deadline; "Review" hands
 *     everything to the review page. "Skip AI" goes straight to the manual
 *     form on the workspace's default template.
 *
 * Start date and assignees live in the owner (TaskEntry) so the review page
 * and the form share them.
 *
 * `seed` ({ brief, nonce }) lets Caddy open the planner with a brief and start
 * planning automatically; onSeedUsed tells the owner to clear it so it doesn't
 * re-fire the next time New Task opens.
 */
export default function ConsultPanel({
  department, workspace, workspaceLabel, template, onApply, onSkip, seed, onSeedUsed,
  startDate = "", onStartDateChange, deadline = "", onDeadlineChange, assignees = [], onAssigneesChange, staffOptions = [],
}) {
  const setDeadline = (v) => onDeadlineChange?.(v);
  const [brief, setBrief] = useState(seed?.brief || "");
  const setStartDate = (v) => onStartDateChange?.(v);
  const [phase, setPhase] = useState("idle"); // "idle" | "thinking" | "ready"
  const [busyLabel, setBusyLabel] = useState("Planning");
  const [steps, setSteps] = useState([]); // live thought steps
  const [draft, setDraft] = useState(null); // partial plan while it streams
  const [plan, setPlan] = useState(null); // the finished, editable plan
  const [reasoning, setReasoning] = useState([]); // thought steps behind `plan`
  const [error, setError] = useState("");
  const [needDates, setNeedDates] = useState(false); // tried to plan without both dates
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
  // Both dates in → clear the "pick the dates first" nudge.
  useEffect(() => {
    if (needDates && startDate && deadline) { setNeedDates(false); setError(""); }
  }, [needDates, startDate, deadline]);
  useEffect(() => () => abortRef.current?.abort(), []);

  // Caddy handed us a brief (and maybe the dates) → fill them in; with both
  // dates it starts planning right away, otherwise it waits for them.
  useEffect(() => {
    if (!seed?.brief) return;
    setBrief(seed.brief);
    const iso = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v || "") ? v : "");
    const s = iso(seed.startDate) || startDate;
    const d = iso(seed.deadline) && (!s || iso(seed.deadline) >= s) ? iso(seed.deadline) : deadline;
    if (s !== startDate) setStartDate(s);
    if (d !== deadline) setDeadline(d);
    run({ text: seed.brief, start: s, end: d });
    onSeedUsed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed?.nonce]);

  async function run({ feedback = "", text, start, end } = {}) {
    const theBrief = (text ?? brief).trim();
    if (!theBrief) return;
    // The AI plans the steps to reach the deadline, so it needs both dates first.
    const s = start ?? startDate;
    const d = end ?? deadline;
    if (!s || !d) {
      setNeedDates(true);
      setError(!s && !d ? "Pick a start date and a deadline first. The AI plans the steps to reach the deadline."
        : !s ? "Pick a start date first. The AI plans the steps from that day." : "Set the deadline first. The AI plans the steps to reach it.");
      return;
    }
    setNeedDates(false);
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
        startDateISO: s,
        deadlineISO: d,
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
    if (!startDate) {
      setError("Pick a start date first — every project needs one.");
      return;
    }
    if (!deadline) {
      setError("Set the deadline first — the milestones are the steps to reach it.");
      return;
    }
    if (!assignees.length) {
      setError("Pick who's working on it first.");
      return;
    }
    onApply({ ...plan, milestones }, startDate, assignees);
  }

  const totalDays = plan ? plan.milestones.reduce((s, m) => s + (m.days || 0), 0) : 0;
  // The person's deadline is fixed; the milestones are the steps to reach it.
  const windowDays = daysBetweenISO(startDate, deadline);
  const deadlineDate = /^\d{4}-\d{2}-\d{2}$/.test(deadline) ? (() => { const [y, m, d] = deadline.split("-").map(Number); return new Date(y, m - 1, d); })() : null;
  const fitState = windowDays == null ? "none" : totalDays > windowDays ? "over" : totalDays < windowDays ? "under" : "exact";
  // Each step's due date (work starting on the start date), so the plan reads
  // as the step-by-step route to the deadline.
  const startAt = /^\d{4}-\d{2}-\d{2}$/.test(startDate) ? (() => { const [y, m, d] = startDate.split("-").map(Number); return new Date(y, m - 1, d); })() : null;
  let runningDays = 0;
  const stepDue = (plan?.milestones || []).map((m) => {
    runningDays += Number(m.days) || 0;
    return startAt ? new Date(startAt.getFullYear(), startAt.getMonth(), startAt.getDate() + runningDays) : null;
  });
  const fmtShortDay = (d) => d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  const busy = phase === "thinking";

  const setPlanField = (field, v) => setPlan((p) => ({ ...p, [field]: v }));
  const setPlanListItem = (field, i, v) => setPlan((p) => {
    const list = [...(p[field] || [])];
    if (v) list[i] = v; else list.splice(i, 1);
    return { ...p, [field]: list };
  });
  const ready = phase === "ready" && !!plan;
  const fmtDay = (d) => d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  return (
    <div className={`consult-panel-wrap ${ready ? "with-setup" : ""}`}>
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
                onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && brief.trim() && !busy) { e.preventDefault(); run(); } }}
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
              <div className={`consult-start-row ${needDates && (!startDate || !deadline) ? "needs" : ""}`}>
                <label htmlFor="consult-start">Start date <b>*</b></label>
                <DatePicker id="consult-start" size="sm" className={`consult-date-picker ${needDates && !startDate ? "missing" : ""}`} value={startDate} onChange={setStartDate} disabled={busy} allowClear placeholder="Pick a date" required />
                <label htmlFor="consult-deadline">Deadline <b>*</b></label>
                <DatePicker id="consult-deadline" size="sm" className={`consult-date-picker ${needDates && !deadline ? "missing" : ""}`} value={deadline} onChange={setDeadline} disabled={busy} allowClear min={startDate || undefined} placeholder="Pick a date" required />
                <span className={`consult-start-hint ${windowDays != null ? "set" : ""}`}>
                  {windowDays == null
                    ? "Both are required before the AI plans. It lays out the steps to finish by the deadline."
                    : windowDays === 0
                      ? "Start and deadline are the same day. The AI will plan a one-day job."
                      : `${windowDays} days from start to deadline. The AI plans the steps to fit them.`}
                </span>
              </div>
              {phase === "idle" && (
                <button className="consult-generate" onClick={() => run()} disabled={!brief.trim() || !startDate || !deadline}>
                  {!brief.trim() ? "Describe the project to start" : !startDate ? "Pick a start date to start" : !deadline ? "Set the deadline to start" : <>✦ Think it through &amp; propose a plan</>}
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

              <EditableText as="h2" className="consult-plan-title" value={plan.title} onChange={(v) => setPlanField("title", v)} placeholder="Double-click to name the project" ariaLabel="Plan title" />
              <EditableText as="p" multiline className="consult-plan-desc" value={plan.description} onChange={(v) => setPlanField("description", v)} placeholder="Double-click to describe it" ariaLabel="Plan description" />
              {plan.successMeasure && (
                <p className="consult-goal"><span>Goal</span><EditableText multiline value={plan.successMeasure} onChange={(v) => setPlanField("successMeasure", v)} ariaLabel="Goal" /></p>
              )}

              <TimelineBar milestones={plan.milestones} total={totalDays} />

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
                      <span className="cms-done">Done when: <EditableText value={m.doneWhen} onChange={(v) => editMilestone(i, "doneWhen", v)} placeholder="double-click to add" ariaLabel={`Milestone ${i + 1} done when`} /></span>
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
                    {stepDue[i] && (
                      <span className={`cms-due ${deadlineDate && stepDue[i] > deadlineDate ? "late" : ""}`} title={deadlineDate && stepDue[i] > deadlineDate ? "Lands after the deadline" : "Due if work starts on the start date"}>
                        Due {fmtShortDay(stepDue[i])}
                      </span>
                    )}
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
                      <ul>{plan.assumptions.map((a, i) => <li key={i}><EditableText multiline value={a} onChange={(v) => setPlanListItem("assumptions", i, v)} ariaLabel="Assumption" /></li>)}</ul>
                      <div className="cn-hint">Wrong? Say so below and refine.</div>
                    </div>
                  )}
                  {plan.risks.length > 0 && (
                    <div className="cn-box cn-box--risk">
                      <div className="cn-title">Watch out for</div>
                      <ul>{plan.risks.map((r, i) => <li key={i}><EditableText multiline value={r} onChange={(v) => setPlanListItem("risks", i, v)} ariaLabel="Watch out for" /></li>)}</ul>
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
              </div>
            </div>
          )}
        </div>

        <button className="consult-skip" onClick={onSkip} disabled={busy}>
          Skip AI · start from the {workspaceLabel} default milestones
        </button>
      </div>

      {/* ── Setup: who, when, and the deadline that gives ── */}
      {ready && (
        <aside className="section-card consult-setup" aria-label="Project setup">
          <div className="consult-setup-cap">Project setup</div>
          <label className="consult-setup-label" htmlFor="consult-start-2">Start date <b>*</b></label>
          <DatePicker id="consult-start-2" value={startDate} onChange={setStartDate} placeholder="Pick a start date" required />
          <label className="consult-setup-label" htmlFor="consult-deadline-2">Deadline <b>*</b></label>
          <DatePicker id="consult-deadline-2" value={deadline} onChange={setDeadline} min={startDate || undefined} placeholder="When must it be done?" required />
          <label className="consult-setup-label">Assignees <b>*</b></label>
          <MultiSelect
            values={assignees}
            onChange={(v) => onAssigneesChange?.(v)}
            options={staffOptions.map((n) => ({ value: n, label: n }))}
            placeholder="Pick who's working on it"
            allLabel="Clear"
            menuWidth={280}
            emptyText="No one in this department yet — add people in Settings → Staff Management."
            ariaLabel="Assignees"
          />
          <div className={`entry-deadline ${deadlineDate ? "" : "empty"}`}>
            <div className="entry-deadline-cap">Deadline</div>
            <div className="entry-deadline-date" key={deadline || "none"}>{deadlineDate ? fmtDay(deadlineDate) : "Set a deadline"}</div>
            <div className="entry-deadline-sub">
              {windowDays != null ? `${windowDays} days from the start · ` : ""}{plan.milestones.length} milestones · {totalDays} days of steps
            </div>
          </div>
          {windowDays != null && windowDays > 0 && (
            <div className={`entry-fit ${fitState}`}>
              {fitState === "over"
                ? <>The steps need <b>{totalDays} days</b> but the deadline gives <b>{windowDays}</b> — {totalDays - windowDays} over.</>
                : fitState === "under"
                  ? <>The steps take <b>{totalDays}</b> of <b>{windowDays} days</b> — {windowDays - totalDays} days of buffer.</>
                  : <>The steps fill the <b>{windowDays} days</b> to the deadline exactly.</>}
              {fitState !== "exact" && (
                <div className="entry-fit-actions">
                  <button type="button" onClick={() => setPlan((p) => ({ ...p, milestones: fitMilestonesToDays(p.milestones, windowDays) }))}>
                    Fit the steps to the deadline
                  </button>
                  <button type="button" onClick={() => run({ feedback: `The deadline is ${deadline} — ${windowDays} days from the start (${startDate}). Re-plan the steps to reach it: the milestones' days must add up to ${windowDays}.` })}>
                    Ask AI to re-plan for it
                  </button>
                </div>
              )}
            </div>
          )}
          {startDate && (
            <div className={`entry-start-note ${startDate <= new Date().toLocaleDateString("en-CA") ? "now" : ""}`}>
              {startDate <= new Date().toLocaleDateString("en-CA")
                ? "Starts today or earlier — it goes straight to Pending once it's created."
                : "Waits in To Do and moves to Pending by itself on its start date."}
            </div>
          )}
          <button className="btn-primary consult-review-btn" onClick={apply} disabled={!startDate || !deadline || !assignees.length}>
            {!startDate ? "Pick a start date" : !deadline ? "Set the deadline" : !assignees.length ? "Pick an assignee" : "Review project →"}
          </button>
          <p className="consult-setup-foot">Next is a review page — you can still change anything before it's created.</p>
        </aside>
      )}
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
      { label: "Client renewal", text: "Prepare the renewal strategy for our largest client: account health review, pricing options, and a negotiation plan before the contract ends in 90 days." },
      { label: "Org change", text: "Restructure the team-lead layer across two sites: design the new structure, align with HR and finance, and communicate it to all staff." },
      { label: "Annual targets", text: "Set next year's operating targets (service level, attrition, margin) with each department head and get them approved." },
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
  if (department === "Executives")
    return ["Faster decision", "Add a board review", "Add stakeholder buy-in", "Fewer, bigger steps", "More detail"];
  return ["Tighter timeline", "More buffer", "Fewer, bigger steps", "More detail"];
}
