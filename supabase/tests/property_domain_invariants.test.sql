begin;

create extension if not exists pgtap with schema extensions;
select plan(49);

select is(
  private.canonical_property_deal_type('Venda locacao'),
  'venda_locacao',
  'database modality aliases match the API canonical vocabulary'
);

insert into public.organizations (id, name, is_active)
values ('a3100000-0000-4000-8000-000000000001', 'Property invariant test', true);

insert into public.property_cities (id, organization_id, name, uf)
values
  ('a3110000-0000-4000-8000-000000000001', 'a3100000-0000-4000-8000-000000000001', 'Cidade A', 'SP'),
  ('a3110000-0000-4000-8000-000000000002', 'a3100000-0000-4000-8000-000000000001', 'Cidade B', 'RJ');

insert into public.property_neighborhoods (id, organization_id, city_id, name)
values
  ('a3120000-0000-4000-8000-000000000001', 'a3100000-0000-4000-8000-000000000001', 'a3110000-0000-4000-8000-000000000001', 'Bairro A'),
  ('a3120000-0000-4000-8000-000000000002', 'a3100000-0000-4000-8000-000000000001', 'a3110000-0000-4000-8000-000000000002', 'Bairro B');

select throws_ok(
  $$
    insert into public.property_neighborhoods (
      organization_id, city_id, name
    ) values (
      'a3100000-0000-4000-8000-000000000001',
      null,
      'Bairro sem cidade'
    )
  $$,
  '23514',
  null,
  'an active neighborhood must identify its city'
);

insert into public.property_condominiums (
  id, organization_id, city_id, neighborhood_id, name
) values (
  'a3130000-0000-4000-8000-000000000001',
  'a3100000-0000-4000-8000-000000000001',
  'a3110000-0000-4000-8000-000000000001',
  'a3120000-0000-4000-8000-000000000001',
  'Residencial Central'
);

select lives_ok(
  $$
    insert into public.property_condominiums (
      id, organization_id, city_id, neighborhood_id, name
    ) values (
      'a3130000-0000-4000-8000-000000000002',
      'a3100000-0000-4000-8000-000000000001',
      'a3110000-0000-4000-8000-000000000002',
      'a3120000-0000-4000-8000-000000000002',
      'Residencial Central'
    )
  $$,
  'the same condominium name is allowed in a different locality'
);

select throws_ok(
  $$
    insert into public.property_condominiums (
      organization_id, city_id, neighborhood_id, name
    ) values (
      'a3100000-0000-4000-8000-000000000001',
      'a3110000-0000-4000-8000-000000000001',
      'a3120000-0000-4000-8000-000000000001',
      ' RESIDENCIAL CENTRAL '
    )
  $$,
  '23505',
  null,
  'an active condominium name is unique inside one locality'
);

select throws_ok(
  $$
    insert into public.property_condominiums (
      organization_id, city_id, neighborhood_id, name
    ) values (
      'a3100000-0000-4000-8000-000000000001',
      'a3110000-0000-4000-8000-000000000002',
      'a3120000-0000-4000-8000-000000000001',
      'Condominio inconsistente'
    )
  $$,
  '23514',
  null,
  'a condominium neighborhood must belong to its city'
);

insert into public.properties (
  id, organization_id, code, title, finalidade, tipo_de_negocio
) values (
  'a3140000-0000-4000-8000-000000000001',
  'a3100000-0000-4000-8000-000000000001',
  'INV-DEAL-1',
  'Imovel modalidade',
  'Residencial',
  'rent'
);

select is(
  (
    select finalidade || ':' || tipo_de_negocio || ':' || finalidade_uso
    from public.properties
    where id = 'a3140000-0000-4000-8000-000000000001'
  ),
  'locacao:locacao:Residencial',
  'legacy purpose is preserved while modality is canonicalized'
);

update public.properties
set finalidade = 'launch'
where id = 'a3140000-0000-4000-8000-000000000001';

select is(
  (
    select finalidade || ':' || tipo_de_negocio
    from public.properties
    where id = 'a3140000-0000-4000-8000-000000000001'
  ),
  'lancamento:lancamento',
  'changing either compatibility column synchronizes the canonical modality'
);

