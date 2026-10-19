-- ════════════════════════════════════════════════════════════════════════════
-- Operations & Executives projects
--   • every milestone keeps its meaning ("hint": what the step is / done when)
--   • the plan's "watch out for" risks and assumptions are kept on the task
--   • Documents: a list of named links (Ops/Exec's version of "system links")
--   • Accounts: client accounts per workspace (Operations) — Admin+ manage
--     them, any project can be tagged with one
--   • Roadblocks: a third kind of item next to features and bugs (managers
--     get "manager_roadblock" notifications for them)
--   • fixes: all six note reactions are accepted (sad/angry were rejected);
--     the Executives no-AI template is an executive one, not the software one;
--     one archive status ("scrapped"); notes are addressed by id, not by
--     position (a reply/reaction could land on the wrong note during a delete);
--     the handbook refuses to overwrite someone else's newer save; only
--     Admin-level users may change a project's admin login
-- ════════════════════════════════════════════════════════════════════════════

-- ── Columns & tables ────────────────────────────────────────────────────────
alter table public.task_milestones add column if not exists hint text;
alter table public.tasks add column if not exists watch_outs jsonb not null default '[]'::jsonb;
alter table public.tasks add column if not exists assumptions jsonb not null default '[]'::jsonb;
alter table public.tasks add column if not exists documents jsonb not null default '[]'::jsonb;

create table if not exists public.workspace_accounts (
  id         uuid primary key default gen_random_uuid(),
  workspace  text not null check (public.is_workspace(workspace)),
  name       text not null check (length(btrim(name)) between 1 and 80),
  created_by text,
  created_at timestamptz not null default now()
);
create unique index if not exists workspace_accounts_name_idx on public.workspace_accounts (workspace, lower(btrim(name)));
alter table public.workspace_accounts enable row level security;
drop policy if exists workspace_accounts_read on public.workspace_accounts;
create policy workspace_accounts_read on public.workspace_accounts for select to authenticated using (private.can_access(workspace));

alter table public.tasks add column if not exists account_id uuid references public.workspace_accounts (id) on delete set null;

alter table public.task_features drop constraint if exists task_features_type_check;
alter table public.task_features add constraint task_features_type_check check (type in ('feature', 'bug', 'roadblock'));

alter table public.note_reactions drop constraint if exists note_reactions_reaction_check;
alter table public.note_reactions add constraint note_reactions_reaction_check
  check (reaction in ('like', 'wow', 'heart', 'haha', 'sad', 'angry'));

-- ── Helpers ─────────────────────────────────────────────────────────────────
-- Clean a list of short strings (watch-outs, assumptions): trimmed, non-empty, ≤ 10.
create or replace function private.str_list(v jsonb) returns jsonb
  language sql immutable set search_path = ''
  as $$ select coalesce((select jsonb_agg(left(btrim(x), 400) order by o)
                         from jsonb_array_elements_text(case when jsonb_typeof(v) = 'array' then v else '[]'::jsonb end)
                              with ordinality e(x, o)
                         where btrim(x) <> '' and o <= 10), '[]'::jsonb) $$;

-- Clean a documents list: [{name, url}] with http(s) urls, ≤ 40.
create or replace function private.doc_list(v jsonb) returns jsonb
  language sql immutable set search_path = ''
  as $$ select coalesce((select jsonb_agg(jsonb_build_object(
                           'name', left(coalesce(nullif(btrim(d ->> 'name'), ''), btrim(d ->> 'url')), 120),
                           'url', btrim(d ->> 'url')) order by o)
                         from jsonb_array_elements(case when jsonb_typeof(v) = 'array' then v else '[]'::jsonb end)
                              with ordinality e(d, o)
                         where jsonb_typeof(d) = 'object' and btrim(coalesce(d ->> 'url', '')) ~* '^https?://\S+$' and o <= 40),
                        '[]'::jsonb) $$;

-- An account id that belongs to this workspace (or null).
create or replace function private.account_in(ws text, aid text) returns uuid
  language plpgsql stable security definer set search_path = ''
  as $$
declare r uuid;
begin
  if aid is null or btrim(aid) = '' then return null; end if;
  select a.id into r from public.workspace_accounts a where a.id::text = aid and a.workspace = ws;
  if r is null then raise exception 'That account doesn''t exist in this workspace.'; end if;
  return r;
end $$;

-- ── JSON shapes ─────────────────────────────────────────────────────────────
create or replace function private.milestones_json(tid text) returns jsonb
  language sql stable security definer set search_path = ''
  as $$
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
           'name', m.name, 'days', m.days, 'completed', m.completed, 'hint', nullif(m.hint, ''),
           'completedAt', private.ny_text(m.completed_at), 'completedAtTime', private.ms(m.completed_at),
           'createdAtTime', private.ms(m.created_at))) order by m.position), '[]'::jsonb)
  from public.task_milestones m where m.task_id = tid $$;

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
    'managerStaleNotifiedAt', private.ms(t.manager_stale_notified_at),
    'watchOuts', t.watch_outs, 'assumptions', t.assumptions, 'documents', t.documents,
    'accountId', t.account_id,
    'account', (select a.name from public.workspace_accounts a where a.id = t.account_id)) $$;

