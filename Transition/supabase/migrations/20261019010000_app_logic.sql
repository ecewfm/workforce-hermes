-- ════════════════════════════════════════════════════════════════════════════
-- Workforce Hermes — app logic on Supabase (replaces the Convex functions)
-- ════════════════════════════════════════════════════════════════════════════
--
-- How access works now:
--   • Identity comes from the signed-in Supabase session (auth.jwt() email),
--     never from anything the browser claims.
--   • READS: row-level-security policies — you see rows in workspaces your
--     departments give you (Main Admin: all). Pending/Revoked see nothing.
--   • WRITES: only through the functions below (no direct insert/update/delete
--     policies). Each one checks role + workspace server-side, then does the
--     same side effects the Convex mutations did (notifications, @mentions,
--     manager alerts, "last updated", priority cap…).
--   • The server (service role — /api/task, /api/auth) bypasses these checks.
--
-- Functions return the SAME shapes the Convex functions did (_id, milestones
-- arrays, "date" strings…), so the React components didn't need rewriting.

create schema if not exists private;
grant usage on schema private to authenticated, service_role;

-- Login helpers need to know whether a Supabase Auth account exists.
alter table public.staff_credentials add column if not exists auth_user_id uuid;

-- ── Identity & permission helpers (security definer: they read staff
--    without tripping the staff RLS policy that itself uses them) ─────────────
-- Only accounts created by OUR server (/api/auth stamps app_metadata.hermes,
-- which users can't set themselves) count as a staff identity. A self-made
-- Supabase account with someone's email gets nothing.
create or replace function private.my_email() returns text
  language sql stable set search_path = ''
  as $$ select case when coalesce(auth.jwt() -> 'app_metadata' ->> 'hermes', '') = 'true'
                    then lower(coalesce(auth.jwt() ->> 'email', '')) else '' end $$;

create or replace function private.is_service() returns boolean
  language sql stable set search_path = ''
  as $$ select coalesce(auth.jwt() ->> 'role', '') = 'service_role' $$;

create or replace function private.is_main_admin() returns boolean
  language sql stable set search_path = ''
  as $$ select private.my_email() = 'wmt@ececontactcenters.com' $$;

create or replace function private.my_role() returns text
  language sql stable security definer set search_path = ''
  as $$ select s.role from public.staff s where s.email = private.my_email() $$;

create or replace function private.my_name() returns text
  language sql stable security definer set search_path = ''
  as $$ select s.name from public.staff s where s.email = private.my_email() $$;

create or replace function private.is_approved() returns boolean
  language sql stable security definer set search_path = ''
  as $$ select private.is_service() or private.is_main_admin()
           or coalesce(private.my_role() not in ('Pending', 'Revoked'), false) $$;

create or replace function private.is_admin_level() returns boolean
  language sql stable security definer set search_path = ''
  as $$ select private.is_service() or private.is_main_admin()
           or coalesce(private.my_role() in ('Admin', 'Admin+', 'Manager'), false) $$;

create or replace function private.is_admin_plus() returns boolean
  language sql stable security definer set search_path = ''
  as $$ select private.is_service() or private.is_main_admin()
           or coalesce(private.my_role() in ('Admin+', 'Manager'), false) $$;

create or replace function private.is_manager() returns boolean
  language sql stable security definer set search_path = ''
  as $$ select private.is_service() or private.is_main_admin()
           or coalesce(private.my_role() = 'Manager', false) $$;

-- Department label for a workspace key.
create or replace function private.ws_department(ws text) returns text
  language sql immutable set search_path = ''
  as $$ select case ws when 'executives' then 'Executives' when 'operations' then 'Operations'
                         when 'workforce' then 'Workforce' end $$;

-- May the caller see/act in this workspace? (exactly their ticked departments)
create or replace function private.can_access(ws text) returns boolean
  language sql stable security definer set search_path = ''
  as $$ select private.is_service() or private.is_main_admin() or (
           private.is_approved() and exists (
             select 1 from public.staff s
             where s.email = private.my_email() and private.ws_department(ws) = any (s.departments))) $$;

create or replace function private.task_workspace(tid text) returns text
  language sql stable security definer set search_path = ''
  as $$ select t.workspace from public.tasks t where t.id = tid $$;

create or replace function private.can_access_task(tid text) returns boolean
  language sql stable security definer set search_path = ''
  as $$ select coalesce(private.can_access(private.task_workspace(tid)), false) $$;

create or replace function private.can_access_note(nid uuid) returns boolean
  language sql stable security definer set search_path = ''
  as $$ select coalesce((select private.can_access_task(n.task_id) from public.task_notes n where n.id = nid), false) $$;

create or replace function private.can_access_feature(fid text) returns boolean
  language sql stable security definer set search_path = ''
  as $$ select coalesce((select private.can_access_task(f.task_id) from public.task_features f where f.id = fid), false) $$;

-- Raise a clean "not allowed" error.
create or replace function private.require(ok boolean, msg text default 'You don''t have permission to do that.') returns void
  language plpgsql set search_path = ''
  as $$ begin if not coalesce(ok, false) then raise exception '%', msg using errcode = '42501'; end if; end $$;

create or replace function private.require_task(tid text) returns public.tasks
  language plpgsql security definer set search_path = ''
  as $$
declare t public.tasks;
begin
  select * into t from public.tasks where id = tid;
  if not found then raise exception 'Task not found'; end if;
  perform private.require(private.can_access(t.workspace));
  return t;
end $$;

-- ── Formatting (same shapes as Convex) ──────────────────────────────────────
create or replace function private.ms(ts timestamptz) returns bigint
  language sql immutable set search_path = ''
  as $$ select (extract(epoch from ts) * 1000)::bigint $$;

-- "4/18/2026, 05:57 PM" in New York time — how the app always displayed dates.
create or replace function private.ny_text(ts timestamptz) returns text
  language sql stable set search_path = ''
  as $$ select to_char(ts at time zone 'America/New_York', 'FMMM/FMDD/YYYY, HH12:MI AM') $$;

create or replace function private.from_ms(v jsonb) returns timestamptz
  language sql immutable set search_path = ''
  as $$ select case when v is null or jsonb_typeof(v) <> 'number' then null
                    else to_timestamp((v #>> '{}')::double precision / 1000) end $$;

create or replace function private.milestones_json(tid text) returns jsonb
  language sql stable security definer set search_path = ''
  as $$
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
           'name', m.name, 'days', m.days, 'completed', m.completed,
           'completedAt', private.ny_text(m.completed_at), 'completedAtTime', private.ms(m.completed_at),
           'createdAtTime', private.ms(m.created_at))) order by m.position), '[]'::jsonb)
  from public.task_milestones m where m.task_id = tid $$;

create or replace function private.note_json(n public.task_notes) returns jsonb
  language sql stable security definer set search_path = ''
  as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'text', n.text, 'date', private.ny_text(n.created_at), 'timestamp', private.ms(n.created_at), 'writer', n.writer,
    'reactions', (select jsonb_object_agg(r.reaction, r.emails) from (
                    select reaction, jsonb_agg(user_email order by created_at) emails
                    from public.note_reactions where note_id = n.id group by reaction) r),
    'replies', (select jsonb_agg(jsonb_build_object('text', x.text, 'date', private.ny_text(x.created_at),
                    'timestamp', private.ms(x.created_at), 'writer', x.writer) order by x.position)
                from public.note_replies x where x.note_id = n.id))) $$;

