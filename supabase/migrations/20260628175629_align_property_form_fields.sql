alter table public.properties
  add column if not exists tipo_de_imovel text,
  add column if not exists tipo_de_negocio text,
  add column if not exists finalidade_uso text,
  add column if not exists public_address_visibility text not null default 'full',
  add column if not exists owner_media_source text,
  add column if not exists destaque boolean not null default false,
  add column if not exists anunciar boolean not null default false,
  add column if not exists fotos text[] not null default '{}'::text[],
  add column if not exists imagem_principal text,
  add column if not exists arquivos jsonb not null default '{}'::jsonb,
  add column if not exists cadastrado_por uuid references public.users(id) on delete set null,
  add column if not exists autorizado_comercializacao boolean not null default true,
  add column if not exists commission_percentage numeric(7,4),
  add column if not exists condicao_pagamento text,
  add column if not exists corretor_id uuid references public.users(id) on delete set null,
  add column if not exists data_inicio_comissao date,
  add column if not exists detalhes_extras text[] not null default '{}'::text[],
  add column if not exists exclusividade boolean not null default false,
  add column if not exists faixa_valor_imovel text,
  add column if not exists imoview_codigo text,
  add column if not exists is_demo boolean not null default false,
  add column if not exists marcadores text[] not null default '{}'::text[],
  add column if not exists mobilia text,
  add column if not exists ocupacao text,
  add column if not exists owner_notify_email boolean not null default false,
  add column if not exists padrao text,
  add column if not exists pais text,
  add column if not exists placa_no_local boolean not null default false,
  add column if not exists posicao_localizacao text,
  add column if not exists projeto_aprovado boolean not null default false,
  add column if not exists proximidades text[] not null default '{}'::text[],
  add column if not exists regra_pet boolean not null default false,
  add column if not exists renda_familiar numeric(14,2),
  add column if not exists situacao_imovel text,
  add column if not exists super_destaque boolean not null default false,
  add column if not exists tipo_comissao text,
  add column if not exists usou_fgts boolean not null default false,
  add column if not exists valor_locacao_avaliado numeric(14,2),
  add column if not exists valor_venda_avaliado numeric(14,2),
  add column if not exists vista_codigo text,
  add column if not exists zoneamento text;

comment on column public.properties.finalidade is
  'Tipo de negocio canônico usado para filtros e site publico: venda, locacao, temporada ou venda_locacao.';

comment on column public.properties.finalidade_uso is
  'Finalidade de uso do imovel informada no formulario, por exemplo Residencial ou Comercial.';

