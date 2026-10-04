begin;
set local lock_timeout = '5s';
set local statement_timeout = '1min';

-- This migration only prepares the cutover. It does not activate any session
-- and does not change, claim, or discard an existing inbox event.
create table if not exists private.whatsapp_webhook_session_cutovers (
  session_id uuid primary key references public.whatsapp_sessions(id) on delete cascade,
  routing_epoch uuid not null default pg_catalog.gen_random_uuid(),
  cutoff_at timestamptz not null,
  activated_at timestamptz not null default clock_timestamp()
);

comment on table private.whatsapp_webhook_session_cutovers is
  'Forward-only per-session boundary for new WhatsApp webhook effects. Rows are inserted only after every API replica understands the boundary; old inbox rows are left untouched.';

alter table private.whatsapp_webhook_session_cutovers enable row level security;
revoke all on private.whatsapp_webhook_session_cutovers from public, anon, authenticated;
grant select on private.whatsapp_webhook_session_cutovers to service_role;

-- Operator-only activation. The session lock fences concurrent ingress and
-- claims, and the processing check refuses to cut over an in-flight event.
-- The caller must first verify that every API replica runs the new code.
create or replace function private.activate_whatsapp_webhook_session_cutover(
  p_session_id uuid
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session_id uuid;
  v_existing timestamptz;
  v_cutoff timestamptz;
begin
  select ws.id into v_session_id
  from public.whatsapp_sessions ws
  where ws.id = p_session_id
    and ws.provider = 'evolution_go'
    and coalesce(ws.is_active, true) = true
  for update;
  if v_session_id is null then
    raise exception using errcode = '22023', message = 'whatsapp_cutover_session_not_found';
  end if;

  select cutover.cutoff_at into v_existing
  from private.whatsapp_webhook_session_cutovers cutover
  where cutover.session_id = v_session_id;
  if v_existing is not null then
    return v_existing;
  end if;

  if exists (
    select 1 from public.whatsapp_webhook_inbox inbox
    where inbox.session_id = v_session_id
      and inbox.status = 'processing'
  ) then
    raise exception using errcode = '55000', message = 'whatsapp_cutover_has_inflight_webhooks';
  end if;

  -- The existing partial index orders each session's lane by created_at.
  -- Keeping that index valid lets the worker seek past the retained backlog
  -- using cutoff_at without building a new index on the large inbox table.
  if not coalesce((
    select index_state.indisready and index_state.indisvalid
    from pg_catalog.pg_index as index_state
    where index_state.indexrelid =
      to_regclass('public.whatsapp_webhook_inbox_lane_session_due_head_idx')
  ), false) then
    raise exception using errcode = '55000', message = 'whatsapp_cutover_claim_index_missing';
  end if;

  v_cutoff := clock_timestamp();
  insert into private.whatsapp_webhook_session_cutovers (
    session_id, cutoff_at, activated_at
  ) values (v_session_id, v_cutoff, v_cutoff);
  return v_cutoff;
end;
$$;

revoke all on function private.activate_whatsapp_webhook_session_cutover(uuid)
  from public, anon, authenticated, service_role;

-- A processed technical callback keeps an explicit reason through the normal
-- inbox retention path. This nullable addition does not rewrite existing rows.
alter table public.whatsapp_webhook_inbox
  add column if not exists ignored_reason text;

comment on column public.whatsapp_webhook_inbox.ignored_reason is
  'Reason for a technical webhook intentionally completed without CRM effects; NULL means normal processing.';

-- Both old and new API images execute embedded SQL against this table. Fence
-- ingress and claims at the database boundary, after serializing with the
-- per-session activation lock. A legacy image may still acknowledge a genuine
-- duplicate, but cannot create a fresh pre-cutover event after activation.
create or replace function private.fence_whatsapp_webhook_cutover_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_epoch uuid;
  v_cutoff timestamptz;
  v_marker text;
begin
  if new.provider is distinct from 'evolution_go' then
    return new;
  end if;

  perform 1
  from public.whatsapp_sessions ws
  where ws.id = new.session_id
    and ws.organization_id = new.organization_id
  for key share;
  if not found then
    raise exception using errcode = '23503', message = 'whatsapp_cutover_session_missing';
  end if;

  -- This second command sees a cutover committed before the session lock.
  select cutover.routing_epoch, cutover.cutoff_at into v_epoch, v_cutoff
  from private.whatsapp_webhook_session_cutovers cutover
  where cutover.session_id = new.session_id;
  if v_epoch is null then
    return new;
  end if;
  v_marker := new.payload #>> '{__vimob_ingress,cutover_epoch}';

  if tg_op = 'INSERT' then
    if v_marker is distinct from v_epoch::text
       or new.created_at < v_cutoff then
      -- BEFORE INSERT fires before ON CONFLICT. A stored provider replay may
      -- still reach its existing event key; an unseen legacy event cannot.
      if not exists (
        select 1
        from public.whatsapp_webhook_inbox existing
        where existing.event_key = new.event_key
          and existing.organization_id = new.organization_id
          and existing.session_id = new.session_id
      ) then
        raise exception using errcode = '55000', message = 'whatsapp_webhook_legacy_ingress_after_cutover';
      end if;
    end if;
  elsif (old.status is distinct from new.status or old.attempts is distinct from new.attempts)
    and (v_marker is distinct from v_epoch::text or new.created_at < v_cutoff) then
    raise exception using errcode = '55000', message = 'whatsapp_webhook_before_cutover';
  end if;

  if new.status = 'processing'
     and (tg_op = 'INSERT' or old.status is distinct from 'processing') then
    if v_marker is distinct from v_epoch::text or new.created_at < v_cutoff then
      raise exception using errcode = '55000', message = 'whatsapp_webhook_before_cutover';
    end if;
    -- The old binary's worker ID has a different prefix. Its stale claim SQL
    -- cannot transition a new-epoch row even during a rolling deployment.
    if coalesce(new.locked_by, '') not like 'vimob-api-evolution-webhook-cutover1-%' then
      raise exception using errcode = '55000', message = 'whatsapp_webhook_legacy_worker_after_cutover';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function private.fence_whatsapp_webhook_cutover_write()
  from public, anon, authenticated, service_role;

drop trigger if exists trg_fence_whatsapp_webhook_cutover_write
  on public.whatsapp_webhook_inbox;
create trigger trg_fence_whatsapp_webhook_cutover_write
before insert or update of status, attempts on public.whatsapp_webhook_inbox
for each row
when (new.provider = 'evolution_go')
execute function private.fence_whatsapp_webhook_cutover_write();

commit;
