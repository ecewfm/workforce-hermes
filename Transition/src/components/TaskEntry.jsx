import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { FALLBACK_MILESTONES } from "../utils/defaults";
import { useWorkspace } from "../utils/workspaceContext";
import { WORKSPACE_META, isInDepartment } from "../utils/departments";

export default function TaskEntry({ staff, userRole, userName, onCreated, showModal }) {
  const workspace = useWorkspace();
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

  const [milestones, setMilestones] = useState(() => FALLBACK_MILESTONES.map((m) => ({ ...m })));
  const [selectedAssignees, setSelectedAssignees] = useState(new Set());
  const [showOptions, setShowOptions] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const formRef = useRef(null);
  const milestonesTouched = useRef(false);

  const templateMilestones = appConfig?.defaultMilestones?.length
    ? appConfig.defaultMilestones
    : FALLBACK_MILESTONES;

  // Swap in the workspace template once it loads — but never clobber rows the
  // user has already started editing.
  useEffect(() => {
    if (appConfig?.defaultMilestones?.length && !milestonesTouched.current) {
      setMilestones(appConfig.defaultMilestones.map((m) => ({ ...m })));
    }
  }, [appConfig]);

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
      next[index] = { ...next[index], [field]: field === "days" ? parseInt(value) || 0 : value };
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
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);

    const milestonesData = milestones.map((m) => ({
      name: m.name,
      days: m.days,
      completed: false,
    }));

    // We don't await here to make it feel INSTANT because we have an optimistic update
    addTask({
      workspace,
      title: document.getElementById("task-title").value,
      assignee: Array.from(selectedAssignees).join(", "),
      startDate: document.getElementById("task-date").value,
      description: document.getElementById("task-desc").value,
      milestones: milestonesData,
    })
      .then(() => {
        // Success handled by showing modal early
      })
      .catch((err) => {
        console.error("Task submission error:", err);
        showModal({
          title: "Deployment Failed",
          message: "There was an error deploying your task. Please try again.",
          type: "error",
        });
      })
      .finally(() => {
        setSubmitting(false);
      });

    // Show success modal INSTANTLY
    showModal({
      title: "Project Deployed",
      message: "Your project has been successfully added and is currently syncing.",
      type: "success",
      onConfirm: () => {
        resetForm();
        onCreated();
      },
    });
  }

  const totalDays = milestones.reduce((sum, m) => sum + m.days, 0);
  const months = (totalDays / 30).toFixed(1);

  return (
    <div id="entry-view" className="view-section">
      <div className="container">
        <div className="entry-grid">
          {/* Left: Form */}
          <div className="section-card">
            <div style={{ textAlign: "center", marginBottom: 30 }}>
              <h1 style={{ fontWeight: 900, margin: 0, fontSize: "2rem", color: "var(--color-text-primary)" }}>Create New Task</h1>
              <p style={{ color: "var(--color-text-secondary)", fontSize: "0.9rem", marginTop: 5 }}>Enter project details and milestones</p>
            </div>

            <form ref={formRef} onSubmit={handleSubmit}>
              <div style={{ marginBottom: 30 }}>
                <h3 style={{ fontWeight: 800, textTransform: "uppercase", fontSize: "0.85rem", color: "var(--color-text-secondary)", borderBottom: "1px solid var(--color-bg-primary)", paddingBottom: 10, marginBottom: 20 }}>
                  Task Information
                </h3>
                <div className="form-group">
                  <label className="form-label">Task Title *</label>
                  <input type="text" id="task-title" className="form-input" placeholder="Project Name" required />
                </div>
                <div className="form-group">
                  <label className="form-label">Assignees *</label>
                  <div className="custom-multiselect">
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
                <div className="form-group">
                  <label className="form-label">Start Date *</label>
                  <input type="date" id="task-date" className="form-input" required />
                </div>
                <div className="form-group">
                  <label className="form-label">Description</label>
                  <textarea id="task-desc" className="form-input" style={{ height: 80 }} placeholder="Details..."></textarea>
                </div>
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
                <button type="submit" className="btn-primary" style={{ width: "auto", padding: "12px 40px" }} disabled={submitting}>
                  {submitting ? "DEPLOYING..." : "Create Task"}
                </button>
              </div>
            </form>
          </div>

          {/* Right: Guide */}
          <div className="section-card">
            <h2 style={{ fontWeight: 900, marginTop: 0, textTransform: "uppercase", fontSize: "1.2rem", marginBottom: 10 }}>Standard Milestone Guide</h2>
            <p style={{ fontSize: "0.72rem", color: "var(--color-text-secondary)", margin: "0 0 12px 0" }}>
              Defaults come from the workspace template — Admin+ can change them in Settings → Workspace Defaults.
            </p>
            <div style={{ height: 2, background: "linear-gradient(to right, var(--color-accent), transparent)", marginBottom: 25 }}></div>
            <div className="guide-list">
              {milestones.map((m, idx) => (
                <div key={idx} className="guide-item">
                  <div className="guide-label">M{idx + 1}: {m.name || "Unnamed Milestone"}</div>
                  <div className="guide-days">({m.days} days)</div>
                </div>
              ))}
            </div>
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
