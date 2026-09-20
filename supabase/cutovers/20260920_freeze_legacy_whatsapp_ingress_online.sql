-- Freeze pre-v1 inbox rows without stopping the API or webhook ingress.
--
-- Required order:
--   1. deploy the API release whose claim query requires routing snapshot v1;
--   2. prove every replica runs that immutable SHA;
--   3. run this file in one dedicated psql invocation with autocommit enabled.
--
-- This script never updates, replays, terminalizes or deletes an inbox row.
\set ON_ERROR_STOP on

\if :{?app_ready_release}
\else
  \echo 'Missing -v app_ready_release=<40-character-sha>'
  \set app_ready_release invalid
\endif

\if :{?app_smoke_confirmed}
\else
  \echo 'Missing -v app_smoke_confirmed=true'
  \set app_smoke_confirmed false
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

set lock_timeout = '5s';
set statement_timeout = '5min';

select pg_catalog.pg_advisory_lock(
  pg_catalog.hashtextextended('vimob:whatsapp-legacy-routing-freeze:v1', 0)
);

do $preflight_whatsapp_legacy_routing_freeze$
declare
  v_app_ready_release text := pg_catalog.current_setting(
    'vimob.queue_scoped_lead_app_ready_release',
    true
  );
  v_app_smoke_confirmed text := pg_catalog.current_setting(
    'vimob.queue_scoped_lead_app_smoke_confirmed',
    true
  );
begin
  if v_app_ready_release is null
     or v_app_ready_release !~ '^[0-9a-f]{40}$'
     or v_app_smoke_confirmed is distinct from 'true' then
    raise exception using
      errcode = '55000',
      message = 'online_whatsapp_freeze_compatible_app_not_attested';
  end if;

  if pg_catalog.to_regclass(
       'private.whatsapp_webhook_legacy_routing_freeze'
     ) is null
     or pg_catalog.to_regprocedure(
       'private.is_frozen_legacy_whatsapp_ingress(uuid,uuid,uuid,text,text)'
     ) is null
     or pg_catalog.to_regprocedure(
       'private.guard_whatsapp_webhook_legacy_routing_freeze()'
     ) is null then
    raise exception using
      errcode = '55000',
      message = 'online_whatsapp_freeze_contract_not_ready';
  end if;

  if exists (
    select 1
    from public.whatsapp_webhook_inbox as inbox
    where inbox.status = 'processing'
      and coalesce(
        inbox.payload #>> '{__vimob_ingress,routing_snapshot,version}',
        ''
      ) <> '1'
  ) then
    raise exception using
      errcode = '55000',
      message = 'legacy_whatsapp_ingress_still_processing',
      hint = 'Do not stop containers. Wait for the current lease to finish after the v1-only claim release, then retry.';
  end if;
end;
$preflight_whatsapp_legacy_routing_freeze$;

-- Populate the ledger without locking the inbox. The final locked transaction
-- inserts any tail and proves that no legacy claim crossed the release fence.
insert into private.whatsapp_webhook_legacy_routing_freeze (
  inbox_id,
  organization_id,
  session_id,
  event_key,
  processing_lane,
  original_status,
  prepared_release_sha
)
select
  inbox.id,
  inbox.organization_id,
  inbox.session_id,
  inbox.event_key,
  inbox.processing_lane,
  inbox.status,
  :'app_ready_release'
from public.whatsapp_webhook_inbox as inbox
where inbox.status in ('pending', 'retry')
  and inbox.processing_lane in ('live', 'backlog')
  and coalesce(
    inbox.payload #>> '{__vimob_ingress,routing_snapshot,version}',
    ''
  ) <> '1'
on conflict (inbox_id) do nothing;

begin;

set local lock_timeout = '5s';
set local statement_timeout = '2min';

lock table public.whatsapp_webhook_inbox in share row exclusive mode;

