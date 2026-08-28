begin;

create extension if not exists pgtap with schema extensions;
select plan(54);

select is(
  (
    select count(*)
    from unnest(array[
      'lead_funnel_events',
      'meta_crm_event_outbox'
    ]) as expected(table_name)
    where to_regclass(format('public.%I', expected.table_name)) is not null
  ),
  2::bigint,
  'funnel facts and Meta CRM outbox exist'
);

select ok(
  to_regclass('public.lead_entry_events_org_occurred_idx') is not null,
  'Meta acquisition cohorts have an organization/time index'
);

select is(
  (
    select count(*)
    from pg_class as relation
    join pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = any(array[
        'lead_funnel_events',
        'meta_crm_event_outbox'
      ])
      and relation.relrowsecurity
  ),
  2::bigint,
  'RLS is enabled on both backend-only tables'
);

select is(
  (
    select count(*)
    from pg_class as relation
    join pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = any(array[
        'lead_funnel_events',
        'meta_crm_event_outbox'
      ])
      and relation.relforcerowsecurity
  ),
  2::bigint,
  'RLS is forced on both backend-only tables'
);

select is(
  (
    select count(*)
    from pg_policies
    where schemaname = 'public'
      and tablename = any(array[
        'lead_funnel_events',
        'meta_crm_event_outbox'
      ])
  ),
  0::bigint,
  'backend-only funnel tables expose no Data API policy'
);

select ok(
  (
    select bool_and(
      not has_table_privilege(
        'anon',
        format('public.%I', target.table_name),
        privilege.name
      )
    )
    from unnest(array[
      'lead_funnel_events',
      'meta_crm_event_outbox'
    ]) as target(table_name)
    cross join unnest(array[
      'select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger'
    ]) as privilege(name)
  ),
  'anonymous clients have no funnel/outbox privilege'
);

select ok(
  (
    select bool_and(
      not has_table_privilege(
        'authenticated',
        format('public.%I', target.table_name),
        privilege.name
      )
    )
    from unnest(array[
      'lead_funnel_events',
      'meta_crm_event_outbox'
    ]) as target(table_name)
    cross join unnest(array[
      'select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger'
    ]) as privilege(name)
  ),
  'authenticated clients have no funnel/outbox privilege'
);

select ok(
  (
    select bool_and(
      not has_table_privilege(
        'service_role',
        format('public.%I', target.table_name),
        privilege.name
      )
    )
    from unnest(array[
      'lead_funnel_events',
      'meta_crm_event_outbox'
    ]) as target(table_name)
    cross join unnest(array['select', 'insert', 'update', 'delete']) as privilege(name)
  ),
  'service role cannot bypass the canonical Go backend'
);

select is(
  (
    select udt_name
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'meta_integrations'
      and column_name = 'crm_dataset_access_token_secret_ref'
  ),
  'uuid',
  'CRM Dataset credential uses a Vault UUID reference'
);

select is(
  (
    select count(*)
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'meta_integrations_public'
      and column_name = any(array[
        'crm_dataset_id',
        'crm_dataset_name',
        'conversion_feedback_enabled',
        'conversion_feedback_status',
        'conversion_feedback_last_sent_at',
        'conversion_feedback_last_validated_at',
        'conversion_feedback_last_error'
      ])
  ),
  7::bigint,
  'browser projection exposes only safe conversion-feedback state'
);

select is(
  (
    select count(*)
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'meta_integrations_public'
      and column_name = any(array[
        'crm_dataset_access_token',
        'crm_dataset_access_token_secret_ref'
      ])
  ),
  0::bigint,
  'browser projection never exposes CRM Dataset credentials'
);

select ok(
  (
    select bool_and(
      not has_column_privilege(
        'authenticated',
        'public.meta_integrations',
        safe_column.name,
        'select'
      )
    )
    from unnest(array[
      'crm_dataset_id',
      'crm_dataset_name',
      'conversion_feedback_enabled',
      'conversion_feedback_status',
      'conversion_feedback_last_sent_at',
      'conversion_feedback_last_validated_at',
      'conversion_feedback_last_error'
    ]) as safe_column(name)
  )
  and not has_table_privilege(
    'authenticated',
    'public.meta_integrations_public',
    'select'
  )
  and not has_column_privilege(
    'authenticated',
    'public.meta_integrations',
    'crm_dataset_access_token_secret_ref',
    'select'
  ),
  'Meta feedback state remains BFF-only even when the projection is tokenless'
);

