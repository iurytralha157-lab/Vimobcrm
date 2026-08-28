begin;

set local role postgres;
set local search_path = public, private, auth, extensions, pgtap, pg_catalog;

create extension if not exists pgtap with schema extensions;
select plan(17);

select ok(
  private.billing_payment_checkout_is_paid('REFUND_DENIED')
    and pg_get_functiondef(
      'private.create_billing_payment_receipt_from_payment()'::regprocedure
    ) ilike '%billing_payment_checkout_is_paid(new.status)%'
    and pg_get_functiondef(
      'private.invalidate_billing_receipt_delivery_from_payment()'::regprocedure
    ) ilike '%billing_payment_checkout_is_paid(v_status)%'
    and pg_get_functiondef(
      'private.ensure_billing_payment_receipt_delivery_from_payment()'::regprocedure
    ) ilike '%billing_payment_checkout_is_paid(new.status)%'
    and pg_get_functiondef(
      'private.cancel_billing_payment_receipt_delivery(uuid,text)'::regprocedure
    ) ilike '%billing_payment_checkout_is_paid(v_payment_status)%'
    and pg_get_functiondef(
      'public.verify_billing_payment_receipt(uuid)'::regprocedure
    ) ilike '%billing_payment_checkout_is_paid(payment.status)%',
  'receipt creation, invalidation, delivery, cancellation and verification share the canonical REFUND_DENIED paid predicate'
);

select ok(
  pg_get_functiondef(
    'private.ensure_billing_payment_receipt_delivery_from_payment()'::regprocedure
  ) ilike '%membership.role%owner%admin%'
    and pg_get_functiondef(
      'private.ensure_billing_payment_receipt_delivery_from_payment()'::regprocedure
    ) ilike '%user_id = null%'
    and pg_get_functiondef(
      'private.ensure_billing_payment_receipt_delivery_from_payment()'::regprocedure
    ) ilike '%billing_email%'
    and pg_get_functiondef(
      'private.ensure_billing_payment_receipt_delivery_from_payment()'::regprocedure
    ) ilike '%billing_phone%'
    and pg_get_functiondef(
      'private.ensure_billing_payment_receipt_delivery_from_payment()'::regprocedure
    ) not ilike '%v_recipient_user_id%',
  'receipt delivery has only a safe admin contact fallback and never assigns outbox ownership to a member'
);

insert into public.organizations (
  id,
  name,
  slug,
  is_active,
  subscription_type,
  subscription_status,
  asaas_customer_id,
  asaas_subscription_id,
  email,
  billing_legal_name,
  billing_tax_id,
  billing_email,
  billing_phone
)
values (
  'fa100000-0000-4000-8000-000000000001',
  'Refund Denied Receipt Organization',
  'refund-denied-receipt-organization',
  true,
  'paid',
  'pending_payment',
  'cus_refund_denied_receipt',
  'sub_refund_denied_receipt',
  'general-refund-denied@example.test',
  'Financeiro Refund Denied Ltda',
  '12345678000199',
  'financeiro-refund-denied@example.test',
  '+5522999990000'
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
  'fa200000-0000-4000-8000-000000000001',
  'authenticated',
  'authenticated',
  'wrong-first-member@example.test',
  crypt('test-password', gen_salt('bf', 4)),
  now(),
  '{"provider":"email","providers":["email"]}',
  '{}',
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
  is_active,
  whatsapp
)
values (
  'fa200000-0000-4000-8000-000000000001',
  'fa100000-0000-4000-8000-000000000001',
  'Wrong First Member',
  'wrong-first-member@example.test',
  'user',
  true,
  '+5522888880000'
)
on conflict (id) do update
set
  organization_id = excluded.organization_id,
  name = excluded.name,
  email = excluded.email,
  role = excluded.role,
  is_active = excluded.is_active,
  whatsapp = excluded.whatsapp;

insert into public.organization_members (
  organization_id,
  user_id,
  role,
  is_active
)
values (
  'fa100000-0000-4000-8000-000000000001',
  'fa200000-0000-4000-8000-000000000001',
  'user',
  true
)
on conflict (user_id, organization_id) do update
set
  role = excluded.role,
  is_active = excluded.is_active;

