begin;

create extension if not exists pgtap with schema extensions;
select plan(131);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
values
  (
    '00000000-0000-0000-0000-000000000000',
    'd1100000-0000-4000-8000-000000000001',
    'authenticated', 'authenticated', 'queue-scope-a@example.test', '', now(),
    '{}', '{}', now(), now(), '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    'd1100000-0000-4000-8000-000000000002',
    'authenticated', 'authenticated', 'queue-scope-b@example.test', '', now(),
    '{}', '{}', now(), now(), '', '', '', ''
  );

insert into public.organizations (id, name, slug, is_active)
values
  ('d1200000-0000-4000-8000-000000000001', 'Queue Scope Org A', 'queue-scope-org-a', true),
  ('d1200000-0000-4000-8000-000000000002', 'Queue Scope Org B', 'queue-scope-org-b', true);

insert into public.users (id, organization_id, name, email, role, is_active)
values
  (
    'd1100000-0000-4000-8000-000000000001',
    'd1200000-0000-4000-8000-000000000001',
    'Queue Scope User A', 'queue-scope-a@example.test', 'admin', true
  ),
  (
    'd1100000-0000-4000-8000-000000000002',
    'd1200000-0000-4000-8000-000000000002',
    'Queue Scope User B', 'queue-scope-b@example.test', 'admin', true
  )
on conflict (id) do update
set organization_id = excluded.organization_id,
    name = excluded.name,
    email = excluded.email,
    role = excluded.role,
    is_active = excluded.is_active;

insert into public.organization_members (
  organization_id, user_id, role, is_active
)
values
  (
    'd1200000-0000-4000-8000-000000000001',
    'd1100000-0000-4000-8000-000000000001',
    'admin', true
  ),
  (
    'd1200000-0000-4000-8000-000000000002',
    'd1100000-0000-4000-8000-000000000002',
    'admin', true
  ),
  (
    'd1200000-0000-4000-8000-000000000001',
    'd1100000-0000-4000-8000-000000000002',
    'user', true
  )
on conflict (user_id, organization_id) do update
set role = excluded.role,
    is_active = excluded.is_active,
    deleted_at = null;

-- Post-tombstone queue-scoped inserts require an operationally visible
-- destination. Keep the shared fixture on active pipelines/stages so tests of
-- lead identity do not accidentally exercise the fail-closed destination
-- guard with an impossible legacy queue.
insert into public.pipelines (
  id, organization_id, name, is_default, is_active, position
)
values
  (
    'd1250000-0000-4000-8000-000000000001',
    'd1200000-0000-4000-8000-000000000001',
    'Queue Scope Pipeline A', true, true, 0
  ),
  (
    'd1250000-0000-4000-8000-000000000002',
    'd1200000-0000-4000-8000-000000000002',
    'Queue Scope Pipeline B', true, true, 0
  );

insert into public.stages (
  id, organization_id, pipeline_id, name, stage_key, position, is_active
)
values
  (
    'd1260000-0000-4000-8000-000000000001',
    'd1200000-0000-4000-8000-000000000001',
    'd1250000-0000-4000-8000-000000000001',
    'Queue Scope Stage A', 'new', 0, true
  ),
  (
    'd1260000-0000-4000-8000-000000000002',
    'd1200000-0000-4000-8000-000000000002',
    'd1250000-0000-4000-8000-000000000002',
    'Queue Scope Stage B', 'new', 0, true
  );

insert into public.round_robins (
  id, organization_id, name, is_active,
  pipeline_id, target_pipeline_id, target_stage_id
)
values
  (
    'd1300000-0000-4000-8000-000000000001',
    'd1200000-0000-4000-8000-000000000001', 'Queue A1', true,
    'd1250000-0000-4000-8000-000000000001',
    'd1250000-0000-4000-8000-000000000001',
    'd1260000-0000-4000-8000-000000000001'
  ),
  (
    'd1300000-0000-4000-8000-000000000002',
    'd1200000-0000-4000-8000-000000000001', 'Queue A2', true,
    'd1250000-0000-4000-8000-000000000001',
    'd1250000-0000-4000-8000-000000000001',
    'd1260000-0000-4000-8000-000000000001'
  ),
  (
    'd1300000-0000-4000-8000-000000000003',
    'd1200000-0000-4000-8000-000000000002', 'Queue B1', true,
    'd1250000-0000-4000-8000-000000000002',
    'd1250000-0000-4000-8000-000000000002',
    'd1260000-0000-4000-8000-000000000002'
  );

insert into public.leads (
  id, organization_id, assigned_user_id, name, phone, source, metadata
)
values (
  'd1400000-0000-4000-8000-000000000006',
  'd1200000-0000-4000-8000-000000000001',
  'd1100000-0000-4000-8000-000000000001',
  'Backfill Evidence Lead', '5511999996000', 'whatsapp',
  jsonb_build_object(
    'target_round_robin_id', 'd1300000-0000-4000-8000-000000000002'
  )
);

insert into public.lead_entry_events (
  lead_id, organization_id, entry_type, source, provider,
  occurred_at, is_countable, metadata, payload
)
values (
  'd1400000-0000-4000-8000-000000000006',
  'd1200000-0000-4000-8000-000000000001',
  'initial', 'whatsapp', 'legacy', now() - interval '1 day', true,
  jsonb_build_object(
    'target_round_robin_id', 'd1300000-0000-4000-8000-000000000001'
  ),
  '{}'::jsonb
);

select is(
  private.infer_lead_intake_origin_queue(
    'd1400000-0000-4000-8000-000000000006'
  ),
  'd1300000-0000-4000-8000-000000000001'::uuid,
  'authoritative initial event A wins over mutable lead metadata from later queue B reentry'
);

select ok(
  pg_catalog.to_regclass('public.leads_org_scope_phone_unique') is not null
  and pg_catalog.to_regclass('public.leads_org_phone_unique') is null,
  'cutover leaves only the queue-scoped normalized-phone identity'
);

-- Recreate a test-org-only namesake briefly to exercise the A1/A2
-- rolling-deploy branch after the final cutover schema has been installed.
-- A real post-B2 clone can already contain intentional same-phone cards in
-- other organizations, so rebuilding the retired global index over every row
-- would make the regression fixture depend on unrelated production-shaped
-- data. The RPC detects this compatibility window by the index name and the
-- fixture below still exercises the matching unique-violation path.
create unique index leads_org_phone_unique
  on public.leads (organization_id, public.normalize_phone(phone))
  where organization_id = 'd1200000-0000-4000-8000-000000000001'::uuid
    and phone is not null
    and btrim(phone) <> ''
    and public.normalize_phone(phone) is not null
    and public.normalize_phone(phone) <> '';

insert into public.leads (
  id, organization_id, origin_round_robin_id, assigned_user_id,
  name, phone, source, metadata
)
values (
  'd1400000-0000-4000-8000-000000000005',
  'd1200000-0000-4000-8000-000000000001',
  'd1300000-0000-4000-8000-000000000001',
  'd1100000-0000-4000-8000-000000000001',
  'Legacy Window Queue A', '5511999995000', 'whatsapp',
  jsonb_build_object(
    'intake_scope_key', 'queue:d1300000-0000-4000-8000-000000000001',
    'origin_round_robin_id', 'd1300000-0000-4000-8000-000000000001',
    'safe', 'old'
  )
);

do $$
begin
  perform *
  from public.upsert_whatsapp_webhook_lead(
    'd1200000-0000-4000-8000-000000000001',
    'Legacy Window Queue B', '5511999995000',
    null, null, null, 'whatsapp', null, null, null, null,
    null, null, 'd1100000-0000-4000-8000-000000000001', null,
    null, null, 'd1100000-0000-4000-8000-000000000001',
    now(), 'whatsapp', now(),
    jsonb_build_object(
      'intake_scope_key', 'queue:d1300000-0000-4000-8000-000000000002',
      'origin_round_robin_id', 'd1300000-0000-4000-8000-000000000002',
      'safe', 'new'
    ),
    'd1300000-0000-4000-8000-000000000002'
  );
end;
$$;

select ok(
  (
    select origin_round_robin_id = 'd1300000-0000-4000-8000-000000000001'::uuid
      and intake_scope_key = 'queue:d1300000-0000-4000-8000-000000000001'
      and metadata->>'intake_scope_key' =
        'queue:d1300000-0000-4000-8000-000000000001'
      and metadata->>'origin_round_robin_id' =
        'd1300000-0000-4000-8000-000000000001'
      and metadata->>'safe' = 'new'
    from public.leads
    where id = 'd1400000-0000-4000-8000-000000000005'
  ),
  'legacy-global compatibility reentry merges ordinary metadata without relabelling queue identity'
);

drop index public.leads_org_phone_unique;

insert into public.leads (
  id, organization_id, origin_round_robin_id, assigned_user_id,
  name, phone, source
)
values (
  'd1400000-0000-4000-8000-000000000001',
  'd1200000-0000-4000-8000-000000000001',
  'd1300000-0000-4000-8000-000000000001',
  'd1100000-0000-4000-8000-000000000001',
  'Queue A1 Lead', '+55 (11) 99999-1000', 'whatsapp'
);

select throws_ok(
  $$
    insert into public.leads (
      organization_id, origin_round_robin_id, name, phone, source
    ) values (
      'd1200000-0000-4000-8000-000000000001',
      'd1300000-0000-4000-8000-000000000001',
      'Duplicate Queue A1', '5511999991000', 'whatsapp'
    )
  $$,
  '23505',
  null,
  'the same normalized phone cannot create a second card in the same queue'
);

select is(
  (
    select upserted.id
    from public.upsert_whatsapp_webhook_lead(
      'd1200000-0000-4000-8000-000000000001',
      'Queue A1 Reentry', '5511999991000',
      null, null, null, 'whatsapp', null, null, null, null,
      null, null, 'd1100000-0000-4000-8000-000000000001', null,
      null, null, 'd1100000-0000-4000-8000-000000000001',
      now(), 'whatsapp', now(), '{}'::jsonb,
      'd1300000-0000-4000-8000-000000000001'
    ) as upserted
  ),
  'd1400000-0000-4000-8000-000000000001'::uuid,
  'queue-aware upsert treats the same phone in the same queue as reentry'
);

select is(
  (
    select count(*)::bigint
    from public.leads
    where organization_id = 'd1200000-0000-4000-8000-000000000001'
      and intake_scope_key = 'queue:d1300000-0000-4000-8000-000000000001'
      and public.normalize_phone(phone) = '5511999991000'
  ),
  1::bigint,
  'same-queue reentry keeps one card'
);

select lives_ok(
  $$
    insert into public.leads (
      id, organization_id, origin_round_robin_id, name, phone, source
    ) values (
      'd1400000-0000-4000-8000-000000000002',
      'd1200000-0000-4000-8000-000000000001',
      'd1300000-0000-4000-8000-000000000002',
      'Queue A2 Lead', '11 99999-1000', 'whatsapp'
    )
  $$,
  'the same phone may create a separate card in another queue'
);

select is(
  (
    select count(*)::bigint
    from public.leads
    where organization_id = 'd1200000-0000-4000-8000-000000000001'
      and public.normalize_phone(phone) = '5511999991000'
  ),
  2::bigint,
  'two queue-scoped cards coexist for one normalized phone'
);

select is(
  (
    select found.id
    from public.find_lead_by_normalized_phone(
      'd1200000-0000-4000-8000-000000000001',
      '5511999991000',
      'd1300000-0000-4000-8000-000000000001'
    ) as found
  ),
  'd1400000-0000-4000-8000-000000000001'::uuid,
  'explicit lookup returns the card from queue A1'
);

select is(
  (
    select found.id
    from public.find_lead_by_normalized_phone(
      'd1200000-0000-4000-8000-000000000001',
      '5511999991000',
      'd1300000-0000-4000-8000-000000000002'
    ) as found
  ),
  'd1400000-0000-4000-8000-000000000002'::uuid,
  'explicit lookup returns the card from queue A2'
);

select throws_ok(
  $$
    select *
    from public.find_lead_by_normalized_phone(
      'd1200000-0000-4000-8000-000000000001',
      '5511999991000'
    )
  $$,
  '23505',
  'whatsapp_lead_phone_ambiguous',
  'legacy lookup fails closed when the phone has multiple cards'
);

insert into public.leads (id, organization_id, name, phone, source)
values (
  'd1400000-0000-4000-8000-000000000003',
  'd1200000-0000-4000-8000-000000000001',
  'Unscoped Lead', '5511999992000', 'manual'
);

select throws_ok(
  $$
    insert into public.leads (organization_id, name, phone, source)
    values (
      'd1200000-0000-4000-8000-000000000001',
      'Duplicate Unscoped', '+55 (11) 99999-2000', 'manual'
    )
  $$,
  '23505',
  null,
  'unscoped legacy cards preserve normalized-phone uniqueness'
);

select is(
  (
    select found.id
    from public.find_lead_by_normalized_phone(
      'd1200000-0000-4000-8000-000000000001',
      '5511999992000'
    ) as found
  ),
  'd1400000-0000-4000-8000-000000000003'::uuid,
  'legacy lookup returns the sole unscoped card'
);

select throws_ok(
  $$
    insert into public.leads (
      organization_id, origin_round_robin_id, name, phone, source
    ) values (
      'd1200000-0000-4000-8000-000000000001',
      'd1300000-0000-4000-8000-000000000003',
      'Foreign Queue Lead', '5511999993000', 'whatsapp'
    )
  $$,
  '23503',
  'lead_origin_round_robin_tenant_mismatch',
  'a queue from another tenant cannot define lead identity'
);

select throws_ok(
  $$
    update public.leads
    set origin_round_robin_id = 'd1300000-0000-4000-8000-000000000002',
        intake_scope_key = 'queue:d1300000-0000-4000-8000-000000000002'
    where id = 'd1400000-0000-4000-8000-000000000001'
  $$,
  '23514',
  'lead_intake_identity_immutable',
  'an established phone identity cannot be relabelled to another queue'
);

insert into public.leads (
  id, organization_id, name, phone, source, meta_lead_id, metadata
)
values (
  'd1400000-0000-4000-8000-000000000004',
  'd1200000-0000-4000-8000-000000000001',
  'Pending Meta Lead', null, 'meta_ads', 'meta-pending-queue-scope',
  '{"meta_details_status":"pending"}'::jsonb
);

select lives_ok(
  $$
    update public.leads
    set phone = '5511999994000',
        origin_round_robin_id = 'd1300000-0000-4000-8000-000000000002',
        intake_scope_key = 'queue:d1300000-0000-4000-8000-000000000002',
        metadata = metadata || '{"meta_details_status":"complete"}'::jsonb
    where id = 'd1400000-0000-4000-8000-000000000004'
  $$,
  'a pending Meta placeholder may atomically claim its first phone and queue'
);

select is(
  (
    select intake_scope_key
    from public.leads
    where id = 'd1400000-0000-4000-8000-000000000004'
  ),
  'queue:d1300000-0000-4000-8000-000000000002',
  'the one-time Meta claim stores the derived queue scope'
);

select is(
  (
    select found.id
    from public.find_lead_by_normalized_phone(
      'd1200000-0000-4000-8000-000000000001',
      '5511999994000'
    ) as found
  ),
  'd1400000-0000-4000-8000-000000000004'::uuid,
  'legacy lookup returns a sole queue-scoped card when it is globally unambiguous'
);

select throws_ok(
  $$
    update public.leads
    set origin_round_robin_id = 'd1300000-0000-4000-8000-000000000001',
        intake_scope_key = 'queue:d1300000-0000-4000-8000-000000000001'
    where id = 'd1400000-0000-4000-8000-000000000004'
  $$,
  '23514',
  'lead_intake_identity_immutable',
  'the claimed Meta identity is immutable after the first phone exists'
);

