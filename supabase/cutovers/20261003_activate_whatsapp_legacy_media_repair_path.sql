-- Run only after the preparation migration and the separate online validation.
-- This short transaction swaps a validated replacement for the old constraint.
-- Deploy the Go binary that accepts same-organization legacy repair paths afterward.
-- If validation fails, leave the old constraint in place and investigate.
-- After legacy repair markers have been written, roll back the Go binary only;
-- restoring the old constraint requires those markers to be resolved first.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

select pg_advisory_xact_lock(hashtextextended('vimob:whatsapp-media:global-claim', 0));
select pg_advisory_xact_lock(hashtextextended('vimob:whatsapp-media:mutation', 0));

do $legacy_media_repair_activation_preflight$
declare
  replacement_definition text;
begin
  if to_regclass('public.media_jobs') is null
     or not exists (
       select 1 from pg_catalog.pg_constraint
       where conrelid = 'public.media_jobs'::regclass
         and conname = 'media_jobs_message_key_minimal_check'
         and convalidated
     ) then
    raise exception 'original media message-key constraint is missing';
  end if;
  select pg_get_constraintdef(oid, true)
  into replacement_definition
  from pg_catalog.pg_constraint
  where conrelid = 'public.media_jobs'::regclass
    and conname = 'media_jobs_message_key_legacy_repair_check'
    and convalidated;
  if replacement_definition is null
     or replacement_definition not like '%repair_storage_path%'
     or replacement_definition not like '%organization_id%'
     or replacement_definition not like '%[0-9a-f]{8}%'
     or replacement_definition not like '%incoming/%'
     or replacement_definition not like '%upload_intent_path%'
     or replacement_definition not like '%assets/v2/%' then
    raise exception 'validated same-organization legacy media repair contract is missing or unfamiliar';
  end if;
end;
$legacy_media_repair_activation_preflight$;

alter table public.media_jobs
  drop constraint media_jobs_message_key_minimal_check;
alter table public.media_jobs
  rename constraint media_jobs_message_key_legacy_repair_check
  to media_jobs_message_key_minimal_check;

comment on constraint media_jobs_message_key_minimal_check on public.media_jobs is
  'Bounded provider recovery coordinates; repair paths may reference v2 or a canonical legacy incoming object in the same organization, while upload intents remain v2-only.';

commit;
