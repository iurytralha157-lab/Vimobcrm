-- Give the high-throughput text lane and the slow media lane independent head
-- indexes. PostgreSQL cannot use a partial index when the predicate is hidden
-- behind a runtime lane parameter, so the Go worker pairs these indexes with
-- literal, lane-specialized claim statements.
--
-- Populated databases must build both indexes concurrently with
-- supabase/cutovers/20260912_prepare_whatsapp_outbox_lane_indexes.sql first.
-- This migration only builds them directly when the outbox is locked and
-- provably pristine, keeping disposable resets self-contained.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '15s';

do $prepare_whatsapp_outbox_lane_indexes$
declare
  fast_index_missing boolean;
  media_index_missing boolean;
begin
  if to_regclass('public.whatsapp_outbox') is null then
    raise exception using
      message = 'WhatsApp outbox finalization-aware foundation is not installed',
      hint = 'Apply 20260912160000_optimize_whatsapp_outbox_finalization_claim.sql first.';
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
      message = 'WhatsApp outbox finalization-aware foundation is not ready',
      hint = 'Complete the v2 outbox head-index cutover first.';
  end if;

  fast_index_missing :=
    to_regclass('public.whatsapp_outbox_fast_due_head_idx') is null;
  media_index_missing :=
    to_regclass('public.whatsapp_outbox_media_due_head_idx') is null;

  if fast_index_missing or media_index_missing then
    begin
      lock table public.whatsapp_outbox in share mode nowait;
    exception
      when lock_not_available then
        raise exception using
          message = 'WhatsApp outbox lane indexes were not prepared before migration',
          hint = 'Run supabase/cutovers/20260912_prepare_whatsapp_outbox_lane_indexes.sql with an autocommit-capable client.';
    end;

    if exists (select 1 from public.whatsapp_outbox limit 1)
       or pg_relation_size('public.whatsapp_outbox'::regclass) > 64 * 1024 * 1024
    then
      raise exception using
        message = 'WhatsApp outbox lane indexes are missing on a populated table',
        hint = 'Run supabase/cutovers/20260912_prepare_whatsapp_outbox_lane_indexes.sql before this migration.';
    end if;

    if fast_index_missing then
      create index whatsapp_outbox_fast_due_head_idx
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
    end if;

    if media_index_missing then
      create index whatsapp_outbox_media_due_head_idx
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
    end if;
  end if;
end;
$prepare_whatsapp_outbox_lane_indexes$;

-- Build canonical throwaway definitions in the same PostgreSQL version, then
-- compare the complete method/keys/include/predicate signature. This is exact
-- without depending on formatting or silently accepting a same-name drifted
-- index through CREATE INDEX IF NOT EXISTS.
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
        hint = 'Run the reviewed online lane-index cutover before retrying.';
    end if;
  end loop;
end;
$verify_whatsapp_outbox_lane_indexes$;

comment on index public.whatsapp_outbox_fast_due_head_idx is
  'Literal fast-lane FIFO heads, including provider-accepted local finalization.';

comment on index public.whatsapp_outbox_media_due_head_idx is
  'Literal media-lane FIFO heads, isolated from high-throughput text claims.';

commit;