select lives_ok(
  $$
    update public.round_robins
    set is_active = false,
        deleted_at = clock_timestamp()
    where id = 'd1300000-0000-4000-8000-000000000001'
  $$,
  'deleting an originating queue retains an inactive identity tombstone'
);

select ok(
  (
    select is_active is false and deleted_at is not null
    from public.round_robins
    where id = 'd1300000-0000-4000-8000-000000000001'
  ),
  'the deleted queue UUID remains resolvable but cannot route new intake'
);

select is(
  private.lead_intake_scope_for_queue(
    'd1200000-0000-4000-8000-000000000001',
    'd1300000-0000-4000-8000-000000000001'
  ),
  'queue:d1300000-0000-4000-8000-000000000001',
  'a delayed replay can still derive the immutable scope from a queue tombstone'
);

select ok(
  (
    select origin_round_robin_id = 'd1300000-0000-4000-8000-000000000001'::uuid
      and intake_scope_key = 'queue:d1300000-0000-4000-8000-000000000001'
    from public.leads
    where id = 'd1400000-0000-4000-8000-000000000001'
  ),
  'queue deletion preserves the immutable origin UUID and scope key'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.find_lead_by_normalized_phone(uuid,text,uuid)',
    'execute'
  )
  and has_function_privilege(
    'service_role',
    'public.activate_whatsapp_conversation_lead_binding(uuid,uuid,uuid,text)',
    'execute'
  )
  and has_function_privilege(
    'service_role',
    'public.activate_whatsapp_conversation_lead_binding(uuid,uuid,uuid,text,text)',
    'execute'
  )
  and has_function_privilege(
    'service_role',
    'public.activate_whatsapp_conversation_lead_binding_if_current(uuid,uuid,uuid,text,uuid,uuid)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.find_lead_by_normalized_phone(uuid,text,uuid)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'public.activate_whatsapp_conversation_lead_binding(uuid,uuid,uuid,text)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.activate_whatsapp_conversation_lead_binding(uuid,uuid,uuid,text,text)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.activate_whatsapp_conversation_lead_binding_if_current(uuid,uuid,uuid,text,uuid,uuid)',
    'execute'
  ),
  'queue lookup and explicit/intake binding activation remain service-role-only'
);

select ok(
  (
    select relrowsecurity
    from pg_catalog.pg_class
    where oid = 'public.whatsapp_conversation_lead_bindings'::regclass
  )
  and not has_table_privilege(
    'authenticated',
    'public.whatsapp_conversation_lead_bindings',
    'select'
  )
  and not has_table_privilege(
    'anon',
    'public.whatsapp_conversation_lead_bindings',
    'select'
  ),
  'binding history is RLS-enabled and unavailable to browser roles'
);

select ok(
  pg_catalog.obj_description(
    'private.enforce_whatsapp_conversation_active_binding_consistency()'::regprocedure,
    'pg_proc'
  ) like 'vimob.queue_scoped_binding_consistency.v1:%'
  and (
    select count(*) = 2
      and bool_and(trigger_state.tgenabled in ('O', 'A'))
      and bool_and(trigger_state.tgdeferrable)
      and bool_and(trigger_state.tginitdeferred)
    from pg_catalog.pg_trigger as trigger_state
    where not trigger_state.tgisinternal
      and (
        (
          trigger_state.tgrelid = 'public.whatsapp_conversations'::regclass
          and trigger_state.tgname =
            'enforce_whatsapp_conversation_active_binding_consistency'
        )
        or (
          trigger_state.tgrelid =
            'public.whatsapp_conversation_lead_bindings'::regclass
          and trigger_state.tgname =
            'enforce_whatsapp_binding_active_conversation_consistency'
        )
      )
  )
  and pg_catalog.has_table_privilege(
    'service_role',
    'public.whatsapp_conversation_lead_bindings',
    'SELECT'
  )
  and not exists (
    select 1
    from unnest(array['anon', 'authenticated', 'service_role']::text[]) as writer(role_name)
    cross join unnest(
      array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']::text[]
    ) as operation(privilege_name)
    where pg_catalog.has_table_privilege(
      writer.role_name,
      'public.whatsapp_conversation_lead_bindings',
      operation.privilege_name
    )
  )
  and not pg_catalog.has_function_privilege(
    'service_role',
    'public.rebind_whatsapp_conversation_session(uuid,uuid)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'service_role',
    'public.rebind_whatsapp_conversation_session(uuid,uuid,text)',
    'EXECUTE'
  ),
  'B1 makes the binding ledger RPC-only and enforces strict deferred final-state consistency from both tables'
);

select ok(
  not exists (
    select 1
    from unnest(array['anon', 'authenticated']::text[]) as browser(role_name)
    cross join unnest(
      array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']::text[]
    ) as operation(privilege_name)
    where pg_catalog.has_table_privilege(
      browser.role_name,
      'public.whatsapp_messages',
      operation.privilege_name
    )
  )
  and not exists (
    select 1
    from pg_catalog.pg_policies as policy
    where policy.schemaname = 'public'
      and policy.tablename = 'whatsapp_messages'
      and policy.cmd = any (array['ALL', 'INSERT', 'UPDATE', 'DELETE']::text[])
      and policy.roles && array['public', 'anon', 'authenticated']::name[]
  )
  and pg_catalog.has_table_privilege(
    'service_role',
    'public.whatsapp_messages',
    'INSERT'
  )
  and pg_catalog.has_table_privilege(
    'service_role',
    'public.whatsapp_messages',
    'UPDATE'
  ),
  'browser roles cannot forge canonical message provenance while the backend writer remains authorized'
);

select ok(
  pg_catalog.obj_description(
    'private.enforce_canonical_whatsapp_outbox_lead_binding()'::regprocedure,
    'pg_proc'
  ) like 'vimob.queue_scoped_outbox_binding.v2:%'
  and exists (
    select 1
    from pg_catalog.pg_trigger as trigger_state
    where trigger_state.tgrelid = 'public.whatsapp_outbox'::regclass
      and trigger_state.tgname =
        'enforce_canonical_whatsapp_outbox_lead_binding_before_write'
      and not trigger_state.tgisinternal
      and trigger_state.tgenabled in ('O', 'A')
      and trigger_state.tgtype = 23
      and (
        select count(*)
        from pg_catalog.pg_attribute as attribute
        where attribute.attrelid = trigger_state.tgrelid
          and attribute.attname = any (
            array[
              'organization_id',
              'session_id',
              'conversation_id',
              'message_id',
              'status'
            ]::name[]
          )
          and attribute.attnum = any (trigger_state.tgattr)
      ) = 5
  ),
  'canonical outbox v2 trigger runs for inserts and status/message context updates in normal sessions'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_attribute as attribute
    where attribute.attrelid = 'public.outbox_messages'::regclass
      and attribute.attname = 'lead_id'
      and not attribute.attisdropped
  )
  and not exists (
    select 1
    from pg_catalog.pg_constraint as constraint_definition
    join pg_catalog.pg_attribute as attribute
      on attribute.attrelid = constraint_definition.conrelid
     and attribute.attnum = any (constraint_definition.conkey)
    where constraint_definition.conrelid = 'public.outbox_messages'::regclass
      and constraint_definition.contype = 'f'
      and attribute.attname = 'lead_id'
  ),
  'legacy outbox stores immutable lead provenance without a deletion-sensitive FK'
);

select ok(
  not exists (
    select 1
    from public.whatsapp_messages as message
    join public.whatsapp_conversations as conversation
      on conversation.id = message.conversation_id
     and conversation.organization_id = message.organization_id
    where conversation.lead_id is not null
      and message.lead_id is null
  ),
  'cutover leaves no linked-conversation message with floating NULL lead attribution'
);

insert into public.leads (id, organization_id, assigned_user_id, name, phone, source)
values
  (
    'd1400000-0000-4000-8000-000000000010',
    'd1200000-0000-4000-8000-000000000001',
    'd1100000-0000-4000-8000-000000000001',
    'Binding Lead A', '5511988880010', 'whatsapp'
  ),
  (
    'd1400000-0000-4000-8000-000000000011',
    'd1200000-0000-4000-8000-000000000001',
    'd1100000-0000-4000-8000-000000000002',
    'Binding Lead B', '5511988880011', 'whatsapp'
  ),
  (
    'd1400000-0000-4000-8000-000000000012',
    'd1200000-0000-4000-8000-000000000001',
    'd1100000-0000-4000-8000-000000000001',
    'Binding Lead C', '5511988880012', 'whatsapp'
  ),
  (
    'd1400000-0000-4000-8000-000000000024',
    'd1200000-0000-4000-8000-000000000001',
    'd1100000-0000-4000-8000-000000000001',
    'Strict Trigger Fixture', '5511988880024', 'whatsapp'
  ),
  (
    'd1400000-0000-4000-8000-000000000021',
    'd1200000-0000-4000-8000-000000000001',
    'd1100000-0000-4000-8000-000000000001',
    'Manual CAS Unlinked Winner', '5511988880021', 'whatsapp'
  ),
  (
    'd1400000-0000-4000-8000-000000000022',
    'd1200000-0000-4000-8000-000000000001',
    'd1100000-0000-4000-8000-000000000001',
    'Manual CAS Stale Target', '5511988880022', 'whatsapp'
  ),
  (
    'd1400000-0000-4000-8000-000000000023',
    'd1200000-0000-4000-8000-000000000001',
    'd1100000-0000-4000-8000-000000000001',
    'Manual CAS Linked Winner', '5511988880023', 'whatsapp'
  );

insert into public.leads (id, organization_id, assigned_user_id, name, phone, source)
values (
  'd1400000-0000-4000-8000-000000000099',
  'd1200000-0000-4000-8000-000000000002',
  'd1100000-0000-4000-8000-000000000002',
  'Foreign Binding Lead', '5511977770099', 'whatsapp'
);

insert into public.whatsapp_sessions (
  id, organization_id, owner_user_id, instance_name, provider, status, is_active
)
values (
  'd1500000-0000-4000-8000-000000000001',
  'd1200000-0000-4000-8000-000000000001',
  'd1100000-0000-4000-8000-000000000001',
  'queue-scope-binding-session', 'evolution_go', 'connected', true
);

insert into public.whatsapp_conversations (
  id, organization_id, session_id, remote_jid, contact_phone, contact_name
)
values (
  'd1600000-0000-4000-8000-000000000001',
  'd1200000-0000-4000-8000-000000000001',
  'd1500000-0000-4000-8000-000000000001',
  '5511988880010@s.whatsapp.net', '5511988880010', 'Binding Contact'
);

insert into public.whatsapp_conversations (
  id, organization_id, session_id, remote_jid, contact_phone, contact_name
)
values (
  'd1600000-0000-4000-8000-000000000099',
  'd1200000-0000-4000-8000-000000000001',
  'd1500000-0000-4000-8000-000000000001',
  '5511988880098@s.whatsapp.net', '5511988880098', 'Quarantine Contact'
);

select lives_ok(
  $$
    insert into public.whatsapp_messages (
      id, organization_id, conversation_id, session_id, lead_id,
      provider_message_id, message_id, from_me, direction,
      message_type, content, status
    ) values (
      'd1700000-0000-4000-8000-000000000099',
      'd1200000-0000-4000-8000-000000000001',
      'd1600000-0000-4000-8000-000000000099',
      'd1500000-0000-4000-8000-000000000001',
      null,
      'provider-quarantine', 'provider-quarantine', false, 'inbound',
      'text', 'Unlinked quarantine message', 'received'
    )
  $$,
  'a truly unlinked quarantine conversation may persist a NULL-lead message'
);

select is(
  (
    select lead_id
    from public.whatsapp_messages
    where id = 'd1700000-0000-4000-8000-000000000099'
  ),
  null::uuid,
  'the quarantine message remains explicitly unlinked'
);

select throws_ok(
  $$
    insert into public.whatsapp_messages (
      organization_id, conversation_id, session_id, lead_id,
      provider_message_id, message_id, from_me, direction,
      message_type, content, status
    ) values (
      'd1200000-0000-4000-8000-000000000001',
      'd1600000-0000-4000-8000-000000000099',
      'd1500000-0000-4000-8000-000000000001',
      'd1400000-0000-4000-8000-000000000010',
      'provider-quarantine-wrong', 'provider-quarantine-wrong', false, 'inbound',
      'text', 'Must not attach without binding', 'received'
    )
  $$,
  '23514',
  'whatsapp_message_active_binding_required',
  'an unlinked conversation cannot accept a lead without an active binding'
);

create temporary table queue_scope_binding_results (
  label text primary key,
  result jsonb not null
) on commit drop;

insert into queue_scope_binding_results (label, result)
values (
  'lead-a',
  public.activate_whatsapp_conversation_lead_binding(
    'd1200000-0000-4000-8000-000000000001',
    'd1600000-0000-4000-8000-000000000001',
    'd1400000-0000-4000-8000-000000000010',
    'provider-binding-a'
  )
);

select ok(
  (
    select result ?& array[
      'success', 'changed', 'conversation_id', 'lead_id',
      'previous_lead_id', 'binding_id', 'is_current', 'active_lead_id'
    ]
    from queue_scope_binding_results
    where label = 'lead-a'
  ),
  'activation returns the complete attribution and current-state shape'
);

select is(
  (select result->>'changed' from queue_scope_binding_results where label = 'lead-a'),
  'true',
  'first activation reports a changed binding'
);

select ok(
  (
    select (result->>'is_current')::boolean
      and (result->>'active_lead_id')::uuid = 'd1400000-0000-4000-8000-000000000010'::uuid
    from queue_scope_binding_results
    where label = 'lead-a'
  ),
  'first activation reports the lead as current'
);

select is(
  (
    select count(*)::bigint
    from public.whatsapp_conversation_lead_bindings
    where conversation_id = 'd1600000-0000-4000-8000-000000000001'
      and active_to is null
  ),
  1::bigint,
  'a conversation has exactly one active binding'
);

select ok(
  (
    with snapshot as (
      select private.capture_whatsapp_webhook_routing_snapshot(
        'd1200000-0000-4000-8000-000000000001',
        'd1500000-0000-4000-8000-000000000001',
        'provider-ingress-bound-a',
        'inbox-ingress-bound-a',
        'live',
        'phone:5511988880010',
        true,
        array[
          '5511988880010@s.whatsapp.net',
          '5511988880098@s.whatsapp.net'
        ],
        '5511988880010',
        'organic', null,
        false, false, false,
        null, null, null
      ) as value
    )
    select value->>'state' = 'bound'
      and (value->>'conversation_id')::uuid = 'd1600000-0000-4000-8000-000000000001'::uuid
      and (value->>'event_lead_id')::uuid = 'd1400000-0000-4000-8000-000000000010'::uuid
      and (value->>'active_binding_id')::uuid is not null
    from snapshot
  ),
  'ingress freezes the primary canonical conversation and active card before ACK'
);

select ok(
  (
    with snapshot as (
      select private.capture_whatsapp_webhook_routing_snapshot(
        'd1200000-0000-4000-8000-000000000001',
        'd1500000-0000-4000-8000-000000000001',
        'provider-binding-a',
        'inbox-provider-binding-a-replay',
        'live',
        'phone:5511988880010',
        true,
        array['5511988880010@s.whatsapp.net'],
        '5511988880010',
        'organic', null,
        false, false, false,
        null, null, null
      ) as value
    )
    select value->>'state' = 'provider_replay'
      and (value->>'event_lead_id')::uuid = 'd1400000-0000-4000-8000-000000000010'::uuid
    from snapshot
  ),
  'provider replay recovers immutable event-card provenance instead of current phone routing'
);