create or replace function private.feature_json(f public.task_features) returns jsonb
  language sql stable security definer set search_path = ''
  as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'id', f.id, 'name', f.name, 'description', f.description, 'status', f.status, 'suggestedBy', f.suggested_by,
    'imageStorageIds', coalesce((select jsonb_agg(i.storage_path order by i.position)
                                 from public.feature_images i where i.feature_id = f.id), '[]'::jsonb),
    'type', f.type, 'createdAt', private.ny_text(f.created_at), 'createdAtTime', private.ms(f.created_at),
    'completedAt', private.ny_text(f.completed_at), 'completedAtTime', private.ms(f.completed_at))) $$;

create or replace function private.task_base_json(t public.tasks) returns jsonb
  language sql stable security definer set search_path = ''
  as $$
  select jsonb_build_object(
    '_id', t.id, '_creationTime', private.ms(t.created_at), 'workspace', t.workspace, 'title', t.title,
    'status', t.status, 'assignee', t.assignee, 'description', t.description,
    'milestones', private.milestones_json(t.id),
    'completedMilestones', (select count(*) from public.task_milestones m where m.task_id = t.id and m.completed),
    'startDate', t.start_date, 'projectLink', t.project_link, 'appscriptLink', t.appscript_link,
    'webappLink', t.webapp_link, 'lastUpdated', private.ms(t.last_updated_at), 'isPrioritized', t.is_prioritized,
    'deadlineOverride', private.ms(t.deadline_override), 'pendingStartedAt', private.ms(t.pending_started_at),
    'managerLateNotifiedAt', private.ms(t.manager_late_notified_at),
    'managerStaleNotifiedAt', private.ms(t.manager_stale_notified_at)) $$;

-- Board payload: no notes/features bodies, just counts + the latest note preview.
create or replace function private.task_light_json(t public.tasks) returns jsonb
  language sql stable security definer set search_path = ''
  as $$
  select jsonb_strip_nulls(private.task_base_json(t) || jsonb_build_object(
    'notesCount', (select count(*) from public.task_notes n where n.task_id = t.id),
    'featuresCount', (select count(*) from public.task_features f where f.task_id = t.id),
    'lastNoteTimestamp', coalesce((select private.ms(max(n.created_at)) from public.task_notes n where n.task_id = t.id), 0),
    'lastFeatureTimestamp', coalesce((select private.ms(max(f.created_at)) from public.task_features f where f.task_id = t.id), 0),
    'lastNoteText', coalesce((select left(n.text, 200) from public.task_notes n where n.task_id = t.id
                              order by n.created_at desc, n.position desc limit 1), ''),
    'lastNoteWriter', coalesce((select n.writer from public.task_notes n where n.task_id = t.id
                                order by n.created_at desc, n.position desc limit 1), ''))) $$;

-- Full task (the task modal). Admin logins only for Admin-level users.
create or replace function private.task_full_json(t public.tasks) returns jsonb
  language sql stable security definer set search_path = ''
  as $$
  select jsonb_strip_nulls(private.task_base_json(t) || jsonb_build_object(
    'notes', (select coalesce(jsonb_agg(private.note_json(n) order by n.position), '[]'::jsonb)
              from public.task_notes n where n.task_id = t.id),
    'features', (select coalesce(jsonb_agg(private.feature_json(f) order by f.position), '[]'::jsonb)
                 from public.task_features f where f.task_id = t.id),
    'adminCredentials', case when private.is_admin_level() then
        (select jsonb_build_object('email', coalesce(c.login_email, ''), 'password', coalesce(c.login_password, ''))
         from public.task_credentials c where c.task_id = t.id) end)) $$;

-- ── Notification helpers (ports of the Convex logic) ────────────────────────
-- Fuzzy name ↔ comma-separated-assignees match, exactly like before:
-- either string contains the other.
create or replace function private.name_matches(person text, assignees text) returns boolean
  language sql immutable set search_path = ''
  as $$
  select coalesce(lower(btrim(person)), '') <> '' and exists (
    select 1 from unnest(string_to_array(lower(coalesce(assignees, '')), ',')) a(raw)
    where btrim(raw) <> ''
      and (strpos(lower(btrim(person)), btrim(raw)) > 0 or strpos(btrim(raw), lower(btrim(person))) > 0)) $$;

create or replace function private.notify(ws text, kind text, target text, actor_email text, actor_name text,
                                          msg text, tid text, ttitle text) returns void
  language sql security definer set search_path = ''
  as $$
  insert into public.notifications (workspace, type, target_email, actor_email, actor_name, message, task_id, task_title)
  values (coalesce(ws, 'workforce'), kind, lower(target), coalesce(nullif(lower(actor_email), ''), 'system'),
          coalesce(nullif(actor_name, ''), 'Project Monitor'), msg, tid, ttitle) $$;

