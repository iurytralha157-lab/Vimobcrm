\set ON_ERROR_STOP on

-- Uso:
--   Auditoria (padrao, nenhuma escrita persistente):
--     psql "$DATABASE_URL" \
--       --set=supabase_public_url=https://supabase.vimobcrm.com.br \
--       --set=apply=0 \
--       --file=rewrite-public-storage-urls-v1.sql
--
--   Aplicacao (copie as cinco contagens exibidas pela auditoria):
--     psql "$DATABASE_URL" \
--       --set=supabase_public_url=https://supabase.vimobcrm.com.br \
--       --set=apply=1 \
--       --set=expected_rewrite=0 \
--       --set=expected_refused=0 \
--       --set=expected_refused_bucket=0 \
--       --set=expected_signed=0 \
--       --set=expected_missing_objects=0 \
--       --file=rewrite-public-storage-urls-v1.sql
--
-- O script nunca reescreve URLs assinadas, endpoints privados, buckets fora da
-- allowlist, buckets que nao estejam publicos ou objetos ausentes no destino.

\if :{?supabase_public_url}
\else
  \echo 'Informe --set=supabase_public_url=https://seu-dominio'
  \quit 2
\endif

\if :{?apply}
\else
  \set apply 0
\endif

\if :apply
  \if :{?expected_rewrite}
  \else
    \echo 'apply=1 exige --set=expected_rewrite=<contagem da auditoria>'
    \quit 2
  \endif
  \if :{?expected_refused}
  \else
    \echo 'apply=1 exige --set=expected_refused=<contagem da auditoria>'
    \quit 2
  \endif
  \if :{?expected_refused_bucket}
  \else
    \echo 'apply=1 exige --set=expected_refused_bucket=<contagem da auditoria>'
    \quit 2
  \endif
  \if :{?expected_signed}
  \else
    \echo 'apply=1 exige --set=expected_signed=<contagem da auditoria>'
    \quit 2
  \endif
  \if :{?expected_missing_objects}
  \else
    \echo 'apply=1 exige --set=expected_missing_objects=<contagem da auditoria>'
    \quit 2
  \endif
\endif

begin isolation level serializable;

set local lock_timeout = '5s';
set local statement_timeout = '15min';
set local search_path = pg_catalog, pg_temp, public, auth, storage;

select set_config(
  'vimob.storage_url_rewrite.old_origin',
  'https://iemalzlfnbouobyjwlwi.supabase.co',
  true
);

select set_config(
  'vimob.storage_url_rewrite.new_origin',
  rtrim(:'supabase_public_url', '/'),
  true
);

\if :apply
select set_config(
  'vimob.storage_url_rewrite.expected_rewrite',
  :'expected_rewrite',
  true
);
select set_config(
  'vimob.storage_url_rewrite.expected_refused',
  :'expected_refused',
  true
);
select set_config(
  'vimob.storage_url_rewrite.expected_refused_bucket',
  :'expected_refused_bucket',
  true
);
select set_config(
  'vimob.storage_url_rewrite.expected_signed',
  :'expected_signed',
  true
);
select set_config(
  'vimob.storage_url_rewrite.expected_missing_objects',
  :'expected_missing_objects',
  true
);
\endif

do $guard$
declare
  old_origin constant text := current_setting(
    'vimob.storage_url_rewrite.old_origin'
  );
  new_origin constant text := current_setting(
    'vimob.storage_url_rewrite.new_origin'
  );
begin
  if new_origin = old_origin then
    raise exception 'A URL nova nao pode ser igual a URL antiga';
  end if;

  if new_origin !~ '^https://[A-Za-z0-9.-]+(:[0-9]+)?$' then
    raise exception
      'supabase_public_url deve ser uma origem HTTPS sem path, query ou fragmento';
  end if;
end
$guard$;

create temporary table storage_url_rewrite_targets (
  target_kind text not null
    check (target_kind in ('text', 'json_key')),
  schema_name text not null,
  table_name text not null,
  column_name text not null,
  json_key text,
  primary key (
    target_kind,
    schema_name,
    table_name,
    column_name,
    json_key
  ),
  check (
    (target_kind = 'text' and json_key = '')
    or (target_kind = 'json_key' and json_key <> '')
  )
) on commit drop;

insert into storage_url_rewrite_targets (
  target_kind,
  schema_name,
  table_name,
  column_name,
  json_key
)
values
  ('text', 'public', 'users', 'avatar_url', ''),
  ('text', 'public', 'organizations', 'logo_url', ''),
  ('text', 'public', 'teams', 'logo_url', ''),
  ('text', 'public', 'onboarding_requests', 'logo_url', ''),
  ('text', 'public', 'onboarding_requests', 'favicon_url', ''),
  ('text', 'public', 'leads', 'whatsapp_avatar_url', ''),
  ('text', 'public', 'lead_attachments', 'file_url', ''),
  ('json_key', 'auth', 'users', 'raw_user_meta_data', 'avatar_url');

