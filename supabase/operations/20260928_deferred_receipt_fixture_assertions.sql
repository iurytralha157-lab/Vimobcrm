-- Run only in a disposable PostgreSQL 17 database after the paired fixture and migration.
do $test$
declare
  v_outcome text;
  v_dead public.whatsapp_webhook_inbox%rowtype;
  v_claim record;
  v_completed boolean;
  v_deferred_overdue integer;
  v_resolved_expired integer;
  v_second_id uuid := '00000000-0000-4000-8000-000000000003';
begin
  v_outcome := private.defer_unmatched_whatsapp_receipt(
    '30000000-0000-4000-8000-000000000001',
    'fixture-provider-read-1', '2026-09-25T00:00:00Z'
  );
  if v_outcome <> 'deferred' then
    raise exception 'positive defer failed: %', v_outcome;
  end if;
  select * into strict v_dead from public.whatsapp_webhook_inbox
  where id = '30000000-0000-4000-8000-000000000001';
  if v_dead.status <> 'dead' or v_dead.attempts <> 8
     or v_dead.last_error <> 'deferred_status_waiting_target:v1:pid_md5=' || md5('fixture-provider-read-1')
     or v_dead.payload #>> '{data,MessageIDs,0}' <> 'fixture-provider-read-1' then
    raise exception 'raw inbox receipt was not preserved';
  end if;
  if not exists (
    select 1 from private.whatsapp_deferred_receipt_ledger
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
    expires_at, provider_occurred_at, payload, last_error
  ) values (
    v_second_id,
    '10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    'backlog', 'receipt', 'retry', 2, 12,
    now() - interval '30 hours', now() - interval '1 minute', now(),
    now() + interval '25 days', '2026-09-26T00:00:00Z',
    jsonb_build_object(
      '__vimob_ingress', jsonb_build_object(
        'routing_key','__session__',
        'routing_snapshot',jsonb_build_object('version',1,'messages','[]'::jsonb)
      ),
      'event','Receipt',
      'data',jsonb_build_object(
        'Type','read','IsFromMe',true,'Timestamp','2026-09-26T00:00:00Z',
        'MessageIDs',jsonb_build_array('fixture-provider-read-2')
      )
    ),
    'notification WhatsApp receipt fixture-provider-read-2: reconciliation rejected outcome "not_found"'
  );

  update public.whatsapp_webhook_inbox
  set payload = jsonb_set(payload, '{data,IsFromMe}', '"true"'::jsonb)
  where id = v_second_id;
  v_outcome := private.defer_unmatched_whatsapp_receipt(
    v_second_id,'fixture-provider-read-2','2026-09-26T00:00:00Z'
  );
  if v_outcome <> 'not_eligible' then
    raise exception 'string IsFromMe accepted: %', v_outcome;
  end if;
  update public.whatsapp_webhook_inbox
  set payload = jsonb_set(payload, '{data,IsFromMe}', 'true'::jsonb)
  where id = v_second_id;

  update public.whatsapp_webhook_inbox
  set payload = payload #- '{data,Timestamp}'
  where id = v_second_id;
  v_outcome := private.defer_unmatched_whatsapp_receipt(
    v_second_id,'fixture-provider-read-2','2026-09-26T00:00:00Z'
  );
  if v_outcome <> 'not_eligible' then
    raise exception 'missing provider time accepted: %', v_outcome;
  end if;
  update public.whatsapp_webhook_inbox
  set payload = jsonb_set(payload, '{data,Timestamp}', '"2026-09-26T00:00:00Z"'::jsonb)
  where id = v_second_id;
  v_outcome := private.defer_unmatched_whatsapp_receipt(
    v_second_id,'fixture-provider-read-2','2026-09-26T00:00:01Z'
  );
  if v_outcome <> 'invalid_provider_id' then
    raise exception 'mismatched provider time accepted: %', v_outcome;
  end if;

  insert into public.whatsapp_messages
    (organization_id,session_id,message_id)
  values (
    '10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    'fixture-provider-read-2'
  );
  v_outcome := private.defer_unmatched_whatsapp_receipt(
    v_second_id,'fixture-provider-read-2','2026-09-26T00:00:00Z'
  );
  if v_outcome <> 'target_present' then
    raise exception 'canonical target not protected: %', v_outcome;
  end if;
  delete from public.whatsapp_messages where message_id='fixture-provider-read-2';

  update public.whatsapp_webhook_inbox
  set payload = jsonb_set(payload, '{data,MessageIDs}',
    '["fixture-provider-read-2","other"]'::jsonb)
  where id=v_second_id;
  v_outcome := private.defer_unmatched_whatsapp_receipt(
    v_second_id,'fixture-provider-read-2','2026-09-26T00:00:00Z'
  );
  if v_outcome <> 'mixed_or_message' then
    raise exception 'mixed IDs accepted: %', v_outcome;
  end if;
  update public.whatsapp_webhook_inbox
  set payload = jsonb_set(payload, '{data,MessageIDs}',
    '["fixture-provider-read-2"]'::jsonb)
  where id=v_second_id;

  -- A raw, unprocessed target is allowed: the ledger waits until the native
  -- processor materializes a canonical target. No read state is invented.
  insert into public.whatsapp_webhook_inbox (
    id,organization_id,session_id,processing_lane,event_type,status,
    attempts,max_attempts,created_at,updated_at,next_attempt_at,expires_at,
    payload,last_error
  ) values (
    '00000000-0000-4000-8000-000000000004',
    '10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    'backlog','album','dead',1,12,now(),now(),now(),now()+interval '25 days',
    jsonb_build_object('data',jsonb_build_object(
      'Info',jsonb_build_object('ID','fixture-provider-read-2')
    )),null
  );
  v_outcome := private.defer_unmatched_whatsapp_receipt(
    v_second_id,'fixture-provider-read-2','2026-09-26T00:00:00Z'
  );
  if v_outcome <> 'deferred' then
    raise exception 'raw target should wait, not block head: %', v_outcome;
  end if;

  update private.whatsapp_deferred_receipt_ledger
  set next_reconcile_at=now()-interval '1 second';
  select * into v_claim from private.claim_deferred_whatsapp_receipt_reconciliation(1);
  if v_claim.inbox_id is null or v_claim.claim_token is null
     or v_claim.reconcile_attempts <> 1 then
    raise exception 'claim contract failed';
  end if;
  select private.complete_deferred_whatsapp_receipt_reconciliation(
    v_claim.inbox_id,v_claim.organization_id,v_claim.session_id,
    v_claim.provider_message_id,gen_random_uuid(),v_claim.reconcile_attempts,
    'native_reconciled'
  ) into v_completed;
  if v_completed then
    raise exception 'completion accepted the wrong claim token';
  end if;
  select private.complete_deferred_whatsapp_receipt_reconciliation(
    v_claim.inbox_id,v_claim.organization_id,v_claim.session_id,
    v_claim.provider_message_id,v_claim.claim_token,v_claim.reconcile_attempts,
    'native_reconciled'
  ) into v_completed;
  if not v_completed then
    raise exception 'exact completion failed';
  end if;

  update private.whatsapp_deferred_receipt_ledger
  set expires_at=now()-interval '1 second';
  select c.deferred_overdue,c.resolved_expired
  into v_deferred_overdue,v_resolved_expired
  from private.cleanup_deferred_whatsapp_receipts(10) c;
  if v_deferred_overdue<>1 or v_resolved_expired<>1 then
    raise exception 'explicit cleanup counts failed: overdue %, resolved %',
      v_deferred_overdue,v_resolved_expired;
  end if;
  if (select count(*) from private.whatsapp_deferred_receipt_ledger
      where state='deferred') <> 1 then
    raise exception 'unresolved deferred status was deleted';
  end if;
end;
$test$;
