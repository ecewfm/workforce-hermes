import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "../data/react";
import { api } from "../data/api";
import { fallbackMilestonesFor, withTemplateHints } from "../utils/defaults";
import { useWorkspace } from "../utils/workspaceContext";
import { WORKSPACE_META, isInDepartment } from "../utils/departments";
import ConsultPanel from "./ConsultPanel";
import Select from "./ui/Select";
import DatePicker from "./ui/DatePicker";
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
        status: "todo",
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
  const [step, setStep] = useState(() => (isCaddyEnabled() ? "consult" : "form"));
  const [draftTitle, setDraftTitle] = useState("");
  const [draftDesc, setDraftDesc] = useState("");
  const [draftStart, setDraftStart] = useState("");
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
  function applyPlan(plan, startDate) {
    milestonesTouched.current = true;
    // doneWhen becomes the milestone's meaning (saved, shown in the task modal).
    setMilestones(plan.milestones.map((m) => ({ name: m.name, days: m.days, ...(m.doneWhen ? { hint: `Done when: ${m.doneWhen}` } : {}) })));
    setPlanNotes({ watchOuts: plan.risks || [], assumptions: plan.assumptions || [] });
    setDraftTitle(plan.title || "");
    setDraftDesc([plan.description, plan.successMeasure && `Goal: ${plan.successMeasure}`].filter(Boolean).join("\n\n"));
    setDraftStart(startDate || "");
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

  async function handleSubmit(e) {
    e.preventDefault();
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
      title: document.getElementById("task-title").value,
      assignee: Array.from(selectedAssignees).join(", "),
      startDate: draftStart,
      description: document.getElementById("task-desc").value,
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
    showModal({
      title: "Project Created",
      message: "Your project has been added to the board and is syncing.",
      type: "success",
      onConfirm: () => {
        resetForm();
        onCreated();
      },
    });
  }

  const totalDays = milestones.reduce((sum, m) => sum + m.days, 0);
  const months = (totalDays / 30).toFixed(1);

  if (step === "consult") {
    return (
      <div id="entry-view" className="view-section">
        <div className="container">
          <ConsultPanel
            department={workspaceDept}
            workspace={workspace}
            workspaceLabel={WORKSPACE_META[workspace]?.label || "this workspace"}
            template={templateMilestones}
            onApply={applyPlan}
            onSkip={startBlank}
            seed={plannerSeed}
            onSeedUsed={onPlannerSeedUsed}
          />
        </div>
      </div>
    );
  }

  return (
    <div id="entry-view" className="view-section">
      <div className="container">
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
              <p style={{ color: "var(--color-text-secondary)", fontSize: "0.9rem", marginTop: 5 }}>Set assignees and a start date, tweak anything, then create the task</p>
            </div>

            <form ref={formRef} onSubmit={handleSubmit}>
              <div style={{ marginBottom: 30 }}>
                <h3 style={{ fontWeight: 800, textTransform: "uppercase", fontSize: "0.85rem", color: "var(--color-text-secondary)", borderBottom: "1px solid var(--color-bg-primary)", paddingBottom: 10, marginBottom: 20 }}>
                  Task Information
                </h3>
                <div className="form-group">
                  <label className="form-label">Task Title *</label>
                  <input type="text" id="task-title" className="form-input" placeholder="Project Name" defaultValue={draftTitle} required />
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
                </div>
                <div className="form-group">
                  <label className="form-label">Description</label>
                  <textarea id="task-desc" className="form-input" style={{ height: 80 }} placeholder="Details..." defaultValue={draftDesc}></textarea>
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
                      <button type="button" className="btn-remove-milestone" onClick={() => removeMilestoneRow(idx)}>×</button>
                    </div>
                  ))}
                </div>
                <button type="button" className="btn-add-milestone" onClick={addMilestoneRow}>+ Add Milestone</button>
              </div>

              <div style={{ display: "flex", justifyContent: "center", gap: 15, marginTop: 40 }}>
                <button type="button" className="btn-secondary" onClick={resetForm}>Clear</button>
                {accUi.locked && (
                  <p className="account-locked-inline">You're not on a client account yet, so you can't start a {terms.label} project. Ask an Admin+ or Manager to add you to one.</p>
                )}
                <button type="submit" className="btn-primary" style={{ width: "auto", padding: "12px 40px" }} disabled={submitting || accUi.locked}>
                  {submitting ? "CREATING..." : "Create Task"}
                </button>
              </div>
            </form>
          </div>

          {/* Right: Guide */}
          <div className="section-card">
            <h2 style={{ fontWeight: 900, marginTop: 0, textTransform: "uppercase", fontSize: "1.2rem", marginBottom: 10 }}>Milestone Overview</h2>
            <p style={{ fontSize: "0.72rem", color: "var(--color-text-secondary)", margin: "0 0 12px 0" }}>
              This task's milestones and total timeline. Edit any of them on the left before creating.
            </p>
            <div style={{ height: 2, background: "linear-gradient(to right, var(--color-accent), transparent)", marginBottom: 25 }}></div>
            <div className="guide-list">
              {milestones.map((m, idx) => (
                <div key={idx} className="guide-item">
                  <div className="guide-label">
                    M{idx + 1}: {m.name || "Unnamed Milestone"}
                    {m.hint && <div className="guide-hint">{m.hint}</div>}
                  </div>
                  <div className="guide-days">({m.days} days)</div>
                </div>
              ))}
            </div>
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
                    <ul>{planNotes.assumptions.map((a, i) => <li key={i}>{a}</li>)}</ul>
                  </div>
                )}
                <div className="entry-plan-foot">Saved with the project — you'll find them in its task view.</div>
              </div>
            )}
            <div className="timeline-summary-box">
              <div style={{ fontWeight: 800, color: "var(--color-accent)", fontSize: "0.9rem" }}>
                Total Guided Timeline: {totalDays} Days (~{months} Months)
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
