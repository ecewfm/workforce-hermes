-- ============================================================================
-- Cliq reminders for late and nearly-late projects.
--
-- Every weekday at 09:00 Manila, Hermes sends a Zoho Cliq DM (as the Workforce
-- Management account) to:
--   • each project owner (assignee): their projects that are overdue or due in
--     the next 3 days;
--   • each Manager: every overdue project in the workspaces they belong to.
--     Nearly-late projects aren't sent to managers.
-- One message per person per day, with buttons that open the project in Hermes
-- (?project=<id>&ws=<workspace>).
--
-- The Cliq OAuth client id / secret / refresh token live in Supabase Vault
-- (cliq_oauth_client_id, cliq_oauth_client_secret, cliq_oauth_refresh_token).
-- The access token is cached for its hour: Zoho throttles refresh exchanges,
-- and Apollo uses the same client. People are found on Cliq by their sign-in
-- email, else by first + last name in the Cliq directory, and remembered in
-- private.cliq_contacts (how = 'manual' rows are never re-checked).
--
-- Run by hand:
--   select private.send_cliq_reminders('dry');                      -- who would get what, sends nothing
--   select private.send_cliq_reminders('resolve');                  -- find everyone on Cliq, sends nothing
--   select private.send_cliq_reminders('preview', null, 'me@…');    -- everyone's message, to one address
--   select private.send_cliq_reminders('live');                     -- what the schedule runs
-- ============================================================================

do $$
begin
  create extension if not exists http with schema extensions;
exception when others then
  raise notice 'http extension unavailable (%) — Cliq reminders cannot send until it is enabled.', sqlerrm;
end $$;

-- Who someone is on Cliq. how: email | search | manual | missing.
create table if not exists private.cliq_contacts (
  staff_email  text primary key,
  cliq_address text,
  cliq_name    text,
  how          text not null default 'missing',
  checked_at   timestamptz not null default now()
);

-- The current Cliq access token (valid an hour).
create table if not exists private.cliq_token (
  id           int primary key default 1 check (id = 1),
  access_token text not null,
  expires_at   timestamptz not null
);

-- One row per message sent (or attempted).
create table if not exists private.cliq_reminder_log (
  id           bigint generated always as identity primary key,
  sent_on      date not null,
  mode         text not null,
  staff_email  text not null,
  staff_name   text,
  cliq_address text,
  own_overdue  int not null default 0,
  own_due_soon int not null default 0,
  team_overdue int not null default 0,
  ok           boolean not null,
  http_status  int,
  error        text,
  created_at   timestamptz not null default now()
);
create index if not exists cliq_reminder_log_day_idx on private.cliq_reminder_log (sent_on, staff_email);

alter table private.cliq_contacts enable row level security;
alter table private.cliq_token enable row level security;
alter table private.cliq_reminder_log enable row level security;
revoke all on private.cliq_contacts, private.cliq_token, private.cliq_reminder_log from public, anon, authenticated;

-- ── Pure parts (no network): what each person should hear about ───────────

create or replace function private.is_are(n int) returns text
  language sql immutable set search_path = ''
  as $$ select case when n = 1 then 'is' else 'are' end $$;

-- Lower-case name words without punctuation or suffixes: "Rodolfo D. Luga II" → {rodolfo,d,luga}.
create or replace function private.name_tokens(p text) returns text[]
  language sql immutable set search_path = ''
  as $$
  select coalesce(array_agg(t order by o), '{}'::text[])
  from regexp_split_to_table(lower(regexp_replace(coalesce(p, ''), '[^[:alpha:][:space:]]', ' ', 'g')), '[[:space:]]+')
       with ordinality as x(t, o)
  where t <> '' and t not in ('ii', 'iii', 'iv', 'jr', 'sr') $$;

