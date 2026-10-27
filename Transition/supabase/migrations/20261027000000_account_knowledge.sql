-- ============================================================================
-- Account knowledge: each client account's SOPs and notes, which the AI reads
-- when it plans a project for that account (and Caddy can search).
--
--   public.account_knowledge  one row per account: free-text notes for the AI
--   public.account_docs       SOP documents — uploaded (.docx/.pdf/.txt/.md,
--                             original kept in the private "account-sops"
--                             bucket) or typed in Hermes. `content` is the
--                             text the AI reads; `digest` is what the AI took
--                             from it (steps, approvals, timelines, tools…).
--
-- Who: anyone who can see the account (its workspace + account membership,
-- the same rule as its projects) can read, add and edit. Deleting a document
-- is for Admins and above, or whoever added it.
-- ============================================================================

create table if not exists public.account_knowledge (
  account_id uuid primary key references public.workspace_accounts (id) on delete cascade,
  notes      text not null default '',
  updated_by text,
  updated_at timestamptz not null default now()
);

create table if not exists public.account_docs (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references public.workspace_accounts (id) on delete cascade,
  title         text not null,
  source        text not null default 'upload' check (source in ('upload', 'typed')),
  file_name     text,
  file_type     text,
  file_size     integer,
  storage_path  text,
  content       text not null default '',
  words         integer not null default 0,
  digest        jsonb,
  digest_status text not null default 'pending' check (digest_status in ('pending', 'ready', 'failed')),
  digest_error  text,
  created_by    text,
  created_at    timestamptz not null default now(),
  updated_by    text,
  updated_at    timestamptz not null default now()
);
create index if not exists account_docs_account_idx on public.account_docs (account_id, created_at);

-- Can the signed-in person see this account? (Same rule as the account's projects.)
create or replace function private.can_see_account(acc uuid) returns boolean
  language sql stable security definer set search_path = ''
  as $$ select coalesce((select private.can_see(a.workspace, a.id, null) from public.workspace_accounts a where a.id = acc), false) $$;

create or replace function private.uuid_or_null(v text) returns uuid
  language plpgsql immutable set search_path = ''
  as $$ begin return v::uuid; exception when others then return null; end $$;

create or replace function private.word_count(t text) returns integer
  language sql immutable set search_path = ''
  as $$ select coalesce(array_length(regexp_split_to_array(btrim(coalesce(t, '')), '\s+'), 1), 0)
               - case when btrim(coalesce(t, '')) = '' then 1 else 0 end $$;

alter table public.account_knowledge enable row level security;
alter table public.account_docs enable row level security;
drop policy if exists account_knowledge_read on public.account_knowledge;
create policy account_knowledge_read on public.account_knowledge for select to authenticated using (private.can_see_account(account_id));
drop policy if exists account_docs_read on public.account_docs;
create policy account_docs_read on public.account_docs for select to authenticated using (private.can_see_account(account_id));
revoke insert, update, delete on public.account_knowledge, public.account_docs from anon, authenticated;
grant select on public.account_knowledge, public.account_docs to authenticated;

-- ── Reads ───────────────────────────────────────────────────────────────────

-- Every account this person can see, with how much the AI knows about it.
create or replace function public.get_knowledge_overview(p_workspace text) returns jsonb
  language sql stable security definer set search_path = ''
  as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'accountId', a.id, 'name', a.name,
           'docs', (select count(*) from public.account_docs d where d.account_id = a.id),
           'words', coalesce((select sum(d.words) from public.account_docs d where d.account_id = a.id), 0)
                    + private.word_count(k.notes),
           'hasNotes', btrim(coalesce(k.notes, '')) <> '',
           'updatedAt', private.ms(greatest(k.updated_at, (select max(d.updated_at) from public.account_docs d where d.account_id = a.id))))
         order by lower(a.name)), '[]'::jsonb)
  from public.workspace_accounts a
  left join public.account_knowledge k on k.account_id = a.id
  where a.workspace = p_workspace and private.can_see(a.workspace, a.id, null) $$;

-- One account's notes and its documents (without their full text).
create or replace function public.get_account_knowledge(p_account_id uuid) returns jsonb
  language plpgsql stable security definer set search_path = ''
  as $$
