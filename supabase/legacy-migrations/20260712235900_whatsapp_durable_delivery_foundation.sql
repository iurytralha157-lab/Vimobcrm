-- Durable, backend-owned WhatsApp ingress and delivery foundation.
--
-- This migration deliberately does not backfill or move legacy rows. The Go
-- processor can be introduced in shadow mode and cut over session by session.
-- Raw provider payloads belong in the short-lived inbox, never in message
-- metadata returned to CRM users.

begin;
set local lock_timeout = '5s';

alter table public.whatsapp_messages
  add column if not exists updated_at timestamptz not null default now();

do $create_whatsapp_messages_updated_at_trigger$
begin
  if not exists (
    select 1
    from pg_catalog.pg_trigger
    where tgrelid = 'public.whatsapp_messages'::regclass
      and tgname = 'set_whatsapp_messages_updated_at'
      and not tgisinternal
  ) then
    create trigger set_whatsapp_messages_updated_at
    before update on public.whatsapp_messages
    for each row execute function private.set_updated_at();
  end if;
end;
$create_whatsapp_messages_updated_at_trigger$;

do $$
begin
  if exists (
    select 1
    from public.whatsapp_messages
    where client_message_id is not null
      and session_id is not null
    group by organization_id, session_id, client_message_id
    having count(*) > 1
  ) then
    raise exception using
      errcode = '23505',
      message = 'cannot enable WhatsApp DB-first idempotency: duplicate client_message_id exists within an organization/session';
  end if;
end;
$$;

-- Production rollout: this table is large. Pre-create this exact index name
-- with CREATE UNIQUE INDEX CONCURRENTLY, verify indisready/indisvalid, and only
-- then apply this transactional migration. The statement below becomes a no-op.
create unique index if not exists whatsapp_messages_org_session_client_message_uidx
  on public.whatsapp_messages(organization_id, session_id, client_message_id)
  where client_message_id is not null;

-- Production rollout: pre-create this exact index name with CREATE INDEX
-- CONCURRENTLY before applying the migration, for the same zero-downtime reason.
-- Matches the keyset pagination used by the Go history endpoint. Including the
-- UUID tie-breaker prevents gaps when several provider events have the same
-- timestamp and avoids sorting an entire large conversation for every page.
create index if not exists whatsapp_messages_org_conversation_timeline_idx
  on public.whatsapp_messages(
    organization_id,
    conversation_id,
    (coalesce(sent_at, created_at)) desc,
    id desc
  );