-- Everyone with something to hear about today:
--   [{ email, name, manager, own: [item…], team: [item…] }]
-- item = { id, title, workspace, kind: overdue|soon, due, due_text, when_text, assignee }.
-- own  = projects they're assigned to that are overdue or due within 3 days.
-- team = (Managers) overdue projects in their workspaces that aren't already in own.
create or replace function private.cliq_reminder_plan(p_now timestamptz default now()) returns jsonb
  language sql stable security definer set search_path = ''
  as $$
  with live as (
    select t.id, t.workspace, t.title, btrim(coalesce(t.assignee, '')) as assignee, private.completion_due(t) as due
    from public.tasks t
    where lower(t.status) not in ('done', 'implemented', 'scrapped', 'scrapyard')
      and not (exists (select 1 from public.task_milestones m where m.task_id = t.id)
               and not exists (select 1 from public.task_milestones m where m.task_id = t.id and not m.completed))
  ),
  late as (
    select l.*,
           case when l.due < p_now then 'overdue' else 'soon' end as kind,
           (p_now at time zone 'Asia/Manila')::date - (l.due at time zone 'Asia/Manila')::date as days_late
    from live l
    where l.due is not null and l.due < p_now + interval '3 days'
  ),
  item as (
    select la.id, la.workspace, la.kind, la.due, la.assignee,
           jsonb_build_object(
             'id', la.id, 'title', la.title, 'workspace', la.workspace, 'kind', la.kind, 'due', la.due,
             'assignee', la.assignee,
             'due_text', to_char(la.due at time zone 'Asia/Manila', 'Dy, Mon FMDD'),
             'when_text', case
               when la.kind = 'overdue' then case when la.days_late <= 0 then 'was due today'
                                                  when la.days_late = 1 then '1 day late'
                                                  else la.days_late || ' days late' end
               else case when la.days_late >= 0 then 'due today'
                         when la.days_late = -1 then 'due tomorrow'
                         else 'due in ' || (-la.days_late) || ' days' end
             end) as j
    from late la
  ),
  people as (
    select lower(s.email) as email, btrim(s.name) as name, s.role, s.departments
    from public.staff s
    where s.role in ('Programmer', 'Admin', 'Admin+', 'Manager')
      and lower(s.email) <> 'wmt@ececontactcenters.com' -- the shared Main Admin login isn't a person
  ),
  owned as (
    select distinct p.email, i.id, i.due, i.j
    from item i
    cross join lateral unnest(string_to_array(i.assignee, ',')) as a(who)
    join people p on lower(p.name) = lower(btrim(a.who))
  ),
  team as (
    select p.email, i.id, i.due, i.j
    from item i
    join people p on p.role = 'Manager' and private.ws_department(i.workspace) = any (p.departments)
    where i.kind = 'overdue'
      and not exists (select 1 from owned o where o.email = p.email and o.id = i.id)
  )
  select coalesce(jsonb_agg(x.person order by x.person ->> 'name'), '[]'::jsonb)
  from (
    select jsonb_build_object(
             'email', p.email, 'name', p.name, 'manager', p.role = 'Manager',
             'own', coalesce((select jsonb_agg(o.j order by o.due) from owned o where o.email = p.email), '[]'::jsonb),
             'team', coalesce((select jsonb_agg(t.j order by t.due) from team t where t.email = p.email), '[]'::jsonb)) as person
    from people p
  ) x
  where jsonb_array_length(x.person -> 'own') > 0 or jsonb_array_length(x.person -> 'team') > 0 $$;

-- Label-slide rows for a list of items: [{ "<title>": "Due Fri, Oct 24 · due in 3 days" }, …]
-- (Cliq's label slide takes the field name as the key.) Long lists end with "…and N more".
create or replace function private.cliq_rows(p_items jsonb, p_multi boolean, p_with_owner boolean, p_limit int default 8)
returns jsonb
  language plpgsql immutable set search_path = ''
  as $$
declare
  rows jsonb := '[]'::jsonb;
  keys text[] := '{}';
  e jsonb;
  k text;
  n int := 0;
  total int := jsonb_array_length(coalesce(p_items, '[]'::jsonb));
begin
  for e in select x from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) as t(x) loop
    n := n + 1;
    exit when n > p_limit;
    k := left(e ->> 'title', 60) || case when p_multi then ' (' || initcap(e ->> 'workspace') || ')' else '' end;
    while k = any (keys) loop k := k || ' ·'; end loop; -- keys must be unique within a slide
    keys := keys || k;
    rows := rows || jsonb_build_object(k, concat_ws(' · ',
              case when p_with_owner then nullif(e ->> 'assignee', '') end,
              'Due ' || (e ->> 'due_text'),
              e ->> 'when_text'));
  end loop;
  if total > p_limit then
    rows := rows || jsonb_build_object('…', format('and %s more in Hermes', total - p_limit));
  end if;
  return rows;
