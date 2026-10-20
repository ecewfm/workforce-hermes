-- ============================================================================
-- Client accounts lock by default (Operations).
-- Below Admin+, someone with NO account now sees no Operations projects
-- (except ones they're assigned to) and can't start one — until an Admin+ or
-- Manager ties them to an account. Before this, "no account" meant "every
-- account". Admin+ and Managers still see everything.
-- ============================================================================

-- Workspaces whose projects belong to client accounts (mirror of usesAccounts()).
create or replace function private.uses_accounts(ws text) returns boolean
  language sql immutable set search_path = ''
  as $$ select ws = 'operations' $$;

-- Is the caller limited to their own accounts here? Everyone below Admin+.
create or replace function private.account_scoped(ws text) returns boolean
  language sql stable security definer set search_path = ''
  as $$ select private.uses_accounts(ws)
           and not (private.is_service() or private.is_main_admin() or private.is_admin_plus()) $$;

-- A scoped person's project must go in one of their accounts.
create or replace function private.scoped_account(ws text, aid text) returns uuid
  language plpgsql stable security definer set search_path = ''
  as $$
declare mine uuid[] := private.my_accounts(ws); r uuid;
begin
  if not private.account_scoped(ws) then return private.account_in(ws, aid); end if;
  if cardinality(mine) = 0 then
    raise exception 'You aren''t on a client account yet — ask an Admin+ or Manager to add you to one.';
  end if;
  if aid is null or btrim(aid) = '' then
    if cardinality(mine) = 1 then return mine[1]; end if;
    raise exception 'Pick one of your accounts for this project.';
  end if;
  r := private.account_in(ws, aid);
  perform private.require(r = any (mine), 'You can only use your own accounts.');
  return r;
end $$;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p
           where p.pronamespace = 'private'::regnamespace and p.proname in ('uses_accounts', 'account_scoped', 'scoped_account') loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated, service_role', f.sig);
  end loop;
end $$;
