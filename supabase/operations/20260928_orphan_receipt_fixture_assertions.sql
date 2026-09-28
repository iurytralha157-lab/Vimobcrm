-- Run only in a disposable PostgreSQL 17 database after the paired fixture and migration.
do $test$
declare
  v_outcome text;
  v_dead public.whatsapp_webhook_inbox%rowtype;
  v_claim record;
  v_completed boolean;
  v_deferred_expired integer;
  v_resolved_expired integer;
  v_second_id uuid := '00000000-0000-4000-8000-000000000003';
begin
  v_outcome := private.quarantine_orphan_whatsapp_receipt(
    'fbdb013a-937c-46ba-98c3-a42eae2d1580',
    'fixture-provider-read-1', now() - interval '3 days'
  );
  if v_outcome <> 'quarantined' then
    raise exception 'positive quarantine failed: %', v_outcome;
  end if;
  select * into strict v_dead from public.whatsapp_webhook_inbox
  where id = 'fbdb013a-937c-46ba-98c3-a42eae2d1580';
  if v_dead.status <> 'dead' or v_dead.attempts <> 8
     or v_dead.last_error <> 'orphan_receipt_no_target:v1:pid_md5=' || md5('fixture-provider-read-1')
     or v_dead.payload #>> '{data,MessageIDs,0}' <> 'fixture-provider-read-1' then
    raise exception 'raw inbox receipt was not preserved';
  end if;
  if not exists (
    select 1 from private.whatsapp_orphan_receipt_ledger
    where inbox_id = v_dead.id and state = 'deferred'
      and expires_at >= now() + interval '29 days'
  ) then
    raise exception 'durable 30-day pointer missing';
  end if;

  -- Remove the synthetic successor so the next fixture is the actual head.
  update public.whatsapp_webhook_inbox set status = 'dead'
  where id = '00000000-0000-4000-8000-000000000002';
  insert into public.whatsapp_webhook_inbox (
    id, organization_id, session_id, processing_lane, event_type, status,
    attempts, max_attempts, created_at, updated_at, next_attempt_at,
    expires_at, payload, last_error
  ) values (
    v_second_id,
    '01b782dc-6921-52eb-bc58-bb9d0d46d736',
    '3bf13e03-9613-448e-aff8-8aaddced472f',
    'backlog', 'receipt', 'retry', 2, 12,
    now() - interval '30 hours', now() - interval '1 minute', now(),
    now() + interval '25 days',
    jsonb_build_object(
      '__vimob_ingress', jsonb_build_object(
        'routing_key','__session__',
        'routing_snapshot',jsonb_build_object('version',1,'messages','[]'::jsonb)
      ),
      'event','Receipt',
      'data',jsonb_build_object(
        'Type','read','IsFromMe',true,
        'MessageIDs',jsonb_build_array('fixture-provider-read-2')
      )
    ),
    'notification WhatsApp receipt fixture-provider-read-2: reconciliation rejected outcome "not_found"'
  );

  update public.whatsapp_webhook_inbox
  set payload = jsonb_set(payload, '{data,IsFromMe}', '"true"'::jsonb)
  where id = v_second_id;
  v_outcome := private.quarantine_orphan_whatsapp_receipt(
    v_second_id,'fixture-provider-read-2',now()-interval '30 hours'
  );
  if v_outcome <> 'not_eligible' then
    raise exception 'string IsFromMe accepted: %', v_outcome;
  end if;
  update public.whatsapp_webhook_inbox
  set payload = jsonb_set(payload, '{data,IsFromMe}', 'true'::jsonb)
  where id = v_second_id;

  insert into public.whatsapp_messages
    (organization_id,session_id,message_id)
  values (
    '01b782dc-6921-52eb-bc58-bb9d0d46d736',
    '3bf13e03-9613-448e-aff8-8aaddced472f',
    'fixture-provider-read-2'
  );
  v_outcome := private.quarantine_orphan_whatsapp_receipt(
    v_second_id,'fixture-provider-read-2',now()-interval '30 hours'
  );
  if v_outcome <> 'target_present' then
    raise exception 'canonical target not protected: %', v_outcome;
  end if;
  delete from public.whatsapp_messages where message_id='fixture-provider-read-2';

  insert into public.whatsapp_webhook_inbox (
    id,organization_id,session_id,processing_lane,event_type,status,
    attempts,max_attempts,created_at,updated_at,next_attempt_at,expires_at,
    payload,last_error
  ) values (
    '00000000-0000-4000-8000-000000000004',
    '01b782dc-6921-52eb-bc58-bb9d0d46d736',
    '3bf13e03-9613-448e-aff8-8aaddced472f',
    'backlog','album','dead',1,12,now(),now(),now(),now()+interval '25 days',
    jsonb_build_object('data',jsonb_build_object(
      'Info',jsonb_build_object('ID','fixture-provider-read-2')
    )),null
  );
  v_outcome := private.quarantine_orphan_whatsapp_receipt(
    v_second_id,'fixture-provider-read-2',now()-interval '30 hours'
  );
  if v_outcome <> 'target_present' then
    raise exception 'non-message inbox target not protected: %', v_outcome;
  end if;
  delete from public.whatsapp_webhook_inbox
  where id='00000000-0000-4000-8000-000000000004';

  update public.whatsapp_webhook_inbox
  set payload = jsonb_set(payload, '{data,MessageIDs}',
    '["fixture-provider-read-2","other"]'::jsonb)
  where id=v_second_id;
  v_outcome := private.quarantine_orphan_whatsapp_receipt(
    v_second_id,'fixture-provider-read-2',now()-interval '30 hours'
  );
  if v_outcome <> 'mixed_or_message' then
    raise exception 'mixed IDs accepted: %', v_outcome;
  end if;
  update public.whatsapp_webhook_inbox
  set payload = jsonb_set(payload, '{data,MessageIDs}',
    '["fixture-provider-read-2"]'::jsonb)
  where id=v_second_id;
  v_outcome := private.quarantine_orphan_whatsapp_receipt(
    v_second_id,'fixture-provider-read-2',now()-interval '30 hours'
  );
  if v_outcome <> 'quarantined' then
    raise exception 'second quarantine failed: %', v_outcome;
  end if;

  update private.whatsapp_orphan_receipt_ledger
  set next_reconcile_at=now()-interval '1 second';
  select * into v_claim from private.claim_orphan_whatsapp_receipt_reconciliation(1);
  if v_claim.inbox_id is null or v_claim.claim_token is null
     or v_claim.reconcile_attempts <> 1 then
    raise exception 'claim contract failed';
  end if;
  select private.complete_orphan_whatsapp_receipt_reconciliation(
    v_claim.inbox_id,v_claim.organization_id,v_claim.session_id,
    v_claim.provider_message_id,gen_random_uuid(),v_claim.reconcile_attempts,
    'native_reconciled'
  ) into v_completed;
  if v_completed then
    raise exception 'completion accepted the wrong claim token';
  end if;
  select private.complete_orphan_whatsapp_receipt_reconciliation(
    v_claim.inbox_id,v_claim.organization_id,v_claim.session_id,
    v_claim.provider_message_id,v_claim.claim_token,v_claim.reconcile_attempts,
    'native_reconciled'
  ) into v_completed;
  if not v_completed then
    raise exception 'exact completion failed';
  end if;

  update private.whatsapp_orphan_receipt_ledger
  set expires_at=now()-interval '1 second';
  select c.deferred_expired,c.resolved_expired
  into v_deferred_expired,v_resolved_expired
  from private.cleanup_expired_orphan_whatsapp_receipts(10) c;
  if v_deferred_expired<>1 or v_resolved_expired<>1 then
    raise exception 'explicit cleanup counts failed: deferred %, resolved %',
      v_deferred_expired,v_resolved_expired;
  end if;
end;
$test$;
