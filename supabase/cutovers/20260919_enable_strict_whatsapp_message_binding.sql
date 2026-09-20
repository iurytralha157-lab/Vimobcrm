-- Cut over canonical WhatsApp message attribution only after API, Edge and Web
-- writers use the queue-scoped lead and binding contracts installed by A1/A2.
--
-- Required invocation inputs are an immutable deployed Git SHA and an explicit
-- smoke confirmation. They are operator attestations, not substitutes for the
-- release runbook checks documented in supabase/cutovers/README.md.
\set ON_ERROR_STOP on

\if :{?app_ready_release}
\else
  \echo 'Missing -v app_ready_release=<40-character deployed Git SHA>'
  \set app_ready_release missing
\endif

\if :{?app_smoke_confirmed}
\else
  \echo 'Missing -v app_smoke_confirmed=true'
  \set app_smoke_confirmed false
\endif

\if :app_smoke_confirmed
\else
  \echo 'app_smoke_confirmed must be true after the compatible-deploy smoke checks'
\endif

\if :{?workers_quiesced}
\else
  \echo 'Missing -v workers_quiesced=true'
  \set workers_quiesced false
\endif

\if :workers_quiesced
\else
  \echo 'workers_quiesced must be true after ingress/workers are paused and drained'
\endif

\if :{?intake_quiesced}
\else
  \echo 'Missing -v intake_quiesced=true'
  \set intake_quiesced false
\endif

\if :intake_quiesced
\else
  \echo 'intake_quiesced must remain true from before A1 until after B2 smokes'
\endif

select pg_catalog.set_config(
  'vimob.queue_scoped_lead_app_ready_release',
  :'app_ready_release',
  false
);

select pg_catalog.set_config(
  'vimob.queue_scoped_lead_app_smoke_confirmed',
  :'app_smoke_confirmed',
  false
);

select pg_catalog.set_config(
  'vimob.queue_scoped_lead_workers_quiesced',
  :'workers_quiesced',
  false
);

select pg_catalog.set_config(
  'vimob.queue_scoped_lead_intake_quiesced',
  :'intake_quiesced',
  false
);

begin;

set local lock_timeout = '5s';
set local statement_timeout = '5min';

-- A short maintenance window is mandatory. These locks make the operational
-- quiesce provable and close races between the final NULL-snapshot backfill,
-- binding materialization and installation of the strict triggers.
lock table
  public.whatsapp_webhook_inbox,
  public.whatsapp_webhook_routing_snapshots,
  public.whatsapp_webhook_routing_outcomes,
  public.whatsapp_conversation_routing_heads,
  public.whatsapp_conversations,
  public.whatsapp_conversation_lead_bindings,
  public.whatsapp_messages,
  public.whatsapp_inbound_logs,
  public.whatsapp_outbox,
  public.outbox_messages,
  public.ai_jobs,
  public.jobs,
  public.ai_outbox_messages,
  public.automation_event_outbox,
  public.automation_executions,
  public.automation_execution_steps,
  public.automation_effect_dispatches
in share row exclusive mode;

do $$
declare
  v_app_ready_release text := pg_catalog.current_setting(
    'vimob.queue_scoped_lead_app_ready_release',
    true
  );
  v_app_smoke_confirmed text := pg_catalog.current_setting(
    'vimob.queue_scoped_lead_app_smoke_confirmed',
    true
  );
  v_workers_quiesced text := pg_catalog.current_setting(
    'vimob.queue_scoped_lead_workers_quiesced',
    true
  );
  v_intake_quiesced text := pg_catalog.current_setting(
    'vimob.queue_scoped_lead_intake_quiesced',
    true
  );
