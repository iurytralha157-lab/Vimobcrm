-- PRELOAD only: create private ledgers/functions before rolling out the API.
-- Old lead content stays in the inbox and in a private, permanent raw audit
-- during the recovery grace. No routing outcome or CRM message is fabricated.
begin;
set local lock_timeout = '250ms';
set local statement_timeout = '4s';
set local transaction_timeout = '5s';

create table private.whatsapp_failed_route_epoch_fences (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  session_id uuid not null,
  routing_key text not null,
  root_inbox_id uuid not null unique,
  cutoff_ingress_sequence bigint not null check (cutoff_ingress_sequence > 0),
  conversation_id uuid not null,
  lead_id_at_fence uuid not null,
  binding_id_at_fence uuid not null,
  state text not null default 'held' check (state in ('held','quarantined')),
  held_count integer not null check (held_count between 0 and 500),
  held_at timestamptz not null default clock_timestamp(),
  quarantine_after timestamptz not null,
  last_reconcile_attempt_at timestamptz,
  quarantined_at timestamptz,
  check (quarantine_after >= held_at + interval '10 minutes'),
  check ((state = 'held' and quarantined_at is null)
      or (state = 'quarantined' and quarantined_at is not null)),
  unique (organization_id,session_id,routing_key,cutoff_ingress_sequence)
);
create index whatsapp_failed_route_epoch_latest_idx
  on private.whatsapp_failed_route_epoch_fences
  (organization_id,session_id,routing_key,cutoff_ingress_sequence desc);
alter table private.whatsapp_failed_route_epoch_fences enable row level security;
revoke all on private.whatsapp_failed_route_epoch_fences
  from public, anon, authenticated, service_role;

create table private.whatsapp_failed_route_epoch_raw (
  inbox_id uuid primary key,
  fence_id uuid not null references private.whatsapp_failed_route_epoch_fences(id),
  organization_id uuid not null,
  session_id uuid not null,
  routing_key text not null,
  provider_message_id text not null,
  ingress_sequence bigint not null,
  original_inbox jsonb not null,
  original_route_snapshot jsonb not null,
  payload_sha256 text not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  original_status text not null,
  captured_conversation_id uuid,
  captured_lead_id uuid,
  captured_binding_id uuid,
  audited_at timestamptz not null default clock_timestamp(),
  retained_until timestamptz not null default 'infinity'::timestamptz
    check (retained_until = 'infinity'::timestamptz),
  reason text not null check (reason in
    ('failed_predecessor_held:v1','failed_predecessor_replay:v1')),
  check (original_status in ('pending','retry','dead'))
);
create index whatsapp_failed_route_epoch_raw_fence_idx
  on private.whatsapp_failed_route_epoch_raw (fence_id,ingress_sequence);
alter table private.whatsapp_failed_route_epoch_raw enable row level security;
revoke all on private.whatsapp_failed_route_epoch_raw
  from public, anon, authenticated, service_role;

-- No PII or raw payload is exposed by this operational alarm table.
create table private.whatsapp_failed_route_epoch_alerts (
  organization_id uuid not null,
  session_id uuid not null,
  routing_key_hash text not null check (routing_key_hash ~ '^[0-9a-f]{32}$'),
  reason text not null check (reason ~ '^[a-z0-9_]{1,80}$'),
  first_seen_at timestamptz not null default clock_timestamp(),
  last_seen_at timestamptz not null default clock_timestamp(),
  occurrences bigint not null default 1 check (occurrences > 0),
  primary key (organization_id,session_id,routing_key_hash,reason)
);
alter table private.whatsapp_failed_route_epoch_alerts enable row level security;
revoke all on private.whatsapp_failed_route_epoch_alerts
  from public, anon, authenticated, service_role;

-- Populated only when the worker marks a deterministic unsupported message
-- DEAD. Capture therefore does an indexed lookup rather than scanning DLQ
-- rows for each incoming message. ACTIVATE backfills exact historical roots.
create table private.whatsapp_failed_route_candidates (
  root_inbox_id uuid primary key,
  organization_id uuid not null,
  session_id uuid not null,
  routing_key text not null,
  provider_message_id text,
  ingress_sequence bigint,
  original_inbox jsonb not null,
  payload_sha256 text not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  recorded_at timestamptz not null default clock_timestamp(),
  last_reconcile_attempt_at timestamptz,
  retained_until timestamptz not null default 'infinity'::timestamptz
    check (retained_until = 'infinity'::timestamptz)
);
create index whatsapp_failed_route_candidates_route_idx
  on private.whatsapp_failed_route_candidates
  (organization_id,session_id,routing_key,ingress_sequence);
create index whatsapp_failed_route_candidates_reconcile_idx
  on private.whatsapp_failed_route_candidates
  (last_reconcile_attempt_at,recorded_at,root_inbox_id);
alter table private.whatsapp_failed_route_candidates enable row level security;
revoke all on private.whatsapp_failed_route_candidates
  from public, anon, authenticated, service_role;

-- A new event on a failed route with no provable current identity is accepted
-- durably but never sent to native processing. Mixed envelopes are kept whole
-- here for manual split/reconciliation, without a lead assignment.
create table private.whatsapp_failed_route_unproven_ingress_raw (
  inbox_id uuid primary key,
  organization_id uuid not null,
  session_id uuid not null,
  routing_key_hash text not null check (routing_key_hash ~ '^[0-9a-f]{32}$'),
  original_inbox jsonb not null,
  payload_sha256 text not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  audited_at timestamptz not null default clock_timestamp(),
  retained_until timestamptz not null default 'infinity'::timestamptz
    check (retained_until = 'infinity'::timestamptz),
  reason text not null default 'failed_route_identity_unproven:v1'
    check (reason = 'failed_route_identity_unproven:v1')
);
alter table private.whatsapp_failed_route_unproven_ingress_raw enable row level security;
revoke all on private.whatsapp_failed_route_unproven_ingress_raw
  from public, anon, authenticated, service_role;

-- A non-splittable mixed callback is stored here before acknowledging the
-- provider. The ingress isolates it before route capture; the fallback path
-- rolls tentative capture back to a savepoint in the same transaction.
-- Other contacts get no DEAD predecessor from that callback.
create table private.whatsapp_failed_route_mixed_envelope_raw (
  organization_id uuid not null,
  session_id uuid not null,
  event_key text not null,
  event_type text not null,
  original_payload jsonb not null,
  payload_sha256 text not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  audited_at timestamptz not null default clock_timestamp(),
  retained_until timestamptz not null default 'infinity'::timestamptz
    check (retained_until = 'infinity'::timestamptz),
  reason text not null check (reason in (
    'failed_route_mixed_identity_unproven:v1',
    'failed_route_mixed_member_unsupported:v1',
    'failed_route_mixed_unsplit_requires_review:v1')),
  primary key (organization_id,session_id,event_key)
);
alter table private.whatsapp_failed_route_mixed_envelope_raw enable row level security;
revoke all on private.whatsapp_failed_route_mixed_envelope_raw
  from public, anon, authenticated, service_role;

