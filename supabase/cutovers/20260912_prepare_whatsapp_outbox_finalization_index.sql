-- ONLINE PREPARATION for
-- 20260912160000_optimize_whatsapp_outbox_finalization_claim.sql.
--
-- The worker may reclaim a provider-accepted row even after max_attempts. The
-- previous partial index excluded that recovery branch, so PostgreSQL could not
-- use it for the complete conversation-head predicate. Build the exact
-- superset online, verify it, and only then retire the old index online.
-- Run with an autocommit-capable SQL client; do not wrap this file in BEGIN.
\set ON_ERROR_STOP on

set lock_timeout = '5s';
set statement_timeout = '0';

do $preflight_whatsapp_outbox_finalization_index$
begin
  if to_regclass('public.whatsapp_outbox') is null then
    raise exception 'public.whatsapp_outbox does not exist';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_index
    where indexrelid = to_regclass('public.whatsapp_outbox_conversation_due_head_v2_idx')
      and (not indisready or not indisvalid)
  ) then
    raise exception using
      message = 'public.whatsapp_outbox_conversation_due_head_v2_idx exists but is invalid',
      hint = 'Inspect it, then DROP INDEX CONCURRENTLY before retrying this cutover.';
  end if;
end;
$preflight_whatsapp_outbox_finalization_index$;

create index concurrently if not exists whatsapp_outbox_conversation_due_head_v2_idx
  on public.whatsapp_outbox (conversation_id, created_at, id)
  include (next_attempt_at)
  where status in ('pending', 'retry')
    and (
      attempts < max_attempts
      or last_error = 'provider_accepted_finalization_pending'
    );

do $verify_whatsapp_outbox_finalization_index$
declare
  index_definition text;
begin
  select regexp_replace(lower(pg_get_indexdef(index_state.indexrelid)), '\s+', ' ', 'g')
  into index_definition
  from pg_catalog.pg_index as index_state
  where index_state.indexrelid = to_regclass('public.whatsapp_outbox_conversation_due_head_v2_idx')
    and index_state.indrelid = 'public.whatsapp_outbox'::regclass
    and index_state.indisready
    and index_state.indisvalid
    and not index_state.indisunique;

  if index_definition is distinct from
     'create index whatsapp_outbox_conversation_due_head_v2_idx on public.whatsapp_outbox using btree (conversation_id, created_at, id) include (next_attempt_at) where ((status = any (array[''pending''::text, ''retry''::text])) and ((attempts < max_attempts) or (last_error = ''provider_accepted_finalization_pending''::text)))'
  then
    raise exception 'public.whatsapp_outbox_conversation_due_head_v2_idx is missing, invalid, or unexpected';
  end if;
end;
$verify_whatsapp_outbox_finalization_index$;

drop index concurrently if exists public.whatsapp_outbox_conversation_due_head_idx;

reset statement_timeout;
reset lock_timeout;
