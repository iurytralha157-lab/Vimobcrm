begin;

create extension if not exists pgtap with schema extensions;
select plan(17);

create temporary table whatsapp_outbox_lane_index_contract
  (like public.whatsapp_outbox);

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

select ok(
  to_regclass('public.whatsapp_outbox_conversation_due_head_v2_idx') is not null,
  'outbound fast lanes have the finalization-aware conversation due-head index'
);

select ok(
  (
    select index_state.indisready and index_state.indisvalid
    from pg_catalog.pg_index index_state
    where index_state.indexrelid =
      'public.whatsapp_outbox_conversation_due_head_v2_idx'::regclass
  ),
  'conversation due-head index is ready and valid'
);

select ok(
  (
    select index_state.indrelid = 'public.whatsapp_outbox'::regclass
      and not index_state.indisunique
      and access_method.amname = 'btree'
    from pg_catalog.pg_index index_state
    join pg_catalog.pg_class index_relation
      on index_relation.oid = index_state.indexrelid
    join pg_catalog.pg_am access_method
      on access_method.oid = index_relation.relam
    where index_state.indexrelid =
      'public.whatsapp_outbox_conversation_due_head_v2_idx'::regclass
  ),
  'conversation due-head index is a non-unique btree on the durable outbox'
);

select ok(
  (
    select regexp_replace(lower(index_definition.indexdef), '\s+', ' ', 'g')
      like '%(conversation_id, created_at, id) include (next_attempt_at)%'
      and regexp_replace(lower(index_definition.indexdef), '\s+', ' ', 'g')
        like '%status%pending%retry%'
      and regexp_replace(lower(index_definition.indexdef), '\s+', ' ', 'g')
        like '%attempts < max_attempts%'
      and regexp_replace(lower(index_definition.indexdef), '\s+', ' ', 'g')
        like '%last_error = ''provider_accepted_finalization_pending''%'
    from pg_catalog.pg_indexes index_definition
    where index_definition.schemaname = 'public'
      and index_definition.indexname = 'whatsapp_outbox_conversation_due_head_v2_idx'
  ),
  'conversation due-head index covers FIFO sends and accepted-provider local finalization'
);

select ok(
  to_regclass('public.whatsapp_outbox_conversation_due_head_idx') is null,
  'the obsolete due-head index is retired after the finalization-aware cutover'
);

select ok(
  to_regclass('public.whatsapp_outbox_fast_due_head_idx') is not null,
  'outbound text has a dedicated literal fast-lane head index'
);

select ok(
  to_regclass('public.whatsapp_outbox_media_due_head_idx') is not null,
  'outbound media has a dedicated literal media-lane head index'
);

select ok(
  (
    select index_state.indisready and index_state.indisvalid
    from pg_catalog.pg_index index_state
    where index_state.indexrelid =
      'public.whatsapp_outbox_fast_due_head_idx'::regclass
  ),
  'fast-lane head index is ready and valid'
);

select ok(
  (
    select index_state.indisready and index_state.indisvalid
    from pg_catalog.pg_index index_state
    where index_state.indexrelid =
      'public.whatsapp_outbox_media_due_head_idx'::regclass
  ),
  'media-lane head index is ready and valid'
);

select ok(
  (
    select index_state.indrelid = 'public.whatsapp_outbox'::regclass
      and not index_state.indisunique
      and access_method.amname = 'btree'
    from pg_catalog.pg_index index_state
    join pg_catalog.pg_class index_relation
      on index_relation.oid = index_state.indexrelid
    join pg_catalog.pg_am access_method
      on access_method.oid = index_relation.relam
    where index_state.indexrelid =
      'public.whatsapp_outbox_fast_due_head_idx'::regclass
  ),
  'fast-lane head index is a non-unique btree on the durable outbox'
);