-- Tell a task's assignees about a change — skipped when the actor is one of
-- the assignees (owners don't get pinged about their own routine changes).
-- `also` adds extra assignee names (e.g. newly assigned people).
create or replace function private.notify_assignees(t public.tasks, kind text, msg text, actor_email text,
                                                    actor_name text, also text default null) returns void
  language plpgsql security definer set search_path = ''
  as $$
declare s public.staff; actor_staff public.staff; recipients text;
begin
  select * into actor_staff from public.staff where email = lower(coalesce(actor_email, ''));
  if actor_staff.id is not null and private.name_matches(actor_staff.name, t.assignee) then return; end if;
  recipients := concat_ws(',', t.assignee, also);
  for s in select * from public.staff loop
    continue when s.email = lower(coalesce(actor_email, ''));
    if private.name_matches(s.name, recipients) then
      perform private.notify(t.workspace, kind, s.email, actor_email, actor_name, msg, t.id, t.title);
    end if;
  end loop;
end $$;

-- @mentions: "@John Doe please check" → anyone whose name contains the
-- mention, or whose first name the mention contains.
create or replace function private.notify_mentions(t public.tasks, body text, actor_email text, actor_name text,
                                                   msg text) returns void
  language plpgsql security definer set search_path = ''
  as $$
declare m text; s public.staff;
begin
  for m in select lower(btrim(x[1])) from regexp_matches(coalesce(body, ''), '@([[:alnum:]_[:space:]]+?)(?=[@,.]|$)', 'g') x loop
    continue when m = '';
    for s in select * from public.staff loop
      continue when s.email = lower(coalesce(actor_email, ''));
      if strpos(lower(s.name), m) > 0 or strpos(m, split_part(lower(btrim(s.name)), ' ', 1)) > 0 then
        perform private.notify(t.workspace, 'mention', s.email, actor_email, actor_name, msg, t.id, t.title);
      end if;
    end loop;
  end loop;
end $$;

-- Tell the author of a note (first staff member whose name matches the writer).
create or replace function private.notify_writer(t public.tasks, writer text, kind text, msg text,
                                                 actor_email text, actor_name text) returns void
  language plpgsql security definer set search_path = ''
  as $$
declare s public.staff;
begin
  if coalesce(writer, '') = '' then return; end if;
  for s in select * from public.staff loop
    continue when s.email = lower(coalesce(actor_email, ''));
    if lower(s.name) = lower(writer) or strpos(lower(s.name), lower(writer)) > 0 then
      perform private.notify(t.workspace, kind, s.email, actor_email, actor_name, msg, t.id, t.title);
      return;
    end if;
  end loop;
end $$;

-- Manager oversight alerts (skips the actor and managers who are assignees).
create or replace function private.notify_managers(ws text, kind text, msg text, tid text, ttitle text,
                                                   actor_email text, actor_name text, assignees text default '')
  returns void
  language plpgsql security definer set search_path = ''
  as $$
declare s public.staff;
begin
  for s in select * from public.staff where role = 'Manager' loop
    continue when coalesce(actor_email, '') <> '' and s.email = lower(actor_email);
    continue when coalesce(actor_email, '') = '' and coalesce(actor_name, '') <> '' and lower(s.name) = lower(actor_name);
    continue when coalesce(assignees, '') <> '' and private.name_matches(s.name, assignees);
    perform private.notify(ws, kind, s.email, actor_email, actor_name, msg, tid, ttitle);
  end loop;
end $$;

create or replace function private.log(action text, target text, details text) returns void
  language sql security definer set search_path = ''
  as $$ insert into public.security_logs (action, user_email, target_email, details)
        values (action, coalesce(nullif(private.my_email(), ''), case when private.is_service() then 'server' else 'unknown' end),
                lower(coalesce(target, '')), details) $$;

create or replace function private.touch(tid text) returns void
  language sql security definer set search_path = ''
  as $$ update public.tasks set last_updated_at = now() where id = tid $$;

-- Who is acting: the signed-in staff member — or, for server calls (Task API),
-- the name it passes.
create or replace function private.actor_name(fallback text) returns text
  language sql stable security definer set search_path = ''
  as $$ select case when private.is_service() then coalesce(nullif(btrim(fallback), ''), 'External Update')
                    else coalesce(nullif(btrim(private.my_name()), ''), nullif(btrim(fallback), ''), private.my_email()) end $$;

-- Replace a task's milestones from a Convex-style array, KEEPING each
-- milestone's real created/completed times when the client didn't send them
-- (matched by name, nearest position). Fixes "editing a project resets its
-- deadlines" and "completing in the modal loses the completion time".
create or replace function private.replace_milestones(tid text, arr jsonb) returns void
  language plpgsql security definer set search_path = ''
  as $$
declare old jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object('position', position, 'name', name, 'completed', completed,
                                               'completed_at', completed_at, 'created_at', created_at)), '[]'::jsonb)
    into old from public.task_milestones where task_id = tid;
  delete from public.task_milestones where task_id = tid;
  insert into public.task_milestones (task_id, position, name, days, completed, completed_at, created_at)
  select tid, (e.ord - 1)::int,
         coalesce(nullif(btrim(e.v ->> 'name'), ''), 'Unnamed'),
         greatest(0, round(coalesce((e.v ->> 'days')::numeric, 0)))::int,
         coalesce((e.v ->> 'completed')::boolean, false),
         case when coalesce((e.v ->> 'completed')::boolean, false) then
           coalesce(private.from_ms(e.v -> 'completedAtTime'), case when om.completed then om.completed_at end, now()) end,
         -- Existing milestone: keep its created time (even if unknown/null).
         -- Only genuinely new milestones are stamped "now".
         coalesce(private.from_ms(e.v -> 'createdAtTime'), case when om.name is not null then om.created_at else now() end)
  from jsonb_array_elements(coalesce(arr, '[]'::jsonb)) with ordinality e(v, ord)
  left join lateral (
    select o.* from jsonb_to_recordset(old) o(position int, name text, completed boolean, completed_at timestamptz, created_at timestamptz)
    where o.name = e.v ->> 'name' order by abs(o.position - (e.ord - 1)) limit 1) om on true;
end $$;

-- Close gaps in a child table's positions after a delete (keeps array
-- indexes — which the UI still uses — lined up with rows).
create or replace function private.renumber(tbl text, tid text) returns void
  language plpgsql security definer set search_path = ''
  as $$
begin
  execute format(
    'update public.%I c set position = r.rn from (select id, row_number() over (order by position) - 1 as rn
       from public.%I where task_id = $1) r where c.id = r.id and c.position <> r.rn', tbl, tbl) using tid;
end $$;

-- Built-in milestone templates (mirror src/utils/defaults.js).
create or replace function private.fallback_milestones(ws text) returns jsonb
  language sql immutable set search_path = ''
  as $$ select case when ws = 'operations' then
    '[{"name":"Scope & Goals","days":5},{"name":"Plan & Design","days":7},{"name":"Review & Sign-off","days":3},
      {"name":"Prepare & Set Up","days":7},{"name":"Pilot / Test Run","days":10},{"name":"Train & Communicate","days":5},
      {"name":"Go-Live / Full Rollout","days":5},{"name":"Monitor & Hand Over","days":14}]'::jsonb
  else
    '[{"name":"Project Planning & Design","days":22},{"name":"Project Setup & Database","days":6},
      {"name":"Core Feature Development (Phase 1)","days":25},{"name":"Core Feature Development (Phase 2)","days":20},
      {"name":"API Integration","days":8},{"name":"Internal Testing & Bug Fixes","days":15},
      {"name":"User Testing & Refinement","days":20},{"name":"Final Polish & Optimization","days":15},
      {"name":"Deployment & Soft Launch","days":17},{"name":"Post-Launch Support","days":22}]'::jsonb end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- READ access (row level security). Writes go through the functions below.
-- ════════════════════════════════════════════════════════════════════════════
create policy staff_read on public.staff for select to authenticated
  using (private.is_approved() or email = private.my_email());
create policy tasks_read on public.tasks for select to authenticated using (private.can_access(workspace));
create policy task_milestones_read on public.task_milestones for select to authenticated using (private.can_access_task(task_id));
create policy task_notes_read on public.task_notes for select to authenticated using (private.can_access_task(task_id));
create policy task_features_read on public.task_features for select to authenticated using (private.can_access_task(task_id));
create policy note_replies_read on public.note_replies for select to authenticated using (private.can_access_note(note_id));
create policy note_reactions_read on public.note_reactions for select to authenticated using (private.can_access_note(note_id));
create policy feature_images_read on public.feature_images for select to authenticated using (private.can_access_feature(feature_id));
create policy task_views_read on public.task_views for select to authenticated using (user_email = private.my_email());
create policy notebook_read on public.notebook_ideas for select to authenticated using (private.can_access(workspace));
create policy announcements_read on public.announcements for select to authenticated using (private.can_access(workspace));
create policy announcement_views_read on public.announcement_views for select to authenticated using (user_email = private.my_email());
create policy handbooks_read on public.handbooks for select to authenticated using (private.can_access(workspace));
create policy workspace_settings_read on public.workspace_settings for select to authenticated using (private.can_access(workspace));
create policy notifications_read on public.notifications for select to authenticated using (target_email = private.my_email());
-- staff_credentials, task_credentials, workspace_passwords, security_logs,
-- presence: no policies → nobody but the server can read them.

-- ════════════════════════════════════════════════════════════════════════════
-- QUERIES
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.get_tasks_light(p_workspace text) returns jsonb
  language sql stable security definer set search_path = ''
  as $$ select coalesce(jsonb_agg(private.task_light_json(t) order by t.created_at), '[]'::jsonb)
        from public.tasks t where t.workspace = p_workspace and private.can_access(t.workspace) $$;

create or replace function public.get_tasks_full(p_workspace text) returns jsonb
  language sql stable security definer set search_path = ''
  as $$ select coalesce(jsonb_agg(private.task_full_json(t) order by t.created_at), '[]'::jsonb)
        from public.tasks t where t.workspace = p_workspace and private.can_access(t.workspace) $$;

create or replace function public.get_task(p_task_id text) returns jsonb
  language sql stable security definer set search_path = ''
  as $$ select private.task_full_json(t) from public.tasks t where t.id = p_task_id and private.can_access(t.workspace) $$;

