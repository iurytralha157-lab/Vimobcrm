-- Keep public registration and billing capabilities behind the Vimob API.
--
-- This is intentionally a backward-compatible transition migration:
-- legacy plaintext columns remain temporarily available to the currently
-- deployed server, but browser roles lose access immediately. The new API
-- writes/reads the hashed invitation token and the service-only checkout
-- capability table. During the rolling deployment, the live invitation token
-- is also mirrored into the browser-inaccessible legacy column so old and new
-- API instances interoperate. A later migration drops both legacy columns.

alter table public.invitations
  add column if not exists token_hash text;

update public.invitations
set token_hash = encode(extensions.digest(token, 'sha256'), 'hex')
where token_hash is null
  and token is not null;

-- Keep the legacy token default/not-null contract until every old API instance
-- has drained. Browser roles cannot read this column; the new API strips both
-- token fields from every response and uses token_hash for canonical lookups.
alter table public.invitations
  alter column token_hash set not null;

create unique index if not exists invitations_token_hash_uidx
  on public.invitations (token_hash);

do $constraint$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.invitations'::regclass
      and conname = 'invitations_token_hash_format_check'
  ) then
    alter table public.invitations
      add constraint invitations_token_hash_format_check
      check (token_hash ~ '^[0-9a-f]{64}$');
  end if;
end
$constraint$;

create or replace function private.sync_invitation_token_hash()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  -- Compatibility for old and new API instances during the rolling deploy.
  -- New instances supply both values temporarily but use only token_hash for
  -- canonical lookups and never expose either value in an API response.
  if new.token is not null then
    if tg_op = 'INSERT' and new.token_hash is null then
      new.token_hash := encode(extensions.digest(new.token, 'sha256'), 'hex');
    elsif tg_op = 'UPDATE'
          and new.token is distinct from old.token
          and new.token_hash is not distinct from old.token_hash then
      new.token_hash := encode(extensions.digest(new.token, 'sha256'), 'hex');
    end if;
  end if;

  if new.token_hash is null then
    raise exception 'invitation token hash is required';
  end if;

  return new;
end
$function$;

drop trigger if exists sync_invitation_token_hash on public.invitations;
create trigger sync_invitation_token_hash
before insert or update of token, token_hash on public.invitations
for each row
execute function private.sync_invitation_token_hash();

-- Invitations are BFF-only. Public invite lookup/acceptance is token-scoped
-- in the Go API; the browser must never query this table directly.
do $policies$
declare
  policy_row record;
begin
  for policy_row in
    select policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'invitations'
  loop
    execute format(
      'drop policy if exists %I on public.invitations',
      policy_row.policyname
    );
  end loop;
end
$policies$;

revoke all privileges on table public.invitations from PUBLIC, anon, authenticated;
grant select, insert, update, delete on table public.invitations to service_role;

create table if not exists public.organization_checkout_capabilities (
  organization_id uuid primary key
    references public.organizations(id) on delete cascade,
  checkout_token text not null unique
    default replace(gen_random_uuid()::text, '-', ''),
  created_at timestamptz not null default now(),
  rotated_at timestamptz,
  constraint organization_checkout_capabilities_token_format_check
    check (checkout_token ~ '^[0-9a-f]{32}$')
);

insert into public.organization_checkout_capabilities (
  organization_id,
  checkout_token
)
select
  organization.id,
  organization.checkout_token
from public.organizations as organization
where organization.checkout_token is not null
on conflict (organization_id) do update
set checkout_token = excluded.checkout_token;

alter table public.organization_checkout_capabilities enable row level security;
revoke all privileges on table public.organization_checkout_capabilities
  from PUBLIC, anon, authenticated;
grant select, insert, update, delete
  on table public.organization_checkout_capabilities
  to service_role;

create or replace function private.sync_organization_checkout_capability()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  -- Compatibility bridge for the currently deployed API. The new API writes
  -- the capability table directly and reuses this value on conflict.
  if new.checkout_token is not null then
    insert into public.organization_checkout_capabilities (
      organization_id,
      checkout_token
    )
    values (new.id, new.checkout_token)
    on conflict (organization_id) do update
    set checkout_token = excluded.checkout_token;
  end if;

  return new;
end
$function$;

drop trigger if exists sync_organization_checkout_capability
  on public.organizations;
create trigger sync_organization_checkout_capability
after insert or update of checkout_token on public.organizations
for each row
execute function private.sync_organization_checkout_capability();

-- Organization creation and mutation are API-only. Authenticated browser
-- clients retain read access only to non-capability columns.
do $organization_policies$
declare
  policy_row record;
begin
  for policy_row in
    select policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'organizations'
      and cmd <> 'SELECT'
  loop
    execute format(
      'drop policy if exists %I on public.organizations',
      policy_row.policyname
    );
  end loop;
end
$organization_policies$;

revoke all privileges on table public.organizations from PUBLIC, anon, authenticated;

do $safe_organization_columns$
declare
  safe_columns text;
begin
  select string_agg(format('%I', column_name), ', ' order by ordinal_position)
  into safe_columns
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'organizations'
    and column_name not in (
      'checkout_token',
      'signup_attempt_id',
      'signup_attempt_email'
    );

  if safe_columns is null then
    raise exception 'organizations safe column list is empty';
  end if;

  execute format(
    'grant select (%s) on table public.organizations to authenticated',
    safe_columns
  );
end
$safe_organization_columns$;

grant all privileges on table public.organizations to service_role;

-- Integration secrets are also BFF-only. Their public APIs authenticate with
-- these values, so exposing them through PostgREST bypasses permission checks.
do $integration_tables$
declare
  target_table text;
  policy_row record;
begin
  foreach target_table in array array[
    'webhooks_integrations',
    'webhooks',
    'whatsapp_sessions',
    'portal_integrations'
  ]
  loop
    if to_regclass(format('public.%I', target_table)) is null then
      continue;
    end if;

    execute format('alter table public.%I enable row level security', target_table);

    for policy_row in
      select policyname
      from pg_policies
      where schemaname = 'public'
        and tablename = target_table
    loop
      execute format(
        'drop policy if exists %I on public.%I',
        policy_row.policyname,
        target_table
      );
    end loop;

    execute format(
      'revoke all privileges on table public.%I from PUBLIC, anon, authenticated',
      target_table
    );
    execute format(
      'grant select, insert, update, delete on table public.%I to service_role',
      target_table
    );
  end loop;
end
$integration_tables$;

comment on column public.invitations.token_hash is
  'Canonical SHA-256 lookup digest. The legacy plaintext mirror is browser-inaccessible and removed after rollout.';
comment on table public.organization_checkout_capabilities is
  'Service-only checkout capability store. Browser roles have no direct privileges.';
