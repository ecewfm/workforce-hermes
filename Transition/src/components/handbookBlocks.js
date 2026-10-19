/**
 * Handbook block model, palette definitions, and ready-made layout templates.
 *
 * A block is: { id, type, w, props, col? }
 *   - w: column span in the 6-column grid (2 = third, 3 = half, 4 = two-thirds, 6 = full)
 *   - props: type-specific content
 *   - col: "side" | "side2" to sit in a sidebar column (omitted = main column)
 *
 * Starter content speaks each workspace's language: the programming team
 * ("workforce") keeps its software defaults; Operations gets contact-center
 * floor content and Executives gets leadership content. Same block types and
 * shapes everywhere, so the editor works unchanged — use defaultsFor(ws),
 * templatesFor(ws), starterBlocksFor(ws) and makeBlock(type, ws).
 */

let _seq = 0;
export function uid(prefix = "b") {
  _seq += 1;
  return `${prefix}_${Date.now().toString(36)}_${_seq.toString(36)}`;
}

// Default content + width for each block type.
const DEFAULTS = {
  banner: { w: 6, props: { title: "Workforce Management", subtitle: "Programming Department — Operational Processes & Policies" } },
  heading: { w: 6, props: { text: "Section Heading", icon: "book" } },
  text: { w: 6, props: { body: "Write your content here. Explain a process, a policy, or anything the team should know." } },
  callout: { w: 6, props: { title: "Reminder", body: "Keep all tracking tickets updated daily to reflect changes, blockers, or completion." } },
  timeline: {
    w: 6,
    props: {
      items: [
        { title: "Start of Day", desc: "Review and organize assigned tasks/tickets inside Hermes." },
        { title: "Morning Focus", desc: "Daily stand-up / align with department goals and current sprint tasks." },
        { title: "Ongoing Development", desc: "Build functionality using our designated frontend, backend, and db frameworks." },
        { title: "End of Day", desc: "Explicitly update progress, milestones, and blockages in Hermes." },
      ],
    },
  },
  steps: {
    w: 6,
    props: {
      items: [
        { title: "The 30-Minute Rule", desc: "Attempt self-resolution or standard diagnostics for 30 minutes max." },
        { title: "Collaborate", desc: "Reach out to fellow programmers or consult the relevant team immediately." },
        { title: "Escalate", desc: "If still blocked, escalate to the lead with full context and what you've tried." },
      ],
    },
  },
  cardgrid: {
    w: 6,
    props: {
      columns: [
        { icon: "layers", title: "Front End", body: "Standard client-side interfaces using our approved framework." },
        { icon: "steps", title: "Back End", body: "Server-side functions, triggers, and execution handlers." },
        { icon: "cardgrid", title: "Database & Storage", body: "Structured storage and metadata management." },
      ],
    },
  },
  kpis: {
    w: 6,
    props: {
      items: [
        { value: "4", label: "Core Stages" },
        { value: "30m", label: "Self-Resolve Rule" },
        { value: "100%", label: "Daily Updates" },
        { value: "V2.4", label: "Process Standard" },
      ],
    },
  },
  chart: {
    w: 3,
    props: {
      kind: "bar", // bar | hbar | line | area | pie | donut | progress | radial
      title: "Workload Distribution",
      data: [
        { label: "Queue", value: 8 },
        { label: "Active", value: 12 },
        { label: "Testing", value: 5 },
        { label: "Done", value: 15 },
      ],
    },
  },
  quote: {
    w: 6,
    props: { text: "Code is read far more often than it is written — optimize for the next person.", author: "Engineering Principle" },
  },
  checklist: {
    w: 3,
    props: {
      title: "Definition of Done",
      items: [
        { text: "Code reviewed & approved", done: true },
        { text: "Milestones updated in Hermes", done: true },
        { text: "Deployed & smoke-tested", done: false },
      ],
    },
  },
  divider: { w: 6, props: {} },
  image: { w: 3, props: { url: "", alt: "" } },
  access: {
    w: 1,
    props: {
      heading: "Universal Access Information",
      cards: [
        {
          title: "Tool Access",
          items: [
            { label: "User ID", value: "" },
            { label: "Password", value: "" },
          ],
        },
      ],
    },
  },
};

