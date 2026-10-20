// ── AI task-planning consultant ─────────────────────────────────────────────
//
// Powers the AI step of New Task (and Caddy's create_project). The user
// describes what they're planning; the AI — knowing how each DEPARTMENT
// actually works — classifies the work, then proposes milestones tailored to
// that specific task, each with a realistic day estimate and a "done when", so
// the derived completion deadline lands "just right".
//
// How it works:
//   • The model THINKS first (Gemini thinking, level "high") and we stream its
//     thought summaries so the UI can show the reasoning live.
//   • The answer is forced into a JSON schema (responseSchema), so there's no
//     prose to scrape — and it streams too, so milestones appear as they're
//     written (parsePartialJson).
//   • Refinement is stateless: we send the brief + the CURRENT plan (including
//     any edits the person made by hand) + their feedback.
//
// Operations gets the deepest playbook (project types, calibration rules) — it's
// the department the planner is optimized for.

import { streamGenerate } from "./geminiClient";
import { getPlannerModels, thinkingConfigFor } from "./aiConfig";

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
    who: "the Operations department of ECE Contact Centers, a BPO / contact-center company. They run the production floor: launching and running client programs (campaigns / lines of business), writing SOPs and workflows, managing staffing and schedules, driving KPI improvement (AHT, CSAT, FCR, service level / SLA, schedule adherence, attrition, QA scores), rolling out tools, training agents and team leads, and keeping audits and compliance on track",
    // The planner classifies every Operations brief into one of these, then
    // adapts that type's flow. Keep `type` labels short — they're shown in the UI.
    projectTypes: [
      { type: "Process / SOP change", flow: "current-state review → SOP draft → lead sign-off → pilot on one team → training → rollout → adherence check", typical: "3–8 weeks" },
      { type: "Client / campaign launch", flow: "client requirements & SOW alignment → workforce plan & hiring → systems, access & tooling → training & nesting → go-live → hypercare", typical: "6–12 weeks" },
      { type: "KPI improvement", flow: "baseline the metric → root-cause analysis → action plan & sign-off → pilot the fix → measure against the baseline → scale & sustain", typical: "4–10 weeks" },
      { type: "Tool / system rollout", flow: "requirements → vendor / configuration setup → UAT → pilot group → training → cutover → hypercare", typical: "6–12 weeks" },
      { type: "Training program", flow: "needs analysis → content design → trainer prep → pilot class → rollout in batches → assessment", typical: "3–8 weeks" },
      { type: "Staffing / scheduling change", flow: "forecast & impact analysis → proposal → HR / compliance review & approval → employee notice → implementation → monitoring", typical: "3–6 weeks" },
      { type: "Compliance / audit", flow: "scope & criteria → evidence gathering → audit fieldwork → findings → remediation → verification", typical: "3–8 weeks" },
      { type: "Site / facilities / BCP", flow: "requirements → vendor & budget → setup → testing or BCP drill → move / activation → stabilization", typical: "4–12 weeks" },
      { type: "Reporting / dashboard", flow: "define metrics & audience → data sources → build → validate numbers with ops leads → publish → adoption check", typical: "2–6 weeks" },
      { type: "Event / one-off activity", flow: "plan & budget approval → logistics & vendors → comms → run it → wrap-up & feedback", typical: "1–4 weeks" },
    ],
    rules: [
      "People and approvals gate the timeline, not effort. Any sign-off or approval step needs 2–5 days (client, HR and finance approvals sit at the slow end).",
      "Anything that changes how agents work gets a PILOT before full rollout: one team, site or shift for at least one full schedule week (5–14 days), so results cover a normal weekly cycle. Skip the pilot only for one-off events or pure documentation/reporting work.",
      "Training scales with headcount and sites: refresher training for existing staff is 2–5 days; new-hire training plus nesting for a new program is 2–4 weeks.",
      "Changes to schedules, pay, policy or headcount need HR / compliance review and advance notice to employees — build that time in.",
      "Multiple sites or large headcount → roll out in waves (by site or team), not big-bang.",
      "Go-live itself is short (1–5 days) but is ALWAYS followed by monitoring / hypercare (7–14 days) that checks the KPI against the goal and hands over to the day-to-day owner.",
      "KPI work starts with a baseline and ends by measuring against it.",
      "Client-facing launches depend on the client: include client sign-off / UAT.",
    ],
    notes: "Operational work is gated by people and approvals, not code. Always include stakeholder sign-off, a pilot before full rollout, and training. Adherence/KPI monitoring after go-live is essential.",
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

