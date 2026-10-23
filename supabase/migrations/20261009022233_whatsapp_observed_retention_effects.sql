-- Local Part 2: retention, raw payload, and side-effect fences.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '5min';

-- The old physical route may be retired by a later intake while its retained
-- seven-day history remains owner-visible. Retirement still prevents routing
-- and sending; this policy changes SELECT only.
-- Match the API's lead scope: owner/admin or explicit all, assigned own with
-- permission, and active team leadership with team permission. A manager role
-- alone does not confer access to every lead.
create or replace function private.whatsapp_actor_can_read_lead(
  p_organization_id uuid, p_lead_id uuid, p_actor_user_id uuid
)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.leads as lead
    join public.organization_members as membership
      on membership.organization_id = lead.organization_id
     and membership.user_id = p_actor_user_id
     and membership.is_active
     and membership.deleted_at is null
    join public.users as actor
      on actor.id = p_actor_user_id
     and actor.organization_id = lead.organization_id
     and coalesce(actor.is_active, false)
    where lead.id = p_lead_id
      and lead.organization_id = p_organization_id
      and (
        membership.role in ('owner', 'admin')
        or private.whatsapp_actor_has_lead_permission(
          p_organization_id, p_actor_user_id, 'lead_view_all'
        )
        or (lead.assigned_user_id = p_actor_user_id
            and private.whatsapp_actor_has_lead_permission(
              p_organization_id, p_actor_user_id, 'lead_view_own'
            ))
        or (
          private.whatsapp_actor_has_lead_permission(
            p_organization_id, p_actor_user_id, 'lead_view_team'
          )
          and exists (
            select 1 from public.team_members as leader
            join public.teams as team
              on team.id = leader.team_id
             and team.organization_id = leader.organization_id
             and coalesce(team.is_active, true)
            where leader.organization_id = p_organization_id
              and leader.user_id = p_actor_user_id
              and leader.is_active and leader.is_leader
              and (
                (lead.assigned_user_id is null
                 and team.id = lead.team_id)
                or (lead.assigned_user_id is not null
                  and exists (
                    select 1 from public.team_members as broker_member
                    join public.users as broker
                      on broker.id = broker_member.user_id
                     and coalesce(broker.is_active, false)
                    join public.organization_members as broker_org_member
                      on broker_org_member.organization_id = broker_member.organization_id
                     and broker_org_member.user_id = broker_member.user_id
                     and broker_org_member.is_active
                     and broker_org_member.deleted_at is null
                    where broker_member.organization_id = p_organization_id
                      and broker_member.team_id = team.id
                      and broker_member.user_id = lead.assigned_user_id
                      and broker_member.is_active
                  ))
              )
          )
        )
      )
  );
