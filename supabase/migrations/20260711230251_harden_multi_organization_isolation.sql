begin;

create or replace function private.safe_uuid(value text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
begin
  if value is null or value !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return null;
  end if;

  return value::uuid;
exception when others then
  return null;
end;
$$;

create or replace function private.lead_shape_is_valid(
  target_organization_id uuid,
  target_assigned_user_id uuid,
  target_pipeline_id uuid,
  target_stage_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    target_organization_id is not null
    and (
      target_assigned_user_id is null
      or exists (
        select 1
        from public.organization_members om
        where om.organization_id = target_organization_id
          and om.user_id = target_assigned_user_id
          and coalesce(om.is_active, false) = true
      )
    )
    and (
      target_pipeline_id is null
      or exists (
        select 1
        from public.pipelines p
        where p.id = target_pipeline_id
          and p.organization_id = target_organization_id
      )
    )
    and (
      target_stage_id is null
      or exists (
        select 1
        from public.stages s
        where s.id = target_stage_id
          and s.organization_id = target_organization_id
          and (
            target_pipeline_id is null
            or s.pipeline_id = target_pipeline_id
          )
      )
    );
$$;

-- Global roles are platform-only. Organization roles live in organization_members.
update public.users
set role = 'user',
    updated_at = now()
where role is distinct from 'super_admin'
  and role is distinct from 'user';

create index if not exists idx_organization_members_active_user_org
  on public.organization_members(user_id, organization_id)
  where is_active = true;

create or replace function private.is_org_member(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_super_admin()
    or (
      target_organization_id is not null
      and exists (
        select 1
        from public.organization_members om
        join public.users u on u.id = om.user_id
        join public.organizations o on o.id = om.organization_id
        where om.user_id = (select auth.uid())
          and om.organization_id = target_organization_id
          and coalesce(om.is_active, false) = true
          and coalesce(u.is_active, false) = true
          and coalesce(o.is_active, true) = true
      )
    );
$$;

create or replace function private.has_org_role(
  target_organization_id uuid,
  allowed_roles text[]
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_super_admin()
    or (
      private.is_org_member(target_organization_id)
      and exists (
        select 1
        from public.organization_members om
        where om.user_id = (select auth.uid())
          and om.organization_id = target_organization_id
          and coalesce(om.is_active, false) = true
          and om.role = any(allowed_roles)
      )
    );
$$;

create or replace function private.has_permission(
  target_organization_id uuid,
  permission_key text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_super_admin()
    or (
      private.is_org_member(target_organization_id)
      and (
        exists (
          select 1
          from public.organization_members om
          where om.user_id = (select auth.uid())
            and om.organization_id = target_organization_id
            and coalesce(om.is_active, false) = true
            and om.role in ('owner', 'admin')
        )
        or exists (
          select 1
          from public.user_organization_roles uor
          join public.organization_roles role
            on role.id = uor.role_id
           and role.organization_id = uor.organization_id
          join public.organization_role_permissions orp
            on orp.role_id = uor.role_id
           and orp.organization_id = uor.organization_id
          join public.available_permissions permission
            on permission.id = orp.permission_id
          where uor.user_id = (select auth.uid())
            and uor.organization_id = target_organization_id
            and coalesce(uor.is_active, false) = true
            and coalesce(role.is_active, false) = true
            and permission.key = $2
        )
      )
    );
$$;

create or replace function private.can_access_lead(
  target_organization_id uuid,
  assigned_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_super_admin()
    or (
      private.is_org_member(target_organization_id)
      and (
        private.has_permission(target_organization_id, 'lead_view_all')
        or assigned_user_id = (select auth.uid())
        or private.has_org_role(target_organization_id, array['owner', 'admin', 'manager'])
        or (
          assigned_user_id is not null
          and private.has_permission(target_organization_id, 'lead_view_team')
          and exists (
            select 1
            from public.team_members leader
            join public.team_members member
              on member.organization_id = leader.organization_id
             and member.team_id = leader.team_id
             and coalesce(member.is_active, false) = true
            where leader.organization_id = target_organization_id
              and leader.user_id = (select auth.uid())
              and coalesce(leader.is_active, false) = true
              and coalesce(leader.is_leader, false) = true
              and member.user_id = assigned_user_id
          )
        )
      )
    );
$$;

revoke execute on function private.is_org_member(uuid) from public, anon;
revoke execute on function private.has_org_role(uuid, text[]) from public, anon;
revoke execute on function private.has_permission(uuid, text) from public, anon;
revoke execute on function private.can_access_lead(uuid, uuid) from public, anon;
revoke execute on function private.safe_uuid(text) from public, anon;
revoke execute on function private.lead_shape_is_valid(uuid, uuid, uuid, uuid) from public, anon;
grant execute on function private.is_org_member(uuid) to authenticated, service_role;
grant execute on function private.has_org_role(uuid, text[]) to authenticated, service_role;
grant execute on function private.has_permission(uuid, text) to authenticated, service_role;
grant execute on function private.can_access_lead(uuid, uuid) to authenticated, service_role;
grant execute on function private.safe_uuid(text) to authenticated, service_role;
grant execute on function private.lead_shape_is_valid(uuid, uuid, uuid, uuid) to authenticated, service_role;

drop policy if exists "users can read permitted leads" on public.leads;
create policy "users can read permitted leads"
on public.leads for select to authenticated
using (private.can_access_lead(organization_id, assigned_user_id));

drop policy if exists "members can create leads" on public.leads;
create policy "members can create leads"
on public.leads for insert to authenticated
with check (
  private.is_org_member(organization_id)
  and private.lead_shape_is_valid(organization_id, assigned_user_id, pipeline_id, stage_id)
);

drop policy if exists "users can update permitted leads" on public.leads;
create policy "users can update permitted leads"
on public.leads for update to authenticated
using (
  private.is_org_member(organization_id)
  and private.lead_shape_is_valid(organization_id, assigned_user_id, pipeline_id, stage_id)
  and (
    private.has_permission(organization_id, 'lead_manage')
    or assigned_user_id = (select auth.uid())
    or private.has_org_role(organization_id, array['owner', 'admin', 'manager'])
  )
)
with check (
  private.is_org_member(organization_id)
  and private.lead_shape_is_valid(organization_id, assigned_user_id, pipeline_id, stage_id)
  and (
    private.has_permission(organization_id, 'lead_manage')
    or assigned_user_id = (select auth.uid())
    or private.has_org_role(organization_id, array['owner', 'admin', 'manager'])
  )
);

drop policy if exists "brokers read own contracts" on public.contracts;
create policy "brokers read own contracts"
on public.contracts for select to authenticated
using (
  private.is_org_member(organization_id)
  and exists (
    select 1
    from public.contract_brokers cb
    where cb.contract_id = contracts.id
      and cb.user_id = (select auth.uid())
  )
);

drop policy if exists "users read own notifications" on public.notifications;
create policy "users read own notifications"
on public.notifications for select to authenticated
using (
  private.is_org_member(organization_id)
  and (
    user_id = (select auth.uid())
    or private.has_org_role(organization_id, array['owner', 'admin'])
  )
);

drop policy if exists "users update own notifications" on public.notifications;
create policy "users update own notifications"
on public.notifications for update to authenticated
using (
  user_id = (select auth.uid())
  and private.is_org_member(organization_id)
)
with check (
  user_id = (select auth.uid())
  and private.is_org_member(organization_id)
);

drop policy if exists "system members can create notifications" on public.notifications;
create policy "system members can create notifications"
on public.notifications for insert to authenticated
with check (
  private.is_org_member(organization_id)
  and (
    user_id = (select auth.uid())
    or private.has_org_role(organization_id, array['owner', 'admin'])
  )
);

drop policy if exists "users manage own push tokens" on public.push_tokens;
create policy "users manage own push tokens"
on public.push_tokens for all to authenticated
using (
  user_id = (select auth.uid())
  and private.is_org_member(organization_id)
)
with check (
  user_id = (select auth.uid())
  and private.is_org_member(organization_id)
);

drop policy if exists "users can read own legal consents" on public.legal_consents;
create policy "users can read own legal consents"
on public.legal_consents for select to authenticated
using (
  user_id = (select auth.uid())
  and private.is_org_member(organization_id)
);

drop policy if exists "users can insert own legal consents" on public.legal_consents;
create policy "users can insert own legal consents"
on public.legal_consents for insert to authenticated
with check (
  user_id = (select auth.uid())
  and private.is_org_member(organization_id)
);

-- Audit events are accepted only through the authenticated backend.
drop policy if exists "users can create own audit logs" on public.audit_logs;
revoke insert on public.audit_logs from authenticated;
revoke update (organization_id) on public.users from authenticated;

drop policy if exists "org admins manage site images" on storage.objects;
create policy "org admins manage site images"
on storage.objects for all to authenticated
using (
  bucket_id = 'site-images'
  and split_part(name, '/', 1) = 'organizations'
  and (
    private.has_org_role(private.safe_uuid(split_part(name, '/', 2)), array['owner', 'admin'])
    or private.has_permission(private.safe_uuid(split_part(name, '/', 2)), 'settings_manage')
  )
)
with check (
  bucket_id = 'site-images'
  and split_part(name, '/', 1) = 'organizations'
  and (
    private.has_org_role(private.safe_uuid(split_part(name, '/', 2)), array['owner', 'admin'])
    or private.has_permission(private.safe_uuid(split_part(name, '/', 2)), 'settings_manage')
  )
);

drop policy if exists "org admins manage logo assets" on storage.objects;
create policy "org admins manage logo assets"
on storage.objects for all to authenticated
using (
  bucket_id = 'logos'
  and split_part(name, '/', 1) = 'organizations'
  and (
    private.has_org_role(private.safe_uuid(split_part(name, '/', 2)), array['owner', 'admin'])
    or private.has_permission(private.safe_uuid(split_part(name, '/', 2)), 'settings_manage')
  )
)
with check (
  bucket_id = 'logos'
  and split_part(name, '/', 1) = 'organizations'
  and (
    private.has_org_role(private.safe_uuid(split_part(name, '/', 2)), array['owner', 'admin'])
    or private.has_permission(private.safe_uuid(split_part(name, '/', 2)), 'settings_manage')
  )
);

create or replace function private.enforce_tenant_reference()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  reference_id uuid;
  reference_organization_id uuid;
begin
  if tg_op = 'UPDATE'
     and new.organization_id is not distinct from old.organization_id
     and (to_jsonb(new) ->> tg_argv[1]) is not distinct from (to_jsonb(old) ->> tg_argv[1]) then
    return new;
  end if;

  reference_id := nullif(to_jsonb(new) ->> tg_argv[1], '')::uuid;
  if reference_id is null then
    return new;
  end if;

  execute format(
    'select organization_id from public.%I where id = $1',
    tg_argv[0]
  )
  into reference_organization_id
  using reference_id;

  if reference_organization_id is not null
     and new.organization_id is distinct from reference_organization_id then
    raise exception using
      errcode = '23514',
      message = format(
        'Referencia %s.%s pertence a outra organizacao.',
        tg_argv[0],
        tg_argv[1]
      );
  end if;

  return new;
end;
$$;

create or replace function private.enforce_active_org_member_reference()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  referenced_user_id uuid;
begin
  if tg_op = 'UPDATE'
     and new.organization_id is not distinct from old.organization_id
     and (to_jsonb(new) ->> tg_argv[0]) is not distinct from (to_jsonb(old) ->> tg_argv[0]) then
    return new;
  end if;

  referenced_user_id := nullif(to_jsonb(new) ->> tg_argv[0], '')::uuid;
  if referenced_user_id is null then
    return new;
  end if;

  if not exists (
    select 1
    from public.organization_members om
    join public.users u on u.id = om.user_id
    where om.organization_id = new.organization_id
      and om.user_id = referenced_user_id
      and coalesce(om.is_active, false) = true
      and coalesce(u.is_active, false) = true
  ) then
    raise exception using
      errcode = '23514',
      message = format(
        'Usuario de %s nao e membro ativo da organizacao.',
        tg_argv[0]
      );
  end if;

  return new;
end;
$$;

do $$
declare
  reference record;
  trigger_name text;
begin
  for reference in
    select *
    from (values
      ('stages', 'pipelines', 'pipeline_id'),
      ('leads', 'pipelines', 'pipeline_id'),
      ('leads', 'stages', 'stage_id'),
      ('leads', 'properties', 'property_id'),
      ('leads', 'properties', 'interest_property_id'),
      ('team_members', 'teams', 'team_id'),
      ('team_pipelines', 'teams', 'team_id'),
      ('team_pipelines', 'pipelines', 'pipeline_id'),
      ('whatsapp_conversations', 'whatsapp_sessions', 'session_id'),
      ('whatsapp_conversations', 'leads', 'lead_id'),
      ('whatsapp_messages', 'whatsapp_conversations', 'conversation_id'),
      ('whatsapp_messages', 'whatsapp_sessions', 'session_id'),
      ('whatsapp_messages', 'leads', 'lead_id'),
      ('webhooks_integrations', 'pipelines', 'target_pipeline_id'),
      ('webhooks_integrations', 'stages', 'target_stage_id'),
      ('webhooks_integrations', 'teams', 'target_team_id'),
      ('webhooks_integrations', 'properties', 'target_property_id'),
      ('contracts', 'properties', 'property_id'),
      ('contracts', 'leads', 'lead_id')
    ) as refs(child_table, parent_table, child_column)
  loop
    if to_regclass(format('public.%I', reference.child_table)) is null
       or to_regclass(format('public.%I', reference.parent_table)) is null
       or not exists (
         select 1
         from information_schema.columns c
         where c.table_schema = 'public'
           and c.table_name = reference.child_table
           and c.column_name = reference.child_column
       ) then
      continue;
    end if;

    trigger_name := left(
      'zz_tenant_ref_' || reference.child_table || '_' || reference.child_column,
      63
    );
    execute format('drop trigger if exists %I on public.%I', trigger_name, reference.child_table);
    execute format(
      'create trigger %I before insert or update on public.%I for each row execute function private.enforce_tenant_reference(%L, %L)',
      trigger_name,
      reference.child_table,
      reference.parent_table,
      reference.child_column
    );
  end loop;
end $$;

do $$
declare
  reference record;
  trigger_name text;
begin
  for reference in
    select *
    from (values
      ('leads', 'assigned_user_id'),
      ('team_members', 'user_id'),
      ('whatsapp_sessions', 'owner_user_id'),
      ('whatsapp_conversations', 'assigned_user_id')
    ) as refs(child_table, child_column)
  loop
    if to_regclass(format('public.%I', reference.child_table)) is null
       or not exists (
         select 1
         from information_schema.columns c
         where c.table_schema = 'public'
           and c.table_name = reference.child_table
           and c.column_name = reference.child_column
       ) then
      continue;
    end if;

    trigger_name := left(
      'zz_org_member_ref_' || reference.child_table || '_' || reference.child_column,
      63
    );
    execute format('drop trigger if exists %I on public.%I', trigger_name, reference.child_table);
    execute format(
      'create trigger %I before insert or update on public.%I for each row execute function private.enforce_active_org_member_reference(%L)',
      trigger_name,
      reference.child_table,
      reference.child_column
    );
  end loop;
end $$;

revoke execute on function private.enforce_tenant_reference() from public, anon, authenticated;
revoke execute on function private.enforce_active_org_member_reference() from public, anon, authenticated;

-- New objects must opt into Data API access explicitly.
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated;

commit;
