begin;
create schema if not exists extensions;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions,pg_catalog;
select plan(22);

select has_column('public','lead_redistribution_jobs','warning_retry_at','warnings have a separate technical retry clock');
select has_column('public','lead_redistribution_jobs','redistribution_retry_at','transfers have a separate technical retry clock');
select col_type_is('public','lead_redistribution_jobs','warning_retry_at','timestamp with time zone','warning retry has an absolute operational timestamp');
select col_type_is('public','lead_redistribution_jobs','redistribution_retry_at','timestamp with time zone','transfer retry has an absolute operational timestamp');
select ok(not exists(select 1 from pg_attribute where attrelid='public.lead_redistribution_jobs'::regclass
  and attname in ('warning_retry_at','redistribution_retry_at') and attnotnull),'new retry clocks are nullable');
select ok(not exists(select 1 from pg_attribute attribute join pg_attrdef expression
  on expression.adrelid=attribute.attrelid and expression.adnum=attribute.attnum
  where attribute.attrelid='public.lead_redistribution_jobs'::regclass
    and attribute.attname in ('warning_retry_at','redistribution_retry_at')),'existing jobs acquire no synthetic retry deadline');
select ok((select relrowsecurity from pg_class where oid='public.lead_redistribution_jobs'::regclass),'the production job RLS boundary remains enabled');
select ok(not has_table_privilege('anon','public.lead_redistribution_jobs','INSERT,UPDATE,DELETE'),'anonymous clients cannot alter technical retry clocks');
select ok(not has_table_privilege('authenticated','public.lead_redistribution_jobs','INSERT,UPDATE,DELETE'),'authenticated Data API clients cannot alter worker eligibility');
select ok(has_table_privilege('service_role','public.lead_redistribution_jobs','SELECT')
  and has_table_privilege('service_role','public.lead_redistribution_jobs','UPDATE'),'trusted backend retains its existing job access');
select ok(exists(select 1 from pg_policy where polrelid='public.lead_redistribution_jobs'::regclass
  and polname='backend manages lead redistribution jobs' and polroles=array['service_role'::regrole::oid]),
  'the original backend-only job policy is retained');
select has_index('public','lead_redistribution_jobs','idx_lead_redistribution_jobs_retry_due','effective transfer ordering is indexed');
select has_index('public','lead_redistribution_jobs','idx_lead_redistribution_jobs_retry_warning','effective warning ordering is indexed');
select ok((select bool_and(index.indisvalid and index.indisready and not index.indisunique)
  from pg_index index join pg_class relation on relation.oid=index.indexrelid
  where relation.relname in ('idx_lead_redistribution_jobs_retry_due','idx_lead_redistribution_jobs_retry_warning')),
  'both new indexes are usable and introduce no new uniqueness rule');
select ok((select pg_get_indexdef(index.indexrelid) like '%GREATEST(due_at, COALESCE(redistribution_retry_at,%'
  and pg_get_indexdef(index.indexrelid) like '%, id)%'
  and pg_get_expr(index.indpred,index.indrelid) like '%warning_sent%'
  from pg_index index where index.indexrelid='public.idx_lead_redistribution_jobs_retry_due'::regclass),
  'transfer index uses its own retry clock and stable ID tie-break for active jobs');
select ok((select pg_get_indexdef(index.indexrelid) like '%GREATEST(warning_due_at, COALESCE(warning_retry_at,%'
  and pg_get_indexdef(index.indexrelid) like '%, id)%'
  and pg_get_expr(index.indpred,index.indrelid) like '%warning_sent_at IS NULL%'
  from pg_index index where index.indexrelid='public.idx_lead_redistribution_jobs_retry_warning'::regclass),
  'warning index uses its own retry clock for unsent pending warnings');
select ok((select indisunique and indisvalid from pg_index
  where indexrelid='public.idx_lead_redistribution_jobs_one_active'::regclass),
  'the existing one-active-job uniqueness barrier is preserved');
select has_function('private','reset_lead_redistribution_worker_retry_clocks',array[]::text[],
  'reenrollment has one row-level technical eligibility reset');
select ok((select not prosecdef and prorettype='trigger'::regtype and 'search_path=""'=any(proconfig)
  from pg_proc where oid='private.reset_lead_redistribution_worker_retry_clocks()'::regprocedure),
  'retry reset reads no elevated role and pins its search path');
select ok(not exists(select 1 from unnest(array['anon','authenticated','service_role']) role
  where has_function_privilege(role,'private.reset_lead_redistribution_worker_retry_clocks()','EXECUTE')),
  'the reset trigger exposes no executable Data API entry point');
select ok(exists(select 1 from pg_trigger where tgrelid='public.lead_redistribution_jobs'::regclass
  and tgname='trg_reset_lead_redistribution_worker_retry_clocks' and tgenabled='O'
  and (tgtype & 2)=2 and (tgtype & 16)=16 and tgqual is not null),
  'only a guarded before-update row trigger resets technical clocks');
select is((select array_agg(attribute.attname::text order by attribute.attname)
  from pg_trigger trigger join pg_attribute attribute on attribute.attrelid=trigger.tgrelid
    and attribute.attnum=any(trigger.tgattr::smallint[])
  where trigger.tgrelid='public.lead_redistribution_jobs'::regclass
    and trigger.tgname='trg_reset_lead_redistribution_worker_retry_clocks'),
  array['attempt_count','current_assigned_user_id','due_at','enrolled_at','round_robin_id','status','warning_due_at']::text[],
  'technical retry-only and updated-at-only writes do not invoke the reset');
select * from finish();
rollback;