select ok(
  to_regclass('public.stages_one_qualified_per_pipeline_idx') is not null,
  'partial unique index protects qualification-stage selection'
);

select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'public.stages'::regclass
      and conname = 'stages_qualified_is_operational_check'
      and convalidated
  ),
  'qualified stage must remain active and non-terminal'
);

select ok(
  not has_function_privilege(
    'anon',
    'private.enqueue_meta_crm_funnel_event(uuid)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'private.enqueue_meta_crm_funnel_event(uuid)',
    'execute'
  )
  and not has_function_privilege(
    'service_role',
    'private.enqueue_meta_crm_funnel_event(uuid)',
    'execute'
  ),
  'Data API roles cannot call the private enqueue function'
);

select is(
  (
    select count(*)
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'meta_crm_event_outbox'
      and column_name = any(array['event_sequence', 'test_event_code'])
  ),
  2::bigint,
  'outbox stores its funnel sequence and per-delivery test code'
);

select is(
  (
    select is_generated
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'meta_crm_event_outbox'
      and column_name = 'event_sequence'
  ),
  'ALWAYS',
  'outbox sequence is derived from the immutable event kind'
);

select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'public.meta_crm_event_outbox'::regclass
      and conname = 'meta_crm_event_outbox_test_event_code_check'
      and convalidated
  ),
  'per-delivery test codes reject blank, untrimmed, oversized, or control text'
);

select ok(
  to_regclass('public.meta_crm_event_outbox_entry_sequence_status_idx') is not null,
  'predecessor checks have a tenant and lead-entry sequence index'
);

select ok(
  not has_function_privilege(
    'anon',
    'private.enqueue_recent_meta_crm_facts(uuid,uuid,text)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'private.enqueue_recent_meta_crm_facts(uuid,uuid,text)',
    'execute'
  )
  and not has_function_privilege(
    'service_role',
    'private.enqueue_recent_meta_crm_facts(uuid,uuid,text)',
    'execute'
  ),
  'Data API roles cannot request a recent-fact replay'
);

select is(
  (
    select count(*)
    from information_schema.column_privileges
    where table_schema = 'public'
      and table_name = any(array[
        'lead_funnel_events',
        'meta_crm_event_outbox'
      ])
      and grantee = any(array['PUBLIC', 'anon', 'authenticated', 'service_role'])
  ),
  0::bigint,
  'column grants cannot bypass backend-only tables'
);

insert into public.organizations (id, name)
values ('81000000-0000-4000-8000-000000000001', 'Meta feedback pgTAP');

insert into public.organization_modules (
  organization_id,
  module_name,
  is_enabled
)
values (
  '81000000-0000-4000-8000-000000000001',
  'campaigns',
  true
);

insert into public.pipelines (id, organization_id, name, position)
values (
  '81000000-0000-4000-8000-000000000010',
  '81000000-0000-4000-8000-000000000001',
  'Pipeline Meta',
  1
);

insert into public.stages (
  id,
  organization_id,
  pipeline_id,
  name,
  stage_key,
  position,
  is_qualified
)
values
  (
    '81000000-0000-4000-8000-000000000011',
    '81000000-0000-4000-8000-000000000001',
    '81000000-0000-4000-8000-000000000010',
    'Entrada',
    'entrada-meta-pgtap',
    1,
    false
  ),
  (
    '81000000-0000-4000-8000-000000000012',
    '81000000-0000-4000-8000-000000000001',
    '81000000-0000-4000-8000-000000000010',
    'Qualificado',
    'qualificado-meta-pgtap',
    2,
    true
  ),
  (
    '81000000-0000-4000-8000-000000000013',
    '81000000-0000-4000-8000-000000000001',
    '81000000-0000-4000-8000-000000000010',
    'Outra etapa',
    'outra-meta-pgtap',
    3,
    false
  );

