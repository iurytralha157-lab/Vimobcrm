-- Additive receipt vocabulary. Deploy consumers that understand these outcomes
-- before enabling managed imports on every replica; old consumers fail closed
-- on a new completed outcome instead of recreating the lead.
-- Rollback is forward-only: never drop completed receipts or narrow the CHECK
-- while any managed outcome exists. Keep the expanded vocabulary on rollback.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
alter table private.contact_import_request_receipts
  drop constraint contact_import_receipt_completion_check;
alter table private.contact_import_request_receipts
  add constraint contact_import_receipt_completion_check check (
    (completed_at is null and lead_id is null and reentry is null and distribution_outcome is null)
    or (completed_at is not null and lead_id is not null and reentry is not null and distribution_outcome is not null
      and distribution_outcome in (
        'assigned', 'already_assigned', 'no_matching_queue', 'no_available_members', 'skipped', 'reentry_preserved',
        'pooled', 'queue_closed', 'queue_waiting', 'queue_limit_reached', 'queue_protected'))
  ) not valid;
commit;
