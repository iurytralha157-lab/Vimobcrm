-- Grupo OLX / Canal Pro portal integration foundation.
-- The data model is generic by portal so future providers can reuse the same tables.

create table if not exists public.portal_integrations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  portal text not null,
  status text not null default 'draft',
  is_active boolean not null default false,
  feed_token text not null default (
    replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
  ),
  webhook_token text not null default (
    replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
  ),
  lead_webhook_secret_ref text,
  default_pipeline_id uuid references public.pipelines(id) on delete set null,
  default_stage_id uuid references public.stages(id) on delete set null,
  default_assigned_user_id uuid references public.users(id) on delete set null,
  default_round_robin_id uuid references public.round_robins(id) on delete set null,
  settings jsonb not null default '{}'::jsonb,
  last_feed_accessed_at timestamptz,
  last_lead_received_at timestamptz,
  last_import_report_at timestamptz,
  last_sync_status text,
  last_error text,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint portal_integrations_portal_check check (portal in ('grupo_olx')),
  constraint portal_integrations_status_check check (status in ('draft', 'pending_setup', 'connected', 'paused', 'error'))
);

create unique index if not exists portal_integrations_org_portal_uidx
  on public.portal_integrations (organization_id, portal);

create unique index if not exists portal_integrations_feed_token_uidx
  on public.portal_integrations (feed_token);

create unique index if not exists portal_integrations_webhook_token_uidx
  on public.portal_integrations (webhook_token);

create index if not exists portal_integrations_org_status_idx
  on public.portal_integrations (organization_id, portal, status);

