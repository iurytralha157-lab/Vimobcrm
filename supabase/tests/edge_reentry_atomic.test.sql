begin;

create extension if not exists pgtap with schema extensions;
select plan(10);

select has_function(
  'public',
  'process_whatsapp_lead_reentry_from_backend',
  array[
    'uuid',
    'uuid',
    'text',
    'uuid',
    'text',
    'text',
    'jsonb',
    'jsonb',
    'timestamp with time zone'
  ],
  'Evolution reentry exposes one atomic backend aggregate'
);

select ok(
  (
    select
      procedure.prosecdef
      and procedure.provolatile = 'v'
      and exists (
        select 1
        from unnest(coalesce(procedure.proconfig, array[]::text[])) as setting
        where setting = 'search_path=""'
      )
    from pg_catalog.pg_proc as procedure
    where procedure.oid =
      'public.process_whatsapp_lead_reentry_from_backend(uuid,uuid,text,uuid,text,text,jsonb,jsonb,timestamptz)'::regprocedure
  )
  and has_function_privilege(
    'service_role',
    'public.process_whatsapp_lead_reentry_from_backend(uuid,uuid,text,uuid,text,text,jsonb,jsonb,timestamptz)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'public.process_whatsapp_lead_reentry_from_backend(uuid,uuid,text,uuid,text,text,jsonb,jsonb,timestamptz)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.process_whatsapp_lead_reentry_from_backend(uuid,uuid,text,uuid,text,text,jsonb,jsonb,timestamptz)',
    'execute'
  ),
  'atomic Evolution reentry is volatile, security-definer and service-role-only'
);

