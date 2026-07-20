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
    from pg_catalog.pg_constraint
    where conrelid = 'public.invitations'::regclass
      and conname = 'invitations_token_key'
      and contype = 'u'
  ),
  'invitation tokens are protected by a unique constraint'
);

select ok(
  not exists (
    select 1
    from public.invitations
    group by token
    having count(*) > 1
  ),
  'existing invitation tokens are unique'
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