create table if not exists public.portal_listing_publications (
  id uuid primary key default gen_random_uuid(),
  integration_id uuid not null references public.portal_integrations(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  portal text not null,
  property_id uuid not null references public.properties(id) on delete cascade,
  client_listing_id text not null,
  publication_type text not null default 'STANDARD',
  is_enabled boolean not null default true,
  status text not null default 'pending',
  validation_errors jsonb not null default '[]'::jsonb,
  last_exported_at timestamptz,
  last_seen_in_feed_at timestamptz,
  last_error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint portal_listing_publications_portal_check check (portal in ('grupo_olx')),
  constraint portal_listing_publications_status_check check (status in ('pending', 'valid', 'invalid', 'exported', 'error', 'disabled')),
  constraint portal_listing_publications_client_listing_id_check check (length(btrim(client_listing_id)) between 1 and 50)
);

create unique index if not exists portal_listing_publications_property_uidx
  on public.portal_listing_publications (integration_id, property_id);

create unique index if not exists portal_listing_publications_listing_uidx
  on public.portal_listing_publications (integration_id, client_listing_id);

create index if not exists portal_listing_publications_org_portal_idx
  on public.portal_listing_publications (organization_id, portal, is_enabled, status);

create index if not exists portal_listing_publications_property_idx
  on public.portal_listing_publications (property_id);

create table if not exists public.portal_import_reports (
  id uuid primary key default gen_random_uuid(),
  integration_id uuid not null references public.portal_integrations(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  portal text not null,
  report_id text,
  status text not null default 'received',
  summary jsonb not null default '{}'::jsonb,
  raw_payload jsonb not null default '{}'::jsonb,
  error text,
  created_at timestamptz not null default now(),
  constraint portal_import_reports_portal_check check (portal in ('grupo_olx')),
  constraint portal_import_reports_status_check check (status in ('received', 'success', 'warning', 'error'))
);

create unique index if not exists portal_import_reports_report_uidx
  on public.portal_import_reports (integration_id, report_id)
  where report_id is not null;

create index if not exists portal_import_reports_org_created_idx
  on public.portal_import_reports (organization_id, portal, created_at desc);

create table if not exists public.portal_webhook_events (
  id uuid primary key default gen_random_uuid(),
  integration_id uuid not null references public.portal_integrations(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  portal text not null,
  event_type text not null,
  event_key text,
  source_id text,
  payload jsonb not null,
  processing_status text not null default 'pending',
  lead_id uuid references public.leads(id) on delete set null,
  property_id uuid references public.properties(id) on delete set null,
  error text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  constraint portal_webhook_events_portal_check check (portal in ('grupo_olx')),
  constraint portal_webhook_events_status_check check (processing_status in ('pending', 'processed', 'duplicate', 'ignored', 'error'))
);

create unique index if not exists portal_webhook_events_event_uidx
  on public.portal_webhook_events (integration_id, event_type, event_key)
  where event_key is not null;

create index if not exists portal_webhook_events_org_received_idx
  on public.portal_webhook_events (organization_id, portal, received_at desc);

create index if not exists portal_webhook_events_lead_idx
  on public.portal_webhook_events (lead_id)
  where lead_id is not null;

create or replace function private.enforce_portal_tenant_scope()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_table_name = 'portal_integrations' then
    if new.default_pipeline_id is not null and not exists (
      select 1 from public.pipelines p
      where p.id = new.default_pipeline_id and p.organization_id = new.organization_id
    ) then
      raise exception using errcode = '23514', message = 'portal pipeline must belong to the integration organization';
    end if;
    if new.default_stage_id is not null and not exists (
      select 1 from public.stages s
      where s.id = new.default_stage_id
        and s.organization_id = new.organization_id
        and (new.default_pipeline_id is null or s.pipeline_id = new.default_pipeline_id)
    ) then
      raise exception using errcode = '23514', message = 'portal stage must belong to the integration organization and pipeline';
    end if;
    if new.default_assigned_user_id is not null and not exists (
      select 1 from public.organization_members om
      where om.organization_id = new.organization_id and om.user_id = new.default_assigned_user_id
    ) then
      raise exception using errcode = '23514', message = 'portal assignee must belong to the integration organization';
    end if;
    if new.default_round_robin_id is not null and not exists (
      select 1 from public.round_robins rr
      where rr.id = new.default_round_robin_id and rr.organization_id = new.organization_id
    ) then
      raise exception using errcode = '23514', message = 'portal round robin must belong to the integration organization';
    end if;
  elsif tg_table_name = 'portal_listing_publications' then
    if not exists (
      select 1 from public.portal_integrations pi
      where pi.id = new.integration_id
        and pi.organization_id = new.organization_id
        and pi.portal = new.portal
    ) or not exists (
      select 1 from public.properties p
      where p.id = new.property_id and p.organization_id = new.organization_id
    ) then
      raise exception using errcode = '23514', message = 'portal publication references must belong to one organization';
    end if;
  elsif tg_table_name in ('portal_import_reports', 'portal_webhook_events') then
    if not exists (
      select 1 from public.portal_integrations pi
      where pi.id = new.integration_id
        and pi.organization_id = new.organization_id
        and pi.portal = new.portal
    ) then
      raise exception using errcode = '23514', message = 'portal event integration must belong to the event organization';
    end if;
    if tg_table_name = 'portal_webhook_events' then
      if new.lead_id is not null and not exists (
        select 1 from public.leads l where l.id = new.lead_id and l.organization_id = new.organization_id
      ) then
        raise exception using errcode = '23514', message = 'portal event lead must belong to the event organization';
      end if;
      if new.property_id is not null and not exists (
        select 1 from public.properties p where p.id = new.property_id and p.organization_id = new.organization_id
      ) then
        raise exception using errcode = '23514', message = 'portal event property must belong to the event organization';
      end if;
    end if;
  end if;
  return new;
end;
$$;

revoke all on function private.enforce_portal_tenant_scope() from public;

drop trigger if exists enforce_portal_integrations_tenant_scope on public.portal_integrations;
create trigger enforce_portal_integrations_tenant_scope
before insert or update on public.portal_integrations
for each row execute function private.enforce_portal_tenant_scope();

drop trigger if exists enforce_portal_publications_tenant_scope on public.portal_listing_publications;
create trigger enforce_portal_publications_tenant_scope
before insert or update on public.portal_listing_publications
for each row execute function private.enforce_portal_tenant_scope();

drop trigger if exists enforce_portal_reports_tenant_scope on public.portal_import_reports;
create trigger enforce_portal_reports_tenant_scope
before insert or update on public.portal_import_reports
for each row execute function private.enforce_portal_tenant_scope();

drop trigger if exists enforce_portal_events_tenant_scope on public.portal_webhook_events;
create trigger enforce_portal_events_tenant_scope
before insert or update on public.portal_webhook_events
for each row execute function private.enforce_portal_tenant_scope();

drop trigger if exists set_updated_at_portal_integrations on public.portal_integrations;
create trigger set_updated_at_portal_integrations
before update on public.portal_integrations
for each row execute function private.set_updated_at();

drop trigger if exists set_updated_at_portal_listing_publications on public.portal_listing_publications;
create trigger set_updated_at_portal_listing_publications
before update on public.portal_listing_publications
for each row execute function private.set_updated_at();

alter table public.portal_integrations enable row level security;
alter table public.portal_listing_publications enable row level security;
alter table public.portal_import_reports enable row level security;
alter table public.portal_webhook_events enable row level security;

revoke all on table public.portal_integrations from anon, authenticated;
revoke all on table public.portal_listing_publications from anon, authenticated;
revoke all on table public.portal_import_reports from anon, authenticated;
revoke all on table public.portal_webhook_events from anon, authenticated;

grant select, insert, update, delete on table public.portal_integrations to authenticated;
grant select, insert, update, delete on table public.portal_listing_publications to authenticated;
grant select on table public.portal_import_reports to authenticated;
grant select, insert, update, delete on table public.portal_integrations to service_role;
grant select, insert, update, delete on table public.portal_listing_publications to service_role;
grant select, insert, update, delete on table public.portal_import_reports to service_role;
grant select, insert, update, delete on table public.portal_webhook_events to service_role;

drop policy if exists "members read portal integrations" on public.portal_integrations;
create policy "members read portal integrations"
on public.portal_integrations
for select
to authenticated
using (private.is_org_member(organization_id) or private.is_super_admin());

drop policy if exists "admins manage portal integrations" on public.portal_integrations;
create policy "admins manage portal integrations"
on public.portal_integrations
for all
to authenticated
using (private.has_org_role(organization_id, array['owner', 'admin']) or private.is_super_admin())
with check (private.has_org_role(organization_id, array['owner', 'admin']) or private.is_super_admin());

drop policy if exists "members read portal publications" on public.portal_listing_publications;
create policy "members read portal publications"
on public.portal_listing_publications
for select
to authenticated
using (private.is_org_member(organization_id) or private.is_super_admin());

drop policy if exists "admins manage portal publications" on public.portal_listing_publications;
create policy "admins manage portal publications"
on public.portal_listing_publications
for all
to authenticated
using (private.has_org_role(organization_id, array['owner', 'admin']) or private.is_super_admin())
with check (private.has_org_role(organization_id, array['owner', 'admin']) or private.is_super_admin());

drop policy if exists "members read portal import reports" on public.portal_import_reports;
create policy "members read portal import reports"
on public.portal_import_reports
for select
to authenticated
using (private.is_org_member(organization_id) or private.is_super_admin());

-- Raw portal webhook payloads are processed by the backend only.
drop policy if exists "backend manages portal webhook events" on public.portal_webhook_events;
create policy "backend manages portal webhook events"
on public.portal_webhook_events
for all
to service_role
using (true)
with check (true);

update public.admin_subscription_plans
set
  description = case
    when description ilike '%portais%' then description
    else coalesce(description, 'Tudo do Pro, com automacoes e mais usuarios.') || ' Inclui integracao com portais imobiliarios.'
  end,
  modules = case
    when coalesce(modules, '{}'::text[]) @> array['portals']::text[] then modules
    else coalesce(modules, '{}'::text[]) || array['portals']::text[]
  end,
  updated_at = now()
where slug = 'master-497';

insert into public.organization_modules (organization_id, module_name, is_enabled)
select o.id, 'portals', true
from public.organizations o
join public.admin_subscription_plans p on p.id = o.plan_id
where p.slug = 'master-497'
on conflict (organization_id, module_name)
do update set is_enabled = true, updated_at = now();
