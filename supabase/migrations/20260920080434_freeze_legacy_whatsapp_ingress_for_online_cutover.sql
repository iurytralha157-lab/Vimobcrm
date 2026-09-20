begin;

set local lock_timeout = '5s';
set local statement_timeout = '5min';

create table if not exists private.whatsapp_webhook_legacy_routing_freeze (
  inbox_id uuid primary key
    references public.whatsapp_webhook_inbox(id) on delete restrict,
  organization_id uuid not null,
  session_id uuid not null,
  event_key text not null,
  processing_lane text not null,
  original_status text not null,
  prepared_release_sha text not null,
  frozen_at timestamp with time zone not null default now(),
  constraint whatsapp_webhook_legacy_routing_freeze_lane_check
    check (processing_lane in ('live', 'backlog')),
  constraint whatsapp_webhook_legacy_routing_freeze_status_check
    check (original_status in ('pending', 'retry')),
  constraint whatsapp_webhook_legacy_routing_freeze_sha_check
    check (prepared_release_sha ~ '^[0-9a-f]{40}$'),
  constraint whatsapp_webhook_legacy_routing_freeze_identity_key
    unique (organization_id, session_id, event_key)
);

comment on table private.whatsapp_webhook_legacy_routing_freeze is
'Immutable ledger of pre-v1 inbox rows excluded from online claims during the queue-scoped lead cutover. Rows are preserved in the inbox and may only be recovered by a later audited procedure.';

alter table private.whatsapp_webhook_legacy_routing_freeze enable row level security;

revoke all on table private.whatsapp_webhook_legacy_routing_freeze
from public, anon, authenticated, service_role;

create or replace function private.is_frozen_legacy_whatsapp_ingress(
  p_inbox_id uuid,
  p_organization_id uuid,
  p_session_id uuid,
  p_event_key text,
  p_processing_lane text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from private.whatsapp_webhook_legacy_routing_freeze as frozen
    where frozen.inbox_id = p_inbox_id
      and frozen.organization_id = p_organization_id
      and frozen.session_id = p_session_id
      and frozen.event_key = p_event_key
      and frozen.processing_lane = p_processing_lane
  );
$$;

comment on function private.is_frozen_legacy_whatsapp_ingress(uuid,uuid,uuid,text,text) is
'vimob.whatsapp_legacy_routing_freeze.v1: proves that an exact pre-v1 inbox identity was frozen before the online strict-binding cutover.';

revoke all on function private.is_frozen_legacy_whatsapp_ingress(uuid,uuid,uuid,text,text)
from public, anon, authenticated;

grant execute on function private.is_frozen_legacy_whatsapp_ingress(uuid,uuid,uuid,text,text)
to service_role;

create or replace function private.guard_whatsapp_webhook_legacy_routing_freeze()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old_frozen boolean := false;
  v_new_snapshot_version text;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    v_old_frozen := private.is_frozen_legacy_whatsapp_ingress(
      old.id,
      old.organization_id,
      old.session_id,
      old.event_key,
      old.processing_lane
    );
  end if;

  if tg_op = 'DELETE' then
    if v_old_frozen then
      raise exception using
        errcode = '55000',
        message = 'frozen_legacy_whatsapp_ingress_delete_forbidden',
        hint = 'Use a separately audited recovery procedure; do not delete preserved pre-v1 ingress.';
    end if;
    return old;
  end if;

  if v_old_frozen then
    if new.organization_id is distinct from old.organization_id
       or new.session_id is distinct from old.session_id
       or new.event_key is distinct from old.event_key
       or new.event_type is distinct from old.event_type
       or new.provider_instance_id is distinct from old.provider_instance_id
       or new.processing_lane is distinct from old.processing_lane
       or new.payload is distinct from old.payload
       or new.status is distinct from old.status then
      raise exception using
        errcode = '55000',
        message = 'frozen_legacy_whatsapp_ingress_mutation_forbidden',
        hint = 'The legacy row is intentionally preserved and excluded from claims until an audited recovery exists.';
    end if;
    return new;
  end if;

  v_new_snapshot_version := coalesce(
    new.payload #>> '{__vimob_ingress,routing_snapshot,version}',
    ''
  );

  if new.status in ('pending', 'retry', 'processing')
     and v_new_snapshot_version <> '1' then
    raise exception using
      errcode = '23514',
      message = 'active_whatsapp_ingress_requires_routing_snapshot_v1';
  end if;

  return new;
end;
$$;

comment on function private.guard_whatsapp_webhook_legacy_routing_freeze() is
'vimob.whatsapp_legacy_routing_freeze.v1: freezes ledgered pre-v1 rows and rejects every new active inbox row without an immutable routing snapshot v1.';

revoke all on function private.guard_whatsapp_webhook_legacy_routing_freeze()
from public, anon, authenticated, service_role;

do $whatsapp_legacy_routing_freeze_contract_readback$
begin
  if pg_catalog.to_regclass(
       'private.whatsapp_webhook_legacy_routing_freeze'
     ) is null
     or pg_catalog.to_regprocedure(
       'private.is_frozen_legacy_whatsapp_ingress(uuid,uuid,uuid,text,text)'
     ) is null
     or pg_catalog.to_regprocedure(
       'private.guard_whatsapp_webhook_legacy_routing_freeze()'
     ) is null
     or not exists (
       select 1
       from pg_catalog.pg_class as relation
       where relation.oid =
         'private.whatsapp_webhook_legacy_routing_freeze'::regclass
         and relation.relrowsecurity
     )
     or pg_catalog.has_table_privilege(
       'service_role',
       'private.whatsapp_webhook_legacy_routing_freeze',
       'SELECT'
     )
     or pg_catalog.has_function_privilege(
       'anon',
       'private.is_frozen_legacy_whatsapp_ingress(uuid,uuid,uuid,text,text)',
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'authenticated',
       'private.is_frozen_legacy_whatsapp_ingress(uuid,uuid,uuid,text,text)',
       'EXECUTE'
     )
     or not pg_catalog.has_function_privilege(
       'service_role',
       'private.is_frozen_legacy_whatsapp_ingress(uuid,uuid,uuid,text,text)',
       'EXECUTE'
     ) then
    raise exception using
      errcode = '55000',
      message = 'whatsapp_legacy_routing_freeze_contract_readback_failed';
  end if;
end;
$whatsapp_legacy_routing_freeze_contract_readback$;

commit;
