-- ============================================================================
-- An on/off switch for the Cliq reminders (Settings → Notifications, Admin+
-- and Managers). One switch for every workspace. Off = the weekday run sends
-- nothing; dry / resolve / preview runs still work for testing.
-- ============================================================================

create table if not exists private.cliq_settings (
  id         int primary key default 1 check (id = 1),
  enabled    boolean not null default true,
  updated_by text,
  updated_at timestamptz not null default now()
);
insert into private.cliq_settings (id) values (1) on conflict (id) do nothing;
alter table private.cliq_settings enable row level security;
revoke all on private.cliq_settings from public, anon, authenticated;

-- What Settings shows: the switch, who last changed it, and the last weekday run.
create or replace function public.get_cliq_reminders() returns jsonb
  language plpgsql stable security definer set search_path = ''
  as $$
declare s private.cliq_settings; last_day date;
begin
  perform private.require(private.is_admin_plus(), 'Only Admin+ and Managers can see the Cliq reminder settings.');
  select * into s from private.cliq_settings where id = 1;
  select max(sent_on) into last_day from private.cliq_reminder_log where mode = 'live';
  return jsonb_build_object(
    'enabled', coalesce(s.enabled, true),
    'updatedBy', s.updated_by,
    'updatedAt', private.ms(s.updated_at),
    'lastRun', case when last_day is null then null else (
      select jsonb_build_object('day', last_day, 'sent', count(*) filter (where ok), 'failed', count(*) filter (where not ok),
                                'at', private.ms(max(created_at)))
      from private.cliq_reminder_log where mode = 'live' and sent_on = last_day) end);
end $$;

create or replace function public.set_cliq_reminders(p_enabled boolean) returns void
  language plpgsql security definer set search_path = ''
  as $$
begin
  perform private.require(private.is_admin_plus(), 'Only Admin+ and Managers can turn Cliq reminders on or off.');
  insert into private.cliq_settings (id, enabled, updated_by, updated_at)
  values (1, coalesce(p_enabled, true), private.actor_name(null), now())
  on conflict (id) do update set enabled = excluded.enabled, updated_by = excluded.updated_by, updated_at = now();
end $$;

-- The weekday run respects the switch.
create or replace function private.cliq_reminders_on() returns boolean
  language sql stable security definer set search_path = ''
  as $$ select coalesce((select enabled from private.cliq_settings where id = 1), true) $$;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p
           where p.pronamespace = 'public'::regnamespace and p.proname in ('get_cliq_reminders', 'set_cliq_reminders') loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated, service_role', f.sig);
  end loop;
  revoke execute on function private.cliq_reminders_on() from public, anon, authenticated;
end $$;

-- Weekdays 01:00 UTC = 09:00 Manila, only while the switch is on.
do $$
begin
  perform cron.schedule('cliq-project-reminders', '0 1 * * 1-5',
    $c$select case when private.cliq_reminders_on() then private.send_cliq_reminders('live') end$c$);
exception when others then
  raise notice 'pg_cron unavailable (%) — schedule cliq-project-reminders by hand.', sqlerrm;
end $$;
