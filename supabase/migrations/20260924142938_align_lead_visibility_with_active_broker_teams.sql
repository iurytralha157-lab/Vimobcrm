  -- Keep lead reads consistent with the current broker's active team memberships.
  -- The recorded team still grants its active leader access to an unassigned lead.
  -- This migration changes SELECT only. Existing mutation policies, grants, and
  -- can_access_lead helpers used by operational WhatsApp flows are untouched.
  -- It requires the backend-only lead mutation boundary installed by
  -- 20260908033712_lock_pipeline_and_lead_mutations_to_backend_gateway.sql.

  do $migration$
  begin
    if (
      select count(*)
      from pg_catalog.pg_policies
      where schemaname = 'public'
        and tablename = 'leads'
        and cmd in ('SELECT', 'ALL')
        and permissive = 'PERMISSIVE'
    ) <> 1 or not exists (
      select 1
      from pg_catalog.pg_policies
      where schemaname = 'public'
        and tablename = 'leads'
        and policyname = 'vimob_canonical_7f56115fb393f8ab9f4c78a7'
        and cmd = 'SELECT'
        and permissive = 'PERMISSIVE'
    ) then
      raise exception 'lead_read_policy_preflight_failed: expected the single canonical permissive SELECT policy';
    end if;

    if exists (
      select 1
      from unnest(array['anon', 'authenticated']) as client_role(role_name)
      cross join unnest(array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) as mutation(privilege_name)
      where has_table_privilege(client_role.role_name, 'public.leads', mutation.privilege_name)
    ) or exists (
      select 1
      from pg_catalog.pg_policies
      where schemaname = 'public'
        and tablename = 'leads'
        and cmd in ('ALL', 'INSERT', 'UPDATE', 'DELETE')
    ) then
      raise exception 'lead_read_policy_preflight_failed: backend-only lead mutation boundary from 20260908033712 is missing';
    end if;

    if not exists (
      select 1
      from pg_catalog.pg_policies
      where schemaname = 'public'
        and tablename = 'leads'
        and policyname = 'vimob_active_membership_guard'
        and cmd = 'SELECT'
        and permissive = 'RESTRICTIVE'
    ) then
      raise exception 'lead_read_policy_preflight_failed: expected the restrictive SELECT membership guard from 20260908033712';
    end if;

    if (
      select count(*)
      from pg_catalog.pg_policies
      where schemaname = 'public'
        and tablename = 'lead_attachments'
        and cmd in ('SELECT', 'ALL')
        and permissive = 'PERMISSIVE'
    ) <> 1 or not exists (
      select 1
      from pg_catalog.pg_policies
      where schemaname = 'public'
        and tablename = 'lead_attachments'
        and policyname = 'Users can view accessible lead attachments'
        and cmd = 'SELECT'
        and permissive = 'PERMISSIVE'
    ) then
      raise exception 'lead_attachment_read_policy_preflight_failed: expected the canonical SELECT policy';
    end if;
  end;
  $migration$;

  create or replace function private.can_read_lead(
    target_organization_id uuid,
    target_assigned_user_id uuid,
    target_team_id uuid
  )
  returns boolean
  language sql
  stable
  security definer
  set search_path = pg_catalog
  as $function$
    select private.is_super_admin()
      or (
        private.is_org_member(target_organization_id)
        and (
          private.has_org_role(target_organization_id, array['owner', 'admin', 'manager']::text[])
          or private.has_permission(target_organization_id, 'lead_view_all')
          or private.user_has_permission('lead_edit_all', (select auth.uid()))
          or private.user_has_permission('lead_transfer', (select auth.uid()))
          or private.user_has_permission('settings_teams', (select auth.uid()))
          or private.user_has_permission('settings_users', (select auth.uid()))
          or target_assigned_user_id = (select auth.uid())
          or exists (
            select 1
            from public.team_members as leader
            join public.teams as led_team
              on led_team.id = leader.team_id
             and led_team.organization_id = leader.organization_id
             and coalesce(led_team.is_active, true) = true
            where leader.organization_id = target_organization_id
              and leader.user_id = (select auth.uid())
              and coalesce(leader.is_active, false) = true
              and coalesce(leader.is_leader, false) = true
              and not exists (
                select 1
                from public.user_permission_overrides as denied_permission
                where denied_permission.organization_id = target_organization_id
                  and denied_permission.user_id = leader.user_id
                  and lower(btrim(denied_permission.permission_key)) = 'lead_view_team'
                  and denied_permission.allowed = false
              )
              and (
                -- An unassigned lead with a recorded team remains visible to
                -- that team's leader. This also preserves existing team reads.
                led_team.id = target_team_id
                or (
                  target_assigned_user_id is not null
                  and exists (
                    select 1
                    from public.team_members as broker_member
                    join public.users as broker
                      on broker.id = broker_member.user_id
                     and coalesce(broker.is_active, false) = true
                    join public.organization_members as broker_organization_member
                      on broker_organization_member.organization_id = broker_member.organization_id
                     and broker_organization_member.user_id = broker_member.user_id
                     and coalesce(broker_organization_member.is_active, false) = true
                     and broker_organization_member.deleted_at is null
                    where broker_member.organization_id = target_organization_id
                      and broker_member.team_id = led_team.id
                      and broker_member.user_id = target_assigned_user_id
                      and coalesce(broker_member.is_active, false) = true
                  )
                )
              )
          )
        )
      );
  $function$;

  revoke all on function private.can_read_lead(uuid, uuid, uuid)
    from public, anon;
  grant execute on function private.can_read_lead(uuid, uuid, uuid)
    to authenticated, service_role;

  -- The attachment SELECT policy has a lead_id rather than lead columns.
  create or replace function private.can_read_lead_by_id(p_lead_id uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path = pg_catalog
  as $function$
    select exists (
      select 1
      from public.leads as lead
      where lead.id = p_lead_id
        and private.can_read_lead(
          lead.organization_id,
          lead.assigned_user_id,
          lead.team_id
        )
    );
  $function$;

  revoke all on function private.can_read_lead_by_id(uuid)
    from public, anon;
  grant execute on function private.can_read_lead_by_id(uuid)
    to authenticated, service_role;

  drop policy "vimob_canonical_7f56115fb393f8ab9f4c78a7" on public.leads;
  create policy leads_select_active_broker_team
  on public.leads
  for select
  to authenticated
  using (
    private.can_read_lead(organization_id, assigned_user_id, team_id)
  );

  drop policy "Users can view accessible lead attachments" on public.lead_attachments;
  create policy "Users can view accessible lead attachments"
  on public.lead_attachments
  for select
  to authenticated
  using (private.can_read_lead_by_id(lead_id));
