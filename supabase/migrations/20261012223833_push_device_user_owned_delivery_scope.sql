begin;
set local lock_timeout = '5s';
set local statement_timeout = '5min';

-- Deleting the registration organization must not delete another active
-- organization's account-owned device or break cross-org delivery foreign keys.
do $$ begin
  if not exists(select 1 from pg_catalog.pg_constraint
    where conrelid='public.push_tokens'::regclass and conname='push_tokens_organization_id_fkey'
      and confrelid='public.organizations'::regclass and confdeltype='c') then
    raise exception 'push_device_registration_fk_source_drift';
  end if;
end; $$;
alter table public.push_tokens alter column organization_id drop not null;
alter table public.push_tokens drop constraint push_tokens_organization_id_fkey;
alter table public.push_tokens add constraint push_tokens_organization_id_fkey
  foreign key(organization_id) references public.organizations(id) on delete set null;

-- A device belongs to its account. This column remains the registration/admin
-- context; authorization for a delivery uses the recipient's current membership
-- in the notification organization, never the device registration organization.
comment on column public.push_tokens.organization_id is
  'Registration/admin organization metadata. Push delivery authority is the current recipient membership in the notification organization; device ownership remains user_id.';

create function private.push_notification_recipient_is_active(p_organization_id uuid,p_user_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists(select 1 from public.users recipient
    join public.organization_members member on member.user_id=recipient.id
      and member.organization_id=p_organization_id
    where recipient.id=p_user_id and coalesce(recipient.is_active,false)
      and coalesce(member.is_active,false) and member.deleted_at is null);
$$;
revoke all on function private.push_notification_recipient_is_active(uuid,uuid)
from public,anon,authenticated,service_role;

create function private.lock_push_notification_recipient(p_organization_id uuid,p_user_id uuid,p_token_id uuid)
returns boolean language plpgsql volatile security definer set search_path = '' set lock_timeout = '2s'
as $$
begin
  -- Match account/membership/token writers; no row locks survive the durable
  -- provider-start COMMIT and none are held while waiting for provider HTTP.
  perform 1 from public.users where id=p_user_id for share;
  if not found then return false; end if;
  perform 1 from public.organization_members
    where organization_id=p_organization_id and user_id=p_user_id for share;
  if not found or not private.push_notification_recipient_is_active(p_organization_id,p_user_id) then return false; end if;
  perform 1 from public.push_tokens where id=p_token_id and user_id=p_user_id and is_active is true for share;
  return found;
end;
$$;
revoke all on function private.lock_push_notification_recipient(uuid,uuid,uuid)
from public,anon,authenticated,service_role;

do $patch$
declare v_definition text; v_old text; v_new text;
begin
  select replace(pg_catalog.pg_get_functiondef('private.prepare_whatsapp_inbound_attendant_push(uuid)'::regprocedure),E'\r\n',E'\n') into v_definition;
  v_old:='v_recipient record; v_session public.whatsapp_sessions%rowtype;';
  v_new:='v_recipient record; v_session public.whatsapp_sessions%rowtype;
  v_session_owner_user_id uuid; v_assigned_user_id uuid;';
  if (length(v_definition)-length(replace(v_definition,v_old,'')))/length(v_old)<>1 then raise exception 'push_device_whatsapp_actor_declaration_source_drift'; end if;
  v_definition:=replace(v_definition,v_old,v_new);
  v_old:='  select * into v_session from public.whatsapp_sessions
    where id = v_message.session_id and organization_id = v_message.organization_id for share;
  perform 1 from public.whatsapp_conversations where id = v_message.conversation_id
    and organization_id = v_message.organization_id for share;
  perform 1 from public.leads where id = v_message.lead_id and organization_id = v_message.organization_id for share;
  perform 1 from public.users where id in (v_session.owner_user_id,
    (select assigned_user_id from public.leads where id = v_message.lead_id and organization_id = v_message.organization_id))
    order by id for share;
  perform 1 from public.organization_members where organization_id = v_message.organization_id
    and user_id in (v_session.owner_user_id,
      (select assigned_user_id from public.leads where id = v_message.lead_id and organization_id = v_message.organization_id))
    order by user_id for share;';
  v_new:='  select owner_user_id into v_session_owner_user_id from public.whatsapp_sessions
    where id=v_message.session_id and organization_id=v_message.organization_id;
  select assigned_user_id into v_assigned_user_id from public.leads
    where id=v_message.lead_id and organization_id=v_message.organization_id;
  perform 1 from public.users where id in(v_session_owner_user_id,v_assigned_user_id) order by id for share;
  perform 1 from public.organization_members where organization_id=v_message.organization_id
    and user_id in(v_session_owner_user_id,v_assigned_user_id) order by user_id for share;
  select * into v_session from public.whatsapp_sessions
    where id=v_message.session_id and organization_id=v_message.organization_id for share;
  perform 1 from public.whatsapp_conversations where id=v_message.conversation_id
    and organization_id=v_message.organization_id for share;
  perform 1 from public.leads where id=v_message.lead_id and organization_id=v_message.organization_id for share;
  if v_session.owner_user_id is distinct from v_session_owner_user_id
    or (select assigned_user_id from public.leads where id=v_message.lead_id and organization_id=v_message.organization_id)
      is distinct from v_assigned_user_id then
    raise exception using errcode=''40001'',message=''whatsapp_push_actor_changed_during_lock'';
  end if;';
  if (length(v_definition)-length(replace(v_definition,v_old,'')))/length(v_old)<>1 then raise exception 'push_device_whatsapp_actor_lock_source_drift'; end if;
  execute replace(v_definition,v_old,v_new);

  select replace(pg_catalog.pg_get_functiondef('private.materialize_notification_deliveries(uuid,boolean)'::regprocedure),E'\r\n',E'\n') into v_definition;
  v_old:='and token.organization_id = v_notification.organization_id';
  v_new:='and private.push_notification_recipient_is_active(v_notification.organization_id,v_notification.user_id)';
  if (length(v_definition)-length(replace(v_definition,v_old,'')))/length(v_old)<>1 then raise exception 'push_device_materialize_existing_source_drift'; end if;
  v_definition:=replace(v_definition,v_old,v_new);
  v_old:='where token.organization_id = v_notification.organization_id';
  v_new:='where private.push_notification_recipient_is_active(v_notification.organization_id,v_notification.user_id)';
  if (length(v_definition)-length(replace(v_definition,v_old,'')))/length(v_old)<>1 then raise exception 'push_device_materialize_selection_source_drift'; end if;
  execute replace(v_definition,v_old,v_new);

  select replace(pg_catalog.pg_get_functiondef('private.claim_notification_deliveries(text,integer,interval,text[])'::regprocedure),E'\r\n',E'\n') into v_definition;
  v_old:='and token.organization_id = delivery.organization_id';
  v_new:='and private.push_notification_recipient_is_active(delivery.organization_id,delivery.user_id)';
  if (length(v_definition)-length(replace(v_definition,v_old,'')))/length(v_old)<>1 then raise exception 'push_device_claim_token_source_drift'; end if;
  v_definition:=replace(v_definition,v_old,v_new);
  -- Old code resolves by token.organization_id and must never claim a delivery
  -- requiring account-owned devices. The exact WhatsApp v2 suffix is preserved.
  v_old:='and (p_channels is null or delivery.channel = any(p_channels))';
  v_new:='and (p_channels is null or delivery.channel = any(p_channels))
        and (delivery.channel<>''push'' or right(p_worker_id,26)=''|push_device_v3|wa_push_v2'' or exists(
          select 1 from public.push_tokens legacy_token where legacy_token.id=delivery.push_token_id
            and legacy_token.organization_id=delivery.organization_id
        ))';
  if (length(v_definition)-length(replace(v_definition,v_old,'')))/length(v_old)<>1 then raise exception 'push_device_claim_protocol_source_drift'; end if;
  execute replace(v_definition,v_old,v_new);

  select replace(pg_catalog.pg_get_functiondef('private.start_notification_delivery(uuid,uuid,text)'::regprocedure),E'\r\n',E'\n') into v_definition;
  v_old:='  update private.notification_deliveries as delivery
  set status = ''sending'',';
  v_new:='  select * into v_delivery from private.notification_deliveries where id=p_delivery_id;
  if not found then return false; end if;
  if v_delivery.channel=''push'' and right(coalesce(v_delivery.leased_by,''''),26)=''|push_device_v3|wa_push_v2''
    and not private.lock_push_notification_recipient(v_delivery.organization_id,v_delivery.user_id,v_delivery.push_token_id) then
    update private.notification_deliveries set status=''cancelled'',next_attempt_at=null,
      lease_token=null,leased_by=null,lease_expires_at=null,dependency_key=null,blocked_at=null,terminal_at=now(),
      last_error_code=''push_recipient_or_device_revoked'',last_error_message=''The account, membership or device was revoked before provider start.'',
      last_error_at=now(),updated_at=now()
    where id=p_delivery_id and status=''leased'' and lease_token=p_lease_token;
    return false;
  end if;
  update private.notification_deliveries as delivery
  set status = ''sending'',';
  if (length(v_definition)-length(replace(v_definition,v_old,'')))/length(v_old)<>1 then raise exception 'push_device_start_fence_source_drift'; end if;
  execute replace(v_definition,v_old,v_new);
end;
$patch$;
commit;
