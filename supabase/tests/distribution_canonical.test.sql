begin;

create extension if not exists pgtap with schema extensions;
select plan(51);

select has_table(
  'private',
  'lead_distribution_events',
  'canonical distribution keeps its idempotency log in the private schema'
);

select is(
  (
    select relation.relrowsecurity
    from pg_catalog.pg_class as relation
    where relation.oid = 'private.lead_distribution_events'::regclass
  ),
  true,
  'distribution event log has RLS as defense in depth'
);

select has_index(
  'private',
  'lead_distribution_events',
  'lead_distribution_events_org_idempotency_key_key',
  'organization and idempotency key are unique'
);

select ok(
  not has_table_privilege(
    'anon',
    'private.lead_distribution_events',
    'select'
  )
  and not has_table_privilege(
    'authenticated',
    'private.lead_distribution_events',
    'select'
  )
  and not has_table_privilege(
    'service_role',
    'private.lead_distribution_events',
    'select'
  ),
  'the durable event log is not directly exposed through Data API roles'
);

select has_function(
  'private',
  'distribute_lead',
  array[
    'uuid',
    'uuid',
    'text',
    'uuid',
    'boolean',
    'text',
    'timestamp with time zone'
  ],
  'canonical backend distribution function exists'
);

select has_function(
  'public',
  'distribute_lead_from_backend',
  array[
    'uuid',
    'uuid',
    'text',
    'uuid',
    'boolean',
    'text',
    'timestamp with time zone'
  ],
  'a Data API bridge exists for trusted backend runtimes'
);

select ok(
  (
    select
      procedure.prosecdef
      and exists (
        select 1
        from unnest(coalesce(procedure.proconfig, array[]::text[])) as setting
        where setting = 'search_path=""'
      )
    from pg_catalog.pg_proc as procedure
    where procedure.oid =
      'public.distribute_lead_from_backend(uuid,uuid,text,uuid,boolean,text,timestamptz)'::regprocedure
  ),
  'the Data API bridge is SECURITY DEFINER with an empty search path'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.distribute_lead_from_backend(uuid,uuid,text,uuid,boolean,text,timestamptz)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'public.distribute_lead_from_backend(uuid,uuid,text,uuid,boolean,text,timestamptz)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.distribute_lead_from_backend(uuid,uuid,text,uuid,boolean,text,timestamptz)',
    'execute'
  ),
  'only service_role can execute the Data API bridge'
);

select ok(
  (
    select
      procedure.prosecdef
      and exists (
        select 1
        from unnest(coalesce(procedure.proconfig, array[]::text[])) as setting
        where setting = 'search_path=""'
      )
    from pg_catalog.pg_proc as procedure
    where procedure.oid =
      'private.distribute_lead(uuid,uuid,text,uuid,boolean,text,timestamptz)'::regprocedure
  ),
  'canonical distribution is privileged with an empty immutable search_path'
);

select ok(
  (
    select
      lower(procedure.prosrc) not like '%auth.uid%'
      and lower(procedure.prosrc) not like '%auth.role%'
      and lower(procedure.prosrc) not like '%request.jwt%'
    from pg_catalog.pg_proc as procedure
    where procedure.oid =
      'private.distribute_lead(uuid,uuid,text,uuid,boolean,text,timestamptz)'::regprocedure
  ),
  'canonical distribution never depends on browser JWT claims'
);

select ok(
  has_function_privilege(
    'service_role',
    'private.distribute_lead(uuid,uuid,text,uuid,boolean,text,timestamptz)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'private.distribute_lead(uuid,uuid,text,uuid,boolean,text,timestamptz)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'private.distribute_lead(uuid,uuid,text,uuid,boolean,text,timestamptz)',
    'execute'
  ),
  'only the trusted backend role can execute canonical distribution'
);

select is(
  private.normalize_lead_distribution_source(' Facebook Lead Ads '),
  'meta',
  'source aliases are normalized before audit and timeline writes'
);

insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at,
  confirmation_token,
  email_change,
  email_change_token_new,
  recovery_token
)
select
  '00000000-0000-0000-0000-000000000000',
  fixture.id,
  'authenticated',
  'authenticated',
  fixture.email,
  crypt('test-password', gen_salt('bf', 4)),
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb,
  now(),
  now(),
  '',
  '',
  '',
  ''
from (
  values
    (
      'd2000000-0000-4000-8000-000000000001'::uuid,
      'distribution-team-one@example.test'
    ),
    (
      'd2000000-0000-4000-8000-000000000002'::uuid,
      'distribution-outside-scale@example.test'
    ),
    (
      'd2000000-0000-4000-8000-000000000003'::uuid,
      'distribution-dynamic@example.test'
    ),
    (
      'd2000000-0000-4000-8000-000000000004'::uuid,
      'distribution-inactive-membership@example.test'
    ),
    (
      'd2000000-0000-4000-8000-000000000005'::uuid,
      'distribution-other-tenant@example.test'
    )
) as fixture(id, email);

