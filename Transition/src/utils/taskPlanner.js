// ── AI task-planning consultant ─────────────────────────────────────────────
//
// Powers the "Consult with AI" button on New Task. The user describes what
// they're planning; the AI — knowing how each DEPARTMENT actually works —
// proposes a set of milestones tailored to that specific task, with realistic
// day estimates, so the derived completion deadline lands "just right".
//
// Workforce Hermes now spans three kinds of work, and their processes differ:
//   • Workforce (WFM web developers) — software delivery lifecycle
//   • Operations — operational rollout / process lifecycle
//   • Executives — strategic initiative lifecycle
//
// Reuses the Gemini proxy + model-fallback chain via runAssistant (no tools):
// we ask for strict JSON and parse it out of the reply.

import { runAssistant } from "./geminiClient";

// Per-department "playbook": the typical phases the AI should draw on and
// ADAPT to the specific brief (not dump verbatim). Kept in one place so it's
// easy to tune as the org's real processes evolve.
export const DEPARTMENT_PLAYBOOKS = {
  Workforce: {
    who: "the Workforce Management (WFM) web-development team — they build internal web apps, dashboards, Google Apps Script tools, and integrations",
    phases: [
      "Requirements & Planning (scope, user stories, data model sketch)",
      "Design (UI/UX, wireframes, architecture)",
      "Project Setup & Database (repo, schema, environments)",
      "Core Feature Development (often split into phases for larger builds)",
      "API / System Integration (Zoho, CRMs, sheets, third-party services)",
      "Internal Testing & Bug Fixes (QA against requirements)",
      "User Testing & Refinement (UAT with real users, feedback loop)",
      "Final Polish & Optimization (performance, edge cases, cleanup)",
      "Deployment & Soft Launch (release, monitor, hotfixes)",
      "Post-Launch Support (stabilization, handover, docs)",
    ],
    notes: "Bias toward realistic engineering time: setup is short, core development is the bulk, always include testing AND user testing separately. Integration-heavy builds need a dedicated integration phase.",
  },
  Operations: {
    who: "the Operations department — they design and roll out operational processes, SOPs, workflows, staffing/scheduling changes, and coordinate cross-team execution",
    phases: [
      "Discovery & Requirements (current-state analysis, pain points, goals)",
      "Process Design / SOP Drafting (target workflow, roles, RACI)",
      "Stakeholder Alignment & Sign-off (reviews, approvals from leads)",
      "Tooling & Resource Setup (systems, templates, access, forms)",
      "Pilot / Dry Run (small-scale trial, gather issues)",
      "Training & Enablement (train affected staff, materials, FAQs)",
      "Full Rollout / Go-Live (deploy the process org-wide)",
      "Monitoring & QA / Audit (track adherence, KPIs, compliance)",
      "Optimization & Handover (refine from data, transition to owners)",
    ],
    notes: "Operational work is gated by people and approvals, not code. Always include stakeholder sign-off, a pilot before full rollout, and training. Adherence/QA monitoring after go-live is essential.",
  },
  Executives: {
    who: "the Executives — they drive strategic initiatives: analysis, business cases, proposals, decisions, and oversight of org-wide programs",
    phases: [
      "Research & Situational Analysis (data, market/ops landscape, options)",
      "Stakeholder Consultation (gather input from leads and departments)",
      "Business Case / Proposal Draft (objectives, scope, budget, risks)",
      "Impact & Financial Modeling (projections, ROI, resourcing)",
      "Review & Revision Cycle (iterate with advisors/board)",
      "Leadership Presentation (present for buy-in)",
      "Decision & Approval (formal go/no-go, funding)",
      "Directive & Delegation (assign owners, set mandates)",
      "Oversight & Progress Review (checkpoints, course-correction)",
    ],
    notes: "Executive initiatives are decision- and review-heavy: build in consultation and revision cycles, an explicit approval gate, then delegation and oversight. Timelines are driven by review cadences, not build effort.",
  },
};

// Default when a workspace has no department mapping (treat as generic project).
const GENERIC_PLAYBOOK = {
  who: "a project team in this workspace",
  phases: [
    "Planning & Scope",
    "Preparation & Setup",
    "Execution (core work, phased if large)",
    "Review & Testing",
    "Refinement",
    "Launch / Delivery",
    "Follow-up & Support",
  ],
  notes: "Adapt phase count and effort to the scope described.",
};

function playbookFor(department) {
  return DEPARTMENT_PLAYBOOKS[department] || GENERIC_PLAYBOOK;
}

