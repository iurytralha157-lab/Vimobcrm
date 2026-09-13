begin;

-- Property codes are allocated only by trusted backend/worker connections.
-- Keeping this table on the browser-facing Data API lets any active member
-- corrupt the next code even when the BFF correctly requires property_manage.
drop policy if exists "vimob_canonical_5cdf6273baeaf1575eb7ebc5" on public.property_sequences;
drop policy if exists "vimob_canonical_67ef1c2de27932a8e3997d98" on public.property_sequences;
drop policy if exists "vimob_canonical_95217ae99504d13c12554452" on public.property_sequences;
drop policy if exists "vimob_canonical_def1588e6377f610ab08c180" on public.property_sequences;
drop policy if exists vimob_active_membership_guard on public.property_sequences;

revoke all on table public.property_sequences from public, anon, authenticated;
grant select, insert, update, delete on table public.property_sequences to service_role;

comment on table public.property_sequences is
  'Backend-only counters used to allocate organization-scoped property codes.';

-- Main catalog order and its most common equality filters.
create index if not exists idx_properties_catalog_org_created_id
  on public.properties (organization_id, created_at desc, id desc);

create index if not exists idx_properties_catalog_org_status_created
  on public.properties (
    organization_id,
    lower(btrim(coalesce(status, ''))),
    created_at desc,
    id desc
  );

create index if not exists idx_properties_catalog_org_finalidade_created
  on public.properties (
    organization_id,
    lower(btrim(coalesce(finalidade, ''))),
    created_at desc,
    id desc
  );

create index if not exists idx_properties_catalog_org_legacy_deal_created
  on public.properties (
    organization_id,
    lower(btrim(coalesce(tipo_de_negocio, ''))),
    created_at desc,
    id desc
  );

-- The browser-visible catalog searches ten non-sensitive property columns in
-- one OR expression. Internal external_id lookup is a separate manager-only
-- branch so users with property_view cannot infer integration identifiers.
-- Separate indexes cannot produce a complete BitmapOr while any branch stays
-- unindexed, so keep one immutable search document that exactly matches the
-- API expression. Drop the superseded indexes in case this migration was
-- exercised manually on a development database before being finalized.
drop index if exists public.idx_properties_search_code_trgm;
drop index if exists public.idx_properties_search_title_trgm;
drop index if exists public.idx_properties_search_address_trgm;
drop index if exists public.idx_properties_search_city_trgm;
drop index if exists public.idx_properties_search_neighborhood_trgm;
drop index if exists public.idx_properties_search_document_trgm;

create index if not exists idx_properties_search_document_trgm
  on public.properties using gin (
    (
      translate(
        lower(
          coalesce(code, '') || ' ' ||
          coalesce(title, '') || ' ' ||
          coalesce(endereco, '') || ' ' ||
          coalesce(bairro, '') || ' ' ||
          coalesce(cidade, '') || ' ' ||
          coalesce(uf, '') || ' ' ||
          coalesce(tipo, '') || ' ' ||
          coalesce(tipo_de_imovel, '') || ' ' ||
          coalesce(finalidade, '') || ' ' ||
          coalesce(finalidade_uso, '')
        ),
        'áàâãäéèêëíìîïóòôõöúùûüç',
        'aaaaaeeeeiiiiooooouuuuc'
      )
    ) extensions.gin_trgm_ops
  );

create index if not exists idx_properties_search_external_id_trgm
  on public.properties using gin (
    (translate(lower(coalesce(external_id, '')), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc')) extensions.gin_trgm_ops
  );

-- City and neighborhood are also independent contains-filters, so their
-- expressions need dedicated indexes in addition to the combined search.
create index if not exists idx_properties_filter_city_trgm
  on public.properties using gin (
    (translate(lower(coalesce(cidade, '')), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc')) extensions.gin_trgm_ops
  );

create index if not exists idx_properties_filter_neighborhood_trgm
  on public.properties using gin (
    (translate(lower(coalesce(bairro, '')), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc')) extensions.gin_trgm_ops
  );

create index if not exists idx_property_condominiums_search_name_trgm
  on public.property_condominiums using gin (
    (translate(lower(coalesce(name, '')), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc')) extensions.gin_trgm_ops
  );

create index if not exists idx_property_owners_catalog_org_name_created
  on public.property_owners (organization_id, lower(name), created_at desc, id desc)
  where coalesce(is_active, true) = true;

create index if not exists idx_property_owners_search_name_trgm
  on public.property_owners using gin (
    (lower(coalesce(name, ''))) extensions.gin_trgm_ops
  )
  where coalesce(is_active, true) = true;

create index if not exists idx_property_owners_search_contacts_trgm
  on public.property_owners using gin (
    (
      lower(
        coalesce(phone_residential, '') || ' ' ||
        coalesce(phone_commercial, '') || ' ' ||
        coalesce(cellphone, '') || ' ' ||
        coalesce(email, '') || ' ' ||
        coalesce(media_source, '')
      )
    ) extensions.gin_trgm_ops
  )
  where coalesce(is_active, true) = true;

commit;
