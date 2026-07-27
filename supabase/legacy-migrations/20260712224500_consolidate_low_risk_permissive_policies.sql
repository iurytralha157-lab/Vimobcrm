begin;

set local lock_timeout = '2s';
set local statement_timeout = '30s';

-- Consolidate only legacy production policy sets whose effective OR behavior
-- can be preserved exactly. Fresh databases use the private-helper policy
-- lineage and intentionally skip these branches.
do $system_settings$
begin
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'system_settings'
      and policyname = 'Authenticated users can view system settings'
  ) then
    if not (
      exists (
        select 1 from pg_policies
        where schemaname = 'public' and tablename = 'system_settings'
          and policyname = 'Authenticated users can view system settings'
          and cmd = 'SELECT' and 'public' = any(roles)
          and qual = '(( SELECT auth.role() AS role) = ''authenticated''::text)'
      )
      and exists (
        select 1 from pg_policies
        where schemaname = 'public' and tablename = 'system_settings'
          and policyname = 'Public can view system settings'
          and cmd = 'SELECT' and 'anon' = any(roles) and qual = 'true'
      )
      and exists (
        select 1 from pg_policies
        where schemaname = 'public' and tablename = 'system_settings'
          and policyname = 'Super admins can view system settings'
          and cmd = 'SELECT' and qual = 'is_super_admin()'
      )
    ) then
      raise exception 'Unexpected system_settings policy state';
    end if;

    drop policy "Authenticated users can view system settings" on public.system_settings;
    drop policy "Public can view system settings" on public.system_settings;
    drop policy "Super admins can view system settings" on public.system_settings;

    create policy "system settings consolidated select"
    on public.system_settings for select to anon, authenticated
    using (true);
  end if;
end
$system_settings$;

do $cadence_templates$
declare
  write_access text := '((organization_id = get_user_organization_id()) AND is_admin()) OR (is_super_admin() AND ((get_user_organization_id() IS NULL) OR (organization_id = get_user_organization_id())))';
  read_access text := '(organization_id = get_user_organization_id()) OR (is_super_admin() AND ((get_user_organization_id() IS NULL) OR (organization_id = get_user_organization_id())))';
begin
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'cadence_templates'
      and policyname = 'Admins can manage cadence templates'
  ) then
    if not (
      exists (
        select 1 from pg_policies
        where schemaname = 'public' and tablename = 'cadence_templates'
          and policyname = 'Admins can manage cadence templates' and cmd = 'ALL'
          and qual = '((organization_id = get_user_organization_id()) AND is_admin())'
      )
      and exists (
        select 1 from pg_policies
        where schemaname = 'public' and tablename = 'cadence_templates'
          and policyname = 'Super admin access cadence_templates' and cmd = 'ALL'
          and qual = '(is_super_admin() AND ((get_user_organization_id() IS NULL) OR (organization_id = get_user_organization_id())))'
      )
      and exists (
        select 1 from pg_policies
        where schemaname = 'public' and tablename = 'cadence_templates'
          and policyname = 'Users can view cadence templates' and cmd = 'SELECT'
          and qual = '(organization_id = get_user_organization_id())'
      )
    ) then
      raise exception 'Unexpected cadence_templates policy state';
    end if;

    drop policy "Admins can manage cadence templates" on public.cadence_templates;
    drop policy "Super admin access cadence_templates" on public.cadence_templates;
    drop policy "Users can view cadence templates" on public.cadence_templates;

    execute format('create policy %I on public.cadence_templates for select to authenticated using (%s)', 'cadence templates consolidated select', read_access);
    execute format('create policy %I on public.cadence_templates for insert to authenticated with check (%s)', 'cadence templates consolidated insert', write_access);
    execute format('create policy %I on public.cadence_templates for update to authenticated using (%s) with check (%s)', 'cadence templates consolidated update', write_access, write_access);
    execute format('create policy %I on public.cadence_templates for delete to authenticated using (%s)', 'cadence templates consolidated delete', write_access);
  end if;
end
$cadence_templates$;

do $financial_categories$
declare
  write_access text := '((organization_id = get_user_organization_id()) AND is_admin()) OR (is_super_admin() AND ((get_user_organization_id() IS NULL) OR (organization_id = get_user_organization_id())))';
  read_access text := '(organization_id = get_user_organization_id()) OR (is_super_admin() AND ((get_user_organization_id() IS NULL) OR (organization_id = get_user_organization_id())))';