insert into public.organizations (id, name, slug, is_active)
values
  (
    'd1000000-0000-4000-8000-000000000001',
    'Canonical Distribution Org',
    'canonical-distribution-org',
    true
  ),
  (
    'd1000000-0000-4000-8000-000000000002',
    'Canonical Distribution Other Org',
    'canonical-distribution-other-org',
    true
  );

insert into public.users (
  id,
  organization_id,
  name,
  email,
  role,
  is_active
)
values
  (
    'd2000000-0000-4000-8000-000000000001',
    'd1000000-0000-4000-8000-000000000001',
    'Team One',
    'distribution-team-one@example.test',
    'user',
    true
  ),
  (
    'd2000000-0000-4000-8000-000000000002',
    'd1000000-0000-4000-8000-000000000001',
    'Outside Scale',
    'distribution-outside-scale@example.test',
    'user',
    true
  ),
  (
    'd2000000-0000-4000-8000-000000000003',
    'd1000000-0000-4000-8000-000000000001',
    'Dynamic Member',
    'distribution-dynamic@example.test',
    'user',
    true
  ),
  (
    'd2000000-0000-4000-8000-000000000004',
    'd1000000-0000-4000-8000-000000000001',
    'Inactive Membership',
    'distribution-inactive-membership@example.test',
    'user',
    true
  ),
  (
    'd2000000-0000-4000-8000-000000000005',
    'd1000000-0000-4000-8000-000000000002',
    'Other Tenant',
    'distribution-other-tenant@example.test',
    'user',
    true
  )
on conflict (id) do update
set organization_id = excluded.organization_id,
    name = excluded.name,
    email = excluded.email,
    role = excluded.role,
    is_active = excluded.is_active;

insert into public.organization_members (
  organization_id,
  user_id,
  role,
  is_active
)
values
  (
    'd1000000-0000-4000-8000-000000000001',
    'd2000000-0000-4000-8000-000000000001',
    'user',
    true
  ),
  (
    'd1000000-0000-4000-8000-000000000001',
    'd2000000-0000-4000-8000-000000000002',
    'user',
    true
  ),
  (
    'd1000000-0000-4000-8000-000000000001',
    'd2000000-0000-4000-8000-000000000003',
    'user',
    true
  ),
  (
    'd1000000-0000-4000-8000-000000000001',
    'd2000000-0000-4000-8000-000000000004',
    'user',
    false
  ),
  (
    'd1000000-0000-4000-8000-000000000002',
    'd2000000-0000-4000-8000-000000000005',
    'user',
    true
  )
on conflict (user_id, organization_id) do update
set role = excluded.role,
    is_active = excluded.is_active;

insert into public.pipelines (
  id,
  organization_id,
  name,
  is_default,
  is_active,
  position
)
values
  (
    'd3000000-0000-4000-8000-000000000001',
    'd1000000-0000-4000-8000-000000000001',
    'Source Pipeline',
    true,
    true,
    1
  ),
  (
    'd3000000-0000-4000-8000-000000000002',
    'd1000000-0000-4000-8000-000000000001',
    'Destination Pipeline',
    false,
    true,
    2
  ),
  (
    'd3000000-0000-4000-8000-000000000003',
    'd1000000-0000-4000-8000-000000000002',
    'Other Tenant Pipeline',
    true,
    true,
    1
  );

insert into public.stages (
  id,
  organization_id,
  pipeline_id,
  name,
  stage_key,
  position,
  is_active
)
values
  (
    'd4000000-0000-4000-8000-000000000001',
    'd1000000-0000-4000-8000-000000000001',
    'd3000000-0000-4000-8000-000000000001',
    'Source New',
    'distribution_source_new',
    1,
    true
  ),
  (
    'd4000000-0000-4000-8000-000000000002',
    'd1000000-0000-4000-8000-000000000001',
    'd3000000-0000-4000-8000-000000000002',
    'Destination New',
    'distribution_destination_new',
    1,
    true
  ),
  (
    'd4000000-0000-4000-8000-000000000003',
    'd1000000-0000-4000-8000-000000000002',
    'd3000000-0000-4000-8000-000000000003',
    'Other Tenant New',
    'distribution_other_new',
    1,
    true
  );

insert into public.teams (
  id,
  organization_id,
  name,
  is_active
)
values (
  'd5000000-0000-4000-8000-000000000001',
  'd1000000-0000-4000-8000-000000000001',
  'Dynamic Distribution Team',
  true
);

