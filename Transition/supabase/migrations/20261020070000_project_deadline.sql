-- ============================================================================
-- New projects carry the deadline the person sets.
-- New Task asks for a deadline; the milestones are the steps to reach it. It's
-- stored as the project's pinned completion deadline (deadline_override, end of
-- that day, Manila time), so the board, Overview and manager alerts all use it.
-- Optional at this level (Caddy / notebook ideas may not have one yet).
-- ============================================================================
drop function if exists public.add_task(text, text, text, text, jsonb, text, text, jsonb, jsonb, jsonb);
create or replace function public.add_task(p_workspace text, p_title text, p_assignee text, p_description text,
                                           p_milestones jsonb, p_start_date text default null,
                                           p_account_id text default null, p_documents jsonb default null,
                                           p_watch_outs jsonb default null, p_assumptions jsonb default null,
                                           p_deadline text default null) returns text
  language plpgsql security definer set search_path = ''
  as $$
declare new_id text; ws text := coalesce(p_workspace, 'workforce'); start_d date; due_d date;
begin
  perform private.require(private.can_access(ws));
  start_d := private.require_start(p_start_date);
  if p_deadline is not null and btrim(p_deadline) <> '' then
    if p_deadline !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'That deadline isn''t a valid date.'; end if;
    due_d := p_deadline::date;
    if due_d < start_d then raise exception 'The deadline can''t be before the start date.'; end if;
  end if;
  insert into public.tasks (workspace, title, assignee, description, start_date, account_id, documents, watch_outs, assumptions,
                            status, pending_started_at, deadline_override)
  values (ws, p_title, coalesce(p_assignee, ''), coalesce(p_description, ''), start_d,
          private.scoped_account(ws, p_account_id), private.doc_list(p_documents),
          private.str_list(p_watch_outs), private.str_list(p_assumptions),
          case when start_d <= private.org_today() then private.start_column(ws) else 'todo' end,
          case when start_d <= private.org_today() then private.start_anchor(start_d) end,
          case when due_d is not null then ((due_d + 1)::timestamp at time zone 'Asia/Manila') - interval '1 second' end)
  returning id into new_id;
  perform private.replace_milestones(new_id, p_milestones);
  return new_id;
end $$;

revoke execute on function public.add_task(text, text, text, text, jsonb, text, text, jsonb, jsonb, jsonb, text) from public, anon;
grant execute on function public.add_task(text, text, text, text, jsonb, text, text, jsonb, jsonb, jsonb, text) to authenticated, service_role;
