-- Queue-scoped lead identity and durable WhatsApp conversation bindings.
--
-- Lead identity is immutable after intake. A queue may be disabled later, but
-- the originating queue remains attached to the card so a later entry through
-- another queue can create a distinct card without stealing the first one.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '5min';

alter table public.leads
  add column if not exists intake_scope_key text not null default 'unscoped',
  add column if not exists origin_round_robin_id uuid;

comment on column public.leads.intake_scope_key is
'Immutable intake identity. unscoped preserves legacy uniqueness; queue:<uuid> permits one card per originating queue.';

comment on column public.leads.origin_round_robin_id is
'Immutable originating distribution queue validated at intake. No foreign key is intentional: hard-deleting a queue must not erase or block this durable provenance.';

commit;

-- Keep unrelated ACCESS EXCLUSIVE locks in separate, restartable phases. A
-- failed later phase leaves these additive columns usable by the replay-safe
-- remainder without holding either leads or the legacy outbox for a backfill.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '5min';

alter table public.outbox_messages
  add column if not exists lead_id uuid;

comment on column public.outbox_messages.lead_id is
'Immutable lead snapshot for the legacy WhatsApp outbox. No FK by design so hard-deleting a lead cannot erase delivery provenance.';

commit;

begin;
set local lock_timeout = '5s';
set local statement_timeout = '5min';

-- B2 uses this private marker to distinguish an approved interrupted
-- DROP INDEX CONCURRENTLY from an unrelated invalid index. The marker is
-- committed before the concurrent drop begins, making a lost connection
-- replayable without guessing whether the irreversible cutover was attempted.
create table if not exists private.queue_scoped_lead_cutover_markers (
  cutover_key text primary key,
  state text not null,
  prepared_release_sha text not null,
  legacy_index_oid oid not null,
  legacy_index_definition text not null,
  prepared_at timestamp with time zone not null default now(),
  completed_at timestamp with time zone,
  updated_at timestamp with time zone not null default now(),
  constraint queue_scoped_lead_cutover_marker_state_check
    check (state in ('prepared', 'completed')),
  constraint queue_scoped_lead_cutover_marker_sha_check
    check (prepared_release_sha ~ '^[0-9a-f]{40}$')
);

comment on table private.queue_scoped_lead_cutover_markers is
'Durable forward-only recovery marker for the queue-scoped lead identity cutover. Not an application feature flag.';

revoke all on table private.queue_scoped_lead_cutover_markers
from public, anon, authenticated, service_role;

commit;

begin;
set local lock_timeout = '5s';
set local statement_timeout = '5min';

