-- Protected production pre-step for
-- 20260909164702_optimize_whatsapp_outbox_fast_lane.sql.
--
-- Run with an autocommit-capable SQL client. Do not wrap this file in a
-- transaction: CREATE INDEX CONCURRENTLY keeps new outgoing messages writable.

set lock_timeout = '5s';
set statement_timeout = '0';

do $preflight_whatsapp_outbox_fast_lane_indexes$
declare
  index_name text;
begin
  if to_regclass('public.whatsapp_outbox') is null then
    raise exception 'public.whatsapp_outbox does not exist';
  end if;

  foreach index_name in array array[
    'whatsapp_outbox_conversation_due_head_idx',
    'whatsapp_outbox_conversation_processing_idx'
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
        hint = 'Inspect it, then use DROP INDEX CONCURRENTLY before retrying this cutover.';
    end if;
  end loop;
end;
$preflight_whatsapp_outbox_fast_lane_indexes$;

create index concurrently if not exists whatsapp_outbox_conversation_due_head_idx
  on public.whatsapp_outbox (
    conversation_id,
    created_at,
    id
  )
  include (next_attempt_at)
  where status in ('pending', 'retry')
    and attempts < max_attempts;

create index concurrently if not exists whatsapp_outbox_conversation_processing_idx
  on public.whatsapp_outbox (conversation_id)
  where status = 'processing';

do $verify_whatsapp_outbox_fast_lane_online_indexes$
begin
  if not exists (
    select 1
    from pg_catalog.pg_indexes index_definition
    join pg_catalog.pg_class index_relation
      on index_relation.relname = index_definition.indexname
    join pg_catalog.pg_namespace index_namespace
      on index_namespace.oid = index_relation.relnamespace
     and index_namespace.nspname = index_definition.schemaname
    join pg_catalog.pg_index index_state
      on index_state.indexrelid = index_relation.oid
    where index_definition.schemaname = 'public'
      and index_definition.tablename = 'whatsapp_outbox'
      and index_definition.indexname = 'whatsapp_outbox_conversation_due_head_idx'
      and index_state.indisready
      and index_state.indisvalid
      and regexp_replace(lower(index_definition.indexdef), '\s+', ' ', 'g')
        like '%(conversation_id, created_at, id) include (next_attempt_at)%'
      and regexp_replace(lower(index_definition.indexdef), '\s+', ' ', 'g')
        like '%status%pending%retry%'
      and regexp_replace(lower(index_definition.indexdef), '\s+', ' ', 'g')
        like '%attempts < max_attempts%'
  ) then
    raise exception 'public.whatsapp_outbox_conversation_due_head_idx is not ready, valid, and exact';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_indexes index_definition
    join pg_catalog.pg_class index_relation
      on index_relation.relname = index_definition.indexname
    join pg_catalog.pg_namespace index_namespace
      on index_namespace.oid = index_relation.relnamespace
     and index_namespace.nspname = index_definition.schemaname
    join pg_catalog.pg_index index_state
      on index_state.indexrelid = index_relation.oid
    where index_definition.schemaname = 'public'
      and index_definition.tablename = 'whatsapp_outbox'
      and index_definition.indexname = 'whatsapp_outbox_conversation_processing_idx'
      and index_state.indisready
      and index_state.indisvalid
      and regexp_replace(lower(index_definition.indexdef), '\s+', ' ', 'g')
        like '%(conversation_id)%'
      and regexp_replace(lower(index_definition.indexdef), '\s+', ' ', 'g')
        like '%status = ''processing''%'
  ) then
    raise exception 'public.whatsapp_outbox_conversation_processing_idx is not ready, valid, and exact';
  end if;
end;
$verify_whatsapp_outbox_fast_lane_online_indexes$;

reset statement_timeout;
reset lock_timeout;
