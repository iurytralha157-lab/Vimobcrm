-- Allow distribution queues to store a team as a single queue entry.
-- Existing expanded team rows (team_id + user_id) remain valid until manually cleaned up.

alter table if exists public.round_robin_members
  add column if not exists team_id uuid references public.teams(id) on delete set null;

alter table if exists public.round_robin_members
  alter column user_id drop not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'round_robin_members_user_or_team_check'
      and conrelid = 'public.round_robin_members'::regclass
  ) then
    alter table public.round_robin_members
      add constraint round_robin_members_user_or_team_check
      check (user_id is not null or team_id is not null);
  end if;
end $$;

create unique index if not exists round_robin_members_unique_team_entry
  on public.round_robin_members (round_robin_id, team_id)
  where user_id is null and team_id is not null;
