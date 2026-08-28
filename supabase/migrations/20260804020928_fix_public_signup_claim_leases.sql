create table if not exists private.public_signup_attempt_claims (
    attempt_id uuid primary key,
    normalized_email text not null,
    status text not null default 'retryable',
    lease_token uuid,
    lease_expires_at timestamptz,
    auth_user_id uuid,
    organization_id uuid,
    completed_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint public_signup_attempt_claims_email_check check (
        normalized_email = lower(btrim(normalized_email))
        and btrim(normalized_email) <> ''
    ),
    constraint public_signup_attempt_claims_status_check check (
        status in ('retryable', 'processing', 'compensating', 'completed')
    ),
    constraint public_signup_attempt_claims_state_check check (
        (
            status = 'retryable'
            and lease_token is null
            and lease_expires_at is null
            and organization_id is null
            and completed_at is null
        )
        or (
            status in ('processing', 'compensating')
            and lease_token is not null
            and lease_expires_at is not null
            and organization_id is null
            and completed_at is null
        )
        or (
            status = 'completed'
            and lease_token is null
            and lease_expires_at is null
            and organization_id is not null
            and completed_at is not null
        )
    )
);

create unique index if not exists public_signup_attempt_claims_organization_unique
    on private.public_signup_attempt_claims (organization_id)
    where organization_id is not null;

create index if not exists public_signup_attempt_claims_recovery_idx
    on private.public_signup_attempt_claims (lease_expires_at, attempt_id)
    where status in ('processing', 'compensating');

insert into private.public_signup_attempt_claims (
    attempt_id,
    normalized_email,
    status,
    organization_id,
    completed_at,
    created_at,
    updated_at
)
select
    organization.signup_attempt_id,
    organization.signup_attempt_email,
    'completed',
    organization.id,
    coalesce(organization.created_at, now()),
    coalesce(organization.created_at, now()),
    now()
from public.organizations as organization
where organization.signup_attempt_id is not null
  and organization.signup_attempt_email is not null
on conflict (attempt_id) do nothing;

comment on table private.public_signup_attempt_claims is
    'Short-lived, fenced leases for multi-instance public signup idempotency. No lease may be held across external HTTP calls by a database transaction.';

comment on column private.public_signup_attempt_claims.lease_token is
    'Fencing token. Every mutation after external I/O must compare-and-set this exact token.';

revoke all on table private.public_signup_attempt_claims from public, anon, authenticated, service_role;
