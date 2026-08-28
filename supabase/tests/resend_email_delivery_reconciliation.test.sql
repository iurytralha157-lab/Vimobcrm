begin;

create extension if not exists pgtap with schema extensions;
select plan(49);

select is(
  has_table_privilege('anon', 'public.email_delivery_events', 'select'),
  false,
  'anonymous clients cannot read Resend delivery events'
);
select is(
  has_table_privilege('authenticated', 'public.email_delivery_events', 'insert'),
  false,
  'authenticated clients cannot forge Resend delivery events'
);
select is(
  has_table_privilege('service_role', 'public.email_delivery_events', 'select'),
  true,
  'service role can inspect verified Resend delivery events'
);
select is(
  has_function_privilege(
    'anon',
    'public.record_resend_email_event(text,text,text,timestamptz,jsonb)',
    'execute'
  ),
  false,
  'anonymous clients cannot execute the Resend event recorder'
);
select is(
  has_function_privilege(
    'authenticated',
    'public.record_resend_email_event(text,text,text,timestamptz,jsonb)',
    'execute'
  ),
  false,
  'authenticated clients cannot execute the Resend event recorder'
);
select is(
  has_function_privilege(
    'service_role',
    'public.record_resend_email_event(text,text,text,timestamptz,jsonb)',
    'execute'
  ),
  true,
  'service role can execute the verified Resend event recorder'
);

select is(
  public.record_resend_email_event(
    'resend-event-delivered',
    'resend-message-orphan',
    'email.delivered',
    '2026-08-03 21:02:00+00'::timestamptz,
    '{}'::jsonb
  ),
  true,
  'a verified webhook is durably accepted before its email log exists'
);
select is(
  (
    select email_log_id
    from public.email_delivery_events
    where provider = 'resend'
      and provider_event_id = 'resend-event-delivered'
  ),
  null::uuid,
  'the early webhook remains an orphan until the provider message id appears'
);

insert into public.email_logs (
  id,
  recipient_email,
  subject,
  status,
  provider,
  provider_message_id,
  idempotency_key,
  metadata
)
values (
  'e1000000-0000-4000-8000-000000000001',
  'billing@example.test',
  'Comprovante de pagamento Vimob',
  'processing',
  'resend',
  'resend-message-orphan',
  'vimob:billing_payment_receipt:test:v1',
  '{"event_key":"billing_payment_receipt"}'::jsonb
);

select is(
  (select status from public.email_logs where id = 'e1000000-0000-4000-8000-000000000001'),
  'delivered',
  'adding the provider id reconciles the orphan delivery immediately'
);
select is(
  (
    select email_log_id
    from public.email_delivery_events
    where provider = 'resend'
      and provider_event_id = 'resend-event-delivered'
  ),
  'e1000000-0000-4000-8000-000000000001'::uuid,
  'the orphan event is linked to the canonical email log'
);
select ok(
  (
    select reconciled_at is not null
    from public.email_delivery_events
    where provider = 'resend'
      and provider_event_id = 'resend-event-delivered'
  ),
  'reconciliation is observable on the delivery event'
);

select is(
  public.record_resend_email_event(
    'resend-event-sent-older',
    'resend-message-orphan',
    'email.sent',
    '2026-08-03 21:01:00+00'::timestamptz,
    '{}'::jsonb
  ),
  true,
  'an older sent event is retained for audit'
);
select is(
  (select status from public.email_logs where id = 'e1000000-0000-4000-8000-000000000001'),
  'delivered',
  'an older sent event cannot downgrade delivered to accepted'
);
select is(
  (select status_event_at from public.email_logs where id = 'e1000000-0000-4000-8000-000000000001'),
  '2026-08-03 21:02:00+00'::timestamptz,
  'the delivery event remains the causal status timestamp'
);

select is(
  public.record_resend_email_event(
    'resend-event-bounced-later',
    'resend-message-orphan',
    'email.bounced',
    '2026-08-03 21:02:30+00'::timestamptz,
    '{"bounce":{"message":"late contradictory bounce"}}'::jsonb
  ),
  true,
  'a contradictory later bounce is retained for audit'
);
select is(
  (select status from public.email_logs where id = 'e1000000-0000-4000-8000-000000000001'),
  'delivered',
  'a bounce cannot downgrade a confirmed delivery'
);

select is(
  public.record_resend_email_event(
    'resend-event-complained',
    'resend-message-orphan',
    'email.complained',
    '2026-08-03 21:03:00+00'::timestamptz,
    '{"complaint":{"message":"recipient marked as spam"}}'::jsonb
  ),
  true,
  'a higher-precedence complaint is accepted'
);
select is(
  (select status from public.email_logs where id = 'e1000000-0000-4000-8000-000000000001'),
  'complained',
  'complained becomes the terminal delivery state'
);
select is(
  (select error_message from public.email_logs where id = 'e1000000-0000-4000-8000-000000000001'),
  'recipient marked as spam',
  'the terminal provider reason is preserved'
);

