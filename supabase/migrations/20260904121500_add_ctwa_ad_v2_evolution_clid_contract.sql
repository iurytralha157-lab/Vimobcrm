-- Evolution may omit entry_point_conversion_source on a legitimate first
-- Click-to-WhatsApp message while still providing the provider-owned CTWA
-- click id. Keep v1 strict and add a closed, auditable v2 fallback without
-- trusting inferred campaign fields, message text, URLs or ad/source ids.

begin;
set local lock_timeout = '5s';

create or replace function private.whatsapp_metadata_ctwa_confirmation_method(p_metadata jsonb)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_metadata jsonb := coalesce(p_metadata, '{}'::jsonb);
  v_attribution jsonb;
  v_referral jsonb;
  v_entry_point_top text;
  v_entry_point_referral text;
  v_explicit_source_type_top text;
  v_explicit_source_type_referral text;
  v_ctwa_clid_top_json jsonb;
  v_ctwa_clid_referral_json jsonb;
  v_ctwa_clid_top text;
  v_ctwa_clid_referral text;
  v_ctwa_clid text;
  v_show_ad_attribution_top jsonb;
  v_show_ad_attribution_referral jsonb;
  v_proof_conflict_top jsonb;
  v_proof_conflict_referral jsonb;
  v_show_invalid_top jsonb;
  v_show_invalid_referral jsonb;
begin
  v_attribution := case
    when jsonb_typeof(v_metadata->'whatsapp_attribution') = 'object'
      then v_metadata->'whatsapp_attribution'
    else '{}'::jsonb
  end;
  v_referral := case
    when jsonb_typeof(v_attribution->'source_referral') = 'object'
      then v_attribution->'source_referral'
    else '{}'::jsonb
  end;

  v_entry_point_top := nullif(btrim(v_attribution->>'entry_point_conversion_source'), '');
  v_entry_point_referral := nullif(btrim(v_referral->>'entry_point_conversion_source'), '');
  v_explicit_source_type_top := nullif(lower(btrim(v_attribution->>'explicit_source_type')), '');
  v_explicit_source_type_referral := nullif(lower(btrim(v_referral->>'explicit_source_type')), '');
  v_ctwa_clid_top_json := v_attribution->'ctwa_clid';
  v_ctwa_clid_referral_json := v_referral->'ctwa_clid';
  v_show_ad_attribution_top := v_attribution->'show_ad_attribution';
  v_show_ad_attribution_referral := v_referral->'show_ad_attribution';
  v_proof_conflict_top := v_attribution->'ctwa_proof_conflict';
  v_proof_conflict_referral := v_referral->'ctwa_proof_conflict';
  v_show_invalid_top := v_attribution->'ctwa_show_ad_attribution_invalid';
  v_show_invalid_referral := v_referral->'ctwa_show_ad_attribution_invalid';

  -- Runtime parsers preserve contradictions found between the current
  -- message and its immediate envelope. Any non-false marker fails closed.
  if (v_proof_conflict_top is not null
      and v_proof_conflict_top <> 'null'::jsonb
      and v_proof_conflict_top <> 'false'::jsonb)
     or (v_proof_conflict_referral is not null
      and v_proof_conflict_referral <> 'null'::jsonb
      and v_proof_conflict_referral <> 'false'::jsonb) then
    return null;
  end if;

  if (v_show_invalid_top is not null
      and v_show_invalid_top <> 'null'::jsonb
      and v_show_invalid_top <> 'false'::jsonb)
     or (v_show_invalid_referral is not null
      and v_show_invalid_referral <> 'null'::jsonb
      and v_show_invalid_referral <> 'false'::jsonb) then
    return null;
  end if;

  if (v_show_ad_attribution_top is not null
      and v_show_ad_attribution_top <> 'null'::jsonb
      and jsonb_typeof(v_show_ad_attribution_top) <> 'boolean')
     or (v_show_ad_attribution_referral is not null
      and v_show_ad_attribution_referral <> 'null'::jsonb
      and jsonb_typeof(v_show_ad_attribution_referral) <> 'boolean') then
    return null;
  end if;

  if (v_ctwa_clid_top_json is not null
      and v_ctwa_clid_top_json <> 'null'::jsonb
      and jsonb_typeof(v_ctwa_clid_top_json) <> 'string')
     or (v_ctwa_clid_referral_json is not null
      and v_ctwa_clid_referral_json <> 'null'::jsonb
      and jsonb_typeof(v_ctwa_clid_referral_json) <> 'string') then
    return null;
  end if;

  -- Also reject directly observable top/referral disagreements so legacy or
  -- independently supplied metadata cannot bypass the runtime marker.
  if (v_entry_point_top is not null
      and v_entry_point_referral is not null
      and lower(v_entry_point_top) <> lower(v_entry_point_referral))
     or (v_explicit_source_type_top is not null
      and v_explicit_source_type_referral is not null
      and v_explicit_source_type_top <> v_explicit_source_type_referral)
     or (v_ctwa_clid_top_json is not null
      and v_ctwa_clid_top_json <> 'null'::jsonb
      and v_ctwa_clid_referral_json is not null
      and v_ctwa_clid_referral_json <> 'null'::jsonb
      and v_ctwa_clid_top_json <> v_ctwa_clid_referral_json)
     or (v_show_ad_attribution_top is not null
      and v_show_ad_attribution_top <> 'null'::jsonb
      and v_show_ad_attribution_referral is not null
      and v_show_ad_attribution_referral <> 'null'::jsonb
      and v_show_ad_attribution_top <> v_show_ad_attribution_referral) then
    return null;
  end if;

  -- A supplied entry point is authoritative. Conflicting or non-CTWA values
  -- must never fall through to the Evolution fallback.
  if v_entry_point_top is not null or v_entry_point_referral is not null then
    if (v_entry_point_top is null or lower(v_entry_point_top) = 'ctwa_ad')
       and (v_entry_point_referral is null or lower(v_entry_point_referral) = 'ctwa_ad')
       and (v_explicit_source_type_top is null or v_explicit_source_type_top = 'ad')
       and (v_explicit_source_type_referral is null or v_explicit_source_type_referral = 'ad') then
      return 'entry_point_ctwa_ad';
    end if;
    return null;
  end if;

  -- Only an explicitly received provider field may corroborate the opaque
  -- click id. source_referral.source_type is intentionally not consulted: it
  -- can be inferred by application normalizers from the click id itself.
  if coalesce(v_explicit_source_type_top, v_explicit_source_type_referral, '') <> 'ad'
     or (v_explicit_source_type_top is not null and v_explicit_source_type_top <> 'ad')
     or (v_explicit_source_type_referral is not null and v_explicit_source_type_referral <> 'ad') then
    return null;
  end if;

  v_ctwa_clid_top := nullif(btrim(v_attribution->>'ctwa_clid'), '');
  v_ctwa_clid_referral := nullif(btrim(v_referral->>'ctwa_clid'), '');
  if v_ctwa_clid_top is not null
     and v_ctwa_clid_referral is not null
     and v_ctwa_clid_top <> v_ctwa_clid_referral then
    return null;
  end if;
  v_ctwa_clid := coalesce(v_ctwa_clid_top, v_ctwa_clid_referral);
  if v_ctwa_clid is null
     or octet_length(v_ctwa_clid) not between 8 and 512
     or v_ctwa_clid ~ '[[:cntrl:]]' then
    return null;
  end if;

  -- Missing show_ad_attribution is a known Evolution shape. When supplied it
  -- must be the JSON boolean true; false or a stringly/truthy value blocks v2.
  if (v_show_ad_attribution_top is not null
      and v_show_ad_attribution_top <> 'null'::jsonb
      and v_show_ad_attribution_top <> 'true'::jsonb)
     or (v_show_ad_attribution_referral is not null
      and v_show_ad_attribution_referral <> 'null'::jsonb
      and v_show_ad_attribution_referral <> 'true'::jsonb) then
    return null;
  end if;

  return 'evolution_ctwa_clid_v1';
