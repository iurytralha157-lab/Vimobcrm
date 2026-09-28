begin;

create extension if not exists pgtap with schema extensions;
select plan(10);

select has_column(
  'public', 'property_cities', 'updated_at',
  'city rows provide the API concurrency timestamp'
);
select has_column(
  'public', 'property_neighborhoods', 'updated_at',
  'neighborhood rows provide the API concurrency timestamp'
);

insert into public.organizations (id, name, is_active)
values ('b5100000-0000-4000-8000-000000000001', 'Manual location test', true);

insert into public.property_cities (id, organization_id, name, uf)
values
  ('b5110000-0000-4000-8000-000000000001', 'b5100000-0000-4000-8000-000000000001', 'Cidade A', 'SP'),
  ('b5110000-0000-4000-8000-000000000002', 'b5100000-0000-4000-8000-000000000001', 'Cidade B', 'RJ');

insert into public.property_neighborhoods (id, organization_id, city_id, name)
values (
  'b5120000-0000-4000-8000-000000000001',
  'b5100000-0000-4000-8000-000000000001',
  'b5110000-0000-4000-8000-000000000001',
  'Bairro A'
);

select ok(
  (select updated_at is not null from public.property_cities
   where id = 'b5110000-0000-4000-8000-000000000001'),
  'created city returns updated_at'
);
select ok(
  (select updated_at is not null from public.property_neighborhoods
   where id = 'b5120000-0000-4000-8000-000000000001'),
  'created neighborhood returns updated_at'
);

insert into public.properties (
  id, organization_id, code, title, cidade, uf, bairro, cep, endereco
) values (
  'b5130000-0000-4000-8000-000000000001',
  'b5100000-0000-4000-8000-000000000001',
  'MANUAL-LOCATION-1',
  'Imovel de teste manual',
  'São Paulo', 'SP', 'Sé', '01001-000', 'Praça da Sé'
);

select is(
  (select cidade || ':' || uf || ':' || bairro || ':' || cep || ':' || endereco
   from public.properties where id = 'b5130000-0000-4000-8000-000000000001'),
  'São Paulo:SP:Sé:01001-000:Praça da Sé',
  'INSERT without catalog IDs keeps the address returned by CEP'
);

update public.properties
set cidade = 'Campinas', uf = 'SP', bairro = 'Centro'
where id = 'b5130000-0000-4000-8000-000000000001';

select is(
  (select cidade || ':' || uf || ':' || bairro
   from public.properties where id = 'b5130000-0000-4000-8000-000000000001'),
  'Campinas:SP:Centro',
  'UPDATE without catalog IDs keeps edited manual location'
);

update public.properties
set city_id = 'b5110000-0000-4000-8000-000000000001',
    neighborhood_id = 'b5120000-0000-4000-8000-000000000001',
    cidade = 'Wrong', uf = 'XX', bairro = 'Wrong'
where id = 'b5130000-0000-4000-8000-000000000001';

select is(
  (select cidade || ':' || uf || ':' || bairro
   from public.properties where id = 'b5130000-0000-4000-8000-000000000001'),
  'Cidade A:SP:Bairro A',
  'catalog IDs remain authoritative for displayed location'
);

select throws_ok(
  $$
    update public.properties
    set city_id = 'b5110000-0000-4000-8000-000000000002'
    where id = 'b5130000-0000-4000-8000-000000000001'
  $$,
  '23514', null,
  'neighborhood cannot be linked to a different city'
);

update public.properties
set city_id = null, neighborhood_id = null
where id = 'b5130000-0000-4000-8000-000000000001';

select ok(
  (select cidade is null and uf is null and bairro is null
   from public.properties where id = 'b5130000-0000-4000-8000-000000000001'),
  'unlinking catalog IDs without replacement clears stale projections'
);

update public.properties
set city_id = 'b5110000-0000-4000-8000-000000000001',
    neighborhood_id = 'b5120000-0000-4000-8000-000000000001'
where id = 'b5130000-0000-4000-8000-000000000001';

update public.properties
set city_id = null, neighborhood_id = null,
    cidade = 'Belo Horizonte', uf = 'MG', bairro = 'Savassi'
where id = 'b5130000-0000-4000-8000-000000000001';

select is(
  (select cidade || ':' || uf || ':' || bairro
   from public.properties where id = 'b5130000-0000-4000-8000-000000000001'),
  'Belo Horizonte:MG:Savassi',
  'switching from catalog IDs to a new manual location keeps its text'
);

select * from finish();
rollback;
