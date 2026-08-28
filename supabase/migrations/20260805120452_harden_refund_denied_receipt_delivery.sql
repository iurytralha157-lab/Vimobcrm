-- REFUND_DENIED means the provider rejected a refund request; the original
-- payment remains settled. Receipt creation already uses the canonical paid
-- classifier. Keep cancellation, delivery and public verification on the same
-- predicate so a first REFUND_DENIED observation cannot invalidate or leak a
-- legitimate receipt delivery.

create or replace function private.cancel_billing_payment_receipt_delivery(
  p_notification_id uuid,
  p_payment_status text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_payment_status text := upper(btrim(coalesce(p_payment_status, 'UNKNOWN')));
begin
  if private.billing_payment_checkout_is_paid(v_payment_status) then
    return false;
  end if;

  update public.notifications notification
  set metadata = coalesce(notification.metadata, '{}'::jsonb) || jsonb_build_object(
    'receipt_delivery_cancelled_at', now(),
    'receipt_delivery_cancel_reason', lower(v_payment_status),
    'dispatch', coalesce(notification.metadata -> 'dispatch', '{}'::jsonb) || jsonb_build_object(
      'whatsapp', coalesce(notification.metadata -> 'dispatch' -> 'whatsapp', '{}'::jsonb) || jsonb_build_object(
        'required', lower(coalesce(
          notification.metadata -> 'dispatch' -> 'whatsapp' ->> 'status', ''
        )) in ('accepted', 'delivered', 'delivery_failed', 'sent', 'permanent_failed'),
        'status', case
          when lower(coalesce(
            notification.metadata -> 'dispatch' -> 'whatsapp' ->> 'status', ''
          )) in (
            'accepted', 'delivered', 'delivery_failed', 'sent', 'skipped',
            'permanent_failed'
          ) then lower(notification.metadata -> 'dispatch' -> 'whatsapp' ->> 'status')
          else 'skipped'
        end,
        'error', case
          when lower(coalesce(
            notification.metadata -> 'dispatch' -> 'whatsapp' ->> 'status', ''
          )) in (
            'accepted', 'delivered', 'delivery_failed', 'sent', 'skipped',
            'permanent_failed'
          )
            then notification.metadata -> 'dispatch' -> 'whatsapp' ->> 'error'
          else 'payment_not_confirmed:' || lower(v_payment_status)
        end,
        'updated_at', now()
      ),
      'email', coalesce(notification.metadata -> 'dispatch' -> 'email', '{}'::jsonb) || jsonb_build_object(
        'required', lower(coalesce(
          notification.metadata -> 'dispatch' -> 'email' ->> 'status', ''
        )) in ('accepted', 'delivered', 'delivery_failed', 'sent', 'permanent_failed'),
        'status', case
          when lower(coalesce(
            notification.metadata -> 'dispatch' -> 'email' ->> 'status', ''
          )) in (
            'accepted', 'delivered', 'delivery_failed', 'sent', 'skipped',
            'permanent_failed'
          ) then lower(notification.metadata -> 'dispatch' -> 'email' ->> 'status')
          else 'skipped'
        end,
        'error', case
          when lower(coalesce(
            notification.metadata -> 'dispatch' -> 'email' ->> 'status', ''
          )) in (
            'accepted', 'delivered', 'delivery_failed', 'sent', 'skipped',
            'permanent_failed'
          )
            then notification.metadata -> 'dispatch' -> 'email' ->> 'error'
          else 'payment_not_confirmed:' || lower(v_payment_status)
        end,
        'updated_at', now()
      )
    ),
    'whatsapp_dispatch_required', lower(coalesce(
      notification.metadata -> 'whatsapp_dispatch' ->> 'status',
      notification.metadata -> 'dispatch' -> 'whatsapp' ->> 'status',
      ''
    )) in ('accepted', 'delivered', 'delivery_failed', 'sent', 'permanent_failed'),
    'whatsapp_dispatch', coalesce(notification.metadata -> 'whatsapp_dispatch', '{}'::jsonb) || jsonb_build_object(
      'required', lower(coalesce(
        notification.metadata -> 'whatsapp_dispatch' ->> 'status',
        notification.metadata -> 'dispatch' -> 'whatsapp' ->> 'status',
        ''
      )) in ('accepted', 'delivered', 'delivery_failed', 'sent', 'permanent_failed'),
      'status', case
        when lower(coalesce(
          notification.metadata -> 'whatsapp_dispatch' ->> 'status',
          notification.metadata -> 'dispatch' -> 'whatsapp' ->> 'status',
          ''
        )) in (
          'accepted', 'delivered', 'delivery_failed', 'sent', 'skipped',
          'permanent_failed'
        ) then lower(coalesce(
          notification.metadata -> 'whatsapp_dispatch' ->> 'status',
          notification.metadata -> 'dispatch' -> 'whatsapp' ->> 'status'
        ))
        else 'skipped'
      end,
      'error', case
        when lower(coalesce(
          notification.metadata -> 'whatsapp_dispatch' ->> 'status',
          notification.metadata -> 'dispatch' -> 'whatsapp' ->> 'status',
          ''
        )) in (
          'accepted', 'delivered', 'delivery_failed', 'sent', 'skipped',
          'permanent_failed'
        ) then coalesce(
          notification.metadata -> 'whatsapp_dispatch' ->> 'error',
          notification.metadata -> 'dispatch' -> 'whatsapp' ->> 'error'
        )
        else 'payment_not_confirmed:' || lower(v_payment_status)
      end,
      'updated_at', now()
    )
  )
  where notification.id = p_notification_id
    and notification.metadata ->> 'event_key' = 'billing_payment_receipt';

  return found;
end;
$function$;

revoke all on function private.cancel_billing_payment_receipt_delivery(uuid, text)
  from PUBLIC, anon, authenticated, service_role;

-- Reversal invalidation runs before the general delivery trigger. Preserve a
-- provider-accepted channel as historical evidence; only work that never
-- reached a provider becomes skipped. The legacy whatsapp_dispatch alias is
-- kept in lockstep with dispatch.whatsapp.
create or replace function private.invalidate_billing_receipt_delivery_from_payment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_status text := upper(btrim(coalesce(new.status, '')));
  v_invalidated_at timestamptz := now();
begin
  if private.billing_payment_checkout_is_paid(v_status)
     or not private.billing_payment_checkout_is_reversal(v_status) then
    return new;
  end if;

  update public.notifications notification
  set metadata = coalesce(notification.metadata, '{}'::jsonb)
    || jsonb_build_object(
      'receipt_invalidated', true,
      'receipt_invalidated_at', v_invalidated_at,
      'receipt_invalidation_status', v_status,
      'whatsapp_dispatch_required', lower(coalesce(
        notification.metadata -> 'whatsapp_dispatch' ->> 'status',
        notification.metadata -> 'dispatch' -> 'whatsapp' ->> 'status',
        ''
      )) in ('accepted', 'delivered', 'delivery_failed', 'sent', 'permanent_failed'),
      'dispatch', coalesce(notification.metadata -> 'dispatch', '{}'::jsonb)
        || jsonb_build_object(
          'whatsapp', coalesce(
            notification.metadata -> 'dispatch' -> 'whatsapp',
            '{}'::jsonb
          ) || jsonb_build_object(
            'required', lower(coalesce(
              notification.metadata -> 'dispatch' -> 'whatsapp' ->> 'status', ''
            )) in ('accepted', 'delivered', 'delivery_failed', 'sent', 'permanent_failed'),
            'status', case
              when lower(coalesce(
                notification.metadata -> 'dispatch' -> 'whatsapp' ->> 'status', ''
              )) in (
                'accepted', 'delivered', 'delivery_failed', 'sent', 'skipped',
                'permanent_failed'
              ) then lower(notification.metadata -> 'dispatch' -> 'whatsapp' ->> 'status')
              else 'skipped'
            end,
            'invalidated_at', v_invalidated_at,
            'invalidation_status', v_status
          ),
          'email', coalesce(
            notification.metadata -> 'dispatch' -> 'email',
            '{}'::jsonb
          ) || jsonb_build_object(
            'required', lower(coalesce(
              notification.metadata -> 'dispatch' -> 'email' ->> 'status', ''
            )) in ('accepted', 'delivered', 'delivery_failed', 'sent', 'permanent_failed'),
            'status', case
              when lower(coalesce(
                notification.metadata -> 'dispatch' -> 'email' ->> 'status', ''
              )) in (
                'accepted', 'delivered', 'delivery_failed', 'sent', 'skipped',
                'permanent_failed'
              ) then lower(notification.metadata -> 'dispatch' -> 'email' ->> 'status')
              else 'skipped'
            end,
            'invalidated_at', v_invalidated_at,
            'invalidation_status', v_status
          ),
          'push', coalesce(
            notification.metadata -> 'dispatch' -> 'push',
            '{}'::jsonb
          ) || jsonb_build_object(
            'required', lower(coalesce(
              notification.metadata -> 'dispatch' -> 'push' ->> 'status', ''
            )) in ('accepted', 'delivered', 'delivery_failed', 'sent', 'permanent_failed'),
            'status', case
              when lower(coalesce(
                notification.metadata -> 'dispatch' -> 'push' ->> 'status', ''
              )) in (
                'accepted', 'delivered', 'delivery_failed', 'sent', 'skipped',
                'permanent_failed'
              ) then lower(notification.metadata -> 'dispatch' -> 'push' ->> 'status')
              else 'skipped'
            end,
            'invalidated_at', v_invalidated_at,
            'invalidation_status', v_status
          )
        ),
      'whatsapp_dispatch', coalesce(
        notification.metadata -> 'whatsapp_dispatch',
        notification.metadata -> 'dispatch' -> 'whatsapp',
        '{}'::jsonb
      ) || jsonb_build_object(
        'required', lower(coalesce(
          notification.metadata -> 'whatsapp_dispatch' ->> 'status',
          notification.metadata -> 'dispatch' -> 'whatsapp' ->> 'status',
          ''
        )) in ('accepted', 'delivered', 'delivery_failed', 'sent', 'permanent_failed'),
        'status', case
          when lower(coalesce(
            notification.metadata -> 'whatsapp_dispatch' ->> 'status',
            notification.metadata -> 'dispatch' -> 'whatsapp' ->> 'status',
            ''
          )) in (
            'accepted', 'delivered', 'delivery_failed', 'sent', 'skipped',
            'permanent_failed'
          ) then lower(coalesce(
            notification.metadata -> 'whatsapp_dispatch' ->> 'status',
            notification.metadata -> 'dispatch' -> 'whatsapp' ->> 'status'
          ))
          else 'skipped'
        end,
        'invalidated_at', v_invalidated_at,
        'invalidation_status', v_status
      )
    )
  where notification.organization_id = new.organization_id
    and notification.metadata ->> 'event_key' = 'billing_payment_receipt'
    and notification.metadata ->> 'payment_id' = new.id::text;

  return new;
end;
$function$;

revoke all on function private.invalidate_billing_receipt_delivery_from_payment()
  from PUBLIC, anon, authenticated, service_role;

create or replace function private.ensure_billing_payment_receipt_delivery_from_payment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_receipt public.billing_payment_receipts%rowtype;
  v_organization record;
  v_fallback_name text;
  v_fallback_email text;
  v_fallback_whatsapp text;
  v_recipient_name text;
  v_recipient_email text;
  v_recipient_whatsapp text;
  v_email_required boolean;
  v_whatsapp_required boolean;
  v_payment_is_paid boolean;
  v_canonicalized_count integer := 0;
begin
  v_payment_is_paid := private.billing_payment_checkout_is_paid(new.status);

  select receipt.*
    into v_receipt
  from public.billing_payment_receipts receipt
  where receipt.payment_id = new.id
    and receipt.organization_id = new.organization_id
  limit 1;

  -- Delivery belongs to the organization's immutable financial contact, never
  -- to whichever CRM member happens to sort first. Resolve this before every
  -- early return so a legacy user-backed row cannot survive a state change.
  select
    organization.name,
    coalesce(
      nullif(btrim(organization.billing_legal_name), ''),
      nullif(btrim(organization.razao_social), ''),
      nullif(btrim(v_receipt.payer_name), ''),
      nullif(btrim(organization.name), ''),
      'Cliente Vimob'
    ) as billing_contact_name,
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

  -- Only an active owner/admin may fill a missing organization-level contact.
  -- This is recipient fallback data, not notification ownership: user_id stays
  -- null even when this fallback is used.
  select
    nullif(btrim(account.name), ''),
    nullif(btrim(account.email), ''),
    coalesce(
      nullif(btrim(account.whatsapp), ''),
      nullif(btrim(account.phone), '')
    )
    into v_fallback_name, v_fallback_email, v_fallback_whatsapp
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
      else 2
    end,
    membership.created_at asc,
    account.id asc
  limit 1;

  v_recipient_name := coalesce(
    v_organization.billing_contact_name,
    v_fallback_name,
    nullif(v_receipt.snapshot ->> 'payer_name', ''),
    nullif(v_receipt.snapshot ->> 'organization_name', ''),
    'Cliente Vimob'
  );
  v_recipient_email := coalesce(
    v_organization.billing_email,
    v_fallback_email
  );
  v_recipient_whatsapp := coalesce(
    v_organization.billing_phone,
    v_fallback_whatsapp
  );
  v_email_required := v_recipient_email is not null;
  v_whatsapp_required := v_recipient_whatsapp is not null;

  -- The older receipt trigger can insert a member-owned row earlier in the
  -- same transaction. Canonicalize ownership, target and financial recipient
  -- before checking payment state or returning for a missing delivery.
  update public.notifications notification
  set
    user_id = null,
    channel = 'external',
    target_url = '/comprovantes/' || v_receipt.verification_token::text,
    is_read = true,
    metadata = (
      coalesce(notification.metadata, '{}'::jsonb)
        - 'receipt_delivery_cancelled_at'
        - 'receipt_delivery_cancel_reason'
    ) || jsonb_build_object(
      'event_key', 'billing_payment_receipt',
      'dedupe_key', coalesce(
        nullif(notification.metadata ->> 'dedupe_key', ''),
        'billing:payment_receipt:' || new.id::text
      ),
      'payment_id', new.id::text,
      'receipt_id', v_receipt.id::text,
      'receipt_number', v_receipt.receipt_number,
      'receipt_version', v_receipt.version,
      'verification_path', '/comprovantes/' || v_receipt.verification_token::text,
      'recipient_name', v_recipient_name,
      'recipient_email', v_recipient_email,
      'recipient_whatsapp', v_recipient_whatsapp,
      'delivery_contact_missing', not (v_email_required or v_whatsapp_required),
      'variables', coalesce(notification.metadata -> 'variables', '{}'::jsonb) || jsonb_build_object(
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
      'dispatch', coalesce(notification.metadata -> 'dispatch', '{}'::jsonb) || jsonb_build_object(
        'whatsapp', (case
          when lower(coalesce(
            notification.metadata -> 'dispatch' -> 'whatsapp' ->> 'status', ''
          )) in (
            'accepted', 'delivered', 'delivery_failed', 'sent',
            'permanent_failed'
          ) then coalesce(
            notification.metadata -> 'dispatch' -> 'whatsapp', '{}'::jsonb
          )
          else coalesce(
            notification.metadata -> 'dispatch' -> 'whatsapp', '{}'::jsonb
          ) - 'error' - 'next_retry_at'
        end) || jsonb_build_object(
          'required', v_whatsapp_required or lower(coalesce(
            notification.metadata -> 'dispatch' -> 'whatsapp' ->> 'status', ''
          )) in (
            'accepted', 'delivered', 'delivery_failed', 'sent',
            'permanent_failed'
          ),
          'status', case
            when lower(coalesce(
              notification.metadata -> 'dispatch' -> 'whatsapp' ->> 'status', ''
            )) in (
              'accepted', 'delivered', 'delivery_failed', 'sent',
              'permanent_failed'
            ) then lower(notification.metadata -> 'dispatch' -> 'whatsapp' ->> 'status')
            when not v_whatsapp_required then 'skipped'
            else 'pending'
          end,
          'updated_at', now()
        ),
        'email', (case
          when lower(coalesce(
            notification.metadata -> 'dispatch' -> 'email' ->> 'status', ''
          )) in (
            'accepted', 'delivered', 'delivery_failed', 'sent',
            'permanent_failed'
          ) then coalesce(
            notification.metadata -> 'dispatch' -> 'email', '{}'::jsonb
          )
          else coalesce(
            notification.metadata -> 'dispatch' -> 'email', '{}'::jsonb
          ) - 'error' - 'next_retry_at'
        end) || jsonb_build_object(
          'required', v_email_required or lower(coalesce(
            notification.metadata -> 'dispatch' -> 'email' ->> 'status', ''
          )) in (
            'accepted', 'delivered', 'delivery_failed', 'sent',
            'permanent_failed'
          ),
          'status', case
            when lower(coalesce(
              notification.metadata -> 'dispatch' -> 'email' ->> 'status', ''
            )) in (
              'accepted', 'delivered', 'delivery_failed', 'sent',
              'permanent_failed'
            ) then lower(notification.metadata -> 'dispatch' -> 'email' ->> 'status')
            when not v_email_required then 'skipped'
            else 'pending'
          end,
          'updated_at', now()
        )
      ),
      'whatsapp_dispatch_required', v_whatsapp_required or lower(coalesce(
        notification.metadata -> 'whatsapp_dispatch' ->> 'status',
        notification.metadata -> 'dispatch' -> 'whatsapp' ->> 'status',
        ''
      )) in (
        'accepted', 'delivered', 'delivery_failed', 'sent', 'permanent_failed'
      ),
      'whatsapp_dispatch', (case
        when lower(coalesce(
          notification.metadata -> 'whatsapp_dispatch' ->> 'status',
          notification.metadata -> 'dispatch' -> 'whatsapp' ->> 'status',
          ''
        )) in (
          'accepted', 'delivered', 'delivery_failed', 'sent',
          'permanent_failed'
        ) then coalesce(
          notification.metadata -> 'whatsapp_dispatch',
          notification.metadata -> 'dispatch' -> 'whatsapp',
          '{}'::jsonb
        )
        else coalesce(
          notification.metadata -> 'whatsapp_dispatch',
          notification.metadata -> 'dispatch' -> 'whatsapp',
          '{}'::jsonb
        ) - 'error' - 'next_retry_at'
      end) || jsonb_build_object(
        'required', v_whatsapp_required or lower(coalesce(
          notification.metadata -> 'whatsapp_dispatch' ->> 'status',
          notification.metadata -> 'dispatch' -> 'whatsapp' ->> 'status',
          ''
        )) in (
          'accepted', 'delivered', 'delivery_failed', 'sent',
          'permanent_failed'
        ),
        'status', case
          when lower(coalesce(
            notification.metadata -> 'whatsapp_dispatch' ->> 'status',
            notification.metadata -> 'dispatch' -> 'whatsapp' ->> 'status',
            ''
          )) in (
            'accepted', 'delivered', 'delivery_failed', 'sent',
            'permanent_failed'
          ) then lower(coalesce(
            notification.metadata -> 'whatsapp_dispatch' ->> 'status',
            notification.metadata -> 'dispatch' -> 'whatsapp' ->> 'status'
          ))
          when not v_whatsapp_required then 'skipped'
          else 'pending'
        end,
        'updated_at', now()
      )
    )
  where v_receipt.id is not null
    and notification.organization_id = new.organization_id
    and notification.metadata ->> 'event_key' = 'billing_payment_receipt'
    and notification.metadata ->> 'payment_id' = new.id::text;
  get diagnostics v_canonicalized_count = row_count;

  if not v_payment_is_paid then
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

  -- Receipt creation is an earlier same-timing trigger. Never enqueue a paid
  -- message without its immutable verification record.
  if v_receipt.id is null then
    return new;
  end if;

  if v_canonicalized_count > 0 then
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
          'status', case when v_whatsapp_required then 'pending' else 'skipped' end,
          'updated_at', now()
        ),
        'email', jsonb_build_object(
          'required', v_email_required,
          'status', case when v_email_required then 'pending' else 'skipped' end,
          'updated_at', now()
        )
      ),
      'whatsapp_dispatch_required', v_whatsapp_required,
      'whatsapp_dispatch', jsonb_build_object(
        'required', v_whatsapp_required,
        'status', case when v_whatsapp_required then 'pending' else 'skipped' end,
        'updated_at', now()
      )
    )
  )
  on conflict do nothing;

  return new;
