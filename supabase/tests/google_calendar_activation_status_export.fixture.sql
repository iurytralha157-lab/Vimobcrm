-- Fresh disposable test database only. Never execute on a CRM environment.
\ir google_calendar_outbound_protocol.fixture.sql
alter table public.google_calendar_tokens add column account_email text,
  add column account_picture_url text, add column scopes text[], add column expires_at timestamptz,
  add column calendar_id text default 'primary', add column calendar_summary text,
  add column connected_at timestamptz, add column last_synced_at timestamptz,
  add column updated_at timestamptz not null default now();
alter table public.google_calendar_tokens add constraint token_secret_required
  check(disconnected_at is not null or token_secret_ref is not null);
create unique index synthetic_active_google_owner on public.google_calendar_tokens(organization_id,user_id)
  where disconnected_at is null;
alter table public.schedule_events add column lead_id uuid;
alter table public.organization_members add column role text default 'user',
  add column membership_generation bigint not null default 1;
create table public.leads(id uuid primary key,organization_id uuid,name text,assigned_user_id uuid,team_id uuid);
create table public.teams(id uuid primary key,organization_id uuid,is_active boolean);
create table public.team_members(organization_id uuid,team_id uuid,user_id uuid,is_active boolean,is_leader boolean,membership_generation bigint);
create table public.available_permissions(id uuid primary key default gen_random_uuid(),key text unique);
create table public.organization_roles(id uuid primary key default gen_random_uuid(),organization_id uuid,is_active boolean);
create table public.user_organization_roles(user_id uuid,organization_id uuid,role_id uuid,is_active boolean);
create table public.organization_role_permissions(role_id uuid,organization_id uuid,permission_id uuid);
create table public.user_permission_overrides(organization_id uuid,user_id uuid,permission_key text,allowed boolean,
  primary key(organization_id,user_id,permission_key));
\ir ../migrations/20261012212128_harden_google_calendar_outbound_protocol.sql
\ir ../migrations/20261013000127_harden_google_calendar_activation_status_and_export.sql
\ir google_calendar_activation_status_export.test.sql
