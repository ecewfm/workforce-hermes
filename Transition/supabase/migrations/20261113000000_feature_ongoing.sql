-- ============================================================================
-- Features, bugs and roadblocks get a middle status: ongoing.
--   pending → ongoing → completed (any step can go back).
-- Ongoing remembers who started it and when (started_by / started_at); going
-- back to pending clears that, completing keeps it. Managers are still told
-- only when something is completed or cleared.
-- ============================================================================

alter table public.task_features drop constraint if exists task_features_status_check;
alter table public.task_features add constraint task_features_status_check
  check (status in ('pending', 'ongoing', 'completed'));
alter table public.task_features add column if not exists started_at timestamptz;
alter table public.task_features add column if not exists started_by text;

create or replace function private.feature_json(f public.task_features) returns jsonb
  language sql stable security definer set search_path = ''
  as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'id', f.id, 'name', f.name, 'description', f.description, 'status', f.status, 'suggestedBy', f.suggested_by,
    'imageStorageIds', coalesce((select jsonb_agg(i.storage_path order by i.position)
                                 from public.feature_images i where i.feature_id = f.id), '[]'::jsonb),
    'type', f.type, 'createdAt', private.ny_text(f.created_at), 'createdAtTime', private.ms(f.created_at),
    'startedAt', private.ny_text(f.started_at), 'startedAtTime', private.ms(f.started_at), 'startedBy', f.started_by,
    'completedAt', private.ny_text(f.completed_at), 'completedAtTime', private.ms(f.completed_at))) $$;

create or replace function public.update_feature_status(p_task_id text, p_feature_id text, p_status text,
                                                        p_writer text default null) returns void
  language plpgsql security definer set search_path = ''
  as $$
declare t public.tasks; f public.task_features;
begin
  perform private.require(p_status in ('pending', 'ongoing', 'completed'), 'Status must be pending, ongoing or completed.');
  t := private.require_task(p_task_id);
  select * into f from public.task_features where id = p_feature_id and task_id = p_task_id;
  if not found or f.status = p_status then return; end if;
  update public.task_features set
    status = p_status,
    completed_at = case when p_status = 'completed' then now() end,
    started_at = case when p_status = 'pending' then null
                      when p_status = 'ongoing' then now()
                      else coalesce(f.started_at, now()) end,
    started_by = case when p_status = 'pending' then null
                      when p_status = 'ongoing' then private.actor_name(p_writer)
                      else coalesce(f.started_by, private.actor_name(p_writer)) end
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

revoke execute on function public.update_feature_status(text, text, text, text) from public, anon;
grant execute on function public.update_feature_status(text, text, text, text) to authenticated, service_role;
revoke execute on function private.feature_json(public.task_features) from public, anon;
grant execute on function private.feature_json(public.task_features) to authenticated, service_role;
