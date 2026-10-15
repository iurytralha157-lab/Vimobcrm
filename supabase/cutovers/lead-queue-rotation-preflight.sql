-- READ ONLY. Prepared for the reviewed rollout; do not run against production
-- without its separate authorization. Execute with ON_ERROR_STOP and the
-- actual API database role as a separate check. Never invoke preview here:
-- preview may persist the legitimate owner's baseline.
begin read only;
set local statement_timeout='10s';
select current_database() as database_name,current_user as connected_role,
  current_setting('server_version') as server_version;

-- Before this hotfix, the normalized canonical predecessor must be one of the
-- two audited bodies: 63b85de2532566f0f457b126747688e6 (forward fallback) or
-- 9a654223cc6e94f617a13e9d33da27ea (unify + NO KEY UPDATE).
-- The unchanged picker must be edddcafa5ab820c1c300845d8794a3b9 (Sept 22) or
-- 102c45eba33b8b1b060f79e01729b2d2 (installed Sept 20 + direct bypass).
-- A web/API SHA does not prove either database body. Export unknown bodies
-- for review instead of changing the allowlist to bypass this check.
select procedure.oid::regprocedure::text as function_identity,
  md5(regexp_replace(procedure.prosrc,'\s','','g')) as normalized_body_md5,
  procedure.prosecdef as security_definer,procedure.proconfig,
  pg_get_userbyid(procedure.proowner) as function_owner,
  has_function_privilege(current_user,procedure.oid,'EXECUTE') as caller_can_execute,
  has_function_privilege('anon',procedure.oid,'EXECUTE') as anon_can_execute,
  has_function_privilege('authenticated',procedure.oid,'EXECUTE') as authenticated_can_execute,
  has_function_privilege('service_role',procedure.oid,'EXECUTE') as service_role_can_execute,
  has_schema_privilege('service_role','private','USAGE') as service_role_private_usage
from pg_proc procedure where procedure.oid in (
  to_regprocedure('private.distribute_lead(uuid,uuid,text,uuid,boolean,text,timestamptz)'),
  to_regprocedure('private.pick_round_robin_ticket_candidate(uuid,uuid,text,boolean,integer,time,bigint)'),
  to_regprocedure('private.next_round_robin_ticket(uuid)'),
  to_regprocedure('public.distribute_lead_from_backend(uuid,uuid,text,uuid,boolean,text,timestamptz)'),
  to_regprocedure('public.redistribute_lead_from_pool_backend(uuid,uuid,text,uuid,uuid,timestamptz,integer,timestamptz)'),
  to_regprocedure('private.preview_round_robin_redistribution_candidate(uuid,uuid,uuid,uuid,uuid,timestamptz)'),
  to_regprocedure('private.is_round_robin_rotation_assignment_reason(text)'),
  to_regprocedure('private.reset_lead_redistribution_worker_retry_clocks()')
) order by function_identity;

-- Enumerate names instead of resolving only an expected signature: otherwise
-- an old six-argument overload or a missing delegated ticket helper is hidden.
-- Source hashes are metadata; this does not invoke any distribution function.
select namespace.nspname as schema_name,procedure.proname as function_name,
  procedure.oid::regprocedure::text as function_identity,
  pg_get_function_arguments(procedure.oid) as arguments_with_defaults,
  procedure.pronargs as argument_count,procedure.pronargdefaults as default_count,
  count(*) over(partition by namespace.nspname,procedure.proname) as overload_count,
  md5(regexp_replace(procedure.prosrc,'\s','','g')) as normalized_body_md5,
  pg_get_userbyid(procedure.proowner) as function_owner,
  procedure.prosecdef as security_definer,procedure.proconfig
from pg_proc procedure join pg_namespace namespace on namespace.oid=procedure.pronamespace
where (namespace.nspname='private' and procedure.proname in (
  'distribute_lead','pick_round_robin_ticket_candidate','next_round_robin_ticket',
  'ensure_round_robin_ticket_sequence','round_robin_ticket_sequence_name'))
  or (namespace.nspname='public' and procedure.proname in (
    'distribute_lead_from_backend','redistribute_lead_from_pool_backend'))
order by schema_name,function_name,function_identity;

-- Removing the old helper's repeated REVOKEs is safe only if existing ticket
-- sequences already deny these roles. Read catalog ACLs, never sequence values.
-- Helper MD5: 206e6eb1c84b4cd0f702267a2cc3dcce before, 700fe7a982c03a6490a54e78733bc31a
-- for the older ACL-only fix, 04e2f165d04c6806c496e874b1977537 after the guarded cold-creation fix.
select count(*) as ticket_sequence_count,
  count(*) filter(where has_sequence_privilege('anon',sequence.oid,'USAGE,SELECT,UPDATE')) as anon_access_count,
  count(*) filter(where has_sequence_privilege('authenticated',sequence.oid,'USAGE,SELECT,UPDATE')) as authenticated_access_count,
  count(*) filter(where has_sequence_privilege('service_role',sequence.oid,'USAGE,SELECT,UPDATE')) as service_role_access_count,
  count(*) filter(where exists(select 1 from aclexplode(coalesce(sequence.relacl,
    acldefault('S',sequence.relowner))) privilege where privilege.grantee=0)) as public_acl_count