-- All writers, including old API replicas during rollout, must serialize a
-- public inbox receipt against a private mixed-envelope receipt. Capture
-- already locks route first, so the Go path takes this event lock only after
-- capture and before either destination commits.
create or replace function private.guard_failed_route_mixed_receipt_before_insert()
returns trigger language plpgsql security definer set search_path = '' as $function$
begin
  if new.provider is distinct from 'evolution_go' then return new; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'failed_route_mixed:' || new.organization_id::text || ':' ||
    new.session_id::text || ':' || new.event_key,0));
  if exists (select 1 from private.whatsapp_failed_route_mixed_envelope_raw as raw
    where raw.organization_id = new.organization_id
      and raw.session_id = new.session_id and raw.event_key = new.event_key) then
    raise exception using errcode = '23505',
      message = 'failed_route_mixed_receipt_already_audited';
  end if;
  return new;
end;
$function$;
revoke all on function private.guard_failed_route_mixed_receipt_before_insert()
  from public, anon, authenticated, service_role;

create or replace function private.whatsapp_failed_route_alert(
  p_organization_id uuid, p_session_id uuid, p_routing_key text, p_reason text
) returns void language plpgsql security definer set search_path = '' as $function$
begin
  if p_reason !~ '^[a-z0-9_]{1,80}$' then
    raise exception 'failed_route_alert_reason_invalid';
  end if;
  insert into private.whatsapp_failed_route_epoch_alerts (
    organization_id,session_id,routing_key_hash,reason
  ) values (p_organization_id,p_session_id,pg_catalog.md5(p_routing_key),p_reason)
  on conflict (organization_id,session_id,routing_key_hash,reason)
  do update set last_seen_at = clock_timestamp(),
    occurrences = private.whatsapp_failed_route_epoch_alerts.occurrences + 1;
end;
$function$;
revoke all on function private.whatsapp_failed_route_alert(uuid,uuid,text,text)
  from public, anon, authenticated, service_role;

create or replace function private.record_failed_whatsapp_route_candidate()
returns trigger language plpgsql security definer set search_path = '' as $function$
declare
  v_route public.whatsapp_webhook_routing_snapshots%rowtype;
  v_key text;
  v_provider_id text;
  v_messages jsonb;
begin
  if new.status is distinct from 'dead'
     or old.status = 'dead'
     or new.provider is distinct from 'evolution_go'
     or new.event_type is distinct from 'message'
     or coalesce(new.last_error,'') not in (
       'native WhatsApp processor does not support this event',
       'native WhatsApp processor rejected an unsupported message-like event') then
    return new;
  end if;
  v_messages := new.payload #> '{__vimob_ingress,routing_snapshot,messages}';
  if pg_catalog.jsonb_typeof(v_messages) is distinct from 'array' then
    return new;
  end if;
  if pg_catalog.jsonb_array_length(v_messages) <> 1 then
    return new; -- Multi-member callbacks are guarded before inbox insertion.
  end if;
  v_key := v_messages #>> '{0,routing_key}';
  v_provider_id := v_messages #>> '{0,provider_message_id}';
  if pg_catalog.btrim(coalesce(v_key,'')) = ''
     or pg_catalog.btrim(coalesce(v_provider_id,'')) = '' then
    return new;
  end if;
  select route.* into v_route
  from public.whatsapp_webhook_routing_snapshots as route
  where route.organization_id = new.organization_id
    and route.session_id = new.session_id
    and route.provider_message_id = v_provider_id;
  -- An unsupported singleton whose immutable ledger is ineligible cannot be
  -- selected as any future predecessor. Preserve its DEAD inbox raw, but do
  -- not fence a healthy route or quarantine later lead messages.
  if v_route.provider_message_id is not null
     and v_route.snapshot = v_messages -> 0
     and v_route.inbox_event_key = new.event_key
     and v_route.processing_lane = new.processing_lane
     and v_route.routing_key = v_key
     and v_route.binding_eligible is distinct from true then
    return new;
  end if;
  insert into private.whatsapp_failed_route_candidates (
    root_inbox_id,organization_id,session_id,routing_key,
    provider_message_id,ingress_sequence,original_inbox,payload_sha256
  ) values (
    new.id,new.organization_id,new.session_id,v_key,
    v_provider_id,v_route.ingress_sequence,
    pg_catalog.to_jsonb(old),private.canonical_jsonb_sha256(new.payload)
  ) on conflict (root_inbox_id) do nothing;
  if v_route.provider_message_id is null
     or v_route.routing_key is distinct from v_key
     or v_route.inbox_event_key is distinct from new.event_key
     or v_route.processing_lane is distinct from new.processing_lane
     or v_route.snapshot is distinct from new.payload #>
       '{__vimob_ingress,routing_snapshot,messages,0}' then
    perform private.whatsapp_failed_route_alert(
      new.organization_id,new.session_id,v_key,'unsupported_root_provenance_missing');
  end if;
  return new;
end;
$function$;
revoke all on function private.record_failed_whatsapp_route_candidate()
  from public, anon, authenticated, service_role;

-- This helper is called under the capture function's route advisory lock,
-- before that function acquires its conversation/binding locks. It locks the
-- inbox first, then the exact current conversation and binding.
create or replace function private.try_hold_failed_whatsapp_route_epoch(
  p_organization_id uuid,
  p_session_id uuid,
  p_routing_key text,
  p_contact_phone text
) returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  v_prior_cutoff bigint;
  v_candidate private.whatsapp_failed_route_candidates%rowtype;
  v_root public.whatsapp_webhook_inbox%rowtype;
  v_root_route public.whatsapp_webhook_routing_snapshots%rowtype;
  v_conversation public.whatsapp_conversations%rowtype;
  v_binding public.whatsapp_conversation_lead_bindings%rowtype;
  v_chain text[];
  v_cutoff bigint;
  v_active integer;
  v_bad integer;
  v_extra_dead integer;
  v_raw integer;
  v_fence_id uuid;
  v_at timestamptz;
  v_snapshot jsonb;
  v_messages jsonb;
