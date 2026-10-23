begin;

create extension if not exists pgtap with schema extensions;
select plan(31);

select ok(
  exists (
    select 1
    from pg_catalog.pg_index as index_state
    join pg_catalog.pg_class as index_class
      on index_class.oid = index_state.indexrelid
    where index_state.indrelid = 'public.whatsapp_conversations'::regclass
      and index_class.relname = 'whatsapp_conversations_active_session_remote_jid_uidx'
      and index_state.indisunique and index_state.indisvalid and index_state.indisready
      and index_state.indnkeyatts = 2
      and pg_catalog.pg_get_indexdef(index_state.indexrelid, 1, true) = 'session_id'
      and pg_catalog.pg_get_indexdef(index_state.indexrelid, 2, true) = 'remote_jid'
      and pg_catalog.regexp_replace(
        pg_catalog.lower(pg_catalog.pg_get_expr(index_state.indpred, index_state.indrelid)),
        '[[:space:]()]', '', 'g'
      ) = 'retired_atisnull'
  ) and not exists (
    select 1 from pg_catalog.pg_constraint as constraint_state
    where constraint_state.conrelid = 'public.whatsapp_conversations'::regclass
      and constraint_state.conname = 'whatsapp_conversations_session_id_remote_jid_key'
  ),
  'cutover retains a valid active-only unique arbiter before dropping full uniqueness'
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
) values (
  '00000000-0000-0000-0000-000000000000',
  'ba100000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
  'wa-epoch-owner@example.test', '', now(), '{}', '{}', now(), now(), '', '', '', ''
);

insert into public.organizations (id, name, slug, is_active)
values ('ba200000-0000-4000-8000-000000000001',
        'WA Epoch Test', 'wa-epoch-test', true);
insert into public.users (id, organization_id, name, email, role, is_active)
values ('ba100000-0000-4000-8000-000000000001',
        'ba200000-0000-4000-8000-000000000001',
        'Epoch Owner', 'wa-epoch-owner@example.test', 'admin', true)
on conflict (id) do update set
  organization_id = excluded.organization_id,
  name = excluded.name,
  email = excluded.email,
  role = excluded.role,
  is_active = excluded.is_active;
insert into public.organization_members (organization_id, user_id, role, is_active)
values ('ba200000-0000-4000-8000-000000000001',
        'ba100000-0000-4000-8000-000000000001', 'admin', true)
on conflict (user_id, organization_id) do update set
  role = excluded.role, is_active = excluded.is_active;
insert into public.whatsapp_sessions (
  id, organization_id, owner_user_id, instance_name, provider, status, is_active
) values (
  'ba400000-0000-4000-8000-000000000001',
  'ba200000-0000-4000-8000-000000000001',
  'ba100000-0000-4000-8000-000000000001',
  'wa-epoch-test', 'evolution_go', 'connected', true
);

insert into public.whatsapp_conversations (
  id, organization_id, session_id, remote_jid, contact_phone,
  contact_name, is_group, metadata
) values
  ('ba500000-0000-4000-8000-000000000001',
   'ba200000-0000-4000-8000-000000000001',
   'ba400000-0000-4000-8000-000000000001',
   '5511999990001@s.whatsapp.net', '5511999990001', 'Ephemeral Person', false,
   '{"test_private_preview":"remove"}'::jsonb),
  ('ba500000-0000-4000-8000-000000000002',
   'ba200000-0000-4000-8000-000000000001',
   'ba400000-0000-4000-8000-000000000001',
   '5511999990002@s.whatsapp.net', '5511999990002', 'Promoted Person', false,
   '{}'::jsonb);

