begin;

set local lock_timeout = '2s';
set local statement_timeout = '30s';

-- These legacy tables use one super-admin FOR ALL policy plus one policy per
-- user action. Consolidate each action to the exact OR of the old policies.
do $commissions$
declare
  actual_fingerprint text;
  manage_access text := '((organization_id = get_user_organization_id()) AND is_admin()) OR (is_super_admin() AND ((get_user_organization_id() IS NULL) OR (organization_id = get_user_organization_id())))';
begin
  if exists (
    select 1 from pg_policies where schemaname='public' and tablename='commissions'
      and policyname='Super admin access commissions'
  ) then
    select md5(string_agg(
      policyname || '|' || cmd || '|' || array_to_string(roles, ',') || '|' ||
      coalesce(qual,'') || '|' || coalesce(with_check,''), E'\n' order by policyname
    )) into actual_fingerprint
    from pg_policies where schemaname='public' and tablename='commissions';

    if actual_fingerprint <> 'd67f97d697b3c908b68a6ef65dc15cb3' then
      raise exception 'Unexpected commissions policy fingerprint: %', actual_fingerprint;
    end if;

    drop policy "Super admin access commissions" on public.commissions;
    drop policy "Admins can delete commissions" on public.commissions;
    drop policy "Admins can insert commissions" on public.commissions;
    drop policy "Users can view own commissions" on public.commissions;
    drop policy "Admins can update commissions" on public.commissions;

    create policy "service commissions select"
    on public.commissions for select to authenticated
    using (
      user_id = (select auth.uid())
      or ((organization_id = get_user_organization_id()) and is_admin())
      or is_super_admin()
    );

    execute format('create policy %I on public.commissions for insert to authenticated with check (%s)', 'service commissions insert', manage_access);
    execute format('create policy %I on public.commissions for update to authenticated using (%s) with check (%s)', 'service commissions update', manage_access, manage_access);
    execute format('create policy %I on public.commissions for delete to authenticated using (%s)', 'service commissions delete', manage_access);

    if (select count(*) from pg_policies where schemaname='public' and tablename='commissions' and policyname like 'service commissions %') <> 4 then
      raise exception 'Canonical commissions policy set is incomplete';
    end if;
  end if;
end
$commissions$;

do $coverage_areas$
declare
  actual_fingerprint text;
  read_access text := '(organization_id = get_user_organization_id()) OR is_super_admin()';
  manage_access text := '((organization_id = get_user_organization_id()) AND is_admin()) OR is_super_admin()';
begin
  if exists (
    select 1 from pg_policies where schemaname='public' and tablename='coverage_areas'
      and policyname='Super admin full access coverage'
  ) then
    select md5(string_agg(
      policyname || '|' || cmd || '|' || array_to_string(roles, ',') || '|' ||
      coalesce(qual,'') || '|' || coalesce(with_check,''), E'\n' order by policyname
    )) into actual_fingerprint
    from pg_policies where schemaname='public' and tablename='coverage_areas';

    if actual_fingerprint <> '262e8e2fea1f86744882d0ef11beecdc' then
      raise exception 'Unexpected coverage_areas policy fingerprint: %', actual_fingerprint;
    end if;

    drop policy "Super admin full access coverage" on public.coverage_areas;
    drop policy "Admins can delete coverage" on public.coverage_areas;
    drop policy "Admins can insert coverage" on public.coverage_areas;
    drop policy "Users can view coverage from their org" on public.coverage_areas;
    drop policy "Admins can update coverage" on public.coverage_areas;

    execute format('create policy %I on public.coverage_areas for select to authenticated using (%s)', 'coverage areas consolidated select', read_access);
    execute format('create policy %I on public.coverage_areas for insert to authenticated with check (%s)', 'coverage areas consolidated insert', manage_access);
    execute format('create policy %I on public.coverage_areas for update to authenticated using (%s) with check (%s)', 'coverage areas consolidated update', manage_access, manage_access);
    execute format('create policy %I on public.coverage_areas for delete to authenticated using (%s)', 'coverage areas consolidated delete', manage_access);

    if (select count(*) from pg_policies where schemaname='public' and tablename='coverage_areas' and policyname like 'coverage areas consolidated %') <> 4 then
      raise exception 'Canonical coverage_areas policy set is incomplete';
    end if;
  end if;
