-- Resend can deliver a signed webhook before the API caller persists the
-- provider message id. Keep the webhook as an orphan, link it when the id
-- becomes available, and replay all events through one monotonic state machine.
alter table public.email_logs
  add column if not exists status_event_at timestamptz;

alter table public.email_delivery_events
  add column if not exists reconciled_at timestamptz;

create index if not exists email_delivery_events_reconcile_order_idx
  on public.email_delivery_events (
    provider,
    provider_message_id,
    occurred_at,
    created_at,
    provider_event_id
  );

-- Rows updated by the previous webhook implementation already have
-- last_event_at. Preserve that causal timestamp when upgrading in place.
update public.email_logs
set status_event_at = coalesce(last_event_at, delivered_at)
where status_event_at is null
  and (last_event_at is not null or delivered_at is not null);

create or replace function private.resend_email_event_status(p_event_type text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case lower(btrim(p_event_type))
    when 'email.sent' then 'accepted'
    when 'email.delivery_delayed' then 'delayed'
    when 'email.delivered' then 'delivered'
    when 'email.failed' then 'failed'
    when 'email.suppressed' then 'suppressed'
    when 'email.bounced' then 'bounced'
    when 'email.complained' then 'complained'
    else null
  end;
$$;

create or replace function private.resend_email_status_rank(p_status text)
returns integer
language sql
immutable
parallel safe
set search_path = ''
as $$
  -- A confirmed delivery cannot be downgraded by a contradictory late
  -- failed/suppressed/bounced event. A complaint is a post-delivery escalation
  -- and therefore remains the only provider state above delivered.
  select case lower(btrim(p_status))
    when 'processing' then 10
    when 'accepted' then 20
    when 'sent' then 20
    when 'delayed' then 30
    when 'failed' then 50
    when 'suppressed' then 60
    when 'bounced' then 70
    when 'delivered' then 90
    when 'complained' then 100
    else 0
  end;
$$;

create or replace function private.reconcile_resend_email_events_for_log(
  p_email_log_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organization_id uuid;
  v_user_id uuid;
  v_provider_message_id text;
  v_current_status text;
  v_current_error text;
  v_current_status_event_at timestamptz;
  v_current_delivered_at timestamptz;
  v_current_last_event_at timestamptz;
  v_current_rank integer;
  v_candidate_status text;
  v_candidate_rank integer;
  v_candidate_error text;
  v_event record;
begin
  select
    logs.organization_id,
    logs.user_id,
    logs.provider_message_id,
    logs.status,
    logs.error_message,
    logs.status_event_at,
    logs.delivered_at,
    logs.last_event_at
    into
      v_organization_id,
      v_user_id,
      v_provider_message_id,
      v_current_status,
      v_current_error,
      v_current_status_event_at,
      v_current_delivered_at,
      v_current_last_event_at
  from public.email_logs logs
  where logs.id = p_email_log_id
    and logs.provider = 'resend'
    and nullif(btrim(logs.provider_message_id), '') is not null
  for update;

  if not found then
    return false;
  end if;

  update public.email_delivery_events events
  set email_log_id = p_email_log_id,
      organization_id = v_organization_id,
      user_id = v_user_id,
      reconciled_at = now()
  where events.provider = 'resend'
    and events.provider_message_id = v_provider_message_id;

  -- A local HTTP failure also uses the text `failed`, but has no provider
  -- event timestamp. It must remain retryable and must not outrank a later
  -- verified provider event.
  v_current_rank := case
    when v_current_status_event_at is null then 0
    else private.resend_email_status_rank(v_current_status)
  end;

  for v_event in
    select
      events.event_type,
      events.occurred_at,
      events.payload,
      events.provider_event_id,
      events.created_at
    from public.email_delivery_events events
    where events.provider = 'resend'
      and events.provider_message_id = v_provider_message_id
    order by
      events.occurred_at asc,
      events.created_at asc,
      events.provider_event_id asc
  loop
    v_current_last_event_at := greatest(
      coalesce(v_current_last_event_at, '-infinity'::timestamptz),
      v_event.occurred_at
    );

    if v_event.event_type = 'email.delivered' then
      v_current_delivered_at := case
        when v_current_delivered_at is null then v_event.occurred_at
        else least(v_current_delivered_at, v_event.occurred_at)
      end;
    end if;

    v_candidate_status := private.resend_email_event_status(v_event.event_type);
    if v_candidate_status is null then
      continue;
    end if;

    v_candidate_rank := private.resend_email_status_rank(v_candidate_status);
    if v_candidate_rank > v_current_rank
       or (
         v_candidate_rank = v_current_rank
         and v_event.occurred_at >= coalesce(v_current_status_event_at, '-infinity'::timestamptz)
       ) then
      v_current_status := v_candidate_status;
      v_current_status_event_at := v_event.occurred_at;
      v_current_rank := v_candidate_rank;

      if v_candidate_status in ('failed', 'suppressed', 'bounced', 'complained') then
        v_candidate_error := coalesce(
          v_event.payload #>> '{bounce,message}',
          v_event.payload #>> '{failed,reason}',
          v_event.payload #>> '{suppressed,message}',
          v_event.payload #>> '{complaint,message}',
          v_event.event_type
        );
        v_current_error := nullif(left(v_candidate_error, 1000), '');
      else
        v_current_error := null;
      end if;
    end if;
  end loop;

  update public.email_logs
  set status = v_current_status,
      error_message = v_current_error,
      status_event_at = v_current_status_event_at,
      delivered_at = v_current_delivered_at,
      last_event_at = nullif(v_current_last_event_at, '-infinity'::timestamptz),
      updated_at = now()
  where id = p_email_log_id;

  return true;
end;
$$;

create or replace function private.reconcile_resend_email_events_after_log()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.provider = 'resend'
     and nullif(btrim(new.provider_message_id), '') is not null then
    perform private.reconcile_resend_email_events_for_log(new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists reconcile_resend_email_events_after_log
  on public.email_logs;
create trigger reconcile_resend_email_events_after_log
after insert or update of provider, provider_message_id, organization_id, user_id
on public.email_logs
for each row
execute function private.reconcile_resend_email_events_after_log();

create or replace function public.record_resend_email_event(
  p_provider_event_id text,
  p_provider_message_id text,
  p_event_type text,
  p_occurred_at timestamptz,
  p_payload jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_provider_event_id text;
  v_provider_message_id text;
  v_event_type text;
  v_email_log_id uuid;
  v_organization_id uuid;
  v_user_id uuid;
  v_event_id uuid;
begin
  if nullif(btrim(p_provider_event_id), '') is null
     or nullif(btrim(p_provider_message_id), '') is null
     or p_event_type not like 'email.%'
     or jsonb_typeof(coalesce(p_payload, '{}'::jsonb)) <> 'object' then
    raise exception 'invalid Resend email event';
  end if;

  v_provider_event_id := left(btrim(p_provider_event_id), 255);
  v_provider_message_id := left(btrim(p_provider_message_id), 255);
  v_event_type := left(btrim(p_event_type), 80);

  -- The API worker takes the same message-scoped lock before attaching the
  -- provider id to email_logs. Serializing both sides closes the commit-order
  -- race where each transaction could otherwise miss the other's new row.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('resend:' || v_provider_message_id, 0)
  );

  select logs.id, logs.organization_id, logs.user_id
    into v_email_log_id, v_organization_id, v_user_id
  from public.email_logs logs
  where logs.provider = 'resend'
    and logs.provider_message_id = v_provider_message_id
  limit 1
  for update;

  insert into public.email_delivery_events (
    email_log_id,
    organization_id,
    user_id,
    provider,
    provider_event_id,
    provider_message_id,
    event_type,
    occurred_at,
    payload,
    reconciled_at
  )
  values (
    v_email_log_id,
    v_organization_id,
    v_user_id,
    'resend',
    v_provider_event_id,
    v_provider_message_id,
    v_event_type,
    coalesce(p_occurred_at, now()),
    coalesce(p_payload, '{}'::jsonb),
    case when v_email_log_id is not null then now() else null end
  )
  on conflict (provider, provider_event_id) do nothing
  returning id into v_event_id;

  if v_email_log_id is not null then
    perform private.reconcile_resend_email_events_for_log(v_email_log_id);
  end if;

  return v_event_id is not null;
end;
$$;

-- Link and replay both historical orphan events and rows processed by the
-- former arrival-order implementation. Re-running this block is harmless.
do $$
declare
  v_email_log_id uuid;
begin
  for v_email_log_id in
    select logs.id
    from public.email_logs logs
    where logs.provider = 'resend'
      and nullif(btrim(logs.provider_message_id), '') is not null
  loop
    perform private.reconcile_resend_email_events_for_log(v_email_log_id);
  end loop;
end;
$$;

revoke all on function private.resend_email_event_status(text)
  from public, anon, authenticated, service_role;
revoke all on function private.resend_email_status_rank(text)
  from public, anon, authenticated, service_role;
revoke all on function private.reconcile_resend_email_events_for_log(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.reconcile_resend_email_events_after_log()
  from public, anon, authenticated, service_role;

revoke all on function public.record_resend_email_event(text, text, text, timestamptz, jsonb)
  from public, anon, authenticated;
grant execute on function public.record_resend_email_event(text, text, text, timestamptz, jsonb)
  to service_role;

alter table public.email_delivery_events enable row level security;
revoke all on table public.email_delivery_events
  from public, anon, authenticated, service_role;
grant select on table public.email_delivery_events to service_role;
