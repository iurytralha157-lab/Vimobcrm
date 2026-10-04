begin;
set local lock_timeout = '5s';
set local statement_timeout = '1min';

-- The baseline owner UPDATE policy also permits changes to status. Keep
-- connection state and lifecycle intent under the Go API / service role so a
-- browser token cannot manufacture or suppress a paid disconnect notice.
create or replace function private.guard_whatsapp_session_server_state()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if current_user in ('anon', 'authenticated')
       and (
         new.status is distinct from 'disconnected'
         or nullif(new.advanced_settings ->> 'lifecycle_operation', '') is not null
       ) then
      raise exception using
        errcode = '42501',
        message = 'WhatsApp connection state must be changed through the server';
    end if;

    return new;
  end if;

  if current_user in ('anon', 'authenticated')
     and (
       new.status is distinct from old.status
       or (new.advanced_settings ->> 'lifecycle_operation')
          is distinct from (old.advanced_settings ->> 'lifecycle_operation')
     ) then
    raise exception using
      errcode = '42501',
      message = 'WhatsApp connection state must be changed through the server';
  end if;

  return new;
end;
$$;

revoke all on function private.guard_whatsapp_session_server_state()
  from public, anon, authenticated, service_role;

drop trigger if exists zzz_guard_whatsapp_session_server_state
  on public.whatsapp_sessions;
create trigger zzz_guard_whatsapp_session_server_state
before insert or update on public.whatsapp_sessions
for each row execute function private.guard_whatsapp_session_server_state();

-- The normalized delivery worker trusts notifications.metadata.event_key.
-- The 20260803223939 migration already revoked browser writes to this table;
-- keep this event-specific fence in case an environment has permission drift.
create or replace function private.guard_whatsapp_disconnected_notification_source()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;

  if pg_catalog.lower(pg_catalog.btrim(coalesce(new.metadata ->> 'event_key', '')))
       = 'whatsapp_disconnected' then
    raise exception using
      errcode = '42501',
      message = 'WhatsApp disconnect notices must be created by the server';
  end if;

  if tg_op = 'UPDATE' then
    if pg_catalog.lower(pg_catalog.btrim(coalesce(old.metadata ->> 'event_key', '')))
         = 'whatsapp_disconnected' then
      raise exception using
        errcode = '42501',
        message = 'WhatsApp disconnect notices must be changed by the server';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function private.guard_whatsapp_disconnected_notification_source()
  from public, anon, authenticated, service_role;

drop trigger if exists zzz_guard_whatsapp_disconnected_notification_source
  on public.notifications;
create trigger zzz_guard_whatsapp_disconnected_notification_source
before insert or update of metadata, user_id, organization_id, title, content, body
on public.notifications
for each row execute function private.guard_whatsapp_disconnected_notification_source();

-- The notification is inserted in the same transaction that records the
-- disconnection. Both webhook and health-check writers use this one producer.
create or replace function private.notify_whatsapp_session_owner_disconnected()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_episode text;
  v_dedupe_key text;
  v_session_name text;
begin
  if new.status is distinct from 'disconnected'
     or old.status is not distinct from new.status
     or new.owner_user_id is null
     or nullif(new.advanced_settings ->> 'lifecycle_operation', '') is not null
     or (old.status is distinct from 'connected'
         and new.last_connected_at is null) then
    return new;
  end if;

  if not exists (
    select 1
    from public.organization_members member
    join public.users account on account.id = member.user_id
    where member.organization_id = new.organization_id
      and member.user_id = new.owner_user_id
      and member.is_active = true
      and member.deleted_at is null
      and coalesce(account.is_active, false) = true
  ) then
    return new;
  end if;

  -- The last successful connection identifies the disconnect episode across
  -- health checks and retries; updated_at changes during unrelated writes.
  v_episode := pg_catalog.to_jsonb(coalesce(
    old.last_connected_at, old.created_at
  )) #>> '{}';
  v_dedupe_key := 'whatsapp_disconnected:' || new.id::text || ':' ||
    new.owner_user_id::text || ':' || v_episode;
  v_session_name := coalesce(
    nullif(pg_catalog.btrim(new.display_name), ''),
    nullif(pg_catalog.btrim(new.instance_name), ''),
    'WhatsApp'
  );

  insert into public.notifications (
    organization_id, user_id, type, title, content, is_read, metadata
  ) values (
    new.organization_id,
    new.owner_user_id,
    'whatsapp',
    'WhatsApp desconectado',
    v_session_name || ' foi desconectado. Conecte novamente para enviar mensagens.',
    false,
    pg_catalog.jsonb_build_object(
      'event_key', 'whatsapp_disconnected',
      'dedupe_key', v_dedupe_key,
      'variables', pg_catalog.jsonb_build_object(
        'nome_sessao', v_session_name,
        'session_name', v_session_name,
        'disconnect_episode', v_episode
      ),
      'whatsapp_dispatch_required', true,
      'whatsapp_dispatch', pg_catalog.jsonb_build_object('status', 'pending'),
      'dispatch', pg_catalog.jsonb_build_object(
        'whatsapp', pg_catalog.jsonb_build_object(
          'required', true,
          'status', 'pending'
        )
      )
    )
  ) on conflict do nothing;

  return new;
end;
$$;

revoke all on function private.notify_whatsapp_session_owner_disconnected()
  from public, anon, authenticated, service_role;

drop trigger if exists trg_notify_whatsapp_session_owner_disconnected
  on public.whatsapp_sessions;
create trigger trg_notify_whatsapp_session_owner_disconnected
after update of status on public.whatsapp_sessions
for each row execute function private.notify_whatsapp_session_owner_disconnected();

commit;
