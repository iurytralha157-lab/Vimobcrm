-- Read-only canary inventory. Run only after the retention migrations are
-- installed. A timeout means HOLD; it must never be interpreted as zero.
begin transaction read only;
set local statement_timeout = '10s';

select
  pg_catalog.to_regprocedure('private.cleanup_whatsapp_nonlead_control_retention(integer)')
    is not null as cleanup_installed,
  pg_catalog.to_regprocedure('private.whatsapp_legacy_is_nonlead_control(text,jsonb)')
    is not null as classifier_installed,
  pg_catalog.to_regprocedure('private.whatsapp_nonlead_retention_payload_safe(text,jsonb)')
    is not null as strict_retention_gate_installed;

select indexrelid::regclass::text as index_name, indisvalid, indisready
from pg_catalog.pg_index
where indexrelid in (
  pg_catalog.to_regclass('public.whatsapp_inbox_nonlead_processed_retention_idx'),
  pg_catalog.to_regclass('public.whatsapp_inbox_nonlead_dead_retention_idx')
)
order by 1;

select exists (
  select 1 from pg_catalog.pg_trigger
  where tgrelid = 'public.whatsapp_webhook_inbox'::regclass
    and tgname = 'guard_whatsapp_inbox_terminal_retention_delete'
    and not tgisinternal
    and tgenabled in ('O', 'A')
) as delete_guard_enabled,
pg_catalog.has_table_privilege(
  'service_role', 'public.whatsapp_webhook_inbox', 'TRUNCATE'
) as service_role_can_truncate;

-- Preview at most 500 oldest control-named rows in each terminal state.
-- The classifier is evaluated for every sampled row. Sample counts are not
-- estimates of the entire backlog.
with oldest as (
  select inbox.id, inbox.event_type, inbox.payload
  from public.whatsapp_webhook_inbox as inbox
  where inbox.status = 'processed'
    and inbox.event_type in (
      'qrcode.updated', 'QRCODE_UPDATED', 'qrcode', 'QRCODE',
      'connection.update', 'CONNECTION_UPDATE',
      'connection.status', 'CONNECTION_STATUS',
      'instance.update', 'INSTANCE_UPDATE',
      'connected', 'disconnected', 'logged.out', 'LOGGED_OUT'
    )
    and inbox.created_at < now() - interval '7 days'
    and inbox.processed_at < now() - interval '7 days'
  order by inbox.processed_at, inbox.id
  limit 500
)
select count(*) as sampled,
       count(*) filter (
         where private.whatsapp_legacy_is_nonlead_control(event_type,payload)
           and private.whatsapp_nonlead_retention_payload_safe(event_type,payload)
           and not exists (
             select 1
             from private.whatsapp_webhook_legacy_routing_freeze as frozen
             where frozen.inbox_id = oldest.id
           )
       ) as eligible_in_sample
from oldest;

with oldest as (
  select inbox.id, inbox.event_type, inbox.payload
  from public.whatsapp_webhook_inbox as inbox
  where inbox.status = 'dead'
    and inbox.event_type in (
      'qrcode.updated', 'QRCODE_UPDATED', 'qrcode', 'QRCODE',
      'connection.update', 'CONNECTION_UPDATE',
      'connection.status', 'CONNECTION_STATUS',
      'instance.update', 'INSTANCE_UPDATE',
      'connected', 'disconnected', 'logged.out', 'LOGGED_OUT'
    )
    and inbox.created_at < now() - interval '7 days'
    and inbox.dead_lettered_at < now() - interval '7 days'
  order by inbox.dead_lettered_at, inbox.id
  limit 500
)
select count(*) as sampled,
       count(*) filter (
         where private.whatsapp_legacy_is_nonlead_control(event_type,payload)
           and private.whatsapp_nonlead_retention_payload_safe(event_type,payload)
           and not exists (
             select 1
             from private.whatsapp_webhook_legacy_routing_freeze as frozen
             where frozen.inbox_id = oldest.id
           )
       ) as eligible_in_sample
from oldest;

commit;
