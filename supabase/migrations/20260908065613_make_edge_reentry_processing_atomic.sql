-- Close the crash window between accepting an Evolution provider event and
-- linking its durable CRM projections. A single RPC now owns registration,
-- conversation linkage and lead attribution. PostgreSQL commits all effects
-- together or rolls all of them back.
--
-- A completed provider retry only reads the result stored on the immutable
-- lead_entry_event. Events created by the previous two-step caller can be
-- recovered once: monotonic conversation linkage is enforced, while a newer
-- lead_meta projection is never overwritten.

create or replace function public.process_whatsapp_lead_reentry_from_backend(
  p_organization_id uuid,
  p_lead_id uuid,
  p_provider_event_id text,
  p_conversation_id uuid,
  p_source text default 'whatsapp',
  p_entry_subtype text default 'whatsapp_reentry',
  p_metadata jsonb default '{}'::jsonb,
  p_lead_meta jsonb default null,
  p_occurred_at timestamptz default clock_timestamp()
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_registration jsonb;
  v_event_id uuid;
  v_event public.lead_entry_events%rowtype;
  v_inserted boolean;
  v_existing_result jsonb;
  v_conversation_lead_id uuid;
  v_existing_meta public.lead_meta%rowtype;
  v_lead_meta_applied boolean := false;
  v_lead_meta_skipped_newer boolean := false;
  v_result jsonb;
begin
  p_occurred_at := coalesce(p_occurred_at, clock_timestamp());
  p_metadata := coalesce(p_metadata, '{}'::jsonb);

  if p_organization_id is null
     or p_lead_id is null
     or nullif(btrim(coalesce(p_provider_event_id, '')), '') is null
     or length(btrim(p_provider_event_id)) > 200 then
    raise exception using
      errcode = '22023',
      message = 'invalid_whatsapp_lead_reentry_request';
  end if;

  -- The provider identity and immutable event are the only facts needed to
  -- acknowledge a completed retry. In particular, do not lock or validate the
  -- lead/conversation first: either may have been legitimately changed or
  -- removed after the original transaction committed.
  select event.*
  into v_event
  from public.lead_entry_events as event
  where event.organization_id = p_organization_id
    and event.provider = 'evolution_whatsapp'
    and event.provider_event_id = btrim(p_provider_event_id)
    and event.is_countable = true;

  if found then
    if v_event.lead_id <> p_lead_id then
      raise exception using
        errcode = '23505',
        message = 'lead_reentry_idempotency_conflict';
    end if;

    v_existing_result := v_event.metadata
      #> '{edge_reentry_processing,result}';

    if v_existing_result is not null then
      return v_existing_result || jsonb_build_object(
        'inserted', false,
        'replayed', true
      );
    end if;
  end if;

  if p_conversation_id is null
     or jsonb_typeof(p_metadata) <> 'object'
     or (
       p_lead_meta is not null
       and jsonb_typeof(p_lead_meta) <> 'object'
     ) then
    raise exception using
      errcode = '22023',
      message = 'invalid_whatsapp_lead_reentry_request';
  end if;

  if p_lead_meta is not null and exists (
    select 1
    from jsonb_object_keys(p_lead_meta) as supplied(key)
    where supplied.key <> all (array[
      'campaign_id',
      'campaign_name',
      'ad_id',
      'ad_name',
      'adset_id',
      'adset_name',
      'platform',
      'source_type',
      'utm_source',
      'utm_medium',
      'utm_campaign',
      'utm_content',
      'utm_term',
      'raw_payload'
    ]::text[])
  ) then
    raise exception using
      errcode = '22023',
      message = 'invalid_whatsapp_lead_meta_projection';
  end if;

  -- This row lock makes a concurrent provider retry wait for the complete
  -- transaction, never for an intermediate registration state.
  perform 1
  from public.leads as lead
  where lead.id = p_lead_id
    and lead.organization_id = p_organization_id
  for no key update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'whatsapp_lead_reentry_target_not_found';
  end if;

  v_registration := public.register_lead_reentry_from_backend(
    p_organization_id,
    p_lead_id,
    'evolution_whatsapp',
    btrim(p_provider_event_id),
    p_source,
    p_entry_subtype,
    null,
    null,
    p_metadata,
    p_occurred_at
  );

  if not coalesce((v_registration->>'success')::boolean, false)
     or nullif(v_registration->>'event_id', '') is null then
    raise exception using
      errcode = 'P0001',
      message = 'whatsapp_lead_reentry_registration_incomplete';
  end if;

  v_event_id := (v_registration->>'event_id')::uuid;
  v_inserted := coalesce((v_registration->>'inserted')::boolean, false);

  select event.*
  into v_event
  from public.lead_entry_events as event
  where event.id = v_event_id
    and event.organization_id = p_organization_id
    and event.lead_id = p_lead_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'whatsapp_lead_reentry_event_not_found';
  end if;

  v_existing_result := v_event.metadata
    #> '{edge_reentry_processing,result}';

  if not v_inserted and v_existing_result is not null then
    -- No writes on a completed replay: the lead, conversation and attribution
    -- may all have legitimately changed after the original delivery.
    return v_existing_result || jsonb_build_object(
      'inserted', false,
      'replayed', true
    );
  end if;

  select conversation.lead_id
  into v_conversation_lead_id
  from public.whatsapp_conversations as conversation
  where conversation.id = p_conversation_id
    and conversation.organization_id = p_organization_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'whatsapp_lead_reentry_conversation_not_found';
  end if;

  if v_conversation_lead_id is not null
     and v_conversation_lead_id <> p_lead_id then
    raise exception using
      errcode = '23514',
      message = 'whatsapp_lead_reentry_conversation_conflict';
  end if;

  update public.whatsapp_conversations as conversation
  set lead_id = p_lead_id,
      updated_at = clock_timestamp()
  where conversation.id = p_conversation_id
    and conversation.organization_id = p_organization_id
    and (
      conversation.lead_id is null
      or conversation.lead_id = p_lead_id
    );

  if not found then
    raise exception using
      errcode = '40001',
      message = 'whatsapp_lead_reentry_conversation_changed';
  end if;

  if p_lead_meta is not null and p_lead_meta <> '{}'::jsonb then
    select meta.*
    into v_existing_meta
    from public.lead_meta as meta
    where meta.lead_id = p_lead_id
    for update;

    if found
       and not v_inserted
       and v_existing_meta.updated_at > v_event.created_at then
      -- Recovery of a legacy half-processed event must not replace attribution
      -- written after that event was accepted.
      v_lead_meta_skipped_newer := true;
    elsif found then
      update public.lead_meta as meta
      set campaign_id = case
            when p_lead_meta ? 'campaign_id' then p_lead_meta->>'campaign_id'
            else meta.campaign_id
          end,
          campaign_name = case
            when p_lead_meta ? 'campaign_name' then p_lead_meta->>'campaign_name'
            else meta.campaign_name
          end,
          ad_id = case
            when p_lead_meta ? 'ad_id' then p_lead_meta->>'ad_id'
            else meta.ad_id
          end,
          ad_name = case
            when p_lead_meta ? 'ad_name' then p_lead_meta->>'ad_name'
            else meta.ad_name
          end,
          adset_id = case
            when p_lead_meta ? 'adset_id' then p_lead_meta->>'adset_id'
            else meta.adset_id
          end,
          adset_name = case
            when p_lead_meta ? 'adset_name' then p_lead_meta->>'adset_name'
            else meta.adset_name
          end,
          platform = case
            when p_lead_meta ? 'platform' then p_lead_meta->>'platform'
            else meta.platform
          end,
          source_type = case
            when p_lead_meta ? 'source_type' then p_lead_meta->>'source_type'
            else meta.source_type
          end,
          utm_source = case
            when p_lead_meta ? 'utm_source' then p_lead_meta->>'utm_source'
            else meta.utm_source
          end,
          utm_medium = case
            when p_lead_meta ? 'utm_medium' then p_lead_meta->>'utm_medium'
            else meta.utm_medium
          end,
          utm_campaign = case
            when p_lead_meta ? 'utm_campaign' then p_lead_meta->>'utm_campaign'
            else meta.utm_campaign
          end,
          utm_content = case
            when p_lead_meta ? 'utm_content' then p_lead_meta->>'utm_content'
            else meta.utm_content
          end,
          utm_term = case
            when p_lead_meta ? 'utm_term' then p_lead_meta->>'utm_term'
            else meta.utm_term
          end,
          raw_payload = case
            when p_lead_meta ? 'raw_payload' then p_lead_meta->'raw_payload'
            else meta.raw_payload
          end,
          updated_at = clock_timestamp()
      where meta.lead_id = p_lead_id;

      v_lead_meta_applied := true;
    else
      insert into public.lead_meta (
        lead_id,
        organization_id,
        campaign_id,
        campaign_name,
        ad_id,
        ad_name,
        adset_id,
        adset_name,
        platform,
        source_type,
        utm_source,
        utm_medium,
        utm_campaign,
        utm_content,
        utm_term,
        raw_payload,
        updated_at
      )
      values (
        p_lead_id,
        p_organization_id,
        p_lead_meta->>'campaign_id',
        p_lead_meta->>'campaign_name',
        p_lead_meta->>'ad_id',
        p_lead_meta->>'ad_name',
        p_lead_meta->>'adset_id',
        p_lead_meta->>'adset_name',
        p_lead_meta->>'platform',
        p_lead_meta->>'source_type',
        p_lead_meta->>'utm_source',
        p_lead_meta->>'utm_medium',
        p_lead_meta->>'utm_campaign',
        p_lead_meta->>'utm_content',
        p_lead_meta->>'utm_term',
        p_lead_meta->'raw_payload',
        clock_timestamp()
      );

      v_lead_meta_applied := true;
    end if;
  end if;

  v_result := jsonb_build_object(
    'success', true,
    'lead_id', p_lead_id,
    'event_id', v_event_id,
    'inserted', v_inserted,
    'replayed', not v_inserted,
    'recovered_legacy_event', not v_inserted,
    'conversation_id', p_conversation_id,
    'conversation_linked', true,
    'lead_meta_applied', v_lead_meta_applied,
    'lead_meta_skipped_newer', v_lead_meta_skipped_newer
  );

  update public.lead_entry_events as event
  set metadata = coalesce(event.metadata, '{}'::jsonb)
    || jsonb_build_object(
      'edge_reentry_processing',
      jsonb_build_object(
        'version', 1,
        'status', 'completed',
        'completed_at', clock_timestamp(),
        'result', v_result
      )
    )
  where event.id = v_event_id
    and event.organization_id = p_organization_id
    and event.lead_id = p_lead_id;

  if not found then
    raise exception using
      errcode = '40001',
      message = 'whatsapp_lead_reentry_completion_not_recorded';
  end if;

  return v_result;
end;
$$;

comment on function public.process_whatsapp_lead_reentry_from_backend(
  uuid,
  uuid,
  text,
  uuid,
  text,
  text,
  jsonb,
  jsonb,
  timestamptz
) is
  'Backend-only atomic Evolution reentry processor. Registration, conversation linkage and attribution commit together; completed retries are read-only.';

revoke all on function public.process_whatsapp_lead_reentry_from_backend(
  uuid,
  uuid,
  text,
  uuid,
  text,
  text,
  jsonb,
  jsonb,
  timestamptz
) from public, anon, authenticated, service_role;

grant execute on function public.process_whatsapp_lead_reentry_from_backend(
  uuid,
  uuid,
  text,
  uuid,
  text,
  text,
  jsonb,
  jsonb,
  timestamptz
) to service_role;
