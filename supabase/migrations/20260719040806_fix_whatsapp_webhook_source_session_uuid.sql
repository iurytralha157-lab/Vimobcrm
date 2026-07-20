begin;

do $contract$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'leads'
      and column_name = 'source_session_id'
      and data_type = 'uuid'
  ) then
    raise exception using
      errcode = '55000',
      message = 'upsert_whatsapp_webhook_lead requires public.leads.source_session_id to be uuid';
  end if;
end
$contract$;

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
returns table (
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
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_now timestamptz := coalesce(p_last_contact_at, now());
  v_normalized_phone text := public.normalize_phone(p_phone);
  v_lead public.leads%rowtype;
  v_lock_key text;
begin
  if p_organization_id is null then
    raise exception 'p_organization_id is required' using errcode = '22023';
  end if;

  if nullif(btrim(coalesce(p_phone, '')), '') is null then
    raise exception 'p_phone is required' using errcode = '22023';
  end if;

  v_lock_key := p_organization_id::text || ':' || coalesce(v_normalized_phone, btrim(p_phone));
  perform pg_advisory_xact_lock(hashtextextended(v_lock_key, 0));

  select l.*
    into v_lead
    from public.leads l
   where l.organization_id = p_organization_id
     and public.normalize_phone(l.phone) = v_normalized_phone
     and l.phone is not null
     and btrim(l.phone) <> ''
   order by coalesce(l.updated_at, l.created_at) desc, l.created_at desc, l.id desc
   limit 1
   for update;

  if found then
    update public.leads l
       set whatsapp_avatar_url = case
             when p_whatsapp_avatar_url is not null and nullif(l.whatsapp_avatar_url, '') is null then p_whatsapp_avatar_url
             else l.whatsapp_avatar_url
           end,
           whatsapp_avatar_synced_at = case
             when p_whatsapp_avatar_url is not null and nullif(l.whatsapp_avatar_url, '') is null then coalesce(p_whatsapp_avatar_synced_at, v_now)
             else l.whatsapp_avatar_synced_at
           end,
           property_code = coalesce(nullif(l.property_code, ''), p_property_code),
           property_id = coalesce(l.property_id, p_property_id),
           interest_property_id = coalesce(l.interest_property_id, p_interest_property_id),
           source_detail = coalesce(nullif(l.source_detail, ''), p_source_detail),
           source_session_id = coalesce(l.source_session_id, p_source_session_id),
           first_touch_at = coalesce(l.first_touch_at, p_first_touch_at),
           first_touch_channel = coalesce(nullif(l.first_touch_channel, ''), p_first_touch_channel),
           last_contact_at = v_now,
           metadata = coalesce(l.metadata, '{}'::jsonb) || coalesce(p_metadata, '{}'::jsonb),
           updated_at = v_now
     where l.id = v_lead.id
     returning l.* into v_lead;

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
    select l.*
      into v_lead
      from public.leads l
     where l.organization_id = p_organization_id
       and public.normalize_phone(l.phone) = v_normalized_phone
       and l.phone is not null
       and btrim(l.phone) <> ''
     order by coalesce(l.updated_at, l.created_at) desc, l.created_at desc, l.id desc
     limit 1;

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

commit;