create temporary table storage_url_rewrite_public_buckets (
  bucket_id text primary key
) on commit drop;

insert into storage_url_rewrite_public_buckets (bucket_id)
values
  ('avatars'),
  ('logos'),
  ('properties'),
  ('site-images');

do $validate_targets$
declare
  target record;
  target_udt text;
begin
  for target in
    select *
    from storage_url_rewrite_targets
    order by schema_name, table_name, column_name, json_key
  loop
    select column.udt_name
    into target_udt
    from information_schema.columns as column
    where column.table_schema = target.schema_name
      and column.table_name = target.table_name
      and column.column_name = target.column_name;

    if target_udt is null then
      raise exception
        'Alvo ausente: %.%.%',
        target.schema_name,
        target.table_name,
        target.column_name;
    end if;

    if target.target_kind = 'text' and target_udt <> 'text' then
      raise exception
        'Alvo %.%.% deveria ser text, mas e %',
        target.schema_name,
        target.table_name,
        target.column_name,
        target_udt;
    end if;

    if target.target_kind = 'json_key' and target_udt <> 'jsonb' then
      raise exception
        'Alvo %.%.% deveria ser jsonb, mas e %',
        target.schema_name,
        target.table_name,
        target.column_name,
        target_udt;
    end if;

    if not exists (
      select 1
      from information_schema.columns as id_column
      where id_column.table_schema = target.schema_name
        and id_column.table_name = target.table_name
        and id_column.column_name = 'id'
    ) then
      raise exception
        'Alvo %.% nao possui chave id',
        target.schema_name,
        target.table_name;
    end if;
  end loop;
end
$validate_targets$;

create temporary table storage_url_rewrite_candidates (
  candidate_id bigint generated always as identity primary key,
  target_kind text not null,
  schema_name text not null,
  table_name text not null,
  column_name text not null,
  json_key text not null,
  row_id text not null,
  raw_url text not null,
  endpoint_kind text,
  locator text,
  bucket_id text,
  object_name text,
  bucket_allowlisted boolean not null default false,
  bucket_public boolean,
  object_exists boolean not null default false,
  decision text,
  new_url text
) on commit drop;

do $collect_candidates$
declare
  target record;
  old_storage_pattern constant text := current_setting(
    'vimob.storage_url_rewrite.old_origin'
  ) || '/storage/v1/%';
begin
  for target in
    select *
    from storage_url_rewrite_targets
    order by schema_name, table_name, column_name, json_key
  loop
    if target.target_kind = 'text' then
      execute format(
        $sql$
          insert into storage_url_rewrite_candidates (
            target_kind,
            schema_name,
            table_name,
            column_name,
            json_key,
            row_id,
            raw_url
          )
          select %L, %L, %L, %L, %L, source.id::text, source.%I
          from %I.%I as source
          where source.%I like $1
        $sql$,
        target.target_kind,
        target.schema_name,
        target.table_name,
        target.column_name,
        target.json_key,
        target.column_name,
        target.schema_name,
        target.table_name,
        target.column_name
      ) using old_storage_pattern;
    elsif target.target_kind = 'json_key' then
      execute format(
        $sql$
          insert into storage_url_rewrite_candidates (
            target_kind,
            schema_name,
            table_name,
            column_name,
            json_key,
            row_id,
            raw_url
          )
          select %L, %L, %L, %L, %L, source.id::text, source.%I ->> %L
          from %I.%I as source
          where source.%I ->> %L like $1
        $sql$,
        target.target_kind,
        target.schema_name,
        target.table_name,
        target.column_name,
        target.json_key,
        target.column_name,
        target.json_key,
        target.schema_name,
        target.table_name,
        target.column_name,
        target.json_key
      ) using old_storage_pattern;
    end if;
  end loop;
end
$collect_candidates$;

do $parse_candidates$
declare
  old_origin constant text := current_setting(
    'vimob.storage_url_rewrite.old_origin'
  );
  public_object_prefix constant text := old_origin
    || '/storage/v1/object/public/';
  public_render_prefix constant text := old_origin
    || '/storage/v1/render/image/public/';
  signed_object_prefix constant text := old_origin
    || '/storage/v1/object/sign/';
  signed_render_prefix constant text := old_origin
    || '/storage/v1/render/image/sign/';
  authenticated_object_prefix constant text := old_origin
    || '/storage/v1/object/authenticated/';
  authenticated_render_prefix constant text := old_origin
    || '/storage/v1/render/image/authenticated/';
