begin;
-- Native PostgreSQL does not pre-create Supabase's extension schema/path.
create schema if not exists extensions;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions,pg_catalog;
select plan(32);

select has_function('private','is_round_robin_rotation_assignment_reason',array['text'],
  'confirmed assignment reasons have one SQL contract');
select ok((select bool_and(private.is_round_robin_rotation_assignment_reason(reason))
  from unnest(array['canonical_round_robin','auto_redistribution','round_robin',
    'meta_lead_ads','grupo_olx']) reason),'canonical, manual, worker and legacy assignments establish a baseline');
select ok((select bool_and(private.is_round_robin_rotation_assignment_reason(reason) is false)
  from unnest(array['keep_assignee','reentry_preserved','no_available_members',
    'no_matching_queue','diagnostic','',null]::text[]) reason),
  'diagnostics and missing reasons cannot establish a baseline');
select ok(not exists(select 1 from unnest(array['anon','authenticated']) role
  where has_function_privilege(role,'private.is_round_robin_rotation_assignment_reason(text)','EXECUTE'))
  and has_function_privilege('service_role','private.is_round_robin_rotation_assignment_reason(text)','EXECUTE'),
  'only the trusted backend can call the reason predicate');
select ok((select not prosecdef and provolatile='i' and proparallel='s'
  and 'search_path=""'=any(proconfig) from pg_proc
  where oid='private.is_round_robin_rotation_assignment_reason(text)'::regprocedure),
  'the reason predicate is immutable, invoker and has no implicit search path');

select has_table('private','round_robin_rotation_state','rotation is scoped outside the Data API');
select ok((select relrowsecurity from pg_class
  where oid='private.round_robin_rotation_state'::regclass),'rotation state has RLS');
select ok(exists(select 1 from pg_constraint where conrelid='private.round_robin_rotation_state'::regclass
  and contype='p' and pg_get_constraintdef(oid)='PRIMARY KEY (organization_id, lead_id, round_robin_id)'),
  'state key isolates organization, lead and queue');
select ok(not exists(select 1 from unnest(array['anon','authenticated','service_role']) role
  where has_table_privilege(role,'private.round_robin_rotation_state','SELECT,INSERT,UPDATE,DELETE')),
  'Data API roles cannot inspect or mutate visits');
select has_table('private','round_robin_rotation_assignment_context','actual transfer context is bounded per lead');
select ok((select relrowsecurity from pg_class
  where oid='private.round_robin_rotation_assignment_context'::regclass),'transfer context has RLS');
select ok(not exists(select 1 from unnest(array['anon','authenticated','service_role']) role
  where has_table_privilege(role,'private.round_robin_rotation_assignment_context','SELECT,INSERT,UPDATE,DELETE')),
  'Data API roles cannot forge previous owners');
select has_function('private','preview_round_robin_redistribution_candidate',
  array['uuid','uuid','uuid','uuid','uuid','timestamp with time zone'],'shared preview has the backend contract');
select ok(not exists(select 1 from pg_proc procedure join pg_namespace ns on ns.oid=procedure.pronamespace
  cross join unnest(array['anon','authenticated','service_role']) role
  where ns.nspname='private' and procedure.proname in ('round_robin_rotation_candidates',
    'pick_round_robin_rotation_candidate','preview_round_robin_redistribution_candidate',
    'capture_round_robin_rotation_assignment','record_round_robin_rotation_assignment')
    and has_function_privilege(role,procedure.oid,'EXECUTE')
    and not (role='service_role' and procedure.proname='preview_round_robin_redistribution_candidate')),
  'only the trusted backend preview crosses the owner boundary');
select ok(has_function_privilege('service_role',
  'private.preview_round_robin_redistribution_candidate(uuid,uuid,uuid,uuid,uuid,timestamptz)','EXECUTE'),
  'trusted API database role can call the shared preview');
select ok(not exists(select 1 from pg_proc procedure join pg_namespace ns on ns.oid=procedure.pronamespace
  where ns.nspname='private' and procedure.proname in ('round_robin_rotation_candidates',
    'pick_round_robin_rotation_candidate','preview_round_robin_redistribution_candidate',
    'capture_round_robin_rotation_assignment','record_round_robin_rotation_assignment')
    and (not procedure.prosecdef or not ('search_path=""'=any(procedure.proconfig)))),
  'privileged helpers pin an empty search path');
select ok((select prosrc like '%weight_groups as%' and prosrc like '%selected_entry as%'
  from pg_proc where oid='private.pick_round_robin_ticket_candidate(uuid,uuid,text,boolean,integer,time,bigint)'::regprocedure),
  'initial IWRR picker remains installed');