export const PLAN_SIZES = ["Small", "Medium", "Large"];
const MIN_MILESTONES = 4;
const MAX_MILESTONES = 10;

function playbookFor(department) {
  return DEPARTMENT_PLAYBOOKS[department] || GENERIC_PLAYBOOK;
}

/** Project-type labels the planner may choose from (null = free text). */
export function projectTypesFor(department) {
  const types = playbookFor(department).projectTypes;
  return types ? [...types.map((t) => t.type), "Other"] : null;
}

// The exact JSON shape the model must return. propertyOrdering makes the
// classification stream FIRST, so the UI can show "what kind of project this
// is" before the milestones arrive.
function planSchema(department) {
  const types = projectTypesFor(department);
  return {
    type: "OBJECT",
    propertyOrdering: ["projectType", "size", "title", "description", "successMeasure", "assumptions", "milestones", "risks", "rationale"],
    properties: {
      projectType: types
        ? { type: "STRING", enum: types }
        : { type: "STRING", description: "Short label for the kind of project (2–4 words)." },
      size: { type: "STRING", enum: PLAN_SIZES },
      title: { type: "STRING", description: "Concise task title, at most 8 words." },
      description: { type: "STRING", description: "1–2 sentences: what this task is and why." },
      successMeasure: { type: "STRING", description: "One line: the measurable outcome that means it worked (a KPI target, a deliverable, an approval)." },
      assumptions: {
        type: "ARRAY", maxItems: 4,
        description: "Short assumptions the plan relies on that the person should confirm (scale, sites, headcount, tools, approvals).",
        items: { type: "STRING" },
      },
      milestones: {
        type: "ARRAY", minItems: MIN_MILESTONES, maxItems: MAX_MILESTONES,
        items: {
          type: "OBJECT",
          propertyOrdering: ["name", "days", "doneWhen"],
          properties: {
            name: { type: "STRING", description: "Specific milestone name, at most ~6 words." },
            days: { type: "INTEGER", minimum: 1, maximum: 120, description: "Calendar days this milestone takes." },
            doneWhen: { type: "STRING", description: "One short line: the concrete output or exit criteria that marks it done." },
          },
          required: ["name", "days", "doneWhen"],
        },
      },
      risks: {
        type: "ARRAY", maxItems: 3,
        description: "Biggest risks to the timeline, each with a short mitigation.",
        items: { type: "STRING" },
      },
      rationale: { type: "STRING", description: "2–3 sentences: why these milestones and this timeline fit." },
    },
    required: ["projectType", "size", "title", "description", "successMeasure", "assumptions", "milestones", "risks", "rationale"],
  };
}

function buildSystemInstruction({ department, workspaceLabel, todayISO, template, recentProjects }) {
  const pb = playbookFor(department);
  const lines = [
    `You are the task-planning consultant inside Hermes, a project database. You are helping someone in the "${workspaceLabel}" workspace plan a NEW task before they create it.`,
    ``,
    `WHO THIS TASK IS FOR: ${pb.who}.`,
    ``,
  ];

  if (pb.projectTypes) {
    lines.push(
      `FIRST, CLASSIFY the task as one of these project types (pick the closest; "Other" only if none fit), then adapt that type's usual flow to THIS task:`,
      ...pb.projectTypes.map((t) => `  • ${t.type} — usual flow: ${t.flow}. Typically ${t.typical}.`),
      ``,
      `CALIBRATION RULES for this department:`,
      ...pb.rules.map((r) => `  • ${r}`),
    );
  } else {
    lines.push(
      `TYPICAL PHASES for this kind of work (draw on these, ADAPT them to the specific task — rename, merge, split, add, or drop to fit; do NOT paste them verbatim):`,
      ...pb.phases.map((p, i) => `  ${i + 1}. ${p}`),
      `GUIDANCE: ${pb.notes}`,
    );
  }

  lines.push(
    ``,
    `SIZE the task: Small ≈ 2–4 weeks total (one team, little coordination); Medium ≈ 1–3 months; Large ≈ 3–6 months (multiple sites or teams, new tooling, hiring, or client dependencies). Weight the days toward the milestones that actually carry the effort or waiting time for THIS task.`,
    ``,
    `HOW TO THINK IT THROUGH: work out what kind of project this is, its real scale (teams, sites, headcount, tools), who has to approve what, and what could slip — THEN size each milestone. Think about the work itself, not about formatting.`,
    ``,
    `YOUR OUTPUT: a milestone plan whose milestones are SPECIFIC to what they described (not generic phase labels), in chronological order, ${MIN_MILESTONES}–${MAX_MILESTONES} of them. Every "days" is a whole number of CALENDAR days; the timeline runs start date + the sum of all milestone days, so the total must reflect real elapsed time — neither padded nor rushed. Each milestone gets a "doneWhen": the concrete output that marks it complete.`,
    `List the assumptions you had to make (so the person can correct them) and the biggest risks to the timeline.`,
    `Today is ${todayISO}.`,
  );

  if (template?.length) {
    const total = template.reduce((s, m) => s + (Number(m.days) || 0), 0);
    lines.push(
      ``,
      `THIS WORKSPACE'S STANDARD TEMPLATE (${total} days) — a reference for naming style and a typical medium-size timeline, NOT something to copy: ${template.map((m) => `${m.name} (${m.days}d)`).join(", ")}.`,
    );
  }
  if (recentProjects?.length) {
    lines.push(
      ``,
      `RECENT PROJECTS IN THIS WORKSPACE (for calibration only — how big this team's work usually is):`,
      ...recentProjects.map((p) => `  • ${p.title} — ${p.milestones} milestones, ${p.totalDays} days, ${p.status}`),
    );
  }
  return lines.join("\n");
}