$$;
revoke all on function private.whatsapp_actor_can_read_lead(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.whatsapp_actor_can_read_lead(uuid, uuid, uuid)
  to authenticated;

-- whatsapp_sessions has no client SELECT policy. Keep the ownership check in a
-- narrow definer helper so conversation RLS does not silently hide every row.
create or replace function private.whatsapp_owner_can_view_session(
  p_organization_id uuid, p_session_id uuid
)
returns boolean language sql stable security definer set search_path = ''
as $$
  select (select auth.uid()) is not null
    and exists (
      select 1 from public.whatsapp_sessions as session
      where session.id = p_session_id
        and session.organization_id = p_organization_id
        and session.owner_user_id = (select auth.uid())
        and session.provider = 'evolution_go'
        and coalesce(session.is_active, true)
        and coalesce(session.status, '') <> 'deleted'
        and private.is_org_member(session.organization_id)
    );
$$;
revoke all on function private.whatsapp_owner_can_view_session(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.whatsapp_owner_can_view_session(uuid, uuid)
  to authenticated;

create or replace function private.whatsapp_message_epoch_matches(
  p_organization_id uuid, p_conversation_id uuid, p_session_id uuid
)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.whatsapp_conversations as conversation
    join public.whatsapp_sessions as session
      on session.id = conversation.session_id
     and session.organization_id = conversation.organization_id
    where conversation.organization_id = p_organization_id
      and conversation.id = p_conversation_id
      and conversation.session_id = p_session_id
      and session.provider = 'evolution_go'
  );
$$;
revoke all on function private.whatsapp_message_epoch_matches(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.whatsapp_message_epoch_matches(uuid, uuid, uuid)
  to authenticated;

drop policy if exists whatsapp_conversations_select_owner_only
on public.whatsapp_conversations;
create policy whatsapp_conversations_select_owner_only
on public.whatsapp_conversations for select to authenticated
using (
  deleted_at is null
  and session_id is not null
  and (
    (lead_id is not null
     and private.whatsapp_actor_can_read_lead(
       organization_id, lead_id, (select auth.uid())
     ))
    or (lead_id is null
        and (retired_at is null
          or (unlinked_retention_v1
              and unlinked_retention_scrubbed_at is null))
        and (coalesce(is_group, false)
             or created_at > pg_catalog.now() - interval '7 days')
        and private.whatsapp_owner_can_view_session(
          organization_id, session_id
        ))
  )
);

drop policy if exists whatsapp_messages_select_owner_only
on public.whatsapp_messages;
create policy whatsapp_messages_select_owner_only
on public.whatsapp_messages for select to authenticated
using (
  capture_state is distinct from 'suppressed'
  and private.whatsapp_message_epoch_matches(
    organization_id, conversation_id, session_id
  )
  and (
    (lead_id is not null and private.whatsapp_actor_can_read_lead(
      organization_id, lead_id, (select auth.uid())
    ))
    or (
      lead_id is null and exists (
        select 1
        from public.whatsapp_conversations as conversation
        where conversation.id = whatsapp_messages.conversation_id
          and conversation.organization_id = whatsapp_messages.organization_id
          and conversation.session_id = whatsapp_messages.session_id
          and conversation.lead_id is null
          and conversation.deleted_at is null
          and conversation.created_at > pg_catalog.now() - interval '7 days'
          and (
            conversation.retired_at is null
            or (conversation.unlinked_retention_v1
                and conversation.unlinked_retention_scrubbed_at is null)
          )
          and private.whatsapp_owner_can_view_session(
            conversation.organization_id, conversation.session_id
          )
      )
    )
  )
);

-- Retired by intake does not mean expired. A pinned pre-retirement event can
-- still arrive before the seven-day cutoff. A human-attached historical event
-- remains eligible even when processing finishes after that cutoff.
create or replace function private.guard_expired_whatsapp_unlinked_message_write()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_conversation public.whatsapp_conversations%rowtype;
  v_snapshot public.whatsapp_webhook_routing_snapshots%rowtype;
  v_resolution jsonb;
begin
  select conversation.* into v_conversation
  from public.whatsapp_conversations as conversation
  where conversation.id = new.conversation_id
    and conversation.organization_id = new.organization_id;
  if not found or not v_conversation.unlinked_retention_v1
     or v_conversation.lead_id is not null
     or coalesce(v_conversation.is_group, false) then
    return new;
  end if;
  if tg_op = 'UPDATE'
     and old.capture_state = 'unlinked_ephemeral'
     and new.capture_state = 'promoted_unlinked'
     and private.whatsapp_unlinked_promotion_is_authorized(old, new)
     and exists (
       select 1 from private.whatsapp_unlinked_history_links as link
       where link.conversation_id = v_conversation.id
         and link.organization_id = v_conversation.organization_id
         and link.lead_id = new.lead_id
         and link.binding_mode = 'history_only'
         and link.confirmed_at < v_conversation.created_at + interval '7 days'
     ) then
    return new;
  end if;
  if v_conversation.retired_at is null
     and v_conversation.created_at > pg_catalog.clock_timestamp() - interval '7 days' then
    return new;
  end if;

  if v_conversation.retired_at is not null
     and v_conversation.created_at > pg_catalog.clock_timestamp() - interval '7 days'
     and new.capture_state = 'unlinked_ephemeral' then
    select snapshot.* into v_snapshot
    from public.whatsapp_webhook_routing_snapshots as snapshot
    where snapshot.organization_id = new.organization_id
      and snapshot.session_id = new.session_id
      and snapshot.provider_message_id = new.provider_message_id;
    v_resolution := private.whatsapp_unlinked_capture_resolution(
      new.organization_id, new.session_id, new.conversation_id,
      new.provider_message_id, v_snapshot.inbox_event_key
    );
    if v_resolution->>'capture_state' = 'unlinked_ephemeral'
       and new.sent_at <= v_conversation.retired_at then
      return new;
    end if;
  end if;

  if new.capture_state is distinct from 'suppressed'
     or new.content is not null
     or new.media_url is not null
     or new.media_storage_path is not null
     or new.media_mime_type is not null
     or new.media_error is not null
     or new.sender_jid is not null
     or new.sender_name is not null
     or new.reaction_sender_jid is not null
     or new.reaction_sender_name is not null
     or coalesce(new.metadata, '{}'::jsonb)
          not in ('{}'::jsonb, '{"unlinked_retention_v1":"expired"}'::jsonb) then
    raise exception using errcode = '23514',
      message = 'expired_unlinked_message_content_forbidden';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_expired_whatsapp_unlinked_message_write()
  from public, anon, authenticated, service_role;

create or replace function private.guard_whatsapp_media_job_epoch_insert()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_conversation public.whatsapp_conversations%rowtype;
  v_message public.whatsapp_messages%rowtype;
begin
  select conversation.* into v_conversation
  from public.whatsapp_conversations as conversation
  where conversation.id = new.conversation_id
    and conversation.organization_id = new.organization_id
  for share;
  if not found or not v_conversation.unlinked_retention_v1
     or v_conversation.lead_id is not null
     or coalesce(v_conversation.is_group, false) then
    return new;
  end if;
  if v_conversation.created_at <= pg_catalog.clock_timestamp() - interval '7 days' then
    raise exception using errcode = '23514',
      message = 'expired_unlinked_media_job_forbidden';
  end if;
  if v_conversation.retired_at is not null then
    select message.* into v_message
    from public.whatsapp_messages as message
    where message.id = new.message_id
      and message.organization_id = new.organization_id
      and message.session_id = new.session_id
      and message.conversation_id = new.conversation_id;
    if not found or v_message.capture_state <> 'unlinked_ephemeral'
       or v_message.sent_at > v_conversation.retired_at then
      raise exception using errcode = '23514',
        message = 'retired_unlinked_media_job_requires_prior_message';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.guard_whatsapp_media_job_epoch_insert()
  from public, anon, authenticated, service_role;

-- A lead-linked observation is visible without an attendance entry, but a
-- provider echo already tied to a CRM outbox row must stay on the managed
-- reconciliation path instead of becoming a duplicate observation.
create or replace function private.guard_whatsapp_observed_unattended()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.capture_state is distinct from 'observed_unattended' then
    return new;
  end if;
  if not exists (
    select 1 from public.whatsapp_conversations as conversation
    join public.whatsapp_conversation_lead_bindings as binding
      on binding.conversation_id = conversation.id
     and binding.organization_id = conversation.organization_id
     and binding.active_to is null
    where conversation.id = new.conversation_id
      and conversation.organization_id = new.organization_id
      and conversation.session_id = new.session_id
      and conversation.lead_id = new.lead_id
      and binding.lead_id = new.lead_id
      and conversation.retired_at is null
  ) then
    raise exception using errcode = '23514',
      message = 'observed_unattended_requires_current_lead_binding';
  end if;
  if new.from_me and (
    exists (
      select 1 from public.whatsapp_outbox as outbox
      where outbox.organization_id = new.organization_id
        and outbox.session_id = new.session_id
        and (
          outbox.provider_message_id = new.provider_message_id
          or outbox.client_message_id = new.client_message_id
        )
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
      message = 'managed_outbound_cannot_be_observed_unattended';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_whatsapp_observed_unattended()
  from public, anon, authenticated, service_role;
drop trigger if exists ty_guard_whatsapp_observed_unattended
on public.whatsapp_messages;
create trigger ty_guard_whatsapp_observed_unattended
before insert on public.whatsapp_messages
for each row execute function private.guard_whatsapp_observed_unattended();

-- Preserve the existing trigger functions and event kinds. Only the new
-- observation state is excluded from lead-side business effects.
drop trigger if exists gamification_canonical_whatsapp_insert_enqueue
on public.whatsapp_messages;
create trigger gamification_canonical_whatsapp_insert_enqueue
after insert on public.whatsapp_messages for each row
when (
  new.capture_state is distinct from 'suppressed'
  and new.capture_state is distinct from 'unlinked_ephemeral'
  and new.capture_state is distinct from 'promoted_unlinked'
  and new.capture_state is distinct from 'observed_unattended'
)
execute function private.enqueue_whatsapp_message_gamification();

drop trigger if exists gamification_canonical_whatsapp_status_enqueue
on public.whatsapp_messages;
create trigger gamification_canonical_whatsapp_status_enqueue
after update of status on public.whatsapp_messages for each row
when (
  new.capture_state is distinct from 'suppressed'
  and new.capture_state is distinct from 'unlinked_ephemeral'
  and new.capture_state is distinct from 'promoted_unlinked'
  and new.capture_state is distinct from 'observed_unattended'
)
execute function private.enqueue_whatsapp_message_gamification();

drop trigger if exists trg_capture_whatsapp_attention_fact
on public.whatsapp_messages;
create trigger trg_capture_whatsapp_attention_fact
after insert on public.whatsapp_messages for each row
when (
  new.capture_state is distinct from 'suppressed'
  and new.capture_state is distinct from 'unlinked_ephemeral'
  and new.capture_state is distinct from 'promoted_unlinked'
  and new.capture_state is distinct from 'observed_unattended'
)
execute function private.capture_whatsapp_attention_fact();

drop trigger if exists zz_automation_human_outbound_handoff
on public.whatsapp_messages;
create trigger zz_automation_human_outbound_handoff
after insert on public.whatsapp_messages for each row
when (
  new.capture_state is distinct from 'suppressed'
  and new.capture_state is distinct from 'unlinked_ephemeral'
  and new.capture_state is distinct from 'promoted_unlinked'
  and new.capture_state is distinct from 'observed_unattended'
)
execute function private.capture_automation_human_outbound_handoff();

drop trigger if exists zz_automation_inbound_message
on public.whatsapp_messages;
create trigger zz_automation_inbound_message
after insert on public.whatsapp_messages for each row
when (
  new.capture_state is distinct from 'suppressed'
  and new.capture_state is distinct from 'unlinked_ephemeral'
  and new.capture_state is distinct from 'promoted_unlinked'
  and new.capture_state is distinct from 'observed_unattended'
)
execute function private.capture_automation_inbound_message_event();

drop trigger if exists enqueue_whatsapp_avatar_after_message
on public.whatsapp_messages;
create trigger enqueue_whatsapp_avatar_after_message
after insert or update of status, direction, from_me, message_type,
  lead_id, session_id, conversation_id, remote_jid
on public.whatsapp_messages for each row
when (
  new.capture_state is distinct from 'suppressed'
  and new.capture_state is distinct from 'unlinked_ephemeral'
  and new.capture_state is distinct from 'promoted_unlinked'
  and new.capture_state is distinct from 'observed_unattended'
)
execute function private.enqueue_whatsapp_avatar_from_message();

-- A retired no-lead epoch linked as history_only retains its media. A GC job
-- for a shared Storage path must treat that attachment as a live reference.
do $protect_attached_retired_media$
declare
  v_target regprocedure;
  v_definition text;
  v_old text := 'and conversation.retired_at is null';
  v_new text := $condition$and (
        conversation.retired_at is null
        or exists (
          select 1 from private.whatsapp_unlinked_history_links as link
          where link.conversation_id = conversation.id
            and link.organization_id = conversation.organization_id
        )
      )$condition$;
begin
  foreach v_target in array array[
    'private.claim_whatsapp_unlinked_media_gc(text,integer,interval)'::regprocedure,
    'private.whatsapp_unlinked_media_gc_can_delete(uuid,text)'::regprocedure
  ] loop
    select pg_catalog.replace(pg_catalog.replace(
      pg_catalog.pg_get_functiondef(v_target), E'\r\n', E'\n'
    ), E'\r', E'\n') into v_definition;
    if (
      pg_catalog.length(v_definition)
      - pg_catalog.length(pg_catalog.replace(v_definition, v_old, ''))
    ) / pg_catalog.length(v_old) <> 2 then
      raise exception using errcode = '55000',
        message = 'whatsapp_attached_media_gc_source_drift';
    end if;
    execute pg_catalog.replace(v_definition, v_old, v_new);
  end loop;
end;
$protect_attached_retired_media$;

-- Redact raw webhook bodies for positively identified expired unlinked
-- epochs. Pending/retry and expired processing leases become terminal; dead
-- and processed rows keep status, but lose the original body. The immutable
-- routing snapshot is retained solely as replay/epoch provenance.
-- An inbox row can contain an unsplit batch. Every member must have an exact
-- immutable snapshot for this SAME epoch before the whole payload is redacted.
create or replace function private.whatsapp_unlinked_inbox_batch_exclusive(
  p_inbox_id uuid, p_conversation_id uuid
)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.whatsapp_webhook_inbox as inbox
    join public.whatsapp_conversations as conversation
      on conversation.id = p_conversation_id
     and conversation.organization_id = inbox.organization_id
     and conversation.session_id = inbox.session_id
    cross join lateral (
      select case when pg_catalog.jsonb_typeof(
        inbox.payload #> '{__vimob_ingress,routing_snapshot,messages}'
      ) = 'array' then
        inbox.payload #> '{__vimob_ingress,routing_snapshot,messages}'
      else '[]'::jsonb end as members
    ) as envelope
    where inbox.id = p_inbox_id
      and pg_catalog.jsonb_typeof(
        envelope.members
      ) = 'array'
      and pg_catalog.jsonb_array_length(
        envelope.members
      ) > 0
      and (
        select count(*)
        from public.whatsapp_webhook_routing_snapshots as snapshot
        where snapshot.organization_id = inbox.organization_id
          and snapshot.session_id = inbox.session_id
          and snapshot.inbox_event_key = inbox.event_key
      ) = pg_catalog.jsonb_array_length(
        envelope.members
      )
      and (
        select count(distinct member.value->>'provider_message_id')
        from pg_catalog.jsonb_array_elements(
          envelope.members
        ) as member(value)
      ) = pg_catalog.jsonb_array_length(
        envelope.members
      )
      and not exists (
        select 1
        from pg_catalog.jsonb_array_elements(
          envelope.members
        ) as member(value)
        where not exists (
          select 1
          from public.whatsapp_webhook_routing_snapshots as snapshot
          where snapshot.organization_id = inbox.organization_id
            and snapshot.session_id = inbox.session_id
            and snapshot.inbox_event_key = inbox.event_key
            and snapshot.provider_message_id = member.value->>'provider_message_id'
        )
      )
      and (
        select count(*)
        from (
          values
            (inbox.payload->'messages'), (inbox.payload->'Messages'),
            (inbox.payload->'message'), (inbox.payload->'Message'),
            (inbox.payload->'data'), (inbox.payload->'Data'),
            (inbox.payload #> '{data,messages}'),
            (inbox.payload #> '{data,Messages}'),
            (inbox.payload #> '{data,message}'),
            (inbox.payload #> '{data,Message}'),
            (inbox.payload #> '{Data,messages}'),
            (inbox.payload #> '{Data,Messages}'),
            (inbox.payload #> '{Data,message}'),
            (inbox.payload #> '{Data,Message}')
        ) as location(value)
        where case when pg_catalog.jsonb_typeof(location.value) = 'array'
          then pg_catalog.jsonb_array_length(location.value) else 0 end > 0
      ) <= 1
      and coalesce((
        select pg_catalog.jsonb_array_length(location.value)
        from (
          values
            (inbox.payload->'messages'), (inbox.payload->'Messages'),
            (inbox.payload->'message'), (inbox.payload->'Message'),
            (inbox.payload->'data'), (inbox.payload->'Data'),
            (inbox.payload #> '{data,messages}'),
            (inbox.payload #> '{data,Messages}'),
            (inbox.payload #> '{data,message}'),
            (inbox.payload #> '{data,Message}'),
            (inbox.payload #> '{Data,messages}'),
            (inbox.payload #> '{Data,Messages}'),
            (inbox.payload #> '{Data,message}'),
            (inbox.payload #> '{Data,Message}')
        ) as location(value)
        where case when pg_catalog.jsonb_typeof(location.value) = 'array'
          then pg_catalog.jsonb_array_length(location.value) else 0 end > 0
        limit 1
      ), 1) = pg_catalog.jsonb_array_length(
        envelope.members
      )
      and not exists (
        select 1
        from public.whatsapp_webhook_routing_snapshots as snapshot
        where snapshot.organization_id = inbox.organization_id
          and snapshot.session_id = inbox.session_id
          and snapshot.inbox_event_key = inbox.event_key
          and (
            snapshot.snapshot->>'unlinked_capture_policy' = 'v1'
            and snapshot.snapshot->>'state' = 'unlinked'
            and snapshot.snapshot->>'context_kind' = 'organic'
            and nullif(snapshot.snapshot->>'event_lead_id', '') is null
            and nullif(snapshot.snapshot->>'current_lead_id', '') is null
            and nullif(snapshot.snapshot->>'quarantine_reason', '') is null
            and (
              snapshot.snapshot->>'conversation_id' = conversation.id::text
              or (
                snapshot.snapshot->>'conversation_id' is null
                and (
                  exists (
                    select 1 from public.whatsapp_messages as message
                    where message.organization_id = inbox.organization_id
                      and message.session_id = inbox.session_id
                      and message.conversation_id = conversation.id
                      and message.provider_message_id = snapshot.provider_message_id
                      and (message.capture_state = 'unlinked_ephemeral'
                           or message.unlinked_retention_scrubbed_at is not null)
                  )
                  or (
                    conversation.created_at >= inbox.created_at
                    and conversation.created_at < inbox.created_at + interval '7 days'
                    and snapshot.routing_key in (
                      'phone:' || coalesce(public.normalize_phone(conversation.contact_phone), ''),
                      'jid:' || pg_catalog.lower(conversation.remote_jid)
                    )
                  )
                )
                and not exists (
                  select 1 from public.whatsapp_conversations as other_epoch
                  where other_epoch.organization_id = conversation.organization_id
                    and other_epoch.session_id = conversation.session_id
                    and other_epoch.remote_jid = conversation.remote_jid
                    and other_epoch.id <> conversation.id
                    and other_epoch.created_at >= inbox.created_at
                    and other_epoch.created_at < conversation.created_at
                )
              )
            )
          ) is not true
      )
  );
$$;
revoke all on function private.whatsapp_unlinked_inbox_batch_exclusive(uuid, uuid)
  from public, anon, authenticated, service_role;

-- Keep routing provenance immutable for ordinary processing. A terminal
-- seven-day redaction may remove that embedded copy only after the separate
-- SQL snapshot proves every member of the row belongs to one expired epoch.
create or replace function private.preserve_whatsapp_webhook_routing_snapshot()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.payload #> '{__vimob_ingress,routing_snapshot}'
     is distinct from old.payload #> '{__vimob_ingress,routing_snapshot}' then
    if new.payload = '{"__vimob_retention":"expired_unlinked_v1"}'::jsonb
       and new.status in ('dead', 'processed')
       and exists (
         select 1 from public.whatsapp_conversations as conversation
         where conversation.organization_id = old.organization_id
           and conversation.session_id = old.session_id
           and conversation.unlinked_retention_v1
           and conversation.lead_id is null
           and conversation.created_at <= pg_catalog.clock_timestamp() - interval '7 days'
           and conversation.unlinked_retention_scrubbed_at is null
           and not private.whatsapp_conversation_has_protected_history(
             conversation.id
           )
           and private.whatsapp_unlinked_inbox_batch_exclusive(
             old.id, conversation.id
           )
       ) then
      return new;
    end if;
    raise exception using errcode = '23514',
      message = 'whatsapp_webhook_routing_snapshot_immutable';
  end if;
  return new;
end;
$$;
revoke all on function private.preserve_whatsapp_webhook_routing_snapshot()
  from public, anon, authenticated, service_role;

-- Forward declaration; replaced with the full batch proof below before the
-- transaction commits. It is never visible as a callable implementation.
create or replace function private.whatsapp_unlinked_has_unscrubbed_inbox(
  p_conversation_id uuid
)
returns boolean language sql stable security definer set search_path = ''
as $$ select false $$;

create or replace function private.scrub_expired_whatsapp_unlinked_inbox(
  p_limit integer default 500
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_count integer := 0;
  v_terminal integer := 0;
  v_new_terminal integer := 0;
  v_conversation public.whatsapp_conversations%rowtype;
begin
  if p_limit is null or p_limit < 1 or p_limit > 2000 then
    raise exception using errcode = '22023',
      message = 'whatsapp_unlinked_inbox_scrub_limit_invalid';
  end if;
  if exists (
    select 1 from pg_catalog.pg_constraint as constraint_state
    where constraint_state.conrelid = 'public.whatsapp_conversations'::regclass
      and constraint_state.conname = 'whatsapp_conversations_session_id_remote_jid_key'
  ) then
    return pg_catalog.jsonb_build_object(
      'inbox_scrubbed', 0, 'inbox_terminal', 0,
      'inbox_newly_terminalized', 0
    );
  end if;
  -- Human link, ingress snapshot capture, and canonical retention all lock
  -- this parent first. Holding it through inbox redaction makes the 7-day
  -- eligibility decision atomic with those writers.
  select conversation.* into v_conversation
  from public.whatsapp_conversations as conversation
  where conversation.unlinked_retention_v1
    and conversation.lead_id is null
    and conversation.created_at <= pg_catalog.clock_timestamp() - interval '7 days'
    and conversation.unlinked_retention_scrubbed_at is null
    and coalesce(conversation.is_group, false) = false
    and not private.whatsapp_conversation_has_protected_history(
      conversation.id
    )
    and private.whatsapp_unlinked_has_unscrubbed_inbox(conversation.id)
  order by conversation.created_at, conversation.id
  for update of conversation skip locked
  limit 1;
  if not found then
    return pg_catalog.jsonb_build_object(
      'inbox_scrubbed', 0, 'inbox_terminal', 0,
      'inbox_newly_terminalized', 0
    );
  end if;
  with candidates as (
    select inbox.id, inbox.status as previous_status
    from public.whatsapp_webhook_inbox as inbox
    join public.whatsapp_webhook_routing_snapshots as snapshot
      on snapshot.organization_id = inbox.organization_id
     and snapshot.session_id = inbox.session_id
     and snapshot.inbox_event_key = inbox.event_key
    join public.whatsapp_conversations as conversation
      on conversation.organization_id = inbox.organization_id
     and conversation.session_id = inbox.session_id
     and conversation.id = v_conversation.id
     and (
       snapshot.snapshot->>'conversation_id' = conversation.id::text
       or (
         snapshot.snapshot->>'conversation_id' is null
         and (
           exists (
             select 1 from public.whatsapp_messages as message
             where message.organization_id = inbox.organization_id
               and message.session_id = inbox.session_id
               and message.conversation_id = conversation.id
               and message.provider_message_id = snapshot.provider_message_id
               and (message.capture_state = 'unlinked_ephemeral'
                    or message.unlinked_retention_scrubbed_at is not null)
           )
           or (
             conversation.created_at >= inbox.created_at
             and conversation.created_at < inbox.created_at + interval '7 days'
             and snapshot.routing_key in (
               'phone:' || coalesce(public.normalize_phone(conversation.contact_phone), ''),
               'jid:' || pg_catalog.lower(conversation.remote_jid)
             )
           )
         )
         and not exists (
           select 1 from public.whatsapp_conversations as other_epoch
           where other_epoch.organization_id = conversation.organization_id
             and other_epoch.session_id = conversation.session_id
             and other_epoch.remote_jid = conversation.remote_jid
             and other_epoch.id <> conversation.id
             and other_epoch.created_at >= inbox.created_at
             and other_epoch.created_at < conversation.created_at
         )
       )
     )
    where conversation.unlinked_retention_v1
      and conversation.lead_id is null
      and conversation.created_at <= pg_catalog.clock_timestamp() - interval '7 days'
      and coalesce(conversation.is_group, false) = false
      and snapshot.snapshot->>'unlinked_capture_policy' = 'v1'
      and snapshot.snapshot->>'state' = 'unlinked'
      and snapshot.snapshot->>'context_kind' = 'organic'
      and nullif(snapshot.snapshot->>'event_lead_id', '') is null
      and nullif(snapshot.snapshot->>'current_lead_id', '') is null
      and nullif(snapshot.snapshot->>'quarantine_reason', '') is null
      and inbox.created_at < conversation.created_at + interval '7 days'
      and (conversation.retired_at is null
           or inbox.created_at <= conversation.retired_at)
      and not private.whatsapp_conversation_has_protected_history(conversation.id)
      and not exists (
        select 1 from private.whatsapp_unlinked_history_links as link
        where link.conversation_id = conversation.id
      )
      and private.whatsapp_unlinked_inbox_batch_exclusive(
        inbox.id, conversation.id
      )
      and (
        inbox.status in ('pending', 'retry', 'dead', 'processed')
        or (inbox.status = 'processing'
            and inbox.locked_at < pg_catalog.clock_timestamp() - interval '10 minutes')
      )
      and (inbox.payload <>
             '{"__vimob_retention":"expired_unlinked_v1"}'::jsonb
           or inbox.status in ('pending', 'retry', 'processing'))
    order by inbox.created_at, inbox.id
    for update of inbox skip locked
    limit p_limit
  ), scrubbed as (
    update public.whatsapp_webhook_inbox as inbox
    set payload = '{"__vimob_retention":"expired_unlinked_v1"}'::jsonb,
        status = case when inbox.status in ('pending', 'retry', 'processing')
          then 'dead' else inbox.status end,
        dead_lettered_at = case when inbox.status in ('pending', 'retry', 'processing', 'dead')
          then coalesce(inbox.dead_lettered_at, pg_catalog.clock_timestamp())
          else inbox.dead_lettered_at end,
        locked_at = null,
        locked_by = null,
        last_error = case when inbox.status in ('pending', 'retry', 'processing', 'dead')
          then 'expired_unlinked_epoch_terminalized' else inbox.last_error end,
        updated_at = pg_catalog.clock_timestamp()
    from candidates
    where inbox.id = candidates.id
    returning (inbox.status = 'dead') as terminal,
              (candidates.previous_status in ('pending', 'retry', 'processing'))
                as newly_terminalized
  )
  select count(*)::integer,
         count(*) filter (where scrubbed.terminal)::integer,
         count(*) filter (where scrubbed.newly_terminalized)::integer
  into v_count, v_terminal, v_new_terminal
  from scrubbed;
  return pg_catalog.jsonb_build_object(
    'inbox_scrubbed', v_count,
    'inbox_terminal', v_terminal,
    'inbox_newly_terminalized', v_new_terminal
  );
end;
$$;
revoke all on function private.scrub_expired_whatsapp_unlinked_inbox(integer)
  from public, anon, authenticated;
grant execute on function private.scrub_expired_whatsapp_unlinked_inbox(integer)
  to service_role;

-- The first webhook may have no conversation_id in its immutable snapshot.
-- Keep the phone proof available while any matching raw body remains. Without
-- this fence, a 500-row batch could complete the conversation and erase the
-- only phone needed to identify row 501 on the next worker cycle.
create or replace function private.whatsapp_unlinked_has_unscrubbed_inbox(
  p_conversation_id uuid
)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.whatsapp_conversations as conversation
    join public.whatsapp_webhook_inbox as inbox
      on inbox.organization_id = conversation.organization_id
     and inbox.session_id = conversation.session_id
    join public.whatsapp_webhook_routing_snapshots as snapshot
      on snapshot.organization_id = inbox.organization_id
     and snapshot.session_id = inbox.session_id
     and snapshot.inbox_event_key = inbox.event_key
    where conversation.id = p_conversation_id
      and conversation.unlinked_retention_v1
      and conversation.lead_id is null
      and inbox.payload->>'__vimob_retention'
        is distinct from 'expired_unlinked_v1'
      and private.whatsapp_unlinked_inbox_batch_exclusive(
        inbox.id, conversation.id
      )
      and inbox.created_at < conversation.created_at + interval '7 days'
      and (conversation.retired_at is null
           or inbox.created_at <= conversation.retired_at)
      and snapshot.snapshot->>'unlinked_capture_policy' = 'v1'
      and snapshot.snapshot->>'state' = 'unlinked'
      and snapshot.snapshot->>'context_kind' = 'organic'
      and nullif(snapshot.snapshot->>'event_lead_id', '') is null
      and nullif(snapshot.snapshot->>'current_lead_id', '') is null
      and nullif(snapshot.snapshot->>'quarantine_reason', '') is null
      and (
        snapshot.snapshot->>'conversation_id' = conversation.id::text
        or (
          snapshot.snapshot->>'conversation_id' is null
          and (
            exists (
              select 1 from public.whatsapp_messages as message
              where message.organization_id = inbox.organization_id
                and message.session_id = inbox.session_id
                and message.conversation_id = conversation.id
                and message.provider_message_id = snapshot.provider_message_id
                and (message.capture_state = 'unlinked_ephemeral'
                     or message.unlinked_retention_scrubbed_at is not null)
            )
            or (
              conversation.created_at >= inbox.created_at
              and conversation.created_at < inbox.created_at + interval '7 days'
              and snapshot.routing_key in (
                'phone:' || coalesce(public.normalize_phone(conversation.contact_phone), ''),
                'jid:' || pg_catalog.lower(conversation.remote_jid)
              )
            )
          )
          and not exists (
            select 1 from public.whatsapp_conversations as other_epoch
            where other_epoch.organization_id = conversation.organization_id
              and other_epoch.session_id = conversation.session_id
              and other_epoch.remote_jid = conversation.remote_jid
              and other_epoch.id <> conversation.id
              and other_epoch.created_at >= inbox.created_at
              and other_epoch.created_at < conversation.created_at
          )
        )
      )
  );
$$;
revoke all on function private.whatsapp_unlinked_has_unscrubbed_inbox(uuid)
  from public, anon, authenticated, service_role;

-- Keep the worker's existing SQL entry point. It now advances both the
-- canonical-message scrub and the bounded raw-inbox redaction each cycle.
alter function private.scrub_expired_whatsapp_unlinked_conversations(integer)
  rename to scrub_expired_whatsapp_unlinked_conversations_base;
do $fence_raw_before_finalizing$
declare
  v_base regprocedure := pg_catalog.to_regprocedure(
    'private.scrub_expired_whatsapp_unlinked_conversations_base(integer)'
  );
  v_definition text;
  v_anchor text := $anchor$
  if not exists (
    select 1 from public.whatsapp_messages as message
    where message.conversation_id = v_conversation.id
      and message.unlinked_retention_scrubbed_at is null
  ) then$anchor$;
begin
  if v_base is null then
    raise exception using errcode = '55000',
      message = 'whatsapp_unlinked_retention_base_missing';
  end if;
  select pg_catalog.replace(pg_catalog.replace(
    pg_catalog.pg_get_functiondef(v_base), E'\r\n', E'\n'
  ), E'\r', E'\n') into v_definition;
  if pg_catalog.strpos(v_definition, v_anchor) = 0
     or pg_catalog.strpos(
       pg_catalog.substr(
         v_definition,
         pg_catalog.strpos(v_definition, v_anchor) + pg_catalog.length(v_anchor)
       ), v_anchor
     ) > 0 then
    raise exception using errcode = '55000',
      message = 'whatsapp_unlinked_retention_finalize_drift';
  end if;
  execute pg_catalog.replace(v_definition, v_anchor,
    pg_catalog.replace(v_anchor, ') then',
      ') and not private.whatsapp_unlinked_has_unscrubbed_inbox(' || E'\n'
      || '    v_conversation.id' || E'\n' || '  ) then'
    )
  );
end;
$fence_raw_before_finalizing$;
create or replace function private.scrub_expired_whatsapp_unlinked_conversations(
  p_message_limit integer default 500
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_base jsonb;
  v_inbox jsonb;
begin
  v_inbox := private.scrub_expired_whatsapp_unlinked_inbox(p_message_limit);
  v_base := private.scrub_expired_whatsapp_unlinked_conversations_base(
    p_message_limit
  );
  if v_base->>'status' = 'cutover_required' then
    return v_base;
  end if;
  return v_base || v_inbox || pg_catalog.jsonb_build_object(
    'status', case
      when v_base->>'status' = 'idle'
           and coalesce((v_inbox->>'inbox_scrubbed')::integer, 0) > 0
        then 'processed'
      else v_base->>'status'
    end
  );
end;
$$;
revoke all on function private.scrub_expired_whatsapp_unlinked_conversations(integer)
  from public, anon, authenticated;
grant execute on function private.scrub_expired_whatsapp_unlinked_conversations(integer)
  to service_role;

commit;
