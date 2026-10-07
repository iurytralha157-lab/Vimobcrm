-- Additive only. Activation is a separate, explicit service-only call after
-- every API replica understands the epoch contract. Existing rows are epoch 0.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '5min';

alter table public.whatsapp_webhook_inbox
  add column if not exists processing_epoch integer not null default 0;
alter table public.whatsapp_webhook_routing_snapshots
  add column if not exists processing_epoch integer not null default 0;

alter table public.whatsapp_webhook_inbox
  add constraint whatsapp_webhook_inbox_processing_epoch_check
  check (processing_epoch in (0, 1)) not valid;
alter table public.whatsapp_webhook_routing_snapshots
  add constraint whatsapp_webhook_routing_epoch_check
  check (processing_epoch in (0, 1)) not valid;
comment on column public.whatsapp_webhook_inbox.processing_epoch is
  '0 is pre-cutover or retained delivery; 1 is the explicitly activated session generation.';
comment on column public.whatsapp_webhook_routing_snapshots.processing_epoch is
  'Frozen routing generation; a predecessor must belong to this same generation.';

create table if not exists private.whatsapp_webhook_session_cutovers (
  session_id uuid primary key references public.whatsapp_sessions(id) on delete cascade,
  active_epoch integer not null default 1 check (active_epoch = 1),
  cutover_at timestamptz not null,
  activated_at timestamptz not null default clock_timestamp()
);
comment on table private.whatsapp_webhook_session_cutovers is
  'Per-session forward-only activation fence. No row means generation zero.';
alter table private.whatsapp_webhook_session_cutovers enable row level security;
revoke all on private.whatsapp_webhook_session_cutovers from public, anon, authenticated, service_role;
grant select on private.whatsapp_webhook_session_cutovers to service_role;

-- Metadata only: never store provider payload, message text, phone or media.
create table if not exists private.whatsapp_webhook_ignored_events (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  session_id uuid not null references public.whatsapp_sessions(id) on delete cascade,
  event_key text not null check (btrim(event_key) <> '' and octet_length(event_key) <= 512),
  reason text not null check (btrim(reason) <> '' and octet_length(reason) <= 160),
  ignored_at timestamptz not null default clock_timestamp(),
  primary key (organization_id, session_id, event_key)
);
comment on table private.whatsapp_webhook_ignored_events is
  'Metadata-only audit of technical webhook events ignored without CRM effects.';
create index if not exists whatsapp_webhook_ignored_events_session_time_idx
  on private.whatsapp_webhook_ignored_events (session_id, ignored_at desc);
alter table private.whatsapp_webhook_ignored_events enable row level security;
revoke all on private.whatsapp_webhook_ignored_events from public, anon, authenticated, service_role;
grant select, insert on private.whatsapp_webhook_ignored_events to service_role;

create or replace function private.guard_whatsapp_webhook_ignored_tenant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1
  from public.whatsapp_sessions as session
  where session.id = new.session_id
    and session.organization_id = new.organization_id
    and session.provider = 'evolution_go'
  for key share;
  if not found then
    raise exception using errcode = '23503', message = 'whatsapp_ignored_event_session_mismatch';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_whatsapp_webhook_ignored_tenant()
from public, anon, authenticated, service_role;
create trigger guard_whatsapp_webhook_ignored_tenant_before_insert
before insert on private.whatsapp_webhook_ignored_events
for each row execute function private.guard_whatsapp_webhook_ignored_tenant();

create or replace function private.activate_whatsapp_webhook_session_cutover(
  p_organization_id uuid,
  p_session_id uuid
)
returns timestamptz
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_cutover_at timestamptz;
begin
  if p_organization_id is null or p_session_id is null then
    raise exception using errcode = '22023', message = 'whatsapp_cutover_scope_required';
  end if;

  -- The claim takes FOR NO KEY UPDATE on this same session. New ingress must
  -- take FOR KEY SHARE before snapshot/insert. FOR UPDATE closes both races.
  perform 1
  from public.whatsapp_sessions as session
  where session.id = p_session_id
    and session.organization_id = p_organization_id
    and session.provider = 'evolution_go'
    and coalesce(session.is_active, true) = true
    and lower(btrim(coalesce(session.status, ''))) not in ('deleted', 'disabled')
  for update;
  if not found then
    raise exception using errcode = '23503', message = 'whatsapp_cutover_session_not_found';
  end if;

  select cutover.cutover_at into v_cutover_at
  from private.whatsapp_webhook_session_cutovers as cutover
  where cutover.session_id = p_session_id;
  if found then
    return v_cutover_at;
  end if;

  -- A native transaction holds the inbox in processing until all its
  -- post-commit jobs are queued. Do not cut over while any legacy execution
  -- is active. Edge HTTP timeouts need a separate execution fence and must
  -- not be enabled for a cutover session.
  if exists (
    select 1
    from public.whatsapp_webhook_inbox as inbox
    where inbox.organization_id = p_organization_id
      and inbox.session_id = p_session_id
      and inbox.processing_epoch = 0
      and inbox.status = 'processing'
  ) then
    raise exception using errcode = '55000', message = 'whatsapp_cutover_legacy_inflight';
  end if;

  v_cutover_at := clock_timestamp();
  insert into private.whatsapp_webhook_session_cutovers (
    session_id, active_epoch, cutover_at, activated_at
  ) values (p_session_id, 1, v_cutover_at, v_cutover_at);
  return v_cutover_at;
