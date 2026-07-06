create or replace function public.find_lead_by_normalized_phone(
  p_organization_id uuid,
  p_phone text
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
  metadata jsonb
)
language sql
stable
set search_path = public, pg_temp
as $$
  select
    l.id,
    l.name,
    l.assigned_user_id,
    l.whatsapp_avatar_url,
    l.property_code,
    l.property_id,
    l.interest_property_id,
    l.source_detail,
    l.metadata
  from public.leads l
  where l.organization_id = p_organization_id
    and normalize_phone(p_phone) <> ''
    and (
      (l.phone is not null and normalize_phone(l.phone) = normalize_phone(p_phone))
      or (l.whatsapp is not null and normalize_phone(l.whatsapp) = normalize_phone(p_phone))
    )
  order by
    case when l.deal_status = 'open' then 0 else 1 end,
    l.last_contact_at desc nulls last,
    l.created_at desc
  limit 1;
$$;

revoke all on function public.find_lead_by_normalized_phone(uuid, text) from public;
revoke all on function public.find_lead_by_normalized_phone(uuid, text) from anon;
revoke all on function public.find_lead_by_normalized_phone(uuid, text) from authenticated;
grant execute on function public.find_lead_by_normalized_phone(uuid, text) to service_role;