insert into public.asaas_payments (
  organization_id,
  asaas_payment_id,
  asaas_customer_id,
  asaas_subscription_id,
  status,
  billing_type,
  value,
  due_date,
  payment_date
)
values (
  'fa100000-0000-4000-8000-000000000001',
  'pay_refund_denied_receipt_first',
  'cus_refund_denied_receipt',
  'sub_refund_denied_receipt',
  'REFUND_DENIED',
  'PIX',
  297,
  '2026-08-05',
  '2026-08-05'
);

select is(
  (
    select count(*)
    from public.billing_payment_receipts receipt
    join public.asaas_payments payment on payment.id = receipt.payment_id
    where payment.asaas_payment_id = 'pay_refund_denied_receipt_first'
  ),
  1::bigint,
  'a first REFUND_DENIED snapshot creates one immutable receipt'
);

select is(
  (
    select count(*)
    from public.notifications notification
    join public.asaas_payments payment
      on payment.id::text = notification.metadata ->> 'payment_id'
    where payment.asaas_payment_id = 'pay_refund_denied_receipt_first'
      and notification.metadata ->> 'event_key' = 'billing_payment_receipt'
  ),
  1::bigint,
  'a first REFUND_DENIED snapshot creates one delivery outbox'
);

select is(
  (
    select notification.user_id
    from public.notifications notification
    join public.asaas_payments payment
      on payment.id::text = notification.metadata ->> 'payment_id'
    where payment.asaas_payment_id = 'pay_refund_denied_receipt_first'
  ),
  null::uuid,
  'the delivery outbox is system-owned instead of assigned to the first member'
);

select is(
  (
    select concat_ws(
      '|',
      notification.metadata ->> 'recipient_name',
      notification.metadata ->> 'recipient_email',
      notification.metadata ->> 'recipient_whatsapp'
    )
    from public.notifications notification
    join public.asaas_payments payment
      on payment.id::text = notification.metadata ->> 'payment_id'
    where payment.asaas_payment_id = 'pay_refund_denied_receipt_first'
  ),
  'Financeiro Refund Denied Ltda|financeiro-refund-denied@example.test|+5522999990000',
  'only the organization financial contact receives the receipt'
);

select ok(
  (
    select notification.metadata::text not like '%wrong-first-member%'
    from public.notifications notification
    join public.asaas_payments payment
      on payment.id::text = notification.metadata ->> 'payment_id'
    where payment.asaas_payment_id = 'pay_refund_denied_receipt_first'
  ),
  'the first CRM member is absent from the external receipt payload'
);

select is(
  (
    select concat_ws(
      '|',
      notification.metadata #>> '{dispatch,email,status}',
      notification.metadata #>> '{dispatch,whatsapp,status}',
      notification.metadata #>> '{whatsapp_dispatch,status}',
      notification.metadata #>> '{dispatch,email,required}',
      notification.metadata #>> '{dispatch,whatsapp,required}'
    )
    from public.notifications notification
    join public.asaas_payments payment
      on payment.id::text = notification.metadata ->> 'payment_id'
    where payment.asaas_payment_id = 'pay_refund_denied_receipt_first'
  ),
  'pending|pending|pending|true|true',
  'REFUND_DENIED-first keeps both financial delivery channels pending'
);

select is(
  private.cancel_billing_payment_receipt_delivery(
    (
      select notification.id
      from public.notifications notification
      join public.asaas_payments payment
        on payment.id::text = notification.metadata ->> 'payment_id'
      where payment.asaas_payment_id = 'pay_refund_denied_receipt_first'
    ),
    'REFUND_DENIED'
  ),
  false,
  'the cancellation primitive refuses to cancel a REFUND_DENIED receipt'
);

select ok(
  (
    select notification.metadata #>> '{dispatch,email,status}' = 'pending'
      and notification.metadata #>> '{dispatch,whatsapp,status}' = 'pending'
      and not (notification.metadata ? 'receipt_delivery_cancelled_at')
    from public.notifications notification
    join public.asaas_payments payment
      on payment.id::text = notification.metadata ->> 'payment_id'
    where payment.asaas_payment_id = 'pay_refund_denied_receipt_first'
  ),
  'REFUND_DENIED leaves no cancellation marker and no skipped channel'
);

