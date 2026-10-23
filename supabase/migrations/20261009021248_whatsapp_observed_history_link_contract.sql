-- Local Part 2: visible observations without attendance and explicit history
-- attachment. The earlier candidate migration remains immutable. Neither this
-- migration nor its functions enables capture for a session or starts a worker.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '5min';

create table private.whatsapp_unlinked_history_links (
  organization_id uuid not null,
  conversation_id uuid primary key
    references public.whatsapp_conversations(id) on delete restrict,
  session_id uuid not null,
  lead_id uuid not null,
  actor_user_id uuid not null,
  action text not null check (action in ('manual_link', 'manual_lead_create')),
  binding_mode text not null check (binding_mode in ('active', 'history_only')),
  confirmed_at timestamptz not null,
  expires_at timestamptz not null,
  attached_message_count integer not null default 0
    check (attached_message_count >= 0),
  history_first_at timestamptz,
  history_last_at timestamptz,
  constraint whatsapp_unlinked_history_links_period_check check (
    history_first_at is null or history_last_at >= history_first_at
  )
);
create index whatsapp_unlinked_history_links_lead_idx
  on private.whatsapp_unlinked_history_links (organization_id, lead_id, confirmed_at);
alter table private.whatsapp_unlinked_history_links enable row level security;
alter table private.whatsapp_unlinked_history_links force row level security;
revoke all on private.whatsapp_unlinked_history_links
  from public, anon, authenticated, service_role;
comment on table private.whatsapp_unlinked_history_links is
'Backend-only proof of a human-confirmed unlinked-history attachment. It preserves the original physical epoch and never contains message text or media.';

-- Remove the candidate's implicit authorization from the generic binding RPC.
-- It must remain available to automated intake for a NEW lead epoch, but it
-- must not be able to expose an older unlinked epoch by matching a phone.
do $remove_implicit_promotion$
declare
  v_rpc regprocedure := pg_catalog.to_regprocedure(
    'public.activate_whatsapp_conversation_lead_binding(uuid,uuid,uuid,text)'
  );
  v_definition text;
  v_injected text := $injected$
  if v_conversation.unlinked_retention_v1
     and v_previous_lead_id is null then
    insert into private.whatsapp_unlinked_promotion_authorizations (
      backend_pid, transaction_id, organization_id, conversation_id, lead_id
    ) values (
      pg_catalog.pg_backend_pid(), pg_catalog.txid_current(),
      p_organization_id, p_conversation_id, p_lead_id
    );
  end if;

$injected$;
begin
  if v_rpc is null then
    raise exception using errcode = '55000',
      message = 'whatsapp_history_generic_binding_rpc_missing';
  end if;
  select pg_catalog.replace(pg_catalog.replace(
    pg_catalog.pg_get_functiondef(v_rpc), E'\r\n', E'\n'
  ), E'\r', E'\n') into v_definition;
  if pg_catalog.strpos(v_definition, v_injected) = 0
     or pg_catalog.strpos(
       pg_catalog.substr(
         v_definition,
         pg_catalog.strpos(v_definition, v_injected) + pg_catalog.length(v_injected)
       ), v_injected
     ) > 0 then
    raise exception using errcode = '55000',
      message = 'whatsapp_history_generic_binding_rpc_drift';
  end if;
  execute pg_catalog.replace(v_definition, v_injected, '');
end;
$remove_implicit_promotion$;

-- An external outbound observation is not proof of a prior CRM send. Only a
-- lead attribution, attendance, old outbound, outbox, or binding ledger is
-- protected. Prospective unlinked outbound rows may therefore expire.
create or replace function private.whatsapp_conversation_has_protected_history(
  p_conversation_id uuid
)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.whatsapp_conversation_lead_bindings as binding
    where binding.conversation_id = p_conversation_id
  ) or exists (
    select 1 from private.whatsapp_unlinked_history_links as link
    where link.conversation_id = p_conversation_id
  ) or exists (
    select 1 from public.whatsapp_attendance_entries as attendance
    where attendance.conversation_id = p_conversation_id
  ) or exists (
    select 1 from public.whatsapp_messages as message
    where message.conversation_id = p_conversation_id
      and (
        message.lead_id is not null
        or (
          (message.from_me or message.direction <> 'inbound')
          and message.capture_state is distinct from 'unlinked_ephemeral'
        )
      )
  ) or exists (
    select 1 from public.whatsapp_inbound_logs as inbound_log
    where inbound_log.conversation_id = p_conversation_id
      and inbound_log.lead_id is not null
  ) or exists (
    select 1 from public.whatsapp_conversation_routing_heads as routing_head
    where routing_head.conversation_id = p_conversation_id
  ) or exists (
    select 1 from public.whatsapp_outbox as outbox
    where outbox.conversation_id = p_conversation_id
  ) or exists (
    select 1 from public.outbox_messages as outbox
    where outbox.conversation_id = p_conversation_id
  ) or exists (
    select 1
    from public.lead_attachments as attachment
    join public.whatsapp_messages as message on message.id = attachment.message_id
    where message.conversation_id = p_conversation_id
  );