function buildUserText({ brief, startDateISO, currentPlan, feedback }) {
  const start = startDateISO
    ? `Planned start date: ${startDateISO}.`
    : `No start date set yet — assume it starts within the next week.`;
  if (currentPlan && feedback) {
    const { projectType, size, title, description, successMeasure, assumptions, milestones, risks } = currentPlan;
    return [
      `ORIGINAL TASK DESCRIPTION:`,
      brief.trim(),
      start,
      ``,
      `CURRENT PLAN. Milestones with "editedByPerson": true were written or changed by the person by hand — keep their names and days exactly unless the feedback explicitly asks to change them; adjust the others around them:`,
      JSON.stringify({
        projectType, size, title, description, successMeasure, assumptions, risks,
        milestones: milestones.map(({ name, days, doneWhen, edited }) => ({ name, days, doneWhen, ...(edited ? { editedByPerson: true } : {}) })),
      }),
      ``,
      `FEEDBACK — revise the plan accordingly, and re-check the size, assumptions and risks:`,
      feedback.trim(),
    ].join("\n");
  }
  return [`Plan this task.`, start, ``, `TASK DESCRIPTION:`, brief.trim()].join("\n");
}

// ── Parsing ─────────────────────────────────────────────────────────────────

/**
 * Parse a JSON document that may be cut off mid-stream: closes any open
 * string / array / object and, if a dangling key or half-written value still
 * breaks it, backs up to the previous comma. Returns null if nothing parses.
 */
