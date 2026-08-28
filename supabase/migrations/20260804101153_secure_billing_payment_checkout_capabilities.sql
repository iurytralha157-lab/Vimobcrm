-- Payment-scoped checkout capabilities let the Vimob BFF expose an internal
-- checkout URL without leaking Asaas invoice URLs or organization-wide tokens.
-- The raw capability remains readable only by service_role.

-- PAYMENT_BANK_SLIP_CANCELLED may carry payment.status=OVERDUE. Preserve that
-- provider payment state, while recording separately that the current boleto
-- registration is no longer payable. Polling snapshots must not erase this
-- fact; an explicit due-date change represents a newly-issued artifact.
alter table public.asaas_payments
  add column if not exists bank_slip_registration_cancelled_at timestamptz,
  add column if not exists bank_slip_registration_cancelled_due_date date;

-- Keep invitation roles canonical end to end. Manager invitations must not be
-- coerced to ordinary users merely because the historical constraint lagged
-- behind the authorization model.
alter table public.organization_members
  drop constraint if exists organization_members_role_check;
alter table public.organization_members
  add constraint organization_members_role_check
  check (lower(btrim(role)) in ('owner', 'admin', 'manager', 'user'));

do $constraints$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'asaas_payments_bank_slip_registration_cancelled_check'
      and conrelid = 'public.asaas_payments'::regclass
  ) then
    alter table public.asaas_payments
      add constraint asaas_payments_bank_slip_registration_cancelled_check
      check (
        (
          bank_slip_registration_cancelled_at is null
          and bank_slip_registration_cancelled_due_date is null
        )
        or (
          bank_slip_registration_cancelled_at is not null
          and bank_slip_registration_cancelled_due_date is not null
        )
      );
  end if;
end
$constraints$;

create or replace function private.sync_asaas_bank_slip_registration_state()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_event_type text := upper(btrim(coalesce(new.raw_event ->> 'event', '')));
  v_is_new_cancellation_event boolean := false;
begin
  if v_event_type = 'PAYMENT_BANK_SLIP_CANCELLED' and new.due_date is not null then
    if tg_op = 'INSERT' then
      v_is_new_cancellation_event := true;
    else
      v_is_new_cancellation_event :=
        new.last_webhook_event_id is distinct from old.last_webhook_event_id
        or new.last_webhook_event_at is distinct from old.last_webhook_event_at;
    end if;
  end if;

  if v_is_new_cancellation_event then
    if tg_op = 'UPDATE' then
      new.bank_slip_registration_cancelled_at := coalesce(
        old.bank_slip_registration_cancelled_at,
        new.last_webhook_event_at,
        clock_timestamp()
      );
    else
      new.bank_slip_registration_cancelled_at := coalesce(
        new.last_webhook_event_at,
        clock_timestamp()
      );
    end if;
    new.bank_slip_registration_cancelled_due_date := new.due_date;
  elsif tg_op = 'UPDATE'
    and old.bank_slip_registration_cancelled_at is not null
    and new.due_date is not null
    and new.due_date is distinct from old.bank_slip_registration_cancelled_due_date then
    new.bank_slip_registration_cancelled_at := null;
    new.bank_slip_registration_cancelled_due_date := null;
  end if;

  return new;
end
$function$;

revoke all on function private.sync_asaas_bank_slip_registration_state()
  from PUBLIC, anon, authenticated, service_role;

drop trigger if exists sync_asaas_bank_slip_registration_state
  on public.asaas_payments;
create trigger sync_asaas_bank_slip_registration_state
before insert or update of
  raw_event,
  due_date,
  last_webhook_event_id,
  last_webhook_event_at
on public.asaas_payments
for each row
execute function private.sync_asaas_bank_slip_registration_state();

update public.asaas_payments
set
  bank_slip_registration_cancelled_at = coalesce(
    last_webhook_event_at,
    updated_at,
    created_at,
    now()
  ),
  bank_slip_registration_cancelled_due_date = due_date
where upper(btrim(coalesce(raw_event ->> 'event', ''))) = 'PAYMENT_BANK_SLIP_CANCELLED'
  and due_date is not null
  and bank_slip_registration_cancelled_at is null;

do $constraints$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'asaas_payments_checkout_identity_key'
      and conrelid = 'public.asaas_payments'::regclass
  ) then
    alter table public.asaas_payments
      add constraint asaas_payments_checkout_identity_key
      unique (id, asaas_payment_id, organization_id);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'asaas_payments_checkout_intent_key'
      and conrelid = 'public.asaas_payments'::regclass
  ) then
    alter table public.asaas_payments
      add constraint asaas_payments_checkout_intent_key
      unique (id, billing_intent_id);
  end if;
end
$constraints$;

create table if not exists public.billing_payment_checkout_capabilities (
  payment_id uuid primary key,
  asaas_payment_id text not null unique,
  organization_id uuid not null,
  billing_intent_id uuid,
  plan_id uuid not null,
  billing_period_months integer not null,
  amount numeric(10, 2) not null,
  snapshot_source text not null,
  checkout_token text not null unique
    default encode(extensions.gen_random_bytes(32), 'hex'),
  -- Asaas may materialize subscription invoices forty days before maturity.
  -- Ninety days keeps the capability valid through that lead time and a
  -- bounded overdue window; terminal provider states still revoke it early.
  expires_at timestamptz not null default (now() + interval '90 days'),
  revoked_at timestamptz,
  attempt_lease_id uuid,
  attempt_lease_expires_at timestamptz,
  attempt_window_started_at timestamptz,
  attempt_window_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint billing_payment_checkout_capabilities_payment_identity_fkey
    foreign key (payment_id, asaas_payment_id, organization_id)
    references public.asaas_payments (id, asaas_payment_id, organization_id)
    on update cascade
    on delete cascade,
  constraint billing_payment_checkout_capabilities_payment_intent_fkey
    foreign key (payment_id, billing_intent_id)
    references public.asaas_payments (id, billing_intent_id)
    on update cascade
    on delete cascade,
  constraint billing_payment_checkout_capabilities_organization_fkey
    foreign key (organization_id)
    references public.organizations (id)
    on update cascade
    on delete cascade,
  constraint billing_payment_checkout_capabilities_intent_fkey
    foreign key (billing_intent_id)
    references private.billing_checkout_intents (id)
    on update cascade
    on delete set null,
  constraint billing_payment_checkout_capabilities_plan_fkey
    foreign key (plan_id)
    references public.admin_subscription_plans (id)
    on update cascade
    on delete restrict,
  constraint billing_payment_checkout_capabilities_token_format_check
    check (checkout_token ~ '^[0-9a-f]{64}$'),
  constraint billing_payment_checkout_capabilities_period_check
    check (billing_period_months in (1, 6, 12)),
  constraint billing_payment_checkout_capabilities_amount_check
    check (amount > 0),
  constraint billing_payment_checkout_capabilities_snapshot_source_check
    check (snapshot_source in ('intent', 'subscription', 'legacy_catalog')),
  constraint billing_payment_checkout_capabilities_expiry_check
    check (expires_at > created_at),
  constraint billing_payment_checkout_capabilities_revocation_check
    check (revoked_at is null or revoked_at >= created_at),
  constraint billing_payment_checkout_capabilities_attempt_lease_check
    check (
      (attempt_lease_id is null and attempt_lease_expires_at is null)
      or (attempt_lease_id is not null and attempt_lease_expires_at is not null)
    ),
  constraint billing_payment_checkout_capabilities_attempt_window_check
    check (
      attempt_window_count between 0 and 5
      and (
        attempt_window_started_at is not null
        or attempt_window_count = 0
      )
    ),
  constraint billing_payment_checkout_capabilities_timestamps_check
    check (updated_at >= created_at)
);

-- Initial organization-scoped card checkout is public by capability. Persist
-- independent limits for the capability and the caller IP fingerprint so an
-- attacker cannot bypass card-testing controls by rotating either dimension.
-- Only HMAC-SHA256 fingerprints produced by the Edge are accepted; raw IPs
-- and raw checkout tokens are never stored in these tables.
create table if not exists private.billing_organization_checkout_card_attempt_limits (
  organization_id uuid not null
    references public.organizations (id) on delete cascade,
  capability_hash text not null,
  short_window_started_at timestamptz not null,
  short_window_count integer not null,
  daily_window_started_at timestamptz not null,
  daily_window_count integer not null,
  last_attempt_at timestamptz not null,
  expires_at timestamptz not null,
  primary key (organization_id, capability_hash),
  constraint billing_org_card_attempt_capability_hash_check
    check (capability_hash ~ '^[0-9a-f]{64}$'),
  constraint billing_org_card_attempt_counts_check
    check (short_window_count >= 1 and daily_window_count >= 1),
  constraint billing_org_card_attempt_timestamps_check
    check (
      short_window_started_at <= last_attempt_at
      and daily_window_started_at <= last_attempt_at
      and expires_at > last_attempt_at
    )
);

create table if not exists private.billing_ip_card_attempt_limits (
  ip_fingerprint text primary key,
  short_window_started_at timestamptz not null,
  short_window_count integer not null,
  daily_window_started_at timestamptz not null,
  daily_window_count integer not null,
  last_attempt_at timestamptz not null,
  expires_at timestamptz not null,
  constraint billing_ip_card_attempt_fingerprint_check
    check (ip_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint billing_ip_card_attempt_counts_check
    check (short_window_count >= 1 and daily_window_count >= 1),
  constraint billing_ip_card_attempt_timestamps_check
    check (
      short_window_started_at <= last_attempt_at
      and daily_window_started_at <= last_attempt_at
      and expires_at > last_attempt_at
    )
);

-- Authenticated settings flows do not carry a public checkout capability.
-- Keep their organization/actor bucket separate while sharing the global
-- HMAC-IP dimension with every public card-entry surface.
create table if not exists private.billing_authenticated_org_card_attempt_limits (
  organization_id uuid not null
    references public.organizations (id) on delete cascade,
  actor_user_id uuid not null
    references public.users (id) on delete cascade,
  short_window_started_at timestamptz not null,
  short_window_count integer not null,
  daily_window_started_at timestamptz not null,
  daily_window_count integer not null,
  last_attempt_at timestamptz not null,
  expires_at timestamptz not null,
  primary key (organization_id, actor_user_id),
  constraint billing_authenticated_org_card_attempt_counts_check
    check (short_window_count >= 1 and daily_window_count >= 1),
  constraint billing_authenticated_org_card_attempt_timestamps_check
    check (
      short_window_started_at <= last_attempt_at
      and daily_window_started_at <= last_attempt_at
      and expires_at > last_attempt_at
    )
);

-- A payment checkout is a different bearer capability from the initial
-- organization checkout. Key by the immutable payment identity so rotating a
-- public token cannot reset the payment-specific card-testing budget.
create table if not exists private.billing_payment_card_attempt_limits (
  payment_id uuid primary key
    references public.billing_payment_checkout_capabilities (payment_id)
    on delete cascade,
  organization_id uuid not null
    references public.organizations (id) on delete cascade,
  short_window_started_at timestamptz not null,
  short_window_count integer not null,
  daily_window_started_at timestamptz not null,
  daily_window_count integer not null,
  last_attempt_at timestamptz not null,
  expires_at timestamptz not null,
  constraint billing_payment_card_attempt_counts_check
    check (short_window_count >= 1 and daily_window_count >= 1),
  constraint billing_payment_card_attempt_timestamps_check
    check (
      short_window_started_at <= last_attempt_at
      and daily_window_started_at <= last_attempt_at
      and expires_at > last_attempt_at
    )
);

-- Creating a recurring card subscription after a one-off invoice is paid is
-- deliberately tracked separately from the payment-attempt lease above. The
-- provider's subscription-create endpoint is not safe to replay after an
-- ambiguous timeout, so every payment gets one durable, fail-closed state
-- machine whose immutable tuple is captured before the card charge.
create table if not exists private.billing_card_recurrence_provisions (
  payment_id uuid primary key,
  provider_payment_id text not null unique,
  organization_id uuid not null,
  billing_intent_id uuid not null,
  plan_id uuid not null,
  billing_period_months integer not null,
  amount numeric(10, 2) not null,
  provider_customer_id text not null,
  next_due_date date not null,
  external_reference text not null unique,
  status text not null default 'prepared',
  provider_subscription_id text unique,
  provider_subscription_snapshot jsonb not null default '{}'::jsonb,
  provider_card_credential text,
  card_last4 text,
  credential_attempt_lease_id uuid,
  capture_request_started_at timestamptz,
  capture_attempt_lease_id uuid,
  capture_manual_review_at timestamptz,
  lease_id uuid,
  lease_expires_at timestamptz,
  attempt_window_started_at timestamptz,
  attempt_window_count integer not null default 0,
  provider_request_started_at timestamptz,
  recovering_at timestamptz,
  completed_at timestamptz,
  provider_cancelled_at timestamptz,
  failed_at timestamptz,
  last_error text,
  job_action text not null default 'create',
  job_status text not null default 'waiting',
  job_attempts integer not null default 0,
  job_max_attempts integer not null default 8,
  job_next_attempt_at timestamptz not null default now(),
  job_locked_at timestamptz,
  job_lock_expires_at timestamptz,
  job_locked_by text,
  job_lease_id uuid,
  job_last_attempt_at timestamptz,
  job_dead_lettered_at timestamptz,
  job_last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint billing_card_recurrence_payment_identity_fkey
    foreign key (payment_id, provider_payment_id, organization_id)
    references public.asaas_payments (id, asaas_payment_id, organization_id)
    on update cascade
    on delete cascade,
  constraint billing_card_recurrence_payment_intent_fkey
    foreign key (payment_id, billing_intent_id)
    references public.asaas_payments (id, billing_intent_id)
    on update cascade
    on delete cascade,
  constraint billing_card_recurrence_intent_fkey
    foreign key (billing_intent_id)
    references private.billing_checkout_intents (id)
    on update cascade
    on delete cascade,
  constraint billing_card_recurrence_organization_fkey
    foreign key (organization_id)
    references public.organizations (id)
    on update cascade
    on delete cascade,
  constraint billing_card_recurrence_plan_fkey
    foreign key (plan_id)
    references public.admin_subscription_plans (id)
    on update cascade
    on delete restrict,
  constraint billing_card_recurrence_period_check
    check (billing_period_months in (1, 6, 12)),
  constraint billing_card_recurrence_amount_check
    check (amount > 0),
  constraint billing_card_recurrence_external_reference_check
    check (
      external_reference = (
        'vimob:billing-card-recurrence:' || payment_id::text
      )
    ),
  constraint billing_card_recurrence_status_check
    check (
      status in (
        'prepared',
        'creating',
        'recovering',
        'completed',
        'cancelled',
        'failed'
      )
    ),
  constraint billing_card_recurrence_lease_check
    check (
      (lease_id is null and lease_expires_at is null)
      or (lease_id is not null and lease_expires_at is not null)
    ),
  constraint billing_card_recurrence_attempt_window_check
    check (
      attempt_window_count between 0 and 5
      and (
        attempt_window_started_at is not null
        or attempt_window_count = 0
      )
    ),
  constraint billing_card_recurrence_provider_snapshot_check
    check (jsonb_typeof(provider_subscription_snapshot) = 'object'),
  constraint billing_card_recurrence_sealed_credential_check
    check (
      (
        provider_card_credential is null
        and card_last4 is null
      )
      or (
        provider_card_credential ~ '^v1[.][A-Za-z0-9._-]+$'
        and char_length(provider_card_credential) >= 35
        and char_length(provider_card_credential) <= 4096
        and card_last4 ~ '^[0-9]{4}$'
      )
    ),
  constraint billing_card_recurrence_capture_marker_check
    check (
      (
        capture_request_started_at is null
        and capture_attempt_lease_id is null
      )
      or (
        capture_request_started_at is not null
        and capture_attempt_lease_id is not null
        and capture_request_started_at >= created_at
      )
    ),
  constraint billing_card_recurrence_capture_review_check
    check (
      capture_manual_review_at is null
      or (
        capture_request_started_at is not null
        and capture_manual_review_at >= capture_request_started_at
      )
    ),
  constraint billing_card_recurrence_completion_check
    check (
      (
        status = 'completed'
        and provider_subscription_id is not null
        and completed_at is not null
        and lease_id is null
        and lease_expires_at is null
      )
      or (
        status = 'cancelled'
        and provider_subscription_id is not null
        and completed_at is not null
        and provider_cancelled_at is not null
        and lease_id is null
        and lease_expires_at is null
      )
      or status not in ('completed', 'cancelled')
    ),
  constraint billing_card_recurrence_job_action_check
    check (job_action in ('create', 'cancel')),
  constraint billing_card_recurrence_job_status_check
    check (
      job_status in (
        'waiting',
        'pending',
        'processing',
        'retry',
        'succeeded',
        'cancelled',
        'dead'
      )
    ),
  constraint billing_card_recurrence_job_attempts_check
    check (job_attempts >= 0 and job_max_attempts between 1 and 30),
  constraint billing_card_recurrence_job_lock_check
    check (
      (
        job_status = 'processing'
        and job_locked_at is not null
        and job_lock_expires_at is not null
        and job_locked_by is not null
        and job_lease_id is not null
      )
      or (
        job_status <> 'processing'
        and job_locked_at is null
        and job_lock_expires_at is null
        and job_locked_by is null
        and job_lease_id is null
      )
    ),
  constraint billing_card_recurrence_job_error_code_check
    check (
      job_last_error_code is null
      or job_last_error_code ~ '^[a-z0-9_]{1,80}$'
    ),
  constraint billing_card_recurrence_provider_cancelled_check
    check (provider_cancelled_at is null or status = 'cancelled'),
  constraint billing_card_recurrence_provider_request_timestamp_check
    check (
      provider_request_started_at is null
      or provider_request_started_at >= created_at
    ),
  constraint billing_card_recurrence_timestamps_check
    check (updated_at >= created_at)
);

create index if not exists billing_payment_checkout_capabilities_org_created_idx
  on public.billing_payment_checkout_capabilities (
    organization_id,
    created_at desc
  );

create index if not exists billing_payment_checkout_capabilities_intent_idx
  on public.billing_payment_checkout_capabilities (billing_intent_id)
  where billing_intent_id is not null;

create index if not exists billing_payment_checkout_capabilities_active_expiry_idx
  on public.billing_payment_checkout_capabilities (expires_at)
  where revoked_at is null;

create index if not exists billing_org_card_attempt_limits_expiry_idx
  on private.billing_organization_checkout_card_attempt_limits (expires_at);

create index if not exists billing_ip_card_attempt_limits_expiry_idx
  on private.billing_ip_card_attempt_limits (expires_at);

create index if not exists billing_authenticated_org_card_attempt_limits_expiry_idx
  on private.billing_authenticated_org_card_attempt_limits (expires_at);

create index if not exists billing_payment_card_attempt_limits_expiry_idx
  on private.billing_payment_card_attempt_limits (expires_at);

create index if not exists subscriptions_provider_subscription_org_idx
  on public.subscriptions (provider_subscription_id, organization_id)
  where provider_subscription_id is not null;

create index if not exists billing_card_recurrence_org_created_idx
  on private.billing_card_recurrence_provisions (
    organization_id,
    created_at desc
  );

create index if not exists billing_card_recurrence_recovery_idx
  on private.billing_card_recurrence_provisions (recovering_at, updated_at)
  where status = 'recovering';

create index if not exists billing_card_recurrence_job_claim_idx
  on private.billing_card_recurrence_provisions (
    job_next_attempt_at,
    created_at,
    payment_id
  )
  where job_status in ('pending', 'retry', 'processing');

alter table public.billing_payment_checkout_capabilities enable row level security;
revoke all privileges on table public.billing_payment_checkout_capabilities
  from PUBLIC, anon, authenticated, service_role;
grant select, insert, update, delete
  on table public.billing_payment_checkout_capabilities
  to service_role;

-- Legal acceptance evidence is append-only and is written only by trusted
-- signup/invitation backends. A browser must never be able to forge a version,
-- source, IP address or acceptance timestamp, but an authenticated user keeps
-- read access to their own rows through the existing SELECT policy.
drop policy if exists "users can insert own legal consents"
  on public.legal_consents;
revoke insert, update, delete on table public.legal_consents
  from PUBLIC, anon, authenticated;
revoke all privileges on table public.legal_consents from service_role;
grant select on table public.legal_consents to authenticated;
grant select, insert on table public.legal_consents to service_role;

alter table private.billing_card_recurrence_provisions enable row level security;
revoke all privileges on table private.billing_card_recurrence_provisions
  from PUBLIC, anon, authenticated, service_role;
grant select, insert, update, delete
  on table private.billing_card_recurrence_provisions
  to service_role;

alter table private.billing_organization_checkout_card_attempt_limits
  enable row level security;
revoke all privileges
  on table private.billing_organization_checkout_card_attempt_limits
  from PUBLIC, anon, authenticated, service_role;

alter table private.billing_ip_card_attempt_limits enable row level security;
revoke all privileges on table private.billing_ip_card_attempt_limits
  from PUBLIC, anon, authenticated, service_role;

alter table private.billing_authenticated_org_card_attempt_limits
  enable row level security;
revoke all privileges
  on table private.billing_authenticated_org_card_attempt_limits
  from PUBLIC, anon, authenticated, service_role;

alter table private.billing_payment_card_attempt_limits enable row level security;
revoke all privileges on table private.billing_payment_card_attempt_limits
  from PUBLIC, anon, authenticated, service_role;

create or replace function private.billing_payment_checkout_is_actionable(
  p_status text
)
returns boolean
language sql
immutable
set search_path = ''
as $function$
  select upper(btrim(coalesce(p_status, ''))) in (
    'CREATED',
    'PENDING',
    'OVERDUE',
    'DUNNING_REQUESTED',
    'DUNNING_RECEIVED',
    'BANK_SLIP_CANCELLED',
    'CREDIT_CARD_CAPTURE_REFUSED'
  );
$function$;

create or replace function private.billing_payment_checkout_is_processing(
  p_status text
)
returns boolean
language sql
immutable
set search_path = ''
as $function$
  select upper(btrim(coalesce(p_status, ''))) in (
    'AWAITING_RISK_ANALYSIS',
    'AUTHORIZED',
    'PROCESSING'
  );
$function$;

revoke all on function private.billing_payment_checkout_is_processing(text)
  from PUBLIC, anon, authenticated, service_role;

revoke all on function private.billing_payment_checkout_is_actionable(text)
  from PUBLIC, anon, authenticated, service_role;

create or replace function private.billing_payment_checkout_is_terminal(
  p_status text
)
returns boolean
language sql
immutable
set search_path = ''
as $function$
  select upper(btrim(coalesce(p_status, ''))) in (
    'CANCELED',
    'CANCELLED',
    'DELETED',
    'REFUNDED',
    'REFUND_REQUESTED',
    'REFUND_IN_PROGRESS',
    'PARTIALLY_REFUNDED',
    'RECEIVED_IN_CASH_UNDONE',
    'REPROVED_BY_RISK_ANALYSIS',
    'CHARGEBACK',
    'CHARGEBACK_REQUESTED',
    'CHARGEBACK_DISPUTE',
    'AWAITING_CHARGEBACK_REVERSAL'
  );
$function$;

create or replace function private.billing_payment_checkout_is_paid(
  p_status text
)
returns boolean
language sql
immutable
set search_path = ''
as $function$
  select upper(btrim(coalesce(p_status, ''))) in (
    'CONFIRMED',
    'RECEIVED',
    'RECEIVED_IN_CASH',
    'REFUND_DENIED'
  );
$function$;

revoke all on function private.billing_payment_checkout_is_paid(text)
  from PUBLIC, anon, authenticated, service_role;

create or replace function private.billing_payment_checkout_is_reversal(
  p_status text
)
returns boolean
language sql
immutable
set search_path = ''
as $function$
  select upper(btrim(coalesce(p_status, ''))) in (
    'REFUNDED',
    'REFUND_REQUESTED',
    'REFUND_IN_PROGRESS',
    'PARTIALLY_REFUNDED',
    'RECEIVED_IN_CASH_UNDONE',
    'CHARGEBACK',
    'CHARGEBACK_REQUESTED',
    'CHARGEBACK_DISPUTE',
    'AWAITING_CHARGEBACK_REVERSAL'
  );
$function$;

revoke all on function private.billing_payment_checkout_is_reversal(text)
  from PUBLIC, anon, authenticated, service_role;

-- One semantic ordering is shared by webhook and polling reconciliation.
-- Asaas event timestamps have second precision and events may be delivered
-- non-sequentially. On an equal (or source-contaminated) cursor, a state that
-- removes access must win over paid/actionable state; REFUND_DENIED is only an
-- audit observation because the funds remain settled.
create or replace function private.asaas_payment_status_precedence(
  p_status text
)
returns integer
language sql
immutable
set search_path = ''
as $function$
  select case
    when private.billing_payment_checkout_is_reversal(p_status) then 500
    when upper(btrim(coalesce(p_status, ''))) in (
      'CHARGEBACK',
      'DELETED',
      'CANCELED',
      'CANCELLED',
      'CREDIT_CARD_CAPTURE_REFUSED',
      'REPROVED_BY_RISK_ANALYSIS'
    ) then 450
    when private.billing_payment_checkout_is_paid(p_status) then 300
    when private.billing_payment_checkout_is_processing(p_status) then 200
    when private.billing_payment_checkout_is_actionable(p_status) then 100
    else 50
  end;
$function$;

revoke all on function private.asaas_payment_status_precedence(text)
  from PUBLIC, anon, authenticated, service_role;

-- A tenant can have several invoices. Keep the exact payment that currently
-- explains a suspended access state so a later REFUND_DENIED for invoice A
-- cannot undo a chargeback/refund that belongs to invoice B. This causality is
-- private implementation state and is never exposed through the Data API.
create table if not exists private.billing_organization_access_causes (
  organization_id uuid not null
    references public.organizations (id) on delete cascade,
  provider_payment_id text,
  payment_status text not null,
  observed_at timestamptz not null,
  source text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, provider_payment_id),
  constraint billing_organization_access_causes_payment_id_check
    check (
      btrim(provider_payment_id) = provider_payment_id
      and char_length(provider_payment_id) between 1 and 255
    ),
  constraint billing_organization_access_causes_status_check
    check (
      payment_status = upper(btrim(payment_status))
      and char_length(payment_status) between 1 and 64
    ),
  constraint billing_organization_access_causes_source_check
    check (
      btrim(source) = source
      and char_length(source) between 1 and 80
      and source ~ '^[a-z0-9][a-z0-9_:-]*$'
    )
);

create index if not exists billing_organization_access_causes_org_observed_idx
  on private.billing_organization_access_causes (
    organization_id,
    observed_at desc,
    provider_payment_id
  );

alter table private.billing_organization_access_causes enable row level security;
revoke all privileges on table private.billing_organization_access_causes
  from PUBLIC, anon, authenticated, service_role;

create or replace function private.asaas_organization_status_from_payment(
  p_current_status text,
  p_payment_status text
)
returns text
language sql
immutable
set search_path = ''
as $function$
  select case
    when lower(btrim(coalesce(p_current_status, ''))) in (
      'cancelled',
      'canceled'
    ) then lower(btrim(p_current_status))
    when upper(btrim(coalesce(p_payment_status, ''))) = 'REFUND_DENIED'
      then case
        when lower(btrim(coalesce(p_current_status, ''))) in ('active', 'trial')
          then p_current_status
        else coalesce(nullif(lower(btrim(p_current_status)), ''), 'pending_payment')
      end
    when private.billing_payment_checkout_is_reversal(p_payment_status)
      or upper(btrim(coalesce(p_payment_status, ''))) = 'CHARGEBACK'
      then 'suspended'
    when upper(btrim(coalesce(p_payment_status, ''))) in (
      'OVERDUE',
      'DUNNING_REQUESTED',
      'DUNNING_RECEIVED',
      'CREDIT_CARD_CAPTURE_REFUSED',
      'REPROVED_BY_RISK_ANALYSIS'
    ) then 'overdue'
    when private.billing_payment_checkout_is_paid(p_payment_status)
      then case
        when lower(btrim(coalesce(p_current_status, ''))) in ('active', 'trial')
          then p_current_status
        else coalesce(nullif(lower(btrim(p_current_status)), ''), 'pending_payment')
      end
    when upper(btrim(coalesce(p_payment_status, ''))) in (
      'DELETED',
      'CANCELED',
      'CANCELLED'
    ) then case
      when lower(btrim(coalesce(p_current_status, ''))) in ('active', 'trial')
        then p_current_status
      else 'pending_payment'
    end
    when lower(btrim(coalesce(p_current_status, ''))) in ('active', 'trial')
      then p_current_status
    else 'pending_payment'
  end;
$function$;

revoke all on function private.asaas_organization_status_from_payment(text, text)
  from PUBLIC, anon, authenticated, service_role;

-- A paid observation can grant access only when it proves the same charge that
-- currently explains the restriction. Exact payment identity wins; a rotated
-- provider payment is accepted only when both rows share one immutable billing
-- intent. For historical rows without a recorded cause, the payment must be the
-- latest exact provider observation and the tenant must be pending/overdue.
create or replace function private.reconcile_billing_payment_access_proof(
  p_organization_id uuid,
  p_provider_payment_id text,
  p_current_status text,
  p_proof_status text
)
returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_payment public.asaas_payments%rowtype;
  v_payment_cursor timestamptz;
  v_had_causes boolean := false;
  v_resolved integer := 0;
  v_current_status text := lower(btrim(coalesce(p_current_status, '')));
  v_proof_status text := upper(btrim(coalesce(p_proof_status, '')));
begin
  if p_organization_id is null
     or nullif(btrim(coalesce(p_provider_payment_id, '')), '') is null
     or not private.billing_payment_checkout_is_paid(v_proof_status) then
    return coalesce(nullif(v_current_status, ''), 'pending_payment');
  end if;
  if v_current_status in ('cancelled', 'canceled') then
    return v_current_status;
  end if;

  select payment.*
  into v_payment
  from public.asaas_payments as payment
  where payment.organization_id = p_organization_id
    and payment.asaas_payment_id = btrim(p_provider_payment_id);
  if not found then
    return coalesce(nullif(v_current_status, ''), 'pending_payment');
  end if;

  select exists (
    select 1
    from private.billing_organization_access_causes as cause
    where cause.organization_id = p_organization_id
  ) into v_had_causes;

  if v_had_causes then
    delete from private.billing_organization_access_causes as cause
    using public.asaas_payments as cause_payment
    where cause.organization_id = p_organization_id
      and cause_payment.organization_id = cause.organization_id
      and cause_payment.asaas_payment_id = cause.provider_payment_id
      and (
        cause.provider_payment_id = v_payment.asaas_payment_id
        or (
          v_payment.billing_intent_id is not null
          and cause_payment.billing_intent_id = v_payment.billing_intent_id
        )
      )
      and cause.payment_status in (
        'CREATED',
        'PENDING',
        'AWAITING_RISK_ANALYSIS',
        'AUTHORIZED',
        'PROCESSING',
        'OVERDUE',
        'DUNNING_REQUESTED',
        'DUNNING_RECEIVED',
        'BANK_SLIP_CANCELLED',
        'CREDIT_CARD_CAPTURE_REFUSED',
        'REFUND_REQUESTED',
        'REFUND_IN_PROGRESS'
      );
    get diagnostics v_resolved = row_count;

    if v_resolved = 0 then
      return coalesce(nullif(v_current_status, ''), 'pending_payment');
    end if;

    if exists (
      select 1
      from private.billing_organization_access_causes as cause
      where cause.organization_id = p_organization_id
        and (
          private.billing_payment_checkout_is_reversal(cause.payment_status)
          or cause.payment_status in ('CHARGEBACK', 'REPROVED_BY_RISK_ANALYSIS')
        )
    ) then
      return 'suspended';
    end if;
    if exists (
      select 1
      from private.billing_organization_access_causes as cause
      where cause.organization_id = p_organization_id
        and cause.payment_status in (
          'OVERDUE',
          'DUNNING_REQUESTED',
          'DUNNING_RECEIVED',
          'CREDIT_CARD_CAPTURE_REFUSED'
        )
    ) then
      return 'overdue';
    end if;
    if exists (
      select 1
      from private.billing_organization_access_causes as cause
      where cause.organization_id = p_organization_id
    ) then
      return 'pending_payment';
    end if;

    return 'active';
  end if;

  if v_current_status in ('active', 'trial') then
    return v_current_status;
  end if;

  if v_current_status not in ('pending_payment', 'overdue', 'past_due') then
    return coalesce(nullif(v_current_status, ''), 'pending_payment');
  end if;

  v_payment_cursor := greatest(
    v_payment.last_webhook_event_at,
    v_payment.last_provider_observed_at
  );
  if v_payment_cursor is null then
    return coalesce(nullif(v_current_status, ''), 'pending_payment');
  end if;

  if not exists (
    select 1
    from public.asaas_payments as other_payment
    where other_payment.organization_id = p_organization_id
      and other_payment.id <> v_payment.id
      and (
        greatest(
          other_payment.last_webhook_event_at,
          other_payment.last_provider_observed_at
        ) > v_payment_cursor
        or (
          greatest(
            other_payment.last_webhook_event_at,
            other_payment.last_provider_observed_at
          ) = v_payment_cursor
          and private.asaas_payment_status_precedence(other_payment.status)
            > private.asaas_payment_status_precedence(v_proof_status)
        )
      )
  ) then
    return 'active';
  end if;

  return coalesce(nullif(v_current_status, ''), 'pending_payment');
end
$function$;

revoke all on function private.reconcile_billing_payment_access_proof(
  uuid, text, text, text
) from PUBLIC, anon, authenticated, service_role;

alter table public.asaas_payments
  add column if not exists last_webhook_received_at timestamptz;
alter table public.organizations
  add column if not exists asaas_last_event_received_at timestamptz;

create or replace function private.correct_asaas_naive_event_timestamp(
  p_payload jsonb
)
returns timestamptz
language plpgsql
immutable
set search_path = ''
as $function$
declare
  v_value text := nullif(btrim(coalesce(p_payload ->> 'dateCreated', '')), '');
begin
  if v_value is null
     or v_value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[ T][0-9]{2}:[0-9]{2}:[0-9]{2}$' then
    return null;
  end if;
  return replace(v_value, 'T', ' ')::timestamp
    at time zone 'America/Sao_Paulo';
exception
  when datetime_field_overflow or invalid_datetime_format then
    return null;
end
$function$;

revoke all on function private.correct_asaas_naive_event_timestamp(jsonb)
  from PUBLIC, anon, authenticated, service_role;

-- Repair only rows that are mathematically identifiable as the old bug: the
-- stored instant equals the naive wall clock interpreted as UTC. Explicit
-- offsets and already-correct rows are untouched.
with corrected as (
  select
    event.event_id,
    private.correct_asaas_naive_event_timestamp(event.payload) as corrected_at
  from private.asaas_webhook_events as event
  where private.correct_asaas_naive_event_timestamp(event.payload) is not null
    and event.provider_event_at = (
      replace(event.payload ->> 'dateCreated', 'T', ' ')::timestamp
        at time zone 'UTC'
    )
    and abs(extract(epoch from (
      private.correct_asaas_naive_event_timestamp(event.payload)
      - event.received_at
    ))) <= 604800
)
update public.asaas_payments as payment
set last_webhook_event_at = corrected.corrected_at
from corrected
where payment.last_webhook_event_id = corrected.event_id;

with corrected as (
  select
    event.event_id,
    private.correct_asaas_naive_event_timestamp(event.payload) as corrected_at
  from private.asaas_webhook_events as event
  where private.correct_asaas_naive_event_timestamp(event.payload) is not null
    and event.provider_event_at = (
      replace(event.payload ->> 'dateCreated', 'T', ' ')::timestamp
        at time zone 'UTC'
    )
    and abs(extract(epoch from (
      private.correct_asaas_naive_event_timestamp(event.payload)
      - event.received_at
    ))) <= 604800
)
update public.organizations as organization_row
set asaas_last_event_at = corrected.corrected_at
from corrected
where organization_row.asaas_last_event_id = corrected.event_id;

with corrected as (
  select
    event.event_id,
    private.correct_asaas_naive_event_timestamp(event.payload) as corrected_at
  from private.asaas_webhook_events as event
  where private.correct_asaas_naive_event_timestamp(event.payload) is not null
    and event.provider_event_at = (
      replace(event.payload ->> 'dateCreated', 'T', ' ')::timestamp
        at time zone 'UTC'
    )
    and abs(extract(epoch from (
      private.correct_asaas_naive_event_timestamp(event.payload)
      - event.received_at
    ))) <= 604800
)
update private.asaas_webhook_events as event
set provider_event_at = corrected.corrected_at
from corrected
where event.event_id = corrected.event_id;

update public.asaas_payments as payment
set last_webhook_received_at = event.received_at
from private.asaas_webhook_events as event
where payment.last_webhook_event_id = event.event_id
  and payment.last_webhook_received_at is null;

update public.organizations as organization_row
set asaas_last_event_received_at = event.received_at
from private.asaas_webhook_events as event
where organization_row.asaas_last_event_id = event.event_id
  and organization_row.asaas_last_event_received_at is null;

revoke all on function private.billing_payment_checkout_is_terminal(text)
  from PUBLIC, anon, authenticated, service_role;

create or replace function private.clear_billing_card_recurrence_credential_on_failure()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_status text := upper(btrim(coalesce(new.status, '')));
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  if private.billing_payment_checkout_is_paid(v_status)
     and upper(btrim(coalesce(new.billing_type, ''))) = 'CREDIT_CARD' then
    -- Card data can be sealed before an asynchronous payment settles. The
    -- webhook transaction only makes the durable job visible; no provider
    -- request or decryption happens on the webhook path.
    update private.billing_card_recurrence_provisions as provision
    set
      status = case
        when provision.status = 'failed' then 'prepared'
        else provision.status
      end,
      job_action = 'create',
      job_status = 'pending',
      job_attempts = 0,
      job_next_attempt_at = clock_timestamp(),
      job_locked_at = null,
      job_lock_expires_at = null,
      job_locked_by = null,
      job_lease_id = null,
      job_dead_lettered_at = null,
      job_last_error_code = null,
      updated_at = clock_timestamp()
    where provision.payment_id = new.id
      and provision.provider_payment_id = new.asaas_payment_id
      and provision.status in ('prepared', 'failed')
      and provision.provider_card_credential is not null;
  elsif private.billing_payment_checkout_is_reversal(v_status) then
    -- A completed future subscription is a provider mutation target. Queue
    -- its exact cancellation tuple and let the worker validate GET + DELETE.
    update private.billing_card_recurrence_provisions as provision
    set
      job_action = 'cancel',
      job_status = case
        when provision.job_action = 'cancel'
          and provision.job_status = 'processing'
        then 'processing'
        else 'pending'
      end,
      job_attempts = case
        when provision.job_action = 'cancel' then provision.job_attempts
        else 0
      end,
      job_next_attempt_at = least(
        provision.job_next_attempt_at,
        clock_timestamp()
      ),
      job_locked_at = case
        when provision.job_action = 'cancel'
          and provision.job_status = 'processing'
        then provision.job_locked_at
        else null
      end,
      job_lock_expires_at = case
        when provision.job_action = 'cancel'
          and provision.job_status = 'processing'
        then provision.job_lock_expires_at
        else null
      end,
      job_locked_by = case
        when provision.job_action = 'cancel'
          and provision.job_status = 'processing'
        then provision.job_locked_by
        else null
      end,
      job_lease_id = case
        when provision.job_action = 'cancel'
          and provision.job_status = 'processing'
        then provision.job_lease_id
        else null
      end,
      job_dead_lettered_at = null,
      job_last_error_code = null,
      updated_at = clock_timestamp()
    where provision.payment_id = new.id
      and provision.provider_payment_id = new.asaas_payment_id
      and provision.status = 'completed';

    -- No subscription exists for a prepared/failed job. The same is provably
    -- true when a worker only claimed the create job but has not crossed the
    -- durable provider-request marker. Closing that lease atomically makes a
    -- concurrent mark CAS fail, so no subscription is created after reversal.
    update private.billing_card_recurrence_provisions as provision
    set
      status = 'failed',
      provider_card_credential = null,
      card_last4 = null,
      credential_attempt_lease_id = null,
      capture_request_started_at = null,
      capture_attempt_lease_id = null,
      capture_manual_review_at = null,
      lease_id = null,
      lease_expires_at = null,
      failed_at = coalesce(provision.failed_at, clock_timestamp()),
      last_error = 'payment_not_paid_terminal',
      job_status = 'cancelled',
      job_locked_at = null,
      job_lock_expires_at = null,
      job_locked_by = null,
      job_lease_id = null,
      job_last_error_code = 'payment_not_paid_terminal',
      updated_at = clock_timestamp()
    where provision.payment_id = new.id
      and provision.provider_payment_id = new.asaas_payment_id
      and (
        provision.status in ('prepared', 'failed')
        or (
          provision.status = 'creating'
          and provision.provider_request_started_at is null
        )
      );
  elsif private.billing_payment_checkout_is_terminal(v_status)
     or v_status = 'CREDIT_CARD_CAPTURE_REFUSED' then
    -- A sealed credential belongs to exactly one provider charge attempt.
    -- Clear it on refusal/terminal non-payment before any later retry can use
    -- stale card authorization. Creating/completed rows already consumed it.
    update private.billing_card_recurrence_provisions as provision
    set
      status = 'failed',
      provider_card_credential = null,
      card_last4 = null,
      credential_attempt_lease_id = null,
      capture_request_started_at = null,
      capture_attempt_lease_id = null,
      capture_manual_review_at = null,
      lease_id = null,
      lease_expires_at = null,
      failed_at = coalesce(provision.failed_at, clock_timestamp()),
      last_error = 'payment_not_paid_terminal',
      job_status = 'cancelled',
      job_locked_at = null,
      job_lock_expires_at = null,
      job_locked_by = null,
      job_lease_id = null,
      job_last_error_code = 'payment_not_paid_terminal',
      updated_at = clock_timestamp()
    where provision.payment_id = new.id
      and provision.provider_payment_id = new.asaas_payment_id
      and (
        provision.status in ('prepared', 'failed')
        or (
          provision.status = 'creating'
          and provision.provider_request_started_at is null
        )
      );
  end if;

  return new;
end
$function$;

revoke all on function private.clear_billing_card_recurrence_credential_on_failure()
  from PUBLIC, anon, authenticated, service_role;

drop trigger if exists clear_billing_card_recurrence_credential_on_failure
  on public.asaas_payments;
create trigger clear_billing_card_recurrence_credential_on_failure
after update of status on public.asaas_payments
for each row
execute function private.clear_billing_card_recurrence_credential_on_failure();

-- Resolve a snapshot before issuing a token. Existing capabilities win when
-- their payment identity and amount still match, which freezes the tuple even
-- if the mutable organization/catalog changes later. New capabilities prefer
-- an immutable intent, then one exact provider subscription. Only the one-time
-- migration backfill may use the legacy catalog fallback, and only when the
-- current organization tuple produces the exact provider charge amount.
create or replace function private.resolve_billing_payment_checkout_snapshot(
  p_payment_id uuid,
  p_allow_legacy_catalog boolean
)
returns table (
  snapshot_plan_id uuid,
  snapshot_billing_period_months integer,
  snapshot_amount numeric,
  snapshot_source text
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_payment public.asaas_payments%rowtype;
  v_subscription_count integer;
begin
  select payment.*
  into v_payment
  from public.asaas_payments as payment
  where payment.id = p_payment_id;

  if not found or v_payment.value is null or v_payment.value <= 0 then
    return;
  end if;

  -- A token already issued for this exact ledger identity keeps its frozen
  -- tuple. Token rotation may change the secret, never the historical price.
  return query
  select
    capability.plan_id,
    capability.billing_period_months,
    capability.amount,
    capability.snapshot_source
  from public.billing_payment_checkout_capabilities as capability
  where capability.payment_id = v_payment.id
    and capability.asaas_payment_id = v_payment.asaas_payment_id
    and capability.organization_id = v_payment.organization_id
    and capability.billing_intent_id is not distinct from v_payment.billing_intent_id
    and capability.plan_id is not null
    and capability.billing_period_months in (1, 6, 12)
    and capability.amount > 0
    and abs(capability.amount - v_payment.value) <= 0.01
  limit 1;

  if found then
    return;
  end if;

  if v_payment.billing_intent_id is not null then
    return query
    select
      intent.pending_plan_id,
      intent.billing_period_months,
      intent.amount,
      'intent'::text
    from private.billing_checkout_intents as intent
    where intent.id = v_payment.billing_intent_id
      and intent.organization_id = v_payment.organization_id
      and intent.pending_plan_id is not null
      and intent.billing_period_months in (1, 6, 12)
      and intent.amount > 0
      and abs(v_payment.value - intent.amount) <= 0.01
    limit 1;

    -- An explicit but corrupt/mismatched intent must never fall through to a
    -- mutable organization snapshot.
    return;
  end if;

  if v_payment.asaas_subscription_id is not null then
    select count(*)
    into v_subscription_count
    from public.subscriptions as subscription
    where subscription.organization_id = v_payment.organization_id
      and subscription.provider_subscription_id = v_payment.asaas_subscription_id;

    if v_subscription_count = 1 then
      return query
      select
        subscription.plan_id,
        subscription.billing_period_months,
        v_payment.value,
        'subscription'::text
      from public.subscriptions as subscription
      where subscription.organization_id = v_payment.organization_id
        and subscription.provider_subscription_id = v_payment.asaas_subscription_id
        and subscription.plan_id is not null
        and subscription.billing_period_months in (1, 6, 12)
      limit 1;

      return;
    elsif v_subscription_count > 1 then
      -- Duplicate subscription ownership is ambiguous and fails closed.
      return;
    end if;
  end if;

  if not coalesce(p_allow_legacy_catalog, false) then
    return;
  end if;

  return query
  select
    organization_row.plan_id,
    organization_row.subscription_billing_period_months,
    round(
      plan.price * organization_row.subscription_billing_period_months,
      2
    ),
    'legacy_catalog'::text
  from public.organizations as organization_row
  join public.admin_subscription_plans as plan
    on plan.id = organization_row.plan_id
  where organization_row.id = v_payment.organization_id
    and organization_row.pending_plan_id is null
    and organization_row.plan_id is not null
    and organization_row.subscription_billing_period_months in (1, 6, 12)
    and plan.price > 0
    and abs(
      v_payment.value - round(
        plan.price * organization_row.subscription_billing_period_months,
        2
      )
    ) <= 0.01
  limit 1;
end
$function$;

revoke all on function private.resolve_billing_payment_checkout_snapshot(uuid, boolean)
  from PUBLIC, anon, authenticated, service_role;

-- Backend history/notification queries use this cheap stable predicate in
-- JOIN/WHERE clauses. It validates only the already-frozen capability tuple;
-- it never infers a price from mutable organization or catalog data.
create or replace function private.billing_payment_checkout_is_resolvable(
  p_payment_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.billing_payment_checkout_capabilities as capability
    join public.asaas_payments as payment
      on payment.id = capability.payment_id
      and payment.asaas_payment_id = capability.asaas_payment_id
      and payment.organization_id = capability.organization_id
      and payment.billing_intent_id is not distinct from capability.billing_intent_id
    where capability.payment_id = p_payment_id
      and capability.plan_id is not null
      and capability.billing_period_months in (1, 6, 12)
      and capability.amount > 0
      and payment.value is not null
      and abs(capability.amount - payment.value) <= 0.01
  );
$function$;

revoke all on function private.billing_payment_checkout_is_resolvable(uuid)
  from PUBLIC, anon, authenticated, service_role;

create or replace function private.billing_card_recurrence_external_reference(
  p_payment_id uuid
)
returns text
language sql
immutable
strict
set search_path = ''
as $function$
  select 'vimob:billing-card-recurrence:' || p_payment_id::text;
$function$;

revoke all on function private.billing_card_recurrence_external_reference(uuid)
  from PUBLIC, anon, authenticated, service_role;

create or replace function private.set_billing_payment_checkout_capability_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  new.updated_at := now();
  return new;
end
$function$;

revoke all on function private.set_billing_payment_checkout_capability_updated_at()
  from PUBLIC, anon, authenticated, service_role;

drop trigger if exists set_billing_payment_checkout_capability_updated_at
  on public.billing_payment_checkout_capabilities;
create trigger set_billing_payment_checkout_capability_updated_at
before update on public.billing_payment_checkout_capabilities
for each row
execute function private.set_billing_payment_checkout_capability_updated_at();

create or replace function private.sync_billing_payment_checkout_capability()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_snapshot record;
  v_issue_authorized boolean := false;
begin
  -- This trigger executes during migration backfills before the later cleanup
  -- claim table exists. The permanent tenant tombstone is therefore the
  -- dependency-free fence here; the cleanup claim sets is_active=false before
  -- freezing any provider inventory.
  if not exists (
    select 1
    from public.organizations as organization_row
    where organization_row.id = new.organization_id
      and organization_row.is_active = true
  ) then
    update public.billing_payment_checkout_capabilities
    set
      revoked_at = coalesce(revoked_at, clock_timestamp()),
      attempt_lease_id = null,
      attempt_lease_expires_at = null,
      updated_at = clock_timestamp()
    where payment_id = new.id;
    return new;
  end if;

  if private.billing_payment_checkout_is_actionable(new.status) then
    if tg_op = 'INSERT' then
      v_issue_authorized := true;
    else
      -- Provider polling commonly writes the same status repeatedly. A
      -- capability is an absolute-lived bearer, so ordinary polling and
      -- transitions inside the actionable set must never extend or revive it.
      -- A new lifetime is authorized only when the immutable payment identity
      -- changes or when the payment explicitly enters the actionable set.
      v_issue_authorized :=
        old.asaas_payment_id is distinct from new.asaas_payment_id
        or old.organization_id is distinct from new.organization_id
        or old.billing_intent_id is distinct from new.billing_intent_id
        or not private.billing_payment_checkout_is_actionable(old.status);
    end if;

    if not v_issue_authorized then
      return new;
    end if;

    select snapshot.*
    into v_snapshot
    from private.resolve_billing_payment_checkout_snapshot(
      new.id,
      false
    ) as snapshot
    limit 1;

    if found then
      insert into public.billing_payment_checkout_capabilities (
        payment_id,
        asaas_payment_id,
        organization_id,
        billing_intent_id,
        plan_id,
        billing_period_months,
        amount,
        snapshot_source,
        expires_at
      )
      values (
        new.id,
        new.asaas_payment_id,
        new.organization_id,
        new.billing_intent_id,
        v_snapshot.snapshot_plan_id,
        v_snapshot.snapshot_billing_period_months,
        v_snapshot.snapshot_amount,
        v_snapshot.snapshot_source,
        now() + interval '90 days'
      )
      on conflict (payment_id) do update
      set
        asaas_payment_id = excluded.asaas_payment_id,
        organization_id = excluded.organization_id,
        billing_intent_id = excluded.billing_intent_id,
        -- This conflict path is reachable only after the authorization gate
        -- above. Rotate the bearer and reset its absolute lifetime together.
        checkout_token = encode(extensions.gen_random_bytes(32), 'hex'),
        plan_id = excluded.plan_id,
        billing_period_months = excluded.billing_period_months,
        amount = excluded.amount,
        snapshot_source = excluded.snapshot_source,
        expires_at = now() + interval '90 days',
        revoked_at = null,
        attempt_lease_id = null,
        attempt_lease_expires_at = null,
        attempt_window_started_at = null,
        attempt_window_count = 0;
    else
      -- Legacy/provider rows without an immutable checkout tuple remain in the
      -- ledger, but never receive a public token that would resolve to a 404.
      update public.billing_payment_checkout_capabilities
      set
        revoked_at = coalesce(revoked_at, now()),
        attempt_lease_id = null,
        attempt_lease_expires_at = null
      where payment_id = new.id
        and revoked_at is null;
    end if;
  elsif private.billing_payment_checkout_is_paid(new.status) then
    -- Keep the already-issued link alive briefly so the payer can see the
    -- confirmation and immutable Vimob receipt after the webhook wins a race
    -- against the browser poll. No new capability is issued for paid rows.
    update public.billing_payment_checkout_capabilities
    set
      expires_at = least(expires_at, now() + interval '7 days'),
      attempt_lease_id = null,
      attempt_lease_expires_at = null
    where payment_id = new.id
      and revoked_at is null;
  elsif private.billing_payment_checkout_is_terminal(new.status) then
    update public.billing_payment_checkout_capabilities
    set
      revoked_at = coalesce(revoked_at, now()),
      attempt_lease_id = null,
      attempt_lease_expires_at = null
    where payment_id = new.id
      and revoked_at is null;
  end if;

  return new;
end
$function$;

revoke all on function private.sync_billing_payment_checkout_capability()
  from PUBLIC, anon, authenticated, service_role;

drop trigger if exists sync_billing_payment_checkout_capability
  on public.asaas_payments;
create trigger sync_billing_payment_checkout_capability
after insert or update of
  status,
  asaas_payment_id,
  organization_id,
  billing_intent_id
on public.asaas_payments
for each row
execute function private.sync_billing_payment_checkout_capability();

-- Fail closed if this migration is reapplied over a partially-created table.
-- The normal first deployment has no rows at this point.
update public.billing_payment_checkout_capabilities as capability
set
  revoked_at = coalesce(capability.revoked_at, now()),
  attempt_lease_id = null,
  attempt_lease_expires_at = null
where capability.revoked_at is null
  and not private.billing_payment_checkout_is_resolvable(capability.payment_id);

insert into public.billing_payment_checkout_capabilities (
  payment_id,
  asaas_payment_id,
  organization_id,
  billing_intent_id,
  plan_id,
  billing_period_months,
  amount,
  snapshot_source,
  expires_at
)
select
  payment.id,
  payment.asaas_payment_id,
  payment.organization_id,
  payment.billing_intent_id,
  snapshot.snapshot_plan_id,
  snapshot.snapshot_billing_period_months,
  snapshot.snapshot_amount,
  snapshot.snapshot_source,
  now() + interval '90 days'
from public.asaas_payments as payment
cross join lateral private.resolve_billing_payment_checkout_snapshot(
  payment.id,
  true
) as snapshot
where private.billing_payment_checkout_is_actionable(payment.status)
on conflict (payment_id) do update
set
  asaas_payment_id = excluded.asaas_payment_id,
  organization_id = excluded.organization_id,
  billing_intent_id = excluded.billing_intent_id,
  plan_id = excluded.plan_id,
  billing_period_months = excluded.billing_period_months,
  amount = excluded.amount,
  snapshot_source = excluded.snapshot_source,
  checkout_token = case
    when public.billing_payment_checkout_capabilities.revoked_at is not null
      or public.billing_payment_checkout_capabilities.expires_at <= now()
      or public.billing_payment_checkout_capabilities.asaas_payment_id
        is distinct from excluded.asaas_payment_id
      or public.billing_payment_checkout_capabilities.organization_id
        is distinct from excluded.organization_id
      or public.billing_payment_checkout_capabilities.billing_intent_id
        is distinct from excluded.billing_intent_id
      or public.billing_payment_checkout_capabilities.plan_id
        is distinct from excluded.plan_id
      or public.billing_payment_checkout_capabilities.billing_period_months
        is distinct from excluded.billing_period_months
      or public.billing_payment_checkout_capabilities.amount
        is distinct from excluded.amount
      or public.billing_payment_checkout_capabilities.snapshot_source
        is distinct from excluded.snapshot_source
    then encode(extensions.gen_random_bytes(32), 'hex')
    else public.billing_payment_checkout_capabilities.checkout_token
  end,
  expires_at = now() + interval '90 days',
  revoked_at = null,
  attempt_lease_id = case
    when public.billing_payment_checkout_capabilities.revoked_at is not null
      or public.billing_payment_checkout_capabilities.expires_at <= now()
      or public.billing_payment_checkout_capabilities.asaas_payment_id
        is distinct from excluded.asaas_payment_id
      or public.billing_payment_checkout_capabilities.organization_id
        is distinct from excluded.organization_id
      or public.billing_payment_checkout_capabilities.billing_intent_id
        is distinct from excluded.billing_intent_id
      or public.billing_payment_checkout_capabilities.plan_id
        is distinct from excluded.plan_id
      or public.billing_payment_checkout_capabilities.billing_period_months
        is distinct from excluded.billing_period_months
      or public.billing_payment_checkout_capabilities.amount
        is distinct from excluded.amount
      or public.billing_payment_checkout_capabilities.snapshot_source
        is distinct from excluded.snapshot_source
    then null
    else public.billing_payment_checkout_capabilities.attempt_lease_id
  end,
  attempt_lease_expires_at = case
    when public.billing_payment_checkout_capabilities.revoked_at is not null
      or public.billing_payment_checkout_capabilities.expires_at <= now()
      or public.billing_payment_checkout_capabilities.asaas_payment_id
        is distinct from excluded.asaas_payment_id
      or public.billing_payment_checkout_capabilities.organization_id
        is distinct from excluded.organization_id
      or public.billing_payment_checkout_capabilities.billing_intent_id
        is distinct from excluded.billing_intent_id
      or public.billing_payment_checkout_capabilities.plan_id
        is distinct from excluded.plan_id
      or public.billing_payment_checkout_capabilities.billing_period_months
        is distinct from excluded.billing_period_months
      or public.billing_payment_checkout_capabilities.amount
        is distinct from excluded.amount
      or public.billing_payment_checkout_capabilities.snapshot_source
        is distinct from excluded.snapshot_source
    then null
    else public.billing_payment_checkout_capabilities.attempt_lease_expires_at
  end,
  attempt_window_started_at = case
    when public.billing_payment_checkout_capabilities.revoked_at is not null
      or public.billing_payment_checkout_capabilities.expires_at <= now()
      or public.billing_payment_checkout_capabilities.asaas_payment_id
        is distinct from excluded.asaas_payment_id
      or public.billing_payment_checkout_capabilities.organization_id
        is distinct from excluded.organization_id
      or public.billing_payment_checkout_capabilities.billing_intent_id
        is distinct from excluded.billing_intent_id
      or public.billing_payment_checkout_capabilities.plan_id
        is distinct from excluded.plan_id
      or public.billing_payment_checkout_capabilities.billing_period_months
        is distinct from excluded.billing_period_months
      or public.billing_payment_checkout_capabilities.amount
        is distinct from excluded.amount
      or public.billing_payment_checkout_capabilities.snapshot_source
        is distinct from excluded.snapshot_source
    then null
    else public.billing_payment_checkout_capabilities.attempt_window_started_at
  end,
  attempt_window_count = case
    when public.billing_payment_checkout_capabilities.revoked_at is not null
      or public.billing_payment_checkout_capabilities.expires_at <= now()
      or public.billing_payment_checkout_capabilities.asaas_payment_id
        is distinct from excluded.asaas_payment_id
      or public.billing_payment_checkout_capabilities.organization_id
        is distinct from excluded.organization_id
      or public.billing_payment_checkout_capabilities.billing_intent_id
        is distinct from excluded.billing_intent_id
      or public.billing_payment_checkout_capabilities.plan_id
        is distinct from excluded.plan_id
      or public.billing_payment_checkout_capabilities.billing_period_months
        is distinct from excluded.billing_period_months
      or public.billing_payment_checkout_capabilities.amount
        is distinct from excluded.amount
      or public.billing_payment_checkout_capabilities.snapshot_source
        is distinct from excluded.snapshot_source
    then 0
    else public.billing_payment_checkout_capabilities.attempt_window_count
  end;

create or replace function public.resolve_billing_payment_checkout_capability(
  p_checkout_token text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_checkout_token text := lower(btrim(coalesce(p_checkout_token, '')));
  v_capability public.billing_payment_checkout_capabilities%rowtype;
  v_payment public.asaas_payments%rowtype;
  v_plan_id uuid;
  v_billing_period_months integer;
  v_amount numeric;
  v_card_recurrence_status text;
begin
  if v_checkout_token !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('outcome', 'not_found');
  end if;

  select capability.*
  into v_capability
  from public.billing_payment_checkout_capabilities as capability
  join public.asaas_payments as payment
    on payment.id = capability.payment_id
    and payment.asaas_payment_id = capability.asaas_payment_id
    and payment.organization_id = capability.organization_id
    and payment.billing_intent_id is not distinct from capability.billing_intent_id
  join public.organizations as organization_row
    on organization_row.id = capability.organization_id
    and organization_row.is_active = true
  where capability.checkout_token = v_checkout_token
    and capability.revoked_at is null
    and capability.expires_at > now()
    and (
      private.billing_payment_checkout_is_actionable(payment.status)
      or private.billing_payment_checkout_is_processing(payment.status)
      or private.billing_payment_checkout_is_paid(payment.status)
    )
    and private.billing_payment_checkout_is_resolvable(payment.id)
  limit 1;

  if not found then
    -- Expired, revoked and unknown tokens are intentionally indistinguishable.
    return jsonb_build_object('outcome', 'not_found');
  end if;

  select payment.*
  into v_payment
  from public.asaas_payments as payment
  where payment.id = v_capability.payment_id
    and payment.asaas_payment_id = v_capability.asaas_payment_id
    and payment.organization_id = v_capability.organization_id;

  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;

  -- The public token resolves only the tuple frozen when it was issued. Never
  -- reconstruct a historical price from today's intent, subscription or plan.
  v_plan_id := v_capability.plan_id;
  v_billing_period_months := v_capability.billing_period_months;
  v_amount := v_capability.amount;

  select provision.status
  into v_card_recurrence_status
  from private.billing_card_recurrence_provisions as provision
  where provision.payment_id = v_capability.payment_id
    and provision.provider_payment_id = v_capability.asaas_payment_id
    and provision.organization_id = v_capability.organization_id
    and provision.billing_intent_id is not distinct from v_capability.billing_intent_id
  limit 1;

  if v_plan_id is null
     or v_billing_period_months not in (1, 6, 12)
     or v_amount is null
     or v_amount <= 0 then
    return jsonb_build_object('outcome', 'not_found');
  end if;

  return jsonb_build_object(
    'outcome', 'resolved',
    'organization_id', v_capability.organization_id,
    'payment_id', v_capability.payment_id,
    'billing_intent_id', v_capability.billing_intent_id,
    'plan_id', v_plan_id,
    'billing_period_months', v_billing_period_months,
    'amount', v_amount,
    'snapshot_source', v_capability.snapshot_source,
    'card_recurrence_status', v_card_recurrence_status,
    'bank_slip_registration_cancelled',
      v_payment.bank_slip_registration_cancelled_at is not null,
    'bank_slip_registration_cancelled_at',
      v_payment.bank_slip_registration_cancelled_at,
    'bank_slip_registration_cancelled_due_date',
      v_payment.bank_slip_registration_cancelled_due_date
  );
end
$function$;

revoke all on function public.resolve_billing_payment_checkout_capability(text)
  from PUBLIC, anon, authenticated, service_role;
grant execute on function public.resolve_billing_payment_checkout_capability(text)
  to service_role;

create or replace function public.ensure_billing_payment_checkout_capability(
  p_payment_id uuid,
  p_organization_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_payment public.asaas_payments%rowtype;
  v_capability public.billing_payment_checkout_capabilities%rowtype;
  v_snapshot record;
begin
  if p_payment_id is null or p_organization_id is null then
    return jsonb_build_object('outcome', 'payment_not_found');
  end if;

  -- Discover the immutable provider key without taking a row lock, then join
  -- the global provider-lock order before the row lock. Organization cleanup
  -- takes the same advisory key for every restorable payment, so exactly one
  -- side can cross its irreversible provider boundary.
  select payment.*
  into v_payment
  from public.asaas_payments as payment
  where payment.id = p_payment_id;

  if not found then
    return jsonb_build_object('outcome', 'payment_not_found');
  end if;

  perform private.lock_asaas_billing_resources(
    v_payment.asaas_payment_id,
    null
  );

  select payment.*
  into v_payment
  from public.asaas_payments as payment
  where payment.id = p_payment_id
  for update;

  if not found then
    return jsonb_build_object('outcome', 'payment_not_found');
  end if;

  if private.billing_organization_cleanup_is_active(
    v_payment.organization_id,
    v_payment.asaas_subscription_id
  ) then
    return jsonb_build_object('outcome', 'organization_inactive');
  end if;

  if v_payment.organization_id is distinct from p_organization_id then
    return jsonb_build_object('outcome', 'organization_mismatch');
  end if;

  if not private.billing_payment_checkout_is_actionable(v_payment.status) then
    return jsonb_build_object(
      'outcome', 'payment_not_actionable',
      'organization_id', v_payment.organization_id,
      'payment_id', v_payment.id,
      'billing_intent_id', v_payment.billing_intent_id
    );
  end if;

  select snapshot.*
  into v_snapshot
  from private.resolve_billing_payment_checkout_snapshot(
    v_payment.id,
    false
  ) as snapshot
  limit 1;

  if not found then
    -- This is the explicit, non-secret outcome for legacy payments that lack
    -- an immutable intent or an exact persisted subscription snapshot. Do not
    -- mint a token that the public resolver would necessarily reject.
    update public.billing_payment_checkout_capabilities
    set
      revoked_at = coalesce(revoked_at, now()),
      attempt_lease_id = null,
      attempt_lease_expires_at = null
    where payment_id = v_payment.id
      and revoked_at is null;

    return jsonb_build_object(
      'outcome', 'payment_not_resolvable',
      'organization_id', v_payment.organization_id,
      'payment_id', v_payment.id,
      'billing_intent_id', v_payment.billing_intent_id
    );
  end if;

  insert into public.billing_payment_checkout_capabilities (
    payment_id,
    asaas_payment_id,
    organization_id,
    billing_intent_id,
    plan_id,
    billing_period_months,
    amount,
    snapshot_source,
    expires_at
  )
  values (
    v_payment.id,
    v_payment.asaas_payment_id,
    v_payment.organization_id,
    v_payment.billing_intent_id,
    v_snapshot.snapshot_plan_id,
    v_snapshot.snapshot_billing_period_months,
    v_snapshot.snapshot_amount,
    v_snapshot.snapshot_source,
    now() + interval '90 days'
  )
  on conflict (payment_id) do update
  set
    asaas_payment_id = excluded.asaas_payment_id,
    organization_id = excluded.organization_id,
    billing_intent_id = excluded.billing_intent_id,
    plan_id = excluded.plan_id,
    billing_period_months = excluded.billing_period_months,
    amount = excluded.amount,
    snapshot_source = excluded.snapshot_source,
    checkout_token = case
      when public.billing_payment_checkout_capabilities.revoked_at is not null
        or public.billing_payment_checkout_capabilities.expires_at <= now()
        or public.billing_payment_checkout_capabilities.asaas_payment_id
          is distinct from excluded.asaas_payment_id
        or public.billing_payment_checkout_capabilities.organization_id
          is distinct from excluded.organization_id
        or public.billing_payment_checkout_capabilities.billing_intent_id
          is distinct from excluded.billing_intent_id
        or public.billing_payment_checkout_capabilities.plan_id
          is distinct from excluded.plan_id
        or public.billing_payment_checkout_capabilities.billing_period_months
          is distinct from excluded.billing_period_months
        or public.billing_payment_checkout_capabilities.amount
          is distinct from excluded.amount
        or public.billing_payment_checkout_capabilities.snapshot_source
          is distinct from excluded.snapshot_source
      then encode(extensions.gen_random_bytes(32), 'hex')
      else public.billing_payment_checkout_capabilities.checkout_token
    end,
    expires_at = now() + interval '90 days',
    revoked_at = null,
    attempt_lease_id = case
      when public.billing_payment_checkout_capabilities.revoked_at is not null
        or public.billing_payment_checkout_capabilities.expires_at <= now()
        or public.billing_payment_checkout_capabilities.asaas_payment_id
          is distinct from excluded.asaas_payment_id
        or public.billing_payment_checkout_capabilities.organization_id
          is distinct from excluded.organization_id
        or public.billing_payment_checkout_capabilities.billing_intent_id
          is distinct from excluded.billing_intent_id
        or public.billing_payment_checkout_capabilities.plan_id
          is distinct from excluded.plan_id
        or public.billing_payment_checkout_capabilities.billing_period_months
          is distinct from excluded.billing_period_months
        or public.billing_payment_checkout_capabilities.amount
          is distinct from excluded.amount
        or public.billing_payment_checkout_capabilities.snapshot_source
          is distinct from excluded.snapshot_source
      then null
      else public.billing_payment_checkout_capabilities.attempt_lease_id
    end,
    attempt_lease_expires_at = case
      when public.billing_payment_checkout_capabilities.revoked_at is not null
        or public.billing_payment_checkout_capabilities.expires_at <= now()
        or public.billing_payment_checkout_capabilities.asaas_payment_id
          is distinct from excluded.asaas_payment_id
        or public.billing_payment_checkout_capabilities.organization_id
          is distinct from excluded.organization_id
        or public.billing_payment_checkout_capabilities.billing_intent_id
          is distinct from excluded.billing_intent_id
        or public.billing_payment_checkout_capabilities.plan_id
          is distinct from excluded.plan_id
        or public.billing_payment_checkout_capabilities.billing_period_months
          is distinct from excluded.billing_period_months
        or public.billing_payment_checkout_capabilities.amount
          is distinct from excluded.amount
        or public.billing_payment_checkout_capabilities.snapshot_source
          is distinct from excluded.snapshot_source
      then null
      else public.billing_payment_checkout_capabilities.attempt_lease_expires_at
    end,
    attempt_window_started_at = case
      when public.billing_payment_checkout_capabilities.revoked_at is not null
        or public.billing_payment_checkout_capabilities.expires_at <= now()
        or public.billing_payment_checkout_capabilities.asaas_payment_id
          is distinct from excluded.asaas_payment_id
        or public.billing_payment_checkout_capabilities.organization_id
          is distinct from excluded.organization_id
        or public.billing_payment_checkout_capabilities.billing_intent_id
          is distinct from excluded.billing_intent_id
        or public.billing_payment_checkout_capabilities.plan_id
          is distinct from excluded.plan_id
        or public.billing_payment_checkout_capabilities.billing_period_months
          is distinct from excluded.billing_period_months
        or public.billing_payment_checkout_capabilities.amount
          is distinct from excluded.amount
        or public.billing_payment_checkout_capabilities.snapshot_source
          is distinct from excluded.snapshot_source
      then null
      else public.billing_payment_checkout_capabilities.attempt_window_started_at
    end,
    attempt_window_count = case
      when public.billing_payment_checkout_capabilities.revoked_at is not null
        or public.billing_payment_checkout_capabilities.expires_at <= now()
        or public.billing_payment_checkout_capabilities.asaas_payment_id
          is distinct from excluded.asaas_payment_id
        or public.billing_payment_checkout_capabilities.organization_id
          is distinct from excluded.organization_id
        or public.billing_payment_checkout_capabilities.billing_intent_id
          is distinct from excluded.billing_intent_id
        or public.billing_payment_checkout_capabilities.plan_id
          is distinct from excluded.plan_id
        or public.billing_payment_checkout_capabilities.billing_period_months
          is distinct from excluded.billing_period_months
        or public.billing_payment_checkout_capabilities.amount
          is distinct from excluded.amount
        or public.billing_payment_checkout_capabilities.snapshot_source
          is distinct from excluded.snapshot_source
      then 0
      else public.billing_payment_checkout_capabilities.attempt_window_count
    end
  returning * into v_capability;

  return jsonb_build_object(
    'outcome', 'ready',
    'organization_id', v_capability.organization_id,
    'payment_id', v_capability.payment_id,
    'billing_intent_id', v_capability.billing_intent_id,
    'checkout_token', v_capability.checkout_token,
    'expires_at', v_capability.expires_at
  );
end
$function$;

revoke all on function public.ensure_billing_payment_checkout_capability(uuid, uuid)
  from PUBLIC, anon, authenticated, service_role;
grant execute on function public.ensure_billing_payment_checkout_capability(uuid, uuid)
  to service_role;

create or replace function public.claim_organization_checkout_card_attempt(
  p_organization_id uuid,
  p_checkout_token text,
  p_ip_fingerprint text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_checkout_token text := lower(btrim(coalesce(p_checkout_token, '')));
  v_ip_fingerprint text := lower(btrim(coalesce(p_ip_fingerprint, '')));
  v_capability_hash text;
  v_now timestamptz := clock_timestamp();
  v_capability_lock_key bigint;
  v_ip_lock_key bigint;
  v_capability_limit private.billing_organization_checkout_card_attempt_limits%rowtype;
  v_ip_limit private.billing_ip_card_attempt_limits%rowtype;
  v_capability_retry_after integer := 0;
  v_ip_retry_after integer := 0;
  v_retry_after integer;
begin
  if p_organization_id is null
     or v_checkout_token !~ '^[0-9a-f]{32}$'
     or v_ip_fingerprint !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('outcome', 'invalid_input');
  end if;

  -- Validate and lock the exact public capability before deriving its digest.
  -- The token itself is never persisted in the limiter tables.
  select encode(extensions.digest(capability.checkout_token, 'sha256'), 'hex')
  into v_capability_hash
  from public.organization_checkout_capabilities as capability
  where capability.organization_id = p_organization_id
    and capability.checkout_token = v_checkout_token
  for update;

  if not found then
    return jsonb_build_object('outcome', 'capability_not_found');
  end if;

  -- Acquire both independent dimensions in globally sorted advisory-key order.
  -- This serializes concurrent first inserts as well as updates without a
  -- capability/IP lock inversion.
  v_capability_lock_key := pg_catalog.hashtextextended(
    'vimob:checkout-card:capability:'
      || p_organization_id::text || ':' || v_capability_hash,
    0
  );
  v_ip_lock_key := pg_catalog.hashtextextended(
    'vimob:checkout-card:ip:' || v_ip_fingerprint,
    0
  );

  perform pg_catalog.pg_advisory_xact_lock(
    least(v_capability_lock_key, v_ip_lock_key)
  );
  if v_capability_lock_key is distinct from v_ip_lock_key then
    perform pg_catalog.pg_advisory_xact_lock(
      greatest(v_capability_lock_key, v_ip_lock_key)
    );
  end if;

  -- Opportunistic bounded cleanup keeps abandoned capability/IP buckets from
  -- accumulating indefinitely without requiring a public maintenance API.
  with expired as (
    select limit_row.organization_id, limit_row.capability_hash
    from private.billing_organization_checkout_card_attempt_limits as limit_row
    where limit_row.expires_at <= v_now
    order by limit_row.expires_at
    limit 100
    for update skip locked
  )
  delete from private.billing_organization_checkout_card_attempt_limits as limit_row
  using expired
  where limit_row.organization_id = expired.organization_id
    and limit_row.capability_hash = expired.capability_hash;

  with expired as (
    select limit_row.ip_fingerprint
    from private.billing_ip_card_attempt_limits as limit_row
    where limit_row.expires_at <= v_now
    order by limit_row.expires_at
    limit 100
    for update skip locked
  )
  delete from private.billing_ip_card_attempt_limits as limit_row
  using expired
  where limit_row.ip_fingerprint = expired.ip_fingerprint;

  -- Capability dimension: five attempts per 15 minutes and ten per 24 hours,
  -- independent of the caller IP. Rotating IPs cannot reset these counters.
  insert into private.billing_organization_checkout_card_attempt_limits (
    organization_id,
    capability_hash,
    short_window_started_at,
    short_window_count,
    daily_window_started_at,
    daily_window_count,
    last_attempt_at,
    expires_at
  )
  values (
    p_organization_id,
    v_capability_hash,
    v_now,
    1,
    v_now,
    1,
    v_now,
    v_now + interval '48 hours'
  )
  on conflict (organization_id, capability_hash) do update
  set
    short_window_started_at = case
      when private.billing_organization_checkout_card_attempt_limits.short_window_started_at
        <= v_now - interval '15 minutes'
      then v_now
      else private.billing_organization_checkout_card_attempt_limits.short_window_started_at
    end,
    short_window_count = case
      when private.billing_organization_checkout_card_attempt_limits.short_window_started_at
        <= v_now - interval '15 minutes'
      then 1
      else case
        when private.billing_organization_checkout_card_attempt_limits.short_window_count
          >= 2147483647
        then 2147483647
        else private.billing_organization_checkout_card_attempt_limits.short_window_count + 1
      end
    end,
    daily_window_started_at = case
      when private.billing_organization_checkout_card_attempt_limits.daily_window_started_at
        <= v_now - interval '24 hours'
      then v_now
      else private.billing_organization_checkout_card_attempt_limits.daily_window_started_at
    end,
    daily_window_count = case
      when private.billing_organization_checkout_card_attempt_limits.daily_window_started_at
        <= v_now - interval '24 hours'
      then 1
      else case
        when private.billing_organization_checkout_card_attempt_limits.daily_window_count
          >= 2147483647
        then 2147483647
        else private.billing_organization_checkout_card_attempt_limits.daily_window_count + 1
      end
    end,
    last_attempt_at = v_now,
    expires_at = v_now + interval '48 hours'
  returning * into v_capability_limit;

  -- IP dimension: ten attempts per 15 minutes and thirty per 24 hours,
  -- independent of organization/capability. Rotating public capabilities or
  -- organization ids cannot reset the HMAC-IP counters.
  insert into private.billing_ip_card_attempt_limits (
    ip_fingerprint,
    short_window_started_at,
    short_window_count,
    daily_window_started_at,
    daily_window_count,
    last_attempt_at,
    expires_at
  )
  values (
    v_ip_fingerprint,
    v_now,
    1,
    v_now,
    1,
    v_now,
    v_now + interval '48 hours'
  )
  on conflict (ip_fingerprint) do update
  set
    short_window_started_at = case
      when private.billing_ip_card_attempt_limits.short_window_started_at
        <= v_now - interval '15 minutes'
      then v_now
      else private.billing_ip_card_attempt_limits.short_window_started_at
    end,
    short_window_count = case
      when private.billing_ip_card_attempt_limits.short_window_started_at
        <= v_now - interval '15 minutes'
      then 1
      else case
        when private.billing_ip_card_attempt_limits.short_window_count
          >= 2147483647
        then 2147483647
        else private.billing_ip_card_attempt_limits.short_window_count + 1
      end
    end,
    daily_window_started_at = case
      when private.billing_ip_card_attempt_limits.daily_window_started_at
        <= v_now - interval '24 hours'
      then v_now
      else private.billing_ip_card_attempt_limits.daily_window_started_at
    end,
    daily_window_count = case
      when private.billing_ip_card_attempt_limits.daily_window_started_at
        <= v_now - interval '24 hours'
      then 1
      else case
        when private.billing_ip_card_attempt_limits.daily_window_count
          >= 2147483647
        then 2147483647
        else private.billing_ip_card_attempt_limits.daily_window_count + 1
      end
    end,
    last_attempt_at = v_now,
    expires_at = v_now + interval '48 hours'
  returning * into v_ip_limit;

  if v_capability_limit.daily_window_count > 10 then
    v_capability_retry_after := greatest(
      1,
      ceil(extract(epoch from (
        v_capability_limit.daily_window_started_at + interval '24 hours' - v_now
      )))::integer
    );
  elsif v_capability_limit.short_window_count > 5 then
    v_capability_retry_after := greatest(
      1,
      ceil(extract(epoch from (
        v_capability_limit.short_window_started_at + interval '15 minutes' - v_now
      )))::integer
    );
  end if;

  if v_ip_limit.daily_window_count > 30 then
    v_ip_retry_after := greatest(
      1,
      ceil(extract(epoch from (
        v_ip_limit.daily_window_started_at + interval '24 hours' - v_now
      )))::integer
    );
  elsif v_ip_limit.short_window_count > 10 then
    v_ip_retry_after := greatest(
      1,
      ceil(extract(epoch from (
        v_ip_limit.short_window_started_at + interval '15 minutes' - v_now
      )))::integer
    );
  end if;

  if v_capability_retry_after > 0 or v_ip_retry_after > 0 then
    v_retry_after := greatest(v_capability_retry_after, v_ip_retry_after, 1);
    return jsonb_build_object(
      'outcome', 'rate_limited',
      'limit_scope', case
        when v_capability_retry_after > 0 and v_ip_retry_after > 0
          then 'capability_and_ip'
        when v_capability_retry_after > 0 then 'capability'
        else 'ip'
      end,
      'retry_after_seconds', v_retry_after
    );
  end if;

  return jsonb_build_object(
    'outcome', 'claimed',
    'attempts_remaining', least(
      greatest(0, 5 - v_capability_limit.short_window_count),
      greatest(0, 10 - v_capability_limit.daily_window_count),
      greatest(0, 10 - v_ip_limit.short_window_count),
      greatest(0, 30 - v_ip_limit.daily_window_count)
    )
  );
end
$function$;

revoke all on function public.claim_organization_checkout_card_attempt(uuid, text, text)
  from PUBLIC, anon, authenticated, service_role;
grant execute on function public.claim_organization_checkout_card_attempt(uuid, text, text)
  to service_role;

create or replace function private.increment_billing_ip_card_attempt_limit(
  p_ip_fingerprint text,
  p_now timestamptz
)
returns private.billing_ip_card_attempt_limits
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_limit private.billing_ip_card_attempt_limits%rowtype;
begin
  if p_ip_fingerprint !~ '^[0-9a-f]{64}$' or p_now is null then
    raise exception 'invalid HMAC-IP limiter input' using errcode = '22023';
  end if;

  with expired as (
    select limit_row.ip_fingerprint
    from private.billing_ip_card_attempt_limits as limit_row
    where limit_row.expires_at <= p_now
    order by limit_row.expires_at
    limit 100
    for update skip locked
  )
  delete from private.billing_ip_card_attempt_limits as limit_row
  using expired
  where limit_row.ip_fingerprint = expired.ip_fingerprint;

  insert into private.billing_ip_card_attempt_limits (
    ip_fingerprint,
    short_window_started_at,
    short_window_count,
    daily_window_started_at,
    daily_window_count,
    last_attempt_at,
    expires_at
  )
  values (
    p_ip_fingerprint,
    p_now,
    1,
    p_now,
    1,
    p_now,
    p_now + interval '48 hours'
  )
  on conflict (ip_fingerprint) do update
  set
    short_window_started_at = case
      when private.billing_ip_card_attempt_limits.short_window_started_at
        <= p_now - interval '15 minutes'
      then p_now
      else private.billing_ip_card_attempt_limits.short_window_started_at
    end,
    short_window_count = case
      when private.billing_ip_card_attempt_limits.short_window_started_at
        <= p_now - interval '15 minutes'
      then 1
      else least(
        private.billing_ip_card_attempt_limits.short_window_count::bigint + 1,
        2147483647
      )::integer
    end,
    daily_window_started_at = case
      when private.billing_ip_card_attempt_limits.daily_window_started_at
        <= p_now - interval '24 hours'
      then p_now
      else private.billing_ip_card_attempt_limits.daily_window_started_at
    end,
    daily_window_count = case
      when private.billing_ip_card_attempt_limits.daily_window_started_at
        <= p_now - interval '24 hours'
      then 1
      else least(
        private.billing_ip_card_attempt_limits.daily_window_count::bigint + 1,
        2147483647
      )::integer
    end,
    last_attempt_at = p_now,
    expires_at = p_now + interval '48 hours'
  returning * into v_limit;

  return v_limit;
end
$function$;

revoke all on function private.increment_billing_ip_card_attempt_limit(text, timestamptz)
  from PUBLIC, anon, authenticated, service_role;

create or replace function public.claim_authenticated_organization_card_attempt(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_ip_fingerprint text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_ip_fingerprint text := lower(btrim(coalesce(p_ip_fingerprint, '')));
  v_now timestamptz := clock_timestamp();
  v_actor_lock_key bigint;
  v_ip_lock_key bigint;
  v_authorized boolean := false;
  v_actor_limit private.billing_authenticated_org_card_attempt_limits%rowtype;
  v_ip_limit private.billing_ip_card_attempt_limits%rowtype;
  v_actor_retry_after integer := 0;
  v_ip_retry_after integer := 0;
begin
  if p_organization_id is null
     or p_actor_user_id is null
     or v_ip_fingerprint !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('outcome', 'invalid_input');
  end if;

  -- Recheck the same billing authorization represented by the backend tenant
  -- context. A false user override wins over custom-role permissions, while
  -- active owner/admin members and active super-admins retain direct access.
  select exists (
    select 1
    from public.organizations as organization_row
    join public.users as account
      on account.id = p_actor_user_id
     and coalesce(account.is_active, false) = true
    where organization_row.id = p_organization_id
      and coalesce(organization_row.is_active, false) = true
      and (
        lower(btrim(coalesce(account.role, ''))) = 'super_admin'
        or exists (
          select 1
          from public.organization_members as membership
          where membership.organization_id = p_organization_id
            and membership.user_id = p_actor_user_id
            and coalesce(membership.is_active, false) = true
            and (
              lower(btrim(coalesce(membership.role, ''))) in ('owner', 'admin')
              or exists (
                select 1
                from public.user_permission_overrides as permission_override
                where permission_override.organization_id = p_organization_id
                  and permission_override.user_id = p_actor_user_id
                  and permission_override.permission_key = 'settings_billing'
                  and permission_override.allowed = true
              )
              or (
                not exists (
                  select 1
                  from public.user_permission_overrides as permission_override
                  where permission_override.organization_id = p_organization_id
                    and permission_override.user_id = p_actor_user_id
                    and permission_override.permission_key = 'settings_billing'
                )
                and (
                  exists (
                    select 1
                    from public.user_organization_roles as user_role
                    join public.organization_roles as role_row
                      on role_row.id = user_role.role_id
                     and role_row.organization_id = user_role.organization_id
                     and coalesce(role_row.is_active, false) = true
                    join public.organization_role_permissions as role_permission
                      on role_permission.organization_id = user_role.organization_id
                     and role_permission.role_id = user_role.role_id
                    join public.available_permissions as permission
                      on permission.id = role_permission.permission_id
                    where user_role.organization_id = p_organization_id
                      and user_role.user_id = p_actor_user_id
                      and coalesce(user_role.is_active, false) = true
                      and permission.key = 'settings_billing'
                  )
                  or exists (
                    select 1
                    from public.user_organization_roles as user_role
                    join public.organization_roles as role_row
                      on role_row.id = user_role.organization_role_id
                     and coalesce(role_row.is_active, false) = true
                    join public.organization_role_permissions as role_permission
                      on role_permission.organization_role_id = user_role.organization_role_id
                    where user_role.user_id = p_actor_user_id
                      and coalesce(user_role.is_active, true) = true
                      and role_row.organization_id = p_organization_id
                      and role_permission.permission_key = 'settings_billing'
                  )
                )
              )
            )
        )
      )
  ) into v_authorized;

  if not v_authorized then
    return jsonb_build_object('outcome', 'unauthorized');
  end if;

  v_actor_lock_key := pg_catalog.hashtextextended(
    'vimob:checkout-card:authenticated:'
      || p_organization_id::text || ':' || p_actor_user_id::text,
    0
  );
  v_ip_lock_key := pg_catalog.hashtextextended(
    'vimob:checkout-card:ip:' || v_ip_fingerprint,
    0
  );
  perform pg_catalog.pg_advisory_xact_lock(
    least(v_actor_lock_key, v_ip_lock_key)
  );
  if v_actor_lock_key is distinct from v_ip_lock_key then
    perform pg_catalog.pg_advisory_xact_lock(
      greatest(v_actor_lock_key, v_ip_lock_key)
    );
  end if;

  with expired as (
    select limit_row.organization_id, limit_row.actor_user_id
    from private.billing_authenticated_org_card_attempt_limits as limit_row
    where limit_row.expires_at <= v_now
    order by limit_row.expires_at
    limit 100
    for update skip locked
  )
  delete from private.billing_authenticated_org_card_attempt_limits as limit_row
  using expired
  where limit_row.organization_id = expired.organization_id
    and limit_row.actor_user_id = expired.actor_user_id;

  insert into private.billing_authenticated_org_card_attempt_limits (
    organization_id,
    actor_user_id,
    short_window_started_at,
    short_window_count,
    daily_window_started_at,
    daily_window_count,
    last_attempt_at,
    expires_at
  )
  values (
    p_organization_id,
    p_actor_user_id,
    v_now,
    1,
    v_now,
    1,
    v_now,
    v_now + interval '48 hours'
  )
  on conflict (organization_id, actor_user_id) do update
  set
    short_window_started_at = case
      when private.billing_authenticated_org_card_attempt_limits.short_window_started_at
        <= v_now - interval '15 minutes'
      then v_now
      else private.billing_authenticated_org_card_attempt_limits.short_window_started_at
    end,
    short_window_count = case
      when private.billing_authenticated_org_card_attempt_limits.short_window_started_at
        <= v_now - interval '15 minutes'
      then 1
      else least(
        private.billing_authenticated_org_card_attempt_limits.short_window_count::bigint + 1,
        2147483647
      )::integer
    end,
    daily_window_started_at = case
      when private.billing_authenticated_org_card_attempt_limits.daily_window_started_at
        <= v_now - interval '24 hours'
      then v_now
      else private.billing_authenticated_org_card_attempt_limits.daily_window_started_at
    end,
    daily_window_count = case
      when private.billing_authenticated_org_card_attempt_limits.daily_window_started_at
        <= v_now - interval '24 hours'
      then 1
      else least(
        private.billing_authenticated_org_card_attempt_limits.daily_window_count::bigint + 1,
        2147483647
      )::integer
    end,
    last_attempt_at = v_now,
    expires_at = v_now + interval '48 hours'
  returning * into v_actor_limit;

  v_ip_limit := private.increment_billing_ip_card_attempt_limit(
    v_ip_fingerprint,
    v_now
  );

  if v_actor_limit.daily_window_count > 10 then
    v_actor_retry_after := greatest(
      1,
      ceil(extract(epoch from (
        v_actor_limit.daily_window_started_at + interval '24 hours' - v_now
      )))::integer
    );
  elsif v_actor_limit.short_window_count > 5 then
    v_actor_retry_after := greatest(
      1,
      ceil(extract(epoch from (
        v_actor_limit.short_window_started_at + interval '15 minutes' - v_now
      )))::integer
    );
  end if;
  if v_ip_limit.daily_window_count > 30 then
    v_ip_retry_after := greatest(
      1,
      ceil(extract(epoch from (
        v_ip_limit.daily_window_started_at + interval '24 hours' - v_now
      )))::integer
    );
  elsif v_ip_limit.short_window_count > 10 then
    v_ip_retry_after := greatest(
      1,
      ceil(extract(epoch from (
        v_ip_limit.short_window_started_at + interval '15 minutes' - v_now
      )))::integer
    );
  end if;

  if v_actor_retry_after > 0 or v_ip_retry_after > 0 then
    return jsonb_build_object(
      'outcome', 'rate_limited',
      'limit_scope', case
        when v_actor_retry_after > 0 and v_ip_retry_after > 0
          then 'organization_actor_and_ip'
        when v_actor_retry_after > 0 then 'organization_actor'
        else 'ip'
      end,
      'retry_after_seconds', greatest(
        v_actor_retry_after,
        v_ip_retry_after,
        1
      )
    );
  end if;

  return jsonb_build_object(
    'outcome', 'claimed',
    'attempts_remaining', least(
      greatest(0, 5 - v_actor_limit.short_window_count),
      greatest(0, 10 - v_actor_limit.daily_window_count),
      greatest(0, 10 - v_ip_limit.short_window_count),
      greatest(0, 30 - v_ip_limit.daily_window_count)
    )
  );
end
$function$;

revoke all on function public.claim_authenticated_organization_card_attempt(uuid, uuid, text)
  from PUBLIC, anon, authenticated, service_role;
grant execute on function public.claim_authenticated_organization_card_attempt(uuid, uuid, text)
  to service_role;

create or replace function public.claim_billing_payment_card_attempt_guard(
  p_payment_id uuid,
  p_provider_payment_id text,
  p_ip_fingerprint text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_provider_payment_id text := nullif(btrim(coalesce(p_provider_payment_id, '')), '');
  v_ip_fingerprint text := lower(btrim(coalesce(p_ip_fingerprint, '')));
  v_payment public.asaas_payments%rowtype;
  v_capability public.billing_payment_checkout_capabilities%rowtype;
  v_now timestamptz := clock_timestamp();
  v_payment_lock_key bigint;
  v_ip_lock_key bigint;
  v_payment_limit private.billing_payment_card_attempt_limits%rowtype;
  v_ip_limit private.billing_ip_card_attempt_limits%rowtype;
  v_payment_retry_after integer := 0;
  v_ip_retry_after integer := 0;
begin
  if p_payment_id is null
     or v_provider_payment_id is null
     or char_length(v_provider_payment_id) > 255
     or v_ip_fingerprint !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('outcome', 'invalid_input');
  end if;

  select payment.*
  into v_payment
  from public.asaas_payments as payment
  where payment.id = p_payment_id
    and payment.asaas_payment_id = v_provider_payment_id
  for update;
  if not found then
    return jsonb_build_object('outcome', 'payment_not_found');
  end if;
  if exists (
    select 1
    from public.organizations as organization_row
    where organization_row.id = v_payment.organization_id
      and organization_row.is_active = false
  ) then
    return jsonb_build_object('outcome', 'organization_inactive');
  end if;
  if not private.billing_payment_checkout_is_actionable(v_payment.status) then
    return jsonb_build_object(
      'outcome', 'payment_not_actionable',
      'payment_status', upper(btrim(coalesce(v_payment.status, '')))
    );
  end if;
  if not private.billing_payment_checkout_is_resolvable(v_payment.id) then
    return jsonb_build_object('outcome', 'payment_not_resolvable');
  end if;

  select capability.*
  into v_capability
  from public.billing_payment_checkout_capabilities as capability
  where capability.payment_id = v_payment.id
    and capability.asaas_payment_id = v_payment.asaas_payment_id
    and capability.organization_id = v_payment.organization_id
    and capability.billing_intent_id is not distinct from v_payment.billing_intent_id
  for update;

  v_now := clock_timestamp();
  if not found
     or v_capability.revoked_at is not null
     or v_capability.expires_at <= v_now then
    return jsonb_build_object('outcome', 'capability_not_available');
  end if;

  v_payment_lock_key := pg_catalog.hashtextextended(
    'vimob:checkout-card:payment:' || p_payment_id::text,
    0
  );
  v_ip_lock_key := pg_catalog.hashtextextended(
    'vimob:checkout-card:ip:' || v_ip_fingerprint,
    0
  );
  perform pg_catalog.pg_advisory_xact_lock(
    least(v_payment_lock_key, v_ip_lock_key)
  );
  if v_payment_lock_key is distinct from v_ip_lock_key then
    perform pg_catalog.pg_advisory_xact_lock(
      greatest(v_payment_lock_key, v_ip_lock_key)
    );
  end if;

  with expired as (
    select limit_row.payment_id
    from private.billing_payment_card_attempt_limits as limit_row
    where limit_row.expires_at <= v_now
    order by limit_row.expires_at
    limit 100
    for update skip locked
  )
  delete from private.billing_payment_card_attempt_limits as limit_row
  using expired
  where limit_row.payment_id = expired.payment_id;

  insert into private.billing_payment_card_attempt_limits (
    payment_id,
    organization_id,
    short_window_started_at,
    short_window_count,
    daily_window_started_at,
    daily_window_count,
    last_attempt_at,
    expires_at
  )
  values (
    v_payment.id,
    v_payment.organization_id,
    v_now,
    1,
    v_now,
    1,
    v_now,
    v_now + interval '48 hours'
  )
  on conflict (payment_id) do update
  set
    organization_id = excluded.organization_id,
    short_window_started_at = case
      when private.billing_payment_card_attempt_limits.short_window_started_at
        <= v_now - interval '15 minutes'
      then v_now
      else private.billing_payment_card_attempt_limits.short_window_started_at
    end,
    short_window_count = case
      when private.billing_payment_card_attempt_limits.short_window_started_at
        <= v_now - interval '15 minutes'
      then 1
      else least(
        private.billing_payment_card_attempt_limits.short_window_count::bigint + 1,
        2147483647
      )::integer
    end,
    daily_window_started_at = case
      when private.billing_payment_card_attempt_limits.daily_window_started_at
        <= v_now - interval '24 hours'
      then v_now
      else private.billing_payment_card_attempt_limits.daily_window_started_at
    end,
    daily_window_count = case
      when private.billing_payment_card_attempt_limits.daily_window_started_at
        <= v_now - interval '24 hours'
      then 1
      else least(
        private.billing_payment_card_attempt_limits.daily_window_count::bigint + 1,
        2147483647
      )::integer
    end,
    last_attempt_at = v_now,
    expires_at = v_now + interval '48 hours'
  returning * into v_payment_limit;

  v_ip_limit := private.increment_billing_ip_card_attempt_limit(
    v_ip_fingerprint,
    v_now
  );

  if v_payment_limit.daily_window_count > 10 then
    v_payment_retry_after := greatest(
      1,
      ceil(extract(epoch from (
        v_payment_limit.daily_window_started_at + interval '24 hours' - v_now
      )))::integer
    );
  elsif v_payment_limit.short_window_count > 5 then
    v_payment_retry_after := greatest(
      1,
      ceil(extract(epoch from (
        v_payment_limit.short_window_started_at + interval '15 minutes' - v_now
      )))::integer
    );
  end if;
  if v_ip_limit.daily_window_count > 30 then
    v_ip_retry_after := greatest(
      1,
      ceil(extract(epoch from (
        v_ip_limit.daily_window_started_at + interval '24 hours' - v_now
      )))::integer
    );
  elsif v_ip_limit.short_window_count > 10 then
    v_ip_retry_after := greatest(
      1,
      ceil(extract(epoch from (
        v_ip_limit.short_window_started_at + interval '15 minutes' - v_now
      )))::integer
    );
  end if;

  if v_payment_retry_after > 0 or v_ip_retry_after > 0 then
    return jsonb_build_object(
      'outcome', 'rate_limited',
      'limit_scope', case
        when v_payment_retry_after > 0 and v_ip_retry_after > 0
          then 'payment_and_ip'
        when v_payment_retry_after > 0 then 'payment'
        else 'ip'
      end,
      'retry_after_seconds', greatest(
        v_payment_retry_after,
        v_ip_retry_after,
        1
      )
    );
  end if;

  return jsonb_build_object(
    'outcome', 'claimed',
    'attempts_remaining', least(
      greatest(0, 5 - v_payment_limit.short_window_count),
      greatest(0, 10 - v_payment_limit.daily_window_count),
      greatest(0, 10 - v_ip_limit.short_window_count),
      greatest(0, 30 - v_ip_limit.daily_window_count)
    )
  );
end
$function$;

revoke all on function public.claim_billing_payment_card_attempt_guard(uuid, text, text)
  from PUBLIC, anon, authenticated, service_role;
grant execute on function public.claim_billing_payment_card_attempt_guard(uuid, text, text)
  to service_role;

create or replace function public.claim_billing_payment_checkout_attempt(
  p_payment_id uuid,
  p_provider_payment_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_provider_payment_id text := nullif(btrim(coalesce(p_provider_payment_id, '')), '');
  v_payment public.asaas_payments%rowtype;
  v_capability public.billing_payment_checkout_capabilities%rowtype;
  v_recurrence private.billing_card_recurrence_provisions%rowtype;
  v_subscription_card_update record;
  v_payment_cancellation_intent_id uuid;
  v_payment_cancellation_finalized_at timestamptz;
  v_payment_cancellation_final_outcome text;
  v_payment_cancellation_lease_expires_at timestamptz;
  v_cancellation_intent_id uuid;
  v_cancellation_finalized_at timestamptz;
  v_cancellation_final_outcome text;
  v_cancellation_lease_expires_at timestamptz;
  v_capability_found boolean := false;
  v_now timestamptz;
  v_window_started_at timestamptz;
  v_window_count integer;
  v_lease_id uuid;
  v_lease_expires_at timestamptz;
begin
  if p_payment_id is null
     or v_provider_payment_id is null
     or char_length(v_provider_payment_id) > 255 then
    return jsonb_build_object('outcome', 'invalid_input');
  end if;

  -- Provider-key advisory locks always precede row locks. Cancellation takes
  -- the same payment key and the same payment -> capability -> cancellation
  -- row order, so a card POST and an irreversible subscription DELETE can
  -- never be in flight for the same charge at the same time.
  perform private.lock_asaas_billing_resources(v_provider_payment_id, null);

  -- Lock the payment before the capability. Payment webhooks take the same
  -- order (payment, then capability trigger), preventing a lock inversion.
  select payment.*
  into v_payment
  from public.asaas_payments as payment
  where payment.id = p_payment_id
    and payment.asaas_payment_id = v_provider_payment_id
  for update;

  if not found then
    return jsonb_build_object('outcome', 'payment_not_found');
  end if;

  if private.billing_organization_cleanup_is_active(
    v_payment.organization_id,
    v_payment.asaas_subscription_id
  ) then
    return jsonb_build_object('outcome', 'organization_inactive');
  end if;

  select capability.*
  into v_capability
  from public.billing_payment_checkout_capabilities as capability
  where capability.payment_id = v_payment.id
    and capability.asaas_payment_id = v_payment.asaas_payment_id
    and capability.organization_id = v_payment.organization_id
    and capability.billing_intent_id is not distinct from v_payment.billing_intent_id
  for update;
  v_capability_found := found;

  v_now := clock_timestamp();

  select
    cancellation.intent_id,
    cancellation.finalized_at,
    cancellation.final_outcome,
    cancellation.lease_expires_at
  into
    v_payment_cancellation_intent_id,
    v_payment_cancellation_finalized_at,
    v_payment_cancellation_final_outcome,
    v_payment_cancellation_lease_expires_at
  from private.billing_payment_checkout_cancellations as cancellation
  where cancellation.organization_id = v_payment.organization_id
    and cancellation.intent_id = v_payment.billing_intent_id
    and cancellation.payment_id = v_payment.id
  for update;

  if v_payment_cancellation_intent_id is not null then
    if v_payment_cancellation_finalized_at is not null then
      update public.billing_payment_checkout_capabilities
      set
        revoked_at = coalesce(revoked_at, v_now),
        attempt_lease_id = null,
        attempt_lease_expires_at = null,
        updated_at = v_now
      where payment_id = v_payment.id;

      return jsonb_build_object(
        'outcome', 'payment_not_actionable',
        'payment_status', upper(btrim(coalesce(v_payment.status, ''))),
        'cancellation_outcome', v_payment_cancellation_final_outcome
      );
    end if;

    return jsonb_build_object(
      'outcome', 'busy',
      'busy_reason', 'payment_cancellation',
      'retry_after_seconds', greatest(
        1,
        ceil(extract(epoch from (
          v_payment_cancellation_lease_expires_at - v_now
        )))::integer
      )
    );
  end if;

  select
    cancellation.intent_id,
    cancellation.finalized_at,
    cancellation.final_outcome,
    cancellation.lease_expires_at
  into
    v_cancellation_intent_id,
    v_cancellation_finalized_at,
    v_cancellation_final_outcome,
    v_cancellation_lease_expires_at
  from private.billing_subscription_checkout_cancellations as cancellation
  where cancellation.organization_id = v_payment.organization_id
    and cancellation.intent_id = v_payment.billing_intent_id
  for update;

  if v_cancellation_intent_id is not null then
    if v_cancellation_finalized_at is not null then
      update public.billing_payment_checkout_capabilities
      set
        revoked_at = coalesce(revoked_at, v_now),
        attempt_lease_id = null,
        attempt_lease_expires_at = null,
        updated_at = v_now
      where payment_id = v_payment.id;

      return jsonb_build_object(
        'outcome', 'payment_not_actionable',
        'payment_status', upper(btrim(coalesce(v_payment.status, ''))),
        'cancellation_outcome', v_cancellation_final_outcome
      );
    end if;

    return jsonb_build_object(
      'outcome', 'busy',
      'busy_reason', 'subscription_cancellation',
      'retry_after_seconds', greatest(
        1,
        ceil(extract(epoch from (
          v_cancellation_lease_expires_at - v_now
        )))::integer
      )
    );
  end if;

  select provision.*
  into v_recurrence
  from private.billing_card_recurrence_provisions as provision
  where provision.payment_id = v_payment.id
    and provision.provider_payment_id = v_payment.asaas_payment_id
    and provision.organization_id = v_payment.organization_id
    and provision.billing_intent_id is not distinct from v_payment.billing_intent_id
  for update;

  if found and v_recurrence.capture_request_started_at is not null then
    if v_recurrence.capture_manual_review_at is not null
       or v_recurrence.capture_request_started_at
         <= v_now - interval '15 minutes' then
      update private.billing_card_recurrence_provisions
      set
        status = case
          when status in ('prepared', 'creating', 'recovering') then 'failed'
          else status
        end,
        provider_card_credential = null,
        card_last4 = null,
        credential_attempt_lease_id = null,
        capture_manual_review_at = coalesce(capture_manual_review_at, v_now),
        lease_id = null,
        lease_expires_at = null,
        failed_at = coalesce(failed_at, v_now),
        last_error = 'card_capture_outcome_unknown',
        job_status = case
          when job_status in ('waiting', 'pending', 'retry', 'processing')
            then 'dead'
          else job_status
        end,
        job_locked_at = null,
        job_lock_expires_at = null,
        job_locked_by = null,
        job_lease_id = null,
        job_dead_lettered_at = coalesce(job_dead_lettered_at, v_now),
        job_last_error_code = 'card_capture_outcome_unknown',
        updated_at = v_now
      where payment_id = v_recurrence.payment_id
        and provider_payment_id = v_recurrence.provider_payment_id
        and capture_request_started_at is not null;

      return jsonb_build_object(
        'outcome', 'manual_review',
        'payment_id', v_payment.id,
        'provider_payment_id', v_payment.asaas_payment_id,
        'capture_request_started_at', v_recurrence.capture_request_started_at,
        'reason', 'card_capture_outcome_unknown'
      );
    end if;

    return jsonb_build_object(
      'outcome', 'recover_only',
      'payment_id', v_payment.id,
      'provider_payment_id', v_payment.asaas_payment_id,
      'capture_request_started_at', v_recurrence.capture_request_started_at,
      'manual_review_at', v_recurrence.capture_request_started_at
        + interval '15 minutes',
      'retry_after_seconds', greatest(
        1,
        least(
          60,
          ceil(extract(epoch from (
            v_recurrence.capture_request_started_at
              + interval '15 minutes' - v_now
          )))::integer
        )
      )
    );
  end if;

  select job.*
  into v_subscription_card_update
  from private.billing_subscription_card_update_jobs as job
  where job.payment_id = v_payment.id
    and job.provider_payment_id = v_payment.asaas_payment_id
    and job.organization_id = v_payment.organization_id
    and job.mode = 'settled_payment'
    and (
      job.status in (
        'prepared', 'awaiting_payment', 'pending_update', 'processing', 'retry'
      )
      or job.capture_request_started_at is not null
    )
  order by job.generation desc
  limit 1
  for update;

  if found
     and v_subscription_card_update.capture_request_started_at is not null then
    if private.billing_payment_checkout_is_paid(v_payment.status) then
      return jsonb_build_object(
        'outcome', 'payment_not_actionable',
        'payment_status', upper(btrim(coalesce(v_payment.status, '')))
      );
    end if;

    if v_subscription_card_update.capture_manual_review_at is not null
       or v_subscription_card_update.capture_request_started_at
         <= v_now - interval '15 minutes' then
      update private.billing_subscription_card_update_jobs
      set
        status = 'dead',
        provider_card_credential = null,
        credential_attempt_lease_id = null,
        capture_manual_review_at = coalesce(capture_manual_review_at, v_now),
        manual_review_at = coalesce(manual_review_at, v_now),
        lease_id = null,
        lease_owner = null,
        lease_started_at = null,
        lease_expires_at = null,
        last_error_code = 'card_capture_outcome_unknown',
        dead_lettered_at = coalesce(dead_lettered_at, v_now),
        updated_at = v_now
      where id = v_subscription_card_update.id
        and capture_request_started_at is not null;

      update public.billing_payment_checkout_capabilities
      set
        revoked_at = coalesce(revoked_at, v_now),
        attempt_lease_id = null,
        attempt_lease_expires_at = null,
        updated_at = v_now
      where payment_id = v_payment.id;

      return jsonb_build_object(
        'outcome', 'manual_review',
        'payment_id', v_payment.id,
        'provider_payment_id', v_payment.asaas_payment_id,
        'card_update_job_id', v_subscription_card_update.id,
        'capture_request_started_at',
          v_subscription_card_update.capture_request_started_at,
        'reason', 'card_capture_outcome_unknown'
      );
    end if;

    return jsonb_build_object(
      'outcome', 'recover_only',
      'payment_id', v_payment.id,
      'provider_payment_id', v_payment.asaas_payment_id,
      'card_update_job_id', v_subscription_card_update.id,
      'capture_request_started_at',
        v_subscription_card_update.capture_request_started_at,
      'manual_review_at',
        v_subscription_card_update.capture_request_started_at
          + interval '15 minutes',
      'retry_after_seconds', greatest(
        1,
        least(
          60,
          ceil(extract(epoch from (
            v_subscription_card_update.capture_request_started_at
              + interval '15 minutes' - v_now
          )))::integer
        )
      )
    );
  end if;

  if not private.billing_payment_checkout_is_actionable(v_payment.status) then
    return jsonb_build_object(
      'outcome', 'payment_not_actionable',
      'payment_status', upper(btrim(coalesce(v_payment.status, '')))
    );
  end if;

  if not private.billing_payment_checkout_is_resolvable(v_payment.id) then
    return jsonb_build_object('outcome', 'payment_not_resolvable');
  end if;

  if not v_capability_found
     or v_capability.revoked_at is not null
     or v_capability.expires_at <= v_now then
    return jsonb_build_object('outcome', 'capability_not_available');
  end if;

  if v_capability.attempt_lease_id is not null
     and v_capability.attempt_lease_expires_at > v_now then
    return jsonb_build_object(
      'outcome', 'busy',
      'retry_after_seconds', greatest(
        1,
        ceil(extract(epoch from (
          v_capability.attempt_lease_expires_at - v_now
        )))::integer
      )
    );
  end if;

  -- A sealed recurrence token is not proof that payWithCreditCard started.
  -- Once its owning attempt lease expired, shred that unmarked token so the
  -- next exact lease can tokenize and try once. A marked token is handled by
  -- the recover_only branch above and can never authorize a second POST.
  if v_recurrence.payment_id is not null
     and v_recurrence.provider_card_credential is not null
     and v_recurrence.capture_request_started_at is null then
    update private.billing_card_recurrence_provisions
    set
      provider_card_credential = null,
      card_last4 = null,
      credential_attempt_lease_id = null,
      updated_at = v_now
    where payment_id = v_recurrence.payment_id
      and provider_payment_id = v_recurrence.provider_payment_id
      and capture_request_started_at is null;
  end if;

  if v_subscription_card_update.id is not null
     and v_subscription_card_update.provider_card_credential is not null
     and v_subscription_card_update.capture_request_started_at is null then
    update private.billing_subscription_card_update_jobs
    set
      status = 'cancelled',
      provider_card_credential = null,
      card_last4 = null,
      credential_attempt_lease_id = null,
      last_error_code = 'capture_not_started_before_lease_expiry',
      cancelled_at = v_now,
      updated_at = v_now
    where id = v_subscription_card_update.id
      and status in ('awaiting_payment', 'pending_update', 'retry')
      and capture_request_started_at is null;
  end if;

  if v_capability.attempt_window_started_at is null
     or v_capability.attempt_window_started_at <= v_now - interval '15 minutes' then
    v_window_started_at := v_now;
    v_window_count := 0;
  else
    v_window_started_at := v_capability.attempt_window_started_at;
    v_window_count := v_capability.attempt_window_count;
  end if;

  if v_window_count >= 5 then
    return jsonb_build_object(
      'outcome', 'rate_limited',
      'retry_after_seconds', greatest(
        1,
        ceil(extract(epoch from (
          v_window_started_at + interval '15 minutes' - v_now
        )))::integer
      )
    );
  end if;

  v_lease_id := extensions.gen_random_uuid();
  -- The Edge critical path can spend up to 75 seconds tokenizing and another
  -- 75 seconds charging before the final CAS. Keep a full five-minute lease
  -- so the capability cannot be reclaimed while either provider call runs.
  v_lease_expires_at := v_now + interval '300 seconds';

  update public.billing_payment_checkout_capabilities
  set
    attempt_lease_id = v_lease_id,
    attempt_lease_expires_at = v_lease_expires_at,
    attempt_window_started_at = v_window_started_at,
    attempt_window_count = v_window_count + 1
  where payment_id = v_capability.payment_id;

  return jsonb_build_object(
    'outcome', 'claimed',
    'payment_id', v_capability.payment_id,
    'lease_id', v_lease_id,
    'lease_expires_at', v_lease_expires_at,
    'attempts_remaining', 5 - (v_window_count + 1)
  );
end
$function$;

revoke all on function public.claim_billing_payment_checkout_attempt(uuid, text)
  from PUBLIC, anon, authenticated, service_role;
grant execute on function public.claim_billing_payment_checkout_attempt(uuid, text)
  to service_role;

create or replace function public.release_billing_payment_checkout_attempt(
  p_payment_id uuid,
  p_provider_payment_id text,
  p_lease_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_provider_payment_id text := nullif(btrim(coalesce(p_provider_payment_id, '')), '');
  v_released_payment_id uuid;
begin
  if p_payment_id is null
     or p_lease_id is null
     or v_provider_payment_id is null
     or char_length(v_provider_payment_id) > 255 then
    return jsonb_build_object('outcome', 'invalid_input');
  end if;

  -- The exact lease id prevents a late request from releasing a newer lease.
  update public.billing_payment_checkout_capabilities as capability
  set
    attempt_lease_id = null,
    attempt_lease_expires_at = null
  where capability.payment_id = p_payment_id
    and capability.asaas_payment_id = v_provider_payment_id
    and capability.attempt_lease_id = p_lease_id
  returning capability.payment_id into v_released_payment_id;

  if not found then
    return jsonb_build_object('outcome', 'lease_not_found');
  end if;

  return jsonb_build_object(
    'outcome', 'released',
    'payment_id', v_released_payment_id
  );
end
$function$;

revoke all on function public.release_billing_payment_checkout_attempt(uuid, text, uuid)
  from PUBLIC, anon, authenticated, service_role;
grant execute on function public.release_billing_payment_checkout_attempt(uuid, text, uuid)
  to service_role;

create or replace function public.prepare_billing_card_recurrence(
  p_payment_id uuid,
  p_provider_payment_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_provider_payment_id text := nullif(btrim(coalesce(p_provider_payment_id, '')), '');
  v_payment public.asaas_payments%rowtype;
  v_intent private.billing_checkout_intents%rowtype;
  v_provision private.billing_card_recurrence_provisions%rowtype;
  v_has_provision boolean := false;
  v_external_reference text;
  v_next_due_date date;
begin
  if p_payment_id is null
     or v_provider_payment_id is null
     or char_length(v_provider_payment_id) > 255 then
    return jsonb_build_object('outcome', 'invalid_input');
  end if;

  -- Every recurrence RPC takes locks in this order: payment, an existing
  -- provision when present, immutable intent, organization, public
  -- subscription. A first prepare simply has no provision row to lock yet.
  select payment.*
  into v_payment
  from public.asaas_payments as payment
  where payment.id = p_payment_id
    and payment.asaas_payment_id = v_provider_payment_id
  for update;

  if not found then
    return jsonb_build_object('outcome', 'payment_not_found');
  end if;

  if not (
    private.billing_payment_checkout_is_actionable(v_payment.status)
    or private.billing_payment_checkout_is_paid(v_payment.status)
  ) then
    return jsonb_build_object(
      'outcome', 'payment_not_eligible',
      'payment_status', upper(btrim(coalesce(v_payment.status, '')))
    );
  end if;

  if v_payment.asaas_subscription_id is not null then
    return jsonb_build_object('outcome', 'payment_already_recurring');
  end if;

  if v_payment.billing_intent_id is null
     or nullif(btrim(coalesce(v_payment.asaas_customer_id, '')), '') is null then
    return jsonb_build_object('outcome', 'immutable_tuple_unavailable');
  end if;

  -- Preserve the global recurrence lock order even on an idempotent prepare:
  -- payment, existing provision (when present), then immutable intent.
  select provision.*
  into v_provision
  from private.billing_card_recurrence_provisions as provision
  where provision.payment_id = v_payment.id
  for update;

  v_has_provision := found;
  if v_has_provision and (
    v_provision.provider_payment_id is distinct from v_payment.asaas_payment_id
    or v_provision.organization_id is distinct from v_payment.organization_id
    or v_provision.billing_intent_id is distinct from v_payment.billing_intent_id
  ) then
    return jsonb_build_object('outcome', 'immutable_tuple_mismatch');
  end if;

  select intent.*
  into v_intent
  from private.billing_checkout_intents as intent
  where intent.id = v_payment.billing_intent_id
    and intent.organization_id = v_payment.organization_id
  for update;

  if not found
     or v_intent.provider_payment_id is distinct from v_payment.asaas_payment_id
     or v_intent.provider_customer_id is distinct from v_payment.asaas_customer_id
     or v_intent.pending_plan_id is null
     or v_intent.billing_period_months not in (1, 6, 12)
     or v_intent.amount is null
     or v_intent.amount <= 0
     or v_payment.value is null
     or abs(v_intent.amount - v_payment.value) > 0.01 then
    return jsonb_build_object('outcome', 'immutable_tuple_mismatch');
  end if;

  v_external_reference :=
    private.billing_card_recurrence_external_reference(v_payment.id);
  v_next_due_date := (
    greatest(
      current_date,
      coalesce(v_payment.due_date, current_date)
    ) + make_interval(months => v_intent.billing_period_months)
  )::date;

  if not v_has_provision then
    insert into private.billing_card_recurrence_provisions (
      payment_id,
      provider_payment_id,
      organization_id,
      billing_intent_id,
      plan_id,
      billing_period_months,
      amount,
      provider_customer_id,
      next_due_date,
      external_reference
    )
    values (
      v_payment.id,
      v_payment.asaas_payment_id,
      v_payment.organization_id,
      v_payment.billing_intent_id,
      v_intent.pending_plan_id,
      v_intent.billing_period_months,
      v_intent.amount,
      v_payment.asaas_customer_id,
      v_next_due_date,
      v_external_reference
    )
    on conflict (payment_id) do nothing;

    select provision.*
    into v_provision
    from private.billing_card_recurrence_provisions as provision
    where provision.payment_id = v_payment.id
    for update;
  end if;

  if not found
     or v_provision.provider_payment_id is distinct from v_payment.asaas_payment_id
     or v_provision.organization_id is distinct from v_payment.organization_id
     or v_provision.billing_intent_id is distinct from v_payment.billing_intent_id
     or v_provision.plan_id is distinct from v_intent.pending_plan_id
     or v_provision.billing_period_months is distinct from v_intent.billing_period_months
     or abs(v_provision.amount - v_intent.amount) > 0.01
     or v_provision.provider_customer_id is distinct from v_payment.asaas_customer_id
     or v_provision.external_reference is distinct from v_external_reference then
    return jsonb_build_object('outcome', 'immutable_tuple_mismatch');
  end if;

  return jsonb_build_object(
    'outcome', case
      when v_provision.status = 'completed' then 'already_completed'
      else 'prepared'
    end,
    'payment_id', v_provision.payment_id,
    'status', v_provision.status,
    'credential_stored', v_provision.provider_card_credential is not null,
    'capture_request_started', v_provision.capture_request_started_at is not null,
    'capture_request_started_at', v_provision.capture_request_started_at,
    'external_reference', v_provision.external_reference,
    'provider_subscription_id', v_provision.provider_subscription_id
  );
end
$function$;

revoke all on function public.prepare_billing_card_recurrence(uuid, text)
  from PUBLIC, anon, authenticated, service_role;
grant execute on function public.prepare_billing_card_recurrence(uuid, text)
  to service_role;

create or replace function public.store_billing_card_recurrence_credential(
  p_payment_id uuid,
  p_provider_payment_id text,
  p_attempt_lease_id uuid,
  p_credential_ciphertext text,
  p_card_last4 text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_provider_payment_id text := nullif(btrim(coalesce(p_provider_payment_id, '')), '');
  v_credential text := nullif(btrim(coalesce(p_credential_ciphertext, '')), '');
  v_card_last4 text := btrim(coalesce(p_card_last4, ''));
  v_payment public.asaas_payments%rowtype;
  v_org public.organizations%rowtype;
  v_capability public.billing_payment_checkout_capabilities%rowtype;
  v_provision private.billing_card_recurrence_provisions%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  if p_payment_id is null
     or v_provider_payment_id is null
     or char_length(v_provider_payment_id) > 255
     or v_credential is null
     or char_length(v_credential) < 35
     or char_length(v_credential) > 4096
     or v_credential !~ '^v1[.][A-Za-z0-9._-]+$'
     or v_card_last4 !~ '^[0-9]{4}$' then
    return jsonb_build_object('outcome', 'invalid_input');
  end if;

  perform private.lock_asaas_billing_resources(v_provider_payment_id, null);

  -- The ciphertext is an Edge-owned AES-GCM envelope whose AAD binds both the
  -- canonical local payment UUID and immutable provider payment id. SQL never
  -- receives token, remoteIp, PAN or CVV.
  select payment.*
  into v_payment
  from public.asaas_payments as payment
  where payment.id = p_payment_id
    and payment.asaas_payment_id = v_provider_payment_id
  for update;

  if not found then
    return jsonb_build_object('outcome', 'payment_not_found');
  end if;

  select organization.*
  into v_org
  from public.organizations as organization
  where organization.id = v_payment.organization_id
  for update;
  if not found then
    return jsonb_build_object('outcome', 'organization_not_found');
  end if;
  if not v_org.is_active then
    return jsonb_build_object('outcome', 'organization_inactive');
  end if;

  select capability.*
  into v_capability
  from public.billing_payment_checkout_capabilities as capability
  where capability.payment_id = v_payment.id
    and capability.asaas_payment_id = v_payment.asaas_payment_id
    and capability.organization_id = v_payment.organization_id
    and capability.billing_intent_id is not distinct from v_payment.billing_intent_id
  for update;

  if not private.billing_payment_checkout_is_paid(v_payment.status)
     and (
       p_attempt_lease_id is null
       or v_capability.payment_id is null
       or v_capability.revoked_at is not null
       or v_capability.expires_at <= v_now
       or v_capability.attempt_lease_id is distinct from p_attempt_lease_id
       or v_capability.attempt_lease_expires_at <= v_now
     ) then
    return jsonb_build_object('outcome', 'attempt_lease_not_found');
  end if;
  if not (
    private.billing_payment_checkout_is_actionable(v_payment.status)
    or private.billing_payment_checkout_is_processing(v_payment.status)
    or private.billing_payment_checkout_is_paid(v_payment.status)
  ) then
    return jsonb_build_object(
      'outcome', 'payment_not_eligible',
      'payment_status', upper(btrim(coalesce(v_payment.status, '')))
    );
  end if;

  select provision.*
  into v_provision
  from private.billing_card_recurrence_provisions as provision
  where provision.payment_id = v_payment.id
    and provision.provider_payment_id = v_payment.asaas_payment_id
    and provision.organization_id = v_payment.organization_id
    and provision.billing_intent_id is not distinct from v_payment.billing_intent_id
  for update;

  if not found then
    return jsonb_build_object('outcome', 'not_prepared');
  end if;
  if v_provision.status = 'completed' then
    return jsonb_build_object('outcome', 'already_completed');
  end if;
  if v_provision.status not in ('prepared', 'failed')
     or v_provision.lease_id is not null
     or v_provision.lease_expires_at is not null then
    return jsonb_build_object('outcome', 'state_not_storable');
  end if;

  if v_provision.provider_card_credential is not null then
    if v_provision.provider_card_credential = v_credential
       and v_provision.card_last4 = v_card_last4
       and v_provision.credential_attempt_lease_id
         is not distinct from p_attempt_lease_id then
      return jsonb_build_object(
        'outcome', 'already_stored',
        'payment_id', v_provision.payment_id
      );
    end if;
    return jsonb_build_object('outcome', 'credential_conflict');
  end if;

  update private.billing_card_recurrence_provisions as provision
  set
    status = 'prepared',
    provider_card_credential = v_credential,
    card_last4 = v_card_last4,
    credential_attempt_lease_id = p_attempt_lease_id,
    job_action = 'create',
    job_status = case
      when private.billing_payment_checkout_is_paid(v_payment.status)
        then 'pending'
      else 'waiting'
    end,
    job_attempts = 0,
    job_next_attempt_at = v_now,
    job_locked_at = null,
    job_lock_expires_at = null,
    job_locked_by = null,
    job_lease_id = null,
    job_dead_lettered_at = null,
    job_last_error_code = null,
    failed_at = null,
    last_error = null,
    updated_at = v_now
  where provision.payment_id = v_provision.payment_id
    and provision.provider_payment_id = v_provision.provider_payment_id
    and provision.status in ('prepared', 'failed')
    and provision.provider_card_credential is null
    and provision.lease_id is null
    and provision.lease_expires_at is null;

  if not found then
    return jsonb_build_object('outcome', 'state_changed');
  end if;

  return jsonb_build_object(
    'outcome', 'stored',
    'payment_id', v_provision.payment_id,
    'card_last4', v_card_last4
  );
end
$function$;

revoke all on function public.store_billing_card_recurrence_credential(uuid, text, uuid, text, text)
  from PUBLIC, anon, authenticated, service_role;
grant execute on function public.store_billing_card_recurrence_credential(uuid, text, uuid, text, text)
  to service_role;

-- Compatibility for an already-paid charge: no capture POST remains to be
-- authorized, so a payment-attempt lease is neither available nor required.
-- Actionable/processing payments must use the five-argument exact-lease RPC.
create or replace function public.store_billing_card_recurrence_credential(
  p_payment_id uuid,
  p_provider_payment_id text,
  p_credential_ciphertext text,
  p_card_last4 text
)
returns jsonb
language sql
security definer
set search_path = ''
as $function$
  select public.store_billing_card_recurrence_credential(
    p_payment_id,
    p_provider_payment_id,
    null::uuid,
    p_credential_ciphertext,
    p_card_last4
  );
$function$;

revoke all on function public.store_billing_card_recurrence_credential(uuid, text, text, text) from PUBLIC, anon, authenticated, service_role;
grant execute on function public.store_billing_card_recurrence_credential(uuid, text, text, text) to service_role;

-- This CAS is the durable boundary immediately before the first byte of
-- POST /payments/{id}/payWithCreditCard. A sealed recurrence credential alone
-- is never treated as evidence that the payment mutation started.
create or replace function public.mark_billing_card_capture_request_started(
  p_payment_id uuid,
  p_provider_payment_id text,
  p_attempt_lease_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_provider_payment_id text := nullif(
    btrim(coalesce(p_provider_payment_id, '')),
    ''
  );
  v_payment public.asaas_payments%rowtype;
  v_org public.organizations%rowtype;
  v_capability public.billing_payment_checkout_capabilities%rowtype;
  v_provision private.billing_card_recurrence_provisions%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  if p_payment_id is null
     or v_provider_payment_id is null
     or char_length(v_provider_payment_id) > 255
     or p_attempt_lease_id is null then
    return jsonb_build_object('outcome', 'invalid_input');
  end if;

  perform private.lock_asaas_billing_resources(v_provider_payment_id, null);

  select payment.*
  into v_payment
  from public.asaas_payments as payment
  where payment.id = p_payment_id
    and payment.asaas_payment_id = v_provider_payment_id
  for update;
  if not found then
    return jsonb_build_object('outcome', 'payment_not_found');
  end if;

  select capability.*
  into v_capability
  from public.billing_payment_checkout_capabilities as capability
  where capability.payment_id = v_payment.id
    and capability.asaas_payment_id = v_payment.asaas_payment_id
    and capability.organization_id = v_payment.organization_id
    and capability.billing_intent_id is not distinct from v_payment.billing_intent_id
  for update;
  if not found
     or v_capability.revoked_at is not null
     or v_capability.expires_at <= v_now
     or v_capability.attempt_lease_id is distinct from p_attempt_lease_id
     or v_capability.attempt_lease_expires_at <= v_now then
    return jsonb_build_object('outcome', 'attempt_lease_not_found');
  end if;

  select provision.*
  into v_provision
  from private.billing_card_recurrence_provisions as provision
  where provision.payment_id = v_payment.id
    and provision.provider_payment_id = v_payment.asaas_payment_id
    and provision.organization_id = v_payment.organization_id
    and provision.billing_intent_id is not distinct from v_payment.billing_intent_id
  for update;
  if not found then
    return jsonb_build_object('outcome', 'not_prepared');
  end if;

  -- Hold the tenant tombstone through the durable capture marker. Cleanup can
  -- therefore never deactivate the organization between this check and the
  -- worker's authorization to call payWithCreditCard.
  select organization.*
  into v_org
  from public.organizations as organization
  where organization.id = v_payment.organization_id
  for update;
  if not found then
    return jsonb_build_object('outcome', 'organization_not_found');
  end if;
  if not v_org.is_active then
    return jsonb_build_object('outcome', 'organization_inactive');
  end if;

  if v_provision.capture_request_started_at is not null then
    return jsonb_build_object(
      'outcome', case
        when v_provision.capture_attempt_lease_id = p_attempt_lease_id
          then 'already_started'
        else 'recover_only'
      end,
      'payment_id', v_provision.payment_id,
      'capture_request_started_at', v_provision.capture_request_started_at
    );
  end if;
  if v_provision.provider_card_credential is null
     or v_provision.card_last4 is null
     or v_provision.credential_attempt_lease_id
       is distinct from p_attempt_lease_id then
    return jsonb_build_object('outcome', 'credential_not_stored');
  end if;
  if not private.billing_payment_checkout_is_actionable(v_payment.status) then
    return jsonb_build_object(
      'outcome', 'payment_not_actionable',
      'payment_status', upper(btrim(coalesce(v_payment.status, '')))
    );
  end if;

  update private.billing_card_recurrence_provisions as provision
  set
    capture_request_started_at = v_now,
    capture_attempt_lease_id = p_attempt_lease_id,
    updated_at = v_now
  where provision.payment_id = v_provision.payment_id
    and provision.provider_payment_id = v_provision.provider_payment_id
    and provision.capture_request_started_at is null
    and provision.provider_card_credential is not null
    and provision.credential_attempt_lease_id = p_attempt_lease_id;

  if not found then
    return jsonb_build_object('outcome', 'state_changed');
  end if;

  return jsonb_build_object(
    'outcome', 'started',
    'payment_id', v_provision.payment_id,
    'provider_payment_id', v_provision.provider_payment_id,
    'capture_request_started_at', v_now
  );
end
$function$;

revoke all on function public.mark_billing_card_capture_request_started(
  uuid, text, uuid
) from PUBLIC, anon, authenticated, service_role;
grant execute on function public.mark_billing_card_capture_request_started(
  uuid, text, uuid
) to service_role;

create or replace function public.claim_billing_card_recurrence(
  p_payment_id uuid,
  p_provider_payment_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_provider_payment_id text := nullif(btrim(coalesce(p_provider_payment_id, '')), '');
  v_payment public.asaas_payments%rowtype;
  v_provision private.billing_card_recurrence_provisions%rowtype;
  v_org public.organizations%rowtype;
  v_now timestamptz := clock_timestamp();
  v_window_started_at timestamptz;
  v_window_count integer;
  v_lease_id uuid;
  v_lease_expires_at timestamptz;
begin
  if p_payment_id is null
     or v_provider_payment_id is null
     or char_length(v_provider_payment_id) > 255 then
    return jsonb_build_object('outcome', 'invalid_input');
  end if;

  perform private.lock_asaas_billing_resources(v_provider_payment_id, null);

  select payment.*
  into v_payment
  from public.asaas_payments as payment
  where payment.id = p_payment_id
    and payment.asaas_payment_id = v_provider_payment_id
  for update;

  if not found then
    return jsonb_build_object('outcome', 'payment_not_found');
  end if;

  select organization.*
  into v_org
  from public.organizations as organization
  where organization.id = v_payment.organization_id
  for update;
  if not found then
    return jsonb_build_object('outcome', 'organization_not_found');
  end if;
  if not v_org.is_active then
    return jsonb_build_object('outcome', 'organization_inactive');
  end if;

  if not private.billing_payment_checkout_is_paid(v_payment.status) then
    return jsonb_build_object(
      'outcome', 'payment_not_paid',
      'payment_status', upper(btrim(coalesce(v_payment.status, '')))
    );
  end if;

  if v_payment.asaas_subscription_id is not null then
    return jsonb_build_object('outcome', 'payment_already_recurring');
  end if;

  select provision.*
  into v_provision
  from private.billing_card_recurrence_provisions as provision
  where provision.payment_id = v_payment.id
    and provision.provider_payment_id = v_payment.asaas_payment_id
    and provision.organization_id = v_payment.organization_id
    and provision.billing_intent_id is not distinct from v_payment.billing_intent_id
  for update;

  if not found then
    return jsonb_build_object('outcome', 'not_prepared');
  end if;

  if private.billing_organization_cleanup_is_active(
    v_provision.organization_id,
    v_provision.provider_subscription_id
  ) then
    return jsonb_build_object('outcome', 'organization_inactive');
  end if;

  if v_provision.status = 'completed' then
    return jsonb_build_object(
      'outcome', 'already_completed',
      'action', 'none',
      'subscription_id', v_provision.provider_subscription_id
    );
  end if;

  if v_provision.status = 'recovering' then
    return jsonb_build_object(
      'outcome', 'recovering',
      'action', 'recover_only',
      'external_reference', v_provision.external_reference,
      'customer_id', v_provision.provider_customer_id,
      'amount', v_provision.amount,
      'billing_period_months', v_provision.billing_period_months,
      'next_due_date', v_provision.next_due_date,
      'plan_id', v_provision.plan_id,
      'provider_subscription_id', v_provision.provider_subscription_id
    );
  end if;

  if v_provision.status = 'creating' then
    if v_provision.lease_id is not null
       and v_provision.lease_expires_at > v_now then
      return jsonb_build_object(
        'outcome', 'busy',
        'action', 'recover_only',
        'retry_after_seconds', greatest(
          1,
          ceil(extract(epoch from (
            v_provision.lease_expires_at - v_now
          )))::integer
        )
      );
    end if;

    -- A crashed worker may have submitted POST /subscriptions before losing
    -- its lease. Never grant a second create after that ambiguity.
    update private.billing_card_recurrence_provisions
    set
      status = 'recovering',
      provider_card_credential = null,
      card_last4 = null,
      lease_id = null,
      lease_expires_at = null,
      recovering_at = coalesce(recovering_at, v_now),
      last_error = coalesce(last_error, 'creation_lease_expired'),
      updated_at = v_now
    where payment_id = v_provision.payment_id;

    return jsonb_build_object(
      'outcome', 'recovering',
      'action', 'recover_only',
      'external_reference', v_provision.external_reference,
      'customer_id', v_provision.provider_customer_id,
      'amount', v_provision.amount,
      'billing_period_months', v_provision.billing_period_months,
      'next_due_date', v_provision.next_due_date,
      'plan_id', v_provision.plan_id,
      'provider_subscription_id', v_provision.provider_subscription_id
    );
  end if;

  if v_provision.status not in ('prepared', 'failed') then
    return jsonb_build_object('outcome', 'state_not_claimable');
  end if;

  if v_provision.provider_card_credential is null
     or v_provision.card_last4 is null then
    return jsonb_build_object('outcome', 'credential_not_stored');
  end if;

  if v_provision.attempt_window_started_at is null
     or v_provision.attempt_window_started_at <= v_now - interval '15 minutes' then
    v_window_started_at := v_now;
    v_window_count := 0;
  else
    v_window_started_at := v_provision.attempt_window_started_at;
    v_window_count := v_provision.attempt_window_count;
  end if;

  if v_window_count >= 5 then
    return jsonb_build_object(
      'outcome', 'rate_limited',
      'action', 'none',
      'retry_after_seconds', greatest(
        1,
        ceil(extract(epoch from (
          v_window_started_at + interval '15 minutes' - v_now
        )))::integer
      )
    );
  end if;

  v_lease_id := extensions.gen_random_uuid();
  v_lease_expires_at := v_now + interval '2 minutes';

  update private.billing_card_recurrence_provisions
  set
    status = 'creating',
    provider_card_credential = null,
    card_last4 = null,
    lease_id = v_lease_id,
    lease_expires_at = v_lease_expires_at,
    attempt_window_started_at = v_window_started_at,
    attempt_window_count = v_window_count + 1,
    provider_request_started_at = v_now,
    failed_at = null,
    last_error = null,
    updated_at = v_now
  where payment_id = v_provision.payment_id;

  return jsonb_build_object(
    'outcome', 'claimed',
    'action', 'create_or_recover',
    'payment_id', v_provision.payment_id,
    'lease_id', v_lease_id,
    'lease_expires_at', v_lease_expires_at,
    'external_reference', v_provision.external_reference,
    'customer_id', v_provision.provider_customer_id,
    'amount', v_provision.amount,
    'billing_period_months', v_provision.billing_period_months,
    'next_due_date', v_provision.next_due_date,
    'plan_id', v_provision.plan_id,
    'provider_card_credential', v_provision.provider_card_credential,
    'card_last4', v_provision.card_last4,
    'attempts_remaining', 5 - (v_window_count + 1)
  );
end
$function$;

revoke all on function public.claim_billing_card_recurrence(uuid, text)
  from PUBLIC, anon, authenticated, service_role;
grant execute on function public.claim_billing_card_recurrence(uuid, text)
  to service_role;

create or replace function public.claim_billing_card_recurrence_by_provider_payment(
  p_provider_payment_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_provider_payment_id text := nullif(btrim(coalesce(p_provider_payment_id, '')), '');
  v_payment_id uuid;
begin
  if v_provider_payment_id is null
     or char_length(v_provider_payment_id) > 255 then
    return jsonb_build_object('outcome', 'invalid_input');
  end if;

  -- Webhooks know the immutable provider payment id. Resolve only its exact
  -- local UUID, then reuse the payment/provision lock order and one-time sealed
  -- credential release implemented by the canonical claim RPC.
  select payment.id
  into v_payment_id
  from public.asaas_payments as payment
  where payment.asaas_payment_id = v_provider_payment_id;

  if not found then
    return jsonb_build_object('outcome', 'payment_not_found');
  end if;

  return public.claim_billing_card_recurrence(
    v_payment_id,
    v_provider_payment_id
  ) || jsonb_build_object('payment_id', v_payment_id);
end
$function$;

revoke all on function public.claim_billing_card_recurrence_by_provider_payment(text)
  from PUBLIC, anon, authenticated, service_role;
grant execute on function public.claim_billing_card_recurrence_by_provider_payment(text)
  to service_role;

create or replace function public.mark_billing_card_recurrence_recovering(
  p_payment_id uuid,
  p_provider_payment_id text,
  p_lease_id uuid,
  p_error text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_provider_payment_id text := nullif(btrim(coalesce(p_provider_payment_id, '')), '');
  v_error text := left(nullif(btrim(coalesce(p_error, '')), ''), 2000);
  v_payment public.asaas_payments%rowtype;
  v_provision private.billing_card_recurrence_provisions%rowtype;
begin
  if p_payment_id is null
     or p_lease_id is null
     or v_provider_payment_id is null
     or v_error is null
     or char_length(v_provider_payment_id) > 255 then
    return jsonb_build_object('outcome', 'invalid_input');
  end if;

  select payment.*
  into v_payment
  from public.asaas_payments as payment
  where payment.id = p_payment_id
    and payment.asaas_payment_id = v_provider_payment_id
  for update;

  if not found then
    return jsonb_build_object('outcome', 'payment_not_found');
  end if;

  select provision.*
  into v_provision
  from private.billing_card_recurrence_provisions as provision
  where provision.payment_id = v_payment.id
    and provision.provider_payment_id = v_payment.asaas_payment_id
  for update;

  if not found
     or v_provision.status <> 'creating'
     or v_provision.lease_id is distinct from p_lease_id then
    return jsonb_build_object('outcome', 'lease_not_found');
  end if;

  update private.billing_card_recurrence_provisions
  set
    status = 'recovering',
    provider_card_credential = null,
    card_last4 = null,
    lease_id = null,
    lease_expires_at = null,
    recovering_at = coalesce(recovering_at, clock_timestamp()),
    last_error = v_error,
    updated_at = clock_timestamp()
  where payment_id = v_provision.payment_id;

  return jsonb_build_object(
    'outcome', 'recovering',
    'action', 'recover_only',
    'external_reference', v_provision.external_reference
  );
end
$function$;

revoke all on function public.mark_billing_card_recurrence_recovering(uuid, text, uuid, text)
  from PUBLIC, anon, authenticated, service_role;
grant execute on function public.mark_billing_card_recurrence_recovering(uuid, text, uuid, text)
  to service_role;

create or replace function public.fail_billing_card_recurrence(
  p_payment_id uuid,
  p_provider_payment_id text,
  p_lease_id uuid,
  p_error text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_provider_payment_id text := nullif(btrim(coalesce(p_provider_payment_id, '')), '');
  v_error text := left(nullif(btrim(coalesce(p_error, '')), ''), 2000);
  v_payment public.asaas_payments%rowtype;
  v_provision private.billing_card_recurrence_provisions%rowtype;
begin
  if p_payment_id is null
     or p_lease_id is null
     or v_provider_payment_id is null
     or v_error is null
     or char_length(v_provider_payment_id) > 255 then
    return jsonb_build_object('outcome', 'invalid_input');
  end if;

  select payment.*
  into v_payment
  from public.asaas_payments as payment
  where payment.id = p_payment_id
    and payment.asaas_payment_id = v_provider_payment_id
  for update;

  if not found then
    return jsonb_build_object('outcome', 'payment_not_found');
  end if;

  select provision.*
  into v_provision
  from private.billing_card_recurrence_provisions as provision
  where provision.payment_id = v_payment.id
    and provision.provider_payment_id = v_payment.asaas_payment_id
  for update;

  if not found
     or v_provision.status <> 'creating'
     or v_provision.lease_id is distinct from p_lease_id then
    return jsonb_build_object('outcome', 'lease_not_found');
  end if;

  update private.billing_card_recurrence_provisions
  set
    status = 'failed',
    provider_card_credential = null,
    card_last4 = null,
    lease_id = null,
    lease_expires_at = null,
    failed_at = clock_timestamp(),
    last_error = v_error,
    updated_at = clock_timestamp()
  where payment_id = v_provision.payment_id;

  return jsonb_build_object(
    'outcome', 'failed',
    'payment_id', v_provision.payment_id
  );
end
$function$;

revoke all on function public.fail_billing_card_recurrence(uuid, text, uuid, text)
  from PUBLIC, anon, authenticated, service_role;
grant execute on function public.fail_billing_card_recurrence(uuid, text, uuid, text)
  to service_role;

-- A card POST can settle asynchronously or fail after recurrence was prepared
-- but before a creation lease exists. Edge may close only that exact prepared
-- provision. No provider payload, PAN, CVV or arbitrary error text is accepted.
create or replace function public.fail_prepared_billing_card_recurrence(
  p_payment_id uuid,
  p_provider_payment_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_provider_payment_id text := nullif(btrim(coalesce(p_provider_payment_id, '')), '');
  v_payment public.asaas_payments%rowtype;
  v_provision private.billing_card_recurrence_provisions%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  if p_payment_id is null
     or v_provider_payment_id is null
     or char_length(v_provider_payment_id) > 255 then
    return jsonb_build_object('outcome', 'invalid_input');
  end if;

  -- Preserve the recurrence lock order used by every sibling RPC: payment,
  -- then exact provision. A provider id mismatch reveals no adjacent row.
  select payment.*
  into v_payment
  from public.asaas_payments as payment
  where payment.id = p_payment_id
    and payment.asaas_payment_id = v_provider_payment_id
  for update;

  if not found then
    return jsonb_build_object('outcome', 'payment_not_found');
  end if;

  select provision.*
  into v_provision
  from private.billing_card_recurrence_provisions as provision
  where provision.payment_id = v_payment.id
    and provision.provider_payment_id = v_payment.asaas_payment_id
    and provision.organization_id = v_payment.organization_id
    and provision.billing_intent_id is not distinct from v_payment.billing_intent_id
  for update;

  if not found then
    return jsonb_build_object('outcome', 'provision_not_found');
  end if;

  if v_provision.status = 'completed' then
    return jsonb_build_object(
      'outcome', 'already_completed',
      'subscription_id', v_provision.provider_subscription_id
    );
  end if;

  if v_provision.status = 'failed' then
    return jsonb_build_object('outcome', 'already_failed');
  end if;

  if v_provision.status <> 'prepared'
     or v_provision.lease_id is not null
     or v_provision.lease_expires_at is not null then
    return jsonb_build_object('outcome', 'state_not_terminalizable');
  end if;

  update private.billing_card_recurrence_provisions as provision
  set
    status = 'failed',
    provider_card_credential = null,
    card_last4 = null,
    lease_id = null,
    lease_expires_at = null,
    failed_at = v_now,
    last_error = 'prepared_recurrence_not_created',
    updated_at = v_now
  where provision.payment_id = v_provision.payment_id
    and provision.provider_payment_id = v_provision.provider_payment_id
    and provision.status = 'prepared'
    and provision.lease_id is null
    and provision.lease_expires_at is null;

  if not found then
    return jsonb_build_object('outcome', 'state_changed');
  end if;

  return jsonb_build_object(
    'outcome', 'failed',
    'payment_id', v_provision.payment_id
  );
end
$function$;

revoke all on function public.fail_prepared_billing_card_recurrence(uuid, text)
  from PUBLIC, anon, authenticated, service_role;
grant execute on function public.fail_prepared_billing_card_recurrence(uuid, text)
  to service_role;

create or replace function private.complete_billing_card_recurrence_locked(
  p_payment_id uuid,
  p_provider_payment_id text,
  p_lease_id uuid,
  p_subscription jsonb,
  p_require_lease boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_provider_payment_id text := nullif(btrim(coalesce(p_provider_payment_id, '')), '');
  v_subscription_id text;
  v_customer_id text;
  v_external_reference text;
  v_value_text text;
  v_amount numeric;
  v_cycle text;
  v_expected_cycle text;
  v_next_due_date_text text;
  v_next_due_date date;
  v_billing_type text;
  v_provider_status text;
  v_payment public.asaas_payments%rowtype;
  v_provision private.billing_card_recurrence_provisions%rowtype;
  v_intent private.billing_checkout_intents%rowtype;
  v_org public.organizations%rowtype;
  v_subscription public.subscriptions%rowtype;
  v_subscription_count integer;
  v_subscription_row_id uuid;
  v_snapshot jsonb;
  v_now timestamptz := clock_timestamp();
  v_payment_reversed boolean := false;
begin
  if p_payment_id is null
     or v_provider_payment_id is null
     or char_length(v_provider_payment_id) > 255
     or p_subscription is null
     or jsonb_typeof(p_subscription) <> 'object'
     or (p_require_lease and p_lease_id is null) then
    return jsonb_build_object('outcome', 'invalid_input');
  end if;

  v_subscription_id := nullif(btrim(coalesce(p_subscription ->> 'id', '')), '');
  v_customer_id := nullif(btrim(coalesce(p_subscription ->> 'customer', '')), '');
  v_external_reference := p_subscription ->> 'externalReference';
  v_value_text := nullif(btrim(coalesce(p_subscription ->> 'value', '')), '');
  v_cycle := upper(nullif(btrim(coalesce(p_subscription ->> 'cycle', '')), ''));
  v_next_due_date_text := nullif(
    btrim(coalesce(p_subscription ->> 'nextDueDate', '')),
    ''
  );
  v_provider_status := upper(nullif(
    btrim(coalesce(p_subscription ->> 'status', '')),
    ''
  ));
  v_billing_type := upper(nullif(
    btrim(coalesce(p_subscription ->> 'billingType', '')),
    ''
  ));

  if v_subscription_id is null
     or v_customer_id is null
     or v_external_reference is null
     or v_value_text is null
     or v_cycle is null
     or v_next_due_date_text is null
     or char_length(v_subscription_id) > 255
     or char_length(v_customer_id) > 255
     or char_length(v_external_reference) > 160
     or v_value_text !~ '^[0-9]+([.][0-9]{1,2})?$'
     or v_next_due_date_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
     or lower(coalesce(p_subscription ->> 'deleted', 'false')) = 'true'
     or v_billing_type is distinct from 'CREDIT_CARD'
     or v_provider_status is distinct from 'ACTIVE' then
    return jsonb_build_object('outcome', 'invalid_subscription_snapshot');
  end if;

  begin
    v_amount := v_value_text::numeric;
    v_next_due_date := v_next_due_date_text::date;
  exception
    when invalid_text_representation or datetime_field_overflow then
      return jsonb_build_object('outcome', 'invalid_subscription_snapshot');
  end;

  -- Every billing writer takes the shared provider advisory locks before any
  -- row lock. private.lock_asaas_billing_resources uses
  -- pg_catalog.pg_advisory_xact_lock for both payment and subscription keys.
  perform private.lock_asaas_billing_resources(
    v_provider_payment_id,
    v_subscription_id
  );

  -- The later organization lock serializes the single public subscription row
  -- for this tenant.
  select payment.*
  into v_payment
  from public.asaas_payments as payment
  where payment.id = p_payment_id
    and payment.asaas_payment_id = v_provider_payment_id
  for update;

  if not found then
    return jsonb_build_object('outcome', 'payment_not_found');
  end if;

  v_payment_reversed := private.billing_payment_checkout_is_reversal(
    v_payment.status
  );
  if not private.billing_payment_checkout_is_paid(v_payment.status)
     and not v_payment_reversed then
    return jsonb_build_object(
      'outcome', 'payment_not_paid',
      'payment_status', upper(btrim(coalesce(v_payment.status, '')))
    );
  end if;

  -- This is the paid one-off invoice. Its provider payment must never be
  -- rewritten as if it belonged to the newly-created future subscription.
  if v_payment.asaas_subscription_id is not null then
    return jsonb_build_object('outcome', 'payment_already_recurring');
  end if;

  select provision.*
  into v_provision
  from private.billing_card_recurrence_provisions as provision
  where provision.payment_id = v_payment.id
    and provision.provider_payment_id = v_payment.asaas_payment_id
    and provision.organization_id = v_payment.organization_id
    and provision.billing_intent_id is not distinct from v_payment.billing_intent_id
  for update;

  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;

  v_expected_cycle := case v_provision.billing_period_months
    when 1 then 'MONTHLY'
    when 6 then 'SEMIANNUALLY'
    when 12 then 'YEARLY'
    else null
  end;

  if v_external_reference is distinct from v_provision.external_reference
     or v_customer_id is distinct from v_provision.provider_customer_id
     or abs(v_amount - v_provision.amount) > 0.01
     or v_cycle is distinct from v_expected_cycle
     or v_next_due_date is distinct from v_provision.next_due_date then
    return jsonb_build_object('outcome', 'immutable_tuple_mismatch');
  end if;

  if v_provision.status = 'completed' then
    if v_provision.provider_subscription_id is distinct from v_subscription_id then
      return jsonb_build_object('outcome', 'provider_subscription_conflict');
    end if;

    return jsonb_build_object(
      'outcome', 'already_completed',
      'subscription_id', v_provision.provider_subscription_id
    );
  end if;

  if p_require_lease and (
    v_provision.status <> 'creating'
    or v_provision.lease_id is distinct from p_lease_id
  ) then
    return jsonb_build_object('outcome', 'lease_not_found');
  end if;

  if exists (
    select 1
    from private.billing_card_recurrence_provisions as other_provision
    where other_provision.provider_subscription_id = v_subscription_id
      and other_provision.payment_id <> v_provision.payment_id
  ) or exists (
    select 1
    from private.billing_checkout_intents as other_intent
    where other_intent.provider_subscription_id = v_subscription_id
      and other_intent.id <> v_provision.billing_intent_id
  ) or exists (
    select 1
    from public.organizations as other_organization
    where other_organization.asaas_subscription_id = v_subscription_id
      and other_organization.id <> v_provision.organization_id
  ) or exists (
    select 1
    from public.subscriptions as other_subscription
    where other_subscription.provider_subscription_id = v_subscription_id
      and other_subscription.organization_id <> v_provision.organization_id
  ) then
    return jsonb_build_object('outcome', 'provider_subscription_conflict');
  end if;

  select intent.*
  into v_intent
  from private.billing_checkout_intents as intent
  where intent.id = v_provision.billing_intent_id
    and intent.organization_id = v_provision.organization_id
  for update;

  if not found
     or v_intent.provider_payment_id is distinct from v_provision.provider_payment_id
     or v_intent.provider_customer_id is distinct from v_provision.provider_customer_id
     or v_intent.pending_plan_id is distinct from v_provision.plan_id
     or v_intent.billing_period_months is distinct from v_provision.billing_period_months
     or abs(v_intent.amount - v_provision.amount) > 0.01 then
    return jsonb_build_object('outcome', 'immutable_tuple_mismatch');
  end if;

  if v_intent.provider_subscription_id is not null
     and v_intent.provider_subscription_id <> v_subscription_id then
    return jsonb_build_object('outcome', 'provider_subscription_conflict');
  end if;

  select organization_row.*
  into v_org
  from public.organizations as organization_row
  where organization_row.id = v_provision.organization_id
  for update;

  if not found then
    return jsonb_build_object('outcome', 'organization_not_found');
  end if;

  if not (
    v_org.plan_id = v_provision.plan_id
    or v_org.pending_plan_id = v_provision.plan_id
  ) then
    return jsonb_build_object('outcome', 'organization_plan_mismatch');
  end if;

  if v_org.asaas_customer_id is not null
     and v_org.asaas_customer_id <> v_provision.provider_customer_id then
    return jsonb_build_object('outcome', 'organization_customer_mismatch');
  end if;

  if v_org.asaas_subscription_id is not null
     and v_org.asaas_subscription_id <> v_subscription_id then
    return jsonb_build_object('outcome', 'provider_subscription_conflict');
  end if;

  -- The organization row above serializes creation/update of its public
  -- subscription. Existing duplicate rows are considered corrupt and fail
  -- closed instead of being updated en masse.
  perform subscription_row.id
  from public.subscriptions as subscription_row
  where subscription_row.organization_id = v_provision.organization_id
  for update;

  select count(*)
  into v_subscription_count
  from public.subscriptions as subscription_row
  where subscription_row.organization_id = v_provision.organization_id;

  if v_subscription_count > 1 then
    return jsonb_build_object('outcome', 'subscription_row_ambiguous');
  end if;

  if v_subscription_count = 1 then
    select subscription_row.id
    into v_subscription_row_id
    from public.subscriptions as subscription_row
    where subscription_row.organization_id = v_provision.organization_id;

    select subscription_row.*
    into v_subscription
    from public.subscriptions as subscription_row
    where subscription_row.id = v_subscription_row_id;

    if (v_subscription.plan_id is not null and v_subscription.plan_id <> v_provision.plan_id)
       or (
         v_subscription.provider_customer_id is not null
         and v_subscription.provider_customer_id <> v_provision.provider_customer_id
       )
       or (
         v_subscription.provider_subscription_id is not null
         and v_subscription.provider_subscription_id <> v_subscription_id
       ) then
      return jsonb_build_object('outcome', 'subscription_row_mismatch');
    end if;
  end if;

  -- Store only the fields needed to prove the immutable tuple. Never persist
  -- a card number, CVV, provider credit-card token or raw provider payload.
  v_snapshot := jsonb_build_object(
    'id', v_subscription_id,
    'customer', v_customer_id,
    'externalReference', v_external_reference,
    'value', v_amount,
    'cycle', v_cycle,
    'nextDueDate', v_next_due_date,
    'billingType', v_billing_type,
    'status', v_provider_status
  );

  update private.billing_checkout_intents
  set
    provider_subscription_id = v_subscription_id,
    provider_response = coalesce(provider_response, '{}'::jsonb)
      || jsonb_build_object('card_recurrence', v_snapshot),
    updated_at = v_now
  where id = v_intent.id;

  -- Do not change subscription_status here. In particular, an active account
  -- remains active; payment confirmation remains the sole activation path.
  update public.organizations
  set
    asaas_customer_id = coalesce(asaas_customer_id, v_provision.provider_customer_id),
    asaas_subscription_id = v_subscription_id,
    subscription_billing_period_months = v_provision.billing_period_months,
    next_billing_date = v_provision.next_due_date,
    updated_at = v_now
  where id = v_provision.organization_id;

  if v_subscription_count = 0 then
    insert into public.subscriptions (
      organization_id,
      plan_id,
      status,
      provider,
      provider_customer_id,
      provider_subscription_id,
      billing_period_months,
      current_period_end,
      metadata,
      created_at,
      updated_at
    )
    values (
      v_provision.organization_id,
      v_provision.plan_id,
      case
        when v_org.subscription_status in (
          'trial',
          'pending_payment',
          'active',
          'blocked',
          'overdue',
          'past_due',
          'suspended',
          'cancelled'
        ) then v_org.subscription_status
        else 'active'
      end,
      'asaas',
      v_provision.provider_customer_id,
      v_subscription_id,
      v_provision.billing_period_months,
      v_provision.next_due_date::timestamp at time zone 'UTC',
      jsonb_build_object('card_recurrence', v_snapshot),
      v_now,
      v_now
    );
  else
    update public.subscriptions
    set
      plan_id = coalesce(plan_id, v_provision.plan_id),
      provider = 'asaas',
      provider_customer_id = coalesce(
        provider_customer_id,
        v_provision.provider_customer_id
      ),
      provider_subscription_id = v_subscription_id,
      billing_period_months = v_provision.billing_period_months,
      current_period_end = v_provision.next_due_date::timestamp at time zone 'UTC',
      metadata = coalesce(metadata, '{}'::jsonb)
        || jsonb_build_object('card_recurrence', v_snapshot),
      updated_at = v_now
    where id = v_subscription_row_id;
  end if;

  update private.billing_card_recurrence_provisions
  set
    status = 'completed',
    provider_subscription_id = v_subscription_id,
    provider_subscription_snapshot = v_snapshot,
    provider_card_credential = null,
    card_last4 = null,
    lease_id = null,
    lease_expires_at = null,
    completed_at = coalesce(completed_at, v_now),
    recovering_at = null,
    failed_at = null,
    last_error = null,
    job_action = case
      when v_payment_reversed then 'cancel'
      else 'create'
    end,
    job_status = case
      when v_payment_reversed then 'pending'
      else 'succeeded'
    end,
    job_attempts = case
      when v_payment_reversed then 0
      else job_attempts
    end,
    job_next_attempt_at = case
      when v_payment_reversed then v_now
      else job_next_attempt_at
    end,
    job_locked_at = null,
    job_lock_expires_at = null,
    job_locked_by = null,
    job_lease_id = null,
    job_dead_lettered_at = null,
    job_last_error_code = null,
    updated_at = v_now
  where payment_id = v_provision.payment_id;

  insert into public.subscription_logs (
    organization_id,
    event_type,
    status,
    metadata
  )
  values (
    v_provision.organization_id,
    'billing_card_recurrence_linked',
    coalesce(v_org.subscription_status, 'logged'),
    jsonb_build_object(
      'payment_id', v_provision.payment_id,
      'billing_intent_id', v_provision.billing_intent_id,
      'plan_id', v_provision.plan_id,
      'billing_period_months', v_provision.billing_period_months,
      'amount', v_provision.amount,
      'next_due_date', v_provision.next_due_date,
      'external_reference', v_provision.external_reference,
      'provider_subscription_id', v_subscription_id
    )
  );

  return jsonb_build_object(
    'outcome', 'completed',
    'payment_id', v_provision.payment_id,
    'subscription_id', v_subscription_id,
    'next_due_date', v_provision.next_due_date,
    'cancellation_queued', v_payment_reversed
  );
exception
  when unique_violation then
    return jsonb_build_object('outcome', 'provider_subscription_conflict');
end
$function$;

revoke all on function private.complete_billing_card_recurrence_locked(
  uuid,
  text,
  uuid,
  jsonb,
  boolean
) from PUBLIC, anon, authenticated, service_role;

create or replace function public.complete_billing_card_recurrence(
  p_payment_id uuid,
  p_provider_payment_id text,
  p_lease_id uuid,
  p_subscription jsonb
)
returns jsonb
language sql
security definer
set search_path = ''
as $function$
  select private.complete_billing_card_recurrence_locked(
    p_payment_id,
    p_provider_payment_id,
    p_lease_id,
    p_subscription,
    true
  );
$function$;

revoke all on function public.complete_billing_card_recurrence(uuid, text, uuid, jsonb)
  from PUBLIC, anon, authenticated, service_role;
grant execute on function public.complete_billing_card_recurrence(uuid, text, uuid, jsonb)
  to service_role;

create or replace function public.claim_billing_card_recurrence_jobs(
  p_worker_id text,
  p_limit integer default 20,
  p_lease_seconds integer default 300
)
returns setof jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_worker_id text := nullif(btrim(coalesce(p_worker_id, '')), '');
  v_now timestamptz := clock_timestamp();
  v_lock_expires_at timestamptz;
  v_dead_alert_count integer := 0;
begin
  if v_worker_id is null
     or char_length(v_worker_id) > 128
     or v_worker_id !~ '^[A-Za-z0-9._:-]+$'
     or p_limit is null
     or p_limit not between 1 and 100
     or p_lease_seconds is null
     or p_lease_seconds not between 30 and 900 then
    return next jsonb_build_object('outcome', 'invalid_input');
    return;
  end if;

  v_lock_expires_at := v_now + make_interval(secs => p_lease_seconds);

  -- Exhausted and abandoned jobs are dead-lettered before new claims. Only a
  -- bounded, non-sensitive error code is persisted and surfaced to operators.
  with exhausted as (
    update private.billing_card_recurrence_provisions as provision
    set
      status = case
        when provision.job_action = 'create'
          and provision.status not in ('completed', 'cancelled')
        then 'failed'
        else provision.status
      end,
      provider_card_credential = case
        when provision.job_action = 'create' then null
        else provision.provider_card_credential
      end,
      card_last4 = case
        when provision.job_action = 'create' then null
        else provision.card_last4
      end,
      lease_id = null,
      lease_expires_at = null,
      failed_at = case
        when provision.job_action = 'create'
          then coalesce(provision.failed_at, v_now)
        else provision.failed_at
      end,
      last_error = coalesce(
        provision.job_last_error_code,
        'job_attempts_exhausted'
      ),
      job_status = 'dead',
      job_locked_at = null,
      job_lock_expires_at = null,
      job_locked_by = null,
      job_lease_id = null,
      job_dead_lettered_at = coalesce(
        provision.job_dead_lettered_at,
        v_now
      ),
      job_last_error_code = coalesce(
        provision.job_last_error_code,
        'job_attempts_exhausted'
      ),
      updated_at = v_now
    where provision.job_attempts >= provision.job_max_attempts
      and (
        (
          provision.job_status in ('pending', 'retry')
          and provision.job_next_attempt_at <= v_now
        )
        or (
          provision.job_status = 'processing'
          and provision.job_lock_expires_at <= v_now
        )
      )
    returning
      provision.payment_id,
      provision.organization_id,
      provision.job_action,
      provision.job_attempts,
      provision.job_last_error_code
  ), alerts as (
    insert into public.error_events (
      organization_id,
      source,
      severity,
      fingerprint,
      message,
      category,
      error_code,
      component,
      metadata,
      occurred_at
    )
    select
      exhausted.organization_id,
      'backend',
      'critical',
      'billing_card_recurrence_dead:' || exhausted.payment_id::text,
      'Billing card recurrence job exhausted all retries',
      'billing',
      'billing_card_recurrence_job_dead',
      'billing_card_recurrence_worker',
      jsonb_build_object(
        'payment_id', exhausted.payment_id,
        'action', exhausted.job_action,
        'attempts', exhausted.job_attempts,
        'error_code', exhausted.job_last_error_code
      ),
      v_now
    from exhausted
    returning 1
  )
  select count(*)::integer
  into v_dead_alert_count
  from alerts;

  return query
  with candidates as (
    select
      provision.payment_id,
      provision.status as previous_recurrence_status,
      provision.job_status as previous_job_status,
      provision.job_action,
      provision.provider_card_credential,
      provision.card_last4,
      provision.provider_request_started_at,
      payment.status as payment_status,
      extensions.gen_random_uuid() as claim_lease_id
    from private.billing_card_recurrence_provisions as provision
    join public.asaas_payments as payment
      on payment.id = provision.payment_id
      and payment.asaas_payment_id = provision.provider_payment_id
      and payment.organization_id = provision.organization_id
      and payment.billing_intent_id is not distinct from provision.billing_intent_id
    where provision.job_attempts < provision.job_max_attempts
      and not private.billing_organization_cleanup_is_active(
        provision.organization_id,
        provision.provider_subscription_id
      )
      and (
        (
          provision.job_status in ('pending', 'retry')
          and provision.job_next_attempt_at <= v_now
        )
        or (
          provision.job_status = 'processing'
          and provision.job_lock_expires_at <= v_now
        )
      )
      and (
        (
          provision.job_action = 'create'
          and provision.status in ('prepared', 'failed', 'creating', 'recovering')
          and provision.provider_card_credential is not null
          and (
            private.billing_payment_checkout_is_paid(payment.status)
            or (
              private.billing_payment_checkout_is_reversal(payment.status)
              and provision.provider_request_started_at is not null
            )
          )
        )
        or (
          provision.job_action = 'cancel'
          and provision.status = 'completed'
          and provision.provider_subscription_id is not null
          and private.billing_payment_checkout_is_reversal(payment.status)
        )
      )
    order by
      provision.job_next_attempt_at,
      provision.created_at,
      provision.payment_id
    limit p_limit
    for update of provision skip locked
  ), claimed as (
    update private.billing_card_recurrence_provisions as provision
    set
      status = case
        when candidates.job_action = 'create' then 'creating'
        else provision.status
      end,
      lease_id = case
        when candidates.job_action = 'create' then candidates.claim_lease_id
        else null
      end,
      lease_expires_at = case
        when candidates.job_action = 'create' then v_lock_expires_at
        else null
      end,
      job_status = 'processing',
      job_attempts = provision.job_attempts + 1,
      job_locked_at = v_now,
      job_lock_expires_at = v_lock_expires_at,
      job_locked_by = v_worker_id,
      job_lease_id = candidates.claim_lease_id,
      job_last_attempt_at = v_now,
      job_last_error_code = null,
      updated_at = v_now
    from candidates
    where provision.payment_id = candidates.payment_id
    returning
      provision.*,
      candidates.previous_recurrence_status,
      candidates.previous_job_status,
      candidates.payment_status,
      candidates.provider_card_credential as claimed_credential,
      candidates.card_last4 as claimed_card_last4
  )
  select jsonb_build_object(
    'outcome', 'claimed',
    'action', claimed.job_action,
    'mode', case
      when claimed.job_action = 'cancel' then 'cancel'
      when claimed.provider_request_started_at is not null
      then 'recover_only'
      else 'create_or_recover'
    end,
    'payment_id', claimed.payment_id,
    'provider_payment_id', claimed.provider_payment_id,
    'organization_id', claimed.organization_id,
    'billing_intent_id', claimed.billing_intent_id,
    'plan_id', claimed.plan_id,
    'customer_id', claimed.provider_customer_id,
    'provider_subscription_id', claimed.provider_subscription_id,
    'external_reference', claimed.external_reference,
    'amount', claimed.amount,
    'billing_period_months', claimed.billing_period_months,
    'next_due_date', claimed.next_due_date,
    'payment_status', upper(btrim(coalesce(claimed.payment_status, ''))),
    'worker_id', claimed.job_locked_by,
    'job_lease_id', claimed.job_lease_id,
    'lock_expires_at', claimed.job_lock_expires_at,
    'attempts', claimed.job_attempts,
    'max_attempts', claimed.job_max_attempts,
    'provider_card_credential', case
      when claimed.job_action = 'create'
        and claimed.provider_request_started_at is null
      then claimed.claimed_credential
      else null
    end,
    'card_last4', case
      when claimed.job_action = 'create'
        and claimed.provider_request_started_at is null
      then claimed.claimed_card_last4
      else null
    end
  )
  from claimed;
end
$function$;

revoke all on function public.claim_billing_card_recurrence_jobs(text, integer, integer)
  from PUBLIC, anon, authenticated, service_role;
grant execute on function public.claim_billing_card_recurrence_jobs(text, integer, integer)
  to service_role;

-- This lease-CAS transition is the durable boundary immediately before the
-- first byte of POST /subscriptions. Claiming a job is not evidence that a
-- provider request started: a process can crash after claim/decryption and the
-- next lease must still be allowed to create. Once this marker commits, every
-- later lease is recovery-only until the exact provider tuple is found.
create or replace function public.mark_billing_card_recurrence_provider_request_started(
  p_payment_id uuid,
  p_worker_id text,
  p_job_lease_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_worker_id text := nullif(btrim(coalesce(p_worker_id, '')), '');
  v_provision private.billing_card_recurrence_provisions%rowtype;
  v_org public.organizations%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  if p_payment_id is null
     or v_worker_id is null
     or char_length(v_worker_id) > 128
     or v_worker_id !~ '^[A-Za-z0-9._:-]+$'
     or p_job_lease_id is null then
    return jsonb_build_object('outcome', 'invalid_input');
  end if;

  select provision.*
  into v_provision
  from private.billing_card_recurrence_provisions as provision
  where provision.payment_id = p_payment_id
    and provision.job_status = 'processing'
    and provision.job_action = 'create'
    and provision.status = 'creating'
    and provision.job_locked_by = v_worker_id
    and provision.job_lease_id = p_job_lease_id
    and provision.lease_id = p_job_lease_id
  for update;

  if not found then
    return jsonb_build_object('outcome', 'lease_not_found');
  end if;

  select organization.*
  into v_org
  from public.organizations as organization
  where organization.id = v_provision.organization_id
  for update;
  if not found then
    return jsonb_build_object('outcome', 'organization_not_found');
  end if;
  if not v_org.is_active then
    return jsonb_build_object('outcome', 'organization_inactive');
  end if;

  if private.billing_organization_cleanup_is_active(
    v_provision.organization_id,
    v_provision.provider_subscription_id
  ) then
    return jsonb_build_object('outcome', 'organization_inactive');
  end if;

  if v_provision.provider_request_started_at is not null then
    return jsonb_build_object(
      'outcome', 'already_started',
      'payment_id', v_provision.payment_id,
      'provider_request_started_at', v_provision.provider_request_started_at
    );
  end if;

  update private.billing_card_recurrence_provisions as provision
  set
    provider_request_started_at = v_now,
    updated_at = v_now
  where provision.payment_id = v_provision.payment_id
    and provision.job_status = 'processing'
    and provision.job_action = 'create'
    and provision.status = 'creating'
    and provision.job_locked_by = v_worker_id
    and provision.job_lease_id = p_job_lease_id
    and provision.lease_id = p_job_lease_id
    and provision.provider_request_started_at is null;

  if not found then
    return jsonb_build_object('outcome', 'lease_not_found');
  end if;

  return jsonb_build_object(
    'outcome', 'started',
    'payment_id', v_provision.payment_id,
    'provider_request_started_at', v_now
  );
end
$function$;

revoke all on function public.mark_billing_card_recurrence_provider_request_started(uuid, text, uuid)
  from PUBLIC, anon, authenticated, service_role;
grant execute on function public.mark_billing_card_recurrence_provider_request_started(uuid, text, uuid)
  to service_role;

create or replace function public.succeed_billing_card_recurrence_job(
  p_payment_id uuid,
  p_provider_payment_id text,
  p_worker_id text,
  p_job_lease_id uuid,
  p_provider_result jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_provider_payment_id text := nullif(btrim(coalesce(p_provider_payment_id, '')), '');
  v_worker_id text := nullif(btrim(coalesce(p_worker_id, '')), '');
  v_preliminary_subscription_id text;
  v_result_subscription_id text;
  v_result_outcome text;
  v_payment public.asaas_payments%rowtype;
  v_provision private.billing_card_recurrence_provisions%rowtype;
  v_complete jsonb;
  v_now timestamptz := clock_timestamp();
begin
  if p_payment_id is null
     or v_provider_payment_id is null
     or char_length(v_provider_payment_id) > 255
     or v_worker_id is null
     or char_length(v_worker_id) > 128
     or v_worker_id !~ '^[A-Za-z0-9._:-]+$'
     or p_job_lease_id is null
     or p_provider_result is null
     or jsonb_typeof(p_provider_result) <> 'object' then
    return jsonb_build_object('outcome', 'invalid_input');
  end if;

  select provision.provider_subscription_id
  into v_preliminary_subscription_id
  from private.billing_card_recurrence_provisions as provision
  where provision.payment_id = p_payment_id
    and provision.provider_payment_id = v_provider_payment_id;

  if not found then
    return jsonb_build_object('outcome', 'job_not_found');
  end if;

  v_result_subscription_id := nullif(btrim(coalesce(
    p_provider_result ->> 'id',
    p_provider_result ->> 'subscription_id',
    ''
  )), '');
  perform private.lock_asaas_billing_resources(
    v_provider_payment_id,
    coalesce(v_preliminary_subscription_id, v_result_subscription_id)
  );

  select payment.*
  into v_payment
  from public.asaas_payments as payment
  where payment.id = p_payment_id
    and payment.asaas_payment_id = v_provider_payment_id
  for update;

  if not found then
    return jsonb_build_object('outcome', 'payment_not_found');
  end if;

  select provision.*
  into v_provision
  from private.billing_card_recurrence_provisions as provision
  where provision.payment_id = v_payment.id
    and provision.provider_payment_id = v_payment.asaas_payment_id
    and provision.organization_id = v_payment.organization_id
    and provision.billing_intent_id is not distinct from v_payment.billing_intent_id
  for update;

  if not found then
    return jsonb_build_object('outcome', 'job_not_found');
  end if;

  v_result_outcome := lower(nullif(btrim(coalesce(
    p_provider_result ->> 'outcome',
    ''
  )), ''));

  -- A committed success can lose its HTTP response. Replaying that exact
  -- acknowledgement is idempotent even after the lease fields were cleared.
  -- Creation reuses the full immutable provider-snapshot validator; cancelled
  -- jobs require the exact stored subscription id and terminal delete result.
  if v_provision.status = 'completed'
     and v_result_subscription_id is not null
     and p_provider_result ? 'customer' then
    v_complete := private.complete_billing_card_recurrence_locked(
      v_payment.id,
      v_payment.asaas_payment_id,
      null,
      p_provider_result,
      false
    );
    return v_complete || jsonb_build_object(
      'job_action', 'create',
      'worker_id', v_worker_id
    );
  end if;

  if v_provision.status = 'cancelled'
     and v_provision.job_status = 'succeeded'
     and v_result_subscription_id
       is not distinct from v_provision.provider_subscription_id
     and v_result_outcome in ('deleted', 'already_absent') then
    return jsonb_build_object(
      'outcome', 'already_succeeded',
      'job_action', 'cancel',
      'payment_id', v_provision.payment_id,
      'provider_subscription_id', v_provision.provider_subscription_id,
      'provider_outcome', v_result_outcome
    );
  end if;

  if v_provision.job_status <> 'processing'
     or v_provision.job_locked_by is distinct from v_worker_id
     or v_provision.job_lease_id is distinct from p_job_lease_id then
    return jsonb_build_object('outcome', 'lease_not_found');
  end if;

  if v_provision.job_action = 'create' then
    if v_provision.lease_id is distinct from p_job_lease_id then
      return jsonb_build_object('outcome', 'lease_not_found');
    end if;

    v_complete := private.complete_billing_card_recurrence_locked(
      v_payment.id,
      v_payment.asaas_payment_id,
      p_job_lease_id,
      p_provider_result,
      true
    );
    return v_complete || jsonb_build_object(
      'job_action', 'create',
      'worker_id', v_worker_id
    );
  end if;

  if v_provision.job_action <> 'cancel'
     or v_provision.status <> 'completed'
     or not private.billing_payment_checkout_is_reversal(v_payment.status) then
    return jsonb_build_object('outcome', 'state_not_succeedable');
  end if;

  if v_result_subscription_id is distinct from v_provision.provider_subscription_id
     or v_result_outcome not in ('deleted', 'already_absent') then
    return jsonb_build_object('outcome', 'invalid_provider_result');
  end if;

  update private.billing_card_recurrence_provisions as provision
  set
    status = 'cancelled',
    provider_card_credential = null,
    card_last4 = null,
    lease_id = null,
    lease_expires_at = null,
    provider_cancelled_at = coalesce(provision.provider_cancelled_at, v_now),
    job_status = 'succeeded',
    job_locked_at = null,
    job_lock_expires_at = null,
    job_locked_by = null,
    job_lease_id = null,
    job_dead_lettered_at = null,
    job_last_error_code = null,
    updated_at = v_now
  where provision.payment_id = v_provision.payment_id
    and provision.job_status = 'processing'
    and provision.job_action = 'cancel'
    and provision.job_locked_by = v_worker_id
    and provision.job_lease_id = p_job_lease_id;

  if not found then
    return jsonb_build_object('outcome', 'lease_not_found');
  end if;

  update public.organizations as organization_row
  set
    asaas_subscription_id = null,
    next_billing_date = null,
    updated_at = v_now
  where organization_row.id = v_provision.organization_id
    and organization_row.asaas_subscription_id
      is not distinct from v_provision.provider_subscription_id;

  update public.subscriptions as subscription
  set
    status = 'cancelled',
    metadata = coalesce(subscription.metadata, '{}'::jsonb)
      || jsonb_build_object(
        'card_recurrence_cancelled_at', v_now,
        'card_recurrence_cancel_outcome', v_result_outcome
      ),
    updated_at = v_now
  where subscription.organization_id = v_provision.organization_id
    and subscription.provider_subscription_id
      = v_provision.provider_subscription_id;

  delete from private.asaas_reconciliation_jobs as reconciliation_job
  where reconciliation_job.organization_id = v_provision.organization_id
    and reconciliation_job.provider_subscription_id
      = v_provision.provider_subscription_id;

  insert into public.subscription_logs (
    organization_id,
    event_type,
    status,
    metadata
  )
  values (
    v_provision.organization_id,
    'billing_card_recurrence_cancelled',
    'cancelled',
    jsonb_build_object(
      'payment_id', v_provision.payment_id,
      'billing_intent_id', v_provision.billing_intent_id,
      'provider_subscription_id', v_provision.provider_subscription_id,
      'provider_outcome', v_result_outcome
    )
  );

  return jsonb_build_object(
    'outcome', 'cancelled',
    'job_action', 'cancel',
    'payment_id', v_provision.payment_id,
    'provider_subscription_id', v_provision.provider_subscription_id,
    'provider_outcome', v_result_outcome
  );
end
$function$;

revoke all on function public.succeed_billing_card_recurrence_job(uuid, text, text, uuid, jsonb)
  from PUBLIC, anon, authenticated, service_role;
grant execute on function public.succeed_billing_card_recurrence_job(uuid, text, text, uuid, jsonb)
  to service_role;

create or replace function public.fail_billing_card_recurrence_job(
  p_payment_id uuid,
  p_worker_id text,
  p_job_lease_id uuid,
  p_failure_class text,
  p_error_code text,
  p_retry_after_seconds integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_worker_id text := nullif(btrim(coalesce(p_worker_id, '')), '');
  v_failure_class text := lower(nullif(btrim(coalesce(p_failure_class, '')), ''));
  v_error_code text := lower(nullif(btrim(coalesce(p_error_code, '')), ''));
  v_provision private.billing_card_recurrence_provisions%rowtype;
  v_now timestamptz := clock_timestamp();
  v_retry_after_seconds integer;
  v_next_attempt_at timestamptz;
  v_dead boolean;
begin
  if p_payment_id is null
     or v_worker_id is null
     or char_length(v_worker_id) > 128
     or v_worker_id !~ '^[A-Za-z0-9._:-]+$'
     or p_job_lease_id is null
     or v_failure_class not in ('deterministic', 'ambiguous', 'permanent')
     or v_error_code is null
     or v_error_code !~ '^[a-z0-9_]{1,80}$'
     or (
       p_retry_after_seconds is not null
       and p_retry_after_seconds not between 30 and 86400
     ) then
    return jsonb_build_object('outcome', 'invalid_input');
  end if;

  select provision.*
  into v_provision
  from private.billing_card_recurrence_provisions as provision
  where provision.payment_id = p_payment_id
    and provision.job_status = 'processing'
    and provision.job_locked_by = v_worker_id
    and provision.job_lease_id = p_job_lease_id
  for update;

  if not found then
    return jsonb_build_object('outcome', 'lease_not_found');
  end if;

  if v_provision.job_action = 'create'
     and v_failure_class = 'ambiguous'
     and v_provision.provider_request_started_at is null then
    return jsonb_build_object('outcome', 'provider_request_not_started');
  end if;

  v_dead := v_failure_class = 'permanent'
    or v_provision.job_attempts >= v_provision.job_max_attempts;
  v_retry_after_seconds := coalesce(
    p_retry_after_seconds,
    least(
      21600,
      (
        300 * power(
          2,
          least(greatest(v_provision.job_attempts - 1, 0), 6)
        )
      )::integer
    )
  );
  v_next_attempt_at := v_now + make_interval(secs => v_retry_after_seconds);

  update private.billing_card_recurrence_provisions as provision
  set
    status = case
      when provision.job_action = 'create' and v_dead then 'failed'
      when provision.job_action = 'create'
        and v_failure_class = 'ambiguous' then 'recovering'
      when provision.job_action = 'create' then 'prepared'
      else provision.status
    end,
    provider_card_credential = case
      when provision.job_action = 'create' and v_dead then null
      else provision.provider_card_credential
    end,
    card_last4 = case
      when provision.job_action = 'create' and v_dead then null
      else provision.card_last4
    end,
    lease_id = null,
    lease_expires_at = null,
    provider_request_started_at = provision.provider_request_started_at,
    recovering_at = case
      when provision.job_action = 'create'
        and v_failure_class = 'ambiguous'
      then coalesce(provision.recovering_at, v_now)
      when provision.job_action = 'create' and not v_dead then null
      else provision.recovering_at
    end,
    failed_at = case
      when provision.job_action = 'create' and v_dead
        then coalesce(provision.failed_at, v_now)
      else provision.failed_at
    end,
    last_error = v_error_code,
    job_status = case when v_dead then 'dead' else 'retry' end,
    job_next_attempt_at = case
      when v_dead then provision.job_next_attempt_at
      else v_next_attempt_at
    end,
    job_locked_at = null,
    job_lock_expires_at = null,
    job_locked_by = null,
    job_lease_id = null,
    job_dead_lettered_at = case
      when v_dead then coalesce(provision.job_dead_lettered_at, v_now)
      else null
    end,
    job_last_error_code = v_error_code,
    updated_at = v_now
  where provision.payment_id = v_provision.payment_id
    and provision.job_status = 'processing'
    and provision.job_locked_by = v_worker_id
    and provision.job_lease_id = p_job_lease_id;

  if not found then
    return jsonb_build_object('outcome', 'lease_not_found');
  end if;

  if v_dead then
    insert into public.error_events (
      organization_id,
      source,
      severity,
      fingerprint,
      message,
      category,
      error_code,
      component,
      metadata,
      occurred_at
    )
    values (
      v_provision.organization_id,
      'backend',
      'critical',
      'billing_card_recurrence_dead:' || v_provision.payment_id::text,
      'Billing card recurrence job entered the dead letter state',
      'billing',
      'billing_card_recurrence_job_dead',
      'billing_card_recurrence_worker',
      jsonb_build_object(
        'payment_id', v_provision.payment_id,
        'action', v_provision.job_action,
        'attempts', v_provision.job_attempts,
        'failure_class', v_failure_class,
        'error_code', v_error_code
      ),
      v_now
    );
  end if;

  return jsonb_build_object(
    'outcome', case when v_dead then 'dead' else 'retry' end,
    'payment_id', v_provision.payment_id,
    'action', v_provision.job_action,
    'failure_class', v_failure_class,
    'error_code', v_error_code,
    'next_attempt_at', case when v_dead then null else v_next_attempt_at end
  );
end
$function$;

revoke all on function public.fail_billing_card_recurrence_job(uuid, text, uuid, text, text, integer)
  from PUBLIC, anon, authenticated, service_role;
grant execute on function public.fail_billing_card_recurrence_job(uuid, text, uuid, text, text, integer)
  to service_role;

create or replace function public.get_billing_card_recurrence_reversal_target(
  p_provider_payment_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_provider_payment_id text := nullif(btrim(coalesce(p_provider_payment_id, '')), '');
  v_preliminary_subscription_id text;
  v_had_preliminary_provision boolean := false;
  v_payment public.asaas_payments%rowtype;
  v_provision private.billing_card_recurrence_provisions%rowtype;
  v_payment_status text;
begin
  if v_provider_payment_id is null
     or char_length(v_provider_payment_id) > 255 then
    return jsonb_build_object('outcome', 'invalid_input');
  end if;

  -- A preliminary read discovers the provider subscription advisory key. The
  -- exact payment/provision tuple is re-read under globally ordered advisory
  -- and row locks; a concurrent completion therefore produces state_changed
  -- and a safe retry instead of an incompletely locked cancellation target.
  select provision.provider_subscription_id
  into v_preliminary_subscription_id
  from private.billing_card_recurrence_provisions as provision
  where provision.provider_payment_id = v_provider_payment_id;
  v_had_preliminary_provision := found;

  perform private.lock_asaas_billing_resources(
    v_provider_payment_id,
    v_preliminary_subscription_id
  );

  select payment.*
  into v_payment
  from public.asaas_payments as payment
  where payment.asaas_payment_id = v_provider_payment_id
  for update;

  if not found then
    return jsonb_build_object('outcome', 'payment_not_found');
  end if;

  select provision.*
  into v_provision
  from private.billing_card_recurrence_provisions as provision
  where provision.payment_id = v_payment.id
    and provision.provider_payment_id = v_payment.asaas_payment_id
    and provision.organization_id = v_payment.organization_id
    and provision.billing_intent_id is not distinct from v_payment.billing_intent_id
  for update;

  if not found then
    return jsonb_build_object(
      'outcome', 'recurrence_not_found',
      'payment_id', v_payment.id
    );
  end if;

  if not v_had_preliminary_provision
     or v_provision.provider_subscription_id
       is distinct from v_preliminary_subscription_id then
    return jsonb_build_object(
      'outcome', 'state_changed',
      'payment_id', v_payment.id
    );
  end if;

  if v_provision.status <> 'completed' then
    return jsonb_build_object(
      'outcome', 'recurrence_not_completed',
      'payment_id', v_payment.id,
      'recurrence_status', v_provision.status
    );
  end if;

  v_payment_status := upper(btrim(coalesce(v_payment.status, '')));
  if not private.billing_payment_checkout_is_reversal(v_payment_status) then
    return jsonb_build_object(
      'outcome', 'payment_not_reversed',
      'payment_id', v_payment.id,
      'payment_status', v_payment_status
    );
  end if;

  if v_provision.provider_subscription_id is null
     or nullif(btrim(v_provision.provider_customer_id), '') is null
     or nullif(btrim(v_provision.external_reference), '') is null
     or v_provision.amount is null
     or v_provision.amount <= 0
     or v_provision.billing_period_months not in (1, 6, 12)
     or v_provision.next_due_date is null then
    return jsonb_build_object(
      'outcome', 'target_invalid',
      'payment_id', v_payment.id
    );
  end if;

  return jsonb_build_object(
    'outcome', 'target',
    'payment_id', v_provision.payment_id,
    'provider_payment_id', v_provision.provider_payment_id,
    'organization_id', v_provision.organization_id,
    'billing_intent_id', v_provision.billing_intent_id,
    'provider_subscription_id', v_provision.provider_subscription_id,
    'provider_customer_id', v_provision.provider_customer_id,
    'external_reference', v_provision.external_reference,
    'amount', v_provision.amount,
    'billing_period_months', v_provision.billing_period_months,
    'next_due_date', v_provision.next_due_date,
    'payment_status', v_payment_status
  );
end
$function$;

revoke all on function public.get_billing_card_recurrence_reversal_target(text)
  from PUBLIC, anon, authenticated, service_role;
grant execute on function public.get_billing_card_recurrence_reversal_target(text)
  to service_role;

create or replace function public.reconcile_billing_card_recurrence_subscription(
  p_subscription jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_external_reference text;
  v_payment_id uuid;
  v_provider_payment_id text;
begin
  if p_subscription is null or jsonb_typeof(p_subscription) <> 'object' then
    return jsonb_build_object('outcome', 'not_applicable');
  end if;

  v_external_reference := p_subscription ->> 'externalReference';
  if v_external_reference is null or v_external_reference !~ (
    '^vimob:billing-card-recurrence:'
    || '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ) then
    return jsonb_build_object('outcome', 'not_applicable');
  end if;

  begin
    v_payment_id := replace(
      v_external_reference,
      'vimob:billing-card-recurrence:',
      ''
    )::uuid;
  exception
    when invalid_text_representation then
      return jsonb_build_object('outcome', 'not_applicable');
  end;

  select provision.provider_payment_id
  into v_provider_payment_id
  from private.billing_card_recurrence_provisions as provision
  where provision.payment_id = v_payment_id
    and provision.external_reference = v_external_reference;

  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;

  return private.complete_billing_card_recurrence_locked(
    v_payment_id,
    v_provider_payment_id,
    null,
    p_subscription,
    false
  );
end
$function$;

revoke all on function public.reconcile_billing_card_recurrence_subscription(jsonb)
  from PUBLIC, anon, authenticated, service_role;
grant execute on function public.reconcile_billing_card_recurrence_subscription(jsonb)
  to service_role;

-- Keep the proven atomic persistence body, but place an immutable-identity
-- gate in front of every caller (public refresh RPC and the Go reconciler).
-- Canonical organization access semantics for every polling caller. The
-- semantic precedence gate prevents a same-second paid snapshot (or an older
-- polling cursor) from overwriting a reversal/adverse state.
create or replace function private.apply_asaas_billing_snapshot(
  p_organization_id uuid,
  p_provider_customer_id text,
  p_provider_subscription_id text,
  p_provider_subscription_status text,
  p_latest_payment_status text,
  p_next_billing_date date,
  p_observed_at timestamptz,
  p_source text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_org public.organizations%rowtype;
  v_provider_status text := upper(btrim(coalesce(p_provider_subscription_status, '')));
  v_payment_status text := upper(btrim(coalesce(p_latest_payment_status, '')));
  v_current_payment_status text;
  v_new_status text;
  v_cursor timestamptz;
  v_observed_at timestamptz := least(coalesce(p_observed_at, now()), now());
  v_source text := left(coalesce(nullif(btrim(p_source), ''), 'reconciliation'), 80);
begin
  select organization_row.*
  into v_org
  from public.organizations as organization_row
  where organization_row.id = p_organization_id
  for update;

  if not found then
    return jsonb_build_object('outcome', 'organization_not_found');
  end if;
  if nullif(btrim(v_org.asaas_customer_id), '') is not null
     and nullif(btrim(p_provider_customer_id), '') is not null
     and btrim(v_org.asaas_customer_id) <> btrim(p_provider_customer_id) then
    return jsonb_build_object('outcome', 'identifier_mismatch', 'field', 'customer');
  end if;
  if nullif(btrim(v_org.asaas_subscription_id), '') is not null
     and nullif(btrim(p_provider_subscription_id), '') is not null
     and btrim(v_org.asaas_subscription_id) <> btrim(p_provider_subscription_id) then
    return jsonb_build_object('outcome', 'identifier_mismatch', 'field', 'subscription');
  end if;

  select payment.status
  into v_current_payment_status
  from public.asaas_payments as payment
  where payment.organization_id = p_organization_id
    and (
      nullif(btrim(coalesce(p_provider_subscription_id, '')), '') is null
      or payment.asaas_subscription_id
        = nullif(btrim(p_provider_subscription_id), '')
    )
  order by coalesce(
    greatest(
      payment.last_webhook_received_at,
      payment.last_webhook_event_at,
      payment.last_provider_observed_at
    ),
    payment.updated_at,
    payment.created_at
  ) desc, payment.id desc
  limit 1;

  v_cursor := greatest(
    v_org.billing_last_reconciled_at,
    v_org.asaas_last_event_received_at,
    v_org.asaas_last_event_at
  );
  if v_cursor > v_observed_at
     or (
       v_cursor = v_observed_at
       and private.asaas_payment_status_precedence(v_payment_status)
         <= private.asaas_payment_status_precedence(v_current_payment_status)
     ) then
    return jsonb_build_object(
      'outcome', 'stale',
      'status', v_org.subscription_status
    );
  elsif v_cursor = v_observed_at then
    v_observed_at := least(v_cursor, now());
  end if;

  v_new_status := v_org.subscription_status;
  if v_provider_status in ('INACTIVE', 'CANCELLED', 'CANCELED', 'DELETED', 'EXPIRED') then
    v_new_status := 'cancelled';
  elsif lower(btrim(coalesce(v_org.subscription_status, ''))) in ('cancelled', 'canceled') then
    v_new_status := v_org.subscription_status;
  else
    v_new_status := private.asaas_organization_status_from_payment(
      v_org.subscription_status,
      v_payment_status
    );
  end if;

  update public.organizations
  set
    subscription_status = v_new_status,
    asaas_customer_id = coalesce(nullif(btrim(p_provider_customer_id), ''), asaas_customer_id),
    asaas_subscription_id = coalesce(nullif(btrim(p_provider_subscription_id), ''), asaas_subscription_id),
    next_billing_date = coalesce(p_next_billing_date, next_billing_date),
    billing_last_reconciled_at = v_observed_at,
    updated_at = now()
  where id = p_organization_id;

  update private.asaas_reconciliation_jobs
  set
    status = 'pending',
    attempts = 0,
    next_attempt_at = now() + interval '5 minutes',
    locked_at = null,
    locked_by = null,
    last_succeeded_at = now(),
    last_error = null,
    last_provider_status = nullif(v_provider_status, ''),
    last_payment_status = nullif(v_payment_status, ''),
    updated_at = now()
  where organization_id = p_organization_id;

  insert into public.subscription_logs (organization_id, event_type, status, metadata)
  values (
    p_organization_id,
    'asaas_reconciled',
    v_new_status,
    jsonb_build_object(
      'source', v_source,
      'provider_subscription_status', nullif(v_provider_status, ''),
      'latest_payment_status', nullif(v_payment_status, ''),
      'observed_at', v_observed_at
    )
  );

  return jsonb_build_object(
    'outcome', 'applied',
    'previous_status', v_org.subscription_status,
    'status', v_new_status,
    'observed_at', v_observed_at
  );
end
$function$;

revoke all on function private.apply_asaas_billing_snapshot(
  uuid, text, text, text, text, date, timestamptz, text
) from PUBLIC, anon, authenticated, service_role;

-- This prevents subscription activation from running before a mismatched
-- provider amount/customer/payment has been rejected.
alter function private.apply_asaas_billing_snapshot_with_payment(
  uuid,
  text,
  text,
  text,
  text,
  text,
  numeric,
  date,
  date,
  timestamptz,
  text
) rename to persist_asaas_billing_snapshot_after_exact_validation;

revoke all on function private.persist_asaas_billing_snapshot_after_exact_validation(
  uuid,
  text,
  text,
  text,
  text,
  text,
  numeric,
  date,
  date,
  timestamptz,
  text
) from PUBLIC, anon, authenticated, service_role;

create or replace function private.apply_asaas_billing_snapshot_with_payment(
  p_organization_id uuid,
  p_provider_customer_id text,
  p_provider_subscription_id text,
  p_provider_subscription_status text,
  p_latest_payment_id text,
  p_latest_payment_status text,
  p_latest_payment_amount numeric,
  p_latest_payment_due_date date,
  p_next_billing_date date,
  p_observed_at timestamptz,
  p_source text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_payment_id text := nullif(btrim(coalesce(p_latest_payment_id, '')), '');
  v_customer_id text := nullif(btrim(coalesce(p_provider_customer_id, '')), '');
  v_subscription_id text := nullif(
    btrim(coalesce(p_provider_subscription_id, '')),
    ''
  );
  v_payment_status text := upper(nullif(
    btrim(coalesce(p_latest_payment_status, '')),
    ''
  ));
  v_source text := lower(nullif(btrim(coalesce(p_source, '')), ''));
  v_payment public.asaas_payments%rowtype;
  v_intent private.billing_checkout_intents%rowtype;
  v_org public.organizations%rowtype;
  v_subscription public.subscriptions%rowtype;
  v_plan public.admin_subscription_plans%rowtype;
  v_plan_change private.billing_plan_changes%rowtype;
  v_expected_amount numeric;
  v_period integer;
  v_result jsonb;
  v_organization_status text;
begin
  if p_organization_id is null
     or v_payment_id is null
     or v_customer_id is null
     or char_length(v_payment_id) > 255
     or char_length(v_customer_id) > 255
     or char_length(coalesce(v_subscription_id, '')) > 255 then
    return jsonb_build_object('outcome', 'invalid_identity');
  end if;
  if v_payment_status is null
     or p_latest_payment_amount is null
     or p_latest_payment_amount::text in ('NaN', 'Infinity', '-Infinity')
     or p_latest_payment_amount <= 0
     or p_latest_payment_due_date is null then
    return jsonb_build_object('outcome', 'invalid_payment_snapshot');
  end if;
  if p_observed_at is null or p_observed_at > now() + interval '5 minutes' then
    return jsonb_build_object('outcome', 'invalid_observed_at');
  end if;
  if v_source is null
     or char_length(v_source) > 80
     or v_source !~ '^[a-z0-9][a-z0-9_:-]*$' then
    return jsonb_build_object('outcome', 'invalid_source');
  end if;

  perform private.lock_asaas_billing_resources(
    v_payment_id,
    v_subscription_id
  );

  select payment.*
  into v_payment
  from public.asaas_payments as payment
  where payment.asaas_payment_id = v_payment_id
  for update;

  if not found then
    -- Periodic reconciliation is the recovery path when the invoice webhook
    -- was lost. Bootstrap only an exact, already-linked recurring tuple. A
    -- customer-only match, a hidden/uncommitted catalog price, or a fuzzy
    -- organization inference remains fail-closed.
    if v_subscription_id is null then
      return jsonb_build_object('outcome', 'payment_not_found');
    end if;

    select organization_row.*
    into v_org
    from public.organizations as organization_row
    where organization_row.id = p_organization_id
      and nullif(btrim(coalesce(organization_row.asaas_customer_id, '')), '')
        = v_customer_id
      and nullif(btrim(coalesce(organization_row.asaas_subscription_id, '')), '')
        = v_subscription_id
    for update;
    if not found then
      return jsonb_build_object(
        'outcome', 'identifier_mismatch',
        'field', 'recurring_organization'
      );
    end if;
    select subscription.*
    into v_subscription
    from public.subscriptions as subscription
    where subscription.organization_id = p_organization_id
      and lower(btrim(coalesce(subscription.provider, ''))) = 'asaas'
      and subscription.provider_customer_id = v_customer_id
      and subscription.provider_subscription_id = v_subscription_id
      and lower(btrim(coalesce(subscription.status, ''))) not in (
        'cancelled', 'canceled', 'inactive', 'expired'
      )
    for update;
    if not found
       or v_subscription.plan_id is null
       or v_org.plan_id is distinct from v_subscription.plan_id then
      return jsonb_build_object(
        'outcome', 'identifier_mismatch',
        'field', 'recurring_subscription'
      );
    end if;

    select plan_change.*
    into v_plan_change
    from private.billing_plan_changes as plan_change
    where plan_change.organization_id = p_organization_id
      and plan_change.provider_subscription_id = v_subscription_id
      and plan_change.status in ('scheduled', 'provider_updating', 'applying')
      and plan_change.from_plan_id = v_org.plan_id
      and plan_change.amount = p_latest_payment_amount
      and (
        plan_change.effective_on is null
        or p_latest_payment_due_date >= plan_change.effective_on
      )
    order by plan_change.created_at desc, plan_change.id desc
    limit 1
    for update;

    if found then
      v_period := v_plan_change.billing_period_months;
      v_expected_amount := v_plan_change.amount;
      select plan.*
      into v_plan
      from public.admin_subscription_plans as plan
      where plan.id = v_plan_change.target_plan_id
      for share;
    else
      v_period := coalesce(
        v_subscription.billing_period_months,
        v_org.subscription_billing_period_months
      );
      if v_period not in (1, 6, 12) then
        return jsonb_build_object('outcome', 'invalid_billing_period');
      end if;

      select plan.*
      into v_plan
      from public.admin_subscription_plans as plan
      where plan.id = v_subscription.plan_id
        and plan.is_active
      for share;
      if found then
        v_expected_amount := round(v_plan.price * v_period, 2);
      end if;
    end if;

    if v_plan.id is null then
      return jsonb_build_object('outcome', 'plan_not_found');
    end if;
    if v_expected_amount is distinct from p_latest_payment_amount then
      return jsonb_build_object('outcome', 'amount_mismatch');
    end if;

    insert into public.asaas_payments (
      organization_id,
      asaas_payment_id,
      asaas_customer_id,
      asaas_subscription_id,
      status,
      value,
      due_date,
      raw_event
    ) values (
      p_organization_id,
      v_payment_id,
      v_customer_id,
      v_subscription_id,
      'PENDING',
      p_latest_payment_amount,
      p_latest_payment_due_date,
      jsonb_build_object(
        'vimob_recurring_invoice_bootstrap', jsonb_build_object(
          'source', v_source,
          'observed_at', p_observed_at,
          'plan_id', v_plan.id,
          'billing_period_months', v_period,
          'billing_plan_change_id', v_plan_change.id
        )
      )
    )
    on conflict (asaas_payment_id) do nothing
    returning * into v_payment;

    if not found then
      select payment.*
      into v_payment
      from public.asaas_payments as payment
      where payment.asaas_payment_id = v_payment_id
      for update;
    end if;
    if not found then
      return jsonb_build_object('outcome', 'bootstrap_race_lost');
    end if;
  end if;
  if v_payment.organization_id is distinct from p_organization_id then
    return jsonb_build_object(
      'outcome', 'identifier_mismatch',
      'field', 'organization'
    );
  end if;
  if nullif(btrim(coalesce(v_payment.asaas_customer_id, '')), '')
       is distinct from v_customer_id then
    return jsonb_build_object(
      'outcome', 'identifier_mismatch',
      'field', 'customer'
    );
  end if;
  if nullif(btrim(coalesce(v_payment.asaas_subscription_id, '')), '')
       is distinct from v_subscription_id then
    return jsonb_build_object(
      'outcome', 'identifier_mismatch',
      'field', 'subscription'
    );
  end if;

  -- Numeric is exact in Postgres. Do not use a floating tolerance here: a
  -- provider amount must equal the immutable local payment and intent tuple.
  if v_payment.value is null
     or v_payment.value is distinct from p_latest_payment_amount then
    return jsonb_build_object(
      'outcome', 'amount_mismatch',
      'field', 'payment'
    );
  end if;

  if v_payment.billing_intent_id is not null then
    select intent.*
    into v_intent
    from private.billing_checkout_intents as intent
    where intent.id = v_payment.billing_intent_id
      and intent.organization_id = v_payment.organization_id
    for update;

    if not found
       or v_intent.provider_payment_id is distinct from v_payment_id
       or v_intent.provider_customer_id is distinct from v_customer_id then
      return jsonb_build_object(
        'outcome', 'identifier_mismatch',
        'field', 'billing_intent_snapshot'
      );
    end if;
    if v_intent.amount is distinct from p_latest_payment_amount then
      return jsonb_build_object(
        'outcome', 'amount_mismatch',
        'field', 'billing_intent'
      );
    end if;
  end if;

  -- Inbound confirmation must survive concurrent deactivation. Hold the
  -- tenant tombstone row through persistence so cleanup observes the complete
  -- payment evidence; this function never reactivates organizations.is_active.
  select organization_row.*
  into v_org
  from public.organizations as organization_row
  where organization_row.id = p_organization_id
  for update;
  if not found then
    return jsonb_build_object('outcome', 'organization_not_found');
  end if;

  v_result := private.persist_asaas_billing_snapshot_after_exact_validation(
    p_organization_id,
    v_customer_id,
    v_subscription_id,
    p_provider_subscription_status,
    v_payment_id,
    v_payment_status,
    p_latest_payment_amount,
    p_latest_payment_due_date,
    p_next_billing_date,
    p_observed_at,
    v_source
  );

  if coalesce(v_result ->> 'outcome', '') = 'applied' then
    select organization_row.subscription_status
    into v_organization_status
    from public.organizations as organization_row
    where organization_row.id = p_organization_id;

    if private.billing_payment_checkout_is_paid(v_payment_status) then
      v_organization_status := private.reconcile_billing_payment_access_proof(
        p_organization_id,
        v_payment_id,
        v_organization_status,
        v_payment_status
      );
      update public.organizations
      set subscription_status = v_organization_status, updated_at = now()
      where id = p_organization_id
        and lower(btrim(coalesce(subscription_status, ''))) not in (
          'cancelled', 'canceled'
        );
      update public.subscriptions
      set status = v_organization_status, updated_at = now()
      where organization_id = p_organization_id
        and provider_subscription_id is not distinct from v_subscription_id
        and lower(btrim(coalesce(status, ''))) not in ('cancelled', 'canceled');
      v_result := v_result || jsonb_build_object('status', v_organization_status);
    end if;

    if lower(btrim(coalesce(v_organization_status, ''))) in (
         'pending_payment', 'overdue', 'past_due', 'blocked', 'suspended'
       )
       and not private.billing_payment_checkout_is_paid(v_payment_status) then
      insert into private.billing_organization_access_causes (
        organization_id,
        provider_payment_id,
        payment_status,
        observed_at,
        source
      ) values (
        p_organization_id,
        v_payment_id,
        v_payment_status,
        least(p_observed_at, now()),
        v_source
      )
      on conflict (organization_id, provider_payment_id) do update
      set
        provider_payment_id = excluded.provider_payment_id,
        payment_status = excluded.payment_status,
        observed_at = excluded.observed_at,
        source = excluded.source,
        updated_at = now()
      where excluded.observed_at > private.billing_organization_access_causes.observed_at
         or (
           excluded.observed_at = private.billing_organization_access_causes.observed_at
           and private.asaas_payment_status_precedence(excluded.payment_status)
             > private.asaas_payment_status_precedence(
               private.billing_organization_access_causes.payment_status
             )
         );
    end if;
  end if;

  -- Stale/duplicate polling evidence is intentionally ignored, but callers
  -- still need the authoritative access state. Never return a status-less
  -- response that can be mistaken for an unknown transition.
  if not (coalesce(v_result, '{}'::jsonb) ? 'status') then
    select organization_row.subscription_status
    into v_organization_status
    from public.organizations as organization_row
    where organization_row.id = p_organization_id;
    if found then
      v_result := coalesce(v_result, '{}'::jsonb)
        || jsonb_build_object('status', v_organization_status);
    end if;
  end if;

  return v_result;
end
$function$;

revoke all on function private.apply_asaas_billing_snapshot_with_payment(
  uuid,
  text,
  text,
  text,
  text,
  text,
  numeric,
  date,
  date,
  timestamptz,
  text
) from PUBLIC, anon, authenticated, service_role;

create or replace function public.reconcile_asaas_payment_method_change(
  p_payment_id uuid,
  p_organization_id uuid,
  p_billing_intent_id uuid,
  p_provider_payment_id text,
  p_provider_customer_id text,
  p_provider_subscription_id text,
  p_external_reference text,
  p_payment_amount numeric,
  p_expected_old_billing_type text,
  p_expected_old_status text,
  p_expected_old_due_date date,
  p_new_billing_type text,
  p_new_status text,
  p_new_due_date date,
  p_observed_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_provider_payment_id text := nullif(btrim(coalesce(p_provider_payment_id, '')), '');
  v_provider_customer_id text := nullif(btrim(coalesce(p_provider_customer_id, '')), '');
  v_provider_subscription_id text := nullif(
    btrim(coalesce(p_provider_subscription_id, '')),
    ''
  );
  v_external_reference text := nullif(btrim(coalesce(p_external_reference, '')), '');
  v_old_billing_type text := upper(nullif(
    btrim(coalesce(p_expected_old_billing_type, '')),
    ''
  ));
  v_old_status text := upper(nullif(
    btrim(coalesce(p_expected_old_status, '')),
    ''
  ));
  v_new_billing_type text := upper(nullif(
    btrim(coalesce(p_new_billing_type, '')),
    ''
  ));
  v_new_status text := upper(nullif(btrim(coalesce(p_new_status, '')), ''));
  v_payment public.asaas_payments%rowtype;
  v_org public.organizations%rowtype;
  v_intent private.billing_checkout_intents%rowtype;
  v_reconcile jsonb;
  v_persisted integer := 0;
begin
  if p_payment_id is null
     or p_organization_id is null
     or v_provider_payment_id is null
     or v_provider_customer_id is null
     or char_length(v_provider_payment_id) > 255
     or char_length(v_provider_customer_id) > 255
     or char_length(coalesce(v_provider_subscription_id, '')) > 255
     or char_length(coalesce(v_external_reference, '')) > 160
     or p_payment_amount is null
     or p_payment_amount::text in ('NaN', 'Infinity', '-Infinity')
     or p_payment_amount <= 0
     or p_expected_old_due_date is null
     or p_new_due_date is null
     or p_observed_at is null
     or p_observed_at > now() + interval '5 minutes' then
    return jsonb_build_object('outcome', 'invalid_input');
  end if;

  if v_old_billing_type not in ('PIX', 'BOLETO', 'CREDIT_CARD')
     or v_new_billing_type not in ('PIX', 'BOLETO', 'CREDIT_CARD')
     or v_old_billing_type = v_new_billing_type
     or not (
       private.billing_payment_checkout_is_actionable(v_old_status)
       or private.billing_payment_checkout_is_processing(v_old_status)
     )
     or not (
       private.billing_payment_checkout_is_actionable(v_new_status)
       or private.billing_payment_checkout_is_processing(v_new_status)
       or v_new_status in ('CONFIRMED', 'RECEIVED', 'RECEIVED_IN_CASH')
     ) then
    return jsonb_build_object('outcome', 'unsupported_transition');
  end if;

  -- Use the same global provider lock order as webhook and polling writers.
  perform private.lock_asaas_billing_resources(
    v_provider_payment_id,
    v_provider_subscription_id
  );

  select payment.*
  into v_payment
  from public.asaas_payments as payment
  where payment.id = p_payment_id
    and payment.asaas_payment_id = v_provider_payment_id
  for update;

  if not found then
    return jsonb_build_object('outcome', 'payment_not_found');
  end if;

  if v_payment.organization_id is distinct from p_organization_id then
    return jsonb_build_object(
      'outcome', 'identifier_mismatch',
      'field', 'organization'
    );
  end if;
  if nullif(btrim(coalesce(v_payment.asaas_customer_id, '')), '')
       is distinct from v_provider_customer_id then
    return jsonb_build_object(
      'outcome', 'identifier_mismatch',
      'field', 'customer'
    );
  end if;
  if nullif(btrim(coalesce(v_payment.asaas_subscription_id, '')), '')
       is distinct from v_provider_subscription_id then
    return jsonb_build_object(
      'outcome', 'identifier_mismatch',
      'field', 'subscription'
    );
  end if;
  if v_payment.billing_intent_id is distinct from p_billing_intent_id then
    return jsonb_build_object(
      'outcome', 'identifier_mismatch',
      'field', 'billing_intent'
    );
  end if;
  if v_payment.value is null
     or abs(v_payment.value - p_payment_amount) > 0.01 then
    return jsonb_build_object(
      'outcome', 'amount_mismatch'
    );
  end if;

  if v_payment.billing_intent_id is not null then
    select intent.*
    into v_intent
    from private.billing_checkout_intents as intent
    where intent.id = v_payment.billing_intent_id
      and intent.organization_id = v_payment.organization_id
    for update;

    if not found
       or v_intent.provider_payment_id is distinct from v_provider_payment_id
       or v_intent.provider_customer_id is distinct from v_provider_customer_id
       or v_intent.external_reference is distinct from v_external_reference
       or abs(v_intent.amount - p_payment_amount) > 0.01 then
      return jsonb_build_object(
        'outcome', 'identifier_mismatch',
        'field', 'billing_intent_snapshot'
      );
    end if;
  elsif p_billing_intent_id is not null or v_external_reference is not null then
    return jsonb_build_object(
      'outcome', 'identifier_mismatch',
      'field', 'billing_intent_snapshot'
    );
  end if;

  select organization_row.*
  into v_org
  from public.organizations as organization_row
  where organization_row.id = v_payment.organization_id
  for update;

  if not found then
    return jsonb_build_object('outcome', 'organization_not_found');
  end if;
  if nullif(btrim(coalesce(v_org.asaas_customer_id, '')), '') is not null
     and nullif(btrim(v_org.asaas_customer_id), '')
       is distinct from v_provider_customer_id then
    return jsonb_build_object(
      'outcome', 'identifier_mismatch',
      'field', 'organization_customer'
    );
  end if;
  -- Idempotent success is accepted only when the complete provider snapshot
  -- already matches, never merely because the method happens to match. Check
  -- this before the monotonic cursor so a delayed retry of an applied snapshot
  -- is a harmless success without weakening stale, non-matching transitions.
  if upper(btrim(coalesce(v_payment.billing_type, ''))) = v_new_billing_type
     and upper(btrim(coalesce(v_payment.status, ''))) = v_new_status
     and v_payment.due_date is not distinct from p_new_due_date then
    if v_new_billing_type = 'CREDIT_CARD'
       and private.billing_payment_checkout_is_paid(v_new_status) then
      -- The status transition may have been applied while the old method was
      -- still Pix/boleto. Queue only after the exact method snapshot is known
      -- to be CREDIT_CARD, including recovery of a lost successful response.
      update private.billing_card_recurrence_provisions as provision
      set
        status = case
          when provision.status = 'failed' then 'prepared'
          else provision.status
        end,
        job_action = 'create',
        job_status = 'pending',
        job_attempts = 0,
        job_next_attempt_at = clock_timestamp(),
        job_locked_at = null,
        job_lock_expires_at = null,
        job_locked_by = null,
        job_lease_id = null,
        job_dead_lettered_at = null,
        job_last_error_code = null,
        failed_at = null,
        last_error = null,
        updated_at = clock_timestamp()
      where provision.payment_id = v_payment.id
        and provision.provider_payment_id = v_provider_payment_id
        and provision.organization_id = p_organization_id
        and provision.billing_intent_id is not distinct from p_billing_intent_id
        and provision.provider_subscription_id is null
        and provision.status in ('prepared', 'failed')
        and provision.provider_card_credential is not null;
    end if;

    if v_old_billing_type = 'CREDIT_CARD'
       and v_new_billing_type in ('PIX', 'BOLETO') then
      -- A card credential is scoped to the exact method attempt. Replaying an
      -- already-applied non-card snapshot must also close an abandoned
      -- credential left by a response lost before this migration completed.
      update private.billing_card_recurrence_provisions as provision
      set
        status = 'failed',
        provider_card_credential = null,
        card_last4 = null,
        lease_id = null,
        lease_expires_at = null,
        failed_at = coalesce(provision.failed_at, clock_timestamp()),
        last_error = 'payment_method_changed_non_card',
        job_action = 'create',
        job_status = 'cancelled',
        job_locked_at = null,
        job_lock_expires_at = null,
        job_locked_by = null,
        job_lease_id = null,
        job_dead_lettered_at = null,
        job_last_error_code = 'payment_method_changed_non_card',
        updated_at = clock_timestamp()
      where provision.payment_id = v_payment.id
        and provision.provider_payment_id = v_provider_payment_id
        and provision.organization_id = p_organization_id
        and provision.billing_intent_id is not distinct from p_billing_intent_id
        and provision.provider_subscription_id is null
        and (
          provision.status in ('prepared', 'failed')
          or (
            provision.status = 'creating'
            and provision.provider_request_started_at is null
          )
        );
    end if;

    return jsonb_build_object(
      'outcome', 'already_updated',
      'payment_id', v_payment.id,
      'billing_type', v_new_billing_type
    );
  end if;

  if coalesce(
       greatest(v_payment.last_webhook_event_at, v_payment.last_provider_observed_at),
       '-infinity'::timestamptz
     ) > p_observed_at
     or coalesce(
       greatest(v_org.billing_last_reconciled_at, v_org.asaas_last_event_at),
       '-infinity'::timestamptz
     ) > p_observed_at then
    return jsonb_build_object('outcome', 'stale_snapshot');
  end if;

  if upper(btrim(coalesce(v_payment.billing_type, ''))) <> v_old_billing_type then
    return jsonb_build_object(
      'outcome', 'snapshot_mismatch',
      'field', 'billing_type'
    );
  end if;
  if upper(btrim(coalesce(v_payment.status, ''))) <> v_old_status then
    return jsonb_build_object(
      'outcome', 'snapshot_mismatch',
      'field', 'status'
    );
  end if;
  if v_payment.due_date is distinct from p_expected_old_due_date then
    return jsonb_build_object(
      'outcome', 'snapshot_mismatch',
      'field', 'due_date'
    );
  end if;

  v_reconcile := private.apply_asaas_billing_snapshot_with_payment(
    p_organization_id,
    v_provider_customer_id,
    v_provider_subscription_id,
    null::text,
    v_provider_payment_id,
    v_new_status,
    p_payment_amount,
    p_new_due_date,
    null::date,
    p_observed_at,
    'edge_payment_method_change'
  );

  if coalesce(v_reconcile ->> 'outcome', '') <> 'applied' then
    raise exception 'payment method reconciliation failed: %', v_reconcile
      using errcode = '40001';
  end if;

  update public.asaas_payments as payment
  set
    billing_type = v_new_billing_type,
    raw_event = jsonb_set(
      coalesce(payment.raw_event, '{}'::jsonb),
      '{last_provider_snapshot}',
      coalesce(payment.raw_event -> 'last_provider_snapshot', '{}'::jsonb)
        || jsonb_build_object(
          'billing_type', v_new_billing_type,
          'previous_billing_type', v_old_billing_type
        ),
      true
    ),
    updated_at = now()
  where payment.id = v_payment.id
    and payment.organization_id = p_organization_id
    and payment.asaas_payment_id = v_provider_payment_id
    and payment.asaas_customer_id = v_provider_customer_id
    and nullif(btrim(coalesce(payment.asaas_subscription_id, '')), '')
      is not distinct from v_provider_subscription_id
    and payment.billing_intent_id is not distinct from p_billing_intent_id
    and abs(payment.value - p_payment_amount) <= 0.01
    and upper(btrim(coalesce(payment.status, ''))) = v_new_status
    and payment.due_date is not distinct from p_new_due_date
    and upper(btrim(coalesce(payment.billing_type, ''))) = v_old_billing_type;

  get diagnostics v_persisted = row_count;
  if v_persisted <> 1 then
    raise exception 'payment method snapshot lost its compare-and-set race'
      using errcode = '40001';
  end if;

  if v_new_billing_type = 'CREDIT_CARD'
     and private.billing_payment_checkout_is_paid(v_new_status) then
    -- `apply_asaas_billing_snapshot_with_payment` runs before the billing-type
    -- CAS, so its status trigger correctly refuses to enqueue while the old
    -- method is non-card. Enqueue now that both fields won the exact CAS.
    update private.billing_card_recurrence_provisions as provision
    set
      status = case
        when provision.status = 'failed' then 'prepared'
        else provision.status
      end,
      job_action = 'create',
      job_status = 'pending',
      job_attempts = 0,
      job_next_attempt_at = clock_timestamp(),
      job_locked_at = null,
      job_lock_expires_at = null,
      job_locked_by = null,
      job_lease_id = null,
      job_dead_lettered_at = null,
      job_last_error_code = null,
      failed_at = null,
      last_error = null,
      updated_at = clock_timestamp()
    where provision.payment_id = v_payment.id
      and provision.provider_payment_id = v_provider_payment_id
      and provision.organization_id = p_organization_id
      and provision.billing_intent_id is not distinct from p_billing_intent_id
      and provision.provider_subscription_id is null
      and provision.status in ('prepared', 'failed')
      and provision.provider_card_credential is not null;
  end if;

  if v_old_billing_type = 'CREDIT_CARD'
     and v_new_billing_type in ('PIX', 'BOLETO') then
    -- This runs in the same transaction and under the same exact payment CAS
    -- as the provider snapshot. A token sealed for the abandoned card attempt
    -- can therefore never become a future subscription after Pix/boleto wins.
    update private.billing_card_recurrence_provisions as provision
    set
      status = 'failed',
      provider_card_credential = null,
      card_last4 = null,
      lease_id = null,
      lease_expires_at = null,
      failed_at = coalesce(provision.failed_at, clock_timestamp()),
      last_error = 'payment_method_changed_non_card',
      job_action = 'create',
      job_status = 'cancelled',
      job_locked_at = null,
      job_lock_expires_at = null,
      job_locked_by = null,
      job_lease_id = null,
      job_dead_lettered_at = null,
      job_last_error_code = 'payment_method_changed_non_card',
      updated_at = clock_timestamp()
    where provision.payment_id = v_payment.id
      and provision.provider_payment_id = v_provider_payment_id
      and provision.organization_id = p_organization_id
      and provision.billing_intent_id is not distinct from p_billing_intent_id
      and provision.provider_subscription_id is null
      and (
        provision.status in ('prepared', 'failed')
        or (
          provision.status = 'creating'
          and provision.provider_request_started_at is null
        )
      );
  end if;

  return jsonb_build_object(
    'outcome', 'updated',
    'payment_id', v_payment.id,
    'billing_type', v_new_billing_type,
    'payment_status', v_new_status,
    'payment_due_date', p_new_due_date
  );
end
$function$;

revoke all on function public.reconcile_asaas_payment_method_change(
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  numeric,
  text,
  text,
  date,
  text,
  text,
  date,
  timestamptz
) from PUBLIC, anon, authenticated, service_role;
grant execute on function public.reconcile_asaas_payment_method_change(
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  numeric,
  text,
  text,
  date,
  text,
  text,
  date,
  timestamptz
) to service_role;

create or replace function public.reconcile_asaas_payment_snapshot(
  p_organization_id uuid,
  p_provider_payment_id text,
  p_provider_customer_id text,
  p_provider_subscription_id text,
  p_payment_status text,
  p_payment_amount numeric,
  p_payment_due_date date,
  p_observed_at timestamptz,
  p_source text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_payment_id text := nullif(btrim(coalesce(p_provider_payment_id, '')), '');
  v_customer_id text := nullif(btrim(coalesce(p_provider_customer_id, '')), '');
  v_subscription_id text := nullif(btrim(coalesce(p_provider_subscription_id, '')), '');
  v_status text := upper(nullif(btrim(coalesce(p_payment_status, '')), ''));
  v_source text := lower(nullif(btrim(coalesce(p_source, '')), ''));
  v_payment public.asaas_payments%rowtype;
  v_org public.organizations%rowtype;
  v_subscription public.subscriptions%rowtype;
  v_plan public.admin_subscription_plans%rowtype;
  v_plan_change private.billing_plan_changes%rowtype;
  v_expected_amount numeric;
  v_period integer;
  v_cursor timestamptz;
  v_effective_observed_at timestamptz := p_observed_at;
  v_effective_paid_status text;
  v_result jsonb;
  v_new_organization_status text;
  v_refund_denied_reactivates boolean := false;
begin
  if p_organization_id is null
     or v_payment_id is null
     or v_customer_id is null
     or char_length(v_payment_id) > 255
     or char_length(v_customer_id) > 255
     or char_length(coalesce(v_subscription_id, '')) > 255 then
    return jsonb_build_object('outcome', 'invalid_identity');
  end if;

  if v_status is null or v_status not in (
    'CREATED',
    'PENDING',
    'AWAITING_RISK_ANALYSIS',
    'AUTHORIZED',
    'PROCESSING',
    'CONFIRMED',
    'RECEIVED',
    'RECEIVED_IN_CASH',
    'OVERDUE',
    'DUNNING_REQUESTED',
    'DUNNING_RECEIVED',
    'CREDIT_CARD_CAPTURE_REFUSED',
    'CANCELED',
    'CANCELLED',
    'DELETED',
    'BANK_SLIP_CANCELLED',
    'REFUNDED',
    'REFUND_REQUESTED',
    'REFUND_IN_PROGRESS',
    'REFUND_DENIED',
    'PARTIALLY_REFUNDED',
    'RECEIVED_IN_CASH_UNDONE',
    'REPROVED_BY_RISK_ANALYSIS',
    'CHARGEBACK',
    'CHARGEBACK_REQUESTED',
    'CHARGEBACK_DISPUTE',
    'AWAITING_CHARGEBACK_REVERSAL'
  ) then
    return jsonb_build_object('outcome', 'unsupported_status');
  end if;

  if p_payment_amount is null
     or p_payment_amount::text in ('NaN', 'Infinity', '-Infinity')
     or p_payment_amount <= 0
     or p_payment_due_date is null then
    return jsonb_build_object('outcome', 'invalid_payment_snapshot');
  end if;

  if p_observed_at is null or p_observed_at > now() + interval '5 minutes' then
    return jsonb_build_object('outcome', 'invalid_observed_at');
  end if;

  if v_source is null
     or char_length(v_source) > 80
     or v_source !~ '^[a-z0-9][a-z0-9_:-]*$' then
    return jsonb_build_object('outcome', 'invalid_source');
  end if;

  -- Match webhook/provider reconciliation ordering: advisory provider locks
  -- always precede the payment row lock. The nested apply helper reacquires
  -- these transaction-scoped locks safely and cannot invert the order.
  perform private.lock_asaas_billing_resources(
    v_payment_id,
    v_subscription_id
  );

  select payment.*
  into v_payment
  from public.asaas_payments as payment
  where payment.asaas_payment_id = v_payment_id
  for update;

  if not found then
    -- Polling can discover a recurring invoice whose webhook was lost. Bootstrap
    -- only an exact, already-linked org/customer/subscription/plan/period tuple;
    -- no customer-only or fuzzy tenant resolution is allowed.
    if v_subscription_id is null then
      return jsonb_build_object('outcome', 'payment_not_found');
    end if;

    select organization_row.*
    into v_org
    from public.organizations as organization_row
    where organization_row.id = p_organization_id
      and nullif(btrim(coalesce(organization_row.asaas_customer_id, '')), '')
        = v_customer_id
      and nullif(btrim(coalesce(organization_row.asaas_subscription_id, '')), '')
        = v_subscription_id
    for update;

    if not found then
      return jsonb_build_object(
        'outcome', 'identifier_mismatch',
        'field', 'recurring_organization'
      );
    end if;
    select subscription.*
    into v_subscription
    from public.subscriptions as subscription
    where subscription.organization_id = p_organization_id
      and lower(btrim(coalesce(subscription.provider, ''))) = 'asaas'
      and subscription.provider_customer_id = v_customer_id
      and subscription.provider_subscription_id = v_subscription_id
      and lower(btrim(coalesce(subscription.status, ''))) not in (
        'cancelled', 'canceled', 'inactive', 'expired'
      )
    for update;

    if not found
       or v_subscription.plan_id is null
       or v_org.plan_id is distinct from v_subscription.plan_id then
      return jsonb_build_object(
        'outcome', 'identifier_mismatch',
        'field', 'recurring_subscription'
      );
    end if;

    -- A provider-updating/scheduled plan change is an immutable commercial
    -- commitment even if the catalog target was hidden afterwards. Match it
    -- only by the exact organization+subscription+amount+period boundary;
    -- an earlier invoice at the current-plan amount keeps the current plan.
    select plan_change.*
    into v_plan_change
    from private.billing_plan_changes as plan_change
    where plan_change.organization_id = p_organization_id
      and plan_change.provider_subscription_id = v_subscription_id
      and plan_change.status in ('provider_updating', 'scheduled', 'applying')
      and plan_change.from_plan_id = v_org.plan_id
      and plan_change.amount = p_payment_amount
      and (
        plan_change.effective_on is null
        or p_payment_due_date >= plan_change.effective_on
      )
    order by plan_change.created_at desc, plan_change.id desc
    limit 1
    for update;

    if found then
      v_period := v_plan_change.billing_period_months;
      v_expected_amount := v_plan_change.amount;
      select plan.*
      into v_plan
      from public.admin_subscription_plans as plan
      where plan.id = v_plan_change.target_plan_id
      for share;
    else
      v_period := coalesce(
        v_subscription.billing_period_months,
        v_org.subscription_billing_period_months
      );
      if v_period not in (1, 6, 12) then
        return jsonb_build_object('outcome', 'invalid_billing_period');
      end if;

      select plan.*
      into v_plan
      from public.admin_subscription_plans as plan
      where plan.id = v_subscription.plan_id
        and plan.is_active
      for share;
      if found then
        v_expected_amount := round(v_plan.price * v_period, 2);
      end if;
    end if;

    if v_plan.id is null then
      return jsonb_build_object('outcome', 'plan_not_found');
    end if;
    if v_expected_amount is distinct from p_payment_amount then
      return jsonb_build_object('outcome', 'amount_mismatch');
    end if;

    insert into public.asaas_payments (
      organization_id,
      asaas_payment_id,
      asaas_customer_id,
      asaas_subscription_id,
      status,
      value,
      due_date,
      raw_event
    ) values (
      p_organization_id,
      v_payment_id,
      v_customer_id,
      v_subscription_id,
      'PENDING',
      p_payment_amount,
      p_payment_due_date,
      jsonb_build_object(
        'vimob_recurring_invoice_bootstrap', jsonb_build_object(
          'source', v_source,
          'observed_at', p_observed_at,
          'plan_id', v_plan.id,
          'billing_period_months', v_period,
          'billing_plan_change_id', v_plan_change.id
        )
      )
    )
    on conflict (asaas_payment_id) do nothing
    returning * into v_payment;

    if not found then
      select payment.*
      into v_payment
      from public.asaas_payments as payment
      where payment.asaas_payment_id = v_payment_id
      for update;
    end if;

    if not found then
      return jsonb_build_object('outcome', 'bootstrap_race_lost');
    end if;
  end if;

  if v_payment.organization_id is distinct from p_organization_id then
    return jsonb_build_object(
      'outcome', 'identifier_mismatch',
      'field', 'organization'
    );
  end if;

  if v_payment.asaas_customer_id is not null
     and btrim(v_payment.asaas_customer_id) <> v_customer_id then
    return jsonb_build_object(
      'outcome', 'identifier_mismatch',
      'field', 'customer'
    );
  end if;

  if v_payment.asaas_subscription_id is not null
     and (
       v_subscription_id is null
       or btrim(v_payment.asaas_subscription_id) <> v_subscription_id
     ) then
    return jsonb_build_object(
      'outcome', 'identifier_mismatch',
      'field', 'subscription'
    );
  end if;

  if v_payment.billing_intent_id is not null then
    select intent.amount
    into v_expected_amount
    from private.billing_checkout_intents as intent
    where intent.id = v_payment.billing_intent_id
      and intent.organization_id = p_organization_id;

    if not found or abs(v_expected_amount - p_payment_amount) > 0.01 then
      return jsonb_build_object('outcome', 'amount_mismatch');
    end if;
  end if;

  select organization_row.*
  into v_org
  from public.organizations as organization_row
  where organization_row.id = p_organization_id
  for update;

  if not found then
    return jsonb_build_object('outcome', 'organization_not_found');
  end if;

  v_cursor := greatest(
    v_payment.last_webhook_received_at,
    v_payment.last_webhook_event_at,
    v_payment.last_provider_observed_at,
    v_org.billing_last_reconciled_at,
    v_org.asaas_last_event_received_at,
    v_org.asaas_last_event_at
  );
  if v_cursor > p_observed_at
     or (
       v_cursor = p_observed_at
       and private.asaas_payment_status_precedence(v_status)
         <= private.asaas_payment_status_precedence(v_payment.status)
     ) then
    return jsonb_build_object(
      'outcome', 'stale_snapshot',
      'payment_status', upper(btrim(coalesce(v_payment.status, '')))
    );
  elsif v_cursor = p_observed_at then
    v_effective_observed_at := least(v_cursor, now());
  end if;

  if v_status = 'REFUND_DENIED' then
    v_effective_paid_status := case
      when private.billing_payment_checkout_is_paid(v_payment.status)
        and upper(btrim(v_payment.status)) <> 'REFUND_DENIED'
      then upper(btrim(v_payment.status))
      when upper(coalesce(
        v_payment.raw_event #>> '{vimob_ordering,effective_paid_status_before_adverse}',
        ''
      )) in ('CONFIRMED', 'RECEIVED', 'RECEIVED_IN_CASH')
      then upper(v_payment.raw_event #>> '{vimob_ordering,effective_paid_status_before_adverse}')
      else null
    end;

    if v_effective_paid_status is null then
      select case event.event_type
        when 'PAYMENT_RECEIVED' then 'RECEIVED'
        when 'PAYMENT_RECEIVED_IN_CASH' then 'RECEIVED_IN_CASH'
        else 'CONFIRMED'
      end
      into v_effective_paid_status
      from private.asaas_webhook_events as event
      where event.resource_type = 'payment'
        and event.resource_id = v_payment_id
        and event.event_type in (
          'PAYMENT_CONFIRMED',
          'PAYMENT_RECEIVED',
          'PAYMENT_RECEIVED_IN_CASH'
        )
        and event.outcome = 'processed'
      order by event.provider_event_at desc, event.received_at desc
      limit 1;
    end if;

    if v_effective_paid_status is null
       and (
         v_payment.payment_date is not null
         or exists (
           select 1
           from private.billing_checkout_intents as intent
           where intent.id = v_payment.billing_intent_id
             and intent.organization_id = v_payment.organization_id
             and intent.status = 'confirmed'
         )
       ) then
      v_effective_paid_status := 'CONFIRMED';
    end if;

    v_effective_paid_status := coalesce(v_effective_paid_status, 'REFUND_DENIED');

    update public.asaas_payments as payment
    set
      status = v_effective_paid_status,
      raw_event = jsonb_set(
        coalesce(payment.raw_event, '{}'::jsonb),
        '{vimob_refund_denied}',
        jsonb_build_object(
          'provider_status', 'REFUND_DENIED',
          'source', v_source,
          'observed_at', p_observed_at,
          'effective_status', v_effective_paid_status
        ),
        true
      ),
      last_provider_observed_at = greatest(
        payment.last_provider_observed_at,
        p_observed_at
      ),
      updated_at = now()
    where payment.id = v_payment.id;

    -- A refund request may have queued cancellation before Asaas denied it.
    -- Cancel only jobs whose provider DELETE has not started (pending/retry);
    -- an in-flight cancellation is surfaced for assisted repair.
    update private.billing_card_recurrence_provisions as provision
    set
      job_action = 'create',
      job_status = 'succeeded',
      job_locked_at = null,
      job_lock_expires_at = null,
      job_locked_by = null,
      job_lease_id = null,
      job_last_error_code = null,
      updated_at = now()
    where provision.payment_id = v_payment.id
      and provision.status = 'completed'
      and provision.job_action = 'cancel'
      and provision.job_status in ('pending', 'retry');

    v_new_organization_status := private.reconcile_billing_payment_access_proof(
      v_org.id,
      v_payment_id,
      v_org.subscription_status,
      'REFUND_DENIED'
    );
    v_refund_denied_reactivates :=
      v_new_organization_status = 'active'
      and lower(btrim(coalesce(v_org.subscription_status, ''))) not in (
        'active', 'trial'
      );

    if lower(btrim(coalesce(v_org.subscription_status, ''))) not in (
      'cancelled', 'canceled'
    ) then
      update public.organizations
      set subscription_status = v_new_organization_status, updated_at = now()
      where id = v_org.id
        and lower(btrim(coalesce(subscription_status, ''))) not in (
          'cancelled', 'canceled'
        );
      update public.subscriptions
      set status = v_new_organization_status, updated_at = now()
      where organization_id = v_org.id
        and provider_subscription_id is not distinct from v_subscription_id
        and lower(btrim(coalesce(status, ''))) not in ('cancelled', 'canceled');

    end if;

    insert into public.subscription_logs (
      organization_id, event_type, status, metadata
    ) values (
      v_org.id,
      'asaas_refund_denied_observed',
      coalesce(v_effective_paid_status, v_payment.status),
      jsonb_build_object(
        'provider_payment_id', v_payment_id,
        'source', v_source,
        'observed_at', p_observed_at,
        'effective_status_preserved', true,
        'access_reactivated', v_refund_denied_reactivates,
        'access_status', v_new_organization_status
      )
    );

    return jsonb_build_object(
      'outcome', 'applied',
      'payment_id', v_payment_id,
      'provider_status', 'REFUND_DENIED',
      'payment_status', v_effective_paid_status,
      'effective_status_preserved', true,
      'access_reactivated', v_refund_denied_reactivates,
      'subscription_status', v_new_organization_status
    );
  end if;

  v_result := private.apply_asaas_billing_snapshot_with_payment(
    p_organization_id,
    v_customer_id,
    v_subscription_id,
    null::text,
    v_payment_id,
    v_status,
    p_payment_amount,
    p_payment_due_date,
    null::date,
    v_effective_observed_at,
    v_source
  );

  if coalesce(v_result ->> 'outcome', '') = 'applied' then
    update public.asaas_payments as payment
    set raw_event = jsonb_set(
      coalesce(payment.raw_event, '{}'::jsonb),
      '{vimob_ordering}',
      coalesce(payment.raw_event -> 'vimob_ordering', '{}'::jsonb)
        || jsonb_build_object(
          'provider_observed_at', p_observed_at,
          'ordering_observed_at', v_effective_observed_at,
          'source', v_source,
          'effective_paid_status_before_adverse', case
            when private.billing_payment_checkout_is_paid(v_payment.status)
              and private.asaas_payment_status_precedence(v_status) >= 450
            then upper(btrim(v_payment.status))
            else payment.raw_event #>> '{vimob_ordering,effective_paid_status_before_adverse}'
          end
        ),
      true
    )
    where payment.id = v_payment.id;
  end if;

  return v_result;
end
$function$;

revoke all on function public.reconcile_asaas_payment_snapshot(
  uuid,
  text,
  text,
  text,
  text,
  numeric,
  date,
  timestamptz,
  text
) from PUBLIC, anon, authenticated, service_role;
grant execute on function public.reconcile_asaas_payment_snapshot(
  uuid,
  text,
  text,
  text,
  text,
  numeric,
  date,
  timestamptz,
  text
) to service_role;

create or replace function public.get_billing_checkout_state(
  p_organization_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_intent private.billing_checkout_intents%rowtype;
  v_payment jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service_role required' using errcode = '42501';
  end if;
  if p_organization_id is null then
    raise exception 'organization is required' using errcode = '22023';
  end if;

  select intent.*
  into v_intent
  from private.billing_checkout_intents as intent
  where intent.organization_id = p_organization_id
    and intent.status in ('creating', 'pending')
  order by intent.created_at desc
  limit 1;

  if not found then
    return null;
  end if;

  select jsonb_build_object(
    'id', payment.asaas_payment_id,
    'status', payment.status,
    'billing_type', payment.billing_type,
    'value', payment.value,
    'due_date', payment.due_date,
    'payment_date', payment.payment_date,
    'invoice_url', payment.invoice_url,
    'bank_slip_registration_cancelled', (
      payment.bank_slip_registration_cancelled_at is not null
      and payment.bank_slip_registration_cancelled_due_date
        is not distinct from payment.due_date
    ),
    'bank_slip_registration_cancelled_due_date', case
      when payment.bank_slip_registration_cancelled_at is not null
        and payment.bank_slip_registration_cancelled_due_date
          is not distinct from payment.due_date
      then payment.bank_slip_registration_cancelled_due_date
      else null
    end,
    'updated_at', payment.updated_at
  )
  into v_payment
  from public.asaas_payments as payment
  where payment.organization_id = p_organization_id
    and payment.billing_intent_id = v_intent.id
  order by payment.updated_at desc nulls last,
    payment.created_at desc nulls last
  limit 1;

  return jsonb_build_object(
    'intent_id', v_intent.id,
    'organization_id', v_intent.organization_id,
    'plan_id', v_intent.pending_plan_id,
    'billing_method', v_intent.billing_method,
    'status', v_intent.status,
    'billing_period_months', v_intent.billing_period_months,
    'amount', v_intent.amount,
    'external_reference', v_intent.external_reference,
    'provider_customer_id', v_intent.provider_customer_id,
    'provider_payment_id', v_intent.provider_payment_id,
    'provider_subscription_id', v_intent.provider_subscription_id,
    'provider_checkout_id', v_intent.provider_checkout_id,
    'provider_request_started_at', v_intent.provider_request_started_at,
    'provider_status', coalesce(
      v_payment ->> 'status',
      nullif(v_intent.provider_response ->> 'status', '')
    ),
    'card_last4', case
      when coalesce(v_intent.provider_response ->> 'cardLast4', '') ~ '^[0-9]{4}$'
        then v_intent.provider_response ->> 'cardLast4'
      else null
    end,
    'has_error', v_intent.last_error is not null,
    'payment', v_payment,
    'created_at', v_intent.created_at,
    'updated_at', v_intent.updated_at
  );
end
$function$;

revoke all on function public.get_billing_checkout_state(uuid)
  from PUBLIC, anon, authenticated, service_role;
grant execute on function public.get_billing_checkout_state(uuid)
  to service_role;

comment on table public.billing_payment_checkout_capabilities is
  'Service-only, payment-scoped capabilities for Vimob-hosted billing checkout links.';
comment on column public.billing_payment_checkout_capabilities.checkout_token is
  'Opaque 256-bit capability. Never expose through anon/authenticated Data API access.';
comment on function public.resolve_billing_payment_checkout_capability(text) is
  'Service-only capability resolver. Never returns the raw checkout token.';
comment on function public.ensure_billing_payment_checkout_capability(uuid, uuid) is
  'Service-only issuance/rotation RPC. The BFF must authorize organization access before calling.';
comment on table private.billing_organization_checkout_card_attempt_limits is
  'Private capability-scoped card-attempt counters. Stores only SHA-256 capability digests, never raw checkout tokens.';
comment on table private.billing_ip_card_attempt_limits is
  'Private cross-tenant card-attempt counters keyed only by Edge-generated HMAC-SHA256 IP fingerprints; raw IPs are forbidden.';
comment on table private.billing_authenticated_org_card_attempt_limits is
  'Private authenticated organization/actor card-attempt counters for settings flows without a public checkout token.';
comment on table private.billing_payment_card_attempt_limits is
  'Private payment-identity card-attempt counters; token rotation cannot reset the payment budget.';
comment on function public.claim_organization_checkout_card_attempt(uuid, text, text) is
  'Service-only atomic pre-provider card-attempt claim. Increments independent capability and HMAC-IP windows and has no release path.';
comment on function public.claim_authenticated_organization_card_attempt(uuid, uuid, text) is
  'Service-only card-attempt claim for an active billing-authorized actor. Increments organization/actor and shared HMAC-IP windows before any provider mutation.';
comment on function public.claim_billing_payment_card_attempt_guard(uuid, text, text) is
  'Service-only payment checkout card guard. Increments immutable payment and shared HMAC-IP windows before the lease or provider POST; counters have no release path.';
comment on function public.claim_billing_payment_checkout_attempt(uuid, text) is
  'Atomically leases one public card attempt for a payment for five minutes; limited to five claims per 15-minute window and fenced against subscription cancellation.';
comment on function public.release_billing_payment_checkout_attempt(uuid, text, uuid) is
  'Releases only the exact active card-attempt lease; rate-limit counters remain intact.';
comment on table private.billing_card_recurrence_provisions is
  'Service-only durable state machine for creating one future card recurrence from one paid, one-off payment.';
comment on column private.billing_card_recurrence_provisions.external_reference is
  'Deterministic provider correlation key: vimob:billing-card-recurrence:<canonical payment UUID>.';
comment on column private.billing_card_recurrence_provisions.provider_card_credential is
  'Short-lived Edge AES-GCM envelope (AAD = payment UUID) containing only provider token plus required remoteIp; never plaintext card data or raw IP.';
comment on function public.prepare_billing_card_recurrence(uuid, text) is
  'Freezes the exact intent tuple before recurrence creation; idempotent for the same one-off payment and reports whether a sealed credential already exists.';
comment on function public.store_billing_card_recurrence_credential(uuid, text, uuid, text, text) is
  'Stores one opaque v1 AES-GCM recurrence credential under the exact live payment-attempt lease; SQL never receives provider token, remoteIp, PAN or CVV separately.';
comment on function public.mark_billing_card_capture_request_started(uuid, text, uuid) is
  'Durable exact-lease marker committed immediately before payWithCreditCard; after it exists every retry is GET/reconcile-only and no second POST is authorized.';
comment on function public.claim_billing_card_recurrence(uuid, text) is
  'Claims recurrence creation only after payment confirmation; returns and deletes the sealed credential exactly once, while ambiguous expired creates transition to recover-only.';
comment on function public.claim_billing_card_recurrence_by_provider_payment(text) is
  'Webhook-safe service-only wrapper that resolves one provider payment, preserves its local UUID on every resolved outcome and performs the canonical one-time recurrence claim.';
comment on function public.get_billing_card_recurrence_reversal_target(text) is
  'Service-only, idempotent resolver for the exact completed future subscription linked to a locally reversed initial payment; provider GET validation and DELETE remain backend responsibilities.';
comment on function public.mark_billing_card_recurrence_recovering(uuid, text, uuid, text) is
  'Marks an ambiguous provider result as recover-only and prevents an unsafe duplicate subscription POST.';
comment on function public.fail_billing_card_recurrence(uuid, text, uuid, text) is
  'Records a deterministic provider rejection, preserving bounded manual retry eligibility.';
comment on function public.fail_prepared_billing_card_recurrence(uuid, text) is
  'Service-only fail-closed terminalization for an exact recurrence provision that is still prepared and has no lease; accepts no sensitive provider payload.';
comment on function public.complete_billing_card_recurrence(uuid, text, uuid, jsonb) is
  'Atomically links an exact provider subscription to the intent, organization and public subscription without changing account status or the one-off payment subscription id.';
comment on function public.reconcile_billing_card_recurrence_subscription(jsonb) is
  'Webhook recovery path for an exact deterministic recurrence externalReference; never creates a provider subscription.';
comment on function private.apply_asaas_billing_snapshot_with_payment(
  uuid,
  text,
  text,
  text,
  text,
  text,
  numeric,
  date,
  date,
  timestamptz,
  text
) is 'Private exact-payment reconciliation gate shared by settings and periodic reconciliation; activation cannot precede immutable identity and amount validation.';
comment on function public.reconcile_asaas_payment_method_change(
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  numeric,
  text,
  text,
  date,
  text,
  text,
  date,
  timestamptz
) is 'Service-only exact compare-and-set for provider payment method changes; accepts paid card results and never trusts tenant, customer, subscription, intent, or amount from the caller.';
comment on function public.reconcile_asaas_payment_snapshot(
  uuid,
  text,
  text,
  text,
  text,
  numeric,
  date,
  timestamptz,
  text
) is 'Service-only exact-payment polling reconciler; payment due_date is persisted and next_billing_date is never inferred.';
comment on function public.get_billing_checkout_state(uuid) is
  'Service-only active checkout state with safe boleto-registration cancellation flags; raw provider events remain private.';

-- The payment webhook that is live at this point in the migration chain was
-- created before semantic status ordering existed. Keep its mature parsing and
-- persistence body as an internal implementation, then put the canonical
-- ordering/tenant-access gate on the real public entry point used by the Edge
-- webhook and by the period-intent wrapper.
alter function public.reconcile_asaas_payment_webhook(
  text, text, timestamptz, jsonb, jsonb
) rename to reconcile_asaas_payment_webhook_unordered_legacy;
alter function public.reconcile_asaas_payment_webhook_unordered_legacy(
  text, text, timestamptz, jsonb, jsonb
) set schema private;
revoke all on function private.reconcile_asaas_payment_webhook_unordered_legacy(
  text, text, timestamptz, jsonb, jsonb
) from PUBLIC, anon, authenticated, service_role;

create or replace function private.asaas_payment_status_from_event(
  p_event_type text,
  p_payload_status text
)
returns text
language sql
immutable
set search_path = ''
as $function$
  select case upper(btrim(coalesce(p_event_type, '')))
    when 'PAYMENT_CONFIRMED' then 'CONFIRMED'
    when 'PAYMENT_RECEIVED' then 'RECEIVED'
    when 'PAYMENT_RECEIVED_IN_CASH' then 'RECEIVED_IN_CASH'
    when 'PAYMENT_OVERDUE' then 'OVERDUE'
    when 'PAYMENT_DELETED' then 'DELETED'
    when 'PAYMENT_REFUNDED' then 'REFUNDED'
    when 'PAYMENT_REFUND_REQUESTED' then 'REFUND_REQUESTED'
    when 'PAYMENT_REFUND_IN_PROGRESS' then 'REFUND_IN_PROGRESS'
    when 'PAYMENT_REFUND_DENIED' then 'REFUND_DENIED'
    when 'PAYMENT_PARTIALLY_REFUNDED' then 'PARTIALLY_REFUNDED'
    when 'PAYMENT_RECEIVED_IN_CASH_UNDONE' then 'RECEIVED_IN_CASH_UNDONE'
    when 'PAYMENT_CHARGEBACK' then 'CHARGEBACK'
    when 'PAYMENT_CHARGEBACK_REQUESTED' then 'CHARGEBACK_REQUESTED'
    when 'PAYMENT_CHARGEBACK_DISPUTE' then 'CHARGEBACK_DISPUTE'
    when 'PAYMENT_AWAITING_CHARGEBACK_REVERSAL' then 'AWAITING_CHARGEBACK_REVERSAL'
    when 'PAYMENT_CREDIT_CARD_CAPTURE_REFUSED' then 'CREDIT_CARD_CAPTURE_REFUSED'
    when 'PAYMENT_REPROVED_BY_RISK_ANALYSIS' then 'REPROVED_BY_RISK_ANALYSIS'
    else coalesce(
      nullif(upper(btrim(coalesce(p_payload_status, ''))), ''),
      nullif(replace(upper(btrim(coalesce(p_event_type, ''))), 'PAYMENT_', ''), '')
    )
  end;
$function$;

revoke all on function private.asaas_payment_status_from_event(text, text)
  from PUBLIC, anon, authenticated, service_role;

create or replace function public.reconcile_asaas_payment_webhook(
  p_event_id text,
  p_event_type text,
  p_event_at timestamptz,
  p_payment jsonb,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_event_id text := btrim(coalesce(p_event_id, ''));
  v_event_type text := upper(btrim(coalesce(p_event_type, '')));
  v_payment_id text := btrim(coalesce(p_payment ->> 'id', ''));
  v_customer_id text := nullif(btrim(coalesce(p_payment ->> 'customer', '')), '');
  v_subscription_id text := nullif(btrim(coalesce(p_payment ->> 'subscription', '')), '');
  v_external_reference text := nullif(
    btrim(coalesce(p_payment ->> 'externalReference', '')),
    ''
  );
  v_status text := private.asaas_payment_status_from_event(
    p_event_type,
    p_payment ->> 'status'
  );
  v_event_at timestamptz := coalesce(
    private.correct_asaas_naive_event_timestamp(p_payload),
    p_event_at,
    clock_timestamp()
  );
  v_received_at timestamptz := clock_timestamp();
  v_payment public.asaas_payments%rowtype;
  v_prior_payment_status text;
  v_prior_org_status text;
  v_organization_id uuid;
  v_cursor timestamptz;
  v_is_stale boolean := false;
  v_inserted integer := 0;
  v_effective_paid_status text;
  v_new_org_status text;
  v_result jsonb;
  v_refund_denied_reactivates boolean := false;
  v_payment_applied boolean := false;
  v_override_suspended_stale boolean := false;
begin
  if char_length(v_event_id) not between 1 and 512 then
    raise exception 'Invalid Asaas webhook event id'
      using errcode = '22023';
  end if;
  if left(v_event_type, 8) <> 'PAYMENT_' then
    raise exception 'Unsupported Asaas webhook event type'
      using errcode = '22023';
  end if;
  if jsonb_typeof(p_payment) is distinct from 'object'
     or char_length(v_payment_id) not between 1 and 255 then
    raise exception 'Invalid Asaas webhook payment payload'
      using errcode = '22023';
  end if;
  if jsonb_typeof(p_payload) is distinct from 'object'
     or v_status is null then
    raise exception 'Invalid Asaas payment webhook'
      using errcode = '22023';
  end if;

  -- Every webhook/poller writer takes the same provider-key lock before a row
  -- lock. This serializes equal-second deliveries without a global bottleneck.
  perform private.lock_asaas_billing_resources(v_payment_id, v_subscription_id);

  select payment.*
  into v_payment
  from public.asaas_payments as payment
  where payment.asaas_payment_id = v_payment_id
  for update;

  if found then
    if v_customer_id is not null
       and v_payment.asaas_customer_id is not null
       and v_customer_id <> v_payment.asaas_customer_id then
      raise exception 'Asaas customer does not match the existing payment'
        using errcode = '22023';
    end if;
    if v_subscription_id is not null
       and v_payment.asaas_subscription_id is not null
       and v_subscription_id <> v_payment.asaas_subscription_id then
      raise exception 'Asaas subscription does not match the existing payment'
        using errcode = '22023';
    end if;

    v_organization_id := v_payment.organization_id;
    v_prior_payment_status := upper(btrim(coalesce(v_payment.status, '')));
    v_cursor := greatest(
      v_payment.last_webhook_event_at,
      v_payment.last_provider_observed_at
    );

    -- Provider chronology remains authoritative. For the only ambiguous case
    -- (the same second), a strictly stronger semantic state wins and equal or
    -- weaker delivery is a harmless no-op.
    v_is_stale := v_cursor is not null and (
      v_event_at < v_cursor
      or (
        v_event_at = v_cursor
        and private.asaas_payment_status_precedence(v_status)
          <= private.asaas_payment_status_precedence(v_prior_payment_status)
      )
    );
  end if;

  if v_organization_id is null
     and v_external_reference ~*
       '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    select organization_row.id
    into v_organization_id
    from public.organizations as organization_row
    where organization_row.id = v_external_reference::uuid
      and (
        organization_row.asaas_customer_id is null
        or v_customer_id is null
        or organization_row.asaas_customer_id = v_customer_id
      )
      and (
        organization_row.asaas_subscription_id is null
        or v_subscription_id is null
        or organization_row.asaas_subscription_id = v_subscription_id
      );
  end if;

  if v_organization_id is null and v_subscription_id is not null then
    select case when count(*) = 1 then min(id::text)::uuid end
    into v_organization_id
    from public.organizations
    where asaas_subscription_id = v_subscription_id;
  end if;

  if v_organization_id is null
     and v_subscription_id is null
     and v_customer_id is not null then
    select case when count(*) = 1 then min(id::text)::uuid end
    into v_organization_id
    from public.organizations
    where asaas_customer_id = v_customer_id;
  end if;

  -- Inbound provider evidence must still reconcile for an inactive tenant:
  -- PAID/refund/cancellation can materially change which remote deletion is
  -- safe. Hold the tenant row while the exact provider advisory keys are held
  -- so cleanup observes either the complete state before this event or the
  -- complete state after it. Outbound provider markers are fenced separately.
  if v_organization_id is not null then
    perform organization_row.id
    from public.organizations as organization_row
    where organization_row.id = v_organization_id
    for update;
  end if;

  if v_is_stale then
    insert into private.asaas_webhook_events (
      event_id, event_type, resource_type, resource_id, organization_id,
      provider_event_at, outcome, payload
    ) values (
      v_event_id, v_event_type, 'payment', v_payment_id, v_organization_id,
      v_event_at, 'stale', p_payload
    )
    on conflict (event_id) do nothing;
    get diagnostics v_inserted = row_count;
    return jsonb_build_object(
      'outcome', case when v_inserted = 0 then 'duplicate' else 'stale' end,
      'event_id', v_event_id,
      'payment_id', v_payment_id,
      'payment_status', v_prior_payment_status,
      'organization_id', v_organization_id,
      'subscription_status', (
        select organization_row.subscription_status
        from public.organizations as organization_row
        where organization_row.id = v_organization_id
      )
    );
  end if;

  -- REFUND_DENIED is an observation about a failed refund, not a payment
  -- reversal. Preserve the last proven paid state and access. If the paid
  -- event itself was missed, REFUND_DENIED is provider proof that funds had
  -- settled and is therefore a valid paid fallback.
  if v_status = 'REFUND_DENIED' and v_payment.id is not null then
    insert into private.asaas_webhook_events (
      event_id, event_type, resource_type, resource_id, organization_id,
      provider_event_at, outcome, payload
    ) values (
      v_event_id, v_event_type, 'payment', v_payment_id, v_organization_id,
      v_event_at, 'processed', p_payload
    )
    on conflict (event_id) do nothing;
    get diagnostics v_inserted = row_count;
    if v_inserted = 0 then
      return jsonb_build_object(
        'outcome', 'duplicate',
        'event_id', v_event_id,
        'payment_id', v_payment_id,
        'organization_id', v_organization_id
      );
    end if;

    if private.billing_payment_checkout_is_paid(v_prior_payment_status)
       and v_prior_payment_status <> 'REFUND_DENIED' then
      v_effective_paid_status := v_prior_payment_status;
    elsif upper(coalesce(
      v_payment.raw_event #>> '{vimob_ordering,effective_paid_status_before_adverse}',
      ''
    )) in ('CONFIRMED', 'RECEIVED', 'RECEIVED_IN_CASH') then
      v_effective_paid_status := upper(
        v_payment.raw_event #>> '{vimob_ordering,effective_paid_status_before_adverse}'
      );
    elsif v_payment.payment_date is not null then
      v_effective_paid_status := 'CONFIRMED';
    else
      select case event.event_type
        when 'PAYMENT_RECEIVED' then 'RECEIVED'
        when 'PAYMENT_RECEIVED_IN_CASH' then 'RECEIVED_IN_CASH'
        else 'CONFIRMED'
      end
      into v_effective_paid_status
      from private.asaas_webhook_events as event
      where event.resource_type = 'payment'
        and event.resource_id = v_payment_id
        and event.event_type in (
          'PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED', 'PAYMENT_RECEIVED_IN_CASH'
        )
        and event.outcome = 'processed'
      order by event.provider_event_at desc, event.received_at desc
      limit 1;
    end if;

    v_effective_paid_status := coalesce(v_effective_paid_status, 'REFUND_DENIED');

    update public.asaas_payments as payment
    set
      status = v_effective_paid_status,
      raw_event = jsonb_set(
        coalesce(payment.raw_event, '{}'::jsonb),
        '{vimob_refund_denied}',
        jsonb_build_object(
          'provider_status', 'REFUND_DENIED',
          'event_id', v_event_id,
          'observed_at', v_event_at,
          'effective_status', v_effective_paid_status
        ),
        true
      ),
      last_webhook_event_id = v_event_id,
      last_webhook_event_at = greatest(payment.last_webhook_event_at, v_event_at),
      last_webhook_received_at = v_received_at,
      updated_at = now()
    where payment.id = v_payment.id;

    select organization_row.subscription_status
    into v_prior_org_status
    from public.organizations as organization_row
    where organization_row.id = v_organization_id
    for update;

    v_new_org_status := private.reconcile_billing_payment_access_proof(
      v_organization_id,
      v_payment_id,
      v_prior_org_status,
      'REFUND_DENIED'
    );
    v_refund_denied_reactivates :=
      v_new_org_status = 'active'
      and lower(btrim(coalesce(v_prior_org_status, ''))) not in ('active', 'trial');

    if lower(btrim(coalesce(v_prior_org_status, ''))) not in (
         'cancelled', 'canceled'
       ) then
      update public.organizations
      set
        subscription_status = v_new_org_status,
        asaas_last_event_id = case
          when v_refund_denied_reactivates
            or lower(btrim(coalesce(v_prior_org_status, ''))) in ('active', 'trial')
          then v_event_id
          else asaas_last_event_id
        end,
        asaas_last_event_at = case
          when v_refund_denied_reactivates
            or lower(btrim(coalesce(v_prior_org_status, ''))) in ('active', 'trial')
          then greatest(asaas_last_event_at, v_event_at)
          else asaas_last_event_at
        end,
        asaas_last_event_received_at = case
          when v_refund_denied_reactivates
            or lower(btrim(coalesce(v_prior_org_status, ''))) in ('active', 'trial')
          then v_received_at
          else asaas_last_event_received_at
        end,
        updated_at = now()
      where id = v_organization_id;
      update public.subscriptions
      set status = v_new_org_status, updated_at = now()
      where organization_id = v_organization_id
        and provider_subscription_id is not distinct from v_subscription_id
        and lower(btrim(coalesce(status, ''))) not in ('cancelled', 'canceled');

      if lower(btrim(coalesce(v_prior_org_status, ''))) in (
           'pending_payment', 'overdue', 'past_due', 'blocked', 'suspended'
         )
         and not v_refund_denied_reactivates then
        insert into public.error_events (
          organization_id,
          source,
          severity,
          fingerprint,
          message,
          category,
          error_code,
          component,
          metadata,
          occurred_at
        )
        select
          v_organization_id,
          'backend',
          'warning',
          'billing_refund_denied_conflict:' || v_organization_id::text || ':'
            || v_payment_id || ':' || v_event_id,
          'Refund denial preserved an unrelated billing restriction',
          'billing_reconciliation',
          'refund_denied_unrelated_suspension',
          'asaas_webhook_reconciliation',
          jsonb_build_object(
            'denied_refund_payment_id', v_payment_id,
            'remaining_causes', coalesce((
              select jsonb_agg(
                jsonb_build_object(
                  'provider_payment_id', cause.provider_payment_id,
                  'payment_status', cause.payment_status
                )
                order by cause.observed_at, cause.provider_payment_id
              )
              from private.billing_organization_access_causes as cause
              where cause.organization_id = v_organization_id
            ), '[]'::jsonb),
            'event_id', v_event_id
          ),
          v_received_at
        where not exists (
          select 1
          from public.error_events as existing
          where existing.fingerprint =
            'billing_refund_denied_conflict:' || v_organization_id::text || ':'
              || v_payment_id || ':' || v_event_id
        );
      end if;

      -- A denied refund only cancels a not-yet-started recurrence cancellation
      -- for this exact payment. An unrelated tenant suspension is untouched.
      update private.billing_card_recurrence_provisions as provision
      set
        job_action = 'create',
        job_status = 'succeeded',
        job_locked_at = null,
        job_lock_expires_at = null,
        job_locked_by = null,
        job_lease_id = null,
        job_last_error_code = null,
        updated_at = now()
      where provision.payment_id = v_payment.id
        and provision.status = 'completed'
        and provision.job_action = 'cancel'
        and provision.job_status in ('pending', 'retry');
    end if;

    return jsonb_build_object(
      'outcome', 'processed',
      'event_id', v_event_id,
      'payment_id', v_payment_id,
      'payment_status', v_effective_paid_status,
      'organization_id', v_organization_id,
      'subscription_status', v_new_org_status,
      'access_reactivated', v_refund_denied_reactivates
    );
  end if;

  if v_organization_id is not null then
    select organization_row.subscription_status
    into v_prior_org_status
    from public.organizations as organization_row
    where organization_row.id = v_organization_id;
  end if;

  v_result := private.reconcile_asaas_payment_webhook_unordered_legacy(
    v_event_id,
    v_event_type,
    v_event_at,
    p_payment || jsonb_build_object('status', v_status),
    p_payload
  );

  if coalesce(v_result ->> 'organization_id', '') ~*
       '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    v_organization_id := (v_result ->> 'organization_id')::uuid;

    if v_prior_org_status is null then
      select organization_row.subscription_status
      into v_prior_org_status
      from public.organizations as organization_row
      where organization_row.id = v_organization_id;
    end if;

    select exists (
      select 1
      from public.asaas_payments as payment
      where payment.asaas_payment_id = v_payment_id
        and payment.organization_id = v_organization_id
        and payment.last_webhook_event_id = v_event_id
        and payment.last_webhook_event_at = v_event_at
    ) into v_payment_applied;

    -- The legacy implementation intentionally froze every already-suspended
    -- tenant. Still reconcile each accepted payment into the private set of
    -- open restrictions: paid proof resolves only its own cause, while a new
    -- adverse observation adds a cause without loosening suspended access.
    v_override_suspended_stale :=
      coalesce(v_result ->> 'outcome', '') = 'stale'
      and v_payment_applied
      and lower(btrim(coalesce(v_prior_org_status, ''))) = 'suspended'
      and (
        private.billing_payment_checkout_is_paid(v_status)
        or private.billing_payment_checkout_is_reversal(v_status)
        or v_status in (
          'CREATED', 'PENDING', 'AWAITING_RISK_ANALYSIS', 'AUTHORIZED',
          'PROCESSING', 'OVERDUE', 'DUNNING_REQUESTED', 'DUNNING_RECEIVED',
          'BANK_SLIP_CANCELLED', 'CREDIT_CARD_CAPTURE_REFUSED',
          'REPROVED_BY_RISK_ANALYSIS'
        )
      );

    if coalesce(v_result ->> 'outcome', '') = 'processed'
       or v_override_suspended_stale then
    v_new_org_status := private.asaas_organization_status_from_payment(
      v_prior_org_status,
      v_status
    );

    if private.billing_payment_checkout_is_paid(v_status) then
      v_new_org_status := private.reconcile_billing_payment_access_proof(
        v_organization_id,
        v_payment_id,
        v_prior_org_status,
        v_status
      );
    elsif v_override_suspended_stale then
      v_new_org_status := 'suspended';
    end if;

    update public.organizations
    set
      subscription_status = v_new_org_status,
      asaas_last_event_id = v_event_id,
      asaas_last_event_at = greatest(asaas_last_event_at, v_event_at),
      asaas_last_event_received_at = v_received_at,
      updated_at = now()
    where id = v_organization_id;

    update public.subscriptions
    set
      status = case
        when lower(btrim(coalesce(status, ''))) in ('cancelled', 'canceled')
          then status
        else v_new_org_status
      end,
      updated_at = now()
    where organization_id = v_organization_id
      and (
        v_subscription_id is null
        or provider_subscription_id is null
        or provider_subscription_id = v_subscription_id
      );

    if lower(btrim(coalesce(v_new_org_status, ''))) in (
         'pending_payment', 'overdue', 'past_due', 'blocked', 'suspended'
       )
       and not private.billing_payment_checkout_is_paid(v_status) then
      insert into private.billing_organization_access_causes (
        organization_id,
        provider_payment_id,
        payment_status,
        observed_at,
        source
      ) values (
        v_organization_id,
        v_payment_id,
        v_status,
        v_event_at,
        'webhook'
      )
      on conflict (organization_id, provider_payment_id) do update
      set
        payment_status = excluded.payment_status,
        observed_at = excluded.observed_at,
        source = excluded.source,
        updated_at = now()
      where excluded.observed_at > private.billing_organization_access_causes.observed_at
         or (
           excluded.observed_at = private.billing_organization_access_causes.observed_at
           and private.asaas_payment_status_precedence(excluded.payment_status)
             > private.asaas_payment_status_precedence(
               private.billing_organization_access_causes.payment_status
             )
         );
    end if;

    update public.asaas_payments
    set last_webhook_received_at = v_received_at
    where asaas_payment_id = v_payment_id;

    if v_override_suspended_stale then
      update private.asaas_webhook_events
      set outcome = 'processed'
      where event_id = v_event_id;
    end if;

    v_result := v_result || jsonb_build_object(
      'outcome', 'processed',
      'payment_status', v_status,
      'subscription_status', v_new_org_status
    );
    end if;
  end if;

  return v_result;
end
$function$;

revoke all on function public.reconcile_asaas_payment_webhook(
  text, text, timestamptz, jsonb, jsonb
) from PUBLIC, anon, authenticated, service_role;
grant execute on function public.reconcile_asaas_payment_webhook(
  text, text, timestamptz, jsonb, jsonb
) to service_role;

comment on function public.reconcile_asaas_payment_webhook(
  text, text, timestamptz, jsonb, jsonb
) is 'Service-only ordered Asaas payment webhook. Exact provider locks plus semantic precedence make adverse equal-second delivery monotonic; REFUND_DENIED preserves settled access.';

-- POST /payments/{id}/restore is not idempotent at the provider. This claim is
-- the irreversible local boundary: after it commits no automated caller may
-- POST again. The same request (or a recovery worker) must GET the exact
-- provider payment and close state through reconcile_asaas_payment_snapshot.
create or replace function public.claim_billing_payment_restore(
  p_payment_id uuid,
  p_checkout_token text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_checkout_token text := nullif(btrim(coalesce(p_checkout_token, '')), '');
  v_payment public.asaas_payments%rowtype;
  v_capability public.billing_payment_checkout_capabilities%rowtype;
  v_status text;
  v_attempt_id uuid;
  v_started_at timestamptz;
begin
  if p_payment_id is null
     or v_checkout_token is null
     or char_length(v_checkout_token) <> 64
     or v_checkout_token !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('outcome', 'invalid_input');
  end if;

  select payment.*
  into v_payment
  from public.asaas_payments as payment
  where payment.id = p_payment_id;

  if not found then
    return jsonb_build_object('outcome', 'payment_not_found');
  end if;

  perform private.lock_asaas_billing_resources(
    v_payment.asaas_payment_id,
    null
  );

  select payment.*
  into v_payment
  from public.asaas_payments as payment
  where payment.id = p_payment_id
  for update;

  if not found then
    return jsonb_build_object('outcome', 'payment_not_found');
  end if;

  if private.billing_organization_cleanup_is_active(
    v_payment.organization_id,
    v_payment.asaas_subscription_id
  ) then
    return jsonb_build_object('outcome', 'organization_inactive');
  end if;

  select capability.*
  into v_capability
  from public.billing_payment_checkout_capabilities as capability
  where capability.payment_id = v_payment.id
    and capability.asaas_payment_id = v_payment.asaas_payment_id
    and capability.organization_id = v_payment.organization_id
    and capability.billing_intent_id is not distinct from v_payment.billing_intent_id
    and capability.checkout_token = v_checkout_token
    and capability.revoked_at is null
    and capability.expires_at > now()
  for update;

  if not found then
    return jsonb_build_object('outcome', 'capability_not_found');
  end if;

  if upper(btrim(coalesce(v_payment.billing_type, ''))) <> 'PIX' then
    return jsonb_build_object('outcome', 'payment_not_pix');
  end if;

  v_status := upper(btrim(coalesce(v_payment.status, '')));
  v_attempt_id := case
    when coalesce(v_payment.raw_event #>> '{vimob_restore,attempt_id}', '')
      ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    then (v_payment.raw_event #>> '{vimob_restore,attempt_id}')::uuid
    else null
  end;
  begin
    v_started_at := (v_payment.raw_event #>>
      '{vimob_restore,provider_request_started_at}')::timestamptz;
  exception
    when datetime_field_overflow or invalid_datetime_format then
      v_started_at := null;
  end;

  -- The irreversible marker wins over every local status. Once a caller was
  -- authorized to issue the provider POST, no replay may issue a second POST,
  -- even if a webhook/poll changed the local row before recovery resumed.
  if v_started_at is not null then
    return jsonb_build_object(
      'outcome', 'recover_only',
      'payment_id', v_payment.id,
      'provider_payment_id', v_payment.asaas_payment_id,
      'organization_id', v_payment.organization_id,
      'provider_customer_id', v_payment.asaas_customer_id,
      'provider_subscription_id', v_payment.asaas_subscription_id,
      'amount', v_payment.value,
      'due_date', v_payment.due_date,
      'payment_status', v_status,
      'attempt_id', v_attempt_id,
      'provider_request_started_at', v_started_at
    );
  end if;

  if private.billing_payment_checkout_is_processing(v_status)
     or private.billing_payment_checkout_is_paid(v_status) then
    return jsonb_build_object(
      'outcome', 'already_restored',
      'payment_id', v_payment.id,
      'provider_payment_id', v_payment.asaas_payment_id,
      'payment_status', v_status,
      'attempt_id', v_attempt_id
    );
  end if;

  -- The Edge function reaches this RPC only after an authenticated exact GET
  -- proved provider `deleted=true`. The local row will normally still be
  -- actionable: changing it to DELETED first would revoke the checkout bearer
  -- in sync_billing_payment_checkout_capability. Therefore both the normal
  -- actionable state and a still-active legacy DELETED capability may claim.
  if not private.billing_payment_checkout_is_actionable(v_status)
     and v_status <> 'DELETED' then
    return jsonb_build_object(
      'outcome', 'payment_not_deleted',
      'payment_status', v_status
    );
  end if;

  v_attempt_id := extensions.gen_random_uuid();
  v_started_at := clock_timestamp();
  update public.asaas_payments as payment
  set
    raw_event = jsonb_set(
      coalesce(payment.raw_event, '{}'::jsonb),
      '{vimob_restore}',
      jsonb_build_object(
        'attempt_id', v_attempt_id,
        'provider_request_started_at', v_started_at,
        'status_before_restore', v_status
      ),
      true
    ),
    updated_at = now()
  where payment.id = v_payment.id
    and (
      private.billing_payment_checkout_is_actionable(payment.status)
      or upper(btrim(coalesce(payment.status, ''))) = 'DELETED'
    )
    and payment.raw_event #>> '{vimob_restore,provider_request_started_at}' is null;

  if not found then
    return jsonb_build_object('outcome', 'recover_only');
  end if;

  return jsonb_build_object(
    'outcome', 'claimed',
    'payment_id', v_payment.id,
    'provider_payment_id', v_payment.asaas_payment_id,
    'organization_id', v_payment.organization_id,
    'provider_customer_id', v_payment.asaas_customer_id,
    'provider_subscription_id', v_payment.asaas_subscription_id,
    'amount', v_payment.value,
    'due_date', v_payment.due_date,
    'payment_status', v_status,
    'attempt_id', v_attempt_id,
    'provider_request_started_at', v_started_at
  );
end
$function$;

revoke all on function public.claim_billing_payment_restore(uuid, text)
  from PUBLIC, anon, authenticated, service_role;
grant execute on function public.claim_billing_payment_restore(uuid, text)
  to service_role;

comment on function public.claim_billing_payment_restore(uuid, text) is
  'Irreversible exact-capability claim for non-idempotent deleted PIX restoration. claimed authorizes one POST; every replay is recover_only until exact GET reconciliation proves restoration.';

-- Reuse the established immutable receipt builder, changing only its paid
-- predicate. This keeps snapshot/recipient behavior byte-for-byte identical
-- while allowing REFUND_DENIED to bootstrap a receipt when the original paid
-- webhook was lost.
do $receipt_paid_predicate$
declare
  v_definition text;
  v_needle text := $needle$if upper(coalesce(new.status, '')) not in ('RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH') then$needle$;
begin
  select pg_catalog.pg_get_functiondef(
    'private.create_billing_payment_receipt_from_payment()'::regprocedure
  ) into v_definition;
  if position(v_needle in v_definition) = 0 then
    raise exception 'billing receipt paid predicate contract changed unexpectedly';
  end if;
  execute replace(
    v_definition,
    v_needle,
    $replacement$if not private.billing_payment_checkout_is_paid(new.status) then$replacement$
  );
end
$receipt_paid_predicate$;

revoke all on function private.create_billing_payment_receipt_from_payment()
  from PUBLIC, anon, authenticated, service_role;

-- Exact local identity only: no CPF/email/customer inference participates in
-- this backfill. Assigning the same status invokes the immutable/idempotent
-- receipt trigger for financially paid rows that predate this predicate.
update public.asaas_payments as payment
set status = payment.status
where private.billing_payment_checkout_is_paid(payment.status)
  and not exists (
    select 1
    from public.billing_payment_receipts as receipt
    where receipt.payment_id = payment.id
      and receipt.organization_id = payment.organization_id
  );

-- Email-correction/restart is another cross-system (DB/Auth Admin) operation.
-- Fence it on the exact completed signup attempt instead of updating Auth and
-- tenant rows independently. Only the Go backend can read/write this table.
alter table private.public_signup_attempt_claims
  add column if not exists recovery_email text,
  add column if not exists recovery_token_hash text,
  add column if not exists recovery_expires_at timestamptz,
  add column if not exists recovery_started_at timestamptz;

alter table private.public_signup_attempt_claims
  drop constraint if exists public_signup_attempt_claims_status_check,
  drop constraint if exists public_signup_attempt_claims_state_check,
  add constraint public_signup_attempt_claims_status_check check (
    status in ('retryable', 'processing', 'compensating', 'completed', 'recovering')
  ),
  add constraint public_signup_attempt_claims_recovery_email_check check (
    recovery_email is null
    or (
      recovery_email = lower(btrim(recovery_email))
      and btrim(recovery_email) <> ''
    )
  ),
  add constraint public_signup_attempt_claims_recovery_token_hash_check check (
    recovery_token_hash is null or recovery_token_hash ~ '^[0-9a-f]{64}$'
  ),
  add constraint public_signup_attempt_claims_state_check check (
    (
      status = 'retryable'
      and lease_token is null
      and lease_expires_at is null
      and organization_id is null
      and completed_at is null
      and recovery_email is null
      and recovery_token_hash is null
      and recovery_expires_at is null
      and recovery_started_at is null
    )
    or (
      status in ('processing', 'compensating')
      and lease_token is not null
      and lease_expires_at is not null
      and organization_id is null
      and completed_at is null
      and recovery_email is null
      and recovery_token_hash is null
      and recovery_expires_at is null
      and recovery_started_at is null
    )
    or (
      status = 'completed'
      and lease_token is null
      and lease_expires_at is null
      and organization_id is not null
      and completed_at is not null
      and recovery_email is null
      and recovery_token_hash is null
      and recovery_expires_at is null
      and recovery_started_at is null
    )
    or (
      status = 'recovering'
      and lease_token is not null
      and lease_expires_at is not null
      and auth_user_id is not null
      and organization_id is not null
      and completed_at is not null
      and recovery_email is not null
      and recovery_token_hash is not null
      and recovery_expires_at is not null
      and recovery_started_at is not null
      and recovery_expires_at > recovery_started_at
    )
  );

create index if not exists public_signup_attempt_claims_email_recovery_idx
  on private.public_signup_attempt_claims (
    recovery_expires_at,
    lease_expires_at,
    attempt_id
  )
  where status = 'recovering';

revoke all on table private.public_signup_attempt_claims
  from PUBLIC, anon, authenticated, service_role;

-- Provider HTTP acceptance is not final email delivery. Reconcile the signed
-- Resend webhook result back to the exact notification/message tuple. A
-- negative terminal event is intentionally non-retryable here: an operator or
-- an explicit resend flow must decide whether a new message should be issued.
create or replace function private.sync_resend_delivery_to_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_is_failure boolean := lower(btrim(coalesce(new.status, ''))) in (
    'failed', 'suppressed', 'bounced', 'complained'
  );
  v_is_delivered boolean := lower(btrim(coalesce(new.status, ''))) = 'delivered';
  v_changed integer := 0;
  v_fingerprint text;
begin
  if new.provider <> 'resend'
     or new.notification_id is null
     or nullif(btrim(coalesce(new.provider_message_id, '')), '') is null
     or (not v_is_failure and not v_is_delivered) then
    return new;
  end if;

  update public.notifications as notification
  set metadata = jsonb_set(
    jsonb_set(
      coalesce(notification.metadata, '{}'::jsonb),
      '{dispatch,email}',
      (
        coalesce(notification.metadata #> '{dispatch,email}', '{}'::jsonb)
        || jsonb_build_object(
          'status', case when v_is_failure then 'delivery_failed' else 'delivered' end,
          'delivery_status', lower(btrim(new.status)),
          'provider', 'resend',
          'message_id', new.provider_message_id,
          'delivery_event_at', new.status_event_at,
          'alert_required', v_is_failure,
          'next_attempt_at', '',
          'error', case
            when v_is_failure then 'provider_' || lower(btrim(new.status))
            else ''
          end
        )
      )
        - 'claim_token'
        - 'claimed_at',
      true
    ),
    '{email_delivery_reconciled_at}',
    to_jsonb(coalesce(new.status_event_at, now())),
    true
  )
  where notification.id = new.notification_id
    and notification.organization_id is not distinct from new.organization_id
    and coalesce(notification.metadata #>> '{dispatch,email,provider}', 'resend') = 'resend'
    and notification.metadata #>> '{dispatch,email,message_id}' = new.provider_message_id
    and coalesce(notification.metadata #>> '{dispatch,email,status}', '') in (
      'accepted', 'sent', 'processing', 'delivery_failed'
    );
  get diagnostics v_changed = row_count;

  if v_is_failure and v_changed = 1 then
    v_fingerprint := 'resend_delivery:' || new.notification_id::text || ':'
      || new.provider_message_id || ':' || lower(btrim(new.status)) || ':'
      || coalesce(new.status_event_at::text, 'unknown');
    insert into public.error_events (
      organization_id,
      user_id,
      source,
      severity,
      fingerprint,
      message,
      category,
      error_code,
      component,
      metadata,
      occurred_at
    )
    select
      new.organization_id,
      new.user_id,
      'backend',
      'error',
      v_fingerprint,
      'Transactional email delivery requires assisted review',
      'notification_delivery',
      'resend_' || lower(btrim(new.status)),
      'resend_webhook_reconciliation',
      jsonb_build_object(
        'notification_id', new.notification_id,
        'email_log_id', new.id,
        'provider_status', lower(btrim(new.status))
      ),
      coalesce(new.status_event_at, now())
    where not exists (
      select 1
      from public.error_events as existing
      where existing.fingerprint = v_fingerprint
    );
  end if;

  return new;
end
$function$;

revoke all on function private.sync_resend_delivery_to_notification()
  from PUBLIC, anon, authenticated, service_role;

drop trigger if exists sync_resend_delivery_to_notification_insert
  on public.email_logs;
create trigger sync_resend_delivery_to_notification_insert
after insert
on public.email_logs
for each row
when (new.status_event_at is not null)
execute function private.sync_resend_delivery_to_notification();

drop trigger if exists sync_resend_delivery_to_notification_update
  on public.email_logs;
create trigger sync_resend_delivery_to_notification_update
after update of
  status,
  status_event_at,
  provider_message_id,
  notification_id,
  organization_id
on public.email_logs
for each row
when (
  new.status_event_at is not null
  and (
    new.status is distinct from old.status
    or new.status_event_at is distinct from old.status_event_at
    or new.provider_message_id is distinct from old.provider_message_id
    or new.notification_id is distinct from old.notification_id
  )
)
execute function private.sync_resend_delivery_to_notification();

comment on function private.sync_resend_delivery_to_notification() is
  'Maps a verified Resend terminal delivery event to one exact notification/message CAS; failures become assisted alerts and never auto-loop.';

-- Evolution delivery receipts arrive independently from the HTTP acceptance
-- that the notification worker persists. Match only the immutable tuple that
-- was stored before the HTTP request; never infer a notification by recipient,
-- session or mutable provider message aliases.
create or replace function private.reconcile_notification_whatsapp_delivery(
  p_organization_id uuid,
  p_expected_message_id text,
  p_status text,
  p_occurred_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_expected_message_id text := nullif(btrim(coalesce(p_expected_message_id, '')), '');
  v_provider_status text := lower(btrim(coalesce(p_status, '')));
  v_target_status text;
  v_ids uuid[];
  v_notification_id uuid;
  v_metadata jsonb;
  v_channel jsonb;
  v_current_status text;
  v_current_event_at timestamptz;
  v_current_event_text text;
  v_new_channel jsonb;
begin
  if p_organization_id is null
     or v_expected_message_id is null
     or char_length(v_expected_message_id) > 255
     or p_occurred_at is null
     or p_occurred_at > now() + interval '5 minutes'
     or v_provider_status not in ('delivered', 'read', 'failed') then
    return jsonb_build_object('outcome', 'invalid_status');
  end if;

  v_target_status := case
    when v_provider_status in ('delivered', 'read') then 'delivered'
    else 'delivery_failed'
  end;

  select array_agg(candidate.id order by candidate.id)
  into v_ids
  from (
    select notification.id
    from public.notifications as notification
    where notification.organization_id = p_organization_id
      and notification.metadata #>> '{dispatch,whatsapp,expected_message_id}'
        = v_expected_message_id
    order by notification.id
    limit 2
    for update
  ) as candidate;

  if coalesce(cardinality(v_ids), 0) = 0 then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  if cardinality(v_ids) <> 1 then
    return jsonb_build_object('outcome', 'ambiguous');
  end if;

  v_notification_id := v_ids[1];
  select coalesce(notification.metadata, '{}'::jsonb)
  into v_metadata
  from public.notifications as notification
  where notification.id = v_notification_id
    and notification.organization_id = p_organization_id;

  v_channel := coalesce(v_metadata #> '{dispatch,whatsapp}', '{}'::jsonb);
  v_current_status := lower(btrim(coalesce(v_channel ->> 'status', '')));
  v_current_event_text := coalesce(
    nullif(v_channel ->> 'delivery_occurred_at', ''),
    nullif(v_channel ->> 'delivered_at', ''),
    nullif(v_channel ->> 'failed_at', '')
  );
  if v_current_event_text is not null then
    begin
      v_current_event_at := v_current_event_text::timestamptz;
    exception
      when invalid_datetime_format or datetime_field_overflow then
        v_current_event_at := null;
    end;
  end if;

  if v_current_status = 'delivered' and v_target_status = 'delivery_failed' then
    return jsonb_build_object(
      'outcome', 'stale',
      'notification_id', v_notification_id,
      'status', v_current_status,
      'occurred_at', v_current_event_at
    );
  end if;
  if v_current_event_at is not null and p_occurred_at < v_current_event_at then
    return jsonb_build_object(
      'outcome', 'stale',
      'notification_id', v_notification_id,
      'status', v_current_status,
      'occurred_at', v_current_event_at
    );
  end if;
  if v_current_status = v_target_status
     and (v_current_event_at is null or p_occurred_at = v_current_event_at) then
    return jsonb_build_object(
      'outcome', 'already_applied',
      'notification_id', v_notification_id,
      'status', v_current_status,
      'occurred_at', coalesce(v_current_event_at, p_occurred_at)
    );
  end if;
  if v_current_status not in (
    'accepted', 'sent', 'processing', 'delivery_failed', 'delivered'
  ) then
    return jsonb_build_object(
      'outcome', 'stale',
      'notification_id', v_notification_id,
      'status', v_current_status
    );
  end if;

  v_new_channel := (
    v_channel
      - 'claim_token'
      - 'claimed_at'
  ) || jsonb_build_object(
    'required', true,
    'status', v_target_status,
    'delivery_status', v_provider_status,
    'delivery_occurred_at', p_occurred_at,
    'delivered_at', case
      when v_target_status = 'delivered' then to_jsonb(p_occurred_at)
      else v_channel -> 'delivered_at'
    end,
    'failed_at', case
      when v_target_status = 'delivery_failed' then to_jsonb(p_occurred_at)
      else v_channel -> 'failed_at'
    end,
    'next_attempt_at', '',
    'error', case
      when v_target_status = 'delivery_failed' then 'provider_delivery_failed'
      else ''
    end,
    'updated_at', now()
  );

  update public.notifications as notification
  set metadata = v_metadata || jsonb_build_object(
    'dispatch', coalesce(v_metadata -> 'dispatch', '{}'::jsonb)
      || jsonb_build_object('whatsapp', v_new_channel),
    'whatsapp_dispatch_required', true,
    'whatsapp_dispatch', v_new_channel,
    'whatsapp_delivery_reconciled_at', p_occurred_at
  )
  where notification.id = v_notification_id
    and notification.organization_id = p_organization_id
    and notification.metadata #>> '{dispatch,whatsapp,expected_message_id}'
      = v_expected_message_id;

  if not found then
    return jsonb_build_object('outcome', 'stale');
  end if;

  return jsonb_build_object(
    'outcome', 'applied',
    'notification_id', v_notification_id,
    'status', v_target_status,
    'occurred_at', p_occurred_at
  );
end
$function$;

revoke all on function private.reconcile_notification_whatsapp_delivery(
  uuid, text, text, timestamptz
) from PUBLIC, anon, authenticated, service_role;
grant execute on function private.reconcile_notification_whatsapp_delivery(
  uuid, text, text, timestamptz
) to service_role;

comment on function private.reconcile_notification_whatsapp_delivery(
  uuid, text, text, timestamptz
) is 'Reconciles one verified Evolution terminal receipt by exact organization and pre-persisted expected message id; failures are terminal and never auto-retried.';

-- Deleting a one-off PIX or BOLETO payment is also an irreversible provider
-- mutation. Keep it separate from subscription deletion because its frozen
-- identity and its paid-race recovery have different semantics.
create table if not exists private.billing_payment_checkout_cancellations (
  intent_id uuid primary key
    references private.billing_checkout_intents (id) on delete cascade,
  payment_id uuid not null unique
    references public.asaas_payments (id) on delete cascade,
  organization_id uuid not null
    references public.organizations (id) on delete cascade,
  provider_payment_id text not null unique,
  provider_customer_id text not null,
  external_reference text not null,
  amount numeric(10, 2) not null,
  billing_type text not null,
  due_date date not null,
  claim_token uuid not null,
  lease_owner text not null,
  claimed_at timestamptz not null,
  lease_expires_at timestamptz not null,
  claim_attempts integer not null default 1,
  max_attempts integer not null default 8,
  last_error_code text,
  provider_delete_started_at timestamptz,
  provider_delete_claim_token uuid,
  provider_deleted_at timestamptz,
  provider_delete_result text,
  finalized_at timestamptz,
  final_outcome text,
  paid_won_at timestamptz,
  manual_review_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint billing_payment_checkout_cancellations_payment_id_check
    check (
      provider_payment_id = btrim(provider_payment_id)
      and char_length(provider_payment_id) between 1 and 255
    ),
  constraint billing_payment_checkout_cancellations_customer_id_check
    check (
      provider_customer_id = btrim(provider_customer_id)
      and char_length(provider_customer_id) between 1 and 255
    ),
  constraint billing_payment_checkout_cancellations_reference_check
    check (
      external_reference = btrim(external_reference)
      and char_length(external_reference) between 1 and 255
    ),
  constraint billing_payment_checkout_cancellations_amount_check
    check (amount > 0),
  constraint billing_payment_checkout_cancellations_billing_type_check
    check (billing_type in ('PIX', 'BOLETO')),
  constraint billing_payment_checkout_cancellations_lease_check
    check (
      lease_owner = btrim(lease_owner)
      and char_length(lease_owner) between 1 and 100
      and lease_expires_at > claimed_at
    ),
  constraint billing_payment_checkout_cancellations_attempts_check
    check (
      claim_attempts between 1 and 30
      and max_attempts between 1 and 30
    ),
  constraint billing_payment_checkout_cancellations_error_code_check
    check (
      last_error_code is null
      or last_error_code ~ '^[a-z0-9_]{1,80}$'
    ),
  constraint billing_payment_checkout_cancellations_delete_result_check
    check (
      provider_delete_result is null
      or provider_delete_result in ('deleted', 'not_found')
    ),
  constraint billing_payment_checkout_cancellations_delete_marker_check
    check (
      (
        provider_delete_started_at is null
        and provider_delete_claim_token is null
      )
      or (
        provider_delete_started_at is not null
        and provider_delete_claim_token = claim_token
        and provider_delete_started_at >= created_at
      )
    ),
  constraint billing_payment_checkout_cancellations_delete_timeline_check
    check (
      provider_deleted_at is null
      or provider_delete_started_at is null
      or provider_deleted_at >= provider_delete_started_at
    ),
  constraint billing_payment_checkout_cancellations_outcome_check
    check (
      final_outcome is null
      or final_outcome in (
        'cancelled', 'paid_before_delete', 'paid_after_delete', 'manual_review'
      )
    ),
  constraint billing_payment_checkout_cancellations_final_state_check
    check (
      (
        finalized_at is null
        and provider_deleted_at is null
        and provider_delete_result is null
        and final_outcome is null
        and paid_won_at is null
        and manual_review_at is null
      )
      or (
        finalized_at is not null
        and final_outcome is not null
        and (
          (
            final_outcome = 'paid_before_delete'
            and provider_deleted_at is null
            and provider_delete_result is null
            and paid_won_at is not null
            and manual_review_at is null
          )
          or (
            final_outcome = 'manual_review'
            and paid_won_at is null
            and manual_review_at is not null
            and (
              (
                provider_deleted_at is null
                and provider_delete_result is null
              )
              or (
                provider_deleted_at is not null
                and provider_delete_result is not null
              )
            )
          )
          or (
            provider_deleted_at is not null
            and provider_delete_result is not null
            and (
              (final_outcome = 'cancelled' and paid_won_at is null)
              or (
                final_outcome = 'paid_after_delete'
                and paid_won_at is not null
              )
            )
            and manual_review_at is null
          )
        )
      )
    )
);

create index if not exists billing_payment_checkout_cancellations_recovery_idx
  on private.billing_payment_checkout_cancellations (
    lease_expires_at, intent_id
  )
  where finalized_at is null;

alter table private.billing_payment_checkout_cancellations
  enable row level security;
revoke all privileges on table private.billing_payment_checkout_cancellations
  from PUBLIC, anon, authenticated, service_role;

create or replace function public.claim_billing_payment_checkout_cancellation(
  p_organization_id uuid,
  p_intent_id uuid,
  p_provider_payment_id text,
  p_lease_owner text,
  p_lease_seconds integer default 600
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_provider_payment_id text := nullif(
    btrim(coalesce(p_provider_payment_id, '')),
    ''
  );
  v_lease_owner text := nullif(btrim(coalesce(p_lease_owner, '')), '');
  v_payment public.asaas_payments%rowtype;
  v_capability public.billing_payment_checkout_capabilities%rowtype;
  v_claim private.billing_payment_checkout_cancellations%rowtype;
  v_org public.organizations%rowtype;
  v_intent private.billing_checkout_intents%rowtype;
  v_claim_found boolean := false;
  v_now timestamptz := clock_timestamp();
  v_claimed_at timestamptz := now();
  v_lease_expires_at timestamptz;
  v_claim_token uuid;
  v_customer_id text;
  v_billing_type text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service_role required' using errcode = '42501';
  end if;
  if p_organization_id is null
     or p_intent_id is null
     or v_provider_payment_id is null
     or v_lease_owner is null
     or char_length(v_provider_payment_id) > 255
     or char_length(v_lease_owner) > 100
     or p_lease_seconds not between 30 and 600 then
    return jsonb_build_object('outcome', 'invalid_request');
  end if;

  perform private.lock_asaas_billing_resources(v_provider_payment_id, null);

  -- Common provider-mutation order: payment -> capability -> cancellation ->
  -- organization -> intent.
  select payment.*
  into v_payment
  from public.asaas_payments as payment
  where payment.organization_id = p_organization_id
    and payment.billing_intent_id = p_intent_id
    and payment.asaas_payment_id = v_provider_payment_id
  for update;
  if not found then
    return jsonb_build_object('outcome', 'payment_not_found');
  end if;

  select capability.*
  into v_capability
  from public.billing_payment_checkout_capabilities as capability
  where capability.payment_id = v_payment.id
    and capability.asaas_payment_id = v_payment.asaas_payment_id
    and capability.organization_id = v_payment.organization_id
    and capability.billing_intent_id is not distinct from v_payment.billing_intent_id
  for update;

  select cancellation.*
  into v_claim
  from private.billing_payment_checkout_cancellations as cancellation
  where cancellation.intent_id = p_intent_id
    and cancellation.organization_id = p_organization_id
  for update;
  v_claim_found := found;

  select organization.*
  into v_org
  from public.organizations as organization
  where organization.id = p_organization_id
  for update;
  if not found then
    return jsonb_build_object('outcome', 'intent_not_found');
  end if;

  if private.billing_organization_cleanup_is_active(
    v_payment.organization_id,
    v_payment.asaas_subscription_id
  ) then
    return jsonb_build_object('outcome', 'organization_inactive');
  end if;

  select intent.*
  into v_intent
  from private.billing_checkout_intents as intent
  where intent.id = p_intent_id
    and intent.organization_id = p_organization_id
  for update;
  if not found then
    return jsonb_build_object('outcome', 'intent_not_found');
  end if;

  if v_claim_found and (
       v_claim.payment_id is distinct from v_payment.id
       or v_claim.provider_payment_id is distinct from v_provider_payment_id
     ) then
    return jsonb_build_object(
      'outcome', 'identifier_mismatch',
      'field', 'claimed_provider_tuple'
    );
  end if;

  if v_claim_found and v_claim.finalized_at is not null then
    update public.billing_payment_checkout_capabilities
    set
      revoked_at = coalesce(revoked_at, clock_timestamp()),
      attempt_lease_id = null,
      attempt_lease_expires_at = null,
      updated_at = clock_timestamp()
    where payment_id = v_payment.id;

    return jsonb_build_object(
      'outcome', 'already_finalized',
      'final_outcome', v_claim.final_outcome,
      'last_error_code', v_claim.last_error_code
    );
  end if;

  -- A paid webhook ends deletion authorization immediately. This also
  -- self-heals claims created before the paid trigger existed.
  if v_claim_found and (
       v_intent.status = 'confirmed'
       or private.billing_payment_checkout_is_paid(v_payment.status)
     ) then
    update private.billing_payment_checkout_cancellations
    set
      finalized_at = now(),
      final_outcome = 'paid_before_delete',
      paid_won_at = now(),
      manual_review_at = null,
      updated_at = now()
    where intent_id = p_intent_id
      and finalized_at is null;

    update public.billing_payment_checkout_capabilities
    set
      revoked_at = coalesce(revoked_at, clock_timestamp()),
      attempt_lease_id = null,
      attempt_lease_expires_at = null,
      updated_at = clock_timestamp()
    where payment_id = v_payment.id;

    return jsonb_build_object(
      'outcome', 'already_finalized',
      'final_outcome', 'paid_before_delete'
    );
  end if;

  if v_claim_found
     and v_claim.lease_expires_at <= v_now
     and v_claim.claim_attempts >= v_claim.max_attempts
     and not (
       v_claim.provider_delete_started_at is null
       and private.billing_payment_checkout_is_processing(v_payment.status)
     ) then
    update private.billing_payment_checkout_cancellations
    set
      finalized_at = now(),
      final_outcome = 'manual_review',
      manual_review_at = now(),
      last_error_code = coalesce(
        last_error_code,
        'cancellation_attempts_exhausted'
      ),
      updated_at = now()
    where intent_id = p_intent_id
      and finalized_at is null;

    update public.billing_payment_checkout_capabilities
    set
      revoked_at = coalesce(revoked_at, clock_timestamp()),
      attempt_lease_id = null,
      attempt_lease_expires_at = null,
      updated_at = clock_timestamp()
    where payment_id = v_payment.id;

    insert into public.error_events (
      organization_id,
      source,
      severity,
      fingerprint,
      message,
      category,
      error_code,
      component,
      metadata,
      occurred_at
    ) values (
      p_organization_id,
      'backend',
      'critical',
      'billing_payment_cancellation_manual:' || p_intent_id::text,
      'Billing payment cancellation requires assisted review',
      'billing',
      'billing_payment_cancellation_manual_review',
      'billing_payment_cancellation_worker',
      jsonb_build_object(
        'billing_intent_id', p_intent_id,
        'payment_id', v_claim.provider_payment_id,
        'stage', 'claim_attempts_exhausted',
        'attempts', v_claim.claim_attempts,
        'error_code', coalesce(
          v_claim.last_error_code,
          'cancellation_attempts_exhausted'
        )
      ),
      v_now
    )
    on conflict do nothing;

    return jsonb_build_object(
      'outcome', 'already_finalized',
      'final_outcome', 'manual_review',
      'last_error_code', coalesce(
        v_claim.last_error_code,
        'cancellation_attempts_exhausted'
      )
    );
  end if;

  -- Once DELETE has crossed its durable provider boundary, no caller may
  -- mint a new deletion token. A crashed request can only renew a recovery
  -- lease around the original token and reconcile the exact provider row.
  if v_claim_found and v_claim.provider_delete_started_at is not null then
    if v_claim.lease_expires_at > v_now
       and v_claim.lease_owner is distinct from v_lease_owner then
      return jsonb_build_object(
        'outcome', 'busy',
        'busy_reason', 'payment_cancellation',
        'retry_after_seconds', greatest(
          1,
          ceil(extract(epoch from (
            v_claim.lease_expires_at - v_now
          )))::integer
        )
      );
    end if;

    if v_claim.lease_expires_at <= v_now then
      v_claimed_at := v_now;
      v_lease_expires_at := v_now
        + make_interval(secs => p_lease_seconds);

      update private.billing_payment_checkout_cancellations as cancellation
      set
        lease_owner = v_lease_owner,
        claimed_at = v_claimed_at,
        lease_expires_at = v_lease_expires_at,
        claim_attempts = cancellation.claim_attempts + 1,
        updated_at = v_now
      where cancellation.intent_id = p_intent_id
        and cancellation.organization_id = p_organization_id
        and cancellation.finalized_at is null
        and cancellation.provider_delete_started_at is not null
        and cancellation.provider_delete_claim_token
          = cancellation.claim_token
        and cancellation.claim_token = v_claim.claim_token
        and cancellation.lease_expires_at <= v_now
        and cancellation.claim_attempts < cancellation.max_attempts;

      if not found then
        return jsonb_build_object('outcome', 'busy');
      end if;

      select cancellation.*
      into v_claim
      from private.billing_payment_checkout_cancellations as cancellation
      where cancellation.intent_id = p_intent_id
        and cancellation.organization_id = p_organization_id;
    end if;

    return jsonb_build_object(
      'outcome', 'recover_only',
      'claim_token', v_claim.claim_token,
      'payment_row_id', v_claim.payment_id,
      'payment_id', v_claim.provider_payment_id,
      'customer_id', v_claim.provider_customer_id,
      'external_reference', v_claim.external_reference,
      'amount', v_claim.amount,
      'billing_type', v_claim.billing_type,
      'due_date', v_claim.due_date,
      'provider_delete_started_at', v_claim.provider_delete_started_at,
      'lease_expires_at', v_claim.lease_expires_at
    );
  end if;

  v_billing_type := upper(btrim(coalesce(v_intent.billing_method, '')));
  v_customer_id := nullif(btrim(coalesce(
    v_intent.provider_customer_id,
    v_org.asaas_customer_id,
    v_payment.asaas_customer_id,
    ''
  )), '');

  -- A frozen claim that no longer matches local/provider identity is not
  -- safely redrivable. Terminalize it here so an Edge crash cannot leave an
  -- unclaimable row fencing checkout forever.
  if v_claim_found and (
       (
         v_intent.provider_payment_id is not null
         and v_intent.provider_payment_id
           is distinct from v_provider_payment_id
       )
       or v_intent.provider_subscription_id is not null
       or v_payment.asaas_subscription_id is not null
       or v_billing_type not in ('PIX', 'BOLETO')
       or upper(btrim(coalesce(v_payment.billing_type, '')))
         is distinct from v_billing_type
       or v_customer_id is null
       or (
         v_payment.asaas_customer_id is not null
         and btrim(v_payment.asaas_customer_id) is distinct from v_customer_id
       )
       or nullif(btrim(coalesce(v_intent.external_reference, '')), '') is null
       or v_payment.value is null
       or round(v_payment.value::numeric, 2)
         is distinct from round(v_intent.amount::numeric, 2)
       or v_payment.due_date is null
       or v_claim.provider_customer_id is distinct from v_customer_id
       or v_claim.external_reference
         is distinct from btrim(v_intent.external_reference)
       or round(v_claim.amount::numeric, 2)
         is distinct from round(v_intent.amount::numeric, 2)
       or v_claim.billing_type is distinct from v_billing_type
       or v_claim.due_date is distinct from v_payment.due_date
     ) then
    update private.billing_payment_checkout_cancellations
    set
      finalized_at = v_now,
      final_outcome = 'manual_review',
      manual_review_at = v_now,
      last_error_code = 'cancellation_frozen_snapshot_mismatch',
      updated_at = v_now
    where intent_id = p_intent_id
      and finalized_at is null;

    update public.billing_payment_checkout_capabilities
    set
      revoked_at = coalesce(revoked_at, v_now),
      attempt_lease_id = null,
      attempt_lease_expires_at = null,
      updated_at = v_now
    where payment_id = v_payment.id;

    insert into public.error_events (
      organization_id,
      source,
      severity,
      fingerprint,
      message,
      category,
      error_code,
      component,
      metadata,
      occurred_at
    ) values (
      p_organization_id,
      'backend',
      'critical',
      'billing_payment_cancellation_manual:' || p_intent_id::text,
      'Billing payment cancellation requires assisted review',
      'billing',
      'billing_payment_cancellation_manual_review',
      'billing_payment_cancellation_worker',
      jsonb_build_object(
        'billing_intent_id', p_intent_id,
        'payment_id', v_claim.provider_payment_id,
        'stage', 'claim_frozen_snapshot',
        'error_code', 'cancellation_frozen_snapshot_mismatch'
      ),
      v_now
    )
    on conflict do nothing;

    return jsonb_build_object(
      'outcome', 'already_finalized',
      'final_outcome', 'manual_review',
      'last_error_code', 'cancellation_frozen_snapshot_mismatch'
    );
  end if;

  -- A provider-side processing state is neither safely cancellable nor a
  -- worker failure. Keep the same claim/token and extend its lease without
  -- incrementing claim_attempts, even when the previous lease expired.
  -- Frozen identity was checked immediately above, so this cannot hide a
  -- drifted payment tuple behind an endlessly renewable busy response.
  if v_claim_found
     and v_claim.provider_delete_started_at is null
     and private.billing_payment_checkout_is_processing(v_payment.status) then
    update private.billing_payment_checkout_cancellations
    set
      lease_expires_at = greatest(
        lease_expires_at,
        v_now + interval '10 minutes'
      ),
      updated_at = v_now
    where intent_id = p_intent_id
      and organization_id = p_organization_id
      and claim_token = v_claim.claim_token
      and finalized_at is null
      and provider_delete_started_at is null;

    return jsonb_build_object(
      'outcome', 'busy',
      'busy_reason', 'payment_processing',
      'retry_after_seconds', 600,
      'payment_status', upper(btrim(v_payment.status))
    );
  end if;

  if v_intent.provider_payment_id is not null
     and v_intent.provider_payment_id is distinct from v_provider_payment_id then
    return jsonb_build_object(
      'outcome', 'identifier_mismatch',
      'field', 'payment'
    );
  end if;
  if v_intent.provider_subscription_id is not null
     or v_payment.asaas_subscription_id is not null then
    return jsonb_build_object('outcome', 'not_one_off');
  end if;

  if v_billing_type not in ('PIX', 'BOLETO')
     or upper(btrim(coalesce(v_payment.billing_type, '')))
       is distinct from v_billing_type then
    return jsonb_build_object(
      'outcome', 'identifier_mismatch',
      'field', 'billing_type'
    );
  end if;

  if v_customer_id is null
     or (
       v_payment.asaas_customer_id is not null
       and btrim(v_payment.asaas_customer_id) is distinct from v_customer_id
     ) then
    return jsonb_build_object(
      'outcome', 'identifier_mismatch',
      'field', 'customer'
    );
  end if;
  if nullif(btrim(coalesce(v_intent.external_reference, '')), '') is null then
    return jsonb_build_object(
      'outcome', 'identifier_mismatch',
      'field', 'external_reference'
    );
  end if;
  if v_payment.value is null
     or round(v_payment.value::numeric, 2)
       is distinct from round(v_intent.amount::numeric, 2) then
    return jsonb_build_object(
      'outcome', 'identifier_mismatch',
      'field', 'amount'
    );
  end if;
  if v_payment.due_date is null then
    return jsonb_build_object(
      'outcome', 'identifier_mismatch',
      'field', 'due_date'
    );
  end if;

  v_now := clock_timestamp();
  if not v_claim_found and (
       v_capability.payment_id is null
       or v_capability.revoked_at is not null
       or v_capability.expires_at <= v_now
     ) then
    return jsonb_build_object('outcome', 'capability_not_found');
  end if;
  if v_capability.payment_id is not null
     and v_capability.attempt_lease_id is not null
     and v_capability.attempt_lease_expires_at > v_now then
    return jsonb_build_object(
      'outcome', 'busy',
      'busy_reason', 'payment_attempt',
      'retry_after_seconds', greatest(
        1,
        ceil(extract(epoch from (
          v_capability.attempt_lease_expires_at - v_now
        )))::integer
      )
    );
  end if;

  -- A fresh preflight may reconcile the provider row to PROCESSING before a
  -- cancellation claim exists. Surface a retryable busy state without
  -- creating a claim/fence or consuming the recovery attempt budget.
  if not v_claim_found
     and private.billing_payment_checkout_is_processing(v_payment.status) then
    return jsonb_build_object(
      'outcome', 'busy',
      'busy_reason', 'payment_processing',
      'retry_after_seconds', 600,
      'payment_status', upper(btrim(v_payment.status))
    );
  end if;

  if v_claim_found and v_claim.lease_expires_at > v_now then
    if v_claim.lease_owner = v_lease_owner then
      return jsonb_build_object(
        'outcome', 'already_claimed',
        'claim_token', v_claim.claim_token,
        'payment_row_id', v_claim.payment_id,
        'payment_id', v_claim.provider_payment_id,
        'customer_id', v_claim.provider_customer_id,
        'external_reference', v_claim.external_reference,
        'amount', v_claim.amount,
        'billing_type', v_claim.billing_type,
        'due_date', v_claim.due_date,
        'lease_expires_at', v_claim.lease_expires_at
      );
    end if;
    return jsonb_build_object(
      'outcome', 'busy',
      'retry_after_seconds', greatest(
        1,
        ceil(extract(epoch from (v_claim.lease_expires_at - v_now)))::integer
      )
    );
  end if;

  -- Once DELETE was authorized, an expired claim is always redrivable. Its
  -- immutable snapshot remains authoritative even if local status changed.
  if not v_claim_found then
    if v_intent.status = 'confirmed'
       or private.billing_payment_checkout_is_paid(v_payment.status) then
      return jsonb_build_object('outcome', 'already_paid');
    end if;
    if v_intent.status not in ('creating', 'pending', 'cancelled') then
      return jsonb_build_object('outcome', 'not_cancellable');
    end if;
    if not private.billing_payment_checkout_is_actionable(v_payment.status)
       and upper(btrim(coalesce(v_payment.status, ''))) not in (
         'CANCELED', 'CANCELLED', 'DELETED'
       ) then
      return jsonb_build_object('outcome', 'not_cancellable');
    end if;
  end if;

  v_claim_token := extensions.gen_random_uuid();
  v_lease_expires_at := v_claimed_at + make_interval(secs => p_lease_seconds);
  insert into private.billing_payment_checkout_cancellations (
    intent_id,
    payment_id,
    organization_id,
    provider_payment_id,
    provider_customer_id,
    external_reference,
    amount,
    billing_type,
    due_date,
    claim_token,
    lease_owner,
    claimed_at,
    lease_expires_at,
    created_at,
    updated_at
  ) values (
    p_intent_id,
    v_payment.id,
    p_organization_id,
    v_provider_payment_id,
    v_customer_id,
    btrim(v_intent.external_reference),
    v_intent.amount,
    v_billing_type,
    v_payment.due_date,
    v_claim_token,
    v_lease_owner,
    v_claimed_at,
    v_lease_expires_at,
    now(),
    now()
  )
  on conflict (intent_id) do update
  set
    claim_token = excluded.claim_token,
    lease_owner = excluded.lease_owner,
    claimed_at = excluded.claimed_at,
    lease_expires_at = excluded.lease_expires_at,
    claim_attempts = private.billing_payment_checkout_cancellations.claim_attempts + 1,
    updated_at = now()
  where private.billing_payment_checkout_cancellations.finalized_at is null
    and private.billing_payment_checkout_cancellations.payment_id
      = excluded.payment_id
    and private.billing_payment_checkout_cancellations.organization_id
      = excluded.organization_id
    and private.billing_payment_checkout_cancellations.provider_payment_id
      = excluded.provider_payment_id
    and private.billing_payment_checkout_cancellations.lease_expires_at <= v_now;

  if not found then
    return jsonb_build_object('outcome', 'busy');
  end if;

  -- Never return mutable intent/payment variables after an ON CONFLICT lease
  -- renewal. The persisted row is the sole provider-validation authority.
  select cancellation.*
  into v_claim
  from private.billing_payment_checkout_cancellations as cancellation
  where cancellation.intent_id = p_intent_id
    and cancellation.organization_id = p_organization_id;
  if not found then
    return jsonb_build_object('outcome', 'busy');
  end if;

  return jsonb_build_object(
    'outcome', 'claimed',
    'claim_token', v_claim.claim_token,
    'payment_row_id', v_claim.payment_id,
    'payment_id', v_claim.provider_payment_id,
    'customer_id', v_claim.provider_customer_id,
    'external_reference', v_claim.external_reference,
    'amount', v_claim.amount,
    'billing_type', v_claim.billing_type,
    'due_date', v_claim.due_date,
    'lease_expires_at', v_claim.lease_expires_at
  );
end
$function$;

revoke all on function public.claim_billing_payment_checkout_cancellation(
  uuid, uuid, text, text, integer
) from PUBLIC, anon, authenticated, service_role;
grant execute on function public.claim_billing_payment_checkout_cancellation(
  uuid, uuid, text, text, integer
) to service_role;

-- Defense in depth for future writers: a frozen organization cleanup inventory
-- cannot coexist with a newly inserted/renewed one-off DELETE claim.
create or replace function private.guard_billing_payment_cancellation_cleanup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if private.billing_organization_cleanup_is_active(
    new.organization_id,
    null
  ) then
    raise exception 'organization billing cleanup is in progress'
      using errcode = '55P03';
  end if;
  return new;
end
$function$;

revoke all on function private.guard_billing_payment_cancellation_cleanup()
  from PUBLIC, anon, authenticated, service_role;

drop trigger if exists guard_billing_payment_cancellation_cleanup
  on private.billing_payment_checkout_cancellations;
create trigger guard_billing_payment_cancellation_cleanup
before insert or update on private.billing_payment_checkout_cancellations
for each row
execute function private.guard_billing_payment_cancellation_cleanup();

-- Exact CAS immediately before the first byte of DELETE /payments/{id}.
-- Only `proceed` authorizes that irreversible call. `already_started` means
-- the caller must reconcile with GET and must never issue DELETE again.
create or replace function public.mark_billing_payment_checkout_cancellation_delete_started(
  p_organization_id uuid,
  p_intent_id uuid,
  p_claim_token uuid,
  p_provider_payment_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_provider_payment_id text := nullif(
    btrim(coalesce(p_provider_payment_id, '')),
    ''
  );
  v_payment public.asaas_payments%rowtype;
  v_capability public.billing_payment_checkout_capabilities%rowtype;
  v_claim private.billing_payment_checkout_cancellations%rowtype;
  v_org public.organizations%rowtype;
  v_intent private.billing_checkout_intents%rowtype;
  v_customer_id text;
  v_now timestamptz := clock_timestamp();
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service_role required' using errcode = '42501';
  end if;
  if p_organization_id is null
     or p_intent_id is null
     or p_claim_token is null
     or v_provider_payment_id is null
     or char_length(v_provider_payment_id) > 255 then
    return jsonb_build_object('outcome', 'invalid_request');
  end if;

  perform private.lock_asaas_billing_resources(v_provider_payment_id, null);

  select payment.*
  into v_payment
  from public.asaas_payments as payment
  where payment.organization_id = p_organization_id
    and payment.billing_intent_id = p_intent_id
    and payment.asaas_payment_id = v_provider_payment_id
  for update;
  if not found then
    return jsonb_build_object('outcome', 'lost_claim');
  end if;

  select capability.*
  into v_capability
  from public.billing_payment_checkout_capabilities as capability
  where capability.payment_id = v_payment.id
    and capability.asaas_payment_id = v_payment.asaas_payment_id
    and capability.organization_id = v_payment.organization_id
    and capability.billing_intent_id is not distinct from v_payment.billing_intent_id
  for update;

  select cancellation.*
  into v_claim
  from private.billing_payment_checkout_cancellations as cancellation
  where cancellation.intent_id = p_intent_id
    and cancellation.organization_id = p_organization_id
    and cancellation.payment_id = v_payment.id
    and cancellation.provider_payment_id = v_provider_payment_id
  for update;
  if not found or v_claim.claim_token is distinct from p_claim_token then
    return jsonb_build_object('outcome', 'lost_claim');
  end if;

  select organization.*
  into v_org
  from public.organizations as organization
  where organization.id = p_organization_id
  for update;
  if not found then
    return jsonb_build_object('outcome', 'lost_claim');
  end if;
  if not v_org.is_active then
    return jsonb_build_object('outcome', 'organization_inactive');
  end if;

  select intent.*
  into v_intent
  from private.billing_checkout_intents as intent
  where intent.id = p_intent_id
    and intent.organization_id = p_organization_id
  for update;
  if not found then
    return jsonb_build_object('outcome', 'lost_claim');
  end if;

  if v_claim.finalized_at is not null then
    if v_claim.final_outcome in ('paid_before_delete', 'paid_after_delete') then
      return jsonb_build_object(
        'outcome', 'paid_before_delete',
        'final_outcome', v_claim.final_outcome
      );
    end if;
    if v_claim.final_outcome = 'manual_review' then
      return jsonb_build_object(
        'outcome', 'manual_review',
        'last_error_code', v_claim.last_error_code
      );
    end if;
    return jsonb_build_object('outcome', 'lost_claim');
  end if;

  -- Paid evidence always wins before the irreversible provider boundary.
  if v_intent.status = 'confirmed'
     or private.billing_payment_checkout_is_paid(v_payment.status) then
    update private.billing_payment_checkout_cancellations
    set
      finalized_at = v_now,
      final_outcome = 'paid_before_delete',
      paid_won_at = v_now,
      manual_review_at = null,
      updated_at = v_now
    where intent_id = p_intent_id
      and finalized_at is null;

    update public.billing_payment_checkout_capabilities
    set
      revoked_at = coalesce(revoked_at, v_now),
      attempt_lease_id = null,
      attempt_lease_expires_at = null,
      updated_at = v_now
    where payment_id = v_payment.id;

    return jsonb_build_object(
      'outcome', 'paid_before_delete',
      'payment_id', v_provider_payment_id
    );
  end if;

  if v_claim.provider_delete_started_at is not null then
    return jsonb_build_object(
      'outcome', 'already_started',
      'payment_id', v_provider_payment_id,
      'provider_delete_started_at', v_claim.provider_delete_started_at
    );
  end if;

  if v_claim.lease_expires_at <= v_now then
    return jsonb_build_object('outcome', 'lost_claim');
  end if;

  v_customer_id := nullif(btrim(coalesce(
    v_intent.provider_customer_id,
    v_org.asaas_customer_id,
    v_payment.asaas_customer_id,
    ''
  )), '');

  if v_claim.payment_id is distinct from v_payment.id
     or (
       v_intent.provider_payment_id is not null
       and v_intent.provider_payment_id
         is distinct from v_claim.provider_payment_id
     )
     or v_customer_id is distinct from v_claim.provider_customer_id
     or (
       v_org.asaas_customer_id is not null
       and btrim(v_org.asaas_customer_id)
         is distinct from v_claim.provider_customer_id
     )
     or (
       v_payment.asaas_customer_id is not null
       and btrim(v_payment.asaas_customer_id)
         is distinct from v_claim.provider_customer_id
     )
     or btrim(coalesce(v_intent.external_reference, ''))
       is distinct from v_claim.external_reference
     or round(v_intent.amount::numeric, 2)
       is distinct from round(v_claim.amount::numeric, 2)
     or round(v_payment.value::numeric, 2)
       is distinct from round(v_claim.amount::numeric, 2)
     or upper(btrim(coalesce(v_payment.billing_type, '')))
       is distinct from v_claim.billing_type
     or upper(btrim(coalesce(v_intent.billing_method, '')))
       is distinct from v_claim.billing_type
     or v_payment.due_date is distinct from v_claim.due_date
     or v_intent.provider_subscription_id is not null
     or v_payment.asaas_subscription_id is not null
     or (
       not private.billing_payment_checkout_is_actionable(v_payment.status)
       and not private.billing_payment_checkout_is_processing(v_payment.status)
       and upper(btrim(coalesce(v_payment.status, ''))) not in (
         'CANCELED', 'CANCELLED', 'DELETED'
       )
     )
     or v_intent.status not in ('creating', 'pending', 'cancelled') then
    update private.billing_payment_checkout_cancellations
    set
      finalized_at = v_now,
      final_outcome = 'manual_review',
      manual_review_at = v_now,
      last_error_code = 'cancellation_frozen_snapshot_mismatch',
      updated_at = v_now
    where intent_id = p_intent_id
      and organization_id = p_organization_id
      and payment_id = v_payment.id
      and claim_token = p_claim_token
      and finalized_at is null;

    update public.billing_payment_checkout_capabilities
    set
      revoked_at = coalesce(revoked_at, v_now),
      attempt_lease_id = null,
      attempt_lease_expires_at = null,
      updated_at = v_now
    where payment_id = v_payment.id;

    insert into public.error_events (
      organization_id,
      source,
      severity,
      fingerprint,
      message,
      category,
      error_code,
      component,
      metadata,
      occurred_at
    ) values (
      p_organization_id,
      'backend',
      'critical',
      'billing_payment_cancellation_manual:' || p_intent_id::text,
      'Billing payment cancellation requires assisted review',
      'billing',
      'billing_payment_cancellation_manual_review',
      'billing_payment_cancellation_worker',
      jsonb_build_object(
        'billing_intent_id', p_intent_id,
        'payment_id', v_claim.provider_payment_id,
        'stage', 'delete_marker_frozen_snapshot',
        'error_code', 'cancellation_frozen_snapshot_mismatch'
      ),
      v_now
    )
    on conflict do nothing;

    return jsonb_build_object(
      'outcome', 'manual_review',
      'reason', 'frozen_snapshot_mismatch',
      'last_error_code', 'cancellation_frozen_snapshot_mismatch'
    );
  end if;

  if private.billing_payment_checkout_is_processing(v_payment.status) then
    update private.billing_payment_checkout_cancellations
    set
      lease_expires_at = greatest(
        lease_expires_at,
        v_now + interval '10 minutes'
      ),
      updated_at = v_now
    where intent_id = p_intent_id
      and organization_id = p_organization_id
      and claim_token = p_claim_token
      and finalized_at is null
      and provider_delete_started_at is null;

    return jsonb_build_object(
      'outcome', 'busy',
      'busy_reason', 'payment_processing',
      'retry_after_seconds', 600,
      'payment_status', upper(btrim(v_payment.status))
    );
  end if;

  if upper(btrim(coalesce(v_payment.status, ''))) in (
    'CANCELED', 'CANCELLED', 'DELETED'
  ) then
    update private.billing_checkout_intents
    set
      status = 'cancelled',
      cancelled_at = coalesce(cancelled_at, v_now),
      last_error = 'provider_payment_already_cancelled',
      updated_at = v_now
    where id = p_intent_id
      and organization_id = p_organization_id
      and status <> 'confirmed';

    update private.billing_payment_checkout_cancellations
    set
      provider_deleted_at = v_now,
      provider_delete_result = 'not_found',
      finalized_at = v_now,
      final_outcome = 'cancelled',
      paid_won_at = null,
      manual_review_at = null,
      updated_at = v_now
    where intent_id = p_intent_id
      and organization_id = p_organization_id
      and claim_token = p_claim_token
      and finalized_at is null;

    update public.billing_payment_checkout_capabilities
    set
      revoked_at = coalesce(revoked_at, v_now),
      attempt_lease_id = null,
      attempt_lease_expires_at = null,
      updated_at = v_now
    where payment_id = v_payment.id;

    return jsonb_build_object(
      'outcome', 'already_cancelled',
      'final_outcome', 'cancelled',
      'payment_id', v_provider_payment_id,
      'payment_status', upper(btrim(v_payment.status))
    );
  end if;

  update private.billing_payment_checkout_cancellations as cancellation
  set
    provider_delete_started_at = v_now,
    provider_delete_claim_token = p_claim_token,
    updated_at = v_now
  where cancellation.intent_id = p_intent_id
    and cancellation.organization_id = p_organization_id
    and cancellation.payment_id = v_payment.id
    and cancellation.provider_payment_id = v_provider_payment_id
    and cancellation.claim_token = p_claim_token
    and cancellation.finalized_at is null
    and cancellation.provider_delete_started_at is null
    and cancellation.lease_expires_at > v_now;
  if not found then
    return jsonb_build_object('outcome', 'lost_claim');
  end if;

  -- The public payment bearer cannot race an in-flight provider DELETE.
  update public.billing_payment_checkout_capabilities
  set
    revoked_at = coalesce(revoked_at, v_now),
    attempt_lease_id = null,
    attempt_lease_expires_at = null,
    updated_at = v_now
  where payment_id = v_payment.id;

  return jsonb_build_object(
    'outcome', 'proceed',
    'payment_id', v_provider_payment_id,
    'provider_delete_started_at', v_now
  );
end
$function$;

revoke all on function public.mark_billing_payment_checkout_cancellation_delete_started(
  uuid, uuid, uuid, text
) from PUBLIC, anon, authenticated, service_role;
grant execute on function public.mark_billing_payment_checkout_cancellation_delete_started(
  uuid, uuid, uuid, text
) to service_role;

create or replace function public.fail_billing_payment_checkout_cancellation(
  p_organization_id uuid,
  p_intent_id uuid,
  p_claim_token uuid,
  p_failure_class text,
  p_error_code text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_failure_class text := lower(nullif(btrim(coalesce(p_failure_class, '')), ''));
  v_error_code text := lower(nullif(btrim(coalesce(p_error_code, '')), ''));
  v_claim private.billing_payment_checkout_cancellations%rowtype;
  v_payment public.asaas_payments%rowtype;
  v_capability public.billing_payment_checkout_capabilities%rowtype;
  v_manual_review boolean;
  v_now timestamptz := clock_timestamp();
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service_role required' using errcode = '42501';
  end if;
  if p_organization_id is null
     or p_intent_id is null
     or p_claim_token is null
     or v_failure_class not in ('retryable', 'permanent')
     or v_error_code is null
     or v_error_code !~ '^[a-z0-9_]{1,80}$' then
    return jsonb_build_object('outcome', 'invalid_request');
  end if;

  select cancellation.*
  into v_claim
  from private.billing_payment_checkout_cancellations as cancellation
  where cancellation.intent_id = p_intent_id
    and cancellation.organization_id = p_organization_id;
  if not found then
    return jsonb_build_object('outcome', 'lost_claim');
  end if;

  perform private.lock_asaas_billing_resources(
    v_claim.provider_payment_id,
    null
  );

  select payment.*
  into v_payment
  from public.asaas_payments as payment
  where payment.id = v_claim.payment_id
    and payment.organization_id = p_organization_id
    and payment.billing_intent_id = p_intent_id
    and payment.asaas_payment_id = v_claim.provider_payment_id
  for update;
  if not found then
    return jsonb_build_object('outcome', 'lost_claim');
  end if;

  select capability.*
  into v_capability
  from public.billing_payment_checkout_capabilities as capability
  where capability.payment_id = v_payment.id
    and capability.asaas_payment_id = v_payment.asaas_payment_id
    and capability.organization_id = v_payment.organization_id
    and capability.billing_intent_id is not distinct from v_payment.billing_intent_id
  for update;

  select cancellation.*
  into v_claim
  from private.billing_payment_checkout_cancellations as cancellation
  where cancellation.intent_id = p_intent_id
    and cancellation.organization_id = p_organization_id
  for update;
  if not found
     or v_claim.claim_token is distinct from p_claim_token then
    return jsonb_build_object('outcome', 'lost_claim');
  end if;
  if v_claim.finalized_at is not null then
    return jsonb_build_object(
      'outcome', 'already_finalized',
      'final_outcome', v_claim.final_outcome,
      'last_error_code', v_claim.last_error_code
    );
  end if;

  if private.billing_payment_checkout_is_paid(v_payment.status) then
    update private.billing_payment_checkout_cancellations
    set
      finalized_at = now(),
      final_outcome = 'paid_before_delete',
      paid_won_at = now(),
      manual_review_at = null,
      updated_at = now()
    where intent_id = p_intent_id
      and finalized_at is null;

    update public.billing_payment_checkout_capabilities
    set
      revoked_at = coalesce(revoked_at, v_now),
      attempt_lease_id = null,
      attempt_lease_expires_at = null,
      updated_at = v_now
    where payment_id = v_payment.id;

    return jsonb_build_object(
      'outcome', 'paid_before_delete',
      'payment_id', v_payment.asaas_payment_id
    );
  end if;

  v_manual_review := v_failure_class = 'permanent'
    or v_claim.claim_attempts >= v_claim.max_attempts;

  update private.billing_payment_checkout_cancellations
  set
    lease_expires_at = case
      when v_manual_review then lease_expires_at
      else greatest(v_now, claimed_at + interval '1 microsecond')
    end,
    finalized_at = case when v_manual_review then now() else null end,
    final_outcome = case when v_manual_review then 'manual_review' else null end,
    manual_review_at = case when v_manual_review then now() else null end,
    last_error_code = v_error_code,
    updated_at = now()
  where intent_id = p_intent_id
    and finalized_at is null
    and claim_token = p_claim_token;
  if not found then
    return jsonb_build_object('outcome', 'lost_claim');
  end if;

  if v_manual_review then
    update public.billing_payment_checkout_capabilities
    set
      revoked_at = coalesce(revoked_at, v_now),
      attempt_lease_id = null,
      attempt_lease_expires_at = null,
      updated_at = v_now
    where payment_id = v_payment.id;

    insert into public.error_events (
      organization_id,
      source,
      severity,
      fingerprint,
      message,
      category,
      error_code,
      component,
      metadata,
      occurred_at
    ) values (
      p_organization_id,
      'backend',
      'critical',
      'billing_payment_cancellation_manual:' || p_intent_id::text,
      'Billing payment cancellation requires assisted review',
      'billing',
      'billing_payment_cancellation_manual_review',
      'billing_payment_cancellation_worker',
      jsonb_build_object(
        'billing_intent_id', p_intent_id,
        'payment_id', v_claim.provider_payment_id,
        'attempts', v_claim.claim_attempts,
        'error_code', v_error_code
      ),
      v_now
    )
    on conflict do nothing;
  end if;

  return jsonb_build_object(
    'outcome', case when v_manual_review then 'manual_review' else 'retry' end,
    'payment_id', v_claim.provider_payment_id,
    'attempts', v_claim.claim_attempts,
    'max_attempts', v_claim.max_attempts,
    'error_code', v_error_code
  );
end
$function$;

revoke all on function public.fail_billing_payment_checkout_cancellation(
  uuid, uuid, uuid, text, text
) from PUBLIC, anon, authenticated, service_role;
grant execute on function public.fail_billing_payment_checkout_cancellation(
  uuid, uuid, uuid, text, text
) to service_role;

create or replace function public.claim_billing_payment_checkout_cancellation_jobs(
  p_worker_id text,
  p_limit integer default 10,
  p_lease_seconds integer default 600
)
returns table (
  organization_id uuid,
  intent_id uuid,
  payment_row_id uuid,
  provider_payment_id text,
  provider_customer_id text,
  external_reference text,
  amount numeric(10, 2),
  billing_type text,
  due_date date,
  claim_token uuid,
  lease_expires_at timestamptz,
  claim_outcome text
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_worker_id text := nullif(btrim(coalesce(p_worker_id, '')), '');
  v_candidate record;
  v_claim jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service_role required' using errcode = '42501';
  end if;
  if v_worker_id is null
     or char_length(v_worker_id) > 100
     or v_worker_id !~ '^[A-Za-z0-9._:-]+$'
     or p_limit not between 1 and 100
     or p_lease_seconds not between 30 and 600 then
    return;
  end if;

  for v_candidate in
    select cancellation.*
    from private.billing_payment_checkout_cancellations as cancellation
    where cancellation.finalized_at is null
      and cancellation.lease_expires_at <= clock_timestamp()
    order by cancellation.lease_expires_at, cancellation.intent_id
    limit p_limit
  loop
    v_claim := public.claim_billing_payment_checkout_cancellation(
      v_candidate.organization_id,
      v_candidate.intent_id,
      v_candidate.provider_payment_id,
      v_worker_id,
      p_lease_seconds
    );

    if coalesce(v_claim ->> 'outcome', '') in ('claimed', 'recover_only') then
      return query
      select
        v_candidate.organization_id::uuid,
        v_candidate.intent_id::uuid,
        (v_claim ->> 'payment_row_id')::uuid,
        v_claim ->> 'payment_id',
        v_claim ->> 'customer_id',
        v_claim ->> 'external_reference',
        (v_claim ->> 'amount')::numeric(10, 2),
        v_claim ->> 'billing_type',
        (v_claim ->> 'due_date')::date,
        (v_claim ->> 'claim_token')::uuid,
        (v_claim ->> 'lease_expires_at')::timestamptz,
        v_claim ->> 'outcome';
    end if;
  end loop;
  return;
end
$function$;

revoke all on function public.claim_billing_payment_checkout_cancellation_jobs(
  text, integer, integer
) from PUBLIC, anon, authenticated, service_role;
grant execute on function public.claim_billing_payment_checkout_cancellation_jobs(
  text, integer, integer
) to service_role;

create or replace function public.finalize_billing_payment_checkout_cancellation(
  p_organization_id uuid,
  p_intent_id uuid,
  p_claim_token uuid,
  p_provider_payment_id text,
  p_provider_delete_result text,
  p_provider_deleted_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_provider_payment_id text := nullif(
    btrim(coalesce(p_provider_payment_id, '')),
    ''
  );
  v_delete_result text := lower(btrim(coalesce(p_provider_delete_result, '')));
  v_claim private.billing_payment_checkout_cancellations%rowtype;
  v_payment public.asaas_payments%rowtype;
  v_capability public.billing_payment_checkout_capabilities%rowtype;
  v_org public.organizations%rowtype;
  v_intent private.billing_checkout_intents%rowtype;
  v_paid boolean := false;
  v_customer_id text;
  v_billing_type text;
  v_payment_status text;
  v_manual_reason text;
  v_confirmation jsonb;
  v_now timestamptz := clock_timestamp();
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service_role required' using errcode = '42501';
  end if;
  if p_organization_id is null
     or p_intent_id is null
     or p_claim_token is null
     or v_provider_payment_id is null
     or char_length(v_provider_payment_id) > 255
     or v_delete_result not in ('deleted', 'not_found', 'paid')
     or (
       v_delete_result = 'paid'
       and p_provider_deleted_at is not null
     )
     or (
       v_delete_result in ('deleted', 'not_found')
       and p_provider_deleted_at is null
     )
     or p_provider_deleted_at > v_now + interval '5 minutes' then
    return jsonb_build_object('outcome', 'invalid_request');
  end if;

  select cancellation.*
  into v_claim
  from private.billing_payment_checkout_cancellations as cancellation
  where cancellation.intent_id = p_intent_id
    and cancellation.organization_id = p_organization_id;
  if not found then
    return jsonb_build_object('outcome', 'lost_claim');
  end if;
  if v_claim.provider_payment_id is distinct from v_provider_payment_id then
    return jsonb_build_object(
      'outcome', 'identifier_mismatch',
      'field', 'payment'
    );
  end if;

  perform private.lock_asaas_billing_resources(v_provider_payment_id, null);

  select payment.*
  into v_payment
  from public.asaas_payments as payment
  where payment.id = v_claim.payment_id
    and payment.organization_id = p_organization_id
    and payment.billing_intent_id = p_intent_id
    and payment.asaas_payment_id = v_provider_payment_id
  for update;
  if not found then
    return jsonb_build_object('outcome', 'lost_claim');
  end if;

  select capability.*
  into v_capability
  from public.billing_payment_checkout_capabilities as capability
  where capability.payment_id = v_payment.id
    and capability.asaas_payment_id = v_payment.asaas_payment_id
    and capability.organization_id = v_payment.organization_id
    and capability.billing_intent_id is not distinct from v_payment.billing_intent_id
  for update;

  select cancellation.*
  into v_claim
  from private.billing_payment_checkout_cancellations as cancellation
  where cancellation.intent_id = p_intent_id
    and cancellation.organization_id = p_organization_id
  for update;
  if not found then
    return jsonb_build_object('outcome', 'lost_claim');
  end if;
  if v_claim.provider_payment_id is distinct from v_provider_payment_id then
    return jsonb_build_object(
      'outcome', 'identifier_mismatch',
      'field', 'payment'
    );
  end if;
  if v_claim.finalized_at is not null then
    return jsonb_build_object(
      'outcome', 'already_finalized',
      'final_outcome', v_claim.final_outcome,
      'provider_delete_result', v_claim.provider_delete_result
    );
  end if;
  if v_claim.claim_token is distinct from p_claim_token then
    return jsonb_build_object('outcome', 'lost_claim');
  end if;
  if v_delete_result = 'deleted'
     and v_claim.provider_delete_started_at is null then
    return jsonb_build_object('outcome', 'delete_not_started');
  end if;
  if v_delete_result = 'deleted'
     and p_provider_deleted_at < v_claim.provider_delete_started_at then
    return jsonb_build_object('outcome', 'invalid_request');
  end if;

  select organization.*
  into v_org
  from public.organizations as organization
  where organization.id = p_organization_id
  for update;
  if not found then
    return jsonb_build_object('outcome', 'intent_not_found');
  end if;

  select intent.*
  into v_intent
  from private.billing_checkout_intents as intent
  where intent.id = p_intent_id
    and intent.organization_id = p_organization_id
  for update;
  if not found then
    return jsonb_build_object('outcome', 'intent_not_found');
  end if;

  v_paid := v_intent.status = 'confirmed'
    or private.billing_payment_checkout_is_paid(v_payment.status);

  if v_delete_result = 'paid' and not v_paid then
    return jsonb_build_object('outcome', 'payment_not_paid');
  end if;

  -- Paid evidence wins first. Otherwise, never use a provider DELETE/404 ack
  -- to cancel a mutable intent that now points at another payment tuple.
  -- Processing after the provider boundary is ambiguous (not a safe retry),
  -- while the provider's cancelled trio is an idempotent terminal success.
  if not v_paid then
    v_customer_id := nullif(btrim(coalesce(
      v_intent.provider_customer_id,
      v_org.asaas_customer_id,
      v_payment.asaas_customer_id,
      ''
    )), '');
    v_billing_type := upper(btrim(coalesce(v_intent.billing_method, '')));
    v_payment_status := upper(btrim(coalesce(v_payment.status, '')));

    if private.billing_payment_checkout_is_processing(v_payment.status) then
      v_manual_reason := 'payment_processing_after_delete_ack';
    elsif (
      (
        v_intent.provider_payment_id is not null
        and v_intent.provider_payment_id
          is distinct from v_claim.provider_payment_id
      )
      or v_intent.provider_subscription_id is not null
      or v_payment.asaas_subscription_id is not null
      or v_customer_id is distinct from v_claim.provider_customer_id
      or (
        v_org.asaas_customer_id is not null
        and btrim(v_org.asaas_customer_id)
          is distinct from v_claim.provider_customer_id
      )
      or (
        v_payment.asaas_customer_id is not null
        and btrim(v_payment.asaas_customer_id)
          is distinct from v_claim.provider_customer_id
      )
      or btrim(coalesce(v_intent.external_reference, ''))
        is distinct from v_claim.external_reference
      or round(v_intent.amount::numeric, 2)
        is distinct from round(v_claim.amount::numeric, 2)
      or round(v_payment.value::numeric, 2)
        is distinct from round(v_claim.amount::numeric, 2)
      or v_billing_type is distinct from v_claim.billing_type
      or upper(btrim(coalesce(v_payment.billing_type, '')))
        is distinct from v_claim.billing_type
      or v_payment.due_date is distinct from v_claim.due_date
      or v_intent.status not in ('creating', 'pending', 'cancelled')
      or (
        not private.billing_payment_checkout_is_actionable(v_payment.status)
        and v_payment_status not in ('CANCELED', 'CANCELLED', 'DELETED')
      )
    ) then
      v_manual_reason := 'cancellation_frozen_snapshot_mismatch';
    end if;

    if v_manual_reason is not null then
      update private.billing_payment_checkout_cancellations
      set
        finalized_at = v_now,
        final_outcome = 'manual_review',
        manual_review_at = v_now,
        last_error_code = v_manual_reason,
        provider_deleted_at = case
          when v_delete_result = 'paid' then provider_deleted_at
          else least(p_provider_deleted_at, v_now)
        end,
        provider_delete_result = nullif(v_delete_result, 'paid'),
        updated_at = v_now
      where intent_id = p_intent_id
        and organization_id = p_organization_id
        and claim_token = p_claim_token
        and finalized_at is null;

      update public.billing_payment_checkout_capabilities
      set
        revoked_at = coalesce(revoked_at, v_now),
        attempt_lease_id = null,
        attempt_lease_expires_at = null,
        updated_at = v_now
      where payment_id = v_payment.id
        and organization_id = p_organization_id;

      insert into public.error_events (
        organization_id,
        source,
        severity,
        fingerprint,
        message,
        category,
        error_code,
        component,
        metadata,
        occurred_at
      ) values (
        p_organization_id,
        'backend',
        'critical',
        'billing_payment_cancellation_manual:' || p_intent_id::text,
        'Billing payment cancellation requires assisted review',
        'billing',
        'billing_payment_cancellation_manual_review',
        'billing_payment_cancellation_worker',
        jsonb_build_object(
          'billing_intent_id', p_intent_id,
          'payment_id', v_claim.provider_payment_id,
          'stage', 'finalize_frozen_snapshot',
          'error_code', v_manual_reason,
          'provider_delete_result', v_delete_result
        ),
        v_now
      )
      on conflict do nothing;

      return jsonb_build_object(
        'outcome', 'manual_review',
        'last_error_code', v_manual_reason,
        'provider_delete_result', nullif(v_delete_result, 'paid')
      );
    end if;
  end if;

  if v_paid then
    if v_intent.status <> 'confirmed' then
      v_confirmation := private.confirm_billing_checkout_intent(
        v_payment.asaas_payment_id,
        null,
        v_payment.status,
        v_payment.value
      );
    end if;

    update private.billing_payment_checkout_cancellations
    set
      provider_deleted_at = case
        when v_delete_result = 'paid' then null
        else least(p_provider_deleted_at, v_now)
      end,
      provider_delete_result = case
        when v_delete_result = 'paid' then null
        else v_delete_result
      end,
      finalized_at = v_now,
      final_outcome = case
        when v_delete_result = 'paid' then 'paid_before_delete'
        else 'paid_after_delete'
      end,
      paid_won_at = v_now,
      updated_at = v_now
    where intent_id = p_intent_id;
  else
    update private.billing_checkout_intents
    set
      status = 'cancelled',
      cancelled_at = coalesce(cancelled_at, v_now),
      last_error = 'provider_payment_cancelled_after_claim',
      updated_at = v_now
    where id = p_intent_id
      and organization_id = p_organization_id
      and status <> 'confirmed';

    if not found then
      return jsonb_build_object('outcome', 'lost_claim');
    end if;

    update public.asaas_payments
    set
      status = 'CANCELED',
      raw_event = coalesce(raw_event, '{}'::jsonb) || jsonb_build_object(
        'local_cancellation', jsonb_build_object(
          'source', 'claimed_payment_checkout_cancellation',
          'provider_delete_result', v_delete_result,
          'recorded_at', v_now
        )
      ),
      updated_at = v_now
    where id = v_payment.id
      and organization_id = p_organization_id
      and billing_intent_id = p_intent_id
      and asaas_payment_id = v_provider_payment_id
      and not private.billing_payment_checkout_is_paid(status);

    update private.billing_payment_checkout_cancellations
    set
      provider_deleted_at = least(p_provider_deleted_at, v_now),
      provider_delete_result = v_delete_result,
      finalized_at = v_now,
      final_outcome = 'cancelled',
      paid_won_at = null,
      updated_at = v_now
    where intent_id = p_intent_id;
  end if;

  update public.billing_payment_checkout_capabilities
  set
    revoked_at = coalesce(revoked_at, v_now),
    attempt_lease_id = null,
    attempt_lease_expires_at = null,
    updated_at = v_now
  where payment_id = v_payment.id
    and organization_id = p_organization_id
    and billing_intent_id = p_intent_id;

  insert into public.subscription_logs (
    organization_id, event_type, status, metadata
  ) values (
    p_organization_id,
    'provider_payment_checkout_cancelled',
    case when v_paid then 'active' else 'cancelled' end,
    jsonb_build_object(
      'billing_intent_id', p_intent_id,
      'payment_id', v_provider_payment_id,
      'provider_deleted_at', case
        when v_delete_result = 'paid' then null
        else least(p_provider_deleted_at, v_now)
      end,
      'provider_delete_result', nullif(v_delete_result, 'paid'),
      'outcome', case
        when v_paid and v_delete_result = 'paid' then 'paid_before_delete'
        when v_paid then 'paid_after_delete'
        else 'cancelled'
      end
    )
  );

  return jsonb_build_object(
    'outcome', case
      when v_paid and v_delete_result = 'paid' then 'paid_before_delete'
      when v_paid then 'paid_after_delete'
      else 'cancelled'
    end,
    'payment_id', v_provider_payment_id,
    'provider_delete_result', nullif(v_delete_result, 'paid')
  );
end
$function$;

revoke all on function public.finalize_billing_payment_checkout_cancellation(
  uuid, uuid, uuid, text, text, timestamptz
) from PUBLIC, anon, authenticated, service_role;
grant execute on function public.finalize_billing_payment_checkout_cancellation(
  uuid, uuid, uuid, text, text, timestamptz
) to service_role;

-- A paid webhook can arrive after DELETE was finalized locally. Reopen only
-- the exact fenced intent before the canonical confirmation trigger runs.
create or replace function private.recover_paid_checkout_after_payment_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_changed integer := 0;
begin
  if new.billing_intent_id is null
     or not private.billing_payment_checkout_is_paid(new.status) then
    return null;
  end if;

  update private.billing_payment_checkout_cancellations as cancellation
  set
    finalized_at = coalesce(cancellation.finalized_at, now()),
    final_outcome = case
      when cancellation.provider_deleted_at is null then 'paid_before_delete'
      else 'paid_after_delete'
    end,
    paid_won_at = coalesce(cancellation.paid_won_at, now()),
    manual_review_at = null,
    updated_at = now()
  where cancellation.intent_id = new.billing_intent_id
    and cancellation.payment_id = new.id
    and cancellation.organization_id = new.organization_id
    and cancellation.provider_payment_id = new.asaas_payment_id
    and (
      cancellation.finalized_at is null
      or cancellation.final_outcome in ('cancelled', 'manual_review')
    );
  get diagnostics v_changed = row_count;

  if v_changed = 1 then
    update private.billing_checkout_intents
    set
      status = 'pending',
      cancelled_at = null,
      last_error = 'provider_payment_removed_before_late_payment',
      updated_at = now()
    where id = new.billing_intent_id
      and organization_id = new.organization_id
      and status = 'cancelled';
  end if;

  return null;
end
$function$;

revoke all on function private.recover_paid_checkout_after_payment_delete()
  from PUBLIC, anon, authenticated, service_role;

drop trigger if exists aaa_recover_paid_checkout_after_payment_delete
  on public.asaas_payments;
create trigger aaa_recover_paid_checkout_after_payment_delete
after insert or update of status
on public.asaas_payments
for each row
execute function private.recover_paid_checkout_after_payment_delete();

comment on function public.claim_billing_payment_checkout_cancellation(
  uuid, uuid, text, text, integer
) is 'Claims one exact unpaid PIX/BOLETO payment before irreversible provider deletion and freezes the tuple required for GET validation and redrive.';
comment on function public.finalize_billing_payment_checkout_cancellation(
  uuid, uuid, uuid, text, text, timestamptz
) is 'Finalizes an exact claimed one-off mutation after Edge proves a matching deleted response, provider 404, or a reconciled paid snapshot; paid state always wins.';

-- Provider subscription deletion is irreversible and therefore must be
-- claimed before Edge performs the DELETE. The claim freezes the exact local
-- intent/payment/subscription tuple and gives a concurrent paid webhook a
-- durable state against which the post-DELETE finalizer can recover.
create table if not exists private.billing_subscription_checkout_cancellations (
  intent_id uuid primary key
    references private.billing_checkout_intents (id) on delete cascade,
  organization_id uuid not null
    references public.organizations (id) on delete cascade,
  provider_payment_id text,
  provider_subscription_id text not null unique,
  provider_customer_id text not null,
  external_reference text not null,
  amount numeric(10, 2) not null,
  billing_period_months integer not null,
  next_due_date date,
  claim_token uuid not null,
  lease_owner text not null,
  claimed_at timestamptz not null,
  lease_expires_at timestamptz not null,
  claim_attempts integer not null default 1,
  max_attempts integer not null default 8,
  last_error_code text,
  provider_deleted_at timestamptz,
  finalized_at timestamptz,
  final_outcome text,
  needs_payment_method_update boolean not null default false,
  paid_won_at timestamptz,
  manual_review_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint billing_subscription_checkout_cancellations_payment_id_check
    check (
      provider_payment_id is null
      or (
        provider_payment_id = btrim(provider_payment_id)
        and char_length(provider_payment_id) between 1 and 255
      )
    ),
  constraint billing_subscription_checkout_cancellations_subscription_id_check
    check (
      provider_subscription_id = btrim(provider_subscription_id)
      and char_length(provider_subscription_id) between 1 and 255
    ),
  constraint billing_subscription_checkout_cancellations_customer_id_check
    check (
      provider_customer_id = btrim(provider_customer_id)
      and char_length(provider_customer_id) between 1 and 255
    ),
  constraint billing_subscription_checkout_cancellations_reference_check
    check (
      external_reference = btrim(external_reference)
      and char_length(external_reference) between 1 and 255
    ),
  constraint billing_subscription_checkout_cancellations_amount_check
    check (amount > 0),
  constraint billing_subscription_checkout_cancellations_period_check
    check (billing_period_months in (1, 6, 12)),
  constraint billing_subscription_checkout_cancellations_lease_check
    check (
      lease_owner = btrim(lease_owner)
      and char_length(lease_owner) between 1 and 100
      and lease_expires_at > claimed_at
    ),
  constraint billing_subscription_checkout_cancellations_attempts_check
    check (
      claim_attempts between 1 and 30
      and max_attempts between 1 and 30
    ),
  constraint billing_subscription_checkout_cancellations_error_check
    check (
      last_error_code is null
      or last_error_code ~ '^[a-z0-9_]{1,80}$'
    ),
  constraint billing_subscription_checkout_cancellations_outcome_check
    check (final_outcome is null or final_outcome in (
      'cancelled', 'paid_without_recurrence', 'manual_review'
    )),
  constraint billing_subscription_checkout_cancellations_final_state_check
    check (
      (
        finalized_at is null
        and provider_deleted_at is null
        and final_outcome is null
        and not needs_payment_method_update
        and paid_won_at is null
        and manual_review_at is null
      )
      or (
        finalized_at is not null
        and final_outcome is not null
        and (
          (
            final_outcome = 'cancelled'
            and provider_deleted_at is not null
            and not needs_payment_method_update
            and paid_won_at is null
            and manual_review_at is null
          )
          or (
            final_outcome = 'paid_without_recurrence'
            and provider_deleted_at is not null
            and needs_payment_method_update
            and paid_won_at is not null
            and manual_review_at is null
          )
          or (
            final_outcome = 'manual_review'
            and provider_deleted_at is null
            and not needs_payment_method_update
            and paid_won_at is null
            and manual_review_at is not null
          )
        )
      )
    )
);

create index if not exists billing_subscription_checkout_cancellations_org_idx
  on private.billing_subscription_checkout_cancellations (
    organization_id, updated_at desc, intent_id
  );
create index if not exists billing_subscription_checkout_cancellations_recovery_idx
  on private.billing_subscription_checkout_cancellations (
    lease_expires_at, intent_id
  )
  where finalized_at is null;

alter table private.billing_subscription_checkout_cancellations
  enable row level security;
revoke all privileges on table private.billing_subscription_checkout_cancellations
  from PUBLIC, anon, authenticated, service_role;

create or replace function public.claim_billing_subscription_checkout_cancellation(
  p_organization_id uuid,
  p_intent_id uuid,
  p_payment_id text,
  p_subscription_id text,
  p_lease_owner text,
  p_lease_seconds integer default 600
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_payment_id text := nullif(btrim(coalesce(p_payment_id, '')), '');
  v_subscription_id text := nullif(btrim(coalesce(p_subscription_id, '')), '');
  v_lease_owner text := nullif(btrim(coalesce(p_lease_owner, '')), '');
  v_intent private.billing_checkout_intents%rowtype;
  v_org public.organizations%rowtype;
  v_payment public.asaas_payments%rowtype;
  v_capability public.billing_payment_checkout_capabilities%rowtype;
  v_claim private.billing_subscription_checkout_cancellations%rowtype;
  v_card_update record;
  v_payment_found boolean := false;
  v_claim_found boolean := false;
  v_lock_payment_id text;
  v_snapshot_customer_id text;
  v_snapshot_external_reference text;
  v_snapshot_amount numeric(10, 2);
  v_snapshot_period integer;
  v_snapshot_next_due_date date;
  v_claim_token uuid;
  v_claimed_at timestamptz := now();
  v_lease_expires_at timestamptz;
  v_now timestamptz;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service_role required' using errcode = '42501';
  end if;
  if p_organization_id is null
     or p_intent_id is null
     or v_subscription_id is null
     or v_lease_owner is null
     or char_length(coalesce(v_payment_id, '')) > 255
     or char_length(v_subscription_id) > 255
     or char_length(v_lease_owner) > 100
     or p_lease_seconds not between 30 and 600 then
    return jsonb_build_object('outcome', 'invalid_request');
  end if;

  -- An expired provider-less claim may acquire its first invoice before a
  -- recovery worker arrives. Discover that exact payment without a row lock so
  -- the advisory lock can still precede every row lock. The locked claim below
  -- remains the authority for the immutable deletion tuple.
  select cancellation.*
  into v_claim
  from private.billing_subscription_checkout_cancellations as cancellation
  where cancellation.intent_id = p_intent_id
    and cancellation.organization_id = p_organization_id;
  v_claim_found := found;

  if v_payment_id is null and v_claim_found then
    select payment.asaas_payment_id
    into v_lock_payment_id
    from public.asaas_payments as payment
    where payment.organization_id = p_organization_id
      and payment.billing_intent_id = p_intent_id
      and payment.asaas_subscription_id = v_subscription_id
    order by
      case when private.billing_payment_checkout_is_paid(payment.status)
        then 0 else 1 end,
      payment.updated_at desc,
      payment.id desc
    limit 1;
  else
    v_lock_payment_id := v_payment_id;
  end if;

  perform private.lock_asaas_billing_resources(v_lock_payment_id, v_subscription_id);

  -- Every path that can race a card POST uses the same row-lock order after
  -- the provider advisory keys: payment -> capability -> cancellation ->
  -- organization -> intent. This prevents both a duplicate provider mutation and lock
  -- inversion with claim_billing_payment_checkout_attempt/finalize.
  if v_lock_payment_id is not null then
    select payment.*
    into v_payment
    from public.asaas_payments as payment
    where payment.organization_id = p_organization_id
      and payment.billing_intent_id = p_intent_id
      and payment.asaas_payment_id = v_lock_payment_id
    for update;
    v_payment_found := found;

    if v_payment_found then
      select capability.*
      into v_capability
      from public.billing_payment_checkout_capabilities as capability
      where capability.payment_id = v_payment.id
        and capability.asaas_payment_id = v_payment.asaas_payment_id
        and capability.organization_id = v_payment.organization_id
        and capability.billing_intent_id is not distinct from v_payment.billing_intent_id
      for update;
    end if;
  end if;

  select cancellation.*
  into v_claim
  from private.billing_subscription_checkout_cancellations as cancellation
  where cancellation.intent_id = p_intent_id
    and cancellation.organization_id = p_organization_id
  for update;
  v_claim_found := found;

  select organization.*
  into v_org
  from public.organizations as organization
  where organization.id = p_organization_id
  for update;
  if not found then
    return jsonb_build_object('outcome', 'intent_not_found');
  end if;

  select intent.*
  into v_intent
  from private.billing_checkout_intents as intent
  where intent.id = p_intent_id
    and intent.organization_id = p_organization_id
  for update;
  if not found then
    return jsonb_build_object('outcome', 'intent_not_found');
  end if;

  if not v_claim_found
     and v_intent.provider_subscription_id is distinct from v_subscription_id then
    return jsonb_build_object('outcome', 'identifier_mismatch', 'field', 'subscription');
  end if;
  if v_claim_found then
    if v_claim.provider_payment_id is distinct from v_payment_id
       or v_claim.provider_subscription_id is distinct from v_subscription_id then
      return jsonb_build_object(
        'outcome', 'identifier_mismatch',
        'field', 'claimed_provider_tuple'
      );
    end if;
  elsif v_payment_id is null then
    if v_intent.provider_payment_id is not null
       or exists (
         select 1
         from public.asaas_payments as candidate
         where candidate.organization_id = p_organization_id
           and candidate.billing_intent_id = p_intent_id
       ) then
      return jsonb_build_object(
        'outcome', 'identifier_mismatch',
        'field', 'payment'
      );
    end if;
  elsif v_intent.provider_payment_id is distinct from v_payment_id
        and not exists (
          select 1
          from public.asaas_payments as candidate
          where candidate.organization_id = p_organization_id
            and candidate.billing_intent_id = p_intent_id
            and candidate.asaas_payment_id = v_payment_id
        ) then
    return jsonb_build_object(
      'outcome', 'identifier_mismatch',
      'field', 'payment'
    );
  end if;

  if v_claim_found and v_claim.finalized_at is not null then
    if v_capability.payment_id is not null then
      update public.billing_payment_checkout_capabilities
      set
        revoked_at = coalesce(revoked_at, clock_timestamp()),
        attempt_lease_id = null,
        attempt_lease_expires_at = null,
        updated_at = clock_timestamp()
      where payment_id = v_capability.payment_id;
    end if;

    return jsonb_build_object(
      'outcome', 'already_finalized',
      'final_outcome', v_claim.final_outcome,
      'needs_payment_method_update', v_claim.needs_payment_method_update
    );
  end if;

  v_now := clock_timestamp();
  if private.billing_organization_cleanup_is_active(
    p_organization_id,
    v_subscription_id
  ) then
    return jsonb_build_object('outcome', 'organization_inactive');
  end if;

  if v_capability.payment_id is not null
     and v_capability.attempt_lease_id is not null
     and v_capability.attempt_lease_expires_at > v_now then
    return jsonb_build_object(
      'outcome', 'busy',
      'busy_reason', 'payment_attempt',
      'retry_after_seconds', greatest(
        1,
        ceil(extract(epoch from (
          v_capability.attempt_lease_expires_at - v_now
        )))::integer
      )
    );
  end if;

  -- A committed card capture/PUT marker outlives its SQL transaction and is
  -- the persistent provider-subscription fence while Edge is on the network.
  -- Cancellation wins only over a card job that has not crossed either
  -- provider boundary; otherwise DELETE must wait for success/manual review.
  select job.*
  into v_card_update
  from private.billing_subscription_card_update_jobs as job
  where job.organization_id = p_organization_id
    and job.provider_subscription_id = v_subscription_id
    and (
      job.status in (
        'prepared', 'awaiting_payment', 'pending_update', 'processing', 'retry'
      )
      or (job.status = 'dead' and job.manual_review_at is not null)
    )
  order by job.generation desc
  limit 1
  for update;

  if found then
    if v_card_update.capture_request_started_at is not null
       or v_card_update.provider_outcome_ambiguous_at is not null
       or v_card_update.manual_review_at is not null
       or (
         v_card_update.status = 'processing'
         and v_card_update.provider_request_started_at is not null
       ) then
      return jsonb_build_object(
        'outcome', 'busy',
        'busy_reason', case
          when v_card_update.capture_request_started_at is not null
            then 'subscription_card_capture'
          else 'subscription_card_update'
        end,
        'retry_after_seconds', case
          when v_card_update.lease_expires_at is not null
               and v_card_update.lease_expires_at > v_now
            then greatest(
              1,
              least(
                60,
                ceil(extract(epoch from (
                  v_card_update.lease_expires_at - v_now
                )))::integer
              )
            )
          else 30
        end
      );
    end if;

    update private.billing_subscription_card_update_jobs
    set
      status = 'cancelled',
      provider_card_credential = null,
      card_last4 = null,
      credential_attempt_lease_id = null,
      capture_request_started_at = null,
      capture_attempt_lease_id = null,
      lease_id = null,
      lease_owner = null,
      lease_started_at = null,
      lease_expires_at = null,
      last_error_code = 'subscription_cancellation_won',
      cancelled_at = v_now,
      updated_at = v_now
    where id = v_card_update.id
      and status in (
        'prepared', 'awaiting_payment', 'pending_update', 'processing', 'retry'
      )
      and capture_request_started_at is null
      and provider_outcome_ambiguous_at is null
      and (
        status <> 'processing'
        or provider_request_started_at is null
      );
    if not found then
      return jsonb_build_object(
        'outcome', 'busy',
        'busy_reason', 'subscription_card_update',
        'retry_after_seconds', 30
      );
    end if;
  end if;

  if v_claim_found
     and v_claim.lease_expires_at <= v_now
     and v_claim.claim_attempts >= v_claim.max_attempts then
    update private.billing_subscription_checkout_cancellations as cancellation
    set
      finalized_at = v_now,
      final_outcome = 'manual_review',
      last_error_code = coalesce(
        cancellation.last_error_code,
        'subscription_cancellation_attempts_exhausted'
      ),
      manual_review_at = v_now,
      updated_at = v_now
    where cancellation.intent_id = p_intent_id
      and cancellation.organization_id = p_organization_id
      and cancellation.finalized_at is null;

    if v_capability.payment_id is not null then
      update public.billing_payment_checkout_capabilities as capability
      set
        revoked_at = coalesce(capability.revoked_at, v_now),
        attempt_lease_id = null,
        attempt_lease_expires_at = null,
        updated_at = v_now
      where capability.payment_id = v_capability.payment_id;
    end if;

    insert into public.error_events (
      organization_id, source, severity, fingerprint, message, category,
      error_code, component, metadata, occurred_at
    ) values (
      p_organization_id,
      'backend',
      'critical',
      'billing_subscription_cancellation_manual:' || p_intent_id::text,
      'Subscription cancellation exhausted all safe verification attempts',
      'billing',
      'billing_subscription_cancellation_manual_review',
      'billing_subscription_cancellation_worker',
      jsonb_build_object(
        'intent_id', p_intent_id,
        'subscription_id', v_claim.provider_subscription_id,
        'error_code', coalesce(
          v_claim.last_error_code,
          'subscription_cancellation_attempts_exhausted'
        )
      ),
      v_now
    );

    return jsonb_build_object(
      'outcome', 'manual_review',
      'reason', 'subscription_cancellation_attempts_exhausted'
    );
  end if;

  if v_claim_found
     and v_claim.lease_expires_at > now() then
    if v_claim.lease_owner = v_lease_owner then
      return jsonb_build_object(
        'outcome', 'already_claimed',
        'claim_token', v_claim.claim_token,
        'payment_id', v_claim.provider_payment_id,
        'reconciliation_payment_id', coalesce(
          v_lock_payment_id,
          v_claim.provider_payment_id
        ),
        'subscription_id', v_claim.provider_subscription_id,
        'customer_id', v_claim.provider_customer_id,
        'external_reference', v_claim.external_reference,
        'amount', v_claim.amount,
        'billing_period_months', v_claim.billing_period_months,
        'next_due_date', v_claim.next_due_date,
        'lease_expires_at', v_claim.lease_expires_at
      );
    end if;
    return jsonb_build_object(
      'outcome', 'busy',
      'lease_expires_at', v_claim.lease_expires_at
    );
  end if;

  -- An expired lease can be reclaimed only for another exact preflight. A
  -- provider 404 is never proof of prior deletion; fail_billing_subscription_
  -- checkout_cancellation owns bounded/manual terminalization.
  if not v_claim_found then
    if v_intent.status = 'confirmed'
       or (
         v_payment_found
         and private.billing_payment_checkout_is_paid(v_payment.status)
       ) then
      return jsonb_build_object('outcome', 'already_paid');
    end if;
    if v_intent.status = 'failed' then
      return jsonb_build_object('outcome', 'not_cancellable');
    end if;
    -- Older workers could close the local intent before deleting a CARD
    -- subscription. The exact unpaid tuple remains claimable, but every worker
    -- must verify it before DELETE and fail closed when that proof is absent.
    if v_intent.status not in ('creating', 'pending', 'cancelled') then
      return jsonb_build_object('outcome', 'not_cancellable');
    end if;
  end if;

  if v_claim_found then
    v_snapshot_customer_id := v_claim.provider_customer_id;
    v_snapshot_external_reference := v_claim.external_reference;
    v_snapshot_amount := v_claim.amount;
    v_snapshot_period := v_claim.billing_period_months;
    v_snapshot_next_due_date := v_claim.next_due_date;
  else
    -- A post-payment card recurrence has its own provider externalReference
    -- and next due date. Prefer that immutable provision snapshot; hosted
    -- checkout subscriptions fall back to the original intent/subscription.
    select
      provision.provider_customer_id,
      provision.external_reference,
      provision.amount,
      provision.billing_period_months,
      provision.next_due_date
    into
      v_snapshot_customer_id,
      v_snapshot_external_reference,
      v_snapshot_amount,
      v_snapshot_period,
      v_snapshot_next_due_date
    from private.billing_card_recurrence_provisions as provision
    where provision.organization_id = p_organization_id
      and provision.billing_intent_id = p_intent_id
      and provision.provider_subscription_id = v_subscription_id
    order by provision.updated_at desc, provision.payment_id desc
    limit 1;

    if not found then
      v_snapshot_customer_id := nullif(btrim(coalesce(
        v_intent.provider_customer_id,
        v_payment.asaas_customer_id,
        v_org.asaas_customer_id,
        ''
      )), '');
      v_snapshot_external_reference := btrim(v_intent.external_reference);
      v_snapshot_amount := v_intent.amount;
      v_snapshot_period := v_intent.billing_period_months;
    end if;

    if v_snapshot_next_due_date is null then
      select subscription.current_period_end::date
      into v_snapshot_next_due_date
      from public.subscriptions as subscription
      where subscription.organization_id = p_organization_id
        and subscription.provider_subscription_id = v_subscription_id
      order by subscription.updated_at desc, subscription.id desc
      limit 1;
    end if;
  end if;

  if v_snapshot_customer_id is null then
    return jsonb_build_object(
      'outcome', 'identifier_mismatch',
      'field', 'customer'
    );
  end if;

  v_claim_token := gen_random_uuid();
  v_lease_expires_at := v_claimed_at + make_interval(secs => p_lease_seconds);
  insert into private.billing_subscription_checkout_cancellations (
    intent_id,
    organization_id,
    provider_payment_id,
    provider_subscription_id,
    provider_customer_id,
    external_reference,
    amount,
    billing_period_months,
    next_due_date,
    claim_token,
    lease_owner,
    claimed_at,
    lease_expires_at,
    created_at,
    updated_at
  ) values (
    p_intent_id,
    p_organization_id,
    v_payment_id,
    v_subscription_id,
    v_snapshot_customer_id,
    v_snapshot_external_reference,
    v_snapshot_amount,
    v_snapshot_period,
    v_snapshot_next_due_date,
    v_claim_token,
    v_lease_owner,
    v_claimed_at,
    v_lease_expires_at,
    now(),
    now()
  )
  on conflict (intent_id) do update
  set
    claim_token = excluded.claim_token,
    lease_owner = excluded.lease_owner,
    claimed_at = excluded.claimed_at,
    lease_expires_at = excluded.lease_expires_at,
    claim_attempts = private.billing_subscription_checkout_cancellations
      .claim_attempts + 1,
    updated_at = now()
  where private.billing_subscription_checkout_cancellations.finalized_at is null
    and private.billing_subscription_checkout_cancellations.organization_id
      = excluded.organization_id
    and private.billing_subscription_checkout_cancellations.provider_payment_id
      is not distinct from excluded.provider_payment_id
    and private.billing_subscription_checkout_cancellations.provider_subscription_id
      = excluded.provider_subscription_id
    and private.billing_subscription_checkout_cancellations.lease_expires_at <= now()
    and private.billing_subscription_checkout_cancellations.claim_attempts
      < private.billing_subscription_checkout_cancellations.max_attempts
  returning * into v_claim;

  if not found then
    return jsonb_build_object('outcome', 'busy');
  end if;

  return jsonb_build_object(
    'outcome', 'claimed',
    'claim_token', v_claim.claim_token,
    'payment_id', v_payment_id,
    'reconciliation_payment_id', coalesce(v_lock_payment_id, v_payment_id),
    'subscription_id', v_subscription_id,
    'customer_id', v_snapshot_customer_id,
    'external_reference', v_snapshot_external_reference,
    'amount', v_snapshot_amount,
    'billing_period_months', v_snapshot_period,
    'next_due_date', v_snapshot_next_due_date,
    'lease_expires_at', v_claim.lease_expires_at,
    'attempts', v_claim.claim_attempts,
    'max_attempts', v_claim.max_attempts
  );
end
$function$;

revoke all on function public.claim_billing_subscription_checkout_cancellation(
  uuid, uuid, text, text, text, integer
) from PUBLIC, anon, authenticated, service_role;
grant execute on function public.claim_billing_subscription_checkout_cancellation(
  uuid, uuid, text, text, text, integer
) to service_role;

create or replace function public.fail_billing_subscription_checkout_cancellation(
  p_organization_id uuid,
  p_intent_id uuid,
  p_claim_token uuid,
  p_failure_class text,
  p_error_code text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_failure_class text := lower(btrim(coalesce(p_failure_class, '')));
  v_error_code text := lower(btrim(coalesce(p_error_code, '')));
  v_hint private.billing_subscription_checkout_cancellations%rowtype;
  v_claim private.billing_subscription_checkout_cancellations%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service_role required' using errcode = '42501';
  end if;
  if p_organization_id is null
     or p_intent_id is null
     or p_claim_token is null
     or v_failure_class not in ('retryable', 'permanent', 'ambiguous')
     or v_error_code !~ '^[a-z0-9_]{1,80}$' then
    return jsonb_build_object('outcome', 'invalid_request');
  end if;

  select cancellation.*
  into v_hint
  from private.billing_subscription_checkout_cancellations as cancellation
  where cancellation.intent_id = p_intent_id
    and cancellation.organization_id = p_organization_id;
  if not found then
    return jsonb_build_object('outcome', 'claim_not_found');
  end if;

  perform private.lock_asaas_billing_resources(
    v_hint.provider_payment_id,
    v_hint.provider_subscription_id
  );

  select cancellation.*
  into v_claim
  from private.billing_subscription_checkout_cancellations as cancellation
  where cancellation.intent_id = p_intent_id
    and cancellation.organization_id = p_organization_id
  for update;
  if not found then
    return jsonb_build_object('outcome', 'claim_not_found');
  end if;
  if v_claim.finalized_at is not null then
    return jsonb_build_object(
      'outcome', case
        when v_claim.final_outcome = 'manual_review' then 'manual_review'
        else 'already_finalized'
      end,
      'final_outcome', v_claim.final_outcome,
      'error_code', v_claim.last_error_code
    );
  end if;
  if v_claim.claim_token is distinct from p_claim_token then
    return jsonb_build_object('outcome', 'lost_claim');
  end if;

  if v_failure_class = 'retryable'
     and v_claim.claim_attempts < v_claim.max_attempts then
    update private.billing_subscription_checkout_cancellations as cancellation
    set last_error_code = v_error_code, updated_at = v_now
    where cancellation.intent_id = p_intent_id
      and cancellation.organization_id = p_organization_id
      and cancellation.claim_token = p_claim_token
      and cancellation.finalized_at is null;

    return jsonb_build_object(
      'outcome', 'retry',
      'attempts', v_claim.claim_attempts,
      'max_attempts', v_claim.max_attempts,
      'retry_after_seconds', greatest(
        1,
        case
          when v_claim.lease_expires_at > v_now
            then ceil(extract(epoch from (
              v_claim.lease_expires_at - v_now
            )))::integer
          else 1
        end
      )
    );
  end if;

  update private.billing_subscription_checkout_cancellations as cancellation
  set
    finalized_at = v_now,
    final_outcome = 'manual_review',
    last_error_code = v_error_code,
    manual_review_at = v_now,
    updated_at = v_now
  where cancellation.intent_id = p_intent_id
    and cancellation.organization_id = p_organization_id
    and cancellation.claim_token = p_claim_token
    and cancellation.finalized_at is null;
  if not found then
    return jsonb_build_object('outcome', 'lost_claim');
  end if;

  update public.billing_payment_checkout_capabilities as capability
  set
    revoked_at = coalesce(capability.revoked_at, v_now),
    attempt_lease_id = null,
    attempt_lease_expires_at = null,
    updated_at = v_now
  where capability.organization_id = p_organization_id
    and capability.billing_intent_id = p_intent_id;

  insert into public.error_events (
    organization_id, source, severity, fingerprint, message, category,
    error_code, component, metadata, occurred_at
  ) values (
    p_organization_id,
    'backend',
    'critical',
    'billing_subscription_cancellation_manual:' || p_intent_id::text,
    'Subscription deletion could not be proven against the bound provider tuple',
    'billing',
    'billing_subscription_cancellation_manual_review',
    'billing_subscription_cancellation_worker',
    jsonb_build_object(
      'intent_id', p_intent_id,
      'subscription_id', v_claim.provider_subscription_id,
      'failure_class', v_failure_class,
      'error_code', v_error_code,
      'attempts', v_claim.claim_attempts,
      'max_attempts', v_claim.max_attempts
    ),
    v_now
  );

  return jsonb_build_object(
    'outcome', 'manual_review',
    'final_outcome', 'manual_review',
    'error_code', v_error_code,
    'attempts', v_claim.claim_attempts,
    'max_attempts', v_claim.max_attempts
  );
end
$function$;

revoke all on function public.fail_billing_subscription_checkout_cancellation(
  uuid, uuid, uuid, text, text
) from PUBLIC, anon, authenticated, service_role;
grant execute on function public.fail_billing_subscription_checkout_cancellation(
  uuid, uuid, uuid, text, text
) to service_role;

create or replace function public.claim_billing_subscription_checkout_cancellation_jobs(
  p_worker_id text,
  p_limit integer default 10,
  p_lease_seconds integer default 600
)
returns table (
  organization_id uuid,
  intent_id uuid,
  provider_payment_id text,
  reconciliation_payment_id text,
  provider_subscription_id text,
  provider_customer_id text,
  external_reference text,
  amount numeric(10, 2),
  billing_period_months integer,
  next_due_date date,
  claim_token uuid,
  lease_expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_worker_id text := nullif(btrim(coalesce(p_worker_id, '')), '');
  v_candidate record;
  v_claim jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service_role required' using errcode = '42501';
  end if;
  if v_worker_id is null
     or char_length(v_worker_id) > 100
     or v_worker_id !~ '^[A-Za-z0-9._:-]+$'
     or p_limit not between 1 and 100
     or p_lease_seconds not between 30 and 600 then
    return;
  end if;

  -- This is deliberately a non-locking candidate scan. The exact claim RPC
  -- acquires provider advisory locks and then payment -> capability ->
  -- cancellation -> organization -> intent. Concurrent workers may observe the same expired
  -- row, but only one can replace its fencing token; the rest receive busy.
  for v_candidate in
    select
      cancellation.organization_id,
      cancellation.intent_id,
      cancellation.provider_payment_id,
      cancellation.provider_subscription_id,
      cancellation.provider_customer_id,
      cancellation.external_reference,
      cancellation.amount,
      cancellation.billing_period_months,
      cancellation.next_due_date
    from private.billing_subscription_checkout_cancellations as cancellation
    where cancellation.finalized_at is null
      and cancellation.lease_expires_at <= clock_timestamp()
    order by cancellation.lease_expires_at, cancellation.intent_id
    limit p_limit
  loop
    v_claim := public.claim_billing_subscription_checkout_cancellation(
      v_candidate.organization_id,
      v_candidate.intent_id,
      v_candidate.provider_payment_id,
      v_candidate.provider_subscription_id,
      v_worker_id,
      p_lease_seconds
    );

    if coalesce(v_claim ->> 'outcome', '') = 'claimed' then
      organization_id := v_candidate.organization_id;
      intent_id := v_candidate.intent_id;
      provider_payment_id := v_candidate.provider_payment_id;
      reconciliation_payment_id := nullif(
        btrim(coalesce(v_claim ->> 'reconciliation_payment_id', '')),
        ''
      );
      provider_subscription_id := v_candidate.provider_subscription_id;
      provider_customer_id := v_candidate.provider_customer_id;
      external_reference := v_candidate.external_reference;
      amount := v_candidate.amount;
      billing_period_months := v_candidate.billing_period_months;
      next_due_date := v_candidate.next_due_date;
      claim_token := (v_claim ->> 'claim_token')::uuid;
      lease_expires_at := (v_claim ->> 'lease_expires_at')::timestamptz;
      return next;
    end if;
  end loop;
end
$function$;

revoke all on function public.claim_billing_subscription_checkout_cancellation_jobs(
  text, integer, integer
) from PUBLIC, anon, authenticated, service_role;
grant execute on function public.claim_billing_subscription_checkout_cancellation_jobs(
  text, integer, integer
) to service_role;

create or replace function public.finalize_billing_subscription_checkout_cancellation(
  p_organization_id uuid,
  p_intent_id uuid,
  p_claim_token uuid,
  p_subscription_id text,
  p_provider_deleted_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_subscription_id text := nullif(btrim(coalesce(p_subscription_id, '')), '');
  v_claim private.billing_subscription_checkout_cancellations%rowtype;
  v_intent private.billing_checkout_intents%rowtype;
  v_org public.organizations%rowtype;
  v_payment public.asaas_payments%rowtype;
  v_capability public.billing_payment_checkout_capabilities%rowtype;
  v_payment_found boolean := false;
  v_lock_payment_id text;
  v_paid boolean := false;
  v_confirmation jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service_role required' using errcode = '42501';
  end if;
  if p_organization_id is null
     or p_intent_id is null
     or p_claim_token is null
     or v_subscription_id is null
     or char_length(v_subscription_id) > 255
     or p_provider_deleted_at is null
     or p_provider_deleted_at > now() + interval '5 minutes' then
    return jsonb_build_object('outcome', 'invalid_request');
  end if;

  select cancellation.*
  into v_claim
  from private.billing_subscription_checkout_cancellations as cancellation
  where cancellation.intent_id = p_intent_id
    and cancellation.organization_id = p_organization_id;
  if not found then
    return jsonb_build_object('outcome', 'lost_claim');
  end if;

  v_lock_payment_id := v_claim.provider_payment_id;
  if v_lock_payment_id is null then
    select payment.asaas_payment_id
    into v_lock_payment_id
    from public.asaas_payments as payment
    where payment.organization_id = p_organization_id
      and payment.billing_intent_id = p_intent_id
      and payment.asaas_subscription_id = v_claim.provider_subscription_id
    order by
      case when private.billing_payment_checkout_is_paid(payment.status)
        then 0 else 1 end,
      payment.updated_at desc,
      payment.id desc
    limit 1;
  end if;

  perform private.lock_asaas_billing_resources(
    v_lock_payment_id,
    v_claim.provider_subscription_id
  );

  -- Match claim/checkout ordering after provider advisory keys: payment ->
  -- capability -> cancellation -> organization -> intent. The preliminary claim read only
  -- discovers immutable provider keys and takes no row lock.
  select payment.*
  into v_payment
  from public.asaas_payments as payment
  where payment.organization_id = p_organization_id
    and payment.billing_intent_id = p_intent_id
    and (
      (
        v_claim.provider_payment_id is not null
        and payment.asaas_payment_id = v_claim.provider_payment_id
      )
      or (
        v_claim.provider_payment_id is null
        and payment.asaas_subscription_id = v_claim.provider_subscription_id
      )
    )
  order by
    case when private.billing_payment_checkout_is_paid(payment.status)
      then 0 else 1 end,
    coalesce(
      greatest(
        payment.last_webhook_event_at,
        payment.last_provider_observed_at
      ),
      payment.updated_at,
      payment.created_at
    ) desc,
    payment.id desc
  limit 1
  for update;
  v_payment_found := found;

  if v_payment_found then
    select capability.*
    into v_capability
    from public.billing_payment_checkout_capabilities as capability
    where capability.payment_id = v_payment.id
      and capability.asaas_payment_id = v_payment.asaas_payment_id
      and capability.organization_id = v_payment.organization_id
      and capability.billing_intent_id is not distinct from v_payment.billing_intent_id
    for update;
  end if;

  select cancellation.*
  into v_claim
  from private.billing_subscription_checkout_cancellations as cancellation
  where cancellation.intent_id = p_intent_id
    and cancellation.organization_id = p_organization_id
  for update;
  if not found then
    return jsonb_build_object('outcome', 'lost_claim');
  end if;

  if v_claim.provider_subscription_id is distinct from v_subscription_id then
    return jsonb_build_object('outcome', 'identifier_mismatch', 'field', 'subscription');
  end if;
  if v_claim.finalized_at is not null then
    return jsonb_build_object(
      'outcome', 'already_finalized',
      'final_outcome', v_claim.final_outcome,
      'needs_payment_method_update', v_claim.needs_payment_method_update
    );
  end if;
  if v_claim.claim_token is distinct from p_claim_token then
    return jsonb_build_object('outcome', 'lost_claim');
  end if;

  select organization.*
  into v_org
  from public.organizations as organization
  where organization.id = p_organization_id
  for update;
  if not found then
    return jsonb_build_object('outcome', 'intent_not_found');
  end if;

  select intent.*
  into v_intent
  from private.billing_checkout_intents as intent
  where intent.id = p_intent_id
    and intent.organization_id = p_organization_id
  for update;
  if not found then
    return jsonb_build_object('outcome', 'intent_not_found');
  end if;

  v_paid := v_intent.status = 'confirmed'
    or (
      v_payment_found
      and private.billing_payment_checkout_is_paid(v_payment.status)
    );

  if v_paid then
    if v_intent.status <> 'confirmed' and v_payment.id is not null then
      v_confirmation := private.confirm_billing_checkout_intent(
        v_payment.asaas_payment_id,
        v_claim.provider_subscription_id,
        v_payment.status,
        v_payment.value
      );
    end if;

    update private.billing_subscription_checkout_cancellations
    set
      provider_deleted_at = least(p_provider_deleted_at, now()),
      finalized_at = now(),
      final_outcome = 'paid_without_recurrence',
      needs_payment_method_update = true,
      paid_won_at = now(),
      updated_at = now()
    where intent_id = p_intent_id;
  else
    update private.billing_checkout_intents
    set
      status = 'cancelled',
      cancelled_at = coalesce(cancelled_at, now()),
      last_error = 'provider_subscription_cancelled_after_claim',
      updated_at = now()
    where id = p_intent_id
      and organization_id = p_organization_id
      and status in ('creating', 'pending', 'cancelled');

    if not found then
      return jsonb_build_object('outcome', 'lost_claim');
    end if;

    update public.asaas_payments
    set
      status = 'CANCELED',
      raw_event = coalesce(raw_event, '{}'::jsonb) || jsonb_build_object(
        'local_cancellation', jsonb_build_object(
          'source', 'claimed_subscription_checkout_cancellation',
          'recorded_at', now()
        )
      ),
      updated_at = now()
    where organization_id = p_organization_id
      and billing_intent_id = p_intent_id
      and (
        (
          v_claim.provider_payment_id is not null
          and asaas_payment_id = v_claim.provider_payment_id
        )
        or (
          v_claim.provider_payment_id is null
          and asaas_subscription_id = v_claim.provider_subscription_id
        )
      )
      and not private.billing_payment_checkout_is_paid(status);

    update private.billing_subscription_checkout_cancellations
    set
      provider_deleted_at = least(p_provider_deleted_at, now()),
      finalized_at = now(),
      final_outcome = 'cancelled',
      needs_payment_method_update = false,
      paid_won_at = null,
      updated_at = now()
    where intent_id = p_intent_id;
  end if;

  -- Finalization is a terminal fence for every checkout bearer tied to the
  -- exact intent, including legacy rows that predate the cancellation flow.
  update public.billing_payment_checkout_capabilities
  set
    revoked_at = coalesce(revoked_at, now()),
    attempt_lease_id = null,
    attempt_lease_expires_at = null,
    updated_at = now()
  where organization_id = p_organization_id
    and billing_intent_id = p_intent_id;

  update public.organizations
  set asaas_subscription_id = null, updated_at = now()
  where id = p_organization_id
    and asaas_subscription_id = v_claim.provider_subscription_id;

  update public.subscriptions
  set
    provider_subscription_id = null,
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
      'recurrence', jsonb_build_object(
        'status', 'provider_subscription_removed',
        'needs_payment_method_update', v_paid,
        'removed_at', least(p_provider_deleted_at, now()),
        'billing_intent_id', p_intent_id
      )
    ),
    updated_at = now()
  where organization_id = p_organization_id
    and provider_subscription_id = v_claim.provider_subscription_id;

  update private.billing_card_recurrence_provisions
  set
    status = case when status = 'completed' then 'cancelled' else 'failed' end,
    provider_card_credential = null,
    card_last4 = null,
    lease_id = null,
    lease_expires_at = null,
    provider_cancelled_at = case
      when status = 'completed' then least(p_provider_deleted_at, now())
      else null
    end,
    failed_at = case when status = 'completed' then failed_at else now() end,
    last_error = 'provider_subscription_removed_during_checkout_cancellation',
    job_status = 'cancelled',
    job_locked_at = null,
    job_lock_expires_at = null,
    job_locked_by = null,
    job_lease_id = null,
    updated_at = now()
  where organization_id = p_organization_id
    and billing_intent_id = p_intent_id
    and (
      provider_payment_id = v_claim.provider_payment_id
      or (
        v_claim.provider_payment_id is null
        and provider_subscription_id = v_claim.provider_subscription_id
      )
    );

  insert into public.subscription_logs (
    organization_id, event_type, status, metadata
  ) values (
    p_organization_id,
    'provider_subscription_checkout_cancelled',
    case when v_paid then 'active' else 'cancelled' end,
    jsonb_build_object(
      'billing_intent_id', p_intent_id,
      'payment_id', v_claim.provider_payment_id,
      'subscription_id', v_claim.provider_subscription_id,
      'provider_deleted_at', least(p_provider_deleted_at, now()),
      'outcome', case
        when v_paid then 'paid_without_recurrence'
        else 'cancelled'
      end,
      'needs_payment_method_update', v_paid
    )
  );

  return jsonb_build_object(
    'outcome', case
      when v_paid then 'paid_without_recurrence'
      else 'cancelled'
    end,
    'payment_id', v_claim.provider_payment_id,
    'subscription_id', v_claim.provider_subscription_id,
    'needs_payment_method_update', v_paid
  );
end
$function$;

revoke all on function public.finalize_billing_subscription_checkout_cancellation(
  uuid, uuid, uuid, text, timestamptz
) from PUBLIC, anon, authenticated, service_role;
grant execute on function public.finalize_billing_subscription_checkout_cancellation(
  uuid, uuid, uuid, text, timestamptz
) to service_role;

-- If settlement arrives after an already-finalized provider DELETE, reopen the
-- exact cancelled intent before the canonical confirmation trigger runs. The
-- later trigger below removes the now-invalid recurrence link again after plan
-- activation. PostgreSQL runs same-timing triggers in name order.
create or replace function private.recover_paid_checkout_after_subscription_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_changed integer := 0;
begin
  if new.billing_intent_id is null
     or not private.billing_payment_checkout_is_paid(new.status) then
    return null;
  end if;

  update private.billing_subscription_checkout_cancellations as cancellation
  set
    final_outcome = 'paid_without_recurrence',
    needs_payment_method_update = true,
    paid_won_at = coalesce(cancellation.paid_won_at, now()),
    updated_at = now()
  where cancellation.intent_id = new.billing_intent_id
    and cancellation.organization_id = new.organization_id
    and (
      cancellation.provider_payment_id = new.asaas_payment_id
      or (
        cancellation.provider_payment_id is null
        and cancellation.provider_subscription_id = new.asaas_subscription_id
      )
    )
    and cancellation.finalized_at is not null
    and cancellation.provider_deleted_at is not null
    and cancellation.final_outcome = 'cancelled';
  get diagnostics v_changed = row_count;

  if v_changed = 1 then
    update private.billing_checkout_intents
    set
      status = 'pending',
      cancelled_at = null,
      last_error = 'provider_subscription_removed_before_late_payment',
      updated_at = now()
    where id = new.billing_intent_id
      and organization_id = new.organization_id
      and status = 'cancelled';

    update private.billing_card_recurrence_provisions
    set
      status = 'failed',
      provider_card_credential = null,
      card_last4 = null,
      lease_id = null,
      lease_expires_at = null,
      failed_at = coalesce(failed_at, now()),
      last_error = 'provider_subscription_removed_before_late_payment',
      job_status = 'cancelled',
      job_locked_at = null,
      job_lock_expires_at = null,
      job_locked_by = null,
      job_lease_id = null,
      updated_at = now()
    where payment_id = new.id
      and organization_id = new.organization_id
      and status <> 'cancelled';
  end if;

  return null;
end
$function$;

revoke all on function private.recover_paid_checkout_after_subscription_delete()
  from PUBLIC, anon, authenticated, service_role;

drop trigger if exists aaa_recover_paid_checkout_after_subscription_delete
  on public.asaas_payments;
create trigger aaa_recover_paid_checkout_after_subscription_delete
after insert or update of status
on public.asaas_payments
for each row
execute function private.recover_paid_checkout_after_subscription_delete();

create or replace function private.clear_removed_subscription_after_late_payment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_subscription_id text;
begin
  if new.billing_intent_id is null
     or not private.billing_payment_checkout_is_paid(new.status) then
    return null;
  end if;

  select cancellation.provider_subscription_id
  into v_subscription_id
  from private.billing_subscription_checkout_cancellations as cancellation
  where cancellation.intent_id = new.billing_intent_id
    and cancellation.organization_id = new.organization_id
    and (
      cancellation.provider_payment_id = new.asaas_payment_id
      or (
        cancellation.provider_payment_id is null
        and cancellation.provider_subscription_id = new.asaas_subscription_id
      )
    )
    and cancellation.final_outcome = 'paid_without_recurrence'
    and cancellation.needs_payment_method_update
    and cancellation.provider_deleted_at is not null;
  if not found then
    return null;
  end if;

  update public.organizations
  set asaas_subscription_id = null, updated_at = now()
  where id = new.organization_id
    and asaas_subscription_id = v_subscription_id;

  update public.subscriptions
  set
    provider_subscription_id = null,
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
      'recurrence', jsonb_build_object(
        'status', 'provider_subscription_removed',
        'needs_payment_method_update', true,
        'billing_intent_id', new.billing_intent_id
      )
    ),
    updated_at = now()
  where organization_id = new.organization_id
    and provider_subscription_id = v_subscription_id;

  return null;
end
$function$;

revoke all on function private.clear_removed_subscription_after_late_payment()
  from PUBLIC, anon, authenticated, service_role;

drop trigger if exists zzz_clear_removed_subscription_after_late_payment
  on public.asaas_payments;
create trigger zzz_clear_removed_subscription_after_late_payment
after insert or update of status
on public.asaas_payments
for each row
execute function private.clear_removed_subscription_after_late_payment();

comment on function public.claim_billing_subscription_checkout_cancellation(
  uuid, uuid, text, text, text, integer
) is 'Claims one exact unpaid intent/payment/subscription tuple before irreversible provider subscription deletion.';
comment on function public.finalize_billing_subscription_checkout_cancellation(
  uuid, uuid, uuid, text, timestamptz
) is 'Finalizes a claimed provider subscription deletion; a concurrent or late paid payment retains its purchased period and is durably marked without recurrence.';

-- Updating the card of an existing provider subscription is a separate
-- mutation from charging an invoice or creating a new recurrence. Edge owns
-- the AES-GCM envelope; Postgres owns target identity, generation, leases and
-- terminal cleanup. The client-generated job id is part of the envelope AAD:
-- vimob:billing-subscription-card:{job_id}:{provider_subscription_id}.
create table if not exists private.billing_subscription_card_update_jobs (
  id uuid primary key,
  organization_id uuid not null
    references public.organizations (id) on delete cascade,
  subscription_id uuid not null
    references public.subscriptions (id) on delete cascade,
  provider_subscription_id text not null,
  provider_customer_id text not null,
  generation bigint not null,
  mode text not null,
  payment_id uuid,
  provider_payment_id text,
  status text not null default 'prepared',
  provider_card_credential text,
  card_last4 text,
  credential_attempt_lease_id uuid,
  credential_stored_at timestamptz,
  capture_request_started_at timestamptz,
  capture_attempt_lease_id uuid,
  capture_manual_review_at timestamptz,
  next_attempt_at timestamptz not null default now(),
  attempts integer not null default 0,
  max_attempts integer not null default 8,
  lease_id uuid,
  lease_owner text,
  lease_started_at timestamptz,
  lease_expires_at timestamptz,
  provider_request_started_at timestamptz,
  provider_request_last_started_at timestamptz,
  provider_request_lease_id uuid,
  provider_request_attempts integer not null default 0,
  provider_outcome_ambiguous_at timestamptz,
  provider_snapshot jsonb not null default '{}'::jsonb,
  last_error_code text,
  manual_review_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  dead_lettered_at timestamptz,
  expires_at timestamptz not null default (now() + interval '24 hours'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint billing_subscription_card_update_subscription_id_check
    check (
      provider_subscription_id = btrim(provider_subscription_id)
      and char_length(provider_subscription_id) between 1 and 255
    ),
  constraint billing_subscription_card_update_customer_id_check
    check (
      provider_customer_id = btrim(provider_customer_id)
      and char_length(provider_customer_id) between 1 and 255
    ),
  constraint billing_subscription_card_update_generation_check
    check (generation > 0),
  constraint billing_subscription_card_update_mode_check
    check (mode in ('settled_payment', 'saved_only')),
  constraint billing_subscription_card_update_payment_mode_check
    check (
      (
        mode = 'saved_only'
        and payment_id is null
        and provider_payment_id is null
        and credential_attempt_lease_id is null
      )
      or (
        mode = 'settled_payment'
        and payment_id is not null
        and provider_payment_id = btrim(provider_payment_id)
        and char_length(provider_payment_id) between 1 and 255
      )
    ),
  constraint billing_subscription_card_update_status_check
    check (
      status in (
        'prepared',
        'awaiting_payment',
        'pending_update',
        'processing',
        'retry',
        'succeeded',
        'cancelled',
        'dead'
      )
    ),
  constraint billing_subscription_card_update_credential_check
    check (
      provider_card_credential is null
      or (
        provider_card_credential ~ '^v1[.][A-Za-z0-9._-]+$'
        and char_length(provider_card_credential) between 35 and 4096
      )
    ),
  constraint billing_subscription_card_update_last4_check
    check (card_last4 is null or card_last4 ~ '^[0-9]{4}$'),
  constraint billing_subscription_card_update_attempts_check
    check (
      attempts between 0 and 30
      and max_attempts between 1 and 30
      and provider_request_attempts between 0 and 30
    ),
  constraint billing_subscription_card_update_lease_check
    check (
      (
        lease_id is null
        and lease_owner is null
        and lease_started_at is null
        and lease_expires_at is null
      )
      or (
        lease_id is not null
        and lease_owner = btrim(lease_owner)
        and char_length(lease_owner) between 1 and 100
        and lease_started_at is not null
        and lease_expires_at > lease_started_at
      )
    ),
  constraint billing_subscription_card_update_provider_marker_check
    check (
      (
        provider_request_started_at is null
        and provider_request_last_started_at is null
        and provider_request_lease_id is null
        and provider_request_attempts = 0
      )
      or (
        provider_request_started_at is not null
        and provider_request_last_started_at >= provider_request_started_at
        and provider_request_lease_id is not null
        and provider_request_attempts > 0
      )
    ),
  constraint billing_subscription_card_update_provider_ambiguity_check
    check (
      provider_outcome_ambiguous_at is null
      or (
        provider_request_started_at is not null
        and provider_outcome_ambiguous_at >= provider_request_started_at
      )
    ),
  constraint billing_subscription_card_update_capture_marker_check
    check (
      (
        capture_request_started_at is null
        and capture_attempt_lease_id is null
      )
      or (
        capture_request_started_at is not null
        and capture_attempt_lease_id is not null
        and capture_request_started_at >= created_at
      )
    ),
  constraint billing_subscription_card_update_capture_review_check
    check (
      capture_manual_review_at is null
      or (
        capture_request_started_at is not null
        and capture_manual_review_at >= capture_request_started_at
      )
    ),
  constraint billing_subscription_card_update_snapshot_check
    check (jsonb_typeof(provider_snapshot) = 'object'),
  constraint billing_subscription_card_update_error_check
    check (
      last_error_code is null
      or last_error_code ~ '^[a-z0-9_]{1,80}$'
    ),
  constraint billing_subscription_card_update_manual_review_check
    check (manual_review_at is null or status = 'dead'),
  constraint billing_subscription_card_update_expiry_check
    check (expires_at > created_at),
  constraint billing_subscription_card_update_state_check
    check (
      (
        status = 'prepared'
        and provider_card_credential is null
        and card_last4 is null
        and credential_stored_at is null
        and lease_id is null
        and completed_at is null
        and cancelled_at is null
        and dead_lettered_at is null
      )
      or (
        status in ('awaiting_payment', 'pending_update', 'retry')
        and provider_card_credential is not null
        and card_last4 is not null
        and credential_stored_at is not null
        and lease_id is null
        and completed_at is null
        and cancelled_at is null
        and dead_lettered_at is null
      )
      or (
        status = 'processing'
        and provider_card_credential is not null
        and card_last4 is not null
        and credential_stored_at is not null
        and lease_id is not null
        and completed_at is null
        and cancelled_at is null
        and dead_lettered_at is null
      )
      or (
        status = 'succeeded'
        and provider_card_credential is null
        and card_last4 is not null
        and lease_id is null
        and completed_at is not null
        and cancelled_at is null
        and dead_lettered_at is null
      )
      or (
        status = 'cancelled'
        and provider_card_credential is null
        and lease_id is null
        and completed_at is null
        and cancelled_at is not null
        and dead_lettered_at is null
      )
      or (
        status = 'dead'
        and provider_card_credential is null
        and lease_id is null
        and completed_at is null
        and dead_lettered_at is not null
      )
    ),
  constraint billing_subscription_card_update_payment_identity_fkey
    foreign key (payment_id, provider_payment_id, organization_id)
    references public.asaas_payments (id, asaas_payment_id, organization_id)
    on update cascade
    on delete cascade
);

create unique index if not exists billing_subscription_card_update_generation_key
  on private.billing_subscription_card_update_jobs (
    subscription_id, generation
  );
create unique index if not exists billing_subscription_card_update_active_key
  on private.billing_subscription_card_update_jobs (subscription_id)
  where status in (
    'prepared', 'awaiting_payment', 'pending_update', 'processing', 'retry'
  );
create unique index if not exists billing_subscription_card_update_provider_active_key
  on private.billing_subscription_card_update_jobs (provider_subscription_id)
  where status in (
    'prepared', 'awaiting_payment', 'pending_update', 'processing', 'retry'
  );
create index if not exists billing_subscription_card_update_claim_idx
  on private.billing_subscription_card_update_jobs (
    next_attempt_at, created_at, id
  )
  where status in ('pending_update', 'retry');
create index if not exists billing_subscription_card_update_payment_idx
  on private.billing_subscription_card_update_jobs (payment_id, status)
  where payment_id is not null;

alter table private.billing_subscription_card_update_jobs
  enable row level security;
revoke all privileges on table private.billing_subscription_card_update_jobs
  from PUBLIC, anon, authenticated, service_role;

-- Legacy card-recurrence reversals delete the same Asaas subscription that a
-- card-update job mutates with PUT. This projection is the durable half of the
-- cross-worker fence: queued, leased and dead cancellation rows remain visible
-- across process crashes and deployments.
create or replace function private.billing_card_recurrence_cancel_state(
  p_organization_id uuid,
  p_provider_subscription_id text
)
returns text
language sql
stable
security definer
set search_path = ''
as $function$
  select case provision.job_status
    when 'processing' then 'processing'
    when 'dead' then 'manual_review'
    else 'queued'
  end
  from private.billing_card_recurrence_provisions as provision
  where provision.organization_id = p_organization_id
    and provision.provider_subscription_id = p_provider_subscription_id
    and provision.job_action = 'cancel'
    and provision.status = 'completed'
    and provision.job_status in ('pending', 'retry', 'processing', 'dead')
  order by case provision.job_status
    when 'processing' then 1
    when 'dead' then 2
    else 3
  end
  limit 1;
$function$;

revoke all on function private.billing_card_recurrence_cancel_state(uuid, text)
  from PUBLIC, anon, authenticated, service_role;

-- The recurrence worker's UPDATE-to-processing is its durable DELETE claim.
-- Under the shared provider advisory lock it either cancels a card update that
-- has not crossed a remote boundary, or skips this recurrence claim while a
-- card capture/PUT outcome is in flight or ambiguous. Enqueueing a reversal is
-- never suppressed: it stays pending and becomes the persistent opposing
-- fence until the card outcome is reconciled.
create or replace function private.guard_card_recurrence_cancel_card_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_card_job private.billing_subscription_card_update_jobs%rowtype;
  v_now timestamptz := clock_timestamp();
  v_card_boundary_crossed boolean := false;
begin
  if new.job_action <> 'cancel'
     or new.status <> 'completed'
     or new.provider_subscription_id is null
     or new.job_status not in ('pending', 'retry', 'processing')
     or (
       old.job_action is not distinct from new.job_action
       and old.job_status is not distinct from new.job_status
       and old.provider_subscription_id
         is not distinct from new.provider_subscription_id
     ) then
    return new;
  end if;

  perform private.lock_asaas_billing_resources(
    null,
    new.provider_subscription_id
  );

  select job.*
  into v_card_job
  from private.billing_subscription_card_update_jobs as job
  where job.organization_id = new.organization_id
    and job.provider_subscription_id = new.provider_subscription_id
    and (
      job.status in (
        'prepared', 'awaiting_payment', 'pending_update', 'processing', 'retry'
      )
      or (job.status = 'dead' and job.manual_review_at is not null)
    )
  order by job.generation desc
  limit 1
  for update;

  if not found then
    return new;
  end if;

  v_card_boundary_crossed :=
    v_card_job.manual_review_at is not null
    or v_card_job.provider_outcome_ambiguous_at is not null
    or (
      v_card_job.status = 'awaiting_payment'
      and v_card_job.capture_request_started_at is not null
    )
    or (
      v_card_job.status = 'processing'
      and v_card_job.provider_request_started_at is not null
      and v_card_job.provider_request_lease_id = v_card_job.lease_id
    );

  if not v_card_boundary_crossed then
    update private.billing_subscription_card_update_jobs
    set
      status = 'cancelled',
      provider_card_credential = null,
      card_last4 = null,
      credential_attempt_lease_id = null,
      lease_id = null,
      lease_owner = null,
      lease_started_at = null,
      lease_expires_at = null,
      last_error_code = 'legacy_recurrence_cancellation_won',
      manual_review_at = null,
      cancelled_at = v_now,
      updated_at = v_now
    where id = v_card_job.id
      and status in (
        'prepared', 'awaiting_payment', 'pending_update', 'processing', 'retry'
      );
    return new;
  end if;

  if new.job_status = 'processing' then
    -- RETURN NULL skips only this worker claim. The recurrence row remains
    -- pending/retry and will be reconsidered after the card boundary resolves.
    return null;
  end if;

  return new;
end
$function$;

revoke all on function private.guard_card_recurrence_cancel_card_update()
  from PUBLIC, anon, authenticated, service_role;
drop trigger if exists guard_card_recurrence_cancel_card_update
  on private.billing_card_recurrence_provisions;
create trigger guard_card_recurrence_cancel_card_update
before update of job_action, job_status, provider_subscription_id
on private.billing_card_recurrence_provisions
for each row
execute function private.guard_card_recurrence_cancel_card_update();

-- Organization purge is an independent Go workflow, but its Asaas cleanup
-- deletes the same subscription/payment resources mutated by billing workers.
-- Persist the exact remote tuple before the first DELETE. Each resource gets a
-- one-shot provider marker and exact HTTP-200 acknowledgement; a crash after
-- the marker is assisted-review state and never authorizes a blind replay.
create table if not exists private.billing_organization_asaas_cleanup_claims (
  organization_id uuid primary key
    references public.organizations (id) on delete cascade,
  provider_customer_id text,
  provider_subscription_id text,
  provider_payment_ids text[] not null default '{}'::text[],
  claim_token uuid not null unique,
  lease_owner text not null,
  claimed_at timestamptz not null,
  lease_expires_at timestamptz not null,
  claim_attempts integer not null default 1,
  max_attempts integer not null default 20,
  provider_cleanup_started_at timestamptz not null,
  completed_at timestamptz,
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint billing_organization_cleanup_customer_check
    check (
      provider_customer_id is null
      or (
        provider_customer_id = btrim(provider_customer_id)
        and char_length(provider_customer_id) between 1 and 255
      )
    ),
  constraint billing_organization_cleanup_subscription_check
    check (
      provider_subscription_id is null
      or (
        provider_subscription_id = btrim(provider_subscription_id)
        and char_length(provider_subscription_id) between 1 and 255
      )
    ),
  constraint billing_organization_cleanup_payments_check
    check (
      array_position(provider_payment_ids, null) is null
      and cardinality(provider_payment_ids) <= 10000
    ),
  constraint billing_organization_cleanup_lease_check
    check (
      lease_owner = btrim(lease_owner)
      and char_length(lease_owner) between 1 and 100
      and lease_expires_at > claimed_at
    ),
  constraint billing_organization_cleanup_attempts_check
    check (
      claim_attempts between 1 and 30
      and max_attempts between 1 and 30
    ),
  constraint billing_organization_cleanup_error_check
    check (
      last_error_code is null
      or last_error_code ~ '^[a-z0-9_]{1,80}$'
    ),
  constraint billing_organization_cleanup_org_claim_key
    unique (organization_id, claim_token),
  constraint billing_organization_cleanup_timeline_check
    check (
      provider_cleanup_started_at >= created_at
      and (completed_at is null or completed_at >= provider_cleanup_started_at)
  )
);

-- Provider deletion is proven one resource at a time. A resource claim commits
-- the durable boundary immediately before Go sends DELETE. There is no replay
-- after that marker: a lost response, 404/410, or a non-exact response is
-- assisted-review state rather than evidence that the resource was removed.
create table if not exists private.billing_organization_asaas_cleanup_resources (
  organization_id uuid not null,
  claim_token uuid not null,
  resource_kind text not null,
  resource_id text not null,
  delete_order smallint not null,
  status text not null default 'pending',
  attempt_token uuid,
  lease_owner text,
  lease_started_at timestamptz,
  lease_expires_at timestamptz,
  provider_delete_started_at timestamptz,
  provider_deleted_at timestamptz,
  provider_http_status integer,
  provider_response jsonb not null default '{}'::jsonb,
  manual_review_at timestamptz,
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, resource_kind, resource_id),
  constraint billing_organization_cleanup_resource_claim_fkey
    foreign key (organization_id, claim_token)
    references private.billing_organization_asaas_cleanup_claims (
      organization_id, claim_token
    )
    on delete cascade,
  constraint billing_organization_cleanup_resource_kind_check
    check (resource_kind in ('payment', 'subscription', 'customer')),
  constraint billing_organization_cleanup_resource_order_check
    check (
      (resource_kind = 'payment' and delete_order = 10)
      or (resource_kind = 'subscription' and delete_order = 20)
      or (resource_kind = 'customer' and delete_order = 30)
    ),
  constraint billing_organization_cleanup_resource_id_check
    check (
      resource_id = btrim(resource_id)
      and char_length(resource_id) between 1 and 255
    ),
  constraint billing_organization_cleanup_resource_status_check
    check (status in ('pending', 'processing', 'succeeded', 'manual_review')),
  constraint billing_organization_cleanup_resource_attempt_check
    check (
      (
        status = 'pending'
        and attempt_token is null
        and lease_owner is null
        and lease_started_at is null
        and lease_expires_at is null
        and provider_delete_started_at is null
      )
      or (
        status = 'processing'
        and attempt_token is not null
        and lease_owner is not null
        and lease_started_at is not null
        and lease_expires_at > lease_started_at
        and provider_delete_started_at = lease_started_at
      )
      or (
        status in ('succeeded', 'manual_review')
        and attempt_token is not null
        and lease_owner is not null
        and lease_started_at is not null
        and lease_expires_at > lease_started_at
        and provider_delete_started_at = lease_started_at
      )
    ),
  constraint billing_organization_cleanup_resource_success_check
    check (
      (
        status = 'succeeded'
        and provider_deleted_at is not null
        and provider_http_status = 200
        and jsonb_typeof(provider_response -> 'id') = 'string'
        and provider_response ->> 'id' = resource_id
        and jsonb_typeof(provider_response -> 'deleted') = 'boolean'
        and provider_response -> 'deleted' = 'true'::jsonb
        and manual_review_at is null
      )
      or status <> 'succeeded'
    ),
  constraint billing_organization_cleanup_resource_review_check
    check (
      (status = 'manual_review' and manual_review_at is not null)
      or (status <> 'manual_review' and manual_review_at is null)
    ),
  constraint billing_organization_cleanup_resource_error_check
    check (
      last_error_code is null
      or last_error_code ~ '^[a-z0-9_]{1,80}$'
    ),
  constraint billing_organization_cleanup_resource_timeline_check
    check (
      updated_at >= created_at
      and (
        provider_delete_started_at is null
        or provider_delete_started_at >= created_at
      )
      and (
        provider_deleted_at is null
        or provider_deleted_at >= provider_delete_started_at
      )
      and (
        manual_review_at is null
        or manual_review_at >= provider_delete_started_at
      )
    )
);

create index if not exists billing_organization_cleanup_resource_next_idx
  on private.billing_organization_asaas_cleanup_resources (
    organization_id, delete_order, resource_id
  )
  where status <> 'succeeded';

-- One provider object can belong to only one destructive cleanup. Keeping
-- this ownership tombstone until the organization purge prevents a second
-- tenant from ever claiming the same remote id after a lost response.
create unique index if not exists billing_organization_cleanup_resource_owner_key
  on private.billing_organization_asaas_cleanup_resources (
    resource_kind, resource_id
  );

create unique index if not exists billing_organization_cleanup_subscription_key
  on private.billing_organization_asaas_cleanup_claims (
    provider_subscription_id
  )
  where provider_subscription_id is not null
    and completed_at is null;

alter table private.billing_organization_asaas_cleanup_claims
  enable row level security;
revoke all privileges on table private.billing_organization_asaas_cleanup_claims
  from PUBLIC, anon, authenticated, service_role;

alter table private.billing_organization_asaas_cleanup_resources
  enable row level security;
revoke all privileges on table private.billing_organization_asaas_cleanup_resources
  from PUBLIC, anon, authenticated, service_role;

create or replace function private.billing_organization_cleanup_is_active(
  p_organization_id uuid,
  p_provider_subscription_id text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select
    exists (
      select 1
      from public.organizations as organization_row
      where organization_row.id = p_organization_id
        and organization_row.is_active = false
    )
    or exists (
      select 1
      from private.billing_organization_asaas_cleanup_claims as cleanup
      where cleanup.organization_id = p_organization_id
        -- A completed provider cleanup remains a permanent, organization-wide
        -- fence until the tenant row is physically purged. A stale/different
        -- subscription id must never bypass the destructive tenant tombstone.
    );
$function$;

revoke all on function private.billing_organization_cleanup_is_active(uuid, text)
  from PUBLIC, anon, authenticated, service_role;

create or replace function private.billing_subscription_provider_delete_is_proven(
  p_organization_id uuid,
  p_provider_subscription_id text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from private.billing_subscription_checkout_cancellations as cancellation
    where cancellation.organization_id = p_organization_id
      and cancellation.provider_subscription_id = p_provider_subscription_id
      and cancellation.provider_deleted_at is not null
      and cancellation.finalized_at is not null
      and cancellation.final_outcome in ('cancelled', 'paid_without_recurrence')
  ) or exists (
    select 1
    from private.billing_card_recurrence_provisions as provision
    where provision.organization_id = p_organization_id
      and provision.provider_subscription_id = p_provider_subscription_id
      and provision.provider_cancelled_at is not null
      and provision.status = 'cancelled'
      and provision.job_action = 'cancel'
      and provision.job_status = 'succeeded'
  );
$function$;

revoke all on function private.billing_subscription_provider_delete_is_proven(
  uuid, text
) from PUBLIC, anon, authenticated, service_role;

create or replace function private.billing_subscription_delete_proof_has_live_conflict(
  p_organization_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  with delete_proof(provider_subscription_id) as (
    select distinct cancellation.provider_subscription_id
    from private.billing_subscription_checkout_cancellations as cancellation
    where cancellation.organization_id = p_organization_id
      and cancellation.provider_deleted_at is not null
      and cancellation.finalized_at is not null
      and cancellation.final_outcome in ('cancelled', 'paid_without_recurrence')
    union
    select distinct provision.provider_subscription_id
    from private.billing_card_recurrence_provisions as provision
    where provision.organization_id = p_organization_id
      and provision.provider_subscription_id is not null
      and provision.provider_cancelled_at is not null
      and provision.status = 'cancelled'
      and provision.job_action = 'cancel'
      and provision.job_status = 'succeeded'
  ),
  live_reference(provider_subscription_id) as (
    select organization_row.asaas_subscription_id
    from public.organizations as organization_row
    where organization_row.id = p_organization_id
      and nullif(btrim(coalesce(organization_row.asaas_subscription_id, '')), '')
        is not null
    union
    select subscription.provider_subscription_id
    from public.subscriptions as subscription
    where subscription.organization_id = p_organization_id
      and nullif(btrim(coalesce(subscription.provider_subscription_id, '')), '')
        is not null
      and lower(btrim(coalesce(subscription.status, '')))
        not in ('cancelled', 'canceled', 'inactive', 'expired', 'deleted')
    union
    select intent.provider_subscription_id
    from private.billing_checkout_intents as intent
    where intent.organization_id = p_organization_id
      and intent.status in ('creating', 'pending')
      and intent.provider_subscription_id is not null
    union
    select provision.provider_subscription_id
    from private.billing_card_recurrence_provisions as provision
    where provision.organization_id = p_organization_id
      and provision.provider_subscription_id is not null
      and provision.status = 'completed'
    union
    select job.provider_subscription_id
    from private.billing_subscription_card_update_jobs as job
    where job.organization_id = p_organization_id
      and job.status in (
        'prepared', 'awaiting_payment', 'pending_update', 'processing', 'retry'
      )
    union
    select plan_change.provider_subscription_id
    from private.billing_plan_changes as plan_change
    where plan_change.organization_id = p_organization_id
      and plan_change.status in ('provider_updating', 'scheduled', 'applying')
    union
    select job.provider_subscription_id
    from private.asaas_reconciliation_jobs as job
    where job.organization_id = p_organization_id
      and job.status in ('pending', 'retry', 'processing')
    union
    select cancellation.provider_subscription_id
    from private.billing_subscription_checkout_cancellations as cancellation
    where cancellation.organization_id = p_organization_id
      and cancellation.finalized_at is null
  )
  select exists (
    select 1
    from delete_proof
    join live_reference using (provider_subscription_id)
  );
$function$;

revoke all on function private.billing_subscription_delete_proof_has_live_conflict(uuid)
  from PUBLIC, anon, authenticated, service_role;

-- A provider payment referenced only by a child workflow cannot be inferred
-- safe to delete. Require the canonical same-tenant payment row unless an
-- exact, durable provider-delete proof already exists.
create or replace function private.billing_provider_payment_delete_is_proven(
  p_organization_id uuid,
  p_provider_payment_id text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce(nullif(btrim(p_provider_payment_id), ''), '') <> ''
    and (
      exists (
        select 1
        from private.billing_payment_checkout_cancellations as cancellation
        where cancellation.organization_id = p_organization_id
          and cancellation.provider_payment_id = btrim(p_provider_payment_id)
          and cancellation.provider_delete_started_at is not null
          and cancellation.provider_deleted_at is not null
          and cancellation.provider_delete_result = 'deleted'
          and cancellation.finalized_at is not null
          and cancellation.final_outcome in ('cancelled', 'paid_after_delete')
      )
      or exists (
        select 1
        from private.billing_organization_asaas_cleanup_resources as resource
        where resource.organization_id = p_organization_id
          and resource.resource_kind = 'payment'
          and resource.resource_id = btrim(p_provider_payment_id)
          and resource.status = 'succeeded'
          and resource.provider_http_status = 200
          and jsonb_typeof(resource.provider_response -> 'id') = 'string'
          and resource.provider_response ->> 'id' = resource.resource_id
          and jsonb_typeof(resource.provider_response -> 'deleted') = 'boolean'
          and resource.provider_response -> 'deleted' = 'true'::jsonb
      )
    );
$function$;

revoke all on function private.billing_provider_payment_delete_is_proven(uuid, text)
  from PUBLIC, anon, authenticated, service_role;

create or replace function private.billing_organization_provider_payment_references(
  p_organization_id uuid
)
returns table(provider_payment_id text)
language sql
stable
security definer
set search_path = ''
as $function$
  select distinct btrim(candidate.provider_payment_id)
  from (
    select intent.provider_payment_id
    from private.billing_checkout_intents as intent
    where intent.organization_id = p_organization_id
    union all
    select cause.provider_payment_id
    from private.billing_organization_access_causes as cause
    where cause.organization_id = p_organization_id
    union all
    select provision.provider_payment_id
    from private.billing_card_recurrence_provisions as provision
    where provision.organization_id = p_organization_id
    union all
    select job.provider_payment_id
    from private.billing_subscription_card_update_jobs as job
    where job.organization_id = p_organization_id
    union all
    select cancellation.provider_payment_id
    from private.billing_payment_checkout_cancellations as cancellation
    where cancellation.organization_id = p_organization_id
    union all
    select cancellation.provider_payment_id
    from private.billing_subscription_checkout_cancellations as cancellation
    where cancellation.organization_id = p_organization_id
  ) as candidate
  where nullif(btrim(coalesce(candidate.provider_payment_id, '')), '') is not null;
$function$;

revoke all on function private.billing_organization_provider_payment_references(uuid)
  from PUBLIC, anon, authenticated, service_role;

create or replace function private.billing_organization_has_unmaterialized_provider_payment(
  p_organization_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from private.billing_organization_provider_payment_references(
      p_organization_id
    ) as provider_ref
    where not exists (
        select 1
        from public.asaas_payments as payment
        where payment.organization_id = p_organization_id
          and payment.asaas_payment_id = btrim(provider_ref.provider_payment_id)
      )
      and not private.billing_provider_payment_delete_is_proven(
        p_organization_id,
        provider_ref.provider_payment_id
      )
  );
$function$;

revoke all on function private.billing_organization_has_unmaterialized_provider_payment(uuid)
  from PUBLIC, anon, authenticated, service_role;

-- Cleanup discovers every provider id before it crosses the destructive
-- boundary, then acquires the same advisory namespace in one deterministic
-- order. Customer ids are included because they are not schema-unique.
create or replace function private.lock_asaas_cleanup_inventory(
  p_payment_ids text[],
  p_subscription_ids text[],
  p_customer_ids text[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_resource text;
begin
  for v_resource in
    select distinct candidate.resource
    from (
      select 'payment:' || btrim(resource_id) as resource
      from unnest(coalesce(p_payment_ids, '{}'::text[])) as item(resource_id)
      where nullif(btrim(coalesce(resource_id, '')), '') is not null
      union all
      select 'subscription:' || btrim(resource_id)
      from unnest(coalesce(p_subscription_ids, '{}'::text[])) as item(resource_id)
      where nullif(btrim(coalesce(resource_id, '')), '') is not null
      union all
      select 'customer:' || btrim(resource_id)
      from unnest(coalesce(p_customer_ids, '{}'::text[])) as item(resource_id)
      where nullif(btrim(coalesce(resource_id, '')), '') is not null
    ) as candidate
    order by candidate.resource
  loop
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(v_resource, 734621)
    );
  end loop;
end
$function$;

revoke all on function private.lock_asaas_cleanup_inventory(text[], text[], text[])
  from PUBLIC, anon, authenticated, service_role;

-- Provider ids frozen by cleanup are ownership tombstones. This generic
-- trigger protects every billing relation from attaching one of those ids to
-- a different tenant while finalize/purge is still pending.
create or replace function private.guard_billing_cleanup_resource_ownership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_new jsonb := to_jsonb(new);
  v_old jsonb;
  v_organization_id uuid;
  v_old_organization_id uuid;
  v_index integer;
  v_resource_kind text;
  v_resource_id text;
  v_old_resource_id text;
  v_payment_ids text[] := '{}'::text[];
  v_subscription_ids text[] := '{}'::text[];
  v_customer_ids text[] := '{}'::text[];
begin
  if tg_nargs < 3 or mod(tg_nargs - 1, 2) <> 0 then
    raise exception 'invalid cleanup ownership trigger configuration'
      using errcode = '55000';
  end if;

  v_organization_id := nullif(v_new ->> tg_argv[0], '')::uuid;
  if v_organization_id is null then
    raise exception 'cleanup ownership organization is required'
      using errcode = '23502';
  end if;

  v_old := case when tg_op = 'UPDATE' then to_jsonb(old) else '{}'::jsonb end;
  v_old_organization_id := nullif(v_old ->> tg_argv[0], '')::uuid;

  -- Freeze every old/new provider identity before consulting cleanup
  -- tombstones. Taking the complete set in global lexical order closes the
  -- writer-before-claim / claim-before-writer race without introducing an
  -- advisory-lock inversion for multi-identity rows.
  v_index := 1;
  while v_index < tg_nargs loop
    v_resource_kind := tg_argv[v_index];
    v_resource_id := nullif(
      btrim(coalesce(v_new ->> tg_argv[v_index + 1], '')),
      ''
    );
    v_old_resource_id := nullif(
      btrim(coalesce(v_old ->> tg_argv[v_index + 1], '')),
      ''
    );

    if v_resource_kind not in ('payment', 'subscription', 'customer') then
      raise exception 'invalid cleanup ownership resource kind'
        using errcode = '55000';
    end if;

    -- Identity-preserving status updates do not create an ownership race and
    -- must not acquire customer locks after a caller already holds a payment
    -- lock. Inserts, tenant moves and identity changes freeze both sides.
    if tg_op = 'INSERT'
       or v_old_organization_id is distinct from v_organization_id
       or v_old_resource_id is distinct from v_resource_id then
      if v_resource_kind = 'payment' then
        v_payment_ids := v_payment_ids || array[v_resource_id, v_old_resource_id];
      elsif v_resource_kind = 'subscription' then
        v_subscription_ids := v_subscription_ids || array[v_resource_id, v_old_resource_id];
      else
        v_customer_ids := v_customer_ids || array[v_resource_id, v_old_resource_id];
      end if;
    end if;

    v_index := v_index + 2;
  end loop;

  perform private.lock_asaas_cleanup_inventory(
    v_payment_ids,
    v_subscription_ids,
    v_customer_ids
  );

  v_index := 1;
  while v_index < tg_nargs loop
    v_resource_kind := tg_argv[v_index];
    v_resource_id := nullif(
      btrim(coalesce(v_new ->> tg_argv[v_index + 1], '')),
      ''
    );
    v_old_resource_id := nullif(
      btrim(coalesce(v_old ->> tg_argv[v_index + 1], '')),
      ''
    );

    if tg_op = 'UPDATE'
       and v_old_resource_id is distinct from v_resource_id
       and exists (
         select 1
         from private.billing_organization_asaas_cleanup_resources as resource
         where resource.organization_id = coalesce(
           v_old_organization_id,
           v_organization_id
         )
           and resource.resource_kind = v_resource_kind
           and resource.resource_id = v_old_resource_id
       ) then
      raise exception 'organization cleanup provider inventory is immutable'
        using errcode = '55000';
    end if;

    if v_resource_id is not null
       and exists (
         select 1
         from private.billing_organization_asaas_cleanup_resources as resource
         where resource.resource_kind = v_resource_kind
           and resource.resource_id = v_resource_id
           and resource.organization_id <> v_organization_id
       ) then
      raise exception 'provider resource is owned by another organization cleanup'
        using errcode = '23505';
    end if;

    if v_resource_id is not null
       and exists (
         select 1
         from private.billing_organization_asaas_cleanup_claims as cleanup
         where cleanup.organization_id = v_organization_id
       )
       and not exists (
         select 1
         from private.billing_organization_asaas_cleanup_resources as resource
         where resource.organization_id = v_organization_id
           and resource.resource_kind = v_resource_kind
           and resource.resource_id = v_resource_id
       )
       -- A same-tenant provider snapshot is authoritative inbound evidence.
       -- Let the canonical payment row persist, then the AFTER trigger below
       -- marks the cleanup claim for assisted review before another DELETE can
       -- be claimed. Customer/subscription identities remain frozen.
       and not (
         tg_table_schema = 'public'
         and tg_table_name = 'asaas_payments'
         and v_resource_kind = 'payment'
       ) then
      raise exception 'organization cleanup provider inventory is frozen'
        using errcode = '55000';
    end if;

    v_index := v_index + 2;
  end loop;

  return new;
end
$function$;

revoke all on function private.guard_billing_cleanup_resource_ownership()
  from PUBLIC, anon, authenticated, service_role;

-- Authoritative provider evidence must never be rolled back merely because an
-- organization cleanup froze its DELETE inventory first. Serialize the event
-- with that provider payment and the organization tombstone, then poison the
-- cleanup claim so every later destructive boundary fails closed.
create or replace function private.mark_billing_cleanup_late_payment_event(
  p_organization_id uuid,
  p_provider_payment_id text,
  p_error_code text
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_provider_payment_id text := nullif(
    btrim(coalesce(p_provider_payment_id, '')),
    ''
  );
  v_error_code text := nullif(btrim(coalesce(p_error_code, '')), '');
begin
  if p_organization_id is null
     or v_provider_payment_id is null
     or v_error_code is null
     or v_error_code !~ '^[a-z0-9_]{1,80}$' then
    raise exception 'invalid late billing cleanup event'
      using errcode = '22023';
  end if;

  perform private.lock_asaas_cleanup_inventory(
    array[v_provider_payment_id],
    '{}'::text[],
    '{}'::text[]
  );

  -- All cleanup paths use provider advisory -> organization -> claim. This
  -- also closes the race where the cleanup claim is inserted while an inbound
  -- event is being persisted.
  perform organization_row.id
  from public.organizations as organization_row
  where organization_row.id = p_organization_id
  for update;
  if not found then
    return;
  end if;

  update private.billing_organization_asaas_cleanup_claims as cleanup
  set
    last_error_code = coalesce(cleanup.last_error_code, v_error_code),
    updated_at = clock_timestamp()
  where cleanup.organization_id = p_organization_id;
end
$function$;

revoke all on function private.mark_billing_cleanup_late_payment_event(
  uuid, text, text
) from PUBLIC, anon, authenticated, service_role;

create or replace function private.guard_billing_cleanup_access_cause()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_provider_payment_id text := nullif(
    btrim(coalesce(new.provider_payment_id, '')),
    ''
  );
begin
  if new.organization_id is null or v_provider_payment_id is null then
    raise exception 'billing access cause payment identity is required'
      using errcode = '23502';
  end if;

  perform private.lock_asaas_cleanup_inventory(
    array[v_provider_payment_id],
    '{}'::text[],
    '{}'::text[]
  );

  if exists (
    select 1
    from private.billing_organization_asaas_cleanup_resources as resource
    where resource.resource_kind = 'payment'
      and resource.resource_id = v_provider_payment_id
      and resource.organization_id <> new.organization_id
  ) then
    raise exception 'provider payment is owned by another organization cleanup'
      using errcode = '23505';
  end if;

  if not exists (
    select 1
    from public.asaas_payments as payment
    where payment.organization_id = new.organization_id
      and payment.asaas_payment_id = v_provider_payment_id
  ) then
    raise exception 'billing access cause requires canonical same-organization payment'
      using errcode = '23503';
  end if;

  return new;
end
$function$;

revoke all on function private.guard_billing_cleanup_access_cause()
  from PUBLIC, anon, authenticated, service_role;

create or replace function private.record_billing_cleanup_access_cause_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if tg_op = 'INSERT'
     or (new.organization_id, new.provider_payment_id, new.payment_status,
         new.observed_at)
        is distinct from
        (old.organization_id, old.provider_payment_id, old.payment_status,
         old.observed_at) then
    perform private.mark_billing_cleanup_late_payment_event(
      new.organization_id,
      new.provider_payment_id,
      'late_billing_access_event'
    );
  end if;
  return new;
end
$function$;

revoke all on function private.record_billing_cleanup_access_cause_event()
  from PUBLIC, anon, authenticated, service_role;

create or replace function private.record_billing_cleanup_payment_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if tg_op = 'INSERT'
     or (new.status, new.payment_date, new.confirmed_date,
         new.last_webhook_event_id, new.last_webhook_event_at,
         new.last_webhook_received_at, new.last_provider_observed_at,
         new.raw_event)
        is distinct from
        (old.status, old.payment_date, old.confirmed_date,
         old.last_webhook_event_id, old.last_webhook_event_at,
         old.last_webhook_received_at, old.last_provider_observed_at,
         old.raw_event) then
    perform private.mark_billing_cleanup_late_payment_event(
      new.organization_id,
      new.asaas_payment_id,
      'late_billing_payment_event'
    );
  end if;
  return new;
end
$function$;

revoke all on function private.record_billing_cleanup_payment_event()
  from PUBLIC, anon, authenticated, service_role;

drop trigger if exists guard_cleanup_resource_ownership_organizations
  on public.organizations;
create trigger guard_cleanup_resource_ownership_organizations
before insert or update of id, asaas_customer_id, asaas_subscription_id
on public.organizations
for each row execute function private.guard_billing_cleanup_resource_ownership(
  'id', 'customer', 'asaas_customer_id', 'subscription', 'asaas_subscription_id'
);

drop trigger if exists guard_cleanup_resource_ownership_subscriptions
  on public.subscriptions;
create trigger guard_cleanup_resource_ownership_subscriptions
before insert or update of
  organization_id, provider_customer_id, provider_subscription_id
on public.subscriptions
for each row execute function private.guard_billing_cleanup_resource_ownership(
  'organization_id', 'customer', 'provider_customer_id',
  'subscription', 'provider_subscription_id'
);

drop trigger if exists guard_cleanup_resource_ownership_payments
  on public.asaas_payments;
create trigger guard_cleanup_resource_ownership_payments
before insert or update of
  organization_id, asaas_payment_id, asaas_customer_id, asaas_subscription_id
on public.asaas_payments
for each row execute function private.guard_billing_cleanup_resource_ownership(
  'organization_id', 'payment', 'asaas_payment_id',
  'customer', 'asaas_customer_id', 'subscription', 'asaas_subscription_id'
);

drop trigger if exists guard_cleanup_resource_ownership_checkout_intents
  on private.billing_checkout_intents;
create trigger guard_cleanup_resource_ownership_checkout_intents
before insert or update of
  organization_id, provider_payment_id, provider_customer_id,
  provider_subscription_id
on private.billing_checkout_intents
for each row execute function private.guard_billing_cleanup_resource_ownership(
  'organization_id', 'payment', 'provider_payment_id',
  'customer', 'provider_customer_id', 'subscription', 'provider_subscription_id'
);

drop trigger if exists guard_cleanup_resource_ownership_access_causes
  on private.billing_organization_access_causes;
create trigger guard_cleanup_resource_ownership_access_causes
before insert or update of organization_id, provider_payment_id
on private.billing_organization_access_causes
for each row execute function private.guard_billing_cleanup_access_cause();

drop trigger if exists record_cleanup_access_cause_event
  on private.billing_organization_access_causes;
create trigger record_cleanup_access_cause_event
after insert or update of
  organization_id, provider_payment_id, payment_status, observed_at
on private.billing_organization_access_causes
for each row execute function private.record_billing_cleanup_access_cause_event();

drop trigger if exists record_cleanup_payment_event
  on public.asaas_payments;
create trigger record_cleanup_payment_event
after insert or update of
  organization_id, asaas_payment_id, status, payment_date, confirmed_date,
  last_webhook_event_id, last_webhook_event_at, last_webhook_received_at,
  last_provider_observed_at, raw_event
on public.asaas_payments
for each row execute function private.record_billing_cleanup_payment_event();

drop trigger if exists guard_cleanup_resource_ownership_recurrences
  on private.billing_card_recurrence_provisions;
create trigger guard_cleanup_resource_ownership_recurrences
before insert or update of
  organization_id, provider_payment_id, provider_customer_id,
  provider_subscription_id
on private.billing_card_recurrence_provisions
for each row execute function private.guard_billing_cleanup_resource_ownership(
  'organization_id', 'payment', 'provider_payment_id',
  'customer', 'provider_customer_id', 'subscription', 'provider_subscription_id'
);

drop trigger if exists guard_cleanup_resource_ownership_card_updates
  on private.billing_subscription_card_update_jobs;
create trigger guard_cleanup_resource_ownership_card_updates
before insert or update of
  organization_id, provider_payment_id, provider_customer_id,
  provider_subscription_id
on private.billing_subscription_card_update_jobs
for each row execute function private.guard_billing_cleanup_resource_ownership(
  'organization_id', 'payment', 'provider_payment_id',
  'customer', 'provider_customer_id', 'subscription', 'provider_subscription_id'
);

drop trigger if exists guard_cleanup_resource_ownership_plan_changes
  on private.billing_plan_changes;
create trigger guard_cleanup_resource_ownership_plan_changes
before insert or update of organization_id, provider_subscription_id
on private.billing_plan_changes
for each row execute function private.guard_billing_cleanup_resource_ownership(
  'organization_id', 'subscription', 'provider_subscription_id'
);

drop trigger if exists guard_cleanup_resource_ownership_reconciliation_jobs
  on private.asaas_reconciliation_jobs;
create trigger guard_cleanup_resource_ownership_reconciliation_jobs
before insert or update of organization_id, provider_subscription_id
on private.asaas_reconciliation_jobs
for each row execute function private.guard_billing_cleanup_resource_ownership(
  'organization_id', 'subscription', 'provider_subscription_id'
);

drop trigger if exists guard_cleanup_resource_ownership_payment_cancellations
  on private.billing_payment_checkout_cancellations;
create trigger guard_cleanup_resource_ownership_payment_cancellations
before insert or update of
  organization_id, provider_payment_id, provider_customer_id
on private.billing_payment_checkout_cancellations
for each row execute function private.guard_billing_cleanup_resource_ownership(
  'organization_id', 'payment', 'provider_payment_id',
  'customer', 'provider_customer_id'
);

drop trigger if exists guard_cleanup_resource_ownership_subscription_cancellations
  on private.billing_subscription_checkout_cancellations;
create trigger guard_cleanup_resource_ownership_subscription_cancellations
before insert or update of
  organization_id, provider_payment_id, provider_customer_id,
  provider_subscription_id
on private.billing_subscription_checkout_cancellations
for each row execute function private.guard_billing_cleanup_resource_ownership(
  'organization_id', 'payment', 'provider_payment_id',
  'customer', 'provider_customer_id', 'subscription', 'provider_subscription_id'
);

-- A provider-cleaned tenant cannot be reactivated by an administrative write.
-- The cleanup claim is removed only by the final relational tenant purge.
create or replace function private.guard_billing_organization_reactivation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if old.is_active = false
     and new.is_active = true
     and exists (
       select 1
       from private.billing_organization_asaas_cleanup_claims as cleanup
       where cleanup.organization_id = new.id
     ) then
    raise exception 'provider-cleaned organization cannot be reactivated'
      using errcode = '55000';
  end if;
  return new;
end
$function$;

revoke all on function private.guard_billing_organization_reactivation()
  from PUBLIC, anon, authenticated, service_role;

drop trigger if exists guard_billing_organization_reactivation
  on public.organizations;
create trigger guard_billing_organization_reactivation
before update of is_active on public.organizations
for each row
execute function private.guard_billing_organization_reactivation();

-- Reconciliation performs provider reads and then writes the billing snapshot.
-- Once a tenant is inactive/cleaning, every enqueue/revive is terminalized so
-- a stale worker cannot repopulate provider identities after cleanup.
create or replace function private.guard_asaas_reconciliation_job_cleanup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if private.billing_organization_cleanup_is_active(
    new.organization_id,
    new.provider_subscription_id
  ) then
    new.status := 'dead';
    new.attempts := greatest(new.attempts, new.max_attempts);
    new.locked_at := null;
    new.locked_by := null;
    new.last_error := 'organization_cleanup_won';
    new.updated_at := clock_timestamp();
  end if;
  return new;
end
$function$;

revoke all on function private.guard_asaas_reconciliation_job_cleanup()
  from PUBLIC, anon, authenticated, service_role;

drop trigger if exists guard_asaas_reconciliation_job_cleanup
  on private.asaas_reconciliation_jobs;
create trigger guard_asaas_reconciliation_job_cleanup
before insert or update on private.asaas_reconciliation_jobs
for each row
execute function private.guard_asaas_reconciliation_job_cleanup();

create or replace function private.billing_provider_identity_ownership_issue(
  p_organization_id uuid,
  p_provider_customer_id text,
  p_provider_subscription_id text
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_customer_id text := nullif(btrim(coalesce(p_provider_customer_id, '')), '');
  v_subscription_id text := nullif(
    btrim(coalesce(p_provider_subscription_id, '')),
    ''
  );
begin
  if v_customer_id is not null and (
    exists (
      select 1 from public.organizations as owner
      where owner.id <> p_organization_id
        and btrim(coalesce(owner.asaas_customer_id, '')) = v_customer_id
    )
    or exists (
      select 1 from public.subscriptions as owner
      where owner.organization_id <> p_organization_id
        and btrim(coalesce(owner.provider_customer_id, '')) = v_customer_id
    )
    or exists (
      select 1 from public.asaas_payments as owner
      where owner.organization_id <> p_organization_id
        and btrim(coalesce(owner.asaas_customer_id, '')) = v_customer_id
    )
    or exists (
      select 1 from private.billing_checkout_intents as owner
      where owner.organization_id <> p_organization_id
        and btrim(coalesce(owner.provider_customer_id, '')) = v_customer_id
    )
    or exists (
      select 1 from private.billing_card_recurrence_provisions as owner
      where owner.organization_id <> p_organization_id
        and btrim(coalesce(owner.provider_customer_id, '')) = v_customer_id
    )
    or exists (
      select 1 from private.billing_subscription_card_update_jobs as owner
      where owner.organization_id <> p_organization_id
        and btrim(coalesce(owner.provider_customer_id, '')) = v_customer_id
    )
    or exists (
      select 1 from private.billing_payment_checkout_cancellations as owner
      where owner.organization_id <> p_organization_id
        and btrim(coalesce(owner.provider_customer_id, '')) = v_customer_id
    )
    or exists (
      select 1 from private.billing_subscription_checkout_cancellations as owner
      where owner.organization_id <> p_organization_id
        and btrim(coalesce(owner.provider_customer_id, '')) = v_customer_id
    )
    or exists (
      select 1 from private.billing_organization_asaas_cleanup_claims as owner
      where owner.organization_id <> p_organization_id
        and btrim(coalesce(owner.provider_customer_id, '')) = v_customer_id
    )
  ) then
    return 'provider_customer_shared_across_organizations';
  end if;

  if v_subscription_id is not null and (
    exists (
      select 1 from public.organizations as owner
      where owner.id <> p_organization_id
        and btrim(coalesce(owner.asaas_subscription_id, '')) = v_subscription_id
    )
    or exists (
      select 1 from public.subscriptions as owner
      where owner.organization_id <> p_organization_id
        and btrim(coalesce(owner.provider_subscription_id, '')) = v_subscription_id
    )
    or exists (
      select 1 from public.asaas_payments as owner
      where owner.organization_id <> p_organization_id
        and btrim(coalesce(owner.asaas_subscription_id, '')) = v_subscription_id
    )
    or exists (
      select 1 from private.billing_checkout_intents as owner
      where owner.organization_id <> p_organization_id
        and btrim(coalesce(owner.provider_subscription_id, '')) = v_subscription_id
    )
    or exists (
      select 1 from private.billing_card_recurrence_provisions as owner
      where owner.organization_id <> p_organization_id
        and btrim(coalesce(owner.provider_subscription_id, '')) = v_subscription_id
    )
    or exists (
      select 1 from private.billing_subscription_card_update_jobs as owner
      where owner.organization_id <> p_organization_id
        and btrim(coalesce(owner.provider_subscription_id, '')) = v_subscription_id
    )
    or exists (
      select 1 from private.billing_plan_changes as owner
      where owner.organization_id <> p_organization_id
        and btrim(coalesce(owner.provider_subscription_id, '')) = v_subscription_id
    )
    or exists (
      select 1 from private.asaas_reconciliation_jobs as owner
      where owner.organization_id <> p_organization_id
        and btrim(coalesce(owner.provider_subscription_id, '')) = v_subscription_id
    )
    or exists (
      select 1 from private.billing_subscription_checkout_cancellations as owner
      where owner.organization_id <> p_organization_id
        and btrim(coalesce(owner.provider_subscription_id, '')) = v_subscription_id
    )
    or exists (
      select 1 from private.billing_organization_asaas_cleanup_claims as owner
      where owner.organization_id <> p_organization_id
        and btrim(coalesce(owner.provider_subscription_id, '')) = v_subscription_id
    )
  ) then
    return 'provider_subscription_shared_across_organizations';
  end if;

  return null;
end
$function$;

revoke all on function private.billing_provider_identity_ownership_issue(
  uuid, text, text
) from PUBLIC, anon, authenticated, service_role;

create or replace function private.billing_organization_cleanup_inventory_issue(
  p_organization_id uuid,
  p_claim_token uuid
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_claim private.billing_organization_asaas_cleanup_claims%rowtype;
  v_organization_active boolean;
  v_payment_ids text[] := '{}'::text[];
  v_subscription_ids text[] := '{}'::text[];
  v_customer_ids text[] := '{}'::text[];
  v_resource_payment_ids text[] := '{}'::text[];
  v_resource_subscription_ids text[] := '{}'::text[];
  v_resource_customer_ids text[] := '{}'::text[];
  v_expected_subscription_ids text[] := '{}'::text[];
  v_expected_customer_ids text[] := '{}'::text[];
  v_ownership_issue text;
begin
  select cleanup.*
  into v_claim
  from private.billing_organization_asaas_cleanup_claims as cleanup
  where cleanup.organization_id = p_organization_id
    and cleanup.claim_token = p_claim_token;
  if not found then
    return 'cleanup_claim_not_found';
  end if;
  if v_claim.last_error_code is not null then
    return v_claim.last_error_code;
  end if;

  select organization_row.is_active
  into v_organization_active
  from public.organizations as organization_row
  where organization_row.id = p_organization_id;
  if not found then
    return 'organization_not_found';
  end if;
  if v_organization_active then
    return 'organization_reactivated';
  end if;
  if private.billing_organization_has_unmaterialized_provider_payment(
    p_organization_id
  ) then
    return 'provider_payment_not_materialized';
  end if;
  if private.billing_subscription_delete_proof_has_live_conflict(
    p_organization_id
  ) then
    return 'provider_subscription_liveness_conflict';
  end if;

  select coalesce(
    array_agg(candidate.provider_id order by candidate.provider_id),
    '{}'::text[]
  )
  into v_subscription_ids
  from (
    select btrim(organization_row.asaas_subscription_id) as provider_id
    from public.organizations as organization_row
    where organization_row.id = p_organization_id
    union
    select btrim(subscription.provider_subscription_id)
    from public.subscriptions as subscription
    where subscription.organization_id = p_organization_id
    union
    select btrim(payment.asaas_subscription_id)
    from public.asaas_payments as payment
    where payment.organization_id = p_organization_id
    union
    select btrim(intent.provider_subscription_id)
    from private.billing_checkout_intents as intent
    where intent.organization_id = p_organization_id
    union
    select btrim(provision.provider_subscription_id)
    from private.billing_card_recurrence_provisions as provision
    where provision.organization_id = p_organization_id
    union
    select btrim(job.provider_subscription_id)
    from private.billing_subscription_card_update_jobs as job
    where job.organization_id = p_organization_id
    union
    select btrim(plan_change.provider_subscription_id)
    from private.billing_plan_changes as plan_change
    where plan_change.organization_id = p_organization_id
    union
    select btrim(job.provider_subscription_id)
    from private.asaas_reconciliation_jobs as job
    where job.organization_id = p_organization_id
    union
    select btrim(cancellation.provider_subscription_id)
    from private.billing_subscription_checkout_cancellations as cancellation
    where cancellation.organization_id = p_organization_id
    union
    select btrim(cleanup.provider_subscription_id)
    from private.billing_organization_asaas_cleanup_claims as cleanup
    where cleanup.organization_id = p_organization_id
  ) as candidate
  where nullif(btrim(coalesce(candidate.provider_id, '')), '') is not null
    and (
      exists (
        select 1
        from private.billing_organization_asaas_cleanup_claims as cleanup
        where cleanup.organization_id = p_organization_id
          and cleanup.provider_subscription_id = candidate.provider_id
      )
      or not private.billing_subscription_provider_delete_is_proven(
        p_organization_id,
        candidate.provider_id
      )
    );

  select coalesce(
    array_agg(candidate.provider_id order by candidate.provider_id),
    '{}'::text[]
  )
  into v_customer_ids
  from (
    select btrim(organization_row.asaas_customer_id) as provider_id
    from public.organizations as organization_row
    where organization_row.id = p_organization_id
    union
    select btrim(subscription.provider_customer_id)
    from public.subscriptions as subscription
    where subscription.organization_id = p_organization_id
    union
    select btrim(payment.asaas_customer_id)
    from public.asaas_payments as payment
    where payment.organization_id = p_organization_id
    union
    select btrim(intent.provider_customer_id)
    from private.billing_checkout_intents as intent
    where intent.organization_id = p_organization_id
    union
    select btrim(provision.provider_customer_id)
    from private.billing_card_recurrence_provisions as provision
    where provision.organization_id = p_organization_id
    union
    select btrim(job.provider_customer_id)
    from private.billing_subscription_card_update_jobs as job
    where job.organization_id = p_organization_id
    union
    select btrim(cancellation.provider_customer_id)
    from private.billing_payment_checkout_cancellations as cancellation
    where cancellation.organization_id = p_organization_id
    union
    select btrim(cancellation.provider_customer_id)
    from private.billing_subscription_checkout_cancellations as cancellation
    where cancellation.organization_id = p_organization_id
    union
    select btrim(cleanup.provider_customer_id)
    from private.billing_organization_asaas_cleanup_claims as cleanup
    where cleanup.organization_id = p_organization_id
  ) as candidate
  where nullif(btrim(coalesce(candidate.provider_id, '')), '') is not null;

  select coalesce(
    array_agg(candidate.provider_payment_id order by candidate.provider_payment_id),
    '{}'::text[]
  )
  into v_payment_ids
  from (
    select distinct btrim(payment.asaas_payment_id) as provider_payment_id
    from public.asaas_payments as payment
    where payment.organization_id = p_organization_id
      and nullif(btrim(coalesce(payment.asaas_payment_id, '')), '') is not null
      and (
        private.billing_payment_checkout_is_actionable(payment.status)
        or private.billing_payment_checkout_is_processing(payment.status)
        or upper(btrim(coalesce(payment.status, ''))) = 'DELETED'
        or payment.raw_event #>>
          '{vimob_restore,provider_request_started_at}' is not null
      )
      and not private.billing_provider_payment_delete_is_proven(
        p_organization_id,
        payment.asaas_payment_id
      )
    union
    select provider_ref.provider_payment_id
    from private.billing_organization_provider_payment_references(
      p_organization_id
    ) as provider_ref
    where not private.billing_provider_payment_delete_is_proven(
      p_organization_id,
      provider_ref.provider_payment_id
    )
      and not exists (
        select 1
        from public.asaas_payments as payment
        where payment.organization_id = p_organization_id
          and payment.asaas_payment_id = provider_ref.provider_payment_id
      )
  ) as candidate;

  select
    coalesce(array_agg(resource.resource_id order by resource.resource_id)
      filter (where resource.resource_kind = 'payment'), '{}'::text[]),
    coalesce(array_agg(resource.resource_id order by resource.resource_id)
      filter (where resource.resource_kind = 'subscription'), '{}'::text[]),
    coalesce(array_agg(resource.resource_id order by resource.resource_id)
      filter (where resource.resource_kind = 'customer'), '{}'::text[])
  into
    v_resource_payment_ids,
    v_resource_subscription_ids,
    v_resource_customer_ids
  from private.billing_organization_asaas_cleanup_resources as resource
  where resource.organization_id = p_organization_id
    and resource.claim_token = p_claim_token;

  v_expected_subscription_ids := case
    when v_claim.provider_subscription_id is null then '{}'::text[]
    else array[v_claim.provider_subscription_id]
  end;
  v_expected_customer_ids := case
    when v_claim.provider_customer_id is null then '{}'::text[]
    else array[v_claim.provider_customer_id]
  end;

  if cardinality(v_payment_ids) > 10000
     or cardinality(v_payment_ids)
          + cardinality(v_subscription_ids)
          + cardinality(v_customer_ids) > 10002 then
    return 'resource_limit_exceeded';
  end if;
  if cardinality(v_subscription_ids) > 1 then
    return 'multiple_provider_subscriptions';
  end if;
  if cardinality(v_customer_ids) > 1 then
    return 'multiple_provider_customers';
  end if;
  if cardinality(v_customer_ids) = 0
     and (
       cardinality(v_subscription_ids) > 0
       or cardinality(v_payment_ids) > 0
     ) then
    return 'incomplete_provider_identity';
  end if;

  if not (v_payment_ids <@ v_claim.provider_payment_ids)
     or v_subscription_ids is distinct from v_expected_subscription_ids
     or v_customer_ids is distinct from v_expected_customer_ids
     or v_resource_payment_ids is distinct from v_claim.provider_payment_ids
     or v_resource_subscription_ids is distinct from v_expected_subscription_ids
     or v_resource_customer_ids is distinct from v_expected_customer_ids then
    return 'inventory_drift';
  end if;

  v_ownership_issue := private.billing_provider_identity_ownership_issue(
    p_organization_id,
    v_claim.provider_customer_id,
    v_claim.provider_subscription_id
  );
  if v_ownership_issue is not null then
    return v_ownership_issue;
  end if;

  if exists (
    select 1
    from private.asaas_reconciliation_jobs as job
    where job.organization_id = p_organization_id
      and (
        job.status <> 'dead'
        or job.last_error is distinct from 'organization_cleanup_won'
      )
  ) then
    return 'billing_reconciliation_not_terminal';
  end if;
  if exists (
    select 1
    from public.billing_payment_checkout_capabilities as capability
    where capability.organization_id = p_organization_id
      and (
        capability.revoked_at is null
        or capability.attempt_lease_id is not null
        or capability.attempt_lease_expires_at is not null
      )
  ) then
    return 'checkout_capability_not_terminal';
  end if;
  if exists (
    select 1
    from private.billing_payment_checkout_cancellations as cancellation
    where cancellation.organization_id = p_organization_id
      and cancellation.finalized_at is null
  ) or exists (
    select 1
    from private.billing_subscription_checkout_cancellations as cancellation
    where cancellation.organization_id = p_organization_id
      and cancellation.finalized_at is null
  ) then
    return 'checkout_cancellation_not_terminal';
  end if;

  return null;
end
$function$;

revoke all on function private.billing_organization_cleanup_inventory_issue(
  uuid, uuid
) from PUBLIC, anon, authenticated, service_role;

-- Once organization cleanup has frozen its exact provider inventory, no
-- checkout writer may create or mutate another intent for that tenant. The
-- organization row lock in the cleanup claim serializes with reservation;
-- this trigger is the durable fence that remains after that transaction
-- commits and protects every current/future SQL writer, not only one RPC.
create or replace function private.guard_billing_checkout_intent_cleanup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if private.billing_organization_cleanup_is_active(
    new.organization_id,
    new.provider_subscription_id
  ) then
    raise exception 'organization billing cleanup is in progress'
      using errcode = '55000';
  end if;
  return new;
end
$function$;

revoke all on function private.guard_billing_checkout_intent_cleanup()
  from PUBLIC, anon, authenticated, service_role;

drop trigger if exists guard_billing_checkout_intent_cleanup
  on private.billing_checkout_intents;
create trigger guard_billing_checkout_intent_cleanup
before insert or update on private.billing_checkout_intents
for each row
execute function private.guard_billing_checkout_intent_cleanup();

create or replace function public.claim_billing_organization_asaas_cleanup(
  p_organization_id uuid,
  p_lease_owner text,
  p_lease_seconds integer default 600
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_lease_owner text := nullif(btrim(coalesce(p_lease_owner, '')), '');
  v_org_hint public.organizations%rowtype;
  v_org public.organizations%rowtype;
  v_subscription_id text;
  v_customer_id text;
  v_lock_payment_ids text[] := '{}'::text[];
  v_current_payment_ids text[] := '{}'::text[];
  v_lock_subscription_ids text[] := '{}'::text[];
  v_current_subscription_ids text[] := '{}'::text[];
  v_lock_customer_ids text[] := '{}'::text[];
  v_current_customer_ids text[] := '{}'::text[];
  v_payment_ids text[] := '{}'::text[];
  v_claim private.billing_organization_asaas_cleanup_claims%rowtype;
  v_reconciliation_job private.asaas_reconciliation_jobs%rowtype;
  v_card_job private.billing_subscription_card_update_jobs%rowtype;
  v_recurrence private.billing_card_recurrence_provisions%rowtype;
  v_capability public.billing_payment_checkout_capabilities%rowtype;
  v_payment_cancellation private.billing_payment_checkout_cancellations%rowtype;
  v_subscription_cancellation private.billing_subscription_checkout_cancellations%rowtype;
  v_checkout_intent private.billing_checkout_intents%rowtype;
  v_restore_payment public.asaas_payments%rowtype;
  v_restore_started_at timestamptz;
  v_plan_change private.billing_plan_changes%rowtype;
  v_now timestamptz := clock_timestamp();
  v_lease_expires_at timestamptz;
  v_claim_token uuid;
  v_resource_count integer := 0;
  v_remaining_count integer := 0;
  v_inventory_issue text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service_role required' using errcode = '42501';
  end if;
  if p_organization_id is null
     or v_lease_owner is null
     or char_length(v_lease_owner) > 100
     or v_lease_owner !~ '^[A-Za-z0-9._:-]+$'
     or p_lease_seconds not between 30 and 900 then
    return jsonb_build_object('outcome', 'invalid_request');
  end if;

  select organization.*
  into v_org_hint
  from public.organizations as organization
  where organization.id = p_organization_id;
  if not found then
    return jsonb_build_object('outcome', 'organization_not_found');
  end if;

  -- Deleting an active tenant by a wrong backend id is never authorized. The
  -- deletion workflow must first deactivate the organization, then call this
  -- provider cleanup RPC. The row-lock recheck below closes a concurrent
  -- reactivation race before any destructive claim is frozen.
  if v_org_hint.is_active then
    return jsonb_build_object('outcome', 'organization_active');
  end if;
  if private.billing_organization_has_unmaterialized_provider_payment(
    p_organization_id
  ) then
    return jsonb_build_object(
      'outcome', 'manual_review',
      'reason', 'provider_payment_not_materialized'
    );
  end if;

  select coalesce(
    array_agg(candidate.provider_id order by candidate.provider_id),
    '{}'::text[]
  )
  into v_lock_subscription_ids
  from (
    select btrim(organization_row.asaas_subscription_id) as provider_id
    from public.organizations as organization_row
    where organization_row.id = p_organization_id
    union
    select btrim(subscription.provider_subscription_id)
    from public.subscriptions as subscription
    where subscription.organization_id = p_organization_id
    union
    select btrim(payment.asaas_subscription_id)
    from public.asaas_payments as payment
    where payment.organization_id = p_organization_id
    union
    select btrim(intent.provider_subscription_id)
    from private.billing_checkout_intents as intent
    where intent.organization_id = p_organization_id
    union
    select btrim(provision.provider_subscription_id)
    from private.billing_card_recurrence_provisions as provision
    where provision.organization_id = p_organization_id
    union
    select btrim(job.provider_subscription_id)
    from private.billing_subscription_card_update_jobs as job
    where job.organization_id = p_organization_id
    union
    select btrim(plan_change.provider_subscription_id)
    from private.billing_plan_changes as plan_change
    where plan_change.organization_id = p_organization_id
    union
    select btrim(job.provider_subscription_id)
    from private.asaas_reconciliation_jobs as job
    where job.organization_id = p_organization_id
    union
    select btrim(cancellation.provider_subscription_id)
    from private.billing_subscription_checkout_cancellations as cancellation
    where cancellation.organization_id = p_organization_id
    union
    select btrim(cleanup.provider_subscription_id)
    from private.billing_organization_asaas_cleanup_claims as cleanup
    where cleanup.organization_id = p_organization_id
  ) as candidate
  where nullif(btrim(coalesce(candidate.provider_id, '')), '') is not null
    and (
      exists (
        select 1
        from private.billing_organization_asaas_cleanup_claims as cleanup
        where cleanup.organization_id = p_organization_id
          and cleanup.provider_subscription_id = candidate.provider_id
      )
      or not private.billing_subscription_provider_delete_is_proven(
        p_organization_id,
        candidate.provider_id
      )
    );

  select coalesce(
    array_agg(candidate.provider_id order by candidate.provider_id),
    '{}'::text[]
  )
  into v_lock_customer_ids
  from (
    select btrim(organization_row.asaas_customer_id) as provider_id
    from public.organizations as organization_row
    where organization_row.id = p_organization_id
    union
    select btrim(subscription.provider_customer_id)
    from public.subscriptions as subscription
    where subscription.organization_id = p_organization_id
    union
    select btrim(payment.asaas_customer_id)
    from public.asaas_payments as payment
    where payment.organization_id = p_organization_id
    union
    select btrim(intent.provider_customer_id)
    from private.billing_checkout_intents as intent
    where intent.organization_id = p_organization_id
    union
    select btrim(provision.provider_customer_id)
    from private.billing_card_recurrence_provisions as provision
    where provision.organization_id = p_organization_id
    union
    select btrim(job.provider_customer_id)
    from private.billing_subscription_card_update_jobs as job
    where job.organization_id = p_organization_id
    union
    select btrim(cancellation.provider_customer_id)
    from private.billing_payment_checkout_cancellations as cancellation
    where cancellation.organization_id = p_organization_id
    union
    select btrim(cancellation.provider_customer_id)
    from private.billing_subscription_checkout_cancellations as cancellation
    where cancellation.organization_id = p_organization_id
    union
    select btrim(cleanup.provider_customer_id)
    from private.billing_organization_asaas_cleanup_claims as cleanup
    where cleanup.organization_id = p_organization_id
  ) as candidate
  where nullif(btrim(coalesce(candidate.provider_id, '')), '') is not null;

  select coalesce(
    array_agg(candidate.provider_payment_id order by candidate.provider_payment_id),
    '{}'::text[]
  )
  into v_lock_payment_ids
  from (
    select distinct btrim(payment.asaas_payment_id) as provider_payment_id
    from public.asaas_payments as payment
    where payment.organization_id = p_organization_id
      and nullif(btrim(coalesce(payment.asaas_payment_id, '')), '') is not null
      and (
        private.billing_payment_checkout_is_actionable(payment.status)
        or private.billing_payment_checkout_is_processing(payment.status)
        or upper(btrim(coalesce(payment.status, ''))) = 'DELETED'
        or payment.raw_event #>>
          '{vimob_restore,provider_request_started_at}' is not null
      )
      and not private.billing_provider_payment_delete_is_proven(
        p_organization_id,
        payment.asaas_payment_id
      )
    union
    select provider_ref.provider_payment_id
    from private.billing_organization_provider_payment_references(
      p_organization_id
    ) as provider_ref
    where not private.billing_provider_payment_delete_is_proven(
      p_organization_id,
      provider_ref.provider_payment_id
    )
      and not exists (
        select 1
        from public.asaas_payments as payment
        where payment.organization_id = p_organization_id
          and payment.asaas_payment_id = provider_ref.provider_payment_id
      )
  ) as candidate;

  if cardinality(v_lock_payment_ids) > 10000
     or cardinality(v_lock_payment_ids)
          + cardinality(v_lock_subscription_ids)
          + cardinality(v_lock_customer_ids) > 10002 then
    return jsonb_build_object(
      'outcome', 'manual_review',
      'reason', 'resource_limit_exceeded'
    );
  end if;

  perform private.lock_asaas_cleanup_inventory(
    v_lock_payment_ids,
    v_lock_subscription_ids,
    v_lock_customer_ids
  );

  select cleanup.*
  into v_claim
  from private.billing_organization_asaas_cleanup_claims as cleanup
  where cleanup.organization_id = p_organization_id
  for update;
  if found then
    v_inventory_issue := private.billing_organization_cleanup_inventory_issue(
      p_organization_id,
      v_claim.claim_token
    );
    if v_inventory_issue is not null then
      return jsonb_build_object(
        'outcome', 'manual_review',
        'reason', v_inventory_issue,
        'claim_token', v_claim.claim_token,
        'organization_id', v_claim.organization_id
      );
    end if;

    if v_claim.completed_at is not null then
      return jsonb_build_object(
        'outcome', 'already_completed',
        'claim_token', v_claim.claim_token,
        'organization_id', v_claim.organization_id
      );
    end if;
    if v_claim.lease_expires_at > v_now
       and v_claim.lease_owner is distinct from v_lease_owner then
      return jsonb_build_object(
        'outcome', 'busy',
        'busy_reason', 'organization_cleanup',
        'retry_after_seconds', greatest(
          1,
          ceil(extract(epoch from (v_claim.lease_expires_at - v_now)))::integer
        )
      );
    end if;
    if v_claim.lease_expires_at <= v_now then
      if v_claim.claim_attempts >= v_claim.max_attempts then
        return jsonb_build_object(
          'outcome', 'manual_review',
          'reason', 'cleanup_attempts_exhausted',
          'claim_token', v_claim.claim_token
        );
      end if;
      v_lease_expires_at := v_now
        + make_interval(secs => p_lease_seconds);
      update private.billing_organization_asaas_cleanup_claims
      set
        lease_owner = v_lease_owner,
        claimed_at = v_now,
        lease_expires_at = v_lease_expires_at,
        claim_attempts = claim_attempts + 1,
        updated_at = v_now
      where organization_id = p_organization_id
        and claim_token = v_claim.claim_token
        and completed_at is null;
      v_claim.lease_expires_at := v_lease_expires_at;
    end if;

    select
      count(*)::integer,
      count(*) filter (where resource.status <> 'succeeded')::integer
    into v_resource_count, v_remaining_count
    from private.billing_organization_asaas_cleanup_resources as resource
    where resource.organization_id = p_organization_id
      and resource.claim_token = v_claim.claim_token;

    if exists (
      select 1
      from private.billing_organization_asaas_cleanup_resources as resource
      where resource.organization_id = p_organization_id
        and resource.claim_token = v_claim.claim_token
        and resource.status = 'manual_review'
    ) then
      return jsonb_build_object(
        'outcome', 'manual_review',
        'reason', 'provider_resource_delete_not_proven',
        'claim_token', v_claim.claim_token,
        'organization_id', v_claim.organization_id
      );
    end if;

    return jsonb_strip_nulls(jsonb_build_object(
      'outcome', 'recover_only',
      'claim_token', v_claim.claim_token,
      'organization_id', v_claim.organization_id,
      'resource_count', v_resource_count,
      'remaining_count', v_remaining_count,
      'lease_expires_at', v_claim.lease_expires_at
    ));
  end if;

  -- Match the billing mutation row-lock order after every provider advisory
  -- key: payments -> capabilities -> cancellation claims -> organization ->
  -- subscription -> provider job state.
  perform payment.id
  from public.asaas_payments as payment
  where payment.organization_id = p_organization_id
    and nullif(btrim(coalesce(payment.asaas_payment_id, '')), '') is not null
    and (
      private.billing_payment_checkout_is_actionable(payment.status)
      or private.billing_payment_checkout_is_processing(payment.status)
      or upper(btrim(coalesce(payment.status, ''))) = 'DELETED'
      or payment.raw_event #>>
        '{vimob_restore,provider_request_started_at}' is not null
    )
  order by payment.id
  for update;

  -- A restore POST is non-idempotent and can resurrect a DELETED payment after
  -- the cleanup inventory was frozen. The marker is therefore a hard fence:
  -- a recent request may still reconcile, while an old/invalid marker has an
  -- unknowable provider outcome and must be reviewed rather than deleted.
  for v_restore_payment in
    select payment.*
    from public.asaas_payments as payment
    where payment.organization_id = p_organization_id
      and payment.raw_event #>>
        '{vimob_restore,provider_request_started_at}' is not null
    order by payment.id
  loop
    begin
      v_restore_started_at := (
        v_restore_payment.raw_event #>>
          '{vimob_restore,provider_request_started_at}'
      )::timestamptz;
    exception
      when datetime_field_overflow or invalid_datetime_format then
        v_restore_started_at := null;
    end;

    -- An exact GET/poll observed after the non-idempotent boundary closes the
    -- ambiguity. A restored actionable payment is included in the frozen
    -- DELETE queue; an exact later DELETED snapshot proves it is already
    -- absent. No other status is silently interpreted as cleanup-safe.
    if v_restore_started_at is not null
       and v_restore_payment.last_provider_observed_at is not null
       and v_restore_payment.last_provider_observed_at
         >= v_restore_started_at then
      if private.billing_payment_checkout_is_actionable(
           v_restore_payment.status
         )
         or upper(btrim(coalesce(v_restore_payment.status, ''))) = 'DELETED'
      then
        continue;
      end if;

      return jsonb_build_object(
        'outcome', 'manual_review',
        'reason', 'payment_restore_reconciled_status_not_cleanup_safe',
        'payment_id', v_restore_payment.asaas_payment_id,
        'payment_status', upper(btrim(coalesce(v_restore_payment.status, '')))
      );
    end if;

    if v_restore_started_at is null
       or v_restore_started_at <= v_now - interval '15 minutes' then
      return jsonb_build_object(
        'outcome', 'manual_review',
        'reason', case
          when v_restore_started_at is null
            then 'payment_restore_marker_invalid'
          else 'payment_restore_outcome_unknown'
        end,
        'payment_id', v_restore_payment.asaas_payment_id
      );
    end if;

    return jsonb_build_object(
      'outcome', 'busy',
      'busy_reason', 'payment_restore_provider_request',
      'payment_id', v_restore_payment.asaas_payment_id,
      'retry_after_seconds', greatest(
        1,
        least(
          60,
          ceil(extract(epoch from (
            v_restore_started_at + interval '15 minutes' - v_now
          )))::integer
        )
      )
    );
  end loop;

  for v_capability in
    select capability.*
    from public.billing_payment_checkout_capabilities as capability
    join public.asaas_payments as payment
      on payment.id = capability.payment_id
     and payment.asaas_payment_id = capability.asaas_payment_id
     and payment.organization_id = capability.organization_id
    where capability.organization_id = p_organization_id
      and (
        private.billing_payment_checkout_is_actionable(payment.status)
        or private.billing_payment_checkout_is_processing(payment.status)
        or upper(btrim(coalesce(payment.status, ''))) = 'DELETED'
      )
    order by capability.payment_id
    for update of capability
  loop
    if v_capability.attempt_lease_id is not null
       and v_capability.attempt_lease_expires_at > v_now then
      return jsonb_build_object(
        'outcome', 'busy',
        'busy_reason', 'payment_checkout_attempt',
        'payment_id', v_capability.payment_id,
        'retry_after_seconds', greatest(
          1,
          ceil(extract(epoch from (
            v_capability.attempt_lease_expires_at - v_now
          )))::integer
        )
      );
    end if;
  end loop;

  for v_payment_cancellation in
    select cancellation.*
    from private.billing_payment_checkout_cancellations as cancellation
    where cancellation.organization_id = p_organization_id
      and cancellation.finalized_at is null
    order by cancellation.intent_id
    for update
  loop
    if v_payment_cancellation.provider_delete_started_at is not null
       and v_payment_cancellation.lease_expires_at <= v_now then
      return jsonb_build_object(
        'outcome', 'manual_review',
        'reason', 'payment_delete_outcome_unknown',
        'payment_id', v_payment_cancellation.provider_payment_id
      );
    end if;

    return jsonb_build_object(
      'outcome', 'busy',
      'busy_reason', 'payment_cancellation',
      'payment_id', v_payment_cancellation.provider_payment_id,
      'retry_after_seconds', greatest(
        1,
        case
          when v_payment_cancellation.lease_expires_at > v_now
            then ceil(extract(epoch from (
              v_payment_cancellation.lease_expires_at - v_now
            )))::integer
          else 30
        end
      )
    );
  end loop;

  for v_subscription_cancellation in
    select cancellation.*
    from private.billing_subscription_checkout_cancellations as cancellation
    where cancellation.organization_id = p_organization_id
      and cancellation.finalized_at is null
    order by cancellation.intent_id
    for update
  loop
    if v_subscription_cancellation.lease_expires_at <= v_now then
      return jsonb_build_object(
        'outcome', 'manual_review',
        'reason', 'subscription_delete_outcome_unknown',
        'subscription_id',
          v_subscription_cancellation.provider_subscription_id
      );
    end if;

    return jsonb_build_object(
      'outcome', 'busy',
      'busy_reason', 'subscription_cancellation',
      'subscription_id', v_subscription_cancellation.provider_subscription_id,
      'retry_after_seconds', greatest(
        1,
        ceil(extract(epoch from (
          v_subscription_cancellation.lease_expires_at - v_now
        )))::integer
      )
    );
  end loop;

  select organization.*
  into v_org
  from public.organizations as organization
  where organization.id = p_organization_id
  for update;
  if not found then
    return jsonb_build_object('outcome', 'organization_not_found');
  end if;

  if v_org.is_active then
    return jsonb_build_object('outcome', 'organization_active');
  end if;
  if private.billing_organization_has_unmaterialized_provider_payment(
    p_organization_id
  ) then
    return jsonb_build_object(
      'outcome', 'manual_review',
      'reason', 'provider_payment_not_materialized'
    );
  end if;

  -- Rebuild the complete provider identity under the organization row lock.
  -- The organization columns are not authoritative by themselves: a failed
  -- prior write can leave the only durable customer/subscription id on a
  -- subscription, payment, intent or worker job.
  select coalesce(
    array_agg(candidate.provider_id order by candidate.provider_id),
    '{}'::text[]
  )
  into v_current_subscription_ids
  from (
    select btrim(organization_row.asaas_subscription_id) as provider_id
    from public.organizations as organization_row
    where organization_row.id = p_organization_id
    union
    select btrim(subscription.provider_subscription_id)
    from public.subscriptions as subscription
    where subscription.organization_id = p_organization_id
    union
    select btrim(payment.asaas_subscription_id)
    from public.asaas_payments as payment
    where payment.organization_id = p_organization_id
    union
    select btrim(intent.provider_subscription_id)
    from private.billing_checkout_intents as intent
    where intent.organization_id = p_organization_id
    union
    select btrim(provision.provider_subscription_id)
    from private.billing_card_recurrence_provisions as provision
    where provision.organization_id = p_organization_id
    union
    select btrim(job.provider_subscription_id)
    from private.billing_subscription_card_update_jobs as job
    where job.organization_id = p_organization_id
    union
    select btrim(plan_change.provider_subscription_id)
    from private.billing_plan_changes as plan_change
    where plan_change.organization_id = p_organization_id
    union
    select btrim(job.provider_subscription_id)
    from private.asaas_reconciliation_jobs as job
    where job.organization_id = p_organization_id
    union
    select btrim(cancellation.provider_subscription_id)
    from private.billing_subscription_checkout_cancellations as cancellation
    where cancellation.organization_id = p_organization_id
    union
    select btrim(cleanup.provider_subscription_id)
    from private.billing_organization_asaas_cleanup_claims as cleanup
    where cleanup.organization_id = p_organization_id
  ) as candidate
  where nullif(btrim(coalesce(candidate.provider_id, '')), '') is not null
    and (
      exists (
        select 1
        from private.billing_organization_asaas_cleanup_claims as cleanup
        where cleanup.organization_id = p_organization_id
          and cleanup.provider_subscription_id = candidate.provider_id
      )
      or not private.billing_subscription_provider_delete_is_proven(
        p_organization_id,
        candidate.provider_id
      )
    );

  select coalesce(
    array_agg(candidate.provider_id order by candidate.provider_id),
    '{}'::text[]
  )
  into v_current_customer_ids
  from (
    select btrim(organization_row.asaas_customer_id) as provider_id
    from public.organizations as organization_row
    where organization_row.id = p_organization_id
    union
    select btrim(subscription.provider_customer_id)
    from public.subscriptions as subscription
    where subscription.organization_id = p_organization_id
    union
    select btrim(payment.asaas_customer_id)
    from public.asaas_payments as payment
    where payment.organization_id = p_organization_id
    union
    select btrim(intent.provider_customer_id)
    from private.billing_checkout_intents as intent
    where intent.organization_id = p_organization_id
    union
    select btrim(provision.provider_customer_id)
    from private.billing_card_recurrence_provisions as provision
    where provision.organization_id = p_organization_id
    union
    select btrim(job.provider_customer_id)
    from private.billing_subscription_card_update_jobs as job
    where job.organization_id = p_organization_id
    union
    select btrim(cancellation.provider_customer_id)
    from private.billing_payment_checkout_cancellations as cancellation
    where cancellation.organization_id = p_organization_id
    union
    select btrim(cancellation.provider_customer_id)
    from private.billing_subscription_checkout_cancellations as cancellation
    where cancellation.organization_id = p_organization_id
    union
    select btrim(cleanup.provider_customer_id)
    from private.billing_organization_asaas_cleanup_claims as cleanup
    where cleanup.organization_id = p_organization_id
  ) as candidate
  where nullif(btrim(coalesce(candidate.provider_id, '')), '') is not null;

  if v_current_subscription_ids is distinct from v_lock_subscription_ids
     or v_current_customer_ids is distinct from v_lock_customer_ids then
    return jsonb_build_object('outcome', 'state_changed');
  end if;

  if private.billing_subscription_delete_proof_has_live_conflict(
    p_organization_id
  ) then
    return jsonb_build_object(
      'outcome', 'manual_review',
      'reason', 'provider_subscription_liveness_conflict'
    );
  end if;

  if cardinality(v_current_subscription_ids) > 1 then
    return jsonb_build_object(
      'outcome', 'manual_review',
      'reason', 'multiple_provider_subscriptions'
    );
  end if;
  if cardinality(v_current_customer_ids) > 1 then
    return jsonb_build_object(
      'outcome', 'manual_review',
      'reason', 'multiple_provider_customers'
    );
  end if;

  v_subscription_id := v_current_subscription_ids[1];
  v_customer_id := v_current_customer_ids[1];

  select coalesce(
    array_agg(candidate.provider_payment_id order by candidate.provider_payment_id),
    '{}'::text[]
  )
  into v_current_payment_ids
  from (
    select distinct btrim(payment.asaas_payment_id) as provider_payment_id
    from public.asaas_payments as payment
    where payment.organization_id = p_organization_id
      and nullif(btrim(coalesce(payment.asaas_payment_id, '')), '') is not null
      and (
        private.billing_payment_checkout_is_actionable(payment.status)
        or private.billing_payment_checkout_is_processing(payment.status)
        or upper(btrim(coalesce(payment.status, ''))) = 'DELETED'
        or payment.raw_event #>>
          '{vimob_restore,provider_request_started_at}' is not null
      )
      and not private.billing_provider_payment_delete_is_proven(
        p_organization_id,
        payment.asaas_payment_id
      )
    union
    select provider_ref.provider_payment_id
    from private.billing_organization_provider_payment_references(
      p_organization_id
    ) as provider_ref
    where not private.billing_provider_payment_delete_is_proven(
      p_organization_id,
      provider_ref.provider_payment_id
    )
      and not exists (
        select 1
        from public.asaas_payments as payment
        where payment.organization_id = p_organization_id
          and payment.asaas_payment_id = provider_ref.provider_payment_id
      )
  ) as candidate;
  if v_current_payment_ids is distinct from v_lock_payment_ids then
    return jsonb_build_object('outcome', 'state_changed');
  end if;

  if v_customer_id is null
     and (
       v_subscription_id is not null
       or cardinality(v_current_payment_ids) > 0
     ) then
    return jsonb_build_object(
      'outcome', 'manual_review',
      'reason', 'incomplete_provider_identity'
    );
  end if;

  -- Customer and subscription ids are not schema-unique. Prove exclusive
  -- ownership across every billing relation before authorizing any DELETE.
  if v_customer_id is not null and (
    exists (
      select 1 from public.organizations as owner
      where owner.id <> p_organization_id
        and btrim(coalesce(owner.asaas_customer_id, '')) = v_customer_id
    )
    or exists (
      select 1 from public.subscriptions as owner
      where owner.organization_id <> p_organization_id
        and btrim(coalesce(owner.provider_customer_id, '')) = v_customer_id
    )
    or exists (
      select 1 from public.asaas_payments as owner
      where owner.organization_id <> p_organization_id
        and btrim(coalesce(owner.asaas_customer_id, '')) = v_customer_id
    )
    or exists (
      select 1 from private.billing_checkout_intents as owner
      where owner.organization_id <> p_organization_id
        and btrim(coalesce(owner.provider_customer_id, '')) = v_customer_id
    )
    or exists (
      select 1 from private.billing_card_recurrence_provisions as owner
      where owner.organization_id <> p_organization_id
        and btrim(coalesce(owner.provider_customer_id, '')) = v_customer_id
    )
    or exists (
      select 1 from private.billing_subscription_card_update_jobs as owner
      where owner.organization_id <> p_organization_id
        and btrim(coalesce(owner.provider_customer_id, '')) = v_customer_id
    )
    or exists (
      select 1 from private.billing_payment_checkout_cancellations as owner
      where owner.organization_id <> p_organization_id
        and btrim(coalesce(owner.provider_customer_id, '')) = v_customer_id
    )
    or exists (
      select 1 from private.billing_subscription_checkout_cancellations as owner
      where owner.organization_id <> p_organization_id
        and btrim(coalesce(owner.provider_customer_id, '')) = v_customer_id
    )
    or exists (
      select 1 from private.billing_organization_asaas_cleanup_claims as owner
      where owner.organization_id <> p_organization_id
        and btrim(coalesce(owner.provider_customer_id, '')) = v_customer_id
    )
  ) then
    return jsonb_build_object(
      'outcome', 'manual_review',
      'reason', 'provider_customer_shared_across_organizations'
    );
  end if;

  if v_subscription_id is not null and (
    exists (
      select 1 from public.organizations as owner
      where owner.id <> p_organization_id
        and btrim(coalesce(owner.asaas_subscription_id, '')) = v_subscription_id
    )
    or exists (
      select 1 from public.subscriptions as owner
      where owner.organization_id <> p_organization_id
        and btrim(coalesce(owner.provider_subscription_id, '')) = v_subscription_id
    )
    or exists (
      select 1 from public.asaas_payments as owner
      where owner.organization_id <> p_organization_id
        and btrim(coalesce(owner.asaas_subscription_id, '')) = v_subscription_id
    )
    or exists (
      select 1 from private.billing_checkout_intents as owner
      where owner.organization_id <> p_organization_id
        and btrim(coalesce(owner.provider_subscription_id, '')) = v_subscription_id
    )
    or exists (
      select 1 from private.billing_card_recurrence_provisions as owner
      where owner.organization_id <> p_organization_id
        and btrim(coalesce(owner.provider_subscription_id, '')) = v_subscription_id
    )
    or exists (
      select 1 from private.billing_subscription_card_update_jobs as owner
      where owner.organization_id <> p_organization_id
        and btrim(coalesce(owner.provider_subscription_id, '')) = v_subscription_id
    )
    or exists (
      select 1 from private.billing_plan_changes as owner
      where owner.organization_id <> p_organization_id
        and btrim(coalesce(owner.provider_subscription_id, '')) = v_subscription_id
    )
    or exists (
      select 1 from private.asaas_reconciliation_jobs as owner
      where owner.organization_id <> p_organization_id
        and btrim(coalesce(owner.provider_subscription_id, '')) = v_subscription_id
    )
    or exists (
      select 1 from private.billing_subscription_checkout_cancellations as owner
      where owner.organization_id <> p_organization_id
        and btrim(coalesce(owner.provider_subscription_id, '')) = v_subscription_id
    )
    or exists (
      select 1 from private.billing_organization_asaas_cleanup_claims as owner
      where owner.organization_id <> p_organization_id
        and btrim(coalesce(owner.provider_subscription_id, '')) = v_subscription_id
    )
  ) then
    return jsonb_build_object(
      'outcome', 'manual_review',
      'reason', 'provider_subscription_shared_across_organizations'
    );
  end if;

  select job.*
  into v_reconciliation_job
  from private.asaas_reconciliation_jobs as job
  where job.organization_id = p_organization_id
  for update;

  if found then
    if v_reconciliation_job.provider_subscription_id
         is distinct from v_subscription_id then
      return jsonb_build_object(
        'outcome', 'manual_review',
        'reason', 'reconciliation_subscription_mismatch'
      );
    end if;

    if v_reconciliation_job.status = 'processing' then
      if v_reconciliation_job.locked_at is not null
         and v_reconciliation_job.locked_at
           >= v_now - interval '10 minutes' then
        return jsonb_build_object(
          'outcome', 'busy',
          'busy_reason', 'billing_reconciliation',
          'retry_after_seconds', greatest(
            1,
            ceil(extract(epoch from (
              v_reconciliation_job.locked_at + interval '10 minutes' - v_now
            )))::integer
          )
        );
      end if;

      return jsonb_build_object(
        'outcome', 'manual_review',
        'reason', 'billing_reconciliation_outcome_unknown'
      );
    end if;

    if v_reconciliation_job.status = 'dead'
       and v_reconciliation_job.last_error
         is distinct from 'organization_cleanup_won' then
      return jsonb_build_object(
        'outcome', 'manual_review',
        'reason', 'billing_reconciliation_dead_letter'
      );
    end if;

    if v_reconciliation_job.status in ('pending', 'retry') then
      update private.asaas_reconciliation_jobs as job
      set
        status = 'dead',
        attempts = greatest(job.attempts, job.max_attempts),
        locked_at = null,
        locked_by = null,
        last_error = 'organization_cleanup_won',
        updated_at = v_now
      where job.organization_id = p_organization_id
        and job.status in ('pending', 'retry');
    end if;
  end if;

  -- Reservation commits `creating` plus the provider-request marker before
  -- the Asaas POST. Because the organization row is locked here, a concurrent
  -- reservation either committed before this check or is held until the
  -- durable cleanup-intent trigger can reject it after the claim is frozen.
  -- Never infer that a provider object is absent from a missing local payment.
  for v_checkout_intent in
    select intent.*
    from private.billing_checkout_intents as intent
    where intent.organization_id = p_organization_id
      and intent.status in ('creating', 'pending')
    order by intent.created_at, intent.id
  loop
    if v_checkout_intent.status = 'creating' then
      if v_checkout_intent.provider_request_started_at is not null
         and v_checkout_intent.provider_request_started_at
           > v_now - interval '15 minutes' then
        return jsonb_build_object(
          'outcome', 'busy',
          'busy_reason', 'checkout_provider_request',
          'intent_id', v_checkout_intent.id,
          'retry_after_seconds', greatest(
            1,
            least(
              60,
              ceil(extract(epoch from (
                v_checkout_intent.provider_request_started_at
                  + interval '15 minutes' - v_now
              )))::integer
            )
          )
        );
      end if;

      return jsonb_build_object(
        'outcome', 'manual_review',
        'reason', 'checkout_provider_outcome_unknown',
        'intent_id', v_checkout_intent.id
      );
    end if;

    if v_checkout_intent.provider_customer_id is null
       or v_customer_id is null
       or btrim(v_checkout_intent.provider_customer_id) <> v_customer_id then
      return jsonb_build_object(
        'outcome', 'manual_review',
        'reason', 'checkout_customer_not_materialized',
        'intent_id', v_checkout_intent.id
      );
    end if;

    if v_checkout_intent.provider_payment_id is not null
       and exists (
         select 1
         from public.asaas_payments as payment
         where payment.organization_id = p_organization_id
           and payment.billing_intent_id = v_checkout_intent.id
           and payment.asaas_payment_id
             = btrim(v_checkout_intent.provider_payment_id)
           and private.billing_payment_checkout_is_processing(payment.status)
       ) then
      return jsonb_build_object(
        'outcome', 'busy',
        'busy_reason', 'checkout_payment_processing',
        'intent_id', v_checkout_intent.id,
        'retry_after_seconds', 60
      );
    end if;

    if v_checkout_intent.billing_method in ('PIX', 'BOLETO') then
      if v_checkout_intent.provider_payment_id is null
         or not exists (
           select 1
           from public.asaas_payments as payment
           where payment.organization_id = p_organization_id
             and payment.billing_intent_id = v_checkout_intent.id
             and payment.asaas_payment_id
               = btrim(v_checkout_intent.provider_payment_id)
             and private.billing_payment_checkout_is_actionable(payment.status)
         ) then
        return jsonb_build_object(
          'outcome', 'manual_review',
          'reason', 'checkout_payment_not_materialized',
          'intent_id', v_checkout_intent.id
        );
      end if;
    elsif v_checkout_intent.billing_method = 'CREDIT_CARD' then
      if v_checkout_intent.provider_subscription_id is null
         or v_subscription_id is null
         or btrim(v_checkout_intent.provider_subscription_id)
           <> v_subscription_id
         or not exists (
           select 1
           from public.subscriptions as subscription
           where subscription.organization_id = p_organization_id
             and subscription.provider_subscription_id = v_subscription_id
         ) then
        return jsonb_build_object(
          'outcome', 'manual_review',
          'reason', 'checkout_subscription_not_materialized',
          'intent_id', v_checkout_intent.id
        );
      end if;
    else
      return jsonb_build_object(
        'outcome', 'manual_review',
        'reason', 'checkout_method_not_reconcilable',
        'intent_id', v_checkout_intent.id
      );
    end if;
  end loop;

  if exists (
    select 1
    from public.asaas_payments as payment
    where payment.organization_id = p_organization_id
      and private.billing_payment_checkout_is_processing(payment.status)
  ) then
    return jsonb_build_object(
      'outcome', 'busy',
      'busy_reason', 'payment_processing',
      'retry_after_seconds', 60
    );
  end if;

  perform subscription.id
  from public.subscriptions as subscription
  where subscription.organization_id = p_organization_id
    and (
      v_subscription_id is null
      or subscription.provider_subscription_id = v_subscription_id
    )
  order by subscription.id
  for update;

  for v_recurrence in
    select provision.*
    from private.billing_card_recurrence_provisions as provision
    where provision.organization_id = p_organization_id
      and (
        provision.status in ('prepared', 'creating', 'recovering', 'failed')
        or provision.job_status in ('waiting', 'pending', 'processing', 'retry')
        or provision.capture_manual_review_at is not null
        or (
          provision.status = 'completed'
          and provision.job_action = 'cancel'
          and provision.job_status in ('pending', 'retry', 'processing', 'dead')
        )
      )
    order by provision.payment_id
    for update
  loop
    if v_recurrence.capture_manual_review_at is not null
       or (
         v_recurrence.capture_request_started_at is not null
         and v_recurrence.status not in ('completed', 'cancelled')
         and v_recurrence.capture_request_started_at
           <= v_now - interval '15 minutes'
       ) then
      return jsonb_build_object(
        'outcome', 'manual_review',
        'reason', 'card_capture_outcome_unknown',
        'payment_id', v_recurrence.provider_payment_id
      );
    end if;
    if v_recurrence.capture_request_started_at is not null
       and v_recurrence.status not in ('completed', 'cancelled') then
      return jsonb_build_object(
        'outcome', 'busy',
        'busy_reason', 'card_capture_provider_request',
        'payment_id', v_recurrence.provider_payment_id,
        'retry_after_seconds', greatest(
          1,
          least(
            60,
            ceil(extract(epoch from (
              v_recurrence.capture_request_started_at
                + interval '15 minutes' - v_now
            )))::integer
          )
        )
      );
    end if;

    if v_recurrence.job_action = 'cancel' then
      if v_recurrence.job_status = 'dead' then
        return jsonb_build_object(
          'outcome', 'manual_review',
          'reason', 'recurrence_cancellation_dead_letter',
          'subscription_id', v_recurrence.provider_subscription_id
        );
      end if;

      if v_recurrence.job_status in ('pending', 'retry') then
        return jsonb_build_object(
          'outcome', 'busy',
          'busy_reason', 'recurrence_cancellation_queued',
          'subscription_id', v_recurrence.provider_subscription_id,
          'retry_after_seconds', greatest(
            1,
            least(
              60,
              ceil(extract(epoch from (
                greatest(v_recurrence.job_next_attempt_at, v_now) - v_now
              )))::integer
            )
          )
        );
      end if;

      if v_recurrence.job_status = 'processing'
         and v_recurrence.job_lock_expires_at > v_now then
        return jsonb_build_object(
          'outcome', 'busy',
          'busy_reason', 'recurrence_cancellation_provider_request',
          'subscription_id', v_recurrence.provider_subscription_id,
          'retry_after_seconds', greatest(
            1,
            ceil(extract(epoch from (
              v_recurrence.job_lock_expires_at - v_now
            )))::integer
          )
        );
      end if;

      if v_recurrence.job_status = 'processing' then
        return jsonb_build_object(
          'outcome', 'manual_review',
          'reason', 'recurrence_cancellation_outcome_unknown',
          'subscription_id', v_recurrence.provider_subscription_id
        );
      end if;
    end if;

    if v_recurrence.job_action = 'create'
       and v_recurrence.provider_request_started_at is not null
       and v_recurrence.status not in ('completed', 'cancelled') then
      if v_recurrence.job_status = 'processing'
         and v_recurrence.job_lock_expires_at > v_now then
        return jsonb_build_object(
          'outcome', 'busy',
          'busy_reason', 'recurrence_create_provider_request',
          'payment_id', v_recurrence.provider_payment_id,
          'retry_after_seconds', greatest(
            1,
            ceil(extract(epoch from (
              v_recurrence.job_lock_expires_at - v_now
            )))::integer
          )
        );
      end if;
      return jsonb_build_object(
        'outcome', 'manual_review',
        'reason', 'recurrence_create_outcome_unknown',
        'payment_id', v_recurrence.provider_payment_id
      );
    end if;

    update private.billing_card_recurrence_provisions as provision
    set
      status = case
        when provision.status in ('prepared', 'creating', 'recovering')
          then 'failed'
        else provision.status
      end,
      provider_card_credential = null,
      card_last4 = null,
      credential_attempt_lease_id = null,
      lease_id = null,
      lease_expires_at = null,
      failed_at = case
        when provision.status in ('prepared', 'creating', 'recovering')
          then coalesce(provision.failed_at, v_now)
        else provision.failed_at
      end,
      last_error = 'organization_cleanup_won',
      job_status = case
        when provision.job_status in ('waiting', 'pending', 'processing', 'retry')
          then 'cancelled'
        else provision.job_status
      end,
      job_locked_at = null,
      job_lock_expires_at = null,
      job_locked_by = null,
      job_lease_id = null,
      job_last_error_code = 'organization_cleanup_won',
      updated_at = v_now
    where provision.payment_id = v_recurrence.payment_id;
  end loop;

  select plan_change.*
  into v_plan_change
  from private.billing_plan_changes as plan_change
  where plan_change.organization_id = p_organization_id
    and plan_change.status in ('provider_updating', 'scheduled', 'applying')
  order by plan_change.created_at desc
  limit 1
  for update;
  if found and v_plan_change.status = 'provider_updating' then
    return jsonb_build_object(
      'outcome', 'manual_review',
      'reason', 'plan_change_provider_outcome_unknown',
      'plan_change_id', v_plan_change.id
    );
  end if;
  if found then
    update private.billing_plan_changes as plan_change
    set
      status = 'cancelled',
      last_error = 'organization_cleanup_won',
      updated_at = v_now
    where plan_change.id = v_plan_change.id
      and plan_change.status in ('scheduled', 'applying');
  end if;

  if v_subscription_id is not null then
    select job.*
    into v_card_job
    from private.billing_subscription_card_update_jobs as job
    where job.organization_id = p_organization_id
      and job.provider_subscription_id = v_subscription_id
      and (
        job.status in (
          'prepared', 'awaiting_payment', 'pending_update', 'processing', 'retry'
        )
        or (job.status = 'dead' and job.manual_review_at is not null)
      )
    order by job.generation desc
    limit 1
    for update;

    if found and (
      v_card_job.manual_review_at is not null
      or v_card_job.provider_outcome_ambiguous_at is not null
      or (
        v_card_job.capture_request_started_at is not null
        and v_card_job.status = 'awaiting_payment'
        and v_card_job.capture_request_started_at
          <= v_now - interval '15 minutes'
      )
      or (
        v_card_job.status = 'processing'
        and v_card_job.provider_request_started_at is not null
        and v_card_job.provider_request_lease_id = v_card_job.lease_id
        and v_card_job.lease_expires_at <= v_now
      )
    ) then
      return jsonb_build_object(
        'outcome', 'manual_review',
        'reason', 'card_update_provider_outcome_ambiguous',
        'job_id', v_card_job.id
      );
    end if;
    if found and (
      (
        v_card_job.status = 'awaiting_payment'
        and v_card_job.capture_request_started_at is not null
      )
      or (
        v_card_job.status = 'processing'
        and v_card_job.provider_request_started_at is not null
        and v_card_job.provider_request_lease_id = v_card_job.lease_id
      )
    ) then
      return jsonb_build_object(
        'outcome', 'busy',
        'busy_reason', 'card_update_provider_request',
        'job_id', v_card_job.id,
        'retry_after_seconds', greatest(
          1,
          ceil(extract(epoch from (
            coalesce(v_card_job.lease_expires_at, v_now + interval '10 minutes')
              - v_now
          )))::integer
        )
      );
    end if;
    if found then
      update private.billing_subscription_card_update_jobs
      set
        status = 'cancelled',
        provider_card_credential = null,
        card_last4 = null,
        credential_attempt_lease_id = null,
        lease_id = null,
        lease_owner = null,
        lease_started_at = null,
        lease_expires_at = null,
        last_error_code = 'organization_cleanup_won',
        manual_review_at = null,
        cancelled_at = v_now,
        updated_at = v_now
      where id = v_card_job.id
        and status in (
          'prepared', 'awaiting_payment', 'pending_update', 'processing', 'retry'
        );
    end if;
  end if;

  select coalesce(
    array_agg(btrim(payment.asaas_payment_id) order by payment.created_at, payment.id),
    '{}'::text[]
  )
  into v_payment_ids
  from public.asaas_payments as payment
  where payment.organization_id = p_organization_id
    and nullif(btrim(coalesce(payment.asaas_payment_id, '')), '') is not null
    and private.billing_payment_checkout_is_actionable(payment.status)
    and not private.billing_provider_payment_delete_is_proven(
      p_organization_id,
      payment.asaas_payment_id
    );

  v_claim_token := extensions.gen_random_uuid();
  v_lease_expires_at := v_now + make_interval(secs => p_lease_seconds);
  insert into private.billing_organization_asaas_cleanup_claims (
    organization_id,
    provider_customer_id,
    provider_subscription_id,
    provider_payment_ids,
    claim_token,
    lease_owner,
    claimed_at,
    lease_expires_at,
    provider_cleanup_started_at,
    created_at,
    updated_at
  ) values (
    p_organization_id,
    v_customer_id,
    v_subscription_id,
    v_payment_ids,
    v_claim_token,
    v_lease_owner,
    v_now,
    v_lease_expires_at,
    v_now,
    v_now,
    v_now
  );

  insert into private.billing_organization_asaas_cleanup_resources (
    organization_id,
    claim_token,
    resource_kind,
    resource_id,
    delete_order,
    created_at,
    updated_at
  )
  select
    p_organization_id,
    v_claim_token,
    'payment',
    payment_id,
    10,
    v_now,
    v_now
  from unnest(v_payment_ids) as frozen(payment_id);

  if v_subscription_id is not null then
    insert into private.billing_organization_asaas_cleanup_resources (
      organization_id, claim_token, resource_kind, resource_id, delete_order,
      created_at, updated_at
    ) values (
      p_organization_id, v_claim_token, 'subscription', v_subscription_id, 20,
      v_now, v_now
    );
  end if;

  if v_customer_id is not null then
    insert into private.billing_organization_asaas_cleanup_resources (
      organization_id, claim_token, resource_kind, resource_id, delete_order,
      created_at, updated_at
    ) values (
      p_organization_id, v_claim_token, 'customer', v_customer_id, 30,
      v_now, v_now
    );
  end if;

  select count(*)::integer
  into v_resource_count
  from private.billing_organization_asaas_cleanup_resources as resource
  where resource.organization_id = p_organization_id
    and resource.claim_token = v_claim_token;

  -- No public checkout may start a fresh provider mutation after organization
  -- cleanup has been authorized.
  update public.billing_payment_checkout_capabilities
  set
    revoked_at = coalesce(revoked_at, v_now),
    attempt_lease_id = null,
    attempt_lease_expires_at = null,
    updated_at = v_now
  where organization_id = p_organization_id;

  return jsonb_strip_nulls(jsonb_build_object(
    'outcome', 'proceed',
    'claim_token', v_claim_token,
    'organization_id', p_organization_id,
    'resource_count', v_resource_count,
    'remaining_count', v_resource_count,
    'lease_expires_at', v_lease_expires_at
  ));
end
$function$;

revoke all on function public.claim_billing_organization_asaas_cleanup(
  uuid, text, integer
) from PUBLIC, anon, authenticated, service_role;
grant execute on function public.claim_billing_organization_asaas_cleanup(
  uuid, text, integer
) to service_role;

create or replace function public.claim_billing_organization_asaas_cleanup_resource(
  p_organization_id uuid,
  p_claim_token uuid,
  p_lease_owner text,
  p_lease_seconds integer default 300
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_lease_owner text := nullif(btrim(coalesce(p_lease_owner, '')), '');
  v_claim private.billing_organization_asaas_cleanup_claims%rowtype;
  v_resource_hint private.billing_organization_asaas_cleanup_resources%rowtype;
  v_resource private.billing_organization_asaas_cleanup_resources%rowtype;
  v_attempt_token uuid;
  v_now timestamptz := clock_timestamp();
  v_lease_expires_at timestamptz;
  v_inventory_issue text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service_role required' using errcode = '42501';
  end if;
  if p_organization_id is null
     or p_claim_token is null
     or v_lease_owner is null
     or char_length(v_lease_owner) > 100
     or v_lease_owner !~ '^[A-Za-z0-9._:-]+$'
     or p_lease_seconds not between 30 and 600 then
    return jsonb_build_object('outcome', 'invalid_request');
  end if;

  -- Discover without a row lock so the exact provider advisory key remains
  -- first in the global lock order. Every predicate is rechecked below.
  select resource.*
  into v_resource_hint
  from private.billing_organization_asaas_cleanup_resources as resource
  where resource.organization_id = p_organization_id
    and resource.claim_token = p_claim_token
    and resource.status <> 'succeeded'
  order by resource.delete_order, resource.resource_id
  limit 1;

  if found then
    perform private.lock_asaas_billing_resources(
      case when v_resource_hint.resource_kind = 'payment'
        then v_resource_hint.resource_id else null end,
      case when v_resource_hint.resource_kind = 'subscription'
        then v_resource_hint.resource_id else null end
    );
  end if;

  -- Keep the global destructive order: provider advisory, organization
  -- tombstone, cleanup claim, then the concrete resource row.
  perform organization_row.id
  from public.organizations as organization_row
  where organization_row.id = p_organization_id
  for update;
  if not found then
    return jsonb_build_object('outcome', 'organization_not_found');
  end if;

  select cleanup.*
  into v_claim
  from private.billing_organization_asaas_cleanup_claims as cleanup
  where cleanup.organization_id = p_organization_id
    and cleanup.claim_token = p_claim_token
  for update;
  if not found then
    return jsonb_build_object('outcome', 'claim_not_found');
  end if;
  if v_claim.last_error_code is not null then
    return jsonb_build_object(
      'outcome', 'manual_review',
      'reason', v_claim.last_error_code
    );
  end if;
  if v_claim.completed_at is not null then
    return jsonb_build_object('outcome', 'already_completed');
  end if;

  v_inventory_issue := private.billing_organization_cleanup_inventory_issue(
    p_organization_id,
    p_claim_token
  );
  if v_inventory_issue is not null then
    return jsonb_build_object(
      'outcome', 'manual_review',
      'reason', v_inventory_issue
    );
  end if;

  if exists (
    select 1
    from private.billing_organization_asaas_cleanup_resources as resource
    where resource.organization_id = p_organization_id
      and resource.claim_token = p_claim_token
      and resource.status = 'manual_review'
  ) then
    return jsonb_build_object(
      'outcome', 'manual_review',
      'reason', 'provider_resource_delete_not_proven'
    );
  end if;

  select resource.*
  into v_resource
  from private.billing_organization_asaas_cleanup_resources as resource
  where resource.organization_id = p_organization_id
    and resource.claim_token = p_claim_token
    and resource.status <> 'succeeded'
  order by resource.delete_order, resource.resource_id
  limit 1
  for update;
  if not found then
    return jsonb_build_object('outcome', 'complete');
  end if;
  if v_resource.resource_kind is distinct from v_resource_hint.resource_kind
     or v_resource.resource_id is distinct from v_resource_hint.resource_id then
    return jsonb_build_object('outcome', 'state_changed');
  end if;

  if v_resource.status = 'processing' then
    if v_resource.lease_expires_at > v_now then
      return jsonb_build_object(
        'outcome', 'busy',
        'busy_reason', 'provider_resource_delete',
        'resource_kind', v_resource.resource_kind,
        'resource_id', v_resource.resource_id,
        'retry_after_seconds', greatest(
          1,
          ceil(extract(epoch from (
            v_resource.lease_expires_at - v_now
          )))::integer
        )
      );
    end if;

    -- The first DELETE may have reached Asaas. Replaying it and interpreting
    -- 404 would conflate "already deleted" with wrong account/not found.
    update private.billing_organization_asaas_cleanup_resources as resource
    set
      status = 'manual_review',
      manual_review_at = v_now,
      last_error_code = 'provider_delete_outcome_unknown',
      updated_at = v_now
    where resource.organization_id = p_organization_id
      and resource.claim_token = p_claim_token
      and resource.resource_kind = v_resource.resource_kind
      and resource.resource_id = v_resource.resource_id
      and resource.status = 'processing'
      and resource.attempt_token = v_resource.attempt_token;

    return jsonb_build_object(
      'outcome', 'manual_review',
      'reason', 'provider_delete_outcome_unknown',
      'resource_kind', v_resource.resource_kind,
      'resource_id', v_resource.resource_id
    );
  end if;
  if v_resource.status <> 'pending' then
    return jsonb_build_object('outcome', 'state_changed');
  end if;

  v_attempt_token := extensions.gen_random_uuid();
  v_lease_expires_at := v_now + make_interval(secs => p_lease_seconds);
  update private.billing_organization_asaas_cleanup_resources as resource
  set
    status = 'processing',
    attempt_token = v_attempt_token,
    lease_owner = v_lease_owner,
    lease_started_at = v_now,
    lease_expires_at = v_lease_expires_at,
    provider_delete_started_at = v_now,
    updated_at = v_now
  where resource.organization_id = p_organization_id
    and resource.claim_token = p_claim_token
    and resource.resource_kind = v_resource.resource_kind
    and resource.resource_id = v_resource.resource_id
    and resource.status = 'pending';
  if not found then
    return jsonb_build_object('outcome', 'state_changed');
  end if;

  return jsonb_build_object(
    'outcome', 'proceed',
    'claim_token', p_claim_token,
    'resource_kind', v_resource.resource_kind,
    'resource_id', v_resource.resource_id,
    'attempt_token', v_attempt_token,
    'lease_expires_at', v_lease_expires_at
  );
end
$function$;

revoke all on function public.claim_billing_organization_asaas_cleanup_resource(
  uuid, uuid, text, integer
) from PUBLIC, anon, authenticated, service_role;
grant execute on function public.claim_billing_organization_asaas_cleanup_resource(
  uuid, uuid, text, integer
) to service_role;

create or replace function public.ack_billing_organization_asaas_cleanup_resource(
  p_organization_id uuid,
  p_claim_token uuid,
  p_resource_kind text,
  p_resource_id text,
  p_attempt_token uuid,
  p_http_status integer,
  p_provider_response jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_resource_kind text := lower(btrim(coalesce(p_resource_kind, '')));
  v_resource_id text := nullif(btrim(coalesce(p_resource_id, '')), '');
  v_response jsonb := coalesce(p_provider_response, '{}'::jsonb);
  v_resource private.billing_organization_asaas_cleanup_resources%rowtype;
  v_exact_ack boolean := false;
  v_now timestamptz := clock_timestamp();
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service_role required' using errcode = '42501';
  end if;
  if p_organization_id is null
     or p_claim_token is null
     or v_resource_kind not in ('payment', 'subscription', 'customer')
     or v_resource_id is null
     or char_length(v_resource_id) > 255
     or p_attempt_token is null
     or (p_http_status <> 0 and p_http_status not between 100 and 599)
     or jsonb_typeof(v_response) <> 'object'
     or pg_catalog.pg_column_size(v_response) > 16384 then
    return jsonb_build_object('outcome', 'invalid_request');
  end if;

  perform private.lock_asaas_billing_resources(
    case when v_resource_kind = 'payment' then v_resource_id else null end,
    case when v_resource_kind = 'subscription' then v_resource_id else null end
  );

  select resource.*
  into v_resource
  from private.billing_organization_asaas_cleanup_resources as resource
  where resource.organization_id = p_organization_id
    and resource.claim_token = p_claim_token
    and resource.resource_kind = v_resource_kind
    and resource.resource_id = v_resource_id
  for update;
  if not found then
    return jsonb_build_object('outcome', 'resource_not_found');
  end if;
  if v_resource.status = 'succeeded' then
    return jsonb_build_object(
      'outcome', 'already_succeeded',
      'resource_kind', v_resource.resource_kind,
      'resource_id', v_resource.resource_id
    );
  end if;
  if v_resource.status = 'manual_review' then
    return jsonb_build_object(
      'outcome', 'manual_review',
      'reason', coalesce(
        v_resource.last_error_code,
        'provider_resource_delete_not_proven'
      )
    );
  end if;
  if v_resource.status <> 'processing'
     or v_resource.attempt_token is distinct from p_attempt_token then
    return jsonb_build_object('outcome', 'lost_claim');
  end if;

  v_exact_ack := p_http_status = 200
    and jsonb_typeof(v_response -> 'id') = 'string'
    and v_response ->> 'id' = v_resource_id
    and jsonb_typeof(v_response -> 'deleted') = 'boolean'
    and v_response -> 'deleted' = 'true'::jsonb;

  if not v_exact_ack then
    update private.billing_organization_asaas_cleanup_resources as resource
    set
      status = 'manual_review',
      provider_http_status = nullif(p_http_status, 0),
      provider_response = v_response,
      manual_review_at = v_now,
      last_error_code = case
        when p_http_status = 0
          then 'provider_delete_transport_ambiguous'
        when p_http_status in (404, 410)
          then 'provider_resource_not_found_ambiguous'
        else 'provider_delete_response_not_proven'
      end,
      updated_at = v_now
    where resource.organization_id = p_organization_id
      and resource.claim_token = p_claim_token
      and resource.resource_kind = v_resource_kind
      and resource.resource_id = v_resource_id
      and resource.status = 'processing'
      and resource.attempt_token = p_attempt_token;

    return jsonb_build_object(
      'outcome', 'manual_review',
      'reason', case
        when p_http_status = 0
          then 'provider_delete_transport_ambiguous'
        when p_http_status in (404, 410)
          then 'provider_resource_not_found_ambiguous'
        else 'provider_delete_response_not_proven'
      end,
      'resource_kind', v_resource_kind,
      'resource_id', v_resource_id
    );
  end if;

  update private.billing_organization_asaas_cleanup_resources as resource
  set
    status = 'succeeded',
    provider_deleted_at = v_now,
    provider_http_status = 200,
    provider_response = v_response,
    last_error_code = null,
    updated_at = v_now
  where resource.organization_id = p_organization_id
    and resource.claim_token = p_claim_token
    and resource.resource_kind = v_resource_kind
    and resource.resource_id = v_resource_id
    and resource.status = 'processing'
    and resource.attempt_token = p_attempt_token;
  if not found then
    return jsonb_build_object('outcome', 'lost_claim');
  end if;

  return jsonb_build_object(
    'outcome', 'succeeded',
    'resource_kind', v_resource_kind,
    'resource_id', v_resource_id
  );
end
$function$;

revoke all on function public.ack_billing_organization_asaas_cleanup_resource(
  uuid, uuid, text, text, uuid, integer, jsonb
) from PUBLIC, anon, authenticated, service_role;
grant execute on function public.ack_billing_organization_asaas_cleanup_resource(
  uuid, uuid, text, text, uuid, integer, jsonb
) to service_role;

create or replace function public.finalize_billing_organization_asaas_cleanup(
  p_organization_id uuid,
  p_claim_token uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_claim private.billing_organization_asaas_cleanup_claims%rowtype;
  v_now timestamptz := clock_timestamp();
  v_remaining_count integer := 0;
  v_inventory_issue text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service_role required' using errcode = '42501';
  end if;
  if p_organization_id is null or p_claim_token is null then
    return jsonb_build_object('outcome', 'invalid_request');
  end if;

  select cleanup.*
  into v_claim
  from private.billing_organization_asaas_cleanup_claims as cleanup
  where cleanup.organization_id = p_organization_id
    and cleanup.claim_token = p_claim_token;
  if not found then
    return jsonb_build_object('outcome', 'claim_not_found');
  end if;

  perform private.lock_asaas_cleanup_inventory(
    v_claim.provider_payment_ids,
    case when v_claim.provider_subscription_id is null then '{}'::text[]
      else array[v_claim.provider_subscription_id] end,
    case when v_claim.provider_customer_id is null then '{}'::text[]
      else array[v_claim.provider_customer_id] end
  );

  perform organization_row.id
  from public.organizations as organization_row
  where organization_row.id = p_organization_id
  for update;
  if not found then
    return jsonb_build_object('outcome', 'organization_not_found');
  end if;

  select cleanup.*
  into v_claim
  from private.billing_organization_asaas_cleanup_claims as cleanup
  where cleanup.organization_id = p_organization_id
    and cleanup.claim_token = p_claim_token
  for update;
  if not found then
    return jsonb_build_object('outcome', 'claim_not_found');
  end if;

  v_inventory_issue := private.billing_organization_cleanup_inventory_issue(
    p_organization_id,
    p_claim_token
  );
  if v_inventory_issue is not null then
    return jsonb_build_object(
      'outcome', 'manual_review',
      'reason', v_inventory_issue
    );
  end if;

  if v_claim.completed_at is not null then
    return jsonb_build_object('outcome', 'already_completed');
  end if;

  if exists (
    select 1
    from private.billing_organization_asaas_cleanup_resources as resource
    where resource.organization_id = p_organization_id
      and resource.claim_token = p_claim_token
      and resource.status = 'manual_review'
  ) then
    return jsonb_build_object(
      'outcome', 'manual_review',
      'reason', 'provider_resource_delete_not_proven'
    );
  end if;

  select count(*)::integer
  into v_remaining_count
  from private.billing_organization_asaas_cleanup_resources as resource
  where resource.organization_id = p_organization_id
    and resource.claim_token = p_claim_token
    and resource.status <> 'succeeded';
  if v_remaining_count > 0 then
    return jsonb_build_object(
      'outcome', 'resources_pending',
      'remaining_count', v_remaining_count
    );
  end if;

  update private.billing_organization_asaas_cleanup_claims
  set completed_at = v_now, updated_at = v_now
  where organization_id = p_organization_id
    and claim_token = p_claim_token
    and completed_at is null;

  return jsonb_build_object(
    'outcome', 'completed',
    'organization_id', p_organization_id
  );
end
$function$;

revoke all on function public.finalize_billing_organization_asaas_cleanup(
  uuid, uuid
) from PUBLIC, anon, authenticated, service_role;
grant execute on function public.finalize_billing_organization_asaas_cleanup(
  uuid, uuid
) to service_role;

create or replace function public.prepare_billing_subscription_card_update(
  p_job_id uuid,
  p_organization_id uuid,
  p_mode text,
  p_payment_id uuid,
  p_provider_payment_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_mode text := lower(nullif(btrim(coalesce(p_mode, '')), ''));
  v_provider_payment_id text := nullif(
    btrim(coalesce(p_provider_payment_id, '')),
    ''
  );
  v_org_hint public.organizations%rowtype;
  v_org public.organizations%rowtype;
  v_subscription public.subscriptions%rowtype;
  v_payment public.asaas_payments%rowtype;
  v_existing private.billing_subscription_card_update_jobs%rowtype;
  v_generation bigint;
  v_provider_subscription_id text;
  v_provider_customer_id text;
  v_existing_payment_status text;
  v_recurrence_cancel_state text;
  v_now timestamptz := clock_timestamp();
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service_role required' using errcode = '42501';
  end if;
  if p_job_id is null
     or p_organization_id is null
     or v_mode not in ('settled_payment', 'saved_only')
     or (
       v_mode = 'saved_only'
       and (p_payment_id is not null or v_provider_payment_id is not null)
     )
     or (
       v_mode = 'settled_payment'
       and (p_payment_id is null or v_provider_payment_id is null)
     )
     or char_length(coalesce(v_provider_payment_id, '')) > 255 then
    return jsonb_build_object('outcome', 'invalid_request');
  end if;

  select organization.*
  into v_org_hint
  from public.organizations as organization
  where organization.id = p_organization_id;
  if not found then
    return jsonb_build_object('outcome', 'organization_not_found');
  end if;
  if not v_org_hint.is_active then
    return jsonb_build_object('outcome', 'organization_inactive');
  end if;

  v_provider_subscription_id := nullif(
    btrim(coalesce(v_org_hint.asaas_subscription_id, '')),
    ''
  );
  v_provider_customer_id := nullif(
    btrim(coalesce(v_org_hint.asaas_customer_id, '')),
    ''
  );
  if v_provider_subscription_id is null or v_provider_customer_id is null then
    return jsonb_build_object('outcome', 'subscription_not_found');
  end if;

  perform private.lock_asaas_billing_resources(
    v_provider_payment_id,
    v_provider_subscription_id
  );

  if v_mode = 'settled_payment' then
    select payment.*
    into v_payment
    from public.asaas_payments as payment
    where payment.id = p_payment_id
      and payment.organization_id = p_organization_id
      and payment.asaas_payment_id = v_provider_payment_id
    for update;
    if not found then
      return jsonb_build_object('outcome', 'payment_not_found');
    end if;
  end if;

  select organization.*
  into v_org
  from public.organizations as organization
  where organization.id = p_organization_id
    and organization.is_active
    and lower(btrim(coalesce(organization.subscription_status, '')))
      = 'active'
    and nullif(btrim(coalesce(organization.asaas_subscription_id, '')), '')
      = v_provider_subscription_id
    and nullif(btrim(coalesce(organization.asaas_customer_id, '')), '')
      = v_provider_customer_id
  for update;
  if not found then
    return jsonb_build_object('outcome', 'identifier_mismatch');
  end if;
  if not v_org.is_active then
    return jsonb_build_object('outcome', 'organization_inactive');
  end if;

  select subscription.*
  into v_subscription
  from public.subscriptions as subscription
  where subscription.organization_id = p_organization_id
    and subscription.provider_subscription_id = v_provider_subscription_id
    and subscription.provider_customer_id = v_provider_customer_id
    and lower(subscription.status) = 'active'
    and lower(coalesce(subscription.provider, 'asaas')) = 'asaas'
  order by subscription.updated_at desc, subscription.id desc
  limit 1
  for update;
  if not found then
    return jsonb_build_object('outcome', 'subscription_not_found');
  end if;

  if exists (
    select 1
    from private.billing_subscription_checkout_cancellations as cancellation
    where cancellation.organization_id = p_organization_id
      and cancellation.provider_subscription_id = v_provider_subscription_id
      and cancellation.finalized_at is null
  ) then
    return jsonb_build_object(
      'outcome', 'busy',
      'busy_reason', 'subscription_cancellation'
    );
  end if;

  v_recurrence_cancel_state :=
    private.billing_card_recurrence_cancel_state(
      p_organization_id,
      v_provider_subscription_id
    );
  if v_recurrence_cancel_state is not null then
    return jsonb_build_object(
      'outcome', 'busy',
      'busy_reason', 'legacy_recurrence_cancellation',
      'cancellation_state', v_recurrence_cancel_state
    );
  end if;

  if private.billing_organization_cleanup_is_active(
    p_organization_id,
    v_provider_subscription_id
  ) then
    return jsonb_build_object('outcome', 'organization_inactive');
  end if;

  if exists (
    select 1
    from private.billing_plan_changes as plan_change
    where plan_change.organization_id = p_organization_id
      and plan_change.provider_subscription_id = v_provider_subscription_id
      and plan_change.status in ('provider_updating', 'applying')
  ) then
    return jsonb_build_object(
      'outcome', 'busy',
      'busy_reason', 'managed_plan_change'
    );
  end if;

  if v_mode = 'settled_payment' and (
       upper(btrim(coalesce(v_payment.billing_type, ''))) <> 'CREDIT_CARD'
       or nullif(btrim(coalesce(v_payment.asaas_customer_id, '')), '')
         is distinct from v_provider_customer_id
       or (
         v_payment.asaas_subscription_id is not null
         and btrim(v_payment.asaas_subscription_id)
           is distinct from v_provider_subscription_id
       )
       or not (
         private.billing_payment_checkout_is_actionable(v_payment.status)
         or private.billing_payment_checkout_is_processing(v_payment.status)
         or private.billing_payment_checkout_is_paid(v_payment.status)
       )
       or exists (
         select 1
         from private.billing_payment_checkout_cancellations as cancellation
         where cancellation.payment_id = v_payment.id
           and cancellation.finalized_at is null
       )
     ) then
    return jsonb_build_object('outcome', 'payment_not_eligible');
  end if;

  select job.*
  into v_existing
  from private.billing_subscription_card_update_jobs as job
  where job.id = p_job_id
  for update;
  if found then
    if v_existing.organization_id is distinct from p_organization_id
       or v_existing.subscription_id is distinct from v_subscription.id
       or v_existing.provider_subscription_id
         is distinct from v_provider_subscription_id
       or v_existing.provider_customer_id is distinct from v_provider_customer_id
       or v_existing.mode is distinct from v_mode
       or v_existing.payment_id is distinct from p_payment_id
       or v_existing.provider_payment_id
         is distinct from v_provider_payment_id then
      return jsonb_build_object('outcome', 'identifier_mismatch');
    end if;

    return jsonb_strip_nulls(jsonb_build_object(
      'outcome', 'already_prepared',
      'job_id', v_existing.id,
      'subscription_row_id', v_existing.subscription_id,
      'subscription_id', v_existing.provider_subscription_id,
      'customer_id', v_existing.provider_customer_id,
      'generation', v_existing.generation,
      'mode', v_existing.mode,
      'state', case
        when v_existing.status = 'succeeded' then 'succeeded'
        when v_existing.status = 'cancelled' then 'cancelled'
        when v_existing.status = 'dead'
          and v_existing.manual_review_at is not null then 'manual_review'
        when v_existing.status = 'dead' then 'failed'
        else 'queued'
      end,
      'status', v_existing.status,
      'manual_review_at', v_existing.manual_review_at,
      'payment_id', v_existing.payment_id,
      'provider_payment_id', v_existing.provider_payment_id,
      'payment_status', case
        when v_existing.mode = 'settled_payment' then upper(v_payment.status)
        else null
      end,
      'aad', 'vimob:billing-subscription-card:' || v_existing.id::text
        || ':' || v_existing.provider_subscription_id
    ));
  end if;

  select job.*
  into v_existing
  from private.billing_subscription_card_update_jobs as job
  where job.subscription_id = v_subscription.id
    and job.status in (
      'prepared', 'awaiting_payment', 'pending_update', 'processing', 'retry'
    )
  for update;
  if found then
    if v_existing.status = 'prepared'
       and v_existing.provider_card_credential is null
       and v_existing.mode = v_mode
       and v_existing.payment_id is not distinct from p_payment_id
       and v_existing.provider_payment_id
         is not distinct from v_provider_payment_id then
      return jsonb_strip_nulls(jsonb_build_object(
        'outcome', 'resume_prepared',
        'job_id', v_existing.id,
        'subscription_row_id', v_existing.subscription_id,
        'subscription_id', v_existing.provider_subscription_id,
        'customer_id', v_existing.provider_customer_id,
        'generation', v_existing.generation,
        'mode', v_existing.mode,
        'state', 'queued',
        'status', v_existing.status,
        'payment_id', v_existing.payment_id,
        'provider_payment_id', v_existing.provider_payment_id,
        'payment_status', case
          when v_existing.mode = 'settled_payment' then upper(v_payment.status)
          else null
        end,
        'aad', 'vimob:billing-subscription-card:' || v_existing.id::text
          || ':' || v_existing.provider_subscription_id
      ));
    end if;

    v_existing_payment_status := null;
    if v_existing.mode = 'settled_payment' then
      select upper(btrim(payment.status))
      into v_existing_payment_status
      from public.asaas_payments as payment
      where payment.id = v_existing.payment_id
        and payment.organization_id = p_organization_id
        and payment.asaas_payment_id = v_existing.provider_payment_id;
    end if;

    return jsonb_strip_nulls(jsonb_build_object(
      'outcome', 'active_job_conflict',
      'job_id', v_existing.id,
      'state', 'queued',
      'status', v_existing.status,
      'generation', v_existing.generation,
      'mode', v_existing.mode,
      'payment_id', v_existing.payment_id,
      'provider_payment_id', v_existing.provider_payment_id,
      'payment_status', v_existing_payment_status
    ));
  end if;

  select coalesce(max(job.generation), 0) + 1
  into v_generation
  from private.billing_subscription_card_update_jobs as job
  where job.subscription_id = v_subscription.id;

  insert into private.billing_subscription_card_update_jobs (
    id,
    organization_id,
    subscription_id,
    provider_subscription_id,
    provider_customer_id,
    generation,
    mode,
    payment_id,
    provider_payment_id,
    status,
    next_attempt_at,
    expires_at,
    created_at,
    updated_at
  ) values (
    p_job_id,
    p_organization_id,
    v_subscription.id,
    v_provider_subscription_id,
    v_provider_customer_id,
    v_generation,
    v_mode,
    p_payment_id,
    v_provider_payment_id,
    'prepared',
    v_now,
    v_now + interval '24 hours',
    v_now,
    v_now
  );

  return jsonb_strip_nulls(jsonb_build_object(
    'outcome', 'prepared',
    'job_id', p_job_id,
    'subscription_row_id', v_subscription.id,
    'subscription_id', v_provider_subscription_id,
    'customer_id', v_provider_customer_id,
    'generation', v_generation,
    'mode', v_mode,
    'state', 'queued',
    'status', 'prepared',
    'payment_id', p_payment_id,
    'provider_payment_id', v_provider_payment_id,
    'payment_status', case
      when v_mode = 'settled_payment' then upper(v_payment.status)
      else null
    end,
    'aad', 'vimob:billing-subscription-card:' || p_job_id::text
      || ':' || v_provider_subscription_id
  ));
end
$function$;

revoke all on function public.prepare_billing_subscription_card_update(
  uuid, uuid, text, uuid, text
) from PUBLIC, anon, authenticated, service_role;
grant execute on function public.prepare_billing_subscription_card_update(
  uuid, uuid, text, uuid, text
) to service_role;

create or replace function public.store_billing_subscription_card_update_credential(
  p_job_id uuid,
  p_organization_id uuid,
  p_generation bigint,
  p_attempt_lease_id uuid,
  p_credential_ciphertext text,
  p_card_last4 text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_credential text := nullif(
    btrim(coalesce(p_credential_ciphertext, '')),
    ''
  );
  v_card_last4 text := btrim(coalesce(p_card_last4, ''));
  v_job_hint private.billing_subscription_card_update_jobs%rowtype;
  v_job private.billing_subscription_card_update_jobs%rowtype;
  v_payment public.asaas_payments%rowtype;
  v_capability public.billing_payment_checkout_capabilities%rowtype;
  v_org public.organizations%rowtype;
  v_subscription public.subscriptions%rowtype;
  v_now timestamptz := clock_timestamp();
  v_next_status text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service_role required' using errcode = '42501';
  end if;
  if p_job_id is null
     or p_organization_id is null
     or p_generation is null
     or p_generation <= 0
     or v_credential is null
     or char_length(v_credential) not between 35 and 4096
     or v_credential !~ '^v1[.][A-Za-z0-9._-]+$'
     or v_card_last4 !~ '^[0-9]{4}$' then
    return jsonb_build_object('outcome', 'invalid_request');
  end if;

  select job.*
  into v_job_hint
  from private.billing_subscription_card_update_jobs as job
  where job.id = p_job_id
    and job.organization_id = p_organization_id;
  if not found then
    return jsonb_build_object('outcome', 'job_not_found');
  end if;

  perform private.lock_asaas_billing_resources(
    v_job_hint.provider_payment_id,
    v_job_hint.provider_subscription_id
  );

  if v_job_hint.mode = 'settled_payment' then
    select payment.*
    into v_payment
    from public.asaas_payments as payment
    where payment.id = v_job_hint.payment_id
      and payment.organization_id = p_organization_id
      and payment.asaas_payment_id = v_job_hint.provider_payment_id
    for update;
    if not found then
      return jsonb_build_object('outcome', 'payment_not_found');
    end if;

    select capability.*
    into v_capability
    from public.billing_payment_checkout_capabilities as capability
    where capability.payment_id = v_payment.id
      and capability.organization_id = v_payment.organization_id
      and capability.asaas_payment_id = v_payment.asaas_payment_id
      and capability.billing_intent_id is not distinct from v_payment.billing_intent_id
    for update;
  end if;

  select organization.*
  into v_org
  from public.organizations as organization
  where organization.id = p_organization_id
  for update;
  if not found then
    return jsonb_build_object('outcome', 'identifier_mismatch');
  end if;
  if not v_org.is_active then
    return jsonb_build_object('outcome', 'organization_inactive');
  end if;

  select subscription.*
  into v_subscription
  from public.subscriptions as subscription
  where subscription.id = v_job_hint.subscription_id
  for update;
  if not found then
    return jsonb_build_object('outcome', 'identifier_mismatch');
  end if;

  select job.*
  into v_job
  from private.billing_subscription_card_update_jobs as job
  where job.id = p_job_id
    and job.organization_id = p_organization_id
    and job.generation = p_generation
  for update;
  if not found then
    return jsonb_build_object('outcome', 'identifier_mismatch');
  end if;

  if v_job.status in ('succeeded', 'cancelled', 'dead') then
    return jsonb_build_object(
      'outcome', 'already_finalized',
      'status', v_job.status,
      'last_error_code', v_job.last_error_code
    );
  end if;
  if v_job.expires_at <= v_now then
    update private.billing_subscription_card_update_jobs
    set
      status = 'dead',
      provider_card_credential = null,
      credential_attempt_lease_id = null,
      lease_id = null,
      lease_owner = null,
      lease_started_at = null,
      lease_expires_at = null,
      last_error_code = 'credential_expired',
      dead_lettered_at = v_now,
      updated_at = v_now
    where id = v_job.id;
    return jsonb_build_object('outcome', 'expired');
  end if;
  if v_job.status <> 'prepared' then
    if v_job.provider_card_credential = v_credential
       and v_job.card_last4 = v_card_last4
       and v_job.credential_attempt_lease_id
         is not distinct from p_attempt_lease_id then
      return jsonb_build_object(
        'outcome', 'already_stored',
        'job_id', v_job.id,
        'status', v_job.status
      );
    end if;
    return jsonb_build_object('outcome', 'state_not_storable');
  end if;

  if v_org.asaas_subscription_id
       is distinct from v_job.provider_subscription_id
     or v_org.asaas_customer_id is distinct from v_job.provider_customer_id
     or not v_org.is_active
     or lower(btrim(coalesce(v_org.subscription_status, ''))) <> 'active'
     or v_subscription.organization_id is distinct from p_organization_id
     or v_subscription.provider_subscription_id
       is distinct from v_job.provider_subscription_id
     or v_subscription.provider_customer_id
       is distinct from v_job.provider_customer_id
     or lower(v_subscription.status) <> 'active'
     or exists (
       select 1
       from private.billing_plan_changes as plan_change
       where plan_change.organization_id = p_organization_id
         and plan_change.provider_subscription_id
           = v_job.provider_subscription_id
         and plan_change.status in ('provider_updating', 'applying')
     )
     or exists (
       select 1
       from private.billing_subscription_checkout_cancellations as cancellation
       where cancellation.organization_id = p_organization_id
         and cancellation.provider_subscription_id
           = v_job.provider_subscription_id
         and (
           cancellation.finalized_at is null
           or cancellation.final_outcome = 'manual_review'
         )
     )
     or private.billing_card_recurrence_cancel_state(
       p_organization_id,
       v_job.provider_subscription_id
     ) is not null
     or private.billing_organization_cleanup_is_active(
       p_organization_id,
       v_job.provider_subscription_id
     ) then
    return jsonb_build_object('outcome', 'identifier_mismatch');
  end if;

  if v_job.mode = 'saved_only' and p_attempt_lease_id is not null then
    return jsonb_build_object('outcome', 'invalid_request');
  end if;

  if v_job.mode = 'settled_payment' then
    if upper(btrim(coalesce(v_payment.billing_type, ''))) <> 'CREDIT_CARD'
       or v_payment.asaas_customer_id
         is distinct from v_job.provider_customer_id
       or not (
         private.billing_payment_checkout_is_actionable(v_payment.status)
         or private.billing_payment_checkout_is_processing(v_payment.status)
         or private.billing_payment_checkout_is_paid(v_payment.status)
       ) then
      return jsonb_build_object('outcome', 'payment_not_eligible');
    end if;

    if exists (
      select 1
      from private.billing_payment_checkout_cancellations as cancellation
      where cancellation.payment_id = v_payment.id
        and (
          cancellation.finalized_at is null
          or cancellation.final_outcome = 'manual_review'
        )
    ) then
      return jsonb_build_object(
        'outcome', 'busy',
        'busy_reason', 'payment_cancellation'
      );
    end if;

    if not private.billing_payment_checkout_is_paid(v_payment.status) and (
         p_attempt_lease_id is null
         or v_capability.payment_id is null
         or v_capability.revoked_at is not null
         or v_capability.expires_at <= v_now
         or v_capability.attempt_lease_id is distinct from p_attempt_lease_id
         or v_capability.attempt_lease_expires_at <= v_now
       ) then
      return jsonb_build_object('outcome', 'attempt_lease_not_found');
    end if;

    if private.billing_payment_checkout_is_paid(v_payment.status)
       and p_attempt_lease_id is not null
       and (
         v_capability.payment_id is null
         or v_capability.attempt_lease_id is distinct from p_attempt_lease_id
         or v_capability.attempt_lease_expires_at <= v_now
       ) then
      return jsonb_build_object('outcome', 'attempt_lease_not_found');
    end if;
  end if;

  v_next_status := case
    when v_job.mode = 'saved_only' then 'pending_update'
    when private.billing_payment_checkout_is_paid(v_payment.status)
      then 'pending_update'
    else 'awaiting_payment'
  end;

  update private.billing_subscription_card_update_jobs as job
  set
    status = v_next_status,
    provider_card_credential = v_credential,
    card_last4 = v_card_last4,
    credential_attempt_lease_id = p_attempt_lease_id,
    credential_stored_at = v_now,
    next_attempt_at = v_now,
    last_error_code = null,
    updated_at = v_now
  where job.id = v_job.id
    and job.organization_id = p_organization_id
    and job.generation = p_generation
    and job.status = 'prepared'
    and job.provider_card_credential is null;
  if not found then
    return jsonb_build_object('outcome', 'state_changed');
  end if;

  return jsonb_build_object(
    'outcome', 'stored',
    'job_id', v_job.id,
    'generation', v_job.generation,
    'status', v_next_status,
    'card_last4', v_card_last4
  );
end
$function$;

revoke all on function public.store_billing_subscription_card_update_credential(
  uuid, uuid, bigint, uuid, text, text
) from PUBLIC, anon, authenticated, service_role;
grant execute on function public.store_billing_subscription_card_update_credential(
  uuid, uuid, bigint, uuid, text, text
) to service_role;

create or replace function private.sync_billing_subscription_card_update_payment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_now timestamptz := clock_timestamp();
begin
  if private.billing_payment_checkout_is_paid(new.status) then
    update private.billing_subscription_card_update_jobs as job
    set
      status = 'pending_update',
      next_attempt_at = v_now,
      last_error_code = null,
      updated_at = v_now
    where job.mode = 'settled_payment'
      and job.payment_id = new.id
      and job.organization_id = new.organization_id
      and job.provider_payment_id = new.asaas_payment_id
      and job.status = 'awaiting_payment'
      and job.provider_card_credential is not null
      and job.expires_at > v_now;
  elsif upper(btrim(coalesce(new.status, '')))
    = 'CREDIT_CARD_CAPTURE_REFUSED' then
    -- A definitive provider refusal proves payWithCreditCard did not settle.
    -- Clear the non-replayable capture marker with its sealed token so the
    -- public checkout may acquire a fresh lease and tokenize a new attempt.
    update private.billing_subscription_card_update_jobs as job
    set
      status = 'cancelled',
      provider_card_credential = null,
      card_last4 = null,
      credential_attempt_lease_id = null,
      capture_request_started_at = null,
      capture_attempt_lease_id = null,
      lease_id = null,
      lease_owner = null,
      lease_started_at = null,
      lease_expires_at = null,
      last_error_code = 'credit_card_capture_refused',
      cancelled_at = v_now,
      updated_at = v_now
    where job.mode = 'settled_payment'
      and job.payment_id = new.id
      and job.organization_id = new.organization_id
      and job.provider_payment_id = new.asaas_payment_id
      and job.status in ('prepared', 'awaiting_payment')
      and job.provider_request_started_at is null;

    update public.billing_payment_checkout_capabilities
    set
      attempt_lease_id = null,
      attempt_lease_expires_at = null,
      updated_at = v_now
    where payment_id = new.id
      and organization_id = new.organization_id
      and asaas_payment_id = new.asaas_payment_id
      and revoked_at is null;
  elsif private.billing_payment_checkout_is_terminal(new.status) then
    -- Before PUT starts, a reversal can safely cancel and shred the token.
    -- After the durable PUT marker, provider outcome is ambiguous: never lie
    -- with `cancelled`, never let a stale success finalizer win, and surface
    -- an assisted-review event.
    update private.billing_subscription_card_update_jobs as job
    set
      status = 'cancelled',
      provider_card_credential = null,
      credential_attempt_lease_id = null,
      lease_id = null,
      lease_owner = null,
      lease_started_at = null,
      lease_expires_at = null,
      last_error_code = 'payment_not_settled',
      cancelled_at = v_now,
      updated_at = v_now
    where job.mode = 'settled_payment'
      and job.payment_id = new.id
      and job.organization_id = new.organization_id
      and job.provider_payment_id = new.asaas_payment_id
      and job.status in (
        'prepared', 'awaiting_payment', 'pending_update', 'processing', 'retry'
      )
      and (
        job.provider_request_started_at is null
        or (
          job.status = 'retry'
          and job.provider_outcome_ambiguous_at is null
        )
      );

    update private.billing_subscription_card_update_jobs as job
    set
      status = 'dead',
      provider_card_credential = null,
      credential_attempt_lease_id = null,
      lease_id = null,
      lease_owner = null,
      lease_started_at = null,
      lease_expires_at = null,
      last_error_code = 'payment_reversed_after_card_update_started',
      manual_review_at = v_now,
      dead_lettered_at = v_now,
      updated_at = v_now
    where job.mode = 'settled_payment'
      and job.payment_id = new.id
      and job.organization_id = new.organization_id
      and job.provider_payment_id = new.asaas_payment_id
      and job.status in (
        'awaiting_payment', 'pending_update', 'processing', 'retry'
      )
      and (
        job.provider_outcome_ambiguous_at is not null
        or job.status = 'processing'
      );

    if found then
      insert into public.error_events (
        organization_id,
        source,
        severity,
        fingerprint,
        message,
        category,
        error_code,
        component,
        metadata,
        occurred_at
      ) values (
        new.organization_id,
        'backend',
        'critical',
        'billing_subscription_card_update_manual:' || new.id::text,
        'Subscription card update requires assisted review',
        'billing',
        'billing_subscription_card_update_manual_review',
        'billing_subscription_card_update_worker',
        jsonb_build_object(
          'payment_id', new.asaas_payment_id,
          'payment_status', upper(btrim(coalesce(new.status, ''))),
          'reason', 'payment_reversed_after_card_update_started'
        ),
        v_now
      )
      on conflict do nothing;
    end if;
  end if;

  return null;
end
$function$;

revoke all on function private.sync_billing_subscription_card_update_payment()
  from PUBLIC, anon, authenticated, service_role;
drop trigger if exists zzz_sync_billing_subscription_card_update_payment
  on public.asaas_payments;
create trigger zzz_sync_billing_subscription_card_update_payment
after insert or update of status
on public.asaas_payments
for each row
execute function private.sync_billing_subscription_card_update_payment();

create or replace function public.mark_billing_subscription_card_update_capture_started(
  p_job_id uuid,
  p_organization_id uuid,
  p_generation bigint,
  p_attempt_lease_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_job_hint private.billing_subscription_card_update_jobs%rowtype;
  v_job private.billing_subscription_card_update_jobs%rowtype;
  v_payment public.asaas_payments%rowtype;
  v_capability public.billing_payment_checkout_capabilities%rowtype;
  v_org public.organizations%rowtype;
  v_subscription public.subscriptions%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service_role required' using errcode = '42501';
  end if;
  if p_job_id is null
     or p_organization_id is null
     or p_generation is null
     or p_generation <= 0
     or p_attempt_lease_id is null then
    return jsonb_build_object('outcome', 'invalid_request');
  end if;

  select job.*
  into v_job_hint
  from private.billing_subscription_card_update_jobs as job
  where job.id = p_job_id
    and job.organization_id = p_organization_id;
  if not found then
    return jsonb_build_object('outcome', 'job_not_found');
  end if;
  if v_job_hint.mode <> 'settled_payment'
     or v_job_hint.payment_id is null
     or v_job_hint.provider_payment_id is null then
    return jsonb_build_object('outcome', 'invalid_mode');
  end if;

  perform private.lock_asaas_billing_resources(
    v_job_hint.provider_payment_id,
    v_job_hint.provider_subscription_id
  );

  select payment.*
  into v_payment
  from public.asaas_payments as payment
  where payment.id = v_job_hint.payment_id
    and payment.organization_id = p_organization_id
    and payment.asaas_payment_id = v_job_hint.provider_payment_id
  for update;
  if not found then
    return jsonb_build_object('outcome', 'payment_not_found');
  end if;

  select capability.*
  into v_capability
  from public.billing_payment_checkout_capabilities as capability
  where capability.payment_id = v_payment.id
    and capability.organization_id = v_payment.organization_id
    and capability.asaas_payment_id = v_payment.asaas_payment_id
    and capability.billing_intent_id is not distinct from v_payment.billing_intent_id
  for update;

  select organization.*
  into v_org
  from public.organizations as organization
  where organization.id = p_organization_id
  for update;
  if not found then
    return jsonb_build_object('outcome', 'identifier_mismatch');
  end if;

  select subscription.*
  into v_subscription
  from public.subscriptions as subscription
  where subscription.id = v_job_hint.subscription_id
  for update;
  if not found then
    return jsonb_build_object('outcome', 'identifier_mismatch');
  end if;

  select job.*
  into v_job
  from private.billing_subscription_card_update_jobs as job
  where job.id = p_job_id
    and job.organization_id = p_organization_id
    and job.generation = p_generation
  for update;
  if not found then
    return jsonb_build_object('outcome', 'identifier_mismatch');
  end if;

  if not v_org.is_active then
    return jsonb_build_object('outcome', 'organization_inactive');
  end if;

  if v_job.status in ('succeeded', 'cancelled', 'dead') then
    return jsonb_build_object(
      'outcome', case
        when v_job.status = 'dead' then 'manual_review'
        else 'payment_not_actionable'
      end,
      'status', v_job.status,
      'last_error_code', v_job.last_error_code
    );
  end if;
  if private.billing_payment_checkout_is_paid(v_payment.status)
     or not private.billing_payment_checkout_is_actionable(v_payment.status) then
    return jsonb_build_object(
      'outcome', 'payment_not_actionable',
      'payment_status', upper(btrim(coalesce(v_payment.status, '')))
    );
  end if;

  if v_job.capture_request_started_at is not null then
    return jsonb_build_object(
      'outcome', case
        when v_job.capture_attempt_lease_id = p_attempt_lease_id
          then 'already_started'
        else 'recover_only'
      end,
      'job_id', v_job.id,
      'capture_request_started_at', v_job.capture_request_started_at
    );
  end if;

  if v_capability.payment_id is null
     or v_capability.revoked_at is not null
     or v_capability.expires_at <= v_now
     or v_capability.attempt_lease_id is distinct from p_attempt_lease_id
     or v_capability.attempt_lease_expires_at <= v_now then
    return jsonb_build_object('outcome', 'attempt_lease_not_found');
  end if;
  if v_job.status <> 'awaiting_payment'
     or v_job.provider_card_credential is null
     or v_job.credential_attempt_lease_id
       is distinct from p_attempt_lease_id then
    return jsonb_build_object('outcome', 'credential_not_stored');
  end if;
  if v_org.asaas_subscription_id
       is distinct from v_job.provider_subscription_id
     or v_org.asaas_customer_id is distinct from v_job.provider_customer_id
     or not v_org.is_active
     or lower(btrim(coalesce(v_org.subscription_status, ''))) <> 'active'
     or v_subscription.organization_id is distinct from p_organization_id
     or v_subscription.provider_subscription_id
       is distinct from v_job.provider_subscription_id
     or v_subscription.provider_customer_id
       is distinct from v_job.provider_customer_id
     or lower(v_subscription.status) <> 'active'
     or exists (
       select 1
       from private.billing_plan_changes as plan_change
       where plan_change.organization_id = p_organization_id
         and plan_change.provider_subscription_id
           = v_job.provider_subscription_id
         and plan_change.status in ('provider_updating', 'applying')
     )
     or exists (
       select 1
       from private.billing_payment_checkout_cancellations as cancellation
       where cancellation.payment_id = v_payment.id
         and cancellation.finalized_at is null
     )
     or exists (
       select 1
       from private.billing_subscription_checkout_cancellations as cancellation
       where cancellation.organization_id = p_organization_id
         and cancellation.provider_subscription_id
           = v_job.provider_subscription_id
         and cancellation.finalized_at is null
     )
     or private.billing_card_recurrence_cancel_state(
       p_organization_id,
       v_job.provider_subscription_id
     ) is not null
     or private.billing_organization_cleanup_is_active(
       p_organization_id,
       v_job.provider_subscription_id
     ) then
    update private.billing_subscription_card_update_jobs
    set
      status = 'cancelled',
      provider_card_credential = null,
      card_last4 = null,
      credential_attempt_lease_id = null,
      last_error_code = 'capture_target_mismatch',
      cancelled_at = v_now,
      updated_at = v_now
    where id = v_job.id
      and status = 'awaiting_payment';
    return jsonb_build_object(
      'outcome', 'cancelled',
      'last_error_code', 'capture_target_mismatch'
    );
  end if;

  update private.billing_subscription_card_update_jobs as job
  set
    capture_request_started_at = v_now,
    capture_attempt_lease_id = p_attempt_lease_id,
    updated_at = v_now
  where job.id = v_job.id
    and job.organization_id = p_organization_id
    and job.generation = p_generation
    and job.status = 'awaiting_payment'
    and job.capture_request_started_at is null
    and job.provider_card_credential is not null
    and job.credential_attempt_lease_id = p_attempt_lease_id;
  if not found then
    return jsonb_build_object('outcome', 'state_changed');
  end if;

  return jsonb_build_object(
    'outcome', 'proceed',
    'job_id', v_job.id,
    'payment_id', v_payment.id,
    'provider_payment_id', v_payment.asaas_payment_id,
    'capture_request_started_at', v_now
  );
end
$function$;

revoke all on function public.mark_billing_subscription_card_update_capture_started(
  uuid, uuid, bigint, uuid
) from PUBLIC, anon, authenticated, service_role;
grant execute on function public.mark_billing_subscription_card_update_capture_started(
  uuid, uuid, bigint, uuid
) to service_role;

-- A capture marker is non-replayable unless the provider returns a definitive
-- validation/refusal response. This CAS is deliberately separate from worker
-- PUT failures: only an exact marked payment attempt can shred its token and
-- release checkout for a newly-tokenized card.
create or replace function public.fail_billing_subscription_card_update_capture(
  p_job_id uuid,
  p_organization_id uuid,
  p_generation bigint,
  p_attempt_lease_id uuid,
  p_error_code text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_error_code text := lower(nullif(btrim(coalesce(p_error_code, '')), ''));
  v_hint private.billing_subscription_card_update_jobs%rowtype;
  v_job private.billing_subscription_card_update_jobs%rowtype;
  v_payment public.asaas_payments%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service_role required' using errcode = '42501';
  end if;
  if p_job_id is null
     or p_organization_id is null
     or p_generation is null
     or p_generation <= 0
     or p_attempt_lease_id is null
     or v_error_code is null
     or v_error_code !~ '^[a-z0-9_]{1,80}$' then
    return jsonb_build_object('outcome', 'invalid_request');
  end if;

  select job.*
  into v_hint
  from private.billing_subscription_card_update_jobs as job
  where job.id = p_job_id
    and job.organization_id = p_organization_id;
  if not found then
    return jsonb_build_object('outcome', 'job_not_found');
  end if;

  perform private.lock_asaas_billing_resources(
    v_hint.provider_payment_id,
    v_hint.provider_subscription_id
  );

  select payment.*
  into v_payment
  from public.asaas_payments as payment
  where payment.id = v_hint.payment_id
    and payment.organization_id = p_organization_id
    and payment.asaas_payment_id = v_hint.provider_payment_id
  for update;
  if not found then
    return jsonb_build_object('outcome', 'payment_not_found');
  end if;

  select job.*
  into v_job
  from private.billing_subscription_card_update_jobs as job
  where job.id = p_job_id
    and job.organization_id = p_organization_id
    and job.generation = p_generation
  for update;
  if not found then
    return jsonb_build_object('outcome', 'identifier_mismatch');
  end if;

  if v_job.status in ('succeeded', 'cancelled', 'dead') then
    return jsonb_build_object(
      'outcome', 'already_finalized',
      'status', v_job.status,
      'last_error_code', v_job.last_error_code
    );
  end if;
  if v_job.mode <> 'settled_payment'
     or v_job.status <> 'awaiting_payment'
     or v_job.capture_request_started_at is null
     or v_job.capture_attempt_lease_id is distinct from p_attempt_lease_id
     or v_job.credential_attempt_lease_id is distinct from p_attempt_lease_id
     or v_job.provider_request_started_at is not null then
    return jsonb_build_object('outcome', 'lost_capture');
  end if;
  if private.billing_payment_checkout_is_paid(v_payment.status) then
    return jsonb_build_object('outcome', 'payment_already_paid');
  end if;
  if private.billing_payment_checkout_is_processing(v_payment.status)
     or private.billing_payment_checkout_is_reversal(v_payment.status) then
    return jsonb_build_object('outcome', 'capture_outcome_ambiguous');
  end if;

  update private.billing_subscription_card_update_jobs
  set
    status = 'cancelled',
    provider_card_credential = null,
    card_last4 = null,
    credential_attempt_lease_id = null,
    capture_request_started_at = null,
    capture_attempt_lease_id = null,
    capture_manual_review_at = null,
    lease_id = null,
    lease_owner = null,
    lease_started_at = null,
    lease_expires_at = null,
    last_error_code = v_error_code,
    cancelled_at = v_now,
    updated_at = v_now
  where id = v_job.id
    and generation = p_generation
    and status = 'awaiting_payment'
    and capture_attempt_lease_id = p_attempt_lease_id;
  if not found then
    return jsonb_build_object('outcome', 'lost_capture');
  end if;

  update public.billing_payment_checkout_capabilities
  set
    attempt_lease_id = null,
    attempt_lease_expires_at = null,
    updated_at = v_now
  where payment_id = v_payment.id
    and organization_id = p_organization_id
    and attempt_lease_id = p_attempt_lease_id
    and revoked_at is null;

  return jsonb_build_object(
    'outcome', 'capture_refused',
    'job_id', v_job.id,
    'payment_id', v_payment.id,
    'provider_payment_id', v_payment.asaas_payment_id,
    'last_error_code', v_error_code
  );
end
$function$;

revoke all on function public.fail_billing_subscription_card_update_capture(
  uuid, uuid, bigint, uuid, text
) from PUBLIC, anon, authenticated, service_role;
grant execute on function public.fail_billing_subscription_card_update_capture(
  uuid, uuid, bigint, uuid, text
) to service_role;

-- Sanitized polling projection for checkout/settings. Sealed credentials,
-- lease tokens and provider request snapshots never cross this boundary.
create or replace function public.get_billing_subscription_card_update_status(
  p_job_id uuid,
  p_organization_id uuid,
  p_expected_payment_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_job private.billing_subscription_card_update_jobs%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service_role required' using errcode = '42501';
  end if;
  if p_job_id is null or p_organization_id is null then
    return jsonb_build_object('outcome', 'invalid_request');
  end if;

  select job.*
  into v_job
  from private.billing_subscription_card_update_jobs as job
  where job.id = p_job_id
    and job.organization_id = p_organization_id;
  if not found then
    return jsonb_build_object('outcome', 'job_not_found');
  end if;
  if (
       v_job.mode = 'settled_payment'
       and (
         p_expected_payment_id is null
         or v_job.payment_id is distinct from p_expected_payment_id
       )
     )
     or (v_job.mode = 'saved_only' and p_expected_payment_id is not null) then
    return jsonb_build_object('outcome', 'job_not_found');
  end if;

  return jsonb_strip_nulls(jsonb_build_object(
    'outcome', 'found',
    'job_id', v_job.id,
    'generation', v_job.generation,
    'mode', v_job.mode,
    'state', case
      when v_job.status = 'succeeded' then 'succeeded'
      when v_job.status = 'cancelled' then 'cancelled'
      when v_job.status = 'dead' and v_job.manual_review_at is not null
        then 'manual_review'
      when v_job.status = 'dead' then 'failed'
      else 'queued'
    end,
    'status', v_job.status,
    'card_last4', v_job.card_last4,
    'last_error_code', v_job.last_error_code,
    'next_attempt_at', case
      when v_job.status in ('retry', 'pending_update')
        then v_job.next_attempt_at
      else null
    end,
    'created_at', v_job.created_at,
    'updated_at', v_job.updated_at,
    'completed_at', v_job.completed_at,
    'cancelled_at', v_job.cancelled_at,
    'manual_review_at', v_job.manual_review_at
  ));
end
$function$;

revoke all on function public.get_billing_subscription_card_update_status(
  uuid, uuid, uuid
) from PUBLIC, anon, authenticated, service_role;
grant execute on function public.get_billing_subscription_card_update_status(
  uuid, uuid, uuid
) to service_role;

-- The plan-change writer is server-only, but it still shares the same remote
-- subscription. Reject a new in-flight provider PUT while a card mutation is
-- live or its outcome is under assisted review. Scheduled changes have
-- already crossed their provider PUT and therefore do not block card updates.
create or replace function private.guard_billing_plan_change_card_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.status in ('provider_updating', 'scheduled', 'applying') then
    perform private.lock_asaas_billing_resources(
      null,
      new.provider_subscription_id
    );
  end if;

  if new.status in ('provider_updating', 'scheduled', 'applying')
     and (
       tg_op = 'INSERT'
       or old.status is distinct from new.status
       or old.provider_subscription_id
         is distinct from new.provider_subscription_id
     )
     and private.billing_organization_cleanup_is_active(
       new.organization_id,
       new.provider_subscription_id
     ) then
    raise exception 'organization billing cleanup is in progress'
      using errcode = '55P03';
  end if;

  if new.status in ('provider_updating', 'scheduled', 'applying')
     and (
       tg_op = 'INSERT'
       or old.status is distinct from new.status
       or old.provider_subscription_id
         is distinct from new.provider_subscription_id
     )
     and exists (
       select 1
       from private.billing_subscription_card_update_jobs as job
       where job.organization_id = new.organization_id
         and job.provider_subscription_id = new.provider_subscription_id
         and (
           job.status in (
             'prepared', 'awaiting_payment', 'pending_update', 'processing', 'retry'
           )
           or (
             job.status = 'dead'
             and job.manual_review_at is not null
           )
         )
     ) then
    raise exception 'subscription card update is in progress'
      using errcode = '55P03';
  end if;
  return new;
end
$function$;

revoke all on function private.guard_billing_plan_change_card_update()
  from PUBLIC, anon, authenticated, service_role;
drop trigger if exists guard_billing_plan_change_card_update
  on private.billing_plan_changes;
create trigger guard_billing_plan_change_card_update
before insert or update of status, provider_subscription_id
on private.billing_plan_changes
for each row
execute function private.guard_billing_plan_change_card_update();

create or replace function public.claim_billing_subscription_card_update_jobs(
  p_worker_id text,
  p_limit integer default 10,
  p_lease_seconds integer default 300
)
returns table (
  job_id uuid,
  organization_id uuid,
  subscription_row_id uuid,
  provider_subscription_id text,
  provider_customer_id text,
  generation bigint,
  mode text,
  payment_id uuid,
  provider_payment_id text,
  provider_card_credential text,
  card_last4 text,
  job_lease_id uuid,
  lease_expires_at timestamptz,
  attempts integer,
  max_attempts integer,
  provider_request_started_at timestamptz,
  claim_outcome text,
  aad text
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_worker_id text := nullif(btrim(coalesce(p_worker_id, '')), '');
  v_candidate record;
  v_job private.billing_subscription_card_update_jobs%rowtype;
  v_org public.organizations%rowtype;
  v_subscription public.subscriptions%rowtype;
  v_payment public.asaas_payments%rowtype;
  v_org_found boolean;
  v_subscription_found boolean;
  v_payment_found boolean;
  v_conflict_reason text;
  v_lease_id uuid;
  v_now timestamptz;
  v_returned integer := 0;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service_role required' using errcode = '42501';
  end if;
  if v_worker_id is null
     or char_length(v_worker_id) > 100
     or v_worker_id !~ '^[A-Za-z0-9._:-]+$'
     or p_limit not between 1 and 100
     or p_lease_seconds not between 30 and 600 then
    return;
  end if;

  -- Candidate discovery is intentionally non-locking. The exact provider
  -- advisory lock is acquired before any row lock, then every predicate is
  -- rechecked against the frozen job generation.
  for v_candidate in
    select job.id, job.provider_payment_id, job.provider_subscription_id
    from private.billing_subscription_card_update_jobs as job
    where (
        job.status in ('pending_update', 'retry')
        and job.next_attempt_at <= clock_timestamp()
      )
      or (
        job.status = 'processing'
        and job.lease_expires_at <= clock_timestamp()
      )
    order by job.next_attempt_at, job.created_at, job.id
    limit least(500, p_limit * 10)
  loop
    v_now := clock_timestamp();
    v_conflict_reason := null;

    perform private.lock_asaas_billing_resources(
      v_candidate.provider_payment_id,
      v_candidate.provider_subscription_id
    );

    select job.*
    into v_job
    from private.billing_subscription_card_update_jobs as job
    where job.id = v_candidate.id
    for update;
    if not found then
      continue;
    end if;

    if v_job.status = 'processing'
       and v_job.lease_expires_at > v_now then
      continue;
    end if;
    if v_job.status = 'processing' then
      if v_job.expires_at <= v_now or v_job.attempts >= v_job.max_attempts then
        update private.billing_subscription_card_update_jobs as expired_job
        set
          status = 'dead',
          provider_card_credential = null,
          credential_attempt_lease_id = null,
          lease_id = null,
          lease_owner = null,
          lease_started_at = null,
          lease_expires_at = null,
          last_error_code = case
            when expired_job.provider_request_lease_id
              is distinct from expired_job.lease_id
              then 'card_update_attempts_exhausted'
            else 'card_update_outcome_unknown'
          end,
          manual_review_at = case
            when expired_job.provider_outcome_ambiguous_at is null
                 and expired_job.provider_request_lease_id
                   is distinct from expired_job.lease_id
              then null
            else v_now
          end,
          dead_lettered_at = v_now,
          updated_at = v_now
        where expired_job.id = v_job.id
          and expired_job.status = 'processing'
          and expired_job.lease_expires_at <= v_now;
        continue;
      end if;

      update private.billing_subscription_card_update_jobs as retry_job
      set
        status = 'retry',
        lease_id = null,
        lease_owner = null,
        lease_started_at = null,
        lease_expires_at = null,
        next_attempt_at = v_now,
        last_error_code = case
          when retry_job.provider_request_lease_id
            is distinct from retry_job.lease_id
            then 'worker_lease_expired'
          else 'provider_update_outcome_unknown'
        end,
        provider_outcome_ambiguous_at = case
          when retry_job.provider_request_lease_id
            is distinct from retry_job.lease_id
            then retry_job.provider_outcome_ambiguous_at
          else coalesce(retry_job.provider_outcome_ambiguous_at, v_now)
        end,
        updated_at = v_now
      where retry_job.id = v_job.id
        and retry_job.status = 'processing'
        and retry_job.lease_expires_at <= v_now;

      select job.*
      into v_job
      from private.billing_subscription_card_update_jobs as job
      where job.id = v_job.id
      for update;
    end if;

    if v_job.status not in ('pending_update', 'retry')
       or v_job.next_attempt_at > v_now then
      continue;
    end if;
    if v_job.expires_at <= v_now or v_job.attempts >= v_job.max_attempts then
      update private.billing_subscription_card_update_jobs
      set
        status = 'dead',
        provider_card_credential = null,
        credential_attempt_lease_id = null,
        last_error_code = 'card_update_attempts_exhausted',
        manual_review_at = case
          when provider_outcome_ambiguous_at is null then null
          else v_now
        end,
        dead_lettered_at = v_now,
        updated_at = v_now
      where id = v_job.id
        and status in ('pending_update', 'retry');
      continue;
    end if;

    select organization.*
    into v_org
    from public.organizations as organization
    where organization.id = v_job.organization_id
    for update;
    v_org_found := found;

    select subscription.*
    into v_subscription
    from public.subscriptions as subscription
    where subscription.id = v_job.subscription_id
    for update;
    v_subscription_found := found;

    v_payment_found := true;
    if v_job.mode = 'settled_payment' then
      select payment.*
      into v_payment
      from public.asaas_payments as payment
      where payment.id = v_job.payment_id
        and payment.organization_id = v_job.organization_id
        and payment.asaas_payment_id = v_job.provider_payment_id
      for update;
      v_payment_found := found;
    end if;

    if not v_org_found
       or not v_subscription_found
       or not v_org.is_active
       or lower(btrim(coalesce(v_org.subscription_status, ''))) <> 'active'
       or v_org.asaas_subscription_id
         is distinct from v_job.provider_subscription_id
       or v_org.asaas_customer_id is distinct from v_job.provider_customer_id
       or v_subscription.organization_id
         is distinct from v_job.organization_id
       or v_subscription.provider_subscription_id
         is distinct from v_job.provider_subscription_id
       or v_subscription.provider_customer_id
         is distinct from v_job.provider_customer_id
       or lower(v_subscription.status) <> 'active'
       or lower(coalesce(v_subscription.provider, 'asaas')) <> 'asaas' then
      v_conflict_reason := 'subscription_target_changed';
    elsif exists (
      select 1
      from private.billing_subscription_checkout_cancellations as cancellation
      where cancellation.organization_id = v_job.organization_id
        and cancellation.provider_subscription_id
          = v_job.provider_subscription_id
        and (
          cancellation.finalized_at is null
          or cancellation.final_outcome = 'manual_review'
        )
    ) then
      v_conflict_reason := 'subscription_cancellation';
    elsif private.billing_card_recurrence_cancel_state(
      v_job.organization_id,
      v_job.provider_subscription_id
    ) is not null then
      v_conflict_reason := 'legacy_recurrence_cancellation';
    elsif private.billing_organization_cleanup_is_active(
      v_job.organization_id,
      v_job.provider_subscription_id
    ) then
      v_conflict_reason := 'organization_cleanup';
    elsif exists (
      select 1
      from private.billing_plan_changes as plan_change
      where plan_change.organization_id = v_job.organization_id
        and plan_change.provider_subscription_id
          = v_job.provider_subscription_id
        and plan_change.status in ('provider_updating', 'applying')
    ) then
      v_conflict_reason := 'managed_plan_change';
    elsif v_job.mode = 'settled_payment' and (
      not v_payment_found
      or not private.billing_payment_checkout_is_paid(v_payment.status)
      or private.billing_payment_checkout_is_reversal(v_payment.status)
    ) then
      v_conflict_reason := 'payment_not_settled';
    end if;

    if v_conflict_reason is not null then
      update private.billing_subscription_card_update_jobs
      set
        status = case
          when provider_outcome_ambiguous_at is null then 'cancelled'
          else 'dead'
        end,
        provider_card_credential = null,
        credential_attempt_lease_id = null,
        lease_id = null,
        lease_owner = null,
        lease_started_at = null,
        lease_expires_at = null,
        last_error_code = v_conflict_reason,
        cancelled_at = case
          when provider_outcome_ambiguous_at is null then v_now else null
        end,
        manual_review_at = case
          when provider_outcome_ambiguous_at is null then null else v_now
        end,
        dead_lettered_at = case
          when provider_outcome_ambiguous_at is null then null else v_now
        end,
        updated_at = v_now
      where id = v_job.id
        and status in ('pending_update', 'retry');
      continue;
    end if;

    v_lease_id := extensions.gen_random_uuid();
    update private.billing_subscription_card_update_jobs as claimed_job
    set
      status = 'processing',
      attempts = claimed_job.attempts + 1,
      lease_id = v_lease_id,
      lease_owner = v_worker_id,
      lease_started_at = v_now,
      lease_expires_at = v_now + make_interval(secs => p_lease_seconds),
      updated_at = v_now
    where claimed_job.id = v_job.id
      and claimed_job.status in ('pending_update', 'retry')
      and claimed_job.next_attempt_at <= v_now
      and claimed_job.provider_card_credential is not null;
    if not found then
      continue;
    end if;

    select job.*
    into v_job
    from private.billing_subscription_card_update_jobs as job
    where job.id = v_job.id;

    job_id := v_job.id;
    organization_id := v_job.organization_id;
    subscription_row_id := v_job.subscription_id;
    provider_subscription_id := v_job.provider_subscription_id;
    provider_customer_id := v_job.provider_customer_id;
    generation := v_job.generation;
    mode := v_job.mode;
    payment_id := v_job.payment_id;
    provider_payment_id := v_job.provider_payment_id;
    provider_card_credential := v_job.provider_card_credential;
    card_last4 := v_job.card_last4;
    job_lease_id := v_job.lease_id;
    lease_expires_at := v_job.lease_expires_at;
    attempts := v_job.attempts;
    max_attempts := v_job.max_attempts;
    provider_request_started_at := v_job.provider_request_started_at;
    claim_outcome := case
      when v_job.provider_request_started_at is null then 'claimed'
      else 'replay'
    end;
    aad := 'vimob:billing-subscription-card:' || v_job.id::text
      || ':' || v_job.provider_subscription_id;
    return next;

    v_returned := v_returned + 1;
    exit when v_returned >= p_limit;
  end loop;
end
$function$;

revoke all on function public.claim_billing_subscription_card_update_jobs(
  text, integer, integer
) from PUBLIC, anon, authenticated, service_role;
grant execute on function public.claim_billing_subscription_card_update_jobs(
  text, integer, integer
) to service_role;

-- Exact CAS immediately before PUT /subscriptions/{id}/creditCard. Replays
-- after a crashed lease reuse the same sealed provider token and increment the
-- durable marker attempt; same-lease re-entry can only reconcile.
create or replace function public.mark_billing_subscription_card_update_provider_request_started(
  p_job_id uuid,
  p_organization_id uuid,
  p_generation bigint,
  p_job_lease_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_hint private.billing_subscription_card_update_jobs%rowtype;
  v_job private.billing_subscription_card_update_jobs%rowtype;
  v_org public.organizations%rowtype;
  v_subscription public.subscriptions%rowtype;
  v_now timestamptz := clock_timestamp();
  v_conflict boolean := false;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service_role required' using errcode = '42501';
  end if;
  if p_job_id is null
     or p_organization_id is null
     or p_generation is null
     or p_generation <= 0
     or p_job_lease_id is null then
    return jsonb_build_object('outcome', 'invalid_request');
  end if;

  select job.*
  into v_hint
  from private.billing_subscription_card_update_jobs as job
  where job.id = p_job_id
    and job.organization_id = p_organization_id;
  if not found then
    return jsonb_build_object('outcome', 'job_not_found');
  end if;

  perform private.lock_asaas_billing_resources(
    v_hint.provider_payment_id,
    v_hint.provider_subscription_id
  );

  select organization.*
  into v_org
  from public.organizations as organization
  where organization.id = p_organization_id
  for update;
  if not found then
    v_conflict := true;
  end if;
  if found and not v_org.is_active then
    return jsonb_build_object('outcome', 'organization_inactive');
  end if;

  select subscription.*
  into v_subscription
  from public.subscriptions as subscription
  where subscription.id = v_hint.subscription_id
  for update;
  if not found then
    v_conflict := true;
  end if;

  select job.*
  into v_job
  from private.billing_subscription_card_update_jobs as job
  where job.id = p_job_id
    and job.organization_id = p_organization_id
    and job.generation = p_generation
  for update;
  if not found then
    return jsonb_build_object('outcome', 'identifier_mismatch');
  end if;

  if v_job.status in ('succeeded', 'cancelled', 'dead') then
    return jsonb_build_object(
      'outcome', case
        when v_job.status = 'succeeded' then 'already_succeeded'
        when v_job.manual_review_at is not null then 'manual_review'
        else 'already_finalized'
      end,
      'status', v_job.status,
      'last_error_code', v_job.last_error_code
    );
  end if;
  if v_job.expires_at <= v_now then
    update private.billing_subscription_card_update_jobs
    set
      status = case
        when provider_outcome_ambiguous_at is null then 'cancelled'
        else 'dead'
      end,
      provider_card_credential = null,
      credential_attempt_lease_id = null,
      lease_id = null,
      lease_owner = null,
      lease_started_at = null,
      lease_expires_at = null,
      last_error_code = 'credential_expired',
      cancelled_at = case
        when provider_outcome_ambiguous_at is null then v_now else null
      end,
      manual_review_at = case
        when provider_outcome_ambiguous_at is null then null else v_now
      end,
      dead_lettered_at = case
        when provider_outcome_ambiguous_at is null then null else v_now
      end,
      updated_at = v_now
    where id = v_job.id
      and status = 'processing'
      and lease_id = p_job_lease_id;
    return jsonb_build_object(
      'outcome', case
        when v_job.provider_outcome_ambiguous_at is null then 'cancelled'
        else 'manual_review'
      end,
      'last_error_code', 'credential_expired'
    );
  end if;
  if v_job.status <> 'processing'
     or v_job.lease_id is distinct from p_job_lease_id
     or v_job.lease_expires_at <= v_now
     or v_job.provider_card_credential is null then
    return jsonb_build_object('outcome', 'lost_claim');
  end if;
  if v_job.provider_request_lease_id = p_job_lease_id then
    return jsonb_build_object(
      'outcome', 'already_started',
      'provider_request_started_at', v_job.provider_request_started_at,
      'provider_request_attempts', v_job.provider_request_attempts
    );
  end if;

  v_conflict := v_conflict
    or not coalesce(v_org.is_active, false)
    or lower(btrim(coalesce(v_org.subscription_status, ''))) <> 'active'
    or v_org.asaas_subscription_id
      is distinct from v_job.provider_subscription_id
    or v_org.asaas_customer_id is distinct from v_job.provider_customer_id
    or v_subscription.organization_id is distinct from p_organization_id
    or v_subscription.provider_subscription_id
      is distinct from v_job.provider_subscription_id
    or v_subscription.provider_customer_id
      is distinct from v_job.provider_customer_id
    or lower(coalesce(v_subscription.status, '')) <> 'active'
    or exists (
      select 1
      from private.billing_subscription_checkout_cancellations as cancellation
      where cancellation.organization_id = p_organization_id
        and cancellation.provider_subscription_id
          = v_job.provider_subscription_id
        and (
          cancellation.finalized_at is null
          or cancellation.final_outcome = 'manual_review'
        )
    )
    or private.billing_card_recurrence_cancel_state(
      p_organization_id,
      v_job.provider_subscription_id
    ) is not null
    or private.billing_organization_cleanup_is_active(
      p_organization_id,
      v_job.provider_subscription_id
    )
    or exists (
      select 1
      from private.billing_plan_changes as plan_change
      where plan_change.organization_id = p_organization_id
        and plan_change.provider_subscription_id
          = v_job.provider_subscription_id
        and plan_change.status in ('provider_updating', 'applying')
    );

  if v_conflict then
    update private.billing_subscription_card_update_jobs
    set
      status = case
        when provider_outcome_ambiguous_at is null then 'cancelled'
        else 'dead'
      end,
      provider_card_credential = null,
      credential_attempt_lease_id = null,
      lease_id = null,
      lease_owner = null,
      lease_started_at = null,
      lease_expires_at = null,
      last_error_code = 'provider_update_target_changed',
      cancelled_at = case
        when provider_outcome_ambiguous_at is null then v_now else null
      end,
      manual_review_at = case
        when provider_outcome_ambiguous_at is null then null else v_now
      end,
      dead_lettered_at = case
        when provider_outcome_ambiguous_at is null then null else v_now
      end,
      updated_at = v_now
    where id = v_job.id
      and status = 'processing'
      and lease_id = p_job_lease_id;

    return jsonb_build_object(
      'outcome', case
        when v_job.provider_outcome_ambiguous_at is null then 'cancelled'
        else 'manual_review'
      end,
      'last_error_code', 'provider_update_target_changed'
    );
  end if;

  update private.billing_subscription_card_update_jobs
  set
    provider_request_started_at = coalesce(provider_request_started_at, v_now),
    provider_request_last_started_at = v_now,
    provider_request_lease_id = p_job_lease_id,
    provider_request_attempts = provider_request_attempts + 1,
    updated_at = v_now
  where id = v_job.id
    and status = 'processing'
    and lease_id = p_job_lease_id
    and lease_expires_at > v_now
    and provider_request_lease_id is distinct from p_job_lease_id;
  if not found then
    return jsonb_build_object('outcome', 'lost_claim');
  end if;

  return jsonb_build_object(
    'outcome', 'proceed',
    'job_id', v_job.id,
    'generation', v_job.generation,
    'subscription_id', v_job.provider_subscription_id,
    'provider_request_started_at', coalesce(
      v_job.provider_request_started_at,
      v_now
    ),
    'provider_request_attempts', v_job.provider_request_attempts + 1
  );
end
$function$;

revoke all on function public.mark_billing_subscription_card_update_provider_request_started(
  uuid, uuid, bigint, uuid
) from PUBLIC, anon, authenticated, service_role;
grant execute on function public.mark_billing_subscription_card_update_provider_request_started(
  uuid, uuid, bigint, uuid
) to service_role;

create or replace function public.succeed_billing_subscription_card_update_job(
  p_job_id uuid,
  p_organization_id uuid,
  p_generation bigint,
  p_job_lease_id uuid,
  p_provider_snapshot jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_hint private.billing_subscription_card_update_jobs%rowtype;
  v_job private.billing_subscription_card_update_jobs%rowtype;
  v_org public.organizations%rowtype;
  v_subscription public.subscriptions%rowtype;
  v_sanitized jsonb;
  v_now timestamptz := clock_timestamp();
  v_target_valid boolean := true;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service_role required' using errcode = '42501';
  end if;
  if p_job_id is null
     or p_organization_id is null
     or p_generation is null
     or p_generation <= 0
     or p_job_lease_id is null
     or jsonb_typeof(p_provider_snapshot) is distinct from 'object' then
    return jsonb_build_object('outcome', 'invalid_request');
  end if;

  select job.*
  into v_hint
  from private.billing_subscription_card_update_jobs as job
  where job.id = p_job_id
    and job.organization_id = p_organization_id;
  if not found then
    return jsonb_build_object('outcome', 'job_not_found');
  end if;

  perform private.lock_asaas_billing_resources(
    v_hint.provider_payment_id,
    v_hint.provider_subscription_id
  );

  select organization.*
  into v_org
  from public.organizations as organization
  where organization.id = p_organization_id
  for update;
  if not found then
    v_target_valid := false;
  end if;

  select subscription.*
  into v_subscription
  from public.subscriptions as subscription
  where subscription.id = v_hint.subscription_id
  for update;
  if not found then
    v_target_valid := false;
  end if;

  select job.*
  into v_job
  from private.billing_subscription_card_update_jobs as job
  where job.id = p_job_id
    and job.organization_id = p_organization_id
    and job.generation = p_generation
  for update;
  if not found then
    return jsonb_build_object('outcome', 'identifier_mismatch');
  end if;

  if v_job.status = 'succeeded' then
    return jsonb_build_object(
      'outcome', 'already_succeeded',
      'job_id', v_job.id,
      'card_last4', v_job.card_last4,
      'completed_at', v_job.completed_at
    );
  end if;
  if v_job.status in ('cancelled', 'dead') then
    return jsonb_build_object(
      'outcome', case
        when v_job.manual_review_at is not null then 'manual_review'
        else 'already_finalized'
      end,
      'status', v_job.status,
      'last_error_code', v_job.last_error_code
    );
  end if;
  if v_job.status <> 'processing'
     or v_job.lease_id is distinct from p_job_lease_id
     or v_job.lease_expires_at <= v_now
     or v_job.provider_request_lease_id is distinct from p_job_lease_id
     or v_job.provider_request_started_at is null then
    return jsonb_build_object('outcome', 'lost_claim');
  end if;

  if nullif(btrim(coalesce(p_provider_snapshot ->> 'id', '')), '')
       is distinct from v_job.provider_subscription_id
     or nullif(btrim(coalesce(p_provider_snapshot ->> 'customer', '')), '')
       is distinct from v_job.provider_customer_id
     or upper(btrim(coalesce(p_provider_snapshot ->> 'status', '')))
       <> 'ACTIVE' then
    return jsonb_build_object('outcome', 'provider_snapshot_mismatch');
  end if;

  v_target_valid := v_target_valid
    and coalesce(v_org.is_active, false)
    and lower(btrim(coalesce(v_org.subscription_status, ''))) = 'active'
    and v_org.asaas_subscription_id = v_job.provider_subscription_id
    and v_org.asaas_customer_id = v_job.provider_customer_id
    and v_subscription.organization_id = p_organization_id
    and v_subscription.provider_subscription_id
      = v_job.provider_subscription_id
    and v_subscription.provider_customer_id = v_job.provider_customer_id
    and lower(v_subscription.status) = 'active';

  if not v_target_valid then
    update private.billing_subscription_card_update_jobs
    set
      status = 'dead',
      provider_card_credential = null,
      credential_attempt_lease_id = null,
      lease_id = null,
      lease_owner = null,
      lease_started_at = null,
      lease_expires_at = null,
      last_error_code = 'provider_update_succeeded_after_target_changed',
      manual_review_at = v_now,
      dead_lettered_at = v_now,
      updated_at = v_now
    where id = v_job.id
      and status = 'processing'
      and lease_id = p_job_lease_id;
    return jsonb_build_object(
      'outcome', 'manual_review',
      'last_error_code', 'provider_update_succeeded_after_target_changed'
    );
  end if;

  v_sanitized := jsonb_strip_nulls(jsonb_build_object(
    'id', v_job.provider_subscription_id,
    'customer', v_job.provider_customer_id,
    'status', 'ACTIVE',
    'cycle', nullif(btrim(coalesce(p_provider_snapshot ->> 'cycle', '')), ''),
    'nextDueDate', nullif(
      btrim(coalesce(p_provider_snapshot ->> 'nextDueDate', '')),
      ''
    )
  ));

  update private.billing_subscription_card_update_jobs
  set
    status = 'succeeded',
    provider_card_credential = null,
    credential_attempt_lease_id = null,
    lease_id = null,
    lease_owner = null,
    lease_started_at = null,
    lease_expires_at = null,
    provider_snapshot = v_sanitized,
    last_error_code = null,
    manual_review_at = null,
    completed_at = v_now,
    updated_at = v_now
  where id = v_job.id
    and status = 'processing'
    and lease_id = p_job_lease_id
    and provider_request_lease_id = p_job_lease_id;
  if not found then
    return jsonb_build_object('outcome', 'lost_claim');
  end if;

  update public.subscriptions
  set
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
      'billing_card', jsonb_build_object(
        'last4', v_job.card_last4,
        'updated_at', v_now,
        'generation', v_job.generation,
        'job_id', v_job.id
      )
    ),
    updated_at = v_now
  where id = v_job.subscription_id
    and organization_id = p_organization_id
    and provider_subscription_id = v_job.provider_subscription_id;

  return jsonb_build_object(
    'outcome', 'succeeded',
    'job_id', v_job.id,
    'generation', v_job.generation,
    'card_last4', v_job.card_last4,
    'completed_at', v_now
  );
end
$function$;

revoke all on function public.succeed_billing_subscription_card_update_job(
  uuid, uuid, bigint, uuid, jsonb
) from PUBLIC, anon, authenticated, service_role;
grant execute on function public.succeed_billing_subscription_card_update_job(
  uuid, uuid, bigint, uuid, jsonb
) to service_role;

create or replace function public.fail_billing_subscription_card_update_job(
  p_job_id uuid,
  p_organization_id uuid,
  p_generation bigint,
  p_job_lease_id uuid,
  p_failure_class text,
  p_error_code text,
  p_retry_after_seconds integer default 30
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_failure_class text := lower(nullif(
    btrim(coalesce(p_failure_class, '')),
    ''
  ));
  v_error_code text := lower(nullif(btrim(coalesce(p_error_code, '')), ''));
  v_hint private.billing_subscription_card_update_jobs%rowtype;
  v_job private.billing_subscription_card_update_jobs%rowtype;
  v_org public.organizations%rowtype;
  v_subscription public.subscriptions%rowtype;
  v_local_removed boolean := false;
  v_has_marker boolean := false;
  v_retry boolean := false;
  v_manual boolean := false;
  v_now timestamptz := clock_timestamp();
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service_role required' using errcode = '42501';
  end if;
  if p_job_id is null
     or p_organization_id is null
     or p_generation is null
     or p_generation <= 0
     or p_job_lease_id is null
     or v_failure_class not in (
       'retryable', 'permanent', 'not_found', 'ambiguous'
     )
     or v_error_code is null
     or v_error_code !~ '^[a-z0-9_]{1,80}$'
     or p_retry_after_seconds not between 1 and 3600 then
    return jsonb_build_object('outcome', 'invalid_request');
  end if;

  select job.*
  into v_hint
  from private.billing_subscription_card_update_jobs as job
  where job.id = p_job_id
    and job.organization_id = p_organization_id;
  if not found then
    return jsonb_build_object('outcome', 'job_not_found');
  end if;

  perform private.lock_asaas_billing_resources(
    v_hint.provider_payment_id,
    v_hint.provider_subscription_id
  );

  select organization.*
  into v_org
  from public.organizations as organization
  where organization.id = p_organization_id
  for update;
  if not found then
    v_local_removed := true;
  end if;

  select subscription.*
  into v_subscription
  from public.subscriptions as subscription
  where subscription.id = v_hint.subscription_id
  for update;
  if not found then
    v_local_removed := true;
  end if;

  select job.*
  into v_job
  from private.billing_subscription_card_update_jobs as job
  where job.id = p_job_id
    and job.organization_id = p_organization_id
    and job.generation = p_generation
  for update;
  if not found then
    return jsonb_build_object('outcome', 'identifier_mismatch');
  end if;

  if v_job.status in ('succeeded', 'cancelled', 'dead') then
    return jsonb_build_object(
      'outcome', 'already_finalized',
      'status', v_job.status,
      'last_error_code', v_job.last_error_code
    );
  end if;
  if v_job.status <> 'processing'
     or v_job.lease_id is distinct from p_job_lease_id then
    return jsonb_build_object('outcome', 'lost_claim');
  end if;
  -- Historical markers belong to prior leases and mean the same token must be
  -- replayed. They must not prevent the fresh worker from reporting a
  -- decrypt/identity-preflight failure before marking its own PUT.
  v_has_marker := v_job.provider_request_started_at is not null
    and v_job.provider_request_lease_id = p_job_lease_id;

  v_local_removed := v_local_removed
    or v_org.asaas_subscription_id
      is distinct from v_job.provider_subscription_id
    or v_subscription.provider_subscription_id
      is distinct from v_job.provider_subscription_id
    or lower(coalesce(v_subscription.status, ''))
      in ('cancelled', 'canceled', 'deleted');

  if v_failure_class in ('retryable', 'ambiguous')
     and v_job.expires_at > v_now
     and v_job.attempts < v_job.max_attempts then
    v_retry := true;
  elsif v_failure_class = 'not_found' and v_local_removed then
    v_retry := false;
    v_manual := false;
  elsif v_failure_class = 'permanent' then
    v_retry := false;
    v_manual := v_job.provider_outcome_ambiguous_at is not null;
  elsif v_failure_class = 'retryable' then
    v_retry := false;
    v_manual := v_job.provider_outcome_ambiguous_at is not null;
  elsif v_failure_class = 'ambiguous' then
    v_retry := false;
    v_manual := v_has_marker
      or v_job.provider_outcome_ambiguous_at is not null;
  else
    v_retry := false;
    v_manual := true;
  end if;

  if v_retry then
    update private.billing_subscription_card_update_jobs
    set
      status = 'retry',
      lease_id = null,
      lease_owner = null,
      lease_started_at = null,
      lease_expires_at = null,
      next_attempt_at = v_now
        + make_interval(secs => p_retry_after_seconds),
      provider_outcome_ambiguous_at = case
        when v_has_marker and v_failure_class = 'ambiguous'
          then coalesce(provider_outcome_ambiguous_at, v_now)
        else provider_outcome_ambiguous_at
      end,
      last_error_code = v_error_code,
      updated_at = v_now
    where id = v_job.id
      and status = 'processing'
      and lease_id = p_job_lease_id;
    if not found then
      return jsonb_build_object('outcome', 'lost_claim');
    end if;

    return jsonb_build_object(
      'outcome', 'retry',
      'job_id', v_job.id,
      'attempts', v_job.attempts,
      'max_attempts', v_job.max_attempts,
      'next_attempt_at', v_now + make_interval(secs => p_retry_after_seconds),
      'replay_same_credential', true
    );
  end if;

  update private.billing_subscription_card_update_jobs
  set
    status = case
      when v_failure_class = 'not_found' and v_local_removed
        then 'cancelled'
      else 'dead'
    end,
    provider_card_credential = null,
    credential_attempt_lease_id = null,
    lease_id = null,
    lease_owner = null,
    lease_started_at = null,
    lease_expires_at = null,
    provider_outcome_ambiguous_at = case
      when v_has_marker and v_failure_class = 'ambiguous'
        then coalesce(provider_outcome_ambiguous_at, v_now)
      else provider_outcome_ambiguous_at
    end,
    last_error_code = v_error_code,
    cancelled_at = case
      when v_failure_class = 'not_found' and v_local_removed then v_now
      else null
    end,
    manual_review_at = case when v_manual then v_now else null end,
    dead_lettered_at = case
      when v_failure_class = 'not_found' and v_local_removed then null
      else v_now
    end,
    updated_at = v_now
  where id = v_job.id
    and status = 'processing'
    and lease_id = p_job_lease_id;
  if not found then
    return jsonb_build_object('outcome', 'lost_claim');
  end if;

  if v_manual then
    insert into public.error_events (
      organization_id,
      source,
      severity,
      fingerprint,
      message,
      category,
      error_code,
      component,
      metadata,
      occurred_at
    ) values (
      p_organization_id,
      'backend',
      'critical',
      'billing_subscription_card_update_manual:' || p_job_id::text,
      'Subscription card update requires assisted review',
      'billing',
      'billing_subscription_card_update_manual_review',
      'billing_subscription_card_update_worker',
      jsonb_build_object(
        'job_id', p_job_id,
        'generation', p_generation,
        'subscription_id', v_job.provider_subscription_id,
        'failure_class', v_failure_class,
        'error_code', v_error_code,
        'provider_request_attempts', v_job.provider_request_attempts
      ),
      v_now
    )
    on conflict do nothing;
  end if;

  return jsonb_build_object(
    'outcome', case
      when v_failure_class = 'not_found' and v_local_removed then 'cancelled'
      when v_manual then 'manual_review'
      else 'failed'
    end,
    'job_id', v_job.id,
    'last_error_code', v_error_code
  );
end
$function$;

revoke all on function public.fail_billing_subscription_card_update_job(
  uuid, uuid, bigint, uuid, text, text, integer
) from PUBLIC, anon, authenticated, service_role;
grant execute on function public.fail_billing_subscription_card_update_job(
  uuid, uuid, bigint, uuid, text, text, integer
) to service_role;

-- Releases a prepared/sealed token after a definitive local tokenization or
-- persistence failure. No capture POST or subscription PUT may have started.
-- The exact checkout attempt fences a stale Edge invocation from abandoning a
-- job that a newer attempt already resumed.
create or replace function public.abandon_billing_subscription_card_update_job(
  p_job_id uuid,
  p_organization_id uuid,
  p_generation bigint,
  p_attempt_lease_id uuid,
  p_error_code text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_error_code text := lower(nullif(btrim(coalesce(p_error_code, '')), ''));
  v_hint private.billing_subscription_card_update_jobs%rowtype;
  v_job private.billing_subscription_card_update_jobs%rowtype;
  v_payment public.asaas_payments%rowtype;
  v_capability public.billing_payment_checkout_capabilities%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service_role required' using errcode = '42501';
  end if;
  if p_job_id is null
     or p_organization_id is null
     or p_generation is null
     or p_generation <= 0
     or v_error_code is null
     or v_error_code !~ '^[a-z0-9_]{1,80}$' then
    return jsonb_build_object('outcome', 'invalid_request');
  end if;

  select job.*
  into v_hint
  from private.billing_subscription_card_update_jobs as job
  where job.id = p_job_id
    and job.organization_id = p_organization_id;
  if not found then
    return jsonb_build_object('outcome', 'job_not_found');
  end if;

  perform private.lock_asaas_billing_resources(
    v_hint.provider_payment_id,
    v_hint.provider_subscription_id
  );

  if v_hint.mode = 'settled_payment' then
    if p_attempt_lease_id is null then
      return jsonb_build_object('outcome', 'invalid_request');
    end if;
    select payment.*
    into v_payment
    from public.asaas_payments as payment
    where payment.id = v_hint.payment_id
      and payment.organization_id = p_organization_id
      and payment.asaas_payment_id = v_hint.provider_payment_id
    for update;
    if not found then
      return jsonb_build_object('outcome', 'payment_not_found');
    end if;

    select capability.*
    into v_capability
    from public.billing_payment_checkout_capabilities as capability
    where capability.payment_id = v_payment.id
      and capability.organization_id = p_organization_id
      and capability.asaas_payment_id = v_payment.asaas_payment_id
    for update;
    if not found
       or v_capability.attempt_lease_id is distinct from p_attempt_lease_id then
      return jsonb_build_object('outcome', 'lost_claim');
    end if;
  elsif p_attempt_lease_id is not null then
    return jsonb_build_object('outcome', 'invalid_request');
  end if;

  select job.*
  into v_job
  from private.billing_subscription_card_update_jobs as job
  where job.id = p_job_id
    and job.organization_id = p_organization_id
    and job.generation = p_generation
  for update;
  if not found then
    return jsonb_build_object('outcome', 'identifier_mismatch');
  end if;

  if v_job.status in ('succeeded', 'cancelled', 'dead') then
    return jsonb_build_object(
      'outcome', 'already_finalized',
      'status', v_job.status,
      'last_error_code', v_job.last_error_code
    );
  end if;
  if v_job.status not in ('prepared', 'awaiting_payment')
     or v_job.capture_request_started_at is not null
     or v_job.provider_request_started_at is not null
     or v_job.lease_id is not null
     or (
       v_job.mode = 'settled_payment'
       and v_job.credential_attempt_lease_id is not null
       and v_job.credential_attempt_lease_id
         is distinct from p_attempt_lease_id
     ) then
    return jsonb_build_object('outcome', 'provider_mutation_started');
  end if;

  update private.billing_subscription_card_update_jobs
  set
    status = 'cancelled',
    provider_card_credential = null,
    card_last4 = null,
    credential_attempt_lease_id = null,
    lease_id = null,
    lease_owner = null,
    lease_started_at = null,
    lease_expires_at = null,
    last_error_code = v_error_code,
    cancelled_at = v_now,
    updated_at = v_now
  where id = v_job.id
    and generation = p_generation
    and status in ('prepared', 'awaiting_payment')
    and capture_request_started_at is null
    and provider_request_started_at is null
    and lease_id is null;
  if not found then
    return jsonb_build_object('outcome', 'state_changed');
  end if;

  if v_job.mode = 'settled_payment' then
    update public.billing_payment_checkout_capabilities
    set
      attempt_lease_id = null,
      attempt_lease_expires_at = null,
      updated_at = v_now
    where payment_id = v_job.payment_id
      and organization_id = p_organization_id
      and attempt_lease_id = p_attempt_lease_id
      and revoked_at is null;
  end if;

  return jsonb_build_object(
    'outcome', 'abandoned',
    'job_id', v_job.id,
    'last_error_code', v_error_code
  );
end
$function$;

revoke all on function public.abandon_billing_subscription_card_update_job(
  uuid, uuid, bigint, uuid, text
) from PUBLIC, anon, authenticated, service_role;
grant execute on function public.abandon_billing_subscription_card_update_job(
  uuid, uuid, bigint, uuid, text
) to service_role;

-- Explicit assisted resolution is the only way to clear a provider-outcome
-- ambiguity. This prevents cancellation/plan writers from being blocked
-- forever while still forbidding automatic guesses about a remote PUT.
create or replace function public.resolve_billing_subscription_card_update_manual_review(
  p_job_id uuid,
  p_organization_id uuid,
  p_resolution text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_resolution text := lower(nullif(btrim(coalesce(p_resolution, '')), ''));
  v_job private.billing_subscription_card_update_jobs%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service_role required' using errcode = '42501';
  end if;
  if p_job_id is null
     or p_organization_id is null
     or v_resolution not in (
       'provider_card_confirmed',
       'provider_card_not_applied',
       'subscription_removed'
     ) then
    return jsonb_build_object('outcome', 'invalid_request');
  end if;

  select job.*
  into v_job
  from private.billing_subscription_card_update_jobs as job
  where job.id = p_job_id
    and job.organization_id = p_organization_id;
  if not found then
    return jsonb_build_object('outcome', 'job_not_found');
  end if;

  perform private.lock_asaas_billing_resources(
    v_job.provider_payment_id,
    v_job.provider_subscription_id
  );

  select job.*
  into v_job
  from private.billing_subscription_card_update_jobs as job
  where job.id = p_job_id
    and job.organization_id = p_organization_id
  for update;
  if v_job.status <> 'dead' or v_job.manual_review_at is null then
    return jsonb_build_object(
      'outcome', 'not_in_manual_review',
      'status', v_job.status
    );
  end if;

  if v_resolution = 'provider_card_confirmed' and not exists (
    select 1
    from public.subscriptions as subscription
    where subscription.id = v_job.subscription_id
      and subscription.organization_id = p_organization_id
      and subscription.provider_subscription_id
        = v_job.provider_subscription_id
      and lower(subscription.status) = 'active'
  ) then
    return jsonb_build_object('outcome', 'subscription_not_active');
  end if;

  update private.billing_subscription_card_update_jobs
  set
    status = case
      when v_resolution = 'provider_card_confirmed' then 'succeeded'
      else 'cancelled'
    end,
    provider_card_credential = null,
    credential_attempt_lease_id = null,
    lease_id = null,
    lease_owner = null,
    lease_started_at = null,
    lease_expires_at = null,
    provider_snapshot = provider_snapshot || jsonb_build_object(
      'assisted_resolution', v_resolution,
      'resolved_at', v_now
    ),
    last_error_code = null,
    manual_review_at = null,
    completed_at = case
      when v_resolution = 'provider_card_confirmed' then v_now else null
    end,
    cancelled_at = case
      when v_resolution = 'provider_card_confirmed' then null else v_now
    end,
    dead_lettered_at = null,
    updated_at = v_now
  where id = v_job.id
    and status = 'dead'
    and manual_review_at is not null;

  if v_resolution = 'provider_card_confirmed' then
    update public.subscriptions
    set
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'billing_card', jsonb_build_object(
          'last4', v_job.card_last4,
          'updated_at', v_now,
          'generation', v_job.generation,
          'job_id', v_job.id,
          'assisted', true
        )
      ),
      updated_at = v_now
    where id = v_job.subscription_id
      and organization_id = p_organization_id
      and provider_subscription_id = v_job.provider_subscription_id;
  end if;

  return jsonb_build_object(
    'outcome', 'resolved',
    'resolution', v_resolution,
    'status', case
      when v_resolution = 'provider_card_confirmed' then 'succeeded'
      else 'cancelled'
    end
  );
end
$function$;

revoke all on function public.resolve_billing_subscription_card_update_manual_review(
  uuid, uuid, text
) from PUBLIC, anon, authenticated, service_role;
grant execute on function public.resolve_billing_subscription_card_update_manual_review(
  uuid, uuid, text
) to service_role;
