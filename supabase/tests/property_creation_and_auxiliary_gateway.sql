-- Run only in the disposable local property fixture, never against production.
begin;
do $contract$
declare target text;
begin
  foreach target in array array['property_sequences','property_feature_catalog','property_proximity_catalog','property_features','property_proximities'] loop
    if has_table_privilege('anon', 'public.' || target, 'INSERT,UPDATE,DELETE')
      or has_table_privilege('authenticated', 'public.' || target, 'INSERT,UPDATE,DELETE')
      or has_any_column_privilege('anon', 'public.' || target, 'INSERT,UPDATE')
      or has_any_column_privilege('authenticated', 'public.' || target, 'INSERT,UPDATE') then
      raise exception 'auxiliary mutation boundary is open: %', target;
    end if;
  end loop;
  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'properties_creation_request_uidx') then
    raise exception 'property creation unique reservation is missing';
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.properties'::regclass and tgname = 'properties_guard_creation_ledger' and tgenabled <> 'D') then
    raise exception 'property creation immutable reservation guard is missing';
  end if;
end;
$contract$;
rollback;
