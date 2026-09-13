begin;

create extension if not exists pgtap with schema extensions;
select plan(56);

select has_table(
  'private',
  'notification_deliveries',
  'normalized notification delivery table exists'
);
select has_table(
  'private',
  'notification_delivery_attempts',
  'notification delivery attempt ledger exists'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'private.notification_deliveries'::regclass)
  and (select relrowsecurity from pg_class where oid = 'private.notification_delivery_attempts'::regclass),
  'both private delivery tables have RLS enabled as defense in depth'
);
select ok(
  not has_table_privilege('anon', 'private.notification_deliveries', 'select,insert,update,delete')
  and not has_table_privilege('authenticated', 'private.notification_deliveries', 'select,insert,update,delete')
  and not has_table_privilege('anon', 'private.notification_delivery_attempts', 'select,insert,update,delete')
  and not has_table_privilege('authenticated', 'private.notification_delivery_attempts', 'select,insert,update,delete'),
  'browser roles cannot inspect or mutate the private outbox'
);
select ok(
  not has_table_privilege('service_role', 'private.notification_deliveries', 'select,insert,update,delete')
  and not has_table_privilege('service_role', 'private.notification_delivery_attempts', 'select,insert,update,delete'),
  'service role has no direct table privileges and must use fenced functions'
);
select ok(
  has_function_privilege(
    'service_role',
    'private.claim_notification_deliveries(text,integer,interval,text[])',
    'execute'
  )
  and has_function_privilege(
    'service_role',
    'private.complete_notification_delivery(uuid,uuid,text,text,text,text,jsonb,timestamptz)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'private.claim_notification_deliveries(text,integer,interval,text[])',
    'execute'
  ),
  'only the backend service role can claim and complete deliveries'
);
select ok(
  not has_function_privilege(
    'service_role',
    'private.materialize_notification_deliveries(uuid,boolean)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'private.notification_delivery_expected_message_id(text)',
    'execute'
  ),
  'trigger and derivation helpers cannot be called by API roles'
);
select ok(
  exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.notifications'::regclass
      and tgname = 'sync_notification_deliveries_from_notification'
      and not tgisinternal
  ),
  'all notification producers feed the normalized outbox through one trigger'
);
select ok(
  exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.whatsapp_sessions'::regclass
      and tgname = 'wake_notification_deliveries_after_whatsapp_connect'
      and not tgisinternal
  ),
  'notification session reconnect wakes its dependency-blocked deliveries'
);
select ok(
  pg_get_functiondef(
    'private.claim_notification_deliveries(text,integer,interval,text[])'::regprocedure
  ) ilike '%for update skip locked%',
  'claim uses non-blocking row locking for concurrent workers'
);
select ok(
  pg_get_indexdef('private.notification_deliveries_due_idx'::regclass)
    ilike '%where (status = any%queued%retry_wait%',
  'claim has a partial due-work index'
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
values
  (
    '00000000-0000-0000-0000-000000000000',
    'd1100000-0000-4000-8000-000000000001',
    'authenticated', 'authenticated', 'delivery-admin@example.test',
    crypt('test-password', gen_salt('bf', 4)), now(),
    '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    'd1100000-0000-4000-8000-000000000002',
    'authenticated', 'authenticated', 'delivery-no-token@example.test',
    crypt('test-password', gen_salt('bf', 4)), now(),
    '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''
  );

insert into public.organizations (id, name, slug, is_active)
values (
  'd1200000-0000-4000-8000-000000000001',
  'Normalized Delivery Test',
  'normalized-delivery-test',
  true
);

insert into public.users (id, organization_id, name, email, role, is_active)
values
  (
    'd1100000-0000-4000-8000-000000000001',
    'd1200000-0000-4000-8000-000000000001',
    'Delivery Admin', 'delivery-admin@example.test', 'admin', true
  ),
  (
    'd1100000-0000-4000-8000-000000000002',
    'd1200000-0000-4000-8000-000000000001',
    'No Token User', 'delivery-no-token@example.test', 'user', true
  )
on conflict (id) do update
set organization_id = excluded.organization_id,
    name = excluded.name,
    email = excluded.email,
    role = excluded.role,
    is_active = excluded.is_active;

insert into public.organization_members (organization_id, user_id, role, is_active)
values
  (
    'd1200000-0000-4000-8000-000000000001',
    'd1100000-0000-4000-8000-000000000001',
    'admin', true
  ),
  (
    'd1200000-0000-4000-8000-000000000001',
    'd1100000-0000-4000-8000-000000000002',
    'user', true
  )
on conflict (user_id, organization_id) do update
set role = excluded.role,
    is_active = excluded.is_active;

insert into public.push_tokens (
  id, user_id, organization_id, token, platform, is_active
)
values (
  'd1300000-0000-4000-8000-000000000001',
  'd1100000-0000-4000-8000-000000000001',
  'd1200000-0000-4000-8000-000000000001',
  'normalized-delivery-device-token',
  'android',
  true
);

select lives_ok(
  $$
    insert into public.notifications (
      id, organization_id, user_id, title, content, body, type, channel, metadata
    ) values (
      'd1400000-0000-4000-8000-000000000001',
      'd1200000-0000-4000-8000-000000000001',
      'd1100000-0000-4000-8000-000000000001',
      'Novo lead', 'Novo lead recebido', 'Novo lead recebido', 'info', 'in_app',
      '{
        "event_key":"new_lead_received",
        "dedupe_key":"normalized:test:lead:1",
        "dispatch":{
          "whatsapp":{"required":true,"status":"pending"},
          "email":{"required":true,"status":"pending"},
          "push":{"required":true,"status":"pending"}
        }
      }'::jsonb
    )
  $$,
  'one legacy-shaped notification is materialized without producer changes'
);
select is(
  (
    select count(*)::bigint
    from private.notification_deliveries
    where notification_id = 'd1400000-0000-4000-8000-000000000001'
  ),
  3::bigint,
  'one delivery is created for each required channel and active push token'
);
select results_eq(
  $$
    select channel || ':' || recipient_key
    from private.notification_deliveries
    where notification_id = 'd1400000-0000-4000-8000-000000000001'
    order by channel
  $$,
  array[
    'email:user:d1100000-0000-4000-8000-000000000001',
    'push:push_token:d1300000-0000-4000-8000-000000000001',
    'whatsapp:user:d1100000-0000-4000-8000-000000000001'
  ],
  'recipient keys are stable identifiers and contain no email, phone or token secret'
);
select is(
  (
    select push_token_id
    from private.notification_deliveries
    where notification_id = 'd1400000-0000-4000-8000-000000000001'
      and channel = 'push'
  ),
  'd1300000-0000-4000-8000-000000000001'::uuid,
  'push is normalized to one exact active token'
);
select ok(
  (
    select metadata ->> 'expected_message_id'
      = private.notification_delivery_expected_message_id(idempotency_key)
      and metadata ->> 'expected_message_id' ~ '^[0-9A-F]{32}$'
    from private.notification_deliveries
    where notification_id = 'd1400000-0000-4000-8000-000000000001'
      and channel = 'whatsapp'
  ),
  'WhatsApp stanza id is deterministically precomputed before provider I/O'
);
select lives_ok(
  $$
    update public.notifications
    set metadata = metadata || jsonb_build_object('producer_replayed_at', now())
    where id = 'd1400000-0000-4000-8000-000000000001'
  $$,
  'producer replay can safely invoke materialization again'
);
select is(
  (
    select count(*)::bigint
    from private.notification_deliveries
    where notification_id = 'd1400000-0000-4000-8000-000000000001'
  ),
  3::bigint,
  'materialization is idempotent and does not duplicate terminal or active jobs'
);