declare acc public.workspace_accounts; k public.account_knowledge;
begin
  select * into acc from public.workspace_accounts where id = p_account_id;
  if not found or not private.can_see_account(p_account_id) then return null; end if;
  select * into k from public.account_knowledge where account_id = p_account_id;
  return jsonb_build_object(
    'accountId', acc.id, 'name', acc.name, 'workspace', acc.workspace,
    'notes', coalesce(k.notes, ''), 'notesUpdatedBy', k.updated_by, 'notesUpdatedAt', private.ms(k.updated_at),
    'canDelete', private.is_admin_level(),
    'docs', coalesce((select jsonb_agg(jsonb_build_object(
              '_id', d.id, 'title', d.title, 'source', d.source, 'fileName', d.file_name, 'fileType', d.file_type,
              'fileSize', d.file_size, 'storagePath', d.storage_path, 'words', d.words, 'digest', d.digest,
              'digestStatus', d.digest_status, 'digestError', d.digest_error,
              'createdBy', d.created_by, 'createdAt', private.ms(d.created_at),
              'updatedBy', d.updated_by, 'updatedAt', private.ms(d.updated_at)) order by d.created_at desc)
            from public.account_docs d where d.account_id = p_account_id), '[]'::jsonb));
end $$;

-- One document with its full text.
create or replace function public.get_account_doc(p_doc_id uuid) returns jsonb
  language sql stable security definer set search_path = ''
  as $$
  select jsonb_build_object('_id', d.id, 'accountId', d.account_id, 'title', d.title, 'source', d.source,
           'fileName', d.file_name, 'fileType', d.file_type, 'storagePath', d.storage_path, 'content', d.content,
           'words', d.words, 'digest', d.digest, 'digestStatus', d.digest_status, 'createdBy', d.created_by,
           'createdAt', private.ms(d.created_at), 'updatedBy', d.updated_by, 'updatedAt', private.ms(d.updated_at))
  from public.account_docs d where d.id = p_doc_id and private.can_see_account(d.account_id) $$;

-- Everything the AI reads for an account: notes + each document's text and digest.
create or replace function public.get_account_knowledge_pack(p_account_id uuid) returns jsonb
  language sql stable security definer set search_path = ''
  as $$
  select case when private.can_see_account(a.id) then jsonb_build_object(
           'accountId', a.id, 'name', a.name,
           'notes', coalesce((select k.notes from public.account_knowledge k where k.account_id = a.id), ''),
           'docs', coalesce((select jsonb_agg(jsonb_build_object('_id', d.id, 'title', d.title, 'content', d.content,
                                                                'words', d.words, 'digest', d.digest) order by d.created_at)
                             from public.account_docs d where d.account_id = a.id), '[]'::jsonb)) end
  from public.workspace_accounts a where a.id = p_account_id $$;

-- ── Writes ──────────────────────────────────────────────────────────────────

create or replace function public.save_account_notes(p_account_id uuid, p_notes text) returns void
  language plpgsql security definer set search_path = ''
  as $$
begin
  perform private.require(private.can_see_account(p_account_id), 'You can only edit the knowledge of accounts you''re on.');
  insert into public.account_knowledge (account_id, notes, updated_by, updated_at)
  values (p_account_id, left(coalesce(p_notes, ''), 200000), private.actor_name(null), now())
  on conflict (account_id) do update set notes = excluded.notes, updated_by = excluded.updated_by, updated_at = now();
end $$;

create or replace function public.add_account_doc(p_account_id uuid, p_title text, p_source text, p_content text,
                                                  p_file_name text default null, p_file_type text default null,
                                                  p_file_size integer default null, p_storage_path text default null)
returns uuid
  language plpgsql security definer set search_path = ''
  as $$
declare new_id uuid; clean_title text := left(btrim(coalesce(p_title, '')), 200);
begin
  perform private.require(private.can_see_account(p_account_id), 'You can only add SOPs to accounts you''re on.');
  perform private.require(clean_title <> '', 'Give the SOP a title.');
  perform private.require(p_storage_path is null or private.uuid_or_null(split_part(p_storage_path, '/', 1)) = p_account_id,
                          'That file belongs to another account.');
  insert into public.account_docs (account_id, title, source, content, words, file_name, file_type, file_size, storage_path, created_by, updated_by)
  values (p_account_id, clean_title, case when p_source = 'typed' then 'typed' else 'upload' end,
          left(coalesce(p_content, ''), 2000000), private.word_count(p_content),
          p_file_name, p_file_type, p_file_size, p_storage_path, private.actor_name(null), private.actor_name(null))
  returning id into new_id;
  return new_id;