select throws_ok(
  $$
    select private.capture_whatsapp_webhook_routing_snapshot(
      'd1200000-0000-4000-8000-000000000002',
      'd1500000-0000-4000-8000-000000000001',
      'provider-cross-tenant',
      'inbox-provider-cross-tenant',
      'live',
      'phone:5511988880010',
      true,
      array['5511988880010@s.whatsapp.net'],
      '5511988880010',
      'organic', null,
      false, false, false,
      null, null, null
    )
  $$,
  '23503',
  'whatsapp_ingress_snapshot_session_mismatch',
  'ingress routing snapshot rejects a cross-tenant session'
);

select throws_ok(
  $$
    insert into public.whatsapp_webhook_inbox (
      organization_id, session_id, provider, event_key, event_type,
      payload, processing_lane, status, next_attempt_at, expires_at
    ) values (
      'd1200000-0000-4000-8000-000000000001',
      'd1500000-0000-4000-8000-000000000001',
      'evolution_go', 'queue-scope-missing-snapshot', 'messages.upsert',
      '{}'::jsonb, 'live', 'pending', now(), now() + interval '1 day'
    )
  $$,
  '23514',
  'new row for relation "whatsapp_webhook_inbox" violates check constraint "whatsapp_webhook_active_routing_snapshot_v1_check"',
  'B1 rejects every newly active inbox row without a v1 routing snapshot'
);

insert into public.whatsapp_webhook_inbox (
  organization_id, session_id, provider, event_key, event_type,
  payload, processing_lane, status, next_attempt_at, expires_at
) values (
  'd1200000-0000-4000-8000-000000000001',
  'd1500000-0000-4000-8000-000000000001',
  'evolution_go', 'queue-scope-immutable-snapshot', 'messages.upsert',
  '{"__vimob_ingress":{"routing_snapshot":{"version":1,"messages":[]}}}'::jsonb,
  'live', 'pending', now(), now() + interval '1 day'
);

select throws_ok(
  $$
    update public.whatsapp_webhook_inbox as inbox
    set payload = jsonb_set(
      inbox.payload,
      '{__vimob_ingress,routing_snapshot,version}',
      '2'::jsonb
    )
    where inbox.event_key = 'queue-scope-immutable-snapshot'
  $$,
  '23514',
  'whatsapp_webhook_routing_snapshot_immutable',
  'an accepted inbox routing snapshot cannot be rewritten later'
);

select throws_ok(
  $$
    update public.whatsapp_conversations
    set lead_id = 'd1400000-0000-4000-8000-000000000011'
    where id = 'd1600000-0000-4000-8000-000000000001';
    set constraints enforce_whatsapp_conversation_active_binding_consistency immediate
  $$,
  '23514',
  'whatsapp_conversation_active_binding_mismatch',
  'a rolling-deploy legacy writer cannot commit a conversation lead divergent from an active binding'
);

select throws_ok(
  $$
    insert into public.whatsapp_conversations (
      id, organization_id, session_id, lead_id, remote_jid, contact_name
    ) values (
      'd1600000-0000-4000-8000-000000000007',
      'd1200000-0000-4000-8000-000000000001',
      'd1500000-0000-4000-8000-000000000001',
      'd1400000-0000-4000-8000-000000000024',
      '5511988880077@s.whatsapp.net',
      'Direct linked insert without binding'
    );
    set constraints enforce_whatsapp_conversation_active_binding_consistency immediate
  $$,
  '23514',
  'whatsapp_conversation_active_binding_mismatch',
  'a directly inserted linked conversation cannot commit without an exact active binding'
);

select throws_ok(
  $$
    update public.whatsapp_conversation_lead_bindings
    set active_to = greatest(clock_timestamp(), active_from + interval '1 microsecond')
    where conversation_id = 'd1600000-0000-4000-8000-000000000001'
      and active_to is null;
    set constraints enforce_whatsapp_binding_active_conversation_consistency immediate
  $$,
  '23514',
  'whatsapp_conversation_active_binding_mismatch',
  'an active binding cannot be closed directly without a coherent replacement in the same transaction'
);

select lives_ok(
  $$
    insert into public.whatsapp_messages (
      id, organization_id, conversation_id, session_id, lead_id,
      provider_message_id, message_id, from_me, direction,
      message_type, content, remote_jid, status
    ) values (
      'd1700000-0000-4000-8000-000000000001',
      'd1200000-0000-4000-8000-000000000001',
      'd1600000-0000-4000-8000-000000000001',
      'd1500000-0000-4000-8000-000000000001',
      null,
      'provider-binding-a', 'provider-binding-a', false, 'inbound',
      'text', 'Historical message for lead A',
      '5511988880010@s.whatsapp.net', 'received'
    )
  $$,
  'a provider event is stored under its ledgered lead'
);

select is(
  (
    select lead_id
    from public.whatsapp_messages
    where id = 'd1700000-0000-4000-8000-000000000001'
  ),
  'd1400000-0000-4000-8000-000000000010'::uuid,
  'the strict insert path freezes an omitted lead_id to active lead A'
);

select lives_ok(
  $$
    insert into public.whatsapp_messages (
      id, organization_id, conversation_id, session_id, lead_id,
      provider_message_id, message_id, from_me, direction,
      message_type, content, status, metadata
    ) values (
      'd1700000-0000-4000-8000-000000000098',
      'd1200000-0000-4000-8000-000000000001',
      'd1600000-0000-4000-8000-000000000001',
      'd1500000-0000-4000-8000-000000000001',
      null,
      'provider-quarantine-linked', 'provider-quarantine-linked',
      false, 'inbound', 'text', 'Ambiguous terminal quarantine', 'received',
      jsonb_build_object(
        'source', 'evolution_go_webhook',
        'lead_resolution_quarantine', jsonb_build_object(
          'reason', 'whatsapp_lead_resolution_ambiguous',
          'terminal', true,
          'retryable', false,
          'recorded_at', '2026-09-19T12:00:00Z'
        )
      )
    )
  $$,
  'an explicit terminal ambiguity quarantine survives in a linked physical conversation'
);

select is(
  (
    select lead_id
    from public.whatsapp_messages
    where id = 'd1700000-0000-4000-8000-000000000098'
  ),
  null::uuid,
  'the strict insert trigger never attributes a terminal ambiguity quarantine to the active card'
);

insert into public.whatsapp_contact_identity_aliases (
  id, organization_id, session_id, alias_jid, canonical_jid,
  contact_phone, lead_id
)
values (
  'd1800000-0000-4000-8000-000000000010',
  'd1200000-0000-4000-8000-000000000001',
  'd1500000-0000-4000-8000-000000000001',
  '5511988880010@s.whatsapp.net',
  '5511988880010@s.whatsapp.net',
  '5511988880010',
  'd1400000-0000-4000-8000-000000000010'
);

update public.whatsapp_conversations
set
  last_message = 'private A body',
  last_message_preview = 'private A preview',
  last_message_at = now(),
  last_message_received_at = now(),
  unread_count = 7,
  archived_at = now()
where id = 'd1600000-0000-4000-8000-000000000001';

update public.whatsapp_messages
set client_message_id = 'queue-scope-canonical-a'
where id = 'd1700000-0000-4000-8000-000000000001';

insert into public.ai_agents (
  id, organization_id, session_id, name, status
)
values (
  'd1800000-0000-4000-8000-000000000001',
  'd1200000-0000-4000-8000-000000000001',
  'd1500000-0000-4000-8000-000000000001',
  'Queue Scope Legacy Agent', 'active'
);

insert into public.ai_global_agents (id, slug, name)
values (
  'd1800000-0000-4000-8000-000000000002',
  'queue-scope-global-agent', 'Queue Scope Global Agent'
);

insert into public.conversation_ai_state (
  id, organization_id, lead_id, conversation_id,
  last_response_id, memory, active_agent_id
)
values (
  'd1800000-0000-4000-8000-000000000003',
  'd1200000-0000-4000-8000-000000000001',
  'd1400000-0000-4000-8000-000000000010',
  'd1600000-0000-4000-8000-000000000001',
  'response-private-a', '{"private":"lead-a"}'::jsonb,
  'd1800000-0000-4000-8000-000000000001'
);

insert into public.ai_agent_conversations (
  id, agent_id, conversation_id, lead_id, memory_summary
)
values (
  'd1800000-0000-4000-8000-000000000004',
  'd1800000-0000-4000-8000-000000000001',
  'd1600000-0000-4000-8000-000000000001',
  'd1400000-0000-4000-8000-000000000010',
  'private memory from lead A'
);

insert into public.ai_conversation_states (
  id, organization_id, conversation_id, agent_id, status, summary
)
values (
  'd1800000-0000-4000-8000-000000000005',
  'd1200000-0000-4000-8000-000000000001',
  'd1600000-0000-4000-8000-000000000001',
  'd1800000-0000-4000-8000-000000000002',
  'processing', 'private summary from lead A'
);

insert into public.chatbot_conversation_state (
  organization_id, conversation_id, last_response_id
)
values (
  'd1200000-0000-4000-8000-000000000001',
  'd1600000-0000-4000-8000-000000000001',
  'private-chatbot-response-a'
);

insert into public.ai_jobs (
  id, organization_id, conversation_id, agent_id, status, payload
)
values (
  'd1800000-0000-4000-8000-000000000006',
  'd1200000-0000-4000-8000-000000000001',
  'd1600000-0000-4000-8000-000000000001',
  'd1800000-0000-4000-8000-000000000002',
  'pending', '{"lead_id":"d1400000-0000-4000-8000-000000000010"}'::jsonb
);

insert into public.jobs (
  id, organization_id, job_type, payload, status
)
values (
  'd1800000-0000-4000-8000-00000000000a',
  'd1200000-0000-4000-8000-000000000001',
  'whatsapp_ai_autoreply',
  jsonb_build_object(
    'conversationId', 'd1600000-0000-4000-8000-000000000001',
    'messageId', 'd1700000-0000-4000-8000-000000000001',
    'expectedLeadId', 'd1400000-0000-4000-8000-000000000010'
  ),
  'queued'
);

insert into public.ai_outbox_messages (
  id, organization_id, conversation_id, agent_id, job_id,
  status, content, approval_required
)
values (
  'd1800000-0000-4000-8000-000000000007',
  'd1200000-0000-4000-8000-000000000001',
  'd1600000-0000-4000-8000-000000000001',
  'd1800000-0000-4000-8000-000000000002',
  'd1800000-0000-4000-8000-000000000006',
  'approved', 'private generated reply for lead A', false
);

insert into public.automations (
  id, organization_id, name, trigger_type, is_active
)
values (
  'd1900000-0000-4000-8000-000000000001',
  'd1200000-0000-4000-8000-000000000001',
  'Queue Scope Pending Automation', 'manual', false
);

insert into public.automation_flow_versions (
  id, automation_id, organization_id, version, trigger_type,
  graph, graph_checksum, first_node_key
)
values (
  'd1900000-0000-4000-8000-000000000002',
  'd1900000-0000-4000-8000-000000000001',
  'd1200000-0000-4000-8000-000000000001',
  1, 'manual', '{}'::jsonb, 'queue-scope-checksum', 'send-a'
);

insert into public.automation_event_outbox (
  id, organization_id, event_type, aggregate_type, aggregate_id,
  lead_id, conversation_id, dedupe_key, payload, status
)
values (
  'd1900000-0000-4000-8000-000000000006',
  'd1200000-0000-4000-8000-000000000001',
  'message_received', 'whatsapp_message',
  'd1700000-0000-4000-8000-000000000001',
  'd1400000-0000-4000-8000-000000000010',
  'd1600000-0000-4000-8000-000000000001',
  'queue-scope-pending-event-a',
  '{"lead_id":"d1400000-0000-4000-8000-000000000010"}'::jsonb,
  'pending'
);

insert into public.automation_executions (
  id, automation_id, lead_id, conversation_id, organization_id,
  status, flow_version_id, current_node_key, locked_at, locked_by
)
values (
  'd1900000-0000-4000-8000-000000000003',
  'd1900000-0000-4000-8000-000000000001',
  'd1400000-0000-4000-8000-000000000010',
  'd1600000-0000-4000-8000-000000000001',
  'd1200000-0000-4000-8000-000000000001',
  'waiting', 'd1900000-0000-4000-8000-000000000002',
  'send-a', null, null
);

insert into public.automation_execution_steps (
  id, execution_id, organization_id, flow_version_id,
  node_key, node_type, action_type, status
)
values (
  'd1900000-0000-4000-8000-000000000004',
  'd1900000-0000-4000-8000-000000000003',
  'd1200000-0000-4000-8000-000000000001',
  'd1900000-0000-4000-8000-000000000002',
  'send-a', 'action', 'send_message', 'waiting'
);

insert into public.automation_effect_dispatches (
  id, organization_id, execution_id, node_key,
  effect_key, effect_type, status, request
)
values (
  'd1900000-0000-4000-8000-000000000005',
  'd1200000-0000-4000-8000-000000000001',
  'd1900000-0000-4000-8000-000000000003',
  'send-a', 'queue-scope-old-lead-effect', 'send.text',
  'sending', '{"lead_id":"d1400000-0000-4000-8000-000000000010"}'::jsonb
);

insert into public.whatsapp_outbox (
  id, organization_id, session_id, conversation_id, message_id,
  client_message_id, recipient_jid, message_type, payload, status
)
values (
  'd1800000-0000-4000-8000-000000000008',
  'd1200000-0000-4000-8000-000000000001',
  'd1500000-0000-4000-8000-000000000001',
  'd1600000-0000-4000-8000-000000000001',
  'd1700000-0000-4000-8000-000000000001',
  'queue-scope-canonical-a', '5511988880010@s.whatsapp.net',
  'text', '{}'::jsonb, 'pending'
);

insert into public.outbox_messages (
  id, organization_id, session_id, conversation_id,
  content, message_type, status, client_message_id
)
values (
  'd1800000-0000-4000-8000-000000000009',
  'd1200000-0000-4000-8000-000000000001',
  'd1500000-0000-4000-8000-000000000001',
  'd1600000-0000-4000-8000-000000000001',
  'private legacy reply for lead A', 'text', 'pending',
  'queue-scope-legacy-a'
);

select is(
  (
    select lead_id
    from public.outbox_messages
    where id = 'd1800000-0000-4000-8000-000000000009'
  ),
  'd1400000-0000-4000-8000-000000000010'::uuid,
  'legacy outbox snapshots lead A instead of resolving the mutable conversation later'
);

select throws_ok(
  $$
    insert into public.outbox_messages (
      organization_id, session_id, conversation_id, lead_id,
      content, message_type, status, client_message_id
    ) values (
      'd1200000-0000-4000-8000-000000000001',
      'd1500000-0000-4000-8000-000000000001',
      'd1600000-0000-4000-8000-000000000001',
      'd1400000-0000-4000-8000-000000000011',
      'must not cross from B into A', 'text', 'pending',
      'queue-scope-wrong-lead'
    )
  $$,
  '23514',
  'whatsapp_outbox_lead_binding_mismatch',
  'legacy outbox rejects an explicit lead outside the active binding'
);

update public.whatsapp_outbox
set status = 'processing',
    locked_at = now(),
    locked_by = 'queue-scope-in-flight-worker'
where id = 'd1800000-0000-4000-8000-000000000008';

select throws_ok(
  $$
    select public.activate_whatsapp_conversation_lead_binding(
      'd1200000-0000-4000-8000-000000000001',
      'd1600000-0000-4000-8000-000000000001',
      'd1400000-0000-4000-8000-000000000011',
      'provider-binding-in-flight-attempt'
    )
  $$,
  '55000',
  'whatsapp_binding_switch_delivery_in_flight',
  'a binding switch fails closed while a provider delivery is in flight'
);

