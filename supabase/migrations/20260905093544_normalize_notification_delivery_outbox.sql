-- Normalize external notification delivery into a durable, backend-owned
-- outbox. This migration deliberately does not start a worker. Historical
-- retryable rows are materialized as blocked_dependency and require an
-- explicit, audited cutover/replay before they can be sent.

create table if not exists private.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null
    references public.notifications (id) on delete cascade,
  organization_id uuid not null
    references public.organizations (id) on delete cascade,
  user_id uuid
    references public.users (id) on delete set null,
  channel text not null,
  recipient_key text not null,
  push_token_id uuid
    references public.push_tokens (id) on delete set null,
  idempotency_key text not null,
  status text not null default 'queued',
  priority smallint not null default 100,
  attempt_count integer not null default 0,
  max_attempts integer not null default 24,
  next_attempt_at timestamptz,
  expires_at timestamptz not null,
  lease_token uuid,
  leased_by text,
  lease_expires_at timestamptz,
  dependency_key text,
  provider text,
  provider_message_id text,
  provider_status text,
  accepted_at timestamptz,
  delivered_at timestamptz,
  blocked_at timestamptz,
  terminal_at timestamptz,
  last_error_code text,
  last_error_message text,
  last_error_at timestamptz,
  last_attempt_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notification_deliveries_channel_check
    check (channel in ('whatsapp', 'push', 'email')),
  constraint notification_deliveries_status_check
    check (status in (
      'queued',
      'leased',
      'sending',
      'accepted',
      'delivered',
      'retry_wait',
      'blocked_dependency',
      'dead_letter',
      'cancelled',
      'permanent_failed'
    )),
  constraint notification_deliveries_recipient_key_check
    check (
      nullif(btrim(recipient_key), '') is not null
      and char_length(recipient_key) <= 255
    ),
  constraint notification_deliveries_idempotency_key_check
    check (
      nullif(btrim(idempotency_key), '') is not null
      and char_length(idempotency_key) <= 255
    ),
  constraint notification_deliveries_priority_check
    check (priority between 0 and 1000),
  constraint notification_deliveries_attempt_budget_check
    check (
      attempt_count >= 0
      and max_attempts between 1 and 100
      and attempt_count <= max_attempts
    ),
  constraint notification_deliveries_expiry_check
    check (expires_at >= created_at),
  constraint notification_deliveries_lease_check
    check (
      (
        status in ('leased', 'sending')
        and lease_token is not null
        and nullif(btrim(leased_by), '') is not null
        and lease_expires_at is not null
      )
      or (
        status not in ('leased', 'sending')
        and lease_token is null
        and leased_by is null
        and lease_expires_at is null
      )
    ),
  constraint notification_deliveries_dependency_check
    check (
      (status = 'blocked_dependency' and nullif(btrim(dependency_key), '') is not null)
      or (status <> 'blocked_dependency' and dependency_key is null)
    ),
  constraint notification_deliveries_schedule_check
    check (
      (status in ('queued', 'retry_wait') and next_attempt_at is not null)
      or (status not in ('queued', 'retry_wait') and next_attempt_at is null)
    ),
  constraint notification_deliveries_blocked_at_check
    check (
      (status = 'blocked_dependency' and blocked_at is not null)
      or (status <> 'blocked_dependency' and blocked_at is null)
    ),
  constraint notification_deliveries_push_target_check
    check (
      (channel = 'push' and push_token_id is not null)
      or (channel <> 'push' and push_token_id is null)
    ),
  constraint notification_deliveries_terminal_at_check
    check (
      (
        status in ('delivered', 'dead_letter', 'cancelled', 'permanent_failed')
        and terminal_at is not null
      )
      or (
        status not in ('delivered', 'dead_letter', 'cancelled', 'permanent_failed')
        and terminal_at is null
      )
    ),
  constraint notification_deliveries_provider_fields_check
    check (
      (provider is null or char_length(provider) <= 100)
      and (provider_message_id is null or char_length(provider_message_id) <= 500)
      and (provider_status is null or char_length(provider_status) <= 255)
      and (leased_by is null or char_length(leased_by) <= 255)
      and (dependency_key is null or char_length(dependency_key) <= 255)
      and (last_error_code is null or char_length(last_error_code) <= 255)
      and (last_error_message is null or char_length(last_error_message) <= 2000)
    ),
  constraint notification_deliveries_metadata_object_check
    check (jsonb_typeof(metadata) = 'object'),
  constraint notification_deliveries_notification_recipient_unique
    unique (notification_id, channel, recipient_key),
  constraint notification_deliveries_idempotency_unique
    unique (idempotency_key)
);

comment on table private.notification_deliveries is
  'Durable backend-owned delivery jobs. One logical delivery per notification, channel and non-PII recipient key.';

create table if not exists private.notification_delivery_attempts (
  id uuid primary key default gen_random_uuid(),
  delivery_id uuid not null
    references private.notification_deliveries (id) on delete cascade,
  event_type text not null default 'send_attempt',
  attempt_number integer,
  lease_token uuid,
  worker_id text,
  from_status text,
  outcome text not null,
  provider text,
  provider_message_id text,
  provider_status text,
  started_at timestamptz,
  completed_at timestamptz,
  error_code text,
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint notification_delivery_attempts_event_type_check
    check (event_type in ('send_attempt', 'replay', 'receipt', 'sweep', 'unblock')),
  constraint notification_delivery_attempts_attempt_number_check
    check (
      (event_type = 'send_attempt' and attempt_number is not null and attempt_number > 0)
      or (event_type <> 'send_attempt' and attempt_number is null)
    ),
  constraint notification_delivery_attempts_outcome_check
    check (outcome in (
      'sending',
      'accepted',
      'delivered',
      'retry_wait',
      'blocked_dependency',
      'dead_letter',
      'cancelled',
      'permanent_failed',
      'replayed',
      'unblocked'
    )),
  constraint notification_delivery_attempts_status_check
    check (
      (from_status is null or from_status in (
        'queued', 'leased', 'sending', 'accepted', 'delivered',
        'retry_wait', 'blocked_dependency', 'dead_letter', 'cancelled',
        'permanent_failed'
      ))
    ),
  constraint notification_delivery_attempts_metadata_object_check
    check (jsonb_typeof(metadata) = 'object')
);

comment on table private.notification_delivery_attempts is
  'Append-oriented state and provider-attempt ledger for notification deliveries.';

create unique index if not exists notification_delivery_attempts_number_uidx
  on private.notification_delivery_attempts (delivery_id, attempt_number)
  where event_type = 'send_attempt';

create unique index if not exists notification_delivery_attempts_lease_uidx
  on private.notification_delivery_attempts (delivery_id, lease_token)
  where event_type = 'send_attempt' and lease_token is not null;

create index if not exists notification_deliveries_due_idx
  on private.notification_deliveries (
    priority desc,
    next_attempt_at,
    created_at,
    id
  )
  where status in ('queued', 'retry_wait');

create index if not exists notification_deliveries_expired_lease_idx
  on private.notification_deliveries (lease_expires_at, id)
  where status in ('leased', 'sending');

create index if not exists notification_deliveries_accepted_reconcile_idx
  on private.notification_deliveries (accepted_at, id)
  where status = 'accepted';

create index if not exists notification_deliveries_blocked_dependency_idx
  on private.notification_deliveries (
    organization_id,
    dependency_key,
    channel,
    blocked_at,
    id
  )
  where status = 'blocked_dependency';

create index if not exists notification_deliveries_notification_idx
  on private.notification_deliveries (notification_id, channel);

create index if not exists notification_deliveries_push_token_idx
  on private.notification_deliveries (push_token_id, status)
  where push_token_id is not null;

create index if not exists notification_deliveries_provider_message_idx
  on private.notification_deliveries (provider, provider_message_id)
  where provider is not null and provider_message_id is not null;

create index if not exists notification_delivery_attempts_delivery_created_idx
  on private.notification_delivery_attempts (delivery_id, created_at desc, id);

alter table private.notification_deliveries enable row level security;
alter table private.notification_delivery_attempts enable row level security;

revoke all privileges on table private.notification_deliveries
  from PUBLIC, anon, authenticated, service_role;
revoke all privileges on table private.notification_delivery_attempts
  from PUBLIC, anon, authenticated, service_role;

grant usage on schema private to service_role;

create or replace function private.notification_safe_integer(
  p_value text,
  p_default integer,
  p_minimum integer,
  p_maximum integer
)
returns integer
language plpgsql
immutable
parallel safe
set search_path = ''
as $function$
declare
  v_value numeric;
begin
  if nullif(btrim(coalesce(p_value, '')), '') is null then
    return least(greatest(p_default, p_minimum), p_maximum);
  end if;

  begin
    v_value := btrim(p_value)::numeric;
  exception
    when invalid_text_representation or numeric_value_out_of_range then
      return least(greatest(p_default, p_minimum), p_maximum);
  end;

  if trunc(v_value) <> v_value then
    return least(greatest(p_default, p_minimum), p_maximum);
  end if;

  return least(greatest(v_value::integer, p_minimum), p_maximum);
exception
  when numeric_value_out_of_range then
    return least(greatest(p_default, p_minimum), p_maximum);
end
$function$;

create or replace function private.notification_safe_timestamptz(p_value text)
returns timestamptz
language plpgsql
stable
parallel safe
set search_path = ''
as $function$
begin
  if nullif(btrim(coalesce(p_value, '')), '') is null then
    return null;
  end if;

  begin
    return btrim(p_value)::timestamptz;
  exception
    when invalid_datetime_format or datetime_field_overflow then
      return null;
  end;
