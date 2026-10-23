begin;
set local lock_timeout = '5s';
set local statement_timeout = '5min';

-- One content-free notification per real inbound message and responsible user.
-- Reassignment may redirect an untouched delivery, but never replay history.
create unique index notifications_whatsapp_inbound_recipient_unique
on public.notifications (organization_id, (metadata->>'whatsapp_message_id'), user_id)
where metadata->>'event_key' = 'whatsapp_inbound_attendant';

create or replace function private.whatsapp_inbound_push_recipient(
  p_organization_id uuid, p_message_id uuid
)
returns table (user_id uuid, attendance_entry_id uuid, binding_id uuid, grant_id uuid)
language sql stable security definer set search_path = ''
as $$
  select lead.assigned_user_id, entry.id, binding.id, access.id
  from public.whatsapp_messages message
  join public.whatsapp_sessions session
    on session.id = message.session_id and session.organization_id = message.organization_id
   and coalesce(session.is_active, true) and session.status not in ('disabled', 'deleted')
  join public.whatsapp_conversations conversation
    on conversation.id = message.conversation_id and conversation.organization_id = message.organization_id
   and conversation.session_id = session.id and conversation.lead_id = message.lead_id
   and conversation.deleted_at is null and conversation.retired_at is null
   and not coalesce(conversation.is_group, false)
  join public.leads lead on lead.id = message.lead_id and lead.organization_id = message.organization_id
  join public.users actor on actor.id = lead.assigned_user_id
   and actor.organization_id = message.organization_id and coalesce(actor.is_active, false)
  join public.organization_members member on member.user_id = actor.id
   and member.organization_id = message.organization_id and coalesce(member.is_active, false)
   and member.deleted_at is null
  join public.users owner_user on owner_user.id = session.owner_user_id
   and coalesce(owner_user.is_active, false)
  join public.organization_members owner_member on owner_member.user_id = owner_user.id
   and owner_member.organization_id = message.organization_id and coalesce(owner_member.is_active, false)
   and owner_member.deleted_at is null
  join public.whatsapp_conversation_lead_bindings binding
    on binding.organization_id = message.organization_id and binding.conversation_id = conversation.id
   and binding.session_id = session.id and binding.lead_id = lead.id
   and binding.active_to is null and not binding.stale
  join public.whatsapp_attendance_entries entry
    on entry.organization_id = message.organization_id and entry.conversation_id = conversation.id
   and entry.session_id = session.id and entry.lead_id = lead.id
   and entry.binding_id = binding.id and entry.user_id = lead.assigned_user_id
  left join public.whatsapp_session_access access
    on access.organization_id = message.organization_id and access.session_id = session.id
   and access.user_id = actor.id and access.granted_by = session.owner_user_id
   and access.access_mode = 'assigned_leads_only' and access.only_leads_access
   and access.can_view and access.can_read and access.can_send
   and access.grant_scope = 'organization' and access.grant_team_id is null
   and lower(btrim(owner_member.role)) in ('owner', 'admin')
  where message.organization_id = p_organization_id and message.id = p_message_id
    and message.capture_state = 'captured' and message.from_me is false
    and message.direction = 'inbound' and message.lead_id is not null
    and message.message_type not in ('reaction', 'system', 'deleted')
    and (actor.id = session.owner_user_id or access.id is not null)
    and private.whatsapp_actor_can_read_lead(message.organization_id, lead.id, actor.id)
  limit 1
$$;
revoke all on function private.whatsapp_inbound_push_recipient(uuid, uuid)
from public, anon, authenticated, service_role;