end $$;

-- The Cliq message (a card) for one plan entry.
create or replace function private.cliq_reminder_message(p jsonb, p_app text default 'https://workforce-hermes.vercel.app')
returns jsonb
  language plpgsql immutable set search_path = ''
  as $$
declare
  own_late jsonb := coalesce((select jsonb_agg(x) from jsonb_array_elements(p -> 'own') as t(x) where x ->> 'kind' = 'overdue'), '[]'::jsonb);
  own_soon jsonb := coalesce((select jsonb_agg(x) from jsonb_array_elements(p -> 'own') as t(x) where x ->> 'kind' = 'soon'), '[]'::jsonb);
  team jsonb := coalesce(p -> 'team', '[]'::jsonb);
  n_late int;
  n_soon int;
  n_team int;
  multi boolean;
  hi text := 'Hi ' || split_part(btrim(p ->> 'name'), ' ', 1);
  msg text;
  slides jsonb := '[]'::jsonb;
  buttons jsonb := '[]'::jsonb;
  e jsonb;
  lbl text;
begin
  n_late := jsonb_array_length(own_late);
  n_soon := jsonb_array_length(own_soon);
  n_team := jsonb_array_length(team);
  select count(distinct x ->> 'workspace') > 1 into multi from jsonb_array_elements(own_late || own_soon || team) as t(x);

  -- What the chat list and the push notification show (Cliq also prints it under the title).
  msg := case
    when n_late > 0 and n_soon > 0 then format('%s, %s of your projects %s overdue and %s %s due in the next 3 days.',
                                               hi, n_late, private.is_are(n_late), n_soon, private.is_are(n_soon))
    when n_late > 0 then format('%s, %s of your projects %s overdue.', hi, n_late, private.is_are(n_late))
    when n_soon > 0 then format('%s, %s of your projects %s due in the next 3 days.', hi, n_soon, private.is_are(n_soon))
  end;
  if n_team > 0 then
    msg := case
      when msg is null then format('%s, %s %s across your team %s overdue.', hi, n_team,
                                   case when n_team = 1 then 'project' else 'projects' end, private.is_are(n_team))
      else msg || format(' Across your team, %s other %s %s overdue.', n_team,
                         case when n_team = 1 then 'project' else 'projects' end, private.is_are(n_team))
    end;
  end if;

  if n_late > 0 then
    slides := slides || jsonb_build_object('type', 'label', 'title', 'Your overdue projects', 'data', private.cliq_rows(own_late, multi, false));
  end if;
  if n_soon > 0 then
    slides := slides || jsonb_build_object('type', 'label', 'title', 'Due in the next 3 days', 'data', private.cliq_rows(own_soon, multi, false));
  end if;
  if n_team > 0 then
    slides := slides || jsonb_build_object('type', 'label', 'title', 'Overdue across your team', 'data', private.cliq_rows(team, multi, true));
  end if;
  slides := slides || jsonb_build_object('type', 'text', 'data', case
    when n_late + n_soon > 0 then 'Update the milestones in Hermes, or change the deadline if the plan has moved.'
    else 'Open a project to see its milestones and latest notes.' end);

  -- Up to four projects get their own button; the last one opens Hermes.
  for e in select x from jsonb_array_elements(own_late || own_soon || team) with ordinality as t(x, o) order by o limit 4 loop
    lbl := 'Open ' || (e ->> 'title');
    if length(lbl) > 30 then lbl := left(lbl, 29) || '…'; end if;
    buttons := buttons || jsonb_build_object('label', lbl, 'action', jsonb_build_object('type', 'open.url', 'data', jsonb_build_object(
      'web', p_app || '/?project=' || regexp_replace(e ->> 'id', '[^A-Za-z0-9_-]', '', 'g') || '&ws=' || (e ->> 'workspace'))));
  end loop;
  buttons := buttons || jsonb_build_object('label', 'Open Hermes', 'action', jsonb_build_object('type', 'open.url', 'data', jsonb_build_object('web', p_app)));

  return jsonb_build_object('text', msg, 'card', jsonb_build_object('title', 'Hermes', 'theme', 'modern-inline'),
                            'slides', slides, 'buttons', buttons);