create temporary table normalized_delivery_claims (
  key text primary key,
  delivery_id uuid not null,
  lease_token uuid not null
);

insert into normalized_delivery_claims (key, delivery_id, lease_token)
select 'whatsapp', delivery.id, delivery.lease_token
from private.claim_notification_deliveries(
  'pgtap-worker', 1, interval '2 minutes', array['whatsapp']::text[]
) as delivery
where delivery.notification_id = 'd1400000-0000-4000-8000-000000000001';

select is(
  (select count(*)::bigint from normalized_delivery_claims where key = 'whatsapp'),
  1::bigint,
  'worker atomically claims one due WhatsApp delivery'
);
select ok(
  (
    select status = 'leased' and attempt_count = 0 and lease_token is not null
    from private.notification_deliveries
    where id = (select delivery_id from normalized_delivery_claims where key = 'whatsapp')
  ),
  'claim leases work without consuming provider-attempt budget'
);
select is(
  private.start_notification_delivery(
    (select delivery_id from normalized_delivery_claims where key = 'whatsapp'),
    (select lease_token from normalized_delivery_claims where key = 'whatsapp'),
    'evolution_go'
  ),
  true,
  'start transitions the fenced lease to sending'
);
select ok(
  (
    select status = 'sending' and attempt_count = 1
    from private.notification_deliveries
    where id = (select delivery_id from normalized_delivery_claims where key = 'whatsapp')
  )
  and (
    select count(*) = 1
    from private.notification_delivery_attempts
    where delivery_id = (select delivery_id from normalized_delivery_claims where key = 'whatsapp')
      and event_type = 'send_attempt'
      and outcome = 'sending'
  ),
  'provider attempt begins only at sending and is recorded once'
);
select is(
  private.block_notification_delivery(
    (select delivery_id from normalized_delivery_claims where key = 'whatsapp'),
    (select lease_token from normalized_delivery_claims where key = 'whatsapp'),
    'whatsapp_session_disconnected',
    'session_disconnected',
    'Notification sender disconnected.'
  ),
  true,
  'a dependency discovered after start blocks the delivery'
);
select ok(
  (
    select status = 'blocked_dependency'
      and dependency_key = 'whatsapp_session_disconnected'
      and attempt_count = 0
      and lease_token is null
    from private.notification_deliveries
    where id = (select delivery_id from normalized_delivery_claims where key = 'whatsapp')
  ),
  'blocking restores budget and clears the worker lease'
);