-- Backfill only from queue evidence that still resolves to the same tenant.
-- A countable initial-entry event is authoritative even when mutable lead
-- metadata was later overwritten by reentry. Lead metadata is used only as a
-- fallback when there is no valid initial event. A conflict at the earliest
-- evidence position stays unscoped instead of guessing.
create or replace function private.infer_lead_intake_origin_queue(
  p_lead_id uuid
)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  with queue_evidence as (
    select
      queue.id as round_robin_id,
      coalesce(entry.occurred_at, entry.created_at) as evidence_at,
      10 as evidence_rank
    from public.lead_entry_events as entry
    join public.leads as lead
      on lead.id = entry.lead_id
     and lead.organization_id = entry.organization_id
    cross join lateral (
      values
        (nullif(pg_catalog.btrim(entry.metadata->>'target_round_robin_id'), '')),
        (nullif(pg_catalog.btrim(entry.metadata->>'round_robin_id'), '')),
        (nullif(pg_catalog.btrim(entry.metadata #>> '{intake_result,round_robin_id}'), '')),
        (nullif(pg_catalog.btrim(entry.payload->>'target_round_robin_id'), '')),
        (nullif(pg_catalog.btrim(entry.payload->>'round_robin_id'), ''))
    ) as evidence(queue_id_text)
    join public.round_robins as queue
      on queue.organization_id = entry.organization_id
     and queue.id::text = evidence.queue_id_text
    where entry.lead_id = p_lead_id
      and entry.entry_type = 'initial'
      and entry.is_countable = true

    union all

    select
      queue.id,
      lead.created_at,
      20
    from public.leads as lead
    cross join lateral (
      values
        (nullif(pg_catalog.btrim(lead.metadata->>'target_round_robin_id'), '')),
        (nullif(pg_catalog.btrim(lead.metadata #>> '{intake_result,round_robin_id}'), ''))
    ) as evidence(queue_id_text)
    join public.round_robins as queue
      on queue.organization_id = lead.organization_id
     and queue.id::text = evidence.queue_id_text
    where lead.id = p_lead_id
  ), ranked_evidence as (
    select
      evidence.*,
      pg_catalog.dense_rank() over (
        order by
          evidence.evidence_rank asc,
          evidence.evidence_at asc nulls last
      ) as evidence_position
    from queue_evidence as evidence
  ), first_evidence as (
    select distinct evidence.round_robin_id
    from ranked_evidence as evidence
    where evidence.evidence_position = 1
  )
  select case
    when pg_catalog.count(*) = 1
      then (pg_catalog.array_agg(first_evidence.round_robin_id))[1]
    else null::uuid
  end
  from first_evidence
$$;

revoke all on function private.infer_lead_intake_origin_queue(uuid)
from public, anon, authenticated, service_role;

with inferred_origin as materialized (
  select
    lead.id as lead_id,
    private.infer_lead_intake_origin_queue(lead.id) as round_robin_id
  from public.leads as lead
)
update public.leads as lead
set
  origin_round_robin_id = evidence.round_robin_id,
  intake_scope_key = 'queue:' || evidence.round_robin_id::text
from inferred_origin as evidence
where evidence.lead_id = lead.id
  and evidence.round_robin_id is not null
  and (
    lead.origin_round_robin_id is distinct from evidence.round_robin_id
    or lead.intake_scope_key is distinct from 'queue:' || evidence.round_robin_id::text
  );

update public.leads
set intake_scope_key = 'unscoped'
where origin_round_robin_id is null
  and intake_scope_key is distinct from 'unscoped';

commit;

begin;
set local lock_timeout = '5s';
set local statement_timeout = '5min';

do $install_leads_intake_scope_key_check$
declare
  v_definition text;
begin
  select pg_catalog.pg_get_constraintdef(constraint_row.oid, true)
  into v_definition
  from pg_catalog.pg_constraint as constraint_row
  where constraint_row.conrelid = 'public.leads'::regclass
    and constraint_row.conname = 'leads_intake_scope_key_check';

  if v_definition is null then
    alter table public.leads
      add constraint leads_intake_scope_key_check
      check (
        intake_scope_key = 'unscoped'
        or intake_scope_key ~ '^queue:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      ) not valid;
  elsif v_definition not ilike '%intake_scope_key = ''unscoped''%'
        or v_definition not ilike '%queue:%' then
    raise exception using
      errcode = '55000',
      message = 'leads_intake_scope_key_check_definition_mismatch';
  end if;
end;
$install_leads_intake_scope_key_check$;

commit;

begin;
set local lock_timeout = '5s';
set local statement_timeout = '5min';

alter table public.leads
  validate constraint leads_intake_scope_key_check;

commit;

begin;
set local lock_timeout = '5s';
set local statement_timeout = '5min';

create or replace function private.lead_intake_scope_for_queue(
  p_organization_id uuid,
  p_origin_round_robin_id uuid
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_organization_id is null then
    raise exception using
      errcode = '22023',
      message = 'lead_intake_organization_required';
  end if;

  if p_origin_round_robin_id is null then
    return 'unscoped';
  end if;

  if not exists (
    select 1
    from public.round_robins as queue
    where queue.id = p_origin_round_robin_id
      and queue.organization_id = p_organization_id
  ) then
    raise exception using
      errcode = '23503',
      message = 'lead_origin_round_robin_tenant_mismatch';
  end if;

  return 'queue:' || p_origin_round_robin_id::text;
end;
$$;

revoke all on function private.lead_intake_scope_for_queue(uuid, uuid)
from public, anon, authenticated, service_role;

create or replace function private.enforce_lead_intake_identity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expected_scope text;
  v_is_pending_meta_phone_claim boolean := false;
begin
  if tg_op = 'UPDATE' then
    if new.organization_id is not distinct from old.organization_id
       and new.origin_round_robin_id is not distinct from old.origin_round_robin_id
       and new.intake_scope_key is not distinct from old.intake_scope_key then
      -- Do not revalidate a durable queue UUID after the queue is hard-deleted.
      return new;
    end if;

    v_is_pending_meta_phone_claim :=
      new.organization_id is not distinct from old.organization_id
      and old.origin_round_robin_id is null
      and old.intake_scope_key = 'unscoped'
      and coalesce(public.normalize_phone(old.phone), '') = ''
      and coalesce(public.normalize_phone(new.phone), '') <> ''
      and new.origin_round_robin_id is not null
      and old.meta_lead_id is not null
      and lower(coalesce(old.metadata->>'meta_details_status', '')) = 'pending';

    if not v_is_pending_meta_phone_claim then
      raise exception using
        errcode = '23514',
        message = 'lead_intake_identity_immutable';
    end if;
  end if;

  v_expected_scope := private.lead_intake_scope_for_queue(
    new.organization_id,
    new.origin_round_robin_id
  );

  if tg_op = 'INSERT'
     and new.origin_round_robin_id is not null
     and coalesce(new.intake_scope_key, 'unscoped') = 'unscoped' then
    new.intake_scope_key := v_expected_scope;
  elsif new.intake_scope_key is distinct from v_expected_scope then
    raise exception using
      errcode = '23514',
      message = 'lead_intake_scope_mismatch';
  end if;

  return new;
end;
$$;

revoke all on function private.enforce_lead_intake_identity()
from public, anon, authenticated, service_role;

drop trigger if exists enforce_lead_intake_identity_before_write on public.leads;
create trigger enforce_lead_intake_identity_before_write
before insert or update of organization_id, origin_round_robin_id, intake_scope_key
on public.leads
for each row
execute function private.enforce_lead_intake_identity();

commit;

begin;
set local lock_timeout = '5s';
set local statement_timeout = '5min';

-- Explicit queue-scoped lookup. The queue argument is required, tenant
-- validated and never falls back to another card with the same phone.
create or replace function public.find_lead_by_normalized_phone(
  p_organization_id uuid,
  p_phone text,
  p_origin_round_robin_id uuid
)
returns table(
  id uuid,
  name text,
  assigned_user_id uuid,
  whatsapp_avatar_url text,
  property_code text,
  property_id uuid,
  interest_property_id uuid,
  source_detail text,
  metadata jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_phone_key text := coalesce(public.normalize_phone(p_phone), '');
  v_scope_key text;
  v_match_count integer;
begin
  if p_origin_round_robin_id is null then
    raise exception using
      errcode = '22023',
      message = 'lead_origin_round_robin_required';
  end if;

  if v_phone_key = '' then
    return;
  end if;

  v_scope_key := private.lead_intake_scope_for_queue(
    p_organization_id,
    p_origin_round_robin_id
  );

  select count(*)::integer
  into v_match_count
  from (
    select lead.id
    from public.leads as lead
    where lead.organization_id = p_organization_id
      and lead.intake_scope_key = v_scope_key
      and lead.phone is not null
      and btrim(lead.phone) <> ''
      and public.normalize_phone(lead.phone) = v_phone_key
    limit 2
  ) as matches;

  if v_match_count > 1 then
    raise exception using
      errcode = '23505',
      message = 'lead_queue_phone_ambiguous';
  end if;

  return query
  select
    lead.id,
    lead.name,
    lead.assigned_user_id,
    lead.whatsapp_avatar_url,
    lead.property_code,
    lead.property_id,
    lead.interest_property_id,
    lead.source_detail,
    lead.metadata
  from public.leads as lead
  where lead.organization_id = p_organization_id
    and lead.intake_scope_key = v_scope_key
    and lead.phone is not null
    and btrim(lead.phone) <> ''
    and public.normalize_phone(lead.phone) = v_phone_key
  limit 1;
end;
$$;

-- The compatibility lookup may infer a card only while the normalized phone
-- identifies exactly one card across every scope in the tenant. Once multiple
-- queue cards exist it fails closed rather than choosing one arbitrarily.
create or replace function public.find_lead_by_normalized_phone(
  p_organization_id uuid,
  p_phone text
)
returns table(
  id uuid,
  name text,
  assigned_user_id uuid,
  whatsapp_avatar_url text,
  property_code text,
  property_id uuid,
  interest_property_id uuid,
  source_detail text,
  metadata jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_phone_key text := coalesce(public.normalize_phone(p_phone), '');
  v_match_count integer;
begin
  if p_organization_id is null or v_phone_key = '' then
    return;
  end if;

  select count(*)::integer
  into v_match_count
  from (
    select lead.id
    from public.leads as lead
    where lead.organization_id = p_organization_id
      and lead.phone is not null
      and btrim(lead.phone) <> ''
      and public.normalize_phone(lead.phone) = v_phone_key
    limit 2
  ) as matches;

  if v_match_count > 1 then
    raise exception using
      errcode = '23505',
      message = 'whatsapp_lead_phone_ambiguous';
  end if;

  return query
  select
    lead.id,
    lead.name,
    lead.assigned_user_id,
    lead.whatsapp_avatar_url,
    lead.property_code,
    lead.property_id,
    lead.interest_property_id,
    lead.source_detail,
    lead.metadata
  from public.leads as lead
  where lead.organization_id = p_organization_id
    and lead.phone is not null
    and btrim(lead.phone) <> ''
    and public.normalize_phone(lead.phone) = v_phone_key
  limit 1;
end;
$$;

revoke all on function public.find_lead_by_normalized_phone(uuid, text)
from public, anon, authenticated;
grant execute on function public.find_lead_by_normalized_phone(uuid, text)
to service_role;

revoke all on function public.find_lead_by_normalized_phone(uuid, text, uuid)
from public, anon, authenticated;
grant execute on function public.find_lead_by_normalized_phone(uuid, text, uuid)
to service_role;

-- New queue-aware overload. All arguments are explicit because PostgreSQL does
-- not allow a required argument after parameters with defaults.
create or replace function public.upsert_whatsapp_webhook_lead(
  p_organization_id uuid,
  p_name text,
  p_phone text,
  p_whatsapp text,
  p_whatsapp_avatar_url text,
  p_whatsapp_avatar_synced_at timestamptz,
  p_source_detail text,
  p_source_session_id uuid,
  p_initial_message text,
  p_message text,
  p_property_code text,
  p_property_id uuid,
  p_interest_property_id uuid,
  p_assigned_user_id uuid,
  p_assigned_at timestamptz,
  p_pipeline_id uuid,
  p_stage_id uuid,
  p_created_by uuid,
  p_first_touch_at timestamptz,
  p_first_touch_channel text,
  p_last_contact_at timestamptz,
  p_metadata jsonb,
  p_origin_round_robin_id uuid
)
returns table(
  id uuid,
  name text,
  assigned_user_id uuid,
  whatsapp_avatar_url text,
  property_code text,
  property_id uuid,
  interest_property_id uuid,
  source_detail text,
  metadata jsonb,
  is_new_lead boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := coalesce(p_last_contact_at, now());
  v_normalized_phone text := public.normalize_phone(p_phone);
  v_scope_key text;
  v_lead public.leads%rowtype;
  v_lock_key text;
  v_constraint_name text;
  v_use_legacy_global_identity boolean;
begin
  if p_organization_id is null then
    raise exception 'p_organization_id is required' using errcode = '22023';
  end if;

  if nullif(btrim(coalesce(p_phone, '')), '') is null
     or nullif(v_normalized_phone, '') is null then
    raise exception 'p_phone is required' using errcode = '22023';
  end if;

  v_scope_key := private.lead_intake_scope_for_queue(
    p_organization_id,
    p_origin_round_robin_id
  );

  -- A1/A2 deliberately retain the legacy global phone index while compatible
  -- writers are deployed. During only that window every caller must retain
  -- global re-entry semantics, including a queue-aware caller whose requested
  -- queue differs. B2 removes the legacy index and this branch automatically
  -- retires with it, enabling the new queue-scoped identity.
  v_use_legacy_global_identity :=
    pg_catalog.to_regclass('public.leads_org_phone_unique') is not null;

  v_lock_key := p_organization_id::text
    || ':'
    || case
      when v_use_legacy_global_identity then 'legacy-global'
      else v_scope_key
    end
    || ':'
    || v_normalized_phone;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_lock_key, 0)
  );

  select lead.*
  into v_lead
  from public.leads as lead
  where lead.organization_id = p_organization_id
    and (
      v_use_legacy_global_identity
      or lead.intake_scope_key = v_scope_key
    )
    and lead.phone is not null
    and btrim(lead.phone) <> ''
    and public.normalize_phone(lead.phone) = v_normalized_phone
  limit 1
  for update;

  if found then
    update public.leads as lead
    set
      whatsapp_avatar_url = case
        when p_whatsapp_avatar_url is not null
          and nullif(lead.whatsapp_avatar_url, '') is null
          then p_whatsapp_avatar_url
        else lead.whatsapp_avatar_url
      end,
      whatsapp_avatar_synced_at = case
        when p_whatsapp_avatar_url is not null
          and nullif(lead.whatsapp_avatar_url, '') is null
          then coalesce(p_whatsapp_avatar_synced_at, v_now)
        else lead.whatsapp_avatar_synced_at
      end,
      property_code = coalesce(nullif(lead.property_code, ''), p_property_code),
      property_id = coalesce(lead.property_id, p_property_id),
      interest_property_id = coalesce(lead.interest_property_id, p_interest_property_id),
      source_detail = coalesce(nullif(lead.source_detail, ''), p_source_detail),
      source_session_id = coalesce(lead.source_session_id, p_source_session_id),
      first_touch_at = coalesce(lead.first_touch_at, p_first_touch_at),
      first_touch_channel = coalesce(nullif(lead.first_touch_channel, ''), p_first_touch_channel),
      last_contact_at = v_now,
      -- Queue identity is stored in dedicated immutable columns. During the
      -- A1/A2 compatibility window a queue-B event may still reenter the one
      -- globally unique queue-A card, so intake keys from event metadata must
      -- never cosmetically relabel that card.
      metadata = coalesce(lead.metadata, '{}'::jsonb)
        || (
          coalesce(p_metadata, '{}'::jsonb)
          - 'intake_scope_key'
          - 'origin_round_robin_id'
        ),
      updated_at = v_now
    where lead.id = v_lead.id
    returning lead.* into v_lead;

    id := v_lead.id;
    name := v_lead.name;
    assigned_user_id := v_lead.assigned_user_id;
    whatsapp_avatar_url := v_lead.whatsapp_avatar_url;
    property_code := v_lead.property_code;
    property_id := v_lead.property_id;
    interest_property_id := v_lead.interest_property_id;
    source_detail := v_lead.source_detail;
    metadata := v_lead.metadata;
    is_new_lead := false;
    return next;
    return;
  end if;

  if not public.whatsapp_webhook_has_lead_creation_context(coalesce(p_metadata, '{}'::jsonb)) then
    return;
  end if;

  insert into public.leads (
    organization_id,
    intake_scope_key,
    origin_round_robin_id,
    name,
    phone,
    whatsapp_avatar_url,
    whatsapp_avatar_synced_at,
    source,
    source_detail,
    source_session_id,
    initial_message,
    message,
    property_code,
    property_id,
    interest_property_id,
    assigned_user_id,
    assigned_at,
    pipeline_id,
    stage_id,
    created_by,
    first_touch_at,
    first_touch_channel,
    last_contact_at,
    metadata
  ) values (
    p_organization_id,
    v_scope_key,
    p_origin_round_robin_id,
    coalesce(nullif(btrim(p_name), ''), p_phone),
    p_phone,
    p_whatsapp_avatar_url,
    p_whatsapp_avatar_synced_at,
    'whatsapp',
    p_source_detail,
    p_source_session_id,
    p_initial_message,
    p_message,
    p_property_code,
    p_property_id,
    p_interest_property_id,
    p_assigned_user_id,
    p_assigned_at,
    p_pipeline_id,
    p_stage_id,
    p_created_by,
    p_first_touch_at,
    p_first_touch_channel,
    v_now,
    coalesce(p_metadata, '{}'::jsonb)
  )
  returning * into v_lead;

  id := v_lead.id;
  name := v_lead.name;
  assigned_user_id := v_lead.assigned_user_id;
  whatsapp_avatar_url := v_lead.whatsapp_avatar_url;
  property_code := v_lead.property_code;
  property_id := v_lead.property_id;
  interest_property_id := v_lead.interest_property_id;
  source_detail := v_lead.source_detail;
  metadata := v_lead.metadata;
  is_new_lead := true;
  return next;
exception
  when unique_violation then
    get stacked diagnostics v_constraint_name = constraint_name;

    if v_constraint_name = 'leads_org_phone_unique'
       and v_use_legacy_global_identity then
      select lead.*
      into v_lead
      from public.leads as lead
      where lead.organization_id = p_organization_id
        and lead.phone is not null
        and btrim(lead.phone) <> ''
        and public.normalize_phone(lead.phone) = v_normalized_phone
      limit 1;
    elsif v_constraint_name = 'leads_org_scope_phone_unique' then
      select lead.*
      into v_lead
      from public.leads as lead
      where lead.organization_id = p_organization_id
        and lead.intake_scope_key = v_scope_key
        and lead.phone is not null
        and btrim(lead.phone) <> ''
        and public.normalize_phone(lead.phone) = v_normalized_phone
      limit 1;
    else
      raise;
    end if;

    if not found then
      raise;
    end if;

    id := v_lead.id;
    name := v_lead.name;
    assigned_user_id := v_lead.assigned_user_id;
    whatsapp_avatar_url := v_lead.whatsapp_avatar_url;
    property_code := v_lead.property_code;
    property_id := v_lead.property_id;
    interest_property_id := v_lead.interest_property_id;
    source_detail := v_lead.source_detail;
    metadata := v_lead.metadata;
    is_new_lead := false;
    return next;
end;
$$;

-- Backward-compatible 22-argument wrapper. Legacy callers remain unscoped;
-- queue-aware callers must invoke the explicit 23-argument overload.
create or replace function public.upsert_whatsapp_webhook_lead(
  p_organization_id uuid,
  p_name text,
  p_phone text,
  p_whatsapp text default null,
  p_whatsapp_avatar_url text default null,
  p_whatsapp_avatar_synced_at timestamptz default null,
  p_source_detail text default null,
  p_source_session_id uuid default null,
  p_initial_message text default null,
  p_message text default null,
  p_property_code text default null,
  p_property_id uuid default null,
  p_interest_property_id uuid default null,
  p_assigned_user_id uuid default null,
  p_assigned_at timestamptz default null,
  p_pipeline_id uuid default null,
  p_stage_id uuid default null,
  p_created_by uuid default null,
  p_first_touch_at timestamptz default null,
  p_first_touch_channel text default null,
  p_last_contact_at timestamptz default null,
  p_metadata jsonb default '{}'::jsonb
)
returns table(
  id uuid,
  name text,
  assigned_user_id uuid,
  whatsapp_avatar_url text,
  property_code text,
  property_id uuid,
  interest_property_id uuid,
  source_detail text,
  metadata jsonb,
  is_new_lead boolean
)
language sql
security definer
set search_path = ''
as $$
  select *
  from public.upsert_whatsapp_webhook_lead(
    p_organization_id,
    p_name,
    p_phone,
    p_whatsapp,
    p_whatsapp_avatar_url,
    p_whatsapp_avatar_synced_at,
    p_source_detail,
    p_source_session_id,
    p_initial_message,
    p_message,
    p_property_code,
    p_property_id,
    p_interest_property_id,
    p_assigned_user_id,
    p_assigned_at,
    p_pipeline_id,
    p_stage_id,
    p_created_by,
    p_first_touch_at,
    p_first_touch_channel,
    p_last_contact_at,
    p_metadata,
    null::uuid
  );
$$;

revoke all on function public.upsert_whatsapp_webhook_lead(
  uuid, text, text, text, text, timestamptz, text, uuid, text, text, text,
  uuid, uuid, uuid, timestamptz, uuid, uuid, uuid, timestamptz, text,
  timestamptz, jsonb
) from public, anon, authenticated;
grant execute on function public.upsert_whatsapp_webhook_lead(
  uuid, text, text, text, text, timestamptz, text, uuid, text, text, text,
  uuid, uuid, uuid, timestamptz, uuid, uuid, uuid, timestamptz, text,
  timestamptz, jsonb
) to service_role;

revoke all on function public.upsert_whatsapp_webhook_lead(
  uuid, text, text, text, text, timestamptz, text, uuid, text, text, text,
  uuid, uuid, uuid, timestamptz, uuid, uuid, uuid, timestamptz, text,
  timestamptz, jsonb, uuid
) from public, anon, authenticated;
grant execute on function public.upsert_whatsapp_webhook_lead(
  uuid, text, text, text, text, timestamptz, text, uuid, text, text, text,
  uuid, uuid, uuid, timestamptz, uuid, uuid, uuid, timestamptz, text,
  timestamptz, jsonb, uuid
) to service_role;

commit;

begin;
set local lock_timeout = '5s';
set local statement_timeout = '5min';

create table if not exists public.whatsapp_conversation_lead_bindings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  conversation_id uuid not null references public.whatsapp_conversations(id) on delete cascade,
  session_id uuid references public.whatsapp_sessions(id) on delete set null,
  lead_id uuid not null,
  previous_lead_id uuid,
  assigned_user_id uuid references public.users(id) on delete set null,
  provider_message_id text,
  changed boolean not null default true,
  stale boolean not null default false,
  active_from timestamptz not null default clock_timestamp(),
  active_to timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  constraint whatsapp_conversation_lead_bindings_window_check
    check (active_to is null or active_to >= active_from),
  constraint whatsapp_conversation_lead_bindings_provider_message_check
    check (provider_message_id is null or btrim(provider_message_id) <> '')
);

commit;

begin;
set local lock_timeout = '5s';
set local statement_timeout = '5min';

create unique index if not exists whatsapp_conversation_lead_bindings_one_active_idx
  on public.whatsapp_conversation_lead_bindings (conversation_id)
  where active_to is null;

create unique index if not exists whatsapp_conversation_lead_bindings_provider_event_idx
  on public.whatsapp_conversation_lead_bindings (
    organization_id,
    session_id,
    provider_message_id
  )
  where provider_message_id is not null
    and session_id is not null;

create unique index if not exists whatsapp_conversation_lead_bindings_conversation_event_idx
  on public.whatsapp_conversation_lead_bindings (
    organization_id,
    conversation_id,
    provider_message_id
  )
  where provider_message_id is not null;

create index if not exists whatsapp_conversation_lead_bindings_history_idx
  on public.whatsapp_conversation_lead_bindings (
    organization_id,
    conversation_id,
    active_from desc,
    id
  );

alter table public.whatsapp_conversation_lead_bindings enable row level security;

revoke all on table public.whatsapp_conversation_lead_bindings
from public, anon, authenticated;
grant select, insert, update on table public.whatsapp_conversation_lead_bindings
to service_role;

comment on table public.whatsapp_conversation_lead_bindings is
'Backend-only immutable lead-binding history for a physical WhatsApp conversation. Exactly one interval may be active.';

comment on column public.whatsapp_conversation_lead_bindings.lead_id is
'Immutable lead UUID tombstone. No FK by design: hard deletion must not erase provider-event replay/idempotency history.';

comment on column public.whatsapp_conversation_lead_bindings.previous_lead_id is
'Immutable prior-lead UUID tombstone. No FK by design so audit provenance survives CRM hard deletion.';

comment on column public.whatsapp_conversation_lead_bindings.stale is
'True only when an intake event lost the compare-and-swap race against a newer active binding. The event remains immutable history and can never become current on replay.';

commit;

begin;
set local lock_timeout = '5s';
set local statement_timeout = '5min';

create or replace function private.enforce_whatsapp_conversation_lead_binding()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conversation public.whatsapp_conversations%rowtype;
begin
  if tg_op = 'UPDATE' then
    if new.organization_id is distinct from old.organization_id
       or new.conversation_id is distinct from old.conversation_id
       or not (
         new.session_id is not distinct from old.session_id
         or (old.session_id is not null and new.session_id is null)
       )
       or new.lead_id is distinct from old.lead_id
       or not (
         new.previous_lead_id is not distinct from old.previous_lead_id
         or (old.previous_lead_id is not null and new.previous_lead_id is null)
       )
       or not (
         new.assigned_user_id is not distinct from old.assigned_user_id
         or (old.assigned_user_id is not null and new.assigned_user_id is null)
       )
       or new.provider_message_id is distinct from old.provider_message_id
       or new.changed is distinct from old.changed
       or new.stale is distinct from old.stale
       or new.active_from is distinct from old.active_from
       or new.created_at is distinct from old.created_at
       or not (
         new.active_to is not distinct from old.active_to
         or (
           old.active_to is null
           and new.active_to is not null
           and new.active_to >= old.active_from
         )
       ) then
      raise exception using
        errcode = '23514',
        message = 'whatsapp_conversation_lead_binding_immutable';
    end if;
    return new;
  end if;

  select conversation.*
  into v_conversation
  from public.whatsapp_conversations as conversation
  where conversation.id = new.conversation_id;

  if not found or v_conversation.organization_id is distinct from new.organization_id then
    raise exception using
      errcode = '23503',
      message = 'whatsapp_binding_conversation_tenant_mismatch';
  end if;

  if v_conversation.session_id is distinct from new.session_id then
    raise exception using
      errcode = '23503',
      message = 'whatsapp_binding_session_mismatch';
  end if;

  if not exists (
    select 1
    from public.leads as lead
    where lead.id = new.lead_id
      and lead.organization_id = new.organization_id
  ) then
    raise exception using
      errcode = '23503',
      message = 'whatsapp_binding_lead_tenant_mismatch';
  end if;

  if new.previous_lead_id is not null
     and not exists (
       select 1
       from public.leads as lead
       where lead.id = new.previous_lead_id
         and lead.organization_id = new.organization_id
     ) then
    raise exception using
      errcode = '23503',
      message = 'whatsapp_binding_previous_lead_tenant_mismatch';
  end if;

  if new.assigned_user_id is not null
     and not exists (
       select 1
       from public.organization_members as membership
       join public.users as app_user
         on app_user.id = membership.user_id
        and app_user.is_active = true
       where membership.organization_id = new.organization_id
         and membership.user_id = new.assigned_user_id
         and membership.is_active = true
         and membership.deleted_at is null
     ) then
    raise exception using
      errcode = '23503',
      message = 'whatsapp_binding_assignee_tenant_mismatch';
  end if;

  new.provider_message_id := nullif(btrim(new.provider_message_id), '');
  return new;
end;
$$;

revoke all on function private.enforce_whatsapp_conversation_lead_binding()
from public, anon, authenticated, service_role;

drop trigger if exists enforce_whatsapp_conversation_lead_binding_before_write
on public.whatsapp_conversation_lead_bindings;

create trigger enforce_whatsapp_conversation_lead_binding_before_write
before insert or update on public.whatsapp_conversation_lead_bindings
for each row
execute function private.enforce_whatsapp_conversation_lead_binding();

create or replace function private.close_whatsapp_bindings_before_lead_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_closed_at timestamptz := clock_timestamp();
begin
  update public.whatsapp_conversation_lead_bindings as binding
  set active_to = greatest(
    v_closed_at,
    binding.active_from + interval '1 microsecond'
  )
  where binding.lead_id = old.id
    and binding.active_to is null;

  return old;
end;
$$;

revoke all on function private.close_whatsapp_bindings_before_lead_delete()
from public, anon, authenticated, service_role;

drop trigger if exists close_whatsapp_bindings_before_lead_delete
on public.leads;

create trigger close_whatsapp_bindings_before_lead_delete
before delete on public.leads
for each row
execute function private.close_whatsapp_bindings_before_lead_delete();

-- During the rolling deploy, a new replica may create an active binding while
-- an old/direct writer still updates whatsapp_conversations.lead_id. Absence of
-- a binding remains backwards-compatible, but once a binding exists the
-- conversation cannot commit a divergent lead/session/tenant. Deferral lets
-- the canonical RPC update the conversation and binding atomically in either
-- statement order while checking the final transaction state.
create or replace function private.enforce_whatsapp_conversation_active_binding_consistency()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.whatsapp_conversations as conversation
    join public.whatsapp_conversation_lead_bindings as binding
      on binding.conversation_id = conversation.id
     and binding.active_to is null
    where conversation.id = new.id
      and (
        conversation.organization_id is distinct from binding.organization_id
        or conversation.session_id is distinct from binding.session_id
        or conversation.lead_id is distinct from binding.lead_id
      )
  ) then
    raise exception using
      errcode = '23514',
      message = 'whatsapp_conversation_active_binding_mismatch';
  end if;

  return null;
end;
$$;

revoke all on function private.enforce_whatsapp_conversation_active_binding_consistency()
from public, anon, authenticated, service_role;

drop trigger if exists enforce_whatsapp_conversation_active_binding_consistency
on public.whatsapp_conversations;

create constraint trigger enforce_whatsapp_conversation_active_binding_consistency
after update of organization_id, session_id, lead_id
on public.whatsapp_conversations
deferrable initially deferred
for each row
execute function private.enforce_whatsapp_conversation_active_binding_consistency();

commit;

begin;
set local lock_timeout = '5s';
set local statement_timeout = '5min';

-- An ambiguous provider identity is durable evidence, but it must not be
-- attributed to whichever card currently owns the physical conversation.
-- Keep this predicate narrow and immutable so the strict B1 trigger and every
-- cutover readback agree on the only allowed NULL snapshot in a linked thread.
create or replace function private.is_terminal_whatsapp_lead_resolution_quarantine(
  p_metadata jsonb,
  p_from_me boolean,
  p_provider_message_id text,
  p_message_id text
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select
    p_from_me is false
    and coalesce(p_metadata, '{}'::jsonb) @>
      '{"lead_resolution_quarantine":{"terminal":true,"retryable":false}}'::jsonb
    and nullif(pg_catalog.btrim(coalesce(
      p_metadata #>> '{lead_resolution_quarantine,reason}',
      ''
    )), '') is not null
    and coalesce(p_metadata->>'source', '') = 'evolution_go_webhook'
    and coalesce(
      nullif(pg_catalog.btrim(p_provider_message_id), ''),
      nullif(pg_catalog.btrim(p_message_id), '')
    ) is not null
$$;

revoke all on function private.is_terminal_whatsapp_lead_resolution_quarantine(
  jsonb,
  boolean,
  text,
  text
) from public, anon, authenticated, service_role;

-- CREATE OR REPLACE preserves the pre-existing trigger-function owner. On a
-- self-hosted restore that owner can be the non-superuser `postgres`, while
-- this new helper is owned by the migration role. Grant only that database
-- owner the narrow predicate so the SECURITY DEFINER trigger works without
-- exposing it through Data API roles.
grant execute on function private.is_terminal_whatsapp_lead_resolution_quarantine(
  jsonb,
  boolean,
  text,
  text
) to postgres;

commit;

begin;
set local lock_timeout = '5s';
set local statement_timeout = '5min';

-- Freeze legacy attribution before queue-aware writers can switch a
-- conversation to another card. Read paths historically treated a NULL
-- message lead as the conversation's current lead; leaving NULL here would
-- make old messages appear under whichever lead becomes current later.
update public.whatsapp_messages as message
set lead_id = conversation.lead_id
from public.whatsapp_conversations as conversation
where conversation.id = message.conversation_id
  and conversation.organization_id = message.organization_id
  and conversation.lead_id is not null
  and message.lead_id is null
  and not private.is_terminal_whatsapp_lead_resolution_quarantine(
    message.metadata,
    message.from_me,
    message.provider_message_id,
    message.message_id
  );

commit;

begin;
set local lock_timeout = '5s';
set local statement_timeout = '5min';

update public.whatsapp_inbound_logs as inbound_log
set
  lead_id = conversation.lead_id,
  assigned_user_id = coalesce(
    inbound_log.assigned_user_id,
    conversation.assigned_user_id
  )
from public.whatsapp_conversations as conversation
where conversation.id = inbound_log.conversation_id
  and conversation.organization_id = inbound_log.organization_id
  and conversation.lead_id is not null
  and inbound_log.lead_id is null;

commit;

begin;
set local lock_timeout = '5s';
set local statement_timeout = '5min';

-- Prefer a canonical message snapshot when the outbox has already created its
-- message row. The canonical logical key is unique within organization/session.
update public.outbox_messages as outbox
set lead_id = message.lead_id
from public.whatsapp_messages as message
where outbox.lead_id is null
  and outbox.client_message_id is not null
  and message.organization_id = outbox.organization_id
  and message.session_id = outbox.session_id
  and message.conversation_id = outbox.conversation_id
  and message.client_message_id = outbox.client_message_id
  and message.lead_id is not null;

-- Rows that may still execute must be frozen before queue-aware writers can
-- rebind the conversation. Terminal history does not need a guessed snapshot.
update public.outbox_messages as outbox
set lead_id = conversation.lead_id
from public.whatsapp_conversations as conversation
where outbox.lead_id is null
  and outbox.status in ('pending', 'processing')
  and conversation.id = outbox.conversation_id
  and conversation.organization_id = outbox.organization_id
  and conversation.session_id = outbox.session_id
  and conversation.lead_id is not null;

-- Do not retain the backfill row locks while trigger DDL waits for its table
-- lock. If this phase is interrupted, the whole A1 file is safe to replay and
-- the final readback remains the only authorization to proceed to A2.
commit;

begin;
set local lock_timeout = '5s';
set local statement_timeout = '5min';

create or replace function public.enforce_whatsapp_outbox_session_match()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conversation public.whatsapp_conversations%rowtype;
  v_active_lead_id uuid;
  v_canonical_lead_id uuid;
begin
  select conversation.*
  into v_conversation
  from public.whatsapp_conversations as conversation
  where conversation.id = new.conversation_id
  for share;

  if not found then
    raise exception using
      errcode = '23503',
      message = 'whatsapp_outbox_conversation_not_found';
  end if;

  if new.session_id is distinct from v_conversation.session_id then
    raise exception using
      errcode = '23514',
      message = 'whatsapp_outbox_session_mismatch';
  end if;

  if new.organization_id is distinct from v_conversation.organization_id then
    raise exception using
      errcode = '23514',
      message = 'whatsapp_outbox_organization_mismatch';
  end if;

  if tg_op = 'UPDATE'
     and old.lead_id is not null
     and new.lead_id is distinct from old.lead_id then
    raise exception using
      errcode = '23514',
      message = 'whatsapp_outbox_lead_immutable';
  end if;

  if new.client_message_id is not null then
    select message.lead_id
    into v_canonical_lead_id
    from public.whatsapp_messages as message
    where message.organization_id = new.organization_id
      and message.session_id = new.session_id
      and message.conversation_id = new.conversation_id
      and message.client_message_id = new.client_message_id
      and message.lead_id is not null
    limit 1;
  end if;

  if new.lead_id is null then
    new.lead_id := coalesce(v_canonical_lead_id, v_conversation.lead_id);
  elsif v_canonical_lead_id is not null
        and new.lead_id is distinct from v_canonical_lead_id then
    raise exception using
      errcode = '23514',
      message = 'whatsapp_outbox_canonical_lead_mismatch';
  end if;

  select binding.lead_id
  into v_active_lead_id
  from public.whatsapp_conversation_lead_bindings as binding
  where binding.organization_id = new.organization_id
    and binding.conversation_id = new.conversation_id
    and binding.active_to is null;

  if found and v_active_lead_id is distinct from v_conversation.lead_id then
    raise exception using
      errcode = '23514',
      message = 'whatsapp_outbox_binding_state_mismatch';
  end if;

  if new.lead_id is null then
    if v_conversation.lead_id is not null or v_active_lead_id is not null then
      raise exception using
        errcode = '23514',
        message = 'whatsapp_outbox_lead_snapshot_required';
    end if;

    return new;
  end if;

  if new.lead_id is distinct from v_conversation.lead_id
     or (v_active_lead_id is not null
         and new.lead_id is distinct from v_active_lead_id) then
    raise exception using
      errcode = '23514',
      message = 'whatsapp_outbox_lead_binding_mismatch';
  end if;

  if not exists (
    select 1
    from public.leads as lead
    where lead.id = new.lead_id
      and lead.organization_id = new.organization_id
  ) then
    raise exception using
      errcode = '23503',
      message = 'whatsapp_outbox_lead_tenant_mismatch';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_whatsapp_outbox_session_match()
from public, anon, authenticated, service_role;
grant execute on function public.enforce_whatsapp_outbox_session_match()
to service_role;

drop trigger if exists trg_enforce_whatsapp_outbox_session_match
on public.outbox_messages;

create trigger trg_enforce_whatsapp_outbox_session_match
before insert or update of
  conversation_id,
  session_id,
  organization_id,
  lead_id,
  client_message_id
on public.outbox_messages
for each row
execute function public.enforce_whatsapp_outbox_session_match();

commit;

begin;
set local lock_timeout = '5s';
set local statement_timeout = '5min';

create sequence if not exists public.whatsapp_webhook_routing_ingress_sequence;

create table if not exists public.whatsapp_webhook_routing_snapshots (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  session_id uuid not null references public.whatsapp_sessions(id) on delete cascade,
  provider_message_id text not null,
  inbox_event_key text not null,
  processing_lane text not null,
  routing_key text not null,
  ingress_sequence bigint not null default nextval('public.whatsapp_webhook_routing_ingress_sequence'),
  predecessor_provider_message_id text,
  binding_eligible boolean not null,
  target_mode text not null,
  snapshot jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (organization_id, session_id, provider_message_id),
  unique (ingress_sequence),
  constraint whatsapp_webhook_routing_snapshot_provider_check
    check (btrim(provider_message_id) <> '' and octet_length(provider_message_id) <= 512),
  constraint whatsapp_webhook_routing_snapshot_event_key_check
    check (btrim(inbox_event_key) <> '' and octet_length(inbox_event_key) <= 1024),
  constraint whatsapp_webhook_routing_snapshot_lane_check
    check (processing_lane in ('live', 'backlog')),
  constraint whatsapp_webhook_routing_snapshot_key_check
    check (btrim(routing_key) <> '' and octet_length(routing_key) <= 256),
  constraint whatsapp_webhook_routing_snapshot_target_mode_check
    check (target_mode in ('snapshot', 'inherit_predecessor')),
  constraint whatsapp_webhook_routing_snapshot_predecessor_check
    check (
      predecessor_provider_message_id is null
      or predecessor_provider_message_id <> provider_message_id
    )
);

create index if not exists whatsapp_webhook_routing_snapshots_chain_idx
  on public.whatsapp_webhook_routing_snapshots (
    organization_id, session_id, routing_key, ingress_sequence desc
  )
  where binding_eligible = true;

create index if not exists whatsapp_webhook_routing_snapshots_inbox_idx
  on public.whatsapp_webhook_routing_snapshots (
    organization_id, session_id, inbox_event_key
  );

create index if not exists whatsapp_webhook_routing_snapshots_retention_idx
  on public.whatsapp_webhook_routing_snapshots (created_at, ingress_sequence);

alter sequence public.whatsapp_webhook_routing_ingress_sequence
  owned by public.whatsapp_webhook_routing_snapshots.ingress_sequence;

alter table public.whatsapp_webhook_routing_snapshots enable row level security;
revoke all on table public.whatsapp_webhook_routing_snapshots
from public, anon, authenticated;
grant select, insert on table public.whatsapp_webhook_routing_snapshots
to service_role;
revoke all on sequence public.whatsapp_webhook_routing_ingress_sequence
from public, anon, authenticated;
grant usage, select on sequence public.whatsapp_webhook_routing_ingress_sequence
to service_role;

-- Completion is deliberately independent from the inbox row that first
-- captured a provider message. A replay may finish through a different inbox
-- event after the original row is dead or already removed by retention. The
-- route outcome is the monotonic proof used by successors in either case.
create table if not exists public.whatsapp_webhook_routing_outcomes (
  organization_id uuid not null,
  session_id uuid not null,
  provider_message_id text not null,
  ingress_sequence bigint not null,
  completed_inbox_event_key text not null,
  completed_at timestamptz not null default clock_timestamp(),
  primary key (organization_id, session_id, provider_message_id),
  unique (ingress_sequence),
  foreign key (organization_id, session_id, provider_message_id)
    references public.whatsapp_webhook_routing_snapshots (
      organization_id, session_id, provider_message_id
    ) on delete cascade,
  constraint whatsapp_webhook_routing_outcome_event_key_check
    check (
      btrim(completed_inbox_event_key) <> ''
      and octet_length(completed_inbox_event_key) <= 1024
    )
);

create index if not exists whatsapp_webhook_routing_outcomes_completed_idx
  on public.whatsapp_webhook_routing_outcomes (completed_at, ingress_sequence);

alter table public.whatsapp_webhook_routing_outcomes enable row level security;
revoke all on table public.whatsapp_webhook_routing_outcomes
from public, anon, authenticated;
grant select, insert, update on table public.whatsapp_webhook_routing_outcomes
to service_role;

create table if not exists public.whatsapp_conversation_routing_heads (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  conversation_id uuid primary key references public.whatsapp_conversations(id) on delete cascade,
  session_id uuid not null references public.whatsapp_sessions(id) on delete cascade,
  routing_key text not null,
  provider_message_id text not null,
  ingress_sequence bigint not null,
  lead_id uuid not null,
  updated_at timestamptz not null default clock_timestamp(),
  unique (organization_id, session_id, routing_key, provider_message_id),
  constraint whatsapp_conversation_routing_head_key_check
    check (btrim(routing_key) <> '' and octet_length(routing_key) <= 256),
  constraint whatsapp_conversation_routing_head_provider_check
    check (btrim(provider_message_id) <> '' and octet_length(provider_message_id) <= 512)
);

alter table public.whatsapp_conversation_routing_heads enable row level security;
revoke all on table public.whatsapp_conversation_routing_heads
from public, anon, authenticated, service_role;
grant select on table public.whatsapp_conversation_routing_heads to service_role;

comment on table public.whatsapp_webhook_routing_snapshots is
'Immutable pre-ACK provider routing provenance. binding_eligible rows form an exact predecessor chain per tenant/session/routing key and identify their durable inbox event.';

comment on table public.whatsapp_webhook_routing_outcomes is
'Monotonic provider-route completion proof. It survives inbox retention and may identify a successful replay inbox different from the immutable capture inbox.';

comment on table public.whatsapp_conversation_routing_heads is
'Last accepted provider routing intent successfully applied to a physical conversation. Manual/non-ingress relinks clear the head.';

commit;

begin;
set local lock_timeout = '5s';
set local statement_timeout = '5min';

-- This helper is called only while the physical conversation row is already
-- locked. Provider events advance the applied head monotonically; a manual or
-- legacy activation has no trustworthy predecessor proof and invalidates it.
create or replace function private.update_whatsapp_conversation_routing_head(
  p_organization_id uuid,
  p_conversation_id uuid,
  p_provider_message_id text,
  p_lead_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_provider_message_id text := nullif(pg_catalog.btrim(p_provider_message_id), '');
  v_session_id uuid;
  v_route_session_id uuid;
  v_routing_key text;
  v_ingress_sequence bigint;
  v_binding_eligible boolean;
begin
  select conversation.session_id
  into v_session_id
  from public.whatsapp_conversations as conversation
  where conversation.id = p_conversation_id
    and conversation.organization_id = p_organization_id;

  if not found or v_session_id is null then
    raise exception using errcode = '23503', message = 'whatsapp_routing_head_conversation_not_found';
  end if;

  if v_provider_message_id is not null then
    select
      routing_snapshot.session_id,
      routing_snapshot.routing_key,
      routing_snapshot.ingress_sequence,
      routing_snapshot.binding_eligible
    into
      v_route_session_id,
      v_routing_key,
      v_ingress_sequence,
      v_binding_eligible
    from public.whatsapp_webhook_routing_snapshots as routing_snapshot
    where routing_snapshot.organization_id = p_organization_id
      and routing_snapshot.session_id = v_session_id
      and routing_snapshot.provider_message_id = v_provider_message_id;
  end if;

  if v_provider_message_id is null
     or not found
     or not coalesce(v_binding_eligible, false)
     or v_routing_key = '__session__'
     or v_route_session_id is distinct from v_session_id then
    delete from public.whatsapp_conversation_routing_heads as routing_head
    where routing_head.organization_id = p_organization_id
      and routing_head.conversation_id = p_conversation_id;
    return;
  end if;

  insert into public.whatsapp_conversation_routing_heads (
    organization_id,
    conversation_id,
    session_id,
    routing_key,
    provider_message_id,
    ingress_sequence,
    lead_id,
    updated_at
  ) values (
    p_organization_id,
    p_conversation_id,
    v_session_id,
    v_routing_key,
    v_provider_message_id,
    v_ingress_sequence,
    p_lead_id,
    clock_timestamp()
  )
  on conflict (conversation_id) do update
  set
    organization_id = excluded.organization_id,
    session_id = excluded.session_id,
    routing_key = excluded.routing_key,
    provider_message_id = excluded.provider_message_id,
    ingress_sequence = excluded.ingress_sequence,
    lead_id = excluded.lead_id,
    updated_at = excluded.updated_at
  where public.whatsapp_conversation_routing_heads.organization_id = excluded.organization_id
    and public.whatsapp_conversation_routing_heads.session_id = excluded.session_id
    and public.whatsapp_conversation_routing_heads.ingress_sequence < excluded.ingress_sequence;
end;
$$;

revoke all on function private.update_whatsapp_conversation_routing_head(
  uuid, uuid, text, uuid
) from public, anon, authenticated, service_role;

create or replace function private.whatsapp_ingress_routing_event_is_current(
  p_organization_id uuid,
  p_conversation_id uuid,
  p_provider_message_id text,
  p_lead_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when conversation.id is null then false
    when routing_snapshot.provider_message_id is null then true
    else exists (
      select 1
      from public.whatsapp_conversation_routing_heads as routing_head
      where routing_head.organization_id = p_organization_id
        and routing_head.conversation_id = p_conversation_id
        and routing_head.session_id = routing_snapshot.session_id
        and routing_head.routing_key = routing_snapshot.routing_key
        and routing_head.ingress_sequence >= routing_snapshot.ingress_sequence
        and routing_head.lead_id = p_lead_id
    )
  end
  from (values (1)) as singleton(value)
  left join public.whatsapp_conversations as conversation
    on conversation.organization_id = p_organization_id
   and conversation.id = p_conversation_id
  left join public.whatsapp_webhook_routing_snapshots as routing_snapshot
    on routing_snapshot.organization_id = p_organization_id
   and routing_snapshot.session_id = conversation.session_id
   and routing_snapshot.provider_message_id = nullif(pg_catalog.btrim(p_provider_message_id), '')
  limit 1
$$;

revoke all on function private.whatsapp_ingress_routing_event_is_current(
  uuid, uuid, text, uuid
) from public, anon, authenticated, service_role;

-- Resolve an organic successor from the result actually applied by its exact
-- predecessor. A lead observed before that predecessor ran is never returned.
-- The CAS RPC repeats the head proof under its stronger row locks.
create or replace function public.resolve_whatsapp_webhook_inherited_routing_target(
  p_organization_id uuid,
  p_session_id uuid,
  p_provider_message_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_provider_message_id text := nullif(pg_catalog.btrim(p_provider_message_id), '');
  v_route public.whatsapp_webhook_routing_snapshots%rowtype;
  v_predecessor public.whatsapp_webhook_routing_snapshots%rowtype;
  v_predecessor_processed boolean;
  v_result jsonb;
begin
  if p_organization_id is null or p_session_id is null or v_provider_message_id is null then
    raise exception using errcode = '22023', message = 'whatsapp_inherited_target_argument_missing';
  end if;

  select routing_snapshot.*
  into v_route
  from public.whatsapp_webhook_routing_snapshots as routing_snapshot
  where routing_snapshot.organization_id = p_organization_id
    and routing_snapshot.session_id = p_session_id
    and routing_snapshot.provider_message_id = v_provider_message_id;

  if not found
     or not v_route.binding_eligible
     or v_route.routing_key = '__session__'
     or v_route.target_mode <> 'inherit_predecessor'
     or v_route.predecessor_provider_message_id is null then
    raise exception using errcode = '23514', message = 'whatsapp_inherited_target_route_invalid';
  end if;

  select routing_snapshot.*
  into v_predecessor
  from public.whatsapp_webhook_routing_snapshots as routing_snapshot
  where routing_snapshot.organization_id = p_organization_id
    and routing_snapshot.session_id = p_session_id
    and routing_snapshot.provider_message_id = v_route.predecessor_provider_message_id;

  if not found
     or not v_predecessor.binding_eligible
     or v_predecessor.routing_key is distinct from v_route.routing_key
     or v_predecessor.ingress_sequence >= v_route.ingress_sequence then
    raise exception using errcode = '23514', message = 'whatsapp_ingress_predecessor_chain_invalid';
  end if;

  select v_predecessor.inbox_event_key = v_route.inbox_event_key
    or exists (
      select 1
      from public.whatsapp_webhook_inbox as predecessor_inbox
      where predecessor_inbox.organization_id = p_organization_id
        and predecessor_inbox.session_id = p_session_id
        and predecessor_inbox.event_key = v_predecessor.inbox_event_key
        and predecessor_inbox.status = 'processed'
    )
    or exists (
      select 1
      from public.whatsapp_webhook_routing_outcomes as predecessor_outcome
      where predecessor_outcome.organization_id = p_organization_id
        and predecessor_outcome.session_id = p_session_id
        and predecessor_outcome.provider_message_id = v_predecessor.provider_message_id
        and predecessor_outcome.ingress_sequence = v_predecessor.ingress_sequence
    )
    or exists (
      select 1
      from public.whatsapp_webhook_inbox as execution_inbox
      where execution_inbox.organization_id = p_organization_id
        and execution_inbox.session_id = p_session_id
        and execution_inbox.status = 'processing'
        and exists (
          select 1
          from pg_catalog.jsonb_array_elements(
            execution_inbox.payload #> '{__vimob_ingress,routing_snapshot,messages}'
          ) as current_route(snapshot)
          where current_route.snapshot = v_route.snapshot
        )
        and exists (
          select 1
          from pg_catalog.jsonb_array_elements(
            execution_inbox.payload #> '{__vimob_ingress,routing_snapshot,messages}'
          ) as predecessor_route(snapshot)
          where predecessor_route.snapshot = v_predecessor.snapshot
        )
    ) into v_predecessor_processed;

  if not v_predecessor_processed then
    raise exception using errcode = '40001', message = 'whatsapp_ingress_predecessor_pending';
  end if;

  -- This single MVCC statement returns only the predecessor result that is
  -- simultaneously the current conversation/binding/head. The activation CAS
  -- repeats the proof under conversation -> binding -> head row locks.
  select pg_catalog.jsonb_build_object(
    'ready', true,
    'terminal', false,
    'conversation_id', conversation.id,
    'lead_id', routing_head.lead_id,
    'active_binding_id', binding.id,
    'predecessor_provider_message_id', routing_head.provider_message_id,
    'predecessor_ingress_sequence', routing_head.ingress_sequence
  )
  into v_result
  from public.whatsapp_conversation_routing_heads as routing_head
  join public.whatsapp_conversations as conversation
    on conversation.id = routing_head.conversation_id
   and conversation.organization_id = routing_head.organization_id
   and conversation.session_id = routing_head.session_id
  join public.whatsapp_conversation_lead_bindings as binding
    on binding.organization_id = conversation.organization_id
   and binding.conversation_id = conversation.id
   and binding.active_to is null
  where routing_head.organization_id = p_organization_id
    and routing_head.session_id = p_session_id
    and routing_head.routing_key = v_route.routing_key
    and routing_head.provider_message_id = v_route.predecessor_provider_message_id
    and routing_head.ingress_sequence = v_predecessor.ingress_sequence
    and binding.session_id is not distinct from p_session_id
    and binding.lead_id is not distinct from conversation.lead_id
    and routing_head.lead_id is not distinct from conversation.lead_id
  limit 1;

  if not found then
    return pg_catalog.jsonb_build_object(
      'ready', false,
      'terminal', true,
      'reason', 'whatsapp_ingress_predecessor_head_invalidated'
    );
  end if;

  return v_result;
end;
$$;

revoke all on function public.resolve_whatsapp_webhook_inherited_routing_target(
  uuid, uuid, text
) from public, anon, authenticated;
grant execute on function public.resolve_whatsapp_webhook_inherited_routing_target(
  uuid, uuid, text
) to service_role;

commit;

-- Keep the three activation overloads atomic as one public contract. No
-- compatible application is deployed between these definitions and grants.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '5min';

create or replace function public.activate_whatsapp_conversation_lead_binding(
  p_organization_id uuid,
  p_conversation_id uuid,
  p_lead_id uuid,
  p_provider_message_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conversation public.whatsapp_conversations%rowtype;
  v_active public.whatsapp_conversation_lead_bindings%rowtype;
  v_replay public.whatsapp_conversation_lead_bindings%rowtype;
  v_lead public.leads%rowtype;
  v_binding_id uuid;
  v_provider_message_id text := nullif(btrim(p_provider_message_id), '');
  v_previous_lead_id uuid;
  v_active_lead_id uuid;
  v_is_current boolean;
  v_switch_at timestamptz := clock_timestamp();
  v_changed boolean;
begin
  if p_organization_id is null
     or p_conversation_id is null
     or p_lead_id is null then
    raise exception using
      errcode = '22023',
      message = 'whatsapp_binding_required_argument_missing';
  end if;

  select conversation.*
  into v_conversation
  from public.whatsapp_conversations as conversation
  where conversation.id = p_conversation_id
    and conversation.organization_id = p_organization_id
  for no key update;

  if not found then
    raise exception using
      errcode = '23503',
      message = 'whatsapp_binding_conversation_not_found';
  end if;

  select binding.*
  into v_active
  from public.whatsapp_conversation_lead_bindings as binding
  where binding.conversation_id = p_conversation_id
    and binding.active_to is null
  for update;

  if found and v_conversation.lead_id is distinct from v_active.lead_id then
    raise exception using
      errcode = '23514',
      message = 'whatsapp_binding_state_mismatch';
  end if;

  if v_provider_message_id is not null then
    select binding.*
    into v_replay
    from public.whatsapp_conversation_lead_bindings as binding
    where binding.organization_id = p_organization_id
      and binding.provider_message_id = v_provider_message_id
      and (
        (v_conversation.session_id is not null and binding.session_id = v_conversation.session_id)
        or (v_conversation.session_id is null and binding.conversation_id = p_conversation_id)
      )
    limit 1;

    if found then
      if v_replay.conversation_id <> p_conversation_id
         or v_replay.lead_id <> p_lead_id then
        raise exception using
          errcode = '23505',
          message = 'whatsapp_binding_provider_message_conflict';
      end if;

      v_active_lead_id := v_conversation.lead_id;
      v_is_current := not v_replay.stale
        and v_replay.lead_id is not distinct from v_active_lead_id
        and private.whatsapp_ingress_routing_event_is_current(
          p_organization_id,
          p_conversation_id,
          v_provider_message_id,
          v_replay.lead_id
        );

      return jsonb_build_object(
        'success', true,
        'changed', false,
        'conversation_id', v_replay.conversation_id,
        'lead_id', v_replay.lead_id,
        'previous_lead_id', v_replay.previous_lead_id,
        'binding_id', v_replay.id,
        'stale', v_replay.stale,
        'is_current', v_is_current,
        'active_lead_id', v_active_lead_id
      );
    end if;
  end if;

  -- Provider-event replay is resolved before dereferencing the lead. Binding
  -- history deliberately survives hard lead deletion, so a replay for a
  -- tombstoned lead can remain idempotent without reopening or reclassifying it.
  select lead.*
  into v_lead
  from public.leads as lead
  where lead.id = p_lead_id
    and lead.organization_id = p_organization_id;

  if not found then
    raise exception using
      errcode = '23503',
      message = 'whatsapp_binding_lead_not_found';
  end if;

  v_previous_lead_id := v_conversation.lead_id;
  v_changed := v_previous_lead_id is distinct from p_lead_id;

  if not v_changed then
    update public.whatsapp_conversations
    set assigned_user_id = v_lead.assigned_user_id,
        updated_at = clock_timestamp()
    where id = p_conversation_id;

    update public.whatsapp_contact_identity_aliases as identity_alias
    set
      lead_id = p_lead_id,
      last_seen_at = greatest(identity_alias.last_seen_at, v_switch_at)
    where identity_alias.organization_id = p_organization_id
      and identity_alias.session_id = v_conversation.session_id
      and (
        identity_alias.alias_jid = v_conversation.remote_jid
        or identity_alias.canonical_jid = v_conversation.remote_jid
        or (
          v_conversation.contact_phone is not null
          and public.normalize_phone(identity_alias.contact_phone) =
            public.normalize_phone(v_conversation.contact_phone)
        )
      );

    if v_active.id is null then
      insert into public.whatsapp_conversation_lead_bindings (
        organization_id,
        conversation_id,
        session_id,
        lead_id,
        previous_lead_id,
        assigned_user_id,
        provider_message_id,
        changed,
        active_from
      ) values (
        p_organization_id,
        p_conversation_id,
        v_conversation.session_id,
        p_lead_id,
        v_previous_lead_id,
        v_lead.assigned_user_id,
        v_provider_message_id,
        false,
        v_switch_at
      )
      returning id into v_binding_id;
    elsif v_provider_message_id is not null then
      insert into public.whatsapp_conversation_lead_bindings (
        organization_id,
        conversation_id,
        session_id,
        lead_id,
        previous_lead_id,
        assigned_user_id,
        provider_message_id,
        changed,
        active_from,
        active_to
      ) values (
        p_organization_id,
        p_conversation_id,
        v_conversation.session_id,
        p_lead_id,
        v_previous_lead_id,
        v_lead.assigned_user_id,
        v_provider_message_id,
        false,
        v_switch_at,
        v_switch_at
      )
      returning id into v_binding_id;
    else
      -- An explicit same-card relink is still an operator-visible binding
      -- epoch. Rotate the active row so a provider event accepted before this
      -- intervention cannot pass an unchanged binding-id CAS afterward.
      v_switch_at := greatest(
        v_switch_at,
        v_active.active_from + interval '1 microsecond'
      );
      update public.whatsapp_conversation_lead_bindings
      set active_to = v_switch_at
      where id = v_active.id;

      insert into public.whatsapp_conversation_lead_bindings (
        organization_id,
        conversation_id,
        session_id,
        lead_id,
        previous_lead_id,
        assigned_user_id,
        provider_message_id,
        changed,
        active_from
      ) values (
        p_organization_id,
        p_conversation_id,
        v_conversation.session_id,
        p_lead_id,
        v_previous_lead_id,
        v_lead.assigned_user_id,
        null,
        false,
        v_switch_at
      )
      returning id into v_binding_id;
    end if;

    perform private.update_whatsapp_conversation_routing_head(
      p_organization_id,
      p_conversation_id,
      v_provider_message_id,
      p_lead_id
    );

    return jsonb_build_object(
      'success', true,
      'changed', false,
      'conversation_id', p_conversation_id,
      'lead_id', p_lead_id,
      'previous_lead_id', v_previous_lead_id,
      'binding_id', v_binding_id,
      'stale', false,
      'is_current', true,
      'active_lead_id', p_lead_id
    );
  end if;

  -- A row already past the provider boundary cannot be cancelled safely. Abort
  -- the whole switch before closing the active binding; the caller may retry
  -- only after the worker has reconciled the in-flight outcome. Lock every
  -- cancelable/in-flight row first so a worker cannot cross the boundary
  -- between this check and the cancellation updates below.
  perform outbox.id
  from public.whatsapp_outbox as outbox
  where outbox.organization_id = p_organization_id
    and outbox.conversation_id = p_conversation_id
    and outbox.status in ('pending', 'retry', 'processing', 'failed')
  for update;

  perform legacy_outbox.id
  from public.outbox_messages as legacy_outbox
  where legacy_outbox.organization_id = p_organization_id
    and legacy_outbox.conversation_id = p_conversation_id
    and legacy_outbox.status in ('pending', 'processing')
  for update;

  perform job.id
  from public.ai_jobs as job
  where job.organization_id = p_organization_id
    and job.conversation_id = p_conversation_id
    and job.status in ('pending', 'processing')
  for update;

  -- The Go auto-reply worker uses public.jobs rather than public.ai_jobs.
  -- Lock it under the same conversation row so an enqueue that races this
  -- switch either commits before us (and is cancelled below) or observes the
  -- new binding and refuses to enqueue.
  perform job.id
  from public.jobs as job
  where job.organization_id = p_organization_id
    and job.job_type = 'whatsapp_ai_autoreply'
    and job.payload->>'conversationId' = p_conversation_id::text
    and job.status in ('queued', 'processing')
  for update;

  perform ai_outbox.id
  from public.ai_outbox_messages as ai_outbox
  where ai_outbox.organization_id = p_organization_id
    and ai_outbox.conversation_id = p_conversation_id
    and ai_outbox.status in ('draft', 'pending_approval', 'approved', 'sending')
  for update;

  -- A message_received event may still be waiting to create its execution.
  -- Lock the event itself before inspecting automation_executions so a worker
  -- cannot claim the previous lead context after the binding has moved.
  perform event_outbox.id
  from public.automation_event_outbox as event_outbox
  where event_outbox.organization_id = p_organization_id
    and event_outbox.conversation_id = p_conversation_id
    and event_outbox.status in ('pending', 'failed', 'processing')
  for update;

  perform execution.id
  from public.automation_executions as execution
  where execution.organization_id = p_organization_id
    and execution.conversation_id = p_conversation_id
    and execution.status in ('queued', 'waiting', 'running')
  for update;

  perform step.id
  from public.automation_execution_steps as step
  join public.automation_executions as execution
    on execution.id = step.execution_id
   and execution.organization_id = step.organization_id
  where execution.organization_id = p_organization_id
    and execution.conversation_id = p_conversation_id
    and step.status in ('running', 'waiting')
  for update of step;

  perform dispatch.id
  from public.automation_effect_dispatches as dispatch
  join public.automation_executions as execution
    on execution.id = dispatch.execution_id
   and execution.organization_id = dispatch.organization_id
  where execution.organization_id = p_organization_id
    and execution.conversation_id = p_conversation_id
    and dispatch.status = 'sending'
  for update of dispatch;

  if exists (
    select 1
    from public.whatsapp_outbox as outbox
    where outbox.organization_id = p_organization_id
      and outbox.conversation_id = p_conversation_id
      and outbox.status = 'processing'
  ) or exists (
    select 1
    from public.outbox_messages as legacy_outbox
    where legacy_outbox.organization_id = p_organization_id
      and legacy_outbox.conversation_id = p_conversation_id
      and legacy_outbox.status = 'processing'
  ) or exists (
    select 1
    from public.ai_jobs as job
    where job.organization_id = p_organization_id
      and job.conversation_id = p_conversation_id
      and job.status = 'processing'
  ) or exists (
    select 1
    from public.jobs as job
    where job.organization_id = p_organization_id
      and job.job_type = 'whatsapp_ai_autoreply'
      and job.payload->>'conversationId' = p_conversation_id::text
      and job.status = 'processing'
  ) or exists (
    select 1
    from public.ai_outbox_messages as ai_outbox
    where ai_outbox.organization_id = p_organization_id
      and ai_outbox.conversation_id = p_conversation_id
      and ai_outbox.status = 'sending'
  ) or exists (
    select 1
    from public.automation_event_outbox as event_outbox
    where event_outbox.organization_id = p_organization_id
      and event_outbox.conversation_id = p_conversation_id
      and event_outbox.status = 'processing'
  ) or exists (
    select 1
    from public.automation_executions as execution
    where execution.organization_id = p_organization_id
      and execution.conversation_id = p_conversation_id
      and execution.status = 'running'
  ) or exists (
    select 1
    from public.automation_effect_dispatches as dispatch
    join public.automation_executions as execution
      on execution.id = dispatch.execution_id
     and execution.organization_id = dispatch.organization_id
    where execution.organization_id = p_organization_id
      and execution.conversation_id = p_conversation_id
      and dispatch.status = 'sending'
  ) then
    raise exception using
      errcode = '55000',
      message = 'whatsapp_binding_switch_delivery_in_flight';
  end if;

  if v_active.id is not null then
    v_switch_at := greatest(
      v_switch_at,
      v_active.active_from + interval '1 microsecond'
    );

    update public.whatsapp_conversation_lead_bindings
    set active_to = v_switch_at
    where id = v_active.id;
  end if;

  -- The physical WhatsApp thread is being handed to a different CRM card.
  -- Fail closed on every queued action that was computed with the previous
  -- lead context, and erase mutable summaries/memory before exposing the new
  -- binding. All changes occur under the locked conversation row.
  update public.whatsapp_outbox as outbox
  set
    status = 'dead',
    dead_lettered_at = coalesce(outbox.dead_lettered_at, v_switch_at),
    locked_at = null,
    locked_by = null,
    last_error = 'conversation_lead_binding_changed',
    updated_at = v_switch_at
  where outbox.organization_id = p_organization_id
    and outbox.conversation_id = p_conversation_id
    and outbox.status in ('pending', 'retry', 'failed');

  update public.outbox_messages as legacy_outbox
  set
    status = 'failed',
    processed_at = coalesce(legacy_outbox.processed_at, v_switch_at),
    error_message = 'conversation_lead_binding_changed'
  where legacy_outbox.organization_id = p_organization_id
    and legacy_outbox.conversation_id = p_conversation_id
    and legacy_outbox.status = 'pending';

  update public.ai_jobs as job
  set
    status = 'cancelled',
    error_message = 'conversation_lead_binding_changed',
    completed_at = coalesce(job.completed_at, v_switch_at)
  where job.organization_id = p_organization_id
    and job.conversation_id = p_conversation_id
    and job.status = 'pending';

  update public.jobs as job
  set
    status = 'cancelled',
    locked_at = null,
    last_error = 'conversation_lead_binding_changed',
    updated_at = v_switch_at
  where job.organization_id = p_organization_id
    and job.job_type = 'whatsapp_ai_autoreply'
    and job.payload->>'conversationId' = p_conversation_id::text
    and job.status = 'queued';

  update public.ai_outbox_messages as ai_outbox
  set
    status = 'cancelled',
    failure_reason = 'conversation_lead_binding_changed',
    updated_at = v_switch_at
  where ai_outbox.organization_id = p_organization_id
    and ai_outbox.conversation_id = p_conversation_id
    and ai_outbox.status in ('draft', 'pending_approval', 'approved');

  update public.automation_event_outbox as event_outbox
  set
    status = 'dead_letter',
    dead_lettered_at = coalesce(event_outbox.dead_lettered_at, v_switch_at),
    locked_at = null,
    locked_by = null,
    last_error = 'conversation_lead_binding_changed',
    updated_at = v_switch_at
  where event_outbox.organization_id = p_organization_id
    and event_outbox.conversation_id = p_conversation_id
    and event_outbox.status in ('pending', 'failed');

  update public.automation_executions as execution
  set
    status = 'cancelled',
    cancellation_requested_at = coalesce(
      execution.cancellation_requested_at,
      v_switch_at
    ),
    completed_at = coalesce(execution.completed_at, v_switch_at),
    error_message = 'conversation_lead_binding_changed',
    locked_at = null,
    locked_by = null,
    updated_at = v_switch_at
  where execution.organization_id = p_organization_id
    and execution.conversation_id = p_conversation_id
    and execution.status in ('queued', 'waiting');

  update public.automation_execution_steps as step
  set
    status = 'cancelled',
    completed_at = coalesce(step.completed_at, v_switch_at),
    error_message = 'conversation_lead_binding_changed'
  from public.automation_executions as execution
  where execution.id = step.execution_id
    and execution.organization_id = step.organization_id
    and execution.organization_id = p_organization_id
    and execution.conversation_id = p_conversation_id
    and execution.status = 'cancelled'
    and execution.error_message = 'conversation_lead_binding_changed'
    and step.status in ('running', 'waiting');

  delete from public.conversation_ai_state as ai_state
  where ai_state.organization_id = p_organization_id
    and ai_state.conversation_id = p_conversation_id;

  delete from public.ai_agent_conversations as agent_conversation
  where agent_conversation.conversation_id = p_conversation_id;

  delete from public.ai_conversation_states as control_state
  where control_state.organization_id = p_organization_id
    and control_state.conversation_id = p_conversation_id;

  delete from public.chatbot_conversation_state as chatbot_state
  where chatbot_state.organization_id = p_organization_id
    and chatbot_state.conversation_id = p_conversation_id::text;

  update public.whatsapp_conversations
  set
    lead_id = p_lead_id,
    assigned_user_id = v_lead.assigned_user_id,
    last_message = null,
    last_message_preview = null,
    last_message_at = null,
    last_message_received_at = null,
    unread_count = 0,
    archived_at = null,
    updated_at = v_switch_at
  where id = p_conversation_id;

  update public.whatsapp_contact_identity_aliases as identity_alias
  set
    lead_id = p_lead_id,
    last_seen_at = greatest(identity_alias.last_seen_at, v_switch_at)
  where identity_alias.organization_id = p_organization_id
    and identity_alias.session_id = v_conversation.session_id
    and (
      identity_alias.alias_jid = v_conversation.remote_jid
      or identity_alias.canonical_jid = v_conversation.remote_jid
      or (
        v_conversation.contact_phone is not null
        and public.normalize_phone(identity_alias.contact_phone) =
          public.normalize_phone(v_conversation.contact_phone)
      )
    );

  insert into public.whatsapp_conversation_lead_bindings (
    organization_id,
    conversation_id,
    session_id,
    lead_id,
    previous_lead_id,
    assigned_user_id,
    provider_message_id,
    changed,
    active_from
  ) values (
    p_organization_id,
    p_conversation_id,
    v_conversation.session_id,
    p_lead_id,
    v_previous_lead_id,
    v_lead.assigned_user_id,
    v_provider_message_id,
    true,
    v_switch_at
  )
  returning id into v_binding_id;

  perform private.update_whatsapp_conversation_routing_head(
    p_organization_id,
    p_conversation_id,
    v_provider_message_id,
    p_lead_id
  );

  return jsonb_build_object(
    'success', true,
    'changed', true,
    'conversation_id', p_conversation_id,
    'lead_id', p_lead_id,
    'previous_lead_id', v_previous_lead_id,
    'binding_id', v_binding_id,
    'stale', false,
    'is_current', true,
    'active_lead_id', p_lead_id
  );
end;
$$;

revoke all on function public.activate_whatsapp_conversation_lead_binding(
  uuid, uuid, uuid, text
) from public, anon, authenticated;
grant execute on function public.activate_whatsapp_conversation_lead_binding(
  uuid, uuid, uuid, text
) to service_role;

comment on function public.activate_whatsapp_conversation_lead_binding(
  uuid, uuid, uuid, text
) is
'Service-role-only, row-locked activation of one lead binding per WhatsApp conversation. Provider-message replay is idempotent and never reopens an older binding.';

-- Browser/operator relinks carry the lead snapshot that was actually rendered
-- to the user. Compare it while holding the same conversation lock used by the
-- four-argument activation RPC; a stale tab must never overwrite a newer bind.
-- The provider-event path intentionally remains on its separate binding-id and
-- routing-head CAS below, preserving replay history and causal ordering.
create or replace function public.activate_whatsapp_conversation_lead_binding(
  p_organization_id uuid,
  p_conversation_id uuid,
  p_lead_id uuid,
  p_provider_message_id text,
  p_expected_previous_lead_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conversation public.whatsapp_conversations%rowtype;
  v_expected_previous_lead_id uuid;
  v_expected_snapshot text := pg_catalog.lower(
    pg_catalog.btrim(p_expected_previous_lead_id)
  );
begin
  if p_organization_id is null
     or p_conversation_id is null
     or p_lead_id is null
     or v_expected_snapshot is null
     or v_expected_snapshot = '' then
    raise exception using
      errcode = '22023',
      message = 'whatsapp_binding_expected_previous_lead_required';
  end if;

  if nullif(pg_catalog.btrim(p_provider_message_id), '') is not null then
    raise exception using
      errcode = '22023',
      message = 'whatsapp_binding_manual_cas_provider_message_forbidden';
  end if;

  if v_expected_snapshot = 'unlinked' then
    v_expected_previous_lead_id := null;
  else
    begin
      v_expected_previous_lead_id := v_expected_snapshot::uuid;
    exception
      when invalid_text_representation then
        raise exception using
          errcode = '22023',
          message = 'whatsapp_binding_expected_previous_lead_invalid';
    end;
  end if;

  select conversation.*
  into v_conversation
  from public.whatsapp_conversations as conversation
  where conversation.id = p_conversation_id
    and conversation.organization_id = p_organization_id
  for no key update;

  if not found then
    raise exception using
      errcode = '23503',
      message = 'whatsapp_binding_conversation_not_found';
  end if;

  if v_conversation.lead_id is distinct from v_expected_previous_lead_id then
    return pg_catalog.jsonb_build_object(
      'success', false,
      'changed', false,
      'conversation_id', p_conversation_id,
      'lead_id', p_lead_id,
      'previous_lead_id', v_conversation.lead_id,
      'binding_id', null,
      'stale', true,
      'is_current', false,
      'active_lead_id', v_conversation.lead_id
    );
  end if;

  return public.activate_whatsapp_conversation_lead_binding(
    p_organization_id,
    p_conversation_id,
    p_lead_id,
    null
  );
end;
$$;

revoke all on function public.activate_whatsapp_conversation_lead_binding(
  uuid, uuid, uuid, text, text
) from public, anon, authenticated;
grant execute on function public.activate_whatsapp_conversation_lead_binding(
  uuid, uuid, uuid, text, text
) to service_role;

comment on function public.activate_whatsapp_conversation_lead_binding(
  uuid, uuid, uuid, text, text
) is
'Service-role-only manual binding CAS. The expected previous lead is a UUID or the unlinked sentinel; stale browser snapshots return success=false without changing binding history.';

-- Intake writers resolve identity outside PostgreSQL. Preserve that decision's
-- starting version so a slower provider event cannot undo a newer explicit or
-- concurrent binding. A lost compare-and-swap is still recorded as a closed
-- provider-event binding: retries remain historical and can never reopen it.
create or replace function public.activate_whatsapp_conversation_lead_binding_if_current(
  p_organization_id uuid,
  p_conversation_id uuid,
  p_lead_id uuid,
  p_provider_message_id text,
  p_expected_active_binding_id uuid,
  p_expected_current_lead_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conversation public.whatsapp_conversations%rowtype;
  v_active public.whatsapp_conversation_lead_bindings%rowtype;
  v_expected public.whatsapp_conversation_lead_bindings%rowtype;
  v_replay public.whatsapp_conversation_lead_bindings%rowtype;
  v_predecessor_binding public.whatsapp_conversation_lead_bindings%rowtype;
  v_route public.whatsapp_webhook_routing_snapshots%rowtype;
  v_predecessor_route public.whatsapp_webhook_routing_snapshots%rowtype;
  v_routing_head public.whatsapp_conversation_routing_heads%rowtype;
  v_lead public.leads%rowtype;
  v_provider_message_id text := nullif(pg_catalog.btrim(p_provider_message_id), '');
  v_binding_id uuid;
  v_recorded_at timestamptz := clock_timestamp();
  v_is_current boolean;
  v_expected_matches boolean;
  v_route_allows_activation boolean := false;
  v_predecessor_processed boolean := false;
begin
  if p_organization_id is null
     or p_conversation_id is null
     or p_lead_id is null then
    raise exception using
      errcode = '22023',
      message = 'whatsapp_binding_required_argument_missing';
  end if;

  if v_provider_message_id is null then
    raise exception using
      errcode = '22023',
      message = 'whatsapp_binding_provider_message_required';
  end if;

  select conversation.*
  into v_conversation
  from public.whatsapp_conversations as conversation
  where conversation.id = p_conversation_id
    and conversation.organization_id = p_organization_id
  for no key update;

  if not found then
    raise exception using
      errcode = '23503',
      message = 'whatsapp_binding_conversation_not_found';
  end if;

  select binding.*
  into v_active
  from public.whatsapp_conversation_lead_bindings as binding
  where binding.conversation_id = p_conversation_id
    and binding.active_to is null
  for update;

  if v_active.id is not null
     and v_conversation.lead_id is distinct from v_active.lead_id then
    raise exception using
      errcode = '23514',
      message = 'whatsapp_binding_state_mismatch';
  end if;

  select routing_snapshot.*
  into v_route
  from public.whatsapp_webhook_routing_snapshots as routing_snapshot
  where routing_snapshot.organization_id = p_organization_id
    and routing_snapshot.session_id = v_conversation.session_id
    and routing_snapshot.provider_message_id = v_provider_message_id;

  if v_route.provider_message_id is not null
     and v_route.binding_eligible
     and v_route.routing_key <> '__session__' then
    -- Lock order is conversation -> active binding -> applied route head. Every
    -- writer follows this order, so automation FK KEY SHARE and provider CAS
    -- cannot form the previous event/conversation inversion.
    select routing_head.*
    into v_routing_head
    from public.whatsapp_conversation_routing_heads as routing_head
    where routing_head.organization_id = p_organization_id
      and routing_head.conversation_id = p_conversation_id
    for update;

    if v_route.predecessor_provider_message_id is not null then
      select routing_snapshot.*
      into v_predecessor_route
      from public.whatsapp_webhook_routing_snapshots as routing_snapshot
      where routing_snapshot.organization_id = p_organization_id
        and routing_snapshot.session_id = v_conversation.session_id
        and routing_snapshot.provider_message_id = v_route.predecessor_provider_message_id;

      if v_predecessor_route.provider_message_id is null
         or not v_predecessor_route.binding_eligible
         or v_predecessor_route.routing_key is distinct from v_route.routing_key
         or v_predecessor_route.ingress_sequence >= v_route.ingress_sequence then
        raise exception using
          errcode = '23514',
          message = 'whatsapp_ingress_predecessor_chain_invalid';
      end if;

      select v_predecessor_route.inbox_event_key = v_route.inbox_event_key
        or exists (
          select 1
          from public.whatsapp_webhook_inbox as predecessor_inbox
          where predecessor_inbox.organization_id = p_organization_id
            and predecessor_inbox.session_id = v_conversation.session_id
            and predecessor_inbox.event_key = v_predecessor_route.inbox_event_key
            and predecessor_inbox.status = 'processed'
        )
        or exists (
          select 1
          from public.whatsapp_webhook_routing_outcomes as predecessor_outcome
          where predecessor_outcome.organization_id = p_organization_id
            and predecessor_outcome.session_id = v_conversation.session_id
            and predecessor_outcome.provider_message_id = v_predecessor_route.provider_message_id
            and predecessor_outcome.ingress_sequence = v_predecessor_route.ingress_sequence
        )
        or exists (
          select 1
          from public.whatsapp_webhook_inbox as execution_inbox
          where execution_inbox.organization_id = p_organization_id
            and execution_inbox.session_id = v_conversation.session_id
            and execution_inbox.status = 'processing'
            and exists (
              select 1
              from pg_catalog.jsonb_array_elements(
                execution_inbox.payload #> '{__vimob_ingress,routing_snapshot,messages}'
              ) as current_route(snapshot)
              where current_route.snapshot = v_route.snapshot
            )
            and exists (
              select 1
              from pg_catalog.jsonb_array_elements(
                execution_inbox.payload #> '{__vimob_ingress,routing_snapshot,messages}'
              ) as predecessor_route(snapshot)
              where predecessor_route.snapshot = v_predecessor_route.snapshot
            )
        )
      into v_predecessor_processed;

      if not v_predecessor_processed then
        raise exception using
          errcode = '40001',
          message = 'whatsapp_ingress_predecessor_pending';
      end if;
    end if;
  end if;

  -- A provider replay is immutable and safe regardless of the caller's old
  -- expected version. Resolve it before evaluating the CAS pair.
  select binding.*
  into v_replay
  from public.whatsapp_conversation_lead_bindings as binding
  where binding.organization_id = p_organization_id
    and binding.provider_message_id = v_provider_message_id
    and (
      (v_conversation.session_id is not null
        and binding.session_id = v_conversation.session_id)
      or (v_conversation.session_id is null
        and binding.conversation_id = p_conversation_id)
    )
  limit 1;

  if v_replay.id is not null then
    if v_replay.conversation_id <> p_conversation_id
       or v_replay.lead_id <> p_lead_id then
      raise exception using
        errcode = '23505',
        message = 'whatsapp_binding_provider_message_conflict';
    end if;

    v_is_current := not v_replay.stale
      and v_replay.lead_id is not distinct from v_conversation.lead_id
      and private.whatsapp_ingress_routing_event_is_current(
        p_organization_id,
        p_conversation_id,
        v_provider_message_id,
        v_replay.lead_id
      );

    return jsonb_build_object(
      'success', true,
      'changed', false,
      'conversation_id', v_replay.conversation_id,
      'lead_id', v_replay.lead_id,
      'previous_lead_id', v_replay.previous_lead_id,
      'binding_id', v_replay.id,
      'stale', v_replay.stale,
      'is_current', v_is_current,
      'active_lead_id', v_conversation.lead_id
    );
  end if;

  if p_expected_active_binding_id is not null then
    select binding.*
    into v_expected
    from public.whatsapp_conversation_lead_bindings as binding
    where binding.id = p_expected_active_binding_id
      and binding.organization_id = p_organization_id
      and binding.conversation_id = p_conversation_id;

    if v_expected.id is null
       or v_expected.lead_id is distinct from p_expected_current_lead_id then
      raise exception using
        errcode = '23514',
        message = 'whatsapp_binding_expected_snapshot_invalid';
    end if;
  end if;

  v_expected_matches :=
    v_conversation.lead_id is not distinct from p_expected_current_lead_id
    and v_active.id is not distinct from p_expected_active_binding_id;

  if v_route.provider_message_id is null
     or not v_route.binding_eligible
     or v_route.routing_key = '__session__' then
    v_route_allows_activation := v_expected_matches;
  elsif v_route.target_mode = 'inherit_predecessor' then
    if v_route.predecessor_provider_message_id is null then
      raise exception using
        errcode = '23514',
        message = 'whatsapp_ingress_inherited_target_without_predecessor';
    end if;

    select binding.*
    into v_predecessor_binding
    from public.whatsapp_conversation_lead_bindings as binding
    where binding.organization_id = p_organization_id
      and binding.session_id = v_conversation.session_id
      and binding.provider_message_id = v_route.predecessor_provider_message_id
    limit 1;

    if v_predecessor_binding.id is null then
      raise exception using
        errcode = '23514',
        message = 'whatsapp_ingress_predecessor_not_applied';
    end if;
    if v_predecessor_binding.lead_id is distinct from p_lead_id then
      raise exception using
        errcode = '23505',
        message = 'whatsapp_ingress_inherited_target_conflict';
    end if;

    v_route_allows_activation :=
      v_routing_head.provider_message_id is not null
      and v_routing_head.session_id is not distinct from v_conversation.session_id
      and v_routing_head.routing_key is not distinct from v_route.routing_key
      and v_routing_head.provider_message_id = v_route.predecessor_provider_message_id
      and v_routing_head.ingress_sequence = v_predecessor_route.ingress_sequence
      and v_routing_head.lead_id = p_lead_id;
  else
    v_route_allows_activation := v_expected_matches;

    if not v_route_allows_activation
       and v_route.predecessor_provider_message_id is not null then
      v_route_allows_activation :=
        v_routing_head.provider_message_id is not null
        and v_routing_head.session_id is not distinct from v_conversation.session_id
        and v_routing_head.routing_key is not distinct from v_route.routing_key
        and v_routing_head.provider_message_id = v_route.predecessor_provider_message_id
        and v_routing_head.ingress_sequence = v_predecessor_route.ingress_sequence;
    end if;

    -- An older same-target event may finish after a newer accepted event. It is
    -- safe to retain its effects on that same card, but the monotonic head must
    -- never move backward. A missing head means an operator/legacy relink broke
    -- the chain and therefore cannot take this exception.
    if not v_route_allows_activation then
      v_route_allows_activation :=
        v_routing_head.provider_message_id is not null
        and v_routing_head.session_id is not distinct from v_conversation.session_id
        and v_routing_head.routing_key is not distinct from v_route.routing_key
        and v_routing_head.ingress_sequence >= v_route.ingress_sequence
        and v_routing_head.lead_id = p_lead_id
        and v_conversation.lead_id = p_lead_id;
    end if;
  end if;

  if v_route_allows_activation then
    return public.activate_whatsapp_conversation_lead_binding(
      p_organization_id,
      p_conversation_id,
      p_lead_id,
      v_provider_message_id
    );
  end if;

  select lead.*
  into v_lead
  from public.leads as lead
  where lead.id = p_lead_id
    and lead.organization_id = p_organization_id;

  if not found then
    raise exception using
      errcode = '23503',
      message = 'whatsapp_binding_lead_not_found';
  end if;

  insert into public.whatsapp_conversation_lead_bindings (
    organization_id,
    conversation_id,
    session_id,
    lead_id,
    previous_lead_id,
    assigned_user_id,
    provider_message_id,
    changed,
    stale,
    active_from,
    active_to
  ) values (
    p_organization_id,
    p_conversation_id,
    v_conversation.session_id,
    p_lead_id,
    v_conversation.lead_id,
    v_lead.assigned_user_id,
    v_provider_message_id,
    false,
    true,
    v_recorded_at,
    v_recorded_at
  )
  returning id into v_binding_id;

  return jsonb_build_object(
    'success', true,
    'changed', false,
    'conversation_id', p_conversation_id,
    'lead_id', p_lead_id,
    'previous_lead_id', v_conversation.lead_id,
    'binding_id', v_binding_id,
    'stale', true,
    'is_current', false,
    'active_lead_id', v_conversation.lead_id
  );
end;
$$;

revoke all on function public.activate_whatsapp_conversation_lead_binding_if_current(
  uuid, uuid, uuid, text, uuid, uuid
) from public, anon, authenticated;
grant execute on function public.activate_whatsapp_conversation_lead_binding_if_current(
  uuid, uuid, uuid, text, uuid, uuid
) to service_role;

comment on function public.activate_whatsapp_conversation_lead_binding_if_current(
  uuid, uuid, uuid, text, uuid, uuid
) is
'Service-role intake CAS. A provider event that loses to a newer conversation binding is recorded as stale closed history and never changes the active card or aliases.';

commit;

begin;
set local lock_timeout = '5s';
set local statement_timeout = '5min';

-- Freeze provider-message routing while the durable ingress transaction is
-- still open. The worker must consume this snapshot instead of re-reading a
-- mutable conversation after another live event or operator relink changed its
-- active card. The conversation lock order matches the binding RPC
-- (conversation, then active binding), so an accepted event is serialized with
-- a concurrent relink without holding a lock across provider I/O.
create or replace function private.capture_whatsapp_webhook_routing_snapshot(
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
  p_provider_event_lead_id uuid
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
begin
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

revoke all on function private.capture_whatsapp_webhook_routing_snapshot(
  uuid, uuid, text, text, text, text, boolean, text[], text, text, text,
  boolean, boolean, boolean, uuid, uuid, uuid
) from public, anon, authenticated;
grant execute on function private.capture_whatsapp_webhook_routing_snapshot(
  uuid, uuid, text, text, text, text, boolean, text[], text, text, text,
  boolean, boolean, boolean, uuid, uuid, uuid
) to service_role;

comment on function private.capture_whatsapp_webhook_routing_snapshot(
  uuid, uuid, text, text, text, text, boolean, text[], text, text, text,
  boolean, boolean, boolean, uuid, uuid, uuid
) is
'Captures immutable tenant/session/provider routing provenance under conversation/binding locks before the durable webhook ACK.';

commit;

begin;
set local lock_timeout = '5s';
set local statement_timeout = '5min';

create or replace function private.preserve_whatsapp_webhook_routing_snapshot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.payload #> '{__vimob_ingress,routing_snapshot}'
     is distinct from old.payload #> '{__vimob_ingress,routing_snapshot}' then
    raise exception using
      errcode = '23514',
      message = 'whatsapp_webhook_routing_snapshot_immutable';
  end if;
  return new;
end;
$$;

revoke all on function private.preserve_whatsapp_webhook_routing_snapshot()
from public, anon, authenticated, service_role;

drop trigger if exists preserve_whatsapp_webhook_routing_snapshot_before_update
on public.whatsapp_webhook_inbox;
create trigger preserve_whatsapp_webhook_routing_snapshot_before_update
before update of payload on public.whatsapp_webhook_inbox
for each row
execute function private.preserve_whatsapp_webhook_routing_snapshot();

commit;

begin;
set local lock_timeout = '5s';
set local statement_timeout = '5min';

-- Retire only provenance that can no longer participate in delivery,
-- rebinding, provider replay, or an unresolved predecessor chain. Capture and
-- cleanup share the same route advisory lock, so an inbox can never commit a
-- snapshot that cleanup removed underneath it. This intentionally prefers
-- retaining evidence over reclaiming space; current heads, chain ancestors,
-- dead/retry inbox rows and durable business ledgers are never removed.
create or replace function private.cleanup_whatsapp_webhook_routing_provenance(
  p_limit integer default 1000,
  p_before timestamptz default (clock_timestamp() - interval '90 days')
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 1000), 1), 10000);
  v_candidate public.whatsapp_webhook_routing_snapshots%rowtype;
  v_deleted bigint := 0;
begin
  if p_before is null or p_before > clock_timestamp() - interval '30 days' then
    raise exception using
      errcode = '22023',
      message = 'whatsapp_routing_provenance_retention_too_short';
  end if;

  for v_candidate in
    select routing_snapshot.*
    from public.whatsapp_webhook_routing_snapshots as routing_snapshot
    left join public.whatsapp_webhook_routing_outcomes as routing_outcome
      on routing_outcome.organization_id = routing_snapshot.organization_id
     and routing_outcome.session_id = routing_snapshot.session_id
     and routing_outcome.provider_message_id = routing_snapshot.provider_message_id
     and routing_outcome.ingress_sequence = routing_snapshot.ingress_sequence
    where routing_snapshot.created_at < p_before
      and (
        (routing_snapshot.binding_eligible = false)
        or routing_outcome.completed_at < p_before
      )
      and not exists (
        select 1
        from public.whatsapp_conversation_routing_heads as routing_head
        where routing_head.organization_id = routing_snapshot.organization_id
          and routing_head.session_id = routing_snapshot.session_id
          and routing_head.provider_message_id = routing_snapshot.provider_message_id
          and routing_head.ingress_sequence = routing_snapshot.ingress_sequence
      )
      and not exists (
        select 1
        from public.whatsapp_webhook_routing_snapshots as successor
        where successor.organization_id = routing_snapshot.organization_id
          and successor.session_id = routing_snapshot.session_id
          and successor.routing_key = routing_snapshot.routing_key
          and successor.predecessor_provider_message_id = routing_snapshot.provider_message_id
      )
      and not exists (
        select 1
        from public.whatsapp_webhook_inbox as inbox
        where inbox.organization_id = routing_snapshot.organization_id
          and inbox.session_id = routing_snapshot.session_id
          and exists (
            select 1
            from pg_catalog.jsonb_array_elements(
              case
                when pg_catalog.jsonb_typeof(
                  inbox.payload #> '{__vimob_ingress,routing_snapshot,messages}'
                ) = 'array'
                  then inbox.payload #> '{__vimob_ingress,routing_snapshot,messages}'
                else '[]'::jsonb
              end
            ) as inbox_route(snapshot)
            where inbox_route.snapshot->>'provider_message_id' =
              routing_snapshot.provider_message_id
          )
      )
      and not exists (
        select 1
        from public.whatsapp_conversation_lead_bindings as binding
        where binding.organization_id = routing_snapshot.organization_id
          and binding.session_id = routing_snapshot.session_id
          and binding.provider_message_id = routing_snapshot.provider_message_id
      )
      and not exists (
        select 1
        from public.whatsapp_messages as message
        where message.organization_id = routing_snapshot.organization_id
          and message.session_id = routing_snapshot.session_id
          and (
            message.provider_message_id = routing_snapshot.provider_message_id
            or (
              message.provider_message_id is null
              and message.message_id = routing_snapshot.provider_message_id
            )
          )
      )
      and not exists (
        select 1
        from public.lead_entry_events as entry
        where entry.organization_id = routing_snapshot.organization_id
          and entry.provider = 'whatsapp'
          and entry.provider_event_id =
            routing_snapshot.session_id::text || ':' || routing_snapshot.provider_message_id
      )
      and not exists (
        select 1
        from private.whatsapp_meta_creative_event_ledger as creative
        where creative.organization_id = routing_snapshot.organization_id
          and creative.whatsapp_session_id = routing_snapshot.session_id
          and creative.provider_message_id = routing_snapshot.provider_message_id
      )
    order by routing_snapshot.routing_key, routing_snapshot.ingress_sequence
    limit v_limit
  loop
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        v_candidate.organization_id::text || ':' ||
        v_candidate.session_id::text || ':' || v_candidate.routing_key,
        0
      )
    );

    delete from public.whatsapp_webhook_routing_snapshots as routing_snapshot
    where routing_snapshot.organization_id = v_candidate.organization_id
      and routing_snapshot.session_id = v_candidate.session_id
      and routing_snapshot.provider_message_id = v_candidate.provider_message_id
      and routing_snapshot.ingress_sequence = v_candidate.ingress_sequence
      and not exists (
        select 1
        from public.whatsapp_conversation_routing_heads as routing_head
        where routing_head.organization_id = routing_snapshot.organization_id
          and routing_head.session_id = routing_snapshot.session_id
          and routing_head.provider_message_id = routing_snapshot.provider_message_id
          and routing_head.ingress_sequence = routing_snapshot.ingress_sequence
      )
      and not exists (
        select 1
        from public.whatsapp_webhook_routing_snapshots as successor
        where successor.organization_id = routing_snapshot.organization_id
          and successor.session_id = routing_snapshot.session_id
          and successor.routing_key = routing_snapshot.routing_key
          and successor.predecessor_provider_message_id = routing_snapshot.provider_message_id
      )
      and not exists (
        select 1
        from public.whatsapp_webhook_inbox as inbox
        where inbox.organization_id = routing_snapshot.organization_id
          and inbox.session_id = routing_snapshot.session_id
          and exists (
            select 1
            from pg_catalog.jsonb_array_elements(
              case
                when pg_catalog.jsonb_typeof(
                  inbox.payload #> '{__vimob_ingress,routing_snapshot,messages}'
                ) = 'array'
                  then inbox.payload #> '{__vimob_ingress,routing_snapshot,messages}'
                else '[]'::jsonb
              end
            ) as inbox_route(snapshot)
            where inbox_route.snapshot->>'provider_message_id' =
              routing_snapshot.provider_message_id
          )
      )
      and not exists (
        select 1
        from public.whatsapp_conversation_lead_bindings as binding
        where binding.organization_id = routing_snapshot.organization_id
          and binding.session_id = routing_snapshot.session_id
          and binding.provider_message_id = routing_snapshot.provider_message_id
      )
      and not exists (
        select 1
        from public.whatsapp_messages as message
        where message.organization_id = routing_snapshot.organization_id
          and message.session_id = routing_snapshot.session_id
          and (
            message.provider_message_id = routing_snapshot.provider_message_id
            or (
              message.provider_message_id is null
              and message.message_id = routing_snapshot.provider_message_id
            )
          )
      )
      and not exists (
        select 1
        from public.lead_entry_events as entry
        where entry.organization_id = routing_snapshot.organization_id
          and entry.provider = 'whatsapp'
          and entry.provider_event_id =
            routing_snapshot.session_id::text || ':' || routing_snapshot.provider_message_id
      )
      and not exists (
        select 1
        from private.whatsapp_meta_creative_event_ledger as creative
        where creative.organization_id = routing_snapshot.organization_id
          and creative.whatsapp_session_id = routing_snapshot.session_id
          and creative.provider_message_id = routing_snapshot.provider_message_id
      );

    if found then
      v_deleted := v_deleted + 1;
    end if;
  end loop;

  return v_deleted;
end;
$$;

revoke all on function private.cleanup_whatsapp_webhook_routing_provenance(
  integer, timestamptz
) from public, anon, authenticated;
grant execute on function private.cleanup_whatsapp_webhook_routing_provenance(
  integer, timestamptz
) to service_role;

comment on function private.cleanup_whatsapp_webhook_routing_provenance(
  integer, timestamptz
) is
'Conservative route-locked retention: removes only old, completed or non-binding provenance with no head, successor, inbox replay, message, binding, entry event, or creative ledger reference.';

commit;

begin;
set local lock_timeout = '5s';
set local statement_timeout = '5min';

-- Database-side automation capture is the final fence after an Edge/native
-- writer persists a CAS-losing historical event. The JSON marker is necessary
-- but never sufficient: re-check the row-locked conversation and its one
-- coherent active binding before enqueueing any lead-scoped automation.
create or replace function private.capture_automation_inbound_message_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conversation public.whatsapp_conversations%rowtype;
  v_binding public.whatsapp_conversation_lead_bindings%rowtype;
begin
  if coalesce(new.from_me, false) is distinct from false
     or new.direction is distinct from 'inbound'
     or new.lead_id is null
     or coalesce(new.metadata->>'whatsapp_event_binding_is_current', 'false') <> 'true'
     or private.is_terminal_whatsapp_lead_resolution_quarantine(
       new.metadata,
       new.from_me,
       new.provider_message_id,
       new.message_id
     ) then
    return new;
  end if;

  select conversation.*
  into v_conversation
  from public.whatsapp_conversations as conversation
  where conversation.id = new.conversation_id
  for share;

  if not found
     or v_conversation.organization_id is distinct from new.organization_id
     or v_conversation.session_id is distinct from new.session_id
     or v_conversation.lead_id is distinct from new.lead_id then
    return new;
  end if;

  select binding.*
  into v_binding
  from public.whatsapp_conversation_lead_bindings as binding
  where binding.organization_id = new.organization_id
    and binding.conversation_id = new.conversation_id
    and binding.active_to is null
  for share;

  if not found
     or v_binding.session_id is distinct from v_conversation.session_id
     or v_binding.lead_id is distinct from v_conversation.lead_id
     or v_binding.lead_id is distinct from new.lead_id then
    return new;
  end if;

  perform private.enqueue_automation_event(
    new.organization_id, 'message_received', 'whatsapp_message', new.id,
    new.lead_id, new.conversation_id,
    'message_received:' || new.id::text,
    pg_catalog.jsonb_build_object(
      'message_id', new.id,
      'lead_id', new.lead_id,
      'conversation_id', new.conversation_id,
      'session_id', new.session_id,
      'whatsapp_binding_id', v_binding.id,
      'message_type', coalesce(nullif(new.message_type, ''), 'text'),
      'content', new.content,
      'occurred_at', coalesce(new.received_at, new.created_at, now())
    )
  );

  return new;
exception when others then
  raise warning 'automation message event enqueue failed: %', sqlerrm;
  return new;
end;
$$;

revoke all on function private.capture_automation_inbound_message_event()
from public, anon, authenticated, service_role;

commit;

-- Internal commits above deliberately isolate short DDL locks from potentially
-- long data backfills. A migration runner can therefore observe a partially
-- applied file after an error; every phase is replay-safe, and this final phase
-- is the authoritative all-or-nothing readiness gate before A2/application
-- rollout is allowed.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '5min';

do $queue_scoped_lead_a1_readback$
declare
  v_index_definition text;
  v_trigger_name text;
  v_table_name text;
begin
  if not exists (
    select 1
    from pg_catalog.pg_attribute as attribute
    where attribute.attrelid = 'public.leads'::regclass
      and attribute.attname = 'intake_scope_key'
      and attribute.attnotnull
      and not attribute.attisdropped
  ) or not exists (
    select 1
    from pg_catalog.pg_attribute as attribute
    where attribute.attrelid = 'public.leads'::regclass
      and attribute.attname = 'origin_round_robin_id'
      and not attribute.attisdropped
  ) or not exists (
    select 1
    from pg_catalog.pg_attrdef as attribute_default
    join pg_catalog.pg_attribute as attribute
      on attribute.attrelid = attribute_default.adrelid
     and attribute.attnum = attribute_default.adnum
    where attribute_default.adrelid = 'public.leads'::regclass
      and attribute.attname = 'intake_scope_key'
      and pg_catalog.pg_get_expr(
        attribute_default.adbin,
        attribute_default.adrelid
      ) ilike '%unscoped%'
  ) or not exists (
    select 1
    from pg_catalog.pg_constraint as constraint_state
    where constraint_state.conrelid = 'public.leads'::regclass
      and constraint_state.conname = 'leads_intake_scope_key_check'
      and constraint_state.convalidated
  ) then
    raise exception using
      errcode = '55000',
      message = 'queue_scoped_lead_a1_lead_contract_readback_failed';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_attribute as attribute
    where attribute.attrelid = 'public.outbox_messages'::regclass
      and attribute.attname = 'lead_id'
      and not attribute.attisdropped
  ) then
    raise exception using
      errcode = '55000',
      message = 'queue_scoped_lead_a1_legacy_outbox_column_readback_failed';
  end if;

  if pg_catalog.to_regclass(
       'private.queue_scoped_lead_cutover_markers'
     ) is null
     or exists (
       select 1
       from (
         values
           ('cutover_key'::name, 'text'::pg_catalog.regtype, true),
           ('state'::name, 'text'::pg_catalog.regtype, true),
           ('prepared_release_sha'::name, 'text'::pg_catalog.regtype, true),
           ('legacy_index_oid'::name, 'oid'::pg_catalog.regtype, true),
           ('legacy_index_definition'::name, 'text'::pg_catalog.regtype, true),
           ('prepared_at'::name, 'timestamp with time zone'::pg_catalog.regtype, true),
           ('completed_at'::name, 'timestamp with time zone'::pg_catalog.regtype, false),
           ('updated_at'::name, 'timestamp with time zone'::pg_catalog.regtype, true)
       ) as expected(attribute_name, attribute_type, attribute_not_null)
       left join pg_catalog.pg_attribute as attribute
         on attribute.attrelid =
           'private.queue_scoped_lead_cutover_markers'::regclass
        and attribute.attname = expected.attribute_name
        and not attribute.attisdropped
       where attribute.attname is null
          or attribute.atttypid <> expected.attribute_type
          or attribute.attnotnull is distinct from expected.attribute_not_null
     )
     or not exists (
       select 1
       from pg_catalog.pg_constraint as constraint_state
       where constraint_state.conrelid =
         'private.queue_scoped_lead_cutover_markers'::regclass
         and constraint_state.contype = 'p'
         and constraint_state.convalidated
     )
     or (
       select pg_catalog.count(*)
       from pg_catalog.pg_constraint as constraint_state
       where constraint_state.conrelid =
         'private.queue_scoped_lead_cutover_markers'::regclass
         and constraint_state.conname = any (
           array[
             'queue_scoped_lead_cutover_marker_state_check',
             'queue_scoped_lead_cutover_marker_sha_check'
           ]::name[]
         )
         and constraint_state.contype = 'c'
         and constraint_state.convalidated
     ) <> 2
     or exists (
       select 1
       from pg_catalog.unnest(
         array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']::text[]
       ) as operation(privilege_name)
       where pg_catalog.has_table_privilege(
         'service_role',
         'private.queue_scoped_lead_cutover_markers',
         operation.privilege_name
       )
     ) then
    raise exception using
      errcode = '55000',
      message = 'queue_scoped_lead_a1_cutover_marker_readback_failed';
  end if;

  foreach v_table_name in array array[
    'whatsapp_conversation_lead_bindings',
    'whatsapp_webhook_routing_snapshots',
    'whatsapp_webhook_routing_outcomes',
    'whatsapp_conversation_routing_heads'
  ] loop
    if pg_catalog.to_regclass('public.' || v_table_name) is null
       or not exists (
         select 1
         from pg_catalog.pg_class as relation
         where relation.oid = pg_catalog.to_regclass('public.' || v_table_name)
           and relation.relrowsecurity
       ) then
      raise exception using
        errcode = '55000',
        message = 'queue_scoped_lead_a1_table_readback_failed:' || v_table_name;
    end if;
  end loop;

  if pg_catalog.to_regclass(
       'public.whatsapp_webhook_routing_ingress_sequence'
     ) is null then
    raise exception using
      errcode = '55000',
      message = 'queue_scoped_lead_a1_routing_sequence_readback_failed';
  end if;

  select pg_catalog.pg_get_indexdef(index_relation.oid)
  into v_index_definition
  from pg_catalog.pg_class as index_relation
  join pg_catalog.pg_index as index_state
    on index_state.indexrelid = index_relation.oid
  where index_relation.oid = pg_catalog.to_regclass(
    'public.whatsapp_conversation_lead_bindings_one_active_idx'
  )
    and index_state.indisvalid
    and index_state.indisready
    and index_state.indisunique;

  if v_index_definition is null
     or v_index_definition not ilike '%(conversation_id)%'
     or v_index_definition not ilike '%where (active_to is null)%' then
    raise exception using
      errcode = '55000',
      message = 'queue_scoped_lead_a1_active_binding_index_readback_failed';
  end if;

  foreach v_trigger_name in array array[
    'enforce_lead_intake_identity_before_write',
    'enforce_whatsapp_conversation_lead_binding_before_write',
    'close_whatsapp_bindings_before_lead_delete',
    'enforce_whatsapp_conversation_active_binding_consistency',
    'trg_enforce_whatsapp_outbox_session_match',
    'preserve_whatsapp_webhook_routing_snapshot_before_update'
  ] loop
    if not exists (
      select 1
      from pg_catalog.pg_trigger as trigger_state
      where trigger_state.tgname = v_trigger_name
        and not trigger_state.tgisinternal
        and trigger_state.tgenabled in ('O', 'A')
    ) then
      raise exception using
        errcode = '55000',
        message = 'queue_scoped_lead_a1_trigger_readback_failed:' || v_trigger_name;
    end if;
  end loop;

  if pg_catalog.to_regprocedure(
       'public.activate_whatsapp_conversation_lead_binding(uuid,uuid,uuid,text)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.activate_whatsapp_conversation_lead_binding(uuid,uuid,uuid,text,text)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.activate_whatsapp_conversation_lead_binding_if_current(uuid,uuid,uuid,text,uuid,uuid)'
     ) is null
     or pg_catalog.to_regprocedure(
       'private.capture_whatsapp_webhook_routing_snapshot(uuid,uuid,text,text,text,text,boolean,text[],text,text,text,boolean,boolean,boolean,uuid,uuid,uuid)'
     ) is null
     or not pg_catalog.has_function_privilege(
       'service_role',
       'public.activate_whatsapp_conversation_lead_binding(uuid,uuid,uuid,text,text)',
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'authenticated',
       'public.activate_whatsapp_conversation_lead_binding(uuid,uuid,uuid,text,text)',
       'EXECUTE'
     ) then
    raise exception using
      errcode = '55000',
      message = 'queue_scoped_lead_a1_rpc_readback_failed';
  end if;

  if exists (
    select 1
    from public.whatsapp_messages as message
    join public.whatsapp_conversations as conversation
      on conversation.id = message.conversation_id
     and conversation.organization_id = message.organization_id
    where conversation.lead_id is not null
      and message.lead_id is null
      and not private.is_terminal_whatsapp_lead_resolution_quarantine(
        message.metadata,
        message.from_me,
        message.provider_message_id,
        message.message_id
      )
  ) or exists (
    select 1
    from public.whatsapp_inbound_logs as inbound_log
    join public.whatsapp_conversations as conversation
      on conversation.id = inbound_log.conversation_id
     and conversation.organization_id = inbound_log.organization_id
    where conversation.lead_id is not null
      and inbound_log.lead_id is null
  ) or exists (
    select 1
    from public.outbox_messages as outbox
    join public.whatsapp_conversations as conversation
      on conversation.id = outbox.conversation_id
     and conversation.organization_id = outbox.organization_id
     and conversation.session_id = outbox.session_id
    where outbox.status in ('pending', 'processing')
      and conversation.lead_id is not null
      and outbox.lead_id is null
  ) then
    raise exception using
      errcode = '55000',
      message = 'queue_scoped_lead_a1_backfill_readback_failed';
  end if;
end;
$queue_scoped_lead_a1_readback$;

commit;