// Operations — contact-center floor: shift flow, escalation path, floor
// policies, KPI targets and a quality chart. Same shapes as DEFAULTS.
const OPS_DEFAULTS = {
  ...DEFAULTS,
  banner: { w: 6, props: { title: "Contact Center Operations", subtitle: "Operations Department — Floor Processes, SOPs & Policies" } },
  callout: { w: 6, props: { title: "Reminder", body: "Log every escalation, incident and shift handover in Hermes before you leave the floor." } },
  timeline: {
    w: 6,
    props: {
      items: [
        { title: "Pre-Shift Huddle", desc: "Review the forecast, staffing, client updates and yesterday's QA notes with the team." },
        { title: "Start of Shift", desc: "Confirm every agent is logged in on time, tools are working, and schedules are adhered to." },
        { title: "Floor Monitoring", desc: "Watch service level, AHT and the queue live; adjust breaks and coverage as volume moves." },
        { title: "End of Shift", desc: "Close out open cases, log incidents, and hand over to the next lead in Hermes." },
      ],
    },
  },
  steps: {
    w: 6,
    props: {
      items: [
        { title: "Agent → Team Lead", desc: "Flag the issue right away with the customer, account and case number. Never leave the customer without an update." },
        { title: "Team Lead → Operations Manager", desc: "If it isn't resolved within 15 minutes, or it affects several customers, escalate to the OM." },
        { title: "OM → Client & Support Teams", desc: "Service-impacting issues go to the client contact, WFM and IT with a short incident summary." },
      ],
    },
  },
  cardgrid: {
    w: 6,
    props: {
      columns: [
        { icon: "timeline", title: "Attendance & Adherence", body: "Be logged in and ready at your scheduled start. Breaks and lunches follow the WFM schedule." },
        { icon: "callout", title: "Quality & Compliance", body: "Follow the approved script, verify the customer's identity, and note every interaction accurately." },
        { icon: "lock", title: "Data Privacy", body: "Clean desk, no personal phones on the floor, and never write down or copy customer data." },
      ],
    },
  },
  kpis: {
    w: 6,
    props: {
      items: [
        { value: "80/20", label: "Service Level" },
        { value: "≤ 6m", label: "Avg Handle Time" },
        { value: "90%", label: "QA Score" },
        { value: "95%", label: "Schedule Adherence" },
      ],
    },
  },
  chart: {
    w: 3,
    props: {
      kind: "bar",
      title: "QA Score by Team (%)",
      data: [
        { label: "Team A", value: 92 },
        { label: "Team B", value: 88 },
        { label: "Team C", value: 95 },
        { label: "Team D", value: 90 },
      ],
    },
  },
  quote: {
    w: 6,
    props: { text: "Every interaction is the customer's whole impression of us — make it count.", author: "Operations Principle" },
  },
  checklist: {
    w: 3,
    props: {
      title: "Shift Handover",
      items: [
        { text: "Open escalations handed over", done: true },
        { text: "Absences & staffing gaps logged", done: true },
        { text: "Incidents & downtime reported", done: false },
      ],
    },
  },
};

