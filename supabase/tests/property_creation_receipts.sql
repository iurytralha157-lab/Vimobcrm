-- Contract only: run against the verified disposable local fixture after both
-- hardening migrations. Does not insert, alter or delete application records.
begin;
do $contract$
declare table_id regclass := 'public.property_creation_receipts'::regclass;
begin
  if not (select relrowsecurity from pg_class where oid = table_id) then
    raise exception 'creation receipts RLS is disabled';
  end if;
  if exists (select 1 from pg_policy where polrelid = table_id) then
    raise exception 'creation receipts unexpectedly allow direct RLS access';
  end if;
  if has_table_privilege('anon', table_id, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES')
    or has_table_privilege('authenticated', table_id, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES')
    or has_any_column_privilege('anon', table_id, 'SELECT,INSERT,UPDATE,REFERENCES')
    or has_any_column_privilege('authenticated', table_id, 'SELECT,INSERT,UPDATE,REFERENCES') then
    raise exception 'creation receipts browser boundary is open';
  end if;
  if has_table_privilege('service_role', table_id, 'DELETE,TRUNCATE') then
    raise exception 'creation receipts allow direct removal';
  end if;
  if not exists (select 1 from pg_constraint where conrelid = table_id and contype = 'p') then
    raise exception 'creation receipt unique identity is missing';
  end if;
  if not exists (select 1 from pg_constraint where conrelid = table_id
    and conname = 'property_creation_receipts_property_fkey'
    and pg_get_constraintdef(oid) like '%ON DELETE SET NULL (property_id)%') then
    raise exception 'creation receipt deletion tombstone FK is missing';
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = table_id
    and tgname = 'property_creation_receipts_guard_update' and tgenabled <> 'D') then
    raise exception 'creation receipt immutable guard is missing';
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.properties'::regclass
    and tgname = 'properties_capture_creation_receipt' and tgenabled <> 'D') then
    raise exception 'legacy replica creation receipt capture is missing';
  end if;
end;
$contract$;
rollback;