begin
  if p_routing_key = '__session__' or p_routing_key not like 'phone:%'
     or public.normalize_phone(p_contact_phone) is distinct from
       pg_catalog.substring(p_routing_key,7) then
    if exists (select 1 from private.whatsapp_failed_route_candidates as candidate
      where candidate.organization_id = p_organization_id
        and candidate.session_id = p_session_id
        and candidate.routing_key = p_routing_key) then
      perform private.whatsapp_failed_route_alert(
        p_organization_id,p_session_id,p_routing_key,'route_identity_unproven');
      return pg_catalog.jsonb_build_object('state','no_go','reason','route_identity_unproven');
    end if;
    return pg_catalog.jsonb_build_object('state','none');
  end if;
  -- The caller already owns this advisory key. Reentrant acquisition makes
  -- direct test/operator invocation obey the same lock order.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_organization_id::text || ':' || p_session_id::text || ':' || p_routing_key,0));
  select coalesce(max(fence.cutoff_ingress_sequence),0) into v_prior_cutoff
  from private.whatsapp_failed_route_epoch_fences as fence
  where fence.organization_id = p_organization_id
    and fence.session_id = p_session_id and fence.routing_key = p_routing_key;
  select candidate.* into v_candidate
  from private.whatsapp_failed_route_candidates as candidate
  where candidate.organization_id = p_organization_id
    and candidate.session_id = p_session_id
    and candidate.routing_key = p_routing_key
    and (candidate.ingress_sequence is null
      or candidate.ingress_sequence > v_prior_cutoff)
  order by candidate.ingress_sequence nulls first,candidate.recorded_at
  limit 1;
  if not found then return pg_catalog.jsonb_build_object('state','none'); end if;
  if v_candidate.ingress_sequence is null then
    perform private.whatsapp_failed_route_alert(
      p_organization_id,p_session_id,p_routing_key,'unsupported_root_ledger_missing');
    return pg_catalog.jsonb_build_object('state','no_go','reason','unsupported_root_ledger_missing');
  end if;
  select inbox.* into v_root
  from public.whatsapp_webhook_inbox as inbox
  join public.whatsapp_webhook_routing_snapshots as route
    on route.organization_id = inbox.organization_id
   and route.session_id = inbox.session_id
   and route.provider_message_id = inbox.payload #>>
     '{__vimob_ingress,routing_snapshot,messages,0,provider_message_id}'
  where inbox.organization_id = p_organization_id
    and inbox.session_id = p_session_id
    and inbox.id = v_candidate.root_inbox_id
    and v_candidate.ingress_sequence = route.ingress_sequence
    and v_candidate.payload_sha256 = private.canonical_jsonb_sha256(inbox.payload)
    and inbox.payload #>>
      '{__vimob_ingress,routing_snapshot,messages,0,routing_key}' = p_routing_key
    and inbox.status = 'dead'
    and inbox.provider = 'evolution_go' and inbox.event_type = 'message'
    and inbox.last_error in (
      'native WhatsApp processor does not support this event',
      'native WhatsApp processor rejected an unsupported message-like event')
    and route.routing_key = p_routing_key
    and route.ingress_sequence > v_prior_cutoff
    and not exists (select 1 from public.whatsapp_webhook_routing_outcomes as outcome
      where outcome.organization_id = route.organization_id
        and outcome.session_id = route.session_id
        and outcome.provider_message_id = route.provider_message_id
        and outcome.ingress_sequence = route.ingress_sequence)
  order by route.ingress_sequence
  limit 1;
  if not found then
    perform private.whatsapp_failed_route_alert(
      p_organization_id,p_session_id,p_routing_key,'unsupported_root_identity_changed');
    return pg_catalog.jsonb_build_object('state','no_go','reason','unsupported_root_identity_changed');
  end if;
  select route.* into v_root_route
  from public.whatsapp_webhook_routing_snapshots as route
  where route.organization_id = p_organization_id
    and route.session_id = p_session_id
    and route.provider_message_id = v_root.payload #>>
      '{__vimob_ingress,routing_snapshot,messages,0,provider_message_id}'
  for key share of route;
  if not found then
    perform private.whatsapp_failed_route_alert(
      p_organization_id,p_session_id,p_routing_key,'unsupported_root_ledger_missing');
    return pg_catalog.jsonb_build_object('state','no_go','reason','unsupported_root_ledger_missing');
  end if;
  -- Lock all live rows on the route before current lead identity. A running
  -- worker, malformed envelope, or a large chain refuses the automatic fence.
  perform inbox.id from public.whatsapp_webhook_inbox as inbox
  where inbox.organization_id = p_organization_id
    and inbox.session_id = p_session_id
    and inbox.payload #>>
      '{__vimob_ingress,routing_snapshot,messages,0,routing_key}' = p_routing_key
    and inbox.status in ('pending','retry','processing')
    and not exists (select 1
      from private.whatsapp_failed_route_epoch_raw as prior_audit
      join private.whatsapp_failed_route_epoch_fences as prior_fence
        on prior_fence.id = prior_audit.fence_id
      where prior_audit.inbox_id = inbox.id
        and prior_audit.reason = 'failed_predecessor_held:v1'
        and prior_fence.organization_id = p_organization_id
        and prior_fence.session_id = p_session_id
        and prior_fence.routing_key = p_routing_key
        and prior_fence.cutoff_ingress_sequence <= v_prior_cutoff)
  order by inbox.id for update of inbox;
  select count(*)::integer into v_active
  from public.whatsapp_webhook_inbox as inbox
  where inbox.organization_id = p_organization_id
    and inbox.session_id = p_session_id
    and inbox.payload #>>
      '{__vimob_ingress,routing_snapshot,messages,0,routing_key}' = p_routing_key
    and inbox.status in ('pending','retry','processing')
    and not exists (select 1
      from private.whatsapp_failed_route_epoch_raw as prior_audit
      join private.whatsapp_failed_route_epoch_fences as prior_fence
        on prior_fence.id = prior_audit.fence_id
      where prior_audit.inbox_id = inbox.id
        and prior_audit.reason = 'failed_predecessor_held:v1'
        and prior_fence.organization_id = p_organization_id
        and prior_fence.session_id = p_session_id
        and prior_fence.routing_key = p_routing_key
        and prior_fence.cutoff_ingress_sequence <= v_prior_cutoff);
  if v_active > 500 then
    perform private.whatsapp_failed_route_alert(
      p_organization_id,p_session_id,p_routing_key,'active_limit_exceeded');
    return pg_catalog.jsonb_build_object('state','no_go','reason','active_limit_exceeded');
  end if;
  select inbox.* into v_root from public.whatsapp_webhook_inbox as inbox
  where inbox.id = v_root.id for update;
  v_messages := v_root.payload #> '{__vimob_ingress,routing_snapshot,messages}';
  if v_root.status is distinct from 'dead'
     or v_root.attempts < v_root.max_attempts
     or v_root.dead_lettered_at is null
     or coalesce(v_root.last_error,'') not in (
       'native WhatsApp processor does not support this event',
       'native WhatsApp processor rejected an unsupported message-like event')
     or v_root.locked_at is not null or v_root.locked_by is not null
     or v_root.payload #>> '{__vimob_ingress,routing_snapshot,version}' is distinct from '1'
     or pg_catalog.jsonb_typeof(v_messages) is distinct from 'array' then
    perform private.whatsapp_failed_route_alert(
      p_organization_id,p_session_id,p_routing_key,'root_changed');
    return pg_catalog.jsonb_build_object('state','no_go','reason','root_changed');
  end if;
  if pg_catalog.jsonb_array_length(v_messages) <> 1 then
    perform private.whatsapp_failed_route_alert(
      p_organization_id,p_session_id,p_routing_key,'root_batch_ambiguous');
    return pg_catalog.jsonb_build_object('state','no_go','reason','root_batch_ambiguous');
  end if;
  v_snapshot := v_messages -> 0;
  if v_root.event_key is distinct from v_root_route.inbox_event_key
     or v_root.processing_lane is distinct from v_root_route.processing_lane
     or v_snapshot is distinct from v_root_route.snapshot
     or v_root_route.provider_message_id is distinct from
       v_root.payload #>>
         '{__vimob_ingress,routing_snapshot,messages,0,provider_message_id}'
     or v_root_route.binding_eligible is distinct from true
     or not ((v_root_route.target_mode = 'inherit_predecessor'
          and v_snapshot ->> 'state' = 'predecessor_inherit')
       or (v_root_route.target_mode = 'snapshot'
          and v_snapshot ->> 'state' = 'bound'
          and v_root_route.predecessor_provider_message_id is null))
     or v_snapshot ->> 'context_kind' is distinct from 'organic'
     or v_snapshot ->> 'context_proof' is not null
     or exists (select 1 from public.whatsapp_messages as message
       where message.organization_id = p_organization_id
         and message.session_id = p_session_id
         and (message.provider_message_id = v_root_route.provider_message_id
           or message.message_id = v_root_route.provider_message_id
           or message.client_message_id = v_root_route.provider_message_id)) then
    perform private.whatsapp_failed_route_alert(
      p_organization_id,p_session_id,p_routing_key,'root_proof_failed');
    return pg_catalog.jsonb_build_object('state','no_go','reason','root_proof_failed');
  end if;
  select coalesce(max(route.ingress_sequence),0) into v_cutoff
  from public.whatsapp_webhook_routing_snapshots as route
  where route.organization_id = p_organization_id
    and route.session_id = p_session_id and route.routing_key = p_routing_key;
  perform route.provider_message_id from public.whatsapp_webhook_routing_snapshots as route
  where route.organization_id = p_organization_id
    and route.session_id = p_session_id and route.routing_key = p_routing_key
    and route.ingress_sequence > v_prior_cutoff
    and route.ingress_sequence <= v_cutoff
  order by route.ingress_sequence for key share of route;
  select count(*)::integer into v_extra_dead
  from public.whatsapp_webhook_inbox as inbox
  join public.whatsapp_webhook_routing_snapshots as route
    on route.organization_id = inbox.organization_id
   and route.session_id = inbox.session_id
   and route.provider_message_id = inbox.payload #>>
     '{__vimob_ingress,routing_snapshot,messages,0,provider_message_id}'
  where inbox.organization_id = p_organization_id
    and inbox.session_id = p_session_id
    and inbox.payload #>>
      '{__vimob_ingress,routing_snapshot,messages,0,routing_key}' = p_routing_key
    and inbox.status = 'dead' and inbox.id <> v_root.id
    and route.ingress_sequence > v_prior_cutoff
    and route.ingress_sequence <= v_cutoff;
  if v_extra_dead <> 0 then
    perform private.whatsapp_failed_route_alert(
      p_organization_id,p_session_id,p_routing_key,'additional_dead_route');
    return pg_catalog.jsonb_build_object('state','no_go','reason','additional_dead_route');
  end if;
  with recursive chain as (
    select route.provider_message_id,route.ingress_sequence
    from public.whatsapp_webhook_routing_snapshots as route
    where route.organization_id = p_organization_id
      and route.session_id = p_session_id
      and route.provider_message_id = v_root_route.provider_message_id
    union all
    select child.provider_message_id,child.ingress_sequence
    from public.whatsapp_webhook_routing_snapshots as child
    join chain as parent
      on child.predecessor_provider_message_id = parent.provider_message_id
     and child.ingress_sequence > parent.ingress_sequence
    where child.organization_id = p_organization_id
      and child.session_id = p_session_id and child.routing_key = p_routing_key
  ) select coalesce(array_agg(distinct provider_message_id),'{}'::text[])
    into v_chain from chain;
  -- The root may be an older lead epoch. Only the current unique binding is
  -- used for NEW events; historical snapshot identities remain raw facts.
  select conversation.* into v_conversation
  from public.whatsapp_conversations as conversation
  where conversation.organization_id = p_organization_id
    and conversation.session_id = p_session_id
    and conversation.deleted_at is null
    and public.normalize_phone(conversation.contact_phone) =
      pg_catalog.substring(p_routing_key,7)
  for no key update of conversation;
  if not found or (select count(*) from public.whatsapp_conversations as candidate
      where candidate.organization_id = p_organization_id
        and candidate.session_id = p_session_id
        and candidate.deleted_at is null
        and public.normalize_phone(candidate.contact_phone) =
          pg_catalog.substring(p_routing_key,7)) <> 1
     or v_conversation.lead_id is null then
    perform private.whatsapp_failed_route_alert(
      p_organization_id,p_session_id,p_routing_key,'current_conversation_unproven');
    return pg_catalog.jsonb_build_object('state','no_go','reason','current_conversation_unproven');
  end if;
  select binding.* into v_binding
  from public.whatsapp_conversation_lead_bindings as binding
  where binding.organization_id = p_organization_id
    and binding.session_id = p_session_id
    and binding.conversation_id = v_conversation.id
    and binding.active_to is null and binding.stale = false
  for update of binding;
  if not found or v_binding.lead_id is distinct from v_conversation.lead_id
     or (select count(*) from public.whatsapp_conversation_lead_bindings as candidate
       where candidate.organization_id = p_organization_id
         and candidate.session_id = p_session_id
         and candidate.conversation_id = v_conversation.id
         and candidate.active_to is null and candidate.stale = false) <> 1
     or not exists (select 1 from public.leads as lead
       where lead.organization_id = p_organization_id
         and lead.id = v_binding.lead_id)
     or exists (select 1 from public.whatsapp_conversation_routing_heads as head
       where head.organization_id = p_organization_id
         and head.conversation_id = v_conversation.id
         and (head.session_id is distinct from p_session_id
           or head.routing_key is distinct from p_routing_key
           or head.lead_id is distinct from v_binding.lead_id
           or head.ingress_sequence >= v_root_route.ingress_sequence)) then
    perform private.whatsapp_failed_route_alert(
      p_organization_id,p_session_id,p_routing_key,'current_binding_unproven');
    return pg_catalog.jsonb_build_object('state','no_go','reason','current_binding_unproven');
  end if;
  if v_root_route.target_mode = 'snapshot'
     and (v_snapshot ->> 'conversation_id' is distinct from v_conversation.id::text
       or v_snapshot ->> 'current_lead_id' is distinct from v_binding.lead_id::text
       or v_snapshot ->> 'active_binding_id' is distinct from v_binding.id::text) then
    perform private.whatsapp_failed_route_alert(
      p_organization_id,p_session_id,p_routing_key,'bound_root_identity_changed');
    return pg_catalog.jsonb_build_object('state','no_go','reason','bound_root_identity_changed');
  end if;
  select count(*)::integer into v_bad
  from public.whatsapp_webhook_inbox as inbox
  left join public.whatsapp_webhook_routing_snapshots as route
    on route.organization_id = inbox.organization_id
   and route.session_id = inbox.session_id
   and route.provider_message_id = inbox.payload #>>
     '{__vimob_ingress,routing_snapshot,messages,0,provider_message_id}'
  where inbox.organization_id = p_organization_id
    and inbox.session_id = p_session_id
    and inbox.payload #>>
      '{__vimob_ingress,routing_snapshot,messages,0,routing_key}' = p_routing_key
    and inbox.status in ('pending','retry','processing')
    and not exists (select 1
      from private.whatsapp_failed_route_epoch_raw as prior_audit
      join private.whatsapp_failed_route_epoch_fences as prior_fence
        on prior_fence.id = prior_audit.fence_id
      where prior_audit.inbox_id = inbox.id
        and prior_audit.reason = 'failed_predecessor_held:v1'
        and prior_fence.organization_id = p_organization_id
        and prior_fence.session_id = p_session_id
        and prior_fence.routing_key = p_routing_key
        and prior_fence.cutoff_ingress_sequence <= v_prior_cutoff)
    and (inbox.status = 'processing'
      or inbox.provider is distinct from 'evolution_go'
      or inbox.event_type is distinct from 'message'
      or inbox.locked_at is not null or inbox.locked_by is not null
      or inbox.payload #>> '{__vimob_ingress,routing_snapshot,version}' is distinct from '1'
      or pg_catalog.jsonb_typeof(inbox.payload #>
        '{__vimob_ingress,routing_snapshot,messages}') is distinct from 'array'
      or (case when pg_catalog.jsonb_typeof(inbox.payload #>
        '{__vimob_ingress,routing_snapshot,messages}') = 'array'
        then pg_catalog.jsonb_array_length(inbox.payload #>
          '{__vimob_ingress,routing_snapshot,messages}') else -1 end) <> 1
      or route.provider_message_id is null
      or route.provider_message_id <> all(v_chain)
      or route.provider_message_id is distinct from inbox.payload #>>
        '{__vimob_ingress,routing_snapshot,messages,0,provider_message_id}'
      or route.inbox_event_key is distinct from inbox.event_key
      or route.processing_lane is distinct from inbox.processing_lane
      or route.routing_key is distinct from p_routing_key
      or route.ingress_sequence > v_cutoff
      or route.snapshot is distinct from inbox.payload #>
        '{__vimob_ingress,routing_snapshot,messages,0}'
      or route.target_mode is distinct from 'inherit_predecessor'
      or route.binding_eligible is distinct from true
      or route.snapshot ->> 'state' is distinct from 'predecessor_inherit'
      or route.snapshot ->> 'context_kind' is distinct from 'organic'
      or route.snapshot ->> 'context_proof' is not null
      or route.snapshot -> 'managed_message_distribution' is distinct from 'false'::jsonb
      or route.snapshot -> 'managed_event_pending' is distinct from 'false'::jsonb
      or route.snapshot -> 'managed_event_handled' is distinct from 'false'::jsonb
      or exists (select 1 from public.whatsapp_webhook_routing_outcomes as outcome
        where outcome.organization_id = inbox.organization_id
          and outcome.session_id = inbox.session_id
          and outcome.provider_message_id = route.provider_message_id
          and outcome.ingress_sequence = route.ingress_sequence)
      or exists (select 1 from public.whatsapp_messages as message
        where message.organization_id = inbox.organization_id
          and message.session_id = inbox.session_id
          and (message.provider_message_id = route.provider_message_id
            or message.message_id = route.provider_message_id
            or message.client_message_id = route.provider_message_id)));
  if v_bad <> 0 then
    perform private.whatsapp_failed_route_alert(
      p_organization_id,p_session_id,p_routing_key,'active_chain_unproven');
    return pg_catalog.jsonb_build_object('state','no_go','reason','active_chain_unproven');
  end if;
  -- The root and all held rows must have exact one-message route ledgers.
  -- A route with an off-chain live branch stays with the operator.
  v_at := clock_timestamp();
  insert into private.whatsapp_failed_route_epoch_fences (
    organization_id,session_id,routing_key,root_inbox_id,
    cutoff_ingress_sequence,conversation_id,lead_id_at_fence,
    binding_id_at_fence,held_count,held_at,quarantine_after
  ) values (
    p_organization_id,p_session_id,p_routing_key,v_root.id,v_cutoff,
    v_conversation.id,v_binding.lead_id,v_binding.id,v_active,v_at,
    v_at + interval '10 minutes'
  ) returning id into v_fence_id;
  insert into private.whatsapp_failed_route_epoch_raw (
    inbox_id,fence_id,organization_id,session_id,routing_key,
    provider_message_id,ingress_sequence,original_inbox,
    original_route_snapshot,payload_sha256,original_status,
    captured_conversation_id,captured_lead_id,captured_binding_id,
    audited_at,reason
  ) select inbox.id,v_fence_id,inbox.organization_id,inbox.session_id,
    p_routing_key,route.provider_message_id,route.ingress_sequence,
    pg_catalog.to_jsonb(inbox),pg_catalog.to_jsonb(route),
    private.canonical_jsonb_sha256(inbox.payload),inbox.status,
    (nullif(route.snapshot ->> 'conversation_id',''))::uuid,
    (nullif(route.snapshot ->> 'current_lead_id',''))::uuid,
    (nullif(route.snapshot ->> 'active_binding_id',''))::uuid,
    v_at,'failed_predecessor_held:v1'
  from public.whatsapp_webhook_inbox as inbox
  join public.whatsapp_webhook_routing_snapshots as route
    on route.organization_id = inbox.organization_id
   and route.session_id = inbox.session_id
   and route.provider_message_id = inbox.payload #>>
     '{__vimob_ingress,routing_snapshot,messages,0,provider_message_id}'
   and route.inbox_event_key = inbox.event_key
   and route.processing_lane = inbox.processing_lane
   and route.snapshot = inbox.payload #>
      '{__vimob_ingress,routing_snapshot,messages,0}'
  where inbox.id = v_root.id or (
    inbox.organization_id = p_organization_id
    and inbox.session_id = p_session_id
    and inbox.payload #>>
      '{__vimob_ingress,routing_snapshot,messages,0,routing_key}' = p_routing_key
    and inbox.status in ('pending','retry')
    and not exists (select 1
      from private.whatsapp_failed_route_epoch_raw as prior_audit
      join private.whatsapp_failed_route_epoch_fences as prior_fence
        on prior_fence.id = prior_audit.fence_id
      where prior_audit.inbox_id = inbox.id
        and prior_audit.reason = 'failed_predecessor_held:v1'
        and prior_fence.organization_id = p_organization_id
        and prior_fence.session_id = p_session_id
        and prior_fence.routing_key = p_routing_key
        and prior_fence.cutoff_ingress_sequence <= v_prior_cutoff));
  get diagnostics v_raw = row_count;
  if v_raw <> v_active + 1 then
    raise exception 'failed_route_raw_audit_incomplete';
  end if;
  update public.whatsapp_webhook_inbox as inbox
  set expires_at = 'infinity'::timestamptz,updated_at = v_at
  where inbox.id = v_root.id and inbox.status = 'dead';
  return pg_catalog.jsonb_build_object('state','held','fence_id',v_fence_id,
    'root_inbox_id',v_root.id,'held_count',v_active,
    'cutoff_ingress_sequence',v_cutoff,
    'conversation_id',v_conversation.id,'lead_id',v_binding.lead_id,
    'binding_id',v_binding.id);