select ok((select md5(regexp_replace(prosrc,'\s','','g')) in (
    'edddcafa5ab820c1c300845d8794a3b9','102c45eba33b8b1b060f79e01729b2d2')
  from pg_proc where oid='private.pick_round_robin_ticket_candidate(uuid,uuid,text,boolean,integer,time,bigint)'::regprocedure),
  'the audited initial picker is preserved without a whole-body replacement');
select ok((select prosecdef and prorettype='jsonb'::regtype
  and 'search_path=""'=any(proconfig) and prosrc like '%for no key update%'
  from pg_proc where oid='private.distribute_lead(uuid,uuid,text,uuid,boolean,text,timestamptz)'::regprocedure),
  'either audited canonical predecessor retains its security and lead-lock contract');
select ok((select prosrc like '%private.next_round_robin_ticket(v_queue.id)%'
  and prosrc like '%private.preview_round_robin_redistribution_candidate(%'
  and prosrc like '%v_ticket := null;%'
  from pg_proc where oid='private.distribute_lead(uuid,uuid,text,uuid,boolean,text,timestamptz)'::regprocedure),
  'canonical initial and redistribution paths retain independent slot sources');
select ok((select prosrc like '%private.is_round_robin_rotation_assignment_reason(new.reason)%'
  and prosrc like '%errcode=''40001''%'
  and prosrc like '%round_robin_rotation_candidate_changed%'
  from pg_proc where oid='private.record_round_robin_rotation_assignment()'::regprocedure),
  'confirmed log guard rejects an obsolete replica selection');
select ok((select prosrc like '%pg_current_xact_id()%'
  and prosrc like '%old.assigned_user_id%' and prosrc like '%old.team_id%'
  from pg_proc where oid='private.capture_round_robin_rotation_assignment()'::regprocedure),
  'previous owner is captured from the actual transaction rather than untrusted metadata');
select ok((select prosrc like '%for no key update%'
  from pg_proc where oid='private.preview_round_robin_redistribution_candidate(uuid,uuid,uuid,uuid,uuid,timestamptz)'::regprocedure),
  'preview serializes assignments without upgrading attribution foreign-key locks');
select ok((select prosrc not like '%round_no=%' and prosrc not like '%insert into public.round_robin_logs%'
  from pg_proc where oid='private.preview_round_robin_redistribution_candidate(uuid,uuid,uuid,uuid,uuid,timestamptz)'::regprocedure),
  'preview does not consume the next round or emit a confirmed assignment');
select ok(exists(select 1 from pg_trigger where tgrelid='public.leads'::regclass
  and tgname='trg_capture_round_robin_rotation_assignment' and tgenabled='O' and (tgtype & 2)=2),
  'owner context is captured before the lead update');
select ok(exists(select 1 from pg_trigger where tgrelid='public.round_robin_logs'::regclass
  and tgname='trg_record_round_robin_rotation_assignment' and tgenabled='O' and (tgtype & 4)=4),
  'a confirmed inserted log is the transactional consumption boundary');
select is((select count(*) from private.preview_round_robin_redistribution_candidate(
  gen_random_uuid(),gen_random_uuid(),gen_random_uuid())),0::bigint,
  'unknown organization and lead return no candidate');
select is((select count(*) from private.preview_round_robin_redistribution_candidate(
  null,null,null)),0::bigint,'null scope never creates a cross-tenant candidate');
select ok((select prosrc like '%private.is_round_robin_rotation_assignment_reason(log.reason)%'
  from pg_proc where oid='private.preview_round_robin_redistribution_candidate(uuid,uuid,uuid,uuid,uuid,timestamptz)'::regprocedure),
  'cold resume uses the shared confirmed-assignment reason contract');
select ok((select prosrc like '%private.is_round_robin_rotation_assignment_reason(prior.reason)%'
  from pg_proc where oid='private.distribute_lead(uuid,uuid,text,uuid,boolean,text,timestamptz)'::regprocedure),
  'canonical transfer classification includes the same legacy assignments');
select ok((select prosrc like '%v_lead.assigned_user_id, null%'
  and prosrc not like '%v_lead.assigned_user_id, null, p_now%'
  and prosrc like '%assigned_at = p_now%'
  from pg_proc where oid='private.distribute_lead(uuid,uuid,text,uuid,boolean,text,timestamptz)'::regprocedure),
  'redistribution omits the historical event clock without rewriting event timestamps');
select ok((select prosrc like '%case when v_ticket is null then v_event_id::text end%'
  from pg_proc where oid='private.distribute_lead(uuid,uuid,text,uuid,boolean,text,timestamptz)'::regprocedure),
  'rotation notifications use the durable event identity while initial notification keys stay unchanged');
select * from finish();
rollback;