begin
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'financial_categories'
      and policyname = 'Admins can manage financial categories'
  ) then
    if not (
      exists (
        select 1 from pg_policies
        where schemaname = 'public' and tablename = 'financial_categories'
          and policyname = 'Admins can manage financial categories' and cmd = 'ALL'
          and qual = '((organization_id = get_user_organization_id()) AND is_admin())'
      )
      and exists (
        select 1 from pg_policies
        where schemaname = 'public' and tablename = 'financial_categories'
          and policyname = 'Super admin access financial_categories' and cmd = 'ALL'
          and qual = '(is_super_admin() AND ((get_user_organization_id() IS NULL) OR (organization_id = get_user_organization_id())))'
      )
      and exists (
        select 1 from pg_policies
        where schemaname = 'public' and tablename = 'financial_categories'
          and policyname = 'Users can view financial categories' and cmd = 'SELECT'
          and qual = '(organization_id = get_user_organization_id())'
      )
    ) then
      raise exception 'Unexpected financial_categories policy state';
    end if;

    drop policy "Admins can manage financial categories" on public.financial_categories;
    drop policy "Super admin access financial_categories" on public.financial_categories;
    drop policy "Users can view financial categories" on public.financial_categories;

    execute format('create policy %I on public.financial_categories for select to authenticated using (%s)', 'financial categories consolidated select', read_access);
    execute format('create policy %I on public.financial_categories for insert to authenticated with check (%s)', 'financial categories consolidated insert', write_access);
    execute format('create policy %I on public.financial_categories for update to authenticated using (%s) with check (%s)', 'financial categories consolidated update', write_access, write_access);
    execute format('create policy %I on public.financial_categories for delete to authenticated using (%s)', 'financial categories consolidated delete', write_access);
  end if;
end
$financial_categories$;

do $tags$
declare
  member_access text := '(organization_id = get_user_organization_id())';
  super_access text := '(is_super_admin() AND ((get_user_organization_id() IS NULL) OR (organization_id = get_user_organization_id())))';
  combined_access text := member_access || ' OR ' || super_access;
begin
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'tags'
      and policyname = 'Users can manage tags'
  ) then
    if not (
      exists (
        select 1 from pg_policies
        where schemaname = 'public' and tablename = 'tags'
          and policyname = 'Users can manage tags' and cmd = 'ALL'
          and qual = '(organization_id = get_user_organization_id())'
      )
      and exists (
        select 1 from pg_policies
        where schemaname = 'public' and tablename = 'tags'
          and policyname = 'Super admin access tags' and cmd = 'ALL'
          and qual = '(is_super_admin() AND ((get_user_organization_id() IS NULL) OR (organization_id = get_user_organization_id())))'
      )
      and exists (
        select 1 from pg_policies
        where schemaname = 'public' and tablename = 'tags'
          and policyname = 'Users can view org tags' and cmd = 'SELECT'
          and qual = '(organization_id = get_user_organization_id())'
      )
    ) then
      raise exception 'Unexpected tags policy state';
    end if;

    drop policy "Users can manage tags" on public.tags;
    drop policy "Super admin access tags" on public.tags;
    drop policy "Users can view org tags" on public.tags;

    execute format('create policy %I on public.tags for select to authenticated using (%s)', 'tags consolidated select', combined_access);
    execute format('create policy %I on public.tags for insert to authenticated with check (%s)', 'tags consolidated insert', combined_access);
    execute format('create policy %I on public.tags for update to authenticated using (%s) with check (%s)', 'tags consolidated update', combined_access, combined_access);
    execute format('create policy %I on public.tags for delete to authenticated using (%s)', 'tags consolidated delete', combined_access);
  end if;
end
$tags$;

do $organization_modules$
begin
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'organization_modules'
      and policyname = 'Super admin can manage modules'
  ) then
    if not (
      exists (
        select 1 from pg_policies
        where schemaname = 'public' and tablename = 'organization_modules'
          and policyname = 'Super admin can manage modules' and cmd = 'ALL'
          and qual = 'is_super_admin()'
      )
      and exists (
        select 1 from pg_policies
        where schemaname = 'public' and tablename = 'organization_modules'
          and policyname = 'Super admin access organization_modules' and cmd = 'ALL'
          and qual = '(is_super_admin() AND ((get_user_organization_id() IS NULL) OR (organization_id = get_user_organization_id())))'
      )
      and exists (
        select 1 from pg_policies
        where schemaname = 'public' and tablename = 'organization_modules'
          and policyname = 'Org members can view modules' and cmd = 'SELECT'
          and qual = '((organization_id = get_user_organization_id()) OR is_super_admin())'
      )
    ) then
      raise exception 'Unexpected organization_modules policy state';
    end if;

    drop policy "Super admin can manage modules" on public.organization_modules;
    drop policy "Super admin access organization_modules" on public.organization_modules;

    create policy "organization modules consolidated insert"
    on public.organization_modules for insert to authenticated
    with check (is_super_admin());

    create policy "organization modules consolidated update"
    on public.organization_modules for update to authenticated
    using (is_super_admin()) with check (is_super_admin());

    create policy "organization modules consolidated delete"
    on public.organization_modules for delete to authenticated
    using (is_super_admin());
  end if;
end
$organization_modules$;

do $verify$
begin
  if exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and policyname in (
        'Authenticated users can view system settings',
        'Public can view system settings',
        'Super admins can view system settings',
        'Admins can manage cadence templates',
        'Super admin access cadence_templates',
        'Users can view cadence templates',
        'Admins can manage financial categories',
        'Super admin access financial_categories',
        'Users can view financial categories',
        'Users can manage tags',
        'Super admin access tags',
        'Users can view org tags',
        'Super admin can manage modules',
        'Super admin access organization_modules'
      )
  ) then
    raise exception 'Legacy permissive policy consolidation did not complete';
  end if;
end
$verify$;

commit;