begin
  if v_app_ready_release is null
     or v_app_ready_release !~ '^[0-9a-f]{40}$'
     or v_app_smoke_confirmed is distinct from 'true'
     or v_workers_quiesced is distinct from 'true'
     or v_intake_quiesced is distinct from 'true' then
    raise exception using
      errcode = '55000',
      message = 'queue_scoped_lead_compatible_app_not_attested';
  end if;

  if exists (
    select 1
    from public.whatsapp_outbox as outbox
    where outbox.status = 'processing'
  ) or exists (
    select 1
    from public.outbox_messages as legacy_outbox
    where legacy_outbox.status = 'processing'
  ) or exists (
    select 1
    from public.ai_jobs as job
    where job.conversation_id is not null
      and job.status = 'processing'
  ) or exists (
    select 1
    from public.jobs as job
    where job.job_type = 'whatsapp_ai_autoreply'
      and job.status = 'processing'
  ) or exists (
    select 1
    from public.ai_outbox_messages as ai_outbox
    where ai_outbox.status = 'sending'
  ) or exists (
    select 1
    from public.automation_event_outbox as event_outbox
    where event_outbox.conversation_id is not null
      and event_outbox.status = 'processing'
  ) or exists (
    select 1
    from public.automation_executions as execution
    where execution.conversation_id is not null
      and execution.status = 'running'
  ) or exists (
    select 1
    from public.automation_effect_dispatches as dispatch
    join public.automation_executions as execution
      on execution.id = dispatch.execution_id
     and execution.organization_id = dispatch.organization_id
    where execution.conversation_id is not null
      and dispatch.status = 'sending'
  ) then
    raise exception using
      errcode = '55000',
      message = 'whatsapp_binding_cutover_delivery_in_flight',
      hint = 'Keep ingress/workers quiesced, reconcile every processing/sending row, then retry.';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_attribute as attribute
    where attribute.attrelid = 'public.leads'::regclass
      and attribute.attname = 'intake_scope_key'
      and not attribute.attisdropped
  ) or not exists (
    select 1
    from pg_catalog.pg_attribute as attribute
    where attribute.attrelid = 'public.leads'::regclass
      and attribute.attname = 'origin_round_robin_id'
      and not attribute.attisdropped
  ) or not exists (
    select 1
    from pg_catalog.pg_attribute as attribute
    where attribute.attrelid = 'public.outbox_messages'::regclass
      and attribute.attname = 'lead_id'
      and not attribute.attisdropped
  ) then
    raise exception using
      errcode = '55000',
      message = 'queue_scoped_lead_columns_not_ready';
  end if;

  if pg_catalog.to_regclass('public.whatsapp_conversation_lead_bindings') is null
     or pg_catalog.to_regprocedure(
       'public.activate_whatsapp_conversation_lead_binding(uuid,uuid,uuid,text)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.activate_whatsapp_conversation_lead_binding(uuid,uuid,uuid,text,text)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.activate_whatsapp_conversation_lead_binding_if_current(uuid,uuid,uuid,text,uuid,uuid)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.find_lead_by_normalized_phone(uuid,text,uuid)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.upsert_whatsapp_webhook_lead(uuid,text,text,text,text,timestamp with time zone,text,uuid,text,text,text,uuid,uuid,uuid,timestamp with time zone,uuid,uuid,uuid,timestamp with time zone,text,timestamp with time zone,jsonb,uuid)'
     ) is null then
    raise exception using
      errcode = '55000',
      message = 'queue_scoped_lead_contract_not_ready';
  end if;

  if pg_catalog.to_regprocedure(
       'private.is_terminal_whatsapp_lead_resolution_quarantine(jsonb,boolean,text,text)'
     ) is null then
    raise exception using
      errcode = '55000',
      message = 'whatsapp_terminal_quarantine_contract_not_ready';
  end if;

  -- Reserved ingress provenance and quarantine metadata are trusted only when
  -- canonical messages are backend-written. B1 may remove stale table grants
  -- below, but it must not paper over a surviving browser RLS write policy or
  -- a backend role that cannot persist the canonical row.
  if not pg_catalog.has_table_privilege(
       'service_role',
       'public.whatsapp_messages',
       'SELECT'
     )
     or not pg_catalog.has_table_privilege(
       'service_role',
       'public.whatsapp_messages',
       'INSERT'
     )
     or not pg_catalog.has_table_privilege(
       'service_role',
       'public.whatsapp_messages',
       'UPDATE'
     )
     or not pg_catalog.has_table_privilege(
       'service_role',
       'public.whatsapp_messages',
       'DELETE'
     ) then
    raise exception using
      errcode = '55000',
      message = 'whatsapp_message_backend_writer_privileges_not_ready';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_policies as policy
    where policy.schemaname = 'public'
      and policy.tablename = 'whatsapp_messages'
      and policy.cmd = any (array['ALL', 'INSERT', 'UPDATE', 'DELETE']::text[])
      and policy.roles && array['public', 'anon', 'authenticated']::name[]
  ) then
    raise exception using
      errcode = '55000',
      message = 'whatsapp_message_browser_write_policy_survived',
      hint = 'Apply/reconcile the WhatsApp backend-only boundary before B1.';
  end if;

  if pg_catalog.to_regprocedure(
       'private.capture_whatsapp_webhook_routing_snapshot(uuid,uuid,text,text,text,text,boolean,text[],text,text,text,boolean,boolean,boolean,uuid,uuid,uuid)'
     ) is null
     or pg_catalog.to_regclass('public.whatsapp_webhook_routing_snapshots') is null
     or pg_catalog.to_regclass('public.whatsapp_webhook_routing_outcomes') is null
     or pg_catalog.to_regclass('public.whatsapp_conversation_routing_heads') is null
     or pg_catalog.to_regprocedure(
       'public.resolve_whatsapp_webhook_inherited_routing_target(uuid,uuid,text)'
     ) is null
     or pg_catalog.to_regprocedure(
       'private.cleanup_whatsapp_webhook_routing_provenance(integer,timestamp with time zone)'
     ) is null
     or not exists (
       select 1
       from pg_catalog.pg_trigger as trigger_state
       where trigger_state.tgrelid = 'public.whatsapp_webhook_inbox'::regclass
         and trigger_state.tgname = 'preserve_whatsapp_webhook_routing_snapshot_before_update'
         and not trigger_state.tgisinternal
         and trigger_state.tgenabled in ('O', 'A')
     ) then
    raise exception using
      errcode = '55000',
      message = 'whatsapp_webhook_routing_snapshot_contract_not_ready';
  end if;

  if exists (
    select 1
    from public.whatsapp_webhook_inbox as inbox
    where inbox.status in ('pending', 'retry', 'processing')
      and coalesce(inbox.payload #>> '{__vimob_ingress,routing_snapshot,version}', '') <> '1'
  ) then
    raise exception using
      errcode = '55000',
      message = 'whatsapp_webhook_legacy_provenance_backlog_not_drained',
      hint = 'Drain each legacy row through the compatible worker or quarantine it as dead with an audited reason before B1. Never let it inherit a later binding.';
  end if;

  if exists (
    select 1
    from public.whatsapp_webhook_inbox as inbox
    cross join lateral pg_catalog.jsonb_array_elements(
      case
        when pg_catalog.jsonb_typeof(
          inbox.payload #> '{__vimob_ingress,routing_snapshot,messages}'
        ) = 'array'
          then inbox.payload #> '{__vimob_ingress,routing_snapshot,messages}'
        else '[]'::jsonb
      end
    ) as payload_route(snapshot)
    left join public.whatsapp_webhook_routing_snapshots as routing_snapshot
      on routing_snapshot.organization_id = inbox.organization_id
     and routing_snapshot.session_id = inbox.session_id
     and routing_snapshot.provider_message_id =
       nullif(payload_route.snapshot->>'provider_message_id', '')
     and routing_snapshot.snapshot = payload_route.snapshot
    where inbox.status in ('pending', 'retry', 'processing')
      and routing_snapshot.provider_message_id is null
  ) or exists (
    select 1
    from public.whatsapp_webhook_inbox as inbox
    where inbox.status in ('pending', 'retry', 'processing')
      and lower(coalesce(inbox.event_type, '')) like '%message%'
      and pg_catalog.jsonb_array_length(
        case
          when pg_catalog.jsonb_typeof(
            inbox.payload #> '{__vimob_ingress,routing_snapshot,messages}'
          ) = 'array'
            then inbox.payload #> '{__vimob_ingress,routing_snapshot,messages}'
          else '[]'::jsonb
        end
      ) = 0
  ) then
    raise exception using
      errcode = '55000',
      message = 'whatsapp_webhook_active_provenance_ledger_mismatch',
      hint = 'Quarantine the malformed active row; never reconstruct its route from a mutable conversation.';
  end if;

  if exists (
    select 1
    from public.whatsapp_webhook_routing_snapshots as routing_snapshot
    where routing_snapshot.binding_eligible
      and not exists (
        select 1
        from public.whatsapp_webhook_inbox as inbox
        where inbox.organization_id = routing_snapshot.organization_id
          and inbox.session_id = routing_snapshot.session_id
          and exists (
            select 1
            from pg_catalog.jsonb_array_elements(
              case
                when pg_catalog.jsonb_typeof(
                  inbox.payload #> '{__vimob_ingress,routing_snapshot,messages}'
                ) = 'array'
                  then inbox.payload #> '{__vimob_ingress,routing_snapshot,messages}'
                else '[]'::jsonb
              end
            ) as payload_route(snapshot)
            where payload_route.snapshot->>'provider_message_id' =
              routing_snapshot.provider_message_id
          )
      )
      and not exists (
        select 1
        from public.whatsapp_webhook_routing_outcomes as routing_outcome
        where routing_outcome.organization_id = routing_snapshot.organization_id
          and routing_outcome.session_id = routing_snapshot.session_id
          and routing_outcome.provider_message_id = routing_snapshot.provider_message_id
          and routing_outcome.ingress_sequence = routing_snapshot.ingress_sequence
      )
  ) then
    raise exception using
      errcode = '55000',
      message = 'whatsapp_webhook_unresolved_provenance_without_receipt',
      hint = 'Rollback/reconcile the orphan ledger before enabling B1.';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_index as index_state
    where index_state.indexrelid =
      pg_catalog.to_regclass('public.leads_org_scope_phone_unique')
      and index_state.indisunique
      and index_state.indisvalid
      and index_state.indisready
  ) then
    raise exception using
      errcode = '55000',
      message = 'queue_scoped_lead_phone_index_not_ready';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_index as index_state
    where index_state.indexrelid =
      pg_catalog.to_regclass('public.outbox_messages_active_lead_idx')
      and index_state.indisvalid
      and index_state.indisready
  ) then
    raise exception using
      errcode = '55000',
      message = 'outbox_messages_active_lead_index_not_ready';
  end if;