create or replace function private.create_whatsapp_inbound_attendant_notification(
  p_organization_id uuid, p_message_id uuid, p_user_id uuid,
  p_entry_id uuid, p_binding_id uuid, p_grant_id uuid, p_origin_notification_id uuid default null
)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_id uuid; v_expiry timestamptz;
begin
  if p_origin_notification_id is not null then
    select min(delivery.expires_at) into v_expiry from private.notification_deliveries delivery
    join public.notifications notification on notification.id=delivery.notification_id
    where notification.organization_id=p_organization_id
      and notification.metadata->>'event_key'='whatsapp_inbound_attendant'
      and notification.metadata->>'whatsapp_message_id'=p_message_id::text and delivery.channel='push';
  end if;
  insert into public.notifications (
    organization_id, user_id, lead_id, type, title, content, body, channel, target_url, metadata
  )
  select message.organization_id, p_user_id, message.lead_id, 'whatsapp',
    'Nova mensagem no WhatsApp', 'Você recebeu uma mensagem de um lead em atendimento.',
    'Você recebeu uma mensagem de um lead em atendimento.', 'in_app',
    '/crm?leadId=' || message.lead_id::text,
    pg_catalog.jsonb_build_object(
      'event_key', 'whatsapp_inbound_attendant',
      'whatsapp_message_id', message.id,
      'whatsapp_session_id', message.session_id,
      'whatsapp_conversation_id', message.conversation_id,
      'attendance_entry_id', p_entry_id, 'binding_id', p_binding_id, 'grant_id', p_grant_id,
      'origin_notification_id', p_origin_notification_id,
      'expires_at', v_expiry,
      'dedupe_key', 'whatsapp-inbound:' || message.organization_id::text || ':' || message.id::text || ':' || p_user_id::text,
      'dispatch', pg_catalog.jsonb_build_object('push', pg_catalog.jsonb_build_object('required', true))
    )
  from public.whatsapp_messages message
  where message.organization_id = p_organization_id and message.id = p_message_id
  on conflict do nothing returning id into v_id;
  if v_id is not null then
    -- Use the existing durable SSE log and its per-user audience filter. This
    -- reaches the app shell without subscribing to every lead conversation.
    -- Inserts and these hints commit together; deduplicated notifications do
    -- not generate another sound or another notification-counter event.
    insert into private.realtime_events(organization_id,user_id,audience_user_id,event_type,data)
    select message.organization_id,p_user_id,p_user_id,'notification.created',
      jsonb_build_object('notificationId',v_id,'targetUserId',p_user_id,'userId',p_user_id,
        'type','whatsapp','leadId',message.lead_id)
    from public.whatsapp_messages message where message.organization_id=p_organization_id and message.id=p_message_id;
    insert into private.realtime_events(organization_id,user_id,audience_user_id,event_type,data)
    select message.organization_id,p_user_id,p_user_id,'whatsapp.message.created',
      jsonb_build_object('messageId',message.id,'conversationId',message.conversation_id,
        'sessionId',message.session_id,'leadId',message.lead_id,'fromMe',false,
        'direction','inbound','captureState','captured','attendantUserId',p_user_id,
        'attendanceEntryId',p_entry_id,'bindingId',p_binding_id,'createdAt',message.created_at)
    from public.whatsapp_messages message where message.organization_id=p_organization_id and message.id=p_message_id;
  end if;
  if v_id is null and p_origin_notification_id is not null then
    select id into v_id from public.notifications where organization_id = p_organization_id
      and user_id = p_user_id and metadata->>'event_key' = 'whatsapp_inbound_attendant'
      and metadata->>'whatsapp_message_id' = p_message_id::text;
    update public.notifications set metadata = metadata || pg_catalog.jsonb_build_object(
      'attendance_entry_id', p_entry_id, 'binding_id', p_binding_id, 'grant_id', p_grant_id)
    where id = v_id;
    update private.notification_deliveries set status = 'queued', terminal_at = null,
      next_attempt_at = now(), last_error_code = null, last_error_message = null, updated_at = now()
    where notification_id = v_id and channel = 'push' and status = 'cancelled'
      and attempt_count = 0 and expires_at > now();
  end if;
  return v_id;
end;
$$;
revoke all on function private.create_whatsapp_inbound_attendant_notification(uuid, uuid, uuid, uuid, uuid, uuid, uuid)
from public, anon, authenticated, service_role;

