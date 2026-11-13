begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Match the same attendance actor and current send authority as the Go
-- outbox. This helper can read the protected eligibility function as postgres,
-- but accepts the actor only from the enclosing immutable flow version.
create or replace function private.automation_whatsapp_outbox_attendance(
  p_organization_id uuid,
  p_conversation_id uuid,
  p_session_id uuid,
  p_lead_id uuid,
  p_binding_id uuid,
  p_actor_user_id uuid
)
returns uuid
language sql stable security definer
set search_path = 'pg_catalog'
as $function$
  select attendance.id
  from public.whatsapp_attendance_entries as attendance
  join public.whatsapp_conversation_lead_bindings as binding
    on binding.id = attendance.binding_id
   and binding.organization_id = attendance.organization_id
   and binding.conversation_id = attendance.conversation_id
   and binding.session_id = attendance.session_id
   and binding.lead_id = attendance.lead_id
   and binding.active_to is null and not binding.stale
  join public.whatsapp_conversations as conversation
    on conversation.id = attendance.conversation_id
   and conversation.organization_id = attendance.organization_id
   and conversation.session_id = attendance.session_id
   and conversation.lead_id = attendance.lead_id
   and conversation.deleted_at is null and not coalesce(conversation.is_group, false)
  join public.whatsapp_sessions as session
    on session.id = attendance.session_id and session.organization_id = attendance.organization_id
   and session.provider = 'evolution_go' and session.status = 'connected' and coalesce(session.is_active, true)
  join public.leads as lead
    on lead.id = attendance.lead_id and lead.organization_id = attendance.organization_id
  join public.users as actor
    on actor.id = attendance.user_id and actor.organization_id = attendance.organization_id and actor.is_active
  join public.organization_members as member
    on member.user_id = actor.id and member.organization_id = attendance.organization_id
   and member.is_active and member.deleted_at is null
  where attendance.organization_id = p_organization_id
    and attendance.conversation_id = p_conversation_id
    and attendance.session_id = p_session_id
    and attendance.lead_id = p_lead_id
    and attendance.binding_id = p_binding_id
    and attendance.user_id = p_actor_user_id
    and private.whatsapp_actor_can_read_lead(p_organization_id, p_lead_id, p_actor_user_id)
    and (
      session.owner_user_id = actor.id
      or (
        lead.assigned_user_id = actor.id
        and exists (
          select 1
          from public.whatsapp_session_access as access
          join public.users as owner_user
            on owner_user.id = session.owner_user_id
           and owner_user.organization_id = access.organization_id and owner_user.is_active
          join public.organization_members as owner_member
            on owner_member.user_id = owner_user.id and owner_member.organization_id = access.organization_id
           and owner_member.is_active and owner_member.deleted_at is null
          where access.organization_id = attendance.organization_id
            and access.session_id = attendance.session_id
            and access.user_id = actor.id and access.granted_by = session.owner_user_id
            and access.access_mode = 'assigned_leads_only' and access.only_leads_access
            and access.can_view and access.can_read and access.can_send
            and access.grant_scope = 'organization' and access.grant_team_id is null
            and lower(btrim(owner_member.role)) in ('owner', 'admin')
        )
      )
    )
  order by attendance.joined_at, attendance.id
  limit 1
$function$;

alter function private.automation_whatsapp_outbox_attendance(uuid, uuid, uuid, uuid, uuid, uuid) owner to postgres;
revoke all on function private.automation_whatsapp_outbox_attendance(uuid, uuid, uuid, uuid, uuid, uuid)
from public, anon, authenticated;
grant execute on function private.automation_whatsapp_outbox_attendance(uuid, uuid, uuid, uuid, uuid, uuid)
to service_role;

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
    or strpos(v_definition, 'automation_whatsapp_attendance_required') = 0 then
    raise exception using errcode = '55000', message = 'automation_whatsapp_attendance_evidence_patch_drift';
  end if;

  -- Preserve the early attendance rejection; check the exact actor after
  -- loading the version, before writing any message/outbox evidence.
  v_old := 'actor_user_id[[:space:]]+uuid;';
  v_new := 'actor_user_id uuid; attendance_entry_id uuid;';
  if (select count(*) from pg_catalog.regexp_matches(v_definition, v_old, 'g')) <> 1 then
    raise exception using errcode = '55000', message = 'automation_whatsapp_attendance_evidence_variable_drift';
  end if;
  v_definition := pg_catalog.regexp_replace(v_definition, v_old, v_new);

  v_old := 'actor_user_id[[:space:]]*:=[[:space:]]*locked_flow[.]created_by;';
  v_new := $new$
  actor_user_id := locked_flow.created_by;
  attendance_entry_id := private.automation_whatsapp_outbox_attendance(
    p_organization_id, p_conversation_id, p_session_id,
    target_lead_id, locked_binding.id, actor_user_id
  );
  if attendance_entry_id is null then
    raise exception using errcode = '23514', message = 'automation_whatsapp_attendance_required';
  end if;
$new$;
  if (select count(*) from pg_catalog.regexp_matches(v_definition, v_old, 'g')) <> 1 then
    raise exception using errcode = '55000', message = 'automation_whatsapp_attendance_evidence_actor_drift';
  end if;
  v_definition := pg_catalog.regexp_replace(v_definition, v_old, v_new);

  v_old := '''origin'',[[:space:]]*''automation'',[[:space:]]*''delivery'',[[:space:]]*''outbox'',';
  v_new := '''origin'', ''automation'', ''delivery'', ''outbox'', ''attendance_entry_id'', attendance_entry_id,';
  if (select count(*) from pg_catalog.regexp_matches(v_definition, v_old, 'g')) <> 1 then
    raise exception using errcode = '55000', message = 'automation_whatsapp_attendance_evidence_metadata_drift';
  end if;
  v_definition := pg_catalog.regexp_replace(v_definition, v_old, v_new);

  -- Replays must match the original immutable attendance evidence. Older
  -- messages without evidence do not become eligible for a new provider send.
  v_old := 'or[[:space:]]+existing_message[.]metadata[[:space:]]*->>[[:space:]]*''origin''[[:space:]]+is[[:space:]]+distinct[[:space:]]+from[[:space:]]+''automation''';
  v_new := $new$
  or existing_message.metadata->>'origin' is distinct from 'automation'
  or existing_message.metadata->>'attendance_entry_id' is distinct from attendance_entry_id::text
$new$;
  if (select count(*) from pg_catalog.regexp_matches(v_definition, v_old, 'g')) <> 1 then
    raise exception using errcode = '55000', message = 'automation_whatsapp_attendance_evidence_replay_drift';
  end if;

  execute pg_catalog.regexp_replace(v_definition, v_old, v_new);
end
$patch$;

commit;