insert into public.whatsapp_messages (
  id, organization_id, conversation_id, session_id, lead_id,
  provider_message_id, message_id, from_me, direction, message_type,
  content, media_storage_path, media_status, remote_jid, status,
  capture_state
) values
  ('ba600000-0000-4000-8000-000000000001',
   'ba200000-0000-4000-8000-000000000001',
   'ba500000-0000-4000-8000-000000000001',
   'ba400000-0000-4000-8000-000000000001', null,
   'wa-epoch-old-provider', 'wa-epoch-old-provider', false, 'inbound', 'image',
   'Private image caption',
   'orgs/ba200000-0000-4000-8000-000000000001/assets/v2/old-image.webp',
   'ready', '5511999990001@s.whatsapp.net', 'received', 'unlinked_ephemeral'),
  ('ba600000-0000-4000-8000-000000000002',
   'ba200000-0000-4000-8000-000000000001',
   'ba500000-0000-4000-8000-000000000002',
   'ba400000-0000-4000-8000-000000000001', null,
   'wa-epoch-promoted-provider', 'wa-epoch-promoted-provider', false, 'inbound', 'text',
    'Keep after promotion', null, null,
    '5511999990002@s.whatsapp.net', 'received', 'unlinked_ephemeral');

insert into public.media_jobs (
  id, organization_id, session_id, conversation_id, message_id,
  message_key, media_type, status
) values (
  'ba700000-0000-4000-8000-000000000001',
  'ba200000-0000-4000-8000-000000000001',
  'ba400000-0000-4000-8000-000000000001',
  'ba500000-0000-4000-8000-000000000001',
  'ba600000-0000-4000-8000-000000000001',
  '{}'::jsonb, 'image', 'pending'
);

select ok(
  (select unlinked_retention_v1 from public.whatsapp_conversations
   where id = 'ba500000-0000-4000-8000-000000000001'),
  'first unlinked inbound insert atomically marks the physical conversation'
);

select is(
  (private.capture_whatsapp_webhook_routing_snapshot_v2(
    'ba200000-0000-4000-8000-000000000001',
    'ba400000-0000-4000-8000-000000000001',
    'wa-epoch-fresh-snapshot', 'wa-epoch-fresh-event', 'live',
    'phone:5511999990001', false,
    array['5511999990001@s.whatsapp.net'], '5511999990001',
    'organic', null, false, false, false, null, null, null, 0
  )->>'unlinked_capture_policy'),
  'v1'::text,
  'new immutable routing snapshot opts into prospective unlinked capture'
);

select is(
  (select snapshot->>'unlinked_capture_policy'
   from public.whatsapp_webhook_routing_snapshots
   where provider_message_id = 'wa-epoch-fresh-snapshot'),
  'v1'::text,
  'the prospective marker is persisted before a webhook replay'
);

insert into public.whatsapp_webhook_routing_snapshots (
  organization_id, session_id, provider_message_id, inbox_event_key,
  processing_lane, routing_key, binding_eligible, target_mode,
  processing_epoch, snapshot
) values (
  'ba200000-0000-4000-8000-000000000001',
  'ba400000-0000-4000-8000-000000000001',
  'wa-epoch-old-snapshot', 'wa-epoch-old-event',
  'live', 'phone:5511999990001', false, 'snapshot', 0,
  '{"version":1,"state":"unlinked","captured_at":"2026-10-01T00:00:00Z"}'::jsonb
);

select is(
  (private.capture_whatsapp_webhook_routing_snapshot_v2(
    'ba200000-0000-4000-8000-000000000001',
    'ba400000-0000-4000-8000-000000000001',
    'wa-epoch-old-snapshot', 'wa-epoch-old-event', 'live',
    'phone:5511999990001', false,
    array['5511999990001@s.whatsapp.net'], '5511999990001',
    'organic', null, false, false, false, null, null, null, 0
  )->>'unlinked_capture_policy'),
  null::text,
  'exact provider replay returns the old snapshot without a new marker'
);

insert into public.leads (id, organization_id, assigned_user_id, name, phone, source)
values ('ba300000-0000-4000-8000-000000000001',
        'ba200000-0000-4000-8000-000000000001',
        'ba100000-0000-4000-8000-000000000001',
        'Promoted Lead', '5511999990002', 'whatsapp');