create table if not exists public.whatsapp_webhook_inbox (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  session_id uuid not null references public.whatsapp_sessions(id) on delete cascade,
  provider text not null default 'evolution_go',
  provider_instance_id text,
  event_key text not null,
  event_type text not null,
  payload jsonb not null,
  status text not null default 'pending',
  attempts integer not null default 0,
  max_attempts integer not null default 12,
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  last_error text,
  processed_at timestamptz,
  dead_lettered_at timestamptz,
  expires_at timestamptz not null default (now() + interval '30 days'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint whatsapp_webhook_inbox_event_key_unique unique (event_key),
  constraint whatsapp_webhook_inbox_status_check
    check (status in ('pending', 'processing', 'retry', 'processed', 'dead')),
  constraint whatsapp_webhook_inbox_attempts_check
    check (attempts >= 0 and max_attempts between 1 and 100),
  constraint whatsapp_webhook_inbox_event_key_check
    check (length(btrim(event_key)) between 1 and 512),
  constraint whatsapp_webhook_inbox_event_type_check
    check (length(btrim(event_type)) between 1 and 160),
  constraint whatsapp_webhook_inbox_lock_check
    check (
      (status = 'processing' and locked_at is not null and locked_by is not null)
      or status <> 'processing'
    )
);

drop index if exists public.whatsapp_webhook_inbox_claim_idx;
create index whatsapp_webhook_inbox_claim_idx
  on public.whatsapp_webhook_inbox(next_attempt_at, created_at, id)
  where status in ('pending', 'retry');

create index if not exists whatsapp_webhook_inbox_expired_lease_idx
  on public.whatsapp_webhook_inbox(locked_at, id)
  where status = 'processing';

create index if not exists whatsapp_webhook_inbox_session_created_idx
  on public.whatsapp_webhook_inbox(session_id, created_at desc, id desc);

create index if not exists whatsapp_webhook_inbox_organization_idx
  on public.whatsapp_webhook_inbox(organization_id);

create index if not exists whatsapp_webhook_inbox_dead_idx
  on public.whatsapp_webhook_inbox(dead_lettered_at, id)
  where status = 'dead';

create index if not exists whatsapp_webhook_inbox_expiry_idx
  on public.whatsapp_webhook_inbox(expires_at, id)
  where status in ('processed', 'dead');

create table if not exists public.whatsapp_outbox (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  session_id uuid not null references public.whatsapp_sessions(id) on delete cascade,
  conversation_id uuid not null references public.whatsapp_conversations(id) on delete cascade,
  message_id uuid not null references public.whatsapp_messages(id) on delete cascade,
  client_message_id text not null,
  recipient_jid text not null,
  message_type text not null default 'text',
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending',
  provider_message_id text,
  attempts integer not null default 0,
  max_attempts integer not null default 12,
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  last_error text,
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  failed_at timestamptz,
  dead_lettered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint whatsapp_outbox_message_unique unique (message_id),
  constraint whatsapp_outbox_client_message_unique
    unique (organization_id, session_id, client_message_id),
  constraint whatsapp_outbox_status_check
    check (status in (
      'pending', 'processing', 'retry', 'sent', 'delivered', 'read',
      'failed', 'dead'
    )),
  constraint whatsapp_outbox_attempts_check
    check (attempts >= 0 and max_attempts between 1 and 100),
  constraint whatsapp_outbox_client_message_id_check
    check (length(btrim(client_message_id)) between 1 and 512),
  constraint whatsapp_outbox_recipient_jid_check
    check (length(btrim(recipient_jid)) between 1 and 320),
  constraint whatsapp_outbox_lock_check
    check (
      (status = 'processing' and locked_at is not null and locked_by is not null)
      or status <> 'processing'
    )
);

create unique index if not exists whatsapp_outbox_session_provider_message_uidx
  on public.whatsapp_outbox(session_id, provider_message_id)
  where provider_message_id is not null;

drop index if exists public.whatsapp_outbox_claim_idx;
create index whatsapp_outbox_claim_idx
  on public.whatsapp_outbox(next_attempt_at, created_at, id)
  where status in ('pending', 'retry');

create index if not exists whatsapp_outbox_expired_lease_idx
  on public.whatsapp_outbox(locked_at, id)
  where status = 'processing';

create index if not exists whatsapp_outbox_session_org_idx
  on public.whatsapp_outbox(session_id, organization_id);

create index if not exists whatsapp_outbox_conversation_created_idx
  on public.whatsapp_outbox(conversation_id, created_at desc, id desc);

create index if not exists whatsapp_outbox_dead_idx
  on public.whatsapp_outbox(dead_lettered_at, id)
  where status = 'dead';

create index if not exists whatsapp_outbox_terminal_retention_idx
  on public.whatsapp_outbox(updated_at, id)
  where status in ('sent', 'delivered', 'read', 'failed', 'dead');

create table if not exists public.whatsapp_message_reactions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  session_id uuid not null references public.whatsapp_sessions(id) on delete cascade,
  conversation_id uuid not null references public.whatsapp_conversations(id) on delete cascade,
  target_message_id uuid references public.whatsapp_messages(id) on delete cascade,
  target_provider_message_id text not null,
  provider_reaction_message_id text,
  actor_jid text not null,
  actor_name text,
  from_me boolean not null default false,
  emoji text,
  status text not null default 'active',
  reacted_at timestamptz not null default now(),
  removed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint whatsapp_message_reactions_actor_unique
    unique (organization_id, session_id, target_provider_message_id, actor_jid),
  constraint whatsapp_message_reactions_status_check
    check (status in ('active', 'removed')),
  constraint whatsapp_message_reactions_target_provider_check
    check (length(btrim(target_provider_message_id)) between 1 and 512),
  constraint whatsapp_message_reactions_actor_check
    check (length(btrim(actor_jid)) between 1 and 320),
  constraint whatsapp_message_reactions_state_check
    check (
      (status = 'active' and emoji is not null and length(emoji) between 1 and 64 and removed_at is null)
      or (status = 'removed' and removed_at is not null)
    )
);

create unique index if not exists whatsapp_message_reactions_provider_event_uidx
  on public.whatsapp_message_reactions(session_id, provider_reaction_message_id)
  where provider_reaction_message_id is not null;

create index if not exists whatsapp_message_reactions_target_idx
  on public.whatsapp_message_reactions(conversation_id, target_provider_message_id, reacted_at, id)
  where status = 'active';

