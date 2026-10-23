-- Prepared locally only. No legacy activity write is safe when these durable
-- receipts are unavailable; keep the command and retry after storage recovers.
create table private.lead_contact_outcome_command_receipts (
  organization_id uuid not null,
  actor_id uuid not null,
  command_id uuid not null,
  lead_id uuid not null,
  channel text not null check (channel in ('call', 'email')),
  payload_sha256 text not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  activity_id uuid,
  recorded_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (organization_id, actor_id, command_id),
  constraint lead_contact_outcome_command_completion_check check (
    (activity_id is null and recorded_at is null)
    or (activity_id is not null and recorded_at is not null)
  )
);
-- Receipts survive activity/lead deletion. A retry must never recreate either.
alter table private.lead_contact_outcome_command_receipts owner to postgres;
alter table private.lead_contact_outcome_command_receipts enable row level security;
revoke all on table private.lead_contact_outcome_command_receipts from public, anon, authenticated, service_role;
comment on table private.lead_contact_outcome_command_receipts is
  'Backend-only contact outcome receipts: organization/actor/command identity, lead/channel, normalized payload hash and original ACK. No notes, mutable-resource FK or automatic expiry.';
