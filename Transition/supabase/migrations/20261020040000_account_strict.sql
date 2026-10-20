-- ============================================================================
-- Client accounts are the only way in (Operations).
-- Below Admin+, you see exactly the projects of the accounts you're on —
-- being assigned to a project in another account no longer opens it, and with
-- no account you see no Operations projects at all. Other workspaces don't use
-- accounts and are unaffected. (Signature kept; `assignees` is now unused.)
-- ============================================================================
create or replace function private.can_see(ws text, acc uuid, assignees text) returns boolean
  language sql stable security definer set search_path = ''
  as $$ select private.can_access(ws) and (not private.account_scoped(ws) or acc = any (private.my_accounts(ws))) $$;

revoke execute on function private.can_see(text, uuid, text) from public, anon;
grant execute on function private.can_see(text, uuid, text) to authenticated, service_role;
