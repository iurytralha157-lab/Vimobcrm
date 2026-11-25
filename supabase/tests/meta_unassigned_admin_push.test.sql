begin;

-- Reuse the real persisted channel, scoped push device, lease, snapshot and
-- provider-start ledger. No test sender executes a network request.
create function private.fixture_start_meta_admin_push(
  p_notification uuid, p_channel text, p_device uuid, p_patch jsonb default '{}'
)
returns text language plpgsql as $function$
declare
  lease uuid := gen_random_uuid();
  candidate_delivery_id uuid;
  snapshot jsonb;
  result text;
begin
  insert into private.notification_deliveries(
    notification_id, organization_id, user_id, channel, recipient_key, push_token_id,
    idempotency_key, status, expires_at, lease_token, leased_by, lease_expires_at
  )
  select id, organization_id, user_id, p_channel, gen_random_uuid()::text,
    case when p_channel = 'push' then p_device end, gen_random_uuid()::text, 'leased',
    clock_timestamp() + interval '1 hour', lease, 'fixture|push_device_v3|wa_push_v2',
    clock_timestamp() + interval '5 minutes'
  from public.notifications where id = p_notification
  returning id into strict candidate_delivery_id;

  select jsonb_build_object('id', id, 'organization_id', organization_id, 'user_id', user_id,
    'lead_id', lead_id, 'title', coalesce(title, ''), 'content', coalesce(content, body, ''),
    'type', coalesce(type, 'info'), 'target_url', coalesce(target_url, ''),
    'metadata', coalesce(metadata, '{}') - array['dispatch', 'whatsapp_dispatch', 'push_dispatch', 'email_dispatch'])
    || p_patch into strict snapshot
  from public.notifications where id = p_notification;

  result := private.start_queue_authorized_notification_delivery(candidate_delivery_id, lease, 'synthetic', snapshot);
  perform private.fixture_assert(
    (select attempt_count = case when result = 'started' then 1 else 0 end
      from private.notification_deliveries where id = candidate_delivery_id)
    and (select count(*) = case when result = 'started' then 1 else 0 end
      from private.notification_delivery_attempts where notification_delivery_attempts.delivery_id = candidate_delivery_id),
    'durable provider-attempt ledger matches send authorization'
  );
  return result;
end;
$function$;

do $test$
declare
  org uuid := gen_random_uuid();
  other_org uuid := gen_random_uuid();
  admin uuid := gen_random_uuid();
  manager uuid := gen_random_uuid();
  agent uuid := gen_random_uuid();
  lead uuid := gen_random_uuid();
  pool_lead uuid := gen_random_uuid();
  owned_lead uuid := gen_random_uuid();
  queue_id uuid := gen_random_uuid();
  admin_device uuid := gen_random_uuid();
  agent_device uuid := gen_random_uuid();
  marked_id uuid;
  pool_marked_id uuid;
  owned_id uuid;
  prior_cycle uuid := gen_random_uuid();
  marked jsonb := '{"event_key":"new_lead_received","meta_unassigned_admin_alert":true,"unassigned":true,"leadgen_id":"synthetic-meta-lead"}';
  ordinary jsonb := '{"event_key":"new_lead_received"}';
  lane text;
