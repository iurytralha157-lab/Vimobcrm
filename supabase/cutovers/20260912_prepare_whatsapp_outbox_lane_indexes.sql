-- ONLINE PREPARATION for
-- 20260912183453_isolate_whatsapp_outbox_lane_claims.sql.
--
-- Run this file in a dedicated autocommit-capable psql invocation. Do not wrap the whole
-- file in BEGIN: CREATE INDEX CONCURRENTLY cannot run in a transaction block.
-- The two builds are intentionally sequential because PostgreSQL permits only
-- one concurrent index build on a table at a time. ON_ERROR_STOP makes a
-- failed dedicated invocation disconnect and release the session lock.
\set ON_ERROR_STOP on

set lock_timeout = '5s';
set statement_timeout = '0';

do $preflight_whatsapp_outbox_lane_indexes$
declare
  index_name text;
begin
  if to_regclass('public.whatsapp_outbox') is null then
    raise exception 'public.whatsapp_outbox does not exist';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_index
    where indexrelid = to_regclass('public.whatsapp_outbox_conversation_due_head_v2_idx')
      and indrelid = 'public.whatsapp_outbox'::regclass
      and indisready
      and indisvalid
  ) then
    raise exception using
      message = 'public.whatsapp_outbox_conversation_due_head_v2_idx is not ready',
      hint = 'Complete the finalization-aware outbox index cutover first.';
  end if;

  foreach index_name in array array[
    'whatsapp_outbox_fast_due_head_idx',
    'whatsapp_outbox_media_due_head_idx'
  ]
  loop
    if exists (
      select 1
      from pg_catalog.pg_class index_relation
      join pg_catalog.pg_index index_state
        on index_state.indexrelid = index_relation.oid
      join pg_catalog.pg_namespace index_namespace
        on index_namespace.oid = index_relation.relnamespace
      where index_namespace.nspname = 'public'
        and index_relation.relname = index_name
        and (not index_state.indisready or not index_state.indisvalid)
    ) then
      raise exception using
        message = format('index public.%I exists but is not ready and valid', index_name),
        hint = 'Inspect it, then DROP INDEX CONCURRENTLY before retrying this cutover.';
    end if;
  end loop;
end;
$preflight_whatsapp_outbox_lane_indexes$;

set statement_timeout = '30s';
select pg_advisory_lock(hashtextextended('vimob:whatsapp-outbox:lane-index-cutover', 0));
set statement_timeout = '0';

create index concurrently if not exists whatsapp_outbox_fast_due_head_idx
  on public.whatsapp_outbox (conversation_id, created_at, id)
  include (next_attempt_at)
  where status in ('pending', 'retry')
    and (
      attempts < max_attempts
      or last_error = 'provider_accepted_finalization_pending'
    )
    and not (
      lower(coalesce(payload->>'action', '')) in ('send.media', 'send.audio', 'send.sticker')
      or lower(coalesce(message_type, '')) in ('image', 'audio', 'video', 'document', 'sticker')
    );

create index concurrently if not exists whatsapp_outbox_media_due_head_idx
  on public.whatsapp_outbox (conversation_id, created_at, id)
  include (next_attempt_at)
  where status in ('pending', 'retry')
    and (
      attempts < max_attempts
      or last_error = 'provider_accepted_finalization_pending'
    )
    and (
      lower(coalesce(payload->>'action', '')) in ('send.media', 'send.audio', 'send.sticker')
      or lower(coalesce(message_type, '')) in ('image', 'audio', 'video', 'document', 'sticker')
    );

-- Exact, server-native contract comparison. The verification transaction is
-- separate from both concurrent builds and only creates session-local objects.
begin;

create temporary table whatsapp_outbox_lane_index_contract
  (like public.whatsapp_outbox)
  on commit drop;

create index whatsapp_outbox_lane_contract_fast_idx
  on whatsapp_outbox_lane_index_contract (conversation_id, created_at, id)
  include (next_attempt_at)
  where status in ('pending', 'retry')
    and (
      attempts < max_attempts
      or last_error = 'provider_accepted_finalization_pending'
    )
    and not (
      lower(coalesce(payload->>'action', '')) in ('send.media', 'send.audio', 'send.sticker')
      or lower(coalesce(message_type, '')) in ('image', 'audio', 'video', 'document', 'sticker')
    );

create index whatsapp_outbox_lane_contract_media_idx
  on whatsapp_outbox_lane_index_contract (conversation_id, created_at, id)
  include (next_attempt_at)
  where status in ('pending', 'retry')
    and (
      attempts < max_attempts
      or last_error = 'provider_accepted_finalization_pending'
    )
    and (
      lower(coalesce(payload->>'action', '')) in ('send.media', 'send.audio', 'send.sticker')
      or lower(coalesce(message_type, '')) in ('image', 'audio', 'video', 'document', 'sticker')
    );

do $verify_whatsapp_outbox_lane_indexes$
declare
  index_name text;
  contract_name text;
  actual_signature text;
  expected_signature text;
  index_ready boolean;
begin
  for index_name, contract_name in
    values
      ('whatsapp_outbox_fast_due_head_idx', 'whatsapp_outbox_lane_contract_fast_idx'),
      ('whatsapp_outbox_media_due_head_idx', 'whatsapp_outbox_lane_contract_media_idx')
  loop
    index_ready := false;
    actual_signature := null;
    expected_signature := null;

    select
      index_state.indisready and index_state.indisvalid
        and not index_state.indisunique
        and access_method.amname = 'btree',
      substring(
        lower(pg_get_indexdef(index_state.indexrelid))
        from position(' using ' in lower(pg_get_indexdef(index_state.indexrelid))) + 1
      )
    into index_ready, actual_signature
    from pg_catalog.pg_index index_state
    join pg_catalog.pg_class index_relation
      on index_relation.oid = index_state.indexrelid
    join pg_catalog.pg_namespace index_namespace
      on index_namespace.oid = index_relation.relnamespace
    join pg_catalog.pg_am access_method
      on access_method.oid = index_relation.relam
    where index_namespace.nspname = 'public'
      and index_relation.relname = index_name
      and index_state.indrelid = 'public.whatsapp_outbox'::regclass;

    select substring(
      lower(pg_get_indexdef(index_state.indexrelid))
      from position(' using ' in lower(pg_get_indexdef(index_state.indexrelid))) + 1
    )
    into expected_signature
    from pg_catalog.pg_index index_state
    join pg_catalog.pg_class index_relation
      on index_relation.oid = index_state.indexrelid
    join pg_catalog.pg_namespace index_namespace
      on index_namespace.oid = index_relation.relnamespace
    where index_namespace.oid = pg_my_temp_schema()
      and index_relation.relname = contract_name;

    if index_ready is distinct from true
       or actual_signature is distinct from expected_signature
    then
      raise exception using
        message = format('public.%I is missing, invalid, or unexpected', index_name),
        hint = 'Inspect the existing same-name index before retrying.';
    end if;
  end loop;
end;
$verify_whatsapp_outbox_lane_indexes$;

commit;

select pg_advisory_unlock(hashtextextended('vimob:whatsapp-outbox:lane-index-cutover', 0));

reset statement_timeout;
reset lock_timeout;
