begin;
set local statement_timeout = '60s';
do $canary$
declare
  v_org uuid := gen_random_uuid();
  v_session uuid := gen_random_uuid();
  v_conversation uuid := gen_random_uuid();
  v_user uuid := gen_random_uuid();
  v_lead uuid := gen_random_uuid();
  v_inbox uuid;
  v_missing_inbox uuid;
  v_target_inbox uuid;
  v_grace_inbox uuid;
  v_provider text;
  v_payload jsonb;
  v_occurred timestamptz := now() - interval '8 days';
  v_deferred timestamptz := now() - interval '8 days';
  v_count integer;
  v_hash text;
  v_i integer;
begin
  insert into public.organizations(id,name,slug)
    values (v_org,'Isolated TTL test','ttl-' || v_org::text);
  insert into auth.users(id,aud,role,email,encrypted_password,
    raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
    values (v_user,'authenticated','authenticated',
      'ttl-' || v_user::text || '@example.invalid','',
      '{}'::jsonb,'{}'::jsonb,now(),now());
  insert into public.users(id,organization_id,name,email,role,is_active)
    values (v_user,v_org,'Isolated user',
      'ttl-' || v_user::text || '@example.invalid','user',true);
  insert into public.organization_members(organization_id,user_id,role,is_active)
    values (v_org,v_user,'user',true) on conflict do nothing;
  insert into public.whatsapp_sessions(id,organization_id,owner_user_id,
    instance_name,instance_id,provider,status,is_active,advanced_settings)
    values (v_session,v_org,v_user,'ttl-' || v_session::text,
      'ttl-' || v_session::text,'evolution_go','connected',true,'{}'::jsonb);
  insert into public.leads(id,organization_id,name,phone)
    values (v_lead,v_org,'Isolated lead','5511999990000');
  insert into public.whatsapp_conversations(id,organization_id,session_id,
    lead_id,assigned_user_id,remote_jid,contact_phone)
    values (v_conversation,v_org,v_session,v_lead,v_user,
      '5511999990000@s.whatsapp.net','5511999990000');
  perform public.activate_whatsapp_conversation_lead_binding(
    v_org,v_conversation,v_lead,null);
  for v_i in 1..3 loop
    v_provider := 'ttl-canary-' || v_org::text || '-' || v_i::text;
    v_payload := pg_catalog.jsonb_build_object(
      'event','Receipt','state','Delivered','instanceId','isolated','instanceName','isolated',
      '__vimob_ingress',pg_catalog.jsonb_build_object('routing_key','receipt:isolated',
        'routing_snapshot',pg_catalog.jsonb_build_object('version',1,'messages','[]'::jsonb)),
      'data',pg_catalog.jsonb_build_object(
        'AddressingMode','pn','MessageSender','','Type','','Sender','',
        'MessageIDs',pg_catalog.jsonb_build_array(v_provider),'Chat','',
        'Timestamp',pg_catalog.to_char(v_occurred at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        'SenderAlt','','RecipientAlt','','BroadcastListOwner','','IsFromMe',false,
        'IsGroup',false,'BroadcastRecipients',null));
    if private.is_v1_status_only_receipt(v_payload) is distinct from true then
      raise exception 'canary status-only payload invalid';
    end if;
    insert into public.whatsapp_webhook_inbox (
      organization_id,session_id,event_key,event_type,provider,payload,
      processing_lane,status,attempts,locked_at,locked_by,provider_occurred_at
    ) values (
      v_org,v_session,'ttl-canary-' || v_i::text,'receipt','evolution_go',v_payload,
      'live','processing',1,now(),'ttl-canary',v_occurred
    ) returning id into v_inbox;
    insert into private.whatsapp_v1_partial_live_receipt_audit (
      inbox_id,organization_id,session_id,event_key,original_inbox,payload_sha256,
      receipt_status,provider_occurred_at,initially_missing_ids,deferred_at
    ) select v_inbox,v_org,v_session,inbox.event_key,pg_catalog.to_jsonb(inbox),
      private.canonical_jsonb_sha256(v_payload),'delivered',v_occurred,
      pg_catalog.jsonb_build_array(v_provider),v_deferred
      from public.whatsapp_webhook_inbox as inbox where inbox.id=v_inbox;
    insert into private.whatsapp_deferred_receipt_ledger (
      inbox_id,organization_id,session_id,provider_message_id,receipt_status,
      provider_occurred_at,expires_at,state,deferred_at,next_reconcile_at,last_reconcile_at
    ) values (
      v_inbox,v_org,v_session,v_provider,'delivered',v_occurred,
      now() + interval '30 days','deferred',v_deferred,now() - interval '1 minute',
      case when v_i=3 then now() else now() - interval '11 minutes' end
    );
    if v_i=1 then v_missing_inbox:=v_inbox;
    elsif v_i=2 then v_target_inbox:=v_inbox;
    else v_grace_inbox:=v_inbox;
    end if;
    if v_i=2 then
      insert into public.whatsapp_messages (
        organization_id,session_id,conversation_id,message_id,provider_message_id,
        from_me,direction,content,message_type,status
      ) values (
        v_org,v_session,v_conversation,v_provider,v_provider,
        true,'outbound','isolated test target','text','sent'
      );
    end if;
  end loop;
  select private.expire_unmatched_partial_live_receipt_ids(3) into v_count;
  if v_count is distinct from 1 then raise exception 'expected exactly one retirement, got %',v_count; end if;
  select count(*)::integer into v_count from private.whatsapp_deferred_receipt_ledger
    where inbox_id in (v_missing_inbox,v_target_inbox,v_grace_inbox);
  if v_count is distinct from 2 then raise exception 'expected two preserved pointers, got %',v_count; end if;
  select count(*)::integer into v_count from private.whatsapp_deferred_receipt_ledger
    where inbox_id in (v_target_inbox,v_grace_inbox) and state='deferred';
  if v_count is distinct from 2 then raise exception 'target or grace pointer was retired'; end if;
  select retirement.payload_sha256 into v_hash
    from private.whatsapp_partial_live_receipt_retirements as retirement
    where retirement.inbox_id=v_missing_inbox
      and retirement.retained_until='infinity'::timestamptz;
  if v_hash is null or v_hash is distinct from (
    select audit.payload_sha256 from private.whatsapp_v1_partial_live_receipt_audit as audit
      where audit.inbox_id=v_missing_inbox
        and audit.retained_until='infinity'::timestamptz
        and private.canonical_jsonb_sha256(audit.original_inbox->'payload')=audit.payload_sha256
  ) then raise exception 'retirement raw/hash retention mismatch'; end if;
  select count(*)::integer into v_count from public.whatsapp_messages
    where organization_id=v_org and session_id=v_session and status='sent';
  if v_count is distinct from 1 then raise exception 'target message modified'; end if;
  select private.expire_unmatched_partial_live_receipt_ids(3) into v_count;
  if v_count is distinct from 0 then raise exception 'expiry is not idempotent'; end if;
  raise notice 'ttl canary passed: one absent retired, target and grace preserved, raw/hash infinite';
end;
$canary$;
rollback;