create or replace function private.enqueue_whatsapp_inbound_attendant_push()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare v_recipient record;
begin
  if new.capture_state is distinct from 'captured' or new.from_me is distinct from false
     or new.direction is distinct from 'inbound' or new.lead_id is null
     or new.message_type in ('reaction', 'system', 'deleted') then return new; end if;

  select recipient.* into v_recipient
  from private.whatsapp_inbound_push_recipient(new.organization_id, new.id) recipient
  join public.whatsapp_attendance_entries entry on entry.id = recipient.attendance_entry_id
  join public.whatsapp_conversation_lead_bindings binding on binding.id = recipient.binding_id
  join public.whatsapp_webhook_routing_snapshots route
    on route.organization_id = new.organization_id and route.session_id = new.session_id
   and route.provider_message_id = coalesce(nullif(new.provider_message_id, ''), new.message_id)
  join public.whatsapp_webhook_inbox inbox
    on inbox.organization_id = route.organization_id and inbox.session_id = route.session_id
   and inbox.event_key = route.inbox_event_key and inbox.processing_epoch = route.processing_epoch
  left join private.whatsapp_webhook_session_cutovers cutover on cutover.session_id = route.session_id
  where route.processing_lane = 'live' and inbox.processing_lane = 'live'
    and route.processing_epoch = coalesce(cutover.active_epoch, 0)
    and coalesce(route.snapshot->>'processing_epoch', '0') = route.processing_epoch::text
    and coalesce(route.snapshot->>'state', '') <> 'provider_replay'
    and (
      (route.snapshot->>'conversation_id' = new.conversation_id::text
       and route.snapshot->>'active_binding_id' = binding.id::text
       and route.snapshot->>'context_kind' = 'organic'
       and route.snapshot->>'state' in ('bound', 'lead_match')
       and coalesce(route.snapshot->>'event_lead_id', route.snapshot->>'current_lead_id') = new.lead_id::text)
      or
      (entry.entry_source = 'ctwa_auto' and route.binding_eligible
       and route.snapshot->>'state' = 'contextual_intake'
       and route.snapshot->>'context_kind' = 'contextual_intake'
       and entry.bootstrap_provider_message_id = route.provider_message_id
       and entry.bootstrap_ingress_sequence = route.ingress_sequence
       and binding.provider_message_id = route.provider_message_id)
      or
      (route.binding_eligible and route.target_mode = 'inherit_predecessor'
       and route.snapshot->>'state' = 'predecessor_inherit'
       and route.snapshot->>'context_kind' = 'organic'
       and exists (
         select 1 from public.whatsapp_conversation_routing_heads head
         join public.whatsapp_webhook_routing_snapshots head_route
           on head_route.organization_id = head.organization_id and head_route.session_id = head.session_id
          and head_route.provider_message_id = head.provider_message_id
          and head_route.ingress_sequence = head.ingress_sequence
          and head_route.processing_epoch = route.processing_epoch
          and head_route.routing_key = route.routing_key and head_route.binding_eligible
         join public.whatsapp_webhook_routing_snapshots predecessor
           on predecessor.organization_id = route.organization_id
          and predecessor.session_id = route.session_id
          and predecessor.provider_message_id = route.predecessor_provider_message_id
         where head.organization_id = route.organization_id and head.session_id = route.session_id
           and head.conversation_id = new.conversation_id and head.lead_id = new.lead_id
           and head.routing_key = route.routing_key and head.ingress_sequence >= route.ingress_sequence
           and predecessor.binding_eligible and predecessor.routing_key = route.routing_key
           and predecessor.ingress_sequence < route.ingress_sequence
           and private.whatsapp_inherited_predecessor_provenance_matches(route, predecessor)
           and (predecessor.inbox_event_key = route.inbox_event_key
             or exists (select 1 from public.whatsapp_webhook_routing_outcomes outcome
               where outcome.organization_id = predecessor.organization_id and outcome.session_id = predecessor.session_id
                 and outcome.provider_message_id = predecessor.provider_message_id and outcome.ingress_sequence = predecessor.ingress_sequence)
             or exists (select 1 from public.whatsapp_webhook_inbox previous_inbox
               where previous_inbox.organization_id = predecessor.organization_id and previous_inbox.session_id = predecessor.session_id
                 and previous_inbox.event_key = predecessor.inbox_event_key and previous_inbox.status = 'processed'))
       ))
    )
    and inbox.provider_occurred_at is not null and inbox.provider_occurred_at <= inbox.created_at
    and (
      (entry.entry_source = 'manual'
       and entry.joined_at <= inbox.provider_occurred_at and entry.joined_at <= inbox.created_at
       and entry.ingress_sequence_cutoff < route.ingress_sequence)
      or
      (entry.entry_source = 'ctwa_auto' and (
        (entry.bootstrap_provider_message_id = route.provider_message_id
         and entry.bootstrap_ingress_sequence = route.ingress_sequence
         and binding.provider_message_id = route.provider_message_id)
        or
        (entry.bootstrap_ingress_sequence < route.ingress_sequence
         and entry.bootstrap_provider_occurred_at <= inbox.provider_occurred_at
         and entry.bootstrap_inbox_created_at <= inbox.created_at)
      ))
    );
  if found then
    perform private.create_whatsapp_inbound_attendant_notification(new.organization_id, new.id,
      v_recipient.user_id, v_recipient.attendance_entry_id, v_recipient.binding_id, v_recipient.grant_id);
  end if;
  return new;