create index if not exists whatsapp_message_reactions_session_org_idx
  on public.whatsapp_message_reactions(session_id, organization_id);

create index if not exists whatsapp_message_reactions_target_message_idx
  on public.whatsapp_message_reactions(target_message_id)
  where target_message_id is not null;

-- Composite foreign keys would make the mutable session binding of a
-- conversation impossible to change while historical outbox rows exist. Keep
-- ordinary lifecycle FKs and validate the complete tenant shape at queue-write
-- time instead. New delivery rows are strict; legacy messages remain untouched.
create or replace function private.validate_whatsapp_worker_tenant_shape()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  shape_is_valid boolean := false;
begin
  if tg_table_name = 'whatsapp_webhook_inbox' then
    select exists (
      select 1
      from public.whatsapp_sessions as session
      where session.id = new.session_id
        and session.organization_id = new.organization_id
    ) into shape_is_valid;
  elsif tg_table_name = 'whatsapp_outbox' then
    select exists (
      select 1
      from public.whatsapp_sessions as session
      join public.whatsapp_conversations as conversation
        on conversation.id = new.conversation_id
       and conversation.organization_id = new.organization_id
       and conversation.session_id = new.session_id
      join public.whatsapp_messages as message
        on message.id = new.message_id
       and message.organization_id = new.organization_id
       and message.conversation_id = new.conversation_id
       and message.session_id = new.session_id
      where session.id = new.session_id
        and session.organization_id = new.organization_id
    ) into shape_is_valid;
  elsif tg_table_name = 'whatsapp_message_reactions' then
    select exists (
      select 1
      from public.whatsapp_sessions as session
      join public.whatsapp_conversations as conversation
        on conversation.id = new.conversation_id
       and conversation.organization_id = new.organization_id
       and conversation.session_id = new.session_id
      where session.id = new.session_id
        and session.organization_id = new.organization_id
        and (
          new.target_message_id is null
          or exists (
            select 1
            from public.whatsapp_messages as message
            where message.id = new.target_message_id
              and message.organization_id = new.organization_id
              and message.conversation_id = new.conversation_id
              and message.session_id = new.session_id
          )
        )
    ) into shape_is_valid;
  end if;

  if not shape_is_valid then
    raise exception using
      errcode = '23514',
      message = 'WhatsApp worker row crosses organization, session, conversation, or message boundaries';
  end if;

  return new;
end;
$$;

revoke all on function private.validate_whatsapp_worker_tenant_shape()
  from public, anon, authenticated;
grant execute on function private.validate_whatsapp_worker_tenant_shape()
  to service_role;

drop trigger if exists validate_whatsapp_webhook_inbox_tenant_shape on public.whatsapp_webhook_inbox;
create trigger validate_whatsapp_webhook_inbox_tenant_shape
before insert or update of organization_id, session_id
on public.whatsapp_webhook_inbox
for each row execute function private.validate_whatsapp_worker_tenant_shape();

drop trigger if exists validate_whatsapp_outbox_tenant_shape on public.whatsapp_outbox;
create trigger validate_whatsapp_outbox_tenant_shape
before insert or update of organization_id, session_id, conversation_id, message_id
on public.whatsapp_outbox
for each row execute function private.validate_whatsapp_worker_tenant_shape();

drop trigger if exists validate_whatsapp_reaction_tenant_shape on public.whatsapp_message_reactions;
create trigger validate_whatsapp_reaction_tenant_shape
before insert or update of organization_id, session_id, conversation_id, target_message_id
on public.whatsapp_message_reactions
for each row execute function private.validate_whatsapp_worker_tenant_shape();

drop trigger if exists set_whatsapp_webhook_inbox_updated_at on public.whatsapp_webhook_inbox;
create trigger set_whatsapp_webhook_inbox_updated_at
before update on public.whatsapp_webhook_inbox
for each row execute function private.set_updated_at();

drop trigger if exists set_whatsapp_outbox_updated_at on public.whatsapp_outbox;
create trigger set_whatsapp_outbox_updated_at
before update on public.whatsapp_outbox
for each row execute function private.set_updated_at();

drop trigger if exists set_whatsapp_message_reactions_updated_at on public.whatsapp_message_reactions;
create trigger set_whatsapp_message_reactions_updated_at
before update on public.whatsapp_message_reactions
for each row execute function private.set_updated_at();

