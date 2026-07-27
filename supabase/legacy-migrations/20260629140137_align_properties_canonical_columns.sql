alter table public.properties
  add column if not exists aceita_permuta boolean default false,
  add column if not exists address_visibility text,
  add column if not exists created_by uuid,
  add column if not exists documents jsonb default '{}'::jsonb,
  add column if not exists external_id text,
  add column if not exists external_provider text,
  add column if not exists faixa_valor_imovel text,
  add column if not exists finalidade_uso text,
  add column if not exists image_urls text[] default '{}'::text[],
  add column if not exists is_featured boolean default false,
  add column if not exists metadata jsonb default '{}'::jsonb,
  add column if not exists mobiliado boolean default false,
  add column if not exists origin_media text,
  add column if not exists property_type_id uuid,
  add column if not exists published_on_site boolean default false,
  add column if not exists renda_familiar numeric,
  add column if not exists responsible_user_id uuid,
  add column if not exists tipo text;

do $$
declare
  has_anunciar boolean;
  has_arquivos boolean;
  has_cadastrado_por boolean;
  has_destaque boolean;
  has_fotos boolean;
  has_owner_media_source boolean;
  has_public_address_visibility boolean;
  has_tipo_de_imovel boolean;
  has_tipo_de_negocio boolean;
  fotos_udt text;
  cadastrado_por_udt text;
begin
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'properties' and column_name = 'anunciar'
  ) into has_anunciar;
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'properties' and column_name = 'arquivos'
  ) into has_arquivos;
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'properties' and column_name = 'cadastrado_por'
  ) into has_cadastrado_por;
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'properties' and column_name = 'destaque'
  ) into has_destaque;
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'properties' and column_name = 'fotos'
  ) into has_fotos;
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'properties' and column_name = 'owner_media_source'
  ) into has_owner_media_source;
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'properties' and column_name = 'public_address_visibility'
  ) into has_public_address_visibility;
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'properties' and column_name = 'tipo_de_imovel'
  ) into has_tipo_de_imovel;
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'properties' and column_name = 'tipo_de_negocio'
  ) into has_tipo_de_negocio;

  if has_anunciar then
    execute 'update public.properties set published_on_site = coalesce(published_on_site, anunciar) where published_on_site is null';
  end if;

  if has_destaque then
    execute 'update public.properties set is_featured = coalesce(is_featured, destaque) where is_featured is null';
  end if;

  if has_arquivos then
    execute 'update public.properties set documents = coalesce(documents, arquivos, ''{}''::jsonb) where documents is null or documents = ''{}''::jsonb';
  end if;

  if has_owner_media_source then
    execute 'update public.properties set origin_media = coalesce(nullif(origin_media, ''''), nullif(owner_media_source, '''')) where origin_media is null or origin_media = ''''';
  end if;

  if has_public_address_visibility then
    execute 'update public.properties set address_visibility = coalesce(nullif(address_visibility, ''''), nullif(public_address_visibility, '''')) where address_visibility is null or address_visibility = ''''';
  end if;

  if has_tipo_de_imovel then
    execute 'update public.properties set tipo = coalesce(nullif(tipo, ''''), nullif(tipo_de_imovel, '''')) where tipo is null or tipo = ''''';
  end if;

  if has_tipo_de_negocio then
    execute 'update public.properties set finalidade = coalesce(nullif(finalidade, ''''), nullif(tipo_de_negocio, '''')) where finalidade is null or finalidade = ''''';
  end if;

  if has_cadastrado_por then
    select udt_name
      into cadastrado_por_udt
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'properties'
       and column_name = 'cadastrado_por';

    if cadastrado_por_udt = 'uuid' then
      execute 'update public.properties set responsible_user_id = coalesce(responsible_user_id, cadastrado_por), created_by = coalesce(created_by, cadastrado_por) where cadastrado_por is not null';
    else
      execute 'update public.properties set responsible_user_id = coalesce(responsible_user_id, case when cadastrado_por ~* ''^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'' then cadastrado_por::uuid end), created_by = coalesce(created_by, case when cadastrado_por ~* ''^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'' then cadastrado_por::uuid end) where cadastrado_por is not null';
    end if;
  end if;

  if has_fotos then
    select udt_name
      into fotos_udt
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'properties'
       and column_name = 'fotos';

    if fotos_udt = 'jsonb' then
      execute 'update public.properties p set image_urls = coalesce((select array_agg(photo.value) from jsonb_array_elements_text(p.fotos) as photo(value)), ''{}''::text[]) where (p.image_urls is null or cardinality(p.image_urls) = 0) and p.fotos is not null and jsonb_typeof(p.fotos) = ''array''';
    elsif fotos_udt = '_text' then
      execute 'update public.properties set image_urls = fotos where (image_urls is null or cardinality(image_urls) = 0) and cardinality(fotos) > 0';
    end if;
  end if;
end $$;

update public.properties
   set image_urls = coalesce(image_urls, '{}'::text[]),
       documents = coalesce(documents, '{}'::jsonb),
       metadata = coalesce(metadata, '{}'::jsonb),
       is_featured = coalesce(is_featured, false),
       published_on_site = coalesce(published_on_site, false),
       aceita_permuta = coalesce(aceita_permuta, false),
       mobiliado = coalesce(mobiliado, false);

create index if not exists idx_properties_responsible_user_id
  on public.properties (organization_id, responsible_user_id);

create index if not exists idx_properties_created_by
  on public.properties (organization_id, created_by);

create index if not exists idx_properties_external_identity
  on public.properties (organization_id, external_provider, external_id)
  where external_provider is not null and external_id is not null;