select throws_ok(
  $$
    update public.properties
    set tipo_de_negocio = 'modalidade-invalida'
    where id = 'a3140000-0000-4000-8000-000000000001'
  $$,
  '23514',
  null,
  'invalid deal types are rejected at the database boundary'
);

select throws_ok(
  $$
    insert into public.properties (
      organization_id, code, title, finalidade, tipo_de_negocio, origin_media
    ) values (
      'a3100000-0000-4000-8000-000000000001',
      'INV-OWNER-MEDIA-LIMIT',
      'Imovel com origem invalida',
      'venda',
      'venda',
      repeat('x', 81)
    )
  $$,
  '23514',
  null,
  'embedded owner media origin is limited to 80 characters'
);

insert into public.properties (
  id, organization_id, code, title, condominium_id
) values (
  'a3140000-0000-4000-8000-000000000002',
  'a3100000-0000-4000-8000-000000000001',
  'INV-LOC-1',
  'Imovel com localidade',
  'a3130000-0000-4000-8000-000000000001'
);

select is(
  (
    select city_id::text || ':' || neighborhood_id::text
    from public.properties
    where id = 'a3140000-0000-4000-8000-000000000002'
  ),
  'a3110000-0000-4000-8000-000000000001:a3120000-0000-4000-8000-000000000001',
  'a condominium selection fills the property city and neighborhood ids'
);

select is(
  (
    select cidade || ':' || uf || ':' || bairro
    from public.properties
    where id = 'a3140000-0000-4000-8000-000000000002'
  ),
  'Cidade A:SP:Bairro A',
  'normalized location ids project their display names'
);

select throws_ok(
  $$
    update public.properties
    set city_id = 'a3110000-0000-4000-8000-000000000002'
    where id = 'a3140000-0000-4000-8000-000000000002'
  $$,
  '23514',
  null,
  'a property cannot contradict its condominium location chain'
);

update public.property_neighborhoods
set name = 'Bairro A Atualizado',
    city_id = 'a3110000-0000-4000-8000-000000000002'
where id = 'a3120000-0000-4000-8000-000000000001';

select is(
  (
    select city_id::text || ':' || cidade || ':' || uf || ':' || bairro
    from public.properties
    where id = 'a3140000-0000-4000-8000-000000000002'
  ),
  'a3110000-0000-4000-8000-000000000002:Cidade B:RJ:Bairro A Atualizado',
  'neighborhood PATCH cascades the canonical property location projection'
);

select throws_ok(
  $$
    update public.property_condominiums
    set is_active = false
    where id = 'a3130000-0000-4000-8000-000000000001'
  $$,
  '23503',
  null,
  'a referenced condominium cannot be deactivated'
);

insert into public.property_owners (
  id, organization_id, name, cellphone, email, notify_email
) values
  (
    'a3150000-0000-4000-8000-000000000001',
    'a3100000-0000-4000-8000-000000000001',
    'Proprietaria Um',
    '11999990001',
    'owner-one@example.test',
    true
  ),
  (
    'a3150000-0000-4000-8000-000000000002',
    'a3100000-0000-4000-8000-000000000001',
    'Proprietario Dois',
    '11999990002',
    'owner-two@example.test',
    false
  ),
  (
    'a3150000-0000-4000-8000-000000000003',
    'a3100000-0000-4000-8000-000000000001',
    'Proprietario Inativo',
    '11999990003',
    'owner-inactive@example.test',
    false
  );

update public.property_owners
set is_active = false
where id = 'a3150000-0000-4000-8000-000000000003';

select throws_ok(
  $$
    insert into public.properties (
      organization_id, code, title, owner_id
    ) values (
      'a3100000-0000-4000-8000-000000000001',
      'INV-INACTIVE-OWNER',
      'Imovel com proprietario inativo',
      'a3150000-0000-4000-8000-000000000003'
    )
  $$,
  '23514',
  null,
  'an inactive owner cannot be selected by a new property'
);

