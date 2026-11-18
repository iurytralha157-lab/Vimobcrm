-- Candidate for explicit review, never an automatic drain step.
-- One permanent, narrowly-scoped exception to the existing epoch freeze.
-- The ordinary trigger remains attached and executes unchanged for all ingress,
-- worker, live, active-session, frozen, and other historical transitions.
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL statement_timeout = '8s';
SET LOCAL search_path = pg_catalog;

DO $preflight$
BEGIN
  IF current_user <> 'postgres' OR session_user <> 'postgres'
     OR current_setting('session_replication_role') <> 'origin'
     OR NOT EXISTS (
       SELECT FROM pg_proc p JOIN pg_roles r ON r.oid=p.proowner
       WHERE p.oid='private.guard_whatsapp_webhook_inbox_epoch()'::regprocedure
         AND r.rolname='postgres' AND p.prosecdef
         AND md5(replace(p.prosrc,chr(13),''))='377fa5ce5ca2e51eaec41be02ab2826b'
     ) OR NOT EXISTS (
       SELECT FROM pg_trigger t
       WHERE t.tgrelid='public.whatsapp_webhook_inbox'::regclass
         AND t.tgfoid='private.guard_whatsapp_webhook_inbox_epoch()'::regprocedure
         AND t.tgname='guard_whatsapp_webhook_inbox_epoch_before_write'
         AND t.tgenabled IN ('O','A') AND NOT t.tgisinternal
     ) OR 5 <> (
       SELECT count(*) FROM (VALUES
         ('private.is_v1_status_only_receipt(jsonb)','dd9c8d2ad873d7c8c62b468da15825c9'),
         ('private.is_v1_readself_noop_receipt(jsonb)','b72dd7be54d96def997a729906c473bf'),
         ('private.canonical_jsonb_sha256(jsonb)','cfc2cf53ce5796055a77e4be54feaf5d'),
         ('private.canonical_jsonb_text(jsonb)','f296e3970dcd27a6eaeb1f3b0198383a'),
         ('private.guard_whatsapp_webhook_legacy_routing_freeze()','5047ecf8595f03cb94fc1223452e2344')
       ) expected(signature,source_md5)
       JOIN pg_proc p ON p.oid=to_regprocedure(expected.signature)
         AND md5(p.prosrc)=expected.source_md5
     ) THEN
    RAISE EXCEPTION 'deleted_retained_epoch_guard_source_drift' USING ERRCODE='55000';
  END IF;
END;
$preflight$;

CREATE TABLE private.whatsapp_deleted_retained_receipt_retirements (
  inbox_id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  session_id uuid NOT NULL,
  event_key text NOT NULL,
  original_status text NOT NULL CHECK (original_status IN ('pending','retry')),
  original_attempts integer NOT NULL CHECK (original_attempts>=0),
  original_updated_at timestamptz,
  original_expires_at timestamptz,
  original_row_sha256 text NOT NULL CHECK (original_row_sha256~'^[0-9a-f]{64}$'),
  payload_sha256 text NOT NULL CHECK (payload_sha256~'^[0-9a-f]{64}$'),
  receipt_class text NOT NULL CHECK (receipt_class IN ('readself_noop','status_broadcast_read')),
  operated_at timestamptz NOT NULL,
  writer_xid xid8 NOT NULL,
  CONSTRAINT whatsapp_deleted_retained_receipt_event_once UNIQUE (organization_id,session_id,event_key)
);
ALTER TABLE private.whatsapp_deleted_retained_receipt_retirements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.whatsapp_deleted_retained_receipt_retirements FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION private.is_authorized_deleted_retained_receipt_retirement(
  pre public.whatsapp_webhook_inbox,
  post public.whatsapp_webhook_inbox
) RETURNS boolean LANGUAGE plpgsql STABLE SET search_path = '' AS $allow$
DECLARE
  expected_class text;
