-- Durable, tenant-safe import boundary for historical lead archives.
--
-- The import path intentionally does not disable triggers and does not use
-- session_replication_role.  A private, transaction-bound capability makes
-- selected effect-producing triggers no-ops only while the controlled RPC is
-- inserting historical rows.  Tenant/FK/member/identity validation remains
-- enabled throughout the transaction.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '10min';

do $historical_import_prerequisites$
declare
  v_relation text;
begin
  if pg_catalog.to_regprocedure('extensions.digest(text,text)') is null
     or pg_catalog.to_regprocedure('extensions.digest(bytea,text)') is null
     or pg_catalog.to_regprocedure('extensions.gen_random_bytes(integer)') is null
     or pg_catalog.to_regprocedure('extensions.uuid_generate_v5(uuid,text)') is null
     or pg_catalog.to_regprocedure('extensions.uuid_ns_url()') is null then
    raise exception using
      errcode = '55000',
      message = 'historical_import_required_extensions_missing';
  end if;

  if pg_catalog.to_regclass('public.leads') is null
     or pg_catalog.to_regclass('public.lead_entry_events') is null
     or pg_catalog.to_regclass('public.lead_timeline_events') is null
     or pg_catalog.to_regclass('public.activities') is null then
    raise exception using
      errcode = '55000',
      message = 'historical_import_required_tables_missing';
  end if;

  foreach v_relation in array array[
    'public.notifications',
    'private.notification_deliveries',
    'public.automation_event_outbox',
    'public.automation_executions',
    'public.automation_effect_dispatches',
    'public.automation_execution_steps',
    'public.gamification_outbox',
    'private.webhook_delivery_outbox',
    'public.lead_funnel_events',
    'public.meta_crm_event_outbox',
    'public.operational_requests',
    'public.operational_timelines',
    'public.lead_tasks',
    'public.schedule_events',
    'public.cadence_enrollments',
    'public.lead_action_facts',
    'public.lead_assignment_cycles',
    'public.lead_stage_cycles',
    'public.lead_attention_instances',
    'public.lead_timeline_events',
    'public.assignments_log',
    'public.lead_assignment_history',
    'public.lead_stage_history',
    'public.commissions',
    'public.financial_entries',
    'public.round_robin_logs',
    'public.lead_redistribution_jobs',
    'private.lead_distribution_events',
    'private.team_distribution_events',
    'public.whatsapp_messages',
    'public.whatsapp_outbox',
    'public.outbox_messages',
    'public.audit_logs'
  ] loop
    if pg_catalog.to_regclass(v_relation) is null then
      raise exception using
        errcode = '55000',
        message = 'historical_import_effect_proof_relation_missing',
      detail = v_relation;
    end if;
  end loop;

  if (
    select pg_catalog.count(*)
    from pg_catalog.pg_attribute as attribute
    where attribute.attrelid = 'public.outbox_messages'::regclass
      and attribute.attname in ('organization_id', 'lead_id')
      and attribute.attnum > 0
      and not attribute.attisdropped
  ) <> 2 or (
    select pg_catalog.count(*)
    from pg_catalog.pg_attribute as attribute
    where attribute.attrelid = 'public.audit_logs'::regclass
      and attribute.attname in ('organization_id', 'entity_type', 'entity_id')
      and attribute.attnum > 0
      and not attribute.attisdropped
  ) <> 3 then
    raise exception using
      errcode = '55000',
      message = 'historical_import_effect_proof_column_missing';
  end if;
end;
$historical_import_prerequisites$;

alter table public.leads
  add column if not exists external_source text,
  add column if not exists external_source_id text,
  add column if not exists operational_effects_suppressed boolean
    not null default false,
  add column if not exists historical_imported_at timestamptz;

comment on column public.leads.external_source is
  'Immutable normalized provider for externally imported lead identity.';
comment on column public.leads.external_source_id is
  'Immutable provider lead id, unique with organization_id and external_source.';
comment on column public.leads.operational_effects_suppressed is
  'Immutable durable exclusion from periodic operational producers for historical imports.';
comment on column public.leads.historical_imported_at is
  'Immutable timestamp that identifies a lead created by the controlled historical import boundary.';
comment on column public.leads.intake_scope_key is
  'Immutable intake identity. Supports unscoped, queue:<uuid>, and external:<source>:<source_id>.';

alter table public.leads
  add constraint leads_external_identity_shape_check_v2
  check (
    (
      external_source is null
      and external_source_id is null
    )
    or (
      external_source is not null
      and external_source_id is not null
      and external_source = pg_catalog.lower(pg_catalog.btrim(external_source))
      and external_source ~ '^[a-z0-9][a-z0-9._-]{0,63}$'
      and pg_catalog.length(external_source_id) between 1 and 256
      and external_source_id = pg_catalog.btrim(external_source_id)
      and external_source_id !~ '[[:cntrl:]]'
      and origin_round_robin_id is null
    )
  ) not valid;

alter table public.leads
  add constraint leads_historical_effect_suppression_shape_check
  check (
    (
      operational_effects_suppressed = false
      and historical_imported_at is null
    )
    or (
      operational_effects_suppressed = true
      and historical_imported_at is not null
      and external_source is not null
      and external_source_id is not null
    )
  ) not valid;

alter table public.leads
  add constraint leads_intake_scope_key_check_v2
  check (
    intake_scope_key = 'unscoped'
    or intake_scope_key ~ '^queue:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or (
      pg_catalog.length(intake_scope_key) between 12 and 400
      and intake_scope_key ~ '^external:[a-z0-9][a-z0-9._-]{0,63}:.+$'
      and intake_scope_key !~ '[[:cntrl:]]'
    )
  ) not valid;

alter table public.leads
  drop constraint if exists leads_intake_scope_key_check;

alter table public.leads
  rename constraint leads_intake_scope_key_check_v2
  to leads_intake_scope_key_check;

alter table public.leads
  validate constraint leads_external_identity_shape_check_v2;
alter table public.leads
  validate constraint leads_intake_scope_key_check;
alter table public.leads
  validate constraint leads_historical_effect_suppression_shape_check;

create unique index if not exists leads_org_external_identity_unique
  on public.leads (organization_id, external_source, external_source_id)
  where external_source is not null
    and external_source_id is not null;

create index if not exists leads_org_external_source_idx
  on public.leads (organization_id, external_source, created_at desc, id desc)
  where external_source is not null;

create or replace function private.lead_intake_scope_for_external(
  p_organization_id uuid,
  p_external_source text,
  p_external_source_id text
)
returns text
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  v_source text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_external_source, '')));
  v_source_id text := pg_catalog.btrim(coalesce(p_external_source_id, ''));
begin
  if p_organization_id is null then
    raise exception using
      errcode = '22023',
      message = 'lead_intake_organization_required';
  end if;

  if v_source !~ '^[a-z0-9][a-z0-9._-]{0,63}$' then
    raise exception using
      errcode = '22023',
      message = 'lead_external_source_invalid';
  end if;

  if pg_catalog.length(v_source_id) not between 1 and 256
     or v_source_id ~ '[[:cntrl:]]' then
    raise exception using
      errcode = '22023',
      message = 'lead_external_source_id_invalid';
  end if;

  return 'external:' || v_source || ':' || v_source_id;
end;
$$;

revoke all on function private.lead_intake_scope_for_external(uuid, text, text)
from public, anon, authenticated, service_role;

create table if not exists private.historical_lead_import_contexts (
  transaction_id text primary key,
  token_sha256 text not null,
  organization_id uuid not null,
  actor_user_id uuid not null,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint historical_lead_import_contexts_token_check
    check (token_sha256 ~ '^[0-9a-f]{64}$')
);

create or replace function private.enforce_lead_intake_identity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expected_scope text;
  v_is_pending_meta_phone_claim boolean := false;
  v_import_token text := pg_catalog.current_setting(
    'vimob.historical_import_token',
    true
  );
begin
  if tg_op = 'UPDATE' then
    if new.organization_id is not distinct from old.organization_id
       and new.origin_round_robin_id is not distinct from old.origin_round_robin_id
       and new.intake_scope_key is not distinct from old.intake_scope_key
       and new.external_source is not distinct from old.external_source
       and new.external_source_id is not distinct from old.external_source_id
       and new.operational_effects_suppressed
         is not distinct from old.operational_effects_suppressed
       and new.historical_imported_at
         is not distinct from old.historical_imported_at then
      -- Do not revalidate immutable provenance after a queue is hard-deleted.
      return new;
    end if;

    v_is_pending_meta_phone_claim :=
      new.organization_id is not distinct from old.organization_id
      and old.origin_round_robin_id is null
      and old.intake_scope_key = 'unscoped'
      and old.external_source is null
      and old.external_source_id is null
      and new.operational_effects_suppressed
        is not distinct from old.operational_effects_suppressed
      and new.historical_imported_at
        is not distinct from old.historical_imported_at
      and new.external_source is null
      and new.external_source_id is null
      and coalesce(public.normalize_phone(old.phone), '') = ''
      and coalesce(public.normalize_phone(new.phone), '') <> ''
      and new.origin_round_robin_id is not null
      and old.meta_lead_id is not null
      and pg_catalog.lower(coalesce(old.metadata->>'meta_details_status', '')) = 'pending';

    if not v_is_pending_meta_phone_claim then
      raise exception using
        errcode = '23514',
        message = 'lead_intake_identity_immutable';
    end if;
  end if;

  new.external_source := nullif(
    pg_catalog.lower(pg_catalog.btrim(coalesce(new.external_source, ''))),
    ''
  );
  new.external_source_id := nullif(
    pg_catalog.btrim(coalesce(new.external_source_id, '')),
    ''
  );

  if (new.external_source is null) <> (new.external_source_id is null) then
    raise exception using
      errcode = '23514',
      message = 'lead_external_identity_incomplete';
  end if;

  if tg_op = 'INSERT'
     and (
       new.external_source is not null
       or coalesce(new.operational_effects_suppressed, false)
       or new.historical_imported_at is not null
     )
     and not exists (
       select 1
       from private.historical_lead_import_contexts as context
       where context.transaction_id = pg_catalog.pg_current_xact_id()::text
         and context.organization_id = new.organization_id
         and context.token_sha256 = pg_catalog.encode(
           extensions.digest(coalesce(v_import_token, ''), 'sha256'),
           'hex'
         )
     ) then
    raise exception using
      errcode = '42501',
      message = 'lead_external_identity_requires_import_capability';
  end if;

  if new.external_source is not null then
    if new.origin_round_robin_id is not null then
      raise exception using
        errcode = '23514',
        message = 'lead_external_identity_queue_conflict';
    end if;

    v_expected_scope := private.lead_intake_scope_for_external(
      new.organization_id,
      new.external_source,
      new.external_source_id
    );
  else
    v_expected_scope := private.lead_intake_scope_for_queue(
      new.organization_id,
      new.origin_round_robin_id
    );
  end if;

  if tg_op = 'INSERT'
     and coalesce(new.intake_scope_key, 'unscoped') = 'unscoped'
     and v_expected_scope <> 'unscoped' then
    new.intake_scope_key := v_expected_scope;
  elsif new.intake_scope_key is distinct from v_expected_scope then
    raise exception using
      errcode = '23514',
      message = 'lead_intake_scope_mismatch';
  end if;

  return new;
end;
$$;

revoke all on function private.enforce_lead_intake_identity()
from public, anon, authenticated, service_role;

drop trigger if exists enforce_lead_intake_identity_before_write
on public.leads;
create trigger enforce_lead_intake_identity_before_write
before insert or update of
  organization_id,
  origin_round_robin_id,
  intake_scope_key,
  external_source,
  external_source_id,
  operational_effects_suppressed,
  historical_imported_at
on public.leads
for each row
execute function private.enforce_lead_intake_identity();