-- ── Milestones keep their meaning through every edit ────────────────────────
create or replace function private.replace_milestones(tid text, arr jsonb) returns void
  language plpgsql security definer set search_path = ''
  as $$
declare old jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object('position', position, 'name', name, 'completed', completed,
                                               'completed_at', completed_at, 'created_at', created_at, 'hint', hint)), '[]'::jsonb)
    into old from public.task_milestones where task_id = tid;
  delete from public.task_milestones where task_id = tid;
  insert into public.task_milestones (task_id, position, name, days, completed, completed_at, created_at, hint)
  select tid, (e.ord - 1)::int,
         coalesce(nullif(btrim(e.v ->> 'name'), ''), 'Unnamed'),
         greatest(0, round(coalesce((e.v ->> 'days')::numeric, 0)))::int,
         coalesce((e.v ->> 'completed')::boolean, false),
         case when coalesce((e.v ->> 'completed')::boolean, false) then
           coalesce(private.from_ms(e.v -> 'completedAtTime'), case when om.completed then om.completed_at end, now()) end,
         -- Existing milestone: keep its created time (even if unknown/null).
         -- Only genuinely new milestones are stamped "now".
         coalesce(private.from_ms(e.v -> 'createdAtTime'), case when om.name is not null then om.created_at else now() end),
         -- Meaning: whatever the caller sent; if it didn't say, keep the old one.
         case when e.v ? 'hint' then left(nullif(btrim(e.v ->> 'hint'), ''), 400) else om.hint end
  from jsonb_array_elements(coalesce(arr, '[]'::jsonb)) with ordinality e(v, ord)
  left join lateral (
    select o.* from jsonb_to_recordset(old) o(position int, name text, completed boolean, completed_at timestamptz,
                                              created_at timestamptz, hint text)
    where o.name = e.v ->> 'name' order by abs(o.position - (e.ord - 1)) limit 1) om on true;
end $$;