end
$coverage_areas$;

do $service_plans$
declare
  actual_fingerprint text;
  read_access text := '(organization_id = get_user_organization_id()) OR is_super_admin()';
  manage_access text := '((organization_id = get_user_organization_id()) AND is_admin()) OR is_super_admin()';
begin
  if exists (
    select 1 from pg_policies where schemaname='public' and tablename='service_plans'
      and policyname='Super admin full access plans'
  ) then
    select md5(string_agg(
      policyname || '|' || cmd || '|' || array_to_string(roles, ',') || '|' ||
      coalesce(qual,'') || '|' || coalesce(with_check,''), E'\n' order by policyname
    )) into actual_fingerprint
    from pg_policies where schemaname='public' and tablename='service_plans';

    if actual_fingerprint <> '04be4e1dcdf8f797a0befb327bba8178' then
      raise exception 'Unexpected service_plans policy fingerprint: %', actual_fingerprint;
    end if;

    drop policy "Super admin full access plans" on public.service_plans;
    drop policy "Admins can delete plans" on public.service_plans;
    drop policy "Admins can insert plans" on public.service_plans;
    drop policy "Users can view plans from their org" on public.service_plans;
    drop policy "Admins can update plans" on public.service_plans;

    execute format('create policy %I on public.service_plans for select to authenticated using (%s)', 'service plans consolidated select', read_access);
    execute format('create policy %I on public.service_plans for insert to authenticated with check (%s)', 'service plans consolidated insert', manage_access);
    execute format('create policy %I on public.service_plans for update to authenticated using (%s) with check (%s)', 'service plans consolidated update', manage_access, manage_access);
    execute format('create policy %I on public.service_plans for delete to authenticated using (%s)', 'service plans consolidated delete', manage_access);

    if (select count(*) from pg_policies where schemaname='public' and tablename='service_plans' and policyname like 'service plans consolidated %') <> 4 then
      raise exception 'Canonical service_plans policy set is incomplete';
    end if;
  end if;
end
$service_plans$;

do $telecom_customers$
declare
  actual_fingerprint text;
  member_access text := '(organization_id = get_user_organization_id()) OR is_super_admin()';
  admin_access text := '((organization_id = get_user_organization_id()) AND is_admin()) OR is_super_admin()';
begin
  if exists (
    select 1 from pg_policies where schemaname='public' and tablename='telecom_customers'
      and policyname='Super admin full access customers'
  ) then
    select md5(string_agg(
      policyname || '|' || cmd || '|' || array_to_string(roles, ',') || '|' ||
      coalesce(qual,'') || '|' || coalesce(with_check,''), E'\n' order by policyname
    )) into actual_fingerprint
    from pg_policies where schemaname='public' and tablename='telecom_customers';

    if actual_fingerprint <> 'f81b7f6600f31e347d0fd734f65a967a' then
      raise exception 'Unexpected telecom_customers policy fingerprint: %', actual_fingerprint;
    end if;

    drop policy "Super admin full access customers" on public.telecom_customers;
    drop policy "Admins can delete customers" on public.telecom_customers;
    drop policy "Users can insert customers" on public.telecom_customers;
    drop policy "Users can view customers from their org" on public.telecom_customers;
    drop policy "Users can update customers from their org" on public.telecom_customers;

    execute format('create policy %I on public.telecom_customers for select to authenticated using (%s)', 'telecom customers consolidated select', member_access);
    execute format('create policy %I on public.telecom_customers for insert to authenticated with check (%s)', 'telecom customers consolidated insert', member_access);
    execute format('create policy %I on public.telecom_customers for update to authenticated using (%s) with check (%s)', 'telecom customers consolidated update', member_access, member_access);
    execute format('create policy %I on public.telecom_customers for delete to authenticated using (%s)', 'telecom customers consolidated delete', admin_access);

    if (select count(*) from pg_policies where schemaname='public' and tablename='telecom_customers' and policyname like 'telecom customers consolidated %') <> 4 then
      raise exception 'Canonical telecom_customers policy set is incomplete';
    end if;
  end if;
end
$telecom_customers$;

commit;