insert into public.properties (
  id, organization_id, code, title
) values (
  'a3140000-0000-4000-8000-000000000004',
  'a3100000-0000-4000-8000-000000000001',
  'INV-FUTURE-OWNER',
  'Imovel com proprietario futuro'
);

insert into public.property_ownerships (
  organization_id, property_id, owner_id, ownership_percentage,
  is_primary, valid_from
) values (
  'a3100000-0000-4000-8000-000000000001',
  'a3140000-0000-4000-8000-000000000004',
  'a3150000-0000-4000-8000-000000000002',
  100,
  true,
  current_date + 30
);

update public.properties
set owner_id = 'a3150000-0000-4000-8000-000000000001'
where id = 'a3140000-0000-4000-8000-000000000004';

select is(
  (
    select count(*)::integer
    from public.property_ownerships
    where property_id = 'a3140000-0000-4000-8000-000000000004'
      and owner_id = 'a3150000-0000-4000-8000-000000000001'
      and is_primary
      and valid_from = current_date
      and valid_to = current_date + 30
  ),
  1,
  'legacy owner synchronization ends before the earliest future allocation'
);

select is(
  (
    select count(*)::integer
    from public.property_ownerships
    where property_id = 'a3140000-0000-4000-8000-000000000004'
      and owner_id = 'a3150000-0000-4000-8000-000000000002'
      and is_primary
      and valid_from = current_date + 30
      and valid_to is null
  ),
  1,
  'future primary ownership remains intact after legacy owner synchronization'
);

insert into public.properties (
  id, organization_id, code, title, owner_id
) values (
  'a3140000-0000-4000-8000-000000000003',
  'a3100000-0000-4000-8000-000000000001',
  'INV-OWNER-1',
  'Imovel com proprietario',
  'a3150000-0000-4000-8000-000000000001'
);

select is(
  (
    select count(*)::integer
    from public.property_ownerships
    where property_id = 'a3140000-0000-4000-8000-000000000003'
      and owner_id = 'a3150000-0000-4000-8000-000000000001'
      and ownership_percentage = 100
      and is_primary
      and valid_from <= current_date
      and (valid_to is null or current_date < valid_to)
  ),
  1,
  'legacy owner_id creates one normalized current ownership'
);

select is(
  (
    select owner_name || ':' || owner_email || ':' || owner_notify_email::text
    from public.properties
    where id = 'a3140000-0000-4000-8000-000000000003'
  ),
  'Proprietaria Um:owner-one@example.test:true',
  'normalized owner details project to the property row'
);

update public.property_owners
set name = 'Proprietaria Um Atualizada',
    cellphone = '11999990999'
where id = 'a3150000-0000-4000-8000-000000000001';

select is(
  (
    select owner_name || ':' || owner_cellphone
    from public.properties
    where id = 'a3140000-0000-4000-8000-000000000003'
  ),
  'Proprietaria Um Atualizada:11999990999',
  'owner detail changes cascade to the property projection'
);

update public.properties
set owner_id = 'a3150000-0000-4000-8000-000000000002'
where id = 'a3140000-0000-4000-8000-000000000003';

select is(
  (
    select owner_id::text || ':' || owner_name
    from public.properties
    where id = 'a3140000-0000-4000-8000-000000000003'
  ),
  'a3150000-0000-4000-8000-000000000002:Proprietario Dois',
  'changing owner_id projects the selected normalized owner'
);

select is(
  (
    select count(*)::integer
    from public.property_ownerships
    where property_id = 'a3140000-0000-4000-8000-000000000003'
      and owner_id = 'a3150000-0000-4000-8000-000000000002'
      and valid_from <= current_date
      and (valid_to is null or current_date < valid_to)
  ),
  1,
  'changing owner_id replaces the normalized current ownership'
);

update public.property_ownerships
set ownership_percentage = 50
where property_id = 'a3140000-0000-4000-8000-000000000003'
  and owner_id = 'a3150000-0000-4000-8000-000000000002'
  and valid_from <= current_date
  and (valid_to is null or current_date < valid_to);

