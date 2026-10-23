-- Local preparation only. Apply independently before clients start sending
-- importRequestKey. No legacy import, contact or distribution data is changed.
create table private.contact_import_request_receipts (
  organization_id uuid not null,
  actor_id uuid not null,
  request_key uuid not null,
  payload_sha256 text not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  lead_id uuid,
  reentry boolean,
  distribution_outcome text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  primary key (organization_id, actor_id, request_key),
  constraint contact_import_receipt_completion_check check (
    (completed_at is null and lead_id is null and reentry is null and distribution_outcome is null)
    or (completed_at is not null and lead_id is not null and reentry is not null and distribution_outcome is not null
      and distribution_outcome in ('assigned', 'already_assigned', 'no_matching_queue', 'no_available_members', 'skipped', 'reentry_preserved'))
  )
);
-- Deliberately no lead FK: a deleted contact must remain a completed request,
-- so retrying a lost response cannot recreate it. No personal payload is stored.
alter table private.contact_import_request_receipts owner to postgres;
alter table private.contact_import_request_receipts enable row level security;
revoke all on table private.contact_import_request_receipts from public, anon, authenticated, service_role;
comment on table private.contact_import_request_receipts is
  'Backend-only transactional contact import receipts scoped by organization, importing actor and request UUID. No names, phones, email, messages or sensitive profile data.';
