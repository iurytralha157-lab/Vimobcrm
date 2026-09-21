-- Preserve unknown historical stage clocks instead of replacing them with the
-- database wall clock.  The first C2S canary/full import exposed that the
-- regular pipeline defaulting trigger also assigns stage_entered_at := now().
--
-- This forward-only repair guards that trigger for the same capability-bound,
-- durably suppressed import path and reconciles the four already imported C2S
-- rows whose source provenance explicitly says the timestamp is unknown.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '5min';

do $historical_stage_clock_prerequisites$
begin
  if pg_catalog.to_regclass('public.leads') is null
     or pg_catalog.to_regclass(
       'private.historical_lead_import_ledger'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.ensure_lead_has_pipeline()'
     ) is null
     or pg_catalog.to_regprocedure(
       'private.historical_import_effects_suppressed()'
     ) is null
     or pg_catalog.to_regprocedure(
       'private.historical_import_effect_counts(uuid,uuid[],uuid[])'
     ) is null
     or pg_catalog.to_regprocedure(
       'private.historical_import_effect_delta(jsonb,jsonb)'
     ) is null
     or pg_catalog.to_regprocedure(
       'private.canonical_jsonb_sha256(jsonb)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.update_updated_at_column()'
     ) is null then
    raise exception using
      errcode = '55000',
      message = 'historical_stage_clock_required_contract_missing';
  end if;
end;
$historical_stage_clock_prerequisites$;

drop trigger if exists tr_ensure_lead_pipeline on public.leads;
create trigger tr_ensure_lead_pipeline
before insert on public.leads
for each row
when (
  not private.historical_import_effects_suppressed()
  and new.operational_effects_suppressed = false
)
execute function public.ensure_lead_has_pipeline();

do $historical_stage_clock_reconcile$
declare
  v_organization_id constant uuid :=
    '002c6b70-239d-4d32-a270-0dec3fbb6b17'::uuid;
  v_archived_stage_id constant uuid :=
    '25352e78-0a63-4301-836e-ec37312e6840'::uuid;
  v_lead_ids constant uuid[] := array[
    '5e1f8a3c-b2d2-5fd7-b14a-3850e9363746'::uuid,
    '3c4bfc36-e757-5803-90be-60f60d766495'::uuid,
    '22bb2a76-d8c4-56e7-baf1-75401586b410'::uuid,
    'facec300-80d7-55d5-84a1-8c8d2fca8d39'::uuid
  ];
  v_target_count integer;
  v_non_null_count integer;
  v_updated_count integer := 0;
  v_effect_before jsonb;
  v_effect_after jsonb;
  v_effect_delta jsonb;