$$;
revoke all on function private.whatsapp_conversation_has_protected_history(uuid)
  from public, anon, authenticated, service_role;

alter table public.whatsapp_messages
  drop constraint whatsapp_messages_capture_state_check;
alter table public.whatsapp_messages
  add constraint whatsapp_messages_capture_state_check check (
    capture_state is null
    or capture_state in ('legacy', 'captured', 'suppressed')
    or (
      capture_state = 'unlinked_ephemeral' and lead_id is null
      and ((not from_me and direction = 'inbound')
        or (from_me and direction = 'outbound'))
    )
    or (
      capture_state in ('promoted_unlinked', 'observed_unattended')
      and lead_id is not null
      and ((not from_me and direction = 'inbound')
        or (from_me and direction = 'outbound'))
    )
  ) not valid;
comment on column public.whatsapp_messages.capture_state is
'captured keeps the current attendance business effects; suppressed has no visible content; unlinked_ephemeral is a seven-day owner-only inbound or proven external outbound observation; promoted_unlinked is human-attached history; observed_unattended is a lead observation without attendance or business effects.';

-- This decision is recomputed under the message/conversation trigger after the
-- processor's earlier lookup. The immutable provider snapshot pins the old
-- physical epoch; a current phone or conversation lead never substitutes for it.
create or replace function private.whatsapp_unlinked_capture_resolution(
  p_organization_id uuid,
  p_session_id uuid,
  p_conversation_id uuid,
  p_provider_message_id text,
  p_inbox_event_key text
)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_conversation public.whatsapp_conversations%rowtype;
  v_snapshot public.whatsapp_webhook_routing_snapshots%rowtype;
  v_inbox public.whatsapp_webhook_inbox%rowtype;
  v_link private.whatsapp_unlinked_history_links%rowtype;
  v_expiry timestamptz;
