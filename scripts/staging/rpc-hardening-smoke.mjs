import { RPC_CHANGES } from './rpc-hardening-contract.mjs';

const id = "'cf990000-0000-4000-8000-000000000002'::uuid";
const AMBIGUOUS_REBIND = 'rebind_whatsapp_conversation_session(uuid,uuid)';
const literal = value => `'${value.replaceAll("'", "''")}'`;
function deniedCall(signature) {
  const [name, argumentsText] = signature.slice(0,-1).split('(');
  const args = argumentsText ? argumentsText.split(',').map(type => {
    if (type === 'uuid') return id;
    if (type === 'text') return "'rpc-hardening-probe'::text";
    if (type === 'integer') return '1::integer';
    if (type === 'jsonb') return "'{}'::jsonb";
    if (type === 'timestamp with time zone') return "(now()+interval '1 hour')";
    throw new Error('Unreviewed smoke argument type.');
  }) : [];
  return `SELECT public.${name}(${args.join(',')})`;
}
function denialBlock(changes) {
  const exactOidCheck = changes.some(row => row.signature === AMBIGUOUS_REBIND) ? `
    -- The three-argument overload has a default third argument. Direct two-
    -- argument SQL invocation is ambiguous (42725), not a permission probe.
    -- Resolve the exact identity through regprocedure and check effective ACL.
    function_oid := pg_catalog.to_regprocedure('public.${AMBIGUOUS_REBIND}')::oid;
    IF function_oid IS NULL OR pg_catalog.has_function_privilege(current_user,function_oid,'EXECUTE') IS DISTINCT FROM false THEN
      RAISE EXCEPTION 'rpc_smoke_rebind_two_arg_exact_oid_permission_denied';
    END IF;
` : '';
  const invocable = changes.filter(row => row.signature !== AMBIGUOUS_REBIND);
  return `DO $rpc_denials$
DECLARE call_sql text; synthetic_user uuid; function_oid oid;
BEGIN
  FOREACH synthetic_user IN ARRAY ARRAY['cf910000-0000-4000-8000-000000000001'::uuid,'cf910000-0000-4000-8000-000000000002'::uuid] LOOP
    PERFORM set_config('request.jwt.claim.sub',synthetic_user::text,true);
    PERFORM set_config('request.jwt.claim.role',current_user,true);
    PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',synthetic_user,'role',current_user)::text,true);
${exactOidCheck}
    FOREACH call_sql IN ARRAY ARRAY[${invocable.map(row => literal(deniedCall(row.signature))).join(',\n')}] LOOP
      BEGIN
        EXECUTE call_sql;
        RAISE EXCEPTION 'rpc_smoke_expected_permission_denied';
      EXCEPTION WHEN insufficient_privilege THEN NULL;
      END;
    END LOOP;
  END LOOP;
END $rpc_denials$;
`;
}