end;
$function$;
revoke all on function private.try_hold_failed_whatsapp_route_epoch(uuid,uuid,text,text)
  from public, anon, authenticated, service_role;

-- Preserve the installed capture body and patch only three exact anchors.
-- This runs before conversation locks, under its existing route advisory key.

create or replace function private.quarantine_failed_route_unproven_before_insert()
returns trigger language plpgsql security definer set search_path = '' as $function$
declare
  v_messages jsonb;
begin
  if new.provider is distinct from 'evolution_go'
     or new.event_type is distinct from 'message'
     or new.status is distinct from 'pending'
     or new.payload #>> '{__vimob_ingress,routing_snapshot,version}' is distinct from '1' then
    return new;
  end if;
  v_messages := new.payload #> '{__vimob_ingress,routing_snapshot,messages}';
  if pg_catalog.jsonb_typeof(v_messages) is distinct from 'array' then
    return new;
  end if;
  if pg_catalog.jsonb_array_length(v_messages) > 1 then
    -- During a rolling deploy an older API may still try to persist an
    -- ambiguous unsplit batch. Reject it before any DEAD root can affect
    -- sibling contacts. The upgraded API stores the direct-only callback in
    -- the private mixed-envelope ledger before acknowledging it.
    raise exception using errcode = '23514',
      message = 'failed_route_unsplit_batch_requires_private_isolation';
  end if;
  if exists (select 1 from pg_catalog.jsonb_array_elements(v_messages) as member(snapshot)
    where member.snapshot ->> 'quarantine_reason' =
      'failed_route_identity_unproven:v1') then
    new.status := 'dead';
    new.attempts := new.max_attempts;
    new.last_error := 'failed_route_identity_unproven:v1';
    new.dead_lettered_at := clock_timestamp();
    new.expires_at := 'infinity'::timestamptz;
    new.locked_at := null; new.locked_by := null;
  end if;
  return new;