// Executives — leadership: governance, decision rights, OKRs, meeting
// cadence and the approval path.
const EXEC_DEFAULTS = {
  ...DEFAULTS,
  banner: { w: 6, props: { title: "Executive Leadership", subtitle: "Executive Team — Governance, Decisions & Operating Rhythm" } },
  callout: { w: 6, props: { title: "Reminder", body: "Record every material decision in the decision log — what was decided, who owns it, and by when." } },
  timeline: {
    w: 6,
    props: {
      items: [
        { title: "Weekly — Leadership Sync", desc: "Priorities, blockers and the key numbers across every department." },
        { title: "Monthly — Business Review", desc: "Financials, client health and each department's scorecard." },
        { title: "Quarterly — OKR Review", desc: "Score last quarter's objectives, set the next ones, and move resources to match." },
        { title: "Annually — Strategy Offsite", desc: "Revisit the vision, multi-year goals and next year's operating plan." },
      ],
    },
  },
  steps: {
    w: 6,
    props: {
      items: [
        { title: "Propose", desc: "The owner writes a one-page brief: the decision needed, the options, the cost and the risks." },
        { title: "Review", desc: "Affected department heads respond within the agreed review window." },
        { title: "Decide & Record", desc: "The accountable executive decides, logs it in the decision log, and tells the teams." },
      ],
    },
  },
  cardgrid: {
    w: 6,
    props: {
      columns: [
        { icon: "layers", title: "Strategy & Budget", body: "The leadership team sets direction, the annual budget and major investments." },
        { icon: "steps", title: "Department Operations", body: "Department heads decide day-to-day matters within their approved budget." },
        { icon: "lock", title: "People & Compensation", body: "New roles and pay changes need HR review and executive approval." },
      ],
    },
  },
  kpis: {
    w: 6,
    props: {
      items: [
        { value: "+12%", label: "Revenue Growth" },
        { value: "95%", label: "Client Retention" },
        { value: "18%", label: "EBITDA Margin" },
        { value: "4 / 5", label: "OKRs On Track" },
      ],
    },
  },
  chart: {
    w: 3,
    props: {
      kind: "progress",
      title: "OKR Progress (%)",
      data: [
        { label: "Grow revenue", value: 70 },
        { label: "Retain key clients", value: 85 },
        { label: "Launch a new service", value: 40 },
        { label: "Raise engagement", value: 60 },
      ],
    },
  },
  quote: {
    w: 6,
    props: { text: "Decide clearly, write it down, and explain why — alignment follows.", author: "Leadership Principle" },
  },
  checklist: {
    w: 3,
    props: {
      title: "Approval Checklist",
      items: [
        { text: "Business case & budget attached", done: true },
        { text: "Risks & dependencies reviewed", done: true },
        { text: "Owner and deadline assigned", done: false },
      ],
    },
  },
};

/** Which set of starter content a workspace gets. */
function contentKey(ws) {
  if (ws === "operations") return "operations";
  if (ws === "executives") return "executives";
  return "workforce";
}

/** Default content + width for each block type, in this workspace's language. */
export function defaultsFor(ws) {
  const key = contentKey(ws);
  return key === "operations" ? OPS_DEFAULTS : key === "executives" ? EXEC_DEFAULTS : DEFAULTS;
}

/** An example access-card title for the editor's placeholder. */
export function accessExampleFor(ws) {
  const key = contentKey(ws);
  return key === "operations" ? "CRM Access" : key === "executives" ? "Board Portal Access" : "Supabase Access";
}

export function makeBlock(type, ws) {
  const defs = defaultsFor(ws);
  const def = defs[type] || defs.text;
  return {
    id: uid(),
    type: defs[type] ? type : "text",
    w: def.w,
    props: JSON.parse(JSON.stringify(def.props)),
  };
}

// Palette ordering + labels + icons, organized into groups so the picker reads
// as a curated set rather than a flat, repetitive list.
export const BLOCK_DEFS = [
  { type: "banner", label: "Banner", icon: "banner", group: "Headers" },
  { type: "heading", label: "Section Heading", icon: "heading", group: "Headers" },

  { type: "text", label: "Paragraph", icon: "text", group: "Content" },
  { type: "callout", label: "Callout / Reminder", icon: "callout", group: "Content" },
  { type: "quote", label: "Quote", icon: "quote", group: "Content" },

  { type: "timeline", label: "Timeline (flow)", icon: "timeline", group: "Lists" },
  { type: "steps", label: "Numbered Steps", icon: "steps", group: "Lists" },
  { type: "checklist", label: "Checklist", icon: "check", group: "Lists" },
  { type: "cardgrid", label: "Card Grid", icon: "cardgrid", group: "Lists" },

  { type: "kpis", label: "KPI Stats", icon: "kpi", group: "Data" },
  { type: "chart", label: "Chart", icon: "chart", group: "Data" },
  { type: "access", label: "Access / Credentials", icon: "lock", group: "Data" },

  { type: "image", label: "Image", icon: "image", group: "Media" },
  { type: "divider", label: "Divider", icon: "divider", group: "Media" },
];

// Grouped view for the palette (preserves order, de-duplicates group headers).
export const BLOCK_GROUPS = BLOCK_DEFS.reduce((acc, def) => {
  const g = acc.find((x) => x.group === def.group);
  if (g) g.items.push(def);
  else acc.push({ group: def.group, items: [def] });
  return acc;
}, []);