select is(
  (
    select lead_id
    from public.whatsapp_conversations
    where id = 'd1600000-0000-4000-8000-000000000001'
  ),
  'd1400000-0000-4000-8000-000000000010'::uuid,
  'an in-flight rejection leaves conversation A and its active binding unchanged'
);

update public.whatsapp_outbox
set status = 'pending',
    locked_at = null,
    locked_by = null
where id = 'd1800000-0000-4000-8000-000000000008';

select throws_ok(
  $$
    select public.activate_whatsapp_conversation_lead_binding(
      'd1200000-0000-4000-8000-000000000001',
      'd1600000-0000-4000-8000-000000000001',
      'd1400000-0000-4000-8000-000000000011',
      'provider-binding-automation-in-flight-attempt'
    )
  $$,
  '55000',
  'whatsapp_binding_switch_delivery_in_flight',
  'a sending automation effect also fences a binding switch'
);

-- External delivery reconciliation is deliberately outside the binding RPC.
-- Only after the provider outcome is terminal may the conversation switch.
update public.automation_effect_dispatches
set status = 'failed',
    completed_at = now(),
    error_message = 'reconciled_before_binding_switch'
where id = 'd1900000-0000-4000-8000-000000000005';

update public.jobs
set status = 'processing',
    locked_at = now()
where id = 'd1800000-0000-4000-8000-00000000000a';

select throws_ok(
  $$
    select public.activate_whatsapp_conversation_lead_binding(
      'd1200000-0000-4000-8000-000000000001',
      'd1600000-0000-4000-8000-000000000001',
      'd1400000-0000-4000-8000-000000000011',
      'provider-binding-go-autoreply-in-flight-attempt'
    )
  $$,
  '55000',
  'whatsapp_binding_switch_delivery_in_flight',
  'a processing Go auto-reply job fences a binding switch'
);

update public.jobs
set status = 'queued',
    locked_at = null
where id = 'd1800000-0000-4000-8000-00000000000a';

update public.automation_event_outbox
set status = 'processing',
    locked_at = now(),
    locked_by = 'queue-scope-automation-event-worker'
where id = 'd1900000-0000-4000-8000-000000000006';

select throws_ok(
  $$
    select public.activate_whatsapp_conversation_lead_binding(
      'd1200000-0000-4000-8000-000000000001',
      'd1600000-0000-4000-8000-000000000001',
      'd1400000-0000-4000-8000-000000000011',
      'provider-binding-automation-event-in-flight-attempt'
    )
  $$,
  '55000',
  'whatsapp_binding_switch_delivery_in_flight',
  'a processing automation event fences a binding switch before it creates an execution'
);

update public.automation_event_outbox
set status = 'pending',
    locked_at = null,
    locked_by = null
where id = 'd1900000-0000-4000-8000-000000000006';

insert into queue_scope_binding_results (label, result)
values (
  'lead-b',
  public.activate_whatsapp_conversation_lead_binding(
    'd1200000-0000-4000-8000-000000000001',
    'd1600000-0000-4000-8000-000000000001',
    'd1400000-0000-4000-8000-000000000011',
    'provider-binding-b'
  )
);

select ok(
  (
    select (result->>'changed')::boolean
      and (result->>'previous_lead_id')::uuid = 'd1400000-0000-4000-8000-000000000010'::uuid
    from queue_scope_binding_results
    where label = 'lead-b'
  ),
  'switching to lead B records lead A as the previous lead'
);

select ok(
  (
    select conversation.assigned_user_id = 'd1100000-0000-4000-8000-000000000002'::uuid
      and identity_alias.lead_id = 'd1400000-0000-4000-8000-000000000011'::uuid
    from public.whatsapp_conversations as conversation
    join public.whatsapp_contact_identity_aliases as identity_alias
      on identity_alias.organization_id = conversation.organization_id
     and identity_alias.session_id = conversation.session_id
     and identity_alias.alias_jid = conversation.remote_jid
    where conversation.id = 'd1600000-0000-4000-8000-000000000001'
  ),
  'switching to B accepts its active multi-org member assignee and advances the contact alias'
);

insert into queue_scope_binding_results (label, result)
values (
  'stale-a-after-b',
  public.activate_whatsapp_conversation_lead_binding_if_current(
    'd1200000-0000-4000-8000-000000000001',
    'd1600000-0000-4000-8000-000000000001',
    'd1400000-0000-4000-8000-000000000010',
    'provider-stale-a-after-b',
    (
      select (result->>'binding_id')::uuid
      from queue_scope_binding_results
      where label = 'lead-a'
    ),
    'd1400000-0000-4000-8000-000000000010'
  )
);

select ok(
  (
    select (result->>'stale')::boolean
      and not (result->>'changed')::boolean
      and not (result->>'is_current')::boolean
      and (result->>'lead_id')::uuid = 'd1400000-0000-4000-8000-000000000010'::uuid
      and (result->>'active_lead_id')::uuid = 'd1400000-0000-4000-8000-000000000011'::uuid
    from queue_scope_binding_results
    where label = 'stale-a-after-b'
  ),
  'an intake CAS that loses to lead B records lead A as stale historical context'
);

select ok(
  (
    select conversation.lead_id = 'd1400000-0000-4000-8000-000000000011'::uuid
      and identity_alias.lead_id = 'd1400000-0000-4000-8000-000000000011'::uuid
    from public.whatsapp_conversations as conversation
    join public.whatsapp_contact_identity_aliases as identity_alias
      on identity_alias.organization_id = conversation.organization_id
     and identity_alias.session_id = conversation.session_id
     and identity_alias.alias_jid = conversation.remote_jid
    where conversation.id = 'd1600000-0000-4000-8000-000000000001'
  ),
  'a stale intake event never rolls the conversation or alias back from lead B'
);

select ok(
  (
    select count(*) = 1
      and bool_and(binding.stale)
      and bool_and(binding.active_to = binding.active_from)
      and bool_and(binding.lead_id = 'd1400000-0000-4000-8000-000000000010'::uuid)
    from public.whatsapp_conversation_lead_bindings as binding
    where binding.organization_id = 'd1200000-0000-4000-8000-000000000001'
      and binding.conversation_id = 'd1600000-0000-4000-8000-000000000001'
      and binding.provider_message_id = 'provider-stale-a-after-b'
  ),
  'the losing provider event has one immutable closed stale ledger row'
);

select ok(
  (
    select replay.replay->>'binding_id' = original.result->>'binding_id'
      and (replay.replay->>'stale')::boolean
      and not (replay.replay->>'is_current')::boolean
    from queue_scope_binding_results as original
    cross join lateral (
      select public.activate_whatsapp_conversation_lead_binding_if_current(
        'd1200000-0000-4000-8000-000000000001',
        'd1600000-0000-4000-8000-000000000001',
        'd1400000-0000-4000-8000-000000000010',
        'provider-stale-a-after-b',
        null,
        'd1400000-0000-4000-8000-000000000011'
      ) as replay
    ) as replay
    where original.label = 'stale-a-after-b'
  ),
  'replaying a stale provider event returns the same historical ledger and never becomes current'
);

select ok(
  (
    select last_message is null
      and last_message_preview is null
      and last_message_at is null
      and last_message_received_at is null
      and unread_count = 0
      and archived_at is null
    from public.whatsapp_conversations
    where id = 'd1600000-0000-4000-8000-000000000001'
  ),
  'a lead switch clears previews, timestamps, unread badge and archive state from lead A'
);

select ok(
  not exists (
    select 1 from public.conversation_ai_state
    where conversation_id = 'd1600000-0000-4000-8000-000000000001'
  )
  and not exists (
    select 1 from public.ai_agent_conversations
    where conversation_id = 'd1600000-0000-4000-8000-000000000001'
  )
  and not exists (
    select 1 from public.ai_conversation_states
    where conversation_id = 'd1600000-0000-4000-8000-000000000001'
  )
  and not exists (
    select 1 from public.chatbot_conversation_state
    where organization_id = 'd1200000-0000-4000-8000-000000000001'
      and conversation_id = 'd1600000-0000-4000-8000-000000000001'
  ),
  'a lead switch erases every conversation-scoped AI memory for lead A'
);

select ok(
  (select status = 'dead' and last_error = 'conversation_lead_binding_changed'
   from public.whatsapp_outbox
   where id = 'd1800000-0000-4000-8000-000000000008')
  and
  (select status = 'failed' and error_message = 'conversation_lead_binding_changed'
   from public.outbox_messages
   where id = 'd1800000-0000-4000-8000-000000000009')
  and
  (select status = 'cancelled' and error_message = 'conversation_lead_binding_changed'
   from public.ai_jobs
   where id = 'd1800000-0000-4000-8000-000000000006')
  and
  (select status = 'cancelled' and last_error = 'conversation_lead_binding_changed'
   from public.jobs
   where id = 'd1800000-0000-4000-8000-00000000000a')
  and
  (select status = 'cancelled' and failure_reason = 'conversation_lead_binding_changed'
   from public.ai_outbox_messages
   where id = 'd1800000-0000-4000-8000-000000000007'),
  'a lead switch atomically quarantines pending WhatsApp and AI effects from lead A'
);

update public.whatsapp_outbox
set status = 'failed',
    failed_at = now(),
    dead_lettered_at = null,
    last_error = 'definitive_provider_failure'
where id = 'd1800000-0000-4000-8000-000000000008';

select throws_ok(
  $$
    update public.whatsapp_outbox
    set status = 'pending',
        attempts = 0,
        next_attempt_at = now(),
        locked_at = null,
        locked_by = null,
        last_error = null,
        failed_at = null,
        dead_lettered_at = null
    where id = 'd1800000-0000-4000-8000-000000000008'
  $$,
  '23514',
  'canonical_whatsapp_outbox_message_lead_mismatch',
  'a failed lead A delivery cannot be retried after the physical conversation rebinds to lead B'
);

select is(
  (
    select status
    from public.whatsapp_outbox
    where id = 'd1800000-0000-4000-8000-000000000008'
  ),
  'failed',
  'a rejected historical retry leaves the outbox terminal and unclaimable'
);

select ok(
  (select status = 'cancelled'
       and lead_id = 'd1400000-0000-4000-8000-000000000010'::uuid
       and error_message = 'conversation_lead_binding_changed'
       and locked_at is null
       and locked_by is null
   from public.automation_executions
   where id = 'd1900000-0000-4000-8000-000000000003')
  and
  (select status = 'cancelled'
       and error_message = 'conversation_lead_binding_changed'
   from public.automation_execution_steps
   where id = 'd1900000-0000-4000-8000-000000000004')
  and
  (select status = 'dead_letter'
       and lead_id = 'd1400000-0000-4000-8000-000000000010'::uuid
       and last_error = 'conversation_lead_binding_changed'
       and locked_at is null
       and locked_by is null
   from public.automation_event_outbox
   where id = 'd1900000-0000-4000-8000-000000000006')
  and
  (select status = 'failed'
       and error_message = 'reconciled_before_binding_switch'
    from public.automation_effect_dispatches
    where id = 'd1900000-0000-4000-8000-000000000005'),
  'a lead switch dead-letters the pending event, cancels waiting automation work and preserves the reconciled effect under lead A'
);

select is(
  (
    select lead_id
    from public.outbox_messages
    where id = 'd1800000-0000-4000-8000-000000000009'
  ),
  'd1400000-0000-4000-8000-000000000010'::uuid,
  'quarantining the legacy outbox preserves its immutable lead A provenance'
);

insert into queue_scope_binding_results (label, result)
values (
  'lead-c',
  public.activate_whatsapp_conversation_lead_binding(
    'd1200000-0000-4000-8000-000000000001',
    'd1600000-0000-4000-8000-000000000001',
    'd1400000-0000-4000-8000-000000000012',
    'provider-binding-c'
  )
);

select ok(
  (
    select (result->>'changed')::boolean
      and (result->>'previous_lead_id')::uuid = 'd1400000-0000-4000-8000-000000000011'::uuid
    from queue_scope_binding_results
    where label = 'lead-c'
  ),
  'switching to lead C records lead B as the previous lead'
);

insert into queue_scope_binding_results (label, result)
values (
  'lead-b-replay',
  public.activate_whatsapp_conversation_lead_binding(
    'd1200000-0000-4000-8000-000000000001',
    'd1600000-0000-4000-8000-000000000001',
    'd1400000-0000-4000-8000-000000000011',
    'provider-binding-b'
  )
);

select ok(
  (
    select not (result->>'changed')::boolean
      and not (result->>'is_current')::boolean
    from queue_scope_binding_results
    where label = 'lead-b-replay'
  ),
  'historical provider replay reports changed=false and is_current=false'
);

select ok(
  (
    select (result->>'lead_id')::uuid = 'd1400000-0000-4000-8000-000000000011'::uuid
      and (result->>'active_lead_id')::uuid = 'd1400000-0000-4000-8000-000000000012'::uuid
    from queue_scope_binding_results
    where label = 'lead-b-replay'
  ),
  'historical replay returns original lead B and current lead C separately'
);

select is(
  (select result->>'binding_id' from queue_scope_binding_results where label = 'lead-b-replay'),
  (select result->>'binding_id' from queue_scope_binding_results where label = 'lead-b'),
  'historical replay returns the original binding event id'
);

select is(
  (
    select lead_id
    from public.whatsapp_conversations
    where id = 'd1600000-0000-4000-8000-000000000001'
  ),
  'd1400000-0000-4000-8000-000000000012'::uuid,
  'historical replay does not reactivate lead B'
);

select is(
  (
    select lead_id
    from public.whatsapp_contact_identity_aliases
    where id = 'd1800000-0000-4000-8000-000000000010'
  ),
  'd1400000-0000-4000-8000-000000000012'::uuid,
  'historical replay of B never rolls the current contact alias back from C'
);

select lives_ok(
  $$
    insert into public.whatsapp_messages (
      id, organization_id, conversation_id, session_id, lead_id,
      provider_message_id, message_id, from_me, direction,
      message_type, content, remote_jid, status
    ) values (
      'd1700000-0000-4000-8000-000000000002',
      'd1200000-0000-4000-8000-000000000001',
      'd1600000-0000-4000-8000-000000000001',
      'd1500000-0000-4000-8000-000000000001',
      'd1400000-0000-4000-8000-000000000011',
      'provider-binding-b', 'provider-binding-b', false, 'inbound',
      'text', 'Delayed historical message for lead B',
      '5511988880010@s.whatsapp.net', 'received'
    )
  $$,
  'a delayed replay inserts into historical lead B after lead C is active'
);

select is(
  (
    select lead_id
    from public.whatsapp_messages
    where id = 'd1700000-0000-4000-8000-000000000002'
  ),
  'd1400000-0000-4000-8000-000000000011'::uuid,
  'the delayed replay preserves its historical lead attribution'
);

select throws_ok(
  $$
    select public.activate_whatsapp_conversation_lead_binding(
      'd1200000-0000-4000-8000-000000000001',
      'd1600000-0000-4000-8000-000000000001',
      'd1400000-0000-4000-8000-000000000012',
      'provider-binding-b'
    )
  $$,
  '23505',
  'whatsapp_binding_provider_message_conflict',
  'one provider event cannot be rebound to another lead'
);

select throws_ok(
  $$
    insert into public.whatsapp_messages (
      organization_id, conversation_id, session_id, lead_id,
      provider_message_id, message_id, from_me, direction,
      message_type, content, status
    ) values (
      'd1200000-0000-4000-8000-000000000001',
      'd1600000-0000-4000-8000-000000000001',
      'd1500000-0000-4000-8000-000000000001',
      'd1400000-0000-4000-8000-000000000011',
      'provider-wrong-current', 'provider-wrong-current', false, 'inbound',
      'text', 'Must fail', 'received'
    )
  $$,
  '23514',
  'whatsapp_message_lead_binding_mismatch',
  'an unledgered message cannot claim a non-current lead'
);