end;
$function$;
revoke all on function private.quarantine_failed_route_unproven_before_insert()
  from public, anon, authenticated, service_role;

create or replace function private.audit_failed_route_unproven_after_insert()
returns trigger language plpgsql security definer set search_path = '' as $function$
begin
  if new.status is distinct from 'dead'
     or new.last_error is distinct from 'failed_route_identity_unproven:v1' then
    return new;
  end if;
  if new.expires_at is distinct from 'infinity'::timestamptz
     or new.payload #>> '{__vimob_ingress,routing_snapshot,version}' is distinct from '1'
     or not exists (
       select 1 from pg_catalog.jsonb_array_elements(
         case when pg_catalog.jsonb_typeof(new.payload #>
           '{__vimob_ingress,routing_snapshot,messages}') = 'array'
           then new.payload #> '{__vimob_ingress,routing_snapshot,messages}'
           else '[]'::jsonb end) as member(snapshot)
       where member.snapshot ->> 'quarantine_reason' =
         'failed_route_identity_unproven:v1'
         and member.snapshot -> 'binding_eligible' = 'false'::jsonb
         and member.snapshot ->> 'current_lead_id' is null
         and member.snapshot ->> 'active_binding_id' is null
         and member.snapshot ->> 'event_lead_id' is null
     ) then
    raise exception using errcode = '23514',
      message = 'failed_route_unproven_ingress_audit_guard_failed';
  end if;
  insert into private.whatsapp_failed_route_unproven_ingress_raw (
    inbox_id,organization_id,session_id,routing_key_hash,
    original_inbox,payload_sha256,audited_at
  ) values (new.id,new.organization_id,new.session_id,
    pg_catalog.md5(coalesce(new.payload #>>
      '{__vimob_ingress,routing_snapshot,messages,0,routing_key}','')),
    pg_catalog.to_jsonb(new),private.canonical_jsonb_sha256(new.payload),
    new.dead_lettered_at);
  return new;
