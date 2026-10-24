-- Staging-only supplement derived from 20261013_prepare_simple_stage_inactivity_index.sql.
-- Canonical SHA256: 10ec8ddce819172012980a8218803bd3b0c1f6093f983a5e937ac799ac15fb4e.
-- CONCURRENTLY and IF NOT EXISTS are removed; the target must be empty and index absent.
-- This is not a canonical migration or a production cutover replay.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';
SET LOCAL transaction_timeout = '45s';
SET LOCAL search_path = pg_catalog;
DO $guard$
BEGIN
  IF current_user <> 'postgres' OR current_database() <> 'postgres'
    OR (SELECT rolsuper FROM pg_roles WHERE rolname=current_user) THEN
    RAISE EXCEPTION 'staging_index_requires_postgres_non_superuser';
  END IF;
  IF (SELECT count(*) FROM vimob_cloud_staging.sentinel) <> 1 OR NOT EXISTS (
    SELECT 1 FROM vimob_cloud_staging.sentinel
    WHERE singleton AND project_ref='lfkfuhvjvqgwyikzcfep'
      AND run_id='f7196a56-e7bb-4221-b61d-f3a95245338c'::uuid
      AND baseline_id='local-20261016-238-v1'
      AND source_chain_sha256='48dd4fdc5f5dcfbaf08d514cb66167a8c5366542afd016b9027d3758196ad22c'
  ) THEN RAISE EXCEPTION 'staging_index_identity_mismatch'; END IF;
END $guard$;
LOCK TABLE public.leads IN SHARE MODE;
DO $preconditions$
BEGIN
  IF EXISTS (
    SELECT 1 FROM (VALUES
('00-extension-proposals.sql','c8ed998379558d72826ad59bc990517e52fa66fb9fb25c83b7bf8583804cb234',0),
('10-domain-001.sql','8ca5c8d8136141199693ac7ac6a7695e3fb59bc4cad5ec8d6465c43f7b6441c3',1),
('10-domain-002.sql','5a92da8f2493b199704bb2e26750b90254c26307f322edac32794b01053c2c80',2),
('10-domain-003.sql','305cdc36d91962818bf54fd6d6e1fe53eecd1c0de454bb67ca8a6d31ca2dd928',3),
('10-domain-004.sql','5877de9f0985afb3adcdc20bda57e43125b3a623650d32fcc756339dd5f8bdf1',4),
('10-domain-005.sql','110b08c0ba6be2d6e702622e4f501629f5881eba60c8d52207fddc4f7eb40567',5),
('10-domain-006.sql','969cff49b928721fe9f45cf2e61c1da05d1cac56b67eda7b0f22d47de2bfab97',6),
('10-domain-007.sql','6cf36533a4a683ad08f122375c26741ac3ad120079eec191c3c1aa869f499b62',7),
('10-domain-008.sql','b363400b0af040dac34438c9bbdcb49a26246ebe54aeaec1e3300620abb3889f',8),
('10-domain-009.sql','64c6e4b4af960d2eaeb5acf3127aa96ee88d3cc4743ad3ccc0f44f500079a2f7',9),
('10-domain-010.sql','e64efa7842f1543a0a964c3ebfa15db59dfd100445d67493ae4e0d15ef1b3eba',10),
('20-auth-overlay.sql','a0d9b13b7cb4767334a0e3d68a346ad19b5422b70134cf2af95e7270fa7d1447',11),
('21-storage-overlays.sql','fdc04f7282dc816f5c1ed70ab0a3d79de852d55a02a840b537f187c283479a6f',12),
('22-realtime-overlays.sql','cf9657270f094fa85eda78ac1328e4e7eff377ca7640c22ca208e4c8f71480b6',13),
('30-static-reference-data.sql','823698f3e8e840f1b8ee6c3709213734de5af1df5c91ee30449476d09e7ca3c1',14),
('40-forward-20261016121216.sql','9049015f8bed27824c1da87cc82b6535ed1c64e9cebe404529600245632f7ace',15),
('40-forward-20261016164738.sql','baff409c6a02d65a9bc2bc81e7ce77019a4f7d5ab9ce05272a86f4f025dab2e1',16),
('40-forward-20261016171117.sql','ae7aa0d841b6e5084f332b6e5ba3be1a726295719edd5a44d1c078b68aa3cfe0',17),
('40-forward-20261016171251.sql','5dd75a631b8392359fce65f162f8d4e77e6fe212a1e545f4dca6ba193ed395c1',18),
('40-forward-20261016171254.sql','4da1b04987410b74a00f5b34aadaabdeb293819e5a3916e606c47798a291aada',19),
('40-forward-20261016171624.sql','7d68b859079504fc3af7ea96084925e8f3e638eafc7cc47cc1b930d0a1ca584a',20),
('40-forward-20261016171628.sql','3e1dd806d9d4157afe36dbcfc38516679fb040cb4f996ce60a2a1a414ce36387',21),
('40-forward-20261016173733.sql','2261bf58aa4771f097c0448ccc07808dced805f6a04148ecfb1f6c5daa7f47bb',22),
('40-forward-20261016175607.sql','dcc4e96f1fa6fddd64b480d2386d2e8b079e93cbc8a6fddbe9ca783ac47a5263',23),
('40-forward-20261016180244.sql','66db158d5bafbbe96b04bb623305727a8cfbfd1744c93b53a827dd6be43aa754',24),
('40-forward-20261016180410.sql','de107e34070594cee52cb104d15daecab247928ea9476a8733ebedd29845b2de',25),
('40-forward-20261016201006.sql','4a2dcef13749a79e7e9c0d1357a90d3441a57995e3cd37722629060db084f9c0',26),
('40-forward-20261016234227.sql','9ec254ce61c6aea7a7d016dc3ac696892b7cfc76798dabf60589589b3c2da0fb',27),
('40-forward-20261017053625.sql','188825dd014588c75bfe939a2562bbc814ab1422bf608cbe6180fc17983f52b7',28),
('40-forward-20261018210058.sql','1e14ea71fffb8256ec55d1ef89465aa6c739ba4ee690d0b77f262bd6bb035777',29),
('40-forward-20261018222847.sql','7ca1bfe31d78519c1531a0c042d80be49974bdccb7c74a1135e90e7cf586b141',30),
('40-forward-20261019214356.sql','ebdcc9ff49d832237de4f972351ec1ea7901de491ab1b7b82f6ccfcbece2ce02',31),
('40-forward-20261019222441.sql','9e187600cb17f08de1c1f397f629b5ea93dc7649c76bcbe72a067d52f6e451f7',32),
('40-forward-20261019224603.sql','0bb28ec8c743317c5c5253e91bc79e92e6dc6b0227c9c265168078c1cf0ade1f',33),
('40-forward-20261019230804.sql','7e9a067fba862790804162c6eacdc555644c42df20b073026d3c1d607ef3ae36',34)
    ) expected(phase_name,payload_sha256,ordinal)
    LEFT JOIN vimob_cloud_staging.phase_history actual
      ON actual.run_id='f7196a56-e7bb-4221-b61d-f3a95245338c'::uuid
      AND actual.phase_name=expected.phase_name
    WHERE actual.phase_name IS NULL OR actual.payload_sha256<>expected.payload_sha256
      OR actual.ordinal<>expected.ordinal
      OR actual.source_chain_sha256<>'48dd4fdc5f5dcfbaf08d514cb66167a8c5366542afd016b9027d3758196ad22c'
  ) THEN RAISE EXCEPTION 'staging_index_phase_history_mismatch'; END IF;
  IF (SELECT count(*) FROM vimob_cloud_staging.phase_history) <> 35
    OR EXISTS (SELECT 1 FROM public.leads)
    OR to_regclass('public.idx_leads_simple_stage_inactivity_scan') IS NOT NULL THEN
    RAISE EXCEPTION 'staging_index_requires_completed_bootstrap_empty_leads_and_absent_index';
  END IF;