select is(
  (
    select concat_ws(
      '|',
      verified ->> 'valid',
      verified ->> 'payment_state',
      verified ->> 'current_payment_status'
    )
    from (
      select public.verify_billing_payment_receipt(receipt.verification_token) as verified
      from public.billing_payment_receipts receipt
      join public.asaas_payments payment on payment.id = receipt.payment_id
      where payment.asaas_payment_id = 'pay_refund_denied_receipt_first'
    ) verification
  ),
  'true|confirmed|REFUND_DENIED',
  'public verification reports a REFUND_DENIED receipt as valid and confirmed'
);

select ok(
  (
    select not (verified ? 'payer_tax_id')
      and not (verified ? 'billing_email')
    from (
      select public.verify_billing_payment_receipt(receipt.verification_token) as verified
      from public.billing_payment_receipts receipt
      join public.asaas_payments payment on payment.id = receipt.payment_id
      where payment.asaas_payment_id = 'pay_refund_denied_receipt_first'
    ) verification
  ),
  'anonymous verification never exposes payer tax id or billing contact data'
);

insert into public.asaas_payments (
  organization_id,
  asaas_payment_id,
  asaas_customer_id,
  asaas_subscription_id,
  status,
  billing_type,
  value,
  due_date,
  payment_date
)
values (
  'fa100000-0000-4000-8000-000000000001',
  'pay_receipt_refund_after_accepted',
  'cus_refund_denied_receipt',
  'sub_refund_denied_receipt',
  'CONFIRMED',
  'CREDIT_CARD',
  297,
  '2026-09-05',
  '2026-08-05'
);

update public.notifications notification
set
  user_id = 'fa200000-0000-4000-8000-000000000001',
  channel = 'in_app',
  metadata = coalesce(notification.metadata, '{}'::jsonb) || jsonb_build_object(
    'recipient_name', 'Wrong First Member',
    'recipient_email', 'wrong-first-member@example.test',
    'recipient_whatsapp', '+5522888880000',
    'dispatch', coalesce(notification.metadata -> 'dispatch', '{}'::jsonb) || jsonb_build_object(
      'whatsapp', coalesce(notification.metadata #> '{dispatch,whatsapp}', '{}'::jsonb) || jsonb_build_object(
        'required', true,
        'status', 'accepted',
        'expected_message_id', 'whatsapp-refund-accepted-1'
      ),
      'email', coalesce(notification.metadata #> '{dispatch,email}', '{}'::jsonb) || jsonb_build_object(
        'required', true,
        'status', 'accepted',
        'message_id', 'resend-refund-accepted-1'
      )
    ),
    'whatsapp_dispatch_required', true,
    'whatsapp_dispatch', coalesce(notification.metadata -> 'whatsapp_dispatch', '{}'::jsonb) || jsonb_build_object(
      'required', true,
      'status', 'sent',
      'expected_message_id', 'whatsapp-refund-accepted-1'
    )
  )
from public.asaas_payments payment
where payment.asaas_payment_id = 'pay_receipt_refund_after_accepted'
  and notification.organization_id = payment.organization_id
  and notification.metadata ->> 'payment_id' = payment.id::text;

update public.asaas_payments
set status = 'REFUNDED'
where asaas_payment_id = 'pay_receipt_refund_after_accepted';