insert into public.team_members (
  id,
  organization_id,
  team_id,
  user_id,
  is_active
)
values
  (
    'd6000000-0000-4000-8000-000000000001',
    'd1000000-0000-4000-8000-000000000001',
    'd5000000-0000-4000-8000-000000000001',
    'd2000000-0000-4000-8000-000000000001',
    true
  ),
  (
    'd6000000-0000-4000-8000-000000000002',
    'd1000000-0000-4000-8000-000000000001',
    'd5000000-0000-4000-8000-000000000001',
    'd2000000-0000-4000-8000-000000000002',
    true
  ),
  (
    'd6000000-0000-4000-8000-000000000003',
    'd1000000-0000-4000-8000-000000000001',
    'd5000000-0000-4000-8000-000000000001',
    'd2000000-0000-4000-8000-000000000003',
    false
  );

insert into public.member_availability (
  id,
  organization_id,
  team_member_id,
  day_of_week,
  start_time,
  end_time,
  is_all_day,
  is_active
)
values
  (
    'd6100000-0000-4000-8000-000000000001',
    'd1000000-0000-4000-8000-000000000001',
    'd6000000-0000-4000-8000-000000000001',
    1,
    null,
    null,
    true,
    true
  ),
  (
    'd6100000-0000-4000-8000-000000000002',
    'd1000000-0000-4000-8000-000000000001',
    'd6000000-0000-4000-8000-000000000002',
    1,
    '18:00',
    '19:00',
    false,
    true
  );

insert into public.round_robins (
  id,
  organization_id,
  name,
  pipeline_id,
  target_pipeline_id,
  target_stage_id,
  strategy,
  is_active,
  current_position,
  leads_distributed
)
values
  (
    'd7000000-0000-4000-8000-000000000001',
    'd1000000-0000-4000-8000-000000000001',
    'Default Team Queue',
    'd3000000-0000-4000-8000-000000000001',
    'd3000000-0000-4000-8000-000000000002',
    'd4000000-0000-4000-8000-000000000002',
    'simple',
    true,
    0,
    0
  ),
  (
    'd7000000-0000-4000-8000-000000000002',
    'd1000000-0000-4000-8000-000000000001',
    'Weighted Direct Queue',
    'd3000000-0000-4000-8000-000000000001',
    'd3000000-0000-4000-8000-000000000001',
    'd4000000-0000-4000-8000-000000000001',
    'weighted',
    true,
    0,
    0
  ),
  (
    'd7000000-0000-4000-8000-000000000003',
    'd1000000-0000-4000-8000-000000000001',
    'Empty Queue',
    'd3000000-0000-4000-8000-000000000001',
    'd3000000-0000-4000-8000-000000000001',
    'd4000000-0000-4000-8000-000000000001',
    'simple',
    true,
    0,
    0
  ),
  (
    'd7000000-0000-4000-8000-000000000004',
    'd1000000-0000-4000-8000-000000000002',
    'Other Tenant Queue',
    'd3000000-0000-4000-8000-000000000003',
    'd3000000-0000-4000-8000-000000000003',
    'd4000000-0000-4000-8000-000000000003',
    'simple',
    true,
    0,
    0
  );

select is(
  private.backfill_unambiguous_pipeline_default_round_robins(),
  1,
  'legacy fallback backfill updates only the pipeline with one active queue'
);

select is(
  (
    select default_round_robin_id::text
    from public.pipelines
    where id = 'd3000000-0000-4000-8000-000000000003'
  ),
  'd7000000-0000-4000-8000-000000000004',
  'legacy fallback backfill preserves an unambiguous queue association'
);

select is(
  (
    select default_round_robin_id::text
    from public.pipelines
    where id = 'd3000000-0000-4000-8000-000000000001'
  ),
  null::text,
  'legacy fallback backfill refuses to guess across multiple active queues'
);

select is(
  private.backfill_unambiguous_pipeline_default_round_robins(),
  0,
  'legacy fallback backfill is idempotent after reconciliation'
);

update public.pipelines
set default_round_robin_id = 'd7000000-0000-4000-8000-000000000001'
where id = 'd3000000-0000-4000-8000-000000000001';

insert into public.round_robin_members (
  id,
  organization_id,
  round_robin_id,
  user_id,
  team_id,
  weight,
  position,
  leads_count,
  is_active
)
values
  (
    'd8000000-0000-4000-8000-000000000001',
    'd1000000-0000-4000-8000-000000000001',
    'd7000000-0000-4000-8000-000000000001',
    null,
    'd5000000-0000-4000-8000-000000000001',
    1,
    1,
    0,
    true
  ),
  (
    'd8000000-0000-4000-8000-000000000002',
    'd1000000-0000-4000-8000-000000000001',
    'd7000000-0000-4000-8000-000000000001',
    'd2000000-0000-4000-8000-000000000004',
    null,
    1,
    0,
    0,
    true
  ),
  (
    'd8000000-0000-4000-8000-000000000003',
    'd1000000-0000-4000-8000-000000000001',
    'd7000000-0000-4000-8000-000000000002',
    'd2000000-0000-4000-8000-000000000001',
    null,
    1,
    1,
    0,
    true
  ),
  (
    'd8000000-0000-4000-8000-000000000004',
    'd1000000-0000-4000-8000-000000000001',
    'd7000000-0000-4000-8000-000000000002',
    'd2000000-0000-4000-8000-000000000003',
    null,
    3,
    2,
    0,
    true
  );