end;
$$;
revoke all on function private.activate_whatsapp_webhook_session_cutover(uuid, uuid)
from public, anon, authenticated;
grant execute on function private.activate_whatsapp_webhook_session_cutover(uuid, uuid)
to service_role;

create or replace function private.guard_whatsapp_webhook_inbox_epoch()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_active_epoch integer;
  v_route jsonb;
begin
  if tg_op = 'UPDATE' then
    if new.processing_epoch is distinct from old.processing_epoch then
      raise exception using errcode = '23514', message = 'whatsapp_inbox_epoch_immutable';
    end if;
  end if;

  -- Also serializes a direct insert/update with activation. The normal claim
  -- already owns a compatible lock on the session row.
  perform 1
  from public.whatsapp_sessions as session
  where session.id = new.session_id
    and session.organization_id = new.organization_id
  for key share;
  if not found then
    raise exception using errcode = '23503', message = 'whatsapp_inbox_epoch_session_mismatch';
  end if;

  select coalesce((
    select cutover.active_epoch
    from private.whatsapp_webhook_session_cutovers as cutover
    where cutover.session_id = new.session_id
  ), 0) into v_active_epoch;

  if new.processing_epoch not in (0, 1) or new.processing_epoch > v_active_epoch then
    raise exception using errcode = '23514', message = 'whatsapp_inbox_epoch_invalid';
  end if;

  -- A replica running the pre-cutover ingress has no epoch marker. Reject a
  -- brand-new event instead of acknowledging it into the retained epoch. A
  -- duplicate of an already stored key must still reach ON CONFLICT.
  if tg_op = 'INSERT' and v_active_epoch = 1 and new.processing_epoch = 0
    and (new.payload #> '{__vimob_ingress,epoch_capable}') is distinct from 'true'::jsonb
    and not exists (
      select 1 from public.whatsapp_webhook_inbox as existing
      where existing.event_key = new.event_key
        and existing.organization_id = new.organization_id
        and existing.session_id = new.session_id
    )
  then
    raise exception using errcode = '55000', message = 'whatsapp_inbox_epoch_legacy_ingress';
  end if;

  if tg_op = 'UPDATE' and v_active_epoch = 1 and new.processing_epoch = 0 then
    if new.status is distinct from old.status or new.attempts is distinct from old.attempts then
      raise exception using errcode = '55000', message = 'whatsapp_inbox_epoch_retained';
    end if;
  end if;

  if new.status = 'processing' and new.processing_epoch <> v_active_epoch then
    if tg_op = 'INSERT' then
      raise exception using errcode = '55000', message = 'whatsapp_inbox_epoch_retained';
    end if;
    if old.status is distinct from 'processing' then
      raise exception using errcode = '55000', message = 'whatsapp_inbox_epoch_retained';
    end if;
  end if;

  -- Old workers know neither the epoch claim predicate nor this worker ID.
  -- During a rolling deploy they must fail before processing a new epoch row.
  if new.processing_epoch = 1 and new.status = 'processing'
    and coalesce(new.locked_by, '') not like 'vimob-api-evolution-webhook-epoch1-%'
  then
    raise exception using errcode = '55000', message = 'whatsapp_inbox_epoch_legacy_worker';
  end if;

  if tg_op = 'INSERT' then
    for v_route in
      select value
      from pg_catalog.jsonb_array_elements(
        case
          when pg_catalog.jsonb_typeof(new.payload #> '{__vimob_ingress,routing_snapshot,messages}') = 'array'
            then new.payload #> '{__vimob_ingress,routing_snapshot,messages}'
          else '[]'::jsonb
        end
      )
    loop
      if coalesce((v_route->>'processing_epoch')::integer, 0) <> new.processing_epoch then
        raise exception using errcode = '23514', message = 'whatsapp_inbox_snapshot_epoch_mismatch';
      end if;
    end loop;
  end if;
  return new;
end;
$$;
revoke all on function private.guard_whatsapp_webhook_inbox_epoch()
from public, anon, authenticated, service_role;
drop trigger if exists guard_whatsapp_webhook_inbox_epoch_before_write
on public.whatsapp_webhook_inbox;
create trigger guard_whatsapp_webhook_inbox_epoch_before_write
before insert or update of status, attempts, processing_epoch on public.whatsapp_webhook_inbox
for each row execute function private.guard_whatsapp_webhook_inbox_epoch();

-- The legacy ingress captures a route before inserting the inbox row. If it
-- could capture a fresh epoch-zero route after activation, the retry on the
-- new API would reuse that snapshot and retain a genuinely new event. Fence
-- the snapshot first, while allowing a read of an existing old snapshot.
create or replace function private.guard_whatsapp_webhook_routing_snapshot_epoch()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_active_epoch integer;
begin
  perform 1
  from public.whatsapp_sessions as session
  where session.id = new.session_id
    and session.organization_id = new.organization_id
  for key share;
  if not found then
    raise exception using errcode = '23503', message = 'whatsapp_snapshot_epoch_session_mismatch';
  end if;

  select coalesce((
    select cutover.active_epoch
    from private.whatsapp_webhook_session_cutovers as cutover
    where cutover.session_id = new.session_id
  ), 0) into v_active_epoch;

  if new.processing_epoch is distinct from v_active_epoch then
    raise exception using errcode = '55000', message = 'whatsapp_snapshot_epoch_inactive';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_whatsapp_webhook_routing_snapshot_epoch()
from public, anon, authenticated, service_role;
drop trigger if exists guard_whatsapp_webhook_routing_snapshot_epoch_before_insert
on public.whatsapp_webhook_routing_snapshots;
create trigger guard_whatsapp_webhook_routing_snapshot_epoch_before_insert
before insert on public.whatsapp_webhook_routing_snapshots
for each row execute function private.guard_whatsapp_webhook_routing_snapshot_epoch();

create or replace function private.capture_whatsapp_webhook_routing_snapshot_v2(
  p_organization_id uuid,
  p_session_id uuid,
  p_provider_message_id text,
  p_inbox_event_key text,
  p_processing_lane text,
  p_routing_key text,
  p_binding_eligible boolean,
  p_identity_aliases text[],
  p_contact_phone text,
  p_context_kind text,
  p_context_proof text,
  p_managed_message_distribution boolean,
  p_managed_event_pending boolean,
  p_managed_event_handled boolean,
  p_rule_id uuid,
  p_origin_round_robin_id uuid,
  p_provider_event_lead_id uuid,
  p_processing_epoch integer
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_provider_message_id text := nullif(pg_catalog.btrim(p_provider_message_id), '');
  v_inbox_event_key text := nullif(pg_catalog.btrim(p_inbox_event_key), '');
  v_processing_lane text := lower(pg_catalog.btrim(coalesce(p_processing_lane, '')));
  v_routing_key text := nullif(pg_catalog.btrim(p_routing_key), '');
  v_aliases text[];
  v_primary_alias text := nullif(lower(pg_catalog.btrim(coalesce(p_identity_aliases[1], ''))), '');
  v_phone_key text := coalesce(public.normalize_phone(p_contact_phone), '');
  v_context_kind text := lower(pg_catalog.btrim(coalesce(p_context_kind, 'organic')));
  v_context_proof text := nullif(pg_catalog.btrim(p_context_proof), '');
  v_managed_message_distribution boolean := coalesce(p_managed_message_distribution, false);
  v_managed_event_pending boolean := coalesce(p_managed_event_pending, false);
  v_managed_event_handled boolean := coalesce(p_managed_event_handled, false);
  v_conversation public.whatsapp_conversations%rowtype;
  v_active public.whatsapp_conversation_lead_bindings%rowtype;
  v_event_binding public.whatsapp_conversation_lead_bindings%rowtype;
  v_message_conversation_id uuid;
  v_message_lead_id uuid;
  v_message_quarantine_reason text;
  v_target_lead_id uuid;
  v_candidate_conversation_ids uuid[] := '{}'::uuid[];
  v_candidate_lead_ids uuid[] := '{}'::uuid[];
  v_locked_alias_canonical_conversation_ids uuid[] := '{}'::uuid[];
  v_match_count integer := 0;
  v_state text := 'unlinked';
  v_quarantine_reason text;
  v_binding_eligible boolean := coalesce(p_binding_eligible, false);
  v_predecessor_provider_message_id text;
  v_predecessor public.whatsapp_webhook_routing_snapshots%rowtype;
  v_target_mode text := 'snapshot';
  v_ingress_sequence bigint;
  v_snapshot jsonb;
  v_existing_snapshot public.whatsapp_webhook_routing_snapshots%rowtype;
  v_active_epoch integer;
begin
  if p_processing_epoch not in (0, 1) or p_processing_epoch is null then
    raise exception using errcode = '22023', message = 'whatsapp_ingress_epoch_invalid';
  end if;
  if p_organization_id is null or p_session_id is null then
    raise exception using errcode = '22023', message = 'whatsapp_ingress_snapshot_tenant_required';
  end if;
  if v_provider_message_id is null
     or pg_catalog.octet_length(v_provider_message_id) > 512 then
    raise exception using errcode = '22023', message = 'whatsapp_ingress_snapshot_provider_message_required';
  end if;
  if v_inbox_event_key is null or pg_catalog.octet_length(v_inbox_event_key) > 1024 then
    raise exception using errcode = '22023', message = 'whatsapp_ingress_snapshot_event_key_required';
  end if;
  if v_processing_lane not in ('live', 'backlog') then
    raise exception using errcode = '22023', message = 'whatsapp_ingress_snapshot_lane_invalid';
  end if;
  if v_routing_key is null or pg_catalog.octet_length(v_routing_key) > 256 then
    raise exception using errcode = '22023', message = 'whatsapp_ingress_snapshot_routing_key_required';
  end if;
  if v_context_kind not in ('organic', 'contextual_intake') then
    raise exception using errcode = '22023', message = 'whatsapp_ingress_snapshot_context_invalid';
  end if;
  if v_managed_message_distribution is distinct from coalesce(v_context_proof = 'managed_rule', false) then
    raise exception using errcode = '22023', message = 'whatsapp_ingress_snapshot_managed_context_invalid';
  end if;
  if v_managed_message_distribution
     and (v_context_kind <> 'contextual_intake'
       or p_rule_id is null
       or p_origin_round_robin_id is null) then
    raise exception using errcode = '22023', message = 'whatsapp_ingress_snapshot_managed_rule_invalid';
  end if;
  if v_managed_event_pending and v_managed_event_handled then
    raise exception using errcode = '22023', message = 'whatsapp_ingress_snapshot_managed_state_invalid';
  end if;
  if not exists (
    select 1
    from public.whatsapp_sessions as session
    where session.id = p_session_id
      and session.organization_id = p_organization_id
      and session.provider = 'evolution_go'
      and coalesce(session.is_active, true) = true
      and lower(pg_catalog.btrim(coalesce(session.status, ''))) not in ('deleted', 'disabled')
  ) then
    raise exception using errcode = '23503', message = 'whatsapp_ingress_snapshot_session_mismatch';
  end if;

  -- Hold the session against activation until the immutable snapshot and
  -- its inbox row commit in the same ingress transaction.
  perform 1 from public.whatsapp_sessions as epoch_session
  where epoch_session.id = p_session_id
    and epoch_session.organization_id = p_organization_id
  for key share;
  if not found then
    raise exception using errcode = '23503', message = 'whatsapp_ingress_epoch_session_mismatch';
  end if;
  select coalesce((
    select cutover.active_epoch
    from private.whatsapp_webhook_session_cutovers as cutover
    where cutover.session_id = p_session_id
  ), 0) into v_active_epoch;
  if p_processing_epoch > v_active_epoch then
    raise exception using errcode = '23514', message = 'whatsapp_ingress_epoch_not_active';
  end if;

  -- The route lock precedes even the replay lookup. Besides serializing two
  -- callbacks for the same provider id, this is the barrier used by the
  -- conservative provenance cleanup: a replay can never observe a row that is
  -- concurrently being retired and then persist an inbox without its ledger.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_organization_id::text || ':' || p_session_id::text || ':' || v_routing_key,
      0
    )
  );

  -- Lookup after the route lock is authoritative. Two concurrent callbacks
  -- cannot select each other as predecessors, and exact provider replay always
  -- returns the original immutable snapshot (including its managed context).
  select routing_snapshot.*
  into v_existing_snapshot
  from public.whatsapp_webhook_routing_snapshots as routing_snapshot
  where routing_snapshot.organization_id = p_organization_id
    and routing_snapshot.session_id = p_session_id
    and routing_snapshot.provider_message_id = v_provider_message_id;

  if found then
    if v_existing_snapshot.routing_key is distinct from v_routing_key then
      raise exception using
        errcode = '23505',
        message = 'whatsapp_ingress_snapshot_provider_identity_conflict';
    end if;
    return v_existing_snapshot.snapshot;
  end if;

  select coalesce(pg_catalog.array_agg(distinct alias_value order by alias_value), '{}'::text[])
  into v_aliases
  from (
    select nullif(lower(pg_catalog.btrim(alias_value)), '') as alias_value
    from pg_catalog.unnest(coalesce(p_identity_aliases, '{}'::text[])) as supplied(alias_value)
  ) as normalized
  where alias_value is not null;

  select binding.*
  into v_event_binding
  from public.whatsapp_conversation_lead_bindings as binding
  where binding.organization_id = p_organization_id
    and binding.session_id = p_session_id
    and binding.provider_message_id = v_provider_message_id
  limit 1;

  if v_event_binding.id is not null then
    v_target_lead_id := v_event_binding.lead_id;
    v_candidate_conversation_ids := array[v_event_binding.conversation_id];
    v_state := 'provider_replay';
  else
    select
      message.conversation_id,
      message.lead_id,
      case
        when coalesce(message.metadata, '{}'::jsonb) @>
             '{"lead_resolution_quarantine":{"terminal":true,"retryable":false}}'::jsonb
          then coalesce(
            nullif(message.metadata #>> '{lead_resolution_quarantine,reason}', ''),
            'whatsapp_lead_resolution_ambiguous'
          )
        else null
      end
    into v_message_conversation_id, v_message_lead_id, v_message_quarantine_reason
    from public.whatsapp_messages as message
    where message.organization_id = p_organization_id
      and message.session_id = p_session_id
      and (
        message.provider_message_id = v_provider_message_id
        or (message.provider_message_id is null and message.message_id = v_provider_message_id)
      )
    order by message.id
    limit 1;

    select pg_catalog.count(*)::integer
    into v_match_count
    from (
      select message.id
      from public.whatsapp_messages as message
      where message.organization_id = p_organization_id
        and message.session_id = p_session_id
        and (
          message.provider_message_id = v_provider_message_id
          or (message.provider_message_id is null and message.message_id = v_provider_message_id)
        )
      limit 2
    ) as message_matches;
    if v_match_count > 1 then
      v_quarantine_reason := 'whatsapp_provider_message_identity_ambiguous';
    elsif v_message_conversation_id is not null then
      v_candidate_conversation_ids := array[v_message_conversation_id];
      v_target_lead_id := v_message_lead_id;
      v_state := 'provider_replay';
      v_quarantine_reason := v_message_quarantine_reason;
    end if;
  end if;

  if v_quarantine_reason is null
     and pg_catalog.cardinality(v_candidate_conversation_ids) = 0 then
    -- A known opaque provider alias routes to its active canonical conversation
    -- before an exact legacy LID row. Edge may leave that source row active,
    -- while native processing retires it; both paths must therefore resolve the
    -- same card without merging or moving the source history.
    if v_primary_alias like '%@lid' then
      select coalesce(pg_catalog.array_agg(candidate.id order by candidate.id), '{}'::uuid[])
      into v_candidate_conversation_ids
      from (
        select distinct conversation.id
        from public.whatsapp_contact_identity_aliases as identity_alias
        join public.whatsapp_conversations as conversation
          on conversation.organization_id = identity_alias.organization_id
         and conversation.session_id = identity_alias.session_id
         and lower(conversation.remote_jid) = lower(identity_alias.canonical_jid)
        where identity_alias.organization_id = p_organization_id
          and identity_alias.session_id = p_session_id
          and lower(identity_alias.alias_jid) = v_primary_alias
          and lower(identity_alias.canonical_jid) <> v_primary_alias
          and conversation.deleted_at is null
        limit 2
      ) as candidate;

      if pg_catalog.cardinality(v_candidate_conversation_ids) > 1 then
        v_quarantine_reason := 'whatsapp_conversation_identity_ambiguous_at_ingress';
        v_candidate_conversation_ids := '{}'::uuid[];
      end if;
    end if;

    -- Otherwise prefer the provider's primary exact JID. Retired rows are
    -- immutable history and never become a fresh event destination.
    if v_quarantine_reason is null
       and pg_catalog.cardinality(v_candidate_conversation_ids) = 0 then
    select coalesce(pg_catalog.array_agg(conversation.id order by conversation.id), '{}'::uuid[])
    into v_candidate_conversation_ids
    from public.whatsapp_conversations as conversation
    where conversation.organization_id = p_organization_id
      and conversation.session_id = p_session_id
      and conversation.deleted_at is null
      and v_primary_alias is not null
      and lower(conversation.remote_jid) = v_primary_alias;
    end if;

    if v_quarantine_reason is null
       and pg_catalog.cardinality(v_candidate_conversation_ids) = 0 then
      select coalesce(pg_catalog.array_agg(candidate.id order by candidate.id), '{}'::uuid[])
      into v_candidate_conversation_ids
      from (
        select distinct conversation.id
        from public.whatsapp_conversations as conversation
        where conversation.organization_id = p_organization_id
          and conversation.session_id = p_session_id
          and conversation.deleted_at is null
          and (
            lower(conversation.remote_jid) = any(v_aliases)
            or (
              v_phone_key <> ''
              and public.normalize_phone(conversation.contact_phone) = v_phone_key
            )
            or exists (
              select 1
              from public.whatsapp_contact_identity_aliases as identity_alias
              where identity_alias.organization_id = p_organization_id
                and identity_alias.session_id = p_session_id
                and lower(identity_alias.alias_jid) = any(v_aliases)
                and lower(identity_alias.canonical_jid) = lower(conversation.remote_jid)
            )
          )
        limit 2
      ) as candidate;
    end if;

    if pg_catalog.cardinality(v_candidate_conversation_ids) > 1 then
      v_quarantine_reason := 'whatsapp_conversation_identity_ambiguous_at_ingress';
      v_candidate_conversation_ids := '{}'::uuid[];
    end if;
  end if;

  if v_quarantine_reason is null
     and pg_catalog.cardinality(v_candidate_conversation_ids) = 1 then
    select conversation.*
    into v_conversation
    from public.whatsapp_conversations as conversation
    where conversation.id = v_candidate_conversation_ids[1]
      and conversation.organization_id = p_organization_id
      and conversation.session_id = p_session_id
      and (
        v_state = 'provider_replay'
        or conversation.deleted_at is null
      )
    for share;

    if not found then
      if v_state <> 'provider_replay' then
        -- Discovery is deliberately non-locking. If an identity reconciler
        -- retired the selected route while this statement waited for its
        -- conversation lock, retry from a fresh snapshot instead of freezing
        -- the now-deleted physical conversation into durable provenance.
        raise exception using
          errcode = '40001',
          message = 'whatsapp_conversation_identity_changed_at_ingress';
      end if;
      v_candidate_conversation_ids := '{}'::uuid[];
    else
      select binding.*
      into v_active
      from public.whatsapp_conversation_lead_bindings as binding
      where binding.organization_id = p_organization_id
        and binding.conversation_id = v_conversation.id
        and binding.active_to is null
      limit 1
      for share;

      -- Binding writers and native identity reconciliation both lock aliases
      -- only after their conversation/binding locks. Keep that global order and
      -- retain every matching alias row in deterministic UUID order until the
      -- immutable routing snapshot is inserted below.
      perform identity_alias.id
      from public.whatsapp_contact_identity_aliases as identity_alias
      where identity_alias.organization_id = p_organization_id
        and identity_alias.session_id = p_session_id
        and lower(identity_alias.alias_jid) = any(v_aliases)
      order by identity_alias.id
      for share of identity_alias;

      if v_state <> 'provider_replay' and v_primary_alias like '%@lid' then
        select coalesce(pg_catalog.array_agg(candidate.id order by candidate.id), '{}'::uuid[])
        into v_locked_alias_canonical_conversation_ids
        from (
          select distinct conversation.id
          from public.whatsapp_contact_identity_aliases as identity_alias
          join public.whatsapp_conversations as conversation
            on conversation.organization_id = identity_alias.organization_id
           and conversation.session_id = identity_alias.session_id
           and lower(conversation.remote_jid) = lower(identity_alias.canonical_jid)
          where identity_alias.organization_id = p_organization_id
            and identity_alias.session_id = p_session_id
            and lower(identity_alias.alias_jid) = v_primary_alias
            and lower(identity_alias.canonical_jid) <> v_primary_alias
            and conversation.deleted_at is null
          limit 2
        ) as candidate;

        if pg_catalog.cardinality(v_locked_alias_canonical_conversation_ids) > 1 then
          v_quarantine_reason := 'whatsapp_conversation_identity_ambiguous_at_ingress';
        elsif pg_catalog.cardinality(v_locked_alias_canonical_conversation_ids) = 1
              and v_locked_alias_canonical_conversation_ids[1] is distinct from v_conversation.id then
          -- The alias changed after discovery but before its row lock. Retrying
          -- is safe because no inbox/snapshot row from this transaction commits.
          raise exception using
            errcode = '40001',
            message = 'whatsapp_conversation_identity_changed_at_ingress';
        end if;
      end if;

      if (v_active.id is null and v_conversation.lead_id is not null)
         or (v_active.id is not null and v_active.lead_id is distinct from v_conversation.lead_id) then
        v_quarantine_reason := 'whatsapp_conversation_binding_inconsistent_at_ingress';
      elsif v_conversation.lead_id is not null and exists (
        select 1
        from public.whatsapp_contact_identity_aliases as identity_alias
        where identity_alias.organization_id = p_organization_id
          and identity_alias.session_id = p_session_id
          and lower(identity_alias.alias_jid) = any(v_aliases)
          and lower(identity_alias.canonical_jid) = lower(v_conversation.remote_jid)
          and identity_alias.lead_id is not null
          and identity_alias.lead_id is distinct from v_conversation.lead_id
      ) then
        v_quarantine_reason := 'whatsapp_identity_alias_lead_conflict_at_ingress';
      end if;
    end if;
  end if;

  if v_quarantine_reason is null and v_state <> 'provider_replay' then
    if v_context_kind = 'contextual_intake' then
      if v_context_proof is null then
        v_quarantine_reason := 'whatsapp_contextual_intake_proof_required';
      elsif p_origin_round_robin_id is not null and not exists (
        select 1
        from public.round_robins as queue
        where queue.id = p_origin_round_robin_id
          and queue.organization_id = p_organization_id
          and coalesce(queue.is_active, true) = true
      ) then
        v_quarantine_reason := 'whatsapp_contextual_intake_queue_invalid';
      elsif p_rule_id is not null and p_origin_round_robin_id is null then
        v_quarantine_reason := 'whatsapp_contextual_intake_queue_required';
      end if;

      if v_quarantine_reason is null and p_provider_event_lead_id is not null then
        if not exists (
          select 1 from public.leads as lead
          where lead.id = p_provider_event_lead_id
            and lead.organization_id = p_organization_id
        ) then
          v_quarantine_reason := 'whatsapp_contextual_intake_event_lead_invalid';
        else
          v_target_lead_id := p_provider_event_lead_id;
        end if;
      end if;

      if v_quarantine_reason is null
         and v_target_lead_id is null
         and v_phone_key <> '' then
        select coalesce(pg_catalog.array_agg(match.id order by match.id), '{}'::uuid[])
        into v_candidate_lead_ids
        from (
          select lead.id
          from public.leads as lead
          where lead.organization_id = p_organization_id
            and public.normalize_phone(lead.phone) = v_phone_key
            and (
              (
                p_origin_round_robin_id is not null
                and lead.intake_scope_key = 'queue:' || p_origin_round_robin_id::text
              )
              or (
                p_origin_round_robin_id is null
                and (
                  v_context_proof not like 'canonical_intake_v1:%'
                  or lead.intake_scope_key = 'unscoped'
                )
              )
            )
          limit 2
        ) as match;
        if pg_catalog.cardinality(v_candidate_lead_ids) > 1 then
          v_quarantine_reason := 'whatsapp_lead_phone_ambiguous_at_ingress';
        elsif pg_catalog.cardinality(v_candidate_lead_ids) = 1 then
          v_target_lead_id := v_candidate_lead_ids[1];
        end if;
      end if;
      v_state := 'contextual_intake';
    elsif v_conversation.id is not null and v_conversation.lead_id is not null then
      v_target_lead_id := v_conversation.lead_id;
      v_state := 'bound';
    else
      select coalesce(pg_catalog.array_agg(distinct identity_alias.lead_id order by identity_alias.lead_id), '{}'::uuid[])
      into v_candidate_lead_ids
      from public.whatsapp_contact_identity_aliases as identity_alias
      where identity_alias.organization_id = p_organization_id
        and identity_alias.session_id = p_session_id
        and lower(identity_alias.alias_jid) = any(v_aliases)
        and identity_alias.lead_id is not null;

      if pg_catalog.cardinality(v_candidate_lead_ids) > 1 then
        v_quarantine_reason := 'whatsapp_identity_alias_lead_ambiguous_at_ingress';
      elsif pg_catalog.cardinality(v_candidate_lead_ids) = 1 then
        v_target_lead_id := v_candidate_lead_ids[1];
        v_state := 'lead_match';
      elsif v_phone_key <> '' then
        select coalesce(pg_catalog.array_agg(match.id order by match.id), '{}'::uuid[])
        into v_candidate_lead_ids
        from (
          select lead.id
          from public.leads as lead
          where lead.organization_id = p_organization_id
            and public.normalize_phone(lead.phone) = v_phone_key
          limit 2
        ) as match;
        if pg_catalog.cardinality(v_candidate_lead_ids) > 1 then
          v_quarantine_reason := 'whatsapp_lead_phone_ambiguous_at_ingress';
        elsif pg_catalog.cardinality(v_candidate_lead_ids) = 1 then
          v_target_lead_id := v_candidate_lead_ids[1];
          v_state := 'lead_match';
        end if;
      end if;
    end if;
  end if;

  if v_quarantine_reason is not null then
    v_state := 'quarantine';
    v_target_lead_id := null;
  end if;

  v_binding_eligible := v_binding_eligible
    and v_routing_key <> '__session__'
    and v_state <> 'quarantine';
  if v_binding_eligible then
    select routing_snapshot.*
    into v_predecessor
    from public.whatsapp_webhook_routing_snapshots as routing_snapshot
    where routing_snapshot.organization_id = p_organization_id
      and routing_snapshot.session_id = p_session_id
      and routing_snapshot.routing_key = v_routing_key
      and routing_snapshot.processing_epoch = p_processing_epoch
      and routing_snapshot.binding_eligible = true
      and not exists (
        select 1
        from public.whatsapp_webhook_routing_outcomes as routing_outcome
        where routing_outcome.organization_id = routing_snapshot.organization_id
          and routing_outcome.session_id = routing_snapshot.session_id
          and routing_outcome.provider_message_id = routing_snapshot.provider_message_id
          and routing_outcome.ingress_sequence = routing_snapshot.ingress_sequence
      )
    order by routing_snapshot.ingress_sequence desc
    limit 1;
    v_predecessor_provider_message_id := v_predecessor.provider_message_id;
  end if;

  v_binding_eligible := v_binding_eligible and (
    v_context_kind = 'contextual_intake'
    or v_target_lead_id is not null
    or (
      v_context_kind = 'organic'
      and v_predecessor_provider_message_id is not null
    )
  );

  if v_binding_eligible
     and v_predecessor_provider_message_id is not null
     and v_context_kind = 'organic'
     and v_state <> 'provider_replay' then
    -- The predecessor may create or select a queue-scoped card that does not
    -- exist yet. Freeze the dependency, not the old lead visible before it ran.
    v_target_mode := 'inherit_predecessor';
    v_state := 'predecessor_inherit';
    v_target_lead_id := null;
  end if;
  v_ingress_sequence := nextval('public.whatsapp_webhook_routing_ingress_sequence');

  v_snapshot := pg_catalog.jsonb_build_object(
    'version', 1,
    'processing_epoch', p_processing_epoch,
    'organization_id', p_organization_id,
    'session_id', p_session_id,
    'provider_message_id', v_provider_message_id,
    'inbox_event_key', v_inbox_event_key,
    'processing_lane', v_processing_lane,
    'state', v_state,
    'conversation_id', v_conversation.id,
    'event_lead_id', v_target_lead_id,
    'current_lead_id', v_conversation.lead_id,
    'active_binding_id', v_active.id,
    'quarantine_reason', v_quarantine_reason,
    'context_kind', v_context_kind,
    'context_proof', v_context_proof,
    'rule_id', p_rule_id,
    'origin_round_robin_id', p_origin_round_robin_id,
    'managed_message_distribution', v_managed_message_distribution,
    'managed_event_pending', v_managed_event_pending,
    'managed_event_handled', v_managed_event_handled,
    'routing_key', v_routing_key,
    'binding_eligible', v_binding_eligible,
    'target_mode', v_target_mode,
    'ingress_sequence', v_ingress_sequence,
    'predecessor_provider_message_id', v_predecessor_provider_message_id,
    'predecessor_inbox_event_key', v_predecessor.inbox_event_key,
    'predecessor_processing_lane', v_predecessor.processing_lane,
    'captured_at', clock_timestamp()
  );

  insert into public.whatsapp_webhook_routing_snapshots (
    organization_id,
    session_id,
    provider_message_id,
    inbox_event_key,
    processing_lane,
    routing_key,
    ingress_sequence,
    predecessor_provider_message_id,
    binding_eligible,
    target_mode,
    processing_epoch,
    snapshot
  ) values (
    p_organization_id,
    p_session_id,
    v_provider_message_id,
    v_inbox_event_key,
    v_processing_lane,
    v_routing_key,
    v_ingress_sequence,
    v_predecessor_provider_message_id,
    v_binding_eligible,
    v_target_mode,
    p_processing_epoch,
    v_snapshot
  )
  on conflict (organization_id, session_id, provider_message_id) do nothing;

  if not found then
    select routing_snapshot.*
    into v_existing_snapshot
    from public.whatsapp_webhook_routing_snapshots as routing_snapshot
    where routing_snapshot.organization_id = p_organization_id
      and routing_snapshot.session_id = p_session_id
      and routing_snapshot.provider_message_id = v_provider_message_id;
    if v_existing_snapshot.routing_key is distinct from v_routing_key then
      raise exception using
        errcode = '23505',
        message = 'whatsapp_ingress_snapshot_provider_identity_conflict';
    end if;
    return v_existing_snapshot.snapshot;
  end if;

  return v_snapshot;
end;
$$;

-- The 17-argument v1 function is intentionally left unchanged for old replicas.
-- Activation is forbidden until every replica has switched to v2 ingress.
revoke all on function private.capture_whatsapp_webhook_routing_snapshot_v2(
  uuid, uuid, text, text, text, text, boolean, text[], text, text, text,
  boolean, boolean, boolean, uuid, uuid, uuid, integer
) from public, anon, authenticated;
grant execute on function private.capture_whatsapp_webhook_routing_snapshot_v2(
  uuid, uuid, text, text, text, text, boolean, text[], text, text, text,
  boolean, boolean, boolean, uuid, uuid, uuid, integer
) to service_role;

commit;