-- Staff list (Revoked hidden, like before). `password` is only a "has one"
-- marker for the admin screen — never the hash.
create or replace function public.get_staff() returns jsonb
  language sql stable security definer set search_path = ''
  as $$
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
           '_id', s.id, '_creationTime', private.ms(s.created_at), 'name', s.name, 'email', s.email,
           'role', s.role, 'departments', to_jsonb(s.departments), 'avatarUrl', s.avatar_url, 'bio', s.bio,
           'country', s.country, 'status', s.status,
           'password', case when private.is_admin_level() and (c.password_hash is not null or c.auth_user_id is not null
                                  or exists (select 1 from auth.users u where lower(u.email) = s.email and u.encrypted_password is not null and u.encrypted_password <> ''))
                            then '********' end)) order by s.created_at), '[]'::jsonb)
  from public.staff s left join public.staff_credentials c on c.staff_id = s.id
  where s.role <> 'Revoked' and (private.is_approved() or s.email = private.my_email()) $$;

create or replace function public.get_my_profile() returns jsonb
  language sql stable security definer set search_path = ''
  as $$
  select jsonb_strip_nulls(jsonb_build_object(
    '_id', s.id, 'name', s.name, 'email', s.email, 'role', s.role, 'departments', to_jsonb(s.departments),
    'avatarUrl', s.avatar_url, 'bio', s.bio, 'country', s.country, 'status', s.status,
    'securityQuestion', c.security_question))
  from public.staff s left join public.staff_credentials c on c.staff_id = s.id
  where s.email = private.my_email() $$;

-- Workspace settings. workspacePasswordHash is now only a "protected" marker;
-- the entry password is checked server-side by verify_workspace_password.
create or replace function public.get_app_config(p_workspace text) returns jsonb
  language sql stable security definer set search_path = ''
  as $$
  select case when w.workspace is null and p.workspace is null then null else jsonb_strip_nulls(jsonb_build_object(
    'workspace', p_workspace, 'productionDeadline', private.ms(w.production_deadline),
    'defaultMilestones', w.default_milestones, 'columns', w.columns,
    'workspacePasswordHash', case when p.workspace is not null then 'protected' end,
    'updatedAt', private.ms(w.updated_at), 'updatedBy', w.updated_by)) end
  from (select 1) x
  left join public.workspace_settings w on w.workspace = p_workspace
  left join public.workspace_passwords p on p.workspace = p_workspace
  where private.can_access(p_workspace) $$;

create or replace function public.verify_workspace_password(p_workspace text, p_password_hash text) returns boolean
  language sql stable security definer set search_path = ''
  as $$ select private.can_access(p_workspace) and coalesce(
          (select p.password_hash = lower(p_password_hash) from public.workspace_passwords p where p.workspace = p_workspace), true) $$;

create or replace function public.get_announcements(p_workspace text) returns jsonb
  language sql stable security definer set search_path = ''
  as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           '_id', a.id, 'workspace', a.workspace, 'title', a.title, 'body', a.body, 'postedBy', a.posted_by,
           'postedByEmail', a.posted_by_email, 'createdAt', private.ms(a.created_at),
           'seenBy', coalesce((select jsonb_agg(v.user_email) from public.announcement_views v where v.announcement_id = a.id
                               and (private.is_admin_plus() or v.user_email = private.my_email())), '[]'::jsonb))
           order by a.created_at desc), '[]'::jsonb)
  from public.announcements a where a.workspace = p_workspace and private.can_access(a.workspace) $$;

create or replace function public.get_unseen_announcement(p_workspace text) returns jsonb
  language sql stable security definer set search_path = ''
  as $$
  select jsonb_build_object('_id', a.id, 'workspace', a.workspace, 'title', a.title, 'body', a.body,
                            'postedBy', a.posted_by, 'postedByEmail', a.posted_by_email,
                            'createdAt', private.ms(a.created_at), 'seenBy', '[]'::jsonb)
  from public.announcements a
  where a.workspace = p_workspace and private.can_access(a.workspace)
    and not exists (select 1 from public.announcement_views v where v.announcement_id = a.id and v.user_email = private.my_email())
  order by a.created_at asc limit 1 $$;

create or replace function public.get_ideas(p_workspace text) returns jsonb
  language sql stable security definer set search_path = ''
  as $$
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
           '_id', i.id, '_creationTime', private.ms(i.created_at), 'workspace', i.workspace, 'name', i.name,
           'description', i.description, 'pros', i.pros, 'cons', i.cons, 'details', i.details,
           'date', private.ny_text(i.created_at), 'taker', i.taker)) order by i.created_at), '[]'::jsonb)
  from public.notebook_ideas i where i.workspace = p_workspace and private.can_access(i.workspace) $$;

create or replace function public.get_handbook(p_workspace text) returns jsonb
  language sql stable security definer set search_path = ''
  as $$
  select jsonb_strip_nulls(jsonb_build_object('_id', h.workspace, 'workspace', h.workspace, 'blocks', h.blocks,
                                              'updatedAt', private.ms(h.updated_at), 'updatedBy', h.updated_by))
  from public.handbooks h where h.workspace = p_workspace and private.can_access(h.workspace) $$;

create or replace function public.get_notifications(p_workspace text) returns jsonb
  language sql stable security definer set search_path = ''
  as $$
  select coalesce(jsonb_agg(x.j order by x.created_at desc), '[]'::jsonb) from (
    select n.created_at, jsonb_strip_nulls(jsonb_build_object(
             '_id', n.id, 'workspace', n.workspace, 'type', n.type, 'targetEmail', n.target_email,
             'actorEmail', n.actor_email, 'actorName', n.actor_name, 'message', n.message, 'taskId', n.task_id,
             'taskTitle', n.task_title, 'read', n.read, 'createdAt', private.ms(n.created_at))) j
    from public.notifications n
    where n.target_email = private.my_email() and n.workspace = p_workspace
    order by n.created_at desc limit 50) x $$;

create or replace function public.get_unread_count(p_workspace text) returns integer
  language sql stable security definer set search_path = ''
  as $$ select count(*)::int from public.notifications n
        where n.target_email = private.my_email() and n.workspace = p_workspace and not n.read $$;

create or replace function public.get_task_view_history(p_task_id text) returns bigint
  language sql stable security definer set search_path = ''
  as $$ select coalesce((select private.ms(v.last_viewed_at) from public.task_views v
                         where v.task_id = p_task_id and v.user_email = private.my_email()), 0) $$;

-- ════════════════════════════════════════════════════════════════════════════
-- TASK MUTATIONS
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.add_task(p_workspace text, p_title text, p_assignee text, p_description text,
                                           p_milestones jsonb, p_start_date text default null) returns text
  language plpgsql security definer set search_path = ''
  as $$
declare new_id text;
begin
  perform private.require(private.can_access(coalesce(p_workspace, 'workforce')));
  insert into public.tasks (workspace, title, assignee, description, start_date)
  values (coalesce(p_workspace, 'workforce'), p_title, coalesce(p_assignee, ''), coalesce(p_description, ''),
          case when p_start_date ~ '^\d{4}-\d{2}-\d{2}$' then p_start_date::date end)
  returning id into new_id;
  perform private.replace_milestones(new_id, p_milestones);
  return new_id;
end $$;

create or replace function public.update_task_status(p_task_id text, p_status text) returns void
  language plpgsql security definer set search_path = ''
  as $$
begin
  perform private.require_task(p_task_id);
  update public.tasks set status = p_status, last_updated_at = now(),
    -- Countdowns start the first time a project leaves To Do.
    pending_started_at = case when lower(p_status) <> 'todo' and pending_started_at is null then now() else pending_started_at end
  where id = p_task_id;
