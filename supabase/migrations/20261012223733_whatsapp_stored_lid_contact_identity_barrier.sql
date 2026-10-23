begin;
set local lock_timeout = '5s';
set local statement_timeout = '5min';

-- Existing private/public entry points may only be the canonical predecessor
-- or this exact migration. A second application is idempotent; unknown drift
-- is rejected instead of silently replacing privileged code.
do $entry_source_guard$
declare v_signature text; v_allowed text[]; v_actual text;
begin
  for v_signature,v_allowed in select * from (values
    ('private.whatsapp_conversation_contact_pn_evidence(uuid,uuid,uuid)', array['6cc92288bd8229c95d8d74a1f26b9877']::text[]),
    ('private.guard_whatsapp_contact_identity_pn()', array['ddb97c436c4656e425b639fed3868066','36a950e18a6893545292fa113134878e']::text[]),
    ('private.guard_whatsapp_conversation_contact_pn()', array['9cc22955cd86f4a481201b7aa70b69f9']::text[]),
    ('public.record_whatsapp_webhook_contact_pn_quarantine(uuid,uuid,uuid,uuid,text)', array['0575636a95f3212f38c2d75e1458af0c']::text[])
  ) expected(signature,allowed) loop
    select md5(replace(proc.prosrc,E'\r\n',E'\n')) into v_actual from pg_catalog.pg_proc proc
      where proc.oid=pg_catalog.to_regprocedure(v_signature);
    if found and not (v_actual=any(v_allowed)) then
      raise exception using errcode='55000',message='whatsapp_stored_lid_identity_entry_source_drift';
    end if;
  end loop;
end;
$entry_source_guard$;


-- Identity evidence belongs to this exact physical route. Never discover a
-- conversation/card by phone, metadata.conversation_id, or another tenant.
-- Retain bare contact_phone so the explicit PN reference disambiguates NANP
-- and national BR forms; opaque/bare alias identifiers are not PN evidence.
create or replace function private.whatsapp_conversation_contact_pn_evidence(
  p_organization_id uuid, p_session_id uuid, p_conversation_id uuid
)
returns text[] language sql stable security definer set search_path = ''
as $$
  select coalesce(pg_catalog.array_agg(distinct evidence.value)
    filter(where nullif(pg_catalog.btrim(evidence.value),'') is not null),'{}'::text[])
  from public.whatsapp_conversations conversation
  cross join lateral (
    select conversation.remote_jid value
    union all select conversation.contact_phone
    union all
    select item.value
    from public.whatsapp_contact_identity_aliases alias
    cross join lateral (
      select alias.alias_jid value where lower(alias.alias_jid) ~ '@(s[.]whatsapp[.]net|c[.]us)$'
      union all select alias.canonical_jid where lower(alias.canonical_jid) ~ '@(s[.]whatsapp[.]net|c[.]us)$'
      union all select alias.contact_phone
    ) item
    where alias.organization_id=conversation.organization_id
      and alias.session_id=conversation.session_id
      and (alias.alias_jid=conversation.remote_jid or alias.canonical_jid=conversation.remote_jid)
  ) evidence
  where conversation.id=p_conversation_id
    and conversation.organization_id=p_organization_id
    and conversation.session_id=p_session_id;
$$;
revoke all on function private.whatsapp_conversation_contact_pn_evidence(uuid,uuid,uuid)
from public, anon, authenticated, service_role;
grant execute on function private.whatsapp_conversation_contact_pn_evidence(uuid,uuid,uuid) to service_role;

do $capture_guard$
declare
  v_target regprocedure := 'private.capture_whatsapp_webhook_routing_snapshot_v2(uuid,uuid,text,text,text,text,boolean,text[],text,text,text,boolean,boolean,boolean,uuid,uuid,uuid,integer)'::regprocedure;
  v_body text; v_definition text;
  v_old text := 'private.whatsapp_contact_pns_conflict(coalesce(p_identity_aliases, ''{}''::text[]) || array[v_conversation.remote_jid])';
  v_new text := 'private.whatsapp_contact_pns_conflict(coalesce(p_identity_aliases, ''{}''::text[]) || private.whatsapp_conversation_contact_pn_evidence(p_organization_id, p_session_id, v_conversation.id))';
begin
  select replace(proc.prosrc,E'\r\n',E'\n'),replace(pg_catalog.pg_get_functiondef(v_target),E'\r\n',E'\n')
    into v_body,v_definition from pg_catalog.pg_proc proc where proc.oid=v_target;
  if (length(v_body)-length(replace(v_body,v_new,'')))/length(v_new)=1 then
    v_body:=replace(v_body,v_new,v_old);
  end if;
  if md5(v_body)<>'3a2da8da0a39e6d55bb0a66c659719c2'
    or (length(v_body)-length(replace(v_body,v_old,'')))/length(v_old)<>1 then
    raise exception using errcode='55000',message='whatsapp_stored_lid_pn_capture_source_drift';
  end if;
  if strpos(v_definition,v_new)=0 then execute replace(v_definition,v_old,v_new); end if;
end;
$capture_guard$;

