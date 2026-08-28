-- Production-safe contract checks. Every scenario is rolled back explicitly.

begin;
do $$
declare
  result jsonb;
  execution_status text;
  current_node text;
begin
  if not exists (select 1 from public.automation_executions where id = '0bf11355-3cd8-45fe-b8f1-f621e3892c99') then
    raise notice 'Pamella campaign contract fixture is not installed; skipping.';
    return;
  end if;
  result := public.process_automation_inbound_message(
    '4251164b-cfb0-402a-a854-ecae79470561',
    'f4c4fcc9-374e-4118-aefe-22388204945e',
    'fa2d3170-a8c5-433f-9318-35f7b8cb3d92',
    gen_random_uuid(),
    'text',
    'morar',
    now()
  );
  if not coalesce((result->>'ok')::boolean, false)
     or jsonb_array_length(result->'resumed_execution_ids') <> 1 then
    raise exception 'text reply did not resume exactly one execution: %', result;
  end if;

  select status, current_node_key
  into execution_status, current_node
  from public.automation_executions
  where id = '0bf11355-3cd8-45fe-b8f1-f621e3892c99';

  if execution_status <> 'queued' or current_node <> 'move_to_in_service' then
    raise exception 'reply branch was not fenced to move_to_in_service: %, %', execution_status, current_node;
  end if;
end;
$$;
rollback;

begin;
do $$
declare
  result jsonb;
  persisted_stage uuid;
begin
  if not exists (select 1 from public.automation_executions where id = '0bf11355-3cd8-45fe-b8f1-f621e3892c99') then
    raise notice 'Pamella campaign contract fixture is not installed; skipping.';
    return;
  end if;
  update public.automation_executions
  set status = 'running',
      current_node_key = 'move_to_in_service',
      locked_by = 'contract-test-lease',
      locked_at = now(),
      next_execution_at = null
  where id = '0bf11355-3cd8-45fe-b8f1-f621e3892c99';

  result := public.apply_automation_internal_effect(
    '4251164b-cfb0-402a-a854-ecae79470561',
    '0bf11355-3cd8-45fe-b8f1-f621e3892c99',
    'move_to_in_service',
    'contract-test-lease',
    'contract-test-move:' || gen_random_uuid()::text,
    'move_lead',
    jsonb_build_object(
      'pipeline_id', '03c0d601-09af-41a4-85ec-f425d66b1bac',
      'stage_id', '35d45cd1-a4fa-437e-818e-9c17fa0fa3b9'
    )
  );

  select stage_id into persisted_stage
  from public.leads
  where id = 'f4c4fcc9-374e-4118-aefe-22388204945e';
  if not coalesce((result->>'ok')::boolean, false)
     or persisted_stage <> '35d45cd1-a4fa-437e-818e-9c17fa0fa3b9'::uuid then
    raise exception 'move_lead internal effect failed: %, %', persisted_stage, result;
  end if;
end;
$$;
rollback;

begin;
do $$
declare
  result jsonb;
  execution_status text;
begin
  if not exists (select 1 from public.automation_executions where id = '0bf11355-3cd8-45fe-b8f1-f621e3892c99') then
    raise notice 'Pamella campaign contract fixture is not installed; skipping.';
    return;
  end if;
  result := public.process_automation_inbound_message(
    '4251164b-cfb0-402a-a854-ecae79470561',
    'f4c4fcc9-374e-4118-aefe-22388204945e',
    'fa2d3170-a8c5-433f-9318-35f7b8cb3d92',
    gen_random_uuid(),
    'audio',
    null,
    now()
  );
  if jsonb_array_length(result->'cancelled_execution_ids') <> 1 then
    raise exception 'audio did not hand off the active execution: %', result;
  end if;

  select status into execution_status
  from public.automation_executions
  where id = '0bf11355-3cd8-45fe-b8f1-f621e3892c99';
  if execution_status <> 'cancelled' then
    raise exception 'audio handoff did not cancel execution: %', execution_status;
  end if;
end;
$$;
rollback;

begin;
do $$
declare
  generated_id text := gen_random_uuid()::text;
  execution_status text;
begin
  if not exists (select 1 from public.automation_executions where id = '0bf11355-3cd8-45fe-b8f1-f621e3892c99') then
    raise notice 'Pamella campaign contract fixture is not installed; skipping.';
    return;
  end if;
  insert into public.whatsapp_messages (
    organization_id, conversation_id, session_id, lead_id, sender_user_id,
    provider_message_id, message_id, client_message_id, from_me, direction,
    message_type, content, status, sent_at, metadata
  ) values (
    '4251164b-cfb0-402a-a854-ecae79470561',
    'fa2d3170-a8c5-433f-9318-35f7b8cb3d92',
    'bcd852e7-8141-4245-bd8f-02a1700fb541',
    'f4c4fcc9-374e-4118-aefe-22388204945e',
    '6b276283-b5e2-4cd4-89b0-3ca23e49196c',
    generated_id, generated_id, generated_id,
    true, 'outbound', 'text', '[TESTE ROLLBACK] atendimento humano',
    'sent', now(), jsonb_build_object('source', 'rollback_contract_test')
  );

  select status into execution_status
  from public.automation_executions
  where id = '0bf11355-3cd8-45fe-b8f1-f621e3892c99';
  if execution_status <> 'cancelled' then
    raise exception 'human outbound did not cancel execution: %', execution_status;
  end if;
end;
$$;
rollback;

begin;
do $$
declare
  result jsonb;
  persisted_stage uuid;
begin
  if not exists (select 1 from public.automation_executions where id = '0bf11355-3cd8-45fe-b8f1-f621e3892c99') then
    raise notice 'Pamella campaign contract fixture is not installed; skipping.';
    return;
  end if;
  result := private.automation_move_lead_stage(
    '4251164b-cfb0-402a-a854-ecae79470561',
    'f4c4fcc9-374e-4118-aefe-22388204945e',
    '35d45cd1-a4fa-437e-818e-9c17fa0fa3b9',
    '03c0d601-09af-41a4-85ec-f425d66b1bac'
  );
  select stage_id into persisted_stage
  from public.leads
  where id = 'f4c4fcc9-374e-4118-aefe-22388204945e';
  if persisted_stage <> '35d45cd1-a4fa-437e-818e-9c17fa0fa3b9'::uuid
     or not coalesce((result->>'stage_changed')::boolean, false) then
    raise exception 'canonical stage move failed: %, %', persisted_stage, result;
  end if;
end;
$$;
rollback;

-- The production campaign fixture is intentionally optional in local and CI
-- databases. The scenarios above still abort on any contract violation when
-- it is installed; this final TAP result gives pg_prove a valid plan either
-- way instead of reporting an infrastructure-level "no plan" failure.
begin;
create extension if not exists pgtap with schema extensions;
select plan(1);

select case
  when exists (
    select 1
    from public.automation_executions
    where id = '0bf11355-3cd8-45fe-b8f1-f621e3892c99'
  ) then pass('Pamella conversational handoff scenarios completed without contract violations')
  else skip('Pamella campaign contract fixture is not installed', 1)
end;

select * from finish();
rollback;
