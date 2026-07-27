begin;

set local lock_timeout = '2s';
set local statement_timeout = '30s';

-- The backend allows every active organization member to read financial data,
-- while writes require financial_manage (owner/admin included by the helper).
-- Replace the legacy tenant-wide FOR ALL policies with that same contract.
do $contracts$
begin
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'contracts'
      and policyname = 'contracts_isolation'
  ) then
    if (
      select count(*)
      from pg_policies
      where schemaname = 'public' and tablename = 'contracts'
        and policyname in (
          'Super admin access contracts',
          'contracts_isolation',
          'Admins can delete contracts',
          'Users can insert contracts',
          'Org members can view contracts',
          'brokers read own contracts',
          'Admins can update contracts'
        )
    ) <> 7 then
      raise exception 'Unexpected contracts policy state';
    end if;

    if not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = 'contracts'
        and policyname = 'contracts_isolation' and cmd = 'ALL'
        and 'authenticated' = any(roles)
        and qual = '(organization_id = get_user_organization_id())'
    ) then
      raise exception 'contracts_isolation changed since audit';
    end if;

    drop policy "Super admin access contracts" on public.contracts;
    drop policy "contracts_isolation" on public.contracts;
    drop policy "Admins can delete contracts" on public.contracts;
    drop policy "Users can insert contracts" on public.contracts;
    drop policy "Org members can view contracts" on public.contracts;
    drop policy "brokers read own contracts" on public.contracts;
    drop policy "Admins can update contracts" on public.contracts;

    create policy "financial contracts select"
    on public.contracts for select to authenticated
    using (private.is_org_member(organization_id));

    create policy "financial contracts insert"
    on public.contracts for insert to authenticated
    with check (private.has_permission(organization_id, 'financial_manage'));

    create policy "financial contracts update"
    on public.contracts for update to authenticated
    using (private.has_permission(organization_id, 'financial_manage'))
    with check (private.has_permission(organization_id, 'financial_manage'));

    create policy "financial contracts delete"
    on public.contracts for delete to authenticated
    using (private.has_permission(organization_id, 'financial_manage'));

    if exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = 'contracts'
        and policyname in (
          'Super admin access contracts', 'contracts_isolation',
          'Admins can delete contracts', 'Users can insert contracts',
          'Org members can view contracts', 'brokers read own contracts',
          'Admins can update contracts'
        )
    ) or (
      select count(*) from pg_policies
      where schemaname = 'public' and tablename = 'contracts'
        and policyname like 'financial contracts %'
    ) <> 4 then
      raise exception 'Canonical contracts policy set is incomplete';
    end if;
  end if;
end
$contracts$;

do $financial_entries$
begin
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'financial_entries'
      and policyname = 'financial_isolation'
  ) then
    if (
      select count(*)
      from pg_policies
      where schemaname = 'public' and tablename = 'financial_entries'
        and policyname in (
          'Super admin access financial_entries',
          'financial_isolation',
          'Admins can delete financial entries',
          'Admins can insert financial entries',
          'Org members can view financial entries',
          'Admins can update financial entries'
        )
    ) <> 6 then
      raise exception 'Unexpected financial_entries policy state';
    end if;

    if not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = 'financial_entries'
        and policyname = 'financial_isolation' and cmd = 'ALL'
        and 'authenticated' = any(roles)
        and qual = '(organization_id = get_user_organization_id())'
    ) then
      raise exception 'financial_isolation changed since audit';
    end if;

    drop policy "Super admin access financial_entries" on public.financial_entries;
    drop policy "financial_isolation" on public.financial_entries;
    drop policy "Admins can delete financial entries" on public.financial_entries;
    drop policy "Admins can insert financial entries" on public.financial_entries;
    drop policy "Org members can view financial entries" on public.financial_entries;
    drop policy "Admins can update financial entries" on public.financial_entries;

    create policy "financial entries select"
    on public.financial_entries for select to authenticated
    using (private.is_org_member(organization_id));

    create policy "financial entries insert"
    on public.financial_entries for insert to authenticated
    with check (private.has_permission(organization_id, 'financial_manage'));

    create policy "financial entries update"
    on public.financial_entries for update to authenticated
    using (private.has_permission(organization_id, 'financial_manage'))
    with check (private.has_permission(organization_id, 'financial_manage'));

    create policy "financial entries delete"
    on public.financial_entries for delete to authenticated
    using (private.has_permission(organization_id, 'financial_manage'));

    if exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = 'financial_entries'
        and policyname in (
          'Super admin access financial_entries', 'financial_isolation',
          'Admins can delete financial entries', 'Admins can insert financial entries',
          'Org members can view financial entries', 'Admins can update financial entries'
        )
    ) or (
      select count(*) from pg_policies
      where schemaname = 'public' and tablename = 'financial_entries'
        and policyname like 'financial entries %'
    ) <> 4 then
      raise exception 'Canonical financial entry policy set is incomplete';
    end if;
  end if;
end
$financial_entries$;

commit;
