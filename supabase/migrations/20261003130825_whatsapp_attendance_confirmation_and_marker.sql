-- Keep the authorization/capture entry distinct from a visible participation
-- marker. The latter is written only after Evolution confirms a human send.
begin;

set local lock_timeout = '5s';
set local statement_timeout = '5min';

alter table public.whatsapp_attendance_entries
  add column marker_at timestamptz,
  add column marker_kind text;

alter table public.whatsapp_attendance_entries
  drop constraint whatsapp_attendance_entries_source_check,
  add constraint whatsapp_attendance_entries_source_check check (
    (
      entry_source in ('manual', 'implicit')
      and bootstrap_provider_message_id is null
      and bootstrap_ingress_sequence is null
      and bootstrap_provider_occurred_at is null
      and bootstrap_inbox_created_at is null
    ) or (
      entry_source = 'ctwa_auto'
      and btrim(coalesce(bootstrap_provider_message_id, '')) <> ''
      and bootstrap_ingress_sequence is not null
      and bootstrap_ingress_sequence > 0
      and ingress_sequence_cutoff = bootstrap_ingress_sequence
      and bootstrap_provider_occurred_at is not null
      and bootstrap_inbox_created_at is not null
      and bootstrap_provider_occurred_at <= bootstrap_inbox_created_at
    )
  ) not valid,
  add constraint whatsapp_attendance_entries_marker_check check (
    (marker_at is null and marker_kind is null)
    or (marker_at is not null and marker_kind in ('started', 'joined'))
  ) not valid;

comment on column public.whatsapp_attendance_entries.marker_at is
  'First human WhatsApp send confirmed by Evolution for this attendance entry; NULL entries authorize capture but are not visible participation markers.';
comment on column public.whatsapp_attendance_entries.marker_kind is
  'started when the lead card had no earlier captured message, joined otherwise.';
comment on column public.whatsapp_attendance_entries.entry_source is
  'manual records a confirmation in this binding; implicit is a technical send/capture gate without a pop-up; ctwa_auto is the verified first CTWA event. The durable one-time consent is stored separately.';
comment on table public.whatsapp_attendance_entries is
  'Backend attendance and capture ledger. Its marker columns are filled once after Evolution confirms a human send; entries without a marker are technical and hidden from the conversation timeline.';

grant update (marker_at, marker_kind)
on public.whatsapp_attendance_entries to service_role;

create table public.whatsapp_attendance_send_consents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null,
  lead_id uuid not null,
  number_key text not null,
  confirmed_at timestamptz not null default clock_timestamp(),
  constraint whatsapp_attendance_send_consents_number_key_check check (
    number_key ~ '^phone:[0-9]{8,20}$'
    or number_key ~ '^session:[0-9a-f-]{36}$'
  ),
  constraint whatsapp_attendance_send_consents_identity_key
    unique (organization_id, user_id, lead_id, number_key)
);

comment on table public.whatsapp_attendance_send_consents is
  'Backend-only confirmation to share outbound WhatsApp history once per organization, user, physical number and lead. session: is a conservative fallback if a connected session has no verifiable number.';

alter table public.whatsapp_attendance_send_consents enable row level security;
revoke all privileges on table public.whatsapp_attendance_send_consents
from public, anon, authenticated, service_role;
grant select, insert on table public.whatsapp_attendance_send_consents to service_role;

-- Carry forward explicit confirmations recorded by the former attendance
-- endpoint, but only where the current session still proves a real number.
insert into public.whatsapp_attendance_send_consents (
  organization_id, user_id, lead_id, number_key, confirmed_at
)
select entry.organization_id, entry.user_id, entry.lead_id,
       'phone:' || regexp_replace(session.phone_number, '[^0-9]', '', 'g'),
       min(entry.joined_at)
from public.whatsapp_attendance_entries as entry
join public.whatsapp_sessions as session
  on session.organization_id = entry.organization_id
 and session.id = entry.session_id
where entry.entry_source = 'manual'
  and length(regexp_replace(coalesce(session.phone_number, ''), '[^0-9]', '', 'g')) between 8 and 20
group by entry.organization_id, entry.user_id, entry.lead_id,
         regexp_replace(session.phone_number, '[^0-9]', '', 'g')
on conflict on constraint whatsapp_attendance_send_consents_identity_key do nothing;

-- The verified CTWA bootstrap continues to create a technical attendance
-- entry, but it no longer announces that its owner has joined a chat before
-- this owner actually sends a message.