begin
  if p_organization_id is null or p_session_id is null
     or p_conversation_id is null
     or nullif(pg_catalog.btrim(p_provider_message_id), '') is null
     or nullif(pg_catalog.btrim(p_inbox_event_key), '') is null then
    return pg_catalog.jsonb_build_object(
      'capture_state', 'suppressed', 'lead_id', null, 'reason', 'missing_proof'
    );
  end if;

  -- A transport tombstone has already discarded its content. Neither replay
  -- nor a later human link may turn it into a visible message.
  if exists (
    select 1 from public.whatsapp_messages as message
    where message.organization_id = p_organization_id
      and message.session_id = p_session_id
      and message.provider_message_id = p_provider_message_id
      and message.capture_state = 'suppressed'
  ) then
    return pg_catalog.jsonb_build_object(
      'capture_state', 'suppressed', 'lead_id', null, 'reason', 'already_suppressed'
    );
  end if;
  if exists (
    select 1 from public.whatsapp_outbox as outbox
    where outbox.organization_id = p_organization_id
      and outbox.session_id = p_session_id
      and outbox.provider_message_id = p_provider_message_id
  ) or exists (
    select 1 from public.outbox_messages as outbox
    where outbox.organization_id = p_organization_id
      and outbox.session_id = p_session_id
      and outbox.sent_message_id = p_provider_message_id
  ) then
    return pg_catalog.jsonb_build_object(
      'capture_state', 'suppressed', 'lead_id', null, 'reason', 'managed_outbound'
    );
  end if;

  select conversation.* into v_conversation
  from public.whatsapp_conversations as conversation
  where conversation.id = p_conversation_id
    and conversation.organization_id = p_organization_id
    and conversation.session_id = p_session_id;
  select snapshot.* into v_snapshot
  from public.whatsapp_webhook_routing_snapshots as snapshot
  where snapshot.organization_id = p_organization_id
    and snapshot.session_id = p_session_id
    and snapshot.provider_message_id = p_provider_message_id
    and snapshot.inbox_event_key = p_inbox_event_key;
  select inbox.* into v_inbox
  from public.whatsapp_webhook_inbox as inbox
  where inbox.organization_id = p_organization_id
    and inbox.session_id = p_session_id
    and inbox.event_key = p_inbox_event_key;

  if v_conversation.id is null or v_snapshot.provider_message_id is null
     or v_inbox.id is null or v_conversation.deleted_at is not null
     or coalesce(v_conversation.is_group, false)
     or v_conversation.unlinked_retention_scrubbed_at is not null
     or v_snapshot.snapshot->>'unlinked_capture_policy' is distinct from 'v1'
     or v_snapshot.snapshot->>'state' is distinct from 'unlinked'
     or v_snapshot.snapshot->>'context_kind' is distinct from 'organic'
     or nullif(v_snapshot.snapshot->>'quarantine_reason', '') is not null
     or nullif(v_snapshot.snapshot->>'event_lead_id', '') is not null
     or nullif(v_snapshot.snapshot->>'current_lead_id', '') is not null
     or not (
       v_snapshot.snapshot->>'conversation_id' = p_conversation_id::text
       or (
         v_snapshot.snapshot->>'conversation_id' is null
         and v_conversation.created_at >= v_inbox.created_at
         and v_conversation.created_at < v_inbox.created_at + interval '7 days'
         and v_snapshot.routing_key in (
           'phone:' || coalesce(public.normalize_phone(v_conversation.contact_phone), ''),
           'jid:' || pg_catalog.lower(v_conversation.remote_jid)
         )
         and not exists (
           select 1 from public.whatsapp_conversations as other_epoch
           where other_epoch.organization_id = p_organization_id
             and other_epoch.session_id = p_session_id
             and other_epoch.remote_jid = v_conversation.remote_jid
             and other_epoch.id <> p_conversation_id
             and other_epoch.created_at >= v_inbox.created_at
             and other_epoch.created_at < v_conversation.created_at
         )
       )
     )
     or v_snapshot.created_at > v_inbox.created_at + interval '5 minutes' then
    return pg_catalog.jsonb_build_object(
      'capture_state', 'suppressed', 'lead_id', null, 'reason', 'epoch_unproven'
    );
  end if;

  v_expiry := v_conversation.created_at + interval '7 days';
  if v_inbox.created_at >= v_expiry or v_snapshot.created_at >= v_expiry
     or (v_conversation.retired_at is not null
         and (v_inbox.created_at > v_conversation.retired_at
              or v_snapshot.created_at > v_conversation.retired_at)) then
    return pg_catalog.jsonb_build_object(
      'capture_state', 'suppressed', 'lead_id', null, 'reason', 'outside_epoch'
    );
  end if;

  select link.* into v_link
  from private.whatsapp_unlinked_history_links as link
  where link.conversation_id = p_conversation_id
    and link.organization_id = p_organization_id
    and link.session_id = p_session_id;
  if v_link.conversation_id is not null then
    if v_link.confirmed_at >= v_expiry
       or v_inbox.created_at > v_link.confirmed_at
       or v_snapshot.created_at > v_link.confirmed_at
       or not exists (
         select 1 from public.leads as lead
         where lead.id = v_link.lead_id
           and lead.organization_id = p_organization_id
       ) then
      return pg_catalog.jsonb_build_object(
        'capture_state', 'suppressed', 'lead_id', null, 'reason', 'link_fence'
      );
    end if;
    return pg_catalog.jsonb_build_object(
      'capture_state', 'promoted_unlinked', 'lead_id', v_link.lead_id,
      'reason', 'human_history_link'
    );
  end if;

  if v_conversation.lead_id is not null
     or pg_catalog.clock_timestamp() >= v_expiry
     or (
       not v_conversation.unlinked_retention_v1
       and not (
         v_snapshot.snapshot->>'conversation_id' is null
         and v_conversation.created_at >= v_inbox.created_at
         and not private.whatsapp_conversation_has_protected_history(
           v_conversation.id
         )
       )
     ) then
    return pg_catalog.jsonb_build_object(
      'capture_state', 'suppressed', 'lead_id', null, 'reason', 'unlinked_closed'
    );
  end if;
  return pg_catalog.jsonb_build_object(
    'capture_state', 'unlinked_ephemeral', 'lead_id', null,
    'reason', 'original_unlinked_epoch'
  );
end;
$$;
revoke all on function private.whatsapp_unlinked_capture_resolution(
  uuid, uuid, uuid, text, text
) from public, anon, authenticated, service_role;

