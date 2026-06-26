begin;

-- Vimob CRM multi-organization hardening.
--
-- Goals:
-- 1. Keep tenant rows pinned to their original organization.
-- 2. Make SECURITY DEFINER helpers validate organization relationships before writing.
-- 3. Reduce broad Data API grants while preserving the grants the frontend needs.
-- 4. Keep the public invitation RPC intentionally callable, but remove inherited PUBLIC execute.

create or replace function private.prevent_organization_id_change()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.organization_id is distinct from old.organization_id then
    raise exception 'Nao e permitido alterar organization_id deste registro.';
  end if;

  return new;
end;
$$;

do $$
declare
  target_table record;
  target_trigger_name text;
begin
  for target_table in
    select distinct table_name
    from information_schema.columns
    where table_schema = 'public'
      and column_name = 'organization_id'
      and table_name not in (
        -- users.organization_id is a profile/default-context field, not a tenant-owned row.
        'users'
      )
    order by table_name
  loop
    target_trigger_name := left('zz_prevent_' || target_table.table_name || '_organization_id_change', 63);

    execute format(
      'drop trigger if exists %I on public.%I',
      target_trigger_name,
      target_table.table_name
    );

    execute format(
      'create trigger %I before update on public.%I for each row execute function private.prevent_organization_id_change()',
      target_trigger_name,
      target_table.table_name
    );
  end loop;
end $$;

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
set search_path = public, pg_temp
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
          and om.is_active = true
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

