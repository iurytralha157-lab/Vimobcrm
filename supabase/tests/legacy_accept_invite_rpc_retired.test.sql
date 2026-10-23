begin;

create extension if not exists pgtap with schema extensions;
select plan(6);

select ok(
  to_regprocedure('public.accept_invite(text)') is null,
  'the broken legacy invitation acceptance RPC is retired'
);

select ok(
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'invitations'
      and column_name = 'used_at'
  )
  and not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'invitations'
      and column_name = 'accepted_at'
  ),
  'used_at remains the single source of truth for invitation acceptance'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_index index_row
    where index_row.indrelid = 'public.invitations'::regclass
      and index_row.indisunique and index_row.indisvalid
      and index_row.indexrelid = pg_catalog.to_regclass('public.invitations_token_hash_uidx')
  ),
  'invitation token hashes are protected by a unique index'
);

select ok(
  not exists (
    select 1
    from public.invitations
    group by token_hash
    having count(*) > 1
  ),
  'existing invitation token hashes are unique'
);

select ok(
  coalesce(
    (
      select relrowsecurity
      from pg_catalog.pg_class
      where oid = 'public.invitations'::regclass
    ),
    false
  ),
  'row level security remains enabled on invitations'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.organization_members'::regclass
      and contype = 'u'
      and pg_get_constraintdef(oid) = 'UNIQUE (user_id, organization_id)'
  ),
  'organization membership keeps the uniqueness required by invitation acceptance'
);

select * from finish();
rollback;
