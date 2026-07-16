-- Prepared only. This migration intentionally performs no lead backfill.
alter table public.leads
  add column if not exists team_id uuid null;

create unique index if not exists teams_organization_id_id_uidx
  on public.teams (organization_id, id);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'leads_team_same_organization_fk'
      and conrelid = 'public.leads'::regclass
  ) then
    alter table public.leads
      add constraint leads_team_same_organization_fk
      foreign key (organization_id, team_id)
      references public.teams (organization_id, id)
      on delete set null (team_id)
      not valid;
  end if;
end
$$;

create index if not exists leads_organization_team_idx
  on public.leads (organization_id, team_id)
  where team_id is not null;
