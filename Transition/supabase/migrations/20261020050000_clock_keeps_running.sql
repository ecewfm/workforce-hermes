-- ============================================================================
-- A project's clock keeps running once it has started.
-- The countdown starts the first time a project leaves To Do (pending_started_at,
-- set once and never cleared). Moving it back to To Do used to stop the clock;
-- now it keeps running, so the daily manager scan (late/stalled alerts) counts
-- it the same way the app does.
-- ============================================================================
create or replace function private.completion_due(t public.tasks) returns timestamptz
  language plpgsql stable security definer set search_path = ''
  as $$
declare idx int; anchor timestamptz; remaining int; computed timestamptz;
begin
  select min(position) into idx from public.task_milestones where task_id = t.id and not completed;
  if idx is null then return t.deadline_override; end if;
  if lower(t.status) <> 'todo' or t.pending_started_at is not null then
    anchor := case when idx > 0 then (select coalesce(completed_at, created_at) from public.task_milestones
                                      where task_id = t.id and position = idx - 1) end;
    anchor := coalesce(anchor, t.pending_started_at, t.last_updated_at);
    select sum(days) into remaining from public.task_milestones where task_id = t.id and position >= idx;
    computed := anchor + make_interval(days => coalesce(remaining, 0));
  end if;
  return coalesce(t.deadline_override, computed);
end $$;

revoke execute on function private.completion_due(public.tasks) from public, anon;
grant execute on function private.completion_due(public.tasks) to authenticated, service_role;