BEGIN
  IF session_user <> 'postgres'
     OR pg_catalog.current_setting('session_replication_role') <> 'origin'
     OR pre.provider IS DISTINCT FROM 'evolution_go'
     OR pre.processing_lane IS DISTINCT FROM 'backlog'
     OR pre.event_type IS DISTINCT FROM 'receipt'
     OR pre.processing_epoch IS DISTINCT FROM 0 OR post.processing_epoch IS DISTINCT FROM 0
     OR pre.status NOT IN ('pending','retry') OR post.status IS DISTINCT FROM 'dead'
     OR pre.attempts<0 OR pre.attempts>=pre.max_attempts
     OR pre.created_at>=pg_catalog.now()-interval '10 minutes'
     OR pre.processed_at IS NOT NULL OR pre.dead_lettered_at IS NOT NULL
     OR pre.locked_at IS NOT NULL OR pre.locked_by IS NOT NULL
     OR pre.edge_execution_id IS NOT NULL OR pre.edge_execution_state IS NOT NULL
     OR pre.edge_execution_reserved_at IS NOT NULL OR pre.edge_execution_started_at IS NOT NULL
     OR post.dead_lettered_at IS NULL OR post.updated_at IS DISTINCT FROM post.dead_lettered_at
     OR post.expires_at IS DISTINCT FROM 'infinity'::timestamptz
     OR (pg_catalog.to_jsonb(pre)-array['status','dead_lettered_at','updated_at','expires_at'])
        IS DISTINCT FROM (pg_catalog.to_jsonb(post)-array['status','dead_lettered_at','updated_at','expires_at'])
     OR pre.payload#>>'{__vimob_ingress,routing_key}' IS DISTINCT FROM '__session__'
     OR pre.payload#>'{__vimob_ingress,routing_snapshot,messages}' IS DISTINCT FROM '[]'::jsonb
     OR (pre.payload#>'{__vimob_ingress,epoch_capable}' IS NOT NULL
         AND pre.payload#>'{__vimob_ingress,epoch_capable}' IS DISTINCT FROM 'true'::jsonb)
     OR EXISTS (
       SELECT FROM private.whatsapp_webhook_legacy_routing_freeze f
       WHERE f.inbox_id=pre.id
     ) OR NOT EXISTS (
       SELECT FROM public.whatsapp_sessions s
       JOIN private.whatsapp_webhook_session_cutovers c ON c.session_id=s.id AND c.active_epoch=1
       WHERE s.id=pre.session_id AND s.organization_id=pre.organization_id
         AND s.provider='evolution_go' AND s.status='deleted' AND s.is_active IS FALSE
     ) THEN
    RETURN false;
  END IF;

  IF private.is_v1_readself_noop_receipt(pre.payload #- '{__vimob_ingress,epoch_capable}') IS TRUE THEN
    expected_class := 'readself_noop';
  ELSIF pre.payload->>'state'='Read' AND pre.payload#>>'{data,Type}'='read'
        AND pre.payload#>'{data,IsGroup}'='true'::jsonb AND pre.payload#>>'{data,Chat}'='status@broadcast'
        AND private.is_v1_status_only_receipt(pre.payload #- '{__vimob_ingress,epoch_capable}') IS TRUE THEN
    IF pg_catalog.jsonb_array_length(pre.payload#>'{data,MessageIDs}') IS DISTINCT FROM 1 THEN RETURN false; END IF;
    expected_class := 'status_broadcast_read';
  ELSE
    RETURN false;
  END IF;

  -- The native parser trims Unicode whitespace. Exact ASCII IDs keep the
  -- operator's raw-ID matches aligned with every native target.
  IF EXISTS (
    SELECT 1 FROM pg_catalog.jsonb_array_elements_text(pre.payload#>'{data,MessageIDs}') ids(provider_id)
    WHERE ids.provider_id COLLATE pg_catalog."C" !~ '^[A-Za-z0-9_-]+$'
  ) THEN RETURN false; END IF;

  RETURN EXISTS (
    SELECT FROM private.whatsapp_deleted_retained_receipt_retirements a
    WHERE a.inbox_id=pre.id AND a.organization_id=pre.organization_id AND a.session_id=pre.session_id
      AND a.event_key=pre.event_key AND a.original_status=pre.status AND a.original_attempts=pre.attempts
      AND a.original_updated_at IS NOT DISTINCT FROM pre.updated_at
      AND a.original_expires_at IS NOT DISTINCT FROM pre.expires_at
      AND a.original_row_sha256=private.canonical_jsonb_sha256(pg_catalog.to_jsonb(pre))
      AND a.payload_sha256=private.canonical_jsonb_sha256(pre.payload)
      AND a.receipt_class=expected_class AND a.operated_at=post.dead_lettered_at
      AND a.writer_xid=pg_catalog.pg_current_xact_id_if_assigned()
  );
END;
$allow$;
REVOKE ALL ON FUNCTION private.is_authorized_deleted_retained_receipt_retirement(
  public.whatsapp_webhook_inbox,public.whatsapp_webhook_inbox
) FROM PUBLIC, anon, authenticated, service_role;

DO $install$
DECLARE
  off_rule constant text := '    if new.status is distinct from old.status or new.attempts is distinct from old.attempts then';
  on_rule constant text := E'    if (new.status is distinct from old.status or new.attempts is distinct from old.attempts)\n       and not private.is_authorized_deleted_retained_receipt_retirement(old,new) then';
  old_definition text;
  original_oid oid;
  original_owner oid;
  original_acl aclitem[];
  replaced text;
BEGIN
  SELECT p.oid,p.proowner,p.proacl,pg_get_functiondef(p.oid)
  INTO STRICT original_oid,original_owner,original_acl,old_definition
  FROM pg_proc p WHERE p.oid='private.guard_whatsapp_webhook_inbox_epoch()'::regprocedure
    AND md5(replace(p.prosrc,chr(13),''))='377fa5ce5ca2e51eaec41be02ab2826b';
  IF (length(old_definition)-length(replace(old_definition,off_rule,'')))/length(off_rule)<>1
     OR EXISTS (
       SELECT FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
       WHERE c.oid='private.whatsapp_deleted_retained_receipt_retirements'::regclass AND a.grantee<>c.relowner
     ) OR EXISTS (
       SELECT FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
       WHERE p.oid='private.is_authorized_deleted_retained_receipt_retirement(public.whatsapp_webhook_inbox,public.whatsapp_webhook_inbox)'::regprocedure
         AND a.grantee<>p.proowner
     ) THEN
    RAISE EXCEPTION 'deleted_retained_epoch_guard_contract_unproven' USING ERRCODE='55000';
  END IF;
  replaced:=replace(old_definition,off_rule,on_rule);
  EXECUTE replaced;
  IF NOT EXISTS (
    SELECT FROM pg_proc p WHERE p.oid=original_oid AND p.proowner=original_owner
      AND p.proacl IS NOT DISTINCT FROM original_acl
      AND pg_get_functiondef(p.oid)=replaced
  ) THEN
    RAISE EXCEPTION 'deleted_retained_epoch_guard_postimage_unproven' USING ERRCODE='55000';
  END IF;
END;
$install$;
COMMIT;
