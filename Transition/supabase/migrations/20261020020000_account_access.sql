-- ============================================================================
-- Client-account access (Operations) + approving into the right workspace.
--
-- • People can be tied to one or more client accounts. Someone tied to
--   accounts (and below Admin+) only sees — and can only work on — projects
--   of those accounts, plus any project they're assigned to. People with no
--   account see every account, as before. Admin+ and Managers always see all.
--   Enforced here (reads, row security, every task write), not just in the UI.
-- • Approving a pending access request from a workspace gives the person that
--   workspace (self-registration used to always mean Workforce).
-- ============================================================================

create table if not exists public.staff_accounts (
  staff_email text not null references public.staff (email) on delete cascade on update cascade,
  account_id  uuid not null references public.workspace_accounts (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (staff_email, account_id)
);
create index if not exists staff_accounts_account_idx on public.staff_accounts (account_id);
alter table public.staff_accounts enable row level security;

-- ── Helpers ─────────────────────────────────────────────────────────────────
-- The caller's accounts in a workspace.
create or replace function private.my_accounts(ws text) returns uuid[]
  language sql stable security definer set search_path = ''
  as $$ select coalesce(array_agg(sa.account_id), '{}')
        from public.staff_accounts sa join public.workspace_accounts a on a.id = sa.account_id
        where sa.staff_email = private.my_email() and a.workspace = ws $$;

-- Is the caller limited to their own accounts in this workspace?
create or replace function private.account_scoped(ws text) returns boolean
  language sql stable security definer set search_path = ''
  as $$ select not (private.is_service() or private.is_main_admin() or private.is_admin_plus())
           and cardinality(private.my_accounts(ws)) > 0 $$;

-- May the caller see this project? Their workspace, and — when tied to
-- accounts — one of those accounts or a project they're assigned to.
create or replace function private.can_see(ws text, acc uuid, assignees text) returns boolean
  language sql stable security definer set search_path = ''
  as $$ select private.can_access(ws) and (
           not private.account_scoped(ws)
           or acc = any (private.my_accounts(ws))
           or lower(coalesce(private.my_name(), '')) = any (
                select lower(btrim(x)) from unnest(string_to_array(coalesce(assignees, ''), ',')) x)) $$;

create or replace function private.can_access_task(tid text) returns boolean
  language sql stable security definer set search_path = ''
  as $$ select coalesce((select private.can_see(t.workspace, t.account_id, t.assignee)
                         from public.tasks t where t.id = tid), false) $$;

create or replace function private.require_task(tid text) returns public.tasks
  language plpgsql security definer set search_path = ''
  as $$
declare t public.tasks;
begin
  select * into t from public.tasks where id = tid;
  if not found then raise exception 'Task not found'; end if;
  perform private.require(private.can_see(t.workspace, t.account_id, t.assignee));
  return t;
end $$;

-- An account a scoped person may put a project in (theirs only; never "none").
create or replace function private.scoped_account(ws text, aid text) returns uuid
  language plpgsql stable security definer set search_path = ''
  as $$
declare mine uuid[] := private.my_accounts(ws); r uuid;
begin
  if not private.account_scoped(ws) then return private.account_in(ws, aid); end if;
  if aid is null or btrim(aid) = '' then
    if cardinality(mine) = 1 then return mine[1]; end if;
    raise exception 'Pick one of your accounts for this project.';
  end if;
  r := private.account_in(ws, aid);
  perform private.require(r = any (mine), 'You can only use your own accounts.');
  return r;
end $$;

-- ── Row security ────────────────────────────────────────────────────────────
drop policy if exists tasks_read on public.tasks;
create policy tasks_read on public.tasks for select to authenticated
  using (private.can_see(workspace, account_id, assignee));

drop policy if exists workspace_accounts_read on public.workspace_accounts;
create policy workspace_accounts_read on public.workspace_accounts for select to authenticated
  using (private.can_access(workspace) and (not private.account_scoped(workspace) or id = any (private.my_accounts(workspace))));

drop policy if exists staff_accounts_read on public.staff_accounts;
create policy staff_accounts_read on public.staff_accounts for select to authenticated
  using (staff_email = private.my_email() or private.is_admin_plus());

-- ── Reads ───────────────────────────────────────────────────────────────────
create or replace function public.get_tasks_light(p_workspace text) returns jsonb
  language sql stable security definer set search_path = ''
  as $$ select coalesce(jsonb_agg(private.task_light_json(t) order by t.created_at), '[]'::jsonb)
        from public.tasks t where t.workspace = p_workspace and private.can_see(t.workspace, t.account_id, t.assignee) $$;

create or replace function public.get_tasks_full(p_workspace text) returns jsonb
  language sql stable security definer set search_path = ''
  as $$ select coalesce(jsonb_agg(private.task_full_json(t) order by t.created_at), '[]'::jsonb)
        from public.tasks t where t.workspace = p_workspace and private.can_see(t.workspace, t.account_id, t.assignee) $$;

create or replace function public.get_task(p_task_id text) returns jsonb
  language sql stable security definer set search_path = ''
  as $$ select private.task_full_json(t) from public.tasks t
        where t.id = p_task_id and private.can_see(t.workspace, t.account_id, t.assignee) $$;

create or replace function public.get_accounts(p_workspace text) returns jsonb
  language sql stable security definer set search_path = ''
  as $$ select coalesce(jsonb_agg(jsonb_build_object('_id', a.id, 'name', a.name,
                                   'projects', (select count(*) from public.tasks t where t.account_id = a.id),
                                   'members', (select count(*) from public.staff_accounts sa where sa.account_id = a.id))
                                   order by lower(a.name)), '[]'::jsonb)
        from public.workspace_accounts a
        where a.workspace = p_workspace and private.can_access(a.workspace)
          and (not private.account_scoped(a.workspace) or a.id = any (private.my_accounts(a.workspace))) $$;

-- Who is tied to which account in a workspace (Admin+ see everyone; others just themselves).
create or replace function public.get_staff_accounts(p_workspace text) returns jsonb
  language sql stable security definer set search_path = ''
  as $$ select coalesce(jsonb_agg(jsonb_build_object('email', sa.staff_email, 'accountId', a.id, 'account', a.name)
                                   order by sa.staff_email, lower(a.name)), '[]'::jsonb)
        from public.staff_accounts sa join public.workspace_accounts a on a.id = sa.account_id
        where a.workspace = p_workspace and private.can_access(p_workspace)
          and (sa.staff_email = private.my_email() or private.is_admin_plus()) $$;

-- ── Writes ──────────────────────────────────────────────────────────────────
create or replace function public.set_staff_accounts(p_email text, p_workspace text, p_account_ids text[]) returns void
  language plpgsql security definer set search_path = ''
  as $$
declare who text := lower(btrim(coalesce(p_email, ''))); names text;
begin
  perform private.require(private.can_access(p_workspace) and private.is_admin_plus(),
                          'Only Admin+ and Managers can set which accounts people belong to.');
  perform private.require(exists (select 1 from public.staff where email = who), 'That person isn''t on the staff list.');
  delete from public.staff_accounts sa using public.workspace_accounts a
  where sa.account_id = a.id and a.workspace = p_workspace and sa.staff_email = who;
  insert into public.staff_accounts (staff_email, account_id)
  select who, a.id from public.workspace_accounts a
  where a.workspace = p_workspace and a.id::text = any (coalesce(p_account_ids, '{}'))
  on conflict do nothing;
  select string_agg(a.name, ', ' order by lower(a.name)) into names
  from public.staff_accounts sa join public.workspace_accounts a on a.id = sa.account_id
  where sa.staff_email = who and a.workspace = p_workspace;
  perform private.log('ACCOUNTS_CHANGED', who, format('Accounts in %s: %s', p_workspace, coalesce(names, 'all (no restriction)')));
end $$;

-- Approve a pending request into the workspace it was approved from.
create or replace function public.approve_staff(p_email text, p_workspace text) returns void
  language plpgsql security definer set search_path = ''
  as $$
declare who text := lower(btrim(coalesce(p_email, ''))); dept text := private.ws_department(p_workspace);
begin
  perform private.require(private.can_access(p_workspace) and private.is_admin_plus(), 'Only Admin+ and Managers can approve access.');
  perform private.require(dept is not null, 'Unknown workspace.');
  perform private.require(exists (select 1 from public.staff where email = who and role = 'Pending'), 'That request isn''t pending any more.');
  update public.staff set role = 'Programmer', departments = array[dept] where email = who;
  perform private.log('ACCESS_APPROVED', who, format('Approved as a member of %s', dept));
end $$;

drop function if exists public.add_task(text, text, text, text, jsonb, text, text, jsonb, jsonb, jsonb);
create or replace function public.add_task(p_workspace text, p_title text, p_assignee text, p_description text,
                                           p_milestones jsonb, p_start_date text default null,
                                           p_account_id text default null, p_documents jsonb default null,
                                           p_watch_outs jsonb default null, p_assumptions jsonb default null) returns text
  language plpgsql security definer set search_path = ''
  as $$
declare new_id text; ws text := coalesce(p_workspace, 'workforce');
begin
  perform private.require(private.can_access(ws));
  insert into public.tasks (workspace, title, assignee, description, start_date, account_id, documents, watch_outs, assumptions)
  values (ws, p_title, coalesce(p_assignee, ''), coalesce(p_description, ''),
          case when p_start_date ~ '^\d{4}-\d{2}-\d{2}$' then p_start_date::date end,
          private.scoped_account(ws, p_account_id), private.doc_list(p_documents),
          private.str_list(p_watch_outs), private.str_list(p_assumptions))
  returning id into new_id;
  perform private.replace_milestones(new_id, p_milestones);
  return new_id;
end $$;

create or replace function public.set_task_account(p_task_id text, p_account_id text) returns void
  language plpgsql security definer set search_path = ''
  as $$
declare t public.tasks;
begin
  t := private.require_task(p_task_id);
  update public.tasks set account_id = private.scoped_account(t.workspace, p_account_id), last_updated_at = now()
  where id = p_task_id;
end $$;

-- delete_task checked only the workspace; now the project must be visible to you.
create or replace function public.delete_task(p_task_id text, p_source text default null) returns void
  language plpgsql security definer set search_path = ''
  as $$
declare t public.tasks;
begin
  select * into t from public.tasks where id = p_task_id;
  if not found then return; end if;
  perform private.require(private.can_see(t.workspace, t.account_id, t.assignee));
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

-- ── Grants & live updates ───────────────────────────────────────────────────
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p
           where p.pronamespace = 'public'::regnamespace
             and p.proname in ('get_tasks_light', 'get_tasks_full', 'get_task', 'get_accounts', 'get_staff_accounts',
                               'set_staff_accounts', 'approve_staff', 'add_task', 'set_task_account', 'delete_task') loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated, service_role', f.sig);
  end loop;
  for f in select p.oid::regprocedure as sig from pg_proc p
           where p.pronamespace = 'private'::regnamespace
             and p.proname in ('my_accounts', 'account_scoped', 'can_see', 'can_access_task', 'require_task', 'scoped_account') loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated, service_role', f.sig);
  end loop;
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.staff_accounts;
    exception when duplicate_object then null;
    end;
  end if;
end $$;
grant select on public.staff_accounts to authenticated;
