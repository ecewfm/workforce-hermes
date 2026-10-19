-- ════════════════════════════════════════════════════════════════════════════
-- Workforce Hermes — initial Supabase schema (moved from Convex, 2026-10-19)
-- ════════════════════════════════════════════════════════════════════════════
--
-- Mirrors every Convex table, with three deliberate changes:
--
--   1. Nested arrays become real tables. A task's milestones, notes (+ replies
--      and reactions) and features (+ images) used to live as arrays inside the
--      task document and were addressed by array POSITION. Each item now has
--      its own row and id, so concurrent edits can't hit the wrong item.
--   2. Secrets live apart from everything else: staff passwords / security
--      answers, per-project admin logins and workspace passwords each get their
--      own table, so read access to staff/tasks never exposes them.
--   3. Text dates ("4/7/2026, 8:27 PM", America/New_York) become timestamptz.
--
-- Migrated rows keep their Convex _id as `id` (text). That keeps existing
-- links and integrations working — e.g. /api/task?taskId=<convex id>.
-- New rows get a random uuid (as text).
--
-- SECURITY: Row Level Security is ON for every table with NO policies, so the
-- anon/authenticated keys can read or write nothing yet. Only the service role
-- (server-side) can. Policies arrive with the auth work, before the app reads
-- from Supabase directly.

-- ── Shared ──────────────────────────────────────────────────────────────────
create or replace function public.is_workspace(w text) returns boolean
  language sql immutable set search_path = ''
  as $$ select w in ('executives', 'operations', 'workforce') $$;

-- ── Staff ───────────────────────────────────────────────────────────────────
create table public.staff (
  id          text primary key default gen_random_uuid()::text,
  email       text not null unique check (email = lower(email)),
  name        text not null,
  -- Access type. Pending = registered, awaiting approval; Revoked = blocked.
  role        text not null check (role in ('Programmer', 'Admin', 'Admin+', 'Manager', 'Pending', 'Revoked')),
  -- Department membership = which workspaces they can enter.
  departments text[] not null default '{}'
              check (departments <@ array['Executives', 'Operations', 'Workforce']),
  avatar_url  text,
  bio         text,
  country     text,
  status      text,
  created_at  timestamptz not null default now()
);

-- Login secrets. password_hash is unsalted SHA-256 hex (the format the current
-- login checks); plain-text passwords from Convex were hashed on the way in.
-- security_answer_hash = SHA-256 hex of trim(lower(answer)).
create table public.staff_credentials (
  staff_id             text primary key references public.staff (id) on delete cascade,
  password_hash        text check (password_hash ~ '^[0-9a-f]{64}$'),
  security_question    text,
  security_answer_hash text check (security_answer_hash ~ '^[0-9a-f]{64}$'),
  updated_at           timestamptz not null default now()
);

-- Presence (was "heartbeats").
create table public.presence (
  email        text primary key check (email = lower(email)),
  last_seen_at timestamptz not null default now()
);

-- ── Projects (tasks) ────────────────────────────────────────────────────────
create table public.tasks (
  id                        text primary key default gen_random_uuid()::text,
  workspace                 text not null default 'workforce' check (public.is_workspace(workspace)),
  title                     text not null,
  -- Board column id (per-workspace columns; 'scrapyard' = archived).
  status                    text not null default 'todo',
  -- Comma-separated assignee NAMES, exactly as before.
  assignee                  text not null default '',
  description               text not null default '',
  start_date                date,
  project_link              text,
  appscript_link            text,
  webapp_link               text,
  is_prioritized            boolean not null default false,
  -- Admin-pinned completion deadline; overrides the computed one.
  deadline_override         timestamptz,
  -- When it first left To Do — milestone countdowns anchor here.
  pending_started_at        timestamptz,
  -- Dedup markers for the daily manager scan.
  manager_late_notified_at  timestamptz,
  manager_stale_notified_at timestamptz,
  -- Last activity (notes, milestones, edits…). Drives "stalled" detection.
  last_updated_at           timestamptz not null default now(),
  created_at                timestamptz not null default now()
);
create index tasks_workspace_idx on public.tasks (workspace);

-- Per-project admin login (was tasks.adminCredentials, base64-"obfuscated").
create table public.task_credentials (
  task_id        text primary key references public.tasks (id) on delete cascade,
  login_email    text,
  login_password text,
  updated_at     timestamptz not null default now()
);

create table public.task_milestones (
  id           uuid primary key default gen_random_uuid(),
  task_id      text not null references public.tasks (id) on delete cascade,
  position     integer not null,
  name         text not null,
  days         integer not null default 0 check (days >= 0),
  completed    boolean not null default false,
  completed_at timestamptz,
  created_at   timestamptz,
  unique (task_id, position) deferrable initially immediate
);

create table public.task_notes (
  id         uuid primary key default gen_random_uuid(),
  task_id    text not null references public.tasks (id) on delete cascade,
  position   integer not null,
  text       text not null,
  writer     text,
  created_at timestamptz not null default now(),
  unique (task_id, position) deferrable initially immediate
);

create table public.note_replies (
  id         uuid primary key default gen_random_uuid(),
  note_id    uuid not null references public.task_notes (id) on delete cascade,
  position   integer not null,
  text       text not null,
  writer     text not null,
  created_at timestamptz not null default now(),
  unique (note_id, position) deferrable initially immediate
);