begin
  insert into public.organizations(id, created_by) values (org, admin), (other_org, admin);
  insert into public.users(id, name) values (admin, 'Admin'), (manager, 'Manager'), (agent, 'Corretor');
  insert into public.organization_members(organization_id, user_id, role)
    values (org, admin, 'admin'), (org, manager, 'manager'), (org, agent, 'user'), (other_org, admin, 'admin');
  insert into public.push_tokens(id, user_id, organization_id)
    values (admin_device, admin, other_org), (agent_device, agent, org);
  insert into public.leads(id, organization_id, assigned_user_id, meta_lead_id)
    values (lead, org, null, 'synthetic-meta-lead'), (pool_lead, org, null, 'synthetic-pool-meta'),
      (owned_lead, org, agent, 'synthetic-owned-meta');
  insert into public.round_robins(id, organization_id, name) values (queue_id, org, 'Pool restrito');
  insert into private.queue_lead_runtime(organization_id, lead_id, round_robin_id, state, reason, baseline_at, max_assignments)
    values (org, pool_lead, queue_id, 'pool_waiting', 'synthetic', clock_timestamp(), 3);
  insert into public.notifications(organization_id, user_id, lead_id, type, title, channel, metadata)
    values (org, admin, lead, 'lead', 'Synthetic administrative new lead', 'in_app', marked)
    returning id into marked_id;
  insert into public.notifications(organization_id, user_id, lead_id, type, title, channel, metadata)
    values (org, admin, pool_lead, 'lead', 'Synthetic protected pool lead', 'in_app',
      marked || '{"leadgen_id":"synthetic-pool-meta"}')
    returning id into pool_marked_id;
  insert into public.notifications(organization_id, user_id, lead_id, type, title, channel, metadata)
    values (org, agent, owned_lead, 'lead', 'Synthetic assigned new lead', 'in_app', ordinary)
    returning id into owned_id;

  perform private.fixture_assert(private.queue_notification_delivery_allowed_for_channel(
    org, lead, admin, 'new_lead_received', marked, 'push'), 'preflight allows current admin on unassigned lead');
  perform private.fixture_assert(not private.queue_notification_delivery_allowed(
    org, lead, admin, 'new_lead_received', marked), 'legacy authorization stays restrictive');
  perform private.fixture_assert(not private.queue_notification_delivery_allowed_for_channel(
    other_org, lead, admin, 'new_lead_received', marked, 'push'), 'lead is scoped to the organization');
  perform private.fixture_assert(not private.queue_notification_delivery_allowed_for_channel(
    org, lead, agent, 'new_lead_received', marked, 'push'), 'ordinary agent cannot get administrative alert');
  perform private.fixture_assert(not private.queue_notification_delivery_allowed_for_channel(
    org, lead, admin, 'new_lead_received', marked || '{"leadgen_id":"other-lead"}', 'push'), 'Meta lead identity is checked');
  perform private.fixture_assert(not private.queue_notification_delivery_allowed_for_channel(
    org, lead, admin, 'new_lead_received', marked || '{"meta_unassigned_admin_alert":"true"}', 'push'), 'marker must be boolean');
  perform private.fixture_assert(private.queue_notification_delivery_allowed_for_channel(
    org, pool_lead, admin, 'new_lead_received', marked || '{"leadgen_id":"synthetic-pool-meta"}', 'push'), 'in-scope admin can read protected pool');
  perform private.fixture_assert(not private.queue_notification_delivery_allowed_for_channel(
    org, pool_lead, manager, 'new_lead_received', marked || '{"leadgen_id":"synthetic-pool-meta"}', 'push'), 'manager outside protected pool is denied');

  foreach lane in array array['whatsapp', 'email'] loop
    perform private.fixture_assert(not private.queue_notification_delivery_allowed_for_channel(
      org, lead, admin, 'new_lead_received', marked, lane), lane || ' preflight denies an administrative push marker');
    perform private.fixture_assert(
      private.fixture_start_meta_admin_push(marked_id, lane, null) = 'queue_policy_changed',
      lane || ' final authorization uses the actual durable channel'
    );
  end loop;
  foreach lane in array array['push', 'whatsapp', 'email'] loop
    perform private.fixture_assert(private.fixture_start_meta_admin_push(owned_id, lane, agent_device) = 'started',
      'normal assigned delivery is preserved on ' || lane);
  end loop;

  perform private.fixture_assert(private.fixture_start_meta_admin_push(marked_id, 'push', admin_device) = 'started',
    'administrative push with in-app notification channel starts from the actual push row');
  perform private.fixture_assert(private.fixture_start_meta_admin_push(marked_id, 'push', admin_device, '{"title":"stale"}')
    = 'queue_policy_changed', 'snapshot changed after preflight');
  perform private.fixture_assert(private.fixture_start_meta_admin_push(marked_id, 'push', agent_device)
    = 'lease_lost', 'other account device rejected');

  update public.notifications set metadata = metadata || '{"event_key":"custom_event"}' where id = marked_id;
  perform private.fixture_assert(private.fixture_start_meta_admin_push(marked_id, 'push', admin_device)
    = 'queue_policy_changed', 'marked event cannot skip authorization by changing event type');
  update public.notifications set metadata = marked where id = marked_id;

  update public.organization_members set role = 'user' where organization_id = org and user_id = admin;
  perform private.fixture_assert(private.fixture_start_meta_admin_push(marked_id, 'push', admin_device)
    = 'queue_policy_changed', 'role change after preflight revokes marked delivery');
  update public.organization_members set role = 'admin' where organization_id = org and user_id = admin;
  update public.leads set assigned_user_id = admin where id = lead;
  perform private.fixture_assert(private.fixture_start_meta_admin_push(marked_id, 'push', admin_device)
    = 'queue_policy_changed', 'assignment after preflight revokes the previous administrative alert even to the new owner');
  update public.leads set assigned_user_id = null where id = lead;
  insert into public.lead_assignment_cycles(id, organization_id, lead_id, assigned_user_id, assigned_at, ended_at)
    values (prior_cycle, org, lead, admin, clock_timestamp(), clock_timestamp());
  perform private.fixture_assert(private.fixture_start_meta_admin_push(marked_id, 'push', admin_device)
    = 'queue_policy_changed', 'legacy assignment then release cannot revive the first-entry alert');
  delete from public.lead_assignment_cycles where id = prior_cycle;
  update private.queue_lead_runtime set last_user_id = admin where lead_id = pool_lead;
  perform private.fixture_assert(private.fixture_start_meta_admin_push(pool_marked_id, 'push', admin_device)
    = 'queue_policy_changed', 'managed queue assignment then release cannot revive the first-entry alert');

  drop function private.meta_unassigned_admin_push_enabled();
  perform private.fixture_assert(private.fixture_start_meta_admin_push(marked_id, 'push', admin_device)
    = 'queue_policy_changed', 'kill switch stops a persisted marked delivery');
  perform private.fixture_assert(private.fixture_start_meta_admin_push(owned_id, 'push', agent_device) = 'started',
    'kill switch preserves ordinary sends');
  insert into public.notifications(organization_id, user_id, lead_id, type, title, metadata)
    values (org, admin, lead, 'lead', 'In-flight intake', marked || '{"dedupe_key":"meta_unassigned_admin_alert:fixture"}');
  perform private.fixture_assert(exists(select 1 from public.notifications where title = 'In-flight intake'
    and not (metadata ? 'meta_unassigned_admin_alert') and metadata->>'dedupe_key' is null),
    'in-flight trusted write does not fail intake or leave a reserved marker after disable');
