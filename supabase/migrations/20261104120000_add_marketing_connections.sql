-- Marketing connections.
--
-- Purely additive. These tables hold the read-only logins used to pull
-- campaigns, media and social data. They are deliberately separate from
-- public.meta_integrations and public.meta_oauth_flows, which belong to the
-- lead intake: nothing here references, reads or changes those tables.
--
-- Rollback while unused: drop the three tables below, then delete the Vault
-- secrets named 'marketing-connection:%'. The previous API version ignores them.

create table public.marketing_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  provider text not null,
  external_user_id text not null,
  external_user_name text,
  status text not null default 'active',
  granted_scopes text[] not null default '{}',
  access_token_secret_ref uuid not null,
  token_expires_at timestamptz,
  last_validated_at timestamptz,
  last_error text,
  connected_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint marketing_connections_provider_check
    check (provider in ('meta', 'google')),
  constraint marketing_connections_status_check
    check (status in ('active', 'expired', 'error')),
  constraint marketing_connections_external_user_check
    check (length(btrim(external_user_id)) > 0),
  constraint marketing_connections_org_provider_user_unique
    unique (organization_id, provider, external_user_id),
  constraint marketing_connections_id_org_unique
    unique (id, organization_id)
);

create table public.marketing_connection_assets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  connection_id uuid not null,
  asset_type text not null,
  external_id text not null,
  name text,
  metadata jsonb not null default '{}'::jsonb,
  is_selected boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint marketing_connection_assets_type_check
    check (asset_type in ('ad_account', 'page', 'instagram_account')),
  constraint marketing_connection_assets_external_check
    check (length(btrim(external_id)) > 0),
  constraint marketing_connection_assets_unique
    unique (connection_id, asset_type, external_id),
  constraint marketing_connection_assets_connection_fkey
    foreign key (connection_id, organization_id)
    references public.marketing_connections(id, organization_id)
    on delete cascade
);

create table public.marketing_oauth_flows (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  provider text not null,
  nonce_hash text not null,
  return_url text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint marketing_oauth_flows_provider_check
    check (provider in ('meta', 'google'))
);

create index marketing_connections_org_idx
  on public.marketing_connections (organization_id, provider);
create index marketing_connection_assets_org_selected_idx
  on public.marketing_connection_assets (organization_id, asset_type)
  where is_selected;
create index marketing_oauth_flows_org_idx
  on public.marketing_oauth_flows (organization_id);
create index marketing_oauth_flows_expires_idx
  on public.marketing_oauth_flows (expires_at);

-- Served only by the permission-checked Go API: browser roles receive neither
-- Data API privileges nor RLS policies.
alter table public.marketing_connections enable row level security;
alter table public.marketing_connection_assets enable row level security;
alter table public.marketing_oauth_flows enable row level security;

revoke all on table public.marketing_connections from public, anon, authenticated;
revoke all on table public.marketing_connection_assets from public, anon, authenticated;
revoke all on table public.marketing_oauth_flows from public, anon, authenticated;
