-- Align legacy push token and assignment log tables with the backend contract.
-- The changes are additive and keep legacy columns for existing database functions.

alter table if exists public.push_tokens
  add column if not exists token text,
  add column if not exists platform text,
  add column if not exists device_info jsonb not null default '{}'::jsonb,
  add column if not exists endpoint text,
  add column if not exists p256dh text,
  add column if not exists auth text,
  add column if not exists user_agent text,
  add column if not exists updated_at timestamptz default now();

update public.push_tokens
set
  endpoint = coalesce(
    endpoint,
    case
      when token is null then null
      when lower(coalesce(platform, '')) in ('ios', 'android') and token not like 'native:%'
        then 'native:' || lower(platform) || ':' || token
      else token
    end
  ),
  p256dh = coalesce(p256dh, device_info->>'p256dh'),
  auth = coalesce(auth, device_info->>'auth'),
  user_agent = coalesce(user_agent, device_info->>'userAgent', device_info->>'user_agent'),
  updated_at = coalesce(updated_at, created_at, now())
where endpoint is null
   or p256dh is null
   or auth is null
   or user_agent is null
   or updated_at is null;

update public.push_tokens
set
  token = coalesce(
    token,
    case
      when endpoint like 'native:%:%' then split_part(endpoint, ':', 3)
      else endpoint
    end
  ),
  platform = coalesce(
    platform,
    case
      when endpoint like 'native:%:%' then split_part(endpoint, ':', 2)
      else 'web'
    end
  ),
  device_info = coalesce(device_info, '{}'::jsonb) || jsonb_build_object('endpoint', endpoint)
where endpoint is not null
  and (token is null or platform is null or not (coalesce(device_info, '{}'::jsonb) ? 'endpoint'));

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'push_tokens'
      and column_name = 'token'
      and is_nullable = 'NO'
  ) then
    alter table public.push_tokens alter column token drop not null;
  end if;
end $$;

create unique index if not exists idx_push_tokens_user_endpoint_unique
  on public.push_tokens (user_id, endpoint)
  where endpoint is not null;

alter table if exists public.assignments_log
  add column if not exists assigned_user_id uuid references public.users(id) on delete set null,
  add column if not exists user_id uuid references public.users(id) on delete set null,
  add column if not exists assigned_at timestamptz,
  add column if not exists old_user_id uuid references public.users(id) on delete set null,
  add column if not exists new_user_id uuid references public.users(id) on delete set null,
  add column if not exists created_by uuid references public.users(id) on delete set null;

update public.assignments_log
set
  assigned_user_id = coalesce(assigned_user_id, new_user_id),
  user_id = coalesce(user_id, created_by),
  assigned_at = coalesce(assigned_at, created_at),
  new_user_id = coalesce(new_user_id, assigned_user_id),
  created_by = coalesce(created_by, user_id)
where assigned_user_id is null
   or user_id is null
   or assigned_at is null
   or new_user_id is null
   or created_by is null;

create index if not exists idx_assignments_log_org_new_user_created
  on public.assignments_log (organization_id, new_user_id, created_at desc)
  where new_user_id is not null;