function buildSystemInstruction({ department, workspaceLabel, todayISO }) {
  const pb = playbookFor(department);
  return [
    `You are the task-planning consultant inside Workforce Hermes, a project database. You are helping someone in the "${workspaceLabel}" workspace plan a NEW task before they create it.`,
    ``,
    `WHO THIS TASK IS FOR: ${pb.who}.`,
    ``,
    `TYPICAL PHASES for this kind of work (draw on these, ADAPT them to the specific task — rename, merge, split, add, or drop to fit; do NOT paste them verbatim):`,
    ...pb.phases.map((p, i) => `  ${i + 1}. ${p}`),
    `GUIDANCE: ${pb.notes}`,
    ``,
    `YOUR JOB: from the user's description, propose a milestone plan whose milestones are SPECIFIC to what they described (not generic), each with a realistic day estimate, so that the total timeline is "just right" for completion — neither padded nor rushed.`,
    `Calibrate scope: a small/simple task ≈ 2–4 weeks total; a medium task ≈ 1–3 months; a large/complex task ≈ 3–6 months. Weight days toward the phases that actually carry the effort for THIS task.`,
    `Today is ${todayISO}. The completion deadline is derived as start date + the sum of all milestone days, so make the day totals reflect real calendar effort.`,
    ``,
    `RESPOND WITH ONLY VALID JSON (no markdown, no code fences, no prose around it), in exactly this shape:`,
    `{`,
    `  "title": "a concise suggested task title (<= 8 words), or \\"\\" if the description already implies one",`,
    `  "description": "a tightened 1–2 sentence description of the task",`,
    `  "milestones": [ { "name": "specific milestone name", "days": 12 }, ... ],`,
    `  "rationale": "2–4 sentences: why this set of milestones and this timeline fit the task and the department's process"`,
    `}`,
    `Rules: 4–10 milestones. Every "days" is a positive whole number. Order milestones chronologically. Names are specific to the task, not just phase labels.`,
  ].join("\n");
}

// Tolerant JSON extraction — models sometimes wrap JSON in prose or fences.
function parsePlan(text) {
  if (!text) return null;
  let s = String(text).trim();
  // strip ```json / ``` fences
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  // isolate the outermost object
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first === -1 || last === -1 || last <= first) return null;
  let obj;
  try {
    obj = JSON.parse(s.slice(first, last + 1));
  } catch {
    return null;
  }
  const milestones = Array.isArray(obj.milestones)
    ? obj.milestones
        .map((m) => ({
          name: String(m?.name || "").trim(),
          days: Math.max(0, Math.round(Number(m?.days) || 0)),
        }))
        .filter((m) => m.name && m.days > 0)
    : [];
  if (!milestones.length) return null;
  return {
    title: String(obj.title || "").trim(),
    description: String(obj.description || "").trim(),
    rationale: String(obj.rationale || "").trim(),
    milestones,
  };
}

/**
 * Ask the AI to plan a task's milestones for a department.
 *
 * @param {object} opts
 * @param {string} opts.department    "Workforce" | "Operations" | "Executives" | undefined
 * @param {string} opts.workspaceLabel human label for the workspace
 * @param {string} opts.brief          the user's description of the task
 * @param {string} opts.startDateISO   yyyy-mm-dd (for calendar context)
 * @param {string} opts.todayISO       yyyy-mm-dd
 * @param {Array}  opts.history        prior turns (for refine), Gemini contents
 * @param {string} [opts.refinement]   optional follow-up instruction to revise a prior plan
 * @returns {Promise<{plan:object, contents:Array}>}
 */
export async function consultTaskPlan({
  department,
  workspaceLabel,
  brief,
  startDateISO,
  todayISO,
  history = [],
  refinement = "",
}) {
  const systemInstruction = buildSystemInstruction({ department, workspaceLabel, todayISO });
  const userText = refinement
    ? `Revise the previous plan based on this feedback, keeping the same JSON shape:\n${refinement}`
    : [
        `Plan the milestones for this task.`,
        startDateISO ? `Planned start date: ${startDateISO}.` : ``,
        ``,
        `TASK DESCRIPTION:`,
        brief.trim(),
      ]
        .filter(Boolean)
        .join("\n");

  const { text, contents } = await runAssistant({
    history,
    userText,
    tools: [],
    systemInstruction,
    taskMode: true, // prefer the stronger model for planning quality
    executeTool: async () => ({}),
  });

  const plan = parsePlan(text);
  if (!plan) {
    throw new Error("The planner didn't return a usable plan. Try describing the task with a bit more detail, or tweak the wording.");
  }
  return { plan, contents };
}