create table if not exists private.historical_lead_import_ledger (
  organization_id uuid not null,
  source_system text not null,
  entity_type text not null,
  source_id text not null,
  external_key text not null,
  target_id uuid not null,
  lead_id uuid,
  payload_sha256 text not null,
  payload jsonb not null,
  provenance jsonb not null default '{}'::jsonb,
  imported_by uuid not null,
  batch_index integer not null,
  imported_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (organization_id, source_system, entity_type, source_id),
  constraint historical_lead_import_ledger_external_key_unique
    unique (organization_id, external_key),
  constraint historical_lead_import_ledger_target_unique
    unique (organization_id, entity_type, target_id),
  constraint historical_lead_import_ledger_entity_check
    check (entity_type in ('lead', 'event', 'chat')),
  constraint historical_lead_import_ledger_source_check
    check (source_system ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
  constraint historical_lead_import_ledger_source_id_check
    check (
      pg_catalog.length(source_id) between 1 and 512
      and source_id !~ '[[:cntrl:]]'
    ),
  constraint historical_lead_import_ledger_external_key_check
    check (
      pg_catalog.length(external_key) between 1 and 700
      and external_key !~ '[[:cntrl:]]'
    ),
  constraint historical_lead_import_ledger_payload_sha_check
    check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  constraint historical_lead_import_ledger_payload_object_check
    check (pg_catalog.jsonb_typeof(payload) = 'object'),
  constraint historical_lead_import_ledger_provenance_object_check
    check (pg_catalog.jsonb_typeof(provenance) = 'object'),
  constraint historical_lead_import_ledger_batch_index_check
    check (batch_index >= 0)
);

create index if not exists historical_lead_import_ledger_lead_idx
  on private.historical_lead_import_ledger (
    organization_id,
    lead_id,
    imported_at,
    target_id
  )
  where lead_id is not null;

alter table private.historical_lead_import_contexts enable row level security;
alter table private.historical_lead_import_ledger enable row level security;

revoke all on table private.historical_lead_import_contexts
from public, anon, authenticated, service_role;
revoke all on table private.historical_lead_import_ledger
from public, anon, authenticated, service_role;

comment on table private.historical_lead_import_contexts is
  'Ephemeral transaction-bound capabilities for the silent historical import RPC.';
comment on table private.historical_lead_import_ledger is
  'Private per-record idempotency and drift ledger for historical lead imports.';

create or replace function private.canonical_jsonb_text(p_value jsonb)
returns text
language plpgsql
immutable
strict
security invoker
set search_path = ''
as $$
declare
  v_result text;
begin
  case pg_catalog.jsonb_typeof(p_value)
    when 'object' then
      select '{' || coalesce(
        pg_catalog.string_agg(
          pg_catalog.to_jsonb(member.key)::text
          || ':'
          || private.canonical_jsonb_text(member.value),
          ',' order by member.key
        ),
        ''
      ) || '}'
      into v_result
      from pg_catalog.jsonb_each(p_value) as member(key, value);
    when 'array' then
      select '[' || coalesce(
        pg_catalog.string_agg(
          private.canonical_jsonb_text(member.value),
          ',' order by member.ordinality
        ),
        ''
      ) || ']'
      into v_result
      from pg_catalog.jsonb_array_elements(p_value)
        with ordinality as member(value, ordinality);
    else
      v_result := p_value::text;
  end case;

  return v_result;
end;
$$;

create or replace function private.canonical_jsonb_sha256(p_value jsonb)
returns text
language sql
immutable
strict
security invoker
set search_path = ''
as $$
  select pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(private.canonical_jsonb_text(p_value), 'UTF8'),
      'sha256'
    ),
    'hex'
  )
$$;

revoke all on function private.canonical_jsonb_text(jsonb)
from public, anon, authenticated, service_role;
revoke all on function private.canonical_jsonb_sha256(jsonb)
from public, anon, authenticated, service_role;

create or replace function private.historical_import_effects_suppressed()
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_token text := pg_catalog.current_setting(
    'vimob.historical_import_token',
    true
  );
begin
  if coalesce(v_token, '') = '' then
    return false;
  end if;

  return exists (
    select 1
    from private.historical_lead_import_contexts as context
    where context.transaction_id = pg_catalog.pg_current_xact_id()::text
      and context.token_sha256 = pg_catalog.encode(
        extensions.digest(v_token, 'sha256'),
        'hex'
      )
  );
end;
$$;

revoke all on function private.historical_import_effects_suppressed()
from public, anon, authenticated, service_role;
grant execute on function private.historical_import_effects_suppressed()
to authenticated, service_role;

comment on function private.historical_import_effects_suppressed() is
  'True only for an unforgeable private capability in the current transaction; used by effect-producing trigger WHEN clauses.';

create or replace function private.lead_operational_effects_suppressed(
  p_organization_id uuid,
  p_lead_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select lead.operational_effects_suppressed
    from public.leads as lead
    where lead.organization_id = p_organization_id
      and lead.id = p_lead_id
  ), false)
$$;

revoke all on function private.lead_operational_effects_suppressed(uuid, uuid)
from public, anon, authenticated, service_role;
grant execute on function private.lead_operational_effects_suppressed(uuid, uuid)
to authenticated, service_role;

comment on function private.lead_operational_effects_suppressed(uuid, uuid) is
  'Durable trigger guard for leads imported as immutable, non-operational history.';

-- Guard every producer with external or operational effects.  Integrity-only
-- triggers (tenant references, active members, pipeline/stage shape, immutable
-- intake identity, managed WhatsApp validation and avatar validation) remain
-- active while the historical import capability is present.

-- The regular pipeline defaulting trigger is not an effect producer, but it
-- also fills stage_entered_at with now().  Historical payloads deliberately
-- leave that business clock null when the source has no evidence, so skip the
-- trigger only for the capability-bound, durably suppressed import path.  The
-- RPC already requires an explicit tenant-valid pipeline and stage.
drop trigger if exists tr_ensure_lead_pipeline on public.leads;
create trigger tr_ensure_lead_pipeline
before insert on public.leads
for each row
when (
  not private.historical_import_effects_suppressed()
  and new.operational_effects_suppressed = false
)
execute function public.ensure_lead_has_pipeline();

drop trigger if exists hydrate_round_robin_destination_before_lead_insert
on public.leads;
create trigger hydrate_round_robin_destination_before_lead_insert
before insert on public.leads
for each row
when (
  not private.historical_import_effects_suppressed()
  and new.operational_effects_suppressed = false
)
execute function private.hydrate_lead_destination_from_intake_queue();

drop trigger if exists gamification_canonical_leads_insert_enqueue
on public.leads;
create trigger gamification_canonical_leads_insert_enqueue
after insert on public.leads
for each row
when (
  not private.historical_import_effects_suppressed()
  and new.operational_effects_suppressed = false
)
execute function private.enqueue_lead_gamification();

drop trigger if exists gamification_canonical_leads_status_enqueue
on public.leads;
create trigger gamification_canonical_leads_status_enqueue
after update of deal_status on public.leads
for each row
when (
  not private.historical_import_effects_suppressed()
  and new.operational_effects_suppressed = false
)
execute function private.enqueue_lead_gamification();

drop trigger if exists tr_lead_created_entry on public.leads;
create trigger tr_lead_created_entry
after insert on public.leads
for each row
when (
  not private.historical_import_effects_suppressed()
  and new.operational_effects_suppressed = false
)
execute function public.on_lead_created_entry_event();

drop trigger if exists tr_mark_lead_owner_activity_for_redistribution
on public.leads;
create trigger tr_mark_lead_owner_activity_for_redistribution
before update on public.leads
for each row
when (
  not private.historical_import_effects_suppressed()
  and new.operational_effects_suppressed = false
)
execute function public.mark_lead_owner_activity_for_redistribution();

drop trigger if exists tr_set_assigned_at on public.leads;
create trigger tr_set_assigned_at
before update on public.leads
for each row
when (
  not private.historical_import_effects_suppressed()
  and new.operational_effects_suppressed = false
)
execute function public.set_lead_assigned_at();

drop trigger if exists tr_set_assigned_at_insert on public.leads;
create trigger tr_set_assigned_at_insert
before insert on public.leads
for each row
when (
  not private.historical_import_effects_suppressed()
  and new.operational_effects_suppressed = false
)
execute function public.set_lead_assigned_at_on_insert();

drop trigger if exists tr_sync_lead_seller_to_customer on public.leads;
create trigger tr_sync_lead_seller_to_customer
after update of assigned_user_id on public.leads
for each row
when (
  not private.historical_import_effects_suppressed()
  and new.operational_effects_suppressed = false
)
execute function public.sync_lead_seller_to_customer();

drop trigger if exists trg_assign_neximob_lancamentos_webhook_lead
on public.leads;
create trigger trg_assign_neximob_lancamentos_webhook_lead
before insert on public.leads
for each row
when (
  not private.historical_import_effects_suppressed()
  and new.operational_effects_suppressed = false
)
execute function public.assign_neximob_lancamentos_webhook_lead();

drop trigger if exists trg_cancel_automations_on_stage_change
on public.leads;
create trigger trg_cancel_automations_on_stage_change
after update of stage_id on public.leads
for each row
when (
  not private.historical_import_effects_suppressed()
  and new.operational_effects_suppressed = false
)
execute function public.cancel_automations_on_stage_change();

drop trigger if exists trg_capture_lead_cycles on public.leads;
create trigger trg_capture_lead_cycles
after insert or update of assigned_user_id, stage_id, pipeline_id, deal_status
on public.leads
for each row
when (
  not private.historical_import_effects_suppressed()
  and new.operational_effects_suppressed = false
)
execute function private.capture_lead_cycles();

drop trigger if exists trg_capture_lead_funnel_transition
on public.leads;
create trigger trg_capture_lead_funnel_transition
after insert or update of stage_id, pipeline_id, deal_status
on public.leads
for each row
when (
  not private.historical_import_effects_suppressed()
  and new.operational_effects_suppressed = false
)
execute function private.capture_lead_funnel_transition();

drop trigger if exists trg_guard_lead_clocks on public.leads;
create trigger trg_guard_lead_clocks
before insert or update of
  stage_id,
  pipeline_id,
  stage_entered_at,
  board_order_at,
  assigned_user_id,
  assigned_at,
  source,
  attention_eligible,
  attention_enrolled_at
on public.leads
for each row
when (
  not private.historical_import_effects_suppressed()
  and new.operational_effects_suppressed = false
)
execute function private.guard_lead_clocks();

drop trigger if exists trg_sync_lead_cadence_assignee on public.leads;
create trigger trg_sync_lead_cadence_assignee
after update of assigned_user_id on public.leads
for each row
when (
  not private.historical_import_effects_suppressed()
  and new.operational_effects_suppressed = false
)
execute function private.sync_lead_cadence_assignee();

drop trigger if exists trigger_create_commission_on_won on public.leads;
create trigger trigger_create_commission_on_won
after update on public.leads
for each row
when (
  not private.historical_import_effects_suppressed()
  and new.operational_effects_suppressed = false
  and new.deal_status = 'won'
  and old.deal_status is distinct from 'won'
)
execute function public.create_commission_on_won();

drop trigger if exists trigger_execute_stage_automations on public.leads;
create trigger trigger_execute_stage_automations
before insert or update on public.leads
for each row
when (
  not private.historical_import_effects_suppressed()
  and new.operational_effects_suppressed = false
)
execute function public.execute_stage_automations();

drop trigger if exists trigger_lead_intake on public.leads;
create trigger trigger_lead_intake
after insert on public.leads
for each row
when (
  not private.historical_import_effects_suppressed()
  and new.operational_effects_suppressed = false
)
execute function public.trigger_handle_lead_intake();

drop trigger if exists trigger_lead_stage_operational_engine
on public.leads;
create trigger trigger_lead_stage_operational_engine
after update of stage_id on public.leads
for each row
when (
  not private.historical_import_effects_suppressed()
  and new.operational_effects_suppressed = false
)
execute function public.execute_stage_operational_actions();

