-- Deactivate only the reviewed operator exception. The retained originals
-- and their completed audit records remain available.
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL statement_timeout = '8s';
SET LOCAL search_path = pg_catalog;

DO $disable$
DECLARE
  off_rule constant text := '    if new.status is distinct from old.status or new.attempts is distinct from old.attempts then';
  on_rule constant text := E'    if (new.status is distinct from old.status or new.attempts is distinct from old.attempts)\n       and not private.is_authorized_deleted_retained_receipt_retirement(old,new) then';
  existing_def text;
  original_oid oid;
  original_owner oid;
  original_acl aclitem[];
BEGIN
  IF current_user <> 'postgres' OR session_user <> 'postgres'
     OR current_setting('session_replication_role') <> 'origin' THEN
    RAISE EXCEPTION 'deleted_retained_epoch_guard_disable_requires_owner' USING ERRCODE='42501';
  END IF;
  SELECT p.oid,p.proowner,p.proacl,pg_get_functiondef(p.oid)
  INTO STRICT original_oid,original_owner,original_acl,existing_def
  FROM pg_proc p WHERE p.oid='private.guard_whatsapp_webhook_inbox_epoch()'::regprocedure
    AND p.proowner=(SELECT oid FROM pg_roles WHERE rolname='postgres') AND p.prosecdef;
  IF (length(existing_def)-length(replace(existing_def,on_rule,'')))/length(on_rule)<>1 THEN
    RAISE EXCEPTION 'deleted_retained_epoch_guard_disable_source_changed' USING ERRCODE='55000';
  END IF;
  EXECUTE replace(existing_def,on_rule,off_rule);
  IF NOT EXISTS (
    SELECT FROM pg_proc p WHERE p.oid=original_oid AND p.proowner=original_owner
      AND p.proacl IS NOT DISTINCT FROM original_acl
      AND md5(replace(p.prosrc,chr(13),''))='377fa5ce5ca2e51eaec41be02ab2826b'
  ) THEN
    RAISE EXCEPTION 'deleted_retained_epoch_guard_disable_postimage_unproven' USING ERRCODE='55000';
  END IF;
END;
$disable$;
COMMIT;