insert into public.whatsapp_sessions (
  id, organization_id, owner_user_id, instance_name, provider, status,
  is_active, is_notification_session
)
values (
  'd1500000-0000-4000-8000-000000000001',
  'd1200000-0000-4000-8000-000000000001',
  'd1100000-0000-4000-8000-000000000001',
  'normalized-notification-sender',
  'evolution_go',
  'disconnected',
  true,
  true
);

select lives_ok(
  $$
    update public.whatsapp_sessions
    set status = 'connected', updated_at = now()
    where id = 'd1500000-0000-4000-8000-000000000001'
  $$,
  'notification session reconnect does not fail its source transaction'
);
select ok(
  (
    select status = 'queued'
      and dependency_key is null
      and next_attempt_at <= now()
    from private.notification_deliveries
    where id = (select delivery_id from normalized_delivery_claims where key = 'whatsapp')
  ),
  'reconnect immediately wakes only the session-blocked job'
);

insert into normalized_delivery_claims (key, delivery_id, lease_token)
select 'whatsapp', delivery.id, delivery.lease_token
from private.claim_notification_deliveries(
  'pgtap-worker', 1, interval '2 minutes', array['whatsapp']::text[]
) as delivery
where delivery.notification_id = 'd1400000-0000-4000-8000-000000000001'
on conflict (key) do update
set delivery_id = excluded.delivery_id,
    lease_token = excluded.lease_token;