insert into public.round_robin_rules (
  id,
  organization_id,
  round_robin_id,
  match_type,
  match_value,
  priority,
  is_active
)
values (
  'd7100000-0000-4000-8000-000000000001',
  'd1000000-0000-4000-8000-000000000001',
  'd7000000-0000-4000-8000-000000000003',
  'campaign_contains',
  'canonical-rule',
  100,
  true
);

insert into public.leads (
  id,
  organization_id,
  pipeline_id,
  stage_id,
  name,
  source,
  metadata
)
values
  (
    'd9000000-0000-4000-8000-000000000001',
    'd1000000-0000-4000-8000-000000000001',
    'd3000000-0000-4000-8000-000000000001',
    'd4000000-0000-4000-8000-000000000001',
    'Default team lead',
    'facebook-lead-ads',
    '{"distribution_deferred":true}'::jsonb
  ),
  (
    'd9000000-0000-4000-8000-000000000002',
    'd1000000-0000-4000-8000-000000000001',
    'd3000000-0000-4000-8000-000000000001',
    'd4000000-0000-4000-8000-000000000001',
    'Dynamic team lead',
    'website',
    '{"distribution_deferred":true}'::jsonb
  );

select is(
  private.distribute_lead(
    'd1000000-0000-4000-8000-000000000001',
    'd9000000-0000-4000-8000-000000000001',
    'team:first',
    null,
    true,
    null,
    '2026-07-27 13:00:00+00'
  )->>'reason',
  'assigned',
  'default pipeline queue assigns the first lead'
);

select is(
  (
    select assigned_user_id
    from public.leads
    where id = 'd9000000-0000-4000-8000-000000000001'
  ),
  'd2000000-0000-4000-8000-000000000001'::uuid,
  'active team member inside the scale receives the lead'
);

select ok(
  (
    select
      pipeline_id = 'd3000000-0000-4000-8000-000000000002'
      and stage_id = 'd4000000-0000-4000-8000-000000000002'
      and team_id = 'd5000000-0000-4000-8000-000000000001'
    from public.leads
    where id = 'd9000000-0000-4000-8000-000000000001'
  ),
  'distribution atomically moves the lead to the queue destination and team'
);

select is(
  (
    select source
    from private.lead_distribution_events
    where organization_id = 'd1000000-0000-4000-8000-000000000001'
      and idempotency_key = 'team:first'
  ),
  'meta',
  'distribution event persists the canonical source'
);

select ok(
  (
    select
      distribution_ticket is not null
      and algorithm_version = 'queue_ticket_iwrr_v1'
      and slot_count = 1
      and candidate_position = 1
    from private.lead_distribution_events
    where organization_id = 'd1000000-0000-4000-8000-000000000001'
      and idempotency_key = 'team:first'
  )
  and (
    select
      count(*) = 1
      and min((metadata->>'distribution_ticket')::bigint) is not null
      and min(metadata->>'algorithm_version') = 'queue_ticket_iwrr_v1'
    from public.round_robin_logs
    where round_robin_id = 'd7000000-0000-4000-8000-000000000001'
      and member_id = 'd8000000-0000-4000-8000-000000000001'
      and reason = 'canonical_round_robin'
  ),
  'assignment ticket and algorithm version are durable and auditable'
);

select ok(
  exists (
    select 1
    from public.assignments_log
    where lead_id = 'd9000000-0000-4000-8000-000000000001'
      and reason = 'canonical_round_robin'
  )
  and exists (
    select 1
    from public.round_robin_logs
    where lead_id = 'd9000000-0000-4000-8000-000000000001'
      and reason = 'canonical_round_robin'
  )
  and exists (
    select 1
    from public.lead_timeline_events
    where lead_id = 'd9000000-0000-4000-8000-000000000001'
      and event_type = 'lead_assigned'
  )
  and exists (
    select 1
    from public.notifications
    where lead_id = 'd9000000-0000-4000-8000-000000000001'
      and type = 'lead_assigned'
      and metadata->>'event_key' = 'new_lead_received'
      and metadata->>'dedupe_key' =
        'new_lead_received:d9000000-0000-4000-8000-000000000001:d2000000-0000-4000-8000-000000000001'
      and metadata->'dispatch'->'whatsapp'->>'status' = 'pending'
      and metadata->'dispatch'->'push'->>'status' = 'pending'
  ),
  'assignment log, queue log, timeline and notification are written atomically'
);

