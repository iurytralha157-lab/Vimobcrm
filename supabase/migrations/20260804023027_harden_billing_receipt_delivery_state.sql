-- A payment receipt is a platform-owned transactional delivery. Requiring an
-- active CRM member made the durable outbox disappear for legacy organizations
-- whose only member was disabled or removed. Permit a userless row only for a
-- genuine backend-created receipt event; browser roles already have no table
-- privileges (see 20260803223939_lock_notification_delivery_outbox.sql).
alter table public.notifications
  alter column user_id drop not null;

alter table public.notifications
  drop constraint if exists notifications_user_or_billing_receipt_check;

alter table public.notifications
  add constraint notifications_user_or_billing_receipt_check
  check (
    user_id is not null
    or (
      metadata ->> 'event_key' = 'billing_payment_receipt'
      and nullif(metadata ->> 'payment_id', '') is not null
      and nullif(metadata ->> 'receipt_id', '') is not null
      and nullif(metadata ->> 'dedupe_key', '') is not null
    )
  ) not valid;

alter table public.notifications
  validate constraint notifications_user_or_billing_receipt_check;

create unique index if not exists notifications_system_receipt_dedupe_idx
  on public.notifications (
    organization_id,
    (metadata ->> 'dedupe_key')
  )
  where user_id is null
    and metadata ->> 'event_key' = 'billing_payment_receipt'
    and nullif(metadata ->> 'dedupe_key', '') is not null;

-- A payment has exactly one external receipt outbox, independently from which
-- (possibly inactive) account anchors the optional in-app row.
create unique index if not exists notifications_billing_receipt_payment_unique_idx
  on public.notifications ((metadata ->> 'payment_id'))
  where metadata ->> 'event_key' = 'billing_payment_receipt'
    and nullif(metadata ->> 'payment_id', '') is not null;