select is(
  private.start_notification_delivery(
    (select delivery_id from normalized_delivery_claims where key = 'whatsapp'),
    (select lease_token from normalized_delivery_claims where key = 'whatsapp'),
    'evolution_go'
  ),
  true,
  'unblocked delivery can start a fresh provider attempt'
);
select is(
  private.reschedule_notification_delivery(
    (select delivery_id from normalized_delivery_claims where key = 'whatsapp'),
    (select lease_token from normalized_delivery_claims where key = 'whatsapp'),
    now() + interval '1 second',
    'provider_unavailable',
    'Evolution unavailable.',
    '503',
    '{"retry_after_honored":true}'::jsonb
  ),
  true,
  'transient provider failure schedules a fenced retry'
);
select ok(
  (
    select status = 'retry_wait'
      and attempt_count = 1
      and next_attempt_at is not null
    from private.notification_deliveries
    where id = (select delivery_id from normalized_delivery_claims where key = 'whatsapp')
  ),
  'retry keeps the consumed provider attempt and a due timestamp'
);
select is(
  private.complete_notification_delivery(
    (select delivery_id from normalized_delivery_claims where key = 'whatsapp'),
    (select lease_token from normalized_delivery_claims where key = 'whatsapp'),
    'delivered', 'evolution_go', 'stale-message', 'delivered', '{}', now()
  ),
  false,
  'old fencing token cannot complete a rescheduled delivery'
);

update private.notification_deliveries
set next_attempt_at = now()
where id = (select delivery_id from normalized_delivery_claims where key = 'whatsapp');

insert into normalized_delivery_claims (key, delivery_id, lease_token)
select 'whatsapp', delivery.id, delivery.lease_token
from private.claim_notification_deliveries(
  'pgtap-worker', 1, interval '2 minutes', array['whatsapp']::text[]
) as delivery
where delivery.notification_id = 'd1400000-0000-4000-8000-000000000001'
on conflict (key) do update
set delivery_id = excluded.delivery_id,
    lease_token = excluded.lease_token;

select ok(
  private.start_notification_delivery(
    (select delivery_id from normalized_delivery_claims where key = 'whatsapp'),
    (select lease_token from normalized_delivery_claims where key = 'whatsapp'),
    'evolution_go'
  )
  and private.complete_notification_delivery(
    (select delivery_id from normalized_delivery_claims where key = 'whatsapp'),
    (select lease_token from normalized_delivery_claims where key = 'whatsapp'),
    'accepted',
    'evolution_go',
    (
      select metadata ->> 'expected_message_id'
      from private.notification_deliveries
      where id = (select delivery_id from normalized_delivery_claims where key = 'whatsapp')
    ),
    'accepted', '{}', now()
  ),
  'send acceptance is fenced and persisted without claiming delivery'
);
select ok(
  (
    select status = 'accepted'
      and accepted_at is not null
      and terminal_at is null
    from private.notification_deliveries
    where id = (select delivery_id from normalized_delivery_claims where key = 'whatsapp')
  ),
  'HTTP acceptance remains non-terminal until a receipt arrives'
);

select is(
  private.reconcile_notification_whatsapp_delivery(
    'd1200000-0000-4000-8000-000000000001',
    (
      select metadata ->> 'expected_message_id'
      from private.notification_deliveries
      where id = (select delivery_id from normalized_delivery_claims where key = 'whatsapp')
    ),
    'failed',
    now()
  ) ->> 'outcome',
  'applied',
  'signed WhatsApp failed receipt is applied once'
);
select ok(
  (
    select status = 'retry_wait' and next_attempt_at is not null
    from private.notification_deliveries
    where id = (select delivery_id from normalized_delivery_claims where key = 'whatsapp')
  )
  and (
    select metadata #>> '{dispatch,whatsapp,status}' = 'failed'
    from public.notifications
    where id = 'd1400000-0000-4000-8000-000000000001'
  ),
  'provider delivery failure requeues normalized and legacy workers'
);

update private.notification_deliveries
set next_attempt_at = now()
where id = (select delivery_id from normalized_delivery_claims where key = 'whatsapp');
insert into normalized_delivery_claims (key, delivery_id, lease_token)
select 'whatsapp', delivery.id, delivery.lease_token
from private.claim_notification_deliveries(
  'pgtap-worker', 1, interval '2 minutes', array['whatsapp']::text[]
) as delivery
where delivery.notification_id = 'd1400000-0000-4000-8000-000000000001'
on conflict (key) do update
set delivery_id = excluded.delivery_id,
    lease_token = excluded.lease_token;