select lives_ok(
  $$
    insert into public.whatsapp_messages (
      id, organization_id, conversation_id, session_id, lead_id,
      provider_message_id, message_id, from_me, direction,
      message_type, content, status
    ) values (
      'd1700000-0000-4000-8000-000000000003',
      'd1200000-0000-4000-8000-000000000001',
      'd1600000-0000-4000-8000-000000000001',
      'd1500000-0000-4000-8000-000000000001',
      null,
      'provider-current-c', 'provider-current-c', false, 'inbound',
      'text', 'Current message for lead C', 'received'
    )
  $$,
  'an unledgered message inherits the active lead when lead_id is omitted'
);

select is(
  (
    select lead_id
    from public.whatsapp_messages
    where id = 'd1700000-0000-4000-8000-000000000003'
  ),
  'd1400000-0000-4000-8000-000000000012'::uuid,
  'the active lead is written onto a new canonical message'
);

insert into public.whatsapp_messages (
  id, organization_id, conversation_id, session_id, lead_id,
  client_message_id, message_id, from_me, direction,
  message_type, content, remote_jid, status
)
values (
  'd1700000-0000-4000-8000-000000000004',
  'd1200000-0000-4000-8000-000000000001',
  'd1600000-0000-4000-8000-000000000001',
  'd1500000-0000-4000-8000-000000000001',
  'd1400000-0000-4000-8000-000000000012',
  'queue-scope-webhook-wins-client', 'queue-scope-webhook-wins-client',
  true, 'outbound', 'text', 'Pending projection',
  '5511988880010@s.whatsapp.net', 'queued'
), (
  'd1700000-0000-4000-8000-000000000005',
  'd1200000-0000-4000-8000-000000000001',
  'd1600000-0000-4000-8000-000000000001',
  'd1500000-0000-4000-8000-000000000001',
  'd1400000-0000-4000-8000-000000000012',
  null, 'provider-webhook-wins', true, 'outbound', 'text',
  'Provider webhook projection', '5511988880010@s.whatsapp.net', 'sent'
);

insert into public.whatsapp_outbox (
  id, organization_id, session_id, conversation_id, message_id,
  client_message_id, recipient_jid, message_type, payload, status,
  provider_message_id, locked_at, locked_by
)
values (
  'd1800000-0000-4000-8000-00000000000b',
  'd1200000-0000-4000-8000-000000000001',
  'd1500000-0000-4000-8000-000000000001',
  'd1600000-0000-4000-8000-000000000001',
  'd1700000-0000-4000-8000-000000000004',
  'queue-scope-webhook-wins-client', '5511988880010@s.whatsapp.net',
  'text', '{}'::jsonb, 'processing', 'provider-webhook-wins',
  now(), 'queue-scope-webhook-wins-worker'
);

update public.whatsapp_messages
set client_message_id = null
where id = 'd1700000-0000-4000-8000-000000000004';

update public.whatsapp_messages
set client_message_id = 'queue-scope-webhook-wins-client',
    provider_message_id = 'provider-webhook-wins',
    message_id = 'provider-webhook-wins'
where id = 'd1700000-0000-4000-8000-000000000005';

select lives_ok(
  $$
    update public.whatsapp_outbox
    set message_id = 'd1700000-0000-4000-8000-000000000005',
        status = 'sent',
        sent_at = now(),
        locked_at = null,
        locked_by = null,
        last_error = null,
        failed_at = null,
        dead_lettered_at = null
    where id = 'd1800000-0000-4000-8000-00000000000b'
      and status = 'processing'
      and locked_by = 'queue-scope-webhook-wins-worker'
  $$,
  'provider-webhook-wins may atomically transfer and terminalize a processing delivery'
);

delete from public.whatsapp_messages
where id = 'd1700000-0000-4000-8000-000000000004';

select ok(
  (
    select message_id = 'd1700000-0000-4000-8000-000000000005'::uuid
      and client_message_id = 'queue-scope-webhook-wins-client'
      and provider_message_id = 'provider-webhook-wins'
      and status = 'sent'
      and locked_by is null
    from public.whatsapp_outbox
    where id = 'd1800000-0000-4000-8000-00000000000b'
  )
  and not exists (
    select 1
    from public.whatsapp_messages
    where id = 'd1700000-0000-4000-8000-000000000004'
  ),
  'provider-webhook-wins preserves the outbox identity after deleting only the losing projection'
);

insert into public.whatsapp_messages (
  id, organization_id, conversation_id, session_id, lead_id,
  client_message_id, message_id, from_me, direction,
  message_type, content, remote_jid, status
)
values (
  'd1700000-0000-4000-8000-000000000006',
  'd1200000-0000-4000-8000-000000000001',
  'd1600000-0000-4000-8000-000000000001',
  'd1500000-0000-4000-8000-000000000001',
  'd1400000-0000-4000-8000-000000000012',
  'queue-scope-outcome-unknown-client', 'queue-scope-outcome-unknown-client',
  true, 'outbound', 'text', 'Outcome unknown pending projection',
  '5511988880010@s.whatsapp.net', 'failed'
), (
  'd1700000-0000-4000-8000-000000000007',
  'd1200000-0000-4000-8000-000000000001',
  'd1600000-0000-4000-8000-000000000001',
  'd1500000-0000-4000-8000-000000000001',
  'd1400000-0000-4000-8000-000000000012',
  null, 'provider-webhook-outcome-unknown', true, 'outbound', 'text',
  'Outcome unknown provider projection', '5511988880010@s.whatsapp.net', 'sent'
);

insert into public.whatsapp_outbox (
  id, organization_id, session_id, conversation_id, message_id,
  client_message_id, recipient_jid, message_type, payload, status,
  provider_message_id, last_error, dead_lettered_at
)
values (
  'd1800000-0000-4000-8000-00000000000c',
  'd1200000-0000-4000-8000-000000000001',
  'd1500000-0000-4000-8000-000000000001',
  'd1600000-0000-4000-8000-000000000001',
  'd1700000-0000-4000-8000-000000000006',
  'queue-scope-outcome-unknown-client', '5511988880010@s.whatsapp.net',
  'text', '{}'::jsonb, 'dead', 'provider-webhook-outcome-unknown',
  'definitive_provider_failure', now()
);

update public.whatsapp_messages
set client_message_id = null
where id = 'd1700000-0000-4000-8000-000000000006';

update public.whatsapp_messages
set client_message_id = 'queue-scope-outcome-unknown-client',
    provider_message_id = 'provider-webhook-outcome-unknown',
    message_id = 'provider-webhook-outcome-unknown'
where id = 'd1700000-0000-4000-8000-000000000007';

select throws_ok(
  $$
    update public.whatsapp_outbox
    set message_id = 'd1700000-0000-4000-8000-000000000007',
        status = 'sent',
        sent_at = now(),
        dead_lettered_at = null,
        last_error = null
    where id = 'd1800000-0000-4000-8000-00000000000c'
  $$,
  '23514',
  'canonical_whatsapp_outbox_message_reconciliation_invalid',
  'a generic dead delivery cannot be revived by a provider message projection'
);

update public.whatsapp_outbox
set last_error = 'provider_delivery_outcome_unknown'
where id = 'd1800000-0000-4000-8000-00000000000c';

select lives_ok(
  $$
    update public.whatsapp_outbox
    set message_id = 'd1700000-0000-4000-8000-000000000007',
        status = 'sent',
        sent_at = now(),
        dead_lettered_at = null,
        last_error = null
    where id = 'd1800000-0000-4000-8000-00000000000c'
      and status = 'dead'
      and last_error = 'provider_delivery_outcome_unknown'
  $$,
  'a signed provider projection may terminalize only the exact outcome-unknown dead delivery'
);

delete from public.whatsapp_messages
where id = 'd1700000-0000-4000-8000-000000000006';

select ok(
  (
    select message_id = 'd1700000-0000-4000-8000-000000000007'::uuid
      and client_message_id = 'queue-scope-outcome-unknown-client'
      and provider_message_id = 'provider-webhook-outcome-unknown'
      and status = 'sent'
      and last_error is null
      and dead_lettered_at is null
    from public.whatsapp_outbox
    where id = 'd1800000-0000-4000-8000-00000000000c'
  )
  and not exists (
    select 1
    from public.whatsapp_messages
    where id = 'd1700000-0000-4000-8000-000000000006'
  ),
  'outcome-unknown reconciliation transfers the client identity exactly once and deletes the losing projection'
);

select throws_ok(
  $$
    insert into public.whatsapp_outbox (
      organization_id, session_id, conversation_id, message_id,
      client_message_id, recipient_jid, message_type, payload, status
    ) values (
      'd1200000-0000-4000-8000-000000000001',
      'd1500000-0000-4000-8000-000000000001',
      'd1600000-0000-4000-8000-000000000001',
      'd1700000-0000-4000-8000-000000000001',
      'queue-scope-historical-a-after-c',
      '5511988880010@s.whatsapp.net', 'text', '{}'::jsonb, 'pending'
    )
  $$,
  '23514',
  'canonical_whatsapp_outbox_message_lead_mismatch',
  'canonical outbox cannot send a historical lead A message after lead C is active'
);

select lives_ok(
  $$
    update public.whatsapp_messages
    set delivered_at = now(), status = 'delivered'
    where id = 'd1700000-0000-4000-8000-000000000001'
  $$,
  'delivery finalization remains valid for a historical lead A message'
);

select is(
  (
    select lead_id
    from public.whatsapp_messages
    where id = 'd1700000-0000-4000-8000-000000000001'
  ),
  'd1400000-0000-4000-8000-000000000010'::uuid,
  'historical message updates never rewrite the original lead'
);

select ok(
  (
    select count(*) = 1
      and bool_and(lead_id = 'd1400000-0000-4000-8000-000000000012'::uuid)
    from public.whatsapp_conversation_lead_bindings
    where conversation_id = 'd1600000-0000-4000-8000-000000000001'
      and active_to is null
  ),
  'the binding switch retains exactly one active interval for lead C'
);

select throws_ok(
  $$
    select public.activate_whatsapp_conversation_lead_binding(
      'd1200000-0000-4000-8000-000000000001',
      'd1600000-0000-4000-8000-000000000001',
      'd1400000-0000-4000-8000-000000000099',
      'provider-cross-tenant'
    )
  $$,
  '23503',
  'whatsapp_binding_lead_not_found',
  'binding activation rejects a lead outside the requested tenant'
);

insert into public.whatsapp_conversations (
  id, organization_id, session_id, lead_id, remote_jid, contact_name
)
values (
  'd1600000-0000-4000-8000-000000000002',
  'd1200000-0000-4000-8000-000000000001',
  'd1500000-0000-4000-8000-000000000001',
  'd1400000-0000-4000-8000-000000000010',
  '5511988880099@s.whatsapp.net', 'Prelinked Contact'
);

select lives_ok(
  $$
    select public.activate_whatsapp_conversation_lead_binding(
      'd1200000-0000-4000-8000-000000000001',
      'd1600000-0000-4000-8000-000000000002',
      'd1400000-0000-4000-8000-000000000010',
      'provider-prelinked-same-lead'
    )
  $$,
  'same-lead activation repairs a prelinked conversation with no active binding'
);

select is(
  (
    select count(*)::bigint
    from public.whatsapp_conversation_lead_bindings
    where conversation_id = 'd1600000-0000-4000-8000-000000000002'
      and active_to is null
  ),
  1::bigint,
  'same-lead activation leaves exactly one active binding'
);

select throws_ok(
  $$
    update public.whatsapp_conversation_lead_bindings
    set lead_id = 'd1400000-0000-4000-8000-000000000011'
    where conversation_id = 'd1600000-0000-4000-8000-000000000002'
      and active_to is null
  $$,
  '23514',
  'whatsapp_conversation_lead_binding_immutable',
  'binding history cannot be relabelled directly'
);

insert into public.whatsapp_conversations (
  id, organization_id, session_id, remote_jid, contact_name
)
values (
  'd1600000-0000-4000-8000-000000000006',
  'd1200000-0000-4000-8000-000000000001',
  'd1500000-0000-4000-8000-000000000001',
  '5511988880006@s.whatsapp.net',
  'Manual CAS Unlinked Contact'
);

insert into queue_scope_binding_results (label, result)
values (
  'manual-unlinked-to-c',
  public.activate_whatsapp_conversation_lead_binding(
    'd1200000-0000-4000-8000-000000000001',
    'd1600000-0000-4000-8000-000000000006',
    'd1400000-0000-4000-8000-000000000021',
    null,
    'unlinked'
  )
);

select ok(
  (
    select (result->>'success')::boolean
      and (result->>'changed')::boolean
      and (result->>'is_current')::boolean
      and (result->>'active_lead_id')::uuid =
        'd1400000-0000-4000-8000-000000000021'::uuid
    from queue_scope_binding_results
    where label = 'manual-unlinked-to-c'
  )
  and (
    select lead_id = 'd1400000-0000-4000-8000-000000000021'::uuid
    from public.whatsapp_conversations
    where id = 'd1600000-0000-4000-8000-000000000006'
  ),
  'manual CAS links an unlinked snapshot to lead C exactly once'
);

insert into queue_scope_binding_results (label, result)
values (
  'manual-stale-unlinked-to-b',
  public.activate_whatsapp_conversation_lead_binding(
    'd1200000-0000-4000-8000-000000000001',
    'd1600000-0000-4000-8000-000000000006',
    'd1400000-0000-4000-8000-000000000022',
    null,
    'unlinked'
  )
);

select ok(
  (
    select not (result->>'success')::boolean
      and not (result->>'changed')::boolean
      and (result->>'stale')::boolean
      and not (result->>'is_current')::boolean
      and (result->>'active_lead_id')::uuid =
        'd1400000-0000-4000-8000-000000000021'::uuid
    from queue_scope_binding_results
    where label = 'manual-stale-unlinked-to-b'
  )
  and (
    select count(*) = 1
      and bool_and(lead_id = 'd1400000-0000-4000-8000-000000000021'::uuid)
    from public.whatsapp_conversation_lead_bindings
    where conversation_id = 'd1600000-0000-4000-8000-000000000006'
      and active_to is null
  ),
  'a stale unlinked browser snapshot cannot overwrite the manual lead C bind with B'
);

insert into queue_scope_binding_results (label, result)
values (
  'manual-a-to-c',
  public.activate_whatsapp_conversation_lead_binding(
    'd1200000-0000-4000-8000-000000000001',
    'd1600000-0000-4000-8000-000000000002',
    'd1400000-0000-4000-8000-000000000023',
    null,
    'd1400000-0000-4000-8000-000000000010'
  )
);

select ok(
  (
    select (result->>'success')::boolean
      and (result->>'changed')::boolean
      and (result->>'previous_lead_id')::uuid =
        'd1400000-0000-4000-8000-000000000010'::uuid
      and (result->>'active_lead_id')::uuid =
        'd1400000-0000-4000-8000-000000000023'::uuid
    from queue_scope_binding_results
    where label = 'manual-a-to-c'
  ),
  'manual CAS moves an exact rendered lead A snapshot to lead C'
);

insert into queue_scope_binding_results (label, result)
values (
  'manual-stale-a-to-b',
  public.activate_whatsapp_conversation_lead_binding(
    'd1200000-0000-4000-8000-000000000001',
    'd1600000-0000-4000-8000-000000000002',
    'd1400000-0000-4000-8000-000000000022',
    null,
    'd1400000-0000-4000-8000-000000000010'
  )
);