end $$;

create or replace function public.update_task_milestones(p_task_id text, p_milestones jsonb, p_actor_name text default null)
  returns void
  language plpgsql security definer set search_path = ''
  as $$
declare t public.tasks; newly text;
begin
  t := private.require_task(p_task_id);
  -- First milestone that is complete now but wasn't before (by position).
  select e.v ->> 'name' into newly
  from jsonb_array_elements(coalesce(p_milestones, '[]'::jsonb)) with ordinality e(v, ord)
  left join public.task_milestones m on m.task_id = p_task_id and m.position = e.ord - 1
  where coalesce((e.v ->> 'completed')::boolean, false) and not coalesce(m.completed, false)
  order by e.ord limit 1;
  perform private.replace_milestones(p_task_id, p_milestones);
  perform private.touch(p_task_id);
  if newly is not null and not private.is_service() then
    perform private.notify_assignees(t, 'project_change', format('completed milestone "%s" on "%s"', newly, t.title),
                                     private.my_email(), private.actor_name(p_actor_name));
  end if;
end $$;

create or replace function public.add_note_to_task(p_task_id text, p_text text, p_writer text default null,
                                                   p_actor_email text default null) returns jsonb
  language plpgsql security definer set search_path = ''
  as $$
declare t public.tasks; n public.task_notes; who text; actor text;
begin
  t := private.require_task(p_task_id);
  who := private.actor_name(p_writer);
  actor := case when private.is_service() then coalesce(p_actor_email, '') else private.my_email() end;
  insert into public.task_notes (task_id, position, text, writer)
  values (p_task_id, coalesce((select max(position) + 1 from public.task_notes where task_id = p_task_id), 0), p_text, who)
  returning * into n;
  perform private.touch(p_task_id);
  perform private.notify_assignees(t, 'project_change', format('added a note on "%s"', t.title), actor, who);
  perform private.notify_mentions(t, p_text, actor, who, format('mentioned you in a note on "%s"', t.title));
  return private.note_json(n);
end $$;

create or replace function public.add_note_reply(p_task_id text, p_note_index int, p_text text, p_writer text default null)
  returns void
  language plpgsql security definer set search_path = ''
  as $$
declare t public.tasks; n public.task_notes; who text; actor text;
begin
  t := private.require_task(p_task_id);
  select * into n from public.task_notes where task_id = p_task_id and position = p_note_index;
  if not found then return; end if;
  who := private.actor_name(p_writer);
  actor := private.my_email();
  insert into public.note_replies (note_id, position, text, writer)
  values (n.id, coalesce((select max(position) + 1 from public.note_replies where note_id = n.id), 0), p_text, who);
  perform private.notify_writer(t, n.writer, 'project_change', format('replied to your note on "%s"', t.title), actor, who);
  perform private.notify_mentions(t, p_text, actor, who, format('mentioned you in a reply on "%s"', t.title));
end $$;

create or replace function public.toggle_note_reaction(p_task_id text, p_note_index int, p_reaction text) returns void
  language plpgsql security definer set search_path = ''
  as $$
declare t public.tasks; n public.task_notes; me text := private.my_email(); emoji text;
begin
  t := private.require_task(p_task_id);
  perform private.require(me <> '', 'Sign in to react.');
  select * into n from public.task_notes where task_id = p_task_id and position = p_note_index;
  if not found then return; end if;
  delete from public.note_reactions where note_id = n.id and user_email = me and reaction = p_reaction;
  if not found then
    insert into public.note_reactions (note_id, user_email, reaction) values (n.id, me, p_reaction);
    emoji := case p_reaction when 'like' then '👍' when 'wow' then '😮' when 'heart' then '❤️' when 'haha' then '😂' else p_reaction end;
    perform private.notify_writer(t, n.writer, 'reaction', format('reacted %s to your note on "%s"', emoji, t.title),
                                  me, private.actor_name(null));
  end if;
end $$;

create or replace function public.delete_task_notes_bulk(p_task_id text, p_indices int[]) returns void
  language plpgsql security definer set search_path = ''
  as $$
begin
  perform private.require_task(p_task_id);
  delete from public.task_notes where task_id = p_task_id and position = any (p_indices);
  perform private.renumber('task_notes', p_task_id);
  perform private.touch(p_task_id);
end $$;

create or replace function public.delete_task_milestones_bulk(p_task_id text, p_indices int[]) returns void
  language plpgsql security definer set search_path = ''
  as $$
begin
  perform private.require_task(p_task_id);
  delete from public.task_milestones where task_id = p_task_id and position = any (p_indices);
  perform private.renumber('task_milestones', p_task_id);
  perform private.touch(p_task_id);
end $$;

-- Soft delete (→ Scrapped Yard) by default; permanent delete only from the
-- archive, and only for Admin-level users.
create or replace function public.delete_task(p_task_id text, p_source text default null) returns void
  language plpgsql security definer set search_path = ''
  as $$
declare t public.tasks;
begin
  select * into t from public.tasks where id = p_task_id;
  if not found then return; end if;
  perform private.require(private.can_access(t.workspace));
  if p_source = 'archive' then
    perform private.require(private.is_admin_level(), 'Only Admins can permanently delete projects.');
    delete from public.tasks where id = p_task_id;
    perform private.log('PROJECT_DELETED_PERMANENTLY', private.my_email(),
                        format('Permanently deleted project "%s" (assignee: %s) from archive.', t.title, coalesce(nullif(t.assignee, ''), 'Unassigned')));
  else
    update public.tasks set status = 'scrapped', last_updated_at = now() where id = p_task_id;
    perform private.log('PROJECT_ARCHIVED', private.my_email(),
                        format('Archived/Soft-deleted project "%s" (assignee: %s) from %s.', t.title, coalesce(nullif(t.assignee, ''), 'Unassigned'), coalesce(p_source, 'unknown')));
  end if;
end $$;

create or replace function public.update_task_details(p_task_id text, p_title text, p_description text, p_assignee text,
                                                      p_appscript_link text, p_webapp_link text, p_milestones jsonb,
                                                      p_actor_name text default null) returns void
  language plpgsql security definer set search_path = ''
  as $$
declare t public.tasks;
begin
  t := private.require_task(p_task_id);
  perform private.replace_milestones(p_task_id, p_milestones);
  update public.tasks set title = p_title, description = coalesce(p_description, ''), assignee = coalesce(p_assignee, ''),
    appscript_link = nullif(p_appscript_link, ''), webapp_link = nullif(p_webapp_link, ''), last_updated_at = now()
  where id = p_task_id;
  if not private.is_service() then
    -- old + new assignees hear about it (unless the actor is an old assignee)
    perform private.notify_assignees(t, 'project_change', format('updated project details for "%s"', p_title),
                                     private.my_email(), private.actor_name(p_actor_name), p_assignee);
  end if;
end $$;

-- Patch only the links that are present in p_links ({appscriptLink, webappLink, projectLink}).
create or replace function public.update_task_links(p_task_id text, p_links jsonb) returns jsonb
  language plpgsql security definer set search_path = ''
  as $$
declare t public.tasks;
begin
  perform private.require_task(p_task_id);
  update public.tasks set
    appscript_link = case when p_links ? 'appscriptLink' then nullif(p_links ->> 'appscriptLink', '') else appscript_link end,
    webapp_link    = case when p_links ? 'webappLink' then nullif(p_links ->> 'webappLink', '') else webapp_link end,
    project_link   = case when p_links ? 'projectLink' then nullif(p_links ->> 'projectLink', '') else project_link end,
    last_updated_at = now()
  where id = p_task_id returning * into t;
  return jsonb_strip_nulls(jsonb_build_object('appscriptLink', t.appscript_link, 'webappLink', t.webapp_link, 'projectLink', t.project_link));