insert into public.meta_integrations (
  id,
  organization_id,
  access_token,
  page_id,
  page_name,
  is_connected,
  crm_dataset_id,
  crm_dataset_name,
  crm_dataset_access_token,
  conversion_feedback_enabled,
  conversion_feedback_status,
  conversion_feedback_activated_at
)
values (
  '81000000-0000-4000-8000-000000000020',
  '81000000-0000-4000-8000-000000000001',
  'pgtap-page-access-token',
  '123456789012345',
  'Pagina pgTAP',
  true,
  '987654321098765',
  'Dataset pgTAP',
  'pgtap-crm-dataset-access-token',
  true,
  'active',
  now() - interval '1 minute'
);

select ok(
  not has_table_privilege(
    'authenticated',
    'public.meta_integrations',
    'update'
  ),
  'authenticated administrators cannot bypass the backend feedback contract'
);

select is(
  (
    select crm_dataset_access_token
    from public.meta_integrations
    where id = '81000000-0000-4000-8000-000000000020'
  ),
  null::text,
  'CRM Dataset plaintext is cleared before row storage'
);

select is(
  (
    select secret.decrypted_secret
    from public.meta_integrations as integration
    join vault.decrypted_secrets as secret
      on secret.id = integration.crm_dataset_access_token_secret_ref
    where integration.id = '81000000-0000-4000-8000-000000000020'
  ),
  'pgtap-crm-dataset-access-token',
  'CRM Dataset token is recoverable only through Vault on the backend'
);

select throws_ok(
  $$
    update public.meta_integrations
    set crm_dataset_id = '887654321098765',
        crm_dataset_access_token = null
    where id = '81000000-0000-4000-8000-000000000020'
  $$,
  '23514',
  'Changing the CRM Dataset requires a new access token',
  'changing a CRM Dataset cannot preserve the previous destination token'
);

select is(
  (
    select conversion_feedback_status
    from public.meta_integrations_public
    where id = '81000000-0000-4000-8000-000000000020'
  ),
  'active',
  'safe projection reports active feedback without returning its token'
);

select lives_ok(
  $$
    update public.stages
    set name = 'Qualificado principal'
    where id = '81000000-0000-4000-8000-000000000012'
  $$,
  'ordinary edits preserve the selected qualification stage'
);

select throws_ok(
  $$
    update public.stages
    set is_qualified = true
    where id = '81000000-0000-4000-8000-000000000013'
  $$,
  '23505',
  null,
  'a second qualified stage in the same pipeline is rejected'
);

update public.stages
set is_qualified = false
where id = '81000000-0000-4000-8000-000000000012';

select throws_ok(
  $$
    update public.stages
    set is_won = true, is_qualified = true
    where id = '81000000-0000-4000-8000-000000000013'
  $$,
  '23514',
  null,
  'won/lost/inactive stages cannot be qualification stages'
);

update public.stages
set is_qualified = true
where id = '81000000-0000-4000-8000-000000000012';

insert into public.leads (
  id,
  organization_id,
  pipeline_id,
  stage_id,
  name,
  source,
  deal_status,
  stage_entered_at,
  valor_interesse
)
values (
  '81000000-0000-4000-8000-000000000030',
  '81000000-0000-4000-8000-000000000001',
  '81000000-0000-4000-8000-000000000010',
  '81000000-0000-4000-8000-000000000011',
  'Lead Meta pgTAP',
  'meta',
  'open',
  now(),
  123450
);

update public.lead_entry_events
set provider = 'meta',
    provider_event_id = '1234567890123456',
    page_id = '123456789012345',
    metadata = jsonb_build_object(
      'integration_id',
      '81000000-0000-4000-8000-000000000020'
    )
where organization_id = '81000000-0000-4000-8000-000000000001'
  and lead_id = '81000000-0000-4000-8000-000000000030'
  and entry_type = 'initial';

select is(
  (
    select count(*)
    from public.lead_funnel_events
    where lead_id = '81000000-0000-4000-8000-000000000030'
      and event_kind = 'initial'
  ),
  1::bigint,
  'hydrating the leadgen id creates one immutable initial event'
);

select is(
  (
    select count(*)
    from public.meta_crm_event_outbox
    where lead_id = '81000000-0000-4000-8000-000000000030'
      and event_kind = 'initial'
  ),
  1::bigint,
  'initial Meta event is enqueued exactly once'
);

select is(
  (
    select test_event_code
    from public.meta_crm_event_outbox
    where lead_id = '81000000-0000-4000-8000-000000000030'
      and event_kind = 'initial'
  ),
  null::text,
  'ordinary automatic delivery never inherits a global test event code'
);

