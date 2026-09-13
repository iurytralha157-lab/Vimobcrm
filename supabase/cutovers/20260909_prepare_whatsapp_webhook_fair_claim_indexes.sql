-- Protected production pre-step for
-- 20260909152547_optimize_whatsapp_webhook_fair_claim.sql.
--
-- Required rollout order: run this DB cutover, record the migration, and only
-- then deploy the API image that writes/claims processing_lane.
--
-- Run with an autocommit-capable SQL client. Do not wrap this file in a
-- transaction: CREATE INDEX CONCURRENTLY is intentionally used because the
-- durable webhook inbox is large. Review DB I/O and replication lag while each
-- index is built. Existing rows are assigned to the backlog lane by a
-- metadata-only constant default; no webhook row is deleted or replayed here.

set lock_timeout = '5s';
set statement_timeout = '0';

alter table public.whatsapp_webhook_inbox
  add column if not exists processing_lane text not null default 'backlog';

alter table public.whatsapp_webhook_inbox
  add column if not exists provider_occurred_at timestamptz;

do $add_whatsapp_webhook_processing_lane_check$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.whatsapp_webhook_inbox'::regclass
      and conname = 'whatsapp_webhook_inbox_processing_lane_check'
  ) then
    alter table public.whatsapp_webhook_inbox
      add constraint whatsapp_webhook_inbox_processing_lane_check
      check (processing_lane in ('live', 'backlog')) not valid;
    -- NOT VALID avoids scanning historical rows now, but PostgreSQL still
    -- enforces this constraint for every new or updated row.
  end if;
end;
$add_whatsapp_webhook_processing_lane_check$;

do $preflight_whatsapp_webhook_online_indexes$
declare
  index_name text;
begin
  if to_regclass('public.whatsapp_webhook_inbox') is null then
    raise exception 'public.whatsapp_webhook_inbox does not exist';
  end if;

  foreach index_name in array array[
    'whatsapp_webhook_inbox_lane_session_due_head_idx',
    'whatsapp_webhook_inbox_session_processing_idx'
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
$preflight_whatsapp_webhook_online_indexes$;

create index concurrently if not exists whatsapp_webhook_inbox_lane_session_due_head_idx
  on public.whatsapp_webhook_inbox (
    session_id,
    processing_lane,
    created_at,
    id
  )
  include (next_attempt_at)
  where status in ('pending', 'retry')
    and attempts < max_attempts;

create index concurrently if not exists whatsapp_webhook_inbox_session_processing_idx
  on public.whatsapp_webhook_inbox (session_id)
  where status = 'processing';

do $verify_whatsapp_webhook_online_indexes$
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
      and index_definition.tablename = 'whatsapp_webhook_inbox'
      and index_definition.indexname = 'whatsapp_webhook_inbox_lane_session_due_head_idx'
      and index_state.indrelid = 'public.whatsapp_webhook_inbox'::regclass
      and index_state.indisready
      and index_state.indisvalid
      and not index_state.indisunique
      and access_method.amname = 'btree'
      and regexp_replace(lower(index_definition.indexdef), '\s+', ' ', 'g')
        like '%(session_id, processing_lane, created_at, id)%'
      and regexp_replace(lower(index_definition.indexdef), '\s+', ' ', 'g')
        like '%include (next_attempt_at)%'
      and regexp_replace(lower(index_definition.indexdef), '\s+', ' ', 'g')
        like '%status%pending%retry%'
      and regexp_replace(lower(index_definition.indexdef), '\s+', ' ', 'g')
        like '%attempts < max_attempts%'
  ) then
    raise exception 'public.whatsapp_webhook_inbox_lane_session_due_head_idx is not ready, valid, and exact';
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
      and index_definition.tablename = 'whatsapp_webhook_inbox'
      and index_definition.indexname = 'whatsapp_webhook_inbox_session_processing_idx'
      and index_state.indrelid = 'public.whatsapp_webhook_inbox'::regclass
      and index_state.indisready
      and index_state.indisvalid
      and not index_state.indisunique
      and access_method.amname = 'btree'
      and regexp_replace(lower(index_definition.indexdef), '\s+', ' ', 'g')
        like '%(session_id)%'
      and regexp_replace(lower(index_definition.indexdef), '\s+', ' ', 'g')
        like '%status = ''processing''%'
  ) then
    raise exception 'public.whatsapp_webhook_inbox_session_processing_idx is not ready, valid, and exact';
  end if;
end;
$verify_whatsapp_webhook_online_indexes$;

reset statement_timeout;
reset lock_timeout;
