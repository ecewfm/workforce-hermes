import { useConvex, useQuery } from "../data/react";
import { api } from "../data/api";
import { useWorkspace } from "./workspaceContext";
import { isAdminPlusOrAbove } from "./roles";
import { DAY_MS, getProjectDeadlines } from "./deadlines";
import { resolveColumns, taskInColumn } from "./columns";
import { WORKSPACE_META } from "./departments";
import { ENABLE_WEB_SEARCH } from "./aiConfig";
import { fallbackMilestonesFor, withTemplateHints } from "./defaults";
import { isTechWorkspace, usesAccounts } from "./workspaceTerms";
import { planTask } from "./taskPlanner";
import { buildKnowledgeBrief, searchKnowledge } from "./sopKnowledge";

// Display date string matching how the rest of the app stamps notes/ideas.
function estNow() {
  return new Date().toLocaleString("en-US", {
    timeZone: "America/New_York",
    year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

// A project's deadline as the board shows it, for Caddy: the due date and
// whether it's overdue (closed and never-started projects have no countdown).
function deadlineFacts(t) {
  const st = String(t.status || "").toLowerCase();
  if (["done", "implemented", "scrapped", "scrapyard"].includes(st)) return {};
  const dl = getProjectDeadlines(t);
  if (!dl) return { deadline: st === "todo" ? "not started yet (the countdown starts when work begins)" : "none set" };
  if (dl.complete) return { deadline: "all milestones complete" };
  const days = Math.floor((dl.completionDue - Date.now()) / DAY_MS);
  return {
    dueDate: new Date(dl.completionDue).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
    deadline: days < 0 ? `OVERDUE by ${-days} day${-days === 1 ? "" : "s"}` : days === 0 ? "due today" : `due in ${days} day${days === 1 ? "" : "s"}`,
    ...(dl.activeName ? { currentMilestone: dl.activeName } : {}),
  };
}

function genId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

// Trim long free-text so a multi-project update payload stays reasonable while
// still giving the assistant the actual substance to explain (not just counts).
function trunc(s, n = 260) {
  const str = String(s || "").trim();
  return str.length > n ? `${str.slice(0, n - 1)}…` : str;
}

// ─────────────────────────────────────────────────────────────────────────────
// APP GUIDE — what Caddy knows about where things live in Hermes, so
// it can answer "where do I…" questions and guide users instead of guessing.
// ⚠️ KEEP THIS UPDATED: whenever we ship a user-facing feature, add a line here
// (and add a tool below if Caddy should DO it, not just explain where it is).
// ─────────────────────────────────────────────────────────────────────────────
const APP_GUIDE = `WHERE THINGS LIVE in Hermes (use this to answer "where do I…" and guide users; never invent settings that don't exist):
• Settings → Workspace Defaults (Admin+): the milestone template for new projects, the workspace's target date (Workforce: the "Full Production Deadline"; Operations/Executives: the "Key Target Date" — shown on the Overview, which Admins and above see), the Kanban board columns, and the WORKSPACE PASSWORD — set/change/remove the password required to enter this workspace (blank = open). It's per-workspace, so it's set from inside the workspace being protected.
• Settings → Staff Management (Admin+): one list of everyone with all their access on their own row — their role (the "Access Type" select), the workspaces they can open (the Workforce / Operations / Executives chips = Department Membership; lit = has access; only Managers can change them, never their own), in Operations their client accounts, plus Reset PW and Revoke. A user reaches exactly the workspaces lit for them. The "Programmer" access type is called "User" outside Workforce — same access; Admin, Admin+ and Manager keep their names. Pending access requests and "Add New Staff Member" are on the same screen.
• Settings → General Preferences: the Caddy on/off switch (off also removes the "Plan with AI" step from New Task), the Default View (the screen that opens first — Admins and above only; Programmers/Users always open on the board) and the "Motion & Fun Effects" toggles. Appearance & UI (theme, accent colour, font size) is saved per device and applies in every workspace.
• Settings → Account & Profile: change your own password (you'll need your current one), set your security question (used for "Forgot Password?" on the sign-in screen), and edit your profile. Your sign-in email is read-only there — an Admin+ or Manager changes it. Admin+ can reset someone else's password in Staff Management; that person then sets a new one at their next sign-in.
• Settings no longer has "Delete Account", "Open on startup", "Start minimized" or "Notify me on errors/updates" — those were removed, so don't send anyone looking for them.
• Projects/Kanban, the notebook, announcements, and the handbook are each per-workspace; switch workspaces from the header title (a password may be required).
• Announcements (Admin+ and Managers) live in Settings → Announcements — there is no ANNOUNCEMENTS button in the navigation any more. Write a title and a message (bold, italics, underline, bullet lists); "Preview" shows exactly how it will pop up; "Post announcement" sends it to everyone in THIS workspace (it pops up once per person — right away if they're online, otherwise the next time they open Hermes). Below the editor is everything posted in this workspace with how many people have seen each one; click one to see who has read it, or the bin icon to delete it.
• The Notebook (NOTEBOOK in the nav) shows ideas as cards with search, sort (newest, oldest, A–Z) and an All/Open/Taken filter (Taken only appears while older taken ideas are still listed). Clicking a card grows it into a big sheet: what it does, further details, and the pros and cons side by side (numbered lines like "1. Faster" start a point and the lines under them become its details). "Take this idea" is in that sheet (Workforce: the Programmer view; Operations/Executives: anyone) — it asks for a start date and turns the idea into a project assigned to the taker, which leaves the notebook. In the Admin view, "+ New idea" opens a form (name, what it does, pros, cons, further details; Ctrl+Enter saves) and Delete is in the idea's sheet.
• The task modal (click a project card): every milestone can show its meaning right under its name — what the step is, or "Done when: …" for an AI-planned step. AI-planned projects also keep the plan's "Watch out for" list (the risks) and its "Assumptions" in the task modal; both are editable there. In Workforce the left sidebar holds Features and Bug Reports, and Admins find System Links, API Access and the project's Admin login behind the round "⋯" button at the top right of the modal (next to Delete Task) — tucked away there to keep the milestones roomy. Adding or opening a feature, bug or roadblock opens a large two-panel sheet (colour-coded: features in the app colour, bugs rose, roadblocks amber) with tips, up to 3 images (click a slot or drag images onto it), and Esc closes it. In Operations and Executives the sidebar is one "Roadblocks" list — anything blocking progress: add one, mark it cleared, edit or delete it — and "Documents" replaces System Links (add any number of named links, e.g. an SOP, a deck or a sheet). API Access and project Admin Credentials only exist in Workforce.
• Project Admin Credentials (Workforce): revealing a project's admin login asks for YOUR OWN account password — there's no shared master password.
• Operations — Account Knowledge (Settings → Account Knowledge): each client account has notes for the AI (an always-editable text area — who signs off, client rules, tools, SLAs, blackout dates) and SOP documents (upload Word .docx, PDF up to 3 MB, .txt or .md — or "Write one" to type an SOP in Hermes). The AI reads each SOP once and keeps a summary (its procedure, sign-offs, timelines, tools, roles, rules and watch-outs); open a document to see that summary, fix the extracted text (saving makes the AI read it again), download the original, or delete it (Admins and above, or whoever added it). Anyone on an account can add and edit its knowledge. When someone plans a project for an account (New Task's planner has a Client account picker; or create_project with an account), the AI plans from that account's SOPs and notes, and the plan says which SOPs it was "Built from". You can look things up in an account's SOPs with search_account_sops.
• Operations — client Accounts: each project can belong to a client account. The board has an account filter bar (pick an account to see just its projects), the Overview shows projects per account, and New Task and the task modal each have an Account picker — Admin+ can create a new account right from it ("+ New account…"). The full list lives in Settings → Client Accounts (its own tab, Operations only): Admin+ and Managers add, rename and delete accounts there; everyone else sees the list read-only. Deleting an account doesn't delete its projects; they just have no account. People are put on accounts in Settings → Staff Management (the client-accounts picker on each Operations person's row; Admin+ and Managers set it, from any workspace as long as they can open Operations). Users and Admins only see — and can only work on — the projects of the accounts they're on (being assigned to a project in another account doesn't open it); their new projects must go in one of their accounts. Someone below Admin+ with NO account has no access to Operations projects at all (the board says so, and they can't start a project) until they're added to one — their other workspaces (e.g. Workforce) are unaffected. Admin+ and Managers always see everything. Account controls (the board's account bar, the account on cards, the Account pickers, the Client Accounts tab) only show for Admin+/Managers — or for someone tied to SEVERAL accounts, and then only their accounts; with one account (or none) they're hidden and new projects use that one account. Approving a pending access request from a workspace makes the person a member of that workspace.
• New Task is AI-first: it opens on a "Plan a new task" step. The person describes what they're planning (one-click example briefs help) and MUST pick a start date and a deadline before the AI plans (the button stays off until both are set) — the AI then lays out the steps to finish by that deadline, and every step on the plan shows its due date (red if it would land after the deadline). The AI thinks it through — its reasoning shows live as a step list — then streams in a plan tailored to how THIS workspace's department works (Workforce = software delivery; Operations = classified by project type, e.g. campaign launch, SOP change, KPI improvement, tool rollout, training, scheduling change, with sign-offs, a pilot, training and post-go-live monitoring built in; Executives = analysis→proposal→approval→oversight). The plan shows project type, size, a goal, a timeline bar with the finish date, assumptions and risks, and every milestone has a "done when". Everything is editable right there (rename, change days, reorder, add, remove); quick chips or a typed note ("it's only one site") refine it. "Use this plan →" opens the details step (assignees, start date, editable milestones) to create the task.
• "Skip AI" on New Task starts from the workspace's DEFAULT milestones (also used when Caddy is off). Operations' built-in default is a general 8-step, 56-day template that fits any operations project: Scope & Goals (5d) → Plan & Design (7d) → Review & Sign-off (3d) → Prepare & Set Up (7d) → Pilot / Test Run (10d) → Train & Communicate (5d) → Go-Live / Full Rollout (5d) → Monitor & Hand Over (14d). Executives has its own 7-step, 53-day default: Situation & Data Review (7d) → Options & Recommendation (7d) → Stakeholder Alignment (5d) → Decision & Approval (3d) → Launch & Delegate (5d) → Oversight & Check-ins (21d) → Results Review & Close-out (5d). Workforce's is a 10-step software-delivery template. Each built-in Operations/Executives step comes with a short meaning that shows under it in the task. Admin+ can change any workspace's default in Settings → Workspace Defaults ("Restore Original" brings the built-in one back).
• New Task's details step ("Final touches"): the expected deadline (start date + every milestone's days, assuming work starts that day) shows right under the start date, each milestone row shows its due date, and the right side is a live Review of the whole project (title, deadline, assignees, account, documents, milestones with due dates, watch-outs) with the Create Task button at the bottom — it lists anything still missing.
• Start dates are REQUIRED for every project (New Task — the AI planner won't continue without one —, Caddy's create_project, and taking a notebook idea, which asks for one). A project whose start date is today or earlier goes straight to Pending when it's created; a later one waits in To Do and moves to Pending by itself on its start date (Manila time, within ~10 minutes of midnight). Only never-started projects move automatically — one dragged back to To Do on purpose stays there.
• Deadlines in New Task: the person sets the DEADLINE themselves (required, next to the start date) and the milestones are the steps to reach it. The AI planner plans to that deadline; if the steps add up to more (or fewer) days than start→deadline, New Task says so and offers "Fit the steps to the deadline" (scales the days to fit) or, on the plan page, "Ask AI to re-plan for it". Steps that would land after the deadline show their due date in red. The deadline is saved as the project's pinned completion deadline. Any sentence on the plan/review (title, description, goal, a step's "done when", watch-outs, assumptions, milestone names) can be edited by double-clicking it.
• Cliq reminders: every weekday at 9:00 AM (Manila) Hermes sends a Zoho Cliq message from the Workforce Management account. Each project owner (assignee) gets their projects that are overdue or due within the next 3 days; each Manager also gets every overdue project in the workspaces they belong to (managers aren't sent the nearly-due ones). One message per person per day, nothing if there's nothing late, with buttons that open each project straight in Hermes. Admin+ and Managers can switch them off for everyone (all workspaces) in Settings → Notifications → "Cliq reminders for late projects"; it saves the moment it's flipped and shows when they were last sent. To stop getting them for a project, finish or update the project (complete milestones, or move the deadline if the plan changed). People are matched to Cliq by their sign-in email or their name; if someone gets nothing although they have late projects, an admin should check their name matches their Cliq name.
• Deadline clock: a project's countdown starts the first time it leaves To Do (e.g. moved to Pending). After that it keeps running — moving it back to To Do does NOT pause or reset it. A project that has never left To Do has no countdown yet ("Starts when work begins").
• You (Caddy) can also act on the screen: open a project's card, take the person to a screen (board, overview, new task, notebook, announcements — which opens Settings on its Announcements tab —, handbook, settings, project links — called Project Documents outside Workforce), or open the New Task planner with their idea already filled in and planning started.
• Clicking a project card morphs that card into the task modal — it keeps the card's shape and content as it grows to the centre, while the board zooms toward it — and closing shrinks it back into the card's spot. That's the intended animation, not a glitch; the board zoom follows the "Camera follows the cursor" toggle. While a big task's notes and features (or roadblocks) load, those lists show soft placeholder rows for a moment. Same for the robotic touches: the cursor is a robotic hand that grips when you click, a robotic arm reaches for your cursor on the navigation buttons, and the view gently pans toward the pointer like a camera — deliberate fun, not glitches. Each can be turned on/off under Settings → General Preferences → "Motion & Fun Effects".
• The rest of the app moves more too: notifications, the handbook, the header buttons, search and profile pop-ups animate as they open and close. That's intentional, not lag or a glitch.
• Clicking a column count at the top of the board (e.g. "6 In Development") gathers that column's cards to the front over a blurred board; click a card to open it, or press Esc / click outside to send them back. Picking a workspace makes its card fly to the centre and swell to fill the screen as the new workspace opens.
• Every dropdown and date field is the app's own (not the browser's): dropdowns open a small list (type to jump, arrows + Enter work), and dates open a calendar with quick picks (Today, Tomorrow, Next week, In 30 days) and Clear where a date is optional.
If you're unsure where something is, say it's most likely under Settings and point them there — never claim a real feature doesn't exist.`;

// ── Gemini function-declaration schemas ─────────────────────────────────────
// Built per workspace so the tools speak its language: Workforce (the
// programming team) adds features and logs bugs; Operations/Executives flag
// roadblocks instead. The status example uses the workspace's real column
// labels, and Operations' create_project takes a client account.
function buildTools({ tech, accounts, columnLabels = [], accountNames = [] }) {
  const recentItems = tech
    ? "new features, new bugs"
    : "new roadblocks (and whether each is open or cleared)";
  const recentItemsDetail = tech
    ? "the new features (name + description), the new bugs (name + description)"
    : "the new roadblocks (name + description + open/cleared)";
  const itemTools = tech
    ? [
      {
        name: "add_feature",
        description: "Add a feature request to an existing project.",
        parameters: {
          type: "object",
          properties: {
            project_name: { type: "string" },
            name: { type: "string", description: "Feature title." },
            description: { type: "string", description: "Feature details." },
          },
          required: ["project_name", "name"],
        },
      },
      {
        name: "add_bug",
        description: "Log a bug on an existing project.",
        parameters: {
          type: "object",
          properties: {
            project_name: { type: "string" },
            name: { type: "string", description: "Short bug title." },
            description: { type: "string", description: "What's wrong / how to reproduce." },
          },
          required: ["project_name", "name"],
        },
      },
    ]
    : [
      {
        name: "add_roadblock",
        description: "Flag a roadblock — something blocking progress on a project (waiting on a sign-off, missing access or data, a client or vendor delay, a staffing gap…). It's added to the project's Roadblocks list as open.",
        parameters: {
          type: "object",
          properties: {
            project_name: { type: "string" },
            name: { type: "string", description: "Short title of what's blocking progress." },
            description: { type: "string", description: "What's blocked, who can unblock it, and what's needed." },
          },
          required: ["project_name", "name"],
        },
      },
    ];

  return [
    {
      name: "list_projects",
      description: `List the projects (tasks) in the current workspace with their status, assignee${accounts ? ", client account" : ""}, progress and deadline (due date, days left, or how many days overdue — the same countdown the board shows). Use this to find the exact project name before acting on one, and to answer which projects are overdue, due soon or on track.`,
      parameters: { type: "object", properties: {} },
    },
    {
      name: "get_project_updates",
      description: `Summarize recent activity for ONE named project: notes/updates, ${recentItems}, and milestones completed within the last N days.`,
      parameters: {
        type: "object",
        properties: {
          project_name: { type: "string", description: "The project/task name (fuzzy match is fine)." },
          days: { type: "integer", description: "How many days back to include. Default 7." },
        },
        required: ["project_name"],
      },
    },
    {
      name: "get_recent_updates",
      description: `Get recent activity across ALL projects in the workspace in ONE call — for each project it returns the ACTUAL note texts, ${recentItemsDetail}, and milestones completed within the last N days, newest first. Use this for questions like 'what has updates?', 'what's the latest?', or 'which projects moved this week?' — do NOT call get_project_updates repeatedly for this. Read the returned text and EXPLAIN what changed; never just report counts.`,
      parameters: {
        type: "object",
        properties: { days: { type: "integer", description: "How many days back to include. Default 7." } },
      },
    },
    {
      name: "create_project",
      description: `Create a new project (task) RIGHT AWAY. Milestones are planned automatically by the AI planner for this workspace's department (falls back to the workspace's default template). ALWAYS include a helpful \`description\` you compose yourself — never leave it blank or just repeat the title. A START DATE IS REQUIRED: if the person didn't say when it starts, ASK them before calling this (today is ${new Date().toLocaleDateString("en-CA")}; convert "today", "tomorrow", "next Monday"… to YYYY-MM-DD). A project whose start date is today or earlier goes straight to Pending (its clock starts); a later one waits in To Do and moves to Pending on that date by itself. Defaults the assignee to the current user unless another person's name is given. If the person wants to review or shape the plan first, use plan_new_task instead.`,
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Project title." },
          description: { type: "string", description: "A clear 1–3 sentence description of what this project involves and its goal. Required — write it yourself from the title, context, and (if the term/tool is unfamiliar) web research." },
          start_date: { type: "string", description: "Start date, YYYY-MM-DD. Required — ask for it if you don't know it." },
          deadline: { type: "string", description: "The date it must be done by, YYYY-MM-DD, if the person gave one (ask if it matters to them). The milestones are then planned as the steps to reach it." },
          assignee: { type: "string", description: "Optional assignee full name. Defaults to the current user." },
          ...(accounts ? {
            account: {
              type: "string",
              description: `Optional client account this project belongs to — only when the person names one (use the account's exact name).${accountNames.length ? ` This workspace's accounts: ${accountNames.join(", ")}.` : ""}`,
            },
          } : {}),
        },
        required: ["title", "description", "start_date"],
      },
    },
    {
      name: "set_project_description",
      description: "Set or replace the description of an EXISTING project. Use this whenever asked to add / update / fix a project's description. NEVER use add_note for a description.",
      parameters: {
        type: "object",
        properties: {
          project_name: { type: "string", description: "The project/task name (fuzzy match ok)." },
          description: { type: "string", description: "The new 1–3 sentence project description." },
        },
        required: ["project_name", "description"],
      },
    },
    {
      name: "add_notebook_idea",
      description: "Add an idea to the workspace notebook.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Short title of the idea." },
          description: { type: "string", description: "Details of the idea." },
          pros: { type: "string", description: "Optional pros." },
          cons: { type: "string", description: "Optional cons." },
        },
        required: ["name"],
      },
    },
    {
      name: "add_note",
      description: "Post a note / status update on an existing project.",
      parameters: {
        type: "object",
        properties: {
          project_name: { type: "string", description: "The project/task name (fuzzy match ok)." },
          note: { type: "string", description: "The update text." },
        },
        required: ["project_name", "note"],
      },
    },
    ...itemTools,
    ...(accounts ? [{
      name: "search_account_sops",
      description: "Look things up in a client account's knowledge: its SOPs and the team's notes (Settings → Account Knowledge). Use it whenever someone asks how an account does something, what its process / SLA / sign-off / rule is, or wants advice that should follow that account's way of working. Returns the account's notes, each SOP's summary, and the passages that best match the question — answer from those, name the SOP you're quoting, and say so plainly if they don't cover it.",
      parameters: {
        type: "object",
        properties: {
          account: { type: "string", description: `The client account's name.${accountNames.length ? ` This workspace's accounts: ${accountNames.join(", ")}.` : ""} Optional when the person is only on one account.` },
          question: { type: "string", description: "What to look up, in the person's words." },
        },
        required: ["question"],
      },
    }] : []),
    {
      name: "set_project_status",
      description: "Move a project to a different board column/status in the current workspace.",
      parameters: {
        type: "object",
        properties: {
          project_name: { type: "string" },
          status: {
            type: "string",
            description: columnLabels.length
              ? `Target column name — this workspace's columns are: ${columnLabels.map((l) => `'${l}'`).join(", ")}.`
              : "Target column name or status (e.g. 'To Do', 'Done').",
          },
        },
        required: ["project_name", "status"],
      },
    },
    {
      name: "set_production_deadline",
      description: `Manager only: set this workspace's ${tech ? "full-production deadline" : "Key Target Date (the date its main initiative should be complete)"}. Date must be YYYY-MM-DD.`,
      parameters: {
        type: "object",
        properties: { date: { type: "string", description: "Deadline date as YYYY-MM-DD." } },
        required: ["date"],
      },
    },
    {
      name: "plan_new_task",
      description: `Open the New Task planner ON SCREEN with this brief filled in, so the person can watch the AI think, then review, edit and refine the plan before creating the task. Prefer this whenever someone wants to plan / scope / get milestones for a new task. The planner needs a START DATE and a DEADLINE before it plans (the milestones are the steps to reach the deadline): pass both when you know them (today is ${new Date().toLocaleDateString("en-CA")}; convert "next Monday", "end of the month"… to YYYY-MM-DD) and it starts planning at once; without them it opens with the brief filled in and asks the person to pick the dates on screen.`,
      parameters: {
        type: "object",
        properties: {
          brief: { type: "string", description: "A clear description of the task in the person's own terms: what needs to happen, scale (teams, sites, headcount), constraints, deadlines." },
          start_date: { type: "string", description: "Start date, YYYY-MM-DD, if known." },
          deadline: { type: "string", description: "The date it must be done by, YYYY-MM-DD (on or after the start date), if known." },
        },
        required: ["brief"],
      },
    },
    {
      name: "open_project",
      description: "Open an existing project's card (its full task view) on screen.",
      parameters: {
        type: "object",
        properties: { project_name: { type: "string", description: "The project/task name (fuzzy match ok)." } },
        required: ["project_name"],
      },
    },
    {
      name: "go_to",
      description: "Take the person to a screen in the app.",
      parameters: {
        type: "object",
        properties: {
          place: {
            type: "string",
            enum: ["board", "overview", "new_task", "notebook", "announcements", "handbook", "settings", "project_links"],
            description: `board = the Kanban project board (labelled DASHBOARD in the nav); overview = the admin OVERVIEW stats page; announcements = Settings → Announcements (Admin+ and Managers); project_links = every project's ${tech ? "links (Project Links)" : "documents (Project Documents)"}.`,
          },
        },
        required: ["place"],
      },
    },
  ];
}

