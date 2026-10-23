-- Phase A: additive schema, bounded cleanup primitives, and a new message
-- state. The immutable prospective capture marker is activated in phase B.
-- This migration does not activate the seven-day cleanup or permit a new
-- physical conversation epoch. Those require the guarded unique-index cutover
-- after every writer has moved off ON CONFLICT (session_id, remote_jid).

begin;

set local lock_timeout = '5s';
set local statement_timeout = '2min';

-- No historical backfill: lead_id NULL can mean a previously linked lead was
-- deleted. Only a new, explicitly captured unlinked message marks a physical
-- conversation as eligible for the seven-day clock, anchored to created_at.
alter table public.whatsapp_conversations
  add column if not exists retired_at timestamptz;
alter table public.whatsapp_conversations
  add column if not exists unlinked_retention_v1 boolean not null default false;
alter table public.whatsapp_conversations
  add column if not exists unlinked_retention_scrubbed_at timestamptz;
alter table public.whatsapp_messages
  add column if not exists unlinked_retention_scrubbed_at timestamptz;

comment on column public.whatsapp_conversations.retired_at is
'Physical route retired for new events; retained as a minimal replay tombstone until dependent provenance can be safely removed.';
comment on column public.whatsapp_conversations.unlinked_retention_v1 is
'Prospective unlinked inbound conversation whose content expires seven days after conversation.created_at; false for historical rows and promoted leads.';
comment on column public.whatsapp_conversations.unlinked_retention_scrubbed_at is
'Set only after every canonical message and conversation preview for this expired unlinked epoch have been scrubbed; provider identity tombstones remain for replay.';

