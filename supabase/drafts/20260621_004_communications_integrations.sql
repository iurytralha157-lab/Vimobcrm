-- Vimob CRM - DRAFT ONLY - WhatsApp/Evolution, Meta, notifications and integrations
-- Do not run before review.
-- Pages covered:
--   /crm/conversas
--   /settings?tab=whatsapp
--   /settings/whatsapp/inbound-rules
--   /settings/integrations/meta
--   notifications and push flows
--
-- Security principle:
--   Provider tokens, API keys and Evolution secrets should stay in Edge Functions/backend.
--   Client tables store safe identifiers/status and user-visible data only.

create table if not exists public.whatsapp_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  provider text not null default 'evolution_go',
  provider_instance_id text,
  phone_number text,
  status text not null default 'disconnected',
  qr_code text,
  last_connected_at timestamptz,
  last_error text,
  created_by uuid references public.users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint whatsapp_sessions_status_check check (status in ('disconnected', 'connecting', 'connected', 'error', 'disabled'))
);

create table if not exists public.whatsapp_session_access (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  session_id uuid not null references public.whatsapp_sessions(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  can_read boolean not null default true,
  can_send boolean not null default false,
  created_at timestamptz not null default now(),
  constraint whatsapp_session_access_unique unique (session_id, user_id)
);

create table if not exists public.whatsapp_conversations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  session_id uuid references public.whatsapp_sessions(id) on delete set null,
  lead_id uuid references public.leads(id) on delete set null,
  assigned_user_id uuid references public.users(id) on delete set null,
  remote_jid text not null,
  contact_name text,
  contact_phone text,
  contact_picture text,
  contact_presence text,
  presence_updated_at timestamptz,
  is_group boolean not null default false,
  is_archived boolean not null default false,
  archived_at timestamptz,
  deleted_at timestamptz,
  unread_count integer not null default 0,
  last_message text,
  last_message_at timestamptz,
  last_message_preview text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint whatsapp_conversations_unique_remote unique (organization_id, session_id, remote_jid)
);

create table if not exists public.whatsapp_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  conversation_id uuid not null references public.whatsapp_conversations(id) on delete cascade,
  session_id uuid references public.whatsapp_sessions(id) on delete set null,
  lead_id uuid references public.leads(id) on delete set null,
  sender_user_id uuid references public.users(id) on delete set null,
  provider_message_id text,
  message_id text,
  client_message_id text,
  from_me boolean not null default false,
  direction text not null default 'inbound',
  message_type text not null default 'text',
  content text,
  media_url text,
  media_mime_type text,
  media_storage_path text,
  media_status text,
  media_error text,
  media_size bigint,
  remote_jid text,
  reaction_to_message_id text,
  reaction_emoji text,
  reaction_sender_jid text,
  reaction_sender_name text,
  status text not null default 'received',
  error_message text,
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  received_at timestamptz,
  sender_jid text,
  sender_name text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint whatsapp_messages_direction_check check (direction in ('inbound', 'outbound')),
  constraint whatsapp_messages_status_check check (status in ('draft', 'queued', 'pending', 'sent', 'delivered', 'read', 'received', 'failed', 'error')),
  constraint whatsapp_messages_unique_provider unique (conversation_id, message_id)
);

create table if not exists public.whatsapp_groups (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  session_id uuid references public.whatsapp_sessions(id) on delete set null,
  remote_jid text not null,
  name text,
  picture_url text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint whatsapp_groups_unique unique (organization_id, session_id, remote_jid)
);

create table if not exists public.whatsapp_labels (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  color text not null default '#FF4529',
  created_at timestamptz not null default now(),
  constraint whatsapp_labels_unique unique (organization_id, name)
);

