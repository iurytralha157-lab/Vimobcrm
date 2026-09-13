begin;

select plan(19);

select ok(
  not has_table_privilege('anon', 'public.property_sequences', 'select,insert,update,delete'),
  'anonymous users have no access to property code sequences'
);

select ok(
  not has_table_privilege('authenticated', 'public.property_sequences', 'select,insert,update,delete'),
  'authenticated clients cannot manipulate property code sequences directly'
);

select ok(
  has_table_privilege('service_role', 'public.property_sequences', 'select'),
  'trusted workers can read property code sequences'
);

select ok(
  has_table_privilege('service_role', 'public.property_sequences', 'insert,update,delete'),
  'trusted workers can allocate property codes'
);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.property_sequences'::regclass),
  'property code sequences keep RLS enabled as defense in depth'
);

select is(
  (
    select count(*)::integer
    from pg_policies
    where schemaname = 'public'
      and tablename = 'property_sequences'
  ),
  0,
  'property code sequences expose no browser-facing row policies'
);

select ok(
  to_regclass('public.idx_properties_catalog_org_created_id') is not null,
  'property catalog has an organization and recency index'
);

select ok(
  to_regclass('public.idx_properties_catalog_org_status_created') is not null,
  'property catalog status filter has a matching index'
);

select ok(
  to_regclass('public.idx_properties_catalog_org_finalidade_created') is not null,
  'property catalog canonical modality has a matching index'
);

select ok(
  to_regclass('public.idx_properties_catalog_org_legacy_deal_created') is not null,
  'property catalog legacy modality fallback has a matching index'
);

select ok(
  to_regclass('public.idx_properties_search_document_trgm') is not null,
  'property contains-search has one matching trigram document index'
);

select ok(
  (
    select position('code' in index_definition) > 0
       and position('title' in index_definition) > 0
       and position('endereco' in index_definition) > 0
       and position('bairro' in index_definition) > 0
       and position('cidade' in index_definition) > 0
       and position('uf' in index_definition) > 0
       and position('tipo' in index_definition) > 0
       and position('tipo_de_imovel' in index_definition) > 0
       and position('finalidade' in index_definition) > 0
       and position('finalidade_uso' in index_definition) > 0
       and position('external_id' in index_definition) = 0
    from (
      select pg_get_indexdef('public.idx_properties_search_document_trgm'::regclass) as index_definition
    ) definitions
  ),
  'the public property search document excludes internal identifiers'
);

select ok(
  to_regclass('public.idx_properties_search_external_id_trgm') is not null,
  'manager-only external identifier search has its own trigram index'
);

select ok(
  to_regclass('public.idx_properties_filter_city_trgm') is not null,
  'property city contains-filter has a matching trigram index'
);

select ok(
  to_regclass('public.idx_properties_filter_neighborhood_trgm') is not null,
  'property neighborhood contains-filter has a matching trigram index'
);

select ok(
  to_regclass('public.idx_property_condominiums_search_name_trgm') is not null,
  'condominium contains-search has a trigram index'
);

select ok(
  to_regclass('public.idx_property_owners_catalog_org_name_created') is not null,
  'property owner catalog has an organization and name index'
);

select ok(
  to_regclass('public.idx_property_owners_search_name_trgm') is not null,
  'property owner name contains-search has a trigram index'
);

select ok(
  to_regclass('public.idx_property_owners_search_contacts_trgm') is not null,
  'authorized property owner contact search has a trigram index'
);

select * from finish();
rollback;