-- ── Default (no-AI) templates, with what each step means ────────────────────
-- Mirrors src/utils/defaults.js — keep the two in sync.
create or replace function private.fallback_milestones(ws text) returns jsonb
  language sql immutable set search_path = ''
  as $$ select case ws when 'operations' then
    '[{"name":"Scope & Goals","days":5,"hint":"Agree the problem, the goal, how success will be measured, and who''s involved."},
      {"name":"Plan & Design","days":7,"hint":"Map the approach: the steps or process, owners, resources, timeline and budget."},
      {"name":"Review & Sign-off","days":3,"hint":"Walk the leads and stakeholders through the plan and get approval to proceed."},
      {"name":"Prepare & Set Up","days":7,"hint":"Get everything ready: tools, templates, SOPs, schedules, access and materials."},
      {"name":"Pilot / Test Run","days":10,"hint":"Try it small (one team, site or shift) for about two weeks and fix what breaks."},
      {"name":"Train & Communicate","days":5,"hint":"Train the people affected and announce what''s changing, when, and why."},
      {"name":"Go-Live / Full Rollout","days":5,"hint":"Launch for everyone in scope — in waves by site or team if it''s large."},
      {"name":"Monitor & Hand Over","days":14,"hint":"Track results against the goal, fix gaps, document it, and hand it to the day-to-day owner."}]'::jsonb
  when 'executives' then
    '[{"name":"Situation & Data Review","days":7,"hint":"Gather the numbers and context: what''s happening, why it matters, and what it costs today."},
      {"name":"Options & Recommendation","days":7,"hint":"Lay out the realistic options with cost, risk and impact, and choose a recommendation."},
      {"name":"Stakeholder Alignment","days":5,"hint":"Walk the key leaders through the recommendation and surface their concerns early."},
      {"name":"Decision & Approval","days":3,"hint":"Get a clear go / no-go from the decision-makers, with budget and an owner."},
      {"name":"Launch & Delegate","days":5,"hint":"Hand the work to the owning team with goals, deadlines and a reporting rhythm."},
      {"name":"Oversight & Check-ins","days":21,"hint":"Review progress on a set rhythm and unblock what the team can''t solve alone."},
      {"name":"Results Review & Close-out","days":5,"hint":"Compare results with the goal, decide next steps, and share what was learned."}]'::jsonb
  else
    '[{"name":"Project Planning & Design","days":22},{"name":"Project Setup & Database","days":6},
      {"name":"Core Feature Development (Phase 1)","days":25},{"name":"Core Feature Development (Phase 2)","days":20},
      {"name":"API Integration","days":8},{"name":"Internal Testing & Bug Fixes","days":15},
      {"name":"User Testing & Refinement","days":20},{"name":"Final Polish & Optimization","days":15},
      {"name":"Deployment & Soft Launch","days":17},{"name":"Post-Launch Support","days":22}]'::jsonb end $$;

-- ── New project: account, documents, watch-outs and assumptions ride along ──
drop function if exists public.add_task(text, text, text, text, jsonb, text);
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
          private.account_in(ws, p_account_id), private.doc_list(p_documents),
          private.str_list(p_watch_outs), private.str_list(p_assumptions))
  returning id into new_id;
  perform private.replace_milestones(new_id, p_milestones);
  return new_id;
end $$;

-- ── Per-project edits ───────────────────────────────────────────────────────
create or replace function public.update_task_documents(p_task_id text, p_documents jsonb) returns jsonb
  language plpgsql security definer set search_path = ''
  as $$
declare cleaned jsonb := private.doc_list(p_documents);
begin
  perform private.require_task(p_task_id);
  update public.tasks set documents = cleaned, last_updated_at = now() where id = p_task_id;
  return cleaned;
end $$;

create or replace function public.update_task_plan_notes(p_task_id text, p_watch_outs jsonb default null,
                                                         p_assumptions jsonb default null) returns void
  language plpgsql security definer set search_path = ''
  as $$
begin
  perform private.require_task(p_task_id);
  update public.tasks set
    watch_outs  = case when p_watch_outs is null then watch_outs else private.str_list(p_watch_outs) end,
    assumptions = case when p_assumptions is null then assumptions else private.str_list(p_assumptions) end,
    last_updated_at = now()
  where id = p_task_id;
end $$;

create or replace function public.set_task_account(p_task_id text, p_account_id text) returns void
  language plpgsql security definer set search_path = ''
  as $$
declare t public.tasks;
begin
  t := private.require_task(p_task_id);
  update public.tasks set account_id = private.account_in(t.workspace, p_account_id), last_updated_at = now()
  where id = p_task_id;
end $$;

-- ── Accounts (Admin+ manage; everyone in the workspace sees them) ───────────
create or replace function public.get_accounts(p_workspace text) returns jsonb
  language sql stable security definer set search_path = ''
  as $$ select coalesce(jsonb_agg(jsonb_build_object('_id', a.id, 'name', a.name,
                                   'projects', (select count(*) from public.tasks t where t.account_id = a.id))
                                   order by lower(a.name)), '[]'::jsonb)
        from public.workspace_accounts a where a.workspace = p_workspace and private.can_access(a.workspace) $$;