do $verify_no_legacy_claim_crossed_freeze$
begin
  if exists (
    select 1
    from public.whatsapp_webhook_inbox as inbox
    where inbox.status = 'processing'
      and coalesce(
        inbox.payload #>> '{__vimob_ingress,routing_snapshot,version}',
        ''
      ) <> '1'
  ) then
    raise exception using
      errcode = '55000',
      message = 'legacy_whatsapp_ingress_claim_raced_online_freeze';
  end if;
end;
$verify_no_legacy_claim_crossed_freeze$;

insert into private.whatsapp_webhook_legacy_routing_freeze (
  inbox_id,
  organization_id,
  session_id,
  event_key,
  processing_lane,
  original_status,
  prepared_release_sha
)
select
  inbox.id,
  inbox.organization_id,
  inbox.session_id,
  inbox.event_key,
  inbox.processing_lane,
  inbox.status,
  :'app_ready_release'
from public.whatsapp_webhook_inbox as inbox
where inbox.status in ('pending', 'retry')
  and inbox.processing_lane in ('live', 'backlog')
  and coalesce(
    inbox.payload #>> '{__vimob_ingress,routing_snapshot,version}',
    ''
  ) <> '1'
on conflict (inbox_id) do nothing;

do $verify_whatsapp_legacy_routing_freeze_coverage$
begin
  if exists (
    select 1
    from public.whatsapp_webhook_inbox as inbox
    where inbox.status in ('pending', 'retry', 'processing')
      and coalesce(
        inbox.payload #>> '{__vimob_ingress,routing_snapshot,version}',
        ''
      ) <> '1'
      and not private.is_frozen_legacy_whatsapp_ingress(
        inbox.id,
        inbox.organization_id,
        inbox.session_id,
        inbox.event_key,
        inbox.processing_lane
      )
  ) then
    raise exception using
      errcode = '23514',
      message = 'legacy_whatsapp_ingress_freeze_coverage_incomplete';
  end if;
end;
$verify_whatsapp_legacy_routing_freeze_coverage$;

drop trigger if exists guard_whatsapp_webhook_legacy_routing_freeze
on public.whatsapp_webhook_inbox;

create trigger guard_whatsapp_webhook_legacy_routing_freeze
before insert or update or delete
on public.whatsapp_webhook_inbox
for each row
execute function private.guard_whatsapp_webhook_legacy_routing_freeze();

comment on trigger guard_whatsapp_webhook_legacy_routing_freeze
on public.whatsapp_webhook_inbox is
'vimob.whatsapp_legacy_routing_freeze.v1: preserves pre-v1 inbox rows while strict routing applies to every new active delivery.';

commit;

do $readback_whatsapp_legacy_routing_freeze$
begin
  if not exists (
    select 1
    from pg_catalog.pg_trigger as trigger_state
    where trigger_state.tgrelid = 'public.whatsapp_webhook_inbox'::regclass
      and trigger_state.tgname = 'guard_whatsapp_webhook_legacy_routing_freeze'
      and not trigger_state.tgisinternal
      and trigger_state.tgenabled in ('O', 'A')
  ) or exists (
    select 1
    from public.whatsapp_webhook_inbox as inbox
    where inbox.status in ('pending', 'retry', 'processing')
      and coalesce(
        inbox.payload #>> '{__vimob_ingress,routing_snapshot,version}',
        ''
      ) <> '1'
      and not private.is_frozen_legacy_whatsapp_ingress(
        inbox.id,
        inbox.organization_id,
        inbox.session_id,
        inbox.event_key,
        inbox.processing_lane
      )
  ) then
    raise exception using
      errcode = '55000',
      message = 'legacy_whatsapp_ingress_freeze_readback_failed';
  end if;
end;
$readback_whatsapp_legacy_routing_freeze$;

select
  pg_catalog.count(*) as frozen_legacy_inbox_rows,
  pg_catalog.min(frozen_at) as first_frozen_at,
  pg_catalog.max(frozen_at) as last_frozen_at
from private.whatsapp_webhook_legacy_routing_freeze;

select pg_catalog.pg_advisory_unlock(
  pg_catalog.hashtextextended('vimob:whatsapp-legacy-routing-freeze:v1', 0)
);