/**
 * Hook that wires the AI tools to Convex for the current user + workspace.
 * Returns { tools, executeTool, systemInstruction }.
 */
export function useAiActions({ userName, userEmail, actualRole, uiActions }) {
  const convex = useConvex();
  const workspace = useWorkspace();
  const isManager = isAdminPlusOrAbove(actualRole);
  const wsLabel = WORKSPACE_META?.[workspace]?.label || workspace;
  // Workforce speaks features & bugs; Operations/Executives speak roadblocks.
  const tech = isTechWorkspace(workspace);
  const accounts = usesAccounts(workspace);
  // Only used to word the tool descriptions (real column labels, known account
  // names) — the board already loads both, so these are usually cached.
  const liveConfig = useQuery(api.appConfig.getAppConfig, { workspace });
  const liveAccounts = useQuery(api.accounts.getAccounts, accounts ? { workspace } : "skip");
  const liveColumns = resolveColumns(liveConfig?.columns, workspace);
  const tools = buildTools({
    tech,
    accounts,
    columnLabels: liveColumns.map((c) => c.label),
    accountNames: (Array.isArray(liveAccounts) ? liveAccounts : []).map((a) => a.name).filter(Boolean),
  });
  // A task's stored status id → the column label people see on this board.
  const statusLabel = (status) => liveColumns.find((c) => taskInColumn(status, c.id))?.label || status;

  // A project's new sidebar items, under what this workspace calls them.
  // Operations/Executives only flag roadblocks; any older feature/bug items
  // there are passed along as-is (otherItems) so nothing is silently dropped.
  function splitItems(items, mapItem, cap = Infinity) {
    if (tech) {
      const features = items.filter((f) => f.type !== "bug");
      const bugs = items.filter((f) => f.type === "bug");
      return {
        newFeatures: features.slice(0, cap).map(mapItem),
        newBugs: bugs.slice(0, cap).map(mapItem),
        ...(cap < Infinity ? { moreFeatures: Math.max(0, features.length - cap), moreBugs: Math.max(0, bugs.length - cap) } : {}),
      };
    }
    const roadblocks = items.filter((f) => f.type === "roadblock");
    const other = items.filter((f) => f.type !== "roadblock");
    const asRoadblock = (f) => ({ ...mapItem(f), status: f.status === "completed" ? "cleared" : "open" });
    return {
      newRoadblocks: roadblocks.slice(0, cap).map(asRoadblock),
      ...(cap < Infinity ? { moreRoadblocks: Math.max(0, roadblocks.length - cap) } : {}),
      ...(other.length ? { otherItems: other.slice(0, cap).map((f) => ({ type: f.type || "feature", ...mapItem(f) })) } : {}),
    };
  }

  // Find one task by fuzzy name within the current workspace. Returns
  // { task } | { error } | { ambiguous:[titles] }.
  async function resolveTask(name) {
    const tasks = await convex.query(api.tasks.getTasks, { workspace });
    const list = Array.isArray(tasks) ? tasks : [];
    const q = (name || "").trim().toLowerCase();
    if (!q) return { error: "No project name given." };
    const exact = list.filter((t) => (t.title || "").toLowerCase() === q);
    const partial = exact.length ? exact : list.filter((t) => (t.title || "").toLowerCase().includes(q));
    if (partial.length === 0) {
      return { error: `No project named "${name}" in this workspace. Available: ${list.slice(0, 12).map((t) => t.title).join(", ") || "none"}.` };
    }
    if (partial.length > 1) {
      return { ambiguous: partial.slice(0, 8).map((t) => t.title) };
    }
    return { task: partial[0] };
  }

  async function executeTool(name, args) {
    switch (name) {
      case "list_projects": {
        const tasks = await convex.query(api.tasks.getTasksLight, { workspace });
        return {
          projects: (tasks || []).map((t) => {
            const total = (t.milestones || []).length || 1;
            return {
              title: t.title,
              status: statusLabel(t.status),
              assignee: t.assignee || "Unassigned",
              ...(accounts ? { account: t.account || "No account" } : {}),
              progressPercent: Math.round(((t.completedMilestones || 0) / total) * 100),
              notes: t.notesCount || 0,
              ...deadlineFacts(t),
            };
          }),
        };
      }

      case "get_project_updates": {
        const found = await resolveTask(args.project_name);
        if (found.error || found.ambiguous) return found;
        const t = found.task;
        const days = Math.max(1, parseInt(args.days) || 7);
        const cutoff = Date.now() - days * DAY_MS;
        const notes = (t.notes || []).filter((n) => (n.timestamp || 0) >= cutoff)
          .map((n) => ({ date: n.date, writer: n.writer, text: n.text }));
        const feats = (t.features || []).filter((f) => (f.createdAtTime || 0) >= cutoff);
        const milestones = t.milestones || [];
        const completedRecently = milestones.filter((m) => m.completed && (m.completedAtTime || 0) >= cutoff).map((m) => m.name);
        const currentM = milestones.find((m) => !m.completed);
        return {
          project: t.title,
          status: statusLabel(t.status),
          assignee: t.assignee || "Unassigned",
          sinceDays: days,
          notes,
          ...splitItems(feats, (f) => ({ name: f.name, description: f.description, status: f.status })),
          milestonesCompleted: completedRecently,
          currentMilestone: currentM ? currentM.name : "All milestones complete",
          nothingRecent: notes.length === 0 && feats.length === 0 && completedRecently.length === 0,
        };
      }

      case "get_recent_updates": {
        const days = Math.max(1, parseInt(args.days) || 7);
        const cutoff = Date.now() - days * DAY_MS;
        const PER = 20; // cap items per project per type so the payload stays sane
        const tasks = await convex.query(api.tasks.getTasks, { workspace });
        const rows = (Array.isArray(tasks) ? tasks : []).map((t) => {
          const notes = (t.notes || []).filter((n) => (n.timestamp || 0) >= cutoff);
          const feats = (t.features || []).filter((f) => (f.createdAtTime || 0) >= cutoff);
          const doneM = (t.milestones || []).filter((m) => m.completed && (m.completedAtTime || 0) >= cutoff);
          const lastActivity = Math.max(
            0,
            ...notes.map((n) => n.timestamp || 0),
            ...feats.map((f) => f.createdAtTime || 0),
            ...doneM.map((m) => m.completedAtTime || 0),
          );
          return {
            project: t.title,
            status: statusLabel(t.status),
            // ACTUAL content (not counts) so the assistant can explain the changes.
            notes: notes.slice(-8).map((n) => ({ writer: n.writer, text: trunc(n.text) })),
            // Features/bugs (Workforce) or roadblocks (Ops/Exec), capped at PER;
            // the more* counts tell the model how many it didn't see.
            ...splitItems(feats, (f) => ({ name: f.name, description: trunc(f.description) }), PER),
            milestonesCompleted: doneM.map((m) => m.name),
            lastActivity,
          };
        }).filter((r) => r.lastActivity > 0)
          .sort((a, b) => b.lastActivity - a.lastActivity)
          .slice(0, 30) // keep plenty so active projects aren't cut off the list
          .map(({ lastActivity, ...r }) => r); // drop raw timestamp from output
        return { sinceDays: days, projectsWithActivity: rows, nothingRecent: rows.length === 0 };
      }

      case "create_project": {
        const title = (args.title || "Untitled Project").trim();
        const description = (args.description || "").trim();
        const startDate = String(args.start_date || "").trim();
        const deadline = /^\d{4}-\d{2}-\d{2}$/.test(String(args.deadline || "").trim()) ? String(args.deadline).trim() : "";
        if (deadline && deadline < startDate) {
          return { created: false, error: "The deadline is before the start date, so nothing was created. Check both dates with the person." };
        }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
          return { created: false, error: "A start date is required and nothing was created. Ask the person when the project starts, then try again with start_date as YYYY-MM-DD." };
        }
        // Operations: the client account, matched by name (case-insensitive).
        // Checked BEFORE planning — an unknown account creates nothing.
        let account = null;
        const accountName = accounts ? String(args.account || "").trim() : "";
        if (accountName) {
          const list = await convex.query(api.accounts.getAccounts, { workspace });
          const all = Array.isArray(list) ? list : [];
          const q = accountName.toLowerCase();
          account = all.find((a) => String(a.name || "").trim().toLowerCase() === q) || null;
          if (!account) {
            return {
              created: false,
              error: `There's no account named "${accountName}" in this workspace, so nothing was created. ${all.length
                ? `The accounts are: ${all.map((a) => a.name).join(", ")}.`
                : "There are no accounts yet — Admin+ and Managers add them in Settings → Client Accounts (or with \"+ New account…\" in an Account picker)."} Tell the person which accounts exist and ask which one to use (or whether to create it with no account).`,
            };
          }
        }
        const cfg = await convex.query(api.appConfig.getAppConfig, { workspace });
        // Saved templates only store name + days, so re-attach each built-in
        // step's meaning (hint) — it's saved on the task and shown under it.
        const template = withTemplateHints(
          (cfg?.defaultMilestones?.length ? cfg.defaultMilestones : fallbackMilestonesFor(workspace))
            .map(({ name, days, hint }) => ({ name, days, ...(hint ? { hint } : {}) })),
          workspace,
        );
        // Let the planner tailor milestones to this task; the template is the
        // safety net if planning fails (quota, network…).
        let milestones = template;
        let watchOuts = [];
        let assumptions = [];
        let plannedByAI = false;
        try {
          // A project for a client account is planned from that account's SOPs and notes.
          const brief = description ? `${title}\n\n${description}` : title;
          let knowledge = null;
          if (account?._id) {
            const pack = await convex.query(api.knowledge.getPack, { accountId: account._id }).catch(() => null);
            const kb = buildKnowledgeBrief(pack, brief);
            if (!kb.empty) knowledge = { accountName: pack.name, text: kb.text };
          }
          const { plan } = await planTask({
            department: WORKSPACE_META[workspace]?.department,
            workspaceLabel: wsLabel,
            brief,
            startDateISO: startDate,
            deadlineISO: deadline,
            template,
            knowledge,
            thinkingLevel: "medium",
          });
          // Same shape as the New Task planner: each step's "done when" is its
          // meaning, and the plan's risks/assumptions stay on the task.
          milestones = plan.milestones.map(({ name, days, doneWhen }) => ({
            name, days, ...(doneWhen ? { hint: `Done when: ${doneWhen}` } : {}),
          }));
          watchOuts = plan.risks || [];
          assumptions = plan.assumptions || [];
          plannedByAI = true;
        } catch (err) {
          console.warn("[Caddy] planner failed, using the template:", err);
        }
        const assignee = (args.assignee || "").trim() || userName;
        await convex.mutation(api.tasks.addTask, {
          workspace, title, assignee, description, milestones, startDate,
          ...(deadline ? { deadline } : {}),
          ...(account ? { accountId: account._id } : {}),
          ...(watchOuts.length ? { watchOuts } : {}),
          ...(assumptions.length ? { assumptions } : {}),
        });
        return {
          created: true,
          title,
          assignee,
          startDate,
          ...(deadline ? { deadline } : {}),
          status: startDate <= new Date().toLocaleDateString("en-CA") ? "Pending (its start date has arrived, so the clock is running)" : `To Do — moves to Pending by itself on ${startDate}`,
          workspace,
          ...(account ? { account: account.name } : {}),
          milestonesSource: plannedByAI ? "planned by AI for this task" : "workspace default template",
          milestones: milestones.map((m) => `${m.name} (${m.days}d)`),
          totalDays: milestones.reduce((s, m) => s + m.days, 0),
          ...(watchOuts.length ? { watchOutFor: watchOuts } : {}),
          ...(assumptions.length ? { assumptions } : {}),
        };
      }

      case "plan_new_task": {
        const brief = (args.brief || "").trim();
        if (!brief) return { error: "No brief given." };
        if (!uiActions?.planNewTask) return { error: "The planner can't be opened from here." };
        const iso = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || "").trim()) ? String(v).trim() : "");
        const startDate = iso(args.start_date);
        const deadline = iso(args.deadline) && (!startDate || iso(args.deadline) >= startDate) ? iso(args.deadline) : "";
        uiActions.planNewTask(brief, { startDate, deadline });
        return startDate && deadline
          ? { opened: true, note: "The New Task planner is open with the brief and both dates filled in, and is planning now. The person reviews, edits and creates it there." }
          : { opened: true, note: "The New Task planner is open with the brief filled in. It needs a start date and a deadline before it plans — tell the person to pick them on screen, then press Think it through." };
      }

      case "search_account_sops": {
        const question = String(args.question || "").trim();
        if (!question) return { error: "No question given." };
        const overview = await convex.query(api.knowledge.getOverview, { workspace }).catch(() => null);
        const list = Array.isArray(overview) ? overview : [];
        if (!list.length) return { error: "This person isn't on any client account, so there's no account knowledge to search." };
        const name = String(args.account || "").trim().toLowerCase();
        const acc = name
          ? list.find((a) => a.name.toLowerCase() === name) || list.find((a) => a.name.toLowerCase().includes(name))
          : list.length === 1 ? list[0] : null;
        if (!acc) {
          return { error: name ? `No account called "${args.account}" that this person can see.` : "Which account?", accounts: list.map((a) => a.name) };
        }
        if (!Number(acc.docs) && !acc.hasNotes) {
          return { account: acc.name, empty: true, note: `${acc.name} has no SOPs or notes yet. They're added in Settings → Account Knowledge.` };
        }
        const pack = await convex.query(api.knowledge.getPack, { accountId: acc.accountId });
        return searchKnowledge(pack, question);
      }

      case "open_project": {
        const found = await resolveTask(args.project_name);
        if (found.error || found.ambiguous) return found;
        if (!uiActions?.openProject) return { error: "Projects can't be opened from here." };
        uiActions.openProject(found.task._id);
        return { opened: true, project: found.task.title };
      }

      case "go_to": {
        if (!uiActions?.goTo) return { error: "Navigation isn't available here." };
        return uiActions.goTo(args.place);
      }

      case "set_project_description": {
        const found = await resolveTask(args.project_name);
        if (found.error || found.ambiguous) return found;
        const t = found.task;
        // Full-details update, but preserve every other field so ONLY the
        // description changes (links/assignee/milestones are otherwise cleared).
        await convex.mutation(api.tasks.updateTaskDetails, {
          taskId: t._id,
          newTitle: t.title,
          newDescription: (args.description || "").trim(),
          newAssignee: t.assignee || "",
          newAppscriptLink: t.appscriptLink,
          newWebappLink: t.webappLink,
          newMilestones: (t.milestones || []).map((m) => ({
            name: m.name, days: m.days, completed: m.completed,
            completedAt: m.completedAt, completedAtTime: m.completedAtTime, createdAtTime: m.createdAtTime,
          })),
          actorEmail: (userEmail || "").toLowerCase(),
          actorName: userName,
        });
        return { updated: true, project: t.title };
      }

      case "add_notebook_idea": {
        await convex.mutation(api.notebook.addIdea, {
          workspace,
          name: (args.name || "Untitled Idea").trim(),
          description: (args.description || "").trim(),
          pros: (args.pros || "").trim(),
          cons: (args.cons || "").trim(),
          date: estNow(),
        });
        return { added: true, name: args.name };
      }

      case "add_note": {
        const found = await resolveTask(args.project_name);
        if (found.error || found.ambiguous) return found;
        await convex.mutation(api.tasks.addNoteToTask, {
          taskId: found.task._id,
          noteText: args.note,
          writer: userName,
          writerEmail: (userEmail || "").toLowerCase(),
          date: estNow(),
        });
        return { added: true, project: found.task.title };
      }

      case "add_feature":
      case "add_bug":
      case "add_roadblock": {
        const kind = name === "add_bug" ? "bug" : name === "add_roadblock" ? "roadblock" : "feature";
        // Each workspace only offers its own kinds (see buildTools).
        if (tech && kind === "roadblock") return { error: "This workspace tracks features and bugs, not roadblocks — use add_feature or add_bug." };
        if (!tech && kind !== "roadblock") return { error: "This workspace has no features or bugs — flag it as a roadblock with add_roadblock." };
        const found = await resolveTask(args.project_name);
        if (found.error || found.ambiguous) return found;
        await convex.mutation(api.tasks.addTaskFeature, {
          taskId: found.task._id,
          feature: {
            id: genId({ feature: "feat", bug: "bug", roadblock: "rb" }[kind]),
            name: (args.name || "").trim(),
            description: (args.description || "").trim(),
            status: "pending",
            type: kind,
            suggestedBy: userName,
            createdAt: estNow(),
          },
          actorEmail: (userEmail || "").toLowerCase(),
          actorName: userName,
        });
        return { added: true, type: kind, project: found.task.title, name: args.name };
      }

      case "set_project_status": {
        const found = await resolveTask(args.project_name);
        if (found.error || found.ambiguous) return found;
        const cfg = await convex.query(api.appConfig.getAppConfig, { workspace });
        const cols = resolveColumns(cfg?.columns, workspace);
        const target = (args.status || "").trim().toLowerCase();
        const match = cols.find((c) => c.label.toLowerCase() === target || c.id.toLowerCase() === target)
          || cols.find((c) => c.label.toLowerCase().includes(target));
        if (!match) return { error: `No column matching "${args.status}". Columns: ${cols.map((c) => c.label).join(", ")}.` };
        await convex.mutation(api.tasks.updateTaskStatus, { taskId: found.task._id, newStatus: match.id });
        return { moved: true, project: found.task.title, to: match.label };
      }

      case "set_production_deadline": {
        if (!isManager) return { error: "Only Admin+/Manager users can change workspace settings." };
        const d = (args.date || "").trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return { error: "Date must be YYYY-MM-DD." };
        const ts = new Date(`${d}T23:59:59`).getTime();
        await convex.mutation(api.appConfig.saveAppConfig, { workspace, productionDeadline: ts, updatedBy: userName });
        return { set: true, date: d, workspace };
      }

      default:
        return { error: `Unknown tool: ${name}` };
    }
  }

  // How update reports talk about a project's sidebar items here.
  const report = tech
    ? { read: "notes, new features, and bug fixes", items: "feature/bug", counts: "23 new features, 15 bugs", extra: "" }
    : {
      read: "notes, roadblocks (open or cleared) and completed milestones",
      items: "roadblock",
      counts: "12 new roadblocks, 3 cleared",
      extra: " Do call out roadblocks that are still OPEN — they're what's holding a project back.",
    };
  const systemInstruction = [
    `You are Caddy (full name Caduceus), the assistant inside the Hermes project-management tool (used by the Workforce, Operations and Executives teams; it was called "Workforce Hermes" before). The current user is "${userName}" (role: ${actualRole || "unknown"}), working in the "${wsLabel}" workspace — all actions apply to this workspace only.`,
    `VOICE — talk like a helpful teammate sitting right next to them, not a formal corporate bot: warm, natural, concise. Use contractions and plain words and get straight to the point. NEVER introduce or re-introduce yourself — not to open, and NOT as a closing "reminder". Specifically banned anywhere in a reply: "I'm Caduceus/Caddy", "your Hermes assistant", "here to help move your work/messages along", "As a reminder, I'm…", and tacked-on boilerplate like "Let me know if you need anything else!". Also skip "As an AI…", "My role is…", "My capabilities are…", and stiff "I'd recommend…". Just answer the question like a real person would, then stop — no sign-off.`,
    `IDENTITY — only explain who you are or what "Caduceus"/"Caddy" means when the user DIRECTLY asks about your name or what you are. When they do: a caduceus is the winged staff of Hermes, the Greek messenger god — a fit for "Hermes" since you help move the team's work and messages along. Otherwise never bring this up, and never tack it onto an unrelated answer.`,
    `You help by answering questions and performing actions through the provided tools:`,
    `• Reporting project updates (default to the last 7 days unless the user specifies a range) — EXPLAIN what actually changed.`,
    `• Creating projects — assign to the current user by default unless they name someone else.${accounts ? " If they name a client account, pass it as `account`." : ""}`,
    `• Adding notebook ideas, posting notes on projects, ${tech ? "adding features, logging bugs" : "flagging roadblocks"}, and moving projects between columns.`,
    ...(tech ? [] : [
      `THIS WORKSPACE'S LANGUAGE: ${wsLabel} runs business projects, not software, so there are NO features or bugs here. Anything in a project's way — a blocker, issue, problem, delay, missing sign-off or something they're waiting on — is a ROADBLOCK: flag it with add_roadblock and call it a roadblock. A project's links are its "Documents" (not system links), the workspace deadline is the "Key Target Date", and the "Programmer" access type is called "User".${accounts ? " Projects can belong to a client ACCOUNT." : ""}`,
    ]),
    `• Acting on the screen: open a project (open_project), take them somewhere (go_to), or open the New Task planner with their idea filled in (plan_new_task). When someone wants to PLAN a new task or get milestones for it, use plan_new_task so they can watch the AI think and edit the plan — only use create_project when they clearly want it created immediately.`,
    `If someone asks HOW or WHERE to do something you don't have a tool for (like setting a password or changing access), guide them to the right screen using the app guide below — don't say you can't help or that it doesn't exist.`,
    APP_GUIDE,
    `A note (add_note) and a description (set_project_description) are DIFFERENT: a description is the project's summary field; a note is a timeline update. To add or change a project's description use set_project_description — never post it as a note.`,
    `When creating a project: ALWAYS compose a clear 1–3 sentence description of what it involves — never leave it empty or just repeat the title. Infer it from the title and context using your own knowledge${ENABLE_WEB_SEARCH ? ", and if the title references a tool, product, company, or term you're unsure about, use Google Search to research it first" : ""}.`,
    `HOW TO REPORT UPDATES: read the ${report.read} the tool returns and write a SHORT natural-language SUMMARY of what changed. Name EVERY project that has activity (a sentence or two each) — NEVER drop a project from the list. The "1–3 most significant items" limit is PER project (which items to highlight within it), NOT a reason to skip whole projects. Do NOT list every ${report.items}, output comma-separated item names, or report raw counts (e.g. never "${report.counts}").${report.extra} If the user says a project has updates you didn't mention, believe them and re-check that exact name with get_project_updates — and remember one word can match several projects (e.g. "Apollo" matches BOTH "Workforce Apollo" and "Workforce Apollo V2"), so check the variants before ever concluding there's nothing.`,
    `Guidelines: Be efficient with tools — for "what has updates / what's the latest / which projects moved" use get_recent_updates ONCE; only use get_project_updates when the user names a single project. Resolve project names with list_projects if unsure, and if a name is ambiguous ask which one. Keep replies short and conversational, and don't re-introduce yourself unless asked. After doing something, confirm exactly what you did in one sentence. Never invent data — if a tool returns nothing recent, say so plainly. Only call set_production_deadline if the user is a manager and explicitly asks.`,
  ].join("\n");

  return { tools, executeTool, systemInstruction };
}
