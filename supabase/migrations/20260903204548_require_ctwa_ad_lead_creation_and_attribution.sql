-- A WhatsApp message may create a lead only when Meta explicitly identifies
-- the entry point as a Click-to-WhatsApp ad. Queue matching remains an
-- independent routing decision after that provider signal is established.

begin;
set local lock_timeout = '5s';

create or replace function private.whatsapp_metadata_is_ctwa_ad(p_metadata jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    lower(coalesce(
      nullif(btrim(p_metadata #>> '{whatsapp_attribution,entry_point_conversion_source}'), ''),
      nullif(btrim(p_metadata #>> '{whatsapp_attribution,source_referral,entry_point_conversion_source}'), ''),
      ''
    )) = 'ctwa_ad'
    and lower(coalesce(
      nullif(btrim(p_metadata #>> '{whatsapp_attribution,source_referral,explicit_source_type}'), ''),
      nullif(btrim(p_metadata #>> '{whatsapp_attribution,source_referral,source_type}'), ''),
      ''
    )) in ('', 'ad'),
    false
  );
$$;

revoke all on function private.whatsapp_metadata_is_ctwa_ad(jsonb)
from public, anon, authenticated, service_role;

-- Lead attachment must fail closed when historical duplicate rows share the
-- same normalized WhatsApp identity. Picking an arbitrary row can expose one
-- contact's conversation through another lead.
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
        and public.normalize_phone(lead.phone) is not null
        and public.normalize_phone(lead.phone) <> ''
        and public.normalize_phone(lead.phone) = v_phone_key
      limit 2
    ) as matches;

  if v_match_count > 1 then
    raise exception using
      errcode = '23505',
      message = 'whatsapp_lead_phone_ambiguous';
  end if;

  if v_match_count = 0 then
    return;
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
    and public.normalize_phone(lead.phone) is not null
    and public.normalize_phone(lead.phone) <> ''
    and public.normalize_phone(lead.phone) = v_phone_key
  order by
    case when lead.deal_status = 'open' then 0 else 1 end,
    lead.last_contact_at desc nulls last,
    lead.created_at desc,
    lead.id
  limit 1;
end;
$$;

revoke all on function public.find_lead_by_normalized_phone(uuid, text)
from public, anon, authenticated;
grant execute on function public.find_lead_by_normalized_phone(uuid, text)
to service_role;

comment on function public.find_lead_by_normalized_phone(uuid, text) is
'Returns the single organization-scoped lead matching the indexed normalized phone and rejects ambiguous historical duplicates.';

create or replace function public.whatsapp_webhook_has_lead_creation_context(p_metadata jsonb)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with managed_context as (
    select
      private.whatsapp_metadata_is_ctwa_ad(coalesce(p_metadata, '{}'::jsonb)) as is_ctwa_ad,
      btrim(coalesce(p_metadata->>'whatsapp_lead_creation_contract', '')) as contract_version,
      lower(btrim(coalesce(
        p_metadata->>'managed_whatsapp_message_distribution',
        'false'
      ))) in ('true', '1', 'yes') as is_managed,
      case
        when btrim(coalesce(p_metadata->>'matched_rule_id', ''))
          ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then btrim(p_metadata->>'matched_rule_id')::uuid
        else null
      end as rule_id,
      case
        when btrim(coalesce(p_metadata->>'whatsapp_session_id', ''))
          ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then btrim(p_metadata->>'whatsapp_session_id')::uuid
        else null
      end as session_id,
      case
        when btrim(coalesce(p_metadata->>'target_round_robin_id', ''))
          ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then btrim(p_metadata->>'target_round_robin_id')::uuid
        else null
      end as round_robin_id
  )
  select case
    when managed_context.contract_version = 'ctwa_ad_v1'
      then managed_context.is_ctwa_ad
    when managed_context.contract_version <> ''
      then false
    when managed_context.is_managed
      then true
    else coalesce(
      lower(btrim(
        p_metadata #>> '{whatsapp_attribution,source_referral,explicit_source_type}'
      )) = 'ad'
      and coalesce(
        nullif(btrim(p_metadata #>> '{whatsapp_attribution,ad_id}'), ''),
        nullif(btrim(p_metadata #>> '{whatsapp_attribution,source_id}'), ''),
        nullif(btrim(p_metadata #>> '{whatsapp_attribution,source_referral,source_id}'), '')
      ) ~ '^[0-9]{5,40}$',
      false
    )
  end and case
    when managed_context.is_managed then coalesce(
      managed_context.rule_id is not null
      and managed_context.session_id is not null
      and managed_context.round_robin_id is not null
      and exists (
        select 1
        from public.whatsapp_inbound_rules as inbound_rule
        join public.round_robin_rules as round_robin_rule
          on round_robin_rule.organization_id = inbound_rule.organization_id
         and round_robin_rule.id = inbound_rule.id
         and round_robin_rule.round_robin_id = inbound_rule.target_round_robin_id
        join public.round_robins as queue
          on queue.organization_id = round_robin_rule.organization_id
         and queue.id = round_robin_rule.round_robin_id
        join public.whatsapp_sessions as whatsapp_session
          on whatsapp_session.organization_id = inbound_rule.organization_id
         and whatsapp_session.id = inbound_rule.session_id
        where inbound_rule.id = managed_context.rule_id
          and inbound_rule.session_id = managed_context.session_id
          and queue.id = managed_context.round_robin_id
          and coalesce(
            nullif(round_robin_rule.match_type, ''),
            round_robin_rule.conditions->>'match_type',
            round_robin_rule.name,
            ''
          ) = 'whatsapp_message_contains'
          and coalesce(
            nullif(btrim(round_robin_rule.match->>'whatsapp_session_id'), ''),
            nullif(btrim(round_robin_rule.conditions->'match'->>'whatsapp_session_id'), '')
          ) = managed_context.session_id::text
          and coalesce(queue.is_active, true) = true
          and coalesce(round_robin_rule.is_active, true) = true
          and coalesce(inbound_rule.is_active, true) = true
          and whatsapp_session.provider = 'evolution_go'
          and coalesce(whatsapp_session.is_active, true) = true
          and lower(btrim(coalesce(whatsapp_session.status, ''))) not in ('deleted', 'disabled')
          and lower(btrim(coalesce(inbound_rule.match_type, ''))) = 'contains'
          and lower(btrim(coalesce(inbound_rule.match_field, 'message'))) = 'message'
          and btrim(coalesce(inbound_rule.match_value, '')) <> ''
          and lower(btrim(inbound_rule.match_value)) = lower(btrim(coalesce(
            nullif(round_robin_rule.match_value, ''),
            round_robin_rule.conditions->>'match_value',
            ''
          )))
          and lower(btrim(coalesce(queue.settings->>'require_checkin', 'false')))
            not in ('true', '1', 'yes')
      ),
      false
    )
    else true
  end
  from managed_context;
$$;

revoke all on function public.whatsapp_webhook_has_lead_creation_context(jsonb)
from public, anon, authenticated;
grant execute on function public.whatsapp_webhook_has_lead_creation_context(jsonb)
to service_role;

comment on function public.whatsapp_webhook_has_lead_creation_context(jsonb) is
'Requires an explicit Meta ctwa_ad entry point for the versioned CTWA intake contract while preserving the prior contract during rolling deployment; a managed queue additionally requires its active session-bound canonical rule.';

-- Defense in depth for callers that might insert a managed lead without using
-- the backend-only upsert RPC. Manual WhatsApp leads are intentionally outside
-- this trigger because they do not carry the managed intake marker.
create or replace function private.validate_managed_whatsapp_ctwa_ad()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_role text := coalesce(auth.role(), '');
  v_trusted_writer boolean := false;
  v_new_automatic_marker boolean := false;
  v_old_automatic_marker boolean := false;
  v_protected_metadata_changed boolean := false;
begin
  v_trusted_writer := v_actor_role = 'service_role'
    or (
      v_actor_role = ''
      and session_user not in ('anon', 'authenticated', 'authenticator')
    );
  v_new_automatic_marker := btrim(coalesce(new.metadata->>'whatsapp_lead_creation_contract', '')) <> ''
    or lower(btrim(coalesce(new.metadata->>'managed_whatsapp_message_distribution', 'false'))) in ('true', '1', 'yes')
    or lower(btrim(coalesce(new.metadata->>'ctwa_ad_confirmed', 'false'))) in ('true', '1', 'yes')
    or btrim(coalesce(new.metadata->>'whatsapp_initial_provider_event_id', '')) <> ''
    or btrim(coalesce(new.metadata->>'managed_whatsapp_initial_provider_event_id', '')) <> '';
  if tg_op = 'UPDATE' then
    v_old_automatic_marker := btrim(coalesce(old.metadata->>'whatsapp_lead_creation_contract', '')) <> ''
      or lower(btrim(coalesce(old.metadata->>'managed_whatsapp_message_distribution', 'false'))) in ('true', '1', 'yes')
      or lower(btrim(coalesce(old.metadata->>'ctwa_ad_confirmed', 'false'))) in ('true', '1', 'yes')
      or btrim(coalesce(old.metadata->>'whatsapp_initial_provider_event_id', '')) <> ''
      or btrim(coalesce(old.metadata->>'managed_whatsapp_initial_provider_event_id', '')) <> '';
    v_protected_metadata_changed := jsonb_build_object(
      'contract', old.metadata->'whatsapp_lead_creation_contract',
      'attribution', old.metadata->'whatsapp_attribution',
      'managed', old.metadata->'managed_whatsapp_message_distribution',
      'rule', old.metadata->'matched_rule_id',
      'session', old.metadata->'whatsapp_session_id',
      'queue', old.metadata->'target_round_robin_id',
      'initial_event', old.metadata->'whatsapp_initial_provider_event_id',
      'managed_initial_event', old.metadata->'managed_whatsapp_initial_provider_event_id',
      'confirmed', old.metadata->'ctwa_ad_confirmed'
    ) is distinct from jsonb_build_object(
      'contract', new.metadata->'whatsapp_lead_creation_contract',
      'attribution', new.metadata->'whatsapp_attribution',
      'managed', new.metadata->'managed_whatsapp_message_distribution',
      'rule', new.metadata->'matched_rule_id',
      'session', new.metadata->'whatsapp_session_id',
      'queue', new.metadata->'target_round_robin_id',
      'initial_event', new.metadata->'whatsapp_initial_provider_event_id',
      'managed_initial_event', new.metadata->'managed_whatsapp_initial_provider_event_id',
      'confirmed', new.metadata->'ctwa_ad_confirmed'
    );
  end if;

  if not v_trusted_writer
     and (
       (tg_op = 'INSERT' and v_new_automatic_marker)
       or (tg_op = 'UPDATE' and (v_new_automatic_marker or v_old_automatic_marker) and v_protected_metadata_changed)
     ) then
    raise exception using
      errcode = '42501',
      message = 'trusted_whatsapp_lead_provenance_required';
  end if;

  if btrim(coalesce(new.metadata->>'whatsapp_lead_creation_contract', '')) <> ''
     and (
       btrim(new.metadata->>'whatsapp_lead_creation_contract') <> 'ctwa_ad_v1'
       or not private.whatsapp_metadata_is_ctwa_ad(coalesce(new.metadata, '{}'::jsonb))
     ) then
    raise exception using
      errcode = '23514',
      message = 'managed_whatsapp_ctwa_ad_required';
  end if;
  return new;
end;
$$;

revoke all on function private.validate_managed_whatsapp_ctwa_ad()
from public, anon, authenticated, service_role;

drop trigger if exists validate_managed_whatsapp_ctwa_ad on public.leads;
create trigger validate_managed_whatsapp_ctwa_ad
before insert or update of metadata on public.leads
for each row execute function private.validate_managed_whatsapp_ctwa_ad();

-- Provider attribution stored on a WhatsApp message is immutable to browser
-- sessions. The backend may continue updating transport fields with the
-- service role or its direct trusted database connection.
create or replace function private.protect_whatsapp_provider_attribution()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_role text := coalesce(auth.role(), '');
  v_trusted_writer boolean := false;
  v_old_attribution jsonb;
  v_new_attribution jsonb;
begin
  v_trusted_writer := v_actor_role = 'service_role'
    or (
      v_actor_role = ''
      and session_user not in ('anon', 'authenticated', 'authenticator')
    );
  if v_trusted_writer then
    return new;
  end if;

  v_new_attribution := jsonb_build_object(
    'attribution', new.metadata->'whatsapp_attribution',
    'referral', new.metadata->'whatsapp_referral'
  );
  if tg_op = 'INSERT' then
    if new.metadata ? 'whatsapp_attribution' or new.metadata ? 'whatsapp_referral' then
      raise exception using
        errcode = '42501',
        message = 'trusted_whatsapp_provider_attribution_required';
    end if;
    return new;
  end if;

  v_old_attribution := jsonb_build_object(
    'attribution', old.metadata->'whatsapp_attribution',
    'referral', old.metadata->'whatsapp_referral'
  );
  if v_new_attribution is distinct from v_old_attribution then
    raise exception using
      errcode = '42501',
      message = 'trusted_whatsapp_provider_attribution_required';
  end if;
  return new;
end;
$$;

revoke all on function private.protect_whatsapp_provider_attribution()
from public, anon, authenticated, service_role;

drop trigger if exists protect_whatsapp_provider_attribution on public.whatsapp_messages;
create trigger protect_whatsapp_provider_attribution
before insert or update of metadata on public.whatsapp_messages
for each row execute function private.protect_whatsapp_provider_attribution();

-- Reserve an indexed provider-event ledger for creative history. Keeping the
-- idempotency key outside the hot activities table avoids an expression-index
-- rollout there and makes every new provider event an O(log n) lookup.
create table if not exists private.whatsapp_meta_creative_event_ledger (
  organization_id uuid not null,
  whatsapp_session_id uuid not null,
  provider_message_id text not null,
  lead_id uuid not null,
  activity_id uuid,
  recorded_at timestamptz not null default clock_timestamp(),
  primary key (organization_id, whatsapp_session_id, provider_message_id),
  constraint whatsapp_meta_creative_event_ledger_organization_fkey
    foreign key (organization_id) references public.organizations(id) on delete cascade,
  constraint whatsapp_meta_creative_event_ledger_session_fkey
    foreign key (whatsapp_session_id) references public.whatsapp_sessions(id) on delete cascade,
  constraint whatsapp_meta_creative_event_ledger_lead_fkey
    foreign key (lead_id) references public.leads(id) on delete cascade,
  constraint whatsapp_meta_creative_provider_message_id_length
    check (length(provider_message_id) between 1 and 500)
);

create index if not exists whatsapp_meta_creative_event_ledger_session_idx
  on private.whatsapp_meta_creative_event_ledger (whatsapp_session_id);

create index if not exists whatsapp_meta_creative_event_ledger_lead_idx
  on private.whatsapp_meta_creative_event_ledger (lead_id);

revoke all on table private.whatsapp_meta_creative_event_ledger
from public, anon, authenticated, service_role;

comment on table private.whatsapp_meta_creative_event_ledger is
'Backend-only idempotency ledger for one Meta creative activity per organization, WhatsApp session and provider message.';

-- The same trigger reserves meta_creative as backend provenance and protects
-- it from browser forgery or mutation. Existing pre-ledger activities are
-- adopted lazily through the lead index so rollout does not scan or lock the
-- full activities table.
create or replace function private.dedupe_whatsapp_meta_creative_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_role text := coalesce(auth.role(), '');
  v_trusted_writer boolean := false;
  v_message_id text;
  v_session_text text;
  v_session_id uuid;
  v_historical_activity_id uuid;
  v_historical_found boolean := false;
  v_registered_lead_id uuid;
begin
  v_trusted_writer := v_actor_role = 'service_role'
    or (
      v_actor_role = ''
      and session_user not in ('anon', 'authenticated', 'authenticator')
    );

  if tg_op = 'DELETE' then
    if old.type <> 'meta_creative' or v_trusted_writer then
      return old;
    end if;

    -- Preserve existing lead/organization deletion behavior. Referential
    -- cascades run after the parent row is no longer visible in this transaction;
    -- a direct activity deletion still sees both parents and is rejected.
    if (
      old.lead_id is not null
      and not exists (
        select 1
        from public.leads as lead
        where lead.organization_id = old.organization_id
          and lead.id = old.lead_id
      )
    ) or (
      old.organization_id is not null
      and not exists (
        select 1
        from public.organizations as organization
        where organization.id = old.organization_id
      )
    ) then
      return old;
    end if;

    raise exception using
      errcode = '42501',
      message = 'trusted_whatsapp_meta_creative_activity_required';
  end if;

  if tg_op = 'UPDATE'
     and (old.type = 'meta_creative' or new.type = 'meta_creative') then
    if not v_trusted_writer then
      raise exception using
        errcode = '42501',
        message = 'trusted_whatsapp_meta_creative_activity_required';
    end if;

    if old.type is distinct from new.type
       or old.organization_id is distinct from new.organization_id
       or old.lead_id is distinct from new.lead_id
       or (old.metadata->>'whatsapp_session_id') is distinct from (new.metadata->>'whatsapp_session_id')
       or (old.metadata->>'message_id') is distinct from (new.metadata->>'message_id') then
      raise exception using
        errcode = '23514',
        message = 'whatsapp_meta_creative_provider_identity_immutable';
    end if;
    return new;
  end if;

  if new.type <> 'meta_creative' then
    return new;
  end if;

  if not v_trusted_writer then
    raise exception using
      errcode = '42501',
      message = 'trusted_whatsapp_meta_creative_activity_required';
  end if;

  v_message_id := btrim(coalesce(new.metadata->>'message_id', ''));
  v_session_text := btrim(coalesce(new.metadata->>'whatsapp_session_id', ''));
  begin
    v_session_id := nullif(v_session_text, '')::uuid;
  exception
    when invalid_text_representation then
      v_session_id := null;
  end;

  if new.organization_id is null
     or new.lead_id is null
     or v_session_id is null
     or length(v_message_id) not between 1 and 500
     or new.metadata->>'message_id' is distinct from v_message_id
     or not exists (
       select 1
       from public.whatsapp_messages as message
       where message.organization_id = new.organization_id
         and message.session_id = v_session_id
         and message.lead_id = new.lead_id
         and coalesce(message.from_me, false) = false
         and lower(coalesce(message.direction, 'inbound')) <> 'outbound'
         and (
           message.provider_message_id = v_message_id
           or (
             message.provider_message_id is null
             and message.message_id = v_message_id
           )
         )
     ) then
    raise exception using
      errcode = '23514',
      message = 'whatsapp_meta_creative_provider_identity_required';
  end if;

  select activity.id
    into v_historical_activity_id
    from public.activities as activity
   where activity.organization_id = new.organization_id
     and activity.lead_id = new.lead_id
     and activity.type = 'meta_creative'
     and activity.metadata->>'whatsapp_session_id' = v_session_id::text
     and activity.metadata->>'message_id' = v_message_id
   order by activity.created_at desc, activity.id desc
   limit 1;
  v_historical_found := found;

  insert into private.whatsapp_meta_creative_event_ledger (
    organization_id,
    whatsapp_session_id,
    provider_message_id,
    lead_id,
    activity_id
  ) values (
    new.organization_id,
    v_session_id,
    v_message_id,
    new.lead_id,
    case when v_historical_found then v_historical_activity_id else new.id end
  )
  on conflict (organization_id, whatsapp_session_id, provider_message_id)
  do nothing
  returning lead_id into v_registered_lead_id;

  if found then
    if v_historical_found then
      -- Only the transaction that wins the immutable ledger key may promote
      -- old history. Later exact retries are true no-ops rather than
      -- last-writer-wins mutations of trusted content or creative URLs.
      delete from public.activities as activity
       where activity.organization_id = new.organization_id
         and activity.lead_id = new.lead_id
         and activity.type = 'meta_creative'
         and activity.metadata->>'whatsapp_session_id' = v_session_id::text
         and activity.metadata->>'message_id' = v_message_id
         and activity.id <> v_historical_activity_id;

      update public.activities as activity
         set user_id = new.user_id,
             content = new.content,
             metadata = new.metadata
       where activity.organization_id = new.organization_id
         and activity.lead_id = new.lead_id
         and activity.id = v_historical_activity_id;
      return null;
    end if;
    return new;
  end if;

  select ledger.lead_id
    into v_registered_lead_id
    from private.whatsapp_meta_creative_event_ledger as ledger
   where ledger.organization_id = new.organization_id
     and ledger.whatsapp_session_id = v_session_id
     and ledger.provider_message_id = v_message_id;

  if v_registered_lead_id is distinct from new.lead_id then
    raise exception using
      errcode = '23505',
      message = 'whatsapp_meta_creative_provider_event_lead_collision';
  end if;

  if v_registered_lead_id is not null then
    return null;
  end if;

  raise exception using
    errcode = '40001',
    message = 'whatsapp_meta_creative_provider_event_registration_failed';
end;
$$;

revoke all on function private.dedupe_whatsapp_meta_creative_activity()
from public, anon, authenticated, service_role;

drop trigger if exists dedupe_whatsapp_meta_creative_activity on public.activities;
create trigger dedupe_whatsapp_meta_creative_activity
before insert or update or delete on public.activities
for each row execute function private.dedupe_whatsapp_meta_creative_activity();

-- Enrich the canonical entry ledger from the already persisted, normalized
-- message row. The caller cannot inject attribution into this SECURITY DEFINER
-- boundary; org/session/lead/provider identity must all match first.
create or replace function public.enrich_whatsapp_lead_entry_attribution(
  p_organization_id uuid,
  p_lead_id uuid,
  p_session_id uuid,
  p_provider_message_id text
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_provider_message_id text := btrim(coalesce(p_provider_message_id, ''));
  v_provider_event_id text;
  v_message public.whatsapp_messages%rowtype;
  v_source jsonb;
  v_attribution jsonb;
  v_source_app text;
begin
  if p_organization_id is null
     or p_lead_id is null
     or p_session_id is null
     or length(v_provider_message_id) not between 1 and 500
     or p_provider_message_id <> v_provider_message_id then
    raise exception using
      errcode = '22023',
      message = 'whatsapp_entry_attribution_identity_required';
  end if;

  v_provider_event_id := p_session_id::text || ':' || v_provider_message_id;

  select message.*
    into v_message
    from public.whatsapp_messages as message
   where message.organization_id = p_organization_id
     and message.session_id = p_session_id
     and message.lead_id = p_lead_id
     and coalesce(message.from_me, false) = false
     and lower(coalesce(message.direction, 'inbound')) <> 'outbound'
     and (
       message.provider_message_id = v_provider_message_id
       or (
         message.provider_message_id is null
         and message.message_id = v_provider_message_id
       )
     )
   order by message.created_at, message.id
   limit 1;

  if not found then
    return false;
  end if;

  select coalesce(inbound_log.match_details->'whatsapp_attribution', '{}'::jsonb)
    into v_source
    from public.whatsapp_inbound_logs as inbound_log
   where inbound_log.organization_id = p_organization_id
     and inbound_log.session_id = p_session_id
     and inbound_log.conversation_id = v_message.conversation_id
     and inbound_log.lead_id = p_lead_id
     and inbound_log.match_details->>'message_id' = v_provider_message_id
     and lower(coalesce(
       inbound_log.match_details->>'managed_whatsapp_message_distribution',
       'false'
     )) in ('true', '1', 'yes')
   order by inbound_log.created_at, inbound_log.id
   limit 1;

  if not found
     or jsonb_typeof(v_source) <> 'object'
     or not private.whatsapp_metadata_is_ctwa_ad(
       jsonb_build_object('whatsapp_attribution', v_source)
     ) then
    return false;
  end if;

  v_source_app := lower(coalesce(
    nullif(btrim(v_source->>'source_app'), ''),
    nullif(btrim(v_source->>'entry_point_conversion_app'), ''),
    nullif(btrim(v_source->'source_referral'->>'source_app'), ''),
    nullif(btrim(v_source->'source_referral'->>'entry_point_conversion_app'), ''),
    'meta'
  ));
  if v_source_app not in ('instagram', 'facebook') then
    v_source_app := 'meta';
  end if;

  v_attribution := jsonb_strip_nulls(jsonb_build_object(
    'source', 'whatsapp',
    'source_type', 'whatsapp_click_to_message',
    'channel', 'whatsapp',
    'platform', 'meta',
    'message_id', v_provider_message_id,
    'provider_event_id', v_provider_event_id,
    'whatsapp_session_id', p_session_id,
    'source_id', nullif(btrim(coalesce(v_source->>'source_id', v_source->>'ad_id', '')), ''),
    'ad_id', nullif(btrim(coalesce(v_source->>'ad_id', v_source->>'source_id', '')), ''),
    'ad_name', nullif(btrim(coalesce(v_source->>'ad_name', v_source->>'source_referral_title', '')), ''),
    'campaign_name', nullif(btrim(coalesce(v_source->>'campaign_name', v_source->>'source_referral_title', '')), ''),
    'creative_name', nullif(btrim(coalesce(v_source->>'creative_name', v_source->>'source_referral_title', '')), ''),
    'creative_link_url', nullif(btrim(coalesce(v_source->>'creative_link_url', v_source->>'source_url', '')), ''),
    'creative_destination_url', nullif(btrim(coalesce(v_source->>'creative_destination_url', v_source->>'source_url', '')), ''),
    'creative_instagram_url', case
      when v_source_app = 'instagram'
        then nullif(btrim(coalesce(v_source->>'source_url', v_source->>'creative_link_url', '')), '')
      else null
    end,
    'source_url', nullif(btrim(coalesce(v_source->>'source_url', v_source->>'creative_link_url', '')), ''),
    'source_app', v_source_app,
    'conversion_source', nullif(btrim(v_source->>'conversion_source'), ''),
    'entry_point_conversion_source', 'ctwa_ad',
    'entry_point_conversion_app', nullif(btrim(v_source->>'entry_point_conversion_app'), ''),
    'ctwa_clid', nullif(btrim(v_source->>'ctwa_clid'), ''),
    'show_ad_attribution', v_source->'show_ad_attribution',
    'source_referral', v_source->'source_referral',
    'utm_source', v_source_app,
    'utm_medium', 'click_to_whatsapp'
  ));

  update public.lead_entry_events as entry
     set source = 'whatsapp',
         provider = 'whatsapp',
         occurred_at = coalesce(v_message.sent_at, v_message.received_at, entry.occurred_at, entry.created_at),
         is_countable = true,
         source_detail = 'whatsapp_click_to_message',
         campaign_name = coalesce(nullif(v_attribution->>'campaign_name', ''), entry.campaign_name),
         ad_id = coalesce(nullif(v_attribution->>'ad_id', ''), entry.ad_id),
         ad_name = coalesce(nullif(v_attribution->>'ad_name', ''), entry.ad_name),
         utm_source = v_source_app,
         utm_medium = 'click_to_whatsapp',
         utm_campaign = coalesce(nullif(v_attribution->>'campaign_name', ''), entry.utm_campaign),
         metadata = coalesce(entry.metadata, '{}'::jsonb) || v_attribution,
         payload = coalesce(entry.payload, '{}'::jsonb)
           || jsonb_build_object('whatsapp_attribution', v_attribution)
   where entry.organization_id = p_organization_id
     and entry.lead_id = p_lead_id
     and entry.provider = 'whatsapp'
     and entry.provider_event_id = v_provider_event_id
     and entry.is_countable = true;

  return found;
end;
$$;

revoke all on function public.enrich_whatsapp_lead_entry_attribution(
  uuid, uuid, uuid, text
) from public, anon, authenticated;
grant execute on function public.enrich_whatsapp_lead_entry_attribution(
  uuid, uuid, uuid, text
) to service_role;

comment on function public.enrich_whatsapp_lead_entry_attribution(
  uuid, uuid, uuid, text
) is
'Copies normalized CTWA attribution from the trusted managed inbound log into its canonical lead entry event after validating the persisted message, organization, session, lead and provider identity.';

commit;
