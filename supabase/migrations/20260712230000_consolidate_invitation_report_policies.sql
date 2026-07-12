begin;

set local lock_timeout = '2s';
set local statement_timeout = '30s';

-- Replace overlapping FOR ALL policies with one policy per command while
-- preserving the exact OR of every legacy rule.
do $invitations$
declare
  actual_fingerprint text;
  manage_access text := '((organization_id = get_user_organization_id()) AND is_admin()) OR (is_super_admin() AND ((get_user_organization_id() IS NULL) OR (organization_id = get_user_organization_id())))';
begin
  if exists (
    select 1 from pg_policies where schemaname='public' and tablename='invitations'
      and policyname='Super admin access invitations'
  ) then
    select md5(string_agg(
      policyname || '|' || cmd || '|' || array_to_string(roles, ',') || '|' ||
      coalesce(qual,'') || '|' || coalesce(with_check,''), E'\n' order by policyname
    )) into actual_fingerprint
    from pg_policies where schemaname='public' and tablename='invitations';

    if actual_fingerprint <> 'e49e8f0cc8cea11e736ac7196ff938d8' then
      raise exception 'Unexpected invitations policy fingerprint: %', actual_fingerprint;
    end if;

    drop policy "Admins can manage invitations" on public.invitations;
    drop policy "Org members can view their invitations" on public.invitations;
    drop policy "Super admin access invitations" on public.invitations;

    create policy "invitations consolidated select"
    on public.invitations for select to public
    using (
      ((organization_id = get_user_organization_id()) and is_admin())
      or (is_super_admin() and (
        get_user_organization_id() is null
        or organization_id = get_user_organization_id()
      ))
      or organization_id = get_user_organization_id()
      or token = ((select current_setting('request.jwt.claims', true))::jsonb ->> 'invitation_token')
    );

    execute format('create policy %I on public.invitations for insert to public with check (%s)', 'invitations consolidated insert', manage_access);
    execute format('create policy %I on public.invitations for update to public using (%s) with check (%s)', 'invitations consolidated update', manage_access, manage_access);
    execute format('create policy %I on public.invitations for delete to public using (%s)', 'invitations consolidated delete', manage_access);

    if (select count(*) from pg_policies where schemaname='public' and tablename='invitations' and policyname like 'invitations consolidated %') <> 4 then
      raise exception 'Canonical invitations policy set is incomplete';
    end if;
  end if;
end
$invitations$;

do $prospecting_reports$
declare
  actual_fingerprint text;
  own_access text := '(( SELECT auth.uid() AS uid) = user_id)';
  admin_access text := '(is_super_admin() OR ((organization_id = get_user_organization_id()) AND is_admin()))';
begin
  if exists (
    select 1 from pg_policies where schemaname='public' and tablename='prospecting_reports'
      and policyname='Manage own reports'
  ) then
    select md5(string_agg(
      policyname || '|' || cmd || '|' || array_to_string(roles, ',') || '|' ||
      coalesce(qual,'') || '|' || coalesce(with_check,''), E'\n' order by policyname
    )) into actual_fingerprint
    from pg_policies where schemaname='public' and tablename='prospecting_reports';

    if actual_fingerprint <> 'a3b0598961afe620bb9ea09813f6364a' then
      raise exception 'Unexpected prospecting_reports policy fingerprint: %', actual_fingerprint;
    end if;

    drop policy "Admins can delete org prospecting reports" on public.prospecting_reports;
    drop policy "Admins can manage org prospecting reports" on public.prospecting_reports;
    drop policy "Manage own reports" on public.prospecting_reports;
    drop policy "Users can create own prospecting reports" on public.prospecting_reports;
    drop policy "Users can view own and org prospecting reports" on public.prospecting_reports;
    drop policy "View reports" on public.prospecting_reports;

    create policy "prospecting reports consolidated select"
    on public.prospecting_reports for select to public
    using (
      ((select auth.uid()) = user_id)
      or is_super_admin()
      or organization_id = get_user_organization_id()
      or true
    );

    create policy "prospecting reports consolidated insert"
    on public.prospecting_reports for insert to public
    with check (
      ((select auth.uid()) = user_id)
      or (
        user_id = (select auth.uid())
        and organization_id = get_user_organization_id()
      )
    );

    execute format(
      'create policy %I on public.prospecting_reports for update to public using ((%s) OR (%s)) with check ((%s) OR (%s))',
      'prospecting reports consolidated update', own_access, admin_access, own_access, admin_access
    );
    execute format(
      'create policy %I on public.prospecting_reports for delete to public using ((%s) OR (%s))',
      'prospecting reports consolidated delete', own_access, admin_access
    );

    if (select count(*) from pg_policies where schemaname='public' and tablename='prospecting_reports' and policyname like 'prospecting reports consolidated %') <> 4 then
      raise exception 'Canonical prospecting_reports policy set is incomplete';
    end if;
  end if;
end
$prospecting_reports$;

commit;