end $$;

-- Rename and/or change the text. New text → the AI reads it again.
create or replace function public.update_account_doc(p_doc_id uuid, p_title text default null, p_content text default null) returns void
  language plpgsql security definer set search_path = ''
  as $$
declare d public.account_docs;
begin
  select * into d from public.account_docs where id = p_doc_id;
  perform private.require(found and private.can_see_account(d.account_id), 'You can only edit SOPs of accounts you''re on.');
  update public.account_docs set
    title = coalesce(nullif(left(btrim(coalesce(p_title, '')), 200), ''), title),
    content = coalesce(left(p_content, 2000000), content),
    words = case when p_content is null then words else private.word_count(p_content) end,
    digest_status = case when p_content is not null and p_content is distinct from content then 'pending' else digest_status end,
    updated_by = private.actor_name(null), updated_at = now()
  where id = p_doc_id;
end $$;

-- What the AI took from a document (written by the browser after it reads it).
create or replace function public.set_account_doc_digest(p_doc_id uuid, p_digest jsonb, p_status text, p_error text default null) returns void
  language plpgsql security definer set search_path = ''
  as $$
declare d public.account_docs;
begin
  select * into d from public.account_docs where id = p_doc_id;
  perform private.require(found and private.can_see_account(d.account_id), 'You can only update SOPs of accounts you''re on.');
  update public.account_docs set
    digest = case when p_status = 'ready' then p_digest else digest end,
    digest_status = case when p_status in ('pending', 'ready', 'failed') then p_status else digest_status end,
    digest_error = case when p_status = 'failed' then left(coalesce(p_error, ''), 500) else null end
  where id = p_doc_id;
end $$;

-- Returns the stored file's path so the browser can remove the file too.
create or replace function public.delete_account_doc(p_doc_id uuid) returns text
  language plpgsql security definer set search_path = ''
  as $$
declare d public.account_docs;
begin
  select * into d from public.account_docs where id = p_doc_id;
  if not found then return null; end if;
  perform private.require(private.can_see_account(d.account_id)
                          and (private.is_admin_level() or d.created_by = private.actor_name(null)),
                          'Only Admins, or whoever added it, can delete an SOP.');
  delete from public.account_docs where id = p_doc_id;
  return d.storage_path;
end $$;

-- ── Original files: private bucket, one folder per account ─────────────────
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit)
    values ('account-sops', 'account-sops', false, 15728640)
    on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;
    execute $p$drop policy if exists "account sops: read" on storage.objects$p$;
    execute $p$drop policy if exists "account sops: upload" on storage.objects$p$;
    execute $p$drop policy if exists "account sops: delete" on storage.objects$p$;
    execute $p$create policy "account sops: read" on storage.objects for select to authenticated
              using (bucket_id = 'account-sops' and private.can_see_account(private.uuid_or_null((storage.foldername(name))[1])))$p$;
    execute $p$create policy "account sops: upload" on storage.objects for insert to authenticated
              with check (bucket_id = 'account-sops' and private.can_see_account(private.uuid_or_null((storage.foldername(name))[1])))$p$;
    execute $p$create policy "account sops: delete" on storage.objects for delete to authenticated
              using (bucket_id = 'account-sops' and private.can_see_account(private.uuid_or_null((storage.foldername(name))[1]))
                     and (private.is_admin_level() or owner_id = (select auth.uid())::text))$p$;
  end if;
end $$;

-- ── Grants + live updates ───────────────────────────────────────────────────
do $$
declare f record; t text;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p
           where p.pronamespace = 'public'::regnamespace
             and p.proname in ('get_knowledge_overview', 'get_account_knowledge', 'get_account_doc', 'get_account_knowledge_pack',
                               'save_account_notes', 'add_account_doc', 'update_account_doc', 'set_account_doc_digest', 'delete_account_doc') loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated, service_role', f.sig);
  end loop;
  for f in select p.oid::regprocedure as sig from pg_proc p
           where p.pronamespace = 'private'::regnamespace and p.proname in ('can_see_account', 'uuid_or_null', 'word_count') loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated, service_role', f.sig);
  end loop;
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['account_knowledge', 'account_docs'] loop
      begin
        execute format('alter publication supabase_realtime add table public.%I', t);
      exception when duplicate_object then null;
      end;
    end loop;
  end if;
end $$;
