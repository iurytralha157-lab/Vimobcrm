-- Keep the organization inbox fresh even while a WhatsApp contact is still
-- unlinked, and reconcile only historical links that are unambiguous under
-- the canonical phone normalizer.
--
-- The backfill intentionally runs before lead_id is added to the broadcast
-- trigger. This prevents one Realtime event per historical message. A single
-- content-free wake-up is emitted per affected organization afterwards.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '5min';

-- This is an online, best-effort pass: it does not lock the high-volume
-- message table. New writes derive lead_id from the conversation after it is
-- linked. Re-running this idempotent pass can pick up an already-open webhook
-- transaction that committed with legacy context.

create temporary table whatsapp_exact_phone_link_candidates (
  conversation_id uuid primary key,
  organization_id uuid not null,
  lead_id uuid not null,
  assigned_user_id uuid
) on commit drop;

with unique_lead_phone as (
  select
    lead.organization_id,
    public.normalize_phone(lead.phone) as normalized_phone,
    (array_agg(lead.id order by lead.id))[1] as lead_id,
    (array_agg(lead.assigned_user_id order by lead.id))[1] as assigned_user_id
  from public.leads as lead
  where public.normalize_phone(lead.phone) <> ''
  group by lead.organization_id, public.normalize_phone(lead.phone)
  having count(*) = 1
), raw_candidate as (
  select
    conversation.id as conversation_id,
    conversation.organization_id,
    conversation.session_id,
    matched_lead.lead_id,
    matched_lead.assigned_user_id,
    matched_lead.normalized_phone,
    count(*) over (
      partition by
        conversation.organization_id,
        conversation.session_id,
        matched_lead.lead_id
    ) as conversations_for_session_lead
  from public.whatsapp_conversations as conversation
  join unique_lead_phone as matched_lead
    on matched_lead.organization_id = conversation.organization_id
   and matched_lead.normalized_phone = public.normalize_phone(conversation.contact_phone)
  where conversation.deleted_at is null
    and conversation.is_group is not true
    and conversation.lead_id is null
    and public.normalize_phone(conversation.contact_phone) <> ''
), safe_candidate as (
  select candidate.*
  from raw_candidate as candidate
  where candidate.conversations_for_session_lead = 1
    -- Never choose between two active conversations that would represent the
    -- same lead in the same session, including legacy NULL-session rows.
    and not exists (
      select 1
      from public.whatsapp_conversations as linked_conversation
      where linked_conversation.id <> candidate.conversation_id
        and linked_conversation.organization_id = candidate.organization_id
        and linked_conversation.session_id is not distinct from candidate.session_id
        and linked_conversation.lead_id = candidate.lead_id
        and linked_conversation.deleted_at is null
        and linked_conversation.is_group is not true
    )
    -- Preserve historical truth. Any pre-existing message or inbound log that
    -- names another lead makes the whole conversation ineligible.
    and not exists (
      select 1
      from public.whatsapp_messages as message
      where message.conversation_id = candidate.conversation_id
        and (
          message.organization_id is distinct from candidate.organization_id
          or (
            message.lead_id is not null
            and message.lead_id <> candidate.lead_id
          )
        )
    )
    and not exists (
      select 1
      from public.whatsapp_inbound_logs as inbound_log
      where inbound_log.conversation_id = candidate.conversation_id
        and (
          inbound_log.organization_id is distinct from candidate.organization_id
          or (
            inbound_log.lead_id is not null
            and inbound_log.lead_id <> candidate.lead_id
          )
        )
    )
    -- Aliases have no conversation foreign key, so they are not rewritten.
    -- A conflicting alias for the same session/contact only excludes the row.
    and not exists (
      select 1
      from public.whatsapp_contact_identity_aliases as identity_alias
      join public.whatsapp_conversations as aliased_conversation
        on aliased_conversation.id = candidate.conversation_id
      where identity_alias.organization_id = candidate.organization_id
        and identity_alias.session_id is not distinct from candidate.session_id
        and identity_alias.is_group is not true
        and identity_alias.lead_id is not null
        and identity_alias.lead_id <> candidate.lead_id
        and (
          identity_alias.alias_jid = aliased_conversation.remote_jid
          or identity_alias.canonical_jid = aliased_conversation.remote_jid
          or public.normalize_phone(identity_alias.contact_phone) = candidate.normalized_phone
        )
    )
)
insert into pg_temp.whatsapp_exact_phone_link_candidates (
  conversation_id,
  organization_id,
  lead_id,
  assigned_user_id
)
select
  candidate.conversation_id,
  candidate.organization_id,
  candidate.lead_id,
  candidate.assigned_user_id