create or replace function public.auto_enter_whatsapp_ctwa_attendance(
  p_organization_id uuid,
  p_conversation_id uuid,
  p_session_id uuid,
  p_lead_id uuid,
  p_binding_id uuid,
  p_provider_message_id text,
  p_ingress_sequence bigint,
  p_provider_occurred_at timestamp with time zone
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_owner_user_id uuid;
  v_actor_name text;
  v_inbox_created_at timestamp with time zone;
  v_entry_id uuid;
begin
  if p_organization_id is null
     or p_conversation_id is null
     or p_session_id is null
     or p_lead_id is null
     or p_binding_id is null
     or btrim(coalesce(p_provider_message_id, '')) = ''
     or p_ingress_sequence is null
     or p_ingress_sequence <= 0
     or p_provider_occurred_at is null then
    return null;
  end if;

  select origin.owner_user_id,
         left(coalesce(
           nullif(btrim(actor.name), ''),
           nullif(btrim(actor.email), ''),
           'Usuario'
         ), 180),
         inbox.created_at
  into v_owner_user_id, v_actor_name, v_inbox_created_at
  from private.whatsapp_ctwa_auto_origins as origin
  join public.leads as lead
    on lead.id = origin.lead_id
   and lead.organization_id = origin.organization_id
   and lead.source_session_id = origin.session_id
  join public.whatsapp_sessions as session
    on session.id = origin.session_id
   and session.organization_id = origin.organization_id
   and session.owner_user_id = origin.owner_user_id
   and session.provider = 'evolution_go'
   and session.status not in ('disabled', 'deleted')
   and coalesce(session.is_active, true) = true
  join public.users as actor
    on actor.id = origin.owner_user_id
   and actor.organization_id = origin.organization_id
   and coalesce(actor.is_active, false) = true
  join public.organization_members as member
    on member.organization_id = origin.organization_id
   and member.user_id = origin.owner_user_id
   and coalesce(member.is_active, true) = true
  join public.whatsapp_conversations as conversation
    on conversation.id = p_conversation_id
   and conversation.organization_id = origin.organization_id
   and conversation.session_id = origin.session_id
   and conversation.lead_id = origin.lead_id
   and conversation.deleted_at is null
  join public.whatsapp_conversation_lead_bindings as binding
    on binding.id = p_binding_id
   and binding.organization_id = origin.organization_id
   and binding.conversation_id = conversation.id
   and binding.session_id = origin.session_id
   and binding.lead_id = origin.lead_id
   and binding.provider_message_id = origin.provider_message_id
   and binding.active_to is null
   and binding.stale = false
  join public.whatsapp_webhook_routing_snapshots as route
    on route.organization_id = origin.organization_id
   and route.session_id = origin.session_id
   and route.provider_message_id = origin.provider_message_id
   and route.ingress_sequence = p_ingress_sequence
   and route.binding_eligible = true
   and route.snapshot->>'context_kind' = 'contextual_intake'
  join public.whatsapp_webhook_inbox as inbox
    on inbox.organization_id = route.organization_id
   and inbox.session_id = route.session_id
   and inbox.event_key = route.inbox_event_key
  where origin.organization_id = p_organization_id
    and origin.auto_entry_eligible = true
    and origin.session_id = p_session_id
    and origin.lead_id = p_lead_id
    and origin.provider_message_id = btrim(p_provider_message_id)
    and origin.provider_event_id = p_session_id::text || ':' || btrim(p_provider_message_id)
    and lead.metadata->>'whatsapp_initial_provider_event_id' = origin.provider_event_id
    and lead.metadata->>'whatsapp_lead_creation_contract' = 'ctwa_ad_v2'
    and lead.metadata->>'ctwa_ad_confirmed' = 'true'
    and p_provider_occurred_at <= inbox.created_at;

  if v_owner_user_id is null then
    return null;
  end if;

  insert into public.whatsapp_attendance_entries (
    organization_id,
    conversation_id,
    session_id,
    lead_id,
    binding_id,
    user_id,
    actor_name_snapshot,
    joined_at,
    ingress_sequence_cutoff,
    entry_source,
    bootstrap_provider_message_id,
    bootstrap_ingress_sequence,
    bootstrap_provider_occurred_at,
    bootstrap_inbox_created_at
  ) values (
    p_organization_id,
    p_conversation_id,
    p_session_id,
    p_lead_id,
    p_binding_id,
    v_owner_user_id,
    v_actor_name,
    clock_timestamp(),
    p_ingress_sequence,
    'ctwa_auto',
    btrim(p_provider_message_id),
    p_ingress_sequence,
    p_provider_occurred_at,
    v_inbox_created_at
  )
  on conflict on constraint whatsapp_attendance_entries_identity_key
    do nothing
  returning id into v_entry_id;

  if v_entry_id is null then
    select entry.id
    into v_entry_id
    from public.whatsapp_attendance_entries as entry
    where entry.organization_id = p_organization_id
      and entry.conversation_id = p_conversation_id
      and entry.session_id = p_session_id
      and entry.lead_id = p_lead_id
      and entry.binding_id = p_binding_id
      and entry.user_id = v_owner_user_id
      and entry.entry_source = 'ctwa_auto'
      and entry.bootstrap_provider_message_id = btrim(p_provider_message_id)
      and entry.bootstrap_ingress_sequence = p_ingress_sequence
      and entry.bootstrap_provider_occurred_at = p_provider_occurred_at
      and entry.bootstrap_inbox_created_at = v_inbox_created_at;
    return v_entry_id;
  end if;

  return v_entry_id;
end;
$$;

commit;