end;
$function$;
revoke all on function private.audit_failed_route_unproven_after_insert()
  from public, anon, authenticated, service_role;

-- A held predecessor remains pending for recovery, but must not be claimed
-- while its epoch is fenced. A later message only bypasses that older row
-- when its own immutable v1 ledger proves a new bound epoch on this route.
create or replace function private.whatsapp_failed_route_inbox_is_held(p_inbox_id uuid)
returns boolean language sql stable security definer set search_path = '' as $function$
  select exists (
    select 1 from private.whatsapp_failed_route_epoch_raw as audit
    join private.whatsapp_failed_route_epoch_fences as fence on fence.id = audit.fence_id
    where audit.inbox_id = p_inbox_id
      and audit.original_status in ('pending','retry')
      and audit.reason = 'failed_predecessor_held:v1'
      and fence.state = 'held'
  );
$function$;
revoke all on function private.whatsapp_failed_route_inbox_is_held(uuid)
  from public, anon, authenticated, service_role;

create or replace function private.whatsapp_failed_route_older_is_held_for_new(
  p_older_inbox_id uuid,p_new_inbox_id uuid
) returns boolean language sql stable security definer set search_path = '' as $function$
  select exists (
    select 1
    from private.whatsapp_failed_route_epoch_raw as audit
    join private.whatsapp_failed_route_epoch_fences as fence on fence.id = audit.fence_id
    join public.whatsapp_webhook_inbox as newer on newer.id = p_new_inbox_id
    join public.whatsapp_webhook_routing_snapshots as route
      on route.organization_id = newer.organization_id
     and route.session_id = newer.session_id
     and route.provider_message_id = newer.payload #>>
       '{__vimob_ingress,routing_snapshot,messages,0,provider_message_id}'
    where audit.inbox_id = p_older_inbox_id
      and audit.original_status in ('pending','retry')
      and audit.reason = 'failed_predecessor_held:v1'
      and fence.state = 'held'
      and newer.organization_id = fence.organization_id
      and newer.session_id = fence.session_id
      and newer.payload #>>
        '{__vimob_ingress,routing_snapshot,messages,0,routing_key}' = fence.routing_key
      and newer.provider = 'evolution_go' and newer.event_type = 'message'
      and newer.payload #>> '{__vimob_ingress,routing_snapshot,version}' = '1'
      and (case when pg_catalog.jsonb_typeof(newer.payload #>
        '{__vimob_ingress,routing_snapshot,messages}') = 'array'
        then pg_catalog.jsonb_array_length(newer.payload #>
          '{__vimob_ingress,routing_snapshot,messages}') else -1 end) = 1
      and route.routing_key = fence.routing_key
      and route.ingress_sequence > fence.cutoff_ingress_sequence
      and route.inbox_event_key = newer.event_key
      and route.processing_lane = newer.processing_lane
      and route.provider_message_id = newer.payload #>>
        '{__vimob_ingress,routing_snapshot,messages,0,provider_message_id}'
      and route.snapshot = newer.payload #>
        '{__vimob_ingress,routing_snapshot,messages,0}'
      and route.binding_eligible = true
      and ((route.target_mode = 'snapshot'
          and route.snapshot ->> 'state' = 'bound')
        or (route.target_mode = 'inherit_predecessor'
          and route.snapshot ->> 'state' = 'predecessor_inherit'
          and exists (select 1
            from public.whatsapp_webhook_routing_snapshots as predecessor
            where predecessor.organization_id = route.organization_id
              and predecessor.session_id = route.session_id
              and predecessor.routing_key = route.routing_key
              and predecessor.provider_message_id = route.predecessor_provider_message_id
              and predecessor.ingress_sequence > fence.cutoff_ingress_sequence
              and predecessor.ingress_sequence < route.ingress_sequence)))
      and route.snapshot ->> 'conversation_id' is not null
      and route.snapshot ->> 'current_lead_id' is not null
      and route.snapshot ->> 'active_binding_id' is not null
  );