select ok(
  (
    select index_state.indrelid = 'public.whatsapp_outbox'::regclass
      and not index_state.indisunique
      and access_method.amname = 'btree'
    from pg_catalog.pg_index index_state
    join pg_catalog.pg_class index_relation
      on index_relation.oid = index_state.indexrelid
    join pg_catalog.pg_am access_method
      on access_method.oid = index_relation.relam
    where index_state.indexrelid =
      'public.whatsapp_outbox_media_due_head_idx'::regclass
  ),
  'media-lane head index is a non-unique btree on the durable outbox'
);

select is(
  (
    select substring(
      lower(pg_get_indexdef(index_state.indexrelid))
      from position(' using ' in lower(pg_get_indexdef(index_state.indexrelid))) + 1
    )
    from pg_catalog.pg_index index_state
    where index_state.indexrelid =
      'public.whatsapp_outbox_fast_due_head_idx'::regclass
  ),
  (
    select substring(
      lower(pg_get_indexdef(index_state.indexrelid))
      from position(' using ' in lower(pg_get_indexdef(index_state.indexrelid))) + 1
    )
    from pg_catalog.pg_index index_state
    join pg_catalog.pg_class index_relation
      on index_relation.oid = index_state.indexrelid
    join pg_catalog.pg_namespace index_namespace
      on index_namespace.oid = index_relation.relnamespace
    where index_namespace.oid = pg_my_temp_schema()
      and index_relation.relname = 'whatsapp_outbox_lane_contract_fast_idx'
  ),
  'fast-lane index exactly matches the literal Go head predicate'
);

select is(
  (
    select substring(
      lower(pg_get_indexdef(index_state.indexrelid))
      from position(' using ' in lower(pg_get_indexdef(index_state.indexrelid))) + 1
    )
    from pg_catalog.pg_index index_state
    where index_state.indexrelid =
      'public.whatsapp_outbox_media_due_head_idx'::regclass
  ),
  (
    select substring(
      lower(pg_get_indexdef(index_state.indexrelid))
      from position(' using ' in lower(pg_get_indexdef(index_state.indexrelid))) + 1
    )
    from pg_catalog.pg_index index_state
    join pg_catalog.pg_class index_relation
      on index_relation.oid = index_state.indexrelid
    join pg_catalog.pg_namespace index_namespace
      on index_namespace.oid = index_relation.relnamespace
    where index_namespace.oid = pg_my_temp_schema()
      and index_relation.relname = 'whatsapp_outbox_lane_contract_media_idx'
  ),
  'media-lane index exactly matches the literal Go head predicate'
);

select ok(
  to_regclass('public.whatsapp_outbox_conversation_processing_idx') is not null,
  'outbound fast lanes have a conversation processing-lease index'
);

select ok(
  (
    select index_state.indisready and index_state.indisvalid
    from pg_catalog.pg_index index_state
    where index_state.indexrelid =
      'public.whatsapp_outbox_conversation_processing_idx'::regclass
  ),
  'conversation processing-lease index is ready and valid'
);

select ok(
  (
    select index_state.indrelid = 'public.whatsapp_outbox'::regclass
      and not index_state.indisunique
      and access_method.amname = 'btree'
    from pg_catalog.pg_index index_state
    join pg_catalog.pg_class index_relation
      on index_relation.oid = index_state.indexrelid
    join pg_catalog.pg_am access_method
      on access_method.oid = index_relation.relam
    where index_state.indexrelid =
      'public.whatsapp_outbox_conversation_processing_idx'::regclass
  ),
  'conversation processing-lease index is a non-unique btree on the durable outbox'
);

select ok(
  (
    select regexp_replace(lower(index_definition.indexdef), '\s+', ' ', 'g')
      like '%(conversation_id)%'
      and regexp_replace(lower(index_definition.indexdef), '\s+', ' ', 'g')
        like '%status = ''processing''%'
    from pg_catalog.pg_indexes index_definition
    where index_definition.schemaname = 'public'
      and index_definition.indexname = 'whatsapp_outbox_conversation_processing_idx'
  ),
  'conversation processing-lease index matches the active lease anti-join'
);

select * from finish();
rollback;
