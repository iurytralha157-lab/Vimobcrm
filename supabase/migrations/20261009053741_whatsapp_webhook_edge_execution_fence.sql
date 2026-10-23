-- An HTTP timeout does not prove that the Edge request stopped executing.
-- Keep one durable execution token on the existing inbox row; do not create a
-- parallel delivery ledger. A reserved token can be cancelled before Edge
-- starts. An active token is released only after Edge has awaited its effects.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '5min';

alter table public.whatsapp_webhook_inbox
  add column edge_execution_id uuid,
  add column edge_execution_state text,
  add column edge_execution_reserved_at timestamptz,
  add column edge_execution_started_at timestamptz;

alter table public.whatsapp_webhook_inbox
  add constraint whatsapp_webhook_inbox_edge_execution_shape_check
  check (
    (
      edge_execution_id is null
      and edge_execution_state is null
      and edge_execution_reserved_at is null
      and edge_execution_started_at is null
    ) or (
      edge_execution_id is not null
      and edge_execution_state = 'reserved'
      and edge_execution_reserved_at is not null
      and edge_execution_started_at is null
    ) or (
      edge_execution_id is not null
      and edge_execution_state = 'active'
      and edge_execution_reserved_at is not null
      and edge_execution_started_at is not null
    )
  ) not valid;

comment on column public.whatsapp_webhook_inbox.edge_execution_id is
  'Opaque Go-to-Edge execution token. A non-null token fences session cutover even after an HTTP timeout.';
comment on column public.whatsapp_webhook_inbox.edge_execution_state is
  'Reserved before HTTP; active only after Edge begins and before its last awaited effect. No clock-only expiry for active.';
commit;

begin;
set local lock_timeout = '5s';
set local statement_timeout = '5min';