$function$;
revoke all on function private.whatsapp_failed_route_older_is_held_for_new(uuid,uuid)
  from public, anon, authenticated, service_role;

-- Provider replay of a fenced id must never recreate a live dependency.
-- A mixed batch is rejected atomically for isolation by the ingress splitter.
create or replace function private.hold_failed_route_replay_before_insert()
returns trigger language plpgsql security definer set search_path = '' as $function$
declare
  v_messages jsonb;
  v_count integer;
  v_snapshot jsonb;
  v_route public.whatsapp_webhook_routing_snapshots%rowtype;
begin
  if new.provider is distinct from 'evolution_go'
     or new.event_type is distinct from 'message'
     or new.status is distinct from 'pending'
     or new.payload #>> '{__vimob_ingress,routing_snapshot,version}' is distinct from '1'
     or not exists (select 1 from private.whatsapp_failed_route_epoch_fences as fence
       where fence.organization_id = new.organization_id
         and fence.session_id = new.session_id) then
    return new;
  end if;
  v_messages := new.payload #> '{__vimob_ingress,routing_snapshot,messages}';
  if pg_catalog.jsonb_typeof(v_messages) = 'array' then
    v_count := pg_catalog.jsonb_array_length(v_messages);
  else
    v_count := 0;
  end if;
  if exists (
    select 1 from public.whatsapp_webhook_routing_snapshots as route
    join private.whatsapp_failed_route_epoch_fences as fence
      on fence.organization_id = route.organization_id
     and fence.session_id = route.session_id
     and fence.routing_key = route.routing_key
     and route.ingress_sequence <= fence.cutoff_ingress_sequence
    where route.organization_id = new.organization_id
      and route.session_id = new.session_id
      and route.provider_message_id = new.payload #>>
        '{__vimob_ingress,routing_snapshot,messages,0,provider_message_id}'
      and (v_count <> 1 or v_messages -> 0 ->> 'provider_message_id'
        is distinct from route.provider_message_id)
  ) then
    raise exception using errcode = '23514',
      message = 'failed_route_replay_envelope_snapshot_mismatch';
  end if;
  if v_count <> 1 then
    if exists (
      select 1 from pg_catalog.jsonb_array_elements(
        case when pg_catalog.jsonb_typeof(v_messages) = 'array'
          then v_messages else '[]'::jsonb end) as member(snapshot)
      join public.whatsapp_webhook_routing_snapshots as route
        on route.organization_id = new.organization_id
       and route.session_id = new.session_id
       and route.provider_message_id = member.snapshot ->> 'provider_message_id'
      join private.whatsapp_failed_route_epoch_fences as fence
        on fence.organization_id = route.organization_id
       and fence.session_id = route.session_id
       and fence.routing_key = route.routing_key
       and route.ingress_sequence <= fence.cutoff_ingress_sequence
    ) then
      raise exception using errcode = '23514',
        message = 'failed_route_mixed_replay_requires_isolation';
    end if;
    return new;
  end if;
  v_snapshot := v_messages -> 0;
  select route.* into v_route
  from public.whatsapp_webhook_routing_snapshots as route
  join private.whatsapp_failed_route_epoch_fences as fence
    on fence.organization_id = route.organization_id
   and fence.session_id = route.session_id
   and fence.routing_key = route.routing_key
   and route.ingress_sequence <= fence.cutoff_ingress_sequence
  where route.organization_id = new.organization_id
    and route.session_id = new.session_id
    and route.provider_message_id = v_snapshot ->> 'provider_message_id'
  order by fence.cutoff_ingress_sequence
  limit 1 for key share of route;
  if not found then return new; end if;
  if new.payload #>>
       '{__vimob_ingress,routing_snapshot,messages,0,provider_message_id}'
     is distinct from v_route.provider_message_id
     or v_snapshot is distinct from v_route.snapshot
     or v_snapshot ->> 'routing_key' is distinct from v_route.routing_key
     or v_snapshot ->> 'inbox_event_key' is distinct from v_route.inbox_event_key
     or v_snapshot ->> 'processing_lane' is distinct from v_route.processing_lane then
    raise exception using errcode = '23514',
      message = 'failed_route_replay_envelope_mismatch';
  end if;
  new.status := 'dead';
  new.attempts := new.max_attempts;
  new.last_error := 'failed_predecessor_replay:v1';
  new.dead_lettered_at := clock_timestamp();
  new.expires_at := 'infinity'::timestamptz;
  new.locked_at := null; new.locked_by := null;
  return new;
end;
$function$;
revoke all on function private.hold_failed_route_replay_before_insert()
  from public, anon, authenticated, service_role;

create or replace function private.audit_failed_route_replay_after_insert()
returns trigger language plpgsql security definer set search_path = '' as $function$
declare
  v_route public.whatsapp_webhook_routing_snapshots%rowtype;
  v_fence_id uuid;
begin
  if new.status is distinct from 'dead'
     or new.last_error is distinct from 'failed_predecessor_replay:v1' then
    return new;
  end if;
  select route.* into v_route
  from public.whatsapp_webhook_routing_snapshots as route
  join private.whatsapp_failed_route_epoch_fences as fence
    on fence.organization_id = route.organization_id
   and fence.session_id = route.session_id
   and fence.routing_key = route.routing_key
   and route.ingress_sequence <= fence.cutoff_ingress_sequence
  where route.organization_id = new.organization_id
    and route.session_id = new.session_id
    and route.provider_message_id = new.payload #>>
      '{__vimob_ingress,routing_snapshot,messages,0,provider_message_id}'
    and route.snapshot = new.payload #>
      '{__vimob_ingress,routing_snapshot,messages,0}'
  order by fence.cutoff_ingress_sequence limit 1 for key share of route;
  if not found or new.expires_at is distinct from 'infinity'::timestamptz then
    raise exception using errcode = '23514',
      message = 'failed_route_replay_audit_ledger_missing';
  end if;
  select fence.id into v_fence_id
  from private.whatsapp_failed_route_epoch_fences as fence
  where fence.organization_id = v_route.organization_id
    and fence.session_id = v_route.session_id
    and fence.routing_key = v_route.routing_key
    and v_route.ingress_sequence <= fence.cutoff_ingress_sequence
  order by fence.cutoff_ingress_sequence limit 1;
  if not found then
    raise exception using errcode = '23514',
      message = 'failed_route_replay_audit_fence_missing';
  end if;
  insert into private.whatsapp_failed_route_epoch_raw (
    inbox_id,fence_id,organization_id,session_id,routing_key,
    provider_message_id,ingress_sequence,original_inbox,
    original_route_snapshot,payload_sha256,original_status,
    audited_at,reason
  ) values (
    new.id,v_fence_id,new.organization_id,new.session_id,v_route.routing_key,
    v_route.provider_message_id,v_route.ingress_sequence,
    pg_catalog.to_jsonb(new),pg_catalog.to_jsonb(v_route),
    private.canonical_jsonb_sha256(new.payload),new.status,
    new.dead_lettered_at,'failed_predecessor_replay:v1'
  );
  return new;
end;
$function$;
revoke all on function private.audit_failed_route_replay_after_insert()
  from public, anon, authenticated, service_role;

