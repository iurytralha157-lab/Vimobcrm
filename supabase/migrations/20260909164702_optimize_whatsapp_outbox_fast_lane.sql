-- Records the production-safe indexes required by the Go outbound worker's
-- conversation-fair text/media lanes. Live databases must prepare them online
-- with supabase/cutovers/20260909_prepare_whatsapp_outbox_fast_lane_indexes.sql.
-- A blocking fallback is allowed only for a locked, provably empty outbox so
-- disposable database resets remain self-contained.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '5s';

do $prepare_empty_whatsapp_outbox_fast_lane_indexes$
declare
  due_head_missing boolean;
  processing_missing boolean;
begin
  if to_regclass('public.whatsapp_outbox') is null
     or to_regclass('public.whatsapp_conversations') is null then
    raise exception 'WhatsApp durable outbox foundation is not installed';
  end if;

  due_head_missing :=
    to_regclass('public.whatsapp_outbox_conversation_due_head_idx') is null;
  processing_missing :=
    to_regclass('public.whatsapp_outbox_conversation_processing_idx') is null;

  if due_head_missing or processing_missing then
    begin
      lock table public.whatsapp_outbox in share mode nowait;
    exception
      when lock_not_available then
        raise exception using
          message = 'WhatsApp outbox fast-lane indexes were not prepared before migration',
          hint = 'Run supabase/cutovers/20260909_prepare_whatsapp_outbox_fast_lane_indexes.sql with an autocommit-capable client.';
    end;

    if exists (select 1 from public.whatsapp_outbox limit 1)
       or pg_relation_size('public.whatsapp_outbox'::regclass) > 64 * 1024 * 1024 then
      raise exception using
        message = 'WhatsApp outbox fast-lane indexes are missing on a non-pristine outbox',
        hint = 'Run supabase/cutovers/20260909_prepare_whatsapp_outbox_fast_lane_indexes.sql with an autocommit-capable client before this migration.';
    end if;

    if due_head_missing then
      execute $index$
        create index whatsapp_outbox_conversation_due_head_idx
          on public.whatsapp_outbox (
            conversation_id,
            created_at,
            id
          )
          include (next_attempt_at)
          where status in ('pending', 'retry')
            and attempts < max_attempts
      $index$;
    end if;

    if processing_missing then
      execute $index$
        create index whatsapp_outbox_conversation_processing_idx
          on public.whatsapp_outbox (conversation_id)
          where status = 'processing'
      $index$;
    end if;
  end if;
end;
$prepare_empty_whatsapp_outbox_fast_lane_indexes$;

do $verify_whatsapp_outbox_fast_lane_indexes$
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
    join pg_catalog.pg_am access_method
      on access_method.oid = index_relation.relam
    where index_definition.schemaname = 'public'
      and index_definition.tablename = 'whatsapp_outbox'
      and index_definition.indexname = 'whatsapp_outbox_conversation_due_head_idx'
      and index_state.indrelid = 'public.whatsapp_outbox'::regclass
      and index_state.indisready
      and index_state.indisvalid
      and not index_state.indisunique
      and access_method.amname = 'btree'
      and regexp_replace(lower(index_definition.indexdef), '\s+', ' ', 'g')
        like '%(conversation_id, created_at, id) include (next_attempt_at)%'
      and regexp_replace(lower(index_definition.indexdef), '\s+', ' ', 'g')
        like '%status%pending%retry%'
      and regexp_replace(lower(index_definition.indexdef), '\s+', ' ', 'g')
        like '%attempts < max_attempts%'
  ) then
    raise exception using
      message = 'public.whatsapp_outbox_conversation_due_head_idx is missing, invalid, or unexpected',
      hint = 'Run supabase/cutovers/20260909_prepare_whatsapp_outbox_fast_lane_indexes.sql before this migration.';
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
    join pg_catalog.pg_am access_method
      on access_method.oid = index_relation.relam
    where index_definition.schemaname = 'public'
      and index_definition.tablename = 'whatsapp_outbox'
      and index_definition.indexname = 'whatsapp_outbox_conversation_processing_idx'
      and index_state.indrelid = 'public.whatsapp_outbox'::regclass
      and index_state.indisready
      and index_state.indisvalid
      and not index_state.indisunique
      and access_method.amname = 'btree'
      and regexp_replace(lower(index_definition.indexdef), '\s+', ' ', 'g')
        like '%(conversation_id)%'
      and regexp_replace(lower(index_definition.indexdef), '\s+', ' ', 'g')
        like '%status = ''processing''%'
  ) then
    raise exception using
      message = 'public.whatsapp_outbox_conversation_processing_idx is missing, invalid, or unexpected',
      hint = 'Run supabase/cutovers/20260909_prepare_whatsapp_outbox_fast_lane_indexes.sql before this migration.';
  end if;
end;
$verify_whatsapp_outbox_fast_lane_indexes$;

comment on index public.whatsapp_outbox_conversation_due_head_idx is
  'Supports FIFO head selection per conversation for independent outbound text and media lanes.';

comment on index public.whatsapp_outbox_conversation_processing_idx is
  'Supports one active outbound delivery per WhatsApp conversation across API replicas.';

commit;
