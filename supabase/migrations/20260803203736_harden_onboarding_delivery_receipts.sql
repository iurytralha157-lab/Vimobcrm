-- Transactional email delivery must be observable beyond the provider's HTTP
-- acceptance response. Keep the existing table for compatibility and extend it
-- with stable provider and outbox identifiers.
alter table public.email_logs
  add column if not exists user_id uuid
    references public.users(id) on delete set null,
  add column if not exists notification_id uuid
    references public.notifications(id) on delete set null,
  add column if not exists provider text not null default 'resend',
  add column if not exists provider_message_id text,
  add column if not exists idempotency_key text,
  add column if not exists accepted_at timestamptz,
  add column if not exists delivered_at timestamptz,
  add column if not exists last_event_at timestamptz,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create unique index if not exists email_logs_notification_unique_idx
  on public.email_logs(notification_id)
  where notification_id is not null;

create unique index if not exists email_logs_provider_message_unique_idx
  on public.email_logs(provider, provider_message_id)
  where provider_message_id is not null;

create unique index if not exists email_logs_idempotency_unique_idx
  on public.email_logs(provider, idempotency_key)
  where idempotency_key is not null;

create index if not exists email_logs_org_created_desc_idx
  on public.email_logs(organization_id, created_at desc);

drop policy if exists "Admins can view email logs" on public.email_logs;
create policy "Organization billing admins can view email logs"
on public.email_logs
for select
to authenticated
using (
  public.is_super_admin()
  or exists (
    select 1
    from public.organization_members membership
    where membership.organization_id = email_logs.organization_id
      and membership.user_id = (select auth.uid())
      and membership.is_active = true
      and lower(coalesce(membership.role, 'user')) in ('owner', 'admin')
  )
);

revoke insert, update, delete, truncate, references, trigger
  on table public.email_logs from anon, authenticated;
grant select on table public.email_logs to authenticated;

create table if not exists public.email_delivery_events (
  id uuid primary key default gen_random_uuid(),
  email_log_id uuid references public.email_logs(id) on delete set null,
  organization_id uuid references public.organizations(id) on delete cascade,
  user_id uuid references public.users(id) on delete set null,
  provider text not null default 'resend',
  provider_event_id text not null,
  provider_message_id text not null,
  event_type text not null,
  occurred_at timestamptz not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint email_delivery_events_payload_object_check
    check (jsonb_typeof(payload) = 'object')
);

create unique index if not exists email_delivery_events_provider_event_unique_idx
  on public.email_delivery_events(provider, provider_event_id);

create index if not exists email_delivery_events_message_created_idx
  on public.email_delivery_events(provider_message_id, created_at desc);

alter table public.email_delivery_events enable row level security;
revoke all on table public.email_delivery_events from public, anon, authenticated;
grant all on table public.email_delivery_events to service_role;