do $$
begin
  perform public.confirm_whatsapp_unlinked_history_binding(
    'ba200000-0000-4000-8000-000000000001',
    'ba500000-0000-4000-8000-000000000002',
    'ba300000-0000-4000-8000-000000000001',
    null,
    'ba100000-0000-4000-8000-000000000001',
    'manual_link'
  );
end;
$$;

select is(
  (select capture_state from public.whatsapp_messages
   where id = 'ba600000-0000-4000-8000-000000000002'),
  'promoted_unlinked'::text,
  'pre-expiry promotion preserves origin without retroactive INSERT effects'
);
select is(
  (select lead_id from public.whatsapp_messages
   where id = 'ba600000-0000-4000-8000-000000000002'),
  'ba300000-0000-4000-8000-000000000001'::uuid,
  'promotion transaction backfills only the same conversation messages'
);
select ok(
  (select not unlinked_retention_v1 from public.whatsapp_conversations
   where id = 'ba500000-0000-4000-8000-000000000002'),
  'promoted conversation exits seven-day retention'
);

update public.whatsapp_conversations
set created_at = now() - interval '8 days'
where id in (
  'ba500000-0000-4000-8000-000000000001',
  'ba500000-0000-4000-8000-000000000002'
);

-- A claimed media job represents provider/Storage I/O outside this SQL
-- transaction. Retention must wait until the lease is released and cannot
-- admit a fresh job after the seven-day cutoff.
update public.media_jobs
set status = 'processing',
    locked_at = now(),
    lease_expires_at = now() + interval '5 minutes',
    lease_duration = interval '5 minutes',
    locked_by = 'epoch-test-media-worker',
    lease_token = pg_catalog.gen_random_uuid(),
    processing_slot = 1
where id = 'ba700000-0000-4000-8000-000000000001';

select is(
  (private.scrub_expired_whatsapp_unlinked_conversations(500)->>'status'),
  'idle'::text,
  'retention does not scrub a conversation with a claimed media job'
);
select is(
  (select content from public.whatsapp_messages
   where id = 'ba600000-0000-4000-8000-000000000001'),
  'Private image caption'::text,
  'claimed media work leaves message content intact until its lease clears'
);
select throws_ok(
  $$insert into public.media_jobs (
      id, organization_id, session_id, conversation_id, message_id,
      message_key, media_type, status
    ) values (
      'ba700000-0000-4000-8000-000000000002',
      'ba200000-0000-4000-8000-000000000001',
      'ba400000-0000-4000-8000-000000000001',
      'ba500000-0000-4000-8000-000000000001',
      'ba600000-0000-4000-8000-000000000001',
      '{}'::jsonb, 'image', 'pending'
    )$$,
  '23514', 'expired_unlinked_media_job_forbidden',
  'new media work cannot enter the expired epoch during retention'
);

update public.media_jobs
set status = 'pending',
    locked_at = null,
    lease_expires_at = null,
    lease_duration = null,
    locked_by = null,
    lease_token = null,
    processing_slot = null
where id = 'ba700000-0000-4000-8000-000000000001';

select is(
  (private.capture_whatsapp_webhook_routing_snapshot_v2(
    'ba200000-0000-4000-8000-000000000001',
    'ba400000-0000-4000-8000-000000000001',
    'wa-epoch-day-eight', 'wa-epoch-day-eight-event', 'live',
    'phone:5511999990001', false,
    array['5511999990001@s.whatsapp.net'], '5511999990001',
    'organic', null, false, false, false, null, null, null, 0
  )->>'expired_unlinked_conversation_id'),
  'ba500000-0000-4000-8000-000000000001'::text,
  'day-eight fresh snapshot freezes the exact expired physical route'
);
select is(
  (select snapshot->>'expired_unlinked_remote_jid'
   from public.whatsapp_webhook_routing_snapshots
   where provider_message_id = 'wa-epoch-day-eight'),
  '5511999990001@s.whatsapp.net'::text,
  'rollover snapshot freezes the canonical stored JID for CAS retirement'
);
select is(
  (select snapshot->>'conversation_id'
   from public.whatsapp_webhook_routing_snapshots
   where provider_message_id = 'wa-epoch-day-eight'),
  null::text,
  'fresh post-cutoff event does not inherit the expired conversation ID'
);

