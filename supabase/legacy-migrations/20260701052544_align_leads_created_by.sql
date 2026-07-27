alter table if exists public.leads
  add column if not exists created_by uuid references public.users(id) on delete set null;

create index if not exists idx_leads_organization_created_by
  on public.leads (organization_id, created_by)
  where created_by is not null;
