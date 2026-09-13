-- Records the production-safe indexes required by the Go webhook worker's
-- session-driven fair claim. The indexes must be prepared online first with
-- supabase/cutovers/20260909_prepare_whatsapp_webhook_fair_claim_indexes.sql.
-- Required rollout order: DB cutover -> this migration -> API image.
-- The only fallback build is for a locked, provably empty inbox so disposable
-- database resets remain self-contained; live databases must use the cutover.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '5s';

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
    -- NOT VALID skips historical validation only; new and updated rows are
    -- still checked immediately by PostgreSQL.
  end if;
end;
$add_whatsapp_webhook_processing_lane_check$;

-- A pristine database reset has no durable inbox rows and does not execute
-- manual cutovers. Keep that path self-contained without ever permitting a
-- blocking index build over live data: NOWAIT excludes concurrent writers and
-- the emptiness check runs while the SHARE lock is held.
do $prepare_empty_whatsapp_webhook_fair_claim_indexes$
declare
  due_head_missing boolean;
  processing_missing boolean;
begin
  if to_regclass('public.whatsapp_webhook_inbox') is null
     or to_regclass('public.whatsapp_sessions') is null then
    raise exception 'WhatsApp durable inbox foundation is not installed';
  end if;

  due_head_missing :=
    to_regclass('public.whatsapp_webhook_inbox_lane_session_due_head_idx') is null;
  processing_missing :=
    to_regclass('public.whatsapp_webhook_inbox_session_processing_idx') is null;

  if due_head_missing or processing_missing then
    begin
      lock table public.whatsapp_webhook_inbox in share mode nowait;
    exception
      when lock_not_available then
        raise exception using
          message = 'WhatsApp webhook fair-claim indexes were not prepared before migration',
          hint = 'Run supabase/cutovers/20260909_prepare_whatsapp_webhook_fair_claim_indexes.sql with an autocommit-capable client.';
    end;

    if exists (select 1 from public.whatsapp_webhook_inbox limit 1)
       or pg_relation_size('public.whatsapp_webhook_inbox'::regclass) > 64 * 1024 * 1024 then
      raise exception using
        message = 'WhatsApp webhook fair-claim indexes are missing on a non-pristine inbox',
        hint = 'Run supabase/cutovers/20260909_prepare_whatsapp_webhook_fair_claim_indexes.sql with an autocommit-capable client before this migration.';
    end if;

    if due_head_missing then
      execute $index$
        create index whatsapp_webhook_inbox_lane_session_due_head_idx
          on public.whatsapp_webhook_inbox (
            session_id,
            processing_lane,
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
        create index whatsapp_webhook_inbox_session_processing_idx
          on public.whatsapp_webhook_inbox (session_id)
          where status = 'processing'
      $index$;
    end if;
  end if;
end;
$prepare_empty_whatsapp_webhook_fair_claim_indexes$;

do $verify_whatsapp_webhook_fair_claim_indexes$
begin
  if to_regclass('public.whatsapp_webhook_inbox') is null
     or to_regclass('public.whatsapp_sessions') is null then
    raise exception 'WhatsApp durable inbox foundation is not installed';
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
    raise exception using
      message = 'public.whatsapp_webhook_inbox_lane_session_due_head_idx is missing, invalid, or unexpected',
      hint = 'Run supabase/cutovers/20260909_prepare_whatsapp_webhook_fair_claim_indexes.sql with an autocommit-capable client before this migration.';
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
    raise exception using
      message = 'public.whatsapp_webhook_inbox_session_processing_idx is missing, invalid, or unexpected',
      hint = 'Run supabase/cutovers/20260909_prepare_whatsapp_webhook_fair_claim_indexes.sql with an autocommit-capable client before this migration.';
  end if;
end;
$verify_whatsapp_webhook_fair_claim_indexes$;

comment on index public.whatsapp_webhook_inbox_lane_session_due_head_idx is
  'Supports the FIFO webhook head per live/backlog lane and WhatsApp session for fair worker claims.';

comment on index public.whatsapp_webhook_inbox_session_processing_idx is
  'Supports checking active webhook leases by WhatsApp session.';

commit;
