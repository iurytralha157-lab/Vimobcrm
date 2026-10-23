-- Offline-prepared synthetic SQL smoke. Root executes only in the selected staging project.
-- Submit this complete file with execute_sql, not apply_migration: no migration ledger entry.
-- No HTTP JWT is forged or used. Claims below model Data API context inside this transaction.
-- No provider credentials, grant changes, disabled triggers/RLS or new SECURITY DEFINER helpers.
-- SQL RLS/trigger/broadcast checks do not prove Auth HTTP, Storage upload or WebSocket E2E.
BEGIN;
SET LOCAL statement_timeout = '90s';
SET LOCAL lock_timeout = '5s';
SET LOCAL transaction_timeout = '120s';
SET LOCAL search_path = pg_catalog;
SET LOCAL standard_conforming_strings = on;

DO $preflight$
DECLARE actor text;
BEGIN
  IF current_user <> 'postgres' OR current_database() <> 'postgres'
     OR (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'cloud_smoke_requires_postgres_non_superuser';
  END IF;
  IF (SELECT count(*) FROM vimob_cloud_staging.sentinel) <> 1 OR NOT EXISTS (
    SELECT 1 FROM vimob_cloud_staging.sentinel WHERE singleton
      AND project_ref = 'lfkfuhvjvqgwyikzcfep'
      AND run_id = 'f7196a56-e7bb-4221-b61d-f3a95245338c'::uuid
      AND baseline_id = 'local-20261016-238-v1'
      AND source_chain_sha256 = '48dd4fdc5f5dcfbaf08d514cb66167a8c5366542afd016b9027d3758196ad22c'
  ) THEN RAISE EXCEPTION 'cloud_smoke_staging_identity_mismatch'; END IF;
  IF (SELECT count(*) FROM vimob_cloud_staging.phase_history
      WHERE run_id = 'f7196a56-e7bb-4221-b61d-f3a95245338c') <> 35
     OR (SELECT count(DISTINCT ordinal) FROM vimob_cloud_staging.phase_history
         WHERE run_id = 'f7196a56-e7bb-4221-b61d-f3a95245338c' AND ordinal BETWEEN 0 AND 34) <> 35
     OR NOT EXISTS (SELECT 1 FROM vimob_cloud_staging.phase_history
       WHERE run_id = 'f7196a56-e7bb-4221-b61d-f3a95245338c'
         AND ordinal = 34 AND phase_name = '40-forward-20261019230804.sql') THEN
    RAISE EXCEPTION 'cloud_smoke_requires_fifteen_baseline_and_twenty_forward_phases';
  END IF;
  IF NOT has_table_privilege('postgres', 'auth.users', 'INSERT')
     OR NOT has_table_privilege('postgres', 'auth.sessions', 'INSERT')
     OR NOT has_table_privilege('postgres', 'auth.sessions', 'DELETE') THEN
    RAISE EXCEPTION 'cloud_smoke_requires_existing_native_auth_fixture_dml';
  END IF;
  IF EXISTS (SELECT 1 FROM auth.users WHERE id IN (
      'cf110000-0000-4000-8000-000000000001', 'cf110000-0000-4000-8000-000000000002'))
     OR EXISTS (SELECT 1 FROM public.organizations WHERE id IN (
      'cf220000-0000-4000-8000-000000000001', 'cf220000-0000-4000-8000-000000000002')) THEN
    RAISE EXCEPTION 'cloud_smoke_fixture_identity_already_exists';
  END IF;
  FOREACH actor IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF NOT has_schema_privilege(actor, 'public', 'USAGE')
       OR NOT has_schema_privilege(actor, 'private', 'USAGE')
       OR has_schema_privilege(actor, 'public', 'CREATE')
       OR has_schema_privilege(actor, 'private', 'CREATE') THEN
      RAISE EXCEPTION 'cloud_smoke_schema_privilege_contract_failed';
    END IF;
  END LOOP;
  IF NOT has_function_privilege('authenticated', 'private.has_active_lead_read_session()', 'EXECUTE')
     OR has_function_privilege('anon', 'private.has_active_lead_read_session()', 'EXECUTE')
     OR has_function_privilege('service_role', 'private.has_active_lead_read_session()', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'private.can_receive_whatsapp_broadcast(text)', 'EXECUTE')
     OR has_function_privilege('anon', 'private.can_receive_whatsapp_broadcast(text)', 'EXECUTE')
     OR has_table_privilege('authenticated', 'auth.sessions', 'SELECT') THEN
    RAISE EXCEPTION 'cloud_smoke_helper_or_auth_session_grants_failed';
  END IF;
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'realtime' AND tablename = 'messages'
      AND policyname IN ('whatsapp_authorized_private_broadcast', 'whatsapp_broadcast_requires_active_session')) <> 2
     OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'realtime' AND tablename = 'messages'
       AND policyname = 'whatsapp_broadcast_requires_active_session' AND permissive = 'RESTRICTIVE'
       AND cmd = 'SELECT' AND roles = ARRAY['authenticated']::name[]) THEN
    RAISE EXCEPTION 'cloud_smoke_realtime_policy_contract_failed';
  END IF;
