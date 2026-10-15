begin;
create schema if not exists extensions;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions,pg_catalog;
select plan(6);

select ok((select relrowsecurity from pg_class
  where oid='public.lead_redistribution_jobs'::regclass),'worker jobs retain RLS');
select ok(not exists(select 1 from unnest(array['anon','authenticated']) role
  cross join unnest(array['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) permission
  where has_table_privilege(role,'public.lead_redistribution_jobs',permission)),
  'client roles cannot mutate worker jobs through table privileges');
select ok(not exists(select 1 from unnest(array['anon','authenticated']) role
  cross join unnest(array['INSERT','UPDATE','REFERENCES']) permission
  where has_any_column_privilege(role,'public.lead_redistribution_jobs',permission)),
  'column-level grants cannot bypass the worker boundary');
select ok(not exists(select 1 from aclexplode(coalesce((select relacl from pg_class
  where oid='public.lead_redistribution_jobs'::regclass),acldefault('r',
    (select relowner from pg_class where oid='public.lead_redistribution_jobs'::regclass)))) privilege
  where privilege.grantee=0 and privilege.privilege_type in
    ('INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER')),
  'PUBLIC has no direct table mutation grant');
select ok(not exists(select 1 from pg_attribute attribute
  cross join lateral aclexplode(attribute.attacl) privilege
  where attribute.attrelid='public.lead_redistribution_jobs'::regclass
    and attribute.attnum>0 and not attribute.attisdropped and privilege.grantee=0
    and privilege.privilege_type in ('INSERT','UPDATE','REFERENCES')),
  'PUBLIC has no direct column mutation grant');
select ok(not exists(select 1 from unnest(array['SELECT','INSERT','UPDATE','DELETE']) permission
  where not has_table_privilege('service_role','public.lead_redistribution_jobs',permission)),
  'trusted backend retains its worker read and write privileges');

select * from finish();
rollback;