select is(
  (public.retire_whatsapp_unlinked_conversation_epoch(
    'ba200000-0000-4000-8000-000000000001',
    'ba400000-0000-4000-8000-000000000001',
    'ba500000-0000-4000-8000-000000000001',
    '5511999990001@s.whatsapp.net'
  )->>'reason'),
  'expired'::text,
  'exact CAS retirement succeeds after partial-unique cutover'
);
select ok(
  (select retired_at is not null from public.whatsapp_conversations
   where id = 'ba500000-0000-4000-8000-000000000001'),
  'old route remains as a retired replay tombstone'
);

insert into public.whatsapp_conversations (
  id, organization_id, session_id, remote_jid, contact_phone,
  contact_name, is_group
) values (
  'ba500000-0000-4000-8000-000000000003',
  'ba200000-0000-4000-8000-000000000001',
  'ba400000-0000-4000-8000-000000000001',
  '5511999990001@s.whatsapp.net', '5511999990001', 'New Epoch', false
);

select is(
  (select count(*)::bigint from public.whatsapp_conversations
   where session_id = 'ba400000-0000-4000-8000-000000000001'
     and remote_jid = '5511999990001@s.whatsapp.net'),
  2::bigint,
  'day-eight inbound can create a new conversation ID for the same session/JID'
);

select is(
  (private.scrub_expired_whatsapp_unlinked_conversations(500)->>'status'),
  'processed'::text,
  'bounded retention worker processes one expired conversation'
);
select is(
  (select count(*)::bigint from public.media_jobs
   where conversation_id = 'ba500000-0000-4000-8000-000000000001'),
  0::bigint,
  'scrub deletes the pending media job after fencing concurrent claims'
);
select ok(
  (select content is null and media_storage_path is null
     and unlinked_retention_scrubbed_at is not null
   from public.whatsapp_messages
   where id = 'ba600000-0000-4000-8000-000000000001'),
  'old message content, media reference and sender metadata are scrubbed'
);
select is(
  (select provider_message_id from public.whatsapp_messages
   where id = 'ba600000-0000-4000-8000-000000000001'),
  'wa-epoch-old-provider'::text,
  'provider identity remains as a minimal replay tombstone'
);
select ok(
  (select contact_name is null and contact_phone is null
     and last_message_preview is null
     and unlinked_retention_scrubbed_at is not null
   from public.whatsapp_conversations
   where id = 'ba500000-0000-4000-8000-000000000001'),
  'expired conversation preview and contact fields are scrubbed'
);
select is(
  (select count(*)::bigint from private.whatsapp_unlinked_media_gc
   where organization_id = 'ba200000-0000-4000-8000-000000000001'
     and object_path =
       'orgs/ba200000-0000-4000-8000-000000000001/assets/v2/old-image.webp'),
  1::bigint,
  'Storage deletion is queued before the message media path is removed'
);
select ok(
  (select content = 'Keep after promotion'
   from public.whatsapp_messages
   where id = 'ba600000-0000-4000-8000-000000000002'),
  'promoted lead message is preserved after the old no-lead epoch expires'
);
-- The same content-addressed Storage object may be used by a live lead.
-- Its expired source alone must not make the object eligible for deletion.
update public.whatsapp_messages
set message_type = 'image', media_status = 'ready',
    media_storage_path =
      'orgs/ba200000-0000-4000-8000-000000000001/assets/v2/old-image.webp'