-- Registering a duplicate provider event returns the canonical inbox row. A
-- collision with another tenant/session is rejected rather than silently mixed.
create or replace function private.enqueue_whatsapp_webhook_event(
  p_organization_id uuid,
  p_session_id uuid,
  p_provider text,
  p_provider_instance_id text,
  p_event_key text,
  p_event_type text,
  p_payload jsonb,
  p_max_attempts integer default 12
)
returns uuid
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  event_id uuid;
  existing_row public.whatsapp_webhook_inbox%rowtype;
begin
  insert into public.whatsapp_webhook_inbox (
    organization_id,
    session_id,
    provider,
    provider_instance_id,
    event_key,
    event_type,
    payload,
    max_attempts
  ) values (
    p_organization_id,
    p_session_id,
    coalesce(nullif(btrim(p_provider), ''), 'evolution_go'),
    nullif(btrim(p_provider_instance_id), ''),
    btrim(p_event_key),
    btrim(p_event_type),
    coalesce(p_payload, '{}'::jsonb),
    p_max_attempts
  )
  on conflict (event_key) do nothing
  returning id into event_id;

  if event_id is not null then
    return event_id;
  end if;

  select inbox.*
    into existing_row
  from public.whatsapp_webhook_inbox as inbox
  where inbox.event_key = btrim(p_event_key);

  if existing_row.id is null
     or existing_row.organization_id <> p_organization_id
     or existing_row.session_id <> p_session_id
     or existing_row.provider <> coalesce(nullif(btrim(p_provider), ''), 'evolution_go') then
    raise exception using
      errcode = '23505',
      message = 'whatsapp webhook event_key collision across provider or tenant';
  end if;

  return existing_row.id;
end;
$$;

create or replace function private.claim_whatsapp_webhook_inbox(
  p_worker_id text,
  p_limit integer default 50,
  p_lease interval default interval '5 minutes'
)
returns setof public.whatsapp_webhook_inbox
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  if nullif(btrim(p_worker_id), '') is null then
    raise exception 'worker id is required';
  end if;

  update public.whatsapp_webhook_inbox as exhausted
  set status = 'dead',
      dead_lettered_at = coalesce(exhausted.dead_lettered_at, now()),
      locked_at = null,
      locked_by = null,
      last_error = coalesce(exhausted.last_error, 'retry_exhausted')
  where exhausted.attempts >= exhausted.max_attempts
    and (
      (exhausted.status in ('pending', 'retry') and exhausted.next_attempt_at <= now())
      or (exhausted.status = 'processing' and exhausted.locked_at < now() - p_lease)
    );

  return query
  with candidates as (
    select inbox.id
    from public.whatsapp_webhook_inbox as inbox
    where inbox.attempts < inbox.max_attempts
      and (
        (inbox.status in ('pending', 'retry') and inbox.next_attempt_at <= now())
        or (inbox.status = 'processing' and inbox.locked_at < now() - p_lease)
      )
    order by inbox.next_attempt_at, inbox.created_at, inbox.id
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 50), 500))
  )
  update public.whatsapp_webhook_inbox as claimed
  set status = 'processing',
      attempts = claimed.attempts + 1,
      locked_at = now(),
      locked_by = btrim(p_worker_id),
      last_error = null
  from candidates
  where claimed.id = candidates.id
  returning claimed.*;
end;
$$;

create or replace function private.complete_whatsapp_webhook_event(
  p_event_id uuid,
  p_worker_id text
)
returns boolean
language sql
security invoker
set search_path = pg_catalog
as $$
  with completed as (
    update public.whatsapp_webhook_inbox
    set status = 'processed',
        processed_at = now(),
        locked_at = null,
        locked_by = null,
        last_error = null
    where id = p_event_id
      and status = 'processing'
      and locked_by = btrim(p_worker_id)
    returning id
  )
  select exists(select 1 from completed);
$$;

create or replace function private.fail_whatsapp_webhook_event(
  p_event_id uuid,
  p_worker_id text,
  p_error text,
  p_retry_at timestamptz default null
)
returns boolean
language sql
security invoker
set search_path = pg_catalog
as $$
  with failed as (
    update public.whatsapp_webhook_inbox
    set status = case when attempts >= max_attempts then 'dead' else 'retry' end,
        next_attempt_at = case
          when attempts >= max_attempts then next_attempt_at
          else coalesce(p_retry_at, now() + make_interval(secs => least(3600, 5 * power(2, least(attempts, 9))::integer)))
        end,
        dead_lettered_at = case when attempts >= max_attempts then now() else null end,
        locked_at = null,
        locked_by = null,
        last_error = left(coalesce(nullif(p_error, ''), 'unknown_error'), 4000)
    where id = p_event_id
      and status = 'processing'
      and locked_by = btrim(p_worker_id)
    returning id
  )
  select exists(select 1 from failed);