select ok(
  (
    select notification.user_id is null
      and notification.channel = 'external'
      and notification.metadata ->> 'recipient_name' = 'Financeiro Refund Denied Ltda'
      and notification.metadata ->> 'recipient_email' = 'financeiro-refund-denied@example.test'
      and notification.metadata ->> 'recipient_whatsapp' = '+5522999990000'
      and notification.metadata #>> '{dispatch,email,status}' = 'accepted'
      and notification.metadata #>> '{dispatch,whatsapp,status}' = 'accepted'
      and notification.metadata #>> '{whatsapp_dispatch,status}' = 'sent'
      and (notification.metadata #>> '{dispatch,email,required}')::boolean
      and (notification.metadata #>> '{dispatch,whatsapp,required}')::boolean
      and (notification.metadata ->> 'whatsapp_dispatch_required')::boolean
    from public.notifications notification
    join public.asaas_payments payment
      on payment.id::text = notification.metadata ->> 'payment_id'
    where payment.asaas_payment_id = 'pay_receipt_refund_after_accepted'
  ),
  'refund canonicalizes legacy member ownership and preserves accepted and legacy sent history as required'
);

select is(
  private.reconcile_notification_whatsapp_delivery(
    'fa100000-0000-4000-8000-000000000001',
    'whatsapp-refund-accepted-1',
    'delivered',
    now()
  ) ->> 'outcome',
  'applied',
  'a late delivered webhook still reconciles after the payment refund'
);

select is(
  (
    select concat_ws(
      '|',
      notification.metadata #>> '{dispatch,whatsapp,status}',
      notification.metadata #>> '{whatsapp_dispatch,status}'
    )
    from public.notifications notification
    join public.asaas_payments payment
      on payment.id::text = notification.metadata ->> 'payment_id'
    where payment.asaas_payment_id = 'pay_receipt_refund_after_accepted'
  ),
  'delivered|delivered',
  'the late provider webhook advances both canonical and legacy WhatsApp state'
);

insert into public.asaas_payments (
  organization_id,
  asaas_payment_id,
  asaas_customer_id,
  asaas_subscription_id,
  status,
  billing_type,
  value,
  due_date,
  payment_date
)
values (
  'fa100000-0000-4000-8000-000000000001',
  'pay_receipt_refund_after_delivered',
  'cus_refund_denied_receipt',
  'sub_refund_denied_receipt',
  'RECEIVED',
  'CREDIT_CARD',
  297,
  '2026-10-05',
  '2026-08-05'
);

update public.notifications notification
set metadata = coalesce(notification.metadata, '{}'::jsonb) || jsonb_build_object(
  'dispatch', coalesce(notification.metadata -> 'dispatch', '{}'::jsonb) || jsonb_build_object(
    'whatsapp', coalesce(notification.metadata #> '{dispatch,whatsapp}', '{}'::jsonb) || jsonb_build_object(
      'required', true,
      'status', 'delivered',
      'expected_message_id', 'whatsapp-refund-delivered-1',
      'delivered_at', now()
    ),
    'email', coalesce(notification.metadata #> '{dispatch,email}', '{}'::jsonb) || jsonb_build_object(
      'required', true,
      'status', 'delivery_failed',
      'message_id', 'resend-refund-failed-1',
      'error', 'provider_bounced'
    )
  ),
  'whatsapp_dispatch_required', true,
  'whatsapp_dispatch', coalesce(notification.metadata -> 'whatsapp_dispatch', '{}'::jsonb) || jsonb_build_object(
    'required', true,
    'status', 'delivered',
    'expected_message_id', 'whatsapp-refund-delivered-1',
    'delivered_at', now()
  )
)
from public.asaas_payments payment
where payment.asaas_payment_id = 'pay_receipt_refund_after_delivered'
  and notification.organization_id = payment.organization_id
  and notification.metadata ->> 'payment_id' = payment.id::text;

update public.asaas_payments
set status = 'REFUNDED'
where asaas_payment_id = 'pay_receipt_refund_after_delivered';

select is(
  (
    select concat_ws(
      '|',
      notification.metadata #>> '{dispatch,email,status}',
      notification.metadata #>> '{dispatch,email,error}',
      notification.metadata #>> '{dispatch,whatsapp,status}',
      notification.metadata #>> '{whatsapp_dispatch,status}'
    )
    from public.notifications notification
    join public.asaas_payments payment
      on payment.id::text = notification.metadata ->> 'payment_id'
    where payment.asaas_payment_id = 'pay_receipt_refund_after_delivered'
  ),
  'delivery_failed|provider_bounced|delivered|delivered',
  'refund preserves delivered and provider delivery-failed history without erasing its error'
);

select ok(
  (
    select (notification.metadata #>> '{dispatch,email,required}')::boolean
      and (notification.metadata #>> '{dispatch,whatsapp,required}')::boolean
      and (notification.metadata ->> 'whatsapp_dispatch_required')::boolean
    from public.notifications notification
    join public.asaas_payments payment
      on payment.id::text = notification.metadata ->> 'payment_id'
    where payment.asaas_payment_id = 'pay_receipt_refund_after_delivered'
  ),
  'provider-attempted terminal channels retain historically coherent required flags'
);

select * from finish();
rollback;