create or replace function public.record_resend_email_event(
  p_provider_event_id text,
  p_provider_message_id text,
  p_event_type text,
  p_occurred_at timestamptz,
  p_payload jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email_log_id uuid;
  v_organization_id uuid;
  v_user_id uuid;
  v_event_id uuid;
  v_error text;
begin
  if nullif(btrim(p_provider_event_id), '') is null
     or nullif(btrim(p_provider_message_id), '') is null
     or p_event_type not like 'email.%'
     or jsonb_typeof(coalesce(p_payload, '{}'::jsonb)) <> 'object' then
    raise exception 'invalid Resend email event';
  end if;

  select logs.id, logs.organization_id, logs.user_id
    into v_email_log_id, v_organization_id, v_user_id
  from public.email_logs logs
  where logs.provider = 'resend'
    and logs.provider_message_id = btrim(p_provider_message_id)
  limit 1;

  insert into public.email_delivery_events (
    email_log_id,
    organization_id,
    user_id,
    provider,
    provider_event_id,
    provider_message_id,
    event_type,
    occurred_at,
    payload
  )
  values (
    v_email_log_id,
    v_organization_id,
    v_user_id,
    'resend',
    left(btrim(p_provider_event_id), 255),
    left(btrim(p_provider_message_id), 255),
    left(btrim(p_event_type), 80),
    coalesce(p_occurred_at, now()),
    coalesce(p_payload, '{}'::jsonb)
  )
  on conflict (provider, provider_event_id) do nothing
  returning id into v_event_id;

  if v_event_id is null then
    return false;
  end if;

  v_error := coalesce(
    p_payload #>> '{bounce,message}',
    p_payload #>> '{failed,reason}',
    p_payload #>> '{suppressed,message}'
  );

  update public.email_logs
  set status = case p_event_type
        when 'email.sent' then 'accepted'
        when 'email.delivered' then 'delivered'
        when 'email.delivery_delayed' then 'delayed'
        when 'email.bounced' then 'bounced'
        when 'email.complained' then 'complained'
        when 'email.failed' then 'failed'
        when 'email.suppressed' then 'suppressed'
        else status
      end,
      error_message = case
        when p_event_type in ('email.bounced', 'email.complained', 'email.failed', 'email.suppressed')
          then nullif(left(coalesce(v_error, p_event_type), 1000), '')
        else error_message
      end,
      delivered_at = case
        when p_event_type = 'email.delivered' then coalesce(p_occurred_at, now())
        else delivered_at
      end,
      last_event_at = greatest(
        coalesce(last_event_at, '-infinity'::timestamptz),
        coalesce(p_occurred_at, now())
      ),
      updated_at = now()
  where id = v_email_log_id;

  return true;
end;
$$;

revoke all on function public.record_resend_email_event(text, text, text, timestamptz, jsonb)
  from public, anon, authenticated;
grant execute on function public.record_resend_email_event(text, text, text, timestamptz, jsonb)
  to service_role;

-- Immutable Vimob-issued payment receipts. The snapshot is created as soon as
-- an Asaas payment reaches a terminal paid state, independently from email and
-- WhatsApp delivery workers.
create table if not exists public.billing_payment_receipts (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null unique
    references public.asaas_payments(id) on delete restrict,
  organization_id uuid not null
    references public.organizations(id) on delete restrict,
  plan_id uuid references public.admin_subscription_plans(id) on delete set null,
  receipt_number text not null unique,
  verification_token uuid not null default gen_random_uuid() unique,
  version integer not null default 1 check (version > 0),
  issuer_name text not null,
  payer_name text not null,
  payer_tax_id text,
  billing_email text,
  plan_name text not null,
  billing_period_months integer not null check (billing_period_months in (1, 6, 12)),
  payment_provider text not null default 'asaas',
  provider_payment_reference text not null,
  billing_type text not null,
  amount numeric(12, 2) not null check (amount >= 0),
  currency text not null default 'BRL',
  paid_at timestamptz not null,
  issued_at timestamptz not null default now(),
  snapshot jsonb not null,
  snapshot_hash text not null,
  created_at timestamptz not null default now(),
  constraint billing_payment_receipts_snapshot_object_check
    check (jsonb_typeof(snapshot) = 'object')
);

create index if not exists billing_payment_receipts_org_issued_desc_idx
  on public.billing_payment_receipts(organization_id, issued_at desc);

alter table public.billing_payment_receipts enable row level security;
revoke all on table public.billing_payment_receipts from public, anon, authenticated;
grant select on table public.billing_payment_receipts to authenticated;
grant all on table public.billing_payment_receipts to service_role;

create policy "Organization billing admins can view payment receipts"
on public.billing_payment_receipts
for select
to authenticated
using (
  public.is_super_admin()
  or exists (
    select 1
    from public.organization_members membership
    where membership.organization_id = billing_payment_receipts.organization_id
      and membership.user_id = (select auth.uid())
      and membership.is_active = true
      and lower(coalesce(membership.role, 'user')) in ('owner', 'admin')
  )
);

create or replace function private.create_billing_payment_receipt_from_payment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organization record;
  v_plan_id uuid;
  v_plan_name text;
  v_billing_period_months integer;
  v_issuer jsonb;
  v_receipt_number text;
  v_snapshot jsonb;
  v_receipt_id uuid;
  v_verification_token uuid;
  v_receipt_issued_at timestamptz;
  v_recipient record;
begin
  if upper(coalesce(new.status, '')) not in ('RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH') then
    return new;
  end if;

  if exists (
    select 1
    from public.billing_payment_receipts receipt
    where receipt.payment_id = new.id
  ) then
    return new;
  end if;

  select
    organization.name,
    coalesce(nullif(btrim(organization.billing_legal_name), ''), nullif(btrim(organization.razao_social), ''), organization.name) as payer_name,
    coalesce(nullif(btrim(organization.billing_tax_id), ''), nullif(btrim(organization.cnpj), '')) as payer_tax_id,
    coalesce(nullif(btrim(organization.billing_email), ''), nullif(btrim(organization.email), '')) as billing_email,
    coalesce(nullif(btrim(organization.billing_phone), ''), nullif(btrim(organization.whatsapp), ''), nullif(btrim(organization.telefone), '')) as billing_phone,
    coalesce(intent.pending_plan_id, organization.pending_plan_id, organization.plan_id) as receipt_plan_id,
    coalesce(intent.billing_period_months, organization.subscription_billing_period_months, 1) as receipt_period_months,
    coalesce(
      intent.confirmed_at,
      new.last_webhook_event_at,
      new.payment_date::timestamp at time zone 'America/Sao_Paulo',
      new.updated_at,
      now()
    ) as receipt_paid_at
    into v_organization
  from public.organizations organization
  left join private.billing_checkout_intents intent
    on intent.id = new.billing_intent_id
  where organization.id = new.organization_id;

  v_plan_id := v_organization.receipt_plan_id;
  v_billing_period_months := case
    when v_organization.receipt_period_months in (1, 6, 12) then v_organization.receipt_period_months
    else 1
  end;

  select plan.name
    into v_plan_name
  from public.admin_subscription_plans plan
  where plan.id = v_plan_id;
  v_plan_name := coalesce(nullif(btrim(v_plan_name), ''), 'Plano Vimob');

  select settings.value
    into v_issuer
  from public.system_settings settings
  where settings.key = 'billing_issuer'
  order by settings.updated_at desc nulls last, settings.created_at desc nulls last
  limit 1;
  v_issuer := coalesce(v_issuer, jsonb_build_object(
    'name', 'Vimob CRM',
    'support_email', 'contato@vimobcrm.com.br'
  ));

  v_receipt_number := 'VIMOB-'
    || to_char(v_organization.receipt_paid_at at time zone 'America/Sao_Paulo', 'YYYYMM')
    || '-'
    || upper(substr(replace(new.id::text, '-', ''), 1, 12));

  v_snapshot := jsonb_build_object(
    'version', 1,
    'receipt_number', v_receipt_number,
    'issuer', v_issuer,
    'organization_id', new.organization_id,
    'organization_name', v_organization.name,
    'payer_name', v_organization.payer_name,
    'payer_tax_id', v_organization.payer_tax_id,
    'billing_email', v_organization.billing_email,
    'plan_id', v_plan_id,
    'plan_name', v_plan_name,
    'billing_period_months', v_billing_period_months,
    'payment_provider', 'asaas',
    'provider_payment_reference', new.asaas_payment_id,
    'billing_type', coalesce(nullif(upper(btrim(new.billing_type)), ''), 'UNKNOWN'),
    'amount', coalesce(new.value, 0),
    'currency', 'BRL',
    'paid_at', v_organization.receipt_paid_at
  );

  insert into public.billing_payment_receipts (
    payment_id,
    organization_id,
    plan_id,
    receipt_number,
    issuer_name,
    payer_name,
    payer_tax_id,
    billing_email,
    plan_name,
    billing_period_months,
    provider_payment_reference,
    billing_type,
    amount,
    paid_at,
    snapshot,
    snapshot_hash
  )
  values (
    new.id,
    new.organization_id,
    v_plan_id,
    v_receipt_number,
    coalesce(nullif(btrim(v_issuer ->> 'name'), ''), 'Vimob CRM'),
    v_organization.payer_name,
    v_organization.payer_tax_id,
    v_organization.billing_email,
    v_plan_name,
    v_billing_period_months,
    new.asaas_payment_id,
    coalesce(nullif(upper(btrim(new.billing_type)), ''), 'UNKNOWN'),
    coalesce(new.value, 0),
    v_organization.receipt_paid_at,
    v_snapshot,
    encode(extensions.digest(v_snapshot::text, 'sha256'), 'hex')
  )
  on conflict (payment_id) do nothing
  returning id, verification_token, issued_at
    into v_receipt_id, v_verification_token, v_receipt_issued_at;

  if v_receipt_id is null then
    select receipt.id, receipt.verification_token, receipt.issued_at
      into v_receipt_id, v_verification_token, v_receipt_issued_at
    from public.billing_payment_receipts receipt
    where receipt.payment_id = new.id;
  end if;

  -- Exactly one external receipt delivery is produced transactionally with the
  -- immutable snapshot. Other billing administrators still see the in-app
  -- payment history, without receiving duplicate copies of the same receipt.
  select
    account.id as user_id,
    account.name as recipient_name,
    coalesce(v_organization.billing_email, nullif(btrim(account.email), '')) as recipient_email,
    coalesce(v_organization.billing_phone, nullif(btrim(account.whatsapp), ''), nullif(btrim(account.phone), '')) as recipient_whatsapp
    into v_recipient
  from public.organization_members membership
  join public.users account on account.id = membership.user_id
  where membership.organization_id = new.organization_id
    and membership.is_active = true
    and coalesce(account.is_active, true) = true
  order by
    case
      when v_organization.billing_email is not null
       and lower(account.email) = lower(v_organization.billing_email) then 0
      when lower(coalesce(membership.role, '')) = 'owner' then 1
      when lower(coalesce(membership.role, '')) = 'admin' then 2
      else 3
    end,
    membership.created_at asc
  limit 1;

  if v_recipient.user_id is not null then
    insert into public.notifications (
      organization_id,
      user_id,
      title,
      content,
      body,
      type,
      channel,
      target_url,
      metadata
    )
    values (
      new.organization_id,
      v_recipient.user_id,
      'Comprovante de pagamento Vimob',
      'Seu pagamento foi confirmado e o comprovante Vimob esta disponivel.',
      'Seu pagamento foi confirmado e o comprovante Vimob esta disponivel.',
      'billing',
      'in_app',
      '/settings?tab=subscription&billing=payments&payment=' || new.id::text,
      jsonb_build_object(
        'event_key', 'billing_payment_receipt',
        'dedupe_key', 'billing:payment_receipt:' || new.id::text,
        'payment_id', new.id::text,
        'receipt_id', v_receipt_id::text,
        'receipt_number', v_receipt_number,
        'receipt_version', 1,
        'verification_path', '/comprovantes/' || v_verification_token::text,
        'recipient_name', v_recipient.recipient_name,
        'recipient_email', v_recipient.recipient_email,
        'recipient_whatsapp', v_recipient.recipient_whatsapp,
        'variables', jsonb_build_object(
          'receipt_number', v_receipt_number,
          'organization_name', v_organization.name,
          'payer_name', v_organization.payer_name,
          'payer_tax_id', v_organization.payer_tax_id,
          'plan_name', v_plan_name,
          'billing_period_months', v_billing_period_months,
          'billing_type', coalesce(nullif(upper(btrim(new.billing_type)), ''), 'UNKNOWN'),
          'amount', 'R$ ' || replace(to_char(coalesce(new.value, 0), 'FM999999990D00'), '.', ','),
          'paid_at', to_char(v_organization.receipt_paid_at at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI'),
          'provider_payment_reference', new.asaas_payment_id,
          'verification_path', '/comprovantes/' || v_verification_token::text,
          'issuer_name', coalesce(nullif(btrim(v_issuer ->> 'name'), ''), 'Vimob CRM'),
          'issued_at', to_char(v_receipt_issued_at at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI')
        ),
        'dispatch', jsonb_build_object(
          'whatsapp', jsonb_build_object('required', true, 'status', 'pending'),
          'email', jsonb_build_object('required', true, 'status', 'pending')
        ),
        'whatsapp_dispatch_required', true,
        'whatsapp_dispatch', jsonb_build_object('status', 'pending')
      )
    )
    on conflict do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists create_billing_payment_receipt_after_payment on public.asaas_payments;
create trigger create_billing_payment_receipt_after_payment
after insert or update of status, payment_date on public.asaas_payments
for each row
execute function private.create_billing_payment_receipt_from_payment();

-- Backfill any paid rows that predate this migration through the same immutable
-- trigger. Assigning the same status is intentional and side-effect free.
update public.asaas_payments
set status = status
where upper(coalesce(status, '')) in ('RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH')
  and not exists (
    select 1
    from public.billing_payment_receipts receipt
    where receipt.payment_id = asaas_payments.id
  );

create or replace function private.prevent_billing_payment_receipt_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'billing payment receipts are immutable';
end;
$$;

drop trigger if exists prevent_billing_payment_receipt_mutation on public.billing_payment_receipts;
create trigger prevent_billing_payment_receipt_mutation
before update or delete on public.billing_payment_receipts
for each row
execute function private.prevent_billing_payment_receipt_mutation();

create or replace function public.verify_billing_payment_receipt(p_verification_token uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'valid', true,
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
  where receipt.verification_token = p_verification_token
  limit 1;
$$;

revoke all on function public.verify_billing_payment_receipt(uuid) from public;
grant execute on function public.verify_billing_payment_receipt(uuid) to anon, authenticated, service_role;

-- The superadmin screen historically wrote the WhatsApp dispatcher under the
-- `platform` row while both workers read `notifications`. Merge the already
-- enabled sender into the canonical row once and keep existing credentials.
insert into public.system_settings (key, description, value)
select
  'notifications',
  'Configuracoes globais de entrega transacional',
  jsonb_build_object(
    'notification_dispatch',
    jsonb_build_object('whatsapp', platform.value #> '{notification_dispatch,whatsapp}')
  )
from public.system_settings platform
where platform.key = 'platform'
  and coalesce((platform.value #>> '{notification_dispatch,whatsapp,enabled}')::boolean, false)
  and not exists (
    select 1 from public.system_settings existing where existing.key = 'notifications'
  )
limit 1;

with platform_sender as (
  select value #> '{notification_dispatch,whatsapp}' as whatsapp
  from public.system_settings
  where key = 'platform'
    and coalesce((value #>> '{notification_dispatch,whatsapp,enabled}')::boolean, false)
  order by updated_at desc nulls last, created_at desc nulls last
  limit 1
)
update public.system_settings notifications
set value = (
      coalesce(notifications.value, '{}'::jsonb)
      || jsonb_build_object(
        'notification_dispatch',
        coalesce(notifications.value -> 'notification_dispatch', '{}'::jsonb)
        || jsonb_build_object(
          'whatsapp',
          (
            coalesce(platform_sender.whatsapp, '{}'::jsonb)
            || coalesce(notifications.value #> '{notification_dispatch,whatsapp}', '{}'::jsonb)
            || jsonb_build_object('enabled', true)
          )
        )
      )
    ),
    description = 'Configuracoes globais de entrega transacional',
    updated_at = now()
from platform_sender
where notifications.key = 'notifications';
