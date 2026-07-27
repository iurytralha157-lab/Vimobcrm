-- Keep attribution complete while application instances are rolling between
-- versions and as a final database-side safety net for future intake paths.

create or replace function public.hydrate_lead_entry_attribution()
returns trigger
language plpgsql
set search_path to 'pg_catalog', 'public', 'private', 'extensions', 'pg_temp'
as $$
declare
  v_created_time text;
  v_external_event_id text;
begin
  if new.provider is null
     or btrim(new.provider) = ''
     or (
       new.provider = 'crm'
       and lower(coalesce(new.source, '')) in ('meta', 'whatsapp', 'site', 'webhook')
     ) then
    new.provider := case
      when lower(coalesce(new.source, '')) = 'meta' then 'meta'
      when lower(coalesce(new.source, '')) = 'whatsapp' then 'whatsapp'
      when lower(coalesce(new.source, '')) = 'site' then 'site'
      when lower(coalesce(new.source, '')) = 'webhook' then 'generic_webhook'
      when nullif(lower(btrim(coalesce(new.source, ''))), '') is not null
        then lower(btrim(new.source))
      else 'crm'
    end;
  end if;

  v_external_event_id := case
    when new.provider = 'meta'
      then nullif(new.metadata->>'leadgen_id', '')
    when new.provider = 'whatsapp'
      then nullif(new.metadata->>'message_id', '')
    when new.provider = 'site'
      then nullif(new.metadata->>'submission_id', '')
    when new.provider = 'generic_webhook'
      then coalesce(
        nullif(new.metadata->>'provider_event_id', ''),
        nullif(new.payload->>'event_id', ''),
        nullif(new.payload->>'eventId', ''),
        nullif(new.payload->>'submission_id', ''),
        nullif(new.payload->>'submissionId', ''),
        nullif(new.payload->>'leadgen_id', ''),
        nullif(new.payload->>'external_id', '')
      )
    else null
  end;
  new.provider_event_id := coalesce(
    nullif(new.provider_event_id, ''),
    v_external_event_id
  );

  v_created_time := nullif(new.metadata->>'created_time', '');
  if new.provider = 'meta' and v_created_time ~ '^[0-9]{9,10}$' then
    new.occurred_at := to_timestamp(v_created_time::bigint);
  elsif new.provider = 'meta' and v_created_time ~ '^[0-9]{13}$' then
    new.occurred_at := to_timestamp(v_created_time::numeric / 1000);
  else
    new.occurred_at := coalesce(new.occurred_at, new.created_at, now());
  end if;

  new.is_countable := coalesce(new.is_countable, true);
  new.source_detail := coalesce(
    nullif(new.source_detail, ''),
    nullif(new.metadata->>'source_detail', ''),
    nullif(new.metadata->>'webhook_name', '')
  );
  new.campaign_id := coalesce(
    nullif(new.campaign_id, ''),
    nullif(new.metadata->>'campaign_id', ''),
    nullif(new.payload->>'campaign_id', ''),
    nullif(new.payload->>'campaignId', '')
  );
  new.campaign_name := coalesce(
    nullif(new.campaign_name, ''),
    nullif(new.metadata->>'campaign_name', ''),
    nullif(new.payload->>'campaign_name', ''),
    nullif(new.payload->>'campaignName', '')
  );
  new.adset_id := coalesce(
    nullif(new.adset_id, ''),
    nullif(new.metadata->>'adset_id', ''),
    nullif(new.payload->>'adset_id', ''),
    nullif(new.payload->>'adsetId', '')
  );
  new.adset_name := coalesce(
    nullif(new.adset_name, ''),
    nullif(new.metadata->>'adset_name', ''),
    nullif(new.payload->>'adset_name', ''),
    nullif(new.payload->>'adsetName', '')
  );
  new.ad_id := coalesce(
    nullif(new.ad_id, ''),
    nullif(new.metadata->>'ad_id', ''),
    nullif(new.payload->>'ad_id', ''),
    nullif(new.payload->>'adId', '')
  );
  new.ad_name := coalesce(
    nullif(new.ad_name, ''),
    nullif(new.metadata->>'ad_name', ''),
    nullif(new.payload->>'ad_name', ''),
    nullif(new.payload->>'adName', '')
  );
  new.form_id := coalesce(
    nullif(new.form_id, ''),
    nullif(new.metadata->>'form_id', ''),
    nullif(new.payload->>'form_id', ''),
    nullif(new.payload->>'formId', '')
  );
  new.form_name := coalesce(
    nullif(new.form_name, ''),
    nullif(new.metadata->>'form_name', ''),
    nullif(new.payload->>'form_name', ''),
    nullif(new.payload->>'formName', '')
  );
  new.page_id := coalesce(
    nullif(new.page_id, ''),
    nullif(new.metadata->>'page_id', '')
  );
  new.page_name := coalesce(
    nullif(new.page_name, ''),
    nullif(new.metadata->>'page_name', '')
  );
  new.utm_content := coalesce(
    nullif(new.utm_content, ''),
    nullif(new.metadata->>'utm_content', ''),
    nullif(new.payload->>'utm_content', ''),
    nullif(new.payload->>'utmContent', '')
  );
  new.utm_term := coalesce(
    nullif(new.utm_term, ''),
    nullif(new.metadata->>'utm_term', ''),
    nullif(new.payload->>'utm_term', ''),
    nullif(new.payload->>'utmTerm', '')
  );

  return new;
end;
$$;

drop trigger if exists tr_hydrate_lead_entry_attribution
  on public.lead_entry_events;
create trigger tr_hydrate_lead_entry_attribution
before insert or update on public.lead_entry_events
for each row execute function public.hydrate_lead_entry_attribution();

revoke all on function public.hydrate_lead_entry_attribution()
  from public, anon, authenticated;
grant execute on function public.hydrate_lead_entry_attribution()
  to service_role;