// Templates: arrays of partial blocks (type/w/props). cloneTemplate assigns ids.
export const TEMPLATES = [
  {
    id: "tpl-banner",
    name: "Page Banner",
    desc: "A bold gradient header with title and subtitle.",
    blocks: [{ type: "banner", w: 6, props: { ...DEFAULTS.banner.props } }],
  },
  {
    id: "tpl-techstack",
    name: "Technology Stack",
    desc: "Heading + three labelled tech columns (Front / Back / DB).",
    blocks: [
      { type: "heading", w: 6, props: { text: "Approved Technology Stack", icon: "layers" } },
      { type: "cardgrid", w: 6, props: { ...JSON.parse(JSON.stringify(DEFAULTS.cardgrid.props)) } },
    ],
  },
  {
    id: "tpl-sop",
    name: "Operating Procedures",
    desc: "Heading + a 2×2 grid of procedure cards.",
    blocks: [
      { type: "heading", w: 6, props: { text: "Standard Operating Procedures", icon: "steps" } },
      {
        type: "cardgrid", w: 6, props: {
          columns: [
            { icon: "callout", title: "Code Reviews", body: "Ensure all libraries undergo structural evaluation before final validation." },
            { icon: "save", title: "Version Tracking", body: "Document code changes and map milestones back to their Hermes ticket." },
            { icon: "layers", title: "Alignment", body: "Do not modify critical endpoints independently. Sync schema changes first." },
            { icon: "callout", title: "Security Protocols", body: "Apply data constraints, restrict permissions, and secure endpoints." },
          ],
        },
      },
    ],
  },
  {
    id: "tpl-daily",
    name: "Daily Protocol",
    desc: "Heading + a vertical timeline of the daily routine.",
    blocks: [
      { type: "heading", w: 6, props: { text: "Daily Hermes Protocol", icon: "timeline" } },
      { type: "timeline", w: 6, props: { ...JSON.parse(JSON.stringify(DEFAULTS.timeline.props)) } },
      { type: "callout", w: 6, props: { ...DEFAULTS.callout.props } },
    ],
  },
  {
    id: "tpl-roadblock",
    name: "Roadblock Protocol",
    desc: "Heading + numbered escalation steps.",
    blocks: [
      { type: "heading", w: 6, props: { text: "Roadblock Protocol", icon: "callout" } },
      { type: "steps", w: 6, props: { ...JSON.parse(JSON.stringify(DEFAULTS.steps.props)) } },
    ],
  },
  {
    id: "tpl-stats",
    name: "Stats Row",
    desc: "A row of KPI metric cards.",
    blocks: [{ type: "kpis", w: 6, props: { ...JSON.parse(JSON.stringify(DEFAULTS.kpis.props)) } }],
  },
  {
    id: "tpl-access",
    name: "Process + Quick Access (3:1)",
    desc: "A ¾-width process column beside a ¼-width credentials sidebar with stacked access cards.",
    blocks: [
      { type: "text", w: 9, props: { body: "Document the process here. This column takes ¾ of the row; the access column on the right holds the quick important details." } },
      {
        type: "access", w: 1, props: {
          heading: "Universal Access Information",
          cards: [
            { title: "Supabase Access", items: [{ label: "User ID", value: "" }, { label: "Password", value: "" }] },
            { title: "Tool 2", items: [{ label: "User ID", value: "" }, { label: "Password", value: "" }] },
            { title: "Tool 3", items: [{ label: "User ID", value: "" }, { label: "Password", value: "" }] },
          ],
        },
      },
    ],
  },
  {
    id: "tpl-chart",
    name: "Chart + Notes",
    desc: "A chart beside an explanatory text block.",
    blocks: [
      { type: "chart", w: 3, props: { ...JSON.parse(JSON.stringify(DEFAULTS.chart.props)) } },
      { type: "text", w: 3, props: { body: "Use this space to explain what the chart shows and why it matters." } },
    ],
  },
];

const copy = (o) => JSON.parse(JSON.stringify(o));
const accessCard = (title) => ({ title, items: [{ label: "User ID", value: "" }, { label: "Password", value: "" }] });

// Shared tail templates (stats row + chart beside notes) built from a
// workspace's defaults.
function commonTemplates(defs) {
  return [
    {
      id: "tpl-stats",
      name: "Stats Row",
      desc: "A row of KPI metric cards.",
      blocks: [{ type: "kpis", w: 6, props: copy(defs.kpis.props) }],
    },
    {
      id: "tpl-chart",
      name: "Chart + Notes",
      desc: "A chart beside an explanatory text block.",
      blocks: [
        { type: "chart", w: 3, props: copy(defs.chart.props) },
        { type: "text", w: 3, props: { body: "Use this space to explain what the chart shows and why it matters." } },
      ],
    },
  ];
}