delete from public.meta_crm_event_outbox
where lead_id = '81000000-0000-4000-8000-000000000030'
  and event_kind = 'initial';

update public.lead_funnel_events
set metadata = metadata || '{"historical_cutover":true}'::jsonb
where lead_id = '81000000-0000-4000-8000-000000000030'
  and event_kind = 'initial';

update public.lead_entry_events
set metadata = metadata || '{"hydration_probe":true}'::jsonb
where organization_id = '81000000-0000-4000-8000-000000000001'
  and lead_id = '81000000-0000-4000-8000-000000000030'
  and entry_type = 'initial';

select is(
  (
    select count(*)
    from public.meta_crm_event_outbox
    where lead_id = '81000000-0000-4000-8000-000000000030'
      and event_kind = 'initial'
  ),
  0::bigint,
  'historical cutover facts cannot be re-enqueued by later entry hydration'
);

update public.leads
set stage_id = '81000000-0000-4000-8000-000000000012',
    stage_entered_at = now(),
    updated_at = now()
where id = '81000000-0000-4000-8000-000000000030';

select is(
  (
    select count(*)
    from public.lead_funnel_events
    where lead_id = '81000000-0000-4000-8000-000000000030'
      and event_kind = 'qualified'
  ),
  1::bigint,
  'entering the selected stage records one immutable qualification'
);

select is(
  (
    select count(*)
    from public.meta_crm_event_outbox
    where lead_id = '81000000-0000-4000-8000-000000000030'
      and event_kind = 'qualified'
      and event_name = 'VimobQualifiedLead'
  ),
  0::bigint,
  'a later transition is not queued when its historical initial delivery is absent'
);

update public.leads
set deal_status = 'won',
    won_at = now(),
    updated_at = now()
where id = '81000000-0000-4000-8000-000000000030';

select is(
  (
    select count(*)
    from public.lead_funnel_events
    where lead_id = '81000000-0000-4000-8000-000000000030'
      and event_kind = 'converted'
  ),
  1::bigint,
  'marking the lead as won records one immutable conversion'
);

select is(
  (
    select (metadata->>'value_snapshot')::numeric
    from public.lead_funnel_events
    where lead_id = '81000000-0000-4000-8000-000000000030'
      and event_kind = 'converted'
  ),
  123450::numeric,
  'conversion freezes the won value used by historical marketing analytics'
);

select is(
  (
    select count(*)
    from public.meta_crm_event_outbox
    where lead_id = '81000000-0000-4000-8000-000000000030'
      and event_kind = 'converted'
      and event_name = 'VimobConvertedLead'
  ),
  0::bigint,
  'conversion is not left pending forever when its predecessor deliveries are absent'
);

update public.lead_funnel_events as qualified
set occurred_at = entry.occurred_at + interval '2 microseconds'
from public.lead_entry_events as entry
where qualified.lead_id = '81000000-0000-4000-8000-000000000030'
  and qualified.event_kind = 'qualified'
  and entry.id = qualified.lead_entry_event_id
  and entry.organization_id = qualified.organization_id;

update public.lead_funnel_events as converted
set occurred_at = entry.occurred_at + interval '1 microsecond'
from public.lead_entry_events as entry
where converted.lead_id = '81000000-0000-4000-8000-000000000030'
  and converted.event_kind = 'converted'
  and entry.id = converted.lead_entry_event_id
  and entry.organization_id = converted.organization_id;

select is(
  private.enqueue_recent_meta_crm_facts(
    '81000000-0000-4000-8000-000000000001',
    '81000000-0000-4000-8000-000000000020',
    'TEST-CRM-123'
  ),
  2,
  'explicit replay queues only the valid prefix of an inconsistent historical timeline'
);

select is(
  (
    select count(*)
    from public.meta_crm_event_outbox
    where lead_id = '81000000-0000-4000-8000-000000000030'
      and event_kind = 'converted'
  ),
  0::bigint,
  'explicit replay excludes conversion recorded before qualification'
);

