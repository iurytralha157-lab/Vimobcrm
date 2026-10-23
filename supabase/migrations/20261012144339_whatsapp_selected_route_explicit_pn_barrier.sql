-- Forward correction to 20261012133549. A primary LID is opaque: compare
-- every explicit contact-side PN against the locked selected physical route.
-- Keep the prior migration/canonical B1 source immutable. Reapplying B1 requires
-- both PN barriers afterwards; this patch accepts only the exact predecessor.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $selected_route_pn$
declare
  v_target regprocedure := 'private.capture_whatsapp_webhook_routing_snapshot_v2(uuid,uuid,text,text,text,text,boolean,text[],text,text,text,boolean,boolean,boolean,uuid,uuid,uuid,integer)'::regprocedure;
  v_body text;
  v_definition text;
  v_old text := 'private.whatsapp_contact_pns_conflict(array[v_primary_alias, v_conversation.remote_jid])';
  v_new text := 'private.whatsapp_contact_pns_conflict(coalesce(p_identity_aliases, ''{}''::text[]) || array[v_conversation.remote_jid])';
begin
  select replace(proc.prosrc, E'\r\n', E'\n'), replace(pg_catalog.pg_get_functiondef(v_target), E'\r\n', E'\n')
  into v_body, v_definition from pg_catalog.pg_proc proc where proc.oid = v_target;
  if (length(v_body)-length(replace(v_body,v_new,'')))/length(v_new) = 1 then
    v_body := replace(v_body,v_new,v_old);
  end if;
  if md5(v_body) <> 'f0ac62447672f723fac16f8b3acf982e'
     or (length(v_body)-length(replace(v_body,v_old,'')))/length(v_old) <> 1
     or strpos(v_body,'private.whatsapp_contact_pn_reference(p_identity_aliases)') = 0 then
    raise exception using errcode='55000',message='whatsapp_selected_route_pn_barrier_source_drift';
  end if;
  if strpos(v_definition,v_new) = 0 then
    execute replace(v_definition,v_old,v_new);
  end if;
end;
$selected_route_pn$;

-- Edge consumes only IDs from the canonical inbox, not a provider's metadata.
-- Its active opaque execution lease and admission-only ignored reason are
-- required together. No message body, phone, actor or lead data is returned.
create or replace function private.read_whatsapp_webhook_pn_route_quarantine(
  p_organization_id uuid,p_session_id uuid,p_inbox_id uuid,p_execution_id uuid
) returns jsonb language sql stable security definer set search_path=''
as $$
  select inbox.payload #> '{__vimob_ingress,identity_quarantined_provider_message_ids}'
  from public.whatsapp_webhook_inbox inbox
  join private.whatsapp_webhook_ignored_events ignored
    on ignored.organization_id=inbox.organization_id and ignored.session_id=inbox.session_id
   and ignored.event_key=inbox.event_key and ignored.reason='whatsapp_contact_pn_route_conflict'
  where inbox.id=p_inbox_id and inbox.organization_id=p_organization_id and inbox.session_id=p_session_id
    and inbox.provider='evolution_go' and inbox.status='processing'
    and inbox.edge_execution_id=p_execution_id and inbox.edge_execution_state='active'
    and inbox.payload #>> '{__vimob_ingress,identity_quarantine_reason}'='whatsapp_contact_pn_route_conflict'
    and jsonb_typeof(inbox.payload #> '{__vimob_ingress,identity_quarantined_provider_message_ids}')='array'
    and not exists(select 1 from jsonb_array_elements(case when jsonb_typeof(inbox.payload #> '{__vimob_ingress,identity_quarantined_provider_message_ids}')='array'
      then inbox.payload #> '{__vimob_ingress,identity_quarantined_provider_message_ids}' else '[]'::jsonb end) candidate(value)
      where jsonb_typeof(candidate.value)<>'string' or octet_length(candidate.value #>> '{}') not between 1 and 200
        or (candidate.value #>> '{}') ~ '[[:cntrl:]]');
$$;
revoke all on function private.read_whatsapp_webhook_pn_route_quarantine(uuid,uuid,uuid,uuid)
from public,anon,authenticated,service_role;

create or replace function public.read_whatsapp_webhook_pn_route_quarantine(
  p_organization_id uuid,p_session_id uuid,p_inbox_id uuid,p_execution_id uuid
) returns jsonb language sql stable security definer set search_path=''
as $$ select private.read_whatsapp_webhook_pn_route_quarantine(p_organization_id,p_session_id,p_inbox_id,p_execution_id); $$;
revoke all on function public.read_whatsapp_webhook_pn_route_quarantine(uuid,uuid,uuid,uuid)
from public,anon,authenticated;
grant execute on function public.read_whatsapp_webhook_pn_route_quarantine(uuid,uuid,uuid,uuid)
to service_role;
commit;