select ok(
  (
    select not (metadata ? 'distribution_deferred')
    from public.leads
    where id = 'd9000000-0000-4000-8000-000000000001'
  )
  and (
    select count(*) = 1
    from public.round_robin_logs
    where lead_id = 'd9000000-0000-4000-8000-000000000001'
      and reason = 'canonical_round_robin'
  )
  and (
    select count(*) = 0
    from public.round_robin_logs
    where lead_id = 'd9000000-0000-4000-8000-000000000001'
      and reason <> 'canonical_round_robin'
  ),
  'deferred insert skips legacy distribution and canonical completion clears its marker'
);

select is(
  (
    select count(*)
    from public.round_robin_logs
    where lead_id = 'd9000000-0000-4000-8000-000000000001'
      and assigned_user_id = 'd2000000-0000-4000-8000-000000000002'
  ),
  0::bigint,
  'team member outside the configured scale is not selected'
);

select is(
  (
    select count(*)
    from public.round_robin_logs
    where lead_id = 'd9000000-0000-4000-8000-000000000001'
      and assigned_user_id = 'd2000000-0000-4000-8000-000000000004'
  ),
  0::bigint,
  'inactive organization membership cannot receive a lead'
);

select is(
  private.distribute_lead(
    'd1000000-0000-4000-8000-000000000001',
    'd9000000-0000-4000-8000-000000000001',
    'team:first',
    null,
    true,
    null,
    '2026-07-27 13:00:01+00'
  )->>'distribution_event_id',
  (
    select id::text
    from private.lead_distribution_events
    where organization_id = 'd1000000-0000-4000-8000-000000000001'
      and idempotency_key = 'team:first'
  ),
  'replaying an idempotency key returns the original result'
);

select ok(
  (
    select count(*) = 1
    from public.round_robin_logs
    where round_robin_id = 'd7000000-0000-4000-8000-000000000001'
      and reason = 'canonical_round_robin'
  )
  and (
    select count(*) = 1
    from public.notifications
    where lead_id = 'd9000000-0000-4000-8000-000000000001'
      and type = 'lead_assigned'
  )
  and (
    select count(*) = 1
    from private.lead_distribution_events
    where organization_id = 'd1000000-0000-4000-8000-000000000001'
      and idempotency_key = 'team:first'
  ),
  'idempotent replay does not consume another durable assignment or duplicate side effects'
);

select is(
  private.distribute_lead(
    'd1000000-0000-4000-8000-000000000001',
    'd9000000-0000-4000-8000-000000000002',
    'team:first',
    null,
    true,
    null,
    '2026-07-27 13:00:02+00'
  )->>'reason',
  'idempotency_key_conflict',
  'one organization cannot reuse an idempotency key for another lead'
);

update public.team_members
set is_active = true
where id = 'd6000000-0000-4000-8000-000000000003';

select is(
  private.distribute_lead(
    'd1000000-0000-4000-8000-000000000001',
    'd9000000-0000-4000-8000-000000000002',
    'team:second',
    null,
    true,
    'site',
    '2026-07-27 13:00:03+00'
  )->>'assigned_user_id',
  'd2000000-0000-4000-8000-000000000003',
  'a newly activated team member participates without rewriting the queue'
);

select ok(
  (
    select
      assigned_user_id = 'd2000000-0000-4000-8000-000000000003'
      and team_id = 'd5000000-0000-4000-8000-000000000001'
    from public.leads
    where id = 'd9000000-0000-4000-8000-000000000002'
  )
  and (
    select
      count(*) = 2
      and count(distinct (metadata->>'distribution_ticket')::bigint) = 2
    from public.round_robin_logs
    where round_robin_id = 'd7000000-0000-4000-8000-000000000001'
      and reason = 'canonical_round_robin'
  ),
  'dynamic team expansion keeps one unique ticket per durable assignment'
);

select is(
  private.distribute_lead(
    'd1000000-0000-4000-8000-000000000001',
    'd9000000-0000-4000-8000-000000000002',
    'team:second:reentry',
    null,
    true,
    null,
    '2026-07-27 13:00:04+00'
  )->>'reason',
  'already_assigned',
  'reentry preserves the current assignee by default'
);

select ok(
  (
    select count(*) = 2
    from public.round_robin_logs
    where round_robin_id = 'd7000000-0000-4000-8000-000000000001'
      and reason = 'canonical_round_robin'
  )
  and (
    select
      outcome = 'already_assigned'
      and distribution_ticket is null
    from private.lead_distribution_events
    where organization_id = 'd1000000-0000-4000-8000-000000000001'
      and idempotency_key = 'team:second:reentry'
  ),
  'preserved reentry records its outcome without consuming another queue ticket'
);