create or replace function public.add_account(p_workspace text, p_name text) returns text
  language plpgsql security definer set search_path = ''
  as $$
declare new_id uuid; clean text := btrim(coalesce(p_name, ''));
begin
  perform private.require(private.can_access(p_workspace) and private.is_admin_plus(), 'Only Admin+ and Managers can create accounts.');
  if clean = '' then raise exception 'Give the account a name.'; end if;
  if exists (select 1 from public.workspace_accounts where workspace = p_workspace and lower(btrim(name)) = lower(clean)) then
    raise exception 'There''s already an account called "%".', clean;
  end if;
  insert into public.workspace_accounts (workspace, name, created_by) values (p_workspace, left(clean, 80), private.actor_name(null))
  returning id into new_id;
  return new_id::text;
end $$;

create or replace function public.rename_account(p_account_id text, p_name text) returns void
  language plpgsql security definer set search_path = ''
  as $$
declare a public.workspace_accounts; clean text := btrim(coalesce(p_name, ''));
begin
  select * into a from public.workspace_accounts where id::text = p_account_id;
  if not found then raise exception 'Account not found.'; end if;
  perform private.require(private.can_access(a.workspace) and private.is_admin_plus(), 'Only Admin+ and Managers can rename accounts.');
  if clean = '' then raise exception 'Give the account a name.'; end if;
  if exists (select 1 from public.workspace_accounts where workspace = a.workspace and id <> a.id and lower(btrim(name)) = lower(clean)) then
    raise exception 'There''s already an account called "%".', clean;
  end if;
  update public.workspace_accounts set name = left(clean, 80) where id = a.id;
end $$;

create or replace function public.delete_account(p_account_id text) returns void
  language plpgsql security definer set search_path = ''
  as $$
declare a public.workspace_accounts;
begin
  select * into a from public.workspace_accounts where id::text = p_account_id;
  if not found then return; end if;
  perform private.require(private.can_access(a.workspace) and private.is_admin_plus(), 'Only Admin+ and Managers can delete accounts.');
  delete from public.workspace_accounts where id = a.id; -- its projects simply become "no account"
end $$;

