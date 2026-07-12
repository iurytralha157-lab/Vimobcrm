begin;

set local lock_timeout = '2s';
set local statement_timeout = '30s';

-- The legacy "Acesso por organizacao" policies only checked that the parent
-- row existed. They therefore granted cross-organization access to every
-- valid child row. Keep member reads and admin writes, but scope both to the
-- parent organization's tenant.
do $purchase_order_items$
declare
  actual_fingerprint text;
  read_access text := 'EXISTS (SELECT 1 FROM public.construction_purchase_orders po WHERE po.id = purchase_order_id AND private.is_org_member(po.organization_id))';
  manage_access text := 'EXISTS (SELECT 1 FROM public.construction_purchase_orders po WHERE po.id = purchase_order_id AND private.has_org_role(po.organization_id, ARRAY[''owner'',''admin'']))';
begin
  if exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='construction_purchase_order_items'
      and policyname='Acesso por organização purchase_order_items'
  ) then
    select md5(string_agg(
      policyname || '|' || cmd || '|' || array_to_string(roles, ',') || '|' ||
      coalesce(qual,'') || '|' || coalesce(with_check,''), E'\n' order by policyname
    )) into actual_fingerprint
    from pg_policies
    where schemaname='public' and tablename='construction_purchase_order_items';

    if actual_fingerprint <> '418e85fb91da634ab134c37bd6763760' then
      raise exception 'Unexpected construction_purchase_order_items policy fingerprint: %', actual_fingerprint;
    end if;

    drop policy "Acesso por organização purchase_order_items" on public.construction_purchase_order_items;
    drop policy "Admins can manage construction purchase order items" on public.construction_purchase_order_items;
    drop policy "Users can view construction purchase order items" on public.construction_purchase_order_items;

    execute format('create policy %I on public.construction_purchase_order_items for select to authenticated using (%s)', 'construction purchase items tenant select', read_access);
    execute format('create policy %I on public.construction_purchase_order_items for insert to authenticated with check (%s)', 'construction purchase items tenant insert', manage_access);
    execute format('create policy %I on public.construction_purchase_order_items for update to authenticated using (%s) with check (%s)', 'construction purchase items tenant update', manage_access, manage_access);
    execute format('create policy %I on public.construction_purchase_order_items for delete to authenticated using (%s)', 'construction purchase items tenant delete', manage_access);

    if (select count(*) from pg_policies where schemaname='public' and tablename='construction_purchase_order_items' and policyname like 'construction purchase items tenant %') <> 4 then
      raise exception 'Canonical construction_purchase_order_items policy set is incomplete';
    end if;
  end if;
end
$purchase_order_items$;

do $team_members$
declare
  actual_fingerprint text;
  read_access text := 'EXISTS (SELECT 1 FROM public.construction_teams t WHERE t.id = team_id AND private.is_org_member(t.organization_id))';
  manage_access text := 'EXISTS (SELECT 1 FROM public.construction_teams t WHERE t.id = team_id AND private.has_org_role(t.organization_id, ARRAY[''owner'',''admin'']))';
begin
  if exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='construction_team_members'
      and policyname='Acesso por organização team_members'
  ) then
    select md5(string_agg(
      policyname || '|' || cmd || '|' || array_to_string(roles, ',') || '|' ||
      coalesce(qual,'') || '|' || coalesce(with_check,''), E'\n' order by policyname
    )) into actual_fingerprint
    from pg_policies
    where schemaname='public' and tablename='construction_team_members';

    if actual_fingerprint <> 'bdfc8e1affa09d99eae332a31c310ef7' then
      raise exception 'Unexpected construction_team_members policy fingerprint: %', actual_fingerprint;
    end if;

    drop policy "Acesso por organização team_members" on public.construction_team_members;
    drop policy "Admins can manage construction team members" on public.construction_team_members;
    drop policy "Users can view construction team members" on public.construction_team_members;

    execute format('create policy %I on public.construction_team_members for select to authenticated using (%s)', 'construction team members tenant select', read_access);
    execute format('create policy %I on public.construction_team_members for insert to authenticated with check (%s)', 'construction team members tenant insert', manage_access);
    execute format('create policy %I on public.construction_team_members for update to authenticated using (%s) with check (%s)', 'construction team members tenant update', manage_access, manage_access);
    execute format('create policy %I on public.construction_team_members for delete to authenticated using (%s)', 'construction team members tenant delete', manage_access);

    if (select count(*) from pg_policies where schemaname='public' and tablename='construction_team_members' and policyname like 'construction team members tenant %') <> 4 then
      raise exception 'Canonical construction_team_members policy set is incomplete';
    end if;
  end if;
end
$team_members$;

commit;