select ok(
  (
    select not (result->>'success')::boolean
      and not (result->>'changed')::boolean
      and (result->>'stale')::boolean
      and (result->>'active_lead_id')::uuid =
        'd1400000-0000-4000-8000-000000000023'::uuid
    from queue_scope_binding_results
    where label = 'manual-stale-a-to-b'
  )
  and (
    select count(*) = 1
      and bool_and(lead_id = 'd1400000-0000-4000-8000-000000000023'::uuid)
    from public.whatsapp_conversation_lead_bindings
    where conversation_id = 'd1600000-0000-4000-8000-000000000002'
      and active_to is null
  ),
  'a stale rendered lead A snapshot cannot overwrite the newer manual lead C bind with B'
);

-- Pre-ACK routing provenance: accepted events form an immutable per-contact
-- chain and only a completed predecessor (or a predecessor in the same ordered
-- inbox) may advance the physical conversation binding.
select ok(
  pg_catalog.to_regclass('public.whatsapp_webhook_routing_snapshots') is not null
  and pg_catalog.to_regclass('public.whatsapp_webhook_routing_outcomes') is not null
  and pg_catalog.to_regclass('public.whatsapp_conversation_routing_heads') is not null
  and (
    select relrowsecurity
    from pg_catalog.pg_class
    where oid = 'public.whatsapp_webhook_routing_snapshots'::regclass
  )
  and (
    select relrowsecurity
    from pg_catalog.pg_class
    where oid = 'public.whatsapp_webhook_routing_outcomes'::regclass
  )
  and has_function_privilege(
    'service_role',
    'public.resolve_whatsapp_webhook_inherited_routing_target(uuid,uuid,text)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.resolve_whatsapp_webhook_inherited_routing_target(uuid,uuid,text)',
    'execute'
  ),
  'routing snapshots, completion outcomes and applied heads are tenant-closed service contracts'
);

select ok(
  pg_catalog.pg_get_functiondef(
    'public.activate_whatsapp_conversation_lead_binding(uuid,uuid,uuid,text)'::regprocedure
  ) ~* 'for[[:space:]]+no[[:space:]]+key[[:space:]]+update'
  and pg_catalog.pg_get_functiondef(
    'public.activate_whatsapp_conversation_lead_binding_if_current(uuid,uuid,uuid,text,uuid,uuid)'::regprocedure
  ) ~* 'for[[:space:]]+no[[:space:]]+key[[:space:]]+update'
  and pg_catalog.pg_get_functiondef(
    'public.activate_whatsapp_conversation_lead_binding_if_current(uuid,uuid,uuid,text,uuid,uuid)'::regprocedure
  ) ~* 'for[[:space:]]+update',
  'binding RPCs use conversation NO KEY UPDATE while retaining an exclusive binding-row lock'
);

insert into public.round_robins (
  id, organization_id, name, is_active,
  pipeline_id, target_pipeline_id, target_stage_id
)
values
  (
    'd1300000-0000-4000-8000-000000000010',
    'd1200000-0000-4000-8000-000000000001', 'Routing Queue B', true,
    'd1250000-0000-4000-8000-000000000001',
    'd1250000-0000-4000-8000-000000000001',
    'd1260000-0000-4000-8000-000000000001'
  ),
  (
    'd1300000-0000-4000-8000-000000000011',
    'd1200000-0000-4000-8000-000000000001', 'Routing Queue C', true,
    'd1250000-0000-4000-8000-000000000001',
    'd1250000-0000-4000-8000-000000000001',
    'd1260000-0000-4000-8000-000000000001'
  );

-- Managed snapshot guards revalidate the exact live queue/rule/session graph.
-- Model that graph instead of fabricating rule UUIDs in the capture call.
insert into public.round_robin_rules (
  id, organization_id, round_robin_id, match_type, match_value,
  match, conditions, is_active, priority
)
values
  (
    'd1900000-0000-4000-8000-000000000010',
    'd1200000-0000-4000-8000-000000000001',
    'd1300000-0000-4000-8000-000000000010',
    'whatsapp_message_contains', 'routing-b1',
    jsonb_build_object(
      'whatsapp_session_id', 'd1500000-0000-4000-8000-000000000001'
    ),
    jsonb_build_object(
      'match_type', 'whatsapp_message_contains',
      'match_value', 'routing-b1',
      'match', jsonb_build_object(
        'whatsapp_session_id', 'd1500000-0000-4000-8000-000000000001'
      )
    ),
    true, 300
  ),
  (
    'd1900000-0000-4000-8000-000000000011',
    'd1200000-0000-4000-8000-000000000001',
    'd1300000-0000-4000-8000-000000000010',
    'whatsapp_message_contains', 'routing-b2',
    jsonb_build_object(
      'whatsapp_session_id', 'd1500000-0000-4000-8000-000000000001'
    ),
    jsonb_build_object(
      'match_type', 'whatsapp_message_contains',
      'match_value', 'routing-b2',
      'match', jsonb_build_object(
        'whatsapp_session_id', 'd1500000-0000-4000-8000-000000000001'
      )
    ),
    true, 200
  ),
  (
    'd1900000-0000-4000-8000-000000000012',
    'd1200000-0000-4000-8000-000000000001',
    'd1300000-0000-4000-8000-000000000011',
    'whatsapp_message_contains', 'routing-c',
    jsonb_build_object(
      'whatsapp_session_id', 'd1500000-0000-4000-8000-000000000001'
    ),
    jsonb_build_object(
      'match_type', 'whatsapp_message_contains',
      'match_value', 'routing-c',
      'match', jsonb_build_object(
        'whatsapp_session_id', 'd1500000-0000-4000-8000-000000000001'
      )
    ),
    true, 100
  );

insert into public.whatsapp_inbound_rules (
  id, organization_id, session_id, name, priority, is_active,
  match_type, match_value, match_field, target_round_robin_id
)
values
  (
    'd1900000-0000-4000-8000-000000000010',
    'd1200000-0000-4000-8000-000000000001',
    'd1500000-0000-4000-8000-000000000001',
    'Routing B1', 300, true, 'contains', 'routing-b1', 'message',
    'd1300000-0000-4000-8000-000000000010'
  ),
  (
    'd1900000-0000-4000-8000-000000000011',
    'd1200000-0000-4000-8000-000000000001',
    'd1500000-0000-4000-8000-000000000001',
    'Routing B2', 200, true, 'contains', 'routing-b2', 'message',
    'd1300000-0000-4000-8000-000000000010'
  ),
  (
    'd1900000-0000-4000-8000-000000000012',
    'd1200000-0000-4000-8000-000000000001',
    'd1500000-0000-4000-8000-000000000001',
    'Routing C', 100, true, 'contains', 'routing-c', 'message',
    'd1300000-0000-4000-8000-000000000011'
  );

insert into public.leads (
  id, organization_id, assigned_user_id, name, phone, source
)
values
  ('d1400000-0000-4000-8000-000000000030', 'd1200000-0000-4000-8000-000000000001', 'd1100000-0000-4000-8000-000000000001', 'Routing Initial A', '551188881030', 'whatsapp'),
  ('d1400000-0000-4000-8000-000000000031', 'd1200000-0000-4000-8000-000000000001', 'd1100000-0000-4000-8000-000000000001', 'Same Inbox Initial A', '551188881031', 'whatsapp'),
  ('d1400000-0000-4000-8000-000000000032', 'd1200000-0000-4000-8000-000000000001', 'd1100000-0000-4000-8000-000000000001', 'Replay Initial A', '551188881032', 'whatsapp'),
  ('d1400000-0000-4000-8000-000000000041', 'd1200000-0000-4000-8000-000000000001', 'd1100000-0000-4000-8000-000000000001', 'Same Inbox Target B', '551188881041', 'whatsapp'),
  ('d1400000-0000-4000-8000-000000000042', 'd1200000-0000-4000-8000-000000000001', 'd1100000-0000-4000-8000-000000000001', 'Replay Target B', '551188881042', 'whatsapp'),
  ('d1400000-0000-4000-8000-000000000043', 'd1200000-0000-4000-8000-000000000001', 'd1100000-0000-4000-8000-000000000001', 'Routing Chain Target B', '551188881043', 'whatsapp'),
  ('d1400000-0000-4000-8000-000000000044', 'd1200000-0000-4000-8000-000000000001', 'd1100000-0000-4000-8000-000000000001', 'Routing Chain Target C', '551188881044', 'whatsapp'),
  ('d1400000-0000-4000-8000-000000000034', 'd1200000-0000-4000-8000-000000000001', 'd1100000-0000-4000-8000-000000000001', 'LID Initial A', '551188881034', 'whatsapp'),
  ('d1400000-0000-4000-8000-000000000045', 'd1200000-0000-4000-8000-000000000001', 'd1100000-0000-4000-8000-000000000001', 'LID Target B', '551188881045', 'whatsapp');

insert into public.leads (
  id, organization_id, origin_round_robin_id, assigned_user_id,
  name, phone, source
)
values
  (
    'd1400000-0000-4000-8000-000000000046',
    'd1200000-0000-4000-8000-000000000001',
    null,
    'd1100000-0000-4000-8000-000000000001',
    'Canonical Unscoped Target', '551188881046', 'whatsapp'
  ),
  (
    'd1400000-0000-4000-8000-000000000047',
    'd1200000-0000-4000-8000-000000000001',
    'd1300000-0000-4000-8000-000000000010',
    'd1100000-0000-4000-8000-000000000001',
    'Canonical Queue B Sibling', '551188881046', 'whatsapp'
  ),
  (
    'd1400000-0000-4000-8000-000000000048',
    'd1200000-0000-4000-8000-000000000001',
    'd1300000-0000-4000-8000-000000000011',
    'd1100000-0000-4000-8000-000000000001',
    'Canonical Queue C Sibling', '551188881046', 'whatsapp'
  );

insert into public.whatsapp_conversations (
  id, organization_id, session_id, remote_jid, contact_phone, contact_name
)
values
  (
    'd1600000-0000-4000-8000-000000000030',
    'd1200000-0000-4000-8000-000000000001',
    'd1500000-0000-4000-8000-000000000001',
    '551188880030@s.whatsapp.net', '551188880030', 'Routing Chain Contact'
  ),
  (
    'd1600000-0000-4000-8000-000000000031',
    'd1200000-0000-4000-8000-000000000001',
    'd1500000-0000-4000-8000-000000000001',
    '551188880031@s.whatsapp.net', '551188880031', 'Same Inbox Contact'
  ),
  (
    'd1600000-0000-4000-8000-000000000032',
    'd1200000-0000-4000-8000-000000000001',
    'd1500000-0000-4000-8000-000000000001',
    '551188880032@s.whatsapp.net', '551188880032', 'Replay Outcome Contact'
  ),
  (
    'd1600000-0000-4000-8000-000000000034',
    'd1200000-0000-4000-8000-000000000001',
    'd1500000-0000-4000-8000-000000000001',
    '551188880034@s.whatsapp.net', '551188880034', 'Known LID Alias Contact'
  );

select public.activate_whatsapp_conversation_lead_binding(
  'd1200000-0000-4000-8000-000000000001',
  'd1600000-0000-4000-8000-000000000030',
  'd1400000-0000-4000-8000-000000000030',
  null
);
select public.activate_whatsapp_conversation_lead_binding(
  'd1200000-0000-4000-8000-000000000001',
  'd1600000-0000-4000-8000-000000000034',
  'd1400000-0000-4000-8000-000000000034',
  null
);

insert into public.whatsapp_contact_identity_aliases (
  id, organization_id, session_id, alias_jid, canonical_jid,
  contact_phone, lead_id
)
values (
  'd1800000-0000-4000-8000-000000000034',
  'd1200000-0000-4000-8000-000000000001',
  'd1500000-0000-4000-8000-000000000001',
  '987654321012345@lid',
  '551188880034@s.whatsapp.net',
  '551188880034',
  'd1400000-0000-4000-8000-000000000034'
);
select public.activate_whatsapp_conversation_lead_binding(
  'd1200000-0000-4000-8000-000000000001',
  'd1600000-0000-4000-8000-000000000031',
  'd1400000-0000-4000-8000-000000000031',
  null
);
select public.activate_whatsapp_conversation_lead_binding(
  'd1200000-0000-4000-8000-000000000001',
  'd1600000-0000-4000-8000-000000000032',
  'd1400000-0000-4000-8000-000000000032',
  null
);

create temporary table queue_scope_route_results (
  label text primary key,
  result jsonb not null
) on commit drop;

insert into queue_scope_route_results (label, result)
values (
  'canonical-unscoped-with-queue-siblings',
  private.capture_whatsapp_webhook_routing_snapshot(
    'd1200000-0000-4000-8000-000000000001',
    'd1500000-0000-4000-8000-000000000001',
    'route-canonical-unscoped', 'route-canonical-unscoped-k1', 'live',
    'phone:551188881046', true,
    array['551188881046@s.whatsapp.net'], '551188881046',
    'contextual_intake', 'canonical_intake_v1:meta_ctwa',
    false, false, false,
    null, null, null
  )
);

select ok(
  (
    select result->>'state' = 'contextual_intake'
      and result->>'event_lead_id' = 'd1400000-0000-4000-8000-000000000046'
      and result->>'quarantine_reason' is null
    from queue_scope_route_results
    where label = 'canonical-unscoped-with-queue-siblings'
  ),
  'canonical no-queue intake resolves only the unscoped card despite queue-scoped siblings'
);

insert into queue_scope_route_results (label, result)
values
  (
    'chain-b1',
    private.capture_whatsapp_webhook_routing_snapshot(
      'd1200000-0000-4000-8000-000000000001',
      'd1500000-0000-4000-8000-000000000001',
      'route-chain-b1', 'route-chain-k1', 'backlog',
      'phone:551188880030', true,
      array['551188880030@s.whatsapp.net'], '551188880030',
      'contextual_intake', 'managed_rule', true, true, false,
      'd1900000-0000-4000-8000-000000000010',
      'd1300000-0000-4000-8000-000000000010',
      'd1400000-0000-4000-8000-000000000043'
    )
  ),
  (
    'chain-b2',
    private.capture_whatsapp_webhook_routing_snapshot(
      'd1200000-0000-4000-8000-000000000001',
      'd1500000-0000-4000-8000-000000000001',
      'route-chain-b2', 'route-chain-k2', 'live',
      'phone:551188880030', true,
      array['551188880030@s.whatsapp.net'], '551188880030',
      'contextual_intake', 'managed_rule', true, true, false,
      'd1900000-0000-4000-8000-000000000011',
      'd1300000-0000-4000-8000-000000000010',
      'd1400000-0000-4000-8000-000000000043'
    )
  ),
  (
    'chain-c',
    private.capture_whatsapp_webhook_routing_snapshot(
      'd1200000-0000-4000-8000-000000000001',
      'd1500000-0000-4000-8000-000000000001',
      'route-chain-c', 'route-chain-k3', 'live',
      'phone:551188880030', true,
      array['551188880030@s.whatsapp.net'], '551188880030',
      'contextual_intake', 'managed_rule', true, true, false,
      'd1900000-0000-4000-8000-000000000012',
      'd1300000-0000-4000-8000-000000000011',
      'd1400000-0000-4000-8000-000000000044'
    )
  ),
  (
    'chain-organic',
    private.capture_whatsapp_webhook_routing_snapshot(
      'd1200000-0000-4000-8000-000000000001',
      'd1500000-0000-4000-8000-000000000001',
      'route-chain-organic', 'route-chain-k4', 'live',
      'phone:551188880030', true,
      array['551188880030@s.whatsapp.net'], '551188880030',
      'organic', null, false, false, false,
      null, null, null
    )
  );

