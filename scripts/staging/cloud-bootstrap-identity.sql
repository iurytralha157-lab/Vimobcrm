BEGIN;
SET LOCAL statement_timeout='30s';
SET LOCAL lock_timeout='5s';
SET LOCAL transaction_timeout='60s';
DO $guard$ BEGIN
  IF current_database()<>'postgres' OR current_user<>'postgres' OR
    (SELECT rolsuper FROM pg_roles WHERE rolname=current_user) OR current_setting('server_version_num')::integer<170000 THEN
    RAISE EXCEPTION 'staging_bootstrap_role_or_database_mismatch';
  END IF;
  IF to_regnamespace('private') IS NOT NULL OR to_regnamespace('vimob_cloud_staging') IS NOT NULL OR
    EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public') OR
    EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public') THEN
    RAISE EXCEPTION 'staging_bootstrap_requires_empty_project';
  END IF;
  IF to_regclass('auth.users') IS NULL OR to_regclass('storage.objects') IS NULL OR to_regclass('realtime.messages') IS NULL OR
    NOT EXISTS(SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime' AND pg_get_userbyid(pubowner)='postgres' AND NOT puballtables) OR
    EXISTS(SELECT 1 FROM pg_publication_rel r JOIN pg_publication p ON p.oid=r.prpubid WHERE p.pubname='supabase_realtime') THEN
    RAISE EXCEPTION 'staging_bootstrap_native_platform_mismatch';
  END IF;
END $guard$;
CREATE SCHEMA vimob_cloud_staging AUTHORIZATION postgres;
REVOKE ALL ON SCHEMA vimob_cloud_staging FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE vimob_cloud_staging.sentinel(
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  project_ref text NOT NULL CHECK(project_ref='lfkfuhvjvqgwyikzcfep'),
  run_id uuid NOT NULL,
  baseline_id text NOT NULL,
  source_chain_sha256 text NOT NULL CHECK(source_chain_sha256 ~ '^[a-f0-9]{64}$'),
  historical_execution boolean NOT NULL DEFAULT false CHECK(NOT historical_execution),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE vimob_cloud_staging.sentinel ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE vimob_cloud_staging.sentinel FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE vimob_cloud_staging.phase_history(
  run_id uuid NOT NULL,
  phase_name text NOT NULL,
  payload_sha256 text NOT NULL CHECK(payload_sha256 ~ '^[a-f0-9]{64}$'),
  source_chain_sha256 text NOT NULL CHECK(source_chain_sha256 ~ '^[a-f0-9]{64}$'),
  ordinal integer NOT NULL CHECK(ordinal>=0),
  executed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(run_id,phase_name),
  UNIQUE(run_id,ordinal)
);
ALTER TABLE vimob_cloud_staging.phase_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE vimob_cloud_staging.phase_history FROM PUBLIC,anon,authenticated,service_role;
INSERT INTO vimob_cloud_staging.sentinel(singleton,project_ref,run_id,baseline_id,source_chain_sha256)
VALUES(true,'lfkfuhvjvqgwyikzcfep','f7196a56-e7bb-4221-b61d-f3a95245338c'::uuid,'local-20261016-238-v1','48dd4fdc5f5dcfbaf08d514cb66167a8c5366542afd016b9027d3758196ad22c');
COMMIT;