-- Once the live payment is no longer confirmed, no pending or recoverable
-- delivery may still announce it as paid. Provider-accepted deliveries remain
-- historical; every other channel is made terminal and cannot be reclaimed.
create or replace function private.cancel_billing_payment_receipt_delivery(
  p_notification_id uuid,
  p_payment_status text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment_status text := upper(btrim(coalesce(p_payment_status, 'UNKNOWN')));
begin
  if v_payment_status in ('RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH') then
    return false;
  end if;

  update public.notifications notification
  set metadata = coalesce(notification.metadata, '{}'::jsonb) || jsonb_build_object(
    'receipt_delivery_cancelled_at', now(),
    'receipt_delivery_cancel_reason', lower(v_payment_status),
    'dispatch', coalesce(notification.metadata -> 'dispatch', '{}'::jsonb) || jsonb_build_object(
      'whatsapp', coalesce(notification.metadata -> 'dispatch' -> 'whatsapp', '{}'::jsonb) || jsonb_build_object(
        'required', false,
        'status', case
          when notification.metadata -> 'dispatch' -> 'whatsapp' ->> 'status'
            in ('sent', 'skipped', 'permanent_failed')
            then notification.metadata -> 'dispatch' -> 'whatsapp' ->> 'status'
          else 'skipped'
        end,
        'error', case
          when notification.metadata -> 'dispatch' -> 'whatsapp' ->> 'status'
            in ('sent', 'permanent_failed')
            then notification.metadata -> 'dispatch' -> 'whatsapp' ->> 'error'
          else 'payment_not_confirmed:' || lower(v_payment_status)
        end,
        'updated_at', now()
      ),
      'email', coalesce(notification.metadata -> 'dispatch' -> 'email', '{}'::jsonb) || jsonb_build_object(
        'required', false,
        'status', case
          when notification.metadata -> 'dispatch' -> 'email' ->> 'status'
            in ('sent', 'skipped', 'permanent_failed')
            then notification.metadata -> 'dispatch' -> 'email' ->> 'status'
          else 'skipped'
        end,
        'error', case
          when notification.metadata -> 'dispatch' -> 'email' ->> 'status'
            in ('sent', 'permanent_failed')
            then notification.metadata -> 'dispatch' -> 'email' ->> 'error'
          else 'payment_not_confirmed:' || lower(v_payment_status)
        end,
        'updated_at', now()
      )
    ),
    'whatsapp_dispatch_required', false,
    'whatsapp_dispatch', coalesce(notification.metadata -> 'whatsapp_dispatch', '{}'::jsonb) || jsonb_build_object(
      'required', false,
      'status', case
        when notification.metadata -> 'whatsapp_dispatch' ->> 'status'
          in ('sent', 'skipped', 'permanent_failed')
          then notification.metadata -> 'whatsapp_dispatch' ->> 'status'
        else 'skipped'
      end,
      'error', case
        when notification.metadata -> 'whatsapp_dispatch' ->> 'status'
          in ('sent', 'permanent_failed')
          then notification.metadata -> 'whatsapp_dispatch' ->> 'error'
        else 'payment_not_confirmed:' || lower(v_payment_status)
      end,
      'updated_at', now()
    )
  )
  where notification.id = p_notification_id
    and notification.metadata ->> 'event_key' = 'billing_payment_receipt';

  return found;
end;
$$;

revoke all on function private.cancel_billing_payment_receipt_delivery(uuid, text)
  from public, anon, authenticated, service_role;

create or replace function private.ensure_billing_payment_receipt_delivery_from_payment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_receipt public.billing_payment_receipts%rowtype;
  v_organization record;
  v_recipient_user_id uuid;
  v_recipient_name text;
  v_recipient_email text;
  v_recipient_whatsapp text;
  v_email_required boolean;
  v_whatsapp_required boolean;
begin
  if upper(coalesce(new.status, '')) not in (
    'RECEIVED',
    'CONFIRMED',
    'RECEIVED_IN_CASH'
  ) then
    perform private.cancel_billing_payment_receipt_delivery(
      notification.id,
      new.status
    )
    from public.notifications notification
    where notification.organization_id = new.organization_id
      and notification.metadata ->> 'event_key' = 'billing_payment_receipt'
      and notification.metadata ->> 'payment_id' = new.id::text;
    return new;
  end if;

  select receipt.*
    into v_receipt
  from public.billing_payment_receipts receipt
  where receipt.payment_id = new.id
  limit 1;

  -- The receipt creation trigger runs first (PostgreSQL orders equal-timing
  -- triggers by name). If creation failed, do not enqueue a misleading notice.
  if v_receipt.id is null then
    return new;
  end if;

  select
    organization.name,
    coalesce(
      nullif(btrim(organization.billing_email), ''),
      nullif(btrim(organization.email), ''),
      nullif(btrim(v_receipt.billing_email), '')
    ) as billing_email,
    coalesce(
      nullif(btrim(organization.billing_phone), ''),
      nullif(btrim(organization.whatsapp), ''),
      nullif(btrim(organization.telefone), '')
    ) as billing_phone
    into v_organization
  from public.organizations organization
  where organization.id = new.organization_id;

  -- A receipt may fall back only to an active owner/admin. Former employees,
  -- inactive accounts and regular brokers must never receive financial data.
  -- The durable row itself is always system-owned and references no user.
  select
    account.id,
    nullif(btrim(account.name), ''),
    nullif(btrim(account.email), ''),
    coalesce(nullif(btrim(account.whatsapp), ''), nullif(btrim(account.phone), ''))
    into
      v_recipient_user_id,
      v_recipient_name,
      v_recipient_email,
      v_recipient_whatsapp
  from public.organization_members membership
  join public.users account on account.id = membership.user_id
  where membership.organization_id = new.organization_id
    and membership.is_active = true
    and coalesce(account.is_active, true) = true
    and lower(coalesce(membership.role, '')) in ('owner', 'admin')
  order by
    case
      when v_organization.billing_email is not null
       and lower(account.email) = lower(v_organization.billing_email) then 0
      when lower(coalesce(membership.role, '')) = 'owner' then 1
      when lower(coalesce(membership.role, '')) = 'admin' then 2
    end,
    membership.created_at asc,
    account.id asc
  limit 1;

  v_recipient_name := coalesce(
    v_recipient_name,
    nullif(v_receipt.snapshot ->> 'payer_name', ''),
    nullif(v_receipt.snapshot ->> 'organization_name', ''),
    v_organization.name,
    'Cliente Vimob'
  );
  v_recipient_email := coalesce(v_organization.billing_email, v_recipient_email);
  v_recipient_whatsapp := coalesce(v_organization.billing_phone, v_recipient_whatsapp);
  v_email_required := v_recipient_email is not null;
  v_whatsapp_required := v_recipient_whatsapp is not null;

  -- The legacy receipt trigger may already have inserted a user-backed row in
  -- this same transaction. Replace both its ownership and recipient snapshot
  -- before commit, so a regular member cannot receive or retain the receipt.
  update public.notifications notification
  set
    user_id = null,
    channel = 'external',
    target_url = '/comprovantes/' || v_receipt.verification_token::text,
    is_read = true,
    metadata = coalesce(notification.metadata, '{}'::jsonb) || jsonb_build_object(
      'recipient_name', v_recipient_name,
      'recipient_email', v_recipient_email,
      'recipient_whatsapp', v_recipient_whatsapp,
      'delivery_contact_missing', not (v_email_required or v_whatsapp_required),
      'dispatch', coalesce(notification.metadata -> 'dispatch', '{}'::jsonb) || jsonb_build_object(
        'whatsapp', coalesce(notification.metadata -> 'dispatch' -> 'whatsapp', '{}'::jsonb) || jsonb_build_object(
          'required', v_whatsapp_required,
          'status', case
            when not v_whatsapp_required then 'skipped'
            when notification.metadata -> 'dispatch' -> 'whatsapp' ->> 'status' in ('sent', 'permanent_failed')
              then notification.metadata -> 'dispatch' -> 'whatsapp' ->> 'status'
            else 'pending'
          end
        ),
        'email', coalesce(notification.metadata -> 'dispatch' -> 'email', '{}'::jsonb) || jsonb_build_object(
          'required', v_email_required,
          'status', case
            when not v_email_required then 'skipped'
            when notification.metadata -> 'dispatch' -> 'email' ->> 'status' in ('sent', 'permanent_failed')
              then notification.metadata -> 'dispatch' -> 'email' ->> 'status'
            else 'pending'
          end
        )
      ),
      'whatsapp_dispatch_required', v_whatsapp_required,
      'whatsapp_dispatch', coalesce(notification.metadata -> 'whatsapp_dispatch', '{}'::jsonb) || jsonb_build_object(
        'status', case
          when not v_whatsapp_required then 'skipped'
          when notification.metadata -> 'whatsapp_dispatch' ->> 'status' in ('sent', 'permanent_failed')
            then notification.metadata -> 'whatsapp_dispatch' ->> 'status'
          else 'pending'
        end
      )
    )
  where notification.organization_id = new.organization_id
    and notification.metadata ->> 'event_key' = 'billing_payment_receipt'
    and notification.metadata ->> 'payment_id' = new.id::text;

  if found then
    return new;
  end if;

  insert into public.notifications (
    organization_id,
    user_id,
    title,
    content,
    body,
    type,
    channel,
    target_url,
    is_read,
    metadata
  )
  values (
    new.organization_id,
    null,
    'Comprovante de pagamento Vimob',
    'Seu pagamento foi confirmado e o comprovante Vimob esta disponivel.',
    'Seu pagamento foi confirmado e o comprovante Vimob esta disponivel.',
    'billing',
    'external',
    '/comprovantes/' || v_receipt.verification_token::text,
    true,
    jsonb_build_object(
      'event_key', 'billing_payment_receipt',
      'dedupe_key', 'billing:payment_receipt:' || new.id::text,
      'payment_id', new.id::text,
      'receipt_id', v_receipt.id::text,
      'receipt_number', v_receipt.receipt_number,
      'receipt_version', v_receipt.version,
      'verification_path', '/comprovantes/' || v_receipt.verification_token::text,
      'recipient_name', v_recipient_name,
      'recipient_email', v_recipient_email,
      'recipient_whatsapp', v_recipient_whatsapp,
      'delivery_contact_missing', not (v_email_required or v_whatsapp_required),
      'variables', jsonb_build_object(
        'receipt_number', v_receipt.receipt_number,
        'organization_name', v_receipt.snapshot ->> 'organization_name',
        'payer_name', v_receipt.payer_name,
        'payer_tax_id', v_receipt.payer_tax_id,
        'plan_name', v_receipt.plan_name,
        'billing_period_months', v_receipt.billing_period_months,
        'billing_type', v_receipt.billing_type,
        'amount', 'R$ ' || replace(to_char(v_receipt.amount, 'FM999999990D00'), '.', ','),
        'paid_at', to_char(v_receipt.paid_at at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI'),
        'provider_payment_reference', v_receipt.provider_payment_reference,
        'verification_path', '/comprovantes/' || v_receipt.verification_token::text,
        'issuer_name', v_receipt.issuer_name,
        'issued_at', to_char(v_receipt.issued_at at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI')
      ),
      'dispatch', jsonb_build_object(
        'whatsapp', jsonb_build_object(
          'required', v_whatsapp_required,
          'status', case when v_whatsapp_required then 'pending' else 'skipped' end
        ),
        'email', jsonb_build_object(
          'required', v_email_required,
          'status', case when v_email_required then 'pending' else 'skipped' end
        )
      ),
      'whatsapp_dispatch_required', v_whatsapp_required,
      'whatsapp_dispatch', jsonb_build_object(
        'status', case when v_whatsapp_required then 'pending' else 'skipped' end
      )
    )
  )
  on conflict do nothing;

  return new;
end;
$$;

revoke all on function private.ensure_billing_payment_receipt_delivery_from_payment()
  from public, anon, authenticated;
grant execute on function private.ensure_billing_payment_receipt_delivery_from_payment()
  to service_role;

drop trigger if exists ensure_billing_payment_receipt_delivery_after_payment
  on public.asaas_payments;
create trigger ensure_billing_payment_receipt_delivery_after_payment
after insert or update of status, payment_date on public.asaas_payments
for each row
execute function private.ensure_billing_payment_receipt_delivery_from_payment();

-- Cancel any historical outbox that was still recoverable after the payment
-- had already changed away from a confirmed state.
do $$
declare
  v_delivery record;
begin
  for v_delivery in
    select notification.id, payment.status
    from public.notifications notification
    join public.asaas_payments payment
      on payment.id::text = notification.metadata ->> 'payment_id'
     and payment.organization_id = notification.organization_id
    where notification.metadata ->> 'event_key' = 'billing_payment_receipt'
      and upper(coalesce(payment.status, '')) not in (
        'RECEIVED',
        'CONFIRMED',
        'RECEIVED_IN_CASH'
      )
  loop
    perform private.cancel_billing_payment_receipt_delivery(
      v_delivery.id,
      v_delivery.status
    );
  end loop;
end;
$$;

-- Existing transactional receipt deliveries must receive the same ownership
-- semantics before the migration commits. The immutable contact snapshot in
-- metadata remains available to the worker after the user row is deleted.
update public.notifications notification
set
  user_id = null,
  channel = 'external',
  target_url = coalesce(
    nullif(notification.metadata ->> 'verification_path', ''),
    notification.target_url
  ),
  is_read = true
where notification.metadata ->> 'event_key' = 'billing_payment_receipt';

-- Re-run the private canonicalizer for any existing outbox so its recipient
-- snapshot is also restricted to billing contacts or active owner/admin users.
update public.asaas_payments payment
set status = payment.status
where upper(coalesce(payment.status, '')) in (
    'RECEIVED',
    'CONFIRMED',
    'RECEIVED_IN_CASH'
  )
  and exists (
    select 1
    from public.notifications notification
    where notification.organization_id = payment.organization_id
      and notification.metadata ->> 'event_key' = 'billing_payment_receipt'
      and notification.metadata ->> 'payment_id' = payment.id::text
  );

-- Recover receipts that were already issued while no active member existed.
-- The immutable receipt insert is idempotent and the outbox has deterministic
-- dedupe indexes for both user-backed and userless deliveries.
update public.asaas_payments payment
set status = payment.status
where upper(coalesce(payment.status, '')) in (
    'RECEIVED',
    'CONFIRMED',
    'RECEIVED_IN_CASH'
  )
  and exists (
    select 1
    from public.billing_payment_receipts receipt
    where receipt.payment_id = payment.id
  )
  and not exists (
    select 1
    from public.notifications notification
    where notification.organization_id = payment.organization_id
      and notification.metadata ->> 'event_key' = 'billing_payment_receipt'
      and notification.metadata ->> 'payment_id' = payment.id::text
  );

-- Preserve the immutable receipt snapshot for audit, but derive its current
-- validity from the live Asaas payment state. A refunded or disputed payment
-- must never continue to be presented as confirmed.
create or replace function public.verify_billing_payment_receipt(p_verification_token uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'found', true,
    'valid', upper(coalesce(payment.status, '')) in (
      'RECEIVED',
      'CONFIRMED',
      'RECEIVED_IN_CASH'
    ),
    'payment_state', case
      when upper(coalesce(payment.status, '')) in (
        'RECEIVED',
        'CONFIRMED',
        'RECEIVED_IN_CASH'
      ) then 'confirmed'
      when upper(coalesce(payment.status, '')) in (
        'REFUNDED',
        'REFUND_REQUESTED',
        'REFUND_IN_PROGRESS',
        'PARTIALLY_REFUNDED',
        'RECEIVED_IN_CASH_UNDONE'
      ) then 'refunded'
      when upper(coalesce(payment.status, '')) like 'CHARGEBACK%'
        or upper(coalesce(payment.status, '')) = 'AWAITING_CHARGEBACK_REVERSAL'
        then 'chargeback'
      when upper(coalesce(payment.status, '')) in ('DELETED', 'CANCELLED', 'CANCELED')
        then 'cancelled'
      else 'invalidated'
    end,
    'current_payment_status', upper(coalesce(payment.status, 'UNKNOWN')),
    'state_changed_at', coalesce(payment.updated_at, receipt.issued_at),
    'receipt_number', receipt.receipt_number,
    'version', receipt.version,
    'issuer_name', receipt.issuer_name,
    'organization_name', receipt.snapshot ->> 'organization_name',
    'plan_name', receipt.plan_name,
    'billing_period_months', receipt.billing_period_months,
    'billing_type', receipt.billing_type,
    'amount', receipt.amount,
    'currency', receipt.currency,
    'paid_at', receipt.paid_at,
    'issued_at', receipt.issued_at,
    'snapshot_hash', receipt.snapshot_hash
  )
  from public.billing_payment_receipts receipt
  join public.asaas_payments payment on payment.id = receipt.payment_id
  where receipt.verification_token = p_verification_token
  limit 1;
$$;

revoke all on function public.verify_billing_payment_receipt(uuid) from public;
grant execute on function public.verify_billing_payment_receipt(uuid)
  to anon, authenticated, service_role;
