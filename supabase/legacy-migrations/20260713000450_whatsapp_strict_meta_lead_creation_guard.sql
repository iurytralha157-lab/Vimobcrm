-- Fail closed when the legacy Edge Function asks the database to create a
-- WhatsApp lead. Existing leads are resolved/updated before this guard runs,
-- so this only changes automatic creation for previously unknown contacts.
--
-- Provider-generated referral objects may contain URLs, click ids or generic
-- source ids that are not proof of a Meta ad. Require the provider's explicit
-- `source_type = ad` plus Meta's numeric ad id shape. The backend and the
-- current Edge source additionally verify that the ad is imported in the same
-- organization before calling the RPC.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create or replace function public.whatsapp_webhook_has_lead_creation_context(
  p_metadata jsonb
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    lower(btrim(
      p_metadata #>> '{whatsapp_attribution,source_referral,explicit_source_type}'
    )) = 'ad'
    and coalesce(
      nullif(btrim(p_metadata #>> '{whatsapp_attribution,ad_id}'), ''),
      nullif(btrim(p_metadata #>> '{whatsapp_attribution,source_id}'), ''),
      nullif(btrim(p_metadata #>> '{whatsapp_attribution,source_referral,source_id}'), '')
    ) ~ '^[0-9]{5,40}$',
    false
  );
$$;

revoke all on function public.whatsapp_webhook_has_lead_creation_context(jsonb)
  from public, anon, authenticated;
grant execute on function public.whatsapp_webhook_has_lead_creation_context(jsonb)
  to service_role;

comment on function public.whatsapp_webhook_has_lead_creation_context(jsonb) is
  'Allows automatic WhatsApp lead creation only for an explicit Meta ad referral with a numeric ad id; existing leads are unaffected.';

commit;