where id = 'ba600000-0000-4000-8000-000000000002';
select is(
  (select count(*)::bigint from private.claim_whatsapp_unlinked_media_gc(
    'epoch-test-worker', 5, interval '5 minutes'
  )),
  0::bigint,
  'a live lead message sharing the expired object prevents Storage GC claim'
);
update public.whatsapp_messages
set message_type = 'text', media_status = null, media_storage_path = null
where id = 'ba600000-0000-4000-8000-000000000002';
select is(
  (select count(*)::bigint
   from private.claim_whatsapp_unlinked_media_gc('epoch-test-worker', 5, interval '5 minutes')),
  1::bigint,
  'Storage worker can claim an unreferenced expired object'
);
select throws_ok(
  $$update public.whatsapp_messages
      set message_type = 'image', media_status = 'ready',
          media_storage_path =
            'orgs/ba200000-0000-4000-8000-000000000001/assets/v2/old-image.webp'
      where id = 'ba600000-0000-4000-8000-000000000002'$$,
  '40001', 'whatsapp_media_gc_path_unavailable',
  'a live message cannot attach the path while Storage deletion is in progress'
);
select ok(
  (select private.whatsapp_unlinked_media_gc_can_delete(gc.id, 'epoch-test-worker')
   from private.whatsapp_unlinked_media_gc as gc
   where gc.organization_id = 'ba200000-0000-4000-8000-000000000001'
     and gc.status = 'processing'),
  'Storage worker revalidates ownership and live references under a row lock'
);
select ok(
  (select private.complete_whatsapp_unlinked_media_gc(
    gc.id, 'epoch-test-worker', true, null
  )
   from private.whatsapp_unlinked_media_gc as gc
   where gc.organization_id = 'ba200000-0000-4000-8000-000000000001'
     and gc.status = 'processing'),
  'Storage worker marks a deleted object complete under its lease'
);

-- HTTP 503 is classified by the Go worker; the DB must eventually expose
-- that retry loop as a terminal job rather than silently dropping the object.
insert into private.whatsapp_unlinked_media_gc (
  organization_id, bucket_id, object_path, source_conversation_id
) values (
  'ba200000-0000-4000-8000-000000000001', 'whatsapp-media',
  'orgs/ba200000-0000-4000-8000-000000000001/assets/v2/terminal.webp',
  'ba500000-0000-4000-8000-000000000001'
);
do $terminal_retry$
declare
  v_job private.whatsapp_unlinked_media_gc%rowtype;
begin
  for v_attempt in 1..12 loop
    select * into v_job
    from private.claim_whatsapp_unlinked_media_gc(
      'epoch-test-worker', 1, interval '5 minutes'
    );
    if v_job.id is null or not private.complete_whatsapp_unlinked_media_gc(
      v_job.id, 'epoch-test-worker', false, 'storage_http_503'
    ) then
      raise exception 'terminal GC test lost its claim at attempt %', v_attempt;
    end if;
    update private.whatsapp_unlinked_media_gc
    set next_attempt_at = clock_timestamp() - interval '1 second'
    where id = v_job.id and status = 'retry';
  end loop;
end;
$terminal_retry$;
select ok(
  (select status = 'failed' and attempts = 12
          and last_error = 'storage_http_503'
   from private.whatsapp_unlinked_media_gc
   where object_path =
     'orgs/ba200000-0000-4000-8000-000000000001/assets/v2/terminal.webp'),
  'twelve failed Storage deletes leave a terminal job with a fixed reason code'
);
select is(
  (select count(*)::bigint from private.claim_whatsapp_unlinked_media_gc(
    'epoch-test-worker', 5, interval '5 minutes'
  )),
  0::bigint,
  'terminal Storage job is not claimed again without explicit remediation'
);

select * from finish();
rollback;
