\set ON_ERROR_STOP on

\if :{?supabase_public_url}
\else
  \echo 'Informe --set=supabase_public_url=https://seu-dominio'
  \quit 2
\endif

begin;

select set_config(
  'vimob.migration_target_supabase_url',
  rtrim(:'supabase_public_url', '/'),
  false
);

update cron.job
set command = replace(
  command,
  'https://iemalzlfnbouobyjwlwi.supabase.co',
  current_setting('vimob.migration_target_supabase_url')
)
where command like '%https://iemalzlfnbouobyjwlwi.supabase.co%';

do $rewrite_function$
declare
  function_ddl text;
  old_url constant text := 'https://iemalzlfnbouobyjwlwi.supabase.co';
  new_url text := current_setting('vimob.migration_target_supabase_url');
begin
  select pg_get_functiondef(p.oid)
  into function_ddl
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private'
    and p.proname = 'invoke_google_calendar_worker'
    and pg_get_function_identity_arguments(p.oid) = 'p_action text, p_limit integer';

  if function_ddl is null then
    raise exception 'private.invoke_google_calendar_worker não encontrada';
  end if;

  if position(old_url in function_ddl) > 0 then
    execute replace(function_ddl, old_url, new_url);
  elsif position(new_url in function_ddl) = 0 then
    raise exception 'A função não contém a URL antiga nem a URL nova';
  end if;
end
$rewrite_function$;

commit;

select count(*) as remaining_old_cron_urls
from cron.job
where command like '%iemalzlfnbouobyjwlwi%';

select count(*) as remaining_old_function_urls
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('public', 'private')
  and p.prokind in ('f', 'p')
  and pg_get_functiondef(p.oid) like '%iemalzlfnbouobyjwlwi%';

