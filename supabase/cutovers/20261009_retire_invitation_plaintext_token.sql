-- Manual, irreversible invitation-token cutover. Never run through db push.
-- See docs/runbooks/invitations.md for replica and pending-link gates.
\set ON_ERROR_STOP on

\if :{?compatible_api_sha}
\else
  \set compatible_api_sha missing
\endif
\if :{?old_replicas_drained}
\else
  \set old_replicas_drained false
\endif
\if :{?backup_confirmed}
\else
  \set backup_confirmed false
\endif

select pg_catalog.set_config('vimob.invitation_compatible_api_sha', :'compatible_api_sha', false);
select pg_catalog.set_config('vimob.invitation_old_replicas_drained', :'old_replicas_drained', false);
select pg_catalog.set_config('vimob.invitation_backup_confirmed', :'backup_confirmed', false);

begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
lock table public.invitations in access exclusive mode;

do $cutover$
declare
  v_sha text := pg_catalog.current_setting('vimob.invitation_compatible_api_sha', true);
  v_old_replicas_drained text := pg_catalog.current_setting('vimob.invitation_old_replicas_drained', true);
  v_backup_confirmed text := pg_catalog.current_setting('vimob.invitation_backup_confirmed', true);
begin
  if v_sha is null or v_sha !~ '^[0-9a-f]{40}$'
     or v_old_replicas_drained is distinct from 'true'
     or v_backup_confirmed is distinct from 'true' then
    raise exception 'invitation cutover requires compatible deployed SHA, drained old replicas, and verified backup';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_attribute
    where attrelid = 'public.invitations'::regclass
      and attname = 'token' and attnum > 0 and not attisdropped
  ) then
    raise exception 'legacy invitations.token column is already absent';
  end if;

  if exists (
    select 1
    from public.invitations invitation
    where invitation.token_hash is null
       or invitation.token_hash !~ '^[0-9a-f]{64}$'
       or invitation.token_hash is distinct from
          pg_catalog.encode(extensions.digest(invitation.token, 'sha256'), 'hex')
  ) then
    raise exception 'invitation token/hash pairs differ; resolve before cutover';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_index index_row
    where index_row.indrelid = 'public.invitations'::regclass
      and index_row.indisunique and index_row.indisvalid
      and index_row.indexrelid = pg_catalog.to_regclass('public.invitations_token_hash_uidx')
  ) then
    raise exception 'invitations.token_hash requires a valid unique index';
  end if;
end
$cutover$;

drop trigger if exists sync_invitation_token_hash on public.invitations;
drop function if exists private.sync_invitation_token_hash();
alter table public.invitations drop constraint if exists invitations_token_key;
alter table public.invitations drop column token;

comment on column public.invitations.token_hash is
  'Canonical SHA-256 digest for invite lookup and acceptance. Raw invite tokens are never persisted.';

commit;
