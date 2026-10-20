import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "../data/react";
import { api } from "../data/api";
import { fallbackMilestonesFor, withTemplateHints } from "../utils/defaults";
import { useWorkspace } from "../utils/workspaceContext";
import { WORKSPACE_META, isInDepartment } from "../utils/departments";
import ConsultPanel from "./ConsultPanel";
import Select from "./ui/Select";
import DatePicker from "./ui/DatePicker";
import MultiSelect from "./ui/MultiSelect";
import { useOutsideClose } from "./ui/Popover";
import { isCaddyEnabled } from "../utils/aiConfig";
import { termsFor } from "../utils/workspaceTerms";
import { useAccountUi } from "../utils/accountScope";

export default function TaskEntry({ staff, userRole, actualRole, userName, onCreated, showModal, plannerSeed, onPlannerSeedUsed }) {
  const workspace = useWorkspace();
  const terms = termsFor(workspace);
  // Operations: which client account the project is for (Admin+ can add one).
  const accounts = useQuery(api.accounts.getAccounts, terms.accounts ? { workspace } : "skip");
  const addAccount = useMutation(api.accounts.addAccount);
  const boardAccount = () => {
    try {
      const v = localStorage.getItem(`wf_account_filter_${workspace}`) || "";
      return v === "all" || v === "none" ? "" : v;
    } catch { return ""; }
  };
  const [accountId, setAccountId] = useState(boardAccount);
  // Account picker: Admin+ choose any account; others only see it when they
  // have several accounts (one account → it's used automatically).
  const accUi = useAccountUi(workspace, actualRole, userRole);
  useEffect(() => {
    if (!accUi.on || accUi.full) return;
    const mine = accUi.accountIds;
    if (mine.length === 1 && accountId !== mine[0]) setAccountId(mine[0]);
    else if (mine.length !== 1 && accountId && !mine.includes(accountId)) setAccountId("");
  }, [accUi.on, accUi.full, accUi.accountIds.join(), accountId]);
  const [newAccountName, setNewAccountName] = useState(null); // null = closed
  useEffect(() => {
    if (accountId && Array.isArray(accounts) && !accounts.some((a) => a._id === accountId)) setAccountId("");
  }, [accounts, accountId]);
  // Operations/Executives: documents the project relies on ({ name, url }).
  const [documents, setDocuments] = useState([]);
  // From the AI plan: risks ("watch out for") and assumptions — saved on the task.
  const [planNotes, setPlanNotes] = useState({ watchOuts: [], assumptions: [] });
  // Only staff who belong to THIS workspace's department can be assigned a task
  // created here (e.g. the Operations workspace lists only Operations members).
  const workspaceDept = WORKSPACE_META[workspace]?.department;
  const assignableStaff = (staff || []).filter(
    (s) => !workspaceDept || isInDepartment(s.departments, workspaceDept)
  );
  // Per-workspace milestone template (Admin+ editable in Settings → Workspace Defaults)
  const appConfig = useQuery(api.appConfig.getAppConfig, { workspace });
  // Optimistic update must target the SAME query the board subscribes to
  // (getTasksLight) with the SAME key ({ workspace }), and match its projected
  // shape (counts, not raw notes/features) — otherwise instant-create no-ops.
  const addTask = useMutation(api.tasks.addTask).withOptimisticUpdate((localStore, args) => {
    const prevTasks = localStore.getQuery(api.tasks.getTasksLight, { workspace });
    if (prevTasks !== undefined) {
      const newTask = {
        _id: "optimistic-task-" + Date.now(),
        ...args,
        // Starting today (or earlier) → it goes straight to Pending (the server decides for real).
        status: args.startDate && args.startDate <= new Date().toLocaleDateString("en-CA") ? "pending" : "todo",
        completedMilestones: 0,
        notesCount: 0,
        featuresCount: 0,
        lastNoteTimestamp: 0,
        lastFeatureTimestamp: 0,
        lastUpdated: Date.now(),
      };
      localStore.setQuery(api.tasks.getTasksLight, { workspace }, [...(Array.isArray(prevTasks) ? prevTasks : []), newTask]);
    }
  });

  const [milestones, setMilestones] = useState(() => fallbackMilestonesFor(workspace));
  const [selectedAssignees, setSelectedAssignees] = useState(new Set());
  const [showOptions, setShowOptions] = useState(false);
  // The assignee list closes when you click anywhere else (it used to stay open over the fields below).
  const multiRef = useRef(null);
  useOutsideClose(showOptions, [multiRef], () => setShowOptions(false));
  const [submitting, setSubmitting] = useState(false);
  // Two-step wizard: AI plans first ("consult"), then the prefilled details
  // form ("form"). If Caddy is off, jump straight to the manual form.
  // "consult" (AI plan) → "review" → create.  Skip AI → "form" (with a review column).
  const [step, setStep] = useState(() => (isCaddyEnabled() ? "consult" : "form"));
  // The planner stays mounted behind the review/form so "Back to the plan"
  // keeps it; bumping this key gives a fresh planner after a reset.
  const [consultKey, setConsultKey] = useState(0);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftDesc, setDraftDesc] = useState("");
  const [draftStart, setDraftStart] = useState("");
  // The review panel mirrors the title/description as they're typed.
  const [titlePreview, setTitlePreview] = useState("");
  const [descPreview, setDescPreview] = useState("");
  useEffect(() => { setTitlePreview(draftTitle); }, [draftTitle]);
  useEffect(() => { setDescPreview(draftDesc); }, [draftDesc]);
  const formRef = useRef(null);
  const milestonesTouched = useRef(false);

  // The workspace's saved template, else its built-in default (Operations has
  // its own general-purpose one). `hint` explains each generic step.
  const templateMilestones = withTemplateHints(
    appConfig?.defaultMilestones?.length ? appConfig.defaultMilestones : fallbackMilestonesFor(workspace),
    workspace
  );

  // Swap in the workspace template once it loads — but never clobber rows the
  // user has already started editing.
  useEffect(() => {
    if (appConfig !== undefined && !milestonesTouched.current) {
      setMilestones(templateMilestones.map((m) => ({ ...m })));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appConfig, workspace]);

  // Caddy asked to plan a task → jump (back) to the AI step; ConsultPanel
  // picks the brief up from the seed and starts planning.
  useEffect(() => {
    if (plannerSeed?.brief) setStep("consult");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plannerSeed?.nonce]);

  // Keep the assignee selection consistent with the active workspace: drop any
  // selected names that aren't assignable here (e.g. after switching workspace),
  // and auto-check a programmer's own name when they're a member.
  useEffect(() => {
    setSelectedAssignees((prev) => {
      const validNames = new Set(assignableStaff.map((s) => s.name));
      const pruned = new Set([...prev].filter((n) => validNames.has(n)));
      if (userRole === "Programmer") {
        const me = assignableStaff.find((s) => s.name.toLowerCase() === userName.toLowerCase());
        if (me) pruned.add(me.name);
      }
      return pruned;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staff, userRole, userName, workspace]);

  function toggleAssignee(name) {
    setSelectedAssignees((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function updateMilestone(index, field, value) {
    milestonesTouched.current = true;
    setMilestones((prev) => {
      const next = [...prev];
      // Renaming a row drops its hint (it may no longer describe the step).
      const { hint, ...row } = next[index];
      next[index] = { ...(field === "name" ? row : next[index]), [field]: field === "days" ? parseInt(value) || 0 : value };
      return next;
    });
  }

  function addMilestoneRow() {
    milestonesTouched.current = true;
    setMilestones((prev) => [...prev, { name: "", days: 0 }]);
  }

  function removeMilestoneRow(index) {
    milestonesTouched.current = true;
    setMilestones((prev) => prev.filter((_, i) => i !== index));
  }

  function resetForm() {
    formRef.current?.reset();
    setConsultKey((k) => k + 1);
    setTitlePreview("");
    setDescPreview("");
    milestonesTouched.current = false;
    setMilestones(templateMilestones.map((m) => ({ ...m })));
    setSelectedAssignees(new Set());
    setDraftTitle("");
    setDraftDesc("");
    setDraftStart("");
    setDocuments([]);
    setPlanNotes({ watchOuts: [], assumptions: [] });
    setAccountId(boardAccount());
    setStep(isCaddyEnabled() ? "consult" : "form");
  }

  // AI plan accepted → prefill milestones + title/description drafts (the form
  // inputs read these as defaultValue when the form step mounts) and advance
  // to the details step for final touches.
  function applyPlan(plan, startDate, assignees) {
    milestonesTouched.current = true;
    // doneWhen becomes the milestone's meaning (saved, shown in the task modal).
    setMilestones(plan.milestones.map((m) => ({ name: m.name, days: m.days, ...(m.doneWhen ? { hint: `Done when: ${m.doneWhen}` } : {}) })));
    setPlanNotes({ watchOuts: plan.risks || [], assumptions: plan.assumptions || [] });
    setDraftTitle(plan.title || "");
    setDraftDesc([plan.description, plan.successMeasure && `Goal: ${plan.successMeasure}`].filter(Boolean).join("\n\n"));
    setDraftStart(startDate || "");
    if (Array.isArray(assignees)) setSelectedAssignees(new Set(assignees));
    setStep("review");
  }

  // Review → the full form (the form's inputs start from the latest title/description).
  function openForm() {
    setDraftTitle(titlePreview);
    setDraftDesc(descPreview);
    setStep("form");
  }

  // Skip AI → blank task on the workspace template.
  function startBlank() {
    milestonesTouched.current = false;
    setMilestones(templateMilestones.map((m) => ({ ...m })));
    setDraftTitle("");
    setDraftDesc("");
    setDraftStart("");
    setPlanNotes({ watchOuts: [], assumptions: [] });
    setStep("form");
  }

  async function createAccount() {
    const name = (newAccountName || "").trim();
    if (!name) { setNewAccountName(null); return; }
    try {
      const id = await addAccount({ workspace, name });
      setAccountId(id ? String(id) : "");
      setNewAccountName(null);
    } catch (err) {
      showModal({ title: "Couldn't create the account", message: err?.message || "Please try again.", type: "alert" });
    }
  }

  function handleSubmit(e) {
    e.preventDefault();
    createProject();
  }

  async function createProject() {
    // Title, at least one assignee and a start date are required.
    const missing = [
      !titlePreview.trim() && "a title",
      selectedAssignees.size === 0 && "an assignee",
      !/^\d{4}-\d{2}-\d{2}$/.test(draftStart) && "a start date",
    ].filter(Boolean);
    if (missing.length) {
      showModal({ title: "Almost there", message: `Add ${missing.join(", ")} before creating the project.`, type: "alert" });
      return;
    }
    setSubmitting(true);

    const milestonesData = milestones.map((m) => ({
      name: m.name,
      days: m.days,
      completed: false,
      ...(m.hint ? { hint: m.hint } : {}), // what the step means — kept on the task
    }));
    const docs = documents
      .map((d) => ({ name: (d.name || "").trim(), url: (d.url || "").trim() }))
      .filter((d) => d.url)
      .map((d) => ({ name: d.name || d.url, url: /^https?:\/\//i.test(d.url) ? d.url : `https://${d.url}` }));

    // We don't await here to make it feel INSTANT because we have an optimistic update
    addTask({
      workspace,
      title: titlePreview.trim(),
      assignee: Array.from(selectedAssignees).join(", "),
      startDate: draftStart,
      description: descPreview,
      milestones: milestonesData,
      ...(terms.accounts && accountId ? { accountId } : {}),
      ...(docs.length ? { documents: docs } : {}),
      ...(planNotes.watchOuts.length ? { watchOuts: planNotes.watchOuts } : {}),
      ...(planNotes.assumptions.length ? { assumptions: planNotes.assumptions } : {}),
    })
      .then(() => {
        // Success handled by showing modal early
      })
      .catch((err) => {
        console.error("Task submission error:", err);
        showModal({
          title: "Couldn't create the project",
          message: err?.message || "Something went wrong creating the project. Please try again.",
          type: "error",
        });
      })
      .finally(() => {
        setSubmitting(false);
      });

    // Show success modal INSTANTLY
    const startsNow = draftStart <= new Date().toLocaleDateString("en-CA");
    showModal({
      title: "Project Created",
      message: startsNow
        ? "It's on the board in Pending — its start date has arrived, so its clock is running."
        : `It's on the board in To Do and moves to Pending by itself on ${new Date(`${draftStart}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}.`,
      type: "success",
      onConfirm: () => {
        resetForm();
        onCreated();
      },
    });
  }

  const totalDays = milestones.reduce((sum, m) => sum + (Number(m.days) || 0), 0);
  const months = (totalDays / 30).toFixed(1);
  // Expected deadline = start date + every milestone's days (if work starts that day).
  const startAt = /^\d{4}-\d{2}-\d{2}$/.test(draftStart) ? new Date(`${draftStart}T00:00:00`) : null;
  const plusDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  const expectedDeadline = startAt ? plusDays(startAt, totalDays) : null;
  const fmtLong = (d) => d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  const fmtShort = (d) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  let runningDays = 0;
  const milestoneDue = milestones.map((m) => {
    runningDays += Number(m.days) || 0;
    return startAt ? plusDays(startAt, runningDays) : null;
  });
  const accountName = (accounts || []).find((a) => a._id === accountId)?.name || "";
  const startsNow = !!startAt && draftStart <= new Date().toLocaleDateString("en-CA");
  const docCount = documents.filter((d) => (d.url || "").trim()).length;
  const stillNeeded = [
    !titlePreview.trim() && "a title",
    selectedAssignees.size === 0 && "an assignee",
    !startAt && "a start date",
  ].filter(Boolean);

  const assigneeOptions = assignableStaff.map((st) => ({ value: st.name, label: st.name }));
  const milestoneList = (
    <ol className="guide-list entry-review-ms">
      {milestones.map((m, idx) => (
        <li key={idx} className="guide-item">
          <span className="entry-ms-num">{idx + 1}</span>
          <div className="guide-label">
            {m.name || "Unnamed Milestone"}
            {m.hint && <div className="guide-hint">{m.hint}</div>}
          </div>
          <div className="entry-ms-when">
            <span className="guide-days">{m.days}d</span>
            {milestoneDue[idx] && <span className="entry-ms-due">{fmtShort(milestoneDue[idx])}</span>}
          </div>
        </li>
      ))}
    </ol>
  );
  const planNotesBlock = (planNotes.watchOuts.length > 0 || planNotes.assumptions.length > 0) && (
    <div className="entry-plan-notes">
      {planNotes.watchOuts.length > 0 && (
        <div className="entry-plan-block watch">
          <div className="entry-plan-title">Watch out for</div>
          <ul>{planNotes.watchOuts.map((w, i) => <li key={i}>{w}</li>)}</ul>
        </div>
      )}
      {planNotes.assumptions.length > 0 && (
        <div className="entry-plan-block assume">
          <div className="entry-plan-title">Assumptions</div>
          <ul>{planNotes.assumptions.map((x, i) => <li key={i}>{x}</li>)}</ul>
        </div>
      )}
      <div className="entry-plan-foot">Saved with the project — you'll find them in its task view.</div>
    </div>
  );
  const deadlineCard = (
    <>
      <div className={`entry-deadline ${expectedDeadline ? "" : "empty"}`}>
        <div className="entry-deadline-cap">Expected deadline</div>
        <div className="entry-deadline-date" key={expectedDeadline ? expectedDeadline.getTime() : "none"}>{expectedDeadline ? fmtLong(expectedDeadline) : "Pick a start date"}</div>
        <div className="entry-deadline-sub">
          {startAt ? <>Starts {fmtLong(startAt)} · </> : null}{totalDays} days (~{months} months)
        </div>
      </div>
      {startAt && (
        <div className={`entry-start-note ${startsNow ? "now" : ""}`}>
          {startsNow
            ? "Starts today or earlier — it goes straight to Pending and its clock starts."
            : `Waits in To Do, then moves to Pending by itself on ${fmtLong(startAt)}.`}
        </div>
      )}
    </>
  );
  const createFoot = (
    <div className="entry-review-foot">
      {accUi.locked ? (
        <p className="account-locked-inline">You're not on a client account yet, so you can't start a {terms.label} project. Ask an Admin+ or Manager to add you to one.</p>
      ) : stillNeeded.length > 0 ? (
        <p className="entry-still-needed">Still needed: {stillNeeded.join(", ")}.</p>
      ) : (
        <p className="entry-ready">Looks good — ready to create.</p>
      )}
      <button type="button" className="btn-primary entry-create" onClick={createProject} disabled={submitting || accUi.locked || stillNeeded.length > 0}>
        {submitting ? "CREATING..." : "Create Task"}
      </button>
    </div>
  );

  return (
    <div id="entry-view" className="view-section">
      <div className="container">
        {isCaddyEnabled() && (
          <div hidden={step !== "consult"}>
            <ConsultPanel
              key={consultKey}
              department={workspaceDept}
              workspace={workspace}
              workspaceLabel={WORKSPACE_META[workspace]?.label || "this workspace"}
              template={templateMilestones}
              onApply={applyPlan}
              onSkip={startBlank}
              seed={plannerSeed}
              onSeedUsed={onPlannerSeedUsed}
              startDate={draftStart}
              onStartDateChange={setDraftStart}
              assignees={Array.from(selectedAssignees)}
              onAssigneesChange={(names) => setSelectedAssignees(new Set(names))}
              staffOptions={assignableStaff.map((st) => st.name)}
            />
          </div>
        )}

        {/* ── Review page (after the AI plan) ── */}
        {step === "review" && (
          <div className="entry-review-page">
            <div className="section-card entry-review-main">
              <div className="entry-review-top">
                <span className="entry-review-eyebrow">Review</span>
                <div className="entry-review-nav">
                  {isCaddyEnabled() && <button type="button" className="btn-back-consult" onClick={() => setStep("consult")}>← Back to the plan</button>}
                  <button type="button" className="entry-edit-link" onClick={openForm}>Edit milestones &amp; all details</button>
                </div>
              </div>
              <input
                className="entry-review-title-input"
                value={titlePreview}
                onChange={(e) => setTitlePreview(e.target.value)}
                placeholder="Project title"
                aria-label="Project title"
              />
              <textarea
                className="entry-review-desc-input"
                value={descPreview}
                onChange={(e) => setDescPreview(e.target.value)}
                placeholder="What is this project about?"
                aria-label="Description"
              />
              <div className="entry-review-fields">
                <div className="entry-review-field">
                  <label htmlFor="review-start">Start date <b>*</b></label>
                  <DatePicker id="review-start" value={draftStart} onChange={setDraftStart} placeholder="Pick a start date" required />
                </div>
                <div className="entry-review-field">
                  <label>Assignees <b>*</b></label>
                  <MultiSelect
                    values={Array.from(selectedAssignees)}
                    onChange={(names) => setSelectedAssignees(new Set(names))}
                    options={assigneeOptions}
                    placeholder="Pick who's working on it"
                    allLabel="Clear"
                    menuWidth={280}
                    ariaLabel="Assignees"
                  />
                </div>
                {accUi.show && (
                  <div className="entry-review-field">
                    <label>Account</label>
                    <Select
                      value={accountId}
                      onChange={(v) => setAccountId(v)}
                      ariaLabel="Account"
                      placeholder="Pick an account"
                      options={[
                        ...(accUi.full ? [{ value: "", label: "No account" }] : []),
                        ...accUi.limit(accounts).map((a) => ({ value: a._id, label: a.name })),
                      ]}
                    />
                  </div>
                )}
                {!terms.tech && (
                  <div className="entry-review-field">
                    <label>Documents</label>
                    <button type="button" className="entry-docs-link" onClick={openForm}>{docCount ? `${docCount} attached — edit` : "+ Add documents"}</button>
                  </div>
                )}
              </div>
              <div className="entry-review-cap">Milestones · {milestones.length}</div>
              {milestoneList}
              {planNotesBlock}
            </div>
            <aside className="section-card entry-review entry-review-side">
              {deadlineCard}
              <dl className="entry-review-facts">
                <div>
                  <dt>{selectedAssignees.size === 1 ? "Assignee" : "Assignees"}</dt>
                  <dd>{selectedAssignees.size ? Array.from(selectedAssignees).join(", ") : <em>None yet</em>}</dd>
                </div>
                {accUi.show && <div><dt>Account</dt><dd>{accountName || <em>No account</em>}</dd></div>}
                <div><dt>Milestones</dt><dd>{milestones.length} · {totalDays} days</dd></div>
              </dl>
              {createFoot}
            </aside>
          </div>
        )}

        {step === "form" && (
        <div className="entry-grid">
          {/* Left: Form */}
          <div className="section-card">
            <div style={{ textAlign: "center", marginBottom: 20, position: "relative" }}>
              {isCaddyEnabled() && (
                <button type="button" className="btn-back-consult" onClick={() => setStep("consult")}>
                  ← Plan with AI
                </button>
              )}
              <h1 style={{ fontWeight: 900, margin: 0, fontSize: "2rem", color: "var(--color-text-primary)" }}>Final touches</h1>
              <p style={{ color: "var(--color-text-secondary)", fontSize: "0.9rem", marginTop: 5 }}>Set assignees and a start date, tweak anything, then check the review and create it</p>
            </div>

            <form ref={formRef} id="task-entry-form" onSubmit={handleSubmit}>
              <div style={{ marginBottom: 30 }}>
                <h3 style={{ fontWeight: 800, textTransform: "uppercase", fontSize: "0.85rem", color: "var(--color-text-secondary)", borderBottom: "1px solid var(--color-bg-primary)", paddingBottom: 10, marginBottom: 20 }}>
                  Task Information
                </h3>
                <div className="form-group">
                  <label className="form-label">Task Title *</label>
                  <input type="text" id="task-title" className="form-input" placeholder="Project Name" defaultValue={draftTitle} required onInput={(e) => setTitlePreview(e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Assignees *</label>
                  <div className="custom-multiselect" ref={multiRef}>
                    <div className="multiselect-trigger" onClick={() => setShowOptions(!showOptions)} style={{ color: selectedAssignees.size > 0 ? "#1e293b" : "#64748b" }}>
                      {selectedAssignees.size > 0 ? Array.from(selectedAssignees).join(", ") : "Select Assignees..."}
                    </div>
                    <div className={`multiselect-options ${showOptions ? "show" : ""}`}>
                      {assignableStaff.length > 0 ? (
                        assignableStaff.map((s) => (
                          <div key={s.email} className="multiselect-option" onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              id={`staff-${s.email}`}
                              checked={selectedAssignees.has(s.name)}
                              onChange={() => toggleAssignee(s.name)}
                            />
                            <label htmlFor={`staff-${s.email}`}>{s.name}</label>
                          </div>
                        ))
                      ) : (
                        <div className="multiselect-option" style={{ color: "#94a3b8", fontStyle: "italic", cursor: "default" }}>
                          No members in the {workspaceDept || "this"} department yet. Assign one in Settings → Staff Management → Department Membership.
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                {accUi.show && (
                  <div className="form-group">
                    <label className="form-label">Account</label>
                    {newAccountName === null ? (
                      <Select
                        value={accountId}
                        onChange={(v) => (v === "__new" ? setNewAccountName("") : setAccountId(v))}
                        ariaLabel="Account"
                        placeholder="Pick an account"
                        options={[
                          ...(accUi.full ? [{ value: "", label: "No account" }] : []),
                          ...accUi.limit(accounts).map((a) => ({ value: a._id, label: a.name, hint: a.projects ? `${a.projects} project${a.projects === 1 ? "" : "s"}` : undefined })),
                          ...(accUi.full ? [{ value: "__new", label: "+ New account…", action: true }] : []),
                        ]}
                      />
                    ) : (
                      <div className="entry-new-account">
                        <input
                          autoFocus
                          className="form-input"
                          value={newAccountName}
                          placeholder="New account name"
                          maxLength={80}
                          onChange={(e) => setNewAccountName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") { e.preventDefault(); createAccount(); }
                            if (e.key === "Escape") setNewAccountName(null);
                          }}
                        />
                        <button type="button" className="btn-primary" onClick={createAccount}>Add</button>
                        <button type="button" className="btn-secondary" onClick={() => setNewAccountName(null)}>Cancel</button>
                      </div>
                    )}
                  </div>
                )}
                <div className="form-group">
                  <label className="form-label">Start Date *</label>
                  <DatePicker id="task-date" value={draftStart} onChange={setDraftStart} placeholder="Pick a start date" required />
                  <div className={`entry-start-deadline ${expectedDeadline ? "" : "empty"}`}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
                    {expectedDeadline
                      ? <>Expected deadline <b>{fmtLong(expectedDeadline)}</b> · {totalDays} days</>
                      : <>Pick a start date to see the expected deadline ({totalDays} days of work)</>}
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label">Description</label>
                  <textarea id="task-desc" className="form-input" style={{ height: 80 }} placeholder="Details..." defaultValue={draftDesc} onInput={(e) => setDescPreview(e.target.value)}></textarea>
                </div>
                {!terms.tech && (
                  <div className="form-group">
                    <label className="form-label">Documents</label>
                    <div className="entry-docs">
                      {documents.map((d, i) => (
                        <div key={i} className="entry-doc-row">
                          <input className="form-input" placeholder="Name (e.g. Escalation SOP)" value={d.name}
                            onChange={(e) => setDocuments((prev) => prev.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                          <input className="form-input" placeholder="https://…" value={d.url}
                            onChange={(e) => setDocuments((prev) => prev.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))} />
                          <button type="button" className="btn-remove-milestone" onClick={() => setDocuments((prev) => prev.filter((_, j) => j !== i))}>×</button>
                        </div>
                      ))}
                      <button type="button" className="btn-add-milestone" onClick={() => setDocuments((prev) => [...prev, { name: "", url: "" }])}>
                        + Add Document
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div>
                <h3 style={{ fontWeight: 800, textTransform: "uppercase", fontSize: "0.85rem", color: "var(--color-text-secondary)", borderBottom: "1px solid var(--color-bg-primary)", paddingBottom: 10, marginBottom: 20 }}>
                  Project Milestones
                </h3>
                <div className="milestone-rows-box">
                  {milestones.map((m, idx) => (
                    <div key={idx} className="milestone-row">
                      <input type="text" className="form-input" value={m.name} onChange={(e) => updateMilestone(idx, "name", e.target.value)} placeholder="Milestone Name" />
                      <input type="number" className="form-input" value={m.days} onChange={(e) => updateMilestone(idx, "days", e.target.value)} placeholder="Days" />
                      <span className={`milestone-row-due ${milestoneDue[idx] ? "" : "empty"}`} title={milestoneDue[idx] ? "Due if work starts on the start date" : "Pick a start date"}>
                        {milestoneDue[idx] ? fmtShort(milestoneDue[idx]) : "—"}
                      </span>
                      <button type="button" className="btn-remove-milestone" onClick={() => removeMilestoneRow(idx)}>×</button>
                    </div>
                  ))}
                </div>
                <button type="button" className="btn-add-milestone" onClick={addMilestoneRow}>+ Add Milestone</button>
              </div>

              <div style={{ display: "flex", justifyContent: "center", gap: 15, marginTop: 40 }}>
                <button type="button" className="btn-secondary" onClick={resetForm}>Clear</button>
                <span className="entry-review-pointer">Review &amp; create on the right →</span>
              </div>
            </form>
          </div>

          {/* Right: Review — everything about the project at a glance, then Create */}
          <div className="section-card entry-review">
            <div className="entry-review-eyebrow">Review</div>
            <h2 className={`entry-review-title ${titlePreview.trim() ? "" : "empty"}`}>{titlePreview.trim() || "Untitled project"}</h2>
            {descPreview.trim() && <p className="entry-review-desc">{descPreview.trim()}</p>}

            {startAt && (
              <div className={`entry-start-note ${startsNow ? "now" : ""}`}>
                {startsNow
                  ? "Starts today or earlier — it goes straight to Pending and its clock starts."
                  : `Waits in To Do, then moves to Pending by itself on ${fmtLong(startAt)}.`}
              </div>
            )}
            <div className={`entry-deadline entry-deadline-form ${expectedDeadline ? "" : "empty"}`}>
              <div className="entry-deadline-cap">Expected deadline</div>
              <div className="entry-deadline-date" key={expectedDeadline ? expectedDeadline.getTime() : "none"}>{expectedDeadline ? fmtLong(expectedDeadline) : "Pick a start date"}</div>
              <div className="entry-deadline-sub">
                {startAt ? <>Starts {fmtLong(startAt)} · </> : null}{totalDays} days (~{months} months)
              </div>
            </div>

            <dl className="entry-review-facts">
              <div>
                <dt>{selectedAssignees.size === 1 ? "Assignee" : "Assignees"}</dt>
                <dd>{selectedAssignees.size ? Array.from(selectedAssignees).join(", ") : <em>None yet</em>}</dd>
              </div>
              {accUi.show && (
                <div><dt>Account</dt><dd>{accountName || <em>No account</em>}</dd></div>
              )}
              {!terms.tech && (
                <div><dt>Documents</dt><dd>{docCount ? `${docCount} attached` : <em>None</em>}</dd></div>
              )}
            </dl>

            <div className="entry-review-cap">Milestones · {milestones.length}</div>
            <ol className="guide-list entry-review-ms">
              {milestones.map((m, idx) => (
                <li key={idx} className="guide-item">
                  <span className="entry-ms-num">{idx + 1}</span>
                  <div className="guide-label">
                    {m.name || "Unnamed Milestone"}
                    {m.hint && <div className="guide-hint">{m.hint}</div>}
                  </div>
                  <div className="entry-ms-when">
                    <span className="guide-days">{m.days}d</span>
                    {milestoneDue[idx] && <span className="entry-ms-due">{fmtShort(milestoneDue[idx])}</span>}
                  </div>
                </li>
              ))}
            </ol>

            {(planNotes.watchOuts.length > 0 || planNotes.assumptions.length > 0) && (
              <div className="entry-plan-notes">
                {planNotes.watchOuts.length > 0 && (
                  <div className="entry-plan-block watch">
                    <div className="entry-plan-title">Watch out for</div>
                    <ul>{planNotes.watchOuts.map((w, i) => <li key={i}>{w}</li>)}</ul>
                  </div>
                )}
                {planNotes.assumptions.length > 0 && (
                  <div className="entry-plan-block assume">
                    <div className="entry-plan-title">Assumptions</div>
                    <ul>{planNotes.assumptions.map((x, i) => <li key={i}>{x}</li>)}</ul>
                  </div>
                )}
                <div className="entry-plan-foot">Saved with the project — you'll find them in its task view.</div>
              </div>
            )}

            <div className="entry-review-foot">
              {accUi.locked ? (
                <p className="account-locked-inline">You're not on a client account yet, so you can't start a {terms.label} project. Ask an Admin+ or Manager to add you to one.</p>
              ) : stillNeeded.length > 0 ? (
                <p className="entry-still-needed">Still needed: {stillNeeded.join(", ")}.</p>
              ) : (
                <p className="entry-ready">Looks good — ready to create.</p>
              )}
              <button type="submit" form="task-entry-form" className="btn-primary entry-create" disabled={submitting || accUi.locked || stillNeeded.length > 0}>
                {submitting ? "CREATING..." : "Create Task"}
              </button>
            </div>
          </div>
        </div>
        )}
      </div>
    </div>
  );
}