// ── Operations templates ─────────────────────────────────────────────────────
const OPS_TEMPLATES = [
  {
    id: "tpl-banner",
    name: "Page Banner",
    desc: "A bold gradient header with title and subtitle.",
    blocks: [{ type: "banner", w: 6, props: { ...OPS_DEFAULTS.banner.props } }],
  },
  {
    id: "tpl-kpi",
    name: "KPI Targets",
    desc: "Heading + target stats + a quality chart with notes.",
    blocks: [
      { type: "heading", w: 6, props: { text: "Performance Targets", icon: "kpi" } },
      { type: "kpis", w: 6, props: copy(OPS_DEFAULTS.kpis.props) },
      { type: "chart", w: 3, props: copy(OPS_DEFAULTS.chart.props) },
      { type: "text", w: 3, props: { body: "How targets are measured:\n• Service level and handle time come from the daily dialer reports.\n• QA scores come from weekly, calibrated call evaluations.\n\nReview the numbers at every pre-shift huddle and coach to the gaps." } },
    ],
  },
  {
    id: "tpl-policies",
    name: "Floor Policies",
    desc: "Heading + three policy cards for the contact-center floor.",
    blocks: [
      { type: "heading", w: 6, props: { text: "Floor Policies", icon: "layers" } },
      { type: "cardgrid", w: 6, props: copy(OPS_DEFAULTS.cardgrid.props) },
    ],
  },
  {
    id: "tpl-sop",
    name: "Operating Procedures",
    desc: "Heading + a 2×2 grid of procedure cards.",
    blocks: [
      { type: "heading", w: 6, props: { text: "Standard Operating Procedures", icon: "steps" } },
      {
        type: "cardgrid", w: 6, props: {
          columns: [
            { icon: "callout", title: "Call Handling", body: "Greet, verify, resolve and summarize — follow the approved script for each account." },
            { icon: "steps", title: "Escalations", body: "Follow the escalation path and log every escalation with its case number." },
            { icon: "timeline", title: "Breaks & Schedules", body: "Take breaks as scheduled; clear any change with your Team Lead and WFM first." },
            { icon: "lock", title: "Security", body: "Lock your screen when you step away and report anything suspicious immediately." },
          ],
        },
      },
    ],
  },
  {
    id: "tpl-escalation",
    name: "Escalation Path",
    desc: "Heading + numbered escalation steps.",
    blocks: [
      { type: "heading", w: 6, props: { text: "Escalation Path", icon: "callout" } },
      { type: "steps", w: 6, props: copy(OPS_DEFAULTS.steps.props) },
    ],
  },
  {
    id: "tpl-shift",
    name: "Shift Flow",
    desc: "Heading + the shift timeline + a reminder.",
    blocks: [
      { type: "heading", w: 6, props: { text: "Daily Shift Flow", icon: "timeline" } },
      { type: "timeline", w: 6, props: copy(OPS_DEFAULTS.timeline.props) },
      { type: "callout", w: 6, props: { ...OPS_DEFAULTS.callout.props } },
    ],
  },
  {
    id: "tpl-handover",
    name: "Shift Handover",
    desc: "A handover checklist beside notes on what to include.",
    blocks: [
      { type: "heading", w: 6, props: { text: "Shift Handover", icon: "check" } },
      { type: "checklist", w: 3, props: copy(OPS_DEFAULTS.checklist.props) },
      { type: "text", w: 3, props: { body: "A good handover note covers:\n• Open escalations and who owns them\n• Absences, late logins and coverage gaps\n• System issues or downtime, with ticket numbers\n• Client updates the next shift must know" } },
    ],
  },
  {
    id: "tpl-onboarding",
    name: "New Hire Onboarding",
    desc: "Heading + a week-by-week onboarding timeline.",
    blocks: [
      { type: "heading", w: 6, props: { text: "New Hire Onboarding", icon: "timeline" } },
      {
        type: "timeline", w: 6, props: {
          items: [
            { title: "Week 1 — Orientation & Product", desc: "Company policies, the client's products and services, and the customer journey." },
            { title: "Week 2 — Systems & Process", desc: "Hands-on with the dialer, CRM and ticketing tools; call flows and the escalation path." },
            { title: "Week 3 — Nesting", desc: "Live calls with a buddy and floor support close by; daily QA feedback." },
            { title: "Week 4 — Production", desc: "Join the live floor; first QA calibration and a 30-day check-in with the Team Lead." },
          ],
        },
      },
    ],
  },
  {
    id: "tpl-access",
    name: "Process + Quick Access (3:1)",
    desc: "A ¾-width process column beside a ¼-width tools & access sidebar.",
    blocks: [
      { type: "text", w: 9, props: { body: "Document the process here. This column takes ¾ of the row; the access column on the right holds the quick important details." } },
      {
        type: "access", w: 1, props: {
          heading: "Tools & Access",
          cards: [accessCard("Dialer / Phone System"), accessCard("CRM"), accessCard("Ticketing / Helpdesk")],
        },
      },
    ],
  },
  ...commonTemplates(OPS_DEFAULTS),
];

