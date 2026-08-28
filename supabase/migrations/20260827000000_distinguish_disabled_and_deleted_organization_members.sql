-- Keep a disabled organization membership recoverable while allowing an
-- explicitly deleted member to disappear from user management without
-- deleting the canonical Auth user or historical records.
alter table public.organization_members
  add column if not exists deleted_at timestamptz;

comment on column public.organization_members.deleted_at is
  'Set only when the member is explicitly removed from the organization; temporary access suspension uses is_active = false.';

-- No historical backfill is safe here: before this column existed, both a
-- temporary suspension and an explicit removal were stored only as
-- is_active = false. Preserve those legacy rows as recoverable/inactive instead
-- of guessing and permanently hiding a user that may only have been suspended.

-- Keep every legacy authorization helper tied to a live membership. This is
-- required because authenticated users keep their Supabase Auth session while
-- their access to an organization is suspended.
create or replace function private.get_user_organization_id()
returns uuid
language sql
stable
security definer
set search_path to ''
as $$
  select app_user.organization_id
  from public.users app_user
  join public.organization_members membership
    on membership.user_id = app_user.id
   and membership.organization_id = app_user.organization_id
  join public.organizations organization
    on organization.id = membership.organization_id
  where app_user.id = (select auth.uid())
    and coalesce(app_user.is_active, false) = true
    and coalesce(membership.is_active, false) = true
    and membership.deleted_at is null
    and coalesce(organization.is_active, true) = true
  limit 1;
$$;

create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select private.is_super_admin()
    or exists (
      select 1
      from public.users app_user
      join public.organization_members membership
        on membership.user_id = app_user.id
       and membership.organization_id = app_user.organization_id
      join public.organizations organization
        on organization.id = membership.organization_id
      where app_user.id = (select auth.uid())
        and coalesce(app_user.is_active, false) = true
        and coalesce(membership.is_active, false) = true
        and membership.deleted_at is null
        and membership.role in ('owner', 'admin')
        and coalesce(organization.is_active, true) = true
    );
$$;