insert into public.property_ownerships (
  organization_id, property_id, owner_id, ownership_percentage, is_primary, valid_from
) values (
  'a3100000-0000-4000-8000-000000000001',
  'a3140000-0000-4000-8000-000000000003',
  'a3150000-0000-4000-8000-000000000001',
  50,
  false,
  current_date
);

select lives_ok(
  $$
    update public.properties
    set title = 'Edicao comum com copropriedade', owner_id = owner_id
    where id = 'a3140000-0000-4000-8000-000000000003'
  $$,
  'an unchanged owner_id does not rewrite or reject a co-ownership ledger'
);

select throws_ok(
  $$
    update public.properties
    set owner_id = 'a3150000-0000-4000-8000-000000000001'
    where id = 'a3140000-0000-4000-8000-000000000003'
  $$,
  '23514',
  null,
  'owner_id cannot replace a co-ownership ledger'
);

select throws_ok(
  $$
    update public.property_owners
    set is_active = false
    where id = 'a3150000-0000-4000-8000-000000000002'
  $$,
  '23503',
  null,
  'a current normalized owner cannot be deactivated'
);

insert into public.property_owners (id, organization_id, name)
values (
  'a3150000-0000-4000-8000-000000000007',
  'a3100000-0000-4000-8000-000000000001',
  'Proprietario Futuro'
);

insert into public.properties (
  id, organization_id, code, title
) values (
  'a3140000-0000-4000-8000-000000000007',
  'a3100000-0000-4000-8000-000000000001',
  'INV-OWNER-FUTURE-ONLY',
  'Imovel com vinculo futuro apenas'
);

insert into public.property_ownerships (
  organization_id, property_id, owner_id, ownership_percentage,
  is_primary, valid_from
) values (
  'a3100000-0000-4000-8000-000000000001',
  'a3140000-0000-4000-8000-000000000007',
  'a3150000-0000-4000-8000-000000000007',
  100,
  true,
  current_date + 30
);

select throws_ok(
  $$
    update public.property_owners
    set is_active = false
    where id = 'a3150000-0000-4000-8000-000000000007'
  $$,
  '23503',
  null,
  'a future normalized owner cannot be deactivated before the ownership starts'
);

insert into public.property_owners (id, organization_id, name)
values (
  'a3150000-0000-4000-8000-000000000008',
  'a3100000-0000-4000-8000-000000000001',
  'Proprietario com vinculo encerrado'
);

insert into public.properties (
  id, organization_id, code, title
) values (
  'a3140000-0000-4000-8000-000000000008',
  'a3100000-0000-4000-8000-000000000001',
  'INV-OWNER-ENDED',
  'Imovel com vinculo encerrado'
);

insert into public.property_ownerships (
  organization_id, property_id, owner_id, ownership_percentage,
  is_primary, valid_from, valid_to
) values (
  'a3100000-0000-4000-8000-000000000001',
  'a3140000-0000-4000-8000-000000000008',
  'a3150000-0000-4000-8000-000000000008',
  100,
  true,
  current_date - 30,
  current_date - 1
);

update public.property_owners
set is_active = false
where id = 'a3150000-0000-4000-8000-000000000008';

select lives_ok(
  $$
    update public.property_ownerships
    set valid_from = current_date - 60
    where property_id = 'a3140000-0000-4000-8000-000000000008'
      and owner_id = 'a3150000-0000-4000-8000-000000000008'
  $$,
  'ended ownership history may be corrected while its owner remains in the same organization'
);

select throws_ok(
  $$
    update public.property_ownerships
    set valid_to = current_date + 30
    where property_id = 'a3140000-0000-4000-8000-000000000008'
      and owner_id = 'a3150000-0000-4000-8000-000000000008'
  $$,
  '23514',
  null,
  'an ended ownership cannot be reopened for an inactive owner'
);

insert into public.property_owners (id, organization_id, name)
values (
  'a3150000-0000-4000-8000-000000000004',
  'a3100000-0000-4000-8000-000000000001',
  'Proprietario Somente Legado'
);

insert into public.properties (
  id, organization_id, code, title, owner_name
) values (
  'a3140000-0000-4000-8000-000000000005',
  'a3100000-0000-4000-8000-000000000001',
  'INV-OWNER-LEGACY',
  'Imovel com nome legado',
  '  proprietario somente legado  '
);

