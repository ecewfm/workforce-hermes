import { useConvex } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useWorkspace } from "./workspaceContext";
import { isAdminPlusOrAbove } from "./roles";
import { DAY_MS } from "./deadlines";
import { resolveColumns } from "./columns";
import { WORKSPACE_META } from "./departments";
import { ENABLE_WEB_SEARCH } from "./aiConfig";

// Display date string matching how the rest of the app stamps notes/ideas.
function estNow() {
  return new Date().toLocaleString("en-US", {
    timeZone: "America/New_York",
    year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
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
// APP GUIDE — what Caddy knows about where things live in Workforce Hermes, so
// it can answer "where do I…" questions and guide users instead of guessing.
// ⚠️ KEEP THIS UPDATED: whenever we ship a user-facing feature, add a line here
// (and add a tool below if Caddy should DO it, not just explain where it is).
// ─────────────────────────────────────────────────────────────────────────────
const APP_GUIDE = `WHERE THINGS LIVE in Workforce Hermes (use this to answer "where do I…" and guide users; never invent settings that don't exist):
• Settings → Workspace Defaults (Admin+): the milestone template for new projects, the full-production deadline, the Kanban board columns, and the WORKSPACE PASSWORD — set/change/remove the password required to enter this workspace (blank = open). It's per-workspace, so it's set from inside the workspace being protected.
• Settings → Staff Management (Admin+): "Access Type" sets each person's role; "Department Membership" (Managers only — Admins can view) controls which workspaces each person can access. A user reaches exactly the workspaces (departments) ticked for them.
• Settings → AI Assistant: toggle Caddy on/off.
• Projects/Kanban, the notebook, announcements, and the handbook are each per-workspace; switch workspaces from the header title (a password may be required).
• Clicking a project card zooms the board toward it and the task modal grows out of the card to the centre (reversing on close) — that's the intended animation, not a glitch. Same for the robotic touches: the cursor is a robotic hand that grips when you click, and a robotic arm reaches for your cursor on the navigation buttons — deliberate fun, not glitches.
If you're unsure where something is, say it's most likely under Settings and point them there — never claim a real feature doesn't exist.`;

// ── Gemini function-declaration schemas ─────────────────────────────────────
const TOOLS = [
  {
    name: "list_projects",
    description: "List the projects (tasks) in the current workspace with their status, assignee and progress. Use this to find the exact project name before acting on one.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "get_project_updates",
    description: "Summarize recent activity for ONE named project: notes/updates, new features, new bugs, and milestones completed within the last N days.",
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
    description: "Get recent activity across ALL projects in the workspace in ONE call — for each project it returns the ACTUAL note texts, the new features (name + description), the new bugs (name + description), and milestones completed within the last N days, newest first. Use this for questions like 'what has updates?', 'what's the latest?', or 'which projects moved this week?' — do NOT call get_project_updates repeatedly for this. Read the returned text and EXPLAIN what changed; never just report counts.",
    parameters: {
      type: "object",
      properties: { days: { type: "integer", description: "How many days back to include. Default 7." } },
    },
  },
  {
    name: "create_project",
    description: "Create a new project (task). ALWAYS include a helpful `description` you compose yourself — never leave it blank or just repeat the title. Defaults the assignee to the current user unless another person's name is given.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Project title." },
        description: { type: "string", description: "A clear 1–3 sentence description of what this project involves and its goal. Required — write it yourself from the title, context, and (if the term/tool is unfamiliar) web research." },
        assignee: { type: "string", description: "Optional assignee full name. Defaults to the current user." },
      },
      required: ["title", "description"],
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
  {
    name: "set_project_status",
    description: "Move a project to a different board column/status in the current workspace.",
    parameters: {
      type: "object",
      properties: {
        project_name: { type: "string" },
        status: { type: "string", description: "Target column name or status (e.g. 'In Development', 'Done')." },
      },
      required: ["project_name", "status"],
    },
  },
  {
    name: "set_production_deadline",
    description: "Manager only: set this workspace's full-production deadline. Date must be YYYY-MM-DD.",
    parameters: {
      type: "object",
      properties: { date: { type: "string", description: "Deadline date as YYYY-MM-DD." } },
      required: ["date"],
    },
  },
];

/**
 * Hook that wires the AI tools to Convex for the current user + workspace.
 * Returns { tools, executeTool, systemInstruction }.
 */
export function useAiActions({ userName, userEmail, actualRole }) {
  const convex = useConvex();
  const workspace = useWorkspace();
  const isManager = isAdminPlusOrAbove(actualRole);

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
              status: t.status,
              assignee: t.assignee || "Unassigned",
              progressPercent: Math.round(((t.completedMilestones || 0) / total) * 100),
              notes: t.notesCount || 0,
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
          status: t.status,
          assignee: t.assignee || "Unassigned",
          sinceDays: days,
          notes,
          newFeatures: feats.filter((f) => f.type !== "bug").map((f) => ({ name: f.name, description: f.description, status: f.status })),
          newBugs: feats.filter((f) => f.type === "bug").map((f) => ({ name: f.name, description: f.description, status: f.status })),
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
          const newFeatures = feats.filter((f) => f.type !== "bug");
          const newBugs = feats.filter((f) => f.type === "bug");
          const lastActivity = Math.max(
            0,
            ...notes.map((n) => n.timestamp || 0),
            ...feats.map((f) => f.createdAtTime || 0),
            ...doneM.map((m) => m.completedAtTime || 0),
          );
          return {
            project: t.title,
            status: t.status,
            // ACTUAL content (not counts) so the assistant can explain the changes.
            notes: notes.slice(-8).map((n) => ({ writer: n.writer, text: trunc(n.text) })),
            newFeatures: newFeatures.slice(0, PER).map((f) => ({ name: f.name, description: trunc(f.description) })),
            newBugs: newBugs.slice(0, PER).map((f) => ({ name: f.name, description: trunc(f.description) })),
            // If there were more than the cap, tell the model how many it didn't see.
            moreFeatures: Math.max(0, newFeatures.length - PER),
            moreBugs: Math.max(0, newBugs.length - PER),
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
        const cfg = await convex.query(api.appConfig.getAppConfig, { workspace });
        const milestones = (cfg?.defaultMilestones || []).map((m) => ({ name: m.name, days: m.days }));
        const assignee = (args.assignee || "").trim() || userName;
        await convex.mutation(api.tasks.addTask, {
          workspace,
          title: (args.title || "Untitled Project").trim(),
          assignee,
          description: (args.description || "").trim(),
          milestones,
        });
        return { created: true, title: args.title, assignee, workspace };
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
      case "add_bug": {
        const found = await resolveTask(args.project_name);
        if (found.error || found.ambiguous) return found;
        const isBug = name === "add_bug";
        await convex.mutation(api.tasks.addTaskFeature, {
          taskId: found.task._id,
          feature: {
            id: genId(isBug ? "bug" : "feat"),
            name: (args.name || "").trim(),
            description: (args.description || "").trim(),
            status: "pending",
            type: isBug ? "bug" : "feature",
            suggestedBy: userName,
            createdAt: estNow(),
          },
          actorEmail: (userEmail || "").toLowerCase(),
          actorName: userName,
        });
        return { added: true, type: isBug ? "bug" : "feature", project: found.task.title, name: args.name };
      }

      case "set_project_status": {
        const found = await resolveTask(args.project_name);
        if (found.error || found.ambiguous) return found;
        const cfg = await convex.query(api.appConfig.getAppConfig, { workspace });
        const cols = resolveColumns(cfg?.columns);
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

  const wsLabel = WORKSPACE_META?.[workspace]?.label || workspace;
  const systemInstruction = [
    `You are Caddy (full name Caduceus), the assistant inside the Workforce Hermes project-management tool. The current user is "${userName}" (role: ${actualRole || "unknown"}), working in the "${wsLabel}" workspace — all actions apply to this workspace only.`,
    `VOICE — talk like a helpful teammate sitting right next to them, not a formal corporate bot: warm, natural, concise. Use contractions and plain words and get straight to the point. NEVER introduce or re-introduce yourself — not to open, and NOT as a closing "reminder". Specifically banned anywhere in a reply: "I'm Caduceus/Caddy", "your Workforce Hermes assistant", "here to help move your work/messages along", "As a reminder, I'm…", and tacked-on boilerplate like "Let me know if you need anything else!". Also skip "As an AI…", "My role is…", "My capabilities are…", and stiff "I'd recommend…". Just answer the question like a real person would, then stop — no sign-off.`,
    `IDENTITY — only explain who you are or what "Caduceus"/"Caddy" means when the user DIRECTLY asks about your name or what you are. When they do: a caduceus is the winged staff of Hermes, the Greek messenger god — a fit for "Workforce Hermes" since you help move the team's work and messages along. Otherwise never bring this up, and never tack it onto an unrelated answer.`,
    `You help by answering questions and performing actions through the provided tools:`,
    `• Reporting project updates (default to the last 7 days unless the user specifies a range) — EXPLAIN what actually changed.`,
    `• Creating projects — assign to the current user by default unless they name someone else.`,
    `• Adding notebook ideas, posting notes on projects, adding features, logging bugs, and moving projects between columns.`,
    `If someone asks HOW or WHERE to do something you don't have a tool for (like setting a password or changing access), guide them to the right screen using the app guide below — don't say you can't help or that it doesn't exist.`,
    APP_GUIDE,
    `A note (add_note) and a description (set_project_description) are DIFFERENT: a description is the project's summary field; a note is a timeline update. To add or change a project's description use set_project_description — never post it as a note.`,
    `When creating a project: ALWAYS compose a clear 1–3 sentence description of what it involves — never leave it empty or just repeat the title. Infer it from the title and context using your own knowledge${ENABLE_WEB_SEARCH ? ", and if the title references a tool, product, company, or term you're unsure about, use Google Search to research it first" : ""}.`,
    `HOW TO REPORT UPDATES: read the notes, new features, and bug fixes the tool returns and write a SHORT natural-language SUMMARY of what changed. Name EVERY project that has activity (a sentence or two each) — NEVER drop a project from the list. The "1–3 most significant items" limit is PER project (which items to highlight within it), NOT a reason to skip whole projects. Do NOT list every feature/bug, output comma-separated item names, or report raw counts (e.g. never "23 new features, 15 bugs"). If the user says a project has updates you didn't mention, believe them and re-check that exact name with get_project_updates — and remember one word can match several projects (e.g. "Apollo" matches BOTH "Workforce Apollo" and "Workforce Apollo V2"), so check the variants before ever concluding there's nothing.`,
    `Guidelines: Be efficient with tools — for "what has updates / what's the latest / which projects moved" use get_recent_updates ONCE; only use get_project_updates when the user names a single project. Resolve project names with list_projects if unsure, and if a name is ambiguous ask which one. Keep replies short and conversational, and don't re-introduce yourself unless asked. After doing something, confirm exactly what you did in one sentence. Never invent data — if a tool returns nothing recent, say so plainly. Only call set_production_deadline if the user is a manager and explicitly asks.`,
  ].join("\n");

  return { tools: TOOLS, executeTool, systemInstruction };
}