select ok(
  (select result->>'event_lead_id' = 'd1400000-0000-4000-8000-000000000043'
     and result->>'predecessor_provider_message_id' is null
     and (result->>'managed_message_distribution')::boolean
   from queue_scope_route_results where label = 'chain-b1'),
  'first accepted contextual B event freezes its managed target with no predecessor'
);

select ok(
  (select result->>'event_lead_id' = 'd1400000-0000-4000-8000-000000000043'
     and result->>'predecessor_provider_message_id' = 'route-chain-b1'
   from queue_scope_route_results where label = 'chain-b2'),
  'second same-queue B event accepted before drain chains to B1'
);

select ok(
  (select result->>'event_lead_id' = 'd1400000-0000-4000-8000-000000000044'
     and result->>'predecessor_provider_message_id' = 'route-chain-b2'
   from queue_scope_route_results where label = 'chain-c'),
  'different-queue C event accepted before drain chains after B2'
);

select ok(
  (select result->>'state' = 'predecessor_inherit'
     and result->>'target_mode' = 'inherit_predecessor'
     and result->>'event_lead_id' is null
     and result->>'predecessor_provider_message_id' = 'route-chain-c'
   from queue_scope_route_results where label = 'chain-organic'),
  'organic successor accepted before drain inherits the exact contextual predecessor result'
);

select is(
  private.capture_whatsapp_webhook_routing_snapshot(
    'd1200000-0000-4000-8000-000000000001',
    'd1500000-0000-4000-8000-000000000001',
    'route-chain-b1', 'route-chain-replay-k9', 'live',
    'phone:551188880030', true,
    array['551188880030@s.whatsapp.net'], '551188880030',
    'organic', null, false, false, false,
    null, null, null
  ),
  (select result from queue_scope_route_results where label = 'chain-b1'),
  'provider replay returns the exact original managed snapshot after mutable rule context changes'
);

insert into queue_scope_binding_results (label, result)
select
  'route-chain-b1-apply',
  public.activate_whatsapp_conversation_lead_binding_if_current(
    'd1200000-0000-4000-8000-000000000001',
    'd1600000-0000-4000-8000-000000000030',
    'd1400000-0000-4000-8000-000000000043',
    'route-chain-b1',
    nullif(result->>'active_binding_id', '')::uuid,
    nullif(result->>'current_lead_id', '')::uuid
  )
from queue_scope_route_results where label = 'chain-b1';

select ok(
  (select (result->>'is_current')::boolean
     and result->>'active_lead_id' = 'd1400000-0000-4000-8000-000000000043'
   from queue_scope_binding_results where label = 'route-chain-b1-apply'),
  'B1 applies A to B and becomes the route head'
);

insert into public.whatsapp_webhook_routing_outcomes
select organization_id, session_id, provider_message_id, ingress_sequence,
       'route-chain-k1', clock_timestamp()
from public.whatsapp_webhook_routing_snapshots
where organization_id = 'd1200000-0000-4000-8000-000000000001'
  and session_id = 'd1500000-0000-4000-8000-000000000001'
  and provider_message_id = 'route-chain-b1';

insert into queue_scope_binding_results (label, result)
select
  'route-chain-b2-apply',
  public.activate_whatsapp_conversation_lead_binding_if_current(
    'd1200000-0000-4000-8000-000000000001',
    'd1600000-0000-4000-8000-000000000030',
    'd1400000-0000-4000-8000-000000000043',
    'route-chain-b2',
    nullif(result->>'active_binding_id', '')::uuid,
    nullif(result->>'current_lead_id', '')::uuid
  )
from queue_scope_route_results where label = 'chain-b2';

select ok(
  (select (result->>'is_current')::boolean
   from queue_scope_binding_results where label = 'route-chain-b2-apply')
  and (select provider_message_id = 'route-chain-b2'
       from public.whatsapp_conversation_routing_heads
       where conversation_id = 'd1600000-0000-4000-8000-000000000030'),
  'same-target B2 remains current and advances the applied route head'
);

insert into public.whatsapp_webhook_routing_outcomes
select organization_id, session_id, provider_message_id, ingress_sequence,
       'route-chain-k2', clock_timestamp()
from public.whatsapp_webhook_routing_snapshots
where organization_id = 'd1200000-0000-4000-8000-000000000001'
  and session_id = 'd1500000-0000-4000-8000-000000000001'
  and provider_message_id = 'route-chain-b2';

insert into queue_scope_binding_results (label, result)
select
  'route-chain-c-apply',
  public.activate_whatsapp_conversation_lead_binding_if_current(
    'd1200000-0000-4000-8000-000000000001',
    'd1600000-0000-4000-8000-000000000030',
    'd1400000-0000-4000-8000-000000000044',
    'route-chain-c',
    nullif(result->>'active_binding_id', '')::uuid,
    nullif(result->>'current_lead_id', '')::uuid
  )
from queue_scope_route_results where label = 'chain-c';

select ok(
  (select (result->>'is_current')::boolean
     and result->>'active_lead_id' = 'd1400000-0000-4000-8000-000000000044'
   from queue_scope_binding_results where label = 'route-chain-c-apply')
  and (select provider_message_id = 'route-chain-c'
       from public.whatsapp_conversation_routing_heads
       where conversation_id = 'd1600000-0000-4000-8000-000000000030'),
  'C applies only after exact predecessor B2 and becomes current'
);

insert into public.whatsapp_webhook_routing_outcomes
select organization_id, session_id, provider_message_id, ingress_sequence,
       'route-chain-k3', clock_timestamp()
from public.whatsapp_webhook_routing_snapshots
where organization_id = 'd1200000-0000-4000-8000-000000000001'
  and session_id = 'd1500000-0000-4000-8000-000000000001'
  and provider_message_id = 'route-chain-c';

insert into queue_scope_route_results (label, result)
values (
  'chain-organic-resolved',
  public.resolve_whatsapp_webhook_inherited_routing_target(
    'd1200000-0000-4000-8000-000000000001',
    'd1500000-0000-4000-8000-000000000001',
    'route-chain-organic'
  )
);

select ok(
  (select (result->>'ready')::boolean
     and result->>'lead_id' = 'd1400000-0000-4000-8000-000000000044'
     and result->>'predecessor_provider_message_id' = 'route-chain-c'
   from queue_scope_route_results where label = 'chain-organic-resolved'),
  'organic successor resolves C from the applied predecessor head, not ingress-time A'
);

insert into queue_scope_binding_results (label, result)
select
  'route-chain-organic-apply',
  public.activate_whatsapp_conversation_lead_binding_if_current(
    'd1200000-0000-4000-8000-000000000001',
    'd1600000-0000-4000-8000-000000000030',
    'd1400000-0000-4000-8000-000000000044',
    'route-chain-organic',
    nullif(captured.result->>'active_binding_id', '')::uuid,
    nullif(captured.result->>'current_lead_id', '')::uuid
  )
from queue_scope_route_results as captured
where captured.label = 'chain-organic';

select ok(
  (select (result->>'is_current')::boolean
   from queue_scope_binding_results where label = 'route-chain-organic-apply')
  and (select provider_message_id = 'route-chain-organic'
       from public.whatsapp_conversation_routing_heads
       where conversation_id = 'd1600000-0000-4000-8000-000000000030'),
  'inherited organic event applies to C and advances the head monotonically'
);

insert into queue_scope_route_results (label, result)
values
  (
    'same-inbox-b',
    private.capture_whatsapp_webhook_routing_snapshot(
      'd1200000-0000-4000-8000-000000000001',
      'd1500000-0000-4000-8000-000000000001',
      'route-same-inbox-b', 'route-same-inbox-k1', 'backlog',
      'phone:551188880031', true,
      array['551188880031@s.whatsapp.net'], '551188880031',
      'contextual_intake', 'provider_event_ledger', false, false, false,
      null, 'd1300000-0000-4000-8000-000000000010',
      'd1400000-0000-4000-8000-000000000041'
    )
  ),
  (
    'same-inbox-organic',
    private.capture_whatsapp_webhook_routing_snapshot(
      'd1200000-0000-4000-8000-000000000001',
      'd1500000-0000-4000-8000-000000000001',
      'route-same-inbox-organic', 'route-same-inbox-k1', 'backlog',
      'phone:551188880031', true,
      array['551188880031@s.whatsapp.net'], '551188880031',
      'organic', null, false, false, false,
      null, null, null
    )
  );

select ok(
  (select result->>'target_mode' = 'inherit_predecessor'
     and result->>'predecessor_provider_message_id' = 'route-same-inbox-b'
     and result->>'predecessor_inbox_event_key' = 'route-same-inbox-k1'
   from queue_scope_route_results where label = 'same-inbox-organic'),
  'two binding messages in one unsplit inbox retain their exact in-envelope predecessor'
);

insert into queue_scope_binding_results (label, result)
select
  'same-inbox-b-apply',
  public.activate_whatsapp_conversation_lead_binding_if_current(
    'd1200000-0000-4000-8000-000000000001',
    'd1600000-0000-4000-8000-000000000031',
    'd1400000-0000-4000-8000-000000000041',
    'route-same-inbox-b',
    nullif(result->>'active_binding_id', '')::uuid,
    nullif(result->>'current_lead_id', '')::uuid
  )
from queue_scope_route_results where label = 'same-inbox-b';

insert into queue_scope_route_results (label, result)
values (
  'same-inbox-resolved',
  public.resolve_whatsapp_webhook_inherited_routing_target(
    'd1200000-0000-4000-8000-000000000001',
    'd1500000-0000-4000-8000-000000000001',
    'route-same-inbox-organic'
  )
);

select ok(
  (select (result->>'ready')::boolean
     and result->>'lead_id' = 'd1400000-0000-4000-8000-000000000041'
   from queue_scope_route_results where label = 'same-inbox-resolved'),
  'same-inbox successor becomes ready after its earlier message advances the head'
);

insert into queue_scope_binding_results (label, result)
select
  'same-inbox-organic-apply',
  public.activate_whatsapp_conversation_lead_binding_if_current(
    'd1200000-0000-4000-8000-000000000001',
    'd1600000-0000-4000-8000-000000000031',
    'd1400000-0000-4000-8000-000000000041',
    'route-same-inbox-organic',
    nullif(result->>'active_binding_id', '')::uuid,
    nullif(result->>'current_lead_id', '')::uuid
  )
from queue_scope_route_results where label = 'same-inbox-organic';

select ok(
  (select (result->>'is_current')::boolean
   from queue_scope_binding_results where label = 'same-inbox-organic-apply'),
  'same-inbox organic event applies after the prior message without waiting for inbox processed'
);

insert into queue_scope_route_results (label, result)
values
  (
    'replay-r1',
    private.capture_whatsapp_webhook_routing_snapshot(
      'd1200000-0000-4000-8000-000000000001',
      'd1500000-0000-4000-8000-000000000001',
      'route-replay-r1', 'route-replay-k1', 'backlog',
      'phone:551188880032', true,
      array['551188880032@s.whatsapp.net'], '551188880032',
      'contextual_intake', 'provider_event_ledger', false, false, false,
      null, 'd1300000-0000-4000-8000-000000000010',
      'd1400000-0000-4000-8000-000000000042'
    )
  ),
  (
    'replay-r3',
    private.capture_whatsapp_webhook_routing_snapshot(
      'd1200000-0000-4000-8000-000000000001',
      'd1500000-0000-4000-8000-000000000001',
      'route-replay-r3', 'route-replay-k3', 'live',
      'phone:551188880032', true,
      array['551188880032@s.whatsapp.net'], '551188880032',
      'organic', null, false, false, false,
      null, null, null
    )
  );

insert into queue_scope_binding_results (label, result)
select
  'replay-r1-apply',
  public.activate_whatsapp_conversation_lead_binding_if_current(
    'd1200000-0000-4000-8000-000000000001',
    'd1600000-0000-4000-8000-000000000032',
    'd1400000-0000-4000-8000-000000000042',
    'route-replay-r1',
    nullif(result->>'active_binding_id', '')::uuid,
    nullif(result->>'current_lead_id', '')::uuid
  )
from queue_scope_route_results where label = 'replay-r1';

insert into public.whatsapp_webhook_inbox (
  organization_id, session_id, provider, event_key, event_type, payload,
  processing_lane, status, next_attempt_at, expires_at
)
select
  'd1200000-0000-4000-8000-000000000001',
  'd1500000-0000-4000-8000-000000000001',
  'evolution_go', inbox_key, 'messages.upsert',
  jsonb_build_object(
    '__vimob_ingress', jsonb_build_object(
      'routing_key', 'phone:551188880032',
      'routing_snapshot', jsonb_build_object(
        'version', 1,
        'messages', jsonb_build_array(route.result)
      )
    )
  ),
  'backlog', inbox_status, now(), now() + interval '1 day'
from queue_scope_route_results as route
cross join (values
  ('route-replay-k1', 'dead'),
  ('route-replay-k2', 'processed')
) as replay_inbox(inbox_key, inbox_status)
where route.label = 'replay-r1';

insert into public.whatsapp_webhook_routing_outcomes
select organization_id, session_id, provider_message_id, ingress_sequence,
       'route-replay-k2', clock_timestamp()
from public.whatsapp_webhook_routing_snapshots
where organization_id = 'd1200000-0000-4000-8000-000000000001'
  and session_id = 'd1500000-0000-4000-8000-000000000001'
  and provider_message_id = 'route-replay-r1';

delete from public.whatsapp_webhook_inbox
where event_key in ('route-replay-k1', 'route-replay-k2');

select ok(
  not exists (
    select 1 from public.whatsapp_webhook_inbox
    where event_key in ('route-replay-k1', 'route-replay-k2')
  ) and exists (
    select 1 from public.whatsapp_webhook_routing_outcomes
    where provider_message_id = 'route-replay-r1'
      and completed_inbox_event_key = 'route-replay-k2'
  ),
  'K2 replay outcome survives deletion of dead K1 and processed replay inbox rows'
);

insert into queue_scope_route_results (label, result)
values (
  'replay-r3-resolved',
  public.resolve_whatsapp_webhook_inherited_routing_target(
    'd1200000-0000-4000-8000-000000000001',
    'd1500000-0000-4000-8000-000000000001',
    'route-replay-r3'
  )
);

select ok(
  (select (result->>'ready')::boolean
     and result->>'lead_id' = 'd1400000-0000-4000-8000-000000000042'
   from queue_scope_route_results where label = 'replay-r3-resolved'),
  'K3 successor proceeds from K2 outcome even after K1 inbox retention'
);

insert into queue_scope_binding_results (label, result)
select
  'replay-r3-apply',
  public.activate_whatsapp_conversation_lead_binding_if_current(
    'd1200000-0000-4000-8000-000000000001',
    'd1600000-0000-4000-8000-000000000032',
    'd1400000-0000-4000-8000-000000000042',
    'route-replay-r3',
    nullif(result->>'active_binding_id', '')::uuid,
    nullif(result->>'current_lead_id', '')::uuid
  )
from queue_scope_route_results where label = 'replay-r3';

insert into public.whatsapp_webhook_routing_outcomes
select organization_id, session_id, provider_message_id, ingress_sequence,
       'route-replay-k3', clock_timestamp()
from public.whatsapp_webhook_routing_snapshots
where organization_id = 'd1200000-0000-4000-8000-000000000001'
  and session_id = 'd1500000-0000-4000-8000-000000000001'
  and provider_message_id = 'route-replay-r3';

insert into queue_scope_route_results (label, result)
values (
  'replay-r4',
  private.capture_whatsapp_webhook_routing_snapshot(
    'd1200000-0000-4000-8000-000000000001',
    'd1500000-0000-4000-8000-000000000001',
    'route-replay-r4', 'route-replay-k4', 'live',
    'phone:551188880032', true,
    array['551188880032@s.whatsapp.net'], '551188880032',
    'organic', null, false, false, false,
    null, null, null
  )
);