end $$;

create or replace function public.update_project_link(p_task_id text, p_project_link text) returns void
  language plpgsql security definer set search_path = ''
  as $$
begin
  perform private.require_task(p_task_id);
  update public.tasks set project_link = nullif(p_project_link, ''), last_updated_at = now() where id = p_task_id;
end $$;

create or replace function public.update_admin_credentials(p_task_id text, p_email text, p_password text) returns void
  language plpgsql security definer set search_path = ''
  as $$
begin
  perform private.require_task(p_task_id);
  insert into public.task_credentials (task_id, login_email, login_password, updated_at)
  values (p_task_id, p_email, p_password, now())
  on conflict (task_id) do update set login_email = excluded.login_email, login_password = excluded.login_password, updated_at = now();
  perform private.touch(p_task_id);
end $$;

create or replace function public.set_task_deadline(p_task_id text, p_deadline_ms bigint) returns void
  language plpgsql security definer set search_path = ''
  as $$
begin
  perform private.require_task(p_task_id);
  perform private.require(private.is_admin_level(), 'Only Admins can set a project deadline.');
  -- Deliberately doesn't touch last_updated_at (it anchors computed deadlines).
  update public.tasks set deadline_override = case when p_deadline_ms is null then null else to_timestamp(p_deadline_ms / 1000.0) end
  where id = p_task_id;
end $$;

-- Max 3 prioritized projects per assignee, per workspace.
create or replace function public.toggle_task_priority(p_task_id text, p_is_prioritized boolean) returns void
  language plpgsql security definer set search_path = ''
  as $$
declare t public.tasks; a text; n int;
begin
  t := private.require_task(p_task_id);
  if p_is_prioritized then
    for a in select btrim(x) from unnest(string_to_array(lower(t.assignee), ',')) x where btrim(x) <> '' loop
      select count(*) into n from public.tasks o
      where o.workspace = t.workspace and o.id <> t.id and o.is_prioritized
        and a = any (select btrim(y) from unnest(string_to_array(lower(o.assignee), ',')) y);
      if n >= 3 then
        raise exception 'Cannot prioritize: Assignee "%" already has 3 prioritized projects.', a;
      end if;
    end loop;
  end if;
  update public.tasks set is_prioritized = p_is_prioritized, last_updated_at = now() where id = p_task_id;
end $$;

create or replace function public.mark_task_viewed(p_task_id text) returns void
  language plpgsql security definer set search_path = ''
  as $$
begin
  perform private.require_task(p_task_id);
  if private.my_email() = '' then return; end if;
  insert into public.task_views (task_id, user_email, last_viewed_at) values (p_task_id, private.my_email(), now())
  on conflict (task_id, user_email) do update set last_viewed_at = now();
end $$;

-- ── Features & bugs ─────────────────────────────────────────────────────────
create or replace function private.set_feature_images(fid text, ids jsonb) returns void
  language sql security definer set search_path = ''
  as $$
  delete from public.feature_images where feature_id = fid;
  insert into public.feature_images (feature_id, position, storage_path)
  select fid, (e.ord - 1)::int, e.v #>> '{}' from jsonb_array_elements(coalesce(ids, '[]'::jsonb)) with ordinality e(v, ord);
  $$;

create or replace function public.add_task_feature(p_task_id text, p_feature jsonb, p_actor_name text default null,
                                                   p_actor_email text default null) returns text
  language plpgsql security definer set search_path = ''
  as $$
declare t public.tasks; fid text; is_bug boolean := (p_feature ->> 'type') = 'bug'; who text; actor text; fname text := p_feature ->> 'name';
begin
  t := private.require_task(p_task_id);
  who := private.actor_name(coalesce(p_actor_name, p_feature ->> 'suggestedBy'));
  actor := case when private.is_service() then coalesce(p_actor_email, '') else private.my_email() end;
  insert into public.task_features (id, task_id, position, type, name, description, status, suggested_by, created_at)
  values (coalesce(nullif(p_feature ->> 'id', ''), gen_random_uuid()::text), p_task_id,
          coalesce((select max(position) + 1 from public.task_features where task_id = p_task_id), 0),
          case when is_bug then 'bug' else 'feature' end, fname, coalesce(p_feature ->> 'description', ''),
          case when p_feature ->> 'status' = 'completed' then 'completed' else 'pending' end,
          coalesce(nullif(p_feature ->> 'suggestedBy', ''), who), now())
  returning id into fid;
  perform private.set_feature_images(fid, p_feature -> 'imageStorageIds');
  perform private.touch(p_task_id);
  if actor <> '' then
    perform private.notify_assignees(t, 'project_change',
      format('added %s "%s" to "%s"', case when is_bug then 'a bug' else 'a feature' end, fname, t.title), actor, who);
  end if;
  perform private.notify_managers(t.workspace, case when is_bug then 'manager_bug' else 'manager_feature' end,
    case when is_bug then format('reported a bug "%s" on "%s"', fname, t.title) else format('added a feature "%s" to "%s"', fname, t.title) end,
    t.id, t.title, actor, who, t.assignee);
  return fid;
end $$;

create or replace function public.update_feature_status(p_task_id text, p_feature_id text, p_status text,
                                                        p_writer text default null) returns void
  language plpgsql security definer set search_path = ''
  as $$
declare t public.tasks; f public.task_features;
begin
  t := private.require_task(p_task_id);
  select * into f from public.task_features where id = p_feature_id and task_id = p_task_id;
  if not found or f.status = p_status then return; end if;
  update public.task_features set status = p_status,
    completed_at = case when p_status = 'completed' then now() end
  where id = p_feature_id;
  perform private.touch(p_task_id);
  if p_status = 'completed' then
    perform private.notify_managers(t.workspace, 'manager_feature',
      format('completed the %s "%s" on "%s"', case when f.type = 'bug' then 'bug fix' else 'feature' end, f.name, t.title),
      t.id, t.title, '', private.actor_name(p_writer));
  end if;
end $$;

-- p_updates: { name, description, imageStorageIds? }
create or replace function public.update_task_feature(p_task_id text, p_feature_id text, p_updates jsonb) returns void
  language plpgsql security definer set search_path = ''
  as $$
begin
  perform private.require_task(p_task_id);
  update public.task_features set name = coalesce(p_updates ->> 'name', name),
    description = coalesce(p_updates ->> 'description', description)
  where id = p_feature_id and task_id = p_task_id;
  if not found then return; end if;
  if p_updates ? 'imageStorageIds' then perform private.set_feature_images(p_feature_id, p_updates -> 'imageStorageIds'); end if;
  perform private.touch(p_task_id);
end $$;

create or replace function public.delete_task_feature(p_task_id text, p_feature_id text) returns void
  language plpgsql security definer set search_path = ''
  as $$
begin
  perform private.require_task(p_task_id);
  delete from public.task_features where id = p_feature_id and task_id = p_task_id;
  perform private.renumber('task_features', p_task_id);
  perform private.touch(p_task_id);
end $$;

create or replace function public.delete_task_features_bulk(p_task_id text, p_feature_ids text[]) returns void
  language plpgsql security definer set search_path = ''
  as $$
