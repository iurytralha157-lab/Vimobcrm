-- A mixed, unsplit provider batch can retain lead traffic after one observed
-- unlinked conversation expires. This narrow path removes only raw members
-- whose immutable routing snapshot names that exact physical conversation.
-- Unsupported envelopes, ambiguous identities and predecessor chains keep
-- their original inbox body for manual review.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '5min';

-- The marker belongs to the database retention worker, never to the
-- provider. Strip a forged copy even if an older ingress writer missed it.
create or replace function private.strip_whatsapp_provider_retention_marker()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if pg_catalog.jsonb_typeof(new.payload) = 'object' then
    new.payload := new.payload - '__vimob_retention';
  end if;
  return new;
end;
$$;
revoke all on function private.strip_whatsapp_provider_retention_marker()
  from public, anon, authenticated, service_role;
drop trigger if exists strip_whatsapp_provider_retention_marker_before_insert
  on public.whatsapp_webhook_inbox;
create trigger strip_whatsapp_provider_retention_marker_before_insert
before insert on public.whatsapp_webhook_inbox
for each row execute function private.strip_whatsapp_provider_retention_marker();

create or replace function private.whatsapp_unlinked_mixed_inbox_plan(
  p_inbox_id uuid, p_conversation_id uuid
)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_inbox public.whatsapp_webhook_inbox%rowtype;
  v_conversation public.whatsapp_conversations%rowtype;
  v_payload jsonb;
  v_data jsonb;
  v_ingress jsonb;
  v_envelope jsonb;
  v_members jsonb;
  v_snapshots jsonb;
  v_marker jsonb;
  v_member jsonb;
  v_embedded jsonb;
  v_route public.whatsapp_webhook_routing_snapshots%rowtype;
  v_provider_id text;
  v_key_id text;
  v_info_id text;
  v_removed_ids text[] := '{}'::text[];
  v_seen_ids text[] := '{}'::text[];
  v_kept_members jsonb := '[]'::jsonb;
  v_kept_snapshots jsonb := '[]'::jsonb;
  v_previous_count integer := 0;
  v_route_count integer;
  v_member_count integer;
  v_removed_count integer;
  v_index integer;
  v_result jsonb;
