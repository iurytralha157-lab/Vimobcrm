-- Local draft. Install only in the caller's explicit, rollback-capable transaction.
-- This file does not call the operator. It defines only temporary objects.
-- Requires the separately reviewed deleted-session old-epoch guard installation.
-- Call one exact manifest of 1–200 old-epoch technical receipts from one deleted session.
-- Required caller settings include small lock/statement timeouts and READ COMMITTED.
-- Use a rollback rehearsal before a commit. No changes to live connections or epochs.
CREATE TEMP TABLE deleted_retained_receipt_manifest (
  inbox_id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  session_id uuid NOT NULL,
  epoch integer NOT NULL CHECK (epoch=0),
  status text NOT NULL CHECK (status IN ('pending', 'retry')),
  attempts integer NOT NULL,
  max_attempts integer NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  event_key_sha256 text NOT NULL CHECK (event_key_sha256 ~ '^[0-9a-f]{64}$'),
  payload_sha256 text NOT NULL CHECK (payload_sha256 ~ '^[0-9a-f]{64}$')
) ON COMMIT DROP;
CREATE TEMP TABLE deleted_retained_receipt_originals ON COMMIT DROP AS
SELECT * FROM public.whatsapp_webhook_inbox WITH NO DATA;
CREATE TEMP TABLE deleted_retained_receipt_targets (
  inbox_id uuid NOT NULL,
  event_key text NOT NULL,
  provider_id text NOT NULL,
  PRIMARY KEY (inbox_id,provider_id)
) ON COMMIT DROP;
CREATE TEMP TABLE deleted_retained_receipt_classification (
  inbox_id uuid PRIMARY KEY,
  receipt_class text NOT NULL
) ON COMMIT DROP;

