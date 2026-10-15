-- Worker jobs are backend state. Production's default ALL table grants plus
-- its authenticated membership policy otherwise let a client change both
-- business deadlines and technical retry clocks. Keep existing SELECT/RLS
-- behavior and service_role privileges; remove only direct client mutations.
do $restrict_worker_job_mutations$
declare
  jobs oid:=to_regclass('public.lead_redistribution_jobs');
  columns text;
begin
  if jobs is null or not exists(select 1 from pg_class relation
    where relation.oid=jobs and relation.relkind='r' and relation.relrowsecurity) then
    raise exception using errcode='55000',message='worker_jobs_missing_rls_boundary';
  end if;
  if exists(select 1 from unnest(array['SELECT','INSERT','UPDATE','DELETE']) permission
    where not has_table_privilege('service_role',jobs,permission)) then
    raise exception using errcode='55000',message='worker_jobs_missing_service_role_privileges';
  end if;
  revoke insert,update,delete,truncate,references,trigger
    on table public.lead_redistribution_jobs from public,anon,authenticated;
  -- Column grants survive a table-level REVOKE. Revoke only the three
  -- mutating column privileges, retaining any column-level SELECT grant.
  select string_agg(format('%I',attribute.attname),',' order by attribute.attnum)
  into columns from pg_attribute attribute where attribute.attrelid=jobs
    and attribute.attnum>0 and not attribute.attisdropped;
  execute format('revoke insert (%s),update (%s),references (%s) on table public.lead_redistribution_jobs from public,anon,authenticated',
    columns,columns,columns);
  -- Check effective privileges, including grants inherited from another role.
  -- Unexpected inherited authority needs review instead of a silent bypass.
  if exists(select 1 from unnest(array['anon','authenticated']) role
    cross join unnest(array['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) permission
    where has_table_privilege(role,jobs,permission))
    or exists(select 1 from unnest(array['anon','authenticated']) role
      cross join unnest(array['INSERT','UPDATE','REFERENCES']) permission
      where has_any_column_privilege(role,jobs,permission)) then
    raise exception using errcode='55000',message='worker_jobs_client_mutation_privilege_remains';
  end if;
  if exists(select 1 from unnest(array['SELECT','INSERT','UPDATE','DELETE']) permission
    where not has_table_privilege('service_role',jobs,permission)) then
    raise exception using errcode='55000',message='worker_jobs_service_role_privileges_changed';
  end if;
end;
$restrict_worker_job_mutations$;