-- This trigger takes no new parent lock. Authorized writers retain the
-- existing conversation-before-alias order. UPDATE/UPSERT compares OLD too,
-- so an opaque alias cannot overwrite a different established explicit PN.
create or replace function private.guard_whatsapp_contact_identity_pn()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare v_values text[]; v_conversation_id uuid;
begin
  v_values:=array[new.alias_jid,new.canonical_jid,new.contact_phone];
  if tg_op='UPDATE' then
    v_values:=v_values || array[old.alias_jid,old.canonical_jid,old.contact_phone];
  end if;
  for v_conversation_id in
    select conversation.id from public.whatsapp_conversations conversation
    where conversation.organization_id=new.organization_id and conversation.session_id=new.session_id
      and conversation.deleted_at is null and conversation.retired_at is null
      and conversation.remote_jid in (new.alias_jid,new.canonical_jid)
    order by conversation.id
  loop
    v_values:=v_values || private.whatsapp_conversation_contact_pn_evidence(
      new.organization_id,new.session_id,v_conversation_id);
  end loop;
  if private.whatsapp_contact_pns_conflict(v_values) then
    raise exception using errcode='23514',message='whatsapp_contact_pn_conflict';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_whatsapp_contact_identity_pn()
from public, anon, authenticated, service_role;
create or replace trigger guard_whatsapp_contact_identity_pn_before_write
before insert or update of alias_jid,canonical_jid,contact_phone
on public.whatsapp_contact_identity_aliases
for each row execute function private.guard_whatsapp_contact_identity_pn();

-- Edge REST reads and writes are separate transactions. The implicit UPDATE
-- row lock makes this final identity check serialize competing promotions.
-- Clearing contact_phone during retention and all non-identity updates remain
-- unchanged; historical message/binding IDs are never rewritten here.
create or replace function private.guard_whatsapp_conversation_contact_pn()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare v_values text[];
begin
  if tg_op='UPDATE' and new.remote_jid is not distinct from old.remote_jid
    and (nullif(pg_catalog.btrim(new.contact_phone),'') is null
      or new.contact_phone is not distinct from old.contact_phone) then return new; end if;
  v_values:=array[new.remote_jid,new.contact_phone];
  if tg_op='UPDATE' then
    -- OLD is the row after PostgreSQL's concurrent UPDATE recheck. A STABLE
    -- helper can still see the statement's older snapshot after a row-lock
    -- wait, so retain this authoritative tuple explicitly as well.
    v_values:=v_values || array[old.remote_jid,old.contact_phone] || private.whatsapp_conversation_contact_pn_evidence(
      old.organization_id,old.session_id,old.id);
  end if;
  if private.whatsapp_contact_pns_conflict(v_values) then
    raise exception using errcode='23514',message='whatsapp_contact_pn_conflict';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_whatsapp_conversation_contact_pn()
from public, anon, authenticated, service_role;
create or replace trigger guard_whatsapp_conversation_contact_pn_before_write
before insert or update of remote_jid,contact_phone on public.whatsapp_conversations
for each row execute function private.guard_whatsapp_conversation_contact_pn();

-- A late conclusively rejected Edge part is technical evidence, not a customer
-- message. The RPC cannot borrow raw provider IDs or a different/stale lease.
-- The canonical inbox payload and frozen snapshots remain immutable.
create or replace function public.record_whatsapp_webhook_contact_pn_quarantine(
  p_organization_id uuid,p_session_id uuid,p_inbox_id uuid,p_execution_id uuid,p_provider_message_id text
)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare v_event_key text;
begin
  select inbox.event_key into v_event_key from public.whatsapp_webhook_inbox inbox
  where inbox.id=p_inbox_id and inbox.organization_id=p_organization_id and inbox.session_id=p_session_id
    and inbox.status='processing' and inbox.edge_execution_id=p_execution_id
    and inbox.edge_execution_state='active' and p_execution_id is not null
    and inbox.processing_epoch=coalesce((select cutover.active_epoch from private.whatsapp_webhook_session_cutovers cutover
      where cutover.session_id=inbox.session_id),0)
    and exists(select 1 from pg_catalog.jsonb_array_elements(
      case when pg_catalog.jsonb_typeof(inbox.payload#>'{__vimob_ingress,routing_snapshot,messages}')='array'
        then inbox.payload#>'{__vimob_ingress,routing_snapshot,messages}' else '[]'::jsonb end
    ) route(snapshot_value) where route.snapshot_value->>'provider_message_id'=p_provider_message_id
      and exists(select 1 from public.whatsapp_webhook_routing_snapshots snapshot
        where snapshot.organization_id=inbox.organization_id and snapshot.session_id=inbox.session_id
          and snapshot.processing_epoch=inbox.processing_epoch and snapshot.provider_message_id=p_provider_message_id
          and snapshot.snapshot=route.snapshot_value))
  for update of inbox;
  if v_event_key is null then
    raise exception using errcode='42501',message='whatsapp_contact_pn_quarantine_scope_invalid';
  end if;
  insert into private.whatsapp_webhook_ignored_events(organization_id,session_id,event_key,reason)
    values(p_organization_id,p_session_id,v_event_key,'whatsapp_contact_pn_route_conflict')
    on conflict(organization_id,session_id,event_key) do update set reason=excluded.reason;
  return true;
end;
$$;
revoke all on function public.record_whatsapp_webhook_contact_pn_quarantine(uuid,uuid,uuid,uuid,text)
from public, anon, authenticated, service_role;
grant execute on function public.record_whatsapp_webhook_contact_pn_quarantine(uuid,uuid,uuid,uuid,text) to service_role;

commit;