end;
$$;

-- Provider routing snapshots, terminal quarantine reasons and automation
-- eligibility markers live in whatsapp_messages.metadata. Browser roles must
-- never be able to forge those reserved fields; all message writes go through
-- the tenant-scoped Go/Edge backend boundary.
revoke insert, update, delete, truncate
on table public.whatsapp_messages
from public, anon, authenticated;

-- Once the legacy active backlog is empty, every pending/retry/processing row
-- must carry the ingress-owned v1 envelope. Processed/dead history remains
-- readable without rewriting source bytes.
alter table public.whatsapp_webhook_inbox
  drop constraint if exists whatsapp_webhook_active_routing_snapshot_v1_check;

alter table public.whatsapp_webhook_inbox
  add constraint whatsapp_webhook_active_routing_snapshot_v1_check
  check (
    status in ('processed', 'dead')
    or coalesce(
      payload #>> '{__vimob_ingress,routing_snapshot,version}',
      ''
    ) = '1'
  ) not valid;

alter table public.whatsapp_webhook_inbox
  validate constraint whatsapp_webhook_active_routing_snapshot_v1_check;

-- Cover conversations created during the A1 -> compatible-writers rollout
-- window. An existing but divergent active binding is not guessed or repaired.
insert into public.whatsapp_conversation_lead_bindings (
  organization_id,
  conversation_id,
  session_id,
  lead_id,
  previous_lead_id,
  assigned_user_id,
  changed,
  active_from
)
select
  conversation.organization_id,
  conversation.id,
  conversation.session_id,
  conversation.lead_id,
  null,
  case
    when exists (
      select 1
      from public.organization_members as membership
      join public.users as app_user
        on app_user.id = membership.user_id
       and app_user.is_active = true
      where membership.organization_id = conversation.organization_id
        and membership.user_id = conversation.assigned_user_id
        and membership.is_active = true
        and membership.deleted_at is null
    ) then conversation.assigned_user_id
    else null
  end,
  true,
  coalesce(conversation.created_at, clock_timestamp())
from public.whatsapp_conversations as conversation
where conversation.lead_id is not null
  and not exists (
    select 1
    from public.whatsapp_conversation_lead_bindings as binding
    where binding.conversation_id = conversation.id
      and binding.active_to is null
  );