END $preflight$;

-- Use the real Auth trigger: do not insert application profiles manually.
INSERT INTO auth.users (id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES
  ('cf110000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
   'cloud-smoke-a@example.invalid', '', now(), '{}', '{"name":"Cloud Smoke A"}', now(), now()),
  ('cf110000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
   'cloud-smoke-b@example.invalid', '', now(), '{}', '{"name":"Cloud Smoke B"}', now(), now());
DO $auth_trigger$
BEGIN
  IF (SELECT count(*) FROM public.users WHERE id IN (
      'cf110000-0000-4000-8000-000000000001', 'cf110000-0000-4000-8000-000000000002')
      AND role = 'user' AND is_active AND organization_id IS NULL) <> 2 THEN
    RAISE EXCEPTION 'cloud_smoke_auth_trigger_did_not_create_safe_profiles';
  END IF;
END $auth_trigger$;

-- A live trial with no checkout capability/provider IDs; normal domain triggers remain active.
INSERT INTO public.organizations (id, name, slug, is_active, subscription_status, trial_ends_at, checkout_token)
VALUES
  ('cf220000-0000-4000-8000-000000000001', 'Cloud Smoke Org A', 'cloud-smoke-org-a', true, 'trial', now() + interval '1 day', NULL),
  ('cf220000-0000-4000-8000-000000000002', 'Cloud Smoke Org B', 'cloud-smoke-org-b', true, 'trial', now() + interval '1 day', NULL);
-- This real profile trigger creates ordinary memberships; no duplicate/fabricated roster insert.
UPDATE public.users SET organization_id = CASE id
  WHEN 'cf110000-0000-4000-8000-000000000001' THEN 'cf220000-0000-4000-8000-000000000001'::uuid
  ELSE 'cf220000-0000-4000-8000-000000000002'::uuid END
WHERE id IN ('cf110000-0000-4000-8000-000000000001', 'cf110000-0000-4000-8000-000000000002');
DO $membership$
BEGIN
  IF (SELECT count(*) FROM public.organization_members m JOIN public.users u ON u.id = m.user_id
      WHERE u.id IN ('cf110000-0000-4000-8000-000000000001', 'cf110000-0000-4000-8000-000000000002')
        AND m.organization_id = u.organization_id AND m.role = 'user' AND m.is_active
        AND m.deleted_at IS NULL AND m.membership_generation = 1) <> 2 THEN
    RAISE EXCEPTION 'cloud_smoke_membership_trigger_contract_failed';
  END IF;
END $membership$;
INSERT INTO public.organization_modules (organization_id, module_name, is_enabled)
VALUES ('cf220000-0000-4000-8000-000000000001', 'whatsapp', true),
       ('cf220000-0000-4000-8000-000000000002', 'whatsapp', true)
ON CONFLICT (organization_id, module_name) DO UPDATE SET is_enabled = true;
INSERT INTO auth.sessions (id, user_id, created_at, updated_at)
VALUES ('cf440000-0000-4000-8000-000000000001', 'cf110000-0000-4000-8000-000000000001', now(), now()),
       ('cf440000-0000-4000-8000-000000000002', 'cf110000-0000-4000-8000-000000000002', now(), now());
INSERT INTO public.leads (id, organization_id, assigned_user_id, name, source)
VALUES ('cf330000-0000-4000-8000-000000000001', 'cf220000-0000-4000-8000-000000000001', 'cf110000-0000-4000-8000-000000000001', 'Synthetic Lead A', 'manual'),
       ('cf330000-0000-4000-8000-000000000002', 'cf220000-0000-4000-8000-000000000002', 'cf110000-0000-4000-8000-000000000002', 'Synthetic Lead B', 'manual');
INSERT INTO public.lead_attachments (id, lead_id, created_by, file_name, file_url)
VALUES ('cf550000-0000-4000-8000-000000000001', 'cf330000-0000-4000-8000-000000000001', 'cf110000-0000-4000-8000-000000000001', 'smoke-a.txt', 'https://files.example.invalid/smoke-a.txt'),
       ('cf550000-0000-4000-8000-000000000002', 'cf330000-0000-4000-8000-000000000002', 'cf110000-0000-4000-8000-000000000002', 'smoke-b.txt', 'https://files.example.invalid/smoke-b.txt');
INSERT INTO public.activities (id, organization_id, lead_id, user_id, type, content, metadata)
VALUES ('cf660000-0000-4000-8000-000000000001', 'cf220000-0000-4000-8000-000000000001', 'cf330000-0000-4000-8000-000000000001', 'cf110000-0000-4000-8000-000000000001', 'note', 'Synthetic note A', '{}'),
       ('cf660000-0000-4000-8000-000000000002', 'cf220000-0000-4000-8000-000000000002', 'cf330000-0000-4000-8000-000000000002', 'cf110000-0000-4000-8000-000000000002', 'note', 'Synthetic note B', '{}');

-- Supported native writer, with SQL visibility checked below. ROLLBACK prevents durable broadcasts.
SELECT realtime.send('{"kind":"cloud_sql_smoke"}', 'cloud_sql_smoke', 'whatsapp:cf220000-0000-4000-8000-000000000001:inbox', true);
SELECT realtime.send('{"kind":"cloud_sql_smoke"}', 'cloud_sql_smoke', 'whatsapp:cf220000-0000-4000-8000-000000000001:lead:cf330000-0000-4000-8000-000000000001', true);
SELECT realtime.send('{"kind":"cloud_sql_smoke"}', 'cloud_sql_smoke', 'whatsapp:cf220000-0000-4000-8000-000000000002:inbox', true);

SET LOCAL ROLE authenticated;
DO $actor_a_live$
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', 'cf110000-0000-4000-8000-000000000001', true);
  PERFORM set_config('request.jwt.claims', '{"sub":"cf110000-0000-4000-8000-000000000001","role":"authenticated","session_id":"cf440000-0000-4000-8000-000000000001","amr":[{"method":"password"}]}', true);
  IF current_user <> 'authenticated' OR NOT private.has_active_lead_read_session() THEN
    RAISE EXCEPTION 'cloud_smoke_live_session_positive_control_failed';
  END IF;
  IF (SELECT count(id) FROM public.leads WHERE id = 'cf330000-0000-4000-8000-000000000001') <> 1
     OR (SELECT count(id) FROM public.leads WHERE id = 'cf330000-0000-4000-8000-000000000002') <> 0
     OR (SELECT count(id) FROM public.lead_attachments WHERE id = 'cf550000-0000-4000-8000-000000000001') <> 1
     OR (SELECT count(id) FROM public.lead_attachments WHERE id = 'cf550000-0000-4000-8000-000000000002') <> 0
     OR (SELECT count(id) FROM public.activities WHERE id = 'cf660000-0000-4000-8000-000000000001') <> 1
     OR (SELECT count(id) FROM public.activities WHERE id = 'cf660000-0000-4000-8000-000000000002') <> 0 THEN
    RAISE EXCEPTION 'cloud_smoke_actor_a_own_or_cross_tenant_read_failed';
  END IF;
  IF NOT private.can_receive_whatsapp_broadcast('whatsapp:cf220000-0000-4000-8000-000000000001:inbox')
     OR private.can_receive_whatsapp_broadcast('whatsapp:cf220000-0000-4000-8000-000000000002:inbox') THEN
    RAISE EXCEPTION 'cloud_smoke_topic_helper_tenant_boundary_failed';
  END IF;
  PERFORM set_config('realtime.topic', 'whatsapp:cf220000-0000-4000-8000-000000000001:inbox', true);
  IF (SELECT count(*) FROM realtime.messages WHERE topic = realtime.topic() AND event = 'cloud_sql_smoke') <> 1 THEN
    RAISE EXCEPTION 'cloud_smoke_live_inbox_broadcast_select_failed';
  END IF;
  PERFORM set_config('realtime.topic', 'whatsapp:cf220000-0000-4000-8000-000000000001:lead:cf330000-0000-4000-8000-000000000001', true);
  IF (SELECT count(*) FROM realtime.messages WHERE topic = realtime.topic() AND event = 'cloud_sql_smoke') <> 1 THEN
    RAISE EXCEPTION 'cloud_smoke_live_lead_broadcast_select_failed';
  END IF;
  PERFORM set_config('realtime.topic', 'whatsapp:cf220000-0000-4000-8000-000000000002:inbox', true);
  IF EXISTS (SELECT 1 FROM realtime.messages WHERE topic = realtime.topic() AND event = 'cloud_sql_smoke') THEN
    RAISE EXCEPTION 'cloud_smoke_cross_tenant_broadcast_leak';
  END IF;
END $actor_a_live$;

DO $activity_browser_boundary$
BEGIN
  IF has_table_privilege(current_user, 'public.activities', 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
     OR has_any_column_privilege(current_user, 'public.activities', 'INSERT,UPDATE,REFERENCES')
     OR has_table_privilege(current_user, 'public.activities', 'SELECT') THEN
    RAISE EXCEPTION 'cloud_smoke_activity_acl_boundary_failed';
  END IF;
  BEGIN
    PERFORM content FROM public.activities WHERE id = 'cf660000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'cloud_smoke_activity_content_was_readable';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM metadata FROM public.activities WHERE id = 'cf660000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'cloud_smoke_activity_metadata_was_readable';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO public.activities (id, organization_id, lead_id, user_id, type, content)
    VALUES ('cf660000-0000-4000-8000-000000000099', 'cf220000-0000-4000-8000-000000000001',
      'cf330000-0000-4000-8000-000000000001', 'cf110000-0000-4000-8000-000000000001', 'note', 'Blocked synthetic browser write');
    RAISE EXCEPTION 'cloud_smoke_activity_browser_insert_succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    UPDATE public.activities SET content = 'Blocked synthetic update' WHERE id = 'cf660000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'cloud_smoke_activity_browser_update_succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    DELETE FROM public.activities WHERE id = 'cf660000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'cloud_smoke_activity_browser_delete_succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $activity_browser_boundary$;

RESET ROLE;
DELETE FROM auth.sessions WHERE id = 'cf440000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
DO $actor_a_revoked$
BEGIN
  IF private.has_active_lead_read_session() THEN RAISE EXCEPTION 'cloud_smoke_revoked_session_accepted'; END IF;
  IF EXISTS (SELECT id FROM public.leads WHERE id = 'cf330000-0000-4000-8000-000000000001')
     OR EXISTS (SELECT id FROM public.lead_attachments WHERE id = 'cf550000-0000-4000-8000-000000000001')
     OR EXISTS (SELECT id FROM public.activities WHERE id = 'cf660000-0000-4000-8000-000000000001') THEN
    RAISE EXCEPTION 'cloud_smoke_revoked_session_read_leak';
  END IF;
  PERFORM set_config('realtime.topic', 'whatsapp:cf220000-0000-4000-8000-000000000001:inbox', true);
  IF EXISTS (SELECT 1 FROM realtime.messages WHERE topic = realtime.topic() AND event = 'cloud_sql_smoke') THEN
    RAISE EXCEPTION 'cloud_smoke_revoked_session_realtime_leak';
  END IF;
END $actor_a_revoked$;

DO $actor_b_live$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', 'cf110000-0000-4000-8000-000000000002', true);
  PERFORM set_config('request.jwt.claims', '{"sub":"cf110000-0000-4000-8000-000000000002","role":"authenticated","session_id":"cf440000-0000-4000-8000-000000000002","amr":[{"method":"password"}]}', true);
  IF NOT private.has_active_lead_read_session()
     OR (SELECT count(id) FROM public.leads WHERE id = 'cf330000-0000-4000-8000-000000000002') <> 1
     OR EXISTS (SELECT id FROM public.leads WHERE id = 'cf330000-0000-4000-8000-000000000001')
     OR (SELECT count(id) FROM public.lead_attachments WHERE id = 'cf550000-0000-4000-8000-000000000002') <> 1
     OR EXISTS (SELECT id FROM public.lead_attachments WHERE id = 'cf550000-0000-4000-8000-000000000001')
     OR (SELECT count(id) FROM public.activities WHERE id = 'cf660000-0000-4000-8000-000000000002') <> 1
     OR EXISTS (SELECT id FROM public.activities WHERE id = 'cf660000-0000-4000-8000-000000000001') THEN
    RAISE EXCEPTION 'cloud_smoke_actor_b_positive_or_cross_tenant_control_failed';
  END IF;
  PERFORM set_config('realtime.topic', 'whatsapp:cf220000-0000-4000-8000-000000000002:inbox', true);
  IF (SELECT count(*) FROM realtime.messages WHERE topic = realtime.topic() AND event = 'cloud_sql_smoke') <> 1 THEN
    RAISE EXCEPTION 'cloud_smoke_actor_b_inbox_control_failed';
  END IF;
  PERFORM set_config('request.jwt.claims', '{"sub":"cf110000-0000-4000-8000-000000000002","role":"authenticated","session_id":"cf440000-0000-4000-8000-000000000002","amr":[{"method":"recovery"}]}', true);
  IF private.has_active_lead_read_session()
     OR EXISTS (SELECT id FROM public.leads WHERE id = 'cf330000-0000-4000-8000-000000000002')
     OR EXISTS (SELECT id FROM public.lead_attachments WHERE id = 'cf550000-0000-4000-8000-000000000002')
     OR EXISTS (SELECT id FROM public.activities WHERE id = 'cf660000-0000-4000-8000-000000000002')
     OR EXISTS (SELECT 1 FROM realtime.messages WHERE topic = realtime.topic() AND event = 'cloud_sql_smoke') THEN
    RAISE EXCEPTION 'cloud_smoke_recovery_session_not_isolated';
  END IF;
END $actor_b_live$;

RESET ROLE;
SET LOCAL ROLE anon;
DO $anonymous_boundary$
BEGIN
  BEGIN
    PERFORM id FROM public.leads WHERE id = 'cf330000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'cloud_smoke_anonymous_lead_select_was_granted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM id FROM public.activities WHERE id = 'cf660000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'cloud_smoke_anonymous_activity_select_was_granted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $anonymous_boundary$;
RESET ROLE;

-- No synthetic users, sessions, orgs, internal effects or broadcast rows are committed.
ROLLBACK;
DO $rollback_check$
BEGIN
  IF EXISTS (SELECT 1 FROM auth.users WHERE id IN (
      'cf110000-0000-4000-8000-000000000001', 'cf110000-0000-4000-8000-000000000002'))
     OR EXISTS (SELECT 1 FROM public.organizations WHERE id IN (
      'cf220000-0000-4000-8000-000000000001', 'cf220000-0000-4000-8000-000000000002'))
     OR EXISTS (SELECT 1 FROM auth.sessions WHERE id IN (
      'cf440000-0000-4000-8000-000000000001', 'cf440000-0000-4000-8000-000000000002'))
     OR EXISTS (SELECT 1 FROM public.leads WHERE id IN (
      'cf330000-0000-4000-8000-000000000001', 'cf330000-0000-4000-8000-000000000002'))
     OR EXISTS (SELECT 1 FROM public.lead_attachments WHERE id IN (
      'cf550000-0000-4000-8000-000000000001', 'cf550000-0000-4000-8000-000000000002'))
     OR EXISTS (SELECT 1 FROM public.activities WHERE id IN (
      'cf660000-0000-4000-8000-000000000001', 'cf660000-0000-4000-8000-000000000002', 'cf660000-0000-4000-8000-000000000099'))
     OR EXISTS (SELECT 1 FROM realtime.messages WHERE event = 'cloud_sql_smoke' AND topic IN (
      'whatsapp:cf220000-0000-4000-8000-000000000001:inbox',
      'whatsapp:cf220000-0000-4000-8000-000000000001:lead:cf330000-0000-4000-8000-000000000001',
      'whatsapp:cf220000-0000-4000-8000-000000000002:inbox')) THEN
    RAISE EXCEPTION 'cloud_smoke_rollback_cleanup_failed';
  END IF;
END $rollback_check$;
SELECT jsonb_build_object('result', 'sql_smoke_passed_and_rolled_back',
  'project_ref', 'lfkfuhvjvqgwyikzcfep', 'synthetic_organizations', 2,
  'scope', 'SQL Auth trigger, real-role grants, session liveness, tenant RLS, activity ACL and Realtime policy/send',
  'auth_http_tested', false, 'storage_upload_tested', false, 'websocket_transport_tested', false) AS proof;