do $$
declare
  lead_id uuid;
begin
  foreach lead_id in array array[
    'd9000000-0000-4000-8000-000000000010'::uuid,
    'd9000000-0000-4000-8000-000000000011'::uuid,
    'd9000000-0000-4000-8000-000000000012'::uuid,
    'd9000000-0000-4000-8000-000000000013'::uuid,
    'd9000000-0000-4000-8000-000000000014'::uuid,
    'd9000000-0000-4000-8000-000000000015'::uuid,
    'd9000000-0000-4000-8000-000000000016'::uuid,
    'd9000000-0000-4000-8000-000000000017'::uuid
  ]
  loop
    insert into public.leads (
      id,
      organization_id,
      pipeline_id,
      stage_id,
      name,
      source,
      metadata
    )
    values (
      lead_id,
      'd1000000-0000-4000-8000-000000000001',
      'd3000000-0000-4000-8000-000000000001',
      'd4000000-0000-4000-8000-000000000001',
      'Weighted lead ' || lead_id::text,
      'manual',
      '{"distribution_deferred":true}'::jsonb
    );

    perform private.distribute_lead(
      'd1000000-0000-4000-8000-000000000001',
      lead_id,
      'weighted:' || lead_id::text,
      'd7000000-0000-4000-8000-000000000002',
      true,
      null,
      '2026-07-27 13:05:00+00'
    );
  end loop;
end;
$$;

select ok(
  (
    select count(*) = 2
    from public.round_robin_logs
    where round_robin_id = 'd7000000-0000-4000-8000-000000000002'
      and member_id = 'd8000000-0000-4000-8000-000000000003'
      and reason = 'canonical_round_robin'
  )
  and (
    select count(*) = 6
    from public.round_robin_logs
    where round_robin_id = 'd7000000-0000-4000-8000-000000000002'
      and member_id = 'd8000000-0000-4000-8000-000000000004'
      and reason = 'canonical_round_robin'
  ),
  'interleaved weighted tickets preserve the configured 1:3 entry allocation'
);

select is(
  (
    select count(distinct (metadata->>'distribution_ticket')::bigint)
    from public.round_robin_logs
    where round_robin_id = 'd7000000-0000-4000-8000-000000000002'
      and reason = 'canonical_round_robin'
  ),
  8::bigint,
  'weighted queue reserves one unique auditable ticket per distributed lead'
);

update public.round_robin_members
set weight = case id
  when 'd8000000-0000-4000-8000-000000000003'::uuid then 3
  when 'd8000000-0000-4000-8000-000000000004'::uuid then 2
  else weight
end
where id in (
  'd8000000-0000-4000-8000-000000000003',
  'd8000000-0000-4000-8000-000000000004'
);

select is(
  (
    select array_agg(candidate.user_id order by ticket_series.ticket)
    from generate_series(1::bigint, 5::bigint) as ticket_series(ticket)
    cross join lateral private.pick_round_robin_ticket_candidate(
      'd1000000-0000-4000-8000-000000000001',
      'd7000000-0000-4000-8000-000000000002',
      'weighted',
      true,
      1,
      '10:00:00'::time,
      ticket_series.ticket
    ) as candidate
  ),
  array[
    'd2000000-0000-4000-8000-000000000001'::uuid,
    'd2000000-0000-4000-8000-000000000003'::uuid,
    'd2000000-0000-4000-8000-000000000001'::uuid,
    'd2000000-0000-4000-8000-000000000003'::uuid,
    'd2000000-0000-4000-8000-000000000001'::uuid
  ],
  'interleaved weighted round robin maps 3:2 as A-B-A-B-A without expanding weight rows'
);

update public.round_robin_members
set weight = case id
  when 'd8000000-0000-4000-8000-000000000003'::uuid then 1
  when 'd8000000-0000-4000-8000-000000000004'::uuid then 3
  else weight
end
where id in (
  'd8000000-0000-4000-8000-000000000003',
  'd8000000-0000-4000-8000-000000000004'
);

select is(
  (
    select count(*)
    from public.leads
    where id between
      'd9000000-0000-4000-8000-000000000010'
      and 'd9000000-0000-4000-8000-000000000017'
      and assigned_user_id in (
        'd2000000-0000-4000-8000-000000000001',
        'd2000000-0000-4000-8000-000000000003'
      )
  ),
  8::bigint,
  'every weighted fixture is assigned to an eligible active member'
);

insert into public.leads (
  id,
  organization_id,
  pipeline_id,
  stage_id,
  name,
  source,
  metadata
)
values (
  'd9000000-0000-4000-8000-000000000020',
  'd1000000-0000-4000-8000-000000000001',
  'd3000000-0000-4000-8000-000000000001',
  'd4000000-0000-4000-8000-000000000001',
  'No member lead',
  'webhook',
  '{"distribution_deferred":true}'::jsonb
);