create or replace function public.resolve_whatsapp_unlinked_history_capture(
  p_organization_id uuid,
  p_session_id uuid,
  p_conversation_id uuid,
  p_provider_message_id text,
  p_inbox_event_key text
)
returns jsonb
language sql volatile security definer set search_path = ''
as $$
  select private.whatsapp_unlinked_capture_resolution(
    p_organization_id, p_session_id, p_conversation_id,
    p_provider_message_id, p_inbox_event_key
  );
$$;
revoke all on function public.resolve_whatsapp_unlinked_history_capture(
  uuid, uuid, uuid, text, text
) from public, anon, authenticated;
grant execute on function public.resolve_whatsapp_unlinked_history_capture(
  uuid, uuid, uuid, text, text
) to service_role;

create or replace function private.mark_whatsapp_unlinked_retention_v1()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_conversation public.whatsapp_conversations%rowtype;
  v_snapshot public.whatsapp_webhook_routing_snapshots%rowtype;
  v_resolution jsonb;
begin
  if new.capture_state not in ('unlinked_ephemeral', 'promoted_unlinked') then
    return new;
  end if;

  select conversation.* into v_conversation
  from public.whatsapp_conversations as conversation
  where conversation.id = new.conversation_id
    and conversation.organization_id = new.organization_id
    and conversation.session_id = new.session_id
  for no key update;
  if not found or coalesce(v_conversation.is_group, false)
     or v_conversation.deleted_at is not null
     or v_conversation.unlinked_retention_scrubbed_at is not null then
    raise exception using errcode = '23514',
      message = 'unlinked_message_requires_proven_epoch';
  end if;

  if new.capture_state = 'promoted_unlinked' then
    select snapshot.* into v_snapshot
    from public.whatsapp_webhook_routing_snapshots as snapshot
    where snapshot.organization_id = new.organization_id
      and snapshot.session_id = new.session_id
      and snapshot.provider_message_id = new.provider_message_id;
    v_resolution := private.whatsapp_unlinked_capture_resolution(
      new.organization_id, new.session_id, new.conversation_id,
      new.provider_message_id, v_snapshot.inbox_event_key
    );
    if v_resolution->>'capture_state' <> 'promoted_unlinked'
       or (v_resolution->>'lead_id')::uuid is distinct from new.lead_id
       or new.sent_at > pg_catalog.clock_timestamp() + interval '5 minutes'
       or new.sent_at > (
         select link.confirmed_at
         from private.whatsapp_unlinked_history_links as link
         where link.conversation_id = new.conversation_id
       ) then
      raise exception using errcode = '23514',
        message = 'promoted_unlinked_requires_human_history_proof';
    end if;
    return new;
  end if;

  if v_conversation.lead_id is not null
     or v_conversation.created_at <= pg_catalog.clock_timestamp() - interval '7 days'
     or private.whatsapp_conversation_has_protected_history(v_conversation.id) then
    raise exception using errcode = '23514',
      message = 'unlinked_message_requires_active_unbound_conversation';
  end if;
  if v_conversation.retired_at is not null then
    select snapshot.* into v_snapshot
    from public.whatsapp_webhook_routing_snapshots as snapshot
    where snapshot.organization_id = new.organization_id
      and snapshot.session_id = new.session_id
      and snapshot.provider_message_id = new.provider_message_id;
    v_resolution := private.whatsapp_unlinked_capture_resolution(
      new.organization_id, new.session_id, new.conversation_id,
      new.provider_message_id, v_snapshot.inbox_event_key
    );
    if v_resolution->>'capture_state' <> 'unlinked_ephemeral'
       or new.sent_at > v_conversation.retired_at then
      raise exception using errcode = '23514',
        message = 'unlinked_retired_epoch_requires_prior_snapshot';
    end if;
  end if;
  if new.from_me and (
    exists (
      select 1 from public.whatsapp_outbox as outbox
      where outbox.organization_id = new.organization_id
        and outbox.session_id = new.session_id
        and outbox.provider_message_id = new.provider_message_id
    ) or exists (
      select 1 from public.outbox_messages as outbox
      where outbox.organization_id = new.organization_id
        and outbox.session_id = new.session_id
        and outbox.conversation_id = new.conversation_id
        and (
          outbox.sent_message_id = new.provider_message_id
          or outbox.client_message_id = new.client_message_id
        )
    )
  ) then
    raise exception using errcode = '23514',
      message = 'managed_outbound_cannot_be_unlinked_observation';
  end if;
  if not v_conversation.unlinked_retention_v1 then
    update public.whatsapp_conversations
    set unlinked_retention_v1 = true
    where id = v_conversation.id;
  end if;
  return new;