from pg_class sequence join pg_namespace namespace on namespace.oid=sequence.relnamespace
where namespace.nspname='private' and sequence.relkind='S'
  and sequence.relname ~ '^lead_distribution_ticket_[0-9a-f]{32}$';

-- The job table exists before rollout; private rotation tables appear after
-- rollout. Their ACLs must match the migrations; no lead/user data is read.
select namespace.nspname,relation.relname,relation.relrowsecurity,
  has_table_privilege('anon',relation.oid,'SELECT,INSERT,UPDATE,DELETE') as anon_has_access,
  has_table_privilege('authenticated',relation.oid,'SELECT,INSERT,UPDATE,DELETE') as authenticated_has_access,
  has_table_privilege('service_role',relation.oid,'SELECT,INSERT,UPDATE,DELETE') as service_role_has_access
from pg_class relation join pg_namespace namespace on namespace.oid=relation.relnamespace
where (namespace.nspname='private' and relation.relname in
  ('round_robin_rotation_state','round_robin_rotation_assignment_context'))
  or (namespace.nspname='public' and relation.relname='lead_redistribution_jobs')
order by relation.relname;

-- Jobs may retain legacy SELECT policies while their client DML grants are
-- removed. Inspect policies and both table/column privileges; RLS alone does
-- not make worker state backend-only when a membership policy permits ALL.
select policy.polname as policy_name,policy.polcmd,policy.polpermissive,
  array(select role.rolname from pg_roles role where role.oid=any(policy.polroles)) as roles,
  pg_get_expr(policy.polqual,policy.polrelid) as using_expression,
  pg_get_expr(policy.polwithcheck,policy.polrelid) as check_expression
from pg_policy policy where policy.polrelid='public.lead_redistribution_jobs'::regclass
order by policy.polname;
select role,permission,
  has_table_privilege(role,'public.lead_redistribution_jobs',permission) as effective_table_privilege
from unnest(array['anon','authenticated','service_role']) role
cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) permission
order by role,permission;
select role,permission,
  has_any_column_privilege(role,'public.lead_redistribution_jobs',permission) as effective_column_privilege
from unnest(array['anon','authenticated','service_role']) role
cross join unnest(array['SELECT','INSERT','UPDATE','REFERENCES']) permission
order by role,permission;

select attribute.attname as column_name,format_type(attribute.atttypid,attribute.atttypmod) as column_type,
  attribute.attnotnull as not_null,pg_get_expr(expression.adbin,expression.adrelid) as column_default
from pg_attribute attribute left join pg_attrdef expression
  on expression.adrelid=attribute.attrelid and expression.adnum=attribute.attnum
where attribute.attrelid='public.lead_redistribution_jobs'::regclass and not attribute.attisdropped
  and attribute.attname in ('warning_retry_at','redistribution_retry_at')
order by attribute.attname;

-- Existing deduplication constraints participate in the assignment transaction.
-- Inspect their exact expressions, uniqueness and validity, including the
-- notification recipient key that must permit a later legitimate round.
-- This catalog query reads no lead, user or notification records.
select namespace.nspname as schema_name,relation.relname as table_name,
  index_relation.relname as index_name,index.indisunique as is_unique,
  index.indisvalid as is_valid,index.indisready as is_ready,
  pg_get_indexdef(index.indexrelid) as index_definition
from pg_index index
join pg_class relation on relation.oid=index.indrelid
join pg_namespace namespace on namespace.oid=relation.relnamespace
join pg_class index_relation on index_relation.oid=index.indexrelid
where (namespace.nspname='public' and relation.relname='notifications' and index.indisunique)
  or (namespace.nspname='public' and relation.relname='lead_redistribution_jobs')
  or (namespace.nspname='private' and relation.relname in
    ('lead_distribution_events','round_robin_rotation_state','round_robin_rotation_assignment_context')
    and index.indisunique)
order by namespace.nspname,relation.relname,index_relation.relname;

select trigger.tgname,trigger.tgrelid::regclass::text as table_identity,
  trigger.tgenabled,pg_get_triggerdef(trigger.oid) as definition
from pg_trigger trigger where not trigger.tgisinternal
  and trigger.tgrelid in ('public.leads'::regclass,'public.round_robin_logs'::regclass,'public.lead_redistribution_jobs'::regclass)
order by trigger.tgrelid::regclass::text,trigger.tgname;
rollback;