update public.lead_funnel_events as converted
set occurred_at = qualified.occurred_at
from public.lead_funnel_events as qualified
where converted.lead_id = '81000000-0000-4000-8000-000000000030'
  and converted.event_kind = 'converted'
  and qualified.lead_id = converted.lead_id
  and qualified.organization_id = converted.organization_id
  and qualified.lead_entry_event_id = converted.lead_entry_event_id
  and qualified.event_kind = 'qualified';

select is(
  private.enqueue_recent_meta_crm_facts(
    '81000000-0000-4000-8000-000000000001',
    '81000000-0000-4000-8000-000000000020',
    'TEST-CRM-123'
  ),
  1,
  'replay queues the remaining conversion after its real timeline is valid'
);

select is(
  (
    select test_event_code
    from public.meta_crm_event_outbox
    where lead_id = '81000000-0000-4000-8000-000000000030'
      and event_kind = 'initial'
  ),
  'TEST-CRM-123',
  'test code is snapshotted only onto the row created by the explicit replay'
);

select is(
  (
    select count(*)
    from public.meta_crm_event_outbox as outbox
    join public.lead_funnel_events as funnel
      on funnel.id = outbox.funnel_event_id
     and funnel.organization_id = outbox.organization_id
    where outbox.lead_id = '81000000-0000-4000-8000-000000000030'
      and outbox.event_time is distinct from funnel.occurred_at
  ),
  0::bigint,
  'explicit replay preserves every real funnel timestamp'
);

select is(
  (
    select count(*)
    from public.meta_crm_event_outbox
    where lead_id = '81000000-0000-4000-8000-000000000030'
      and test_event_code is not null
  ),
  3::bigint,
  'a replay test code is limited to rows created by explicit replay requests'
);

select is(
  private.enqueue_recent_meta_crm_facts(
    '81000000-0000-4000-8000-000000000001',
    '81000000-0000-4000-8000-000000000020',
    'TEST-CRM-123'
  ),
  0,
  'repeating an explicit replay is idempotent'
);

select throws_ok(
  $$
    select private.enqueue_recent_meta_crm_facts(
      '81000000-0000-4000-8000-000000000099',
      '81000000-0000-4000-8000-000000000020',
      null
    )
  $$,
  '23514',
  'Meta conversion feedback must be active before replaying recent facts',
  'recent-fact replay cannot cross the requested organization boundary'
);

update public.leads
set deal_status = 'won', updated_at = now()
where id = '81000000-0000-4000-8000-000000000030';

select is(
  (
    select count(*)
    from public.lead_funnel_events
    where lead_id = '81000000-0000-4000-8000-000000000030'
  ),
  3::bigint,
  'repeating the won state cannot duplicate funnel events'
);

update public.stages
set is_qualified = false
where id = '81000000-0000-4000-8000-000000000012';

update public.stages
set is_qualified = true
where id = '81000000-0000-4000-8000-000000000011';

select is(
  (
    select count(*)
    from public.lead_funnel_events
    where lead_id = '81000000-0000-4000-8000-000000000030'
      and event_kind = 'qualified'
      and stage_id = '81000000-0000-4000-8000-000000000012'
  ),
  1::bigint,
  'changing configuration does not rewrite historical qualification facts'
);

insert into public.leads (
  id,
  organization_id,
  pipeline_id,
  stage_id,
  name,
  source,
  deal_status,
  stage_entered_at
)
values (
  '81000000-0000-4000-8000-000000000032',
  '81000000-0000-4000-8000-000000000001',
  '81000000-0000-4000-8000-000000000010',
  '81000000-0000-4000-8000-000000000013',
  'Lead com reentrada Meta',
  'meta',
  'open',
  now() - interval '2 hours'
);

update public.lead_entry_events
set provider = 'meta',
    provider_event_id = '3234567890123456',
    occurred_at = now() - interval '2 hours',
    created_at = now() - interval '2 hours',
    page_id = '123456789012345',
    metadata = jsonb_build_object(
      'integration_id',
      '81000000-0000-4000-8000-000000000020'
    )
where organization_id = '81000000-0000-4000-8000-000000000001'
  and lead_id = '81000000-0000-4000-8000-000000000032'
  and entry_type = 'initial';