end;
$$;

-- The generic binding RPC may switch an ordinary lead conversation, but it
-- cannot consume a marked no-lead epoch. Only the explicit human RPC plants
-- the transaction-scoped proof consumed here. A retired epoch is attached by
-- the human RPC as history_only, without mutating its active route.
create or replace function private.promote_whatsapp_unlinked_retention_v1()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if old.unlinked_retention_v1 and old.lead_id is null
     and new.lead_id is not null then
    if old.retired_at is not null
       or old.created_at <= pg_catalog.clock_timestamp() - interval '7 days'
       or old.unlinked_retention_scrubbed_at is not null then
      raise exception using errcode = '23514',
        message = 'expired_unlinked_conversation_cannot_be_promoted';
    end if;
    update private.whatsapp_unlinked_promotion_authorizations as authz
    set promotion_active = true
    where authz.backend_pid = pg_catalog.pg_backend_pid()
      and authz.transaction_id = pg_catalog.txid_current()
      and authz.organization_id = old.organization_id
      and authz.conversation_id = old.id
      and authz.lead_id = new.lead_id
      and not authz.promotion_active
      and exists (
        select 1 from private.whatsapp_unlinked_history_links as link
        where link.organization_id = old.organization_id
          and link.conversation_id = old.id
          and link.session_id = old.session_id
          and link.lead_id = new.lead_id
          and link.binding_mode = 'active'
      );
    if not found then
      raise exception using errcode = '23514',
        message = 'unlinked_promotion_requires_human_confirmation';
    end if;

    update public.whatsapp_messages as message
    set lead_id = new.lead_id,
        capture_state = 'promoted_unlinked'
    where message.organization_id = old.organization_id
      and message.conversation_id = old.id
      and message.session_id = old.session_id
      and message.lead_id is null
      and message.capture_state = 'unlinked_ephemeral'
      and message.unlinked_retention_scrubbed_at is null;

    delete from private.whatsapp_unlinked_promotion_authorizations as authz
    where authz.backend_pid = pg_catalog.pg_backend_pid()
      and authz.transaction_id = pg_catalog.txid_current()
      and authz.organization_id = old.organization_id
      and authz.conversation_id = old.id
      and authz.lead_id = new.lead_id
      and authz.promotion_active;
    new.unlinked_retention_v1 := false;
  end if;
  return new;
end;
$$;
revoke all on function private.promote_whatsapp_unlinked_retention_v1()
  from public, anon, authenticated, service_role;

create or replace function private.whatsapp_actor_has_lead_permission(
  p_organization_id uuid, p_actor_user_id uuid, p_permission_key text
)
returns boolean language plpgsql stable security definer set search_path = ''
as $$
declare
  v_role text;
  v_override boolean;
  v_default boolean := false;
  v_granted boolean := false;
begin
  if p_permission_key not in ('lead_view_all', 'lead_view_own', 'lead_view_team')
     or p_organization_id is null or p_actor_user_id is null then
    return false;
  end if;
  select member.role into v_role
  from public.organization_members as member
  join public.users as actor
    on actor.id = member.user_id
   and actor.organization_id = member.organization_id
   and coalesce(actor.is_active, false)
  where member.organization_id = p_organization_id
    and member.user_id = p_actor_user_id
    and member.is_active and member.deleted_at is null;
  if v_role is null then return false; end if;
  if v_role in ('owner', 'admin') then return true; end if;

  select override.allowed into v_override
  from public.user_permission_overrides as override
  where override.organization_id = p_organization_id
    and override.user_id = p_actor_user_id
    and pg_catalog.lower(pg_catalog.btrim(override.permission_key)) =
        p_permission_key
  limit 1;
  if found then return v_override; end if;

  v_default := p_permission_key = 'lead_view_own'
    or (p_permission_key = 'lead_view_all' and v_role = 'manager')
    or (p_permission_key = 'lead_view_team' and exists (
      select 1 from public.team_members as leader
      join public.teams as team
        on team.id = leader.team_id
       and team.organization_id = leader.organization_id
       and coalesce(team.is_active, true)
      where leader.organization_id = p_organization_id
        and leader.user_id = p_actor_user_id
        and leader.is_active and leader.is_leader
    ));
  select exists (
    select 1
    from public.user_organization_roles as user_role
    join public.organization_role_permissions as role_permission
      on role_permission.role_id = user_role.role_id
     and role_permission.organization_id = user_role.organization_id
    join public.available_permissions as permission
      on permission.id = role_permission.permission_id
    where user_role.organization_id = p_organization_id
      and user_role.user_id = p_actor_user_id
      and user_role.is_active
      and (
        permission.key = p_permission_key
        or (p_permission_key = 'lead_view_all'
            and permission.key in ('lead_edit_all', 'lead_manage'))
        or (p_permission_key = 'lead_view_own'
            and permission.key = 'lead_edit_own')
      )
  ) into v_granted;
  return v_default or v_granted;