create table public.note_reactions (
  note_id    uuid not null references public.task_notes (id) on delete cascade,
  user_email text not null check (user_email = lower(user_email)),
  reaction   text not null check (reaction in ('like', 'wow', 'heart', 'haha')),
  created_at timestamptz not null default now(),
  primary key (note_id, user_email, reaction)
);

-- Features AND bugs. ids are the existing ones (the Task API addresses them).
create table public.task_features (
  id           text primary key default gen_random_uuid()::text,
  task_id      text not null references public.tasks (id) on delete cascade,
  position     integer not null,
  type         text not null default 'feature' check (type in ('feature', 'bug')),
  name         text not null,
  description  text not null default '',
  status       text not null default 'pending' check (status in ('pending', 'completed')),
  suggested_by text,
  created_at   timestamptz,
  completed_at timestamptz,
  unique (task_id, position) deferrable initially immediate
);

-- Screenshots on a feature/bug. Files live in the private "feature-images"
-- storage bucket at storage_path.
create table public.feature_images (
  id                uuid primary key default gen_random_uuid(),
  feature_id        text not null references public.task_features (id) on delete cascade,
  position          integer not null,
  storage_path      text not null,
  legacy_storage_id text,
  unique (feature_id, position)
);

-- Last time each person opened each project (drives "new" badges).
create table public.task_views (
  task_id        text not null references public.tasks (id) on delete cascade,
  user_email     text not null check (user_email = lower(user_email)),
  last_viewed_at timestamptz not null default now(),
  primary key (task_id, user_email)
);

create index task_milestones_task_idx on public.task_milestones (task_id, position);
create index task_notes_task_idx on public.task_notes (task_id, position);
create index task_features_task_idx on public.task_features (task_id, position);

-- ── Notebook, announcements, handbook ───────────────────────────────────────
create table public.notebook_ideas (
  id          text primary key default gen_random_uuid()::text,
  workspace   text not null default 'workforce' check (public.is_workspace(workspace)),
  name        text not null,
  description text not null default '',
  pros        text not null default '',
  cons        text not null default '',
  details     text not null default '',
  taker       text,
  created_at  timestamptz not null default now()
);
create index notebook_ideas_workspace_idx on public.notebook_ideas (workspace);

create table public.announcements (
  id              text primary key default gen_random_uuid()::text,
  workspace       text not null default 'workforce' check (public.is_workspace(workspace)),
  title           text not null,
  body            text not null, -- HTML from the composer
  posted_by       text not null,
  posted_by_email text not null,
  created_at      timestamptz not null default now()
);
create index announcements_workspace_idx on public.announcements (workspace, created_at desc);

-- Who has dismissed which announcement (was the seenBy array).
create table public.announcement_views (
  announcement_id text not null references public.announcements (id) on delete cascade,
  user_email      text not null check (user_email = lower(user_email)),
  seen_at         timestamptz not null default now(),
  primary key (announcement_id, user_email)
);

-- One block-built handbook page per workspace.
create table public.handbooks (
  workspace  text primary key check (public.is_workspace(workspace)),
  blocks     jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by text
);

-- ── Workspace settings (was appConfig) ──────────────────────────────────────
create table public.workspace_settings (
  workspace           text primary key check (public.is_workspace(workspace)),
  production_deadline timestamptz,
  default_milestones  jsonb, -- [{ name, days }] — null = built-in default
  columns             jsonb, -- [{ id, label, color, limit? }] — null = default columns
  updated_at          timestamptz not null default now(),
  updated_by          text
);

-- Workspace entry password (SHA-256 hex). No row = open workspace.
create table public.workspace_passwords (
  workspace     text primary key check (public.is_workspace(workspace)),
  password_hash text not null check (password_hash ~ '^[0-9a-f]{64}$'),
  updated_at    timestamptz not null default now()
);

-- ── Notifications & audit ───────────────────────────────────────────────────
create table public.notifications (
  id           text primary key default gen_random_uuid()::text,
  workspace    text not null default 'workforce' check (public.is_workspace(workspace)),
  -- mention | project_change | reaction | manager_feature | manager_bug | manager_overdue | manager_stale
  type         text not null,
  target_email text not null check (target_email = lower(target_email)),
  actor_email  text not null,
  actor_name   text not null,
  message      text not null,
  task_id      text references public.tasks (id) on delete set null,
  task_title   text,
  read         boolean not null default false,
  created_at   timestamptz not null default now()
);
create index notifications_inbox_idx on public.notifications (target_email, workspace, read, created_at desc);

create table public.security_logs (
  id           text primary key default gen_random_uuid()::text,
  action       text not null,
  user_email   text not null,
  target_email text not null,
  details      text,
  ip           text,
  created_at   timestamptz not null default now()
);
create index security_logs_user_idx on public.security_logs (user_email);
create index security_logs_target_idx on public.security_logs (target_email);
create index security_logs_action_idx on public.security_logs (action);

-- ── Lock everything down (deny-all until policies exist) ───────────────────
do $$
declare t text;
begin
  foreach t in array array[
    'staff', 'staff_credentials', 'presence', 'tasks', 'task_credentials', 'task_milestones',
    'task_notes', 'note_replies', 'note_reactions', 'task_features', 'feature_images', 'task_views',
    'notebook_ideas', 'announcements', 'announcement_views', 'handbooks', 'workspace_settings',
    'workspace_passwords', 'notifications', 'security_logs'
  ] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;