select ok(
  (select result->>'state' = 'bound'
     and result->>'event_lead_id' = 'd1400000-0000-4000-8000-000000000042'
     and result->>'predecessor_provider_message_id' is null
   from queue_scope_route_results where label = 'replay-r4'),
  'a future event after durable outcomes captures current state without depending on deleted inbox history'
);

insert into queue_scope_binding_results (label, result)
select
  'replay-r4-apply',
  public.activate_whatsapp_conversation_lead_binding_if_current(
    'd1200000-0000-4000-8000-000000000001',
    'd1600000-0000-4000-8000-000000000032',
    'd1400000-0000-4000-8000-000000000042',
    'route-replay-r4',
    nullif(result->>'active_binding_id', '')::uuid,
    nullif(result->>'current_lead_id', '')::uuid
  )
from queue_scope_route_results where label = 'replay-r4';

insert into queue_scope_route_results (label, result)
values (
  'replay-r5',
  private.capture_whatsapp_webhook_routing_snapshot(
    'd1200000-0000-4000-8000-000000000001',
    'd1500000-0000-4000-8000-000000000001',
    'route-replay-r5', 'route-replay-k5', 'live',
    'phone:551188880032', true,
    array['551188880032@s.whatsapp.net'], '551188880032',
    'organic', null, false, false, false,
    null, null, null
  )
);

insert into public.whatsapp_webhook_routing_outcomes
select organization_id, session_id, provider_message_id, ingress_sequence,
       'route-replay-k4', clock_timestamp()
from public.whatsapp_webhook_routing_snapshots
where organization_id = 'd1200000-0000-4000-8000-000000000001'
  and session_id = 'd1500000-0000-4000-8000-000000000001'
  and provider_message_id = 'route-replay-r4';

select public.activate_whatsapp_conversation_lead_binding(
  'd1200000-0000-4000-8000-000000000001',
  'd1600000-0000-4000-8000-000000000032',
  'd1400000-0000-4000-8000-000000000042',
  null
);

select ok(
  (resolved->>'ready')::boolean = false
    and (resolved->>'terminal')::boolean
    and resolved->>'reason' = 'whatsapp_ingress_predecessor_head_invalidated',
  'explicit same-lead ABA relink rotates the binding epoch and invalidates an older inherit chain'
)
from (
  select public.resolve_whatsapp_webhook_inherited_routing_target(
    'd1200000-0000-4000-8000-000000000001',
    'd1500000-0000-4000-8000-000000000001',
    'route-replay-r5'
  ) as resolved
) as manual_barrier;

insert into public.organization_modules (
  organization_id, module_name, is_enabled
)
values (
  'd1200000-0000-4000-8000-000000000001', 'automations', true
)
on conflict (organization_id, module_name) do update
set is_enabled = excluded.is_enabled;

insert into public.whatsapp_messages (
  id, organization_id, conversation_id, session_id, lead_id,
  provider_message_id, message_id, from_me, direction,
  message_type, content, status, metadata
)
values (
  'd1700000-0000-4000-8000-000000000030',
  'd1200000-0000-4000-8000-000000000001',
  'd1600000-0000-4000-8000-000000000032',
  'd1500000-0000-4000-8000-000000000001',
  'd1400000-0000-4000-8000-000000000042',
  'route-automation-stale', 'route-automation-stale', false, 'inbound',
  'text', 'stale routing event', 'received',
  '{"whatsapp_event_binding_is_current":false}'::jsonb
);

select is(
  (select count(*)::bigint from public.automation_event_outbox
   where aggregate_id = 'd1700000-0000-4000-8000-000000000030'),
  0::bigint,
  'database automation capture ignores a stale/quarantined routing event even when it has a lead id'
);

insert into public.whatsapp_messages (
  id, organization_id, conversation_id, session_id, lead_id,
  provider_message_id, message_id, from_me, direction,
  message_type, content, status, metadata
)
values (
  'd1700000-0000-4000-8000-000000000031',
  'd1200000-0000-4000-8000-000000000001',
  'd1600000-0000-4000-8000-000000000032',
  'd1500000-0000-4000-8000-000000000001',
  'd1400000-0000-4000-8000-000000000042',
  'route-automation-current', 'route-automation-current', false, 'inbound',
  'text', 'current routing event', 'received',
  '{"whatsapp_event_binding_is_current":true}'::jsonb
);

select ok(
  (select count(*) = 1
     and bool_and(lead_id = 'd1400000-0000-4000-8000-000000000042'::uuid)
     and bool_and(conversation_id = 'd1600000-0000-4000-8000-000000000032'::uuid)
     and bool_and(
       payload->>'whatsapp_binding_id' = (
         select binding.id::text
         from public.whatsapp_conversation_lead_bindings as binding
         where binding.conversation_id = 'd1600000-0000-4000-8000-000000000032'
           and binding.active_to is null
       )
     )
   from public.automation_event_outbox
   where aggregate_id = 'd1700000-0000-4000-8000-000000000031'),
  'database automation capture freezes the exact current conversation binding epoch'
);

select ok(
  pg_catalog.pg_get_functiondef(
    'private.capture_automation_inbound_message_event()'::regprocedure
  ) ~ 'whatsapp_event_binding_is_current'
  and pg_catalog.pg_get_functiondef(
    'private.capture_automation_inbound_message_event()'::regprocedure
  ) ~* 'for[[:space:]]+share',
  'automation trigger definition independently rechecks the marker and row-locked binding'
);

-- Edge can leave an exact LID source active after learning its canonical JID.
-- The alias must still win without merging or moving the source history.
insert into public.whatsapp_conversations (
  id, organization_id, session_id, remote_jid, contact_name
)
values (
  'd1600000-0000-4000-8000-000000000035',
  'd1200000-0000-4000-8000-000000000001',
  'd1500000-0000-4000-8000-000000000001',
  '987654321012345@lid', 'Active exact LID source'
);

insert into queue_scope_route_results (label, result)
values
  (
    'lid-contextual',
    private.capture_whatsapp_webhook_routing_snapshot(
      'd1200000-0000-4000-8000-000000000001',
      'd1500000-0000-4000-8000-000000000001',
      'route-lid-contextual', 'route-lid-k1', 'backlog',
      'jid:987654321012345@lid', true,
      array['987654321012345@lid'], null,
      'contextual_intake', 'provider_event_ledger', false, false, false,
      null, 'd1300000-0000-4000-8000-000000000010',
      'd1400000-0000-4000-8000-000000000045'
    )
  ),
  (
    'lid-organic',
    private.capture_whatsapp_webhook_routing_snapshot(
      'd1200000-0000-4000-8000-000000000001',
      'd1500000-0000-4000-8000-000000000001',
      'route-lid-organic', 'route-lid-k2', 'live',
      'jid:987654321012345@lid', true,
      array['987654321012345@lid'], null,
      'organic', null, false, false, false,
      null, null, null
    )
  );

select ok(
  (select result->>'conversation_id' = 'd1600000-0000-4000-8000-000000000034'
     and result->>'event_lead_id' = 'd1400000-0000-4000-8000-000000000045'
     and result->>'routing_key' = 'jid:987654321012345@lid'
   from queue_scope_route_results where label = 'lid-contextual'),
  'known LID alias resolves the canonical conversation without collapsing to session scope'
);

select ok(
  (select result->>'target_mode' = 'inherit_predecessor'
     and result->>'predecessor_provider_message_id' = 'route-lid-contextual'
     and result->>'event_lead_id' is null
   from queue_scope_route_results where label = 'lid-organic'),
  'organic LID accepted before drain inherits its exact contextual predecessor'
);

insert into queue_scope_binding_results (label, result)
select
  'route-lid-contextual-apply',
  public.activate_whatsapp_conversation_lead_binding_if_current(
    'd1200000-0000-4000-8000-000000000001',
    'd1600000-0000-4000-8000-000000000034',
    'd1400000-0000-4000-8000-000000000045',
    'route-lid-contextual',
    nullif(result->>'active_binding_id', '')::uuid,
    nullif(result->>'current_lead_id', '')::uuid
  )
from queue_scope_route_results where label = 'lid-contextual';

insert into public.whatsapp_webhook_routing_outcomes
select organization_id, session_id, provider_message_id, ingress_sequence,
       'route-lid-k1', clock_timestamp()
from public.whatsapp_webhook_routing_snapshots
where organization_id = 'd1200000-0000-4000-8000-000000000001'
  and session_id = 'd1500000-0000-4000-8000-000000000001'
  and provider_message_id = 'route-lid-contextual';

insert into queue_scope_route_results (label, result)
values (
  'lid-organic-resolved',
  public.resolve_whatsapp_webhook_inherited_routing_target(
    'd1200000-0000-4000-8000-000000000001',
    'd1500000-0000-4000-8000-000000000001',
    'route-lid-organic'
  )
);

select ok(
  (select (result->>'ready')::boolean
     and result->>'conversation_id' = 'd1600000-0000-4000-8000-000000000034'
     and result->>'lead_id' = 'd1400000-0000-4000-8000-000000000045'
   from queue_scope_route_results where label = 'lid-organic-resolved'),
  'LID organic successor resolves the contextual card actually applied by its predecessor'
);

insert into public.leads (
  id, organization_id, assigned_user_id, name, phone, source
)
values (
  'd1400000-0000-4000-8000-000000000013',
  'd1200000-0000-4000-8000-000000000001',
  'd1100000-0000-4000-8000-000000000001',
  'Deleted Snapshot Lead', '551188880033', 'whatsapp'
);

insert into public.whatsapp_conversations (
  id, organization_id, session_id, remote_jid, contact_phone, contact_name
)
values (
  'd1600000-0000-4000-8000-000000000033',
  'd1200000-0000-4000-8000-000000000001',
  'd1500000-0000-4000-8000-000000000001',
  '551188880033@s.whatsapp.net', '551188880033', 'Deleted Snapshot Contact'
);

insert into queue_scope_route_results (label, result)
values (
  'deleted-lead-snapshot',
  private.capture_whatsapp_webhook_routing_snapshot(
    'd1200000-0000-4000-8000-000000000001',
    'd1500000-0000-4000-8000-000000000001',
    'route-deleted-lead', 'route-deleted-lead-k1', 'live',
    'phone:551188880033', true,
    array['551188880033@s.whatsapp.net'], '551188880033',
    'contextual_intake', 'provider_event_ledger', false, false, false,
    null, 'd1300000-0000-4000-8000-000000000010',
    'd1400000-0000-4000-8000-000000000013'
  )
);

delete from public.leads
where id = 'd1400000-0000-4000-8000-000000000013';

select ok(
  (select result->>'event_lead_id' = 'd1400000-0000-4000-8000-000000000013'
   from queue_scope_route_results where label = 'deleted-lead-snapshot')
  and not exists (
    select 1 from public.leads
    where id = 'd1400000-0000-4000-8000-000000000013'
  ),
  'hard-deleted event lead leaves immutable neutralization evidence for Edge/native terminal quarantine'
);

select ok(
  pg_catalog.to_regprocedure(
    'private.cleanup_whatsapp_webhook_routing_provenance(integer,timestamp with time zone)'
  ) is not null
  and pg_catalog.pg_get_functiondef(
    'private.cleanup_whatsapp_webhook_routing_provenance(integer,timestamp with time zone)'::regprocedure
  ) ~ 'whatsapp_conversation_routing_heads'
  and pg_catalog.pg_get_functiondef(
    'private.cleanup_whatsapp_webhook_routing_provenance(integer,timestamp with time zone)'::regprocedure
  ) ~ 'predecessor_provider_message_id',
  'retention cleanup is installed with explicit head and predecessor preservation gates'
);

insert into public.leads (id, organization_id, assigned_user_id, name, phone, source)
values (
  'd1400000-0000-4000-8000-000000000020',
  'd1200000-0000-4000-8000-000000000001',
  'd1100000-0000-4000-8000-000000000001',
  'Binding Delete Lead', '5511988880020', 'whatsapp'
);

insert into public.whatsapp_sessions (
  id, organization_id, owner_user_id, instance_name, provider, status, is_active
)
values (
  'd1500000-0000-4000-8000-000000000002',
  'd1200000-0000-4000-8000-000000000001',
  'd1100000-0000-4000-8000-000000000001',
  'queue-scope-delete-session', 'evolution_go', 'connected', true
);

insert into public.whatsapp_conversations (
  id, organization_id, session_id, remote_jid, contact_name
)
values (
  'd1600000-0000-4000-8000-000000000020',
  'd1200000-0000-4000-8000-000000000001',
  'd1500000-0000-4000-8000-000000000002',
  '5511988880020@s.whatsapp.net', 'Delete Contract Contact'
);

select public.activate_whatsapp_conversation_lead_binding(
  'd1200000-0000-4000-8000-000000000001',
  'd1600000-0000-4000-8000-000000000020',
  'd1400000-0000-4000-8000-000000000020',
  'provider-delete-contract'
);

insert into public.whatsapp_messages (
  id, organization_id, conversation_id, session_id, lead_id,
  provider_message_id, message_id, from_me, direction,
  message_type, content, status
)
values (
  'd1700000-0000-4000-8000-000000000020',
  'd1200000-0000-4000-8000-000000000001',
  'd1600000-0000-4000-8000-000000000020',
  'd1500000-0000-4000-8000-000000000002',
  null,
  'provider-delete-contract', 'provider-delete-contract', false, 'inbound',
  'text', 'Session deletion history', 'received'
);

select lives_ok(
  $$delete from public.whatsapp_sessions where id = 'd1500000-0000-4000-8000-000000000002'$$,
  'deleting a session is not blocked by immutable binding history'
);

select ok(
  (
    select conversation.session_id is null
      and binding.session_id is null
      and message.session_id is null
      and message.lead_id = 'd1400000-0000-4000-8000-000000000020'::uuid
    from public.whatsapp_conversations as conversation
    join public.whatsapp_conversation_lead_bindings as binding
      on binding.conversation_id = conversation.id
     and binding.active_to is null
    join public.whatsapp_messages as message
      on message.conversation_id = conversation.id
     and message.id = 'd1700000-0000-4000-8000-000000000020'
    where conversation.id = 'd1600000-0000-4000-8000-000000000020'
  ),
  'session deletion nulls conversation, binding and historical message session IDs safely'
);

select lives_ok(
  $$delete from public.leads where id = 'd1400000-0000-4000-8000-000000000020'$$,
  'hard-deleting a lead is not blocked by binding history'
);

select ok(
  (
    select lead_id is null
    from public.whatsapp_conversations
    where id = 'd1600000-0000-4000-8000-000000000020'
  )
  and exists (
    select 1
    from public.whatsapp_conversation_lead_bindings
    where conversation_id = 'd1600000-0000-4000-8000-000000000020'
      and lead_id = 'd1400000-0000-4000-8000-000000000020'::uuid
      and active_to is not null
  ),
  'lead deletion nulls the conversation but preserves a closed binding tombstone'
);

select ok(
  (
    select not (replay->>'changed')::boolean
      and not (replay->>'is_current')::boolean
      and (replay->>'lead_id')::uuid = 'd1400000-0000-4000-8000-000000000020'::uuid
      and replay->>'active_lead_id' is null
    from (
      select public.activate_whatsapp_conversation_lead_binding(
        'd1200000-0000-4000-8000-000000000001',
        'd1600000-0000-4000-8000-000000000020',
        'd1400000-0000-4000-8000-000000000020',
        'provider-delete-contract'
      ) as replay
    ) as deleted_lead_replay
  ),
  'provider replay remains idempotent after the original lead is hard-deleted'
);

select * from finish();
rollback;