// ── Executives templates ─────────────────────────────────────────────────────
const EXEC_TEMPLATES = [
  {
    id: "tpl-banner",
    name: "Page Banner",
    desc: "A bold gradient header with title and subtitle.",
    blocks: [{ type: "banner", w: 6, props: { ...EXEC_DEFAULTS.banner.props } }],
  },
  {
    id: "tpl-okrs",
    name: "OKRs & Targets",
    desc: "Heading + target stats + an OKR progress chart with notes.",
    blocks: [
      { type: "heading", w: 6, props: { text: "Objectives & Key Results", icon: "kpi" } },
      { type: "kpis", w: 6, props: copy(EXEC_DEFAULTS.kpis.props) },
      { type: "chart", w: 3, props: copy(EXEC_DEFAULTS.chart.props) },
      { type: "text", w: 3, props: { body: "Each objective has one accountable executive and two to four measurable key results.\n\nProgress is updated before every monthly business review; anything under 50% at mid-quarter gets a recovery plan." } },
    ],
  },
  {
    id: "tpl-governance",
    name: "Governance & Decision Rights",
    desc: "Heading + a 2×2 grid of who decides what.",
    blocks: [
      { type: "heading", w: 6, props: { text: "Governance & Decision Rights", icon: "layers" } },
      {
        type: "cardgrid", w: 6, props: {
          columns: [
            ...copy(EXEC_DEFAULTS.cardgrid.props.columns),
            { icon: "cardgrid", title: "Client Contracts", body: "Contracts above the approval threshold need executive sign-off before they're signed." },
          ],
        },
      },
    ],
  },
  {
    id: "tpl-cadence",
    name: "Meeting Cadence",
    desc: "Heading + the leadership meeting rhythm + a reminder.",
    blocks: [
      { type: "heading", w: 6, props: { text: "Meeting Cadence", icon: "timeline" } },
      { type: "timeline", w: 6, props: copy(EXEC_DEFAULTS.timeline.props) },
      { type: "callout", w: 6, props: { ...EXEC_DEFAULTS.callout.props } },
    ],
  },
  {
    id: "tpl-approval",
    name: "Approval Process",
    desc: "Heading + approval steps + a checklist beside the thresholds.",
    blocks: [
      { type: "heading", w: 6, props: { text: "Approval Process", icon: "steps" } },
      { type: "steps", w: 6, props: copy(EXEC_DEFAULTS.steps.props) },
      { type: "checklist", w: 3, props: copy(EXEC_DEFAULTS.checklist.props) },
      { type: "text", w: 3, props: { body: "Who approves:\n• Within a department's budget — the department head\n• Over budget or new headcount — the executive team\n• Strategic or contractual commitments — the CEO" } },
    ],
  },
  {
    id: "tpl-decisions",
    name: "Decision Log",
    desc: "Heading + a dated log of decisions + a reminder.",
    blocks: [
      { type: "heading", w: 6, props: { text: "Decision Log", icon: "book" } },
      {
        type: "timeline", w: 6, props: {
          items: [
            { title: "Date — Decision title", desc: "What was decided and why. Decided by: … Owner: … Review on: …" },
            { title: "Date — Decision title", desc: "Add each decision with its date, the owner, and the reasoning behind it." },
          ],
        },
      },
      { type: "callout", w: 6, props: { ...EXEC_DEFAULTS.callout.props } },
    ],
  },
  {
    id: "tpl-contacts",
    name: "Key Contacts",
    desc: "Heading + cards for the people to reach.",
    blocks: [
      { type: "heading", w: 6, props: { text: "Key Contacts", icon: "book" } },
      {
        type: "cardgrid", w: 6, props: {
          columns: [
            { icon: "layers", title: "Chief Executive Officer", body: "Name\nEmail · Phone" },
            { icon: "steps", title: "Operations Head", body: "Name\nEmail · Phone" },
            { icon: "kpi", title: "Finance Head", body: "Name\nEmail · Phone" },
            { icon: "callout", title: "HR Head", body: "Name\nEmail · Phone" },
          ],
        },
      },
    ],
  },
  {
    id: "tpl-access",
    name: "Process + Quick Access (3:1)",
    desc: "A ¾-width process column beside a ¼-width tools & access sidebar.",
    blocks: [
      { type: "text", w: 9, props: { body: "Document the process here. This column takes ¾ of the row; the access column on the right holds the quick important details." } },
      {
        type: "access", w: 1, props: {
          heading: "Tools & Access",
          cards: [accessCard("Board Portal"), accessCard("Finance System"), accessCard("Reporting Dashboard")],
        },
      },
    ],
  },
  ...commonTemplates(EXEC_DEFAULTS),
];