-- ── Roadblocks (Operations/Executives' features & bugs) ─────────────────────
create or replace function public.add_task_feature(p_task_id text, p_feature jsonb, p_actor_name text default null,
                                                   p_actor_email text default null) returns text
  language plpgsql security definer set search_path = ''
  as $$
declare t public.tasks; fid text; who text; actor text; fname text := p_feature ->> 'name';
        kind text := case p_feature ->> 'type' when 'bug' then 'bug' when 'roadblock' then 'roadblock' else 'feature' end;
begin
  t := private.require_task(p_task_id);
  who := private.actor_name(coalesce(p_actor_name, p_feature ->> 'suggestedBy'));
  actor := case when private.is_service() then coalesce(p_actor_email, '') else private.my_email() end;
  insert into public.task_features (id, task_id, position, type, name, description, status, suggested_by, created_at)
  values (coalesce(nullif(p_feature ->> 'id', ''), gen_random_uuid()::text), p_task_id,
          coalesce((select max(position) + 1 from public.task_features where task_id = p_task_id), 0),
          kind, fname, coalesce(p_feature ->> 'description', ''),
          case when p_feature ->> 'status' = 'completed' then 'completed' else 'pending' end,
          coalesce(nullif(p_feature ->> 'suggestedBy', ''), who), now())
  returning id into fid;
  perform private.set_feature_images(fid, p_feature -> 'imageStorageIds');
  perform private.touch(p_task_id);
  if actor <> '' then
    perform private.notify_assignees(t, 'project_change',
      format('added %s "%s" to "%s"', case kind when 'bug' then 'a bug' when 'roadblock' then 'a roadblock' else 'a feature' end, fname, t.title),
      actor, who);
  end if;
  perform private.notify_managers(t.workspace, case kind when 'feature' then 'manager_feature' when 'roadblock' then 'manager_roadblock' else 'manager_bug' end,
    case kind when 'bug' then format('reported a bug "%s" on "%s"', fname, t.title)
              when 'roadblock' then format('flagged a roadblock "%s" on "%s"', fname, t.title)
              else format('added a feature "%s" to "%s"', fname, t.title) end,
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
    perform private.notify_managers(t.workspace, case when f.type = 'roadblock' then 'manager_roadblock' else 'manager_feature' end,
      format(case f.type when 'roadblock' then 'cleared the roadblock "%s" on "%s"'
                         when 'bug' then 'completed the bug fix "%s" on "%s"'
                         else 'completed the feature "%s" on "%s"' end, f.name, t.title),
      t.id, t.title, '', private.actor_name(p_writer));
  end if;
end $$;

-- ── One archive status ──────────────────────────────────────────────────────
-- Right-click → Archive used to write "scrapyard", which matched no column (so
-- the card fell into To Do). Everything archived is "scrapped" now.
update public.tasks set status = 'scrapped' where lower(status) = 'scrapyard';

-- ── Notes by id (and all six reactions) ─────────────────────────────────────
create or replace function private.note_json(n public.task_notes) returns jsonb
  language sql stable security definer set search_path = ''
  as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'id', n.id, 'text', n.text, 'date', private.ny_text(n.created_at), 'timestamp', private.ms(n.created_at), 'writer', n.writer,
    'reactions', (select jsonb_object_agg(r.reaction, r.emails) from (
                    select reaction, jsonb_agg(user_email order by created_at) emails
                    from public.note_reactions where note_id = n.id group by reaction) r),
    'replies', (select jsonb_agg(jsonb_build_object('text', x.text, 'date', private.ny_text(x.created_at),
                    'timestamp', private.ms(x.created_at), 'writer', x.writer) order by x.position)
                from public.note_replies x where x.note_id = n.id))) $$;

-- The note a call means: by id when given (safe while others delete), else by position.
create or replace function private.pick_note(tid text, idx int, nid text) returns public.task_notes
  language plpgsql stable security definer set search_path = ''
  as $$
declare n public.task_notes;
begin
  if nullif(nid, '') is not null then
    select * into n from public.task_notes where task_id = tid and id::text = nid;
  else
    select * into n from public.task_notes where task_id = tid and position = idx;
  end if;
  return n;
end $$;

drop function if exists public.toggle_note_reaction(text, int, text);
create or replace function public.toggle_note_reaction(p_task_id text, p_note_index int, p_reaction text,
                                                       p_note_id text default null) returns void
  language plpgsql security definer set search_path = ''
  as $$
declare t public.tasks; n public.task_notes; me text := private.my_email(); emoji text;
begin
  t := private.require_task(p_task_id);
  perform private.require(me <> '', 'Sign in to react.');
  if p_reaction not in ('like', 'wow', 'heart', 'haha', 'sad', 'angry') then raise exception 'Unknown reaction.'; end if;
  n := private.pick_note(p_task_id, p_note_index, p_note_id);
  if n.id is null then return; end if;
  delete from public.note_reactions where note_id = n.id and user_email = me and reaction = p_reaction;
  if not found then
    insert into public.note_reactions (note_id, user_email, reaction) values (n.id, me, p_reaction);
    emoji := case p_reaction when 'like' then '👍' when 'wow' then '😮' when 'heart' then '❤️' when 'haha' then '😆'
                             when 'sad' then '😢' when 'angry' then '😡' else p_reaction end;
    perform private.notify_writer(t, n.writer, 'reaction', format('reacted %s to your note on "%s"', emoji, t.title),
                                  me, private.actor_name(null));
  end if;
end $$;

drop function if exists public.add_note_reply(text, int, text, text);
create or replace function public.add_note_reply(p_task_id text, p_note_index int, p_text text, p_writer text default null,
                                                 p_note_id text default null) returns void
  language plpgsql security definer set search_path = ''
  as $$
