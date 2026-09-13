-- The production baseline retained the legacy role columns while introducing
-- the organization-scoped canonical columns consumed by the Go API. Keep both
-- representations readable, backfill existing grants and make new dual-write
-- operations enforce tenant-consistent foreign keys.

-- Materialize canonical grants for every legacy permission that is still
-- understood by the application. Legacy aliases remain in place for old SQL
-- readers; canonical copies make the same access visible to the Go resolver.
with permission_expansions(source_key, target_key) as (
  values
    ('data_view_dashboard', 'dashboard_view'),
    ('data_view_org_stats', 'dashboard_view'),
    ('data_view_team_stats', 'dashboard_view'),
    ('lead_edit', 'lead_operate'),
    ('lead_edit_own', 'lead_operate'),
    ('lead_edit_own', 'lead_view_own'),
    ('lead_edit_all', 'lead_operate'),
    ('lead_edit_all', 'lead_view_all'),
    ('lead_manage', 'lead_operate'),
    ('lead_manage', 'lead_view_all'),
    ('lead_assign', 'lead_operate'),
    ('lead_transfer', 'lead_operate'),
    ('pipeline_edit', 'pipeline_manage'),
    ('settings_pipelines', 'pipeline_manage'),
    ('cadences_manage', 'pipeline_manage'),
    ('settings_teams', 'team_manage'),
    ('teams_manage', 'team_manage'),
    ('settings_users', 'users_manage'),
    ('automations_edit', 'automations_manage'),
    ('property_create', 'property_manage'),
    ('property_delete', 'property_manage'),
    ('property_assign', 'property_manage'),
    ('property_view_all', 'property_view'),
    ('property_view_team', 'property_view'),
    ('schedule_manage', 'schedule_manage'),
    ('site_manage', 'settings_site'),
    ('ai_manage', 'settings_ai'),
    ('settings_manage', 'permissions_manage'),
    ('settings_manage', 'users_manage'),
    ('settings_manage', 'team_manage'),
    ('settings_manage', 'pipeline_manage'),
    ('settings_manage', 'tag_manage'),
    ('settings_manage', 'settings_integrations'),
    ('settings_manage', 'settings_organization'),
    ('financial_manage', 'financial_view'),
    ('financial_manage', 'financial_manage'),
    ('gamification_manage', 'gamification_view'),
    ('gamification_manage', 'gamification_manage'),
    ('property_manage', 'property_view'),
    ('property_manage', 'property_manage'),
    ('whatsapp_manage', 'whatsapp_view'),
    ('whatsapp_manage', 'whatsapp_operate'),
    ('whatsapp_manage', 'whatsapp_manage')
), expanded_grants as (
  select distinct
    legacy.organization_role_id as role_id,
    role_row.organization_id,
    permission_row.id as permission_id,
    permission_row.key as permission_key
  from public.organization_role_permissions legacy
  join public.organization_roles role_row
    on role_row.id = legacy.organization_role_id
  join public.available_permissions permission_row
    on permission_row.key = lower(btrim(legacy.permission_key))

  union

  select distinct
    legacy.organization_role_id as role_id,
    role_row.organization_id,
    permission_row.id as permission_id,
    permission_row.key as permission_key
  from public.organization_role_permissions legacy
  join public.organization_roles role_row
    on role_row.id = legacy.organization_role_id
  join permission_expansions expansion
    on expansion.source_key = lower(btrim(legacy.permission_key))
  join public.available_permissions permission_row
    on permission_row.key = expansion.target_key
)
insert into public.organization_role_permissions (
  organization_role_id,
  permission_key,
  organization_id,
  role_id,
  permission_id
)
select
  role_id,
  permission_key,
  organization_id,
  role_id,
  permission_id
from expanded_grants
on conflict (organization_role_id, permission_key)
do update set
  organization_id = excluded.organization_id,
  role_id = excluded.role_id,
  permission_id = excluded.permission_id;

-- A legacy assignment already identifies its organization through the role.
-- Backfill that scope before replacing the old global one-role-per-user key.
update public.user_organization_roles assignment
set
  organization_id = role_row.organization_id,
  role_id = assignment.organization_role_id,
  updated_at = coalesce(assignment.updated_at, now())
from public.organization_roles role_row
where role_row.id = assignment.organization_role_id
  and (
    assignment.organization_id is distinct from role_row.organization_id
    or assignment.role_id is distinct from assignment.organization_role_id
  );

alter table public.user_organization_roles
  drop constraint if exists user_organization_roles_user_id_key;

create unique index if not exists user_organization_roles_organization_user_uidx
  on public.user_organization_roles (organization_id, user_id)
  where organization_id is not null;

-- Canonical columns now have database-level tenant consistency while nullable
-- legacy-only rows remain preserved. NOT VALID avoids discarding unknown legacy
-- permission keys; every new row is still checked immediately.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'organization_roles_organization_id_id_key'
      and conrelid = 'public.organization_roles'::regclass
  ) then
    alter table public.organization_roles
      add constraint organization_roles_organization_id_id_key
      unique (organization_id, id);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'organization_role_permissions_canonical_role_fkey'
      and conrelid = 'public.organization_role_permissions'::regclass
  ) then
    alter table public.organization_role_permissions
      add constraint organization_role_permissions_canonical_role_fkey
      foreign key (organization_id, role_id)
      references public.organization_roles (organization_id, id)
      on delete cascade
      not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'organization_role_permissions_permission_id_fkey'
      and conrelid = 'public.organization_role_permissions'::regclass
  ) then
    alter table public.organization_role_permissions
      add constraint organization_role_permissions_permission_id_fkey
      foreign key (permission_id)
      references public.available_permissions (id)
      on delete restrict
      not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'user_organization_roles_canonical_role_fkey'
      and conrelid = 'public.user_organization_roles'::regclass
  ) then
    alter table public.user_organization_roles
      add constraint user_organization_roles_canonical_role_fkey
      foreign key (organization_id, role_id)
      references public.organization_roles (organization_id, id)
      on delete cascade
      not valid;
  end if;
end
$$;

comment on column public.organization_role_permissions.organization_role_id is
  'Legacy alias of role_id retained for compatibility; backend writes both columns.';
comment on column public.organization_role_permissions.permission_key is
  'Legacy alias of available_permissions.key retained for compatibility; backend writes both representations.';
comment on column public.user_organization_roles.organization_role_id is
  'Legacy alias of role_id retained for compatibility; backend writes both columns.';