/** The template palette for this workspace. */
export function templatesFor(ws) {
  const key = contentKey(ws);
  return key === "operations" ? OPS_TEMPLATES : key === "executives" ? EXEC_TEMPLATES : TEMPLATES;
}

export function cloneTemplate(tpl) {
  return tpl.blocks.map((b) => ({
    id: uid(),
    type: b.type,
    w: b.w,
    props: JSON.parse(JSON.stringify(b.props)),
    ...(b.col ? { col: b.col } : {}),
  }));
}

// A complete starter handbook resembling the reference design.
export function STARTER_BLOCKS() {
  return [
    ...cloneTemplate(TEMPLATES.find((t) => t.id === "tpl-banner")),
    ...cloneTemplate(TEMPLATES.find((t) => t.id === "tpl-techstack")),
    ...cloneTemplate(TEMPLATES.find((t) => t.id === "tpl-sop")),
    ...cloneTemplate(TEMPLATES.find((t) => t.id === "tpl-daily")),
    ...cloneTemplate(TEMPLATES.find((t) => t.id === "tpl-roadblock")),
  ];
}

const fromTemplates = (list, ids) => ids.flatMap((id) => cloneTemplate(list.find((t) => t.id === id)));
// Starter-layout blocks that live in the right-hand column.
const sideBlocks = (blocks) => cloneTemplate({ blocks: blocks.map((b) => ({ ...b, col: "side" })) });

/** A complete starter handbook in this workspace's language. */
export function starterBlocksFor(ws) {
  const key = contentKey(ws);
  if (key === "operations") {
    return [
      ...fromTemplates(OPS_TEMPLATES, ["tpl-banner", "tpl-kpi", "tpl-policies", "tpl-sop", "tpl-escalation", "tpl-shift", "tpl-onboarding"]),
      ...sideBlocks([
        { type: "access", w: 1, props: { heading: "Tools & Access", cards: [accessCard("Dialer / Phone System"), accessCard("CRM"), accessCard("Ticketing / Helpdesk")] } },
        { type: "checklist", w: 3, props: copy(OPS_DEFAULTS.checklist.props) },
        { type: "quote", w: 6, props: { ...OPS_DEFAULTS.quote.props } },
      ]),
    ];
  }
  if (key === "executives") {
    return [
      ...fromTemplates(EXEC_TEMPLATES, ["tpl-banner", "tpl-okrs", "tpl-governance", "tpl-cadence", "tpl-approval", "tpl-decisions"]),
      ...sideBlocks([
        { type: "heading", w: 6, props: { text: "Key Contacts", icon: "book" } },
        { type: "cardgrid", w: 6, props: copy(EXEC_TEMPLATES.find((t) => t.id === "tpl-contacts").blocks[1].props) },
        { type: "quote", w: 6, props: { ...EXEC_DEFAULTS.quote.props } },
      ]),
    ];
  }
  return STARTER_BLOCKS();
}