-- Close the A1 -> compatible-writers window: legacy writers could still have
-- inserted a NULL lead snapshot after A1. Freeze those rows immediately before
-- enforcing the strict insert contract.
update public.whatsapp_messages as message
set lead_id = conversation.lead_id
from public.whatsapp_conversations as conversation
where conversation.id = message.conversation_id
  and conversation.organization_id = message.organization_id
  and conversation.lead_id is not null
  and message.lead_id is null
  and not private.is_terminal_whatsapp_lead_resolution_quarantine(
    message.metadata,
    message.from_me,
    message.provider_message_id,
    message.message_id
  );

do $$
begin
  if exists (
    select 1
    from public.whatsapp_messages as message
    join public.whatsapp_conversations as conversation
      on conversation.id = message.conversation_id
     and conversation.organization_id = message.organization_id
    where conversation.lead_id is not null
      and message.lead_id is null
      and not private.is_terminal_whatsapp_lead_resolution_quarantine(
        message.metadata,
        message.from_me,
        message.provider_message_id,
        message.message_id
      )
  ) then
    raise exception using
      errcode = '23514',
      message = 'linked_whatsapp_message_without_lead_snapshot';
  end if;
end;
$$;

update public.whatsapp_inbound_logs as inbound_log
set
  lead_id = conversation.lead_id,
  assigned_user_id = coalesce(
    inbound_log.assigned_user_id,
    conversation.assigned_user_id
  )
from public.whatsapp_conversations as conversation
where conversation.id = inbound_log.conversation_id
  and conversation.organization_id = inbound_log.organization_id
  and conversation.lead_id is not null
  and inbound_log.lead_id is null;

-- B1 closes the rolling-deploy compatibility window. From this point on the
-- final transaction state must contain either no active binding for an
-- unlinked conversation, or exactly one active binding that agrees with every
-- immutable tenant/session/lead dimension. Constraint triggers are deferred so
-- the canonical SECURITY DEFINER RPCs may close, insert and update in either
-- statement order without exposing an invalid committed state.
create or replace function private.enforce_whatsapp_conversation_active_binding_consistency()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conversation_id uuid;
  v_conversation public.whatsapp_conversations%rowtype;
  v_active_count bigint;
  v_exact_count bigint;
begin
  if tg_table_name = 'whatsapp_conversations' then
    v_conversation_id := new.id;
  elsif tg_op = 'DELETE' then
    v_conversation_id := old.conversation_id;
  else
    v_conversation_id := new.conversation_id;
  end if;

  select conversation.*
  into v_conversation
  from public.whatsapp_conversations as conversation
  where conversation.id = v_conversation_id;

  -- ON DELETE CAS fires the binding trigger after the parent disappeared. A
  -- missing parent has no final binding invariant left to validate.
  if not found then
    return null;
  end if;

  select
    count(*),
    count(*) filter (
      where binding.organization_id is not distinct from v_conversation.organization_id
        and binding.session_id is not distinct from v_conversation.session_id
        and binding.lead_id is not distinct from v_conversation.lead_id
        and binding.stale is false
    )
  into v_active_count, v_exact_count
  from public.whatsapp_conversation_lead_bindings as binding
  where binding.conversation_id = v_conversation_id
    and binding.active_to is null;

  if (
      v_conversation.lead_id is null
      and v_active_count <> 0
    ) or (
      v_conversation.lead_id is not null
      and (v_active_count <> 1 or v_exact_count <> 1)
    ) then
    raise exception using
      errcode = '23514',
      message = 'whatsapp_conversation_active_binding_mismatch';
  end if;

  return null;
end;
$$;

revoke all on function private.enforce_whatsapp_conversation_active_binding_consistency()
from public, anon, authenticated, service_role;

drop trigger if exists enforce_whatsapp_conversation_active_binding_consistency
on public.whatsapp_conversations;

create constraint trigger enforce_whatsapp_conversation_active_binding_consistency
after insert or update of organization_id, session_id, lead_id
on public.whatsapp_conversations
deferrable initially deferred
for each row
execute function private.enforce_whatsapp_conversation_active_binding_consistency();

drop trigger if exists enforce_whatsapp_binding_active_conversation_consistency
on public.whatsapp_conversation_lead_bindings;

create constraint trigger enforce_whatsapp_binding_active_conversation_consistency
after insert or update or delete
on public.whatsapp_conversation_lead_bindings
deferrable initially deferred
for each row
execute function private.enforce_whatsapp_conversation_active_binding_consistency();

comment on function private.enforce_whatsapp_conversation_active_binding_consistency() is
'vimob.queue_scoped_binding_consistency.v1: deferred final-state invariant; unlinked conversations have zero active bindings and linked conversations have exactly one tenant/session/lead-exact non-stale active binding.';

-- Binding history is read-only to every application role. All mutations must
-- cross one of the reviewed SECURITY DEFINER binding RPCs above.
revoke insert, update, delete, truncate
on table public.whatsapp_conversation_lead_bindings
from public, anon, authenticated, service_role;
grant select on table public.whatsapp_conversation_lead_bindings
to service_role;

-- These pre-ledger helpers merge/move physical histories and update the
-- conversation without maintaining the immutable binding ledger. They are no
-- longer routable after B1; callers must use the canonical API/RPC path.
revoke execute on function public.rebind_whatsapp_conversation_session(uuid, uuid)
from public, anon, authenticated, service_role;
revoke execute on function public.rebind_whatsapp_conversation_session(uuid, uuid, text)
from public, anon, authenticated, service_role;

-- Quarantine only delivery rows that have not crossed the provider boundary.
-- The preflight above rejects every processing row instead of relabelling its
-- externally ambiguous outcome as failed.
update public.outbox_messages as outbox
set
  status = 'failed',
  processed_at = coalesce(outbox.processed_at, clock_timestamp()),
  error_message = 'conversation_lead_binding_not_current'
