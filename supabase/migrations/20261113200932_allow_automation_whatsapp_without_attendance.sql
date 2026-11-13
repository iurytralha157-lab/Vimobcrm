begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- The published flow author is the session authority. An owner can automate
-- sends for unassigned leads; an existing delegated grant keeps its scope.
create function private.automation_whatsapp_session_can_send(
  p_organization_id uuid, p_session_id uuid, p_lead_id uuid, p_publisher_id uuid
)
returns boolean
language sql stable security definer
set search_path = 'pg_catalog'
as $function$
  select exists (
    select 1
    from public.whatsapp_sessions as session
    join public.leads as lead
      on lead.id = p_lead_id and lead.organization_id = session.organization_id
    join public.users as publisher
      on publisher.id = p_publisher_id and publisher.organization_id = session.organization_id
     and publisher.is_active
    join public.organization_members as member
      on member.user_id = publisher.id and member.organization_id = session.organization_id
     and member.is_active and member.deleted_at is null
    where session.id = p_session_id and session.organization_id = p_organization_id
      and session.provider = 'evolution_go' and session.status = 'connected' and coalesce(session.is_active, true)
      and (
        (session.owner_user_id = publisher.id and (
          lead.assigned_user_id is null
          or private.whatsapp_actor_can_read_lead(p_organization_id, p_lead_id, p_publisher_id)
        ))
        or (
          lead.assigned_user_id = publisher.id
          and private.whatsapp_actor_can_read_lead(p_organization_id, p_lead_id, p_publisher_id)
          and exists (
            select 1
            from public.whatsapp_session_access as access
            join public.users as owner_user
              on owner_user.id = session.owner_user_id
             and owner_user.organization_id = access.organization_id and owner_user.is_active
            join public.organization_members as owner_member
              on owner_member.user_id = owner_user.id and owner_member.organization_id = access.organization_id
             and owner_member.is_active and owner_member.deleted_at is null
            where access.organization_id = session.organization_id and access.session_id = session.id
              and access.user_id = publisher.id and access.granted_by = session.owner_user_id
              and access.access_mode = 'assigned_leads_only' and access.only_leads_access
              and access.can_view and access.can_read and access.can_send
              and access.grant_scope = 'organization' and access.grant_team_id is null
              and lower(btrim(owner_member.role)) in ('owner', 'admin')
          )
        )
      )
  )
$function$;