select private.start_notification_delivery(
  (select delivery_id from normalized_delivery_claims where key = 'whatsapp'),
  (select lease_token from normalized_delivery_claims where key = 'whatsapp'),
  'evolution_go'
);
select private.complete_notification_delivery(
  (select delivery_id from normalized_delivery_claims where key = 'whatsapp'),
  (select lease_token from normalized_delivery_claims where key = 'whatsapp'),
  'accepted',
  'evolution_go',
  (
    select metadata ->> 'expected_message_id'
    from private.notification_deliveries
    where id = (select delivery_id from normalized_delivery_claims where key = 'whatsapp')
  ),
  'accepted', '{}', now()
);
select is(
  private.reconcile_notification_whatsapp_delivery(
    'd1200000-0000-4000-8000-000000000001',
    (
      select metadata ->> 'expected_message_id'
      from private.notification_deliveries
      where id = (select delivery_id from normalized_delivery_claims where key = 'whatsapp')
    ),
    'delivered',
    now() + interval '1 second'
  ) ->> 'status',
  'delivered',
  'later WhatsApp delivered receipt wins monotonically'
);
select ok(
  (
    select status = 'delivered' and delivered_at is not null and terminal_at is not null
    from private.notification_deliveries
    where id = (select delivery_id from normalized_delivery_claims where key = 'whatsapp')
  )
  and (
    select metadata #>> '{dispatch,whatsapp,status}' = 'delivered'
    from public.notifications
    where id = 'd1400000-0000-4000-8000-000000000001'
  ),
  'WhatsApp delivery receipt completes normalized and legacy state'
);

insert into normalized_delivery_claims (key, delivery_id, lease_token)
select 'email', delivery.id, delivery.lease_token
from private.claim_notification_deliveries(
  'pgtap-worker', 1, interval '2 minutes', array['email']::text[]
) as delivery
where delivery.notification_id = 'd1400000-0000-4000-8000-000000000001';
select ok(
  private.start_notification_delivery(
    (select delivery_id from normalized_delivery_claims where key = 'email'),
    (select lease_token from normalized_delivery_claims where key = 'email'),
    'resend'
  )
  and private.complete_notification_delivery(
    (select delivery_id from normalized_delivery_claims where key = 'email'),
    (select lease_token from normalized_delivery_claims where key = 'email'),
    'accepted', 'resend', 'resend-normalized-message', 'accepted', '{}', now()
  ),
  'email delivery records provider acceptance'
);
update private.notification_deliveries
set accepted_at = now() - interval '2 hours', updated_at = now() - interval '2 hours'
where id = (select delivery_id from normalized_delivery_claims where key = 'email');
select ok(
  private.sweep_stale_notification_deliveries() >= 1,
  'sweeper observes an accepted delivery with no receipt'
);
select ok(
  (
    select status = 'blocked_dependency'
      and dependency_key = 'receipt_reconciliation_required'
    from private.notification_deliveries
    where id = (select delivery_id from normalized_delivery_claims where key = 'email')
  ),
  'missing receipt is blocked for reconciliation instead of blindly resent'
);
select is(
  private.replay_notification_delivery(
    (select delivery_id from normalized_delivery_claims where key = 'email'),
    'operator confirmed provider did not send',
    'pgtap-admin'
  ),
  true,
  'assisted replay explicitly requeues a blocked delivery'
);
select ok(
  (
    select status = 'queued' and attempt_count = 0 and next_attempt_at <= now()
    from private.notification_deliveries
    where id = (select delivery_id from normalized_delivery_claims where key = 'email')
  )
  and exists (
    select 1
    from private.notification_delivery_attempts
    where delivery_id = (select delivery_id from normalized_delivery_claims where key = 'email')
      and event_type = 'replay'
      and outcome = 'replayed'
      and metadata ->> 'requested_by' = 'pgtap-admin'
  ),
  'replay is append-audited and resets the delivery budget'
);