insert into public.leads (
  id,
  organization_id,
  pipeline_id,
  stage_id,
  name,
  source,
  utm_campaign,
  metadata
)
values (
  'd9000000-0000-4000-8000-000000000021',
  'd1000000-0000-4000-8000-000000000001',
  'd3000000-0000-4000-8000-000000000001',
  'd4000000-0000-4000-8000-000000000001',
  'Rule-selected empty queue lead',
  'site',
  'campaign:canonical-rule:lead',
  '{"distribution_deferred":true}'::jsonb
);

select is(
  private.distribute_lead(
    'd1000000-0000-4000-8000-000000000001',
    'd9000000-0000-4000-8000-000000000021',
    'rules:first',
    null,
    true,
    null,
    '2026-07-27 13:09:00+00'
  )->>'reason',
  'no_available_members',
  'canonical distribution evaluates queue rules before the pipeline fallback'
);

select is(
  (
    select round_robin_id
    from private.lead_distribution_events
    where organization_id = 'd1000000-0000-4000-8000-000000000001'
      and idempotency_key = 'rules:first'
  ),
  'd7000000-0000-4000-8000-000000000003'::uuid,
  'the matching campaign rule selects its exact queue'
);

select is(
  private.distribute_lead(
    'd1000000-0000-4000-8000-000000000001',
    'd9000000-0000-4000-8000-000000000020',
    'empty:first',
    'd7000000-0000-4000-8000-000000000003',
    true,
    null,
    '2026-07-27 13:10:00+00'
  )->>'reason',
  'no_available_members',
  'empty queue returns an explicit non-destructive outcome'
);

select is(
  (
    select assigned_user_id
    from public.leads
    where id = 'd9000000-0000-4000-8000-000000000020'
  ),
  null::uuid,
  'empty queue leaves the lead unassigned'
);

select ok(
  exists (
    select 1
    from private.lead_distribution_events
    where organization_id = 'd1000000-0000-4000-8000-000000000001'
      and idempotency_key = 'empty:first'
      and outcome = 'no_available_members'
  )
  and exists (
    select 1
    from public.round_robin_logs
    where lead_id = 'd9000000-0000-4000-8000-000000000020'
      and reason = 'no_available_members'
  )
  and exists (
    select 1
    from public.lead_timeline_events
    where lead_id = 'd9000000-0000-4000-8000-000000000020'
      and event_type = 'lead_distribution_pending'
  ),
  'no-member outcome is durable and observable'
);

select is(
  public.distribute_lead_from_backend(
    'd1000000-0000-4000-8000-000000000001',
    'd9000000-0000-4000-8000-000000000020',
    'empty:first',
    'd7000000-0000-4000-8000-000000000003',
    true,
    'whatsapp',
    '2026-07-27 13:10:30+00'
  )->>'reason',
  'no_available_members',
  'the service-role bridge delegates to the same idempotent canonical result'
);

select is(
  private.distribute_lead(
    'd1000000-0000-4000-8000-000000000002',
    'd9000000-0000-4000-8000-000000000020',
    'cross-tenant:lead',
    null,
    true,
    null,
    '2026-07-27 13:11:00+00'
  )->>'reason',
  'lead_not_found',
  'tenant mismatch is indistinguishable from a missing lead'
);

select is(
  (
    select count(*)
    from private.lead_distribution_events
    where organization_id = 'd1000000-0000-4000-8000-000000000002'
      and idempotency_key = 'cross-tenant:lead'
  ),
  0::bigint,
  'tenant mismatch creates no durable side effect'
);

select is(
  private.distribute_lead(
    'd1000000-0000-4000-8000-000000000001',
    'd9000000-0000-4000-8000-000000000020',
    'cross-tenant:queue',
    'd7000000-0000-4000-8000-000000000004',
    true,
    null,
    '2026-07-27 13:12:00+00'
  )->>'reason',
  'no_matching_queue',
  'an explicit queue from another tenant cannot be selected'
);

select is(
  (
    select count(*)
    from private.lead_distribution_events
    where organization_id = 'd1000000-0000-4000-8000-000000000001'
      and lead_id = 'd9000000-0000-4000-8000-000000000020'
      and (
        outcome = 'assigned'
        or requested_round_robin_id =
          'd7000000-0000-4000-8000-000000000004'
      )
  ),
  0::bigint,
  'cross-tenant attempts persist neither assignment nor a foreign queue link'
);

select ok(
  (
    select
      lower(procedure.prosrc) not like '%from pg_catalog.pg_timezone_names%'
      and lower(procedure.prosrc) like '%at time zone v_timezone%'
    from pg_catalog.pg_proc as procedure
    where procedure.oid =
      'private.distribute_lead(uuid,uuid,text,uuid,boolean,text,timestamptz)'::regprocedure
  ),
  'distribution validates the configured timezone without scanning the timezone catalog inside the queue lock'
);