alter function private.automation_whatsapp_session_can_send(uuid, uuid, uuid, uuid) owner to postgres;
revoke all on function private.automation_whatsapp_session_can_send(uuid, uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function private.automation_whatsapp_session_can_send(uuid, uuid, uuid, uuid) to service_role;

-- Deny unauthorized connections before the resolver can create or bind a
-- conversation. Enqueue rechecks both the immutable node and send authority.
do $resolve$
declare
  v_oid regprocedure := 'public.resolve_automation_whatsapp_conversation(uuid,uuid,text,text,uuid)'::regprocedure;
  v_definition text := pg_catalog.pg_get_functiondef(v_oid);
  v_anchor text := 'v_phone_digits[[:space:]]*:=[[:space:]]*pg_catalog[.]regexp_replace';
  v_guard text := $guard$
  if not exists (
    select 1 from public.automation_flow_versions as flow
    where flow.id = v_initial_execution.flow_version_id
      and flow.organization_id = p_organization_id
      and flow.automation_id = v_initial_execution.automation_id
      and exists (
        select 1 from pg_catalog.jsonb_array_elements(
          case when pg_catalog.jsonb_typeof(flow.graph->'nodes') = 'array'
            then flow.graph->'nodes' else '[]'::jsonb end
        ) as node(value)
        where node.value->>'id' = p_node_key and node.value->>'type' = 'action'
          and node.value->>'action_type' in ('send_whatsapp', 'send_image', 'send_audio', 'send_video')
          and pg_catalog.lower(node.value #>> '{config,session_id}') = p_session_id::text
      )
      and private.automation_whatsapp_session_can_send(
        p_organization_id, p_session_id, v_target_lead_id, flow.created_by
      )
  ) then
    raise exception using errcode = '23514', message = 'automation_whatsapp_session_access_denied';
  end if;

  v_phone_digits := pg_catalog.regexp_replace$guard$;
begin
  if coalesce(pg_catalog.obj_description(v_oid, 'pg_proc'), '') not like 'automation_whatsapp_binding_fence_v2:%'
    or (select count(*) from pg_catalog.regexp_matches(v_definition, v_anchor, 'g')) <> 1 then
    raise exception using errcode = '55000', message = 'automation_whatsapp_unattended_resolver_drift';
  end if;
  execute pg_catalog.regexp_replace(v_definition, v_anchor, v_guard);
end;
$resolve$;

-- Keep the existing signature and locks. Deploy the worker that recognizes
-- tenant_session_v1 before allowing the RPC to write that evidence.
do $patch$
declare
  v_oid regprocedure :=
    'public.enqueue_automation_whatsapp_outbox(uuid,uuid,text,text,text,uuid,uuid,text,text,text,text,text,bigint,text)'::regprocedure;
  v_definition text := pg_catalog.pg_get_functiondef(v_oid);
  v_old text;
  v_new text;
begin
  if not exists (
    select 1 from pg_catalog.pg_proc
    where oid = v_oid and not prosecdef and proconfig = array['search_path=pg_catalog']::text[]
  ) or coalesce(pg_catalog.obj_description(v_oid, 'pg_proc'), '') not like 'automation_whatsapp_binding_fence_v2:%'
    or strpos(v_definition, 'private.lock_automation_whatsapp_binding') = 0
    or strpos(v_definition, 'outbound_media_sha256') = 0 then
    raise exception using errcode = '55000', message = 'automation_whatsapp_unattended_patch_drift';
  end if;

  v_old := $old$actor_user_id[[:space:]]+uuid;[[:space:]]*attendance_entry_id[[:space:]]+uuid;$old$;
  if (select count(*) from pg_catalog.regexp_matches(v_definition, v_old, 'g')) <> 1 then
    raise exception using errcode = '55000', message = 'automation_whatsapp_unattended_variable_drift';
  end if;
  v_definition := pg_catalog.regexp_replace(v_definition, v_old, 'actor_user_id uuid;');

  v_old := $old$if not exists \([[:space:]]*select 1[[:space:]]+from public[.]whatsapp_attendance_entries as attendance[^;]*message = 'automation_whatsapp_attendance_required';[[:space:]]*end if;$old$;
  if (select count(*) from pg_catalog.regexp_matches(v_definition, v_old, 'g')) <> 1 then
    raise exception using errcode = '55000', message = 'automation_whatsapp_unattended_binding_check_drift';
  end if;
  v_definition := pg_catalog.regexp_replace(v_definition, v_old, '');

  v_old := $old$attendance_entry_id[[:space:]]*:=[[:space:]]*private[.]automation_whatsapp_outbox_attendance\([^;]*;[[:space:]]*if attendance_entry_id is null then[[:space:]]*raise exception using errcode = '23514', message = 'automation_whatsapp_attendance_required';[[:space:]]*end if;$old$;
  v_new := $new$
  if not private.automation_whatsapp_session_can_send(
    p_organization_id, p_session_id, target_lead_id, actor_user_id
  ) then
    raise exception using errcode = '23514', message = 'automation_whatsapp_session_access_denied';
  end if;
$new$;
  if (select count(*) from pg_catalog.regexp_matches(v_definition, v_old, 'g')) <> 1 then
    raise exception using errcode = '55000', message = 'automation_whatsapp_unattended_publisher_check_drift';
  end if;
  v_definition := pg_catalog.regexp_replace(v_definition, v_old, v_new);

  v_old := $old$and graph_node[.]value->>'action_type' = expected_effect_type$old$;
  v_new := $new$and graph_node.value->>'action_type' = expected_effect_type
      and lower(graph_node.value #>> '{config,session_id}') = p_session_id::text$new$;
  if (select count(*) from pg_catalog.regexp_matches(v_definition, v_old, 'g')) <> 1 then
    raise exception using errcode = '55000', message = 'automation_whatsapp_unattended_graph_drift';
  end if;
  v_definition := pg_catalog.regexp_replace(v_definition, v_old, v_new);

  v_old := $old$'attendance_entry_id', attendance_entry_id,$old$;
  v_new := $new$
      'automation_delivery_policy', 'tenant_session_v1',
      'automation_binding_id', locked_binding.id,
      'automation_flow_version_id', locked_flow.id,
$new$;
  if (select count(*) from pg_catalog.regexp_matches(v_definition, v_old, 'g')) <> 1 then
    raise exception using errcode = '55000', message = 'automation_whatsapp_unattended_metadata_drift';
  end if;
  v_definition := pg_catalog.regexp_replace(v_definition, v_old, v_new);

  -- Old rows can still return the same committed result, without rewriting
  -- their proof or authorizing a fresh provider attempt. New rows must match
  -- the exact binding and version and cannot masquerade as legacy rows.
  v_old := $old$or existing_message[.]metadata->>'attendance_entry_id' is distinct from attendance_entry_id::text$old$;
  v_new := $new$
       or (case when existing_message.metadata ?| array[
         'automation_delivery_policy', 'automation_binding_id', 'automation_flow_version_id'
       ] then (
         existing_message.metadata->>'automation_delivery_policy' is distinct from 'tenant_session_v1'
         or existing_message.metadata->>'automation_binding_id' is distinct from locked_binding.id::text
         or existing_message.metadata->>'automation_flow_version_id' is distinct from locked_flow.id::text
       ) else nullif(existing_message.metadata->>'attendance_entry_id', '') is null end)
$new$;
  if (select count(*) from pg_catalog.regexp_matches(v_definition, v_old, 'g')) <> 1 then
    raise exception using errcode = '55000', message = 'automation_whatsapp_unattended_replay_drift';
  end if;
  v_definition := pg_catalog.regexp_replace(v_definition, v_old, v_new);

  if strpos(v_definition, 'automation_whatsapp_attendance_required') > 0 then
    raise exception using errcode = '55000', message = 'automation_whatsapp_unattended_legacy_check_present';
  end if;
  execute v_definition;
end;
$patch$;

commit;