create or replace function private.property_shape_is_valid(
  target_organization_id uuid,
  target_responsible_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    target_organization_id is not null
    and (
      target_responsible_user_id is null
      or exists (
        select 1
        from public.organization_members om
        where om.organization_id = target_organization_id
          and om.user_id = target_responsible_user_id
          and om.is_active = true
      )
    );
$$;

create or replace function private.stage_shape_is_valid(
  target_organization_id uuid,
  target_pipeline_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    target_organization_id is not null
    and target_pipeline_id is not null
    and exists (
      select 1
      from public.pipelines p
      where p.id = target_pipeline_id
        and p.organization_id = target_organization_id
    );
$$;

create or replace function private.whatsapp_session_shape_is_valid(
  target_organization_id uuid,
  target_owner_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    target_organization_id is not null
    and (
      target_owner_user_id is null
      or exists (
        select 1
        from public.organization_members om
        where om.organization_id = target_organization_id
          and om.user_id = target_owner_user_id
          and om.is_active = true
      )
    );
$$;

create or replace function private.whatsapp_conversation_shape_is_valid(
  target_organization_id uuid,
  target_session_id uuid,
  target_lead_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    target_organization_id is not null
    and (
      target_session_id is null
      or exists (
        select 1
        from public.whatsapp_sessions ws
        where ws.id = target_session_id
          and ws.organization_id = target_organization_id
      )
    )
    and (
      target_lead_id is null
      or exists (
        select 1
        from public.leads l
        where l.id = target_lead_id
          and l.organization_id = target_organization_id
      )
    );
$$;

create or replace function private.can_access_lead(target_organization_id uuid, assigned_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select private.is_super_admin()
    or (
      private.is_org_member(target_organization_id)
      and (
        private.has_permission(target_organization_id, 'lead_view_all')
        or assigned_user_id = auth.uid()
        or exists (
          select 1
          from public.organization_members om
          where om.organization_id = target_organization_id
            and om.user_id = auth.uid()
            and om.is_active = true
            and om.role in ('owner', 'admin', 'manager')
        )
        or (
          assigned_user_id is not null
          and private.has_permission(target_organization_id, 'lead_view_team')
          and exists (
            select 1
            from public.team_members leader
            join public.team_members member
              on member.organization_id = leader.organization_id
             and member.team_id = leader.team_id
             and member.is_active = true
            where leader.organization_id = target_organization_id
              and leader.user_id = auth.uid()
              and leader.is_active = true
              and leader.is_leader = true
              and member.user_id = assigned_user_id
          )
        )
      )
    );
$$;

create or replace function private.can_manage_whatsapp_session(p_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.whatsapp_sessions ws
    where ws.id = p_session_id
      and (
        private.is_super_admin()
        or (
          private.is_org_member(ws.organization_id)
          and (
            ws.owner_user_id = auth.uid()
            or private.has_permission(ws.organization_id, 'whatsapp_manage')
            or private.has_permission(ws.organization_id, 'settings_manage')
            or private.has_org_role(ws.organization_id, array['owner', 'admin'])
          )
        )
      )
  );
$$;

create or replace function private.can_access_whatsapp_session(
  p_session_id uuid,
  p_require_send boolean default false
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.whatsapp_sessions ws
    where ws.id = p_session_id
      and ws.is_active is not false
      and (
        private.can_manage_whatsapp_session(ws.id)
        or exists (
          select 1
          from public.whatsapp_session_access access
          where access.session_id = ws.id
            and access.organization_id = ws.organization_id
            and access.user_id = auth.uid()
            and coalesce(access.can_view, access.can_read, true) = true
            and (p_require_send is false or coalesce(access.can_send, false) = true)
        )
      )
  );
$$;

alter policy "users can update permitted leads" on public.leads
using (
  private.lead_shape_is_valid(organization_id, assigned_user_id, pipeline_id, stage_id)
  and (
    private.has_permission(organization_id, 'lead_manage')
    or assigned_user_id = auth.uid()
    or private.has_org_role(organization_id, array['owner', 'admin', 'manager'])
  )
)
with check (
  private.lead_shape_is_valid(organization_id, assigned_user_id, pipeline_id, stage_id)
  and (
    private.has_permission(organization_id, 'lead_manage')
    or assigned_user_id = auth.uid()
    or private.has_org_role(organization_id, array['owner', 'admin', 'manager'])
  )
);

alter policy "property managers and responsible can update properties" on public.properties
using (
  private.property_shape_is_valid(organization_id, responsible_user_id)
  and (
    private.has_permission(organization_id, 'property_manage')
    or responsible_user_id = auth.uid()
  )
)
with check (
  private.property_shape_is_valid(organization_id, responsible_user_id)
  and (
    private.has_permission(organization_id, 'property_manage')
    or responsible_user_id = auth.uid()
  )
);

alter policy "admins manage stages" on public.stages
using (
  private.stage_shape_is_valid(organization_id, pipeline_id)
  and private.has_org_role(organization_id, array['owner', 'admin', 'manager'])
)
with check (
  private.stage_shape_is_valid(organization_id, pipeline_id)
  and private.has_org_role(organization_id, array['owner', 'admin', 'manager'])
);

alter policy "whatsapp sessions manage allowed" on public.whatsapp_sessions
using (
  private.can_manage_whatsapp_session(id)
)
with check (
  private.can_manage_whatsapp_session(id)
  and private.whatsapp_session_shape_is_valid(organization_id, owner_user_id)
);

alter policy "whatsapp conversations update allowed" on public.whatsapp_conversations
using (
  private.can_view_whatsapp_conversation(id)
)
with check (
  private.is_org_member(organization_id)
  and private.whatsapp_conversation_shape_is_valid(organization_id, session_id, lead_id)
);

create or replace function private.create_default_stages_for_pipeline_impl(
  p_org_id uuid,
  p_pipeline_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_org_id uuid;
begin
  select p.organization_id
    into target_org_id
  from public.pipelines p
  where p.id = p_pipeline_id;

  if target_org_id is null then
    raise exception 'Pipeline nao encontrada.';
  end if;

  if target_org_id <> p_org_id then
    raise exception 'Pipeline nao pertence a organizacao informada.';
  end if;

  if not private.has_org_role(target_org_id, array['owner', 'admin', 'manager']) then
    raise exception 'Sem permissao para criar etapas.';
  end if;

  insert into public.stages (organization_id, pipeline_id, name, stage_key, color, position)
  values
    (target_org_id, p_pipeline_id, 'Novo', 'new', '#FF4529', 0),
    (target_org_id, p_pipeline_id, 'Em atendimento', 'in_progress', '#f59e0b', 1),
    (target_org_id, p_pipeline_id, 'Visita agendada', 'scheduled_visit', '#3b82f6', 2),
    (target_org_id, p_pipeline_id, 'Fechamento', 'closing', '#10b981', 3)
  on conflict do nothing;
end;
$$;

create or replace function private.reorder_stages_impl(p_stages jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  stage_record record;
  target_org_id uuid;
  existing_stage record;
begin
  for stage_record in
    select *
    from jsonb_to_recordset(p_stages) as x(
      id uuid,
      pipeline_id uuid,
      name text,
      color text,
      position integer,
      stage_key text
    )
  loop
    select p.organization_id
      into target_org_id
    from public.pipelines p
    where p.id = stage_record.pipeline_id;

    if target_org_id is null then
      raise exception 'Pipeline nao encontrada.';
    end if;

    if not private.has_org_role(target_org_id, array['owner', 'admin', 'manager']) then
      raise exception 'Sem permissao para reordenar etapas.';
    end if;

    select s.organization_id, s.pipeline_id
      into existing_stage
    from public.stages s
    where s.id = stage_record.id;

    if existing_stage.organization_id is not null and (
      existing_stage.organization_id <> target_org_id
      or existing_stage.pipeline_id <> stage_record.pipeline_id
    ) then
      raise exception 'Etapa pertence a outra pipeline ou organizacao.';
    end if;

    insert into public.stages (id, organization_id, pipeline_id, name, color, position, stage_key)
    values (
      stage_record.id,
      target_org_id,
      stage_record.pipeline_id,
      stage_record.name,
      stage_record.color,
      coalesce(stage_record.position, 0),
      stage_record.stage_key
    )
    on conflict (id) do update set
      name = excluded.name,
      color = excluded.color,
      position = excluded.position,
      stage_key = excluded.stage_key,
      updated_at = now();
  end loop;
end;
$$;

-- Sensitive Data API grants. RLS remains the row-level boundary; grants now
-- remove unnecessary anon and non-DML privileges from sensitive tables.
revoke all on table public.leads from anon;
revoke truncate, references, trigger on table public.leads from authenticated;
grant select, insert, update, delete on table public.leads to authenticated;

revoke all on table public.properties from anon;
revoke truncate, references, trigger on table public.properties from authenticated;
grant select on table public.properties to anon;
grant select, insert, update, delete on table public.properties to authenticated;

revoke all on table public.whatsapp_sessions from anon;
revoke truncate, references, trigger on table public.whatsapp_sessions from authenticated;
grant select, insert, update, delete on table public.whatsapp_sessions to authenticated;

revoke all on table public.whatsapp_conversations from anon;
revoke truncate, references, trigger on table public.whatsapp_conversations from authenticated;
grant select, insert, update, delete on table public.whatsapp_conversations to authenticated;

revoke all on table public.whatsapp_messages from anon;
revoke truncate, references, trigger on table public.whatsapp_messages from authenticated;
grant select, insert, update, delete on table public.whatsapp_messages to authenticated;

revoke all on table public.events from anon;
revoke truncate, references, trigger on table public.events from authenticated;
grant select, insert, update, delete on table public.events to authenticated;

revoke all on table public.jobs from anon;
revoke truncate, references, trigger on table public.jobs from authenticated;
grant select, insert, update, delete on table public.jobs to authenticated;

revoke all on table public.outbox_messages from anon;
revoke truncate, references, trigger on table public.outbox_messages from authenticated;
grant select, insert, update, delete on table public.outbox_messages to authenticated;

revoke all on table public.organization_api_keys from anon;
revoke all on table public.organization_api_keys from authenticated;
grant select (
  id,
  organization_id,
  name,
  key_prefix,
  scopes,
  is_active,
  last_used_at,
  created_by,
  created_at,
  updated_at
) on table public.organization_api_keys to authenticated;
grant delete on table public.organization_api_keys to authenticated;

-- Public invitation lookup is intentionally callable by anon for invite acceptance,
-- but it should not be executable through inherited PUBLIC privileges.
revoke execute on function public.get_invitation_by_token(text) from public;
grant execute on function public.get_invitation_by_token(text) to anon, authenticated, service_role;

-- Internal/public RPC wrappers should not be callable by anon through PUBLIC.
revoke execute on function public.admin_dashboard_overview(integer) from public, anon;
grant execute on function public.admin_dashboard_overview(integer) to authenticated, service_role;

revoke execute on function public.admin_dashboard_timeseries(integer) from public, anon;
grant execute on function public.admin_dashboard_timeseries(integer) to authenticated, service_role;

revoke execute on function public.admin_dashboard_pending_boards() from public, anon;
grant execute on function public.admin_dashboard_pending_boards() to authenticated, service_role;

revoke execute on function public.admin_dashboard_feed(integer) from public, anon;
grant execute on function public.admin_dashboard_feed(integer) to authenticated, service_role;

revoke execute on function public.admin_list_organizations(text, text, text) from public, anon;
grant execute on function public.admin_list_organizations(text, text, text) to authenticated, service_role;

revoke execute on function public.list_all_organizations_admin() from public, anon;
grant execute on function public.list_all_organizations_admin() to authenticated, service_role;

revoke execute on function public.list_all_users_admin() from public, anon;
grant execute on function public.list_all_users_admin() to authenticated, service_role;

revoke execute on function public.generate_organization_api_key(text, uuid) from public, anon;
grant execute on function public.generate_organization_api_key(text, uuid) to authenticated, service_role;

revoke execute on function public.cleanup_orphan_members() from public, anon;
grant execute on function public.cleanup_orphan_members() to authenticated, service_role;

revoke execute on function public.find_orphan_team_members() from public, anon;
grant execute on function public.find_orphan_team_members() to authenticated, service_role;

revoke execute on function public.find_orphan_rr_members() from public, anon;
grant execute on function public.find_orphan_rr_members() to authenticated, service_role;

revoke execute on function public.create_default_stages_for_pipeline(uuid, uuid) from public, anon;
grant execute on function public.create_default_stages_for_pipeline(uuid, uuid) to authenticated, service_role;

revoke execute on function public.reorder_stages(jsonb) from public, anon;
grant execute on function public.reorder_stages(jsonb) to authenticated, service_role;

revoke execute on function public.move_lead_stage(uuid, uuid, boolean, timestamp with time zone) from public, anon;
grant execute on function public.move_lead_stage(uuid, uuid, boolean, timestamp with time zone) to authenticated, service_role;

revoke execute on function public.transfer_lead_assignee(uuid, uuid) from public, anon;
grant execute on function public.transfer_lead_assignee(uuid, uuid) to authenticated, service_role;

revoke execute on function public.register_lead_reentry(uuid, uuid, text, text, uuid, numeric, text, text, text, text, jsonb) from public, anon;
grant execute on function public.register_lead_reentry(uuid, uuid, text, text, uuid, numeric, text, text, text, text, jsonb) to authenticated, service_role;

revoke execute on function public.redistribute_lead_round_robin(uuid) from public, anon;
grant execute on function public.redistribute_lead_round_robin(uuid) to authenticated, service_role;

revoke execute on function public.handle_lead_intake(uuid) from public, anon;
grant execute on function public.handle_lead_intake(uuid) to authenticated, service_role;

revoke execute on function public.rebind_whatsapp_conversation_session(uuid, uuid, text) from public, anon;
grant execute on function public.rebind_whatsapp_conversation_session(uuid, uuid, text) to authenticated, service_role;

-- Private helper functions are used by policies/RPC wrappers. Authenticated users
-- keep explicit EXECUTE where policy evaluation needs it; anon gets none.
revoke execute on function private.prevent_organization_id_change() from public, anon, authenticated;
revoke execute on function private.set_lead_child_organization_id() from public, anon, authenticated;
revoke execute on function private.set_member_availability_organization_id() from public, anon, authenticated;

revoke execute on function private.is_super_admin() from public, anon;
revoke execute on function private.is_org_member(uuid) from public, anon;
revoke execute on function private.has_org_role(uuid, text[]) from public, anon;
revoke execute on function private.has_permission(uuid, text) from public, anon;
revoke execute on function private.can_access_lead(uuid, uuid) from public, anon;
revoke execute on function private.lead_shape_is_valid(uuid, uuid, uuid, uuid) from public, anon;
revoke execute on function private.property_shape_is_valid(uuid, uuid) from public, anon;
revoke execute on function private.stage_shape_is_valid(uuid, uuid) from public, anon;
revoke execute on function private.whatsapp_session_shape_is_valid(uuid, uuid) from public, anon;
revoke execute on function private.whatsapp_conversation_shape_is_valid(uuid, uuid, uuid) from public, anon;
revoke execute on function private.can_manage_whatsapp_session(uuid) from public, anon;
revoke execute on function private.can_access_whatsapp_session(uuid, boolean) from public, anon;
revoke execute on function private.can_view_whatsapp_conversation(uuid) from public, anon;
revoke execute on function private.can_send_whatsapp_conversation(uuid, uuid) from public, anon;

grant execute on function private.is_super_admin() to authenticated, service_role;
grant execute on function private.is_org_member(uuid) to authenticated, service_role;
grant execute on function private.has_org_role(uuid, text[]) to authenticated, service_role;
grant execute on function private.has_permission(uuid, text) to authenticated, service_role;
grant execute on function private.can_access_lead(uuid, uuid) to authenticated, service_role;
grant execute on function private.lead_shape_is_valid(uuid, uuid, uuid, uuid) to authenticated, service_role;
grant execute on function private.property_shape_is_valid(uuid, uuid) to authenticated, service_role;
grant execute on function private.stage_shape_is_valid(uuid, uuid) to authenticated, service_role;
grant execute on function private.whatsapp_session_shape_is_valid(uuid, uuid) to authenticated, service_role;
grant execute on function private.whatsapp_conversation_shape_is_valid(uuid, uuid, uuid) to authenticated, service_role;
grant execute on function private.can_manage_whatsapp_session(uuid) to authenticated, service_role;
grant execute on function private.can_access_whatsapp_session(uuid, boolean) to authenticated, service_role;
grant execute on function private.can_view_whatsapp_conversation(uuid) to authenticated, service_role;
grant execute on function private.can_send_whatsapp_conversation(uuid, uuid) to authenticated, service_role;

commit;