export function rpcHardeningSmoke() {
  return `
-- Synthetic SQL-only rehearsal: complete transaction always ends in ROLLBACK.
-- No credentials, HTTP calls, worker invocation, provider IDs or disabled triggers.
-- First prove global maintenance can run without scanning existing business rows.
DO $rpc_empty_fixture_guard$ BEGIN
  IF EXISTS(SELECT 1 FROM public.organizations) OR EXISTS(SELECT 1 FROM public.leads)
     OR EXISTS(SELECT 1 FROM public.automations) OR EXISTS(SELECT 1 FROM public.automation_executions)
     OR EXISTS(SELECT 1 FROM public.automation_event_outbox) OR EXISTS(SELECT 1 FROM public.automation_effect_dispatches)
     OR EXISTS(SELECT 1 FROM public.financial_entries) OR EXISTS(SELECT 1 FROM public.gamification_seasons) THEN
    RAISE EXCEPTION 'rpc_smoke_requires_empty_business_domain';
  END IF;
END $rpc_empty_fixture_guard$;
SET LOCAL ROLE service_role;
DO $rpc_service_empty$
BEGIN
  PERFORM set_config('request.jwt.claim.role','service_role',true);
  PERFORM set_config('request.jwt.claim.sub','',true);
  PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);
  IF public.cancel_disabled_automation_runtime(1) IS DISTINCT FROM
       '{"executions_cancelled":0,"steps_cancelled":0,"events_dead_lettered":0}'::jsonb
     OR (SELECT count(*) FROM public.release_due_automation_delays(1)) IS DISTINCT FROM 0
     OR public.recover_stuck_executions(10) IS DISTINCT FROM 0
     OR (SELECT count(*) FROM public.get_sla_pending_leads()) IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'rpc_smoke_unexpected_global_rows';
  END IF;
  PERFORM public.mark_overdue_financial_entries();
  PERFORM public.notify_financial_entries();
  IF public.try_acquire_execution_step_lock(${id},300) IS NOT NULL THEN
    RAISE EXCEPTION 'rpc_smoke_unexpected_execution_lock';
  END IF;
  PERFORM public.release_execution_step_lock(${id},'rpc-hardening-probe');
  IF public.enter_automation_delay_wait(${id},${id},${id},'probe','probe',now()+interval '1 hour') IS DISTINCT FROM false
     OR (public.start_automation_execution_from_event(${id},${id},${id},${id},NULL,'probe','{}')->>'status') IS DISTINCT FROM 'invalid_event'
     OR (public.reserve_automation_external_effect(${id},${id},'probe','probe','rpc-hardening-probe','probe','{}')->>'status') IS DISTINCT FROM 'execution_not_running'
     OR (public.resume_automation_delay(${id},${id},'elapsed',NULL,'{}',NULL,NULL)->>'status') IS DISTINCT FROM 'not_waiting' THEN
    RAISE EXCEPTION 'rpc_smoke_nonexistent_execution_behavior_changed';
  END IF;
  -- Existing DRE business authorization is preserved; this checks entry, not CRUD success.
  BEGIN
    PERFORM public.copy_default_dre_groups(NULL);
    RAISE EXCEPTION 'rpc_smoke_expected_existing_dre_input_guard';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM<>'org_id is required' THEN RAISE; END IF;
  END;
END $rpc_service_empty$;
RESET ROLE;

INSERT INTO auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
VALUES ('cf910000-0000-4000-8000-000000000001','authenticated','authenticated','rpc-hardening-a@example.invalid','',now(),'{}','{"name":"RPC Smoke A"}',now(),now()),
       ('cf910000-0000-4000-8000-000000000002','authenticated','authenticated','rpc-hardening-b@example.invalid','',now(),'{}','{"name":"RPC Smoke B"}',now(),now());
INSERT INTO public.organizations(id,name,slug,is_active,subscription_status,trial_ends_at,checkout_token)
VALUES ('cf920000-0000-4000-8000-000000000001','RPC Smoke Org A','rpc-smoke-org-a',true,'trial',now()+interval '1 day',NULL),
       ('cf920000-0000-4000-8000-000000000002','RPC Smoke Org B','rpc-smoke-org-b',true,'trial',now()+interval '1 day',NULL);
UPDATE public.users SET organization_id=CASE id
  WHEN 'cf910000-0000-4000-8000-000000000001'::uuid THEN 'cf920000-0000-4000-8000-000000000001'::uuid
  ELSE 'cf920000-0000-4000-8000-000000000002'::uuid END
WHERE id IN ('cf910000-0000-4000-8000-000000000001','cf910000-0000-4000-8000-000000000002');
INSERT INTO public.automations(id,organization_id,name,trigger_type,is_active)
VALUES ('cf930000-0000-4000-8000-000000000001','cf920000-0000-4000-8000-000000000001','RPC Smoke A','manual',false),
       ('cf930000-0000-4000-8000-000000000002','cf920000-0000-4000-8000-000000000002','RPC Smoke B','manual',false);
INSERT INTO public.automation_executions(id,automation_id,organization_id,status,completed_at)
VALUES ('cf940000-0000-4000-8000-000000000001','cf930000-0000-4000-8000-000000000001','cf920000-0000-4000-8000-000000000001','completed',now()),
       ('cf940000-0000-4000-8000-000000000002','cf930000-0000-4000-8000-000000000002','cf920000-0000-4000-8000-000000000002','completed',now());
INSERT INTO public.automation_effect_dispatches(id,organization_id,execution_id,node_key,effect_key,effect_type)
VALUES ('cf950000-0000-4000-8000-000000000001','cf920000-0000-4000-8000-000000000001','cf940000-0000-4000-8000-000000000001','probe','rpc-hardening-effect-a','synthetic'),
       ('cf950000-0000-4000-8000-000000000002','cf920000-0000-4000-8000-000000000002','cf940000-0000-4000-8000-000000000002','probe','rpc-hardening-effect-b','synthetic');
INSERT INTO public.automation_event_outbox(id,organization_id,event_type,aggregate_type,aggregate_id,dedupe_key,status,locked_by,locked_at)
VALUES ('cf960000-0000-4000-8000-000000000001','cf920000-0000-4000-8000-000000000001','manual','synthetic','cf990000-0000-4000-8000-000000000001','rpc-hardening-event-a','processing','rpc-hardening-worker',now()),
       ('cf960000-0000-4000-8000-000000000002','cf920000-0000-4000-8000-000000000002','manual','synthetic','cf990000-0000-4000-8000-000000000002','rpc-hardening-event-b','processing','rpc-hardening-worker',now());

-- Two real synthetic profile/organization pairs; SQL JWT context is simulated.
-- Function permissions must deny execution before their bodies see arguments.
SET LOCAL ROLE anon;
${denialBlock(RPC_CHANGES)}
RESET ROLE;
SET LOCAL ROLE authenticated;
${denialBlock(RPC_CHANGES)}
RESET ROLE;
SET LOCAL ROLE service_role;
${denialBlock(RPC_CHANGES.filter(row => row.decision === 'retired'))}
DO $rpc_service_fixtures$ BEGIN
  PERFORM set_config('request.jwt.claim.sub','',true);
  PERFORM set_config('request.jwt.claim.role','service_role',true);
  PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);
  IF public.complete_automation_event('cf960000-0000-4000-8000-000000000001','rpc-hardening-worker') IS DISTINCT FROM true
     OR public.fail_automation_event('cf960000-0000-4000-8000-000000000002','rpc-hardening-worker','synthetic',30) IS DISTINCT FROM true
     OR public.finish_automation_external_effect('rpc-hardening-effect-a','succeeded','{"synthetic":true}',NULL,NULL) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'rpc_smoke_service_worker_transition_failed';
  END IF;
  PERFORM public.get_or_create_active_season('cf920000-0000-4000-8000-000000000001');
END $rpc_service_fixtures$;
RESET ROLE;
DO $rpc_assert_fixtures$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.automation_event_outbox WHERE id='cf960000-0000-4000-8000-000000000001' AND status='completed' AND locked_by IS NULL)
     OR NOT EXISTS(SELECT 1 FROM public.automation_event_outbox WHERE id='cf960000-0000-4000-8000-000000000002' AND status='failed' AND locked_by IS NULL)
     OR NOT EXISTS(SELECT 1 FROM public.automation_effect_dispatches WHERE effect_key='rpc-hardening-effect-a' AND status='succeeded' AND response='{"synthetic":true}'::jsonb)
     OR NOT EXISTS(SELECT 1 FROM public.automation_effect_dispatches WHERE effect_key='rpc-hardening-effect-b' AND status='sending' AND response='{}'::jsonb)
     OR (SELECT count(*) FROM public.gamification_seasons WHERE organization_id='cf920000-0000-4000-8000-000000000001')<>1
     OR EXISTS(SELECT 1 FROM public.gamification_seasons WHERE organization_id='cf920000-0000-4000-8000-000000000002') THEN
    RAISE EXCEPTION 'rpc_smoke_synthetic_transition_or_tenant_sibling_changed';
  END IF;
  IF (SELECT count(*) FROM vimob_cloud_staging.phase_history WHERE run_id='f7196a56-e7bb-4221-b61d-f3a95245338c')<>35 THEN
    RAISE EXCEPTION 'rpc_smoke_original_ledger_changed';
  END IF;
END $rpc_assert_fixtures$;
SELECT 'rpc_hardening_sql_rehearsal_passed_rollback_follows' AS result,
  'rebind(uuid,uuid): exact-OID ACL checked; direct invocation unavailable due to ambiguous defaulted overload' AS probe_limitation;
`;
}