from public.whatsapp_conversations as conversation
left join public.whatsapp_conversation_lead_bindings as binding
  on binding.organization_id = conversation.organization_id
 and binding.conversation_id = conversation.id
 and binding.active_to is null
where outbox.organization_id = conversation.organization_id
  and outbox.conversation_id = conversation.id
  and outbox.status = 'pending'
  and (
    outbox.session_id is distinct from conversation.session_id
    or outbox.lead_id is null
    or binding.lead_id is null
    or outbox.lead_id is distinct from binding.lead_id
    or outbox.lead_id is distinct from conversation.lead_id
  );

-- Canonical outbox rows snapshot their lead through whatsapp_messages. Rows
-- not yet handed to the provider can be dead-lettered safely; processing rows
-- were rejected by the cutover preflight and must be reconciled externally.
update public.whatsapp_outbox as outbox
set
  status = 'dead',
  dead_lettered_at = coalesce(outbox.dead_lettered_at, clock_timestamp()),
  locked_at = null,
  locked_by = null,
  last_error = 'conversation_lead_binding_not_current',
  updated_at = clock_timestamp()
where outbox.status in ('pending', 'retry')
  and exists (
    select 1
    from public.whatsapp_conversations as conversation
    join public.whatsapp_messages as message
      on message.id = outbox.message_id
     and message.organization_id = outbox.organization_id
     and message.session_id = outbox.session_id
     and message.conversation_id = outbox.conversation_id
    left join public.whatsapp_conversation_lead_bindings as binding
      on binding.organization_id = conversation.organization_id
     and binding.conversation_id = conversation.id
     and binding.active_to is null
    where conversation.organization_id = outbox.organization_id
      and conversation.id = outbox.conversation_id
      and (
        outbox.session_id is distinct from conversation.session_id
        or message.lead_id is null
        or binding.lead_id is null
        or message.lead_id is distinct from binding.lead_id
        or message.lead_id is distinct from conversation.lead_id
      )
  );

do $$
begin
  if exists (
    select 1
    from public.whatsapp_conversations as conversation
    join public.whatsapp_conversation_lead_bindings as binding
      on binding.conversation_id = conversation.id
     and binding.active_to is null
    where conversation.organization_id is distinct from binding.organization_id
       or conversation.session_id is distinct from binding.session_id
       or conversation.lead_id is distinct from binding.lead_id
       or binding.stale
  ) or exists (
    select 1
    from public.whatsapp_conversations as conversation
    where conversation.lead_id is not null
      and not exists (
        select 1
        from public.whatsapp_conversation_lead_bindings as binding
        where binding.conversation_id = conversation.id
          and binding.active_to is null
      )
  ) then
    raise exception using
      errcode = '23514',
      message = 'whatsapp_binding_cutover_state_mismatch';
  end if;

  if exists (
    select 1
    from public.outbox_messages as outbox
    join public.whatsapp_conversations as conversation
      on conversation.organization_id = outbox.organization_id
     and conversation.id = outbox.conversation_id
    join public.whatsapp_conversation_lead_bindings as binding
      on binding.organization_id = conversation.organization_id
     and binding.conversation_id = conversation.id
     and binding.active_to is null
    where outbox.status = 'pending'
      and (
        outbox.lead_id is null
        or outbox.session_id is distinct from conversation.session_id
        or outbox.lead_id is distinct from conversation.lead_id
        or outbox.lead_id is distinct from binding.lead_id
      )
  ) then
    raise exception using
      errcode = '23514',
      message = 'whatsapp_outbox_cutover_state_mismatch';
  end if;

  if exists (
    select 1
    from public.whatsapp_outbox as outbox
    join public.whatsapp_conversations as conversation
      on conversation.organization_id = outbox.organization_id
     and conversation.id = outbox.conversation_id
    join public.whatsapp_messages as message
      on message.id = outbox.message_id
     and message.organization_id = outbox.organization_id
     and message.session_id = outbox.session_id
     and message.conversation_id = outbox.conversation_id
    join public.whatsapp_conversation_lead_bindings as binding
      on binding.organization_id = conversation.organization_id
     and binding.conversation_id = conversation.id
     and binding.active_to is null
    where outbox.status in ('pending', 'retry')
      and (
        outbox.session_id is distinct from conversation.session_id
        or message.lead_id is null
        or message.lead_id is distinct from conversation.lead_id
        or message.lead_id is distinct from binding.lead_id
      )
  ) then
    raise exception using
      errcode = '23514',
      message = 'canonical_whatsapp_outbox_cutover_state_mismatch';
  end if;
end;
$$;

create or replace function public.set_whatsapp_message_context()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conversation public.whatsapp_conversations%rowtype;
  v_active_binding public.whatsapp_conversation_lead_bindings%rowtype;
  v_event_binding public.whatsapp_conversation_lead_bindings%rowtype;
  v_provider_message_id text := nullif(btrim(new.provider_message_id), '');
  v_message_id text := nullif(btrim(new.message_id), '');
  v_expected_lead_id uuid;