-- These are the set-based matching branches from group-read-batch-25.sql.
-- Include the inbox provider ledger and future reconciliation ledgers as well.
CREATE OR REPLACE FUNCTION pg_temp.deleted_retained_receipt_has_effect(p_org uuid, p_session uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  WITH ids AS MATERIALIZED (SELECT DISTINCT provider_id FROM pg_temp.deleted_retained_receipt_targets),
       keys AS MATERIALIZED (SELECT event_key FROM pg_temp.deleted_retained_receipt_targets)
  SELECT EXISTS (
    SELECT 1 FROM ids t JOIN public.whatsapp_messages m
      ON m.organization_id=p_org AND m.session_id=p_session AND m.message_id=t.provider_id
    UNION ALL
    SELECT 1 FROM ids t JOIN public.whatsapp_messages m
      ON m.organization_id=p_org AND m.session_id=p_session AND m.provider_message_id=t.provider_id
    UNION ALL
    SELECT 1 FROM ids t JOIN public.whatsapp_messages m
      ON m.organization_id=p_org AND m.session_id=p_session AND m.client_message_id=t.provider_id
    UNION ALL
    SELECT 1 FROM ids t JOIN public.whatsapp_outbox o
      ON o.organization_id=p_org AND o.session_id=p_session AND o.provider_message_id=t.provider_id
    UNION ALL
    SELECT 1 FROM ids t JOIN public.whatsapp_outbox o
      ON o.organization_id=p_org AND o.session_id=p_session AND o.client_message_id=t.provider_id
    UNION ALL
    SELECT 1 FROM ids t JOIN public.outbox_messages o
      ON o.organization_id=p_org AND o.session_id=p_session AND o.sent_message_id=t.provider_id
    UNION ALL
    SELECT 1 FROM ids t JOIN public.outbox_messages o
      ON o.organization_id=p_org AND o.session_id=p_session AND o.client_message_id=t.provider_id
    UNION ALL
    SELECT 1 FROM ids t JOIN private.notification_deliveries d
      ON d.organization_id=p_org AND d.channel='whatsapp' AND d.provider_message_id=t.provider_id
    UNION ALL
    SELECT 1 FROM ids t JOIN private.notification_deliveries d
      ON d.organization_id=p_org AND d.channel='whatsapp' AND d.metadata->>'expected_message_id'=t.provider_id
    UNION ALL
    SELECT 1 FROM ids t JOIN public.notifications n
      ON n.organization_id=p_org AND n.metadata#>>'{dispatch,whatsapp,expected_message_id}'=t.provider_id
    UNION ALL
    SELECT 1 FROM ids t JOIN public.whatsapp_webhook_routing_snapshots r
      ON r.organization_id=p_org AND r.session_id=p_session AND r.provider_message_id=t.provider_id
    UNION ALL
    SELECT 1 FROM keys t JOIN public.whatsapp_webhook_routing_snapshots r
      ON r.organization_id=p_org AND r.session_id=p_session AND r.inbox_event_key=t.event_key
    UNION ALL
    SELECT 1 FROM public.whatsapp_webhook_routing_snapshots r
      WHERE r.organization_id=p_org AND r.session_id=p_session
        AND r.snapshot->>'predecessor_inbox_event_key' IN (SELECT event_key FROM keys)
    UNION ALL
    SELECT 1 FROM public.whatsapp_webhook_routing_outcomes o
      WHERE o.organization_id=p_org AND o.session_id=p_session
        AND (o.completed_inbox_event_key IN (SELECT event_key FROM keys)
             OR o.provider_message_id IN (SELECT provider_id FROM ids))
  );
$$;

CREATE OR REPLACE FUNCTION pg_temp.deleted_retained_receipt_has_deferred_effect(p_org uuid, p_session uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  ledger regclass;
  present boolean;
BEGIN
  FOR ledger IN SELECT to_regclass(name) FROM (VALUES
    ('private.whatsapp_deferred_receipt_ledger'),
    ('private.whatsapp_orphan_receipt_ledger'),
    ('private.whatsapp_partial_live_receipt_retirements')
  ) AS known(name) LOOP
    IF ledger IS NOT NULL THEN
      EXECUTE format(
        'SELECT EXISTS (
          SELECT 1 FROM pg_temp.deleted_retained_receipt_targets t JOIN %s d ON d.inbox_id=t.inbox_id
          UNION ALL
          SELECT 1 FROM %s d WHERE d.organization_id=$1 AND d.session_id=$2
            AND d.provider_message_id IN (SELECT provider_id FROM pg_temp.deleted_retained_receipt_targets)
        )', ledger, ledger
      ) INTO present USING p_org, p_session;
      IF present THEN RETURN true; END IF;
    END IF;
  END LOOP;
  RETURN false;
END;
$$;

-- Supply independently reviewed source / trigger pins. Catalog drift aborts.
-- p_contract keys: classifier_md5, readself_md5, canonical_md5, canonical_text_md5, target_md5,
-- epoch_md5, freeze_md5, permit_md5, inbox_trigger_digest and audit_trigger_digest.
-- The epoch/permit and trigger digests must come from a reviewed installation.
CREATE OR REPLACE FUNCTION pg_temp.apply_deleted_retained_receipt_batch(p_manifest jsonb, p_contract jsonb)
RETURNS integer LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  scope record;
  n integer;
  affected integer;
  terminal_at timestamptz;
  audited_relation regclass := to_regclass('private.whatsapp_deleted_retained_receipt_retirements');
BEGIN
  IF current_user <> 'postgres' OR current_user <> session_user
     OR current_setting('session_replication_role') <> 'origin'
     OR current_setting('transaction_isolation') <> 'read committed'
     OR current_setting('transaction_read_only') <> 'off' THEN
    RAISE EXCEPTION 'deleted_retained_receipt_owner_transaction_required';
  END IF;
  IF jsonb_typeof(p_manifest) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_manifest) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'deleted_retained_receipt_batch_size';
  END IF;
  IF EXISTS (SELECT FROM pg_temp.deleted_retained_receipt_manifest) THEN
    RAISE EXCEPTION 'deleted_retained_receipt_already_used';
  END IF;
  INSERT INTO pg_temp.deleted_retained_receipt_manifest
  SELECT * FROM jsonb_to_recordset(p_manifest) AS input(
    inbox_id uuid, organization_id uuid, session_id uuid, epoch integer,
    status text, attempts integer, max_attempts integer, created_at timestamptz, updated_at timestamptz,
    event_key_sha256 text, payload_sha256 text
  );
  GET DIAGNOSTICS n=ROW_COUNT;
  IF n <> jsonb_array_length(p_manifest)
     OR 1 <> (SELECT count(DISTINCT (organization_id, session_id, epoch)) FROM pg_temp.deleted_retained_receipt_manifest)
     OR EXISTS (SELECT FROM pg_temp.deleted_retained_receipt_manifest WHERE attempts<0 OR attempts>=max_attempts) THEN
    RAISE EXCEPTION 'deleted_retained_receipt_exact_scope_required';
  END IF;
  SELECT DISTINCT organization_id, session_id, epoch INTO STRICT scope FROM pg_temp.deleted_retained_receipt_manifest;

  IF audited_relation IS NULL
     OR NOT EXISTS (
       SELECT FROM pg_class c JOIN pg_roles owner ON owner.oid=c.relowner
       WHERE c.oid=audited_relation AND c.relkind='r' AND c.relpersistence='p' AND owner.rolname='postgres'
         AND c.relrowsecurity
         AND NOT EXISTS (
           SELECT FROM aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) acl
           WHERE acl.grantee<>c.relowner
         ) AND NOT EXISTS (
           SELECT FROM pg_attribute attr
           CROSS JOIN LATERAL aclexplode(attr.attacl) acl
           WHERE attr.attrelid=c.oid AND NOT attr.attisdropped AND acl.grantee<>c.relowner
         )
     )
     OR NOT EXISTS (
       SELECT FROM pg_trigger t
       WHERE t.tgrelid='public.whatsapp_webhook_inbox'::regclass
         AND t.tgname='guard_whatsapp_webhook_inbox_epoch_before_write'
         AND t.tgenabled IN ('O','A') AND NOT t.tgisinternal
     )
     OR 8 <> (
       SELECT count(*) FROM (VALUES
         ('private.is_v1_status_only_receipt(jsonb)', 'classifier_md5'),
         ('private.is_v1_readself_noop_receipt(jsonb)', 'readself_md5'),
         ('private.canonical_jsonb_sha256(jsonb)', 'canonical_md5'),
         ('private.canonical_jsonb_text(jsonb)', 'canonical_text_md5'),
         ('private.is_authorized_deleted_retained_receipt_retirement(public.whatsapp_webhook_inbox,public.whatsapp_webhook_inbox)', 'permit_md5'),
         ('private.v1_receipt_has_canonical_target(uuid,uuid,jsonb)', 'target_md5'),
         ('private.guard_whatsapp_webhook_inbox_epoch()', 'epoch_md5'),
         ('private.guard_whatsapp_webhook_legacy_routing_freeze()', 'freeze_md5')
       ) known(signature, pin)
       JOIN pg_proc p ON p.oid=to_regprocedure(known.signature)
         AND md5(p.prosrc)=p_contract->>known.pin
     )
     OR NOT (p_contract ? 'audit_trigger_digest')
     OR (SELECT md5(string_agg(concat_ws(':',t.tgname,t.tgenabled::text,pg_get_triggerdef(t.oid),md5(p.prosrc)),
                              chr(10) ORDER BY t.tgname))
         FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid
         WHERE t.tgrelid='public.whatsapp_webhook_inbox'::regclass AND NOT t.tgisinternal)
       IS DISTINCT FROM p_contract->>'inbox_trigger_digest'
     OR (SELECT md5(string_agg(concat_ws(':',t.tgname,t.tgenabled::text,pg_get_triggerdef(t.oid),md5(p.prosrc)),
                              chr(10) ORDER BY t.tgname))
         FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid
         WHERE t.tgrelid=audited_relation AND NOT t.tgisinternal)
       IS DISTINCT FROM p_contract->>'audit_trigger_digest' THEN
    RAISE EXCEPTION 'deleted_retained_receipt_catalog_or_audit_drift';
  END IF;

  -- Keep a deleted connection deleted for the entire check and write.
  PERFORM 1 FROM public.whatsapp_sessions AS s
  WHERE s.id=scope.session_id AND s.organization_id=scope.organization_id
    AND s.provider='evolution_go' AND s.status='deleted' AND s.is_active IS FALSE
  FOR UPDATE OF s SKIP LOCKED;
  IF NOT FOUND OR scope.epoch <> 0 OR 1 <> coalesce((
    SELECT e.active_epoch FROM private.whatsapp_webhook_session_cutovers e
    WHERE e.session_id=scope.session_id
  ),0) OR EXISTS (
    SELECT FROM public.whatsapp_webhook_inbox w
    WHERE w.organization_id=scope.organization_id AND w.session_id=scope.session_id
      AND w.status='processing'
  ) THEN
    RAISE EXCEPTION 'deleted_retained_receipt_session_epoch_or_processing_changed';
  END IF;

  WITH locked AS MATERIALIZED (
    SELECT i.* FROM pg_temp.deleted_retained_receipt_manifest m
    JOIN public.whatsapp_webhook_inbox i ON i.id=m.inbox_id
    WHERE i.organization_id=scope.organization_id AND i.session_id=scope.session_id
      AND i.processing_epoch=scope.epoch AND i.processing_lane='backlog'
      AND i.provider='evolution_go' AND i.event_type='receipt'
      AND i.status=m.status AND i.attempts=m.attempts AND i.max_attempts=m.max_attempts
      AND i.created_at=m.created_at AND i.updated_at=m.updated_at
      AND i.created_at<now()-interval '10 minutes' AND i.next_attempt_at<=now()
      AND i.processed_at IS NULL AND i.dead_lettered_at IS NULL
      AND i.locked_at IS NULL AND i.locked_by IS NULL
      AND i.edge_execution_id IS NULL AND i.edge_execution_state IS NULL
      AND i.edge_execution_reserved_at IS NULL AND i.edge_execution_started_at IS NULL
    ORDER BY i.id FOR UPDATE OF i SKIP LOCKED
  )
  INSERT INTO pg_temp.deleted_retained_receipt_originals SELECT * FROM locked;
  GET DIAGNOSTICS affected=ROW_COUNT;
  IF affected<>n THEN RAISE EXCEPTION 'deleted_retained_receipt_row_drift_or_lock_conflict'; END IF;
  IF EXISTS (
    SELECT FROM pg_temp.deleted_retained_receipt_originals i
    JOIN pg_temp.deleted_retained_receipt_manifest m ON m.inbox_id=i.id
    WHERE encode(sha256(convert_to(i.event_key,'UTF8')),'hex') IS DISTINCT FROM m.event_key_sha256
      OR private.canonical_jsonb_sha256(i.payload) IS DISTINCT FROM m.payload_sha256
      OR NOT (coalesce(i.payload#>'{__vimob_ingress,epoch_capable}'='true'::jsonb,false)
        OR (i.processing_epoch=0 AND i.payload#>'{__vimob_ingress,epoch_capable}' IS NULL))
      OR i.payload#>>'{__vimob_ingress,routing_key}' IS DISTINCT FROM '__session__'
      OR i.payload#>'{__vimob_ingress,routing_snapshot,messages}' IS DISTINCT FROM '[]'::jsonb
  ) THEN
    RAISE EXCEPTION 'deleted_retained_receipt_shape_or_hash_changed';
  END IF;
  INSERT INTO pg_temp.deleted_retained_receipt_classification
  SELECT i.id, typed.receipt_class
  FROM pg_temp.deleted_retained_receipt_originals i
  CROSS JOIN LATERAL (
    SELECT CASE
      WHEN private.is_v1_readself_noop_receipt(i.payload #- '{__vimob_ingress,epoch_capable}') IS TRUE
        THEN 'readself_noop'
      WHEN private.is_v1_status_only_receipt(i.payload #- '{__vimob_ingress,epoch_capable}') IS TRUE
        AND i.payload->>'state'='Read' AND i.payload#>>'{data,Type}'='read'
        AND i.payload#>'{data,IsGroup}'='true'::jsonb AND i.payload#>>'{data,Chat}'='status@broadcast'
        AND CASE WHEN jsonb_typeof(i.payload#>'{data,MessageIDs}')='array'
              THEN jsonb_array_length(i.payload#>'{data,MessageIDs}')=1 ELSE false END
        THEN 'status_broadcast_read'
    END AS receipt_class
  ) typed
  WHERE typed.receipt_class IS NOT NULL;
  GET DIAGNOSTICS affected=ROW_COUNT;
  IF affected<>n THEN RAISE EXCEPTION 'deleted_retained_receipt_shape_or_hash_changed'; END IF;
  INSERT INTO pg_temp.deleted_retained_receipt_targets
  SELECT i.id, i.event_key, ids.provider_id
  FROM pg_temp.deleted_retained_receipt_originals i
  CROSS JOIN LATERAL jsonb_array_elements_text(i.payload#>'{data,MessageIDs}') ids(provider_id)
  ON CONFLICT DO NOTHING;
  IF n<>(SELECT count(DISTINCT inbox_id) FROM pg_temp.deleted_retained_receipt_targets)
     OR EXISTS (SELECT FROM pg_temp.deleted_retained_receipt_targets
       WHERE provider_id COLLATE pg_catalog."C" !~ '^[A-Za-z0-9_-]+$')
  THEN
    RAISE EXCEPTION 'deleted_retained_receipt_effect_id_scope_changed';
  END IF;

  IF pg_temp.deleted_retained_receipt_has_effect(scope.organization_id,scope.session_id) IS DISTINCT FROM false
     OR pg_temp.deleted_retained_receipt_has_deferred_effect(scope.organization_id,scope.session_id) IS DISTINCT FROM false
     OR EXISTS (SELECT FROM pg_temp.deleted_retained_receipt_targets t
       JOIN private.whatsapp_webhook_legacy_routing_freeze f ON f.inbox_id=t.inbox_id)
     OR EXISTS (SELECT FROM pg_temp.deleted_retained_receipt_targets t
       JOIN private.whatsapp_v1_readself_noop_audit a
         ON a.inbox_id=t.inbox_id OR (a.organization_id,a.session_id,a.event_key)=(scope.organization_id,scope.session_id,t.event_key))
     OR EXISTS (SELECT FROM pg_temp.deleted_retained_receipt_targets t
       JOIN private.whatsapp_v1_receipt_terminalizations a
         ON a.inbox_id=t.inbox_id OR (a.organization_id,a.session_id,a.event_key)=(scope.organization_id,scope.session_id,t.event_key))
     OR EXISTS (SELECT FROM pg_temp.deleted_retained_receipt_targets t
       JOIN private.whatsapp_deleted_retained_receipt_retirements a
         ON a.inbox_id=t.inbox_id OR (a.organization_id,a.session_id,a.event_key)=(scope.organization_id,scope.session_id,t.event_key)) THEN
    RAISE EXCEPTION 'deleted_retained_receipt_target_dependency_or_prior_audit';
  END IF;
  terminal_at:=clock_timestamp();
  INSERT INTO private.whatsapp_deleted_retained_receipt_retirements (
    inbox_id, organization_id, session_id, event_key, original_status, original_attempts,
    original_updated_at, original_expires_at, original_row_sha256, payload_sha256, receipt_class,
    operated_at, writer_xid
  )
  SELECT i.id, i.organization_id, i.session_id, i.event_key, i.status, i.attempts,
    i.updated_at, i.expires_at, private.canonical_jsonb_sha256(to_jsonb(i)), m.payload_sha256,
    typed.receipt_class, terminal_at, pg_current_xact_id()
  FROM pg_temp.deleted_retained_receipt_originals i
  JOIN pg_temp.deleted_retained_receipt_manifest m ON m.inbox_id=i.id
  JOIN pg_temp.deleted_retained_receipt_classification typed ON typed.inbox_id=i.id;
  GET DIAGNOSTICS affected=ROW_COUNT;
  IF affected<>n THEN RAISE EXCEPTION 'deleted_retained_receipt_audit_count_changed'; END IF;
  UPDATE public.whatsapp_webhook_inbox i
  SET status='dead', dead_lettered_at=terminal_at, expires_at='infinity'::timestamptz, updated_at=terminal_at
  FROM pg_temp.deleted_retained_receipt_originals old
  WHERE i.id=old.id AND i.organization_id=scope.organization_id AND i.session_id=scope.session_id
    AND i.processing_epoch=scope.epoch AND i.processing_lane='backlog'
    AND i.event_key=old.event_key AND i.status=old.status AND i.attempts=old.attempts
    AND i.max_attempts=old.max_attempts AND i.updated_at=old.updated_at AND i.payload=old.payload
    AND i.locked_at IS NULL AND i.locked_by IS NULL AND i.edge_execution_id IS NULL;
  GET DIAGNOSTICS affected=ROW_COUNT;
  IF affected<>n THEN RAISE EXCEPTION 'deleted_retained_receipt_cas_count_changed'; END IF;

  IF pg_temp.deleted_retained_receipt_has_effect(scope.organization_id,scope.session_id) IS DISTINCT FROM false
     OR pg_temp.deleted_retained_receipt_has_deferred_effect(scope.organization_id,scope.session_id) IS DISTINCT FROM false
     OR EXISTS (
       SELECT FROM pg_temp.deleted_retained_receipt_originals old
       JOIN pg_temp.deleted_retained_receipt_manifest m ON m.inbox_id=old.id
       LEFT JOIN public.whatsapp_webhook_inbox i ON i.id=old.id
       JOIN pg_temp.deleted_retained_receipt_classification typed ON typed.inbox_id=old.id
       LEFT JOIN private.whatsapp_deleted_retained_receipt_retirements a ON a.inbox_id=old.id
       WHERE i.id IS NULL OR a.inbox_id IS NULL OR i.status IS DISTINCT FROM 'dead' OR i.processed_at IS NOT NULL
         OR i.dead_lettered_at IS DISTINCT FROM terminal_at OR i.expires_at IS DISTINCT FROM 'infinity'::timestamptz
         OR private.canonical_jsonb_sha256(i.payload) IS DISTINCT FROM m.payload_sha256
         OR (to_jsonb(i)-array['status','dead_lettered_at','expires_at','updated_at'])
           IS DISTINCT FROM (to_jsonb(old)-array['status','dead_lettered_at','expires_at','updated_at'])
         OR a.payload_sha256 IS DISTINCT FROM m.payload_sha256 OR a.original_status IS DISTINCT FROM old.status
         OR a.original_attempts IS DISTINCT FROM old.attempts
         OR a.original_updated_at IS DISTINCT FROM old.updated_at
         OR a.original_expires_at IS DISTINCT FROM old.expires_at
         OR a.original_row_sha256 IS DISTINCT FROM private.canonical_jsonb_sha256(to_jsonb(old))
         OR a.organization_id IS DISTINCT FROM i.organization_id OR a.session_id IS DISTINCT FROM i.session_id
         OR a.event_key IS DISTINCT FROM i.event_key OR a.operated_at IS DISTINCT FROM terminal_at
         OR a.receipt_class IS DISTINCT FROM typed.receipt_class
         OR a.writer_xid IS DISTINCT FROM pg_current_xact_id_if_assigned()
     ) THEN
    RAISE EXCEPTION 'deleted_retained_receipt_postcondition_failed';
  END IF;
  RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION pg_temp.apply_deleted_retained_receipt_batch(jsonb,jsonb) FROM PUBLIC;