select is(
  public.record_resend_email_event(
    'resend-event-delivered-later',
    'resend-message-orphan',
    'email.delivered',
    '2026-08-03 21:04:00+00'::timestamptz,
    '{}'::jsonb
  ),
  true,
  'a later lower-precedence event is retained for audit'
);
select is(
  (select status from public.email_logs where id = 'e1000000-0000-4000-8000-000000000001'),
  'complained',
  'a later delivery event cannot downgrade a terminal complaint'
);
select is(
  (select last_event_at from public.email_logs where id = 'e1000000-0000-4000-8000-000000000001'),
  '2026-08-03 21:04:00+00'::timestamptz,
  'last_event_at tracks the newest observed provider event'
);
select is(
  (select status_event_at from public.email_logs where id = 'e1000000-0000-4000-8000-000000000001'),
  '2026-08-03 21:03:00+00'::timestamptz,
  'status_event_at remains tied to the event that won precedence'
);

select is(
  public.record_resend_email_event(
    'resend-event-delivered',
    'resend-message-orphan',
    'email.delivered',
    '2026-08-03 21:05:00+00'::timestamptz,
    '{}'::jsonb
  ),
  false,
  'provider event ids are idempotent'
);
select is(
  (
    select count(*)
    from public.email_delivery_events
    where provider = 'resend'
      and provider_message_id = 'resend-message-orphan'
  ),
  5::bigint,
  'a duplicate webhook does not create another audit row'
);

update public.email_logs
set provider_message_id = provider_message_id
where id = 'e1000000-0000-4000-8000-000000000001';

select is(
  (select status from public.email_logs where id = 'e1000000-0000-4000-8000-000000000001'),
  'complained',
  'replaying reconciliation is state-idempotent'
);
select is(
  (
    select count(*)
    from public.email_delivery_events
    where provider = 'resend'
      and provider_message_id = 'resend-message-orphan'
  ),
  5::bigint,
  'replaying reconciliation does not duplicate provider events'
);

insert into public.organizations (
  id, name, slug, subscription_type, subscription_status
) values (
  'e2000000-0000-4000-8000-000000000001',
  'Resend notification reconciliation',
  'resend-notification-reconciliation',
  'paid',
  'active'
);

insert into public.notifications (
  id, organization_id, user_id, title, type, channel, is_read, metadata
) values (
  'e2100000-0000-4000-8000-000000000001',
  'e2000000-0000-4000-8000-000000000001',
  null,
  'Transactional receipt',
  'billing',
  'external',
  true,
  jsonb_build_object(
    'event_key', 'billing_payment_receipt',
    'payment_id', 'e2300000-0000-4000-8000-000000000001',
    'receipt_id', 'e2400000-0000-4000-8000-000000000001',
    'dedupe_key', 'billing_payment_receipt:e2300000-0000-4000-8000-000000000001',
    'dispatch', jsonb_build_object(
      'email', jsonb_build_object(
        'required', true,
        'status', 'sent',
        'provider', 'resend',
        'message_id', 'resend-message-notification'
      )
    )
  )
);

insert into public.email_logs (
  id,
  organization_id,
  notification_id,
  recipient_email,
  subject,
  status,
  provider,
  provider_message_id,
  idempotency_key,
  metadata
) values (
  'e2200000-0000-4000-8000-000000000001',
  'e2000000-0000-4000-8000-000000000001',
  'e2100000-0000-4000-8000-000000000001',
  'finance@example.test',
  'Transactional receipt',
  'accepted',
  'resend',
  'resend-message-notification',
  'vimob:notification:delivery-reconcile:v1',
  '{"event_key":"billing_payment_receipt"}'::jsonb
);

select is(
  public.record_resend_email_event(
    'resend-event-notification-bounced',
    'resend-message-notification',
    'email.bounced',
    '2026-08-04 18:00:00+00'::timestamptz,
    '{"bounce":{"message":"mailbox unavailable"}}'::jsonb
  ),
  true,
  'a verified negative delivery event is accepted for the exact message'
);

select is(
  (
    select metadata #>> '{dispatch,email,status}'
    from public.notifications
    where id = 'e2100000-0000-4000-8000-000000000001'
  ),
  'delivery_failed',
  'the exact notification channel is terminalized without an automatic retry loop'
);

