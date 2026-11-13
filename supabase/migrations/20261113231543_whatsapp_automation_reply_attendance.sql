begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Service-owned evidence for future replies. The accepted row outlives outbox
-- retention and stays tied to the binding that authorized the original send.
create table private.whatsapp_automation_reply_starts (
  outbox_id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  session_id uuid not null,
  conversation_id uuid not null,
  lead_id uuid not null,
  binding_id uuid not null references public.whatsapp_conversation_lead_bindings(id) on delete cascade,
  publisher_user_id uuid not null,
  owner_user_id uuid not null,
  provider_message_id text not null check (btrim(provider_message_id) <> ''),
  started_at timestamptz not null,
  ingress_cutoff bigint not null check (ingress_cutoff >= 0),
  accepted_at timestamptz check (accepted_at >= started_at),
  check (publisher_user_id = owner_user_id)
);

create index whatsapp_automation_reply_starts_scope_idx
  on private.whatsapp_automation_reply_starts (organization_id, session_id, conversation_id, binding_id, started_at);

create index whatsapp_automation_reply_starts_binding_idx
  on private.whatsapp_automation_reply_starts (binding_id);

alter table private.whatsapp_automation_reply_starts enable row level security;
revoke all on private.whatsapp_automation_reply_starts from public, anon, authenticated, service_role;

commit;