begin
  perform private.require_task(p_task_id);
  delete from public.task_features where task_id = p_task_id and id = any (p_feature_ids);
  perform private.renumber('task_features', p_task_id);
  perform private.touch(p_task_id);
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- STAFF (sign-in itself lives in /api/auth)
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.add_staff(p_name text, p_email text, p_role text, p_departments text[] default null)
  returns void
  language plpgsql security definer set search_path = ''
  as $$
begin
  perform private.require(private.is_admin_plus(), 'Only Admin+ and Managers can add staff.');
  insert into public.staff (name, email, role, departments)
  values (p_name, lower(btrim(p_email)), p_role, coalesce(p_departments, array['Workforce']))
  on conflict (email) do nothing;
  perform private.log('STAFF_ADDED', p_email, format('Added as %s', p_role));
end $$;

create or replace function public.update_staff_role(p_staff_email text, p_new_role text) returns void
  language plpgsql security definer set search_path = ''
  as $$
begin
  perform private.require(private.is_admin_plus(), 'Only Admin+ and Managers can change roles.');
  perform private.require(lower(p_staff_email) <> private.my_email(), 'You cannot change your own role.');
  perform private.require(p_new_role in ('Programmer', 'Admin', 'Admin+', 'Manager', 'Pending', 'Revoked'), 'Unknown role.');
  update public.staff set role = p_new_role where email = lower(p_staff_email);
  perform private.log('ROLE_CHANGED', p_staff_email, format('Role updated to: %s', p_new_role));
end $$;

create or replace function public.update_staff_department(p_staff_email text, p_departments text[]) returns void
  language plpgsql security definer set search_path = ''
  as $$
begin
  perform private.require(private.is_manager(), 'Only Managers can change department membership.');
  perform private.require(lower(p_staff_email) <> private.my_email(), 'You cannot change your own department membership.');
  update public.staff set departments = (select coalesce(array_agg(d), '{}') from unnest(p_departments) d
                                         where d in ('Executives', 'Operations', 'Workforce'))
  where email = lower(p_staff_email);
  perform private.log('DEPARTMENT_CHANGED', p_staff_email,
                      format('Departments updated to: %s', coalesce(nullif(array_to_string(p_departments, ', '), ''), '(none)')));
end $$;

-- "Delete" = revoke access (the row stays for history).
create or replace function public.delete_staff(p_email text) returns void
  language plpgsql security definer set search_path = ''
  as $$
begin
  perform private.require(private.is_admin_plus(), 'Only Admin+ and Managers can revoke access.');
  perform private.require(lower(p_email) <> private.my_email(), 'You cannot revoke your own access.');
  update public.staff set role = 'Revoked' where email = lower(p_email);
  perform private.log('ACCESS_REVOKED', p_email, 'Access revoked.');
end $$;

-- Your OWN profile only. Keys present in p_fields are updated (null clears).
create or replace function public.update_profile(p_fields jsonb) returns void
  language plpgsql security definer set search_path = ''
  as $$
begin
  perform private.require(private.my_email() <> '', 'Sign in first.');
  update public.staff set
    name       = case when p_fields ? 'name' and nullif(btrim(p_fields ->> 'name'), '') is not null then btrim(p_fields ->> 'name') else name end,
    bio        = case when p_fields ? 'bio' then p_fields ->> 'bio' else bio end,
    avatar_url = case when p_fields ? 'avatarUrl' then p_fields ->> 'avatarUrl' else avatar_url end,
    country    = case when p_fields ? 'country' then p_fields ->> 'country' else country end,
    status     = case when p_fields ? 'status' then p_fields ->> 'status' else status end
  where email = private.my_email();
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- WORKSPACE SETTINGS, NOTEBOOK, ANNOUNCEMENTS, HANDBOOK, NOTIFICATIONS
-- ════════════════════════════════════════════════════════════════════════════
-- p_fields keys (only present ones change): productionDeadline (ms|null),
-- defaultMilestones, columns, workspacePasswordHash (sha256 hex | null/"" = remove)
create or replace function public.save_app_config(p_workspace text, p_fields jsonb) returns void
  language plpgsql security definer set search_path = ''
  as $$
begin
  perform private.require(private.can_access(p_workspace) and private.is_admin_plus(), 'Only Admin+ and Managers can change workspace defaults.');
  insert into public.workspace_settings (workspace, updated_by) values (p_workspace, private.actor_name(null))
  on conflict (workspace) do nothing;
  update public.workspace_settings set
    production_deadline = case when p_fields ? 'productionDeadline' then private.from_ms(p_fields -> 'productionDeadline') else production_deadline end,
    default_milestones  = case when p_fields ? 'defaultMilestones' then p_fields -> 'defaultMilestones' else default_milestones end,
    columns             = case when p_fields ? 'columns' then p_fields -> 'columns' else columns end,
    updated_at = now(), updated_by = private.actor_name(p_fields ->> 'updatedBy')
  where workspace = p_workspace;
  if p_fields ? 'workspacePasswordHash' then
    if coalesce(p_fields ->> 'workspacePasswordHash', '') = '' then
      delete from public.workspace_passwords where workspace = p_workspace;
    else
      insert into public.workspace_passwords (workspace, password_hash) values (p_workspace, lower(p_fields ->> 'workspacePasswordHash'))
      on conflict (workspace) do update set password_hash = excluded.password_hash, updated_at = now();
    end if;
  end if;
end $$;

create or replace function public.add_idea(p_workspace text, p_name text, p_description text, p_pros text default '',
                                           p_cons text default '', p_details text default '') returns void
  language plpgsql security definer set search_path = ''
  as $$
begin
  perform private.require(private.can_access(coalesce(p_workspace, 'workforce')));
  insert into public.notebook_ideas (workspace, name, description, pros, cons, details)
  values (coalesce(p_workspace, 'workforce'), p_name, coalesce(p_description, ''), coalesce(p_pros, ''), coalesce(p_cons, ''), coalesce(p_details, ''));
end $$;

create or replace function public.delete_idea(p_idea_id text) returns void
  language plpgsql security definer set search_path = ''
  as $$
declare ws text;
begin
  select workspace into ws from public.notebook_ideas where id = p_idea_id;
  if ws is null then return; end if;
  perform private.require(private.can_access(ws));
  delete from public.notebook_ideas where id = p_idea_id;
end $$;

-- Take an idea → it becomes a project assigned to the taker, then leaves the notebook.
create or replace function public.take_idea(p_idea_id text, p_taker_name text default null) returns text
  language plpgsql security definer set search_path = ''
  as $$
declare i public.notebook_ideas; template jsonb; descr text; new_id text;
begin
  select * into i from public.notebook_ideas where id = p_idea_id;
  if not found then return null; end if;
  perform private.require(private.can_access(i.workspace));
  select coalesce(nullif(w.default_milestones, '[]'::jsonb), private.fallback_milestones(i.workspace)) into template
  from (select 1) x left join public.workspace_settings w on w.workspace = i.workspace;
  descr := concat_ws(E'\n\n', nullif(i.description, ''), 'Pros: ' || nullif(i.pros, ''), 'Cons: ' || nullif(i.cons, ''), nullif(i.details, ''));
  insert into public.tasks (workspace, title, assignee, description)
  values (i.workspace, i.name, private.actor_name(p_taker_name), coalesce(descr, ''))
  returning id into new_id;
  perform private.replace_milestones(new_id, template);
  delete from public.notebook_ideas where id = p_idea_id;
  return new_id;
end $$;

create or replace function public.post_announcement(p_workspace text, p_title text, p_body text) returns void
  language plpgsql security definer set search_path = ''
  as $$