select ok(
  (
    select (metadata #>> '{dispatch,email,alert_required}')::boolean
      and metadata #>> '{dispatch,email,delivery_status}' = 'bounced'
      and metadata #>> '{dispatch,email,message_id}' = 'resend-message-notification'
    from public.notifications
    where id = 'e2100000-0000-4000-8000-000000000001'
  ),
  'notification metadata exposes a bounded assisted-delivery alert'
);

select is(
  (
    select count(*)
    from public.error_events
    where fingerprint like 'resend_delivery:e2100000-0000-4000-8000-000000000001:%'
  ),
  1::bigint,
  'one operator alert is emitted for the terminal delivery failure'
);

select is(
  public.record_resend_email_event(
    'resend-event-notification-bounced',
    'resend-message-notification',
    'email.bounced',
    '2026-08-04 18:00:00+00'::timestamptz,
    '{}'::jsonb
  ),
  false,
  'duplicate provider events cannot reopen delivery or duplicate the alert'
);

select is(
  has_function_privilege(
    'anon',
    'private.reconcile_notification_whatsapp_delivery(uuid,text,text,timestamptz)',
    'execute'
  ),
  false,
  'anonymous clients cannot forge WhatsApp delivery receipts'
);
select is(
  has_function_privilege(
    'authenticated',
    'private.reconcile_notification_whatsapp_delivery(uuid,text,text,timestamptz)',
    'execute'
  ),
  false,
  'authenticated clients cannot forge WhatsApp delivery receipts'
);
select is(
  has_function_privilege(
    'service_role',
    'private.reconcile_notification_whatsapp_delivery(uuid,text,text,timestamptz)',
    'execute'
  ),
  true,
  'the trusted backend can reconcile an exact WhatsApp receipt'
);

insert into public.notifications (
  id, organization_id, user_id, title, type, channel, is_read, metadata
) values (
  'e2100000-0000-4000-8000-000000000002',
  'e2000000-0000-4000-8000-000000000001',
  null,
  'WhatsApp transactional receipt',
  'billing',
  'external',
  true,
  jsonb_build_object(
    'event_key', 'billing_payment_receipt',
    'payment_id', 'e2300000-0000-4000-8000-000000000002',
    'receipt_id', 'e2400000-0000-4000-8000-000000000002',
    'dedupe_key', 'billing_payment_receipt:e2300000-0000-4000-8000-000000000002',
    'dispatch', jsonb_build_object(
      'whatsapp', jsonb_build_object(
        'required', true,
        'status', 'accepted',
        'expected_message_id', 'vimob-whatsapp-exact-1',
        'claim_token', 'must-be-scrubbed',
        'claimed_at', '2026-08-04T18:00:00Z',
        'next_attempt_at', '2026-08-04T18:05:00Z'
      )
    )
  )
);

select is(
  private.reconcile_notification_whatsapp_delivery(
    'e2000000-0000-4000-8000-000000000001',
    'wrong-message-id',
    'delivered',
    '2026-08-04 18:01:00+00'
  ) ->> 'outcome',
  'not_found',
  'a provider alias cannot select a notification without the expected message id'
);
select is(
  private.reconcile_notification_whatsapp_delivery(
    'e2000000-0000-4000-8000-000000000001',
    'vimob-whatsapp-exact-1',
    'sent',
    '2026-08-04 18:01:00+00'
  ) ->> 'outcome',
  'invalid_status',
  'only terminal provider delivery statuses are accepted'
);
select is(
  private.reconcile_notification_whatsapp_delivery(
    'e2000000-0000-4000-8000-000000000001',
    'vimob-whatsapp-exact-1',
    'delivered',
    '2026-08-04 18:01:00+00'
  ) ->> 'outcome',
  'applied',
  'the exact delivered receipt is applied once'
);
select is(
  (
    select metadata #>> '{dispatch,whatsapp,status}'
    from public.notifications
    where id = 'e2100000-0000-4000-8000-000000000002'
  ),
  'delivered',
  'WhatsApp delivery is persisted on the canonical dispatch channel'
);
select ok(
  (
    select metadata #>> '{whatsapp_dispatch,status}' = 'delivered'
      and metadata #>> '{dispatch,whatsapp,next_attempt_at}' = ''
      and not (metadata #> '{dispatch,whatsapp}' ? 'claim_token')
      and not (metadata #> '{dispatch,whatsapp}' ? 'claimed_at')
    from public.notifications
    where id = 'e2100000-0000-4000-8000-000000000002'
  ),
  'terminal delivery mirrors legacy metadata and removes every retry lease'
);
select is(
  private.reconcile_notification_whatsapp_delivery(
    'e2000000-0000-4000-8000-000000000001',
    'vimob-whatsapp-exact-1',
    'read',
    '2026-08-04 18:01:00+00'
  ) ->> 'outcome',
  'already_applied',
  'an equal-time read replay is idempotent'
);
select is(
  private.reconcile_notification_whatsapp_delivery(
    'e2000000-0000-4000-8000-000000000001',
    'vimob-whatsapp-exact-1',
    'failed',
    '2026-08-04 18:00:30+00'
  ) ->> 'outcome',
  'stale',
  'an older failure cannot downgrade a delivered message'
);
select is(
  (
    select metadata #>> '{dispatch,whatsapp,status}'
    from public.notifications
    where id = 'e2100000-0000-4000-8000-000000000002'
  ),
  'delivered',
  'the stale failure leaves the final delivery state unchanged'
);

insert into public.notifications (
  id, organization_id, user_id, title, type, channel, is_read, metadata
) values (
  'e2100000-0000-4000-8000-000000000003',
  'e2000000-0000-4000-8000-000000000001',
  null,
  'WhatsApp failed receipt',
  'billing',
  'external',
  true,
  '{"event_key":"billing_payment_receipt","payment_id":"e2300000-0000-4000-8000-000000000003","receipt_id":"e2400000-0000-4000-8000-000000000003","dedupe_key":"billing_payment_receipt:e2300000-0000-4000-8000-000000000003","dispatch":{"whatsapp":{"required":true,"status":"accepted","expected_message_id":"vimob-whatsapp-exact-2"}}}'::jsonb
);
select is(
  private.reconcile_notification_whatsapp_delivery(
    'e2000000-0000-4000-8000-000000000001',
    'vimob-whatsapp-exact-2',
    'failed',
    '2026-08-04 18:02:00+00'
  ) ->> 'outcome',
  'applied',
  'an exact failed receipt is terminalized'
);
select ok(
  (
    select metadata #>> '{dispatch,whatsapp,status}' = 'delivery_failed'
      and metadata #>> '{dispatch,whatsapp,error}' = 'provider_delivery_failed'
      and metadata #>> '{dispatch,whatsapp,next_attempt_at}' = ''
    from public.notifications
    where id = 'e2100000-0000-4000-8000-000000000003'
  ),
  'a delivery failure is bounded and cannot enter the automatic retry loop'
);
select is(
  private.reconcile_notification_whatsapp_delivery(
    'e2000000-0000-4000-8000-000000000001',
    'vimob-whatsapp-exact-2',
    'read',
    '2026-08-04 18:03:00+00'
  ) ->> 'outcome',
  'applied',
  'a later positive receipt can correct a provider failure'
);
select is(
  (
    select metadata #>> '{dispatch,whatsapp,status}'
    from public.notifications
    where id = 'e2100000-0000-4000-8000-000000000003'
  ),
  'delivered',
  'the later read receipt becomes the final state'
);

insert into public.notifications (
  id, organization_id, user_id, title, type, channel, is_read, metadata
) values
  (
    'e2100000-0000-4000-8000-000000000004',
    'e2000000-0000-4000-8000-000000000001', null,
    'Ambiguous WhatsApp one', 'billing', 'external', true,
    '{"event_key":"billing_payment_receipt","payment_id":"e2300000-0000-4000-8000-000000000004","receipt_id":"e2400000-0000-4000-8000-000000000004","dedupe_key":"billing_payment_receipt:e2300000-0000-4000-8000-000000000004","dispatch":{"whatsapp":{"required":true,"status":"accepted","expected_message_id":"vimob-whatsapp-ambiguous"}}}'::jsonb
  ),
  (
    'e2100000-0000-4000-8000-000000000005',
    'e2000000-0000-4000-8000-000000000001', null,
    'Ambiguous WhatsApp two', 'billing', 'external', true,
    '{"event_key":"billing_payment_receipt","payment_id":"e2300000-0000-4000-8000-000000000005","receipt_id":"e2400000-0000-4000-8000-000000000005","dedupe_key":"billing_payment_receipt:e2300000-0000-4000-8000-000000000005","dispatch":{"whatsapp":{"required":true,"status":"accepted","expected_message_id":"vimob-whatsapp-ambiguous"}}}'::jsonb
  );
select is(
  private.reconcile_notification_whatsapp_delivery(
    'e2000000-0000-4000-8000-000000000001',
    'vimob-whatsapp-ambiguous',
    'delivered',
    '2026-08-04 18:04:00+00'
  ) ->> 'outcome',
  'ambiguous',
  'a duplicated expected message id fails closed'
);
select is(
  (
    select count(*)
    from public.notifications
    where id in (
      'e2100000-0000-4000-8000-000000000004',
      'e2100000-0000-4000-8000-000000000005'
    )
      and metadata #>> '{dispatch,whatsapp,status}' = 'accepted'
  ),
  2::bigint,
  'an ambiguous receipt mutates neither notification'
);

select * from finish();
rollback;