$$;

create or replace function private.enqueue_whatsapp_outbox(
  p_organization_id uuid,
  p_session_id uuid,
  p_conversation_id uuid,
  p_message_id uuid,
  p_client_message_id text,
  p_recipient_jid text,
  p_message_type text,
  p_payload jsonb,
  p_max_attempts integer default 12
)
returns uuid
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  outbox_id uuid;
  existing_row public.whatsapp_outbox%rowtype;
begin
  insert into public.whatsapp_outbox (
    organization_id,
    session_id,
    conversation_id,
    message_id,
    client_message_id,
    recipient_jid,
    message_type,
    payload,
    max_attempts
  ) values (
    p_organization_id,
    p_session_id,
    p_conversation_id,
    p_message_id,
    btrim(p_client_message_id),
    btrim(p_recipient_jid),
    coalesce(nullif(btrim(p_message_type), ''), 'text'),
    coalesce(p_payload, '{}'::jsonb),
    p_max_attempts
  )
  on conflict (organization_id, session_id, client_message_id) do nothing
  returning id into outbox_id;

  if outbox_id is not null then
    return outbox_id;
  end if;

  select queued.*
    into existing_row
  from public.whatsapp_outbox as queued
  where queued.organization_id = p_organization_id
    and queued.session_id = p_session_id
    and queued.client_message_id = btrim(p_client_message_id);

  if existing_row.id is null
     or existing_row.conversation_id <> p_conversation_id
     or existing_row.message_id <> p_message_id
     or existing_row.recipient_jid <> btrim(p_recipient_jid) then
    raise exception using
      errcode = '23505',
      message = 'whatsapp client_message_id collision with a different message';
  end if;

  return existing_row.id;
end;
$$;

create or replace function private.claim_whatsapp_outbox(
  p_worker_id text,
  p_limit integer default 50,
  p_lease interval default interval '5 minutes'
)
returns setof public.whatsapp_outbox
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  if nullif(btrim(p_worker_id), '') is null then
    raise exception 'worker id is required';
  end if;

  update public.whatsapp_outbox as exhausted
  set status = 'dead',
      dead_lettered_at = coalesce(exhausted.dead_lettered_at, now()),
      locked_at = null,
      locked_by = null,
      last_error = coalesce(exhausted.last_error, 'retry_exhausted')
  where exhausted.attempts >= exhausted.max_attempts
    and (
      (exhausted.status in ('pending', 'retry') and exhausted.next_attempt_at <= now())
      or (exhausted.status = 'processing' and exhausted.locked_at < now() - p_lease)
    );

  return query
  with candidates as (
    select queued.id
    from public.whatsapp_outbox as queued
    where queued.attempts < queued.max_attempts
      and (
        (queued.status in ('pending', 'retry') and queued.next_attempt_at <= now())
        or (queued.status = 'processing' and queued.locked_at < now() - p_lease)
      )
    order by queued.next_attempt_at, queued.created_at, queued.id
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 50), 500))
  )
  update public.whatsapp_outbox as claimed
  set status = 'processing',
      attempts = claimed.attempts + 1,
      locked_at = now(),
      locked_by = btrim(p_worker_id),
      last_error = null
  from candidates
  where claimed.id = candidates.id
  returning claimed.*;
end;
$$;

create or replace function private.mark_whatsapp_outbox_sent(
  p_outbox_id uuid,
  p_worker_id text,
  p_provider_message_id text,
  p_sent_at timestamptz default now()
)
returns boolean
language sql
security invoker
set search_path = pg_catalog
as $$
  with sent as (
    update public.whatsapp_outbox
    set status = 'sent',
        provider_message_id = nullif(btrim(p_provider_message_id), ''),
        sent_at = coalesce(p_sent_at, now()),
        locked_at = null,
        locked_by = null,
        last_error = null
    where id = p_outbox_id
      and status = 'processing'
      and locked_by = btrim(p_worker_id)
    returning id
  )
  select exists(select 1 from sent);
$$;