begin
  update storage_url_rewrite_candidates
  set endpoint_kind = case
        when raw_url like public_object_prefix || '%' then 'public_object'
        when raw_url like public_render_prefix || '%' then 'public_render'
        when raw_url like signed_object_prefix || '%' then 'signed_object'
        when raw_url like signed_render_prefix || '%' then 'signed_render'
        when raw_url like authenticated_object_prefix || '%'
          then 'authenticated_object'
        when raw_url like authenticated_render_prefix || '%'
          then 'authenticated_render'
        else 'other_storage'
      end,
      locator = split_part(
        split_part(
          case
            when raw_url like public_object_prefix || '%'
              then substr(raw_url, char_length(public_object_prefix) + 1)
            when raw_url like public_render_prefix || '%'
              then substr(raw_url, char_length(public_render_prefix) + 1)
            when raw_url like signed_object_prefix || '%'
              then substr(raw_url, char_length(signed_object_prefix) + 1)
            when raw_url like signed_render_prefix || '%'
              then substr(raw_url, char_length(signed_render_prefix) + 1)
            when raw_url like authenticated_object_prefix || '%'
              then substr(raw_url, char_length(authenticated_object_prefix) + 1)
            when raw_url like authenticated_render_prefix || '%'
              then substr(
                raw_url,
                char_length(authenticated_render_prefix) + 1
              )
          end,
          '?',
          1
        ),
        '#',
        1
      );
end
$parse_candidates$;

update storage_url_rewrite_candidates
set bucket_id = case
      when strpos(locator, '/') > 1 then split_part(locator, '/', 1)
    end,
    object_name = case
      when strpos(locator, '/') > 1
        then nullif(substr(locator, strpos(locator, '/') + 1), '')
    end;

update storage_url_rewrite_candidates as candidate
set bucket_allowlisted = exists (
      select 1
      from storage_url_rewrite_public_buckets as allowed
      where allowed.bucket_id = candidate.bucket_id
    ),
    bucket_public = (
      select bucket.public
      from storage.buckets as bucket
      where bucket.id = candidate.bucket_id
    ),
    object_exists = exists (
      select 1
      from storage.objects as object
      where object.bucket_id = candidate.bucket_id
        and object.name = candidate.object_name
    );

update storage_url_rewrite_candidates
set decision = case
      when endpoint_kind not in ('public_object', 'public_render')
        then 'refuse_endpoint'
      when bucket_id is null or object_name is null
        then 'refuse_malformed'
      when not bucket_allowlisted
        then 'refuse_bucket'
      when bucket_public is distinct from true
        then 'refuse_bucket_visibility'
      when not object_exists
        then 'refuse_object_missing'
      else 'rewrite'
    end;

update storage_url_rewrite_candidates
set new_url = current_setting('vimob.storage_url_rewrite.new_origin')
      || substr(
        raw_url,
        char_length(
          current_setting('vimob.storage_url_rewrite.old_origin')
        ) + 1
      )
where decision = 'rewrite';

\echo 'Auditoria por origem, endpoint, bucket e decisao (URLs/tokens omitidos):'
select
  format('%I.%I.%I', schema_name, table_name, column_name) as target,
  nullif(json_key, '') as json_key,
  endpoint_kind,
  coalesce(bucket_id, '<malformed>') as bucket_id,
  bucket_allowlisted,
  bucket_public,
  object_exists,
  decision,
  count(*)::bigint as references
from storage_url_rewrite_candidates
group by
  schema_name,
  table_name,
  column_name,
  json_key,
  endpoint_kind,
  bucket_id,
  bucket_allowlisted,
  bucket_public,
  object_exists,
  decision
order by target, json_key, decision, bucket_id;

\echo 'Copie estas contagens para a execucao com apply=1:'
select
  count(*) filter (where decision = 'rewrite')::bigint
    as expected_rewrite,
  count(*) filter (where decision <> 'rewrite')::bigint
    as expected_refused,
  count(*) filter (where decision = 'refuse_bucket')::bigint
    as expected_refused_bucket,
  count(*) filter (
    where endpoint_kind in ('signed_object', 'signed_render')
  )::bigint as expected_signed,
  count(*) filter (where not object_exists)::bigint
    as expected_missing_objects
from storage_url_rewrite_candidates;

\if :apply
do $expected_counts$
declare
  actual_rewrite bigint;
  actual_refused bigint;
  actual_refused_bucket bigint;
  actual_signed bigint;
  actual_missing_objects bigint;
  expected_value text;
