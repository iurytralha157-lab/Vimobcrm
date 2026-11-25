-- The API guard must be active on every replica before this migration.
-- Keep the capability absent to disable production and start of marked sends.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create function private.queue_notification_delivery_allowed_for_channel(
  p_org uuid, p_lead uuid, p_actor uuid, p_event text, p_metadata jsonb, p_channel text
)
returns boolean language plpgsql stable security definer set search_path = '' as $function$
begin
  if not coalesce(p_metadata ? 'meta_unassigned_admin_alert', false) then
    return private.queue_notification_delivery_allowed(p_org, p_lead, p_actor, p_event, p_metadata);
  end if;

  if p_channel is distinct from 'push'
    or p_event is distinct from 'new_lead_received'
    or p_metadata->'meta_unassigned_admin_alert' is distinct from 'true'::jsonb
    or p_metadata->'unassigned' is distinct from 'true'::jsonb
    or to_regprocedure('private.meta_unassigned_admin_push_enabled()') is null
    or not private.queue_runtime_actor_active(p_org, p_actor)
  then
    return false;
  end if;

  return exists (
    select 1
    from public.leads l
    join public.organization_members m on m.organization_id = l.organization_id and m.user_id = p_actor
    where l.organization_id = p_org and l.id = p_lead and l.assigned_user_id is null
      and nullif(btrim(l.meta_lead_id), '') is not null
      and l.meta_lead_id = p_metadata->>'leadgen_id'
      and m.is_active and m.deleted_at is null and m.role in ('owner', 'admin', 'manager')
      and private.queue_pool_read_access(p_org, p_lead, p_actor) is distinct from false
      -- A first-entry alert cannot revive if the lead was assigned and released.
      and not exists (
        select 1 from private.queue_lead_runtime r
        where r.organization_id = p_org and r.lead_id = p_lead and r.last_user_id is not null
      )
      and not exists (
        select 1 from public.lead_assignment_cycles c
        where c.organization_id = p_org and c.lead_id = p_lead
      )
  );
end;
$function$;

revoke all on function private.queue_notification_delivery_allowed_for_channel(uuid, uuid, uuid, text, jsonb, text)
  from public, anon, authenticated, service_role;

-- Evaluate the protected event on the channel read from the locked delivery,
-- while preserving the exact predecessor's snapshot, lease and token fences.
do $migration$
declare
  definition text;
  predecessor text := $old$  if event in ('queue_pool_available','new_lead_received','lead_redistributed_received','lead_redistribution_warning')
    and (notification.lead_id is null or not coalesce(private.queue_notification_delivery_allowed(
      notification.organization_id,notification.lead_id,notification.user_id,event,notification.metadata),false)) then$old$;
  replacement text := $new$  if (event in ('queue_pool_available','new_lead_received','lead_redistributed_received','lead_redistribution_warning')
      or coalesce(notification.metadata ? 'meta_unassigned_admin_alert',false))
    and (notification.lead_id is null or not coalesce(private.queue_notification_delivery_allowed_for_channel(
      notification.organization_id,notification.lead_id,notification.user_id,event,notification.metadata,delivery.channel),false)) then$new$;
begin
  select replace(pg_get_functiondef(to_regprocedure('private.start_queue_authorized_notification_delivery(uuid,uuid,text,jsonb)')),
    chr(13) || chr(10), chr(10)) into definition;
  if definition is null or length(definition) - length(replace(definition, predecessor, '')) <> length(predecessor) then
    raise exception using errcode = '55000', message = 'meta_unassigned_admin_push_unknown_send_gate';
  end if;
  execute replace(definition, predecessor, replacement);
end;
$migration$;

create function private.guard_meta_unassigned_admin_alert_write()
returns trigger language plpgsql set search_path = '' as $function$
declare
  prefix constant text := 'meta_unassigned_admin_alert:';
  new_reserved boolean := coalesce(new.metadata ? 'meta_unassigned_admin_alert'
    or left(new.metadata->>'dedupe_key', length(prefix)) = prefix, false);
  old_reserved boolean := false;
begin
  if tg_op = 'UPDATE' then
    old_reserved := coalesce(old.metadata ? 'meta_unassigned_admin_alert'
      or left(old.metadata->>'dedupe_key', length(prefix)) = prefix, false);
  end if;
  if (new_reserved or old_reserved)
    and (current_user in ('anon', 'authenticated') or current_setting('role', true) in ('anon', 'authenticated'))
  then
    raise exception using errcode = '42501', message = 'meta_unassigned_admin_alert_backend_owned';
  end if;
  -- A concurrent disable can follow the intake capability probe. Keep the
  -- notification and the lead transaction, but do not persist a new marker.
  if new_reserved and not old_reserved and to_regprocedure('private.meta_unassigned_admin_push_enabled()') is null then
    new.metadata := new.metadata - array['meta_unassigned_admin_alert', 'dedupe_key'];
  end if;
  return new;
end;
$function$;

create trigger zz_guard_meta_unassigned_admin_alert_write
  before insert or update of id, organization_id, user_id, lead_id, metadata, title, content, body, type, channel, target_url
  on public.notifications for each row execute function private.guard_meta_unassigned_admin_alert_write();

revoke all on function private.guard_meta_unassigned_admin_alert_write() from public, anon, authenticated, service_role;

-- The trigger creation holds the write lock through this check. A row created
-- before the guards cannot become trusted solely because of the migration.
do $precheck$
declare prefix constant text := 'meta_unassigned_admin_alert:';
begin
  if exists (
    select 1 from public.notifications
    where metadata ? 'meta_unassigned_admin_alert'
      or left(metadata->>'dedupe_key', length(prefix)) = prefix
  ) then
    raise exception using errcode = '55000', message = 'meta_unassigned_admin_push_preexisting_reserved_notifications';
  end if;
end;
$precheck$;

-- Dropping this capability disables creation and sending of marked alerts.
-- Retain the write trigger and delivery gates during an API rollback.
create function private.meta_unassigned_admin_push_enabled()
returns boolean language sql immutable set search_path = '' as $$ select true $$;
revoke all on function private.meta_unassigned_admin_push_enabled() from public, anon, authenticated, service_role;

commit;