create or replace function private.is_org_member(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select private.is_super_admin()
    or (
      target_organization_id is not null
      and exists (
        select 1
        from public.organization_members membership
        join public.users app_user on app_user.id = membership.user_id
        join public.organizations organization on organization.id = membership.organization_id
        where membership.user_id = (select auth.uid())
          and membership.organization_id = target_organization_id
          and coalesce(membership.is_active, false) = true
          and membership.deleted_at is null
          and coalesce(app_user.is_active, false) = true
          and coalesce(organization.is_active, true) = true
      )
    );
$$;

create or replace function private.user_belongs_to_organization(org_id uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select private.is_org_member(org_id);
$$;

create or replace function private.user_has_organization()
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select private.is_super_admin()
    or exists (
      select 1
      from public.organization_members membership
      join public.users app_user on app_user.id = membership.user_id
      join public.organizations organization on organization.id = membership.organization_id
      where membership.user_id = (select auth.uid())
        and coalesce(membership.is_active, false) = true
        and membership.deleted_at is null
        and coalesce(app_user.is_active, false) = true
        and coalesce(organization.is_active, true) = true
    );
$$;

create or replace function private.vimob_user_has_active_org_membership(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select (select auth.uid()) is not null
    and exists (
      select 1
      from public.organization_members membership
      join public.users app_user on app_user.id = membership.user_id
      join public.organizations organization on organization.id = membership.organization_id
      where membership.user_id = (select auth.uid())
        and membership.organization_id = p_org_id
        and coalesce(membership.is_active, false) = true
        and membership.deleted_at is null
        and coalesce(app_user.is_active, false) = true
        and coalesce(organization.is_active, true) = true
    );
$$;

create or replace function private.vimob_users_share_active_org(p_target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select exists (
    select 1
    from public.organization_members caller
    join public.organization_members target
      on target.organization_id = caller.organization_id
    join public.users caller_user on caller_user.id = caller.user_id
    join public.organizations organization on organization.id = caller.organization_id
    where caller.user_id = (select auth.uid())
      and caller.organization_id = private.get_user_organization_id()
      and coalesce(caller.is_active, false) = true
      and caller.deleted_at is null
      and coalesce(caller_user.is_active, false) = true
      and coalesce(organization.is_active, true) = true
      and target.user_id = p_target_user_id
      and target.deleted_at is null
      and (
        coalesce(target.is_active, false) = true
        or caller.role in ('owner', 'admin')
        or private.is_super_admin()
      )
  );
$$;

-- This SECURITY DEFINER helper is used by WhatsApp RLS policies. Keep the
-- existing session ownership constraints, but delegate tenant authorization to
-- the canonical helper so a suspended or tombstoned membership cannot keep
-- accessing a session through a legacy raw is_active check.
create or replace function private.vimob_can_access_whatsapp_session(
  p_session_id uuid,
  p_permission text default 'view'::text
)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select exists (
    select 1
    from public.whatsapp_sessions session
    where session.id = p_session_id
      and coalesce(session.is_active, true) = true
      and coalesce(session.status, '') <> 'deleted'
      and session.provider = 'evolution_go'
      and session.owner_user_id = (select auth.uid())
      and private.is_org_member(session.organization_id)
  );
$$;

-- Role assignment is a server-side operation. The production baseline allowed
-- an authenticated user with no row yet to self-insert any app_role, including
-- super_admin, which would bypass every tenant guard below.
revoke insert, update, delete on table public.user_roles from anon, authenticated;

-- Existing policies in the production baseline are intentionally varied. A
-- restrictive policy adds one common invariant without replacing their more
-- specific permission rules: an authenticated request may touch a tenant row
-- only when that user is currently active in the row's organization.
do $migration$
declare
  tenant_table record;
begin
  for tenant_table in
    select namespace.nspname as schema_name, relation.relname as table_name
    from pg_class relation
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    join pg_attribute attribute
      on attribute.attrelid = relation.oid
     and attribute.attname = 'organization_id'
     and attribute.attnum > 0
     and not attribute.attisdropped
    join pg_type attribute_type on attribute_type.oid = attribute.atttypid
    where namespace.nspname = 'public'
      and relation.relkind in ('r', 'p')
      and relation.relrowsecurity = true
      and attribute_type.typname = 'uuid'
  loop
    execute format(
      'drop policy if exists %I on %I.%I',
      'vimob_active_membership_guard',
      tenant_table.schema_name,
      tenant_table.table_name
    );
    execute format(
      'create policy %I on %I.%I as restrictive for all to authenticated using (organization_id is null or private.is_org_member(organization_id)) with check (organization_id is null or private.is_org_member(organization_id))',
      'vimob_active_membership_guard',
      tenant_table.schema_name,
      tenant_table.table_name
    );
  end loop;
end
$migration$;

-- organizations uses its own id as the tenant key, so it is covered
-- separately. INSERT remains governed by the existing onboarding policy.
drop policy if exists vimob_active_membership_guard_select on public.organizations;
create policy vimob_active_membership_guard_select
on public.organizations
as restrictive
for select
to authenticated
using (private.is_org_member(id));

drop policy if exists vimob_active_membership_guard_update on public.organizations;
create policy vimob_active_membership_guard_update
on public.organizations
as restrictive
for update
to authenticated
using (private.is_org_member(id))
with check (private.is_org_member(id));

drop policy if exists vimob_active_membership_guard_delete on public.organizations;
create policy vimob_active_membership_guard_delete
on public.organizations
as restrictive
for delete
to authenticated
using (private.is_org_member(id));

-- Tenant-owned child tables do not carry organization_id themselves. Guard
-- them through their canonical parent instead of trusting permissive legacy
-- policies that only verify that a parent row exists.
drop policy if exists vimob_active_membership_guard on public.automation_nodes;
create policy vimob_active_membership_guard
on public.automation_nodes
as restrictive
for all
to authenticated
using (
  exists (
    select 1
    from public.automations automation
    where automation.id = automation_nodes.automation_id
      and private.is_org_member(automation.organization_id)
  )
)
with check (
  exists (
    select 1
    from public.automations automation
    where automation.id = automation_nodes.automation_id
      and private.is_org_member(automation.organization_id)
  )
);

drop policy if exists vimob_active_membership_guard on public.automation_connections;
create policy vimob_active_membership_guard
on public.automation_connections
as restrictive
for all
to authenticated
using (
  exists (
    select 1
    from public.automations automation
    where automation.id = automation_connections.automation_id
      and private.is_org_member(automation.organization_id)
  )
)
with check (
  exists (
    select 1
    from public.automations automation
    where automation.id = automation_connections.automation_id
      and private.is_org_member(automation.organization_id)
  )
);

drop policy if exists vimob_active_membership_guard on public.meta_messages;
create policy vimob_active_membership_guard
on public.meta_messages
as restrictive
for all
to authenticated
using (
  exists (
    select 1
    from public.meta_conversations conversation
    where conversation.id = meta_messages.conversation_id
      and private.is_org_member(conversation.organization_id)
  )
)
with check (
  exists (
    select 1
    from public.meta_conversations conversation
    where conversation.id = meta_messages.conversation_id
      and private.is_org_member(conversation.organization_id)
  )
);
