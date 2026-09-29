-- Disposable PG17 only. Creates 25 exact DEAD roots in two isolated tenants
-- after PRELOAD and before ACTIVATE; no production data is copied.
begin;
do $seed$
declare
  v_org uuid[] := array[gen_random_uuid(),gen_random_uuid()];
  v_user uuid[] := array[gen_random_uuid(),gen_random_uuid()];
  v_session uuid[] := array[gen_random_uuid(),gen_random_uuid()];
  v_n integer;
  v_tenant integer;
  v_phone text;
  v_provider text;
  v_event text;
  v_lead uuid;
  v_conversation uuid;
  v_snapshot jsonb;
  v_child jsonb;
  v_payload jsonb;
  v_root_inbox uuid;
begin
  perform pg_catalog.set_config('session_replication_role','replica',true);
  for v_tenant in 1..2 loop
    insert into public.organizations(id,name,slug)
      values (v_org[v_tenant],'Failed route fixture '||v_tenant,
        'failed-route-fixture-'||v_org[v_tenant]::text);
    insert into public.users(id,email,name,organization_id)
      values (v_user[v_tenant],
        'route-'||v_tenant||'@example.invalid','Fixture',v_org[v_tenant]);
    insert into public.whatsapp_sessions(
      id,organization_id,owner_user_id,instance_name,status,is_active,provider)
      values (v_session[v_tenant],v_org[v_tenant],v_user[v_tenant],
        'failed-route-fixture-'||v_tenant,'connected',true,'evolution_go');
  end loop;
  perform pg_catalog.set_config('session_replication_role','origin',true);

  for v_n in 1..25 loop
    v_tenant := case when v_n <= 13 then 1 else 2 end;
    v_phone := '55119999'||pg_catalog.lpad(v_n::text,5,'0');
    v_lead := gen_random_uuid();
    v_conversation := gen_random_uuid();
    v_provider := 'backfill-root-'||v_n;
    v_event := 'backfill-root-event-'||v_n;
    perform pg_catalog.set_config('session_replication_role','replica',true);
    insert into public.leads(id,organization_id,name,phone)
      values (v_lead,v_org[v_tenant],'Fixture lead '||v_n,v_phone);
    insert into public.whatsapp_conversations(
      id,organization_id,session_id,lead_id,remote_jid,contact_phone)
      values (v_conversation,v_org[v_tenant],v_session[v_tenant],v_lead,
        v_phone||'@s.whatsapp.net',v_phone);
    insert into public.whatsapp_conversation_lead_bindings(
      id,organization_id,session_id,conversation_id,lead_id)
      values (gen_random_uuid(),v_org[v_tenant],v_session[v_tenant],
        v_conversation,v_lead);
    perform pg_catalog.set_config('session_replication_role','origin',true);

    v_snapshot := private.capture_whatsapp_webhook_routing_snapshot(
      v_org[v_tenant],v_session[v_tenant],v_provider,v_event,'live',
      'phone:'||v_phone,true,array[v_phone||'@s.whatsapp.net'],
      v_phone,'organic',null,false,false,false,null,null,null);
    if v_snapshot->>'state' is distinct from 'bound'
       or v_snapshot->>'binding_eligible' is distinct from 'true' then
      raise exception 'backfill fixture root % did not bind',v_n;
    end if;
    v_payload := pg_catalog.jsonb_build_object(
      'data',pg_catalog.jsonb_build_object('Info',
        pg_catalog.jsonb_build_object('ID',v_provider),
        'Message',pg_catalog.jsonb_build_object('conversation','')),
      '__vimob_ingress',pg_catalog.jsonb_build_object(
        'routing_key','phone:'||v_phone,
        'routing_snapshot',pg_catalog.jsonb_build_object(
          'version',1,'messages',pg_catalog.jsonb_build_array(v_snapshot))));
    insert into public.whatsapp_webhook_inbox(
      organization_id,session_id,event_key,event_type,payload,processing_lane)
      values (v_org[v_tenant],v_session[v_tenant],v_event,'message',v_payload,'live')
      returning id into v_root_inbox;

    v_child := private.capture_whatsapp_webhook_routing_snapshot(
      v_org[v_tenant],v_session[v_tenant],'backfill-child-'||v_n,
      'backfill-child-event-'||v_n,'live',
      'phone:'||v_phone,true,array[v_phone||'@s.whatsapp.net'],
      v_phone,'organic',null,false,false,false,null,null,null);
    if v_child->>'state' is distinct from 'predecessor_inherit'
       or v_child->>'predecessor_provider_message_id' is distinct from v_provider then
      raise exception 'backfill fixture child % did not inherit',v_n;
    end if;
    v_payload := pg_catalog.jsonb_build_object(
      'data',pg_catalog.jsonb_build_object('Info',
        pg_catalog.jsonb_build_object('ID','backfill-child-'||v_n),
        'Message',pg_catalog.jsonb_build_object('conversation','Fixture lead text')),
      '__vimob_ingress',pg_catalog.jsonb_build_object(
        'routing_key','phone:'||v_phone,
        'routing_snapshot',pg_catalog.jsonb_build_object(
          'version',1,'messages',pg_catalog.jsonb_build_array(v_child))));
    insert into public.whatsapp_webhook_inbox(
      organization_id,session_id,event_key,event_type,payload,processing_lane)
      values (v_org[v_tenant],v_session[v_tenant],
        'backfill-child-event-'||v_n,'message',v_payload,'live');
    update public.whatsapp_webhook_inbox
      set status='processing',attempts=1,locked_at=clock_timestamp(),locked_by='fixture'
      where id=v_root_inbox;
    update public.whatsapp_webhook_inbox
      set status='dead',attempts=max_attempts,locked_at=null,locked_by=null,
        last_error='native WhatsApp processor does not support this event',
        dead_lettered_at=clock_timestamp()
      where id=v_root_inbox;
  end loop;
  if (select count(*) from private.whatsapp_failed_route_candidates) <> 0
     or (select count(*) from public.whatsapp_webhook_inbox
       where event_key like 'backfill-root-event-%' and status='dead') <> 25
     or (select count(*) from public.whatsapp_webhook_inbox
       where event_key like 'backfill-child-event-%' and status='pending') <> 25 then
    raise exception 'PRELOAD unexpectedly changed candidate/dead/live fixture counts';
  end if;
end;
$seed$;
commit;