export function parsePartialJson(src) {
  const text = String(src || "").trim();
  if (!text) return null;
  const close = (s) => {
    let inStr = false;
    let esc = false;
    const stack = [];
    for (const c of s) {
      if (inStr) {
        if (esc) esc = false;
        else if (c === "\\") esc = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') inStr = true;
      else if (c === "{") stack.push("}");
      else if (c === "[") stack.push("]");
      else if (c === "}" || c === "]") stack.pop();
    }
    let out = s;
    if (inStr) out = (esc ? out.slice(0, -1) : out) + '"';
    out = out.replace(/[,:]\s*$/, "");
    return out + stack.reverse().join("");
  };
  let s = text;
  for (let attempt = 0; attempt < 10 && s; attempt++) {
    try { return JSON.parse(close(s)); } catch { /* back up and retry */ }
    // Back up to just before the last comma, or just after the last opener.
    const body = /[{[]$/.test(s) ? s.slice(0, -1) : s;
    const cut = Math.max(body.lastIndexOf(","), body.lastIndexOf("{"), body.lastIndexOf("["));
    if (cut <= 0) break;
    s = body[cut] === "," ? body.slice(0, cut) : body.slice(0, cut + 1);
  }
  return null;
}

const str = (v) => String(v ?? "").trim();
const strList = (v, max) => (Array.isArray(v) ? v.map(str).filter(Boolean).slice(0, max) : []);

/**
 * Clean a plan object into the shape the UI uses. While streaming, the last
 * milestone may still be half-written (e.g. "days" of 1 on its way to 14) —
 * the UI holds that one back until the stream ends.
 */
export function normalizePlan(obj) {
  if (!obj || typeof obj !== "object") return null;
  const milestones = (Array.isArray(obj.milestones) ? obj.milestones : [])
    .map((m) => ({
      name: str(m?.name),
      days: Math.min(120, Math.max(1, Math.round(Number(m?.days) || 0))),
      doneWhen: str(m?.doneWhen),
    }))
    .filter((m) => m.name)
    .slice(0, 12);
  return {
    projectType: str(obj.projectType),
    size: PLAN_SIZES.includes(str(obj.size)) ? str(obj.size) : "",
    title: str(obj.title),
    description: str(obj.description),
    successMeasure: str(obj.successMeasure),
    assumptions: strList(obj.assumptions, 5),
    milestones,
    risks: strList(obj.risks, 4),
    rationale: str(obj.rationale),
  };
}

/**
 * Split streamed thought-summary text into steps. Each summary starts with a
 * bold "**Heading**" line; we keep the heading + body. Headings about output
 * formatting (JSON, schema…) are dropped — they're noise to the person.
 */
export function parseThoughtSteps(thoughts) {
  const text = String(thoughts || "");
  const re = /\*\*(.+?)\*\*/g;
  const marks = [];
  let m;
  while ((m = re.exec(text))) marks.push({ title: m[1].trim(), start: m.index, bodyStart: re.lastIndex });
  // Thoughts occasionally include a draft of the JSON answer — drop code.
  const clean = (s) => s.replace(/```[\s\S]*?(```|$)/g, "").replace(/^\s*[{[][\s\S]*$/m, "").trim();
  const steps = marks.map((mk, i) => ({
    title: mk.title.replace(/[:.]+$/, ""),
    body: clean(text.slice(mk.bodyStart, marks[i + 1]?.start ?? text.length)),
  }));
  if (!steps.length && clean(text)) steps.push({ title: "Thinking it through", body: clean(text) });
  return steps.filter((s) => !/\b(json|schema|format(ting)?|output|syntax)\b/i.test(s.title));
}

// ── Main entry point ────────────────────────────────────────────────────────

/**
 * Ask the AI to plan (or re-plan) a task's milestones for a department.
 *
 * @param {object}  opts
 * @param {string}  opts.department      "Workforce" | "Operations" | "Executives" | undefined
 * @param {string}  opts.workspaceLabel  human label for the workspace
 * @param {string}  opts.brief           the person's description of the task
 * @param {string}  [opts.startDateISO]  yyyy-mm-dd
 * @param {object}  [opts.currentPlan]   the plan to revise (with `feedback`)
 * @param {string}  [opts.feedback]      what to change about currentPlan
 * @param {Array}   [opts.template]      the workspace's milestone template [{name, days}]
 * @param {Array}   [opts.recentProjects] [{title, milestones, totalDays, status}] for calibration
 * @param {"low"|"medium"|"high"} [opts.thinkingLevel]
 * @param {(steps:Array, raw:string)=>void} [opts.onThinking]  live thought steps
 * @param {(plan:object)=>void} [opts.onPartial]  live partial plan while the answer streams
 * @param {()=>void} [opts.onRestart]  switched model mid-way; discard partial output
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<{plan:object, thoughts:Array, model:string}>}
 */
export async function planTask({
  department,
  workspaceLabel,
  brief,
  startDateISO = "",
  currentPlan = null,
  feedback = "",
  template = [],
  recentProjects = [],
  thinkingLevel = "high",
  onThinking,
  onPartial,
  onRestart,
  signal,
}) {
  const systemInstruction = buildSystemInstruction({
    department,
    workspaceLabel,
    todayISO: localISODate(new Date()),
    template,
    recentProjects,
  });
  const userText = buildUserText({ brief, startDateISO, currentPlan, feedback });
  const schema = planSchema(department);

  const { text, thoughts, model } = await streamGenerate({
    models: getPlannerModels(),
    signal,
    onRestart,
    buildBody: (m) => {
      const thinkingConfig = thinkingConfigFor(m, thinkingLevel, true);
      return {
        systemInstruction: { parts: [{ text: systemInstruction }] },
        contents: [{ role: "user", parts: [{ text: userText }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: schema,
          ...(thinkingConfig ? { thinkingConfig } : {}),
        },
      };
    },
    onThought: (_chunk, all) => onThinking?.(parseThoughtSteps(all), all),
    onText: (_chunk, all) => {
      if (!onPartial) return;
      const partial = normalizePlan(parsePartialJson(all));
      if (partial) onPartial(partial);
    },
  });

  const plan = normalizePlan(parsePartialJson(text));
  if (!plan || plan.milestones.length === 0) {
    throw new Error("The planner didn't return a usable plan. Try describing the task with a bit more detail, or tweak the wording.");
  }
  return { plan, thoughts: parseThoughtSteps(thoughts), model };
}

/** yyyy-mm-dd in the person's LOCAL timezone (toISOString would use UTC). */
export function localISODate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
