begin;

create extension if not exists pgtap with schema extensions;
select plan(10);

select has_table(
  'private',
  'webhook_delivery_outbox',
  'private outgoing webhook outbox exists'
);

select ok(
  exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.lead_entry_events'::regclass
      and tgname = 'zz_enqueue_outgoing_lead_webhooks'
      and not tgisinternal
  ),
  'canonical lead-entry events feed the outgoing webhook outbox'
);

insert into public.organizations (
  id,
  name,
  slug,
  is_active,
  subscription_type,
  subscription_status
) values (
  'e9710000-0000-4000-8000-000000000001',
  'Public API Webhook Outbox Test',
  'public-api-webhook-outbox-test',
  true,
  'free',
  'active'
);

insert into public.organization_modules (organization_id, module_name, is_enabled)
values
  ('e9710000-0000-4000-8000-000000000001', 'api', true),
  ('e9710000-0000-4000-8000-000000000001', 'webhooks', true)
on conflict (organization_id, module_name)
do update set is_enabled = excluded.is_enabled;

insert into public.organization_api_keys (
  id,
  organization_id,
  name,
  key_prefix,
  key_hash,
  is_active
) values (
  'e9740000-0000-4000-8000-000000000001',
  'e9710000-0000-4000-8000-000000000001',
  'Test key',
  'vimob_aaaaaaaa',
  encode(
    extensions.digest('vimob_' || repeat('a', 64), 'sha256'),
    'hex'
  ),
  true
);

select is(
  (
    select api_key.organization_id::text
    from public.organization_api_keys api_key
    join public.organizations organization
      on organization.id = api_key.organization_id
     and organization.is_active
    where api_key.key_hash = encode(
      extensions.digest('vimob_' || repeat('a', 64), 'sha256'),
      'hex'
    )
      and api_key.is_active
      and (api_key.expires_at is null or api_key.expires_at > now())
      and exists (
        select 1
        from public.organization_modules module
        where module.organization_id = api_key.organization_id
          and lower(trim(module.module_name)) = 'api'
          and module.is_enabled
      )
  ),
  'e9710000-0000-4000-8000-000000000001',
  'active API key resolves only inside its enabled tenant'
);

insert into public.webhooks_integrations (
  id,
  organization_id,
  name,
  type,
  api_token,
  webhook_url,
  trigger_events,
  is_active
) values (
  'e9750000-0000-4000-8000-000000000001',
  'e9710000-0000-4000-8000-000000000001',
  'Test receiver',
  'outgoing',
  repeat('b', 64),
  'https://receiver.example.test/vimob',
  array['lead.created']::text[],
  true
);

insert into public.pipelines (
  id,
  organization_id,
  name,
  is_default,
  is_active
) values (
  'e9720000-0000-4000-8000-000000000001',
  'e9710000-0000-4000-8000-000000000001',
  'API intake',
  true,
  true
);

insert into public.stages (
  id,
  pipeline_id,
  organization_id,
  name,
  stage_key,
  position,
  is_active
) values (
  'e9730000-0000-4000-8000-000000000001',
  'e9720000-0000-4000-8000-000000000001',
  'e9710000-0000-4000-8000-000000000001',
  'Entrada API',
  'api-entry',
  0,
  true
);

insert into public.leads (
  id,
  organization_id,
  pipeline_id,
  stage_id,
  name,
  phone,
  source,
  metadata
) values (
  'e9760000-0000-4000-8000-000000000001',
  'e9710000-0000-4000-8000-000000000001',
  'e9720000-0000-4000-8000-000000000001',
  'e9730000-0000-4000-8000-000000000001',
  'Lead API test',
  '11999999999',
  'api',
  jsonb_build_object(
    'distribution_deferred', true,
    'provider', 'public_api',
    'api_key_id', 'e9740000-0000-4000-8000-000000000001'
  )
);

update public.lead_entry_events
set provider = 'public_api',
    provider_event_id = 'e9740000-0000-4000-8000-000000000001:lead-api-test-001',
    source_detail = 'Public API smoke',
    payload = '{"name":"Lead API test","phone":"11999999999"}'::jsonb
where organization_id = 'e9710000-0000-4000-8000-000000000001'
  and lead_id = 'e9760000-0000-4000-8000-000000000001'
  and entry_type = 'initial';

create temporary table api_distribution_result on commit drop as
select private.distribute_lead(
  'e9710000-0000-4000-8000-000000000001',
  'e9760000-0000-4000-8000-000000000001',
  'public_api:lead-api-test-001',
  null,
  true,
  'api',
  clock_timestamp()
) as result;

select is(
  (
    select count(*)::integer
    from public.lead_entry_events
    where organization_id = 'e9710000-0000-4000-8000-000000000001'
      and lead_id = 'e9760000-0000-4000-8000-000000000001'
      and provider = 'public_api'
      and provider_event_id = 'e9740000-0000-4000-8000-000000000001:lead-api-test-001'
      and is_countable
  ),
  1,
  'API intake has one canonical idempotent lead-entry event'
);

select ok(
  (select result->>'reason' from api_distribution_result)
    = any(array['assigned', 'already_assigned', 'no_matching_queue', 'no_available_members']),
  'canonical distribution returns an accepted outcome'
);

select is(
  (
    select count(*)::integer
    from private.lead_distribution_events
    where organization_id = 'e9710000-0000-4000-8000-000000000001'
      and lead_id = 'e9760000-0000-4000-8000-000000000001'
      and idempotency_key = 'public_api:lead-api-test-001'
  ),
  1,
  'distribution is recorded exactly once with the API idempotency key'
);

select is(
  (
    select count(*)::integer
    from private.webhook_delivery_outbox
    where organization_id = 'e9710000-0000-4000-8000-000000000001'
      and webhook_id = 'e9750000-0000-4000-8000-000000000001'
      and lead_id = 'e9760000-0000-4000-8000-000000000001'
      and event_type = 'lead.created'
      and status = 'pending'
  ),
  1,
  'the same transaction creates one pending outgoing delivery'
);

select is(
  (
    select payload #>> '{data,entry,provider}'
    from private.webhook_delivery_outbox
    where webhook_id = 'e9750000-0000-4000-8000-000000000001'
  ),
  'public_api',
  'pending delivery is refreshed with final API attribution'
);

select is(
  (
    select payload->>'type'
    from private.webhook_delivery_outbox
    where webhook_id = 'e9750000-0000-4000-8000-000000000001'
  ),
  'lead.created',
  'outgoing payload exposes the versioned lead-created event contract'
);

select ok(
  not exists (
    select 1
    from private.webhook_delivery_outbox
    where webhook_id = 'e9750000-0000-4000-8000-000000000001'
      and payload::text like '%' || repeat('b', 64) || '%'
  ),
  'outgoing payload never contains its signing secret'
);

select * from finish();
rollback;