end;
$$;
revoke all on function private.whatsapp_actor_has_lead_permission(uuid, uuid, text)
  from public, anon, authenticated, service_role;

create or replace function public.confirm_whatsapp_unlinked_history_binding(
  p_organization_id uuid,
  p_conversation_id uuid,
  p_lead_id uuid,
  p_expected_previous_lead_id uuid,
  p_actor_user_id uuid,
  p_action text
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_conversation public.whatsapp_conversations%rowtype;
  v_session public.whatsapp_sessions%rowtype;
  v_lead public.leads%rowtype;
  v_link private.whatsapp_unlinked_history_links%rowtype;
  v_mode text;
  v_now timestamptz;
  v_count integer := 0;
  v_first timestamptz;
  v_last timestamptz;
begin
  if p_organization_id is null or p_conversation_id is null
     or p_lead_id is null or p_actor_user_id is null
     or p_action not in ('manual_link', 'manual_lead_create') then
    raise exception using errcode = '22023',
      message = 'whatsapp_history_link_arguments_invalid';
  end if;
  if p_expected_previous_lead_id is not null then
    raise exception using errcode = '40001',
      message = 'whatsapp_history_link_previous_lead_changed';
  end if;

  select conversation.* into v_conversation
  from public.whatsapp_conversations as conversation
  where conversation.id = p_conversation_id
    and conversation.organization_id = p_organization_id
  for update;
  if not found then
    raise exception using errcode = '23503',
      message = 'whatsapp_history_link_conversation_not_found';
  end if;
  -- Expiry is decided after this row lock, never from a timestamp captured
  -- while waiting behind retention or another binding writer.
  v_now := pg_catalog.clock_timestamp();
  select session.* into v_session
  from public.whatsapp_sessions as session
  where session.id = v_conversation.session_id
    and session.organization_id = p_organization_id;
  select lead.* into v_lead
  from public.leads as lead
  where lead.id = p_lead_id
    and lead.organization_id = p_organization_id;
  if v_session.id is null or v_lead.id is null then
    raise exception using errcode = '23503',
      message = 'whatsapp_history_link_target_not_found';
  end if;
  select link.* into v_link
  from private.whatsapp_unlinked_history_links as link
  where link.conversation_id = p_conversation_id
  for update;
  if found then
    if v_link.organization_id <> p_organization_id
       or v_link.lead_id <> p_lead_id
       or v_link.actor_user_id <> p_actor_user_id then
      raise exception using errcode = '40001',
        message = 'whatsapp_history_link_already_attached';
    end if;
    return pg_catalog.jsonb_build_object(
      'success', true, 'conversation_id', v_link.conversation_id,
      'lead_id', v_link.lead_id, 'binding_mode', v_link.binding_mode,
      'attached_message_count', v_link.attached_message_count,
      'history_first_at', v_link.history_first_at,
      'history_last_at', v_link.history_last_at,
      'confirmed_at', v_link.confirmed_at, 'expires_at', v_link.expires_at
    );
  end if;
  if v_conversation.lead_id is not null then
    raise exception using errcode = '40001',
      message = 'whatsapp_history_link_previous_lead_changed';
  end if;
  if coalesce(v_conversation.is_group, false)
     or v_conversation.deleted_at is not null
     or not v_conversation.unlinked_retention_v1
     or v_conversation.unlinked_retention_scrubbed_at is not null
     or v_conversation.created_at + interval '7 days' <= v_now
     then
    raise exception using errcode = '23514',
      message = 'whatsapp_history_link_epoch_ineligible';
  end if;
  if v_session.owner_user_id is distinct from p_actor_user_id
     or not coalesce(v_session.is_active, false)
     or v_session.status = 'deleted'
     or not exists (
       select 1 from public.users as app_user
       where app_user.id = p_actor_user_id
         and app_user.organization_id = p_organization_id
         and coalesce(app_user.is_active, false)
     )
     or not exists (
       select 1 from public.organization_members as member
       where member.organization_id = p_organization_id
         and member.user_id = p_actor_user_id
         and member.is_active
         and member.deleted_at is null
     ) then
    raise exception using errcode = '42501',
      message = 'whatsapp_history_link_actor_denied';
  end if;
  if not (
    exists (
      select 1 from public.organization_members as member
      where member.organization_id = p_organization_id
        and member.user_id = p_actor_user_id
        and member.is_active and member.deleted_at is null
        and member.role in ('owner', 'admin')
    )
    or private.whatsapp_actor_has_lead_permission(
      p_organization_id, p_actor_user_id, 'lead_view_all'
    )
    or (v_lead.assigned_user_id = p_actor_user_id
        and private.whatsapp_actor_has_lead_permission(
          p_organization_id, p_actor_user_id, 'lead_view_own'
        ))
    or (private.whatsapp_actor_has_lead_permission(
          p_organization_id, p_actor_user_id, 'lead_view_team'
        )
      and exists (
        select 1
        from public.team_members as leader
        join public.teams as team
          on team.id = leader.team_id
         and team.organization_id = leader.organization_id
        where leader.organization_id = p_organization_id
          and leader.user_id = p_actor_user_id
          and leader.is_active and leader.is_leader
          and coalesce(team.is_active, true)
          and v_lead.assigned_user_id is null
          and team.id = v_lead.team_id
      ))
    or exists (
      select 1
      from public.team_members as leader
      join public.teams as team
        on team.id = leader.team_id
       and team.organization_id = leader.organization_id
      where leader.organization_id = p_organization_id
        and leader.user_id = p_actor_user_id
        and leader.is_active and leader.is_leader
        and coalesce(team.is_active, true)
        and private.whatsapp_actor_has_lead_permission(
          p_organization_id, p_actor_user_id, 'lead_view_team'
        )
        and v_lead.assigned_user_id is not null
        and exists (
          select 1
          from public.team_members as assignee
          join public.users as broker
            on broker.id = assignee.user_id
           and coalesce(broker.is_active, false)
          join public.organization_members as broker_member
            on broker_member.organization_id = assignee.organization_id
           and broker_member.user_id = assignee.user_id
           and broker_member.is_active
           and broker_member.deleted_at is null
          where assignee.organization_id = p_organization_id
            and assignee.team_id = team.id
            and assignee.user_id = v_lead.assigned_user_id
            and assignee.is_active
        )
      )
  ) then
    raise exception using errcode = '42501',
      message = 'whatsapp_history_link_lead_denied';
  end if;
  if not (
    (public.normalize_phone(v_conversation.contact_phone) is not null
     and public.normalize_phone(v_conversation.contact_phone) in (
       public.normalize_phone(v_lead.phone),
       public.normalize_phone(nullif(to_jsonb(v_lead)->>'whatsapp', ''))
     ))
    or exists (
      select 1 from public.whatsapp_contact_identity_aliases as alias
      where alias.organization_id = p_organization_id
        and alias.session_id = v_conversation.session_id
        and alias.lead_id = p_lead_id
        and (alias.alias_jid = v_conversation.remote_jid
             or alias.canonical_jid = v_conversation.remote_jid)
    )
  ) then
    raise exception using errcode = '23514',
      message = 'whatsapp_history_link_identity_mismatch';
  end if;
  if private.whatsapp_conversation_has_protected_history(v_conversation.id) then
    raise exception using errcode = '23514',
      message = 'whatsapp_history_link_has_prior_lead_history';
  end if;

  v_mode := case when v_conversation.retired_at is null
    then 'active' else 'history_only' end;
  insert into private.whatsapp_unlinked_history_links (
    organization_id, conversation_id, session_id, lead_id,
    actor_user_id, action, binding_mode, confirmed_at, expires_at
  ) values (
    p_organization_id, p_conversation_id, v_conversation.session_id,
    p_lead_id, p_actor_user_id, p_action, v_mode, v_now,
    v_conversation.created_at + interval '7 days'
  );

  if v_conversation.unlinked_retention_v1 then
    insert into private.whatsapp_unlinked_promotion_authorizations (
      backend_pid, transaction_id, organization_id, conversation_id,
      lead_id, promotion_active
    ) values (
      pg_catalog.pg_backend_pid(), pg_catalog.txid_current(),
      p_organization_id, p_conversation_id, p_lead_id,
      v_mode = 'history_only'
    );
  end if;

  if v_mode = 'active' then
    perform public.activate_whatsapp_conversation_lead_binding(
      p_organization_id, p_conversation_id, p_lead_id, null
    );
  else
    -- A later intake has its own new active epoch. Preserve this retired
    -- physical route, its aliases, and the new epoch's binding untouched.
    update public.whatsapp_messages as message
    set lead_id = p_lead_id,
        capture_state = 'promoted_unlinked'
    where message.organization_id = p_organization_id
      and message.session_id = v_conversation.session_id
      and message.conversation_id = p_conversation_id
      and message.lead_id is null
      and message.capture_state = 'unlinked_ephemeral'
      and message.unlinked_retention_scrubbed_at is null;
    update public.whatsapp_conversations
    set unlinked_retention_v1 = false,
        updated_at = v_now
    where id = p_conversation_id;
    delete from private.whatsapp_unlinked_promotion_authorizations as authz
    where authz.backend_pid = pg_catalog.pg_backend_pid()
      and authz.transaction_id = pg_catalog.txid_current()
      and authz.conversation_id = p_conversation_id;
  end if;

  select count(*)::integer, min(message.sent_at), max(message.sent_at)
  into v_count, v_first, v_last
  from public.whatsapp_messages as message
  where message.organization_id = p_organization_id
    and message.conversation_id = p_conversation_id
    and message.lead_id = p_lead_id
    and message.capture_state = 'promoted_unlinked';
  update private.whatsapp_unlinked_history_links as link
  set attached_message_count = v_count,
      history_first_at = v_first,
      history_last_at = v_last
  where link.conversation_id = p_conversation_id;

  return pg_catalog.jsonb_build_object(
    'success', true, 'conversation_id', p_conversation_id,
    'lead_id', p_lead_id, 'binding_mode', v_mode,
    'attached_message_count', v_count,
    'history_first_at', v_first, 'history_last_at', v_last,
    'confirmed_at', v_now,
    'expires_at', v_conversation.created_at + interval '7 days'
  );
end;
$$;
revoke all on function public.confirm_whatsapp_unlinked_history_binding(
  uuid, uuid, uuid, uuid, uuid, text
) from public, anon, authenticated;
grant execute on function public.confirm_whatsapp_unlinked_history_binding(
  uuid, uuid, uuid, uuid, uuid, text
) to service_role;

-- The optional strict message-context cutover otherwise rejects a historical
-- INSERT into a retired epoch whose conversation.lead_id deliberately stays
-- NULL. Permit exactly the immutable human-link ledger/snapshot proof.
do $allow_late_promoted_insert$
declare
  v_context regprocedure := pg_catalog.to_regprocedure(
    'public.set_whatsapp_message_context()'
  );
  v_definition text;
  v_anchor text := '  -- A provider event may be replayed after a later lead becomes active.';
  v_replacement text := $replacement$
  if new.capture_state = 'promoted_unlinked'
     and new.session_id is not distinct from v_conversation.session_id
     and new.remote_jid is not distinct from v_conversation.remote_jid
     and new.lead_id is not null
     and (
       private.whatsapp_unlinked_capture_resolution(
         new.organization_id, new.session_id, new.conversation_id,
         new.provider_message_id,
         (
           select snapshot.inbox_event_key
           from public.whatsapp_webhook_routing_snapshots as snapshot
           where snapshot.organization_id = new.organization_id
             and snapshot.session_id = new.session_id
             and snapshot.provider_message_id = new.provider_message_id
         )
       )->>'lead_id'
     )::uuid is not distinct from new.lead_id then
    return new;
  end if;

  -- A provider event may be replayed after a later lead becomes active.$replacement$;
begin
  if v_context is null then
    raise exception using errcode = '55000',
      message = 'whatsapp_history_message_context_missing';
  end if;
  select pg_catalog.replace(pg_catalog.replace(
    pg_catalog.pg_get_functiondef(v_context), E'\r\n', E'\n'
  ), E'\r', E'\n') into v_definition;
  if pg_catalog.strpos(v_definition, 'whatsapp_message_context_immutable') > 0 then
    if pg_catalog.strpos(v_definition, v_anchor) = 0
       or pg_catalog.strpos(
         pg_catalog.substr(
           v_definition,
           pg_catalog.strpos(v_definition, v_anchor) + pg_catalog.length(v_anchor)
         ), v_anchor
       ) > 0 then
      raise exception using errcode = '55000',
        message = 'whatsapp_history_strict_message_context_drift';
    end if;
    execute pg_catalog.replace(v_definition, v_anchor, v_replacement);
  elsif pg_catalog.strpos(v_definition, 'if new.lead_id is null then') = 0 then
    raise exception using errcode = '55000',
      message = 'whatsapp_history_baseline_message_context_drift';
  end if;
end;
$allow_late_promoted_insert$;

commit;
