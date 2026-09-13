begin;

create extension if not exists pgtap with schema extensions;
select plan(12);

select col_is(
  'public',
  'whatsapp_webhook_inbox',
  'processing_lane',
  'text',
  'durable webhook inbox classifies live and backlog work'
);

select col_default_is(
  'public',
  'whatsapp_webhook_inbox',
  'processing_lane',
  '''backlog''::text',
  'pre-cutover webhook rows remain in the backlog lane by default'
);

select col_is(
  'public',
  'whatsapp_webhook_inbox',
  'provider_occurred_at',
  'timestamp with time zone',
  'provider occurrence time is retained for lane auditing'
);

select has_check(
  'public',
  'whatsapp_webhook_inbox',
  'whatsapp_webhook_inbox_processing_lane_check',
  'processing lane is constrained to the supported values'
);

select ok(
  to_regclass('public.whatsapp_webhook_inbox_lane_session_due_head_idx') is not null,
  'fair webhook claim has a lane/session due-head index'
);

select ok(
  (
    select index_state.indisready and index_state.indisvalid
    from pg_catalog.pg_index index_state
    where index_state.indexrelid =
      'public.whatsapp_webhook_inbox_lane_session_due_head_idx'::regclass
  ),
  'session due-head index is ready and valid'
);

select ok(
  (
    select index_state.indrelid = 'public.whatsapp_webhook_inbox'::regclass
      and not index_state.indisunique
      and access_method.amname = 'btree'
    from pg_catalog.pg_index index_state
    join pg_catalog.pg_class index_relation
      on index_relation.oid = index_state.indexrelid
    join pg_catalog.pg_am access_method
      on access_method.oid = index_relation.relam
    where index_state.indexrelid =
      'public.whatsapp_webhook_inbox_lane_session_due_head_idx'::regclass
  ),
  'session due-head index is a non-unique btree on the durable inbox'
);

select ok(
  (
    select regexp_replace(lower(index_definition.indexdef), '\s+', ' ', 'g')
      like '%(session_id, processing_lane, created_at, id)%'
      and regexp_replace(lower(index_definition.indexdef), '\s+', ' ', 'g')
        like '%include (next_attempt_at)%'
      and regexp_replace(lower(index_definition.indexdef), '\s+', ' ', 'g')
        like '%status%pending%retry%'
      and regexp_replace(lower(index_definition.indexdef), '\s+', ' ', 'g')
        like '%attempts < max_attempts%'
    from pg_catalog.pg_indexes index_definition
    where index_definition.schemaname = 'public'
      and index_definition.indexname = 'whatsapp_webhook_inbox_lane_session_due_head_idx'
  ),
  'session due-head index matches FIFO lookup and retry predicate'
);

select ok(
  to_regclass('public.whatsapp_webhook_inbox_session_processing_idx') is not null,
  'fair webhook claim has a session processing-lease index'
);

select ok(
  (
    select index_state.indisready and index_state.indisvalid
    from pg_catalog.pg_index index_state
    where index_state.indexrelid =
      'public.whatsapp_webhook_inbox_session_processing_idx'::regclass
  ),
  'session processing-lease index is ready and valid'
);

select ok(
  (
    select index_state.indrelid = 'public.whatsapp_webhook_inbox'::regclass
      and not index_state.indisunique
      and access_method.amname = 'btree'
    from pg_catalog.pg_index index_state
    join pg_catalog.pg_class index_relation
      on index_relation.oid = index_state.indexrelid
    join pg_catalog.pg_am access_method
      on access_method.oid = index_relation.relam
    where index_state.indexrelid =
      'public.whatsapp_webhook_inbox_session_processing_idx'::regclass
  ),
  'session processing-lease index is a non-unique btree on the durable inbox'
);

select ok(
  (
    select regexp_replace(lower(index_definition.indexdef), '\s+', ' ', 'g')
      like '%(session_id)%'
      and regexp_replace(lower(index_definition.indexdef), '\s+', ' ', 'g')
        like '%status = ''processing''%'
    from pg_catalog.pg_indexes index_definition
    where index_definition.schemaname = 'public'
      and index_definition.indexname = 'whatsapp_webhook_inbox_session_processing_idx'
  ),
  'session processing-lease index matches the active lease anti-join'
);

select * from finish();
rollback;