end;
$test$;

grant insert, select, update on public.notifications to anon, authenticated;
do $test$
declare
  client_role text;
  payload jsonb;
begin
  foreach client_role in array array['anon', 'authenticated'] loop
    execute format('set local role %I', client_role);
    foreach payload in array array['{"meta_unassigned_admin_alert":false}'::jsonb,
      '{"dedupe_key":"meta_unassigned_admin_alert:fixture"}'::jsonb]
    loop
      begin
        insert into public.notifications(type, title, metadata) values ('lead', 'Forged fixture', payload);
        raise exception 'client role % inserted reserved metadata', client_role;
      exception when insufficient_privilege then
        if sqlerrm <> 'meta_unassigned_admin_alert_backend_owned' then raise; end if;
      end;
    end loop;
    begin
      update public.notifications set title = 'Forged change' where title = 'Synthetic administrative new lead';
      raise exception 'client role % altered a marked row', client_role;
    exception when insufficient_privilege then
      if sqlerrm <> 'meta_unassigned_admin_alert_backend_owned' then raise; end if;
    end;
    update public.notifications set is_read = true where title = 'Synthetic administrative new lead';
    execute 'reset role';
  end loop;
end;
$test$;
select private.fixture_assert(exists(select 1 from public.notifications
  where title = 'Synthetic administrative new lead' and is_read), 'notifications can still be marked read by exact column update');
rollback;