end $$;

-- ── Network parts (Cliq) ───────────────────────────────────────────────────

create or replace function private.cliq_secret(p_name text) returns text
  language sql stable security definer set search_path = ''
  as $$ select decrypted_secret from vault.decrypted_secrets where name = p_name limit 1 $$;

create or replace function private.cliq_access_token() returns text
  language plpgsql volatile security definer set search_path = ''
  as $$
declare
  tok text;
  r extensions.http_response;
  j jsonb;
begin
  select access_token into tok from private.cliq_token where id = 1 and expires_at > now() + interval '2 minutes';
  if tok is not null then return tok; end if;
  r := extensions.http_post('https://accounts.zoho.com/oauth/v2/token',
         'grant_type=refresh_token'
         || '&client_id=' || extensions.urlencode(coalesce(private.cliq_secret('cliq_oauth_client_id'), ''))
         || '&client_secret=' || extensions.urlencode(coalesce(private.cliq_secret('cliq_oauth_client_secret'), ''))
         || '&refresh_token=' || extensions.urlencode(coalesce(private.cliq_secret('cliq_oauth_refresh_token'), '')),
         'application/x-www-form-urlencoded');
  if r.content ~ '^\s*\{' then j := r.content::jsonb; end if;
  if j ->> 'access_token' is null then
    -- Zoho's reply names the problem (invalid_client, "too many requests"…); it never echoes the secrets.
    raise exception 'Cliq token exchange failed (HTTP %): %', r.status, left(coalesce(j ->> 'error', r.content, ''), 160);
  end if;
  insert into private.cliq_token (id, access_token, expires_at)
  values (1, j ->> 'access_token', now() + make_interval(secs => coalesce((j ->> 'expires_in')::int, 3600)))
  on conflict (id) do update set access_token = excluded.access_token, expires_at = excluded.expires_at;
  return j ->> 'access_token';
end $$;

create or replace function private.cliq_get(p_path text) returns extensions.http_response
  language plpgsql volatile security definer set search_path = ''
  as $$
declare r extensions.http_response;
begin
  select * into r from extensions.http((
    'GET', 'https://cliq.zoho.com/api/v2' || p_path,
    array[extensions.http_header('Authorization', 'Zoho-oauthtoken ' || private.cliq_access_token())],
    null, null)::extensions.http_request);
  return r;
end $$;

create or replace function private.cliq_dm(p_address text, p_payload jsonb) returns extensions.http_response
  language plpgsql volatile security definer set search_path = ''
  as $$
declare r extensions.http_response;
begin
  select * into r from extensions.http((
    'POST', 'https://cliq.zoho.com/api/v2/buddies/' || extensions.urlencode(p_address) || '/message',
    array[extensions.http_header('Authorization', 'Zoho-oauthtoken ' || private.cliq_access_token())],
    'application/json', p_payload::text)::extensions.http_request);
  return r;
end $$;

-- A staff member's Cliq address, found once and remembered: their sign-in
-- email if Cliq knows it, else the one directory entry whose name has both
-- their first and last name. Not found → null (checked again after 7 days).
create or replace function private.cliq_address_for(p_email text, p_name text) returns text
  language plpgsql volatile security definer set search_path = ''
  as $$