begin
  select inbox.* into v_inbox
  from public.whatsapp_webhook_inbox as inbox
  where inbox.id = p_inbox_id;
  select conversation.* into v_conversation
  from public.whatsapp_conversations as conversation
  where conversation.id = p_conversation_id;
  if v_inbox.id is null or v_conversation.id is null
     or v_inbox.organization_id <> v_conversation.organization_id
     or v_inbox.session_id <> v_conversation.session_id
     or v_inbox.event_type <> 'messages.upsert'
     or v_inbox.status not in ('pending', 'retry', 'dead', 'processed')
     or not v_conversation.unlinked_retention_v1
     or v_conversation.lead_id is not null
     or coalesce(v_conversation.is_group, false)
     or v_conversation.unlinked_retention_scrubbed_at is not null
     or v_conversation.created_at > pg_catalog.clock_timestamp() - interval '7 days'
     or v_inbox.created_at >= v_conversation.created_at + interval '7 days'
     or (v_conversation.retired_at is not null
         and v_inbox.created_at > v_conversation.retired_at)
     or private.whatsapp_conversation_has_protected_history(v_conversation.id)
     or exists (
       select 1 from private.whatsapp_unlinked_history_links as link
       where link.conversation_id = v_conversation.id
     ) then
    return null;
  end if;

  -- The provider decoder has several legacy shapes. Only this one canonical
  -- list is transformed. Every other shape stays byte-for-byte intact.
  v_payload := v_inbox.payload;
  v_data := v_payload->'data';
  v_ingress := v_payload->'__vimob_ingress';
  v_envelope := v_ingress->'routing_snapshot';
  v_members := v_data->'messages';
  v_snapshots := v_envelope->'messages';
  if pg_catalog.jsonb_typeof(v_payload) <> 'object'
     or pg_catalog.jsonb_typeof(v_data) <> 'object'
     or pg_catalog.jsonb_typeof(v_ingress) <> 'object'
     or pg_catalog.jsonb_typeof(v_envelope) <> 'object'
     or pg_catalog.jsonb_typeof(v_members) <> 'array'
     or pg_catalog.jsonb_typeof(v_snapshots) <> 'array'
     or (v_payload - 'data' - '__vimob_ingress' - '__vimob_retention' - 'event'
                   - 'instance' - 'instanceName' - 'instanceId') <> '{}'::jsonb
     or (v_data - 'messages') <> '{}'::jsonb
     or (v_ingress - 'routing_key' - 'epoch_capable'
                   - 'routing_snapshot') <> '{}'::jsonb
     or v_ingress->>'routing_key' <> '__session__'
     or v_ingress->'epoch_capable' is distinct from 'true'::jsonb
     or (v_envelope - 'version' - 'messages') <> '{}'::jsonb
     or v_envelope->'version' is distinct from '1'::jsonb then
    return null;
  end if;
  v_member_count := pg_catalog.jsonb_array_length(v_members);
  if v_member_count < 1
     or v_member_count <> pg_catalog.jsonb_array_length(v_snapshots) then
    return null;
  end if;
  v_marker := v_payload->'__vimob_retention';
  if v_marker is not null then
    if pg_catalog.jsonb_typeof(v_marker) <> 'object'
       or (v_marker - 'kind' - 'redacted_count') <> '{}'::jsonb
       or v_marker->>'kind' <> 'partial_expired_unlinked_v1'
       or coalesce(v_marker->>'redacted_count', '') !~ '^[1-9][0-9]{0,5}$' then
      return null;
    end if;
    v_previous_count := (v_marker->>'redacted_count')::integer;
  end if;
  select count(*)::integer into v_route_count
  from public.whatsapp_webhook_routing_snapshots as route
  where route.organization_id = v_inbox.organization_id
    and route.session_id = v_inbox.session_id
    and route.inbox_event_key = v_inbox.event_key;
  if v_route_count <> v_member_count + v_previous_count then
    return null;
  end if;

  for v_index in 0..v_member_count - 1 loop
    v_member := v_members->v_index;
    v_embedded := v_snapshots->v_index;
    if pg_catalog.jsonb_typeof(v_member) <> 'object'
       or pg_catalog.jsonb_typeof(v_embedded) <> 'object' then
      return null;
    end if;
    v_key_id := nullif(pg_catalog.btrim(v_member #>> '{key,id}'), '');
    v_info_id := nullif(pg_catalog.btrim(v_member #>> '{Info,ID}'), '');
    if (v_key_id is null) = (v_info_id is null) then
      return null;
    end if;
    v_provider_id := coalesce(v_key_id, v_info_id);
    if pg_catalog.length(v_provider_id) > 512
       or v_provider_id = any(v_seen_ids)
       or v_embedded->>'provider_message_id' is distinct from v_provider_id then
      return null;
    end if;
    v_seen_ids := pg_catalog.array_append(v_seen_ids, v_provider_id);
    select route.* into v_route
    from public.whatsapp_webhook_routing_snapshots as route
    where route.organization_id = v_inbox.organization_id
      and route.session_id = v_inbox.session_id
      and route.inbox_event_key = v_inbox.event_key
      and route.provider_message_id = v_provider_id;
    if not found or v_embedded is distinct from v_route.snapshot
       or v_route.processing_epoch <> v_inbox.processing_epoch then
      return null;
    end if;
    if (
         v_route.snapshot->>'conversation_id' = v_conversation.id::text
         or (
           v_route.snapshot->>'conversation_id' is null
           and (
             exists (
               select 1 from public.whatsapp_messages as message
               where message.organization_id = v_inbox.organization_id
                 and message.session_id = v_inbox.session_id
                 and message.conversation_id = v_conversation.id
                 and message.provider_message_id = v_provider_id
                 and (message.capture_state = 'unlinked_ephemeral'
                      or message.unlinked_retention_scrubbed_at is not null)
                 and not exists (
                   select 1 from public.whatsapp_messages as other_message
                   where other_message.organization_id = message.organization_id
                     and other_message.session_id = message.session_id
                     and other_message.provider_message_id = v_provider_id
                     and other_message.conversation_id is distinct from v_conversation.id
                 )
             )
             or (
               v_conversation.created_at >= v_inbox.created_at
               and v_conversation.created_at < v_inbox.created_at + interval '7 days'
               and v_route.routing_key in (
                 'phone:' || coalesce(public.normalize_phone(
                   v_conversation.contact_phone
                 ), ''),
                 'jid:' || pg_catalog.lower(v_conversation.remote_jid)
               )
               and not exists (
                 select 1 from public.whatsapp_conversations as other_epoch
                 where other_epoch.organization_id = v_conversation.organization_id
                   and other_epoch.session_id = v_conversation.session_id
                   and other_epoch.id <> v_conversation.id
                   and (other_epoch.retired_at is null
                        or other_epoch.retired_at >= v_inbox.created_at)
                   and (
                     other_epoch.remote_jid = v_conversation.remote_jid
                     or (
                       public.normalize_phone(v_conversation.contact_phone) is not null
                       and public.normalize_phone(other_epoch.contact_phone) =
                           public.normalize_phone(v_conversation.contact_phone)
                     )
                   )
               )
             )
           )
         )
       )
       and v_route.snapshot->>'unlinked_capture_policy' = 'v1'
       and v_route.snapshot->>'state' = 'unlinked'
       and v_route.snapshot->>'context_kind' = 'organic'
       and nullif(v_route.snapshot->>'event_lead_id', '') is null
       and nullif(v_route.snapshot->>'current_lead_id', '') is null
       and nullif(v_route.snapshot->>'quarantine_reason', '') is null then
      v_removed_ids := pg_catalog.array_append(v_removed_ids, v_provider_id);
    else
      v_kept_members := v_kept_members || pg_catalog.jsonb_build_array(v_member);
      v_kept_snapshots := v_kept_snapshots || pg_catalog.jsonb_build_array(v_embedded);
    end if;
  end loop;
  v_removed_count := pg_catalog.cardinality(v_removed_ids);
  if v_removed_count = 0
     or (v_removed_count = v_member_count and v_previous_count = 0)
     or exists (
       select 1 from public.whatsapp_webhook_routing_snapshots as successor
       where successor.organization_id = v_inbox.organization_id
         and successor.session_id = v_inbox.session_id
         and successor.predecessor_provider_message_id = any(v_removed_ids)
         and successor.provider_message_id <> all(v_removed_ids)
     )
     or exists (
       select 1 from public.whatsapp_conversation_routing_heads as head
       where head.organization_id = v_inbox.organization_id
         and head.session_id = v_inbox.session_id
         and head.provider_message_id = any(v_removed_ids)
     ) then
    return null;
  end if;

  if v_removed_count = v_member_count then
    v_result := '{"__vimob_retention":"expired_unlinked_v1"}'::jsonb;
  else
    v_result := pg_catalog.jsonb_set(v_payload, '{data,messages}', v_kept_members);
    v_result := pg_catalog.jsonb_set(
      v_result, '{__vimob_ingress,routing_snapshot,messages}', v_kept_snapshots
    );
    v_result := v_result || pg_catalog.jsonb_build_object(
      '__vimob_retention', pg_catalog.jsonb_build_object(
        'kind', 'partial_expired_unlinked_v1',
        'redacted_count', v_previous_count + v_removed_count
      )
    );
  end if;
  return pg_catalog.jsonb_build_object(
    'payload', v_result,
    'removed_provider_message_ids', pg_catalog.to_jsonb(v_removed_ids),
    'redacted_count', v_removed_count,
    'terminal', v_removed_count = v_member_count
  );
end;
$$;
revoke all on function private.whatsapp_unlinked_mixed_inbox_plan(uuid, uuid)
  from public, anon, authenticated, service_role;

-- Preserve the immutable snapshot guard; accept only the exact transition
-- computed from the old inbox body and an eligible, locked conversation.
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
           and not private.whatsapp_conversation_has_protected_history(conversation.id)
           and private.whatsapp_unlinked_inbox_batch_exclusive(old.id, conversation.id)
       ) then
      return new;
    end if;
    if exists (
      select 1 from public.whatsapp_conversations as conversation
      cross join lateral private.whatsapp_unlinked_mixed_inbox_plan(
        old.id, conversation.id
      ) as plan(result)
      where conversation.organization_id = old.organization_id
        and conversation.session_id = old.session_id
        and plan.result->'payload' = new.payload
        and new.status = case when plan.result->>'terminal' = 'true'
          and old.status in ('pending', 'retry') then 'dead'
          else old.status end
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

-- A mixed row must keep the parent contact proof until its own raw members
-- have been removed. A prior partial marker means external snapshots alone
-- are insufficient evidence that raw text is still present.
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
      and inbox.payload <> '{"__vimob_retention":"expired_unlinked_v1"}'::jsonb
      and snapshot.snapshot->>'unlinked_capture_policy' = 'v1'
      and snapshot.snapshot->>'state' = 'unlinked'
      and snapshot.snapshot->>'context_kind' = 'organic'
      and nullif(snapshot.snapshot->>'event_lead_id', '') is null
      and nullif(snapshot.snapshot->>'current_lead_id', '') is null
      and nullif(snapshot.snapshot->>'quarantine_reason', '') is null
      and inbox.created_at < conversation.created_at + interval '7 days'
      and (conversation.retired_at is null
           or inbox.created_at <= conversation.retired_at)
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
              snapshot.routing_key in (
                'phone:' || coalesce(public.normalize_phone(conversation.contact_phone), ''),
                'jid:' || pg_catalog.lower(conversation.remote_jid)
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
        )
      )
      and (
        inbox.payload #>> '{__vimob_retention,kind}'
          is distinct from 'partial_expired_unlinked_v1'
        or exists (
          select 1
          from pg_catalog.jsonb_array_elements(
            case when pg_catalog.jsonb_typeof(
              inbox.payload #> '{data,messages}'
            ) = 'array' then inbox.payload #> '{data,messages}'
            else '[]'::jsonb end
          ) as raw_member(value)
          where snapshot.provider_message_id in (
            raw_member.value #>> '{key,id}',
            raw_member.value #>> '{Info,ID}'
          )
        )
      )
  );
$$;
revoke all on function private.whatsapp_unlinked_has_unscrubbed_inbox(uuid)
  from public, anon, authenticated, service_role;

alter function private.scrub_expired_whatsapp_unlinked_inbox(integer)
  rename to scrub_expired_whatsapp_unlinked_inbox_exclusive;
revoke all on function private.scrub_expired_whatsapp_unlinked_inbox_exclusive(integer)
  from public, anon, authenticated, service_role;

create or replace function private.scrub_expired_whatsapp_unlinked_inbox(
  p_limit integer default 500
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_exclusive jsonb;
  v_conversation public.whatsapp_conversations%rowtype;
  v_inbox public.whatsapp_webhook_inbox%rowtype;
  v_plan jsonb;
  v_payload jsonb;
  v_provider_id text;
  v_route public.whatsapp_webhook_routing_snapshots%rowtype;
  v_partial_count integer := 0;
  v_partial_terminal integer := 0;
  v_new_terminal integer := 0;
begin
  if p_limit is null or p_limit < 1 or p_limit > 2000 then
    raise exception using errcode = '22023',
      message = 'whatsapp_unlinked_inbox_scrub_limit_invalid';
  end if;
  v_exclusive := private.scrub_expired_whatsapp_unlinked_inbox_exclusive(p_limit);
  if coalesce((v_exclusive->>'inbox_scrubbed')::integer, 0) >= p_limit then
    return v_exclusive || pg_catalog.jsonb_build_object('inbox_partial', 0);
  end if;

  for v_conversation in
    select conversation.*
    from public.whatsapp_conversations as conversation
    where conversation.unlinked_retention_v1
      and conversation.lead_id is null
      and conversation.created_at <= pg_catalog.clock_timestamp() - interval '7 days'
      and conversation.unlinked_retention_scrubbed_at is null
      and coalesce(conversation.is_group, false) = false
      and not private.whatsapp_conversation_has_protected_history(conversation.id)
      and private.whatsapp_unlinked_has_unscrubbed_inbox(conversation.id)
      and exists (
        select 1 from public.whatsapp_webhook_inbox as candidate
        where candidate.organization_id = conversation.organization_id
          and candidate.session_id = conversation.session_id
          and candidate.status in ('pending', 'retry', 'dead', 'processed')
          and private.whatsapp_unlinked_mixed_inbox_plan(
            candidate.id, conversation.id
          ) is not null
      )
    order by conversation.created_at, conversation.id
    limit p_limit
    for update of conversation skip locked
  loop
    for v_inbox in
      select inbox.*
      from public.whatsapp_webhook_inbox as inbox
      where inbox.organization_id = v_conversation.organization_id
        and inbox.session_id = v_conversation.session_id
        and inbox.status in ('pending', 'retry', 'dead', 'processed')
        and inbox.payload <> '{"__vimob_retention":"expired_unlinked_v1"}'::jsonb
        and exists (
          select 1 from public.whatsapp_webhook_routing_snapshots as snapshot
          where snapshot.organization_id = inbox.organization_id
            and snapshot.session_id = inbox.session_id
            and snapshot.inbox_event_key = inbox.event_key
            and snapshot.snapshot->>'unlinked_capture_policy' = 'v1'
            and snapshot.snapshot->>'state' = 'unlinked'
            and (
              snapshot.snapshot->>'conversation_id' = v_conversation.id::text
              or (
                snapshot.snapshot->>'conversation_id' is null
                and (
                  snapshot.routing_key in (
                    'phone:' || coalesce(public.normalize_phone(
                      v_conversation.contact_phone
                    ), ''),
                    'jid:' || pg_catalog.lower(v_conversation.remote_jid)
                  )
                  or exists (
                    select 1 from public.whatsapp_messages as message
                    where message.organization_id = inbox.organization_id
                      and message.session_id = inbox.session_id
                      and message.conversation_id = v_conversation.id
                      and message.provider_message_id = snapshot.provider_message_id
                  )
                )
              )
            )
        )
        and private.whatsapp_unlinked_mixed_inbox_plan(
          inbox.id, v_conversation.id
        ) is not null
      order by inbox.created_at, inbox.id
      limit p_limit
      for update of inbox skip locked
    loop
      v_plan := private.whatsapp_unlinked_mixed_inbox_plan(
        v_inbox.id, v_conversation.id
      );
      if v_plan is null then
        continue;
      end if;
      v_payload := v_plan->'payload';
      for v_provider_id in
        select raw_id.value
        from pg_catalog.jsonb_array_elements_text(
          v_plan->'removed_provider_message_ids'
        ) as raw_id(value)
      loop
        select snapshot.* into v_route
        from public.whatsapp_webhook_routing_snapshots as snapshot
        where snapshot.organization_id = v_inbox.organization_id
          and snapshot.session_id = v_inbox.session_id
          and snapshot.inbox_event_key = v_inbox.event_key
          and snapshot.provider_message_id = v_provider_id;
        insert into public.whatsapp_webhook_routing_outcomes (
          organization_id, session_id, provider_message_id,
          ingress_sequence, completed_inbox_event_key
        ) values (
          v_route.organization_id, v_route.session_id,
          v_route.provider_message_id, v_route.ingress_sequence,
          v_route.inbox_event_key
        ) on conflict (organization_id, session_id, provider_message_id)
          do nothing;
      end loop;
      update public.whatsapp_webhook_inbox as inbox
      set payload = v_payload,
          status = case when v_plan->>'terminal' = 'true'
                         and inbox.status in ('pending', 'retry')
            then 'dead' else inbox.status end,
          dead_lettered_at = case when v_plan->>'terminal' = 'true'
                                 and inbox.status in ('pending', 'retry', 'dead')
            then coalesce(inbox.dead_lettered_at, pg_catalog.clock_timestamp())
            else inbox.dead_lettered_at end,
          last_error = case when v_plan->>'terminal' = 'true'
                            and inbox.status in ('pending', 'retry', 'dead')
            then 'expired_unlinked_epoch_terminalized'
            else inbox.last_error end,
          updated_at = pg_catalog.clock_timestamp()
      where inbox.id = v_inbox.id;
      v_partial_count := v_partial_count + 1;
      if v_plan->>'terminal' = 'true' then
        v_partial_terminal := v_partial_terminal + 1;
        if v_inbox.status in ('pending', 'retry') then
          v_new_terminal := v_new_terminal + 1;
        end if;
      end if;
      exit when v_partial_count +
        coalesce((v_exclusive->>'inbox_scrubbed')::integer, 0) >= p_limit;
    end loop;
    exit when v_partial_count +
      coalesce((v_exclusive->>'inbox_scrubbed')::integer, 0) >= p_limit;
  end loop;
  return v_exclusive || pg_catalog.jsonb_build_object(
    'inbox_scrubbed', coalesce((v_exclusive->>'inbox_scrubbed')::integer, 0)
                       + v_partial_count,
    'inbox_partial', v_partial_count - v_partial_terminal,
    'inbox_terminal', coalesce((v_exclusive->>'inbox_terminal')::integer, 0)
                      + v_partial_terminal,
    'inbox_newly_terminalized',
      coalesce((v_exclusive->>'inbox_newly_terminalized')::integer, 0)
      + v_new_terminal
  );
end;
$$;
revoke all on function private.scrub_expired_whatsapp_unlinked_inbox(integer)
  from public, anon, authenticated;
grant execute on function private.scrub_expired_whatsapp_unlinked_inbox(integer)
  to service_role;

commit;
