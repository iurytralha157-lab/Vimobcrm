begin;

set local role postgres;
set local search_path = public, private, auth, extensions, pgtap, pg_catalog;

create extension if not exists pgtap with schema extensions;
select plan(17);

select is(
  (
    select is_nullable
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'notifications'
      and column_name = 'user_id'
  ),
  'YES',
  'transactional receipts can be delivered without an active user row'
);

select is(
  (
    select convalidated
    from pg_constraint
    where conrelid = 'public.notifications'::regclass
      and conname = 'notifications_user_or_billing_receipt_check'
  ),
  true,
  'only the validated billing receipt event may omit user_id'
);

select has_index(
  'public',
  'notifications',
  'notifications_system_receipt_dedupe_idx',
  'userless receipt deliveries have a deterministic dedupe index'
);

select has_index(
  'public',
  'notifications',
  'notifications_billing_receipt_payment_unique_idx',
  'a payment can enqueue exactly one receipt delivery'
);

select has_function(
  'private',
  'ensure_billing_payment_receipt_delivery_from_payment',
  array[]::text[],
  'receipt delivery recovery is owned by a private trigger function'
);

select has_function(
  'private',
  'cancel_billing_payment_receipt_delivery',
  array['uuid', 'text'],
  'receipt delivery has a private live-payment cancellation primitive'
);

select ok(
  pg_get_functiondef(
    'private.ensure_billing_payment_receipt_delivery_from_payment()'::regprocedure
  ) ilike '%cancel_billing_payment_receipt_delivery%'
    and pg_get_functiondef(
      'private.cancel_billing_payment_receipt_delivery(uuid,text)'::regprocedure
    ) ilike '%receipt_delivery_cancelled_at%payment_not_confirmed%',
  'a non-confirmed payment makes every recoverable receipt channel terminal'
);

select is(
  (
    select count(*)::integer
    from pg_trigger
    where tgrelid = 'public.asaas_payments'::regclass
      and tgname = 'ensure_billing_payment_receipt_delivery_after_payment'
      and not tgisinternal
  ),
  1,
  'paid payment changes always invoke receipt outbox recovery'
);

select ok(
  pg_get_functiondef(
    'private.ensure_billing_payment_receipt_delivery_from_payment()'::regprocedure
  ) ilike '%membership.is_active = true%'
    and pg_get_functiondef(
      'private.ensure_billing_payment_receipt_delivery_from_payment()'::regprocedure
    ) ilike '%coalesce(account.is_active, true) = true%',
  'receipt fallback excludes inactive memberships and accounts'
);

select ok(
  pg_get_functiondef(
    'private.ensure_billing_payment_receipt_delivery_from_payment()'::regprocedure
  ) ilike '%membership.role%owner%admin%',
  'receipt fallback is restricted to active owners and administrators'
);

select ok(
  pg_get_functiondef(
    'private.ensure_billing_payment_receipt_delivery_from_payment()'::regprocedure
  ) ilike '%user_id = null%recipient_email%recipient_whatsapp%',
  'legacy receipt rows are converted to system ownership with a safe recipient snapshot'
);

select ok(
  pg_get_functiondef('public.verify_billing_payment_receipt(uuid)'::regprocedure)
    ilike '%join public.asaas_payments payment on payment.id = receipt.payment_id%',
  'public receipt verification reads the live payment state'
);

select ok(
  pg_get_functiondef('public.verify_billing_payment_receipt(uuid)'::regprocedure)
    ilike '%REFUNDED%',
  'refund states invalidate the public receipt'
);

select ok(
  pg_get_functiondef('public.verify_billing_payment_receipt(uuid)'::regprocedure)
    ilike '%CHARGEBACK%',
  'chargeback states invalidate the public receipt'
);

select ok(
  position(
    'DUNNING_RECEIVED'
    in pg_get_functiondef('public.verify_billing_payment_receipt(uuid)'::regprocedure)
  ) = 0,
  'credit-bureau dunning is never mistaken for a received payment'
);

select is(
  has_function_privilege(
    'anon',
    'public.verify_billing_payment_receipt(uuid)',
    'execute'
  ),
  true,
  'anonymous verification remains available only through the sanitized RPC'
);

select is(
  has_table_privilege('authenticated', 'public.notifications', 'insert'),
  false,
  'browser roles cannot forge a userless transactional receipt'
);

select * from finish();
rollback;
