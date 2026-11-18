BEGIN READ ONLY;
SET LOCAL lock_timeout = '500ms';
SET LOCAL statement_timeout = '8s';
SET LOCAL search_path = pg_catalog;

DO $check$
DECLARE
  guard_oid regprocedure := 'private.guard_whatsapp_webhook_inbox_epoch()'::regprocedure;
  retired_receipt_audit regclass := 'private.whatsapp_deleted_retained_receipt_retirements'::regclass;
  permit_oid regprocedure := 'private.is_authorized_deleted_retained_receipt_retirement(public.whatsapp_webhook_inbox,public.whatsapp_webhook_inbox)'::regprocedure;
  off_rule constant text := '    if new.status is distinct from old.status or new.attempts is distinct from old.attempts then';
  on_rule constant text := E'    if (new.status is distinct from old.status or new.attempts is distinct from old.attempts)\n       and not private.is_authorized_deleted_retained_receipt_retirement(old,new) then';
BEGIN
  IF current_user <> 'postgres' OR session_user <> 'postgres'
     OR current_setting('session_replication_role') <> 'origin'
     OR pg_is_in_recovery()
     OR NOT EXISTS (
       SELECT FROM pg_proc p JOIN pg_roles r ON r.oid = p.proowner
       WHERE p.oid = guard_oid AND r.rolname = 'postgres' AND p.prosecdef
         AND md5(replace(replace(p.prosrc, chr(13), ''), on_rule, off_rule))
             = '377fa5ce5ca2e51eaec41be02ab2826b'
     )
     OR NOT EXISTS (
       SELECT FROM pg_trigger t
       WHERE t.tgrelid = 'public.whatsapp_webhook_inbox'::regclass
         AND t.tgname = 'guard_whatsapp_webhook_inbox_epoch_before_write'
         AND t.tgfoid = guard_oid AND t.tgenabled IN ('O', 'A') AND NOT t.tgisinternal
     )
     OR NOT EXISTS (
       SELECT FROM pg_proc p JOIN pg_roles r ON r.oid = p.proowner
       WHERE p.oid = permit_oid AND r.rolname = 'postgres' AND NOT p.prosecdef
         AND NOT EXISTS (
           SELECT FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
           WHERE acl.grantee <> p.proowner
         )
     )
     OR NOT EXISTS (
       SELECT FROM pg_class c JOIN pg_roles r ON r.oid = c.relowner
       WHERE c.oid = retired_receipt_audit AND r.rolname = 'postgres' AND c.relrowsecurity
         AND NOT EXISTS (
           SELECT FROM aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) acl
           WHERE acl.grantee <> c.relowner
         )
         AND NOT EXISTS (
           SELECT FROM pg_attribute a CROSS JOIN LATERAL aclexplode(a.attacl) acl
           WHERE a.attrelid = c.oid AND NOT a.attisdropped AND acl.grantee <> c.relowner
         )
     )
  THEN
    RAISE EXCEPTION 'deleted_retained_receipt_readback_catalog';
  END IF;

  IF EXISTS (
    SELECT FROM private.whatsapp_deleted_retained_receipt_retirements a
    LEFT JOIN public.whatsapp_webhook_inbox i
      ON i.id = a.inbox_id AND i.organization_id = a.organization_id AND i.session_id = a.session_id
    WHERE i.id IS NULL OR i.event_key IS DISTINCT FROM a.event_key
      OR i.status IS DISTINCT FROM 'dead' OR i.processing_epoch IS DISTINCT FROM 0
      OR i.attempts IS DISTINCT FROM a.original_attempts
      OR i.expires_at IS DISTINCT FROM 'infinity'::timestamptz
      OR i.processed_at IS NOT NULL OR i.dead_lettered_at IS DISTINCT FROM a.operated_at
      OR private.canonical_jsonb_sha256(i.payload) IS DISTINCT FROM a.payload_sha256
  ) THEN
    RAISE EXCEPTION 'deleted_retained_receipt_readback_original';
  END IF;
END;
$check$;

ROLLBACK;
