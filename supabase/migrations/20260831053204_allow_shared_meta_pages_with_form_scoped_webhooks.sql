-- Allow an agency-owned Meta Page to be connected to multiple CRM
-- organizations without making signed provider webhooks tenant-ambiguous.
--
-- Lead Ads is routed by its globally unique Form id. Messenger/Instagram does
-- not carry a Form id, so the Go webhook handler counts matching connected
-- integrations and fails closed unless there is exactly one eligible tenant.

do $validate_meta_form_route_ownership$
declare
  duplicate_form_count bigint := 0;
begin
  select count(*)
  into duplicate_form_count
  from (
    select btrim(form_id)
    from public.meta_form_configs
    where coalesce(is_active, true) = true
      and nullif(btrim(form_id), '') is not null
    group by btrim(form_id)
    having count(*) > 1
  ) as duplicate_form;

  if duplicate_form_count > 0 then
    raise exception using
      errcode = '23505',
      message = 'meta_active_form_has_multiple_tenant_routes',
      detail = format(
        '%s active Meta Form id(s) have more than one CRM route.',
        duplicate_form_count
      ),
      hint = 'Keep the Page connections and deactivate only the conflicting Form assignment before applying this migration.';
  end if;
end
$validate_meta_form_route_ownership$;

drop index if exists public.uq_meta_integrations_connected_page_owner;
drop index if exists public.uq_meta_integrations_connected_instagram_owner;

create unique index if not exists uq_meta_form_configs_active_provider_route
  on public.meta_form_configs (btrim(form_id))
  where coalesce(is_active, true) = true
    and nullif(btrim(form_id), '') is not null;

create index if not exists idx_meta_integrations_connected_page_route
  on public.meta_integrations (btrim(page_id))
  where coalesce(is_connected, false) = true
    and nullif(btrim(page_id), '') is not null;

create index if not exists idx_meta_integrations_connected_instagram_route
  on public.meta_integrations (btrim(instagram_business_account_id))
  where coalesce(is_connected, false) = true
    and nullif(btrim(instagram_business_account_id), '') is not null;

comment on index public.uq_meta_form_configs_active_provider_route is
  'One active CRM tenant route per Meta Lead Ads Form. Page connections may be shared across organizations.';

comment on index public.idx_meta_integrations_connected_page_route is
  'Lookup support for shared Page connections; messaging delivery remains fail-closed on multiple matches.';

comment on index public.idx_meta_integrations_connected_instagram_route is
  'Lookup support for shared Instagram connections; messaging delivery remains fail-closed on multiple matches.';