create or replace function pg_temp.vimob_property_legacy_text(payload jsonb, key text)
returns text
language sql
immutable
as $$
  select nullif(payload #>> array['legacy', key], '')
$$;

create or replace function pg_temp.vimob_property_legacy_bool(payload jsonb, key text)
returns boolean
language sql
immutable
as $$
  select case lower(pg_temp.vimob_property_legacy_text(payload, key))
    when 'true' then true
    when 'false' then false
    else null
  end
$$;

create or replace function pg_temp.vimob_property_legacy_numeric(payload jsonb, key text)
returns numeric
language sql
immutable
as $$
  select case
    when pg_temp.vimob_property_legacy_text(payload, key) ~ '^-?[0-9]+(\.[0-9]+)?$'
      then pg_temp.vimob_property_legacy_text(payload, key)::numeric
    else null
  end
$$;

create or replace function pg_temp.vimob_property_legacy_uuid(payload jsonb, key text)
returns uuid
language sql
immutable
as $$
  select case
    when pg_temp.vimob_property_legacy_text(payload, key) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then pg_temp.vimob_property_legacy_text(payload, key)::uuid
    else null
  end
$$;

create or replace function pg_temp.vimob_property_legacy_text_array(payload jsonb, key text)
returns text[]
language sql
stable
as $$
  select case
    when jsonb_typeof(payload #> array['legacy', key]) = 'array'
      then array(select jsonb_array_elements_text(payload #> array['legacy', key]))
    else null
  end
$$;

update public.properties
set
  tipo_de_imovel = coalesce(nullif(tipo_de_imovel, ''), tipo),
  tipo_de_negocio = coalesce(nullif(tipo_de_negocio, ''), finalidade),
  finalidade_uso = coalesce(nullif(finalidade_uso, ''), pg_temp.vimob_property_legacy_text(metadata, 'finalidade')),
  public_address_visibility = coalesce(nullif(address_visibility, ''), nullif(public_address_visibility, ''), 'full'),
  owner_media_source = coalesce(nullif(owner_media_source, ''), origin_media, pg_temp.vimob_property_legacy_text(metadata, 'owner_media_source')),
  destaque = coalesce(is_featured, destaque, false),
  anunciar = coalesce(published_on_site, anunciar, false),
  fotos = case
    when cardinality(fotos) = 0 and cardinality(image_urls) > 0 then image_urls
    else fotos
  end,
  imagem_principal = coalesce(nullif(imagem_principal, ''), image_urls[1]),
  arquivos = case
    when arquivos = '{}'::jsonb and documents is not null then documents
    else arquivos
  end,
  cadastrado_por = coalesce(cadastrado_por, responsible_user_id, created_by),
  autorizado_comercializacao = coalesce(pg_temp.vimob_property_legacy_bool(metadata, 'autorizado_comercializacao'), autorizado_comercializacao, true),
  commission_percentage = coalesce(commission_percentage, pg_temp.vimob_property_legacy_numeric(metadata, 'commission_percentage')),
  condicao_pagamento = coalesce(nullif(condicao_pagamento, ''), pg_temp.vimob_property_legacy_text(metadata, 'condicao_pagamento')),
  corretor_id = coalesce(corretor_id, pg_temp.vimob_property_legacy_uuid(metadata, 'corretor_id')),
  data_inicio_comissao = coalesce(
    data_inicio_comissao,
    case
      when pg_temp.vimob_property_legacy_text(metadata, 'data_inicio_comissao') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
        then pg_temp.vimob_property_legacy_text(metadata, 'data_inicio_comissao')::date
      else null
    end
  ),
  detalhes_extras = coalesce(nullif(detalhes_extras, '{}'::text[]), pg_temp.vimob_property_legacy_text_array(metadata, 'detalhes_extras'), '{}'::text[]),
  exclusividade = coalesce(pg_temp.vimob_property_legacy_bool(metadata, 'exclusividade'), exclusividade, false),
  faixa_valor_imovel = coalesce(nullif(faixa_valor_imovel, ''), pg_temp.vimob_property_legacy_text(metadata, 'faixa_valor_imovel')),
  imoview_codigo = coalesce(nullif(imoview_codigo, ''), pg_temp.vimob_property_legacy_text(metadata, 'imoview_codigo')),
  is_demo = coalesce(pg_temp.vimob_property_legacy_bool(metadata, 'is_demo'), is_demo, false),
  marcadores = coalesce(nullif(marcadores, '{}'::text[]), pg_temp.vimob_property_legacy_text_array(metadata, 'marcadores'), '{}'::text[]),
  mobilia = coalesce(nullif(mobilia, ''), pg_temp.vimob_property_legacy_text(metadata, 'mobilia')),
  ocupacao = coalesce(nullif(ocupacao, ''), pg_temp.vimob_property_legacy_text(metadata, 'ocupacao')),
  owner_notify_email = coalesce(pg_temp.vimob_property_legacy_bool(metadata, 'owner_notify_email'), owner_notify_email, false),
  padrao = coalesce(nullif(padrao, ''), pg_temp.vimob_property_legacy_text(metadata, 'padrao')),
  pais = coalesce(nullif(pais, ''), pg_temp.vimob_property_legacy_text(metadata, 'pais')),
  placa_no_local = coalesce(pg_temp.vimob_property_legacy_bool(metadata, 'placa_no_local'), placa_no_local, false),
  posicao_localizacao = coalesce(nullif(posicao_localizacao, ''), pg_temp.vimob_property_legacy_text(metadata, 'posicao_localizacao')),
  projeto_aprovado = coalesce(pg_temp.vimob_property_legacy_bool(metadata, 'projeto_aprovado'), projeto_aprovado, false),
  proximidades = coalesce(nullif(proximidades, '{}'::text[]), pg_temp.vimob_property_legacy_text_array(metadata, 'proximidades'), '{}'::text[]),
  regra_pet = coalesce(pg_temp.vimob_property_legacy_bool(metadata, 'regra_pet'), regra_pet, false),
  renda_familiar = coalesce(renda_familiar, pg_temp.vimob_property_legacy_numeric(metadata, 'renda_familiar')),
  situacao_imovel = coalesce(nullif(situacao_imovel, ''), pg_temp.vimob_property_legacy_text(metadata, 'situacao_imovel')),
  super_destaque = coalesce(pg_temp.vimob_property_legacy_bool(metadata, 'super_destaque'), super_destaque, false),
  tipo_comissao = coalesce(nullif(tipo_comissao, ''), pg_temp.vimob_property_legacy_text(metadata, 'tipo_comissao')),
  usou_fgts = coalesce(pg_temp.vimob_property_legacy_bool(metadata, 'usou_fgts'), usou_fgts, false),
  valor_locacao_avaliado = coalesce(valor_locacao_avaliado, pg_temp.vimob_property_legacy_numeric(metadata, 'valor_locacao_avaliado')),
  valor_venda_avaliado = coalesce(valor_venda_avaliado, pg_temp.vimob_property_legacy_numeric(metadata, 'valor_venda_avaliado')),
  vista_codigo = coalesce(nullif(vista_codigo, ''), pg_temp.vimob_property_legacy_text(metadata, 'vista_codigo')),
  zoneamento = coalesce(nullif(zoneamento, ''), pg_temp.vimob_property_legacy_text(metadata, 'zoneamento'));