create table if not exists public.whatsapp_chat_labels (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  conversation_id uuid not null references public.whatsapp_conversations(id) on delete cascade,
  label_id uuid not null references public.whatsapp_labels(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint whatsapp_chat_labels_unique unique (conversation_id, label_id)
);

create table if not exists public.whatsapp_message_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  content text not null,
  variables text[] not null default '{}',
  is_active boolean not null default true,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.whatsapp_inbound_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  session_id uuid references public.whatsapp_sessions(id) on delete cascade,
  name text not null,
  match_type text not null default 'all',
  conditions jsonb not null default '{}'::jsonb,
  action_type text not null,
  action_config jsonb not null default '{}'::jsonb,
  priority integer not null default 0,
  is_active boolean not null default true,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.meta_integrations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  integration_type text not null default 'facebook_leads',
  page_id text,
  page_name text,
  page_picture_url text,
  facebook_user_id text,
  facebook_user_name text,
  instagram_business_account_id text,
  instagram_username text,
  pipeline_id uuid references public.pipelines(id) on delete set null,
  stage_id uuid references public.stages(id) on delete set null,
  assigned_user_id uuid references public.users(id) on delete set null,
  ad_account_id text,
  selected_ad_accounts jsonb not null default '[]'::jsonb,
  form_ids jsonb,
  field_mapping jsonb,
  campaign_property_mapping jsonb,
  default_status text,
  is_connected boolean not null default false,
  leads_received integer not null default 0,
  last_lead_at timestamptz,
  last_sync_at timestamptz,
  last_validated_at timestamptz,
  webhook_subscribed_at timestamptz,
  token_status text,
  token_expires_at timestamptz,
  health_status text,
  last_error text,
  access_token_secret_ref text,
  user_token_secret_ref text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint meta_integrations_unique_page unique (organization_id, page_id)
);

create table if not exists public.meta_form_configs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  integration_id uuid references public.meta_integrations(id) on delete cascade,
  page_id text,
  form_id text not null,
  form_name text,
  pipeline_id uuid references public.pipelines(id) on delete set null,
  stage_id uuid references public.stages(id) on delete set null,
  default_status text,
  assigned_user_id uuid references public.users(id) on delete set null,
  round_robin_id uuid references public.round_robins(id) on delete set null,
  property_id uuid references public.properties(id) on delete set null,
  purpose text,
  source text,
  source_details text,
  default_values jsonb not null default '{}'::jsonb,
  auto_tags jsonb not null default '[]'::jsonb,
  field_mapping jsonb not null default '{}'::jsonb,
  custom_fields_config jsonb not null default '[]'::jsonb,
  is_active boolean not null default true,
  leads_received integer not null default 0,
  last_lead_at timestamptz,
  created_by uuid references public.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint meta_form_configs_unique unique (organization_id, form_id)
);

create or replace view public.meta_integrations_public
with (security_invoker = true)
as
select
  id,
  organization_id,
  integration_type,
  page_id,
  page_name,
  page_picture_url,
  facebook_user_id,
  facebook_user_name,
  instagram_business_account_id,
  instagram_username,
  pipeline_id,
  stage_id,
  assigned_user_id,
  ad_account_id,
  selected_ad_accounts,
  form_ids,
  field_mapping,
  campaign_property_mapping,
  default_status,
  is_connected,
  leads_received,
  last_lead_at,
  last_sync_at,
  last_validated_at,
  webhook_subscribed_at,
  token_status,
  token_expires_at,
  health_status,
  last_error,
  created_at,
  updated_at
from public.meta_integrations;

create table if not exists public.meta_webhook_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete set null,
  object_type text,
  event_type text,
  provider_event_id text,
  payload jsonb not null default '{}'::jsonb,
  processed_at timestamptz,
  error_message text,
  created_at timestamptz not null default now()
);

create table if not exists public.meta_campaign_insights (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  campaign_id text not null,
  campaign_name text,
  adset_id text,
  adset_name text,
  ad_id text,
  ad_name text,
  spend numeric(14,2),
  impressions integer,
  clicks integer,
  leads_count integer,
  date_start date,
  date_stop date,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.meta_conversations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  page_id text not null,
  provider_conversation_id text not null,
  lead_id uuid references public.leads(id) on delete set null,
  contact_name text,
  last_message_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint meta_conversations_unique unique (organization_id, page_id, provider_conversation_id)
);