alter table public.notifications
  disable trigger sync_notification_deliveries_from_notification;
insert into public.notifications (
  id, organization_id, user_id, title, content, body, type, channel, metadata
)
values (
  'd1400000-0000-4000-8000-000000000002',
  'd1200000-0000-4000-8000-000000000001',
  'd1100000-0000-4000-8000-000000000001',
  'Legacy', 'Legacy pending', 'Legacy pending', 'info', 'in_app',
  '{
    "event_key":"new_lead_received",
    "dedupe_key":"normalized:test:legacy:1",
    "dispatch":{"whatsapp":{"required":true,"status":"pending"}}
  }'::jsonb
);
alter table public.notifications
  enable trigger sync_notification_deliveries_from_notification;
select is(
  private.materialize_notification_deliveries(
    'd1400000-0000-4000-8000-000000000002',
    true
  ),
  1,
  'historical flags are materialized by the idempotent backfill path'
);
select ok(
  (
    select status = 'blocked_dependency'
      and dependency_key = 'legacy_backfill_cutover'
      and attempt_count = 0
    from private.notification_deliveries
    where notification_id = 'd1400000-0000-4000-8000-000000000002'
      and channel = 'whatsapp'
  ),
  'historical pending delivery cannot send before explicit cutover'
);

select lives_ok(
  $$
    insert into public.notifications (
      id, organization_id, user_id, title, content, body, type, channel, metadata
    ) values (
      'd1400000-0000-4000-8000-000000000003',
      'd1200000-0000-4000-8000-000000000001',
      'd1100000-0000-4000-8000-000000000001',
      'Agenda', 'Lembrete', 'Lembrete', 'info', 'in_app',
      '{
        "event_key":"schedule_reminder",
        "dedupe_key":"normalized:test:schedule:1",
        "start_time":"not-a-timestamp",
        "dispatch":{"push":{"required":true,"status":"pending"}}
      }'::jsonb
    )
  $$,
  'invalid producer timestamp cannot abort notification creation'
);
select ok(
  (
    select expires_at > created_at
    from private.notification_deliveries
    where notification_id = 'd1400000-0000-4000-8000-000000000003'
      and channel = 'push'
  ),
  'schedule reminder receives a safe bounded fallback TTL'
);
select lives_ok(
  $$
    insert into public.notifications (
      id, organization_id, user_id, title, content, body, type, channel, metadata
    ) values (
      'd1400000-0000-4000-8000-000000000004',
      'd1200000-0000-4000-8000-000000000001',
      'd1100000-0000-4000-8000-000000000002',
      'Sem token', 'Push sem token', 'Push sem token', 'info', 'in_app',
      '{
        "event_key":"announcement",
        "dedupe_key":"normalized:test:no-token:1",
        "dispatch":{"push":{"required":true,"status":"pending"}}
      }'::jsonb
    )
  $$,
  'notification remains valid when the recipient has no push token'
);
select is(
  (
    select count(*)::bigint
    from private.notification_deliveries
    where notification_id = 'd1400000-0000-4000-8000-000000000004'
      and channel = 'push'
  ),
  0::bigint,
  'no aggregate push job is created without an active token'
);
select ok(
  exists (
    select 1
    from private.notification_delivery_metrics()
    where organization_id = 'd1200000-0000-4000-8000-000000000001'
      and delivery_count > 0
  ),
  'read-only metrics expose queue counts without recipient payloads'
);

insert into normalized_delivery_claims (key, delivery_id, lease_token)
select 'push', delivery.id, delivery.lease_token
from private.claim_notification_deliveries(
  'pgtap-worker', 1, interval '2 minutes', array['push']::text[]
) as delivery
where delivery.notification_id = 'd1400000-0000-4000-8000-000000000001';
update private.notification_deliveries
set lease_expires_at = now() - interval '1 second'
where id = (select delivery_id from normalized_delivery_claims where key = 'push');
select ok(
  private.sweep_stale_notification_deliveries() >= 1,
  'sweeper recovers an expired worker lease'
);
select ok(
  (
    select status = 'retry_wait'
      and attempt_count = 0
      and lease_token is null
      and next_attempt_at is not null
    from private.notification_deliveries
    where id = (select delivery_id from normalized_delivery_claims where key = 'push')
  ),
  'expired claim returns to retry_wait without consuming provider budget'
);

