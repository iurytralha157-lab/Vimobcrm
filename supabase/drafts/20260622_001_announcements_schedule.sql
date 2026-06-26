alter table public.announcements
  add column if not exists starts_at timestamptz null,
  add column if not exists ends_at timestamptz null,
  add column if not exists display_duration_seconds integer null;

alter table public.announcements
  drop constraint if exists announcements_display_duration_seconds_check;

alter table public.announcements
  add constraint announcements_display_duration_seconds_check
  check (display_duration_seconds is null or display_duration_seconds between 5 and 86400);

create index if not exists announcements_active_schedule_idx
  on public.announcements (is_active, show_banner, starts_at, ends_at, created_at desc);

create index if not exists announcements_target_user_ids_idx
  on public.announcements using gin (target_user_ids);

create index if not exists announcements_target_organization_ids_idx
  on public.announcements using gin (target_organization_ids);

drop policy if exists "users read targeted active announcements" on public.announcements;

create policy "users read targeted active announcements"
on public.announcements
for select
to authenticated
using (
  is_active = true
  and (starts_at is null or starts_at <= now())
  and (ends_at is null or ends_at >= now())
  and (
    target_type = 'all'
    or (target_type = 'specific' and auth.uid() = any(target_user_ids))
    or (
      target_type = 'organizations'
      and exists (
        select 1
        from public.organization_members om
        where om.user_id = auth.uid()
          and om.is_active = true
          and om.organization_id = any(announcements.target_organization_ids)
      )
    )
    or (
      target_type = 'admins'
      and exists (
        select 1
        from public.users u
        where u.id = auth.uid()
          and u.role = any(array['admin', 'super_admin'])
      )
    )
    or (
      target_type = 'brokers'
      and exists (
        select 1
        from public.users u
        where u.id = auth.uid()
          and u.is_active = true
          and lower(coalesce(u.role, '')) = any(array['corretor', 'broker', 'agent', 'user'])
      )
    )
  )
);
