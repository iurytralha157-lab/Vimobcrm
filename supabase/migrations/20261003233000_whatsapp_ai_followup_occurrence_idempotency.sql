begin;
set local lock_timeout = '5s';
set local statement_timeout = '1min';

-- One durable identity for the current AI follow-up of each lead. The API
-- reserves it before running AI, then reuses it after every uncertain result.
-- No existing follow-up or WhatsApp row is modified by this migration.
create table private.whatsapp_ai_followup_attempts (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  attempt_id uuid not null default pg_catalog.gen_random_uuid(),
  conversation_id uuid not null,
  session_id uuid not null,
  due_at timestamptz not null,
  status text not null default 'active'
    check (status in ('active', 'completed', 'cancelled', 'legacy_review')),
  next_due_at timestamptz,
  legacy_message_id uuid,
  legacy_client_message_id text,
  legacy_outbox_id uuid,
  legacy_outbox_status text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (organization_id, lead_id),
  unique (attempt_id),
  check (status <> 'completed' or next_due_at is not null),
  check (status <> 'legacy_review' or legacy_message_id is not null)
);

comment on table private.whatsapp_ai_followup_attempts is
  'Durable per-lead identity for AI follow-up retries. Legacy sends near the prior 15-minute claim lease are retained for review without another automatic send.';

alter table private.whatsapp_ai_followup_attempts enable row level security;
revoke all on private.whatsapp_ai_followup_attempts
  from public, anon, authenticated, service_role;
grant select, insert, update on private.whatsapp_ai_followup_attempts
  to service_role;

commit;