begin
  -- The regular updated_at trigger would replace the imported source clock
  -- while this repair clears stage_entered_at.  Take a write-conflicting lock
  -- and require the exact ordinary trigger state before temporarily disabling
  -- it below.  Any failure rolls the DDL and data change back together.
  lock table public.leads in share row exclusive mode;

  if (
    select pg_catalog.count(*)
    from pg_catalog.pg_trigger as trigger_state
    join pg_catalog.pg_proc as trigger_function
      on trigger_function.oid = trigger_state.tgfoid
    join pg_catalog.pg_namespace as function_schema
      on function_schema.oid = trigger_function.pronamespace
    where trigger_state.tgrelid = 'public.leads'::regclass
      and trigger_state.tgname = 'update_leads_updated_at'
      and trigger_state.tgenabled = 'O'
      and not trigger_state.tgisinternal
      and function_schema.nspname = 'public'
      and trigger_function.proname = 'update_updated_at_column'
  ) <> 1 then
    raise exception using
      errcode = '55000',
      message = 'historical_stage_clock_updated_at_trigger_unexpected';
  end if;

  with expected(lead_id, source_id, payload_sha256) as (
    values
      (
        '5e1f8a3c-b2d2-5fd7-b14a-3850e9363746'::uuid,
        '68449787'::text,
        'b7de69f37637620059d6d78e71404383217917a2dfbd19c15bc3dc505c14c07a'::text
      ),
      (
        '3c4bfc36-e757-5803-90be-60f60d766495'::uuid,
        '68750820'::text,
        '3f9a6dd53431f55fa3c920e6cbb1c7cd9d6288eb088ded7f889d88198fa0edea'::text
      ),
      (
        '22bb2a76-d8c4-56e7-baf1-75401586b410'::uuid,
        '69463731'::text,
        '43fb82f1778ae7f75f1bdcabb9f6c17bf736e08b332cab036ad7e3d61c783b1b'::text
      ),
      (
        'facec300-80d7-55d5-84a1-8c8d2fca8d39'::uuid,
        '69505080'::text,
        '83df34ea08202685c91335d8b317642cee9f81a9f2e749b0a85eef14f754a22b'::text
      )
  )
  select
    pg_catalog.count(*),
    pg_catalog.count(*) filter (
      where lead.stage_entered_at is not null
    )
  into v_target_count, v_non_null_count
  from expected
  join public.leads as lead
    on lead.id = expected.lead_id
   and lead.organization_id = v_organization_id
   and lead.external_source_id = expected.source_id
  join private.historical_lead_import_ledger as ledger
    on ledger.organization_id = lead.organization_id
   and ledger.source_system = 'contact2sale'
   and ledger.entity_type = 'lead'
   and ledger.source_id = expected.source_id
   and ledger.target_id = expected.lead_id
   and ledger.lead_id = expected.lead_id
   and ledger.payload_sha256 = expected.payload_sha256
   and private.canonical_jsonb_sha256(ledger.payload) =
     expected.payload_sha256
  where lead.organization_id = v_organization_id
    and lead.external_source = 'contact2sale'
    and lead.operational_effects_suppressed = true
    and lead.historical_imported_at is not null
    and lead.stage_id = v_archived_stage_id
    and lead.deal_status = 'lost'
    and lead.lost_at is null
    and lead.metadata #>>
      '{timestamp_provenance,stage_entered_at,rule}' =
        'unresolved_no_stage_entered_timestamp_evidence'
    and lead.metadata #>
      '{timestamp_provenance,stage_entered_at,value}' = 'null'::jsonb;

  if v_target_count <> 4 then
    raise exception using
      errcode = '23514',
      message = 'historical_stage_clock_target_readback_failed';
  end if;

  if v_non_null_count not in (0, 4) then
    raise exception using
      errcode = '23514',
      message = 'historical_stage_clock_partial_state_detected';
  end if;

  v_effect_before := private.historical_import_effect_counts(
    v_organization_id,
    v_lead_ids,
    '{}'::uuid[]
  );

  if v_non_null_count = 4 then
    execute 'alter table public.leads disable trigger update_leads_updated_at';

    if not exists (
      select 1
      from pg_catalog.pg_trigger as trigger_state
      where trigger_state.tgrelid = 'public.leads'::regclass
        and trigger_state.tgname = 'update_leads_updated_at'
        and trigger_state.tgenabled = 'D'
        and not trigger_state.tgisinternal
    ) then
      raise exception using
        errcode = '55000',
        message = 'historical_stage_clock_updated_at_trigger_disable_failed';
    end if;

    with expected(lead_id, source_id, payload_sha256) as (
      values
        (
          '5e1f8a3c-b2d2-5fd7-b14a-3850e9363746'::uuid,
          '68449787'::text,
          'b7de69f37637620059d6d78e71404383217917a2dfbd19c15bc3dc505c14c07a'::text
        ),
        (
          '3c4bfc36-e757-5803-90be-60f60d766495'::uuid,
          '68750820'::text,
          '3f9a6dd53431f55fa3c920e6cbb1c7cd9d6288eb088ded7f889d88198fa0edea'::text
        ),
        (
          '22bb2a76-d8c4-56e7-baf1-75401586b410'::uuid,
          '69463731'::text,
          '43fb82f1778ae7f75f1bdcabb9f6c17bf736e08b332cab036ad7e3d61c783b1b'::text
        ),
        (
          'facec300-80d7-55d5-84a1-8c8d2fca8d39'::uuid,
          '69505080'::text,
          '83df34ea08202685c91335d8b317642cee9f81a9f2e749b0a85eef14f754a22b'::text
        )
    )
    update public.leads as lead
    set stage_entered_at = null
    from expected,
      private.historical_lead_import_ledger as ledger
    where lead.organization_id = v_organization_id
      and lead.id = expected.lead_id
      and lead.external_source = 'contact2sale'
      and lead.external_source_id = expected.source_id
      and lead.operational_effects_suppressed = true
      and lead.historical_imported_at is not null
      and lead.stage_id = v_archived_stage_id
      and lead.deal_status = 'lost'
      and lead.lost_at is null
      and lead.stage_entered_at is not null
      and lead.metadata #>>
        '{timestamp_provenance,stage_entered_at,rule}' =
          'unresolved_no_stage_entered_timestamp_evidence'
      and lead.metadata #>
        '{timestamp_provenance,stage_entered_at,value}' = 'null'::jsonb
      and ledger.organization_id = lead.organization_id
      and ledger.source_system = 'contact2sale'
      and ledger.entity_type = 'lead'
      and ledger.source_id = expected.source_id
      and ledger.target_id = expected.lead_id
      and ledger.lead_id = expected.lead_id
      and ledger.payload_sha256 = expected.payload_sha256
      and private.canonical_jsonb_sha256(ledger.payload) =
        expected.payload_sha256;

    get diagnostics v_updated_count = row_count;
    if v_updated_count <> 4 then
      raise exception using
        errcode = '23514',
        message = 'historical_stage_clock_update_count_mismatch';
    end if;

    execute 'alter table public.leads enable trigger update_leads_updated_at';

    if not exists (
      select 1
      from pg_catalog.pg_trigger as trigger_state
      where trigger_state.tgrelid = 'public.leads'::regclass
        and trigger_state.tgname = 'update_leads_updated_at'
        and trigger_state.tgenabled = 'O'
        and not trigger_state.tgisinternal
    ) then
      raise exception using
        errcode = '55000',
        message = 'historical_stage_clock_updated_at_trigger_enable_failed';
    end if;
  end if;

  v_effect_after := private.historical_import_effect_counts(
    v_organization_id,
    v_lead_ids,
    '{}'::uuid[]
  );
  v_effect_delta := private.historical_import_effect_delta(
    v_effect_before,
    v_effect_after
  );

  if exists (
    select 1
    from pg_catalog.jsonb_each_text(v_effect_delta) as effect(key, value)
    where effect.value::bigint <> 0
  ) then
    raise exception using
      errcode = '23514',
      message = 'historical_stage_clock_side_effect_detected',
      detail = v_effect_delta::text;
  end if;

  if (
    with expected(lead_id, source_id, payload_sha256) as (
      values
        (
          '5e1f8a3c-b2d2-5fd7-b14a-3850e9363746'::uuid,
          '68449787'::text,
          'b7de69f37637620059d6d78e71404383217917a2dfbd19c15bc3dc505c14c07a'::text
        ),
        (
          '3c4bfc36-e757-5803-90be-60f60d766495'::uuid,
          '68750820'::text,
          '3f9a6dd53431f55fa3c920e6cbb1c7cd9d6288eb088ded7f889d88198fa0edea'::text
        ),
        (
          '22bb2a76-d8c4-56e7-baf1-75401586b410'::uuid,
          '69463731'::text,
          '43fb82f1778ae7f75f1bdcabb9f6c17bf736e08b332cab036ad7e3d61c783b1b'::text
        ),
        (
          'facec300-80d7-55d5-84a1-8c8d2fca8d39'::uuid,
          '69505080'::text,
          '83df34ea08202685c91335d8b317642cee9f81a9f2e749b0a85eef14f754a22b'::text
        )
    )
    select pg_catalog.count(*)
    from expected
    join public.leads as lead
      on lead.id = expected.lead_id
     and lead.organization_id = v_organization_id
     and lead.external_source_id = expected.source_id
    join private.historical_lead_import_ledger as ledger
      on ledger.organization_id = lead.organization_id
     and ledger.source_id = expected.source_id
     and ledger.target_id = lead.id
     and ledger.lead_id = expected.lead_id
     and ledger.entity_type = 'lead'
     and ledger.source_system = 'contact2sale'
     and ledger.payload_sha256 = expected.payload_sha256
     and private.canonical_jsonb_sha256(ledger.payload) =
       expected.payload_sha256
    where lead.organization_id = v_organization_id
      and lead.stage_entered_at is null
      and lead.updated_at = (ledger.payload->>'updated_at')::timestamptz
      and (
        ledger.payload->'stage_entered_at' is null
        or ledger.payload->'stage_entered_at' = 'null'::jsonb
      )
  ) <> 4 then
    raise exception using
      errcode = '23514',
      message = 'historical_stage_clock_final_readback_failed';
  end if;