select throws_ok(
  $$
    update public.property_owners
    set is_active = false
    where id = 'a3150000-0000-4000-8000-000000000004'
  $$,
  '23503',
  null,
  'a legacy name-only property association prevents owner deactivation'
);

select throws_ok(
  $$
    update public.property_owners
    set name = 'Proprietario legado renomeado'
    where id = 'a3150000-0000-4000-8000-000000000004'
  $$,
  '23503',
  null,
  'a legacy name-only property association prevents owner rename'
);

insert into public.property_owners (id, organization_id, name, is_active)
values (
  'a3150000-0000-4000-8000-000000000005',
  'a3100000-0000-4000-8000-000000000001',
  'Proprietario legado inativo',
  false
);

select throws_ok(
  $$
    insert into public.properties (
      organization_id, code, title, owner_name
    ) values (
      'a3100000-0000-4000-8000-000000000001',
      'INV-OWNER-INACTIVE',
      'Imovel com proprietario inativo',
      '  proprietario legado inativo  '
    )
  $$,
  '23514',
  null,
  'a new legacy name-only association cannot target an inactive owner'
);

insert into public.properties (
  id, organization_id, code, title, owner_name
) values (
  'a3140000-0000-4000-8000-000000000006',
  'a3100000-0000-4000-8000-000000000001',
  'INV-OWNER-TARGET',
  'Imovel com nome de destino legado',
  'Nome destino legado'
);

insert into public.property_owners (id, organization_id, name)
values (
  'a3150000-0000-4000-8000-000000000006',
  'a3100000-0000-4000-8000-000000000001',
  'Proprietario livre'
);

select throws_ok(
  $$
    update public.property_owners
    set name = 'Nome destino legado'
    where id = 'a3150000-0000-4000-8000-000000000006'
  $$,
  '23503',
  null,
  'an owner cannot be renamed into an existing legacy name-only association'
);

insert into public.properties (
  id, organization_id, code, title, owner_name
) values (
  'a3140000-0000-4000-8000-000000000009',
  'a3100000-0000-4000-8000-000000000001',
  'INV-OWNER-FIRST-NAME',
  'Imovel legado aguardando primeiro cadastro',
  'Nome legado primeiro cadastro'
);

select lives_ok(
  $$
    insert into public.property_owners (id, organization_id, name, email)
    values (
      'a3150000-0000-4000-8000-000000000009',
      'a3100000-0000-4000-8000-000000000001',
      'Nome legado primeiro cadastro',
      'primeiro@example.com'
    )
  $$,
  'the first active owner may resolve an unmatched legacy name'
);

select throws_ok(
  $$
    insert into public.property_owners (id, organization_id, name, email)
    values (
      'a3150000-0000-4000-8000-000000000010',
      'a3100000-0000-4000-8000-000000000001',
      'Nome legado primeiro cadastro',
      'segundo@example.com'
    )
  $$,
  '23514',
  null,
  'a second same-name owner cannot make a legacy association ambiguous'
);

insert into public.properties (
  id, organization_id, code, title, owner_name
) values (
  'a3140000-0000-4000-8000-000000000010',
  'a3100000-0000-4000-8000-000000000001',
  'INV-OWNER-FIRST-INACTIVE',
  'Imovel legado sem owner ativo',
  'Nome legado nao pode iniciar inativo'
);

select throws_ok(
  $$
    insert into public.property_owners (id, organization_id, name, is_active)
    values (
      'a3150000-0000-4000-8000-000000000011',
      'a3100000-0000-4000-8000-000000000001',
      'Nome legado nao pode iniciar inativo',
      false
    )
  $$,
  '23514',
  null,
  'the first owner resolving a legacy name must be active'
);

select throws_ok(
  $$
    insert into public.property_owners (
      organization_id, name, email, notify_email
    ) values (
      'a3100000-0000-4000-8000-000000000001',
      'Email invalido',
      'email-invalido',
      true
    )
  $$,
  '23514',
  null,
  'owner email and notification contracts are enforced by the database'
);