begin
  foreach expected_value in array array[
    current_setting('vimob.storage_url_rewrite.expected_rewrite'),
    current_setting('vimob.storage_url_rewrite.expected_refused'),
    current_setting('vimob.storage_url_rewrite.expected_refused_bucket'),
    current_setting('vimob.storage_url_rewrite.expected_signed'),
    current_setting('vimob.storage_url_rewrite.expected_missing_objects')
  ]
  loop
    if expected_value !~ '^[0-9]+$' then
      raise exception 'Contagem esperada invalida: %', expected_value;
    end if;
  end loop;

  select
    count(*) filter (where decision = 'rewrite'),
    count(*) filter (where decision <> 'rewrite'),
    count(*) filter (where decision = 'refuse_bucket'),
    count(*) filter (
      where endpoint_kind in ('signed_object', 'signed_render')
    ),
    count(*) filter (where not object_exists)
  into
    actual_rewrite,
    actual_refused,
    actual_refused_bucket,
    actual_signed,
    actual_missing_objects
  from storage_url_rewrite_candidates;

  if actual_rewrite <>
      current_setting('vimob.storage_url_rewrite.expected_rewrite')::bigint
    or actual_refused <>
      current_setting('vimob.storage_url_rewrite.expected_refused')::bigint
    or actual_refused_bucket <>
      current_setting(
        'vimob.storage_url_rewrite.expected_refused_bucket'
      )::bigint
    or actual_signed <>
      current_setting('vimob.storage_url_rewrite.expected_signed')::bigint
    or actual_missing_objects <>
      current_setting(
        'vimob.storage_url_rewrite.expected_missing_objects'
      )::bigint
  then
    raise exception
      'As contagens mudaram desde a auditoria; nenhuma URL foi alterada';
  end if;
end
$expected_counts$;

create temporary table storage_url_rewrite_applied (
  candidate_id bigint primary key
) on commit drop;

do $apply_rewrite$
declare
  target record;
begin
  for target in
    select *
    from storage_url_rewrite_targets
    order by schema_name, table_name, column_name, json_key
  loop
    if target.target_kind = 'text' then
      execute format(
        $sql$
          with updated as (
            update %I.%I as destination
            set %I = candidate.new_url
            from storage_url_rewrite_candidates as candidate
            where candidate.target_kind = 'text'
              and candidate.schema_name = %L
              and candidate.table_name = %L
              and candidate.column_name = %L
              and candidate.json_key = ''
              and candidate.decision = 'rewrite'
              and destination.id::text = candidate.row_id
              and destination.%I = candidate.raw_url
            returning candidate.candidate_id
          )
          insert into storage_url_rewrite_applied (candidate_id)
          select candidate_id
          from updated
          on conflict (candidate_id) do nothing
        $sql$,
        target.schema_name,
        target.table_name,
        target.column_name,
        target.schema_name,
        target.table_name,
        target.column_name,
        target.column_name
      );
    elsif target.target_kind = 'json_key' then
      execute format(
        $sql$
          with updated as (
            update %I.%I as destination
            set %I = jsonb_set(
              destination.%I,
              array[candidate.json_key],
              to_jsonb(candidate.new_url),
              false
            )
            from storage_url_rewrite_candidates as candidate
            where candidate.target_kind = 'json_key'
              and candidate.schema_name = %L
              and candidate.table_name = %L
              and candidate.column_name = %L
              and candidate.json_key = %L
              and candidate.decision = 'rewrite'
              and destination.id::text = candidate.row_id
              and destination.%I ->> candidate.json_key = candidate.raw_url
            returning candidate.candidate_id
          )
          insert into storage_url_rewrite_applied (candidate_id)
          select candidate_id
          from updated
          on conflict (candidate_id) do nothing
        $sql$,
        target.schema_name,
        target.table_name,
        target.column_name,
        target.column_name,
        target.schema_name,
        target.table_name,
        target.column_name,
        target.json_key,
        target.column_name
      );
    end if;
  end loop;
end
$apply_rewrite$;

do $postcondition$
declare
  expected_applied bigint;
  actual_applied bigint;
begin
  select count(*)
  into expected_applied
  from storage_url_rewrite_candidates
  where decision = 'rewrite';

  select count(*)
  into actual_applied
  from storage_url_rewrite_applied;

  if actual_applied <> expected_applied then
    raise exception
      'Aplicacao incompleta: esperadas %, aplicadas %; transacao revertida',
      expected_applied,
      actual_applied;
  end if;

  if exists (
    select 1
    from storage_url_rewrite_applied as applied
    join storage_url_rewrite_candidates as candidate
      using (candidate_id)
    where candidate.decision <> 'rewrite'
  ) then
    raise exception
      'Uma referencia recusada foi alterada; transacao revertida';
  end if;
end
$postcondition$;

select count(*)::bigint as applied_references
from storage_url_rewrite_applied;

commit;
\else
\echo 'DRY RUN concluido: nenhuma alteracao foi persistida.'
rollback;
\endif