end;
$function$;

revoke all on function private.ensure_billing_payment_receipt_delivery_from_payment()
  from PUBLIC, anon, authenticated, service_role;
grant execute on function private.ensure_billing_payment_receipt_delivery_from_payment()
  to service_role;

-- Repair REFUND_DENIED-first rows created between the canonical paid predicate
-- and this delivery override. The assignment is intentional: receipt creation
-- and delivery are both idempotent and uniquely keyed by payment.
update public.asaas_payments payment
set status = payment.status
where upper(btrim(coalesce(payment.status, ''))) = 'REFUND_DENIED';

create or replace function public.verify_billing_payment_receipt(
  p_verification_token uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select jsonb_build_object(
    'found', true,
    'valid', private.billing_payment_checkout_is_paid(payment.status),
    'payment_state', case
      when private.billing_payment_checkout_is_paid(payment.status)
        then 'confirmed'
      when upper(btrim(coalesce(payment.status, ''))) in (
        'REFUNDED',
        'REFUND_REQUESTED',
        'REFUND_IN_PROGRESS',
        'PARTIALLY_REFUNDED',
        'RECEIVED_IN_CASH_UNDONE'
      ) then 'refunded'
      when upper(btrim(coalesce(payment.status, ''))) like 'CHARGEBACK%'
        or upper(btrim(coalesce(payment.status, ''))) = 'AWAITING_CHARGEBACK_REVERSAL'
        then 'chargeback'
      when upper(btrim(coalesce(payment.status, ''))) in (
        'DELETED', 'CANCELLED', 'CANCELED'
      ) then 'cancelled'
      else 'invalidated'
    end,
    'current_payment_status', upper(btrim(coalesce(payment.status, 'UNKNOWN'))),
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
$function$;

revoke all on function public.verify_billing_payment_receipt(uuid)
  from PUBLIC, anon, authenticated, service_role;
grant execute on function public.verify_billing_payment_receipt(uuid)
  to anon, authenticated, service_role;