end;
$historical_stage_clock_reconcile$;

do $historical_stage_clock_trigger_readback$
begin
  if not exists (
    select 1
    from pg_catalog.pg_trigger as trigger_state
    join pg_catalog.pg_proc as trigger_function
      on trigger_function.oid = trigger_state.tgfoid
    join pg_catalog.pg_namespace as function_schema
      on function_schema.oid = trigger_function.pronamespace
    where trigger_state.tgrelid = 'public.leads'::regclass
      and trigger_state.tgname = 'update_leads_updated_at'
      and trigger_state.tgenabled = 'O'
      and not trigger_state.tgisinternal
      and function_schema.nspname = 'public'
      and trigger_function.proname = 'update_updated_at_column'
  ) then
    raise exception using
      errcode = '23514',
      message = 'historical_stage_clock_updated_at_trigger_readback_failed';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_trigger as trigger_state
    where trigger_state.tgrelid = 'public.leads'::regclass
      and trigger_state.tgname = 'tr_ensure_lead_pipeline'
      and trigger_state.tgenabled in ('O', 'A')
      and not trigger_state.tgisinternal
      and pg_catalog.pg_get_triggerdef(trigger_state.oid, true) like
        '%historical_import_effects_suppressed%'
      and pg_catalog.pg_get_triggerdef(trigger_state.oid, true) like
        '%operational_effects_suppressed%'
      and pg_catalog.pg_get_triggerdef(trigger_state.oid, true) like
        '%ensure_lead_has_pipeline%'
  ) then
    raise exception using
      errcode = '23514',
      message = 'historical_stage_clock_trigger_readback_failed';
  end if;
end;
$historical_stage_clock_trigger_readback$;

commit;