END $preconditions$;

CREATE INDEX idx_leads_simple_stage_inactivity_scan
ON public.leads (organization_id, stage_id, id)
WHERE deal_status = 'open' AND operational_effects_suppressed = false;

-- Exact runtime assertion from apps/api/internal/stageconfig/inactivity_readiness.go.
DO $postflight$
DECLARE ready boolean;
BEGIN
  SELECT
    to_regclass('private.stage_inactivity_policies') IS NOT NULL
    AND to_regclass('private.stage_inactivity_jobs') IS NOT NULL
    AND to_regclass('private.stage_inactivity_lead_scopes') IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM pg_catalog.pg_index definition
      JOIN pg_catalog.pg_class index_relation ON index_relation.oid=definition.indexrelid
      JOIN pg_catalog.pg_am access_method ON access_method.oid=index_relation.relam
      WHERE definition.indrelid='public.leads'::regclass
        AND index_relation.relname='idx_leads_simple_stage_inactivity_scan'
        AND definition.indisvalid AND definition.indisready
        AND access_method.amname='btree' AND definition.indnkeyatts=3
        AND definition.indexprs IS NULL
        AND pg_catalog.pg_get_indexdef(definition.indexrelid,1,true)='organization_id'
        AND pg_catalog.pg_get_indexdef(definition.indexrelid,2,true)='stage_id'
        AND pg_catalog.pg_get_indexdef(definition.indexrelid,3,true)='id'
        AND regexp_replace(pg_catalog.pg_get_expr(definition.indpred,definition.indrelid),
          '[[:space:]()]','','g')='deal_status=''open''::textANDoperational_effects_suppressed=false'
    ) INTO ready;
  IF NOT ready THEN RAISE EXCEPTION 'staging_index_runtime_postflight_failed'; END IF;
END $postflight$;
COMMIT;
