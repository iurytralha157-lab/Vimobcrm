begin;

create table if not exists public.error_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete set null,
  user_id uuid references public.users(id) on delete set null,
  request_id text,
  source text not null,
  severity text not null default 'error',
  category text,
  message text not null,
  error_code text,
  http_status integer,
  method text,
  path text,
  route text,
  component text,
  stack text,
  stack_hash text,
  fingerprint text not null,
  url text,
  user_agent text,
  browser_context jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.users(id) on delete set null,
  resolution_note text,
  constraint error_events_source_check check (source in ('frontend', 'backend', 'api')),
  constraint error_events_severity_check check (severity in ('debug', 'info', 'warning', 'error', 'critical')),
  constraint error_events_http_status_check check (http_status is null or (http_status >= 100 and http_status <= 599)),
  constraint error_events_message_not_blank check (length(btrim(message)) > 0),
  constraint error_events_fingerprint_not_blank check (length(btrim(fingerprint)) > 0)
);

create index if not exists idx_error_events_created_at
  on public.error_events(created_at desc);

create index if not exists idx_error_events_organization_created_at
  on public.error_events(organization_id, created_at desc);

create index if not exists idx_error_events_user_created_at
  on public.error_events(user_id, created_at desc);

create index if not exists idx_error_events_severity_created_at
  on public.error_events(severity, created_at desc);

create index if not exists idx_error_events_fingerprint_created_at
  on public.error_events(fingerprint, created_at desc);

create index if not exists idx_error_events_unresolved_created_at
  on public.error_events(created_at desc)
  where resolved_at is null;

alter table public.error_events enable row level security;

revoke all on table public.error_events from anon, authenticated;
grant select, insert, update, delete on table public.error_events to service_role;

commit;
