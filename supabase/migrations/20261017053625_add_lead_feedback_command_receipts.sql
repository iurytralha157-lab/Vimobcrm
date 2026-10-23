-- Prepared locally only. The new API/client must not fall back to a legacy
-- non-idempotent write when this receipt table is unavailable.
create table private.lead_feedback_command_receipts (
  organization_id uuid not null,
  actor_id uuid not null,
  command_id uuid not null,
  lead_id uuid not null,
  payload_sha256 text not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  activity_id uuid,
  recorded_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (organization_id, actor_id, command_id),
  constraint lead_feedback_command_completion_check check (
    (activity_id is null and recorded_at is null)
    or (activity_id is not null and recorded_at is not null)
  )
);
-- No FK to a mutable/deletable CRM resource: the receipt must survive deletion
-- of an activity or lead and must never recreate either on a delayed retry.
create index lead_feedback_command_receipts_lead_idx
  on private.lead_feedback_command_receipts (organization_id, lead_id);
alter table private.lead_feedback_command_receipts owner to postgres;
alter table private.lead_feedback_command_receipts enable row level security;
revoke all on table private.lead_feedback_command_receipts from public, anon, authenticated, service_role;
comment on table private.lead_feedback_command_receipts is
  'Backend-only feedback command receipts. Organization/actor/command scope, normalized payload hash and acknowledgement only; no feedback text. Retained across CRM activity deletion; no automatic expiry.';