declare t public.tasks; n public.task_notes; who text; actor text;
begin
  t := private.require_task(p_task_id);
  n := private.pick_note(p_task_id, p_note_index, p_note_id);
  if n.id is null then return; end if;
  who := private.actor_name(p_writer);
  actor := private.my_email();
  insert into public.note_replies (note_id, position, text, writer)
  values (n.id, coalesce((select max(position) + 1 from public.note_replies where note_id = n.id), 0), p_text, who);
  perform private.notify_writer(t, n.writer, 'project_change', format('replied to your note on "%s"', t.title), actor, who);
  perform private.notify_mentions(t, p_text, actor, who, format('mentioned you in a reply on "%s"', t.title));
end $$;

drop function if exists public.delete_task_notes_bulk(text, int[]);
create or replace function public.delete_task_notes_bulk(p_task_id text, p_indices int[], p_note_ids text[] default null)
  returns void
  language plpgsql security definer set search_path = ''
  as $$
begin
  perform private.require_task(p_task_id);
  if p_note_ids is not null and cardinality(p_note_ids) > 0 then
    delete from public.task_notes where task_id = p_task_id and id::text = any (p_note_ids);
  else
    delete from public.task_notes where task_id = p_task_id and position = any (p_indices);
  end if;
  perform private.renumber('task_notes', p_task_id);
  perform private.touch(p_task_id);
end $$;

-- ── Handbook: don't silently overwrite a newer save ─────────────────────────
drop function if exists public.save_handbook(text, jsonb);
create or replace function public.save_handbook(p_workspace text, p_blocks jsonb, p_base_updated_at bigint default null)
  returns bigint
  language plpgsql security definer set search_path = ''
  as $$
declare cur timestamptz; saved timestamptz;
begin
  perform private.require(private.can_access(coalesce(p_workspace, 'workforce')) and private.is_admin_plus(),
                          'Only Admin+ and Managers can edit the handbook.');
  select updated_at into cur from public.handbooks where workspace = coalesce(p_workspace, 'workforce');
  if p_base_updated_at is not null and cur is not null and private.ms(cur) > p_base_updated_at then
    raise exception 'Someone else saved the handbook while you were editing. Reload it to see their changes, then edit again.';
  end if;
  insert into public.handbooks (workspace, blocks, updated_at, updated_by)
  values (coalesce(p_workspace, 'workforce'), coalesce(p_blocks, '[]'::jsonb), now(), private.actor_name(null))
  on conflict (workspace) do update set blocks = excluded.blocks, updated_at = now(), updated_by = excluded.updated_by
  returning updated_at into saved;
  return private.ms(saved);
end $$;

-- ── Project admin logins: Admin-level only (they're the only ones who see them) ─
create or replace function public.update_admin_credentials(p_task_id text, p_email text, p_password text) returns void
  language plpgsql security definer set search_path = ''
  as $$
begin
  perform private.require_task(p_task_id);
  perform private.require(private.is_admin_level(), 'Only Admins can change a project''s admin login.');
  insert into public.task_credentials (task_id, login_email, login_password, updated_at)
  values (p_task_id, p_email, p_password, now())
  on conflict (task_id) do update set login_email = excluded.login_email, login_password = excluded.login_password, updated_at = now();
  perform private.touch(p_task_id);
end $$;

-- ── Grants (new/changed functions) & live updates ───────────────────────────
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig, p.proname from pg_proc p
           where p.pronamespace = 'public'::regnamespace and p.proname <> 'is_workspace' and p.proname <> 'auth_account_status' loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated, service_role', f.sig);
  end loop;
  for f in select p.oid::regprocedure as sig from pg_proc p where p.pronamespace = 'private'::regnamespace loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated, service_role', f.sig);
  end loop;
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.workspace_accounts;
    exception when duplicate_object then null;
    end;
  end if;
end $$;
grant select on public.workspace_accounts to authenticated;