-- A NULL conversation lead does not prove that this physical row was never a
-- lead. Lead deletion can SET NULL on the conversation while canonical
-- messages and other ledgers retain evidence. Never classify or scrub such a
-- row as ephemeral even if the binding ledger is absent from older history.
create or replace function private.whatsapp_conversation_has_protected_history(
  p_conversation_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.whatsapp_conversation_lead_bindings as binding
    where binding.conversation_id = p_conversation_id
  ) or exists (
    select 1 from public.whatsapp_attendance_entries as attendance
    where attendance.conversation_id = p_conversation_id
  ) or exists (
    select 1 from public.whatsapp_messages as message
    where message.conversation_id = p_conversation_id
      and (
        message.lead_id is not null
        or message.from_me
        or message.direction <> 'inbound'
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

alter table public.whatsapp_conversations
  add constraint whatsapp_conversations_unlinked_retention_v1_check
  check (
    not unlinked_retention_v1
    or (lead_id is null and coalesce(is_group, false) = false)
  ) not valid;

-- Keep the existing owner-only Data API policy and apply the same cutoff used
-- by the backend list/history/media projections. Expiry is based on the
-- physical conversation's creation time, including old unmarked no-lead rows.
drop policy if exists whatsapp_conversations_select_owner_only
on public.whatsapp_conversations;
create policy whatsapp_conversations_select_owner_only
on public.whatsapp_conversations
for select to authenticated
using (
  retired_at is null
  and deleted_at is null
  and (
    lead_id is not null
    or coalesce(is_group, false)
    or created_at > pg_catalog.now() - interval '7 days'
  )
  and session_id is not null
  and exists (
    select 1
    from public.whatsapp_sessions as session
    where session.id = whatsapp_conversations.session_id
      and session.organization_id = whatsapp_conversations.organization_id
      and coalesce(session.is_active, true)
      and coalesce(session.status, '') <> 'deleted'
      and session.provider = 'evolution_go'
      and session.owner_user_id = (select auth.uid())
      and (
        exists (
          select 1 from public.users as app_user
          where app_user.id = (select auth.uid())
            and app_user.organization_id = session.organization_id
            and coalesce(app_user.is_active, true)
        )
        or exists (
          select 1 from public.organization_members as member
          where member.organization_id = session.organization_id
            and member.user_id = (select auth.uid())
            and member.is_active
        )
      )
  )
);

create or replace function private.guard_whatsapp_unlinked_retention_columns()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user not in ('postgres', 'service_role')
     and (
       new.retired_at is distinct from old.retired_at
       or new.unlinked_retention_v1 is distinct from old.unlinked_retention_v1
       or new.unlinked_retention_scrubbed_at is distinct from old.unlinked_retention_scrubbed_at
     ) then
    raise exception using errcode = '42501',
      message = 'whatsapp_unlinked_retention_columns_backend_only';
  end if;
  return new;
end;
$$;

revoke all on function private.guard_whatsapp_unlinked_retention_columns()
from public, anon, authenticated, service_role;
drop trigger if exists guard_whatsapp_unlinked_retention_columns
on public.whatsapp_conversations;
create trigger guard_whatsapp_unlinked_retention_columns
before update of retired_at, unlinked_retention_v1, unlinked_retention_scrubbed_at
on public.whatsapp_conversations
for each row execute function private.guard_whatsapp_unlinked_retention_columns();

-- The legacy constraint was NOT VALID to avoid scanning the message table.
-- Preserve that property and enforce the new state's no-lead/inbound boundary
-- on every future INSERT or UPDATE. The context trigger derives lead_id from
-- the conversation before this CHECK runs, so a linked conversation cannot
-- masquerade as unlinked by sending a NULL lead_id.
alter table public.whatsapp_messages
  drop constraint whatsapp_messages_capture_state_check;

alter table public.whatsapp_messages
  add constraint whatsapp_messages_capture_state_check
  check (
    capture_state is null
    or capture_state in ('legacy', 'captured', 'suppressed')
    or (
      capture_state = 'unlinked_ephemeral'
      and lead_id is null
      and from_me is false
      and direction = 'inbound'
    )
    or (
      capture_state = 'promoted_unlinked'
      and lead_id is not null
      and from_me is false
      and direction = 'inbound'
    )
  ) not valid;

comment on column public.whatsapp_messages.capture_state is
'Attendance capture gate. NULL means legacy-visible history; captured may emit lead effects; suppressed is backend-only; unlinked_ephemeral is an inbound no-lead message subject to conversation-created-at retention; promoted_unlinked is retained history attached during a pre-expiry lead promotion.';

-- The context trigger has already resolved organization/session/lead when this
-- trigger runs (PostgreSQL orders same-kind triggers by name). Locking the
-- conversation serializes capture with lead promotion and epoch retirement.
create or replace function private.mark_whatsapp_unlinked_retention_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conversation public.whatsapp_conversations%rowtype;
begin
  if new.capture_state is distinct from 'unlinked_ephemeral' then
    if new.capture_state = 'promoted_unlinked' then
      raise exception using errcode = '23514',
        message = 'promoted_unlinked_requires_existing_message';
    end if;
    return new;
  end if;

  select conversation.* into v_conversation
  from public.whatsapp_conversations as conversation
  where conversation.id = new.conversation_id
    and conversation.organization_id = new.organization_id
    and conversation.session_id = new.session_id
  for no key update;

  if not found or v_conversation.lead_id is not null
     or coalesce(v_conversation.is_group, false)
     or v_conversation.deleted_at is not null
     or v_conversation.retired_at is not null then
    raise exception using errcode = '23514',
      message = 'unlinked_message_requires_active_unbound_conversation';
  end if;
  if v_conversation.created_at <= pg_catalog.clock_timestamp() - interval '7 days' then
    raise exception using errcode = '23514',
      message = 'unlinked_conversation_epoch_expired';
  end if;
  if private.whatsapp_conversation_has_protected_history(v_conversation.id) then
    raise exception using errcode = '23514',
      message = 'unlinked_conversation_has_lead_history';
  end if;

  if not v_conversation.unlinked_retention_v1 then
    update public.whatsapp_conversations
    set unlinked_retention_v1 = true
    where id = v_conversation.id;
  end if;
  return new;
end;
$$;

revoke all on function private.mark_whatsapp_unlinked_retention_v1()
from public, anon, authenticated, service_role;
drop trigger if exists sz_mark_whatsapp_unlinked_retention_v1
on public.whatsapp_messages;
create trigger sz_mark_whatsapp_unlinked_retention_v1
before insert on public.whatsapp_messages
for each row execute function private.mark_whatsapp_unlinked_retention_v1();

-- Promotion happens in the same transaction as the canonical lead-binding
-- RPC. Only this conversation's retained inbound messages acquire the lead;
-- the distinct state records their origin and does not retroactively emit
-- attendance/automation/gamification INSERT effects.
-- The RPC plants an authorization row that this conversation trigger consumes.
-- A direct UPDATE on the conversation or message cannot mint that proof, and
-- no session GUC remains available for another statement in the transaction.
create table private.whatsapp_unlinked_promotion_authorizations (
  backend_pid integer not null,
  transaction_id bigint not null,
  organization_id uuid not null,
  conversation_id uuid not null,
  lead_id uuid not null,
  promotion_active boolean not null default false,
  primary key (backend_pid, transaction_id, conversation_id)
);

alter table private.whatsapp_unlinked_promotion_authorizations
  enable row level security;
alter table private.whatsapp_unlinked_promotion_authorizations
  force row level security;
revoke all on private.whatsapp_unlinked_promotion_authorizations
from public, anon, authenticated, service_role;

create or replace function private.whatsapp_unlinked_promotion_is_authorized(
  p_old public.whatsapp_messages,
  p_new public.whatsapp_messages
)
returns boolean
language sql
volatile
security definer
set search_path = ''
as $$
  select (p_old).capture_state = 'unlinked_ephemeral'
    and (p_old).lead_id is null
    and (p_new).capture_state = 'promoted_unlinked'
    and (p_new).lead_id is not null
    and (p_new).id is not distinct from (p_old).id
    and (p_new).organization_id is not distinct from (p_old).organization_id
    and (p_new).conversation_id is not distinct from (p_old).conversation_id
    and (p_new).session_id is not distinct from (p_old).session_id
    and (p_new).remote_jid is not distinct from (p_old).remote_jid
    and (p_new).provider_message_id is not distinct from (p_old).provider_message_id
    and (p_new).message_id is not distinct from (p_old).message_id
    and (p_new).from_me is not distinct from (p_old).from_me
    and (p_new).direction is not distinct from (p_old).direction
    and exists (
      select 1
      from private.whatsapp_unlinked_promotion_authorizations as authz
      where authz.backend_pid = pg_catalog.pg_backend_pid()
        and authz.transaction_id = pg_catalog.txid_current()
        and authz.organization_id = (p_old).organization_id
        and authz.conversation_id = (p_old).conversation_id
        and authz.lead_id = (p_new).lead_id
        and authz.promotion_active
    );
$$;

revoke all on function private.whatsapp_unlinked_promotion_is_authorized(
  public.whatsapp_messages, public.whatsapp_messages
) from public, anon, authenticated, service_role;

create or replace function private.promote_whatsapp_unlinked_retention_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.unlinked_retention_v1
     and old.lead_id is null
     and new.lead_id is not null then
    if old.retired_at is not null
       or old.created_at <= pg_catalog.clock_timestamp() - interval '7 days' then
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
      and not authz.promotion_active;
    if not found then
      raise exception using errcode = '23514',
        message = 'unlinked_promotion_requires_binding_rpc';
    end if;

    update public.whatsapp_messages as message
    set lead_id = new.lead_id,
        capture_state = 'promoted_unlinked'
    where message.organization_id = old.organization_id
      and message.conversation_id = old.id
      and message.lead_id is null
      and message.capture_state = 'unlinked_ephemeral';

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
drop trigger if exists sz_promote_whatsapp_unlinked_retention_v1
on public.whatsapp_conversations;
create trigger sz_promote_whatsapp_unlinked_retention_v1
before update of lead_id on public.whatsapp_conversations
for each row execute function private.promote_whatsapp_unlinked_retention_v1();

-- Patch exactly one known UPDATE site of the service-role-only canonical
-- binding RPC. The authorization is consumed by the conversation trigger in
-- the same statement; any source drift aborts this migration before a loose
-- promotion path can be installed.
do $authorize_canonical_unlinked_promotion$
declare
  v_rpc regprocedure := pg_catalog.to_regprocedure(
    'public.activate_whatsapp_conversation_lead_binding(uuid,uuid,uuid,text)'
  );
  v_definition text;
  v_old text := $old$
  update public.whatsapp_conversations
  set
    lead_id = p_lead_id,
$old$;
  v_new text := $new$
  if v_conversation.unlinked_retention_v1
     and v_previous_lead_id is null then
    insert into private.whatsapp_unlinked_promotion_authorizations (
      backend_pid, transaction_id, organization_id, conversation_id, lead_id
    ) values (
      pg_catalog.pg_backend_pid(), pg_catalog.txid_current(),
      p_organization_id, p_conversation_id, p_lead_id
    );
  end if;

  update public.whatsapp_conversations
  set
    lead_id = p_lead_id,
$new$;
begin
  if v_rpc is null then
    raise exception using errcode = '55000',
      message = 'unlinked_promotion_canonical_binding_rpc_missing';
  end if;
  select pg_catalog.replace(pg_catalog.replace(
    pg_catalog.pg_get_functiondef(v_rpc), E'\r\n', E'\n'
  ), E'\r', E'\n') into v_definition;
  v_old := pg_catalog.replace(pg_catalog.replace(v_old, E'\r\n', E'\n'), E'\r', E'\n');
  v_new := pg_catalog.replace(pg_catalog.replace(v_new, E'\r\n', E'\n'), E'\r', E'\n');
  if v_definition is null
     or not exists (
       select 1 from pg_catalog.pg_proc as procedure
       where procedure.oid = v_rpc
         and procedure.prosecdef
         and exists (
           select 1 from pg_catalog.unnest(procedure.proconfig) as setting
           where setting in ('search_path=', 'search_path=""')
         )
     )
     or pg_catalog.strpos(v_definition, v_old) = 0
     or pg_catalog.strpos(
       pg_catalog.substr(
         v_definition,
         pg_catalog.strpos(v_definition, v_old) + pg_catalog.length(v_old)
       ),
       v_old
     ) > 0 then
    raise exception using errcode = '55000',
      message = 'unlinked_promotion_canonical_binding_rpc_drift';
  end if;

  execute pg_catalog.replace(v_definition, v_old, v_new);
end;
$authorize_canonical_unlinked_promotion$;

create or replace function private.guard_whatsapp_unlinked_message_attribution()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.capture_state = 'unlinked_ephemeral' then
    if new.capture_state = 'unlinked_ephemeral' and new.lead_id is null then
      return new;
    end if;
    if new.capture_state = 'suppressed' and new.lead_id is null then
      return new;
    end if;
    if private.whatsapp_unlinked_promotion_is_authorized(old, new) then
      return new;
    end if;
    raise exception using errcode = '23514',
      message = 'whatsapp_unlinked_message_attribution_immutable';
  end if;

  if old.capture_state = 'promoted_unlinked'
     and (
       new.lead_id is distinct from old.lead_id
       or new.capture_state is distinct from old.capture_state
     ) then
    raise exception using errcode = '23514',
      message = 'whatsapp_promoted_unlinked_attribution_immutable';
  end if;
  return new;
end;
$$;

revoke all on function private.guard_whatsapp_unlinked_message_attribution()
from public, anon, authenticated, service_role;
drop trigger if exists ty_guard_whatsapp_unlinked_message_attribution
on public.whatsapp_messages;
create trigger ty_guard_whatsapp_unlinked_message_attribution
before update of lead_id, capture_state on public.whatsapp_messages
for each row execute function private.guard_whatsapp_unlinked_message_attribution();

-- The optional strict binding cutover installed a different context trigger
-- that rejects every lead_id UPDATE. Permit only the proof above in its UPDATE
-- branch. Databases still using the baseline context trigger are protected by
-- ty_guard_whatsapp_unlinked_message_attribution instead.
do $allow_strict_unlinked_promotion$
declare
  v_context regprocedure := pg_catalog.to_regprocedure(
    'public.set_whatsapp_message_context()'
  );
  v_definition text;
  v_old text := $old$
    raise exception using
      errcode = '23514',
      message = 'whatsapp_message_context_immutable';
  end if;
$old$;
  v_new text := $new$
    if private.whatsapp_unlinked_promotion_is_authorized(old, new) then
      return new;
    end if;

    raise exception using
      errcode = '23514',
      message = 'whatsapp_message_context_immutable';
  end if;
$new$;
begin
  if v_context is null then
    raise exception using errcode = '55000',
      message = 'unlinked_promotion_message_context_missing';
  end if;
  select pg_catalog.replace(pg_catalog.replace(
    pg_catalog.pg_get_functiondef(v_context), E'\r\n', E'\n'
  ), E'\r', E'\n') into v_definition;
  v_old := pg_catalog.replace(pg_catalog.replace(v_old, E'\r\n', E'\n'), E'\r', E'\n');
  v_new := pg_catalog.replace(pg_catalog.replace(v_new, E'\r\n', E'\n'), E'\r', E'\n');
  if pg_catalog.strpos(v_definition, 'whatsapp_message_context_immutable') > 0 then
    if pg_catalog.strpos(v_definition, v_old) = 0
       or pg_catalog.strpos(
         pg_catalog.substr(
           v_definition,
           pg_catalog.strpos(v_definition, v_old) + pg_catalog.length(v_old)
         ),
         v_old
       ) > 0 then
      raise exception using errcode = '55000',
        message = 'unlinked_promotion_strict_message_context_drift';
    end if;
    execute pg_catalog.replace(v_definition, v_old, v_new);
  elsif pg_catalog.strpos(v_definition, 'if new.lead_id is null then') = 0 then
    raise exception using errcode = '55000',
      message = 'unlinked_promotion_baseline_message_context_drift';
  end if;
end;
$allow_strict_unlinked_promotion$;

-- Called only for a newly captured v1 snapshot that froze this exact expired
-- conversation ID. A provider replay is routed to its original ID instead.
-- The full UNIQUE constraint is intentionally still present in phase A: fail
-- closed before retiring a row if phase B has not installed the active-only
-- unique index and removed the old constraint.
create or replace function public.retire_whatsapp_unlinked_conversation_epoch(
  p_organization_id uuid,
  p_session_id uuid,
  p_expected_conversation_id uuid,
  p_remote_jid text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conversation public.whatsapp_conversations%rowtype;
  v_retired_at timestamptz;
begin
  if p_organization_id is null or p_session_id is null
     or p_expected_conversation_id is null
     or nullif(pg_catalog.btrim(p_remote_jid), '') is null then
    raise exception using errcode = '22023',
      message = 'whatsapp_unlinked_epoch_arguments_required';
  end if;

  select conversation.* into v_conversation
  from public.whatsapp_conversations as conversation
  where conversation.id = p_expected_conversation_id
    and conversation.organization_id = p_organization_id
    and conversation.session_id = p_session_id
    and conversation.remote_jid = p_remote_jid
  for update;

  if not found then
    return pg_catalog.jsonb_build_object(
      'retired', false, 'conversation_id', p_expected_conversation_id,
      'reason', 'not_found'
    );
  end if;
  if v_conversation.retired_at is not null then
    return pg_catalog.jsonb_build_object(
      'retired', true, 'conversation_id', v_conversation.id,
      'reason', 'already_retired'
    );
  end if;
  if v_conversation.lead_id is not null
     or private.whatsapp_conversation_has_protected_history(v_conversation.id) then
    return pg_catalog.jsonb_build_object(
      'retired', false, 'conversation_id', v_conversation.id,
      'reason', 'lead_bound'
    );
  end if;
  if coalesce(v_conversation.is_group, false)
     or v_conversation.deleted_at is not null then
    return pg_catalog.jsonb_build_object(
      'retired', false, 'conversation_id', v_conversation.id,
      'reason', 'route_inactive'
    );
  end if;
  if v_conversation.created_at > pg_catalog.clock_timestamp() - interval '7 days' then
    return pg_catalog.jsonb_build_object(
      'retired', false, 'conversation_id', v_conversation.id,
      'reason', 'not_due'
    );
  end if;

  if exists (
    select 1 from pg_catalog.pg_constraint as constraint_state
    where constraint_state.conrelid = 'public.whatsapp_conversations'::regclass
      and constraint_state.conname = 'whatsapp_conversations_session_id_remote_jid_key'
  ) or not exists (
    select 1 from pg_catalog.pg_index as index_state
    join pg_catalog.pg_class as index_class on index_class.oid = index_state.indexrelid
    where index_state.indrelid = 'public.whatsapp_conversations'::regclass
      and index_class.relname = 'whatsapp_conversations_active_session_remote_jid_uidx'
      and index_state.indisunique and index_state.indisvalid
  ) then
    return pg_catalog.jsonb_build_object(
      'retired', false, 'conversation_id', v_conversation.id,
      'reason', 'cutover_required'
    );
  end if;

  v_retired_at := pg_catalog.clock_timestamp();
  update public.whatsapp_conversations
  set retired_at = v_retired_at,
      unlinked_retention_v1 = true,
      updated_at = v_retired_at
  where id = v_conversation.id;

  return pg_catalog.jsonb_build_object(
    'retired', true, 'conversation_id', v_conversation.id,
    'reason', 'expired'
  );
end;
$$;

revoke all on function public.retire_whatsapp_unlinked_conversation_epoch(
  uuid, uuid, uuid, text
) from public, anon, authenticated;
grant execute on function public.retire_whatsapp_unlinked_conversation_epoch(
  uuid, uuid, uuid, text
) to service_role;

-- Storage objects can be shared by a content-addressed media job in another
-- conversation. Retention records an object path, then the backend Storage
-- API worker deletes it only after checking that no live DB reference remains.
create table private.whatsapp_unlinked_media_gc (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  bucket_id text not null default 'whatsapp-media'
    check (bucket_id = 'whatsapp-media'),
  object_path text not null,
  source_conversation_id uuid not null,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'retry', 'completed', 'failed')),
  attempts integer not null default 0 check (attempts between 0 and 100),
  next_attempt_at timestamptz not null default clock_timestamp(),
  locked_at timestamptz,
  locked_by text,
  last_error text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  unique (organization_id, bucket_id, object_path),
  constraint whatsapp_unlinked_media_gc_path_check check (
    object_path like 'orgs/' || organization_id::text || '/%'
    and length(object_path) between 44 and 1024
    and position('..' in object_path) = 0
    and position(E'\\' in object_path) = 0
  ),
  constraint whatsapp_unlinked_media_gc_lease_check check (
    (status = 'processing' and locked_at is not null and locked_by is not null)
    or (status <> 'processing' and locked_at is null and locked_by is null)
  )
);

create index whatsapp_unlinked_media_gc_pending_idx
on private.whatsapp_unlinked_media_gc (next_attempt_at, created_at, id)
where status in ('pending', 'retry', 'processing');

alter table private.whatsapp_unlinked_media_gc enable row level security;
alter table private.whatsapp_unlinked_media_gc force row level security;
revoke all on private.whatsapp_unlinked_media_gc
from public, anon, authenticated, service_role;
grant select on private.whatsapp_unlinked_media_gc to service_role;

create or replace function private.claim_whatsapp_unlinked_media_gc(
  p_worker_id text,
  p_limit integer default 50,
  p_lease interval default interval '5 minutes'
)
returns setof private.whatsapp_unlinked_media_gc
language plpgsql
security definer
set search_path = ''
as $$
begin
  if nullif(pg_catalog.btrim(p_worker_id), '') is null
     or p_lease <= interval '0 seconds' then
    raise exception using errcode = '22023',
      message = 'whatsapp_unlinked_media_gc_worker_invalid';
  end if;

  return query
  with candidates as (
    select gc.id
    from private.whatsapp_unlinked_media_gc as gc
    where (
      (gc.status in ('pending', 'retry') and gc.next_attempt_at <= pg_catalog.clock_timestamp())
      or (gc.status = 'processing' and gc.locked_at < pg_catalog.clock_timestamp() - p_lease)
    )
      and gc.attempts < 12
      and not exists (
        select 1
        from public.whatsapp_messages as message
        join public.whatsapp_conversations as conversation
          on conversation.id = message.conversation_id
         and conversation.organization_id = message.organization_id
        where message.organization_id = gc.organization_id
          and message.media_storage_path = gc.object_path
          and conversation.retired_at is null
      )
      and not exists (
        select 1
        from public.media_jobs as job
        join public.whatsapp_conversations as conversation
          on conversation.id = job.conversation_id
         and conversation.organization_id = job.organization_id
        where job.organization_id = gc.organization_id
          and (
            job.storage_path = gc.object_path
            or job.message_key->>'upload_intent_path' = gc.object_path
            or job.message_key->>'repair_storage_path' = gc.object_path
          )
          and conversation.retired_at is null
      )
      and not exists (
        select 1 from public.leads as lead
        where lead.organization_id = gc.organization_id
          and lead.whatsapp_avatar_storage_path = gc.object_path
      )
    order by gc.next_attempt_at, gc.created_at, gc.id
    for update of gc skip locked
    limit least(greatest(coalesce(p_limit, 50), 1), 500)
  )
  update private.whatsapp_unlinked_media_gc as gc
  set status = 'processing',
      attempts = gc.attempts + 1,
      locked_at = pg_catalog.clock_timestamp(),
      locked_by = p_worker_id,
      updated_at = pg_catalog.clock_timestamp()
  from candidates
  where gc.id = candidates.id
  returning gc.*;
end;
$$;

revoke all on function private.claim_whatsapp_unlinked_media_gc(text, integer, interval)
from public, anon, authenticated;
grant execute on function private.claim_whatsapp_unlinked_media_gc(text, integer, interval)
to service_role;

create or replace function private.complete_whatsapp_unlinked_media_gc(
  p_id uuid,
  p_worker_id text,
  p_deleted boolean,
  p_error text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated boolean := false;
begin
  if p_id is null or nullif(pg_catalog.btrim(p_worker_id), '') is null
     or p_deleted is null then
    raise exception using errcode = '22023',
      message = 'whatsapp_unlinked_media_gc_result_invalid';
  end if;

  update private.whatsapp_unlinked_media_gc as gc
  set status = case
        when p_deleted then 'completed'
        when p_error = 'live_reference' then 'pending'
        when p_error = 'invalid_path' then 'failed'
        when gc.attempts >= 12 then 'failed'
        else 'retry'
      end,
      next_attempt_at = case
        when p_deleted then gc.next_attempt_at
        when p_error = 'live_reference' then pg_catalog.clock_timestamp() + interval '24 hours'
        else pg_catalog.clock_timestamp()
          + pg_catalog.make_interval(secs => least(3600, 30 * gc.attempts * gc.attempts))
      end,
      attempts = case
        when p_error = 'live_reference' then greatest(gc.attempts - 1, 0)
        else gc.attempts
      end,
      locked_at = null,
      locked_by = null,
      completed_at = case when p_deleted then pg_catalog.clock_timestamp() else null end,
      last_error = case when p_deleted then null else left(coalesce(p_error, 'storage_delete_failed'), 512) end,
      updated_at = pg_catalog.clock_timestamp()
  where gc.id = p_id
    and gc.status = 'processing'
    and gc.locked_by = p_worker_id
  returning true into v_updated;

  return coalesce(v_updated, false);
end;
$$;

revoke all on function private.complete_whatsapp_unlinked_media_gc(uuid, text, boolean, text)
from public, anon, authenticated;
grant execute on function private.complete_whatsapp_unlinked_media_gc(uuid, text, boolean, text)
to service_role;

create or replace function private.whatsapp_unlinked_media_gc_can_delete(
  p_id uuid,
  p_worker_id text
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_gc private.whatsapp_unlinked_media_gc%rowtype;
begin
  -- Caller must keep this transaction open through Storage DELETE and
  -- complete_whatsapp_unlinked_media_gc. A fresh path attachment takes a
  -- conflicting FOR SHARE lock on the same queue row.
  select gc.* into v_gc
  from private.whatsapp_unlinked_media_gc as gc
  where gc.id = p_id
  for update;

  if not found or v_gc.status <> 'processing'
     or v_gc.locked_by is distinct from p_worker_id
     or v_gc.locked_at < pg_catalog.clock_timestamp() - interval '5 minutes'
     or v_gc.bucket_id <> 'whatsapp-media'
     or v_gc.object_path not like 'orgs/' || v_gc.organization_id::text || '/%'
     or pg_catalog.strpos(v_gc.object_path, '..') > 0
     or pg_catalog.strpos(v_gc.object_path, E'\\') > 0 then
    return false;
  end if;
  if exists (
    select 1
    from public.whatsapp_messages as message
    join public.whatsapp_conversations as conversation
      on conversation.id = message.conversation_id
     and conversation.organization_id = message.organization_id
    where message.organization_id = v_gc.organization_id
      and message.media_storage_path = v_gc.object_path
      and conversation.retired_at is null
  ) or exists (
    select 1
    from public.media_jobs as job
    join public.whatsapp_conversations as conversation
      on conversation.id = job.conversation_id
     and conversation.organization_id = job.organization_id
    where job.organization_id = v_gc.organization_id
      and (
        job.storage_path = v_gc.object_path
        or job.message_key->>'upload_intent_path' = v_gc.object_path
        or job.message_key->>'repair_storage_path' = v_gc.object_path
      )
      and conversation.retired_at is null
  ) or exists (
    select 1 from public.leads as lead
    where lead.organization_id = v_gc.organization_id
      and lead.whatsapp_avatar_storage_path = v_gc.object_path
  ) then
    return false;
  end if;

  return true;
end;
$$;

revoke all on function private.whatsapp_unlinked_media_gc_can_delete(uuid, text)
from public, anon, authenticated;
grant execute on function private.whatsapp_unlinked_media_gc_can_delete(uuid, text)
to service_role;

create or replace function private.guard_whatsapp_message_media_gc_attach()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  if new.media_storage_path is null then
    return new;
  end if;
  if tg_op = 'UPDATE' then
    if new.media_storage_path is not distinct from old.media_storage_path then
      return new;
    end if;
  end if;
  select gc.status into v_status
  from private.whatsapp_unlinked_media_gc as gc
  where gc.organization_id = new.organization_id
    and gc.bucket_id = 'whatsapp-media'
    and gc.object_path = new.media_storage_path
  for share;
  if v_status = 'processing' then
    raise exception using errcode = '40001',
      message = 'whatsapp_media_gc_path_unavailable';
  end if;
  return new;
end;
$$;

revoke all on function private.guard_whatsapp_message_media_gc_attach()
from public, anon, authenticated, service_role;
drop trigger if exists sz_guard_whatsapp_message_media_gc_attach
on public.whatsapp_messages;
create trigger sz_guard_whatsapp_message_media_gc_attach
before insert or update of media_storage_path on public.whatsapp_messages
for each row execute function private.guard_whatsapp_message_media_gc_attach();

create or replace function private.guard_whatsapp_media_job_gc_attach()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_path text;
  v_status text;
begin
  for v_path in
    select distinct path_value
    from pg_catalog.unnest(array[
      new.storage_path,
      new.message_key->>'upload_intent_path',
      new.message_key->>'repair_storage_path'
    ]) as path_value
    where path_value is not null
    order by path_value
  loop
    if tg_op = 'UPDATE' then
      if v_path is not distinct from old.storage_path
         or v_path is not distinct from old.message_key->>'upload_intent_path'
         or v_path is not distinct from old.message_key->>'repair_storage_path' then
        continue;
      end if;
    end if;
    select gc.status into v_status
    from private.whatsapp_unlinked_media_gc as gc
    where gc.organization_id = new.organization_id
      and gc.bucket_id = 'whatsapp-media'
      and gc.object_path = v_path
    for share;
    if v_status = 'processing' then
      raise exception using errcode = '40001',
        message = 'whatsapp_media_gc_path_unavailable';
    end if;
  end loop;
  return new;
end;
$$;

revoke all on function private.guard_whatsapp_media_job_gc_attach()
from public, anon, authenticated, service_role;
drop trigger if exists guard_whatsapp_media_job_gc_attach
on public.media_jobs;
create trigger guard_whatsapp_media_job_gc_attach
before insert or update of storage_path, message_key on public.media_jobs
for each row execute function private.guard_whatsapp_media_job_gc_attach();

-- An INSERT must take a compatible lock on its parent conversation before
-- making a media job visible. The retention scrub holds FOR UPDATE on that
-- parent through job collection/deletion. Once the scrub commits, a waiting
-- INSERT sees the retired epoch and cannot schedule a late Storage upload.
create or replace function private.guard_whatsapp_media_job_epoch_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conversation public.whatsapp_conversations%rowtype;
begin
  select conversation.* into v_conversation
  from public.whatsapp_conversations as conversation
  where conversation.id = new.conversation_id
    and conversation.organization_id = new.organization_id
  for share;

  if found
     and v_conversation.unlinked_retention_v1
     and v_conversation.lead_id is null
     and not coalesce(v_conversation.is_group, false)
     and (
       v_conversation.retired_at is not null
       or v_conversation.created_at <= pg_catalog.clock_timestamp() - interval '7 days'
     ) then
    raise exception using errcode = '23514',
      message = 'expired_unlinked_media_job_forbidden';
  end if;
  return new;
end;
$$;

revoke all on function private.guard_whatsapp_media_job_epoch_insert()
from public, anon, authenticated, service_role;
drop trigger if exists guard_whatsapp_media_job_epoch_insert
on public.media_jobs;
create trigger guard_whatsapp_media_job_epoch_insert
before insert on public.media_jobs
for each row execute function private.guard_whatsapp_media_job_epoch_insert();

-- A delayed provider/media callback cannot refill a conversation after its
-- seven-day cutoff. Suppressed transport tombstones remain allowed only when
-- all user-facing content and sender fields are absent.
create or replace function private.guard_expired_whatsapp_unlinked_message_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conversation public.whatsapp_conversations%rowtype;
begin
  select conversation.* into v_conversation
  from public.whatsapp_conversations as conversation
  where conversation.id = new.conversation_id
    and conversation.organization_id = new.organization_id;

  if not found or not v_conversation.unlinked_retention_v1
     or v_conversation.lead_id is not null
     or coalesce(v_conversation.is_group, false)
     or (
       v_conversation.retired_at is null
       and v_conversation.created_at > pg_catalog.clock_timestamp() - interval '7 days'
     ) then
    return new;
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
drop trigger if exists zz_guard_expired_whatsapp_unlinked_message_write
on public.whatsapp_messages;
create trigger zz_guard_expired_whatsapp_unlinked_message_write
before insert or update of
  capture_state, content, media_url, media_storage_path, media_mime_type,
  media_error, sender_jid, sender_name, reaction_sender_jid,
  reaction_sender_name, metadata
on public.whatsapp_messages
for each row execute function private.guard_expired_whatsapp_unlinked_message_write();

-- No schedule is installed by this migration. The optional backend worker
-- calls this bounded function after phase B is activated. One physical
-- conversation is locked per call; provider IDs and remote_jid remain as
-- minimal replay tombstones, while text, media references, sender identity,
-- raw media jobs and chat preview are removed.
create or replace function private.scrub_expired_whatsapp_unlinked_conversations(
  p_message_limit integer default 500
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conversation public.whatsapp_conversations%rowtype;
  v_messages_scrubbed integer := 0;
  v_media_queued integer := 0;
  v_completed integer := 0;
  v_retired integer := 0;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if p_message_limit is null or p_message_limit < 1 or p_message_limit > 2000 then
    raise exception using errcode = '22023',
      message = 'whatsapp_unlinked_retention_limit_invalid';
  end if;
  if exists (
    select 1 from pg_catalog.pg_constraint as constraint_state
    where constraint_state.conrelid = 'public.whatsapp_conversations'::regclass
      and constraint_state.conname = 'whatsapp_conversations_session_id_remote_jid_key'
  ) then
    return pg_catalog.jsonb_build_object(
      'status', 'cutover_required', 'conversation_id', null,
      'conversations_retired', 0, 'messages_scrubbed', 0,
      'conversations_completed', 0, 'media_queued', 0
    );
  end if;

  select conversation.* into v_conversation
  from public.whatsapp_conversations as conversation
  where conversation.unlinked_retention_v1
    and conversation.lead_id is null
    and coalesce(conversation.is_group, false) = false
    and conversation.created_at <= v_now - interval '7 days'
    and conversation.unlinked_retention_scrubbed_at is null
    and not private.whatsapp_conversation_has_protected_history(conversation.id)
    and not exists (
      select 1 from public.media_jobs as job
      where job.conversation_id = conversation.id
        and job.status = 'processing'
    )
  order by conversation.created_at, conversation.id
  for update of conversation skip locked
  limit 1;

  if not found then
    return pg_catalog.jsonb_build_object(
      'status', 'idle', 'conversation_id', null,
      'conversations_retired', 0, 'messages_scrubbed', 0,
      'conversations_completed', 0, 'media_queued', 0
    );
  end if;

  -- The existing media claim uses FOR UPDATE SKIP LOCKED on job rows. If a
  -- claim wins, wait for its transaction, then refuse to scrub a processing
  -- job. If this lock wins, the claim skips these jobs and cannot upload a
  -- Storage object after our path snapshot. New INSERTs wait on the parent
  -- conversation lock above and are rejected by the epoch guard after commit.
  perform job.id
  from public.media_jobs as job
  where job.organization_id = v_conversation.organization_id
    and job.conversation_id = v_conversation.id
  order by job.id
  for update of job;

  if exists (
    select 1 from public.media_jobs as job
    where job.organization_id = v_conversation.organization_id
      and job.conversation_id = v_conversation.id
      and job.status = 'processing'
  ) then
    return pg_catalog.jsonb_build_object(
      'status', 'media_processing', 'conversation_id', v_conversation.id,
      'conversations_retired', 0, 'messages_scrubbed', 0,
      'conversations_completed', 0, 'media_queued', 0
    );
  end if;

  if v_conversation.retired_at is null then
    update public.whatsapp_conversations
    set retired_at = v_now,
        updated_at = v_now
    where id = v_conversation.id;
    v_retired := 1;
  end if;

  -- Collect every known Storage object reference before deleting media jobs
  -- or nulling message paths. Upsert requeues an object if it was reused after
  -- an earlier completed GC attempt; claim checks live references again.
  with paths as (
    select distinct path.object_path
    from (
      select message.media_storage_path as object_path
      from public.whatsapp_messages as message
      where message.conversation_id = v_conversation.id
      union all
      select job.storage_path
      from public.media_jobs as job
      where job.conversation_id = v_conversation.id
      union all
      select job.message_key->>'upload_intent_path'
      from public.media_jobs as job
      where job.conversation_id = v_conversation.id
      union all
      select job.message_key->>'repair_storage_path'
      from public.media_jobs as job
      where job.conversation_id = v_conversation.id
    ) as path
    where nullif(pg_catalog.btrim(path.object_path), '') is not null
  )
  insert into private.whatsapp_unlinked_media_gc as gc (
    organization_id, bucket_id, object_path, source_conversation_id
  )
  select v_conversation.organization_id, 'whatsapp-media', path.object_path,
    v_conversation.id
  from paths as path
  on conflict (organization_id, bucket_id, object_path)
  do update set
    source_conversation_id = excluded.source_conversation_id,
    status = case when gc.status in ('completed', 'failed') then 'pending' else gc.status end,
    next_attempt_at = case when gc.status in ('completed', 'failed') then v_now else gc.next_attempt_at end,
    completed_at = case when gc.status in ('completed', 'failed') then null else gc.completed_at end,
    updated_at = v_now;
  get diagnostics v_media_queued = row_count;

  delete from public.media_jobs as job
  where job.conversation_id = v_conversation.id
    and job.organization_id = v_conversation.organization_id;

  with candidates as (
    select message.id
    from public.whatsapp_messages as message
    where message.conversation_id = v_conversation.id
      and message.organization_id = v_conversation.organization_id
      and message.unlinked_retention_scrubbed_at is null
    order by message.id
    for update of message skip locked
    limit p_message_limit
  )
  update public.whatsapp_messages as message
  set capture_state = 'suppressed',
      content = null,
      media_url = null,
      media_mime_type = null,
      media_status = null,
      media_storage_path = null,
      media_error = null,
      media_size = null,
      sender_jid = null,
      sender_name = null,
      reaction_sender_jid = null,
      reaction_sender_name = null,
      reaction_emoji = null,
      metadata = '{"unlinked_retention_v1":"expired"}'::jsonb,
      unlinked_retention_scrubbed_at = v_now
  from candidates
  where message.id = candidates.id;
  get diagnostics v_messages_scrubbed = row_count;

  if not exists (
    select 1 from public.whatsapp_messages as message
    where message.conversation_id = v_conversation.id
      and message.unlinked_retention_scrubbed_at is null
  ) then
    delete from public.whatsapp_inbound_logs as log
    where log.conversation_id = v_conversation.id
      and log.organization_id = v_conversation.organization_id;

    update public.whatsapp_conversations
    set contact_name = null,
        contact_phone = null,
        contact_picture = null,
        last_message = null,
        last_message_preview = null,
        last_message_at = null,
        last_message_received_at = null,
        unread_count = 0,
        assigned_user_id = null,
        metadata = '{}'::jsonb,
        unlinked_retention_scrubbed_at = v_now,
        updated_at = v_now
    where id = v_conversation.id;
    v_completed := 1;
  end if;

  return pg_catalog.jsonb_build_object(
    'status', 'processed',
    'conversation_id', v_conversation.id,
    'conversations_retired', v_retired,
    'messages_scrubbed', v_messages_scrubbed,
    'conversations_completed', v_completed,
    'media_queued', v_media_queued
  );
end;
$$;

revoke all on function private.scrub_expired_whatsapp_unlinked_conversations(integer)
from public, anon, authenticated;
grant execute on function private.scrub_expired_whatsapp_unlinked_conversations(integer)
to service_role;

-- Keep the existing message broadcaster and conversation-touch trigger. The
-- broadcaster emits a content-free whatsapp.inbox.changed hint to the private
-- organization topic for every non-suppressed INSERT/content or status UPDATE.
-- Its lead-topic branch requires lead_id, which the CHECK above forbids for
-- unlinked_ephemeral. The API must still perform the owner-scoped data fetch.

-- The other six AFTER triggers feed lead-related effects. Exclude only the
-- new state; retain the exact legacy/captured/suppressed behavior, event kinds
-- and UPDATE column lists used by the currently deployed API.
drop trigger if exists gamification_canonical_whatsapp_insert_enqueue
on public.whatsapp_messages;
create trigger gamification_canonical_whatsapp_insert_enqueue
after insert on public.whatsapp_messages
for each row
when (
  new.capture_state is distinct from 'suppressed'
  and new.capture_state is distinct from 'unlinked_ephemeral'
  and new.capture_state is distinct from 'promoted_unlinked'
)
execute function private.enqueue_whatsapp_message_gamification();

drop trigger if exists gamification_canonical_whatsapp_status_enqueue
on public.whatsapp_messages;
create trigger gamification_canonical_whatsapp_status_enqueue
after update of status on public.whatsapp_messages
for each row
when (
  new.capture_state is distinct from 'suppressed'
  and new.capture_state is distinct from 'unlinked_ephemeral'
  and new.capture_state is distinct from 'promoted_unlinked'
)
execute function private.enqueue_whatsapp_message_gamification();

drop trigger if exists trg_capture_whatsapp_attention_fact
on public.whatsapp_messages;
create trigger trg_capture_whatsapp_attention_fact
after insert on public.whatsapp_messages
for each row
when (
  new.capture_state is distinct from 'suppressed'
  and new.capture_state is distinct from 'unlinked_ephemeral'
  and new.capture_state is distinct from 'promoted_unlinked'
)
execute function private.capture_whatsapp_attention_fact();

drop trigger if exists zz_automation_human_outbound_handoff
on public.whatsapp_messages;
create trigger zz_automation_human_outbound_handoff
after insert on public.whatsapp_messages
for each row
when (
  new.capture_state is distinct from 'suppressed'
  and new.capture_state is distinct from 'unlinked_ephemeral'
  and new.capture_state is distinct from 'promoted_unlinked'
)
execute function private.capture_automation_human_outbound_handoff();

drop trigger if exists zz_automation_inbound_message
on public.whatsapp_messages;
create trigger zz_automation_inbound_message
after insert on public.whatsapp_messages
for each row
when (
  new.capture_state is distinct from 'suppressed'
  and new.capture_state is distinct from 'unlinked_ephemeral'
  and new.capture_state is distinct from 'promoted_unlinked'
)
execute function private.capture_automation_inbound_message_event();

drop trigger if exists enqueue_whatsapp_avatar_after_message
on public.whatsapp_messages;
create trigger enqueue_whatsapp_avatar_after_message
after insert or update of
  status,
  direction,
  from_me,
  message_type,
  lead_id,
  session_id,
  conversation_id,
  remote_jid
on public.whatsapp_messages
for each row
when (
  new.capture_state is distinct from 'suppressed'
  and new.capture_state is distinct from 'unlinked_ephemeral'
  and new.capture_state is distinct from 'promoted_unlinked'
)
execute function private.enqueue_whatsapp_avatar_from_message();

commit;
