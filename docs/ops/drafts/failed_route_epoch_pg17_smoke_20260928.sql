-- Disposable PostgreSQL 17.6 only. Every fixture change is rolled back.
begin;
set local statement_timeout = '30s';
do $test$
declare
  v_org uuid := 'b76ee006-8d30-4612-a06b-398800000001';
  v_user uuid := 'b76ee006-8d30-4612-a06b-398800000002';
  v_session uuid := 'b76ee006-8d30-4612-a06b-398800000003';
  v_lead uuid := 'b76ee006-8d30-4612-a06b-398800000004';
  v_conversation uuid := 'b76ee006-8d30-4612-a06b-398800000005';
  v_binding uuid := 'b76ee006-8d30-4612-a06b-398800000006';
  v_lead2 uuid := 'b76ee006-8d30-4612-a06b-398800000007';
  v_conversation2 uuid := 'b76ee006-8d30-4612-a06b-398800000008';
  v_binding2 uuid := 'b76ee006-8d30-4612-a06b-398800000009';
  v_snapshot jsonb;
  v_child jsonb;
  v_root_inbox uuid;
  v_child_inbox uuid;
  v_payload jsonb;
  v_result jsonb;
  v_fence uuid;
  v_unsupported uuid;
begin
  -- The restored schema has no auth.users and its legacy users trigger inserts
  -- membership before the user row exists. Seed only fixtures with triggers off.
  perform pg_catalog.set_config('session_replication_role','replica',true);
  insert into public.organizations(id,name) values (v_org,'Test isolated organization');
  insert into public.users(id,email,name,organization_id)
    values (v_user,'test-route@example.invalid','Test',v_org);
  insert into public.whatsapp_sessions(id,organization_id,owner_user_id,instance_name,
    status,is_active,provider) values
    (v_session,v_org,v_user,'isolated-test','connected',true,'evolution_go');
  insert into public.leads(id,organization_id,name,phone)
    values (v_lead,v_org,'Test lead','5511999911111');
  insert into public.whatsapp_conversations(id,organization_id,session_id,lead_id,
    remote_jid,contact_phone) values
    (v_conversation,v_org,v_session,v_lead,
      '5511999911111@s.whatsapp.net','5511999911111');
  insert into public.whatsapp_conversation_lead_bindings(
    id,organization_id,session_id,conversation_id,lead_id)
    values (v_binding,v_org,v_session,v_conversation,v_lead);
  insert into public.leads(id,organization_id,name,phone)
    values (v_lead2,v_org,'Second test lead','5511999922222');
  insert into public.whatsapp_conversations(id,organization_id,session_id,lead_id,
    remote_jid,contact_phone) values
    (v_conversation2,v_org,v_session,v_lead2,
      '5511999922222@s.whatsapp.net','5511999922222');
  insert into public.whatsapp_conversation_lead_bindings(
    id,organization_id,session_id,conversation_id,lead_id)
    values (v_binding2,v_org,v_session,v_conversation2,v_lead2);
  perform pg_catalog.set_config('session_replication_role','origin',true);
  v_snapshot := private.capture_whatsapp_webhook_routing_snapshot(
    v_org,v_session,'test-root','test-root-event','live',
    'phone:5511999911111',true,array['5511999911111@s.whatsapp.net'],
    '5511999911111','organic',null,false,false,false,null,null,null);
  raise notice 'capture state=% target=% eligible=%',
    v_snapshot->>'state',v_snapshot->>'target_mode',v_snapshot->>'binding_eligible';
  if v_snapshot->>'state' is distinct from 'bound'
     or v_snapshot->>'binding_eligible' is distinct from 'true' then
    raise exception 'root did not bind in disposable fixture: %',v_snapshot;
  end if;
  v_payload := pg_catalog.jsonb_build_object(
    'data',pg_catalog.jsonb_build_object('Info',
      pg_catalog.jsonb_build_object('ID','test-root'),
      'Message',pg_catalog.jsonb_build_object('conversation','')),
    '__vimob_ingress',pg_catalog.jsonb_build_object(
      'routing_key','phone:5511999911111',
      'routing_snapshot',pg_catalog.jsonb_build_object(
        'version',1,'messages',pg_catalog.jsonb_build_array(v_snapshot))));
  insert into public.whatsapp_webhook_inbox(
    organization_id,session_id,event_key,event_type,payload,processing_lane)
    values (v_org,v_session,'test-root-event','message',v_payload,'live')
    returning id into v_root_inbox;
  v_child := private.capture_whatsapp_webhook_routing_snapshot(
    v_org,v_session,'test-child','test-child-event','live',
    'phone:5511999911111',true,array['5511999911111@s.whatsapp.net'],
    '5511999911111','organic',null,false,false,false,null,null,null);
  if v_child->>'state' is distinct from 'predecessor_inherit'
     or v_child->>'predecessor_provider_message_id' is distinct from 'test-root' then
    raise exception 'child did not inherit root: %',v_child;
  end if;
  v_payload := pg_catalog.jsonb_build_object(
    'data',pg_catalog.jsonb_build_object('Info',
      pg_catalog.jsonb_build_object('ID','test-child'),
      'Message',pg_catalog.jsonb_build_object('conversation','lead text')),
    '__vimob_ingress',pg_catalog.jsonb_build_object(
      'routing_key','phone:5511999911111',
      'routing_snapshot',pg_catalog.jsonb_build_object(
        'version',1,'messages',pg_catalog.jsonb_build_array(v_child))));
  insert into public.whatsapp_webhook_inbox(
    organization_id,session_id,event_key,event_type,payload,processing_lane)
    values (v_org,v_session,'test-child-event','message',v_payload,'live')
    returning id into v_child_inbox;
  update public.whatsapp_webhook_inbox
    set status='processing',attempts=1,locked_at=clock_timestamp(),locked_by='test'
    where id=v_root_inbox;
  update public.whatsapp_webhook_inbox
    set status='dead',attempts=max_attempts,locked_at=null,locked_by=null,
      last_error='native WhatsApp processor does not support this event',
      dead_lettered_at=clock_timestamp()
    where id=v_root_inbox;
  if (select count(*) from private.whatsapp_failed_route_candidates
      where root_inbox_id=v_root_inbox) <> 1 then
    raise exception 'candidate trigger missed the deterministic root';
  end if;
  -- This is the periodic path: no further webhook is ingested after DEAD.
  v_result := private.try_hold_failed_whatsapp_route_epoch(
    v_org,v_session,'phone:5511999911111','5511999911111');
  raise notice 'fence result=%',v_result;
  if v_result->>'state' is distinct from 'held'
     or (v_result->>'held_count')::integer <> 1 then
    raise exception 'periodic candidate reconcile did not hold the child';
  end if;
  v_fence := (v_result->>'fence_id')::uuid;
  if not private.whatsapp_failed_route_inbox_is_held(v_child_inbox) then
    raise exception 'claim guard failed to recognize held child';
  end if;
  update private.whatsapp_failed_route_epoch_fences
    set held_at=clock_timestamp()-interval '11 minutes',
      quarantine_after=clock_timestamp()-interval '1 minute'
    where id=v_fence;
  v_result := private.quarantine_due_failed_whatsapp_epoch(v_root_inbox);
  raise notice 'quarantine result=%',v_result;
  if v_result->>'state' is distinct from 'quarantined'
     or (select status from public.whatsapp_webhook_inbox where id=v_child_inbox)
       is distinct from 'dead'
     or (select count(*) from private.whatsapp_failed_route_epoch_raw
       where fence_id=v_fence and retained_until='infinity'::timestamptz) <> 2 then
    raise exception 'quarantine did not preserve root and child raw';
  end if;
  -- Opaque singleton is ineligible by construction, so it must not fence its
  -- route or stop a later text on the same phone.
  v_snapshot := private.capture_whatsapp_webhook_routing_snapshot(
    v_org,v_session,'test-opaque','test-opaque-event','live',
    'phone:5511999922222',false,array['5511999922222@s.whatsapp.net'],
    '5511999922222','organic',null,false,false,false,null,null,null);
  v_payload := pg_catalog.jsonb_build_object(
    'data',pg_catalog.jsonb_build_object('Info',
      pg_catalog.jsonb_build_object('ID','test-opaque'),
      'Message',pg_catalog.jsonb_build_object('albumMessage',
        pg_catalog.jsonb_build_object('expectedImageCount',2))),
    '__vimob_ingress',pg_catalog.jsonb_build_object(
      'routing_key','phone:5511999922222',
      'routing_snapshot',pg_catalog.jsonb_build_object(
        'version',1,'messages',pg_catalog.jsonb_build_array(v_snapshot))));
  insert into public.whatsapp_webhook_inbox(
    organization_id,session_id,event_key,event_type,payload,processing_lane)
    values (v_org,v_session,'test-opaque-event','message',v_payload,'live')
    returning id into v_unsupported;
  update public.whatsapp_webhook_inbox
    set status='processing',attempts=1,locked_at=clock_timestamp(),locked_by='test'
    where id=v_unsupported;
  update public.whatsapp_webhook_inbox
    set status='dead',attempts=max_attempts,locked_at=null,locked_by=null,
      last_error='native WhatsApp processor does not support this event',
      dead_lettered_at=clock_timestamp()
    where id=v_unsupported;
  if exists (select 1 from private.whatsapp_failed_route_candidates
      where root_inbox_id=v_unsupported) then
    raise exception 'ineligible opaque singleton incorrectly became candidate';
  end if;
  v_child := private.capture_whatsapp_webhook_routing_snapshot(
    v_org,v_session,'test-after-opaque','test-after-opaque-event','live',
    'phone:5511999922222',true,array['5511999922222@s.whatsapp.net'],
    '5511999922222','organic',null,false,false,false,null,null,null);
  if v_child->>'state' is distinct from 'bound'
     or v_child->>'current_lead_id' is distinct from v_lead2::text
     or v_child->>'predecessor_provider_message_id' is not null then
    raise exception 'valid text inherited ineligible opaque root: %',v_child;
  end if;
  if exists (select 1 from public.whatsapp_webhook_routing_outcomes
      where provider_message_id in ('test-root','test-child','test-opaque'))
     or exists (select 1 from public.whatsapp_messages
      where provider_message_id in ('test-root','test-child','test-opaque')) then
    raise exception 'fence fabricated outcome or message';
  end if;
  -- An old API replica cannot turn an unsplittable peer batch into a public
  -- DEAD predecessor after ACTIVATE; the new API must use private raw.
  v_payload := pg_catalog.jsonb_build_object(
    'data',pg_catalog.jsonb_build_object('messages',pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('Info',pg_catalog.jsonb_build_object('ID','a')),
      pg_catalog.jsonb_build_object('Info',pg_catalog.jsonb_build_object('ID','b')))),
    '__vimob_ingress',pg_catalog.jsonb_build_object('routing_key','__session__',
      'routing_snapshot',pg_catalog.jsonb_build_object('version',1,'messages',
        pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object('provider_message_id','a'),
          pg_catalog.jsonb_build_object('provider_message_id','b')))));
  begin
    insert into public.whatsapp_webhook_inbox(
      organization_id,session_id,event_key,event_type,payload,processing_lane)
      values (v_org,v_session,'test-mixed-old-api','message',v_payload,'live');
    raise exception 'old API mixed inbox was not rejected';
  exception when check_violation then
    if sqlerrm not like '%failed_route_unsplit_batch_requires_private_isolation%' then
      raise;
    end if;
  end;
  if exists (select 1 from public.whatsapp_webhook_inbox
      where event_key='test-mixed-old-api') then
    raise exception 'old API mixed inbox leaked after guard';
  end if;
end;
$test$;
rollback;