end;
$$;

revoke all on function private.whatsapp_metadata_ctwa_confirmation_method(jsonb)
from public, anon, authenticated, service_role;

comment on function private.whatsapp_metadata_ctwa_confirmation_method(jsonb) is
'Returns the provider-proof method for a strict Meta CTWA entry point or the closed Evolution explicit-ad plus opaque-ctwa-clid fallback.';

create or replace function private.whatsapp_metadata_is_ctwa_ad(p_metadata jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select private.whatsapp_metadata_ctwa_confirmation_method(
    coalesce(p_metadata, '{}'::jsonb)
  ) is not null;
$$;

revoke all on function private.whatsapp_metadata_is_ctwa_ad(jsonb)
from public, anon, authenticated, service_role;

create or replace function public.whatsapp_webhook_has_lead_creation_context(p_metadata jsonb)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with managed_context as (
    select
      private.whatsapp_metadata_ctwa_confirmation_method(
        coalesce(p_metadata, '{}'::jsonb)
      ) as confirmation_method,
      btrim(coalesce(p_metadata->>'ctwa_confirmation_method', '')) as declared_confirmation_method,
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
  select coalesce(case
    -- v1 remains valid during a rolling deployment and does not require the
    -- newly introduced declared method.
    when managed_context.contract_version = 'ctwa_ad_v1'
      then managed_context.confirmation_method = 'entry_point_ctwa_ad'
        and managed_context.declared_confirmation_method in ('', 'entry_point_ctwa_ad')
    when managed_context.contract_version = 'ctwa_ad_v2'
      then managed_context.confirmation_method in (
        'entry_point_ctwa_ad',
        'evolution_ctwa_clid_v1'
      )
      and managed_context.declared_confirmation_method = managed_context.confirmation_method
    when managed_context.contract_version <> ''
      then false
    -- Unversioned rolling callers still need a provider proof. A queue keyword,
    -- source/ad id, URL or message text never authorizes lead creation alone.
    else managed_context.confirmation_method is not null
  end, false) and case
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
'Accepts rolling ctwa_ad_v1 entry-point proof and ctwa_ad_v2 entry-point or closed Evolution CTWA click proof; a managed queue additionally requires its active session-bound canonical rule.';

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
  v_contract_version text;
  v_confirmation_method text;
  v_declared_confirmation_method text;
  v_contract_valid boolean := false;
begin
  v_trusted_writer := v_actor_role = 'service_role'
    or (
      v_actor_role = ''
      and session_user not in ('anon', 'authenticated', 'authenticator')
    );
  v_new_automatic_marker := btrim(coalesce(new.metadata->>'whatsapp_lead_creation_contract', '')) <> ''
    or btrim(coalesce(new.metadata->>'ctwa_confirmation_method', '')) <> ''
    or lower(btrim(coalesce(new.metadata->>'managed_whatsapp_message_distribution', 'false'))) in ('true', '1', 'yes')
    or lower(btrim(coalesce(new.metadata->>'ctwa_ad_confirmed', 'false'))) in ('true', '1', 'yes')
    or btrim(coalesce(new.metadata->>'whatsapp_initial_provider_event_id', '')) <> ''
    or btrim(coalesce(new.metadata->>'managed_whatsapp_initial_provider_event_id', '')) <> '';
  if tg_op = 'UPDATE' then
    v_old_automatic_marker := btrim(coalesce(old.metadata->>'whatsapp_lead_creation_contract', '')) <> ''
      or btrim(coalesce(old.metadata->>'ctwa_confirmation_method', '')) <> ''
      or lower(btrim(coalesce(old.metadata->>'managed_whatsapp_message_distribution', 'false'))) in ('true', '1', 'yes')
      or lower(btrim(coalesce(old.metadata->>'ctwa_ad_confirmed', 'false'))) in ('true', '1', 'yes')
      or btrim(coalesce(old.metadata->>'whatsapp_initial_provider_event_id', '')) <> ''
      or btrim(coalesce(old.metadata->>'managed_whatsapp_initial_provider_event_id', '')) <> '';
    v_protected_metadata_changed := jsonb_build_object(
      'contract', old.metadata->'whatsapp_lead_creation_contract',
      'confirmation_method', old.metadata->'ctwa_confirmation_method',
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
      'confirmation_method', new.metadata->'ctwa_confirmation_method',
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

  v_contract_version := btrim(coalesce(new.metadata->>'whatsapp_lead_creation_contract', ''));
  if v_contract_version <> '' then
    v_confirmation_method := private.whatsapp_metadata_ctwa_confirmation_method(
      coalesce(new.metadata, '{}'::jsonb)
    );
    v_declared_confirmation_method := btrim(coalesce(new.metadata->>'ctwa_confirmation_method', ''));

    if v_contract_version = 'ctwa_ad_v1' then
      v_contract_valid := v_confirmation_method = 'entry_point_ctwa_ad'
        and v_declared_confirmation_method in ('', 'entry_point_ctwa_ad');
    elsif v_contract_version = 'ctwa_ad_v2' then
      v_contract_valid := v_confirmation_method in (
        'entry_point_ctwa_ad',
        'evolution_ctwa_clid_v1'
      ) and v_declared_confirmation_method = v_confirmation_method;
    end if;

    if not coalesce(v_contract_valid, false) then
      raise exception using
        errcode = '23514',
        message = 'managed_whatsapp_ctwa_ad_required';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function private.validate_managed_whatsapp_ctwa_ad()
from public, anon, authenticated, service_role;

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
  v_confirmation_method text;
  v_entry_point_conversion_source text;
  v_ctwa_clid text;
  v_show_ad_attribution jsonb;
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

  if not found or jsonb_typeof(v_source) <> 'object' then
    return false;
  end if;

  v_confirmation_method := private.whatsapp_metadata_ctwa_confirmation_method(
    jsonb_build_object('whatsapp_attribution', v_source)
  );
  if v_confirmation_method is null then
    return false;
  end if;

  v_entry_point_conversion_source := coalesce(
    nullif(btrim(v_source->>'entry_point_conversion_source'), ''),
    nullif(btrim(v_source->'source_referral'->>'entry_point_conversion_source'), '')
  );
  v_ctwa_clid := coalesce(
    nullif(btrim(v_source->>'ctwa_clid'), ''),
    nullif(btrim(v_source->'source_referral'->>'ctwa_clid'), '')
  );
  v_show_ad_attribution := coalesce(
    v_source->'show_ad_attribution',
    v_source->'source_referral'->'show_ad_attribution'
  );

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
    'ctwa_confirmation_method', v_confirmation_method,
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
    'entry_point_conversion_source', v_entry_point_conversion_source,
    'entry_point_conversion_app', nullif(btrim(v_source->>'entry_point_conversion_app'), ''),
    'ctwa_clid', v_ctwa_clid,
    'show_ad_attribution', v_show_ad_attribution,
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
'Copies provider-derived CTWA v1/v2 attribution from the trusted managed inbound log without manufacturing a missing entry-point signal.';

-- CREATE OR REPLACE preserves the existing trigger bindings and avoids taking
-- extra DDL locks on hot leads and message tables during this rollout.
commit;