begin
  -- Delivery/status/reaction/media updates to an old message must remain valid
  -- after the conversation moves to another lead. Never compare an unchanged
  -- historical message context with the conversation's current binding. The
  -- only allowed context transition is session_id non-NULL -> NULL, performed
  -- by the existing ON DELETE SET NULL contract when a session is deleted.
  if tg_op = 'UPDATE' then
    if new.organization_id is not distinct from old.organization_id
       and new.conversation_id is not distinct from old.conversation_id
       and new.lead_id is not distinct from old.lead_id
       and new.remote_jid is not distinct from old.remote_jid
       and (
         new.session_id is not distinct from old.session_id
         or (old.session_id is not null and new.session_id is null)
       ) then
      return new;
    end if;

    raise exception using
      errcode = '23514',
      message = 'whatsapp_message_context_immutable';
  end if;

  if new.conversation_id is null then
    raise exception using
      errcode = '23503',
      message = 'whatsapp_message_conversation_required';
  end if;

  select conversation.*
  into v_conversation
  from public.whatsapp_conversations as conversation
  where conversation.id = new.conversation_id
  for share;

  if not found then
    raise exception using
      errcode = '23503',
      message = 'whatsapp_message_conversation_not_found';
  end if;

  if new.organization_id is not null
     and new.organization_id is distinct from v_conversation.organization_id then
    raise exception using
      errcode = '23503',
      message = 'whatsapp_message_conversation_tenant_mismatch';
  end if;

  new.organization_id := v_conversation.organization_id;
  new.session_id := coalesce(new.session_id, v_conversation.session_id);
  new.remote_jid := coalesce(new.remote_jid, v_conversation.remote_jid);

  if new.session_id is not null
     and not exists (
       select 1
       from public.whatsapp_sessions as session
       where session.id = new.session_id
         and session.organization_id = new.organization_id
     ) then
    raise exception using
      errcode = '23503',
      message = 'whatsapp_message_session_tenant_mismatch';
  end if;

  -- A provider event may be replayed after a later lead becomes active. Its
  -- immutable binding-event ledger wins over current state so the message is
  -- inserted into the original lead history without reopening that binding.
  select binding.*
  into v_event_binding
  from public.whatsapp_conversation_lead_bindings as binding
  where binding.organization_id = new.organization_id
    and binding.provider_message_id is not null
    and (
      binding.provider_message_id = v_provider_message_id
      or binding.provider_message_id = v_message_id
    )
    and (
      binding.conversation_id = new.conversation_id
      or (
        new.session_id is not null
        and binding.session_id = new.session_id
      )
    )
  order by
    case when binding.provider_message_id = v_provider_message_id then 0 else 1 end,
    binding.created_at,
    binding.id
  limit 1;

  if found then
    if v_event_binding.conversation_id is distinct from new.conversation_id then
      raise exception using
        errcode = '23505',
        message = 'whatsapp_message_provider_binding_conflict';
    end if;

    if exists (
      select 1
      from public.whatsapp_conversation_lead_bindings as binding
      where binding.organization_id = new.organization_id
        and binding.provider_message_id is not null
        and (
          binding.provider_message_id = v_provider_message_id
          or binding.provider_message_id = v_message_id
        )
        and (
          binding.conversation_id = new.conversation_id
          or (
            new.session_id is not null
            and binding.session_id = new.session_id
          )
        )
        and binding.id <> v_event_binding.id
        and (
          binding.conversation_id is distinct from v_event_binding.conversation_id
          or binding.lead_id is distinct from v_event_binding.lead_id
        )
    ) then
      raise exception using
        errcode = '23505',
        message = 'whatsapp_message_provider_binding_ambiguous';
    end if;

    v_expected_lead_id := v_event_binding.lead_id;
    new.session_id := coalesce(v_event_binding.session_id, new.session_id);
  else
    if new.session_id is distinct from v_conversation.session_id then
      raise exception using
        errcode = '23514',
        message = 'whatsapp_message_current_session_mismatch';
    end if;

    if new.lead_id is null
       and private.is_terminal_whatsapp_lead_resolution_quarantine(
         new.metadata,
         new.from_me,
         new.provider_message_id,
         new.message_id
       ) then
      return new;
    end if;

    select binding.*
    into v_active_binding
    from public.whatsapp_conversation_lead_bindings as binding
    where binding.organization_id = new.organization_id
      and binding.conversation_id = new.conversation_id
      and binding.active_to is null;

    if not found then
      if v_conversation.lead_id is null and new.lead_id is null then
        -- A genuinely unlinked conversation may persist its inbound history.
        -- Explicit terminal ambiguity quarantine in an already linked physical
        -- thread returned above before the active-binding lookup.
        return new;
      end if;

      raise exception using
        errcode = '23514',
        message = 'whatsapp_message_active_binding_required';
    end if;

    if v_active_binding.session_id is distinct from v_conversation.session_id
       or v_active_binding.lead_id is distinct from v_conversation.lead_id then
      raise exception using
        errcode = '23514',
        message = 'whatsapp_message_binding_state_mismatch';
    end if;

    v_expected_lead_id := v_active_binding.lead_id;
  end if;

  if new.lead_id is null then
    new.lead_id := v_expected_lead_id;
  elsif new.lead_id is distinct from v_expected_lead_id then
    raise exception using
      errcode = '23514',
      message = 'whatsapp_message_lead_binding_mismatch';
  end if;

  return new;
end;
$$;

revoke all on function public.set_whatsapp_message_context()
from public, anon, authenticated, service_role;
grant execute on function public.set_whatsapp_message_context()
to service_role;

-- The compatible writers now resolve the canonical conversation before insert.
-- Retire the legacy trigger because it could rewrite conversation_id after a
-- binding-ledger decision and thereby bypass historical attribution. The new
-- strict trigger below owns inserts and explicitly permits the session FK's
-- non-NULL -> NULL transition on historical rows.
drop trigger if exists trg_enforce_whatsapp_message_session_match
on public.whatsapp_messages;

drop trigger if exists trg_enforce_whatsapp_message_session_match_insert
on public.whatsapp_messages;

drop trigger if exists trg_enforce_whatsapp_message_session_match_update
on public.whatsapp_messages;

drop trigger if exists set_whatsapp_message_context_before_write
on public.whatsapp_messages;

drop trigger if exists zz_enforce_whatsapp_message_context_before_write
on public.whatsapp_messages;