-- Go reserves before making the HTTP request. FOR KEY SHARE serializes with
-- activation's FOR UPDATE on the session. NULL means the claim is no longer
-- eligible; no Edge request may be sent without a returned token.
create or replace function public.reserve_whatsapp_webhook_edge_execution(
  p_organization_id uuid,
  p_session_id uuid,
  p_inbox_id uuid,
  p_worker_id text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_execution_id uuid := pg_catalog.gen_random_uuid();
begin
  if p_organization_id is null or p_session_id is null or p_inbox_id is null
    or coalesce(p_worker_id, '') not like 'vimob-api-evolution-webhook-epoch1-%'
  then
    return null;
  end if;

  perform 1 from public.whatsapp_sessions as session
  where session.id = p_session_id
    and session.organization_id = p_organization_id
    and session.provider = 'evolution_go'
  for key share;
  if not found or exists (
    select 1 from private.whatsapp_webhook_session_cutovers as cutover
    where cutover.session_id = p_session_id
  ) then
    return null;
  end if;

  update public.whatsapp_webhook_inbox as inbox
  set edge_execution_id = v_execution_id,
      edge_execution_state = 'reserved',
      edge_execution_reserved_at = clock_timestamp(),
      edge_execution_started_at = null,
      updated_at = now()
  where inbox.id = p_inbox_id
    and inbox.organization_id = p_organization_id
    and inbox.session_id = p_session_id
    and inbox.provider = 'evolution_go'
    and inbox.processing_epoch = 0
    and inbox.status = 'processing'
    and inbox.locked_by = p_worker_id
    and inbox.edge_execution_id is null;
  if not found then
    return null;
  end if;
  return v_execution_id;
end;
$$;

-- Edge must call this before QR, connection, label, status or message effects.
-- It cannot start after Go cancels a reservation or after epoch activation.
create or replace function public.start_whatsapp_webhook_edge_execution(
  p_organization_id uuid,
  p_session_id uuid,
  p_inbox_id uuid,
  p_execution_id uuid
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_organization_id is null or p_session_id is null or p_inbox_id is null
    or p_execution_id is null
  then
    return false;
  end if;

  perform 1 from public.whatsapp_sessions as session
  where session.id = p_session_id
    and session.organization_id = p_organization_id
    and session.provider = 'evolution_go'
  for key share;
  if not found or exists (
    select 1 from private.whatsapp_webhook_session_cutovers as cutover
    where cutover.session_id = p_session_id
  ) then
    return false;
  end if;

  update public.whatsapp_webhook_inbox as inbox
  set edge_execution_state = 'active',
      edge_execution_started_at = clock_timestamp(),
      updated_at = now()
  where inbox.id = p_inbox_id
    and inbox.organization_id = p_organization_id
    and inbox.session_id = p_session_id
    and inbox.provider = 'evolution_go'
    and inbox.processing_epoch = 0
    and inbox.status = 'processing'
    and inbox.edge_execution_id = p_execution_id
    and inbox.edge_execution_state = 'reserved';
  return found;
end;
$$;

-- Go may cancel only a reservation, including after a timeout or during stale
-- lease recovery. Cancellation and Edge start are compare-and-swap updates on
-- the same row; whichever commits first determines whether Edge may execute.
create or replace function public.cancel_whatsapp_webhook_edge_execution(
  p_organization_id uuid,
  p_session_id uuid,
  p_inbox_id uuid,
  p_execution_id uuid
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_organization_id is null or p_session_id is null or p_inbox_id is null
    or p_execution_id is null
  then
    return false;
  end if;
  update public.whatsapp_webhook_inbox as inbox
  set edge_execution_id = null,
      edge_execution_state = null,
      edge_execution_reserved_at = null,
      edge_execution_started_at = null,
      updated_at = now()
  where inbox.id = p_inbox_id
    and inbox.organization_id = p_organization_id
    and inbox.session_id = p_session_id
    and inbox.processing_epoch = 0
    and inbox.edge_execution_id = p_execution_id
    and inbox.edge_execution_state = 'reserved';
  return found;
end;
$$;

-- Edge calls finish in finally, after all database/provider effects have been
-- awaited. This also works if Go already moved the inbox to retry or dead.
-- A crashed active invocation remains fenced until an audited repair proves
-- that its runtime and outstanding PostgREST requests have stopped.
create or replace function public.finish_whatsapp_webhook_edge_execution(
  p_organization_id uuid,
  p_session_id uuid,
  p_inbox_id uuid,
  p_execution_id uuid
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_organization_id is null or p_session_id is null or p_inbox_id is null
    or p_execution_id is null
  then
    return false;
  end if;
  update public.whatsapp_webhook_inbox as inbox
  set edge_execution_id = null,
      edge_execution_state = null,
      edge_execution_reserved_at = null,
      edge_execution_started_at = null,
      updated_at = now()
  where inbox.id = p_inbox_id
    and inbox.organization_id = p_organization_id
    and inbox.session_id = p_session_id
    and inbox.processing_epoch = 0
    and inbox.edge_execution_id = p_execution_id
    and inbox.edge_execution_state = 'active';
  return found;
end;
$$;

revoke all on function public.reserve_whatsapp_webhook_edge_execution(uuid, uuid, uuid, text)
from public, anon, authenticated;
grant execute on function public.reserve_whatsapp_webhook_edge_execution(uuid, uuid, uuid, text)
to service_role;
revoke all on function public.start_whatsapp_webhook_edge_execution(uuid, uuid, uuid, uuid)
from public, anon, authenticated;
grant execute on function public.start_whatsapp_webhook_edge_execution(uuid, uuid, uuid, uuid)
to service_role;
revoke all on function public.cancel_whatsapp_webhook_edge_execution(uuid, uuid, uuid, uuid)
from public, anon, authenticated;
grant execute on function public.cancel_whatsapp_webhook_edge_execution(uuid, uuid, uuid, uuid)
to service_role;
revoke all on function public.finish_whatsapp_webhook_edge_execution(uuid, uuid, uuid, uuid)
from public, anon, authenticated;
grant execute on function public.finish_whatsapp_webhook_edge_execution(uuid, uuid, uuid, uuid)
to service_role;

commit;

-- Keep the existing two-argument activation API. Previously this only saw
-- status='processing'; after a lost HTTP ACK, the old Edge request could still
-- write while Go had already moved that row to retry/dead. Pending/retry rows
-- must also drain or be explicitly reconciled before becoming retained.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '5min';

create or replace function private.activate_whatsapp_webhook_session_cutover(
  p_organization_id uuid,
  p_session_id uuid
)
returns timestamptz
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_cutover_at timestamptz;
begin
  if p_organization_id is null or p_session_id is null then
    raise exception using errcode = '22023', message = 'whatsapp_cutover_scope_required';
  end if;

  perform 1
  from public.whatsapp_sessions as session
  where session.id = p_session_id
    and session.organization_id = p_organization_id
    and session.provider = 'evolution_go'
    and lower(btrim(coalesce(session.status, ''))) <> 'deleted'
  for update;
  if not found then
    raise exception using errcode = '23503', message = 'whatsapp_cutover_session_not_found';
  end if;

  select cutover.cutover_at into v_cutover_at
  from private.whatsapp_webhook_session_cutovers as cutover
  where cutover.session_id = p_session_id;
  -- Check even on an idempotent call. A retained terminal inbox row with an
  -- orphan token is an inconsistent execution state, not a successful reentry.
  if exists (
    select 1 from public.whatsapp_webhook_inbox as inbox
    where inbox.organization_id = p_organization_id
      and inbox.session_id = p_session_id
      and inbox.processing_epoch = 0
      and inbox.edge_execution_id is not null
  ) then
    raise exception using errcode = '55000', message = 'whatsapp_cutover_edge_execution_inflight';
  end if;
  if v_cutover_at is not null then
    return v_cutover_at;
  end if;

  if exists (
    select 1 from public.whatsapp_webhook_inbox as inbox
    where inbox.organization_id = p_organization_id
      and inbox.session_id = p_session_id
      and inbox.processing_epoch = 0
      and inbox.status = 'processing'
  ) then
    raise exception using errcode = '55000', message = 'whatsapp_cutover_legacy_inflight';
  end if;

  if exists (
    select 1 from public.whatsapp_webhook_inbox as inbox
    where inbox.organization_id = p_organization_id
      and inbox.session_id = p_session_id
      and inbox.processing_epoch = 0
      and inbox.status in ('pending', 'retry')
  ) then
    raise exception using errcode = '55000', message = 'whatsapp_cutover_legacy_pending';
  end if;

  v_cutover_at := clock_timestamp();
  insert into private.whatsapp_webhook_session_cutovers (
    session_id, active_epoch, cutover_at, activated_at
  ) values (p_session_id, 1, v_cutover_at, v_cutover_at);
  return v_cutover_at;
end;
$$;
revoke all on function private.activate_whatsapp_webhook_session_cutover(uuid, uuid)
from public, anon, authenticated;
grant execute on function private.activate_whatsapp_webhook_session_cutover(uuid, uuid)
to service_role;
commit;