create table if not exists public.meta_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  conversation_id uuid not null references public.meta_conversations(id) on delete cascade,
  provider_message_id text,
  direction text not null,
  content text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.webhooks_integrations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  type text not null default 'incoming',
  provider text not null default 'custom',
  direction text not null default 'incoming',
  api_token text,
  webhook_url text,
  target_pipeline_id uuid references public.pipelines(id) on delete set null,
  target_team_id uuid references public.teams(id) on delete set null,
  target_stage_id uuid references public.stages(id) on delete set null,
  target_tag_ids uuid[] not null default '{}',
  target_property_id uuid references public.properties(id) on delete set null,
  field_mapping jsonb not null default '{}'::jsonb,
  leads_received integer not null default 0,
  last_lead_at timestamptz,
  last_triggered_at timestamptz,
  trigger_events text[] not null default '{}',
  secret_ref text,
  config jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint webhooks_integrations_type_check check (type in ('incoming', 'outgoing')),
  constraint webhooks_integrations_direction_check check (direction in ('incoming', 'outgoing'))
);

create table if not exists public.google_calendar_tokens (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  account_email text,
  token_secret_ref text not null,
  scopes text[] not null default '{}',
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint google_calendar_tokens_unique unique (organization_id, user_id, account_email)
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  user_id uuid references public.users(id) on delete cascade,
  title text not null,
  content text,
  body text,
  type text not null default 'info',
  channel text not null default 'in_app',
  lead_id uuid references public.leads(id) on delete set null,
  target_url text,
  is_read boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.push_tokens (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  endpoint text not null,
  p256dh text,
  auth text,
  user_agent text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint push_tokens_unique unique (user_id, endpoint)
);

create index if not exists idx_whatsapp_conversations_org_session on public.whatsapp_conversations(organization_id, session_id);
create index if not exists idx_whatsapp_messages_conversation on public.whatsapp_messages(conversation_id, created_at desc);
create index if not exists idx_notifications_user_unread on public.notifications(user_id, is_read, created_at desc);
create index if not exists idx_meta_integrations_org on public.meta_integrations(organization_id, created_at desc);
create index if not exists idx_meta_integrations_page on public.meta_integrations(organization_id, page_id);
create index if not exists idx_meta_form_configs_integration on public.meta_form_configs(integration_id, is_active);
create index if not exists idx_meta_webhook_events_created on public.meta_webhook_events(created_at desc);

create or replace function private.set_whatsapp_message_defaults()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  conversation_org_id uuid;
begin
  select c.organization_id
    into conversation_org_id
  from public.whatsapp_conversations c
  where c.id = new.conversation_id;

  if conversation_org_id is null then
    raise exception 'Conversa WhatsApp nao encontrada para preencher organization_id.';
  end if;

  new.organization_id = conversation_org_id;
  new.direction = case when new.from_me then 'outbound' else 'inbound' end;
  new.message_id = coalesce(new.message_id, new.client_message_id, gen_random_uuid()::text);
  new.provider_message_id = coalesce(new.provider_message_id, new.message_id);
  return new;
end;
$$;

drop trigger if exists set_whatsapp_message_defaults on public.whatsapp_messages;
create trigger set_whatsapp_message_defaults
before insert or update on public.whatsapp_messages
for each row execute function private.set_whatsapp_message_defaults();

drop trigger if exists set_updated_at_meta_integrations on public.meta_integrations;
create trigger set_updated_at_meta_integrations
before update on public.meta_integrations
for each row execute function private.set_updated_at();

drop trigger if exists set_updated_at_meta_form_configs on public.meta_form_configs;
create trigger set_updated_at_meta_form_configs
before update on public.meta_form_configs
for each row execute function private.set_updated_at();

do $$
declare
  t text;
begin
  foreach t in array array[
    'whatsapp_sessions', 'whatsapp_session_access', 'whatsapp_conversations',
    'whatsapp_messages', 'whatsapp_groups', 'whatsapp_labels', 'whatsapp_chat_labels',
    'whatsapp_message_templates', 'whatsapp_inbound_rules', 'meta_form_configs',
    'meta_campaign_insights', 'meta_conversations', 'meta_messages',
    'webhooks_integrations', 'google_calendar_tokens'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('drop policy if exists %I on public.%I', 'members read ' || t, t);
    execute format('drop policy if exists %I on public.%I', 'communication admins manage ' || t, t);
    execute format('create policy %I on public.%I for select to authenticated using (private.is_org_member(organization_id))', 'members read ' || t, t);
    execute format('create policy %I on public.%I for all to authenticated using (private.has_permission(organization_id, ''whatsapp_manage'') or private.has_permission(organization_id, ''settings_manage'') or private.has_org_role(organization_id, array[''owner'', ''admin''])) with check (private.has_permission(organization_id, ''whatsapp_manage'') or private.has_permission(organization_id, ''settings_manage'') or private.has_org_role(organization_id, array[''owner'', ''admin'']))', 'communication admins manage ' || t, t);
  end loop;
end $$;

alter table public.meta_integrations enable row level security;
alter table public.notifications enable row level security;
alter table public.push_tokens enable row level security;
alter table public.meta_webhook_events enable row level security;

revoke all on public.meta_integrations from anon, authenticated;
grant select (
  id,
  organization_id,
  integration_type,
  page_id,
  page_name,
  page_picture_url,
  facebook_user_id,
  facebook_user_name,
  instagram_business_account_id,
  instagram_username,
  pipeline_id,
  stage_id,
  assigned_user_id,
  ad_account_id,
  selected_ad_accounts,
  form_ids,
  field_mapping,
  campaign_property_mapping,
  default_status,
  is_connected,
  leads_received,
  last_lead_at,
  last_sync_at,
  last_validated_at,
  webhook_subscribed_at,
  token_status,
  token_expires_at,
  health_status,
  last_error,
  created_at,
  updated_at
) on public.meta_integrations to authenticated;
grant select on public.meta_integrations_public to authenticated;
grant select, update on public.notifications to authenticated;
grant insert on public.notifications to authenticated;
grant select, insert, update, delete on public.push_tokens to authenticated;
grant select on public.meta_webhook_events to authenticated;

drop policy if exists "members read safe meta integration columns" on public.meta_integrations;
create policy "members read safe meta integration columns"
on public.meta_integrations
for select
to authenticated
using (private.is_org_member(organization_id));

drop policy if exists "backend manages meta integrations" on public.meta_integrations;
create policy "backend manages meta integrations"
on public.meta_integrations
for all
to service_role
using (true)
with check (true);

drop policy if exists "users read own notifications" on public.notifications;
create policy "users read own notifications"
on public.notifications
for select
to authenticated
using (user_id = auth.uid() or private.has_org_role(organization_id, array['owner', 'admin']));

drop policy if exists "users update own notifications" on public.notifications;
create policy "users update own notifications"
on public.notifications
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "system members can create notifications" on public.notifications;
create policy "system members can create notifications"
on public.notifications
for insert
to authenticated
with check (
  user_id = auth.uid()
  or private.has_org_role(organization_id, array['owner', 'admin'])
);

drop policy if exists "users manage own push tokens" on public.push_tokens;
create policy "users manage own push tokens"
on public.push_tokens
for all
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "admins read meta webhook events" on public.meta_webhook_events;
create policy "admins read meta webhook events"
on public.meta_webhook_events
for select
to authenticated
using (organization_id is null or private.has_org_role(organization_id, array['owner', 'admin']));

-- No automatic lead notification/send policy:
-- notifications are internal user notifications only. Outbound WhatsApp must pass through backend/outbox.