create trigger zz_enforce_whatsapp_message_context_before_write
before insert or update of conversation_id, session_id, organization_id, lead_id, remote_jid
on public.whatsapp_messages
for each row
execute function public.set_whatsapp_message_context();

create or replace function private.enforce_canonical_whatsapp_outbox_lead_binding()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conversation public.whatsapp_conversations%rowtype;
  v_message public.whatsapp_messages%rowtype;
  v_previous_message public.whatsapp_messages%rowtype;
  v_binding public.whatsapp_conversation_lead_bindings%rowtype;
  v_message_reconciled boolean := false;
  v_terminal_message_reconciled boolean := false;
begin
  if tg_op = 'UPDATE' then
    if new.organization_id is distinct from old.organization_id
       or new.session_id is distinct from old.session_id
       or new.conversation_id is distinct from old.conversation_id then
      raise exception using
        errcode = '23514',
        message = 'canonical_whatsapp_outbox_context_immutable';
    end if;

    if new.message_id is distinct from old.message_id then
      -- A message-id rewrite exists only for provider-webhook-wins. It either
      -- preserves the current worker lease or atomically records a signed
      -- acknowledgement from a processing / outcome-unknown delivery. The
      -- immutable message pair is checked below before the losing projection
      -- can be deleted.
      if new.client_message_id is distinct from old.client_message_id
         or new.provider_message_id is distinct from old.provider_message_id
         or nullif(btrim(new.client_message_id), '') is null
         or nullif(btrim(new.provider_message_id), '') is null then
        raise exception using
          errcode = '23514',
          message = 'canonical_whatsapp_outbox_message_reconciliation_invalid';
      end if;

      if old.status = 'processing'
         and new.status = 'processing'
         and old.locked_by is not null
         and new.locked_by is not distinct from old.locked_by
         and new.locked_at is not null then
        v_message_reconciled := true;
      elsif (
          old.status = 'processing'
          or (
            old.status = 'dead'
            and old.last_error = 'provider_delivery_outcome_unknown'
          )
        )
        and new.status in ('sent', 'delivered', 'read')
        and new.sent_at is not null
        and new.locked_at is null
        and new.locked_by is null
        and new.last_error is null
        and new.failed_at is null
        and new.dead_lettered_at is null then
        v_message_reconciled := true;
        v_terminal_message_reconciled := true;
      else
        raise exception using
          errcode = '23514',
          message = 'canonical_whatsapp_outbox_message_reconciliation_invalid';
      end if;

    -- Active rows were validated when inserted or reactivated. Rechecking the
    -- ordinary pending/retry -> processing -> retry lifecycle after the row is
    -- locked would invert the canonical conversation -> outbox lock order.
    elsif old.status in ('pending', 'retry', 'processing')
       or new.status not in ('pending', 'retry', 'processing') then
      return new;
    end if;
  end if;

  select conversation.*
  into v_conversation
  from public.whatsapp_conversations as conversation
  where conversation.id = new.conversation_id
  for share;

  if not found
     or v_conversation.organization_id is distinct from new.organization_id
     or v_conversation.session_id is distinct from new.session_id then
    raise exception using
      errcode = '23514',
      message = 'canonical_whatsapp_outbox_conversation_mismatch';
  end if;

  select message.*
  into v_message
  from public.whatsapp_messages as message
  where message.id = new.message_id
    and message.organization_id = new.organization_id
    and message.session_id = new.session_id
    and message.conversation_id = new.conversation_id
  for share;

  if not found then
    raise exception using
      errcode = '23514',
      message = 'canonical_whatsapp_outbox_message_mismatch';
  end if;

  if v_terminal_message_reconciled then
    -- A terminal provider acknowledgement never authorizes a send or a card
    -- switch. It may therefore finish a historical outcome-unknown delivery
    -- after a later manual rebind, provided both immutable projections agree.
    if v_message.lead_id is null then
      raise exception using
        errcode = '23514',
        message = 'canonical_whatsapp_outbox_message_lead_mismatch';
    end if;
  else
    select binding.*
    into v_binding
    from public.whatsapp_conversation_lead_bindings as binding
    where binding.organization_id = new.organization_id
      and binding.conversation_id = new.conversation_id
      and binding.active_to is null
    for share;

    if not found
       or v_conversation.lead_id is null
       or v_message.lead_id is null
       or v_binding.session_id is distinct from v_conversation.session_id
       or v_binding.lead_id is distinct from v_conversation.lead_id
       or v_message.lead_id is distinct from v_binding.lead_id then
      raise exception using
        errcode = '23514',
        message = 'canonical_whatsapp_outbox_message_lead_mismatch';
    end if;
  end if;

  if v_message_reconciled then
    select message.*
    into v_previous_message
    from public.whatsapp_messages as message
    where message.id = old.message_id
      and message.organization_id = old.organization_id
      and message.session_id = old.session_id
      and message.conversation_id = old.conversation_id
    for share;

    if not found
       or v_previous_message.lead_id is null
       or v_previous_message.lead_id is distinct from v_message.lead_id
       or (
         not v_terminal_message_reconciled
         and v_previous_message.lead_id is distinct from v_binding.lead_id
       )
       or coalesce(v_previous_message.from_me, false) is false
       or coalesce(v_message.from_me, false) is false
       or nullif(btrim(v_previous_message.client_message_id), '') is not null
       or not (
         v_previous_message.provider_message_id = new.provider_message_id
         or v_previous_message.message_id = new.provider_message_id
         or v_previous_message.message_id = new.client_message_id
       )
       or v_message.client_message_id is distinct from new.client_message_id
       or v_message.provider_message_id is distinct from new.provider_message_id
       or v_message.message_id is distinct from new.provider_message_id
       or (
         v_terminal_message_reconciled
         and v_message.status not in ('sent', 'delivered', 'read')
       ) then
      raise exception using
        errcode = '23514',
        message = 'canonical_whatsapp_outbox_message_reconciliation_mismatch';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function private.enforce_canonical_whatsapp_outbox_lead_binding()