create or replace function private.fail_whatsapp_outbox(
  p_outbox_id uuid,
  p_worker_id text,
  p_error text,
  p_retry_at timestamptz default null,
  p_permanent boolean default false
)
returns boolean
language sql
security invoker
set search_path = pg_catalog
as $$
  with failed as (
    update public.whatsapp_outbox
    set status = case
          when p_permanent then 'failed'
          when attempts >= max_attempts then 'dead'
          else 'retry'
        end,
        next_attempt_at = case
          when p_permanent or attempts >= max_attempts then next_attempt_at
          else coalesce(p_retry_at, now() + make_interval(secs => least(3600, 5 * power(2, least(attempts, 9))::integer)))
        end,
        failed_at = case when p_permanent then now() else failed_at end,
        dead_lettered_at = case when not p_permanent and attempts >= max_attempts then now() else null end,
        locked_at = null,
        locked_by = null,
        last_error = left(coalesce(nullif(p_error, ''), 'unknown_error'), 4000)
    where id = p_outbox_id
      and status = 'processing'
      and locked_by = btrim(p_worker_id)
    returning id
  )
  select exists(select 1 from failed);
$$;

-- Worker state is not exposed to browser roles. The Go backend/service role is
-- the only application principal allowed to inspect or mutate these tables.
alter table public.whatsapp_webhook_inbox enable row level security;
alter table public.whatsapp_outbox enable row level security;
alter table public.whatsapp_message_reactions enable row level security;

revoke all on table public.whatsapp_webhook_inbox from public, anon, authenticated;
revoke all on table public.whatsapp_outbox from public, anon, authenticated;
revoke all on table public.whatsapp_message_reactions from public, anon, authenticated;

grant select, insert, update, delete on table public.whatsapp_webhook_inbox to service_role;
grant select, insert, update, delete on table public.whatsapp_outbox to service_role;
grant select, insert, update, delete on table public.whatsapp_message_reactions to service_role;

grant usage on schema private to service_role;

revoke all on function private.enqueue_whatsapp_webhook_event(uuid, uuid, text, text, text, text, jsonb, integer)
  from public, anon, authenticated;
revoke all on function private.claim_whatsapp_webhook_inbox(text, integer, interval)
  from public, anon, authenticated;
revoke all on function private.complete_whatsapp_webhook_event(uuid, text)
  from public, anon, authenticated;
revoke all on function private.fail_whatsapp_webhook_event(uuid, text, text, timestamptz)
  from public, anon, authenticated;
revoke all on function private.enqueue_whatsapp_outbox(uuid, uuid, uuid, uuid, text, text, text, jsonb, integer)
  from public, anon, authenticated;
revoke all on function private.claim_whatsapp_outbox(text, integer, interval)
  from public, anon, authenticated;
revoke all on function private.mark_whatsapp_outbox_sent(uuid, text, text, timestamptz)
  from public, anon, authenticated;
revoke all on function private.fail_whatsapp_outbox(uuid, text, text, timestamptz, boolean)
  from public, anon, authenticated;

grant execute on function private.enqueue_whatsapp_webhook_event(uuid, uuid, text, text, text, text, jsonb, integer)
  to service_role;
grant execute on function private.claim_whatsapp_webhook_inbox(text, integer, interval)
  to service_role;
grant execute on function private.complete_whatsapp_webhook_event(uuid, text)
  to service_role;
grant execute on function private.fail_whatsapp_webhook_event(uuid, text, text, timestamptz)
  to service_role;
grant execute on function private.enqueue_whatsapp_outbox(uuid, uuid, uuid, uuid, text, text, text, jsonb, integer)
  to service_role;
grant execute on function private.claim_whatsapp_outbox(text, integer, interval)
  to service_role;
grant execute on function private.mark_whatsapp_outbox_sent(uuid, text, text, timestamptz)
  to service_role;
grant execute on function private.fail_whatsapp_outbox(uuid, text, text, timestamptz, boolean)
  to service_role;

-- The legacy browser grants and policies intentionally remain unchanged here.
-- They are revoked only by the post-deploy backend cutover migration after the
-- Go API and new frontend are healthy, so this additive foundation is safe to
-- apply before the Portainer release without interrupting the live application.

comment on table public.whatsapp_webhook_inbox is
  'Private durable WhatsApp webhook inbox. Raw payloads are retained temporarily for replay and must never be returned to CRM users.';
comment on table public.whatsapp_outbox is
  'Private DB-first WhatsApp delivery outbox. Each row is bound to one canonical whatsapp_messages row.';
comment on table public.whatsapp_message_reactions is
  'Private normalized WhatsApp reaction state keyed by target provider message and actor.';

commit;
