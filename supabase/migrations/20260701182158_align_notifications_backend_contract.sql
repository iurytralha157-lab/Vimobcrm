-- Align notifications with the Go API contract used by leads and schedule flows.
-- These columns are additive and keep existing notifications untouched.

alter table if exists public.notifications
  add column if not exists body text,
  add column if not exists channel text not null default 'in_app',
  add column if not exists target_url text;

update public.notifications
set body = content
where body is null
  and content is not null;