drop trigger if exists trigger_log_lead_activity on public.leads;
create trigger trigger_log_lead_activity
after insert or update on public.leads
for each row
when (
  not private.historical_import_effects_suppressed()
  and new.operational_effects_suppressed = false
)
execute function public.log_lead_activity();

drop trigger if exists zz_automation_lead_events on public.leads;
create trigger zz_automation_lead_events
after insert or update of stage_id on public.leads
for each row
when (
  not private.historical_import_effects_suppressed()
  and new.operational_effects_suppressed = false
)
execute function private.capture_automation_lead_events();

drop trigger if exists zz_trigger_deal_status_timestamp_guard
on public.leads;
create trigger zz_trigger_deal_status_timestamp_guard
before insert or update on public.leads
for each row
when (
  not private.historical_import_effects_suppressed()
  and new.operational_effects_suppressed = false
)
execute function public.handle_deal_status_change();

drop trigger if exists trg_capture_meta_entry_funnel
on public.lead_entry_events;
create trigger trg_capture_meta_entry_funnel
after insert or update of
  provider,
  provider_event_id,
  is_countable,
  occurred_at,
  pipeline_id,
  stage_id,
  metadata
on public.lead_entry_events
for each row
when (
  not private.historical_import_effects_suppressed()
  and not private.lead_operational_effects_suppressed(
    new.organization_id,
    new.lead_id
  )
)
execute function private.capture_meta_entry_funnel();

drop trigger if exists zz_enqueue_outgoing_lead_webhooks
on public.lead_entry_events;
create trigger zz_enqueue_outgoing_lead_webhooks
after insert or update of
  entry_type,
  provider,
  provider_event_id,
  occurred_at,
  is_countable,
  source_detail
on public.lead_entry_events
for each row
when (
  not private.historical_import_effects_suppressed()
  and not private.lead_operational_effects_suppressed(
    new.organization_id,
    new.lead_id
  )
)
execute function private.enqueue_outgoing_lead_webhooks();

drop trigger if exists gamification_canonical_activities_enqueue
on public.activities;
create trigger gamification_canonical_activities_enqueue
after insert on public.activities
for each row
when (
  not private.historical_import_effects_suppressed()
  and not private.lead_operational_effects_suppressed(
    new.organization_id,
    new.lead_id
  )
)
execute function private.enqueue_activity_gamification();

drop trigger if exists trg_capture_activity_attention_fact
on public.activities;
create trigger trg_capture_activity_attention_fact
after insert on public.activities
for each row
when (
  not private.historical_import_effects_suppressed()
  and not private.lead_operational_effects_suppressed(
    new.organization_id,
    new.lead_id
  )
)
execute function private.capture_activity_attention_fact();

drop trigger if exists zz_automation_tag_added on public.lead_tags;
create trigger zz_automation_tag_added
after insert on public.lead_tags
for each row
when (
  not private.historical_import_effects_suppressed()
  and not private.lead_operational_effects_suppressed(
    new.organization_id,
    new.lead_id
  )
)
execute function private.capture_automation_tag_event();

-- Transaction-local trigger suppression is not enough for periodic scanners.
-- These two producers discover old open leads after the import transaction has
-- committed, so the durable marker is part of their candidate predicate.
create or replace function public.enqueue_due_automation_inactivity(
  p_batch_size integer default 100
)
returns setof public.automation_event_outbox
language sql
security definer
set search_path = ''
as $$
  with candidates as (
    select
      a.organization_id,
      fv.id as flow_version_id,
      l.id as lead_id,
      l.assigned_user_id,
      greatest(coalesce(l.last_contact_at, '-infinity'::timestamptz), l.updated_at, l.created_at) as last_activity_at
    from public.automations a
    join public.automation_flow_versions fv on fv.id = a.active_flow_version_id
    join public.organization_modules om
      on om.organization_id = a.organization_id
     and lower(trim(om.module_name)) = 'automations'
     and coalesce(om.is_enabled, false) = true
    join public.leads l on l.organization_id = a.organization_id
    where a.is_active = true
      and a.deleted_at is null
      and fv.trigger_type = 'inactivity'
      and fv.requires_review = false
      and l.operational_effects_suppressed = false
      and coalesce(fv.trigger_config->>'inactivity_value', '') ~ '^[0-9]+$'
      and fv.trigger_config->>'inactivity_unit' in ('hours', 'days')
      and (
        (fv.trigger_config->>'inactivity_unit' = 'hours' and (fv.trigger_config->>'inactivity_value')::integer between 1 and 8760)
        or (fv.trigger_config->>'inactivity_unit' = 'days' and (fv.trigger_config->>'inactivity_value')::integer between 1 and 365)
      )
      and greatest(coalesce(l.last_contact_at, '-infinity'::timestamptz), l.updated_at, l.created_at)
        <= now() - case
          when fv.trigger_config->>'inactivity_unit' = 'hours'
            then make_interval(hours => (fv.trigger_config->>'inactivity_value')::integer)
          else make_interval(days => (fv.trigger_config->>'inactivity_value')::integer)
        end
      and (
        nullif(fv.trigger_config->>'filter_user_id', '') is null
        or (fv.trigger_config->>'filter_user_id') = l.assigned_user_id::text
        or (
          fv.trigger_config->>'filter_user_id' = '__me__'
          and fv.created_by = l.assigned_user_id
        )
      )
      and not exists (
        select 1
        from public.automation_event_outbox o
        where o.dedupe_key = 'inactivity:' || fv.id::text || ':' || l.id::text || ':' ||
          greatest(coalesce(l.last_contact_at, '-infinity'::timestamptz), l.updated_at, l.created_at)::text
      )
    order by last_activity_at, fv.id, l.id
    limit least(greatest(coalesce(p_batch_size, 100), 1), 500)
  )
  insert into public.automation_event_outbox (
    organization_id, event_type, aggregate_type, aggregate_id,
    lead_id, dedupe_key, payload
  )
  select
    c.organization_id,
    'inactivity',
    'lead',
    c.lead_id,
    c.lead_id,
    'inactivity:' || c.flow_version_id::text || ':' || c.lead_id::text || ':' || c.last_activity_at::text,
    jsonb_build_object(
      'lead_id', c.lead_id,
      'assigned_user_id', c.assigned_user_id,
      'flow_version_id', c.flow_version_id,
      'last_activity_at', c.last_activity_at,
      'causal_depth', 0
    )
  from candidates c
  on conflict (dedupe_key) do nothing
  returning *;
$$;

create or replace function public.get_sla_pending_leads()
returns table (
  lead_id uuid,
  organization_id uuid,
  pipeline_id uuid,
  assigned_user_id uuid,
  lead_name text,
  sla_start_at timestamptz,
  current_sla_status text,
  warn_after_seconds integer,
  overdue_after_seconds integer,
  notify_assignee boolean,
  notify_manager boolean,
  sla_notified_warning_at timestamptz,
  sla_notified_overdue_at timestamptz
)
language plpgsql
security definer
set search_path = 'public'
as $$
begin
  return query
  select
    l.id as lead_id,
    l.organization_id,
    l.pipeline_id,
    l.assigned_user_id,
    l.name as lead_name,
    public.get_sla_start_at(l.id) as sla_start_at,
    coalesce(l.sla_status, 'ok') as current_sla_status,
    greatest(coalesce(pss.warning_hours, 24), 1) * 3600 as warn_after_seconds,
    greatest(coalesce(pss.critical_hours, 48), 1) * 3600 as overdue_after_seconds,
    true as notify_assignee,
    true as notify_manager,
    l.sla_notified_warning_at,
    l.sla_notified_overdue_at
  from public.leads l
  join lateral (
    select pss.*
    from public.pipeline_sla_settings pss
    where pss.pipeline_id = l.pipeline_id
      and (pss.stage_id = l.stage_id or pss.stage_id is null)
    order by case when pss.stage_id = l.stage_id then 0 else 1 end
    limit 1
  ) pss on true
  where l.pipeline_id is not null
    and l.operational_effects_suppressed = false
    and l.first_response_at is null
    and coalesce(l.deal_status, 'open') not in ('won', 'lost')
    and (l.sla_last_checked_at is null or l.sla_last_checked_at < now() - interval '1 minute')
    and public.get_sla_start_at(l.id) is not null;
end;
$$;