begin
  perform private.require(private.can_access(coalesce(p_workspace, 'workforce')) and private.is_admin_plus(),
                          'Only Admin+ and Managers can post announcements.');
  insert into public.announcements (workspace, title, body, posted_by, posted_by_email)
  values (coalesce(p_workspace, 'workforce'), p_title, p_body, private.actor_name(null), private.my_email());
end $$;

create or replace function public.mark_announcement_seen(p_announcement_id text) returns void
  language plpgsql security definer set search_path = ''
  as $$
begin
  if private.my_email() = '' then return; end if;
  insert into public.announcement_views (announcement_id, user_email) values (p_announcement_id, private.my_email())
  on conflict do nothing;
end $$;

create or replace function public.delete_announcement(p_announcement_id text) returns void
  language plpgsql security definer set search_path = ''
  as $$
declare ws text;
begin
  select workspace into ws from public.announcements where id = p_announcement_id;
  if ws is null then return; end if;
  perform private.require(private.can_access(ws) and private.is_admin_plus(), 'Only Admin+ and Managers can delete announcements.');
  delete from public.announcements where id = p_announcement_id;
end $$;

create or replace function public.save_handbook(p_workspace text, p_blocks jsonb) returns void
  language plpgsql security definer set search_path = ''
  as $$
begin
  perform private.require(private.can_access(coalesce(p_workspace, 'workforce')) and private.is_admin_plus(),
                          'Only Admin+ and Managers can edit the handbook.');
  insert into public.handbooks (workspace, blocks, updated_at, updated_by)
  values (coalesce(p_workspace, 'workforce'), coalesce(p_blocks, '[]'::jsonb), now(), private.actor_name(null))
  on conflict (workspace) do update set blocks = excluded.blocks, updated_at = now(), updated_by = excluded.updated_by;
end $$;

create or replace function public.mark_notification_read(p_notification_id text) returns void
  language sql security definer set search_path = ''
  as $$ update public.notifications set read = true where id = p_notification_id and target_email = private.my_email() $$;

create or replace function public.mark_all_notifications_read(p_workspace text) returns void
  language sql security definer set search_path = ''
  as $$ update public.notifications set read = true
        where target_email = private.my_email() and workspace = p_workspace and not read $$;

-- Server-only: does a Supabase Auth account exist for this email? (/api/auth)
create or replace function public.auth_account_status(p_email text) returns jsonb
  language sql stable security definer set search_path = ''
  as $$ select jsonb_build_object('authUserId', (select u.id from auth.users u where lower(u.email) = lower(p_email) limit 1)) $$;

-- ════════════════════════════════════════════════════════════════════════════
-- Daily manager scan (was the Convex cron): overdue + stalled (5+ days) alerts.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function private.completion_due(t public.tasks) returns timestamptz
  language plpgsql stable security definer set search_path = ''
  as $$
declare idx int; anchor timestamptz; remaining int; computed timestamptz;
begin
  select min(position) into idx from public.task_milestones where task_id = t.id and not completed;
  if idx is null then return t.deadline_override; end if;
  if lower(t.status) <> 'todo' then
    anchor := case when idx > 0 then (select coalesce(completed_at, created_at) from public.task_milestones
                                      where task_id = t.id and position = idx - 1) end;
    anchor := coalesce(anchor, t.pending_started_at, t.last_updated_at);
    select sum(days) into remaining from public.task_milestones where task_id = t.id and position >= idx;
    computed := anchor + make_interval(days => coalesce(remaining, 0));
  end if;
  return coalesce(t.deadline_override, computed);
end $$;

create or replace function private.scan_projects_for_managers() returns void
  language plpgsql security definer set search_path = ''
  as $$
declare t public.tasks; due timestamptz; done boolean; days_late int; idle int;
begin
  if not exists (select 1 from public.staff where role = 'Manager') then return; end if;
  for t in select * from public.tasks where lower(status) not in ('done', 'implemented', 'scrapped', 'scrapyard') loop
    done := exists (select 1 from public.task_milestones where task_id = t.id)
            and not exists (select 1 from public.task_milestones where task_id = t.id and not completed);
    due := case when done then null else private.completion_due(t) end;
    if due is not null and due < now() and t.manager_late_notified_at is null then
      days_late := floor(extract(epoch from now() - due) / 86400);
      perform private.notify_managers(t.workspace, 'manager_overdue',
        format('flagged "%s" as overdue — completion was due %s%s', t.title, to_char(due at time zone 'America/New_York', 'Mon FMDD, YYYY'),
               case when days_late > 0 then format(' (%sd late)', days_late) else '' end),
        t.id, t.title, '', '');
      update public.tasks set manager_late_notified_at = now() where id = t.id;
    elsif not (due is not null and due < now()) and t.manager_late_notified_at is not null then
      update public.tasks set manager_late_notified_at = null where id = t.id;
    end if;
    if now() - t.last_updated_at >= interval '5 days'
       and coalesce(t.manager_stale_notified_at, '-infinity'::timestamptz) < t.last_updated_at then
      idle := floor(extract(epoch from now() - t.last_updated_at) / 86400);
      perform private.notify_managers(t.workspace, 'manager_stale',
        format('flagged "%s" — no activity for %s days (no notes or milestone movement)', t.title, idle),
        t.id, t.title, '', '');
      update public.tasks set manager_stale_notified_at = now() where id = t.id;
    end if;
  end loop;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- Grants: RPCs are for signed-in users (each checks permissions itself);
-- the anonymous key can call none of them. auth_account_status is server-only.
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig, p.proname from pg_proc p
           where p.pronamespace = 'public'::regnamespace and p.proname <> 'is_workspace' loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    if f.proname = 'auth_account_status' then
      execute format('revoke execute on function %s from authenticated', f.sig);
      execute format('grant execute on function %s to service_role', f.sig);
    else
      execute format('grant execute on function %s to authenticated, service_role', f.sig);
    end if;
  end loop;
  for f in select p.oid::regprocedure as sig from pg_proc p where p.pronamespace = 'private'::regnamespace loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated, service_role', f.sig);
  end loop;
end $$;

-- Live updates: publish changes so open boards refresh instantly.
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['tasks', 'task_milestones', 'task_notes', 'note_replies', 'note_reactions', 'task_features',
                             'feature_images', 'notebook_ideas', 'announcements', 'announcement_views', 'handbooks',
                             'workspace_settings', 'notifications', 'staff'] loop
      begin
        execute format('alter publication supabase_realtime add table public.%I', t);
      exception when duplicate_object then null; -- already published
      end;
    end loop;
  end if;
end $$;

-- Feature screenshots: signed-in, approved staff can view and upload.
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    execute $p$create policy "feature images: approved staff read" on storage.objects for select to authenticated
              using (bucket_id = 'feature-images' and private.is_approved())$p$;
    execute $p$create policy "feature images: approved staff upload" on storage.objects for insert to authenticated
              with check (bucket_id = 'feature-images' and private.is_approved())$p$;
  end if;
end $$;

-- Daily scan at 01:00 UTC (~09:00 Manila), like the old Convex cron.
do $$
begin
  create extension if not exists pg_cron with schema pg_catalog;
  perform cron.schedule('manager-project-scan', '0 1 * * *', 'select private.scan_projects_for_managers()');
exception when others then
  raise notice 'pg_cron unavailable (%). Enable it under Database → Extensions, then run: select cron.schedule(''manager-project-scan'', ''0 1 * * *'', ''select private.scan_projects_for_managers()'');', sqlerrm;
end $$;