insert into public.lead_entry_events (
  lead_id,
  organization_id,
  entry_type,
  source,
  provider,
  provider_event_id,
  occurred_at,
  is_countable,
  page_id,
  metadata,
  created_at
)
values (
  '81000000-0000-4000-8000-000000000032',
  '81000000-0000-4000-8000-000000000001',
  'reentry',
  'facebook',
  'legacy',
  null,
  now() - interval '3 hours',
  true,
  '123456789012345',
  jsonb_build_object(
    'integration_id',
    '81000000-0000-4000-8000-000000000020'
  ),
  clock_timestamp()
);

update public.leads
set stage_id = '81000000-0000-4000-8000-000000000011',
    stage_entered_at = clock_timestamp(),
    updated_at = clock_timestamp()
where id = '81000000-0000-4000-8000-000000000032';

select is(
  (
    select count(*)
    from public.lead_funnel_events as funnel
    join public.lead_entry_events as entry
      on entry.id = funnel.lead_entry_event_id
    where funnel.lead_id = '81000000-0000-4000-8000-000000000032'
      and funnel.event_kind = 'qualified'
      and entry.provider_event_id = '3234567890123456'
  ),
  1::bigint,
  'an older Meta-like reentry preserves qualification on the latest chronological leadgen id'
);

select is(
  (
    select count(*)
    from public.lead_funnel_events as funnel
    join public.lead_entry_events as entry
      on entry.id = funnel.lead_entry_event_id
    where funnel.lead_id = '81000000-0000-4000-8000-000000000032'
      and funnel.event_kind = 'qualified'
      and entry.entry_type = 'reentry'
  ),
  0::bigint,
  'a Meta-like source without leadgen id cannot steal qualification by arriving later'
);

update public.organization_modules
set is_enabled = false
where organization_id = '81000000-0000-4000-8000-000000000001'
  and module_name = 'campaigns';

insert into public.leads (
  id,
  organization_id,
  pipeline_id,
  stage_id,
  name,
  source,
  deal_status,
  stage_entered_at
)
values (
  '81000000-0000-4000-8000-000000000031',
  '81000000-0000-4000-8000-000000000001',
  '81000000-0000-4000-8000-000000000010',
  '81000000-0000-4000-8000-000000000013',
  'Lead sem modulo',
  'meta',
  'open',
  now()
);

update public.lead_entry_events
set provider = 'meta',
    provider_event_id = '2234567890123456',
    page_id = '123456789012345',
    metadata = jsonb_build_object(
      'integration_id',
      '81000000-0000-4000-8000-000000000020'
    )
where organization_id = '81000000-0000-4000-8000-000000000001'
  and lead_id = '81000000-0000-4000-8000-000000000031'
  and entry_type = 'initial';

select is(
  (
    select count(*)
    from public.lead_funnel_events
    where lead_id = '81000000-0000-4000-8000-000000000031'
      and event_kind = 'initial'
  ),
  1::bigint,
  'internal funnel evidence remains available without the Marketing module'
);

select is(
  (
    select count(*)
    from public.meta_crm_event_outbox
    where lead_id = '81000000-0000-4000-8000-000000000031'
  ),
  0::bigint,
  'disabled Marketing module prevents advanced Meta data delivery'
);

update public.organization_modules
set is_enabled = true
where organization_id = '81000000-0000-4000-8000-000000000001'
  and module_name = 'campaigns';

update public.lead_entry_events
set metadata = metadata || '{"module_reactivation_probe":true}'::jsonb
where organization_id = '81000000-0000-4000-8000-000000000001'
  and lead_id = '81000000-0000-4000-8000-000000000031'
  and entry_type = 'initial';

select is(
  (
    select count(*)
    from public.meta_crm_event_outbox
    where lead_id = '81000000-0000-4000-8000-000000000031'
  ),
  0::bigint,
  're-enabling Marketing never backfills facts captured while the module was disabled'
);

insert into public.organization_modules (
  organization_id,
  module_name,
  is_enabled
)
values (
  '81000000-0000-4000-8000-000000000001',
  'Campaigns',
  true
);

update public.organization_modules
set is_enabled = false
where organization_id = '81000000-0000-4000-8000-000000000001'
  and module_name = 'campaigns';

select ok(
  exists (
    select 1
    from private.meta_feedback_module_activations as activation
    where activation.organization_id = '81000000-0000-4000-8000-000000000001'
  ),
  'case-variant module rows preserve Meta delivery while any campaigns module remains enabled'
);

select * from finish();
rollback;
