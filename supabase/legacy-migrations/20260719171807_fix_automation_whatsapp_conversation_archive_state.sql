begin;

do $contract$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'whatsapp_conversations'
      and column_name = 'archived_at'
      and data_type = 'timestamp with time zone'
  ) then
    raise exception using
      errcode = '55000',
      message = 'resolve_automation_whatsapp_conversation requires public.whatsapp_conversations.archived_at';
  end if;
end
$contract$;

create or replace function public.resolve_automation_whatsapp_conversation(
  p_organization_id uuid,
  p_execution_id uuid,
  p_node_key text,
  p_lease_token text,
  p_session_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_lead_id uuid;
  preferred_conversation_id uuid;
  existing_conversation_id uuid;
  target_name text;
  raw_phone text;
  phone_digits text;
  canonical_phone text;
  canonical_jid text;
begin
  select e.lead_id, e.conversation_id, l.name, nullif(l.phone, '')
  into target_lead_id, preferred_conversation_id, target_name, raw_phone
  from public.automation_executions e
  join public.leads l
    on l.id = e.lead_id and l.organization_id = e.organization_id
  join public.whatsapp_sessions ws
    on ws.id = p_session_id and ws.organization_id = e.organization_id
   and ws.status = 'connected'
   and coalesce(ws.is_active, true)
   and coalesce(ws.provider, 'evolution_go') = 'evolution_go'
  where e.id = p_execution_id
    and e.organization_id = p_organization_id
    and e.current_node_key = p_node_key
    and e.status = 'running'
    and e.locked_by = p_lease_token
    and e.cancellation_requested_at is null
  for update of e;

  if target_lead_id is null then
    return jsonb_build_object('ok', false, 'status', 'execution_session_or_lead_unavailable');
  end if;

  phone_digits := regexp_replace(coalesce(raw_phone, ''), '[^0-9]', '', 'g');
  if length(phone_digits) between 10 and 15 then
    canonical_phone := case
      when left(phone_digits, 2) = '55' then phone_digits
      when length(phone_digits) in (10, 11) then '55' || phone_digits
      else phone_digits
    end;
    canonical_jid := canonical_phone || '@s.whatsapp.net';
  end if;

  select wc.id
  into existing_conversation_id
  from public.whatsapp_conversations wc
  where wc.organization_id = p_organization_id
    and wc.lead_id = target_lead_id
    and wc.session_id = p_session_id
    and wc.deleted_at is null
    and coalesce(wc.is_group, false) = false
  order by case when wc.id = preferred_conversation_id then 0 else 1 end,
           wc.last_message_at desc nulls last, wc.created_at desc, wc.id
  limit 1
  for update;

  if existing_conversation_id is null then
    if canonical_jid is null then
      return jsonb_build_object('ok', false, 'status', 'lead_has_no_valid_whatsapp_phone');
    end if;

    insert into public.whatsapp_conversations (
      organization_id, session_id, lead_id, assigned_user_id, remote_jid,
      contact_name, contact_phone, is_group, unread_count, metadata
    )
    select
      p_organization_id, p_session_id, target_lead_id, l.assigned_user_id,
      canonical_jid, coalesce(nullif(target_name, ''), canonical_phone),
      canonical_phone, false, 0,
      jsonb_build_object('origin', 'automation', 'execution_id', p_execution_id)
    from public.leads l
    where l.id = target_lead_id and l.organization_id = p_organization_id
    on conflict (organization_id, session_id, remote_jid) do update
      set lead_id = coalesce(public.whatsapp_conversations.lead_id, excluded.lead_id),
          contact_name = coalesce(nullif(public.whatsapp_conversations.contact_name, ''), excluded.contact_name),
          contact_phone = coalesce(nullif(public.whatsapp_conversations.contact_phone, ''), excluded.contact_phone),
          deleted_at = null,
          archived_at = null,
          updated_at = now()
    returning id into existing_conversation_id;

    if not exists (
      select 1
      from public.whatsapp_conversations wc
      where wc.id = existing_conversation_id
        and wc.organization_id = p_organization_id
        and wc.lead_id = target_lead_id
        and wc.session_id = p_session_id
    ) then
      raise exception 'whatsapp_identity_belongs_to_another_lead';
    end if;
  end if;

  insert into public.whatsapp_contact_identity_aliases (
    organization_id, session_id, alias_jid, canonical_jid,
    contact_phone, lead_id, is_group, last_seen_at, metadata
  )
  select
    wc.organization_id, wc.session_id, wc.remote_jid, coalesce(canonical_jid, wc.remote_jid),
    coalesce(canonical_phone, wc.contact_phone), wc.lead_id, false, now(),
    jsonb_build_object('origin', 'automation', 'execution_id', p_execution_id)
  from public.whatsapp_conversations wc
  where wc.id = existing_conversation_id
  on conflict (organization_id, session_id, alias_jid) do update
    set canonical_jid = case
          when public.whatsapp_contact_identity_aliases.canonical_jid like '%@s.whatsapp.net'
            then public.whatsapp_contact_identity_aliases.canonical_jid
          else excluded.canonical_jid
        end,
        contact_phone = coalesce(excluded.contact_phone, public.whatsapp_contact_identity_aliases.contact_phone),
        lead_id = coalesce(excluded.lead_id, public.whatsapp_contact_identity_aliases.lead_id),
        last_seen_at = now(),
        metadata = public.whatsapp_contact_identity_aliases.metadata || excluded.metadata;

  update public.automation_executions e
  set conversation_id = existing_conversation_id,
      updated_at = now()
  where e.id = p_execution_id
    and e.organization_id = p_organization_id
    and e.status = 'running'
    and e.locked_by = p_lease_token;

  return (
    select jsonb_build_object(
      'ok', true,
      'status', 'resolved',
      'id', wc.id,
      'session_id', wc.session_id,
      'lead_id', wc.lead_id,
      'remote_jid', coalesce((
        select alias.canonical_jid
        from public.whatsapp_contact_identity_aliases alias
        where alias.organization_id = wc.organization_id
          and alias.session_id = wc.session_id
          and alias.alias_jid = wc.remote_jid
          and alias.canonical_jid like '%@s.whatsapp.net'
        order by alias.last_seen_at desc
        limit 1
      ), wc.remote_jid),
      'is_group', wc.is_group
    )
    from public.whatsapp_conversations wc
    where wc.id = existing_conversation_id
  );
end;
$$;

revoke execute on function public.resolve_automation_whatsapp_conversation(
  uuid, uuid, text, text, uuid
) from public, anon, authenticated;

grant execute on function public.resolve_automation_whatsapp_conversation(
  uuid, uuid, text, text, uuid
) to service_role;

commit;
