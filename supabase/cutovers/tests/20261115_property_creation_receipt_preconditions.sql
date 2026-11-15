-- Read-only contract after the F00 preconditions and canonical receipt SQL.
begin;
do $contract$
begin
  if not exists (
    select 1 from pg_index i
    where i.indrelid = 'public.properties'::regclass
      and i.indisunique and i.indisvalid and i.indisready and i.indimmediate
      and i.indpred is null and i.indexprs is null and i.indnkeyatts = 2
      and (select array_agg(a.attname::text order by a.attname)
        from unnest(i.indkey::smallint[]) with ordinality k(attnum, position)
        join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum
        where k.position <= i.indnkeyatts) = array['id','organization_id']::text[]
  ) then
    raise exception 'property composite identity index is missing or invalid';
  end if;
  if not exists (select 1 from pg_index
    where indexrelid = to_regclass('public.properties_creation_request_uidx')
      and indisunique and indisvalid and indisready and indpred is not null) then
    raise exception 'property creation reservation identity index is missing or invalid';
  end if;
  if not exists (select 1 from pg_trigger
    where tgrelid = 'public.properties'::regclass
      and tgname = 'properties_guard_creation_ledger'
      and tgenabled in ('O','A')
      and tgfoid = to_regprocedure('private.guard_property_creation_ledger()')) then
    raise exception 'property creation reservation guard is missing or disabled';
  end if;
  if has_function_privilege('anon', 'private.guard_property_creation_ledger()', 'EXECUTE')
    or has_function_privilege('authenticated', 'private.guard_property_creation_ledger()', 'EXECUTE') then
    raise exception 'browser can execute property reservation guard';
  end if;
end;
$contract$;
rollback;