from public, anon, authenticated, service_role;

drop trigger if exists enforce_canonical_whatsapp_outbox_lead_binding_before_write
on public.whatsapp_outbox;

create trigger enforce_canonical_whatsapp_outbox_lead_binding_before_write
before insert or update of organization_id, session_id, conversation_id, message_id, status
on public.whatsapp_outbox
for each row
execute function private.enforce_canonical_whatsapp_outbox_lead_binding();

comment on function public.set_whatsapp_message_context() is
'vimob.queue_scoped_message_binding.v1: pins new messages to the provider-event ledger or active conversation lead while preserving immutable historical message context after later rebinds.';

comment on function private.enforce_canonical_whatsapp_outbox_lead_binding() is
'vimob.queue_scoped_outbox_binding.v2: validates active inserts and terminal-to-active retries against the current binding; provider-webhook-wins may only transfer an exact immutable client/provider identity while leased or terminalizing a signed outcome-unknown delivery.';

do $$
begin
  if exists (
    select 1
    from public.whatsapp_webhook_inbox as inbox
    where inbox.status in ('pending', 'retry', 'processing')
      and coalesce(inbox.payload #>> '{__vimob_ingress,routing_snapshot,version}', '') <> '1'
  ) or not exists (
    select 1
    from pg_catalog.pg_constraint as constraint_state
    where constraint_state.conrelid = 'public.whatsapp_webhook_inbox'::regclass
      and constraint_state.conname = 'whatsapp_webhook_active_routing_snapshot_v1_check'
      and constraint_state.convalidated
  ) then
    raise exception using
      errcode = '23514',
      message = 'whatsapp_webhook_b1_provenance_readback_failed';
  end if;

  if exists (
    select 1
    from unnest(array['anon', 'authenticated']::text[]) as browser(role_name)
    cross join unnest(
      array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']::text[]
    ) as operation(privilege_name)
    where pg_catalog.has_table_privilege(
      browser.role_name,
      'public.whatsapp_messages',
      operation.privilege_name
    )
  ) then
    raise exception using
      errcode = '42501',
      message = 'whatsapp_message_browser_write_privilege_survived';
  end if;

  if pg_catalog.obj_description(
       'private.enforce_canonical_whatsapp_outbox_lead_binding()'::regprocedure,
       'pg_proc'
     ) not like 'vimob.queue_scoped_outbox_binding.v2:%'
     or not exists (
    select 1
    from pg_catalog.pg_trigger as trigger_state
    where trigger_state.tgrelid = 'public.whatsapp_outbox'::regclass
      and trigger_state.tgname =
        'enforce_canonical_whatsapp_outbox_lead_binding_before_write'
      and not trigger_state.tgisinternal
      and trigger_state.tgenabled in ('O', 'A')
      and trigger_state.tgtype = 23
      and (
        select pg_catalog.count(*)
        from pg_catalog.pg_attribute as attribute
        where attribute.attrelid = trigger_state.tgrelid
          and attribute.attname = any (
            array[
              'organization_id',
              'session_id',
              'conversation_id',
              'message_id',
              'status'
            ]::name[]
          )
          and attribute.attnum = any (trigger_state.tgattr)
      ) = 5
  ) then
    raise exception using
      errcode = '23514',
      message = 'canonical_whatsapp_outbox_trigger_readback_failed';
  end if;

  if pg_catalog.obj_description(
       'private.enforce_whatsapp_conversation_active_binding_consistency()'::regprocedure,
       'pg_proc'
     ) not like 'vimob.queue_scoped_binding_consistency.v1:%'
     or not exists (
       select 1
       from pg_catalog.pg_trigger as trigger_state
       where trigger_state.tgrelid = 'public.whatsapp_conversations'::regclass
         and trigger_state.tgname =
           'enforce_whatsapp_conversation_active_binding_consistency'
         and not trigger_state.tgisinternal
         and trigger_state.tgenabled in ('O', 'A')
         and trigger_state.tgdeferrable
         and trigger_state.tginitdeferred
     )
     or not exists (
       select 1
       from pg_catalog.pg_trigger as trigger_state
       where trigger_state.tgrelid =
         'public.whatsapp_conversation_lead_bindings'::regclass
         and trigger_state.tgname =
           'enforce_whatsapp_binding_active_conversation_consistency'
         and not trigger_state.tgisinternal
         and trigger_state.tgenabled in ('O', 'A')
         and trigger_state.tgdeferrable
         and trigger_state.tginitdeferred
     )
     or exists (
       select 1
       from unnest(array['anon', 'authenticated', 'service_role']::text[]) as writer(role_name)
       cross join unnest(
         array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']::text[]
       ) as operation(privilege_name)
       where pg_catalog.has_table_privilege(
         writer.role_name,
         'public.whatsapp_conversation_lead_bindings',
         operation.privilege_name
       )
     )
     or pg_catalog.has_function_privilege(
       'service_role',
       'public.rebind_whatsapp_conversation_session(uuid,uuid)',
       'execute'
     )
     or pg_catalog.has_function_privilege(
       'service_role',
       'public.rebind_whatsapp_conversation_session(uuid,uuid,text)',
       'execute'
     ) then
    raise exception using
      errcode = '23514',
      message = 'strict_whatsapp_binding_ledger_boundary_readback_failed';
  end if;
end;
$$;

commit;
