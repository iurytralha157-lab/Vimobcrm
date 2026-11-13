begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Strict message binding removed UPDATE on the binding ledger from service_role.
-- PostgreSQL also requires UPDATE privilege for a row lock. Give the fenced
-- enqueue RPC exactly that lock capability without restoring table writes.
create or replace function private.lock_automation_whatsapp_binding(
  p_organization_id uuid,
  p_conversation_id uuid,
  p_session_id uuid,
  p_lead_id uuid
)
returns setof public.whatsapp_conversation_lead_bindings
language sql
security definer
set search_path = 'pg_catalog'
rows 1
as $function$
  select binding.*
  from public.whatsapp_conversation_lead_bindings as binding
  where binding.organization_id = p_organization_id
    and binding.conversation_id = p_conversation_id
    and binding.session_id = p_session_id
    and binding.lead_id = p_lead_id
    and binding.active_to is null
  for share
$function$;

alter function private.lock_automation_whatsapp_binding(uuid, uuid, uuid, uuid) owner to postgres;

revoke all on function private.lock_automation_whatsapp_binding(uuid, uuid, uuid, uuid)
from public, anon, authenticated;
grant execute on function private.lock_automation_whatsapp_binding(uuid, uuid, uuid, uuid)
to service_role;

do $patch$
declare
  v_function_oid regprocedure :=
    'public.enqueue_automation_whatsapp_outbox(uuid,uuid,text,text,text,uuid,uuid,text,text,text,text,text,bigint,text)'::regprocedure;
  v_definition text := replace(replace(pg_catalog.pg_get_functiondef(v_function_oid), E'\r\n', E'\n'), E'\r', E'\n');
  -- Accept formatting differences only. The statement must match once.
  v_old constant text := '^[[:blank:]]*select[[:space:]]+binding[.][*][[:space:]]+into[[:space:]]+locked_binding[[:space:]]+from[[:space:]]+public[.]whatsapp_conversation_lead_bindings[[:space:]]+as[[:space:]]+binding[[:space:]]+where[[:space:]]+binding[.]conversation_id[[:space:]]*=[[:space:]]*p_conversation_id[[:space:]]+and[[:space:]]+binding[.]active_to[[:space:]]+is[[:space:]]+null[[:space:]]+for[[:space:]]+share;$';
  v_new constant text := $new$
  select binding.*
  into locked_binding
  from private.lock_automation_whatsapp_binding(
    p_organization_id, p_conversation_id, p_session_id, target_lead_id
  ) as binding;
$new$;
begin
  if not exists (
    select 1
    from pg_catalog.pg_proc
    where oid = v_function_oid and not prosecdef
      and proconfig = array['search_path=pg_catalog']::text[]
  )
    or coalesce(pg_catalog.obj_description(v_function_oid, 'pg_proc'), '') not like 'automation_whatsapp_binding_fence_v2:%'
    or strpos(v_definition, 'automation_whatsapp_attendance_required') = 0
    or (select count(*) from pg_catalog.regexp_matches(v_definition, v_old, 'gn')) <> 1 then
    raise exception using errcode = '55000', message = 'automation_whatsapp_binding_lock_patch_drift';
  end if;

  execute pg_catalog.regexp_replace(v_definition, v_old, btrim(v_new, E'\n'), 'n');
end
$patch$;

commit;
