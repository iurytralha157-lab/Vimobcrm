-- POST-ACTIVATION ONLINE VALIDATION.
-- Run only after 20260912152432_scale_whatsapp_media_queue_safely.sql commits.
-- VALIDATE CONSTRAINT scans existing rows but does not block ordinary INSERT,
-- UPDATE, or DELETE traffic. It remains separate from activation so the short
-- cutover transaction never carries a live-table scan.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '30min';
select pg_advisory_xact_lock(hashtextextended('vimob:whatsapp-media:scale-cutover', 0));

do $whatsapp_media_scale_validation_preflight$
begin
  if to_regclass('public.media_jobs') is null
     or to_regclass('public.media_jobs_processing_slot_uidx') is null
     or to_regclass('public.media_jobs_processing_session_uidx') is null
     or to_regclass('public.media_jobs_processing_asset_uidx') is null
     or to_regclass('public.media_jobs_processing_org_idx') is null
     or to_regclass('public.media_jobs_pending_session_claim_idx') is null
     or to_regclass('public.media_jobs_pending_local_session_claim_idx') is null
     or to_regclass('public.media_jobs_pending_exhausted_idx') is null
     or to_regprocedure('private.claim_whatsapp_media_job(text,interval,integer,uuid[],boolean)') is null
     or to_regprocedure('private.claim_whatsapp_media_job(text,interval,integer,text[])') is null
     or to_regprocedure('private.claim_whatsapp_media_job(text,interval)') is null
     or to_regprocedure('private.enforce_whatsapp_media_processing_slot()') is null
     or to_regclass('private.whatsapp_media_session_quarantine') is null
     or to_regclass('private.whatsapp_media_scale_cutover_state') is null
     or to_regclass('public.media_jobs_one_global_processing_uidx') is not null
  then
    raise exception 'WhatsApp media scale activation is incomplete; do not validate';
  end if;

  if exists (
    select 1
    from public.media_jobs
    where (status = 'processing' and processing_slot is null)
       or (status = 'processing' and processing_slot not between 1 and 16)
       or (status <> 'processing' and processing_slot is not null)
  ) then
    raise exception 'WhatsApp media processing-slot rows violate the activation contract';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_class as relation
    where relation.oid in (
      'private.whatsapp_media_session_quarantine'::regclass,
      'private.whatsapp_media_scale_cutover_state'::regclass
    )
      and (not relation.relrowsecurity or not relation.relforcerowsecurity)
  ) then
    raise exception 'WhatsApp media private fence tables are not protected by FORCE RLS';
  end if;

  if has_table_privilege('service_role', 'private.whatsapp_media_session_quarantine', 'SELECT')
     or has_table_privilege('service_role', 'private.whatsapp_media_session_quarantine', 'INSERT')
     or has_table_privilege('service_role', 'private.whatsapp_media_session_quarantine', 'UPDATE')
     or has_table_privilege('service_role', 'private.whatsapp_media_session_quarantine', 'DELETE')
     or has_table_privilege('service_role', 'private.whatsapp_media_scale_cutover_state', 'SELECT')
     or has_table_privilege('service_role', 'private.whatsapp_media_scale_cutover_state', 'INSERT')
     or has_table_privilege('service_role', 'private.whatsapp_media_scale_cutover_state', 'UPDATE')
     or has_table_privilege('service_role', 'private.whatsapp_media_scale_cutover_state', 'DELETE')
  then
    raise exception 'service_role can access a backend-only WhatsApp media fence table';
  end if;
end;
$whatsapp_media_scale_validation_preflight$;

alter table public.media_jobs
  validate constraint media_jobs_processing_slot_check;

do $verify_whatsapp_media_scale_validation$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.media_jobs'::regclass
      and conname = 'media_jobs_processing_slot_check'
      and contype = 'c'
      and convalidated
  ) then
    raise exception 'WhatsApp media processing-slot check was not validated';
  end if;
end;
$verify_whatsapp_media_scale_validation$;

commit;
