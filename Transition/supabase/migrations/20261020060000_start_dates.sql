-- ============================================================================
-- Start dates are required, and a project starts on its start date.
--
-- • Every new project needs a start date (New Task, Caddy, taking a notebook
--   idea).
-- • When a project's start date arrives it moves from To Do to Pending on its
--   own — right away when it's created with today's (or an earlier) date, and
--   otherwise within ~10 minutes of midnight (Manila time) on that date. Its
--   clock starts on the start date, so the deadline matches what New Task showed.
-- • Only projects that have never started are moved: one that was started and
--   then dragged back to To Do on purpose stays there (its clock keeps running).
-- ============================================================================

-- The team's calendar day.
create or replace function private.org_today() returns date
  language sql stable set search_path = ''
  as $$ select (now() at time zone 'Asia/Manila')::date $$;

-- The column a starting project moves to: "pending" if the workspace has it,
-- otherwise the board's second column.
create or replace function private.start_column(ws text) returns text
  language sql stable security definer set search_path = ''
  as $$ select coalesce(
           (select 'pending' from public.workspace_settings s
             where s.workspace = ws and s.columns @> '[{"id": "pending"}]'::jsonb),
           (select c ->> 'id' from public.workspace_settings s,
                   jsonb_array_elements(case when jsonb_typeof(s.columns) = 'array' then s.columns else '[]'::jsonb end)
                   with ordinality e(c, o)
             where s.workspace = ws and o = 2),
           'pending') $$;

-- When the clock starts for a project whose start date has come: that date
-- (Manila midnight) — unless it's more than a day ago (an old backlog item),
-- then now, so it isn't overdue the moment it moves.
create or replace function private.start_anchor(d date) returns timestamptz
  language sql stable set search_path = ''
  as $$ select case when d >= private.org_today() - 1 then (d::timestamp at time zone 'Asia/Manila') else now() end $$;

-- Move every never-started To Do project whose start date has arrived.
create or replace function private.start_due_projects() returns int
  language plpgsql security definer set search_path = ''
  as $$
declare n int;
begin
  update public.tasks t
     set status = private.start_column(t.workspace),
         pending_started_at = private.start_anchor(t.start_date),
         last_updated_at = now()
   where lower(t.status) = 'todo'
     and t.pending_started_at is null
     and t.start_date is not null
     and t.start_date <= private.org_today();
  get diagnostics n = row_count;
  return n;
end $$;

-- A valid start date, or a clear error.
create or replace function private.require_start(p text) returns date
  language plpgsql immutable set search_path = ''
  as $$
begin
  if p is null or p !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Pick a start date for the project.'; end if;
  return p::date;
end $$;

-- ── New projects ────────────────────────────────────────────────────────────
drop function if exists public.add_task(text, text, text, text, jsonb, text, text, jsonb, jsonb, jsonb);
create or replace function public.add_task(p_workspace text, p_title text, p_assignee text, p_description text,
                                           p_milestones jsonb, p_start_date text default null,
                                           p_account_id text default null, p_documents jsonb default null,
                                           p_watch_outs jsonb default null, p_assumptions jsonb default null) returns text
  language plpgsql security definer set search_path = ''
  as $$
declare new_id text; ws text := coalesce(p_workspace, 'workforce'); start_d date;
begin
  perform private.require(private.can_access(ws));
  start_d := private.require_start(p_start_date);
  insert into public.tasks (workspace, title, assignee, description, start_date, account_id, documents, watch_outs, assumptions,
                            status, pending_started_at)
  values (ws, p_title, coalesce(p_assignee, ''), coalesce(p_description, ''), start_d,
          private.scoped_account(ws, p_account_id), private.doc_list(p_documents),
          private.str_list(p_watch_outs), private.str_list(p_assumptions),
          case when start_d <= private.org_today() then private.start_column(ws) else 'todo' end,
          case when start_d <= private.org_today() then private.start_anchor(start_d) end)
  returning id into new_id;
  perform private.replace_milestones(new_id, p_milestones);
  return new_id;
end $$;

-- Taking a notebook idea makes it a project — with a start date too.
drop function if exists public.take_idea(text, text);
create or replace function public.take_idea(p_idea_id text, p_taker_name text default null, p_start_date text default null) returns text
  language plpgsql security definer set search_path = ''
  as $$
declare i public.notebook_ideas; template jsonb; descr text; new_id text; start_d date;
begin
  select * into i from public.notebook_ideas where id = p_idea_id;
  if not found then return null; end if;
  perform private.require(private.can_access(i.workspace));
  start_d := private.require_start(p_start_date);
  select coalesce(nullif(w.default_milestones, '[]'::jsonb), private.fallback_milestones(i.workspace)) into template
  from (select 1) x left join public.workspace_settings w on w.workspace = i.workspace;
  descr := concat_ws(E'\n\n', nullif(i.description, ''), 'Pros: ' || nullif(i.pros, ''), 'Cons: ' || nullif(i.cons, ''), nullif(i.details, ''));
  insert into public.tasks (workspace, title, assignee, description, start_date, account_id, status, pending_started_at)
  values (i.workspace, i.name, private.actor_name(p_taker_name), coalesce(descr, ''), start_d,
          case when private.account_scoped(i.workspace) then private.scoped_account(i.workspace, null) end,
          case when start_d <= private.org_today() then private.start_column(i.workspace) else 'todo' end,
          case when start_d <= private.org_today() then private.start_anchor(start_d) end)
  returning id into new_id;
  perform private.replace_milestones(new_id, template);
  delete from public.notebook_ideas where id = p_idea_id;
  return new_id;
end $$;

-- ── Grants, schedule, and catch up now ──────────────────────────────────────
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p
           where (p.pronamespace = 'public'::regnamespace and p.proname in ('add_task', 'take_idea'))
              or (p.pronamespace = 'private'::regnamespace and p.proname in ('org_today', 'start_column', 'start_anchor', 'start_due_projects', 'require_start')) loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated, service_role', f.sig);
  end loop;
  begin
    perform cron.unschedule('start-due-projects');
  exception when others then null;
  end;
  begin
    perform cron.schedule('start-due-projects', '*/10 * * * *', 'select private.start_due_projects()');
  exception when others then
    raise notice 'pg_cron unavailable (%); run private.start_due_projects() on a schedule another way.', sqlerrm;
  end;
end $$;

select private.start_due_projects();