-- Run at most one due epoch per transaction. Failed proof leaves HELD intact;
-- the worker reports the no-go reason and an operator can reconcile raw rows.
create or replace function private.quarantine_due_failed_whatsapp_epoch(
  p_root_inbox_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  v_hint private.whatsapp_failed_route_epoch_fences%rowtype;
  v_fence private.whatsapp_failed_route_epoch_fences%rowtype;
  v_bad integer;
  v_audited integer;
  v_active integer;
  v_updated integer;
  v_at timestamptz;
begin
  select fence.* into v_hint from private.whatsapp_failed_route_epoch_fences as fence
  where fence.root_inbox_id = p_root_inbox_id;
  if not found then
    return pg_catalog.jsonb_build_object('state','not_found');
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    v_hint.organization_id::text || ':' || v_hint.session_id::text || ':' || v_hint.routing_key,0));
  select fence.* into v_fence from private.whatsapp_failed_route_epoch_fences as fence
  where fence.id = v_hint.id for update;
  if v_fence.state = 'quarantined' then
    return pg_catalog.jsonb_build_object('state','already_quarantined',
      'root_inbox_id',v_fence.root_inbox_id);
  end if;
  if clock_timestamp() < v_fence.quarantine_after then
    return pg_catalog.jsonb_build_object('state','grace',
      'root_inbox_id',v_fence.root_inbox_id);
  end if;
  perform inbox.id from private.whatsapp_failed_route_epoch_raw as audit
  join public.whatsapp_webhook_inbox as inbox on inbox.id = audit.inbox_id
  where audit.fence_id = v_fence.id and audit.reason = 'failed_predecessor_held:v1'
  order by inbox.id for update of inbox;
  select count(*)::integer into v_audited
  from private.whatsapp_failed_route_epoch_raw as audit
  where audit.fence_id = v_fence.id and audit.reason = 'failed_predecessor_held:v1';
  select count(*)::integer into v_active
  from private.whatsapp_failed_route_epoch_raw as audit
  join public.whatsapp_webhook_inbox as inbox on inbox.id = audit.inbox_id
  where audit.fence_id = v_fence.id
    and audit.reason = 'failed_predecessor_held:v1'
    and audit.original_status in ('pending','retry')
    and inbox.status in ('pending','retry');
  if v_audited <> v_fence.held_count + 1 or v_active <> v_fence.held_count then
    update private.whatsapp_failed_route_epoch_fences
      set last_reconcile_attempt_at = clock_timestamp() where id = v_fence.id;
    perform private.whatsapp_failed_route_alert(v_fence.organization_id,
      v_fence.session_id,v_fence.routing_key,'grace_member_status_changed');
    return pg_catalog.jsonb_build_object('state','no_go','reason','grace_member_status_changed');
  end if;
  select count(*)::integer into v_bad
  from private.whatsapp_failed_route_epoch_raw as audit
  left join public.whatsapp_webhook_inbox as inbox on inbox.id = audit.inbox_id
  left join public.whatsapp_webhook_routing_snapshots as route
    on route.organization_id = audit.organization_id
   and route.session_id = audit.session_id
   and route.provider_message_id = audit.provider_message_id
  where audit.fence_id = v_fence.id
    and audit.reason = 'failed_predecessor_held:v1'
    and (inbox.id is null or route.provider_message_id is null
      or inbox.organization_id is distinct from audit.organization_id
      or inbox.session_id is distinct from audit.session_id
      or inbox.payload #>>
        '{__vimob_ingress,routing_snapshot,messages,0,routing_key}'
        is distinct from audit.routing_key
      or private.canonical_jsonb_sha256(inbox.payload) is distinct from audit.payload_sha256
      or audit.original_inbox -> 'payload' is distinct from inbox.payload
      or audit.original_route_snapshot is distinct from pg_catalog.to_jsonb(route)
      or audit.captured_conversation_id is distinct from
        (nullif(route.snapshot ->> 'conversation_id',''))::uuid
      or audit.captured_lead_id is distinct from
        (nullif(route.snapshot ->> 'current_lead_id',''))::uuid
      or audit.captured_binding_id is distinct from
        (nullif(route.snapshot ->> 'active_binding_id',''))::uuid
      or route.snapshot is distinct from inbox.payload #>
        '{__vimob_ingress,routing_snapshot,messages,0}'
      or route.inbox_event_key is distinct from inbox.event_key
      or route.processing_lane is distinct from inbox.processing_lane
      or route.routing_key is distinct from v_fence.routing_key
      or route.ingress_sequence > v_fence.cutoff_ingress_sequence
      or audit.retained_until is distinct from 'infinity'::timestamptz
      or (audit.original_status in ('pending','retry') and
        (inbox.status not in ('pending','retry')
         or inbox.locked_at is not null or inbox.locked_by is not null))
      or (audit.original_status = 'dead' and inbox.status is distinct from 'dead')
      or exists (select 1 from public.whatsapp_webhook_routing_outcomes as outcome
        where outcome.organization_id = audit.organization_id
          and outcome.session_id = audit.session_id
          and outcome.provider_message_id = audit.provider_message_id)
      or exists (select 1 from public.whatsapp_messages as message
        where message.organization_id = audit.organization_id
          and message.session_id = audit.session_id
          and (message.provider_message_id = audit.provider_message_id
            or message.message_id = audit.provider_message_id
            or message.client_message_id = audit.provider_message_id)));
  if v_bad <> 0 then
    update private.whatsapp_failed_route_epoch_fences
      set last_reconcile_attempt_at = clock_timestamp() where id = v_fence.id;
    perform private.whatsapp_failed_route_alert(v_fence.organization_id,
      v_fence.session_id,v_fence.routing_key,'grace_proof_changed');
    return pg_catalog.jsonb_build_object('state','no_go','reason','grace_proof_changed');
  end if;
  v_at := clock_timestamp();
  update public.whatsapp_webhook_inbox as inbox
  set status = 'dead',attempts = inbox.max_attempts,
      last_error = 'failed_predecessor_raw_preserved:v1',
      dead_lettered_at = v_at,expires_at = 'infinity'::timestamptz,
      locked_at = null,locked_by = null,updated_at = v_at
  from private.whatsapp_failed_route_epoch_raw as audit
  where audit.fence_id = v_fence.id
    and audit.reason = 'failed_predecessor_held:v1'
    and audit.original_status in ('pending','retry')
    and audit.inbox_id = inbox.id
    and inbox.status in ('pending','retry');
  get diagnostics v_updated = row_count;
  if v_updated <> v_fence.held_count then
    raise exception 'failed_route_epoch_terminal_count_changed';
  end if;
  update private.whatsapp_failed_route_epoch_fences as fence
  set state = 'quarantined',quarantined_at = v_at,
      last_reconcile_attempt_at = v_at
  where fence.id = v_fence.id and fence.state = 'held';
  return pg_catalog.jsonb_build_object('state','quarantined',
    'root_inbox_id',v_fence.root_inbox_id,'raw_rows',v_audited,
    'terminal_rows',v_updated);
end;
$function$;
revoke all on function private.quarantine_due_failed_whatsapp_epoch(uuid)
  from public, anon, authenticated, service_role;

commit;