update public.round_robins
set settings = coalesce(settings, '{}'::jsonb)
  || jsonb_build_object('timezone', 'Invalid/Vimob')
where id = 'd7000000-0000-4000-8000-000000000003';

insert into public.leads (
  id,
  organization_id,
  pipeline_id,
  stage_id,
  name,
  source,
  metadata
)
values (
  'd9000000-0000-4000-8000-000000000030',
  'd1000000-0000-4000-8000-000000000001',
  'd3000000-0000-4000-8000-000000000001',
  'd4000000-0000-4000-8000-000000000001',
  'Invalid timezone fallback lead',
  'site',
  '{"distribution_deferred":true}'::jsonb
);

select is(
  private.distribute_lead(
    'd1000000-0000-4000-8000-000000000001',
    'd9000000-0000-4000-8000-000000000030',
    'timezone:invalid:fallback',
    'd7000000-0000-4000-8000-000000000003',
    true,
    'site',
    '2026-07-27 13:13:00+00'
  )->>'reason',
  'no_available_members',
  'an invalid persisted timezone falls back safely instead of aborting distribution'
);

insert into public.teams (
  id,
  organization_id,
  name,
  is_active
)
values (
  'd5000000-0000-4000-8000-000000000002',
  'd1000000-0000-4000-8000-000000000001',
  'Available Duplicate Team',
  true
);

insert into public.team_members (
  id,
  organization_id,
  team_id,
  user_id,
  is_active
)
values (
  'd6000000-0000-4000-8000-000000000004',
  'd1000000-0000-4000-8000-000000000001',
  'd5000000-0000-4000-8000-000000000002',
  'd2000000-0000-4000-8000-000000000001',
  true
);

insert into public.round_robins (
  id,
  organization_id,
  name,
  strategy,
  is_active,
  created_by
)
values (
  'd7000000-0000-4000-8000-000000000005',
  'd1000000-0000-4000-8000-000000000001',
  'Availability Before Dedupe Queue',
  'simple',
  true,
  'd2000000-0000-4000-8000-000000000001'
);

insert into public.round_robin_members (
  id,
  organization_id,
  round_robin_id,
  user_id,
  team_id,
  weight,
  position,
  is_active
)
values
  (
    'd8000000-0000-4000-8000-000000000005',
    'd1000000-0000-4000-8000-000000000001',
    'd7000000-0000-4000-8000-000000000005',
    'd2000000-0000-4000-8000-000000000001',
    'd5000000-0000-4000-8000-000000000001',
    1,
    0,
    true
  ),
  (
    'd8000000-0000-4000-8000-000000000006',
    'd1000000-0000-4000-8000-000000000001',
    'd7000000-0000-4000-8000-000000000005',
    null,
    'd5000000-0000-4000-8000-000000000002',
    1,
    1,
    true
  );

select is(
  (
    select candidate.member_id
    from private.pick_round_robin_ticket_candidate(
      'd1000000-0000-4000-8000-000000000001',
      'd7000000-0000-4000-8000-000000000005',
      'simple',
      false,
      2,
      '10:00:00'::time,
      1
    ) as candidate
  ),
  'd8000000-0000-4000-8000-000000000006'::uuid,
  'availability is filtered before duplicate users choose their preferred queue entry'
);

insert into public.leads (
  id,
  organization_id,
  pipeline_id,
  stage_id,
  name,
  source,
  metadata
)
values (
  'd9000000-0000-4000-8000-000000000031',
  'd1000000-0000-4000-8000-000000000001',
  'd3000000-0000-4000-8000-000000000001',
  'd4000000-0000-4000-8000-000000000001',
  'Canonical trigger lead',
  'site',
  '{}'::jsonb
);

select ok(
  exists (
    select 1
    from private.lead_distribution_events
    where organization_id = 'd1000000-0000-4000-8000-000000000001'
      and lead_id = 'd9000000-0000-4000-8000-000000000031'
      and idempotency_key =
        'trigger:d9000000-0000-4000-8000-000000000031'
      and outcome <> 'processing'
  ),
  'an unmarked lead insert enters the canonical idempotency boundary'
);

select ok(
  (
    select
      lower(procedure.prosrc) like '%for no key update%'
      and lower(procedure.prosrc) not like '%for update;%'
      and lower(procedure.prosrc)
        like '%private.next_round_robin_ticket(v_queue.id)%'
    from pg_catalog.pg_proc as procedure
    where procedure.oid =
      'private.distribute_lead(uuid,uuid,text,uuid,boolean,text,timestamptz)'::regprocedure
  ),
  'function keeps the lead safety lock without restoring a queue or member lock convoy'
);

select * from finish();
rollback;
