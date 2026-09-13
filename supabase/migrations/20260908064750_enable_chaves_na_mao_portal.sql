-- Chaves na Mao uses its own feed contract and must never be represented as a
-- Grupo OLX alias. Only the integration and listing tables are widened here:
-- no lead webhook or import-report contract is publicly available to support
-- rows for this provider in those domains.

alter table public.portal_integrations
  drop constraint if exists portal_integrations_portal_check;

alter table public.portal_integrations
  add constraint portal_integrations_portal_check
  check (portal = any (array['grupo_olx'::text, 'chaves_na_mao'::text]))
  not valid;

alter table public.portal_integrations
  validate constraint portal_integrations_portal_check;

alter table public.portal_listing_publications
  drop constraint if exists portal_listing_publications_portal_check;

alter table public.portal_listing_publications
  add constraint portal_listing_publications_portal_check
  check (portal = any (array['grupo_olx'::text, 'chaves_na_mao'::text]))
  not valid;

alter table public.portal_listing_publications
  validate constraint portal_listing_publications_portal_check;

comment on constraint portal_integrations_portal_check on public.portal_integrations is
  'Canonical portal identifiers supported by the backend. Chaves na Mao is an independent XML feed integration.';

comment on constraint portal_listing_publications_portal_check on public.portal_listing_publications is
  'Listing rows are isolated by their canonical portal identifier; Grupo OLX and Chaves na Mao do not share feed formats.';
