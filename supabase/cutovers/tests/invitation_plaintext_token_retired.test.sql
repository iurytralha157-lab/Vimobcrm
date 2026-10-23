begin;
set local role postgres;
set local search_path = public, private, auth, extensions, pgtap, pg_catalog;

create extension if not exists pgtap with schema extensions;
select plan(7);

select hasnt_column('public', 'invitations', 'token', 'legacy plaintext token column is gone');
select has_column('public', 'invitations', 'token_hash', 'canonical hash remains');
select col_not_null('public', 'invitations', 'token_hash', 'all invitations require a hash');
select ok(
  not exists (
    select 1 from public.invitations
    where token_hash !~ '^[0-9a-f]{64}$'
  ),
  'existing invite hashes retain canonical format'
);
select ok(
  exists (
    select 1 from pg_catalog.pg_index index_row
    where index_row.indrelid = 'public.invitations'::regclass
      and index_row.indisunique and index_row.indisvalid
      and index_row.indexrelid = pg_catalog.to_regclass('public.invitations_token_hash_uidx')
  ),
  'hash lookup retains a valid unique index'
);
select ok(
  not has_table_privilege('anon', 'public.invitations', 'SELECT')
  and not has_table_privilege('authenticated', 'public.invitations', 'SELECT'),
  'browser roles cannot read invitation rows'
);
select ok(
  not exists (
    select 1 from pg_catalog.pg_trigger
    where tgrelid = 'public.invitations'::regclass
      and tgname = 'sync_invitation_token_hash'
      and not tgisinternal
  ),
  'plaintext compatibility trigger is retired'
);

select * from finish();
rollback;