select ok(
  not has_table_privilege('authenticated', 'public.property_owners', 'insert,update,delete'),
  'authenticated clients cannot bypass the owner gateway'
);

select ok(
  not has_table_privilege('authenticated', 'public.property_condominiums', 'insert,update,delete'),
  'authenticated clients cannot bypass the location gateway'
);

select is(
  (
    select count(*)::integer
    from public.properties
    where finalidade not in ('venda', 'locacao', 'temporada', 'lancamento', 'venda_locacao')
       or tipo_de_negocio <> finalidade
  ),
  0,
  'every property stores one synchronized canonical modality'
);

select is(
  (
    select count(*)::integer
    from public.property_condominiums condominium
    join public.property_neighborhoods neighborhood
      on neighborhood.organization_id = condominium.organization_id
     and neighborhood.id = condominium.neighborhood_id
    where condominium.city_id is distinct from neighborhood.city_id
  ),
  0,
  'every condominium neighborhood agrees with its city'
);

select is(
  (
    select count(*)::integer
    from public.properties property
    join public.property_ownerships ownership
      on ownership.organization_id = property.organization_id
     and ownership.property_id = property.id
     and ownership.valid_from <= current_date
     and (ownership.valid_to is null or current_date < ownership.valid_to)
     and ownership.is_primary
    where property.owner_id is distinct from ownership.owner_id
  ),
  0,
  'the current primary ownership agrees with the property projection'
);

select ok(
  to_regclass('public.property_condominiums_active_locality_name_uidx') is not null,
  'the locality-aware condominium dedupe index exists'
);

select ok(
  exists (
    select 1 from pg_trigger
    where tgrelid = 'public.properties'::regclass
      and tgname = 'property_owner_update_to_ownership_sync'
      and not tgisinternal
  ),
  'the property-to-ownership synchronization trigger exists'
);

select ok(
  exists (
    select 1 from pg_trigger
    where tgrelid = 'public.properties'::regclass
      and tgname = 'a0_properties_active_owner_reference'
      and not tgisinternal
  ),
  'property writes serialize changed owner assignments'
);

select ok(
  exists (
    select 1 from pg_trigger
    where tgrelid = 'public.property_ownerships'::regclass
      and tgname = 'a0_property_ownership_active_owner_reference'
      and not tgisinternal
  ),
  'normalized ownership writes serialize changed owner assignments'
);

select is(
  (
    select count(*)::integer
    from pg_trigger
    where not tgisinternal
      and tgname in (
        'a0_property_neighborhood_active_city_reference',
        'a0_property_condominium_active_location_reference',
        'a0_properties_active_location_references'
      )
  ),
  3,
  'all location assignment levels serialize against catalog deactivation'
);

select ok(
  exists (
    select 1 from pg_trigger
    where tgrelid = 'public.property_development_units'::regclass
      and tgname = 'zz_property_development_unit_deal_type'
      and not tgisinternal
  ),
  'development unit links enforce the launch modality at the database boundary'
);

select is(
  (
    select count(*)::integer
    from public.property_ownerships ownership
    join public.property_owners owner
      on owner.organization_id = ownership.organization_id
     and owner.id = ownership.owner_id
    where (ownership.valid_to is null or current_date < ownership.valid_to)
      and not coalesce(owner.is_active, true)
  ),
  0,
  'every current or future ownership keeps an active owner'
);

select is(
  (
    select count(*)::integer
    from public.properties property
    cross join lateral (
      select
        count(*)::integer as match_count,
        count(*) filter (where coalesce(owner.is_active, true))::integer as active_match_count
      from public.property_owners owner
      where owner.organization_id = property.organization_id
        and lower(btrim(owner.name)) = lower(btrim(property.owner_name))
    ) matches
    where property.owner_id is null
      and nullif(btrim(property.owner_name), '') is not null
      and (
        matches.match_count > 1
        or (matches.match_count = 1 and matches.active_match_count <> 1)
      )
  ),
  0,
  'every matched legacy owner name resolves to exactly one active catalog owner'
);

select * from finish();
rollback;
