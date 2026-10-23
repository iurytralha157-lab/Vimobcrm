create schema private;

create table public.organizations (
  id uuid primary key,
  name text not null,
  is_active boolean not null default true
);

create table public.users (
  id uuid primary key,
  organization_id uuid,
  name text,
  email text,
  role text not null default 'user',
  is_active boolean not null default true,
  avatar_url text,
  whatsapp text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organization_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  user_id uuid not null,
  role text not null default 'user',
  is_active boolean not null default true,
  deleted_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (user_id, organization_id)
);

create table public.teams (
  id uuid primary key,
  organization_id uuid not null,
  is_active boolean not null default true
);

create table public.team_members (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null,
  organization_id uuid not null,
  user_id uuid not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.round_robins (
  id uuid primary key,
  organization_id uuid not null,
  deleted_at timestamptz
);

create table public.round_robin_members (
  id uuid primary key default gen_random_uuid(),
  round_robin_id uuid not null,
  organization_id uuid not null,
  user_id uuid,
  team_id uuid,
  weight integer not null default 1,
  position integer not null default 0,
  leads_count integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.round_robin_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  round_robin_id uuid not null
);

create table public.round_robin_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  round_robin_id uuid not null,
  member_id uuid,
  assigned_user_id uuid,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create table public.whatsapp_inbound_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  target_round_robin_id uuid not null
);

create table public.member_availability (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  team_member_id uuid not null references public.team_members(id) on delete cascade,
  day_of_week integer,
  is_all_day boolean,
  start_time time,
  end_time time,
  is_active boolean
);

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  assigned_user_id uuid,
  updated_at timestamptz not null default now()
);

create table public.properties (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  responsible_user_id uuid,
  created_by uuid,
  cadastrado_por text,
  corretor_id uuid,
  updated_at timestamptz not null default now()
);

create table public.whatsapp_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  owner_user_id uuid,
  status text,
  is_active boolean,
  is_notification_session boolean,
  updated_at timestamptz not null default now()
);

create table public.user_organization_roles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  user_id uuid not null,
  is_active boolean not null default true,
  updated_at timestamptz not null default now()
);

create table public.user_permission_overrides (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  user_id uuid not null,
  permission_key text not null,
  allowed boolean not null
);

create table private.pending_queue (
  organization_id uuid not null,
  round_robin_id uuid not null,
  is_pending boolean not null default true,
  primary key (organization_id, round_robin_id)
);

create function private.round_robin_has_pending_whatsapp_intake(
  p_organization_id uuid,
  p_round_robin_id uuid
) returns boolean
language sql stable
as $body$
  select exists (
    select 1
    from private.pending_queue
    where organization_id = p_organization_id
      and round_robin_id = p_round_robin_id
      and is_pending = true
  );
$body$;