from safe_candidate as candidate;

create temporary table whatsapp_exact_phone_linked_conversations (
  conversation_id uuid primary key,
  organization_id uuid not null,
  lead_id uuid not null,
  assigned_user_id uuid
) on commit drop;

with linked_conversation as (
  update public.whatsapp_conversations as conversation
  set lead_id = candidate.lead_id,
      assigned_user_id = coalesce(
        conversation.assigned_user_id,
        case
          -- Historical leads may still point at a deactivated assignee. Link
          -- the conversation without reviving that invalid responsibility.
          when candidate.assigned_user_id is not null
           and exists (
             select 1
             from public.organization_members as member
             join public.users as assignee
               on assignee.id = member.user_id
             where member.organization_id = candidate.organization_id
               and member.user_id = candidate.assigned_user_id
               and coalesce(member.is_active, false) = true
               and coalesce(assignee.is_active, false) = true
           ) then candidate.assigned_user_id
          else null
        end
      ),
      updated_at = clock_timestamp()
  from pg_temp.whatsapp_exact_phone_link_candidates as candidate
  where conversation.id = candidate.conversation_id
    and conversation.organization_id = candidate.organization_id
    and conversation.lead_id is null
    and conversation.deleted_at is null
    and conversation.is_group is not true
  returning
    conversation.id,
    conversation.organization_id,
    conversation.lead_id,
    conversation.assigned_user_id
)
insert into pg_temp.whatsapp_exact_phone_linked_conversations (
  conversation_id,
  organization_id,
  lead_id,
  assigned_user_id
)
select id, organization_id, lead_id, assigned_user_id
from linked_conversation;

create temporary table whatsapp_exact_phone_link_backfill_stats (
  linked_messages bigint not null default 0,
  linked_inbound_logs bigint not null default 0
) on commit drop;

insert into pg_temp.whatsapp_exact_phone_link_backfill_stats default values;

with linked_message as (
  update public.whatsapp_messages as message
  set lead_id = linked_conversation.lead_id
  from pg_temp.whatsapp_exact_phone_linked_conversations as linked_conversation
  where message.organization_id = linked_conversation.organization_id
    and message.conversation_id = linked_conversation.conversation_id
    and message.lead_id is null
  returning message.id
)
update pg_temp.whatsapp_exact_phone_link_backfill_stats
set linked_messages = (select count(*) from linked_message);

with linked_inbound_log as (
  update public.whatsapp_inbound_logs as inbound_log
  set lead_id = linked_conversation.lead_id,
      assigned_user_id = coalesce(
        inbound_log.assigned_user_id,
        linked_conversation.assigned_user_id
      )
  from pg_temp.whatsapp_exact_phone_linked_conversations as linked_conversation
  where inbound_log.organization_id = linked_conversation.organization_id
    and inbound_log.conversation_id = linked_conversation.conversation_id
    and inbound_log.lead_id is null
  returning inbound_log.id
)
update pg_temp.whatsapp_exact_phone_link_backfill_stats
set linked_inbound_logs = (select count(*) from linked_inbound_log);

