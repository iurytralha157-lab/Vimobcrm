-- Validate separately from the short ACCESS EXCLUSIVE constraint replacement.
-- The expanded CHECK already applies to every new/changed row; this transaction
-- records validation atomically in its own migration ledger entry. On timeout,
-- retry this forward validation without dropping/replacing the enforced CHECK.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '1min';
alter table private.contact_import_request_receipts
  validate constraint contact_import_receipt_completion_check;
commit;
