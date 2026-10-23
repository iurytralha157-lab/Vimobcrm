-- Local preparation only: apply before the new upload client. No existing
-- contact, attachment, storage object or import receipt is changed.
create table private.lead_attachment_upload_receipts (
  organization_id uuid not null,
  actor_id uuid not null,
  request_key uuid not null,
  lead_id uuid not null,
  payload_sha256 text not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  object_path text not null check (object_path like 'orgs/' || organization_id::text || '/leads/' || lead_id::text || '/docs/%'),
  attachment_id uuid,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  primary key (organization_id, actor_id, request_key),
  constraint lead_attachment_upload_completion_check check (
    (attachment_id is null and completed_at is null)
    or (attachment_id is not null and completed_at is not null)
  )
);
-- No FK to lead/attachment: a completed request must never recreate deleted
-- data. Pending object references remain tracked after ambiguous Storage or
-- COMMIT outcomes; the same actor/request/payload can safely resume them.
alter table private.lead_attachment_upload_receipts owner to postgres;
alter table private.lead_attachment_upload_receipts enable row level security;
revoke all on table private.lead_attachment_upload_receipts from public, anon, authenticated, service_role;
comment on table private.lead_attachment_upload_receipts is
  'Backend-only upload receipts: organization, actor, operation UUID, SHA256 digest and scoped object reference. No file bytes or contact profile payload.';