create or replace function private.broadcast_whatsapp_message_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  message_row public.whatsapp_messages;
begin
  message_row := case when tg_op = 'DELETE' then old else new end;

  -- The organization topic is a content-free cache invalidation hint. It is
  -- emitted even before the contact has a lead and never carries message text,
  -- media, phone numbers, JIDs, or other contact data.
  begin
    perform realtime.send(
      jsonb_build_object('scope', 'conversations'),
      'whatsapp.inbox.changed',
      'whatsapp:' || message_row.organization_id::text || ':inbox',
      true
    );
  exception when others then
    null;
  end;

  -- Keep the detailed hint isolated from the inbox hint. A failure here must
  -- neither roll back the canonical write nor undo a successful inbox wake-up.
  if message_row.lead_id is not null then
    begin
      perform realtime.send(
        jsonb_build_object(
          'operation', tg_op,
          'messageId', message_row.id,
          'conversationId', message_row.conversation_id,
          'clientMessageId', message_row.client_message_id,
          'status', message_row.status,
          'sentAt', message_row.sent_at
        ),
        'whatsapp.message.changed',
        'whatsapp:' || message_row.organization_id::text || ':lead:' || message_row.lead_id::text,
        true
      );
    exception when others then
      null;
    end;
  end if;

  -- When an UPDATE moves a message away from a previously linked lead, wake
  -- that old private topic as well so its cached history can remove the row.
  if tg_op = 'UPDATE'
     and old.lead_id is not null
     and old.lead_id is distinct from new.lead_id then
    begin
      perform realtime.send(
        jsonb_build_object(
          'operation', tg_op,
          'messageId', old.id,
          'conversationId', old.conversation_id,
          'clientMessageId', old.client_message_id,
          'status', old.status,
          'sentAt', old.sent_at
        ),
        'whatsapp.message.changed',
        'whatsapp:' || old.organization_id::text || ':lead:' || old.lead_id::text,
        true
      );
    exception when others then
      null;
    end;
  end if;

  return null;
end;
$$;

-- CREATE OR REPLACE preserves the postgres owner and the existing EXECUTE
-- grants. SECURITY DEFINER and the empty search_path remain unchanged.

drop trigger if exists whatsapp_message_private_broadcast on public.whatsapp_messages;
create trigger whatsapp_message_private_broadcast
after insert or update of lead_id, status, delivered_at, read_at, media_status,
  media_url, content, message_type, reaction_emoji, reaction_to_message_id
on public.whatsapp_messages
for each row execute function private.broadcast_whatsapp_message_change();

do $notify_reconciled_organizations$
declare
  affected_organization record;
  linked_conversation_count bigint;
  linked_message_count bigint;
  linked_inbound_log_count bigint;
  affected_organization_count bigint;
begin
  select count(*)
  into linked_conversation_count
  from pg_temp.whatsapp_exact_phone_linked_conversations;

  select linked_messages, linked_inbound_logs
  into linked_message_count, linked_inbound_log_count
  from pg_temp.whatsapp_exact_phone_link_backfill_stats;

  select count(distinct linked.organization_id)
  into affected_organization_count
  from pg_temp.whatsapp_exact_phone_linked_conversations as linked;

  for affected_organization in
    select distinct linked.organization_id
    from pg_temp.whatsapp_exact_phone_linked_conversations as linked
  loop
    begin
      perform realtime.send(
        jsonb_build_object('scope', 'conversations'),
        'whatsapp.inbox.changed',
        'whatsapp:' || affected_organization.organization_id::text || ':inbox',
        true
      );
    exception when others then
      raise warning
        'WhatsApp backfill wake-up failed for organization % (SQLSTATE %)',
        affected_organization.organization_id,
        sqlstate;
    end;
  end loop;

  raise notice
    'WhatsApp exact-phone backfill linked % conversation(s), % message(s), and % inbound log(s) across % organization(s)',
    linked_conversation_count,
    linked_message_count,
    linked_inbound_log_count,
    affected_organization_count;
end;
$notify_reconciled_organizations$;

commit;