end;
$$;
revoke all on function private.enqueue_whatsapp_inbound_attendant_push()
from public, anon, authenticated, service_role;
create trigger enqueue_whatsapp_inbound_attendant_push
after insert on public.whatsapp_messages for each row
execute function private.enqueue_whatsapp_inbound_attendant_push();

-- Called inside the dispatch transaction, which commits a durable attempt-start
-- marker before the bounded push call. Locks serialize assignment and revocation.
-- The per-message advisory lock serializes all devices and redirection decisions.
create or replace function private.prepare_whatsapp_inbound_attendant_push(p_notification_id uuid)
returns text language plpgsql security definer set search_path = ''
as $$
declare v_notification public.notifications%rowtype; v_message public.whatsapp_messages%rowtype;
  v_recipient record; v_session public.whatsapp_sessions%rowtype;
begin
  select * into v_notification from public.notifications where id = p_notification_id
    and metadata->>'event_key' = 'whatsapp_inbound_attendant';
  if not found then return 'revoked'; end if;
  select * into v_message from public.whatsapp_messages
    where organization_id = v_notification.organization_id
      and id = nullif(v_notification.metadata->>'whatsapp_message_id', '')::uuid;
  if not found then return 'revoked'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'whatsapp-inbound-push:' || v_message.organization_id::text || ':' || v_message.id::text, 0));
  select * into v_session from public.whatsapp_sessions
    where id = v_message.session_id and organization_id = v_message.organization_id for share;
  perform 1 from public.whatsapp_conversations where id = v_message.conversation_id
    and organization_id = v_message.organization_id for share;
  perform 1 from public.leads where id = v_message.lead_id and organization_id = v_message.organization_id for share;
  perform 1 from public.users where id in (v_session.owner_user_id,
    (select assigned_user_id from public.leads where id = v_message.lead_id and organization_id = v_message.organization_id))
    order by id for share;
  perform 1 from public.organization_members where organization_id = v_message.organization_id
    and user_id in (v_session.owner_user_id,
      (select assigned_user_id from public.leads where id = v_message.lead_id and organization_id = v_message.organization_id))
    order by user_id for share;
  perform 1 from public.whatsapp_conversation_lead_bindings where conversation_id = v_message.conversation_id
    and organization_id = v_message.organization_id and active_to is null for share;
  select * into v_recipient from private.whatsapp_inbound_push_recipient(v_message.organization_id, v_message.id);
  if found then
    perform 1 from public.whatsapp_attendance_entries where id = v_recipient.attendance_entry_id for share;
    if v_recipient.grant_id is not null then
      perform 1 from public.whatsapp_session_access where id = v_recipient.grant_id for share;
    end if;
    -- Recheck after locking the grant: an UPDATE may have committed while we waited.
    select * into v_recipient from private.whatsapp_inbound_push_recipient(v_message.organization_id, v_message.id);
    if found and v_recipient.user_id = v_notification.user_id
       and v_recipient.attendance_entry_id::text = v_notification.metadata->>'attendance_entry_id'
       and v_recipient.binding_id::text = v_notification.metadata->>'binding_id'
       and coalesce(v_recipient.grant_id::text, '') = coalesce(v_notification.metadata->>'grant_id', '') then
      return 'authorized';
    end if;
  end if;

  -- A provider-started attempt is ambiguous even after worker crash. Never
  -- redirect it, or a different device could have already shown the old alert.
  if exists (select 1 from public.notifications notification
    where notification.organization_id = v_message.organization_id
      and notification.metadata->>'event_key' = 'whatsapp_inbound_attendant'
      and notification.metadata->>'whatsapp_message_id' = v_message.id::text
      and notification.metadata->>'whatsapp_inbound_provider_started' = 'true')
    or exists (select 1 from private.notification_deliveries delivery
    join public.notifications notification on notification.id = delivery.notification_id
    where notification.organization_id = v_message.organization_id
      and notification.metadata->>'event_key' = 'whatsapp_inbound_attendant'
      and notification.metadata->>'whatsapp_message_id' = v_message.id::text
      and delivery.channel = 'push'
      and (delivery.attempt_count > 0 or delivery.status in ('sending', 'accepted', 'delivered'))) then
    return 'revoked';
  end if;
  if not exists (select 1 from private.notification_deliveries delivery
    join public.notifications notification on notification.id=delivery.notification_id
    where notification.organization_id=v_message.organization_id
      and notification.metadata->>'event_key'='whatsapp_inbound_attendant'
      and notification.metadata->>'whatsapp_message_id'=v_message.id::text and delivery.channel='push'
      and delivery.status in ('queued','leased','retry_wait','blocked_dependency')
      and delivery.attempt_count=0 and delivery.expires_at>now()) then
    return 'revoked';
  end if;
  update private.notification_deliveries set status = 'cancelled', terminal_at = now(),
    next_attempt_at = null, lease_token = null, leased_by = null, lease_expires_at = null,
    dependency_key = null, blocked_at = null, last_error_code = 'whatsapp_attendant_changed',
    last_error_message = 'Current attendance no longer authorizes the original recipient.', updated_at = now()
  where notification_id = v_notification.id and channel = 'push'
    and status in ('queued', 'leased', 'retry_wait', 'blocked_dependency');
  if v_recipient.user_id is not null and v_recipient.user_id <> v_notification.user_id then
    perform private.create_whatsapp_inbound_attendant_notification(v_message.organization_id, v_message.id,
      v_recipient.user_id, v_recipient.attendance_entry_id, v_recipient.binding_id, v_recipient.grant_id,
      coalesce(nullif(v_notification.metadata->>'origin_notification_id', '')::uuid, v_notification.id));
    return 'redirected';
  end if;
  return 'cancelled';