-- Exercise the Resend trigger after the manual replay. It must preserve the
-- legacy metadata contract while updating the normalized delivery.
update private.notification_deliveries
set next_attempt_at = now()
where id = (select delivery_id from normalized_delivery_claims where key = 'email');
insert into normalized_delivery_claims (key, delivery_id, lease_token)
select 'email', delivery.id, delivery.lease_token
from private.claim_notification_deliveries(
  'pgtap-worker', 1, interval '2 minutes', array['email']::text[]
) as delivery
where delivery.notification_id = 'd1400000-0000-4000-8000-000000000001'
on conflict (key) do update
set delivery_id = excluded.delivery_id,
    lease_token = excluded.lease_token;
select private.start_notification_delivery(
  (select delivery_id from normalized_delivery_claims where key = 'email'),
  (select lease_token from normalized_delivery_claims where key = 'email'),
  'resend'
);
select private.complete_notification_delivery(
  (select delivery_id from normalized_delivery_claims where key = 'email'),
  (select lease_token from normalized_delivery_claims where key = 'email'),
  'accepted', 'resend', 'resend-normalized-message', 'accepted', '{}', now()
);
update public.notifications
set metadata = jsonb_set(
  metadata,
  '{dispatch,email}',
  coalesce(metadata #> '{dispatch,email}', '{}'::jsonb) || jsonb_build_object(
    'required', true,
    'status', 'accepted',
    'provider', 'resend',
    'message_id', 'resend-normalized-message'
  ),
  true
)
where id = 'd1400000-0000-4000-8000-000000000001';

select lives_ok(
  $$
    insert into public.email_logs (
      id, organization_id, user_id, notification_id, recipient_email,
      subject, status, provider, provider_message_id, idempotency_key,
      status_event_at, metadata
    ) values (
      'd1600000-0000-4000-8000-000000000001',
      'd1200000-0000-4000-8000-000000000001',
      'd1100000-0000-4000-8000-000000000001',
      'd1400000-0000-4000-8000-000000000001',
      'delivery-admin@example.test',
      'Notification test',
      'failed',
      'resend',
      'resend-normalized-message',
      'normalized:test:resend:1',
      now(),
      '{}'::jsonb
    )
  $$,
  'Resend transient receipt trigger reconciles without aborting the webhook'
);
select ok(
  (
    select status = 'retry_wait' and next_attempt_at is not null
    from private.notification_deliveries
    where id = (select delivery_id from normalized_delivery_claims where key = 'email')
  ),
  'Resend failed receipt returns the normalized delivery to retry_wait'
);
select is(
  (
    select metadata #>> '{dispatch,email,status}'
    from public.notifications
    where id = 'd1400000-0000-4000-8000-000000000001'
  ),
  'failed',
  'Resend transient failure remains retryable for the legacy worker during cutover'
);
select lives_ok(
  $$
    update public.email_logs
    set status = 'suppressed', status_event_at = now() + interval '1 second'
    where id = 'd1600000-0000-4000-8000-000000000001'
  $$,
  'Resend permanent suppression is reconciled'
);
select is(
  (
    select status
    from private.notification_deliveries
    where id = (select delivery_id from normalized_delivery_claims where key = 'email')
  ),
  'permanent_failed',
  'permanent Resend failure is terminal in the normalized outbox'
);
select is(
  (
    select metadata #>> '{dispatch,email,status}'
    from public.notifications
    where id = 'd1400000-0000-4000-8000-000000000001'
  ),
  'permanent_failed',
  'permanent Resend failure is terminal for the legacy worker too'
);

select * from finish();
rollback;