declare
  em text := lower(btrim(p_email));
  c private.cliq_contacts;
  r extensions.http_response;
  j jsonb;
  u jsonb;
  toks text[] := private.name_tokens(p_name);
  cand text[];
  q text;
  seen text[] := '{}';
  hit_addr text;
  hit_name text;
begin
  select * into c from private.cliq_contacts where staff_email = em;
  if found and (c.how = 'manual'
                or (c.cliq_address is not null and c.checked_at > now() - interval '30 days')
                or (c.cliq_address is null and c.checked_at > now() - interval '7 days')) then
    return c.cliq_address;
  end if;

  r := private.cliq_get('/users/' || extensions.urlencode(em));
  if r.status = 429 then return null; end if; -- throttled: try again next time, remember nothing
  if r.status = 200 and r.content ~ '^\s*\{' then
    j := r.content::jsonb;
    hit_addr := lower(coalesce(nullif(j #>> '{data,email_id}', ''), em));
    insert into private.cliq_contacts (staff_email, cliq_address, cliq_name, how, checked_at)
    values (em, hit_addr, j #>> '{data,name}', 'email', now())
    on conflict (staff_email) do update set cliq_address = excluded.cliq_address, cliq_name = excluded.cliq_name, how = excluded.how, checked_at = now();
    return hit_addr;
  end if;

  if coalesce(array_length(toks, 1), 0) >= 2 then
    foreach q in array array[toks[array_length(toks, 1)], toks[1]] loop
      perform pg_sleep(0.3);
      r := private.cliq_get('/users?limit=50&search=' || extensions.urlencode(q));
      if r.status = 429 then return null; end if;
      continue when r.status <> 200 or r.content !~ '^\s*\{';
      for u in select x from jsonb_array_elements(coalesce(r.content::jsonb -> 'data', '[]'::jsonb)) as t(x) loop
        cand := private.name_tokens(coalesce(u ->> 'name', u ->> 'display_name'));
        if toks[1] = any (cand) and toks[array_length(toks, 1)] = any (cand)
           and nullif(u ->> 'email_id', '') is not null and not (lower(u ->> 'email_id') = any (seen)) then
          seen := seen || lower(u ->> 'email_id');
          hit_addr := lower(u ->> 'email_id');
          hit_name := btrim(coalesce(u ->> 'name', u ->> 'display_name'));
        end if;
      end loop;
    end loop;
    if coalesce(array_length(seen, 1), 0) = 1 then
      insert into private.cliq_contacts (staff_email, cliq_address, cliq_name, how, checked_at)
      values (em, hit_addr, hit_name, 'search', now())
      on conflict (staff_email) do update set cliq_address = excluded.cliq_address, cliq_name = excluded.cliq_name, how = excluded.how, checked_at = now();
      return hit_addr;
    end if;
  end if;

  insert into private.cliq_contacts (staff_email, cliq_address, cliq_name, how, checked_at)
  values (em, null, null, 'missing', now())
  on conflict (staff_email) do update set cliq_address = null, cliq_name = null, how = 'missing', checked_at = now();
  return null;
end $$;

-- The run. Modes: live (the schedule) | dry (no network) | resolve (look people
-- up, send nothing) | preview (send everyone's message to p_preview_to).
-- p_only limits it to one staff email. A live run skips anyone already sent
-- today, so running it twice doesn't double-send.
create or replace function private.send_cliq_reminders(p_mode text default 'live', p_only text default null, p_preview_to text default null)
returns jsonb
  language plpgsql volatile security definer set search_path = ''
  as $$
declare
  today date := (now() at time zone 'Asia/Manila')::date;
  plan jsonb := private.cliq_reminder_plan();
  p jsonb;
  addr text;
  msg jsonb;
  r extensions.http_response;
  err text;
  n_late int;
  n_soon int;
  n_team int;
  results jsonb := '[]'::jsonb;
begin
  if p_mode not in ('live', 'dry', 'resolve', 'preview') then
    raise exception 'mode must be live, dry, resolve or preview';
  end if;
  if p_mode = 'preview' and nullif(btrim(p_preview_to), '') is null then
    raise exception 'preview needs an address to send to';
  end if;
  if p_mode <> 'dry' then
    perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS', '15000');
  end if;

  for p in select x from jsonb_array_elements(plan) as t(x)
           where p_only is null or lower(x ->> 'email') = lower(btrim(p_only)) loop
    msg := private.cliq_reminder_message(p);
    n_late := (select count(*) from jsonb_array_elements(p -> 'own') as t(x) where x ->> 'kind' = 'overdue');
    n_soon := (select count(*) from jsonb_array_elements(p -> 'own') as t(x) where x ->> 'kind' = 'soon');
    n_team := jsonb_array_length(p -> 'team');

    if p_mode = 'dry' then
      results := results || jsonb_build_object('to', p ->> 'name', 'message', msg);
      continue;
    end if;
    if p_mode = 'live' and exists (select 1 from private.cliq_reminder_log l
                                   where l.sent_on = today and l.mode = 'live' and l.ok and l.staff_email = p ->> 'email') then
      results := results || jsonb_build_object('to', p ->> 'name', 'skipped', 'already sent today');
      continue;
    end if;

    r := null;
    err := null;
    begin
      if p_mode = 'preview' then
        addr := btrim(p_preview_to);
        msg := jsonb_set(msg, '{text}', to_jsonb(format('[Preview: what %s gets] %s', p ->> 'name', msg ->> 'text')));
      else
        addr := private.cliq_address_for(p ->> 'email', p ->> 'name');
      end if;
      if p_mode = 'resolve' then
        results := results || jsonb_build_object('to', p ->> 'name', 'address', addr);
        continue;
      end if;
      if addr is null then
        err := 'not found on Cliq';
      else
        r := private.cliq_dm(addr, msg);
        if r.status not between 200 and 299 then err := left(coalesce(r.content, ''), 300); end if;
      end if;
    exception when others then
      err := left(sqlerrm, 300);
    end;

    insert into private.cliq_reminder_log (sent_on, mode, staff_email, staff_name, cliq_address, own_overdue, own_due_soon, team_overdue, ok, http_status, error)
    values (today, p_mode, p ->> 'email', p ->> 'name', addr, n_late, n_soon, n_team, err is null, r.status, err);
    -- Cliq doesn't know that address after all: look them up again next time.
    if p_mode = 'live' and err ilike '%invalid_user%' then
      update private.cliq_contacts set cliq_address = null, how = 'missing', checked_at = now() - interval '8 days'
      where staff_email = p ->> 'email' and how <> 'manual';
    end if;
    results := results || jsonb_build_object('to', p ->> 'name', 'address', addr, 'ok', err is null, 'status', r.status, 'error', err);
    perform pg_sleep(0.4); -- Cliq throttles bursts
  end loop;

  return jsonb_build_object('mode', p_mode, 'day', today, 'people', jsonb_array_length(plan), 'results', results);
end $$;

-- ── Lock it down: server-only ──────────────────────────────────────────────
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p
           where p.pronamespace = 'private'::regnamespace
             and p.proname in ('is_are', 'name_tokens', 'cliq_reminder_plan', 'cliq_rows', 'cliq_reminder_message', 'cliq_secret',
                               'cliq_access_token', 'cliq_get', 'cliq_dm', 'cliq_address_for', 'send_cliq_reminders') loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
  -- Best effort: keep outbound HTTP for the server. (Supabase grants the http functions as
  -- supabase_admin, which this can't undo; the extensions schema isn't on the REST API anyway.)
  for f in select p.oid::regprocedure as sig from pg_proc p
           join pg_depend d on d.objid = p.oid and d.deptype = 'e'
           join pg_extension e on e.oid = d.refobjid and e.extname = 'http' loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;

-- Weekdays 01:00 UTC = 09:00 Manila.
do $$
begin
  perform cron.schedule('cliq-project-reminders', '0 1 * * 1-5', $c$select private.send_cliq_reminders('live')$c$);
exception when others then
  raise notice 'pg_cron unavailable (%) — schedule cliq-project-reminders by hand.', sqlerrm;
end $$;