create or replace function private.historical_import_effect_counts(
  p_organization_id uuid,
  p_lead_ids uuid[],
  p_entity_ids uuid[]
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_lead_ids uuid[] := coalesce(p_lead_ids, '{}'::uuid[]);
  v_lead_id_texts text[];
  v_entity_ids uuid[] := coalesce(p_entity_ids, '{}'::uuid[]);
  v_entity_id_texts text[];
begin
  select coalesce(
    pg_catalog.array_agg(lead_id::text),
    '{}'::text[]
  )
  into v_lead_id_texts
  from pg_catalog.unnest(v_lead_ids) as item(lead_id);

  select coalesce(
    pg_catalog.array_agg(distinct entity_id::text),
    '{}'::text[]
  )
  into v_entity_id_texts
  from pg_catalog.unnest(v_lead_ids || v_entity_ids) as item(entity_id);

  return pg_catalog.jsonb_build_object(
    'notifications', (
      select pg_catalog.count(*)
      from public.notifications as notification
      where notification.organization_id = p_organization_id
        and notification.lead_id = any(v_lead_ids)
    ),
    'notification_deliveries', (
      select pg_catalog.count(*)
      from private.notification_deliveries as delivery
      join public.notifications as notification
        on notification.id = delivery.notification_id
      where delivery.organization_id = p_organization_id
        and notification.organization_id = p_organization_id
        and notification.lead_id = any(v_lead_ids)
    ),
    'automation_event_outbox', (
      select pg_catalog.count(*)
      from public.automation_event_outbox as event_outbox
      where event_outbox.organization_id = p_organization_id
        and event_outbox.lead_id = any(v_lead_ids)
    ),
    'automation_executions', (
      select pg_catalog.count(*)
      from public.automation_executions as execution
      where execution.organization_id = p_organization_id
        and execution.lead_id = any(v_lead_ids)
    ),
    'automation_effect_dispatches', (
      select pg_catalog.count(*)
      from public.automation_effect_dispatches as dispatch
      join public.automation_executions as execution
        on execution.id = dispatch.execution_id
      where dispatch.organization_id = p_organization_id
        and execution.organization_id = p_organization_id
        and execution.lead_id = any(v_lead_ids)
    ),
    'automation_execution_steps', (
      select pg_catalog.count(*)
      from public.automation_execution_steps as step
      join public.automation_executions as execution
        on execution.id = step.execution_id
      where step.organization_id = p_organization_id
        and execution.organization_id = p_organization_id
        and execution.lead_id = any(v_lead_ids)
    ),
    'gamification_outbox', (
      select pg_catalog.count(*)
      from public.gamification_outbox as gamification
      where gamification.organization_id = p_organization_id
        and (
          gamification.reference_id = any(v_lead_id_texts)
          or gamification.metadata->>'lead_id' = any(v_lead_id_texts)
        )
    ),
    'webhook_delivery_outbox', (
      select pg_catalog.count(*)
      from private.webhook_delivery_outbox as webhook
      where webhook.organization_id = p_organization_id
        and webhook.lead_id = any(v_lead_ids)
    ),
    'lead_funnel_events', (
      select pg_catalog.count(*)
      from public.lead_funnel_events as funnel_event
      where funnel_event.organization_id = p_organization_id
        and funnel_event.lead_id = any(v_lead_ids)
    ),
    'meta_crm_event_outbox', (
      select pg_catalog.count(*)
      from public.meta_crm_event_outbox as meta_outbox
      where meta_outbox.organization_id = p_organization_id
        and meta_outbox.lead_id = any(v_lead_ids)
    ),
    'operational_requests', (
      select pg_catalog.count(*)
      from public.operational_requests as request
      where request.organization_id = p_organization_id
        and request.lead_id = any(v_lead_ids)
    ),
    'operational_timelines', (
      select pg_catalog.count(*)
      from public.operational_timelines as timeline
      where timeline.organization_id = p_organization_id
        and timeline.lead_id = any(v_lead_ids)
    ),
    'lead_tasks', (
      select pg_catalog.count(*)
      from public.lead_tasks as task
      where task.organization_id = p_organization_id
        and task.lead_id = any(v_lead_ids)
    ),
    'schedule_events', (
      select pg_catalog.count(*)
      from public.schedule_events as schedule
      where schedule.organization_id = p_organization_id
        and schedule.lead_id = any(v_lead_ids)
    ),
    'cadence_enrollments', (
      select pg_catalog.count(*)
      from public.cadence_enrollments as enrollment
      where enrollment.organization_id = p_organization_id
        and enrollment.lead_id = any(v_lead_ids)
    ),
    'lead_action_facts', (
      select pg_catalog.count(*)
      from public.lead_action_facts as action_fact
      where action_fact.organization_id = p_organization_id
        and action_fact.lead_id = any(v_lead_ids)
    ),
    'lead_assignment_cycles', (
      select pg_catalog.count(*)
      from public.lead_assignment_cycles as assignment_cycle
      where assignment_cycle.organization_id = p_organization_id
        and assignment_cycle.lead_id = any(v_lead_ids)
    ),
    'lead_stage_cycles', (
      select pg_catalog.count(*)
      from public.lead_stage_cycles as stage_cycle
      where stage_cycle.organization_id = p_organization_id
        and stage_cycle.lead_id = any(v_lead_ids)
    ),
    'lead_attention_instances', (
      select pg_catalog.count(*)
      from public.lead_attention_instances as attention
      where attention.organization_id = p_organization_id
        and attention.lead_id = any(v_lead_ids)
    ),
    'lead_timeline_events', (
      select pg_catalog.count(*)
      from public.lead_timeline_events as timeline_event
      where timeline_event.organization_id = p_organization_id
        and timeline_event.lead_id = any(v_lead_ids)
    ),
    'assignments_log', (
      select pg_catalog.count(*)
      from public.assignments_log as assignment
      where assignment.organization_id = p_organization_id
        and assignment.lead_id = any(v_lead_ids)
    ),
    'lead_assignment_history', (
      select pg_catalog.count(*)
      from public.lead_assignment_history as assignment_history
      join public.leads as lead
        on lead.id = assignment_history.lead_id
      where lead.organization_id = p_organization_id
        and assignment_history.lead_id = any(v_lead_ids)
    ),
    'lead_stage_history', (
      select pg_catalog.count(*)
      from public.lead_stage_history as stage_history
      join public.leads as lead
        on lead.id = stage_history.lead_id
      where lead.organization_id = p_organization_id
        and stage_history.lead_id = any(v_lead_ids)
    ),
    'commissions', (
      select pg_catalog.count(*)
      from public.commissions as commission
      where commission.organization_id = p_organization_id
        and commission.lead_id = any(v_lead_ids)
    ),
    'financial_entries', (
      select pg_catalog.count(*)
      from public.financial_entries as financial_entry
      where financial_entry.organization_id = p_organization_id
        and financial_entry.lead_id = any(v_lead_ids)
    ),
    'round_robin_logs', (
      select pg_catalog.count(*)
      from public.round_robin_logs as round_robin_log
      where round_robin_log.organization_id = p_organization_id
        and round_robin_log.lead_id = any(v_lead_ids)
    ),
    'lead_redistribution_jobs', (
      select pg_catalog.count(*)
      from public.lead_redistribution_jobs as redistribution_job
      where redistribution_job.organization_id = p_organization_id
        and redistribution_job.lead_id = any(v_lead_ids)
    ),
    'lead_distribution_events', (
      select pg_catalog.count(*)
      from private.lead_distribution_events as distribution_event
      where distribution_event.organization_id = p_organization_id
        and distribution_event.lead_id = any(v_lead_ids)
    ),
    'team_distribution_events', (
      select pg_catalog.count(*)
      from private.team_distribution_events as distribution_event
      where distribution_event.organization_id = p_organization_id
        and distribution_event.lead_id = any(v_lead_ids)
    ),
    'whatsapp_messages', (
      select pg_catalog.count(*)
      from public.whatsapp_messages as message
      where message.organization_id = p_organization_id
        and message.lead_id = any(v_lead_ids)
    ),
    'whatsapp_outbox', (
      select pg_catalog.count(*)
      from public.whatsapp_outbox as outbox
      join public.whatsapp_messages as message
        on message.id = outbox.message_id
      where outbox.organization_id = p_organization_id
        and message.organization_id = p_organization_id
        and message.lead_id = any(v_lead_ids)
    ),
    'outbox_messages', (
      select pg_catalog.count(*)
      from public.outbox_messages as outbox_message
      where outbox_message.organization_id = p_organization_id
        and outbox_message.lead_id = any(v_lead_ids)
    ),
    'audit_logs', (
      select pg_catalog.count(*)
      from public.audit_logs as audit_log
      where audit_log.organization_id = p_organization_id
        and audit_log.entity_id = any(v_entity_id_texts)
    )
  );
end;
$$;

-- public.ai_outbox_messages is intentionally excluded: it has no lead_id or
-- other cohort-safe correlation key, and no imported lead/activity producer
-- writes to it.  An organization-wide delta would mix legitimate concurrent
-- AI traffic into the proof and create false failures.

create or replace function private.historical_import_effect_delta(
  p_before jsonb,
  p_after jsonb
)
returns jsonb
language sql
immutable
strict
security invoker
set search_path = ''
as $$
  select coalesce(
    pg_catalog.jsonb_object_agg(
      key,
      coalesce((p_after->>key)::bigint, 0)
        - coalesce((p_before->>key)::bigint, 0)
      order by key
    ),
    '{}'::jsonb
  )
  from (
    select key
    from pg_catalog.jsonb_object_keys(p_before) as before_key(key)
    union
    select key
    from pg_catalog.jsonb_object_keys(p_after) as after_key(key)
  ) as keys
$$;

revoke all on function private.historical_import_effect_counts(uuid, uuid[], uuid[])
from public, anon, authenticated, service_role;
revoke all on function private.historical_import_effect_delta(jsonb, jsonb)
from public, anon, authenticated, service_role;

create or replace function private.user_can_import_historical_leads(
  p_organization_id uuid,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    p_organization_id is not null
    and p_user_id is not null
    and exists (
      select 1
      from public.organization_members as member
      where member.organization_id = p_organization_id
        and member.user_id = p_user_id
        and coalesce(member.is_active, false) = true
    )
    and (
      exists (
        select 1
        from public.organization_members as member
        where member.organization_id = p_organization_id
          and member.user_id = p_user_id
          and coalesce(member.is_active, false) = true
          and member.role in ('owner', 'admin')
      )
      or exists (
        select 1
        from public.user_organization_roles as user_role
        join public.organization_roles as role
          on role.id = user_role.role_id
         and role.organization_id = user_role.organization_id
        join public.organization_role_permissions as role_permission
          on role_permission.role_id = user_role.role_id
         and role_permission.organization_id = user_role.organization_id
        join public.available_permissions as permission
          on permission.id = role_permission.permission_id
        where user_role.user_id = p_user_id
          and user_role.organization_id = p_organization_id
          and coalesce(user_role.is_active, false) = true
          and coalesce(role.is_active, false) = true
          and permission.key = 'lead_import'
      )
    )
$$;

revoke all on function private.user_can_import_historical_leads(uuid, uuid)
from public, anon, authenticated, service_role;

create or replace function private.import_historical_lead_batch(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_batch jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_request_role text := coalesce(
    nullif(pg_catalog.current_setting('request.jwt.claim.role', true), ''),
    nullif(pg_catalog.current_setting('request.jwt.claims', true), '')::jsonb
      ->>'role',
    ''
  );
  v_entity_type text;
  v_batch_index integer;
  v_declared_count integer;
  v_actual_count integer;
  v_records jsonb;
  v_declared_records_sha256 text;
  v_batch_sha256 text;
  v_batch_lead_ids uuid[] := '{}'::uuid[];
  v_batch_target_ids uuid[] := '{}'::uuid[];
  v_proof_lead_id uuid;
  v_proof_target_id uuid;
  v_effect_before jsonb;
  v_effect_after jsonb;
  v_effect_delta jsonb;
  v_effect_sinks jsonb;
  v_effect_all_zero boolean := false;
  v_suppression_active boolean := false;
  v_token text;
  v_transaction_id text;
  v_record jsonb;
  v_payload jsonb;
  v_provenance jsonb;
  v_action text;
  v_external_key text;
  v_payload_sha256 text;
  v_computed_sha256 text;
  v_source_system text;
  v_source_id text;
  v_source_lead_id text;
  v_target_id uuid;
  v_expected_target_id uuid;
  v_lead_id uuid;
  v_entry_id uuid;
  v_pipeline_id uuid;
  v_stage_id uuid;
  v_assigned_user_id uuid;
  v_team_id uuid;
  v_name text;
  v_phone text;
  v_email text;
  v_message text;
  v_created_at timestamptz;
  v_updated_at timestamptz;
  v_stage_entered_at timestamptz;
  v_assigned_at timestamptz;
  v_won_at timestamptz;
  v_lost_at timestamptz;
  v_deal_status text;
  v_event_at timestamptz;
  v_event_type text;
  v_direction text;
  v_metadata jsonb;
  v_tags jsonb;
  v_tag_value jsonb;
  v_tag_name text;
  v_tag_id uuid;
  v_existing private.historical_lead_import_ledger%rowtype;
  v_results jsonb := '[]'::jsonb;
  v_created_count integer := 0;
  v_noop_count integer := 0;
  v_scoped_phone_index_ready boolean := false;
begin
  if v_request_role <> 'service_role' then
    raise exception using
      errcode = '42501',
      message = 'historical_import_service_role_required';
  end if;

  if not private.user_can_import_historical_leads(
    p_organization_id,
    p_actor_user_id
  ) then
    raise exception using
      errcode = '42501',
      message = 'historical_import_lead_import_permission_required';
  end if;

  if p_batch is null
     or pg_catalog.jsonb_typeof(p_batch) <> 'object'
     or p_batch->>'schema_version' <> '1'
     or pg_catalog.jsonb_typeof(p_batch->'batch') <> 'object'
     or pg_catalog.jsonb_typeof(p_batch->'records') <> 'array' then
    raise exception using
      errcode = '22023',
      message = 'historical_import_batch_shape_invalid';
  end if;

  if pg_catalog.octet_length(pg_catalog.convert_to(
       private.canonical_jsonb_text(p_batch),
       'UTF8'
     ))
     > 5 * 1024 * 1024 then
    raise exception using
      errcode = '54000',
      message = 'historical_import_batch_payload_too_large';
  end if;

  v_entity_type := pg_catalog.lower(
    pg_catalog.btrim(coalesce(p_batch #>> '{batch,entity_type}', ''))
  );
  if v_entity_type not in ('lead', 'event', 'chat') then
    raise exception using
      errcode = '22023',
      message = 'historical_import_batch_entity_invalid';
  end if;

  begin
    v_batch_index := (p_batch #>> '{batch,index}')::integer;
    v_declared_count := (p_batch #>> '{batch,record_count}')::integer;
  exception
    when invalid_text_representation or numeric_value_out_of_range then
      raise exception using
        errcode = '22023',
        message = 'historical_import_batch_counters_invalid';
  end;

  v_records := p_batch->'records';
  v_actual_count := pg_catalog.jsonb_array_length(v_records);
  if v_batch_index is null
     or v_batch_index < 0
     or v_actual_count < 1
     or v_actual_count > 250
     or v_declared_count is distinct from v_actual_count then
    raise exception using
      errcode = '22023',
      message = 'historical_import_batch_count_invalid';
  end if;

  v_declared_records_sha256 := pg_catalog.lower(pg_catalog.btrim(coalesce(
    p_batch #>> '{batch,records_sha256}',
    ''
  )));
  if v_declared_records_sha256 !~ '^[0-9a-f]{64}$'
     or v_declared_records_sha256 is distinct from
       private.canonical_jsonb_sha256(v_records) then
    raise exception using
      errcode = '22023',
      message = 'historical_import_records_hash_mismatch';
  end if;

  for v_record in
    select record.value
    from pg_catalog.jsonb_array_elements(v_records) as record(value)
  loop
    begin
      v_proof_target_id := (v_record->>'target_id')::uuid;
      v_proof_lead_id := case
        when v_entity_type = 'lead' then (v_record->>'target_id')::uuid
        else (v_record #>> '{payload,lead_id}')::uuid
      end;
    exception
      when invalid_text_representation then
        raise exception using
          errcode = '22023',
          message = 'historical_import_proof_lead_id_invalid';
    end;

    if v_proof_lead_id is null or v_proof_target_id is null then
      raise exception using
        errcode = '22023',
        message = 'historical_import_proof_scope_id_required';
    end if;

    if not v_proof_lead_id = any(v_batch_lead_ids) then
      v_batch_lead_ids := pg_catalog.array_append(
        v_batch_lead_ids,
        v_proof_lead_id
      );
    end if;

    if not v_proof_target_id = any(v_batch_target_ids) then
      v_batch_target_ids := pg_catalog.array_append(
        v_batch_target_ids,
        v_proof_target_id
      );
    end if;
  end loop;

  if v_entity_type = 'lead' then
    if pg_catalog.to_regclass('public.leads_org_phone_unique') is not null then
      raise exception using
        errcode = '55000',
        message = 'historical_import_legacy_global_phone_identity_active',
        hint = 'Complete and verify the reviewed queue-scoped phone identity cutover before importing external cards.';
    end if;

    select exists (
      select 1
      from pg_catalog.pg_index as index_state
      where index_state.indexrelid =
        pg_catalog.to_regclass('public.leads_org_scope_phone_unique')
        and index_state.indrelid = 'public.leads'::regclass
        and index_state.indisunique
        and index_state.indisready
        and index_state.indisvalid
    )
    into v_scoped_phone_index_ready;

    if not v_scoped_phone_index_ready then
      raise exception using
        errcode = '55000',
        message = 'historical_import_scoped_phone_identity_not_ready';
    end if;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'historical_lead_import:' || p_organization_id::text,
      0
    )
  );

  v_batch_sha256 := private.canonical_jsonb_sha256(p_batch);
  v_effect_before := private.historical_import_effect_counts(
    p_organization_id,
    v_batch_lead_ids,
    v_batch_target_ids
  );
  v_token := pg_catalog.encode(extensions.gen_random_bytes(32), 'hex');
  v_transaction_id := pg_catalog.pg_current_xact_id()::text;

  insert into private.historical_lead_import_contexts (
    transaction_id,
    token_sha256,
    organization_id,
    actor_user_id
  ) values (
    v_transaction_id,
    pg_catalog.encode(extensions.digest(v_token, 'sha256'), 'hex'),
    p_organization_id,
    p_actor_user_id
  );

  perform pg_catalog.set_config(
    'vimob.historical_import_token',
    v_token,
    true
  );

  v_suppression_active := private.historical_import_effects_suppressed();
  if not v_suppression_active then
    raise exception using
      errcode = '55000',
      message = 'historical_import_transaction_capability_not_active';
  end if;

  begin
    for v_record in
      select record.value
      from pg_catalog.jsonb_array_elements(v_records) as record(value)
    loop
      if pg_catalog.jsonb_typeof(v_record) <> 'object'
         or pg_catalog.jsonb_typeof(v_record->'payload') <> 'object'
         or coalesce(v_record #>> '{validation,ok}', 'false') <> 'true' then
        raise exception using
          errcode = '22023',
          message = 'historical_import_record_shape_invalid';
      end if;

      v_payload := v_record->'payload';
      v_provenance := coalesce(v_record->'provenance', '{}'::jsonb);
      if pg_catalog.jsonb_typeof(v_provenance) <> 'object' then
        raise exception using
          errcode = '22023',
          message = 'historical_import_record_provenance_invalid';
      end if;

      if pg_catalog.octet_length(
        pg_catalog.convert_to(
          private.canonical_jsonb_text(v_payload),
          'UTF8'
        )
      ) > 512 * 1024 then
        raise exception using
          errcode = '54000',
          message = 'historical_import_record_payload_too_large';
      end if;

      v_action := pg_catalog.upper(
        pg_catalog.btrim(coalesce(v_record->>'action', ''))
      );
      if v_action not in ('CREATE', 'NOOP') then
        raise exception using
          errcode = '22023',
          message = 'historical_import_record_action_invalid';
      end if;

      if pg_catalog.lower(pg_catalog.btrim(coalesce(
        v_record->>'entity_type',
        v_entity_type
      ))) <> v_entity_type then
        raise exception using
          errcode = '22023',
          message = 'historical_import_record_entity_mismatch';
      end if;

      if nullif(v_record->>'organization_id', '')::uuid
         is distinct from p_organization_id then
        raise exception using
          errcode = '22023',
          message = 'historical_import_record_tenant_mismatch';
      end if;

      v_external_key := pg_catalog.btrim(coalesce(
        v_record->>'external_key',
        ''
      ));
      if pg_catalog.length(v_external_key) not between 1 and 700
         or v_external_key ~ '[[:cntrl:]]' then
        raise exception using
          errcode = '22023',
          message = 'historical_import_external_key_invalid';
      end if;

      v_payload_sha256 := pg_catalog.lower(pg_catalog.btrim(coalesce(
        v_record->>'payload_sha256',
        ''
      )));
      v_computed_sha256 := private.canonical_jsonb_sha256(v_payload);
      if v_payload_sha256 !~ '^[0-9a-f]{64}$'
         or v_payload_sha256 is distinct from v_computed_sha256 then
        raise exception using
          errcode = '22023',
          message = 'historical_import_payload_hash_mismatch';
      end if;

      v_source_system := pg_catalog.lower(pg_catalog.btrim(coalesce(
        v_payload->>'source_system',
        v_provenance->>'source_system',
        ''
      )));
      if v_source_system !~ '^[a-z0-9][a-z0-9._-]{0,63}$' then
        raise exception using
          errcode = '22023',
          message = 'historical_import_source_system_invalid';
      end if;

      v_source_lead_id := pg_catalog.btrim(coalesce(
        v_payload->>'source_lead_id',
        ''
      ));
      if pg_catalog.length(v_source_lead_id) not between 1 and 256
         or v_source_lead_id ~ '[[:cntrl:]]' then
        raise exception using
          errcode = '22023',
          message = 'historical_import_source_lead_id_invalid';
      end if;

      v_source_id := case
        when v_entity_type = 'lead' then v_source_lead_id
        else pg_catalog.btrim(coalesce(
          v_payload->>'source_event_id',
          v_external_key
        ))
      end;
      if pg_catalog.length(v_source_id) not between 1 and 512
         or v_source_id ~ '[[:cntrl:]]' then
        raise exception using
          errcode = '22023',
          message = 'historical_import_source_id_invalid';
      end if;

      if coalesce(v_payload->>'historical_import', 'false') <> 'true'
         or v_payload->>'notification_policy' <> 'suppress_all' then
        raise exception using
          errcode = '22023',
          message = 'historical_import_suppression_contract_required';
      end if;

      begin
        v_target_id := (v_record->>'target_id')::uuid;
      exception
        when invalid_text_representation then
          raise exception using
            errcode = '22023',
            message = 'historical_import_target_id_invalid';
      end;

      v_expected_target_id := extensions.uuid_generate_v5(
        extensions.uuid_ns_url(),
        p_organization_id::text || ':' || v_external_key
      );
      if v_target_id is distinct from v_expected_target_id then
        raise exception using
          errcode = '22023',
          message = 'historical_import_target_id_not_deterministic';
      end if;

      select ledger.*
      into v_existing
      from private.historical_lead_import_ledger as ledger
      where ledger.organization_id = p_organization_id
        and ledger.source_system = v_source_system
        and ledger.entity_type = v_entity_type
        and ledger.source_id = v_source_id
      for update;

      if found then
        if v_existing.external_key is distinct from v_external_key
           or v_existing.target_id is distinct from v_target_id
           or v_existing.payload_sha256 is distinct from v_payload_sha256
           or v_existing.payload is distinct from v_payload then
          raise exception using
            errcode = '23514',
            message = 'historical_import_ledger_drift';
        end if;

        if (
          v_entity_type = 'lead'
          and not exists (
            select 1
            from public.leads as lead
            where lead.organization_id = p_organization_id
              and lead.id = v_target_id
              and lead.external_source = v_source_system
              and lead.external_source_id = v_source_lead_id
          )
        ) or (
          v_entity_type = 'event'
          and not exists (
            select 1
            from public.activities as activity
            where activity.organization_id = p_organization_id
              and activity.id = v_target_id
          )
        ) or (
          v_entity_type = 'chat'
          and not exists (
            select 1
            from public.activities as activity
            where activity.organization_id = p_organization_id
              and activity.id = v_target_id
          )
        ) then
          raise exception using
            errcode = '23514',
            message = 'historical_import_ledger_target_missing';
        end if;

        v_noop_count := v_noop_count + 1;
        v_results := v_results || pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object(
            'external_key', v_external_key,
            'target_id', v_target_id,
            'action', 'NOOP'
          )
        );
        continue;
      end if;

      if v_action = 'NOOP' then
        raise exception using
          errcode = '23514',
          message = 'historical_import_noop_without_ledger';
      end if;

      if exists (
        select 1
        from private.historical_lead_import_ledger as ledger
        where ledger.organization_id = p_organization_id
          and ledger.external_key = v_external_key
      ) then
        raise exception using
          errcode = '23505',
          message = 'historical_import_external_key_collision';
      end if;

      if (
        v_entity_type = 'lead'
        and exists (
          select 1 from public.leads as lead
          where lead.id = v_target_id
        )
      ) or (
        v_entity_type = 'event'
        and exists (
          select 1 from public.activities as activity
          where activity.id = v_target_id
        )
      ) or (
        v_entity_type = 'chat'
        and exists (
          select 1 from public.activities as activity
          where activity.id = v_target_id
        )
      ) then
        raise exception using
          errcode = '23505',
          message = 'historical_import_target_exists_without_ledger';
      end if;

      if v_entity_type = 'lead' then
        v_name := pg_catalog.btrim(coalesce(v_payload->>'name', ''));
        if pg_catalog.length(v_name) not between 1 and 255 then
          raise exception using
            errcode = '22023',
            message = 'historical_import_lead_name_invalid';
        end if;

        begin
          v_pipeline_id := (v_payload->>'pipeline_id')::uuid;
          v_stage_id := (v_payload->>'stage_id')::uuid;
          v_assigned_user_id := (v_payload->>'assigned_user_id')::uuid;
          v_team_id := nullif(v_payload->>'team_id', '')::uuid;
          v_created_at := (v_payload->>'created_at')::timestamptz;
          v_updated_at := coalesce(
            nullif(v_payload->>'updated_at', '')::timestamptz,
            v_created_at
          );
          v_stage_entered_at :=
            nullif(v_payload->>'stage_entered_at', '')::timestamptz;
          v_assigned_at :=
            nullif(v_payload->>'assigned_at', '')::timestamptz;
        exception
          when invalid_text_representation or datetime_field_overflow then
            raise exception using
              errcode = '22023',
              message = 'historical_import_lead_reference_or_timestamp_invalid';
        end;

        if v_created_at is null
           or v_created_at > pg_catalog.clock_timestamp() + interval '1 day'
           or v_updated_at < v_created_at
           or v_updated_at > pg_catalog.clock_timestamp() + interval '1 day'
           or (
             v_stage_entered_at is not null
             and (
               v_stage_entered_at < v_created_at
               or v_stage_entered_at >
                 pg_catalog.clock_timestamp() + interval '1 day'
             )
           )
           or (
             v_assigned_at is not null
             and (
               v_assigned_at < v_created_at
               or v_assigned_at >
                 pg_catalog.clock_timestamp() + interval '1 day'
             )
           ) then
          raise exception using
            errcode = '22023',
            message = 'historical_import_lead_timestamp_invalid';
        end if;

        if not exists (
          select 1
          from public.pipelines as pipeline
          join public.stages as stage
            on stage.organization_id = pipeline.organization_id
           and stage.pipeline_id = pipeline.id
          where pipeline.organization_id = p_organization_id
            and pipeline.id = v_pipeline_id
            and stage.id = v_stage_id
            and coalesce(pipeline.is_active, true) = true
            and coalesce(stage.is_active, true) = true
        ) then
          raise exception using
            errcode = '23503',
            message = 'historical_import_pipeline_stage_tenant_mismatch';
        end if;

        if not exists (
          select 1
          from public.organization_members as member
          where member.organization_id = p_organization_id
            and member.user_id = v_assigned_user_id
            and coalesce(member.is_active, false) = true
        ) then
          raise exception using
            errcode = '23503',
            message = 'historical_import_owner_not_active_member';
        end if;

        if v_team_id is not null
           and not exists (
             select 1
             from public.teams as team
             where team.organization_id = p_organization_id
               and team.id = v_team_id
           ) then
          raise exception using
            errcode = '23503',
            message = 'historical_import_team_tenant_mismatch';
        end if;

        v_deal_status := pg_catalog.lower(pg_catalog.btrim(coalesce(
          v_payload->>'deal_status',
          ''
        )));
        if v_deal_status not in ('open', 'won', 'lost') then
          raise exception using
            errcode = '22023',
            message = 'historical_import_deal_status_invalid';
        end if;

        begin
          v_won_at := case
            when v_deal_status = 'won'
              then nullif(v_payload->>'won_at', '')::timestamptz
            else null
          end;
          v_lost_at := case
            when v_deal_status = 'lost'
              then nullif(v_payload->>'lost_at', '')::timestamptz
            else null
          end;
        exception
          when invalid_text_representation or datetime_field_overflow then
            raise exception using
              errcode = '22023',
              message = 'historical_import_deal_timestamp_invalid';
        end;

        if (
          v_won_at is not null
          and (
            v_won_at < v_created_at
            or v_won_at > pg_catalog.clock_timestamp() + interval '1 day'
          )
        ) or (
          v_lost_at is not null
          and (
            v_lost_at < v_created_at
            or v_lost_at > pg_catalog.clock_timestamp() + interval '1 day'
          )
        ) then
          raise exception using
            errcode = '22023',
            message = 'historical_import_deal_timestamp_out_of_range';
        end if;

        v_phone := nullif(pg_catalog.btrim(coalesce(v_payload->>'phone', '')), '');
        v_email := nullif(pg_catalog.btrim(coalesce(v_payload->>'email', '')), '');
        v_message := nullif(v_payload->>'message', '');
        if pg_catalog.length(coalesce(v_phone, '')) > 80
           or pg_catalog.length(coalesce(v_email, '')) > 320 then
          raise exception using
            errcode = '22023',
            message = 'historical_import_lead_contact_invalid';
        end if;

        v_metadata := coalesce(v_payload->'metadata', '{}'::jsonb);
        if pg_catalog.jsonb_typeof(v_metadata) <> 'object'
           or pg_catalog.octet_length(
             pg_catalog.convert_to(v_metadata::text, 'UTF8')
           ) > 256 * 1024 then
          raise exception using
            errcode = '22023',
              message = 'historical_import_lead_metadata_invalid';
        end if;

        if pg_catalog.jsonb_typeof(
             v_metadata->'timestamp_provenance'
           ) is distinct from 'object'
           or v_metadata->'timestamp_provenance' = '{}'::jsonb
           or exists (
             select 1
             from pg_catalog.unnest(array[
               'created_at',
               'updated_at',
               'stage_entered_at',
               'assigned_at',
               'won_at',
               'lost_at'
             ]) as required(field_name)
             where pg_catalog.jsonb_typeof(
               v_metadata->'timestamp_provenance'->required.field_name
             ) is distinct from 'object'
               or not (
                 v_metadata->'timestamp_provenance'->required.field_name
                   ?& array[
                     'value',
                     'source_field',
                     'confidence',
                     'is_inferred',
                     'rule',
                     'parse_method'
                   ]
               )
           ) then
          raise exception using
            errcode = '22023',
            message = 'historical_import_timestamp_provenance_required';
        end if;

        v_metadata := v_metadata || pg_catalog.jsonb_build_object(
          'historical_import', true,
          'notification_policy', 'suppress_all',
          'external_identity', pg_catalog.jsonb_build_object(
            'source_system', v_source_system,
            'source_id', v_source_lead_id,
            'external_key', v_external_key,
            'payload_sha256', v_payload_sha256
          ),
          'imported_by', p_actor_user_id,
          'imported_at', pg_catalog.clock_timestamp()
        );

        insert into public.leads (
          id,
          organization_id,
          pipeline_id,
          stage_id,
          assigned_user_id,
          team_id,
          name,
          email,
          phone,
          message,
          source,
          source_detail,
          deal_status,
          status,
          priority,
          lost_reason,
          won_at,
          lost_at,
          created_at,
          updated_at,
          stage_entered_at,
          board_order_at,
          assigned_at,
          last_entry_at,
          created_by,
          attention_eligible,
          attention_enrolled_at,
          metadata,
          external_source,
          external_source_id,
          intake_scope_key,
          origin_round_robin_id,
          operational_effects_suppressed,
          historical_imported_at
        ) values (
          v_target_id,
          p_organization_id,
          v_pipeline_id,
          v_stage_id,
          v_assigned_user_id,
          v_team_id,
          v_name,
          v_email,
          v_phone,
          v_message,
          coalesce(nullif(pg_catalog.btrim(v_payload->>'source'), ''), v_source_system),
          'historical_import',
          v_deal_status,
          coalesce(nullif(pg_catalog.btrim(v_payload->>'status'), ''), 'new'),
          coalesce(nullif(pg_catalog.btrim(v_payload->>'priority'), ''), 'normal'),
          nullif(v_payload->>'lost_reason', ''),
          v_won_at,
          v_lost_at,
          v_created_at,
          v_updated_at,
          v_stage_entered_at,
          coalesce(
            nullif(v_payload->>'board_order_at', '')::timestamptz,
            v_updated_at,
            v_created_at
          ),
          v_assigned_at,
          coalesce(
            nullif(v_payload->>'last_entry_at', '')::timestamptz,
            v_updated_at,
            v_created_at
          ),
          p_actor_user_id,
          false,
          null,
          v_metadata,
          v_source_system,
          v_source_lead_id,
          private.lead_intake_scope_for_external(
            p_organization_id,
            v_source_system,
            v_source_lead_id
          ),
          null,
          true,
          pg_catalog.clock_timestamp()
        );

        v_entry_id := extensions.uuid_generate_v5(
          extensions.uuid_ns_url(),
          p_organization_id::text || ':' || v_external_key || ':initial-entry'
        );

        insert into public.lead_entry_events (
          id,
          lead_id,
          organization_id,
          entry_type,
          source,
          provider,
          provider_event_id,
          occurred_at,
          created_at,
          is_countable,
          source_detail,
          pipeline_id,
          stage_id,
          metadata,
          payload
        ) values (
          v_entry_id,
          v_target_id,
          p_organization_id,
          'initial',
          v_source_system,
          v_source_system,
          v_source_lead_id,
          v_created_at,
          v_created_at,
          false,
          'historical_import_non_countable',
          v_pipeline_id,
          v_stage_id,
          pg_catalog.jsonb_build_object(
            'historical_import', true,
            'notification_policy', 'suppress_all',
            'external_key', v_external_key,
            'payload_sha256', v_payload_sha256
          ),
          pg_catalog.jsonb_build_object(
            'source_system', v_source_system,
            'source_lead_id', v_source_lead_id
          )
        );

        v_tags := coalesce(v_payload->'tags', '[]'::jsonb);
        if pg_catalog.jsonb_typeof(v_tags) <> 'array'
           or pg_catalog.jsonb_array_length(v_tags) > 50 then
          raise exception using
            errcode = '22023',
            message = 'historical_import_lead_tags_invalid';
        end if;

        for v_tag_value in
          select tag.value
          from pg_catalog.jsonb_array_elements(v_tags) as tag(value)
        loop
          if pg_catalog.jsonb_typeof(v_tag_value) <> 'string' then
            raise exception using
              errcode = '22023',
              message = 'historical_import_tag_name_invalid';
          end if;

          v_tag_name := pg_catalog.btrim(v_tag_value #>> '{}');
          if pg_catalog.length(v_tag_name) not between 1 and 100
             or v_tag_name ~ '[[:cntrl:]]' then
            raise exception using
              errcode = '22023',
              message = 'historical_import_tag_name_invalid';
          end if;

          insert into public.tags (
            organization_id,
            name,
            color,
            description,
            created_at
          ) values (
            p_organization_id,
            v_tag_name,
            '#6B7280',
            'Importada do histórico C2S',
            v_created_at
          )
          on conflict do nothing;

          select tag.id
          into v_tag_id
          from public.tags as tag
          where tag.organization_id = p_organization_id
            and pg_catalog.lower(pg_catalog.btrim(tag.name)) =
              pg_catalog.lower(v_tag_name)
          order by
            (tag.name = v_tag_name) desc,
            tag.created_at,
            tag.id
          limit 1;

          if v_tag_id is null then
            raise exception using
              errcode = '23514',
              message = 'historical_import_tag_upsert_failed';
          end if;

          insert into public.lead_tags (
            id,
            lead_id,
            tag_id,
            organization_id,
            created_at
          ) values (
            extensions.uuid_generate_v5(
              extensions.uuid_ns_url(),
              p_organization_id::text || ':' || v_external_key
                || ':tag:' || pg_catalog.lower(v_tag_name)
            ),
            v_target_id,
            v_tag_id,
            p_organization_id,
            v_created_at
          )
          on conflict (lead_id, tag_id) do nothing;
        end loop;

        v_lead_id := v_target_id;
      else
        begin
          v_lead_id := (v_payload->>'lead_id')::uuid;
          v_event_at := (v_payload->>'event_at')::timestamptz;
        exception
          when invalid_text_representation or datetime_field_overflow then
            raise exception using
              errcode = '22023',
              message = 'historical_import_history_reference_or_timestamp_invalid';
        end;

        if v_event_at is null
           or v_event_at > pg_catalog.clock_timestamp() + interval '1 day'
           or not exists (
             select 1
             from public.leads as lead
             where lead.organization_id = p_organization_id
               and lead.id = v_lead_id
               and lead.external_source = v_source_system
               and lead.external_source_id = v_source_lead_id
           ) then
          raise exception using
            errcode = '23503',
            message = 'historical_import_history_lead_tenant_mismatch';
        end if;

        v_message := coalesce(v_payload->>'message', '');
        if pg_catalog.length(v_message) > 500000 then
          raise exception using
            errcode = '22023',
            message = 'historical_import_history_message_too_large';
        end if;

        v_metadata := coalesce(v_payload->'metadata', '{}'::jsonb);
        if pg_catalog.jsonb_typeof(v_metadata) <> 'object' then
          raise exception using
            errcode = '22023',
            message = 'historical_import_history_metadata_invalid';
        end if;

        v_metadata := v_metadata || pg_catalog.jsonb_build_object(
          'source_system', v_source_system,
          'historical_import', true,
          'notification_policy', 'suppress_all',
          'external_key', v_external_key,
          'source_lead_id', v_source_lead_id,
          'sequence', v_payload->'sequence',
          'author_source', v_payload->'author_source',
          'time_raw', v_payload->'time_raw',
          'payload_sha256', v_payload_sha256,
          'message', v_message
        );

        if v_entity_type = 'event' then
          if nullif(pg_catalog.btrim(v_message), '') is null then
            raise exception using
              errcode = '22023',
              message = 'historical_import_event_content_required';
          end if;

          insert into public.activities (
            id,
            organization_id,
            lead_id,
            user_id,
            type,
            content,
            metadata,
            created_at
          ) values (
            v_target_id,
            p_organization_id,
            v_lead_id,
            null,
            'note',
            v_message,
            v_metadata || pg_catalog.jsonb_build_object(
              'kind', v_source_system || ':event:' || v_source_id,
              'event_kind', coalesce(
                nullif(v_payload->>'event_kind', ''),
                nullif(v_payload->>'event_type', ''),
                'history'
              ),
              'raw_text', v_payload->'raw_text',
              'title', v_payload->'title',
              'description', v_payload->'description',
              'timestamp_confidence', v_payload->'timestamp_confidence'
            ),
            v_event_at
          );
        else
          v_direction := pg_catalog.lower(pg_catalog.btrim(coalesce(
            v_payload->>'direction',
            ''
          )));
          if v_direction not in ('inbound', 'outbound') then
            raise exception using
              errcode = '22023',
              message = 'historical_import_chat_direction_invalid';
          end if;

          v_event_type := case
            when v_direction = 'inbound' then 'whatsapp_message_received'
            else 'whatsapp_message_sent'
          end;

          if v_payload->'media' is not null
             and pg_catalog.jsonb_typeof(v_payload->'media') <> 'array' then
            raise exception using
              errcode = '22023',
              message = 'historical_import_chat_media_invalid';
          end if;

          if v_message = ''
             and coalesce(pg_catalog.jsonb_array_length(
               coalesce(v_payload->'media', '[]'::jsonb)
             ), 0) = 0 then
            raise exception using
              errcode = '22023',
              message = 'historical_import_chat_content_required';
          end if;

          insert into public.activities (
            id,
            organization_id,
            lead_id,
            user_id,
            type,
            content,
            metadata,
            created_at
          ) values (
            v_target_id,
            p_organization_id,
            v_lead_id,
            null,
            v_event_type,
            nullif(v_message, ''),
            v_metadata || pg_catalog.jsonb_build_object(
              'kind', v_source_system || ':chat:' || v_source_id,
              'direction', v_direction,
              'media', coalesce(v_payload->'media', '[]'::jsonb)
            ),
            v_event_at
          );
        end if;
      end if;

      insert into private.historical_lead_import_ledger (
        organization_id,
        source_system,
        entity_type,
        source_id,
        external_key,
        target_id,
        lead_id,
        payload_sha256,
        payload,
        provenance,
        imported_by,
        batch_index
      ) values (
        p_organization_id,
        v_source_system,
        v_entity_type,
        v_source_id,
        v_external_key,
        v_target_id,
        v_lead_id,
        v_payload_sha256,
        v_payload,
        v_provenance,
        p_actor_user_id,
        v_batch_index
      );

      v_created_count := v_created_count + 1;
      v_results := v_results || pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'external_key', v_external_key,
          'target_id', v_target_id,
          'action', 'CREATE'
        )
      );
    end loop;

    v_effect_after := private.historical_import_effect_counts(
      p_organization_id,
      v_batch_lead_ids,
      v_batch_target_ids
    );
    v_effect_delta := private.historical_import_effect_delta(
      v_effect_before,
      v_effect_after
    );

    select coalesce(
      pg_catalog.bool_and(effect.value::bigint = 0),
      true
    )
    into v_effect_all_zero
    from pg_catalog.jsonb_each_text(v_effect_delta) as effect(key, value);

    select coalesce(
      pg_catalog.jsonb_object_agg(
        sink.key,
        pg_catalog.jsonb_build_object(
          'before', (v_effect_before->>sink.key)::bigint,
          'after', (v_effect_after->>sink.key)::bigint,
          'delta', (v_effect_delta->>sink.key)::bigint
        )
        order by sink.key
      ),
      '{}'::jsonb
    )
    into v_effect_sinks
    from pg_catalog.jsonb_object_keys(v_effect_delta) as sink(key);

    if not v_effect_all_zero then
      raise exception using
        errcode = '23514',
        message = 'historical_import_side_effect_detected',
        detail = v_effect_delta::text;
    end if;

    delete from private.historical_lead_import_contexts as context
    where context.transaction_id = v_transaction_id;
    perform pg_catalog.set_config(
      'vimob.historical_import_token',
      '',
      true
    );
  exception
    when others then
      delete from private.historical_lead_import_contexts as context
      where context.transaction_id = v_transaction_id;
      perform pg_catalog.set_config(
        'vimob.historical_import_token',
        '',
        true
      );
      raise;
  end;

  return pg_catalog.jsonb_build_object(
    'schema_version', 1,
    'organization_id', p_organization_id,
    'entity_type', v_entity_type,
    'batch_index', v_batch_index,
    'batch_sha256', v_batch_sha256,
    'records_sha256', v_declared_records_sha256,
    'record_count', v_actual_count,
    'created_count', v_created_count,
    'noop_count', v_noop_count,
    'notification_policy', 'suppress_all',
    'effect_proof', pg_catalog.jsonb_build_object(
      'suppression_active', v_suppression_active,
      'durable_marker_enforced', true,
      'sinks', v_effect_sinks,
      'all_zero', v_effect_all_zero
    ),
    'results', v_results
  );
end;
$$;

revoke all on function private.import_historical_lead_batch(uuid, uuid, jsonb)
from public, anon, authenticated, service_role;

comment on function private.import_historical_lead_batch(uuid, uuid, jsonb) is
  'Atomic/idempotent historical lead import. Service-role entrypoint still requires an active actor with lead_import in the target tenant.';

create or replace function public.import_historical_lead_batch(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_batch jsonb
)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select private.import_historical_lead_batch(
    p_organization_id,
    p_actor_user_id,
    p_batch
  )
$$;

revoke all on function public.import_historical_lead_batch(uuid, uuid, jsonb)
from public, anon, authenticated, service_role;
grant execute on function public.import_historical_lead_batch(uuid, uuid, jsonb)
to service_role;

comment on function public.import_historical_lead_batch(uuid, uuid, jsonb) is
  'PostgREST service-role boundary for bounded, silent, tenant-safe historical lead batches.';

create or replace function public.preflight_historical_lead_import(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_manifest_sha256 text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_request_role text := coalesce(
    nullif(pg_catalog.current_setting('request.jwt.claim.role', true), ''),
    nullif(pg_catalog.current_setting('request.jwt.claims', true), '')::jsonb
      ->>'role',
    ''
  );
  v_manifest_sha256 text := pg_catalog.lower(pg_catalog.btrim(coalesce(
    p_manifest_sha256,
    ''
  )));
  v_organization_exists boolean;
  v_actor_can_import boolean;
  v_scoped_identity_ready boolean;
  v_global_identity_absent boolean;
  v_columns_ready boolean;
  v_identity_trigger_ready boolean;
  v_effect_triggers_ready boolean;
  v_scanners_ready boolean;
  v_helpers_ready boolean;
  v_effect_sink_contract_ready boolean;
  v_effect_sink_count integer := 0;
  v_empty_effect_counts jsonb;
  v_rpc_acl_ready boolean;
  v_ready boolean;
  v_result jsonb;
begin
  if v_request_role <> 'service_role' then
    raise exception using
      errcode = '42501',
      message = 'historical_import_service_role_required';
  end if;

  if v_manifest_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception using
      errcode = '22023',
      message = 'historical_import_manifest_hash_invalid';
  end if;

  select exists (
    select 1
    from public.organizations as organization
    where organization.id = p_organization_id
  ) into v_organization_exists;

  v_actor_can_import := private.user_can_import_historical_leads(
    p_organization_id,
    p_actor_user_id
  );

  select exists (
    select 1
    from pg_catalog.pg_index as index_state
    where index_state.indexrelid =
      pg_catalog.to_regclass('public.leads_org_scope_phone_unique')
      and index_state.indrelid = 'public.leads'::regclass
      and index_state.indisunique
      and index_state.indisready
      and index_state.indisvalid
  ) into v_scoped_identity_ready;

  v_global_identity_absent :=
    pg_catalog.to_regclass('public.leads_org_phone_unique') is null;

  select pg_catalog.count(*) = 4
  into v_columns_ready
  from pg_catalog.pg_attribute as attribute
  where attribute.attrelid = 'public.leads'::regclass
    and attribute.attname in (
      'external_source',
      'external_source_id',
      'operational_effects_suppressed',
      'historical_imported_at'
    )
    and attribute.attnum > 0
    and not attribute.attisdropped;

  select exists (
    select 1
    from pg_catalog.pg_trigger as trigger_state
    where trigger_state.tgrelid = 'public.leads'::regclass
      and trigger_state.tgname =
        'enforce_lead_intake_identity_before_write'
      and trigger_state.tgenabled in ('O', 'A')
      and not trigger_state.tgisinternal
      and pg_catalog.pg_get_triggerdef(trigger_state.oid, true) like
        '%external_source%'
      and pg_catalog.pg_get_triggerdef(trigger_state.oid, true) like
        '%external_source_id%'
      and pg_catalog.pg_get_triggerdef(trigger_state.oid, true) like
        '%operational_effects_suppressed%'
      and pg_catalog.pg_get_triggerdef(trigger_state.oid, true) like
        '%historical_imported_at%'
  ) into v_identity_trigger_ready;

  select pg_catalog.count(*) = 26
  into v_effect_triggers_ready
  from (
    values
      ('public.leads'::regclass, 'hydrate_round_robin_destination_before_lead_insert', 'lead'),
      ('public.leads'::regclass, 'gamification_canonical_leads_insert_enqueue', 'lead'),
      ('public.leads'::regclass, 'gamification_canonical_leads_status_enqueue', 'lead'),
      ('public.leads'::regclass, 'tr_lead_created_entry', 'lead'),
      ('public.leads'::regclass, 'tr_mark_lead_owner_activity_for_redistribution', 'lead'),
      ('public.leads'::regclass, 'tr_set_assigned_at', 'lead'),
      ('public.leads'::regclass, 'tr_set_assigned_at_insert', 'lead'),
      ('public.leads'::regclass, 'tr_sync_lead_seller_to_customer', 'lead'),
      ('public.leads'::regclass, 'trg_assign_neximob_lancamentos_webhook_lead', 'lead'),
      ('public.leads'::regclass, 'trg_cancel_automations_on_stage_change', 'lead'),
      ('public.leads'::regclass, 'trg_capture_lead_cycles', 'lead'),
      ('public.leads'::regclass, 'trg_capture_lead_funnel_transition', 'lead'),
      ('public.leads'::regclass, 'trg_guard_lead_clocks', 'lead'),
      ('public.leads'::regclass, 'trg_sync_lead_cadence_assignee', 'lead'),
      ('public.leads'::regclass, 'trigger_create_commission_on_won', 'lead'),
      ('public.leads'::regclass, 'trigger_execute_stage_automations', 'lead'),
      ('public.leads'::regclass, 'trigger_lead_intake', 'lead'),
      ('public.leads'::regclass, 'trigger_lead_stage_operational_engine', 'lead'),
      ('public.leads'::regclass, 'trigger_log_lead_activity', 'lead'),
      ('public.leads'::regclass, 'zz_automation_lead_events', 'lead'),
      ('public.leads'::regclass, 'zz_trigger_deal_status_timestamp_guard', 'lead'),
      ('public.lead_entry_events'::regclass, 'trg_capture_meta_entry_funnel', 'child'),
      ('public.lead_entry_events'::regclass, 'zz_enqueue_outgoing_lead_webhooks', 'child'),
      ('public.activities'::regclass, 'gamification_canonical_activities_enqueue', 'child'),
      ('public.activities'::regclass, 'trg_capture_activity_attention_fact', 'child'),
      ('public.lead_tags'::regclass, 'zz_automation_tag_added', 'child')
  ) as expected(relation_id, trigger_name, guard_kind)
  join pg_catalog.pg_trigger as trigger_state
    on trigger_state.tgrelid = expected.relation_id
   and trigger_state.tgname = expected.trigger_name
   and trigger_state.tgenabled in ('O', 'A')
   and not trigger_state.tgisinternal
  where pg_catalog.pg_get_triggerdef(trigger_state.oid, true) like
      '%historical_import_effects_suppressed%'
    and (
      (
        expected.guard_kind = 'lead'
        and pg_catalog.pg_get_triggerdef(trigger_state.oid, true) like
          '%operational_effects_suppressed%'
      )
      or (
        expected.guard_kind = 'child'
        and pg_catalog.pg_get_triggerdef(trigger_state.oid, true) like
          '%lead_operational_effects_suppressed%'
      )
    );

  v_scanners_ready :=
    pg_catalog.pg_get_functiondef(
      'public.get_sla_pending_leads()'::regprocedure
    ) like '%operational_effects_suppressed%'
    and pg_catalog.pg_get_functiondef(
      'public.enqueue_due_automation_inactivity(integer)'::regprocedure
    ) like '%operational_effects_suppressed%';

  v_helpers_ready :=
    pg_catalog.to_regprocedure(
      'private.historical_import_effect_counts(uuid,uuid[],uuid[])'
    ) is not null
    and pg_catalog.to_regprocedure(
      'private.historical_import_effect_delta(jsonb,jsonb)'
    ) is not null
    and pg_catalog.to_regprocedure(
      'private.historical_import_effects_suppressed()'
    ) is not null;

  v_empty_effect_counts := private.historical_import_effect_counts(
    p_organization_id,
    '{}'::uuid[],
    '{}'::uuid[]
  );
  select pg_catalog.count(*)
  into v_effect_sink_count
  from pg_catalog.jsonb_object_keys(v_empty_effect_counts) as sink(key);
  v_effect_sink_contract_ready :=
    v_effect_sink_count = 33
    and v_empty_effect_counts ?& array['outbox_messages', 'audit_logs'];

  v_rpc_acl_ready :=
    pg_catalog.has_function_privilege(
      'service_role',
      'public.import_historical_lead_batch(uuid,uuid,jsonb)',
      'execute'
    )
    and exists (
      select 1
      from pg_catalog.pg_proc as function_state
      where function_state.oid =
        'public.import_historical_lead_batch(uuid,uuid,jsonb)'::regprocedure
        and function_state.prosecdef
        and function_state.proconfig = array['search_path=""']::text[]
    )
    and not exists (
      select 1
      from pg_catalog.pg_proc as function_state
      cross join lateral pg_catalog.aclexplode(coalesce(
        function_state.proacl,
        pg_catalog.acldefault('f', function_state.proowner)
      )) as privilege
      where function_state.oid =
        'public.import_historical_lead_batch(uuid,uuid,jsonb)'::regprocedure
        and privilege.grantee = 0
        and privilege.privilege_type = 'EXECUTE'
    )
    and not pg_catalog.has_function_privilege(
      'anon',
      'public.import_historical_lead_batch(uuid,uuid,jsonb)',
      'execute'
    )
    and not pg_catalog.has_function_privilege(
      'authenticated',
      'public.import_historical_lead_batch(uuid,uuid,jsonb)',
      'execute'
    )
    and not pg_catalog.has_function_privilege(
      'service_role',
      'private.import_historical_lead_batch(uuid,uuid,jsonb)',
      'execute'
    );

  v_ready :=
    v_organization_exists
    and v_actor_can_import
    and v_scoped_identity_ready
    and v_global_identity_absent
    and v_columns_ready
    and v_identity_trigger_ready
    and v_effect_triggers_ready
    and v_scanners_ready
    and v_helpers_ready
    and v_effect_sink_contract_ready
    and v_rpc_acl_ready;

  v_result := pg_catalog.jsonb_build_object(
    'schema_version', 1,
    'ready', v_ready,
    'organization_id', p_organization_id,
    'actor_user_id', p_actor_user_id,
    'manifest_sha256', v_manifest_sha256,
    'checks', pg_catalog.jsonb_build_object(
      'organization_exists', v_organization_exists,
      'actor_has_lead_import', v_actor_can_import,
      'scoped_phone_identity_ready', v_scoped_identity_ready,
      'legacy_global_phone_identity_absent', v_global_identity_absent,
      'historical_columns_ready', v_columns_ready,
      'identity_trigger_ready', v_identity_trigger_ready,
      'effect_triggers_ready', v_effect_triggers_ready,
      'periodic_scanners_ready', v_scanners_ready,
      'effect_proof_helpers_ready', v_helpers_ready,
      'effect_proof_sink_contract_ready', v_effect_sink_contract_ready,
      'rpc_acl_ready', v_rpc_acl_ready
    ),
    'current_counts', pg_catalog.jsonb_build_object(
      'external_contact2sale_leads', (
        select pg_catalog.count(*)
        from public.leads as lead
        where lead.organization_id = p_organization_id
          and lead.external_source = 'contact2sale'
      ),
      'suppressed_historical_leads', (
        select pg_catalog.count(*)
        from public.leads as lead
        where lead.organization_id = p_organization_id
          and lead.operational_effects_suppressed = true
      ),
      'ledger_records', (
        select pg_catalog.count(*)
        from private.historical_lead_import_ledger as ledger
        where ledger.organization_id = p_organization_id
          and ledger.source_system = 'contact2sale'
      ),
      'effect_proof_sink_count', v_effect_sink_count
    ),
    'scope_note',
      'Database preflight; pipeline/stage/owner and payload checks run atomically in each apply call.'
  );

  return v_result || pg_catalog.jsonb_build_object(
    'proof_sha256', private.canonical_jsonb_sha256(v_result)
  );
end;
$$;

revoke all on function public.preflight_historical_lead_import(
  uuid,
  uuid,
  text
) from public, anon, authenticated, service_role;
grant execute on function public.preflight_historical_lead_import(
  uuid,
  uuid,
  text
) to service_role;

comment on function public.preflight_historical_lead_import(uuid, uuid, text) is
  'Read-only service-role preflight for the historical import database boundary.';

do $historical_import_readback$
declare
  v_import_definition text;
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint as constraint_state
    where constraint_state.conrelid = 'public.leads'::regclass
      and constraint_state.conname =
        'leads_external_identity_shape_check_v2'
      and constraint_state.convalidated
  ) or not exists (
    select 1
    from pg_catalog.pg_constraint as constraint_state
    where constraint_state.conrelid = 'public.leads'::regclass
      and constraint_state.conname =
        'leads_historical_effect_suppression_shape_check'
      and constraint_state.convalidated
  ) then
    raise exception 'historical_import_lead_constraint_readback_failed';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_index as index_state
    where index_state.indexrelid =
      pg_catalog.to_regclass('public.leads_org_external_identity_unique')
      and index_state.indrelid = 'public.leads'::regclass
      and index_state.indisunique
      and index_state.indisready
      and index_state.indisvalid
  ) then
    raise exception 'historical_import_external_identity_index_readback_failed';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_trigger as trigger_state
    where trigger_state.tgrelid = 'public.leads'::regclass
      and trigger_state.tgname =
        'enforce_lead_intake_identity_before_write'
      and trigger_state.tgenabled in ('O', 'A')
      and not trigger_state.tgisinternal
      and pg_catalog.pg_get_triggerdef(trigger_state.oid, true) like
        '%external_source%'
      and pg_catalog.pg_get_triggerdef(trigger_state.oid, true) like
        '%external_source_id%'
      and pg_catalog.pg_get_triggerdef(trigger_state.oid, true) like
        '%operational_effects_suppressed%'
      and pg_catalog.pg_get_triggerdef(trigger_state.oid, true) like
        '%historical_imported_at%'
  ) then
    raise exception 'historical_import_identity_trigger_readback_failed';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_trigger as trigger_state
    where trigger_state.tgname in (
      'trg_stop_redistribution_on_stage_move',
      'trg_reserve_managed_whatsapp_distribution_auto_reply',
      'trg_enqueue_managed_whatsapp_auto_reply'
    )
      and not trigger_state.tgisinternal
  ) then
    raise exception 'historical_import_must_not_resurrect_absent_triggers';
  end if;

  if pg_catalog.pg_get_functiondef(
       'public.get_sla_pending_leads()'::regprocedure
     ) not like '%operational_effects_suppressed%'
     or pg_catalog.pg_get_functiondef(
       'public.enqueue_due_automation_inactivity(integer)'::regprocedure
     ) not like '%operational_effects_suppressed%' then
    raise exception 'historical_import_periodic_scanner_readback_failed';
  end if;

  if not pg_catalog.has_function_privilege(
       'service_role',
       'public.import_historical_lead_batch(uuid,uuid,jsonb)',
       'execute'
     )
     or pg_catalog.has_function_privilege(
       'anon',
       'public.import_historical_lead_batch(uuid,uuid,jsonb)',
       'execute'
     )
     or pg_catalog.has_function_privilege(
       'authenticated',
       'public.import_historical_lead_batch(uuid,uuid,jsonb)',
       'execute'
     )
     or pg_catalog.has_function_privilege(
       'service_role',
       'private.import_historical_lead_batch(uuid,uuid,jsonb)',
       'execute'
     )
     or not pg_catalog.has_function_privilege(
       'service_role',
       'public.preflight_historical_lead_import(uuid,uuid,text)',
       'execute'
     )
     or pg_catalog.has_function_privilege(
       'anon',
       'public.preflight_historical_lead_import(uuid,uuid,text)',
       'execute'
     )
     or pg_catalog.has_function_privilege(
       'authenticated',
       'public.preflight_historical_lead_import(uuid,uuid,text)',
       'execute'
     ) then
    raise exception 'historical_import_rpc_acl_readback_failed';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_proc as function_state
    cross join lateral pg_catalog.aclexplode(coalesce(
      function_state.proacl,
      pg_catalog.acldefault('f', function_state.proowner)
    )) as privilege
    where function_state.oid in (
      'public.import_historical_lead_batch(uuid,uuid,jsonb)'::regprocedure,
      'public.preflight_historical_lead_import(uuid,uuid,text)'::regprocedure
    )
      and privilege.grantee = 0
      and privilege.privilege_type = 'EXECUTE'
  ) then
    raise exception 'historical_import_public_execute_readback_failed';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc as function_state
    where function_state.oid =
        'public.import_historical_lead_batch(uuid,uuid,jsonb)'::regprocedure
      and function_state.prosecdef
      and function_state.proconfig = array['search_path=""']::text[]
  ) or not exists (
    select 1
    from pg_catalog.pg_proc as function_state
    where function_state.oid =
        'public.preflight_historical_lead_import(uuid,uuid,text)'::regprocedure
      and function_state.prosecdef
      and function_state.proconfig = array['search_path=""']::text[]
  ) then
    raise exception 'historical_import_rpc_security_readback_failed';
  end if;

  if (
    select pg_catalog.count(*)
    from pg_catalog.pg_class as relation
    where relation.oid in (
      'private.historical_lead_import_contexts'::regclass,
      'private.historical_lead_import_ledger'::regclass
    )
      and relation.relrowsecurity
  ) <> 2 then
    raise exception 'historical_import_private_rls_readback_failed';
  end if;

  v_import_definition := pg_catalog.pg_get_functiondef(
    'private.import_historical_lead_batch(uuid,uuid,jsonb)'::regprocedure
  );
  if v_import_definition not like '%historical_import_records_hash_mismatch%'
     or v_import_definition not like '%insert into public.activities%'
     or v_import_definition like '%insert into public.lead_timeline_events%'
     or v_import_definition not like '%historical_import_side_effect_detected%'
     or v_import_definition not like '%effect_proof%'
     or v_import_definition like '%session_replication_role%' then
    raise exception 'historical_import_apply_definition_readback_failed';
  end if;
end;
$historical_import_readback$;

commit;