end;
$$;
revoke all on function private.prepare_whatsapp_inbound_attendant_push(uuid)
from public, anon, authenticated;
grant execute on function private.prepare_whatsapp_inbound_attendant_push(uuid) to service_role;

-- The producer trigger sorts before whatsapp_message_private_broadcast. These
-- extra fields are content-free; cache invalidation remains on the same topics.
create or replace function private.broadcast_whatsapp_message_change()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare message_row public.whatsapp_messages; v_attendant uuid;
begin
  message_row := case when tg_op = 'DELETE' then old else new end;
  if tg_op = 'INSERT' then
    select user_id into v_attendant from public.notifications
    where organization_id = message_row.organization_id
      and metadata->>'event_key' = 'whatsapp_inbound_attendant'
      and metadata->>'whatsapp_message_id' = message_row.id::text limit 1;
  end if;
  begin
    perform realtime.send(jsonb_build_object('scope', 'conversations'),
      'whatsapp.inbox.changed', 'whatsapp:' || message_row.organization_id::text || ':inbox', true);
  exception when others then null; end;
  if message_row.lead_id is not null then
    begin
      perform realtime.send(jsonb_build_object(
        'operation', tg_op, 'messageId', message_row.id,
        'conversationId', message_row.conversation_id,
        'clientMessageId', message_row.client_message_id, 'status', message_row.status,
        'sentAt', message_row.sent_at, 'createdAt', message_row.created_at,
        'organizationId', message_row.organization_id, 'fromMe', message_row.from_me,
        'direction', message_row.direction, 'captureState', message_row.capture_state,
        'attendantUserId', v_attendant),
        'whatsapp.message.changed',
        'whatsapp:' || message_row.organization_id::text || ':lead:' || message_row.lead_id::text, true);
    exception when others then null; end;
  end if;
  if tg_op = 'UPDATE' and old.lead_id is not null and old.lead_id is distinct from new.lead_id then
    begin
      perform realtime.send(jsonb_build_object(
        'operation', tg_op, 'messageId', old.id, 'conversationId', old.conversation_id,
        'clientMessageId', old.client_message_id, 'status', old.status, 'sentAt', old.sent_at),
        'whatsapp.message.changed', 'whatsapp:' || old.organization_id::text || ':lead:' || old.lead_id::text, true);
    exception when others then null; end;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
commit;