insert into public.organizations (id, name, slug, is_active)
values (
  'e1000000-0000-4000-8000-000000000001',
  'Atomic Edge Reentry Org',
  'atomic-edge-reentry-org',
  true
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
values (
  '00000000-0000-0000-0000-000000000000',
  'e2000000-0000-4000-8000-000000000001',
  'authenticated',
  'authenticated',
  'atomic-edge-reentry@example.test',
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
);

insert into public.users (
  id,
  organization_id,
  name,
  email,
  role,
  is_active
)
values (
  'e2000000-0000-4000-8000-000000000001',
  'e1000000-0000-4000-8000-000000000001',
  'Atomic Reentry Owner',
  'atomic-edge-reentry@example.test',
  'admin',
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
values (
  'e1000000-0000-4000-8000-000000000001',
  'e2000000-0000-4000-8000-000000000001',
  'admin',
  true
)
on conflict (organization_id, user_id) do update
set role = excluded.role,
    is_active = excluded.is_active;

insert into public.pipelines (
  id,
  organization_id,
  name,
  position,
  is_active
)
values (
  'e3000000-0000-4000-8000-000000000001',
  'e1000000-0000-4000-8000-000000000001',
  'Atomic Reentry Pipeline',
  1,
  true
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
values (
  'e4000000-0000-4000-8000-000000000001',
  'e1000000-0000-4000-8000-000000000001',
  'e3000000-0000-4000-8000-000000000001',
  'Entrada',
  'atomic_reentry_entry',
  1,
  true
);

insert into public.whatsapp_sessions (
  id,
  organization_id,
  owner_user_id,
  instance_name,
  status,
  provider
)
values
  (
    'e7000000-0000-4000-8000-000000000001',
    'e1000000-0000-4000-8000-000000000001',
    'e2000000-0000-4000-8000-000000000001',
    'atomic-edge-reentry-session-1',
    'connected',
    'evolution'
  ),
  (
    'e7000000-0000-4000-8000-000000000002',
    'e1000000-0000-4000-8000-000000000001',
    'e2000000-0000-4000-8000-000000000001',
    'atomic-edge-reentry-session-2',
    'connected',
    'evolution'
  ),
  (
    'e7000000-0000-4000-8000-000000000003',
    'e1000000-0000-4000-8000-000000000001',
    'e2000000-0000-4000-8000-000000000001',
    'atomic-edge-reentry-session-3',
    'connected',
    'evolution'
  ),
  (
    'e7000000-0000-4000-8000-000000000004',
    'e1000000-0000-4000-8000-000000000001',
    'e2000000-0000-4000-8000-000000000001',
    'atomic-edge-reentry-session-4',
    'connected',
    'evolution'
  );

insert into public.leads (
  id,
  organization_id,
  pipeline_id,
  stage_id,
  name,
  source,
  metadata,
  stage_entered_at,
  board_order_at
)
values
  (
    'e9000000-0000-4000-8000-000000000001',
    'e1000000-0000-4000-8000-000000000001',
    'e3000000-0000-4000-8000-000000000001',
    'e4000000-0000-4000-8000-000000000001',
    'Fresh atomic reentry',
    'whatsapp',
    '{"distribution_deferred":true}'::jsonb,
    '2026-01-01 10:00:00+00',
    '2026-01-01 10:00:00+00'
  ),
  (
    'e9000000-0000-4000-8000-000000000002',
    'e1000000-0000-4000-8000-000000000001',
    'e3000000-0000-4000-8000-000000000001',
    'e4000000-0000-4000-8000-000000000001',
    'Rollback atomic reentry',
    'whatsapp',
    '{"distribution_deferred":true}'::jsonb,
    '2026-01-01 10:00:00+00',
    '2026-01-01 10:00:00+00'
  );

insert into public.whatsapp_conversations (
  id,
  session_id,
  organization_id,
  remote_jid,
  contact_name
)
values
  (
    'e8000000-0000-4000-8000-000000000001',
    'e7000000-0000-4000-8000-000000000001',
    'e1000000-0000-4000-8000-000000000001',
    '5511999990001@s.whatsapp.net',
    'Fresh conversation'
  ),
  (
    'e8000000-0000-4000-8000-000000000002',
    'e7000000-0000-4000-8000-000000000002',
    'e1000000-0000-4000-8000-000000000001',
    '5511999990002@s.whatsapp.net',
    'Legacy recovery conversation'
  ),
  (
    'e8000000-0000-4000-8000-000000000003',
    'e7000000-0000-4000-8000-000000000003',
    'e1000000-0000-4000-8000-000000000001',
    '5511999990003@s.whatsapp.net',
    'Newer metadata conversation'
  ),
  (
    'e8000000-0000-4000-8000-000000000004',
    'e7000000-0000-4000-8000-000000000004',
    'e1000000-0000-4000-8000-000000000001',
    '5511999990004@s.whatsapp.net',
    'Rollback conversation'
  );

create temporary table atomic_reentry_results (
  label text primary key,
  result jsonb not null
) on commit drop;

insert into atomic_reentry_results (label, result)
values (
  'fresh',
  public.process_whatsapp_lead_reentry_from_backend(
    'e1000000-0000-4000-8000-000000000001',
    'e9000000-0000-4000-8000-000000000001',
    'provider-event-fresh',
    'e8000000-0000-4000-8000-000000000001',
    'whatsapp',
    'whatsapp_reentry',
    '{"fixture":"fresh"}'::jsonb,
    '{"campaign_name":"Original campaign","source_type":"whatsapp","raw_payload":{"fixture":true}}'::jsonb,
    '2026-09-08 05:00:00+00'
  )
);

select ok(
  (
    select
      (result->>'success')::boolean
      and (result->>'inserted')::boolean
      and not (result->>'replayed')::boolean
      and (result->>'conversation_linked')::boolean
      and (result->>'lead_meta_applied')::boolean
    from atomic_reentry_results
    where label = 'fresh'
  )
  and (
    select conversation.lead_id = 'e9000000-0000-4000-8000-000000000001'
    from public.whatsapp_conversations as conversation
    where conversation.id = 'e8000000-0000-4000-8000-000000000001'
  )
  and (
    select
      lead.reentry_count = 1
      and lead.board_order_at > '2026-01-01 10:00:00+00'
      and lead.stage_entered_at = '2026-01-01 10:00:00+00'
      and meta.campaign_name = 'Original campaign'
    from public.leads as lead
    join public.lead_meta as meta on meta.lead_id = lead.id
    where lead.id = 'e9000000-0000-4000-8000-000000000001'
  )
  and exists (
    select 1
    from public.lead_entry_events as event
    where event.id = (
      select (result->>'event_id')::uuid
      from atomic_reentry_results
      where label = 'fresh'
    )
      and event.metadata #>> '{edge_reentry_processing,status}' = 'completed'
  ),
  'fresh processing commits registration, conversation and attribution together'
);

create temporary table atomic_reentry_board_snapshots (
  label text primary key,
  board_order_at timestamptz not null
) on commit drop;

insert into atomic_reentry_board_snapshots (label, board_order_at)
select 'fresh', board_order_at
from public.leads
where id = 'e9000000-0000-4000-8000-000000000001';

update public.lead_meta
set campaign_name = 'Newer human attribution',
    updated_at = '2026-09-08 06:00:00+00'
where lead_id = 'e9000000-0000-4000-8000-000000000001';

update public.whatsapp_conversations
set lead_id = 'e9000000-0000-4000-8000-000000000002'
where id = 'e8000000-0000-4000-8000-000000000001';

insert into atomic_reentry_results (label, result)
values (
  'completed-replay',
  public.process_whatsapp_lead_reentry_from_backend(
    'e1000000-0000-4000-8000-000000000001',
    'e9000000-0000-4000-8000-000000000001',
    'provider-event-fresh',
    'e8000000-0000-4000-8000-000000000001',
    'whatsapp',
    'whatsapp_reentry',
    '{"fixture":"retry"}'::jsonb,
    '{"campaign_name":"Stale retry"}'::jsonb,
    '2026-09-08 05:01:00+00'
  )
);

select ok(
  (
    select
      (result->>'replayed')::boolean
      and not (result->>'inserted')::boolean
    from atomic_reentry_results
    where label = 'completed-replay'
  )
  and (
    select
      meta.campaign_name = 'Newer human attribution'
      and meta.updated_at = '2026-09-08 06:00:00+00'
    from public.lead_meta as meta
    where meta.lead_id = 'e9000000-0000-4000-8000-000000000001'
  )
  and (
    select
      lead.reentry_count = 1
      and lead.stage_entered_at = '2026-01-01 10:00:00+00'
      and lead.board_order_at = (
        select snapshot.board_order_at
        from atomic_reentry_board_snapshots as snapshot
        where snapshot.label = 'fresh'
      )
    from public.leads as lead
    where lead.id = 'e9000000-0000-4000-8000-000000000001'
  )
  and (
    select conversation.lead_id = 'e9000000-0000-4000-8000-000000000002'
    from public.whatsapp_conversations as conversation
    where conversation.id = 'e8000000-0000-4000-8000-000000000001'
  ),
  'completed retry is read-only after the conversation was relinked'
);

delete from public.whatsapp_conversations
where id = 'e8000000-0000-4000-8000-000000000001';

insert into atomic_reentry_results (label, result)
values (
  'completed-replay-deleted-conversation',
  public.process_whatsapp_lead_reentry_from_backend(
    'e1000000-0000-4000-8000-000000000001',
    'e9000000-0000-4000-8000-000000000001',
    'provider-event-fresh',
    'e8000000-0000-4000-8000-000000000001',
    'whatsapp',
    'whatsapp_reentry',
    '[]'::jsonb,
    '{"organization_id":"must-not-be-validated-on-completed-replay"}'::jsonb,
    '2026-09-08 05:02:00+00'
  )
);

select ok(
  (
    select
      (result->>'replayed')::boolean
      and not (result->>'inserted')::boolean
    from atomic_reentry_results
    where label = 'completed-replay-deleted-conversation'
  )
  and not exists (
    select 1
    from public.whatsapp_conversations as conversation
    where conversation.id = 'e8000000-0000-4000-8000-000000000001'
  )
  and (
    select meta.campaign_name = 'Newer human attribution'
    from public.lead_meta as meta
    where meta.lead_id = 'e9000000-0000-4000-8000-000000000001'
  ),
  'completed retry succeeds without validating a deleted conversation or stale projection'
);

insert into atomic_reentry_results (label, result)
values (
  'legacy-register-only',
  public.register_lead_reentry_from_backend(
    'e1000000-0000-4000-8000-000000000001',
    'e9000000-0000-4000-8000-000000000001',
    'evolution_whatsapp',
    'provider-event-legacy-gap',
    'whatsapp',
    'whatsapp_reentry',
    null,
    null,
    '{"fixture":"legacy-gap"}'::jsonb,
    '2026-09-08 07:00:00+00'
  )
);

insert into atomic_reentry_results (label, result)
values (
  'legacy-recovered',
  public.process_whatsapp_lead_reentry_from_backend(
    'e1000000-0000-4000-8000-000000000001',
    'e9000000-0000-4000-8000-000000000001',
    'provider-event-legacy-gap',
    'e8000000-0000-4000-8000-000000000002',
    'whatsapp',
    'whatsapp_reentry',
    '{"fixture":"legacy-recovery"}'::jsonb,
    '{"campaign_name":"Recovered campaign"}'::jsonb,
    '2026-09-08 07:01:00+00'
  )
);

select ok(
  (
    select
      (result->>'recovered_legacy_event')::boolean
      and (result->>'conversation_linked')::boolean
    from atomic_reentry_results
    where label = 'legacy-recovered'
  )
  and (
    select conversation.lead_id = 'e9000000-0000-4000-8000-000000000001'
    from public.whatsapp_conversations as conversation
    where conversation.id = 'e8000000-0000-4000-8000-000000000002'
  )
  and (
    select lead.reentry_count = 2
    from public.leads as lead
    where lead.id = 'e9000000-0000-4000-8000-000000000001'
  ),
  'a previously registered but unfinished event resumes without double-counting'
);

update public.lead_meta
set campaign_name = 'Attribution after legacy event',
    updated_at = '2026-09-08 09:00:00+00'
where lead_id = 'e9000000-0000-4000-8000-000000000001';

insert into atomic_reentry_results (label, result)
values (
  'legacy-register-before-newer-meta',
  public.register_lead_reentry_from_backend(
    'e1000000-0000-4000-8000-000000000001',
    'e9000000-0000-4000-8000-000000000001',
    'evolution_whatsapp',
    'provider-event-legacy-newer-meta',
    'whatsapp',
    'whatsapp_reentry',
    null,
    null,
    '{"fixture":"legacy-newer-meta"}'::jsonb,
    '2026-09-08 08:00:00+00'
  )
);

insert into atomic_reentry_results (label, result)
values (
  'legacy-newer-meta-recovered',
  public.process_whatsapp_lead_reentry_from_backend(
    'e1000000-0000-4000-8000-000000000001',
    'e9000000-0000-4000-8000-000000000001',
    'provider-event-legacy-newer-meta',
    'e8000000-0000-4000-8000-000000000003',
    'whatsapp',
    'whatsapp_reentry',
    '{"fixture":"legacy-newer-meta-recovery"}'::jsonb,
    '{"campaign_name":"Stale legacy attribution"}'::jsonb,
    '2026-09-08 08:01:00+00'
  )
);

select ok(
  (
    select
      (result->>'lead_meta_skipped_newer')::boolean
      and not (result->>'lead_meta_applied')::boolean
    from atomic_reentry_results
    where label = 'legacy-newer-meta-recovered'
  )
  and (
    select
      meta.campaign_name = 'Attribution after legacy event'
      and meta.updated_at = '2026-09-08 09:00:00+00'
    from public.lead_meta as meta
    where meta.lead_id = 'e9000000-0000-4000-8000-000000000001'
  )
  and (
    select conversation.lead_id = 'e9000000-0000-4000-8000-000000000001'
    from public.whatsapp_conversations as conversation
    where conversation.id = 'e8000000-0000-4000-8000-000000000003'
  ),
  'legacy recovery links monotonically but preserves newer attribution'
);

create or replace function pg_temp.reject_atomic_reentry_meta()
returns trigger
language plpgsql
as $$
begin
  if new.lead_id = 'e9000000-0000-4000-8000-000000000002'::uuid then
    raise exception using
      errcode = 'P0001',
      message = 'forced_atomic_reentry_meta_failure';
  end if;
  return new;
end;
$$;

create trigger reject_atomic_reentry_meta
before insert or update on public.lead_meta
for each row execute function pg_temp.reject_atomic_reentry_meta();

select throws_ok(
  $$
    select public.process_whatsapp_lead_reentry_from_backend(
      'e1000000-0000-4000-8000-000000000001',
      'e9000000-0000-4000-8000-000000000002',
      'provider-event-rollback',
      'e8000000-0000-4000-8000-000000000004',
      'whatsapp',
      'whatsapp_reentry',
      '{"fixture":"rollback"}'::jsonb,
      '{"campaign_name":"Must roll back"}'::jsonb,
      '2026-09-08 10:00:00+00'
    )
  $$,
  'P0001',
  'forced_atomic_reentry_meta_failure',
  'a downstream projection failure aborts the aggregate'
);

select ok(
  not exists (
    select 1
    from public.lead_entry_events as event
    where event.organization_id = 'e1000000-0000-4000-8000-000000000001'
      and event.provider = 'evolution_whatsapp'
      and event.provider_event_id = 'provider-event-rollback'
  )
  and (
    select lead.reentry_count = 0
    from public.leads as lead
    where lead.id = 'e9000000-0000-4000-8000-000000000002'
  )
  and (
    select conversation.lead_id is null
    from public.whatsapp_conversations as conversation
    where conversation.id = 'e8000000-0000-4000-8000-000000000004'
  ),
  'registration and conversation linkage roll back with a failed projection'
);

drop trigger reject_atomic_reentry_meta on public.lead_meta;

select throws_ok(
  $$
    select public.process_whatsapp_lead_reentry_from_backend(
      'e1000000-0000-4000-8000-000000000001',
      'e9000000-0000-4000-8000-000000000002',
      'provider-event-invalid-meta',
      'e8000000-0000-4000-8000-000000000004',
      'whatsapp',
      'whatsapp_reentry',
      '{}'::jsonb,
      '{"organization_id":"e1000000-0000-4000-8000-000000000001"}'::jsonb,
      '2026-09-08 10:01:00+00'
    )
  $$,
  '22023',
  'invalid_whatsapp_lead_meta_projection',
  'unrecognized projection keys fail closed before any event is accepted'
);

select * from finish();
rollback;