end
$function$;

create or replace function private.notification_dispatch_required(p_value jsonb)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $function$
  select lower(coalesce(p_value #>> '{}', 'false')) in ('true', '1', 'yes', 'on');
$function$;

create or replace function private.notification_delivery_retry_delay(
  p_attempt_count integer
)
returns interval
language sql
immutable
parallel safe
set search_path = ''
as $function$
  select pg_catalog.make_interval(
    secs => least(
      3600,
      (30 * power(2::numeric, least(greatest(coalesce(p_attempt_count, 1) - 1, 0), 7)))::integer
    )
  );
$function$;

create or replace function private.notification_delivery_expected_message_id(
  p_idempotency_key text
)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $function$
  select upper(substr(
    pg_catalog.encode(
      extensions.digest(coalesce(p_idempotency_key, ''), 'sha256'),
      'hex'
    ),
    1,
    32
  ));
$function$;

create or replace function private.notification_delivery_idempotency_key(
  p_organization_id uuid,
  p_notification_id uuid,
  p_source_dedupe_key text,
  p_channel text,
  p_recipient_key text
)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $function$
  select 'notification-delivery:v1:' || pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        p_organization_id::text || '|' ||
        coalesce(nullif(btrim(p_source_dedupe_key), ''), 'notification:' || p_notification_id::text) || '|' ||
        lower(btrim(p_channel)) || '|' ||
        btrim(p_recipient_key),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
$function$;

create or replace function private.notification_delivery_expiry(
  p_created_at timestamptz,
  p_metadata jsonb,
  p_channel_metadata jsonb
)
returns timestamptz
language plpgsql
stable
set search_path = ''
as $function$
declare
  v_event_key text := lower(btrim(coalesce(p_metadata ->> 'event_key', '')));
  v_explicit timestamptz;
  v_schedule_time timestamptz;
begin
  v_explicit := coalesce(
    private.notification_safe_timestamptz(p_channel_metadata ->> 'expires_at'),
    private.notification_safe_timestamptz(p_metadata ->> 'expires_at')
  );
  if v_explicit is not null then
    return greatest(v_explicit, p_created_at);
  end if;

  if v_event_key in ('schedule_reminder', 'appointment_reminder') then
    v_schedule_time := coalesce(
      private.notification_safe_timestamptz(p_metadata ->> 'start_time'),
      private.notification_safe_timestamptz(p_metadata ->> 'reminder_due_at'),
      private.notification_safe_timestamptz(p_metadata #>> '{variables,start_time}'),
      private.notification_safe_timestamptz(p_metadata #>> '{variables,reminder_due_at}')
    );
    return greatest(
      p_created_at,
      coalesce(v_schedule_time + interval '15 minutes', p_created_at + interval '6 hours')
    );
  end if;

  if v_event_key in (
    'new_lead_received', 'lead_reentry', 'lead_duplicate_existing',
    'lead_transferred', 'lead_stage_changed', 'deal_won',
    'lead_auto_redistributed', 'lead_auto_redistribution_failed'
  ) or v_event_key like 'billing_%'
    or v_event_key like 'onboarding_%' then
    return p_created_at + interval '7 days';
  end if;

  if v_event_key in (
    'update_phone_reminder', 'gamification_update', 'announcement',
    'whatsapp_disconnected'
  ) then
    return p_created_at + interval '1 day';
  end if;

  return p_created_at + interval '3 days';
end
$function$;

revoke all on function private.notification_safe_integer(text, integer, integer, integer)
  from PUBLIC, anon, authenticated, service_role;
revoke all on function private.notification_safe_timestamptz(text)
  from PUBLIC, anon, authenticated, service_role;
revoke all on function private.notification_dispatch_required(jsonb)
  from PUBLIC, anon, authenticated, service_role;
revoke all on function private.notification_delivery_retry_delay(integer)
  from PUBLIC, anon, authenticated, service_role;
revoke all on function private.notification_delivery_expected_message_id(text)
  from PUBLIC, anon, authenticated, service_role;
revoke all on function private.notification_delivery_idempotency_key(uuid, uuid, text, text, text)
  from PUBLIC, anon, authenticated, service_role;
revoke all on function private.notification_delivery_expiry(timestamptz, jsonb, jsonb)
  from PUBLIC, anon, authenticated, service_role;

create or replace function private.materialize_notification_deliveries(
  p_notification_id uuid,
  p_backfill boolean default false
)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_notification public.notifications%rowtype;
  v_channel text;
  v_channel_metadata jsonb;
  v_required boolean;
  v_legacy_status text;
  v_status text;
  v_dependency_key text;
  v_recipient_key text;
  v_push_token_id uuid;
  v_source_dedupe_key text;
  v_idempotency_key text;
  v_attempt_count integer;
  v_max_attempts integer;
  v_priority integer;
  v_next_attempt_at timestamptz;
  v_expires_at timestamptz;
  v_provider text;
  v_provider_message_id text;
  v_accepted_at timestamptz;
  v_delivered_at timestamptz;
  v_terminal_at timestamptz;
  v_inserted integer := 0;
  v_affected integer := 0;
begin
  if p_notification_id is null then
    return 0;
  end if;

  select notification.*
    into v_notification
  from public.notifications as notification
  where notification.id = p_notification_id;

  if not found then
    return 0;
  end if;

  v_source_dedupe_key := nullif(btrim(v_notification.metadata ->> 'dedupe_key'), '');

  foreach v_channel in array array['whatsapp'::text, 'email'::text, 'push'::text]
  loop
    v_channel_metadata := case
      when v_channel = 'whatsapp' then coalesce(
        v_notification.metadata #> '{dispatch,whatsapp}',
        v_notification.metadata -> 'whatsapp_dispatch',
        '{}'::jsonb
      )
      else coalesce(
        v_notification.metadata #> array['dispatch', v_channel],
        '{}'::jsonb
      )
    end;

    v_required := private.notification_dispatch_required(
      v_channel_metadata -> 'required'
    );
    if v_channel = 'whatsapp' then
      v_required := v_required
        or private.notification_dispatch_required(
          v_notification.metadata -> 'whatsapp_dispatch_required'
        );
    end if;

    if not v_required then
      update private.notification_deliveries as delivery
      set status = 'cancelled',
          next_attempt_at = null,
          lease_token = null,
          leased_by = null,
          lease_expires_at = null,
          dependency_key = null,
          terminal_at = now(),
          last_error_code = 'delivery_not_required',
          last_error_message = 'Delivery requirement was removed from the notification.',
          last_error_at = now(),
          updated_at = now()
      where delivery.notification_id = v_notification.id
        and delivery.channel = v_channel
        and delivery.status in (
          'queued', 'leased', 'sending', 'retry_wait', 'blocked_dependency'
        );
      continue;
    end if;

    v_legacy_status := lower(btrim(coalesce(
      v_channel_metadata ->> 'status',
      case
        when v_channel = 'whatsapp'
          then v_notification.metadata #>> '{whatsapp_dispatch,status}'
        else null
      end,
      'pending'
    )));
    v_max_attempts := private.notification_safe_integer(
      v_channel_metadata ->> 'max_attempts',
      24,
      1,
      100
    );
    v_attempt_count := private.notification_safe_integer(
      coalesce(
        v_channel_metadata ->> 'attempts',
        v_channel_metadata ->> 'attempt_count'
      ),
      0,
      0,
      v_max_attempts
    );
    v_priority := private.notification_safe_integer(
      coalesce(
        v_channel_metadata ->> 'priority',
        v_notification.metadata ->> 'priority'
      ),
      case
        when lower(coalesce(v_notification.metadata ->> 'event_key', '')) like 'billing_%' then 300
        when lower(coalesce(v_notification.metadata ->> 'event_key', '')) in (
          'new_lead_received', 'lead_reentry', 'lead_transferred',
          'lead_auto_redistributed', 'whatsapp_disconnected'
        ) then 250
        when lower(coalesce(v_notification.metadata ->> 'event_key', '')) in (
          'update_phone_reminder', 'gamification_update', 'announcement'
        ) then 50
        else 100
      end,
      0,
      1000
    );
    v_expires_at := private.notification_delivery_expiry(
      v_notification.created_at,
      v_notification.metadata,
      v_channel_metadata
    );
    v_next_attempt_at := coalesce(
      private.notification_safe_timestamptz(v_channel_metadata ->> 'next_attempt_at'),
      private.notification_safe_timestamptz(v_channel_metadata ->> 'next_retry_at'),
      now()
    );
    v_provider := nullif(left(btrim(v_channel_metadata ->> 'provider'), 100), '');
    if v_provider is null and v_channel = 'email' then
      v_provider := 'resend';
    end if;
    v_provider_message_id := case
      when v_channel = 'push' then null
      when v_channel = 'whatsapp' then nullif(left(btrim(coalesce(
        v_channel_metadata ->> 'expected_message_id',
        v_channel_metadata ->> 'message_id'
      )), 500), '')
      else nullif(left(btrim(v_channel_metadata ->> 'message_id'), 500), '')
    end;

    v_accepted_at := coalesce(
      private.notification_safe_timestamptz(v_channel_metadata ->> 'accepted_at'),
      private.notification_safe_timestamptz(v_channel_metadata ->> 'sent_at')
    );
    v_delivered_at := coalesce(
      private.notification_safe_timestamptz(v_channel_metadata ->> 'delivered_at'),
      private.notification_safe_timestamptz(v_channel_metadata ->> 'delivery_occurred_at')
    );
    v_dependency_key := null;
    v_terminal_at := null;

    if v_expires_at <= now() or v_attempt_count >= v_max_attempts then
      v_status := 'dead_letter';
      v_terminal_at := now();
    elsif v_legacy_status = 'delivered' then
      v_status := 'delivered';
      v_delivered_at := coalesce(v_delivered_at, now());
      v_terminal_at := v_delivered_at;
    elsif v_legacy_status in ('accepted', 'sent') then
      v_status := 'accepted';
      v_accepted_at := coalesce(v_accepted_at, now());
    elsif v_legacy_status = 'permanent_failed' then
      v_status := 'permanent_failed';
      v_terminal_at := coalesce(
        private.notification_safe_timestamptz(v_channel_metadata ->> 'failed_at'),
        now()
      );
    elsif v_legacy_status = 'skipped' then
      v_status := 'cancelled';
      v_terminal_at := now();
    elsif p_backfill then
      v_status := 'blocked_dependency';
      v_dependency_key := 'legacy_backfill_cutover';
    elsif v_legacy_status in ('failed', 'delivery_failed', 'retry_wait') then
      v_status := 'retry_wait';
    else
      v_status := 'queued';
    end if;

    if v_status not in ('queued', 'retry_wait') then
      v_next_attempt_at := null;
    end if;

    if v_channel in ('whatsapp', 'email') then
      v_push_token_id := null;
      v_recipient_key := case
        when v_notification.user_id is not null
          then 'user:' || v_notification.user_id::text
        else 'notification:' || v_notification.id::text
      end;

      -- A recipient change never mutates or duplicates a terminal delivery.
      -- It fences only work that has not reached a provider-terminal state.
      update private.notification_deliveries as delivery
      set status = 'cancelled',
          next_attempt_at = null,
          lease_token = null,
          leased_by = null,
          lease_expires_at = null,
          dependency_key = null,
          terminal_at = now(),
          last_error_code = 'recipient_changed',
          last_error_message = 'The notification recipient identity changed before delivery.',
          last_error_at = now(),
          updated_at = now()
      where delivery.notification_id = v_notification.id
        and delivery.channel = v_channel
        and delivery.recipient_key <> v_recipient_key
        and delivery.status in (
          'queued', 'leased', 'sending', 'retry_wait', 'blocked_dependency'
        );

      v_idempotency_key := private.notification_delivery_idempotency_key(
        v_notification.organization_id,
        v_notification.id,
        v_source_dedupe_key,
        v_channel,
        v_recipient_key
      );

      insert into private.notification_deliveries (
        notification_id,
        organization_id,
        user_id,
        channel,
        recipient_key,
        push_token_id,
        idempotency_key,
        status,
        priority,
        attempt_count,
        max_attempts,
        next_attempt_at,
        expires_at,
        dependency_key,
        provider,
        provider_message_id,
        provider_status,
        accepted_at,
        delivered_at,
        blocked_at,
        terminal_at,
        last_error_code,
        last_error_message,
        last_error_at,
        metadata,
        created_at,
        updated_at
      )
      values (
        v_notification.id,
        v_notification.organization_id,
        v_notification.user_id,
        v_channel,
        v_recipient_key,
        null,
        v_idempotency_key,
        v_status,
        v_priority,
        v_attempt_count,
        v_max_attempts,
        v_next_attempt_at,
        v_expires_at,
        v_dependency_key,
        v_provider,
        v_provider_message_id,
        nullif(left(btrim(v_channel_metadata ->> 'delivery_status'), 255), ''),
        v_accepted_at,
        v_delivered_at,
        case when v_status = 'blocked_dependency' then now() else null end,
        v_terminal_at,
        nullif(btrim(v_channel_metadata ->> 'error_code'), ''),
        nullif(left(btrim(v_channel_metadata ->> 'error'), 2000), ''),
        case
          when nullif(btrim(v_channel_metadata ->> 'error'), '') is not null then now()
          else null
        end,
        jsonb_strip_nulls(jsonb_build_object(
          'source', case when p_backfill then 'legacy_backfill' else 'notification_trigger' end,
          'legacy_status', v_legacy_status,
          'event_key', nullif(v_notification.metadata ->> 'event_key', ''),
          'expected_message_id', case
            when v_channel = 'whatsapp'
              then private.notification_delivery_expected_message_id(v_idempotency_key)
            else null
          end
        )),
        v_notification.created_at,
        now()
      )
      on conflict do nothing;
      get diagnostics v_affected = row_count;
      v_inserted := v_inserted + v_affected;
    else
      -- Push delivery is tracked per active token. A user with no active token
      -- gets no external job; the in-app notification remains authoritative.
      update private.notification_deliveries as delivery
      set status = 'cancelled',
          next_attempt_at = null,
          lease_token = null,
          leased_by = null,
          lease_expires_at = null,
          dependency_key = null,
          terminal_at = now(),
          last_error_code = 'push_token_inactive',
          last_error_message = 'The target push token is no longer active.',
          last_error_at = now(),
          updated_at = now()
      where delivery.notification_id = v_notification.id
        and delivery.channel = 'push'
        and delivery.status in (
          'queued', 'leased', 'sending', 'retry_wait', 'blocked_dependency'
        )
        and not exists (
          select 1
          from public.push_tokens as token
          where token.id = delivery.push_token_id
            and token.organization_id = v_notification.organization_id
            and token.user_id = v_notification.user_id
            and token.is_active is true
        );

      for v_push_token_id in
        select token.id
        from public.push_tokens as token
        where token.organization_id = v_notification.organization_id
          and token.user_id = v_notification.user_id
          and token.is_active is true
        order by token.id
      loop
        v_recipient_key := 'push_token:' || v_push_token_id::text;
        v_idempotency_key := private.notification_delivery_idempotency_key(
          v_notification.organization_id,
          v_notification.id,
          v_source_dedupe_key,
          v_channel,
          v_recipient_key
        );

        insert into private.notification_deliveries (
          notification_id,
          organization_id,
          user_id,
          channel,
          recipient_key,
          push_token_id,
          idempotency_key,
          status,
          priority,
          attempt_count,
          max_attempts,
          next_attempt_at,
          expires_at,
          dependency_key,
          provider,
          accepted_at,
          delivered_at,
          blocked_at,
          terminal_at,
          last_error_code,
          last_error_message,
          last_error_at,
          metadata,
          created_at,
          updated_at
        )
        values (
          v_notification.id,
          v_notification.organization_id,
          v_notification.user_id,
          v_channel,
          v_recipient_key,
          v_push_token_id,
          v_idempotency_key,
          v_status,
          v_priority,
          v_attempt_count,
          v_max_attempts,
          v_next_attempt_at,
          v_expires_at,
          v_dependency_key,
          v_provider,
          v_accepted_at,
          v_delivered_at,
          case when v_status = 'blocked_dependency' then now() else null end,
          v_terminal_at,
          nullif(btrim(v_channel_metadata ->> 'error_code'), ''),
          nullif(left(btrim(v_channel_metadata ->> 'error'), 2000), ''),
          case
            when nullif(btrim(v_channel_metadata ->> 'error'), '') is not null then now()
            else null
          end,
          jsonb_strip_nulls(jsonb_build_object(
            'source', case when p_backfill then 'legacy_backfill' else 'notification_trigger' end,
            'legacy_status', v_legacy_status,
            'event_key', nullif(v_notification.metadata ->> 'event_key', '')
          )),
          v_notification.created_at,
          now()
        )
        on conflict do nothing;
        get diagnostics v_affected = row_count;
        v_inserted := v_inserted + v_affected;
      end loop;
    end if;
  end loop;

  -- If a producer removed a channel or changed its recipient while an old
  -- worker held a lease, fence that worker and close the corresponding ledger
  -- row instead of leaving a permanent `sending` diagnostic.
  update private.notification_delivery_attempts as attempt
  set outcome = 'cancelled',
      completed_at = coalesce(attempt.completed_at, now()),
      error_code = coalesce(attempt.error_code, 'delivery_materialization_cancelled'),
      error_message = coalesce(
        attempt.error_message,
        'Notification requirements or recipient changed during delivery.'
      )
  from private.notification_deliveries as delivery
  where delivery.notification_id = v_notification.id
    and delivery.status = 'cancelled'
    and attempt.delivery_id = delivery.id
    and attempt.event_type = 'send_attempt'
    and attempt.outcome = 'sending';

  return v_inserted;
end
$function$;

create or replace function private.sync_notification_deliveries_from_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  perform private.materialize_notification_deliveries(new.id, false);
  return new;
end
$function$;

revoke all on function private.materialize_notification_deliveries(uuid, boolean)
  from PUBLIC, anon, authenticated, service_role;
revoke all on function private.sync_notification_deliveries_from_notification()
  from PUBLIC, anon, authenticated, service_role;

drop trigger if exists sync_notification_deliveries_from_notification
  on public.notifications;
create trigger sync_notification_deliveries_from_notification
after insert or update of metadata, user_id, organization_id
on public.notifications
for each row
execute function private.sync_notification_deliveries_from_notification();

-- Materialize historical jobs without making them executable. Delivered,
-- accepted and permanent terminal state are preserved for reconciliation;
-- all other live work is fenced behind the explicit cutover dependency.
do $backfill$
declare
  v_notification_id uuid;
begin
  for v_notification_id in
    select notification.id
    from public.notifications as notification
    where private.notification_dispatch_required(
      notification.metadata #> '{dispatch,whatsapp,required}'
    )
       or private.notification_dispatch_required(
         notification.metadata #> '{whatsapp_dispatch,required}'
       )
       or private.notification_dispatch_required(
         notification.metadata -> 'whatsapp_dispatch_required'
       )
       or private.notification_dispatch_required(
         notification.metadata #> '{dispatch,email,required}'
       )
       or private.notification_dispatch_required(
         notification.metadata #> '{dispatch,push,required}'
       )
    order by notification.id
  loop
    perform private.materialize_notification_deliveries(v_notification_id, true);
  end loop;
end
$backfill$;

create or replace function private.claim_notification_deliveries(
  p_worker_id text,
  p_batch_size integer default 25,
  p_lease_for interval default interval '2 minutes',
  p_channels text[] default null
)
returns setof private.notification_deliveries
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_batch_size integer := least(greatest(coalesce(p_batch_size, 25), 1), 100);
  v_lease_for interval := greatest(
    interval '15 seconds',
    least(coalesce(p_lease_for, interval '2 minutes'), interval '15 minutes')
  );
  v_delivery private.notification_deliveries%rowtype;
begin
  if nullif(btrim(coalesce(p_worker_id, '')), '') is null
     or char_length(p_worker_id) > 255 then
    raise exception 'invalid notification delivery worker id';
  end if;
  if p_channels is not null and (
    cardinality(p_channels) = 0
    or exists (
      select 1
      from unnest(p_channels) as requested(channel)
      where requested.channel is null
         or requested.channel not in ('whatsapp', 'push', 'email')
    )
  ) then
    raise exception 'invalid notification delivery channels';
  end if;

  for v_delivery in
    with candidates as (
      select delivery.id
      from private.notification_deliveries as delivery
      where delivery.status in ('queued', 'retry_wait')
        and delivery.next_attempt_at <= now()
        and delivery.expires_at > now()
        and delivery.attempt_count < delivery.max_attempts
        and (p_channels is null or delivery.channel = any(p_channels))
        and (
          delivery.channel <> 'push'
          or exists (
            select 1
            from public.push_tokens as token
            where token.id = delivery.push_token_id
              and token.organization_id = delivery.organization_id
              and token.user_id = delivery.user_id
              and token.is_active is true
          )
        )
      order by
        delivery.priority desc,
        delivery.next_attempt_at asc,
        delivery.created_at asc,
        delivery.id asc
      limit v_batch_size
      for update skip locked
    )
    update private.notification_deliveries as delivery
    set status = 'leased',
        next_attempt_at = null,
        lease_token = gen_random_uuid(),
        leased_by = btrim(p_worker_id),
        lease_expires_at = now() + v_lease_for,
        dependency_key = null,
        blocked_at = null,
        updated_at = now()
    from candidates
    where delivery.id = candidates.id
    returning delivery.*
  loop
    return next v_delivery;
  end loop;

  return;
end
$function$;

create or replace function private.start_notification_delivery(
  p_delivery_id uuid,
  p_lease_token uuid,
  p_provider text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_delivery private.notification_deliveries%rowtype;
  v_attempt_number integer;
begin
  if p_delivery_id is null or p_lease_token is null
     or char_length(coalesce(p_provider, '')) > 100 then
    return false;
  end if;

  update private.notification_deliveries as delivery
  set status = 'sending',
      attempt_count = delivery.attempt_count + 1,
      provider = coalesce(nullif(btrim(p_provider), ''), delivery.provider),
      last_attempt_at = now(),
      updated_at = now()
  where delivery.id = p_delivery_id
    and delivery.status = 'leased'
    and delivery.lease_token = p_lease_token
    and delivery.lease_expires_at > now()
    and delivery.expires_at > now()
    and delivery.attempt_count < delivery.max_attempts
  returning delivery.* into v_delivery;

  if not found then
    return false;
  end if;

  select coalesce(max(attempt.attempt_number), 0) + 1
    into v_attempt_number
  from private.notification_delivery_attempts as attempt
  where attempt.delivery_id = v_delivery.id
    and attempt.event_type = 'send_attempt';

  insert into private.notification_delivery_attempts (
    delivery_id,
    event_type,
    attempt_number,
    lease_token,
    worker_id,
    from_status,
    outcome,
    provider,
    started_at,
    metadata
  )
  values (
    v_delivery.id,
    'send_attempt',
    v_attempt_number,
    p_lease_token,
    v_delivery.leased_by,
    'leased',
    'sending',
    v_delivery.provider,
    now(),
    '{}'::jsonb
  );

  return true;
end
$function$;

create or replace function private.complete_notification_delivery(
  p_delivery_id uuid,
  p_lease_token uuid,
  p_status text,
  p_provider text default null,
  p_provider_message_id text default null,
  p_provider_status text default null,
  p_attempt_metadata jsonb default '{}'::jsonb,
  p_occurred_at timestamptz default now()
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_status text := lower(btrim(coalesce(p_status, '')));
  v_occurred_at timestamptz := coalesce(p_occurred_at, now());
  v_delivery private.notification_deliveries%rowtype;
begin
  if p_delivery_id is null
     or p_lease_token is null
     or v_status not in (
       'accepted', 'delivered', 'cancelled', 'permanent_failed', 'dead_letter'
     )
     or jsonb_typeof(coalesce(p_attempt_metadata, '{}'::jsonb)) <> 'object'
     or char_length(coalesce(p_provider, '')) > 100
     or char_length(coalesce(p_provider_message_id, '')) > 500
     or char_length(coalesce(p_provider_status, '')) > 255
     or v_occurred_at > now() + interval '5 minutes' then
    return false;
  end if;

  update private.notification_deliveries as delivery
  set status = v_status,
      next_attempt_at = null,
      lease_token = null,
      leased_by = null,
      lease_expires_at = null,
      dependency_key = null,
      provider = coalesce(nullif(btrim(p_provider), ''), delivery.provider),
      provider_message_id = coalesce(
        nullif(btrim(p_provider_message_id), ''),
        delivery.provider_message_id
      ),
      provider_status = coalesce(
        nullif(btrim(p_provider_status), ''),
        delivery.provider_status
      ),
      accepted_at = case
        when v_status in ('accepted', 'delivered')
          then coalesce(delivery.accepted_at, v_occurred_at)
        else delivery.accepted_at
      end,
      delivered_at = case
        when v_status = 'delivered'
          then coalesce(delivery.delivered_at, v_occurred_at)
        else delivery.delivered_at
      end,
      blocked_at = null,
      terminal_at = case
        when v_status in ('delivered', 'cancelled', 'permanent_failed', 'dead_letter')
          then v_occurred_at
        else null
      end,
      last_error_code = case
        when v_status in ('accepted', 'delivered') then null
        else coalesce(
          nullif(left(btrim(coalesce(p_attempt_metadata ->> 'error_code', '')), 255), ''),
          delivery.last_error_code,
          'delivery_' || v_status
        )
      end,
      last_error_message = case
        when v_status in ('accepted', 'delivered') then null
        else coalesce(
          nullif(left(btrim(coalesce(p_attempt_metadata ->> 'error_message', '')), 2000), ''),
          delivery.last_error_message
        )
      end,
      last_error_at = case
        when v_status in ('accepted', 'delivered') then null
        else v_occurred_at
      end,
      metadata = delivery.metadata || coalesce(p_attempt_metadata, '{}'::jsonb),
      updated_at = now()
  where delivery.id = p_delivery_id
    and delivery.status = 'sending'
    and delivery.lease_token = p_lease_token
  returning delivery.* into v_delivery;

  if not found then
    return false;
  end if;

  update private.notification_delivery_attempts as attempt
  set outcome = v_status,
      provider = v_delivery.provider,
      provider_message_id = v_delivery.provider_message_id,
      provider_status = v_delivery.provider_status,
      completed_at = v_occurred_at,
      error_code = case
        when v_status in ('accepted', 'delivered') then null
        else coalesce(
          nullif(left(btrim(coalesce(p_attempt_metadata ->> 'error_code', '')), 255), ''),
          'delivery_' || v_status
        )
      end,
      error_message = case
        when v_status in ('accepted', 'delivered') then null
        else nullif(left(btrim(coalesce(p_attempt_metadata ->> 'error_message', '')), 2000), '')
      end,
      metadata = attempt.metadata || coalesce(p_attempt_metadata, '{}'::jsonb)
  where attempt.delivery_id = p_delivery_id
    and attempt.event_type = 'send_attempt'
    and attempt.lease_token = p_lease_token
    and attempt.outcome = 'sending';

  return true;
end
$function$;

create or replace function private.reschedule_notification_delivery(
  p_delivery_id uuid,
  p_lease_token uuid,
  p_next_attempt_at timestamptz,
  p_error_code text default null,
  p_error_message text default null,
  p_provider_status text default null,
  p_attempt_metadata jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_delivery private.notification_deliveries%rowtype;
  v_status text;
  v_next_attempt_at timestamptz;
begin
  if p_delivery_id is null
     or p_lease_token is null
     or jsonb_typeof(coalesce(p_attempt_metadata, '{}'::jsonb)) <> 'object'
     or char_length(coalesce(p_error_code, '')) > 255
     or char_length(coalesce(p_error_message, '')) > 2000
     or char_length(coalesce(p_provider_status, '')) > 255 then
    return false;
  end if;

  select delivery.*
    into v_delivery
  from private.notification_deliveries as delivery
  where delivery.id = p_delivery_id
    and delivery.status in ('leased', 'sending')
    and delivery.lease_token = p_lease_token
  for update;

  if not found then
    return false;
  end if;

  if v_delivery.expires_at <= now()
     or v_delivery.attempt_count >= v_delivery.max_attempts
     or coalesce(p_next_attempt_at, now()) >= v_delivery.expires_at then
    v_status := 'dead_letter';
    v_next_attempt_at := null;
  else
    v_status := 'retry_wait';
    v_next_attempt_at := greatest(coalesce(p_next_attempt_at, now()), now());
  end if;

  update private.notification_deliveries as delivery
  set status = v_status,
      next_attempt_at = v_next_attempt_at,
      lease_token = null,
      leased_by = null,
      lease_expires_at = null,
      dependency_key = null,
      provider_status = coalesce(
        nullif(btrim(p_provider_status), ''),
        delivery.provider_status
      ),
      blocked_at = null,
      terminal_at = case when v_status = 'dead_letter' then now() else null end,
      last_error_code = nullif(left(btrim(coalesce(p_error_code, '')), 255), ''),
      last_error_message = nullif(left(btrim(coalesce(p_error_message, '')), 2000), ''),
      last_error_at = now(),
      metadata = delivery.metadata || coalesce(p_attempt_metadata, '{}'::jsonb),
      updated_at = now()
  where delivery.id = p_delivery_id
    and delivery.lease_token = p_lease_token;

  update private.notification_delivery_attempts as attempt
  set outcome = v_status,
      provider = v_delivery.provider,
      provider_message_id = v_delivery.provider_message_id,
      provider_status = coalesce(
        nullif(btrim(p_provider_status), ''),
        attempt.provider_status
      ),
      completed_at = now(),
      error_code = nullif(left(btrim(coalesce(p_error_code, '')), 255), ''),
      error_message = nullif(left(btrim(coalesce(p_error_message, '')), 2000), ''),
      metadata = attempt.metadata || coalesce(p_attempt_metadata, '{}'::jsonb)
  where attempt.delivery_id = p_delivery_id
    and attempt.event_type = 'send_attempt'
    and attempt.lease_token = p_lease_token
    and attempt.outcome = 'sending';

  return true;
end
$function$;

create or replace function private.block_notification_delivery(
  p_delivery_id uuid,
  p_lease_token uuid,
  p_dependency_key text,
  p_error_code text default null,
  p_error_message text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_delivery private.notification_deliveries%rowtype;
  v_was_sending boolean;
begin
  if p_delivery_id is null
     or p_lease_token is null
     or nullif(btrim(coalesce(p_dependency_key, '')), '') is null
     or char_length(p_dependency_key) > 255
     or char_length(coalesce(p_error_code, '')) > 255
     or char_length(coalesce(p_error_message, '')) > 2000 then
    return false;
  end if;

  select delivery.*
    into v_delivery
  from private.notification_deliveries as delivery
  where delivery.id = p_delivery_id
    and delivery.status in ('leased', 'sending')
    and delivery.lease_token = p_lease_token
  for update;

  if not found then
    return false;
  end if;
  v_was_sending := v_delivery.status = 'sending';

  update private.notification_deliveries as delivery
  set status = 'blocked_dependency',
      attempt_count = case
        when v_was_sending then greatest(delivery.attempt_count - 1, 0)
        else delivery.attempt_count
      end,
      next_attempt_at = null,
      lease_token = null,
      leased_by = null,
      lease_expires_at = null,
      dependency_key = btrim(p_dependency_key),
      blocked_at = now(),
      terminal_at = null,
      last_error_code = nullif(left(btrim(coalesce(p_error_code, '')), 255), ''),
      last_error_message = nullif(left(btrim(coalesce(p_error_message, '')), 2000), ''),
      last_error_at = now(),
      updated_at = now()
  where delivery.id = p_delivery_id
    and delivery.lease_token = p_lease_token;

  if v_was_sending then
    update private.notification_delivery_attempts as attempt
    set outcome = 'blocked_dependency',
        completed_at = now(),
        error_code = nullif(left(btrim(coalesce(p_error_code, '')), 255), ''),
        error_message = nullif(left(btrim(coalesce(p_error_message, '')), 2000), ''),
        metadata = attempt.metadata || jsonb_build_object(
          'dependency_key', btrim(p_dependency_key),
          'budget_restored', true
        )
    where attempt.delivery_id = p_delivery_id
      and attempt.event_type = 'send_attempt'
      and attempt.lease_token = p_lease_token
      and attempt.outcome = 'sending';
  end if;

  return true;
end
$function$;

create or replace function private.replay_notification_delivery(
  p_delivery_id uuid,
  p_reason text,
  p_requested_by text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_delivery private.notification_deliveries%rowtype;
begin
  if p_delivery_id is null
     or nullif(btrim(coalesce(p_reason, '')), '') is null
     or nullif(btrim(coalesce(p_requested_by, '')), '') is null
     or char_length(p_reason) > 1000
     or char_length(p_requested_by) > 255 then
    return false;
  end if;

  update private.notification_deliveries as delivery
  set status = 'queued',
      attempt_count = 0,
      next_attempt_at = now(),
      expires_at = greatest(delivery.expires_at, now() + interval '1 day'),
      lease_token = null,
      leased_by = null,
      lease_expires_at = null,
      dependency_key = null,
      provider_status = null,
      accepted_at = null,
      delivered_at = null,
      blocked_at = null,
      terminal_at = null,
      last_error_code = null,
      last_error_message = null,
      last_error_at = null,
      metadata = delivery.metadata || jsonb_build_object(
        'last_replay_at', now(),
        'last_replay_by', btrim(p_requested_by),
        'last_replay_reason', btrim(p_reason),
        'replay_count', private.notification_safe_integer(
          delivery.metadata ->> 'replay_count',
          0,
          0,
          2147483646
        ) + 1
      ),
      updated_at = now()
  where delivery.id = p_delivery_id
    and delivery.status in (
      'blocked_dependency', 'dead_letter', 'cancelled', 'permanent_failed'
    )
  returning delivery.* into v_delivery;

  if not found then
    return false;
  end if;

  insert into private.notification_delivery_attempts (
    delivery_id,
    event_type,
    attempt_number,
    lease_token,
    worker_id,
    from_status,
    outcome,
    completed_at,
    metadata
  )
  values (
    v_delivery.id,
    'replay',
    null,
    null,
    null,
    null,
    'replayed',
    now(),
    jsonb_build_object(
      'reason', btrim(p_reason),
      'requested_by', btrim(p_requested_by)
    )
  );

  return true;
end
$function$;

revoke all on function private.claim_notification_deliveries(text, integer, interval, text[])
  from PUBLIC, anon, authenticated, service_role;
revoke all on function private.start_notification_delivery(uuid, uuid, text)
  from PUBLIC, anon, authenticated, service_role;
revoke all on function private.complete_notification_delivery(
  uuid, uuid, text, text, text, text, jsonb, timestamptz
) from PUBLIC, anon, authenticated, service_role;
revoke all on function private.reschedule_notification_delivery(
  uuid, uuid, timestamptz, text, text, text, jsonb
) from PUBLIC, anon, authenticated, service_role;
revoke all on function private.block_notification_delivery(uuid, uuid, text, text, text)
  from PUBLIC, anon, authenticated, service_role;
revoke all on function private.replay_notification_delivery(uuid, text, text)
  from PUBLIC, anon, authenticated, service_role;

grant execute on function private.claim_notification_deliveries(text, integer, interval, text[])
  to service_role;
grant execute on function private.start_notification_delivery(uuid, uuid, text)
  to service_role;
grant execute on function private.complete_notification_delivery(
  uuid, uuid, text, text, text, text, jsonb, timestamptz
) to service_role;
grant execute on function private.reschedule_notification_delivery(
  uuid, uuid, timestamptz, text, text, text, jsonb
) to service_role;
grant execute on function private.block_notification_delivery(uuid, uuid, text, text, text)
  to service_role;
grant execute on function private.replay_notification_delivery(uuid, text, text)
  to service_role;

create or replace function private.sweep_stale_notification_deliveries(
  p_acceptance_timeout interval default interval '1 hour'
)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_acceptance_timeout interval := coalesce(
    p_acceptance_timeout,
    interval '1 hour'
  );
  v_changed integer := 0;
  v_step integer := 0;
begin
  if v_acceptance_timeout < interval '5 minutes'
     or v_acceptance_timeout > interval '30 days' then
    raise exception 'invalid notification acceptance timeout';
  end if;

  with changed as (
    update private.notification_deliveries as delivery
    set status = 'dead_letter',
        next_attempt_at = null,
        lease_token = null,
        leased_by = null,
        lease_expires_at = null,
        dependency_key = null,
        blocked_at = null,
        terminal_at = now(),
        last_error_code = case
          when delivery.expires_at <= now() then 'delivery_ttl_expired'
          else 'delivery_attempt_budget_exhausted'
        end,
        last_error_message = case
          when delivery.expires_at <= now() then 'Notification delivery TTL expired.'
          else 'Notification delivery attempt budget was exhausted.'
        end,
        last_error_at = now(),
        updated_at = now()
    where delivery.status in (
      'queued', 'leased', 'sending', 'accepted', 'retry_wait', 'blocked_dependency'
    )
      and (
        delivery.expires_at <= now()
        or delivery.attempt_count >= delivery.max_attempts
      )
    returning delivery.id, delivery.lease_token
  ),
  attempt_updates as (
    update private.notification_delivery_attempts as attempt
    set outcome = 'dead_letter',
        completed_at = coalesce(attempt.completed_at, now()),
        error_code = 'delivery_swept_to_dead_letter',
        error_message = 'The delivery expired or exhausted its attempt budget.'
    from changed
    where attempt.delivery_id = changed.id
      and attempt.event_type = 'send_attempt'
      and attempt.outcome = 'sending'
    returning attempt.id
  ),
  audit as (
    insert into private.notification_delivery_attempts (
      delivery_id,
      event_type,
      attempt_number,
      from_status,
      outcome,
      completed_at,
      error_code,
      metadata
    )
    select
      changed.id,
      'sweep',
      null,
      null,
      'dead_letter',
      now(),
      'delivery_swept_to_dead_letter',
      jsonb_build_object('reason', 'ttl_or_attempt_budget')
    from changed
    returning id
  )
  select count(*)::integer into v_step from changed;
  v_changed := v_changed + v_step;

  with changed as (
    update private.notification_deliveries as delivery
    set status = 'retry_wait',
        next_attempt_at = now() + private.notification_delivery_retry_delay(
          greatest(delivery.attempt_count, 1)
        ),
        lease_token = null,
        leased_by = null,
        lease_expires_at = null,
        dependency_key = null,
        blocked_at = null,
        terminal_at = null,
        last_error_code = 'delivery_lease_expired',
        last_error_message = 'The delivery worker lease expired before completion.',
        last_error_at = now(),
        updated_at = now()
    where delivery.status in ('leased', 'sending')
      and delivery.lease_expires_at <= now()
      and delivery.expires_at > now()
      and delivery.attempt_count < delivery.max_attempts
    returning delivery.id, delivery.lease_token
  ),
  attempt_updates as (
    update private.notification_delivery_attempts as attempt
    set outcome = 'retry_wait',
        completed_at = coalesce(attempt.completed_at, now()),
        error_code = 'delivery_lease_expired',
        error_message = 'The delivery worker lease expired before completion.'
    from changed
    where attempt.delivery_id = changed.id
      and attempt.event_type = 'send_attempt'
      and attempt.outcome = 'sending'
    returning attempt.id
  ),
  audit as (
    insert into private.notification_delivery_attempts (
      delivery_id,
      event_type,
      attempt_number,
      from_status,
      outcome,
      completed_at,
      error_code,
      metadata
    )
    select
      changed.id,
      'sweep',
      null,
      null,
      'retry_wait',
      now(),
      'delivery_lease_expired',
      jsonb_build_object('reason', 'lease_expired')
    from changed
    returning id
  )
  select count(*)::integer into v_step from changed;
  v_changed := v_changed + v_step;

  -- HTTP acceptance is not proof of delivery. Once the reconciliation window
  -- expires, fence the row for assisted/provider reconciliation instead of
  -- issuing a blind duplicate.
  with changed as (
    update private.notification_deliveries as delivery
    set status = 'blocked_dependency',
        next_attempt_at = null,
        dependency_key = 'receipt_reconciliation_required',
        blocked_at = now(),
        terminal_at = null,
        last_error_code = 'provider_receipt_timeout',
        last_error_message = 'Provider acceptance has no terminal delivery receipt yet.',
        last_error_at = now(),
        updated_at = now()
    where delivery.status = 'accepted'
      and coalesce(delivery.accepted_at, delivery.updated_at)
        <= now() - v_acceptance_timeout
      and delivery.expires_at > now()
      and delivery.attempt_count < delivery.max_attempts
    returning delivery.id
  ),
  audit as (
    insert into private.notification_delivery_attempts (
      delivery_id,
      event_type,
      attempt_number,
      from_status,
      outcome,
      completed_at,
      error_code,
      metadata
    )
    select
      changed.id,
      'sweep',
      null,
      'accepted',
      'blocked_dependency',
      now(),
      'provider_receipt_timeout',
      jsonb_build_object('dependency_key', 'receipt_reconciliation_required')
    from changed
    returning id
  )
  select count(*)::integer into v_step from changed;
  v_changed := v_changed + v_step;

  return v_changed;
end
$function$;

create or replace function private.unblock_notification_deliveries(
  p_organization_id uuid,
  p_dependency_key text,
  p_channel text default null,
  p_limit integer default 1000
)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 1000), 1), 5000);
  v_changed integer := 0;
begin
  if p_organization_id is null
     or nullif(btrim(coalesce(p_dependency_key, '')), '') is null
     or char_length(p_dependency_key) > 255
     or (p_channel is not null and p_channel not in ('whatsapp', 'push', 'email')) then
    return 0;
  end if;

  with candidates as (
    select delivery.id
    from private.notification_deliveries as delivery
    where delivery.organization_id = p_organization_id
      and delivery.status = 'blocked_dependency'
      and delivery.dependency_key = btrim(p_dependency_key)
      and (p_channel is null or delivery.channel = p_channel)
      and delivery.expires_at > now()
      and delivery.attempt_count < delivery.max_attempts
    order by delivery.priority desc, delivery.created_at asc, delivery.id asc
    limit v_limit
    for update skip locked
  ),
  changed as (
    update private.notification_deliveries as delivery
    set status = 'queued',
        next_attempt_at = now(),
        dependency_key = null,
        blocked_at = null,
        last_error_code = null,
        last_error_message = null,
        last_error_at = null,
        updated_at = now()
    from candidates
    where delivery.id = candidates.id
    returning delivery.id
  ),
  audit as (
    insert into private.notification_delivery_attempts (
      delivery_id,
      event_type,
      attempt_number,
      from_status,
      outcome,
      completed_at,
      metadata
    )
    select
      changed.id,
      'unblock',
      null,
      'blocked_dependency',
      'unblocked',
      now(),
      jsonb_build_object(
        'dependency_key', btrim(p_dependency_key),
        'source', 'dependency_recovered'
      )
    from changed
    returning id
  )
  select count(*)::integer into v_changed from changed;

  return v_changed;
end
$function$;

create or replace function private.wake_notification_deliveries_after_whatsapp_connect()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_dependency_key text;
begin
  if new.status <> 'connected'
     or new.is_notification_session is not true
     or new.is_active is not true then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and old.status = 'connected'
     and old.is_notification_session is true
     and old.is_active is true then
    return new;
  end if;

  foreach v_dependency_key in array array[
    'whatsapp_session_disconnected'::text,
    'whatsapp_session_unavailable'::text,
    'whatsapp_session_reconnecting'::text,
    'whatsapp_qr_required'::text
  ]
  loop
    perform private.unblock_notification_deliveries(
      new.organization_id,
      v_dependency_key,
      'whatsapp',
      5000
    );
  end loop;

  return new;
end
$function$;

drop trigger if exists wake_notification_deliveries_after_whatsapp_connect
  on public.whatsapp_sessions;
create trigger wake_notification_deliveries_after_whatsapp_connect
after insert or update of status, is_notification_session, is_active
on public.whatsapp_sessions
for each row
execute function private.wake_notification_deliveries_after_whatsapp_connect();

create or replace function private.notification_delivery_metrics()
returns table (
  organization_id uuid,
  channel text,
  status text,
  delivery_count bigint,
  due_count bigint,
  oldest_created_at timestamptz,
  oldest_next_attempt_at timestamptz,
  oldest_lease_expires_at timestamptz,
  max_attempt_count integer
)
language sql
stable
security definer
set search_path = ''
as $function$
  select
    delivery.organization_id,
    delivery.channel,
    delivery.status,
    count(*)::bigint as delivery_count,
    count(*) filter (
      where (
        delivery.status in ('queued', 'retry_wait')
        and delivery.next_attempt_at <= now()
      ) or (
        delivery.status in ('leased', 'sending')
        and delivery.lease_expires_at <= now()
      )
    )::bigint as due_count,
    min(delivery.created_at) as oldest_created_at,
    min(delivery.next_attempt_at) as oldest_next_attempt_at,
    min(delivery.lease_expires_at) as oldest_lease_expires_at,
    max(delivery.attempt_count)::integer as max_attempt_count
  from private.notification_deliveries as delivery
  group by delivery.organization_id, delivery.channel, delivery.status;
$function$;

revoke all on function private.sweep_stale_notification_deliveries(interval)
  from PUBLIC, anon, authenticated, service_role;
revoke all on function private.unblock_notification_deliveries(uuid, text, text, integer)
  from PUBLIC, anon, authenticated, service_role;
revoke all on function private.wake_notification_deliveries_after_whatsapp_connect()
  from PUBLIC, anon, authenticated, service_role;
revoke all on function private.notification_delivery_metrics()
  from PUBLIC, anon, authenticated, service_role;

grant execute on function private.sweep_stale_notification_deliveries(interval)
  to service_role;
grant execute on function private.unblock_notification_deliveries(uuid, text, text, integer)
  to service_role;
grant execute on function private.notification_delivery_metrics()
  to service_role;

create or replace function private.apply_notification_delivery_receipt(
  p_notification_id uuid,
  p_channel text,
  p_provider text,
  p_provider_message_id text,
  p_provider_status text,
  p_delivered boolean,
  p_permanent_failure boolean,
  p_occurred_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_delivery private.notification_deliveries%rowtype;
  v_target_status text;
  v_next_attempt_at timestamptz;
  v_prior_receipt_at timestamptz;
begin
  if p_notification_id is null
     or p_channel not in ('whatsapp', 'email')
     or nullif(btrim(coalesce(p_provider, '')), '') is null
     or nullif(btrim(coalesce(p_provider_message_id, '')), '') is null
     or nullif(btrim(coalesce(p_provider_status, '')), '') is null
     or char_length(p_provider) > 100
     or char_length(p_provider_message_id) > 500
     or char_length(p_provider_status) > 255
     or p_occurred_at is null
     or p_occurred_at > now() + interval '5 minutes' then
    return jsonb_build_object('outcome', 'invalid_receipt');
  end if;

  select delivery.*
    into v_delivery
  from private.notification_deliveries as delivery
  where delivery.notification_id = p_notification_id
    and delivery.channel = p_channel
    and (
      delivery.provider_message_id = btrim(p_provider_message_id)
      or delivery.provider_message_id is null
      or delivery.metadata ->> 'expected_message_id' = btrim(p_provider_message_id)
    )
  order by
    case
      when delivery.provider_message_id = btrim(p_provider_message_id) then 0
      when delivery.metadata ->> 'expected_message_id' = btrim(p_provider_message_id) then 1
      else 2
    end,
    delivery.created_at,
    delivery.id
  limit 1
  for update;

  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;

  v_prior_receipt_at := private.notification_safe_timestamptz(
    v_delivery.metadata ->> 'last_receipt_at'
  );
  if v_prior_receipt_at is not null and p_occurred_at < v_prior_receipt_at then
    return jsonb_build_object(
      'outcome', 'stale',
      'delivery_id', v_delivery.id,
      'status', v_delivery.status
    );
  end if;

  if v_delivery.status = 'delivered' and not p_delivered then
    return jsonb_build_object(
      'outcome', 'stale',
      'delivery_id', v_delivery.id,
      'status', v_delivery.status
    );
  end if;
  if not p_delivered
     and v_delivery.status in ('permanent_failed', 'dead_letter', 'cancelled') then
    return jsonb_build_object(
      'outcome', 'stale',
      'delivery_id', v_delivery.id,
      'status', v_delivery.status
    );
  end if;

  if p_delivered then
    v_target_status := 'delivered';
    v_next_attempt_at := null;
  elsif p_permanent_failure then
    v_target_status := 'permanent_failed';
    v_next_attempt_at := null;
  elsif v_delivery.expires_at <= p_occurred_at
        or v_delivery.attempt_count >= v_delivery.max_attempts then
    v_target_status := 'dead_letter';
    v_next_attempt_at := null;
  else
    v_target_status := 'retry_wait';
    v_next_attempt_at := greatest(
      now(),
      p_occurred_at + private.notification_delivery_retry_delay(
        greatest(v_delivery.attempt_count, 1)
      )
    );
  end if;

  if v_delivery.status = v_target_status
     and v_prior_receipt_at is not null
     and p_occurred_at = v_prior_receipt_at then
    return jsonb_build_object(
      'outcome', 'already_applied',
      'delivery_id', v_delivery.id,
      'status', v_delivery.status,
      'next_attempt_at', v_delivery.next_attempt_at
    );
  end if;

  update private.notification_deliveries as delivery
  set status = v_target_status,
      next_attempt_at = v_next_attempt_at,
      lease_token = null,
      leased_by = null,
      lease_expires_at = null,
      dependency_key = null,
      provider = btrim(p_provider),
      provider_message_id = btrim(p_provider_message_id),
      provider_status = lower(btrim(p_provider_status)),
      accepted_at = case
        when p_delivered then coalesce(delivery.accepted_at, p_occurred_at)
        else delivery.accepted_at
      end,
      delivered_at = case
        when p_delivered then coalesce(delivery.delivered_at, p_occurred_at)
        else delivery.delivered_at
      end,
      blocked_at = null,
      terminal_at = case
        when v_target_status in ('delivered', 'permanent_failed', 'dead_letter')
          then p_occurred_at
        else null
      end,
      last_error_code = case
        when p_delivered then null
        else 'provider_' || lower(btrim(p_provider_status))
      end,
      last_error_message = case
        when p_delivered then null
        else 'Provider reported a delivery failure.'
      end,
      last_error_at = case when p_delivered then null else p_occurred_at end,
      metadata = delivery.metadata || jsonb_build_object(
        'last_receipt_at', p_occurred_at,
        'last_receipt_status', lower(btrim(p_provider_status)),
        'last_receipt_permanent', coalesce(p_permanent_failure, false)
      ),
      updated_at = now()
  where delivery.id = v_delivery.id;

  update private.notification_delivery_attempts as attempt
  set outcome = v_target_status,
      provider = btrim(p_provider),
      provider_message_id = btrim(p_provider_message_id),
      provider_status = lower(btrim(p_provider_status)),
      completed_at = greatest(coalesce(attempt.completed_at, p_occurred_at), p_occurred_at),
      error_code = case
        when p_delivered then null
        else 'provider_' || lower(btrim(p_provider_status))
      end,
      error_message = case
        when p_delivered then null
        else 'Provider reported a delivery failure.'
      end,
      metadata = attempt.metadata || jsonb_build_object(
        'receipt_at', p_occurred_at,
        'receipt_permanent', coalesce(p_permanent_failure, false)
      )
  where attempt.id = (
    select latest.id
    from private.notification_delivery_attempts as latest
    where latest.delivery_id = v_delivery.id
      and latest.event_type = 'send_attempt'
    order by latest.attempt_number desc
    limit 1
  );

  insert into private.notification_delivery_attempts (
    delivery_id,
    event_type,
    attempt_number,
    from_status,
    outcome,
    provider,
    provider_message_id,
    provider_status,
    completed_at,
    error_code,
    metadata
  )
  values (
    v_delivery.id,
    'receipt',
    null,
    v_delivery.status,
    v_target_status,
    btrim(p_provider),
    btrim(p_provider_message_id),
    lower(btrim(p_provider_status)),
    p_occurred_at,
    case
      when p_delivered then null
      else 'provider_' || lower(btrim(p_provider_status))
    end,
    jsonb_build_object(
      'permanent_failure', coalesce(p_permanent_failure, false)
    )
  );

  return jsonb_build_object(
    'outcome', 'applied',
    'delivery_id', v_delivery.id,
    'status', v_target_status,
    'next_attempt_at', v_next_attempt_at
  );
end
$function$;

revoke all on function private.apply_notification_delivery_receipt(
  uuid, text, text, text, text, boolean, boolean, timestamptz
) from PUBLIC, anon, authenticated, service_role;

-- Preserve the signed Resend webhook reconciliation while making transient
-- provider failures retryable in both the normalized outbox and the legacy
-- metadata read by the old worker during cutover.
create or replace function private.sync_resend_delivery_to_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_provider_status text := lower(btrim(coalesce(new.status, '')));
  v_is_failure boolean := v_provider_status in (
    'failed', 'suppressed', 'bounced', 'complained'
  );
  v_is_delivered boolean := v_provider_status = 'delivered';
  v_is_permanent boolean := v_provider_status in (
    'suppressed', 'bounced', 'complained'
  );
  v_delivery_result jsonb;
  v_normalized_status text;
  v_legacy_status text;
  v_next_attempt_at text;
  v_changed integer := 0;
  v_fingerprint text;
begin
  if new.provider <> 'resend'
     or new.notification_id is null
     or nullif(btrim(coalesce(new.provider_message_id, '')), '') is null
     or (not v_is_failure and not v_is_delivered) then
    return new;
  end if;

  -- Keep the global lock order notification -> delivery. The materialization
  -- trigger follows the same order, avoiding a receipt/producer deadlock.
  perform 1
  from public.notifications as notification
  where notification.id = new.notification_id
    and notification.organization_id is not distinct from new.organization_id
  for update;
  if not found then
    return new;
  end if;

  v_delivery_result := private.apply_notification_delivery_receipt(
    new.notification_id,
    'email',
    'resend',
    new.provider_message_id,
    v_provider_status,
    v_is_delivered,
    v_is_permanent,
    coalesce(new.status_event_at, now())
  );
  v_normalized_status := coalesce(v_delivery_result ->> 'status', '');
  v_legacy_status := case
    when v_normalized_status = 'delivered' then 'delivered'
    when v_normalized_status in ('permanent_failed', 'dead_letter') then 'permanent_failed'
    when v_is_failure then 'failed'
    else 'delivered'
  end;
  v_next_attempt_at := case
    when v_legacy_status = 'failed'
      then coalesce(v_delivery_result ->> 'next_attempt_at', now()::text)
    else ''
  end;

  update public.notifications as notification
  set metadata = jsonb_set(
    jsonb_set(
      coalesce(notification.metadata, '{}'::jsonb),
      '{dispatch,email}',
      (
        coalesce(notification.metadata #> '{dispatch,email}', '{}'::jsonb)
        || jsonb_build_object(
          'status', v_legacy_status,
          'delivery_status', v_provider_status,
          'provider', 'resend',
          'message_id', new.provider_message_id,
          'delivery_event_at', new.status_event_at,
          'alert_required', v_is_failure,
          'next_attempt_at', v_next_attempt_at,
          'error', case
            when v_is_failure then 'provider_' || v_provider_status
            else ''
          end,
          'updated_at', now()
        )
      )
        - 'claim_token'
        - 'claimed_at',
      true
    ),
    '{email_delivery_reconciled_at}',
    to_jsonb(coalesce(new.status_event_at, now())),
    true
  )
  where notification.id = new.notification_id
    and notification.organization_id is not distinct from new.organization_id
    and coalesce(notification.metadata #>> '{dispatch,email,provider}', 'resend') = 'resend'
    and notification.metadata #>> '{dispatch,email,message_id}' = new.provider_message_id
    and coalesce(notification.metadata #>> '{dispatch,email,status}', '') in (
      'accepted', 'sent', 'processing', 'delivery_failed', 'failed',
      'permanent_failed'
    )
    and not (
      notification.metadata #>> '{dispatch,email,status}' = 'delivered'
      and v_is_failure
    );
  get diagnostics v_changed = row_count;

  if v_is_failure and v_changed = 1 then
    v_fingerprint := 'resend_delivery:' || new.notification_id::text || ':'
      || new.provider_message_id || ':' || v_provider_status || ':'
      || coalesce(new.status_event_at::text, 'unknown');
    insert into public.error_events (
      organization_id,
      user_id,
      source,
      severity,
      fingerprint,
      message,
      category,
      error_code,
      component,
      metadata,
      occurred_at
    )
    select
      new.organization_id,
      new.user_id,
      'backend',
      case when v_is_permanent then 'error' else 'warning' end,
      v_fingerprint,
      case
        when v_is_permanent then 'Transactional email delivery requires assisted review'
        else 'Transactional email delivery was requeued after provider failure'
      end,
      'notification_delivery',
      'resend_' || v_provider_status,
      'resend_webhook_reconciliation',
      jsonb_build_object(
        'notification_id', new.notification_id,
        'email_log_id', new.id,
        'provider_status', v_provider_status,
        'delivery_status', v_normalized_status
      ),
      coalesce(new.status_event_at, now())
    where not exists (
      select 1
      from public.error_events as existing
      where existing.fingerprint = v_fingerprint
    );
  end if;

  return new;
end
$function$;

revoke all on function private.sync_resend_delivery_to_notification()
  from PUBLIC, anon, authenticated, service_role;

-- Evolution receipts can arrive before the HTTP caller stores acceptance.
-- Resolve the precomputed stanza id from the normalized row first, then fall
-- back to the legacy metadata during rollout. A provider failure is retryable
-- unless TTL/budget makes it a dead letter.
create or replace function private.reconcile_notification_whatsapp_delivery(
  p_organization_id uuid,
  p_expected_message_id text,
  p_status text,
  p_occurred_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_expected_message_id text := nullif(btrim(coalesce(p_expected_message_id, '')), '');
  v_provider_status text := lower(btrim(coalesce(p_status, '')));
  v_ids uuid[];
  v_notification_id uuid;
  v_metadata jsonb;
  v_channel jsonb;
  v_current_status text;
  v_current_event_at timestamptz;
  v_delivery_result jsonb;
  v_normalized_status text;
  v_legacy_status text;
  v_next_attempt_at text;
  v_new_channel jsonb;
begin
  if p_organization_id is null
     or v_expected_message_id is null
     or char_length(v_expected_message_id) > 500
     or p_occurred_at is null
     or p_occurred_at > now() + interval '5 minutes'
     or v_provider_status not in ('delivered', 'read', 'failed') then
    return jsonb_build_object('outcome', 'invalid_status');
  end if;

  select array_agg(candidate.notification_id order by candidate.notification_id)
    into v_ids
  from (
    select delivery.notification_id
    from private.notification_deliveries as delivery
    where delivery.organization_id = p_organization_id
      and delivery.channel = 'whatsapp'
      and (
        delivery.provider_message_id = v_expected_message_id
        or delivery.metadata ->> 'expected_message_id' = v_expected_message_id
      )
    order by delivery.notification_id
    limit 2
  ) as candidate;

  if coalesce(cardinality(v_ids), 0) = 0 then
    select array_agg(candidate.id order by candidate.id)
      into v_ids
    from (
      select notification.id
      from public.notifications as notification
      where notification.organization_id = p_organization_id
        and notification.metadata #>> '{dispatch,whatsapp,expected_message_id}'
          = v_expected_message_id
      order by notification.id
      limit 2
    ) as candidate;
  end if;

  if coalesce(cardinality(v_ids), 0) = 0 then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  if cardinality(v_ids) <> 1 then
    return jsonb_build_object('outcome', 'ambiguous');
  end if;

  v_notification_id := v_ids[1];
  select coalesce(notification.metadata, '{}'::jsonb)
    into v_metadata
  from public.notifications as notification
  where notification.id = v_notification_id
    and notification.organization_id = p_organization_id
  for update;

  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;

  v_channel := coalesce(v_metadata #> '{dispatch,whatsapp}', '{}'::jsonb);
  v_current_status := lower(btrim(coalesce(v_channel ->> 'status', '')));
  v_current_event_at := coalesce(
    private.notification_safe_timestamptz(v_channel ->> 'delivery_occurred_at'),
    private.notification_safe_timestamptz(v_channel ->> 'delivered_at'),
    private.notification_safe_timestamptz(v_channel ->> 'failed_at')
  );

  if v_current_status = 'delivered' and v_provider_status = 'failed' then
    return jsonb_build_object(
      'outcome', 'stale',
      'notification_id', v_notification_id,
      'status', v_current_status,
      'occurred_at', v_current_event_at
    );
  end if;
  if v_current_event_at is not null and p_occurred_at < v_current_event_at then
    return jsonb_build_object(
      'outcome', 'stale',
      'notification_id', v_notification_id,
      'status', v_current_status,
      'occurred_at', v_current_event_at
    );
  end if;

  v_delivery_result := private.apply_notification_delivery_receipt(
    v_notification_id,
    'whatsapp',
    coalesce(nullif(v_channel ->> 'provider', ''), 'evolution'),
    v_expected_message_id,
    v_provider_status,
    v_provider_status in ('delivered', 'read'),
    false,
    p_occurred_at
  );

  if v_delivery_result ->> 'outcome' = 'stale' then
    return jsonb_build_object(
      'outcome', 'stale',
      'notification_id', v_notification_id,
      'status', v_delivery_result ->> 'status',
      'occurred_at', p_occurred_at
    );
  end if;

  v_normalized_status := coalesce(v_delivery_result ->> 'status', '');
  v_legacy_status := case
    when v_provider_status in ('delivered', 'read') then 'delivered'
    when v_normalized_status in ('permanent_failed', 'dead_letter') then 'permanent_failed'
    else 'failed'
  end;
  v_next_attempt_at := case
    when v_legacy_status = 'failed'
      then coalesce(v_delivery_result ->> 'next_attempt_at', now()::text)
    else ''
  end;

  if v_current_status = v_legacy_status
     and v_current_event_at is not null
     and p_occurred_at = v_current_event_at then
    return jsonb_build_object(
      'outcome', 'already_applied',
      'notification_id', v_notification_id,
      'status', v_normalized_status,
      'occurred_at', p_occurred_at
    );
  end if;

  v_new_channel := (
    v_channel
      - 'claim_token'
      - 'claimed_at'
  ) || jsonb_build_object(
    'required', true,
    'status', v_legacy_status,
    'delivery_status', v_provider_status,
    'delivery_occurred_at', p_occurred_at,
    'delivered_at', case
      when v_legacy_status = 'delivered' then to_jsonb(p_occurred_at)
      else v_channel -> 'delivered_at'
    end,
    'failed_at', case
      when v_legacy_status in ('failed', 'permanent_failed') then to_jsonb(p_occurred_at)
      else v_channel -> 'failed_at'
    end,
    'next_attempt_at', v_next_attempt_at,
    'error', case
      when v_legacy_status in ('failed', 'permanent_failed')
        then 'provider_delivery_failed'
      else ''
    end,
    'updated_at', now()
  );

  update public.notifications as notification
  set metadata = v_metadata || jsonb_build_object(
    'dispatch', coalesce(v_metadata -> 'dispatch', '{}'::jsonb)
      || jsonb_build_object('whatsapp', v_new_channel),
    'whatsapp_dispatch_required', true,
    'whatsapp_dispatch', v_new_channel,
    'whatsapp_delivery_reconciled_at', p_occurred_at
  )
  where notification.id = v_notification_id
    and notification.organization_id = p_organization_id;

  if not found then
    return jsonb_build_object('outcome', 'stale');
  end if;

  return jsonb_build_object(
    'outcome', 'applied',
    'notification_id', v_notification_id,
    'delivery_id', v_delivery_result ->> 'delivery_id',
    'status', v_normalized_status,
    'legacy_status', v_legacy_status,
    'occurred_at', p_occurred_at,
    'next_attempt_at', nullif(v_next_attempt_at, '')
  );
end
$function$;

revoke all on function private.reconcile_notification_whatsapp_delivery(
  uuid, text, text, timestamptz
) from PUBLIC, anon, authenticated, service_role;
grant execute on function private.reconcile_notification_whatsapp_delivery(
  uuid, text, text, timestamptz
) to service_role;

comment on function private.reconcile_notification_whatsapp_delivery(
  uuid, text, text, timestamptz
) is 'Reconciles one verified Evolution receipt against normalized and legacy state; a transient failed receipt is requeued with backoff instead of becoming terminal.';
