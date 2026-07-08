-- Ensure that the teams table has the updated_at column expected by the backend.
-- If the table was created before the v3 schema migration, it may be missing this column
-- because CREATE TABLE IF NOT EXISTS does not alter existing tables.

alter table if exists public.teams
  add column if not exists updated_at timestamptz not null default now();

alter table if exists public.teams
  add column if not exists is_active boolean not null default true;

alter table if exists public.teams
  add column if not exists logo_url text;

alter table if exists public.teams
  add column if not exists created_by uuid references public.users(id) on delete set null;
