/**
 * Handbook block model, palette definitions, and ready-made layout templates.
 *
 * A block is: { id, type, w, props }
 *   - w: column span in the 6-column grid (2 = third, 3 = half, 4 = two-thirds, 6 = full)
 *   - props: type-specific content
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
};

export function makeBlock(type) {
  const def = DEFAULTS[type] || DEFAULTS.text;
  return {
    id: uid(),
    type: DEFAULTS[type] ? type : "text",
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
    id: "tpl-chart",
    name: "Chart + Notes",
    desc: "A chart beside an explanatory text block.",
    blocks: [
      { type: "chart", w: 3, props: { ...JSON.parse(JSON.stringify(DEFAULTS.chart.props)) } },
      { type: "text", w: 3, props: { body: "Use this space to explain what the chart shows and why it matters." } },
    ],
  },
];

export function cloneTemplate(tpl) {
  return tpl.blocks.map((b) => ({
    id: uid(),
    type: b.type,
    w: b.w,
    props: JSON.parse(JSON.stringify(b.props)),
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
