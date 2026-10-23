-- Validate distribution authorization after a contested delivery row has been
-- acquired, in the same transaction that starts the attempt. This is the
-- authorization boundary; provider requests already started are not revocable.
-- Previous API replicas remain compatible with the original start function.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

do $policy_clock$
declare definition text;
begin
  select pg_get_functiondef(to_regprocedure('private.queue_notification_delivery_allowed(uuid,uuid,uuid,text,jsonb)')) into definition;
  if definition is null or length(definition)-length(replace(definition,'now_at timestamptz := statement_timestamp();',''))
    <>length('now_at timestamptz := statement_timestamp();') then
    raise exception using errcode='55000',message='queue_notification_unknown_clock_predecessor';
  end if;
  -- statement_timestamp predates a row-lock wait. Deadline/window decisions
  -- must use the time when authorization is actually checked after that wait.
  execute replace(definition,'now_at timestamptz := statement_timestamp();','now_at timestamptz := clock_timestamp();');
end;
$policy_clock$;

create function private.start_queue_authorized_notification_delivery(p_delivery uuid,p_lease uuid,p_provider text,p_snapshot jsonb)
returns text language plpgsql volatile security definer set search_path='' set lock_timeout='5s' as $function$
declare observed private.notification_deliveries%rowtype; delivery private.notification_deliveries%rowtype;
  notification public.notifications%rowtype; event text; push_allowed boolean:=true;
begin
  if p_delivery is null or p_lease is null or char_length(coalesce(p_provider,''))>100 then return 'lease_lost';end if;
  -- Preserve the original push lock order: users -> membership -> token ->
  -- delivery. The first read is deliberately unlocked; revalidate identity below.
  select * into observed from private.notification_deliveries where id=p_delivery;
  if not found or observed.status<>'leased' or observed.lease_token is distinct from p_lease then return 'lease_lost';end if;
  if observed.channel='push' and right(coalesce(observed.leased_by,''),26)='|push_device_v3|wa_push_v2' then
    push_allowed:=private.lock_push_notification_recipient(observed.organization_id,observed.user_id,observed.push_token_id);
  end if;
  -- A fresh statement follows both potential waits. Queue/lead locks are never
  -- acquired here: ownership writers may enqueue deliveries in their transaction.
  select * into delivery from private.notification_deliveries where id=p_delivery for update;
  if not found or delivery.status<>'leased' or delivery.lease_token is distinct from p_lease
    or delivery.lease_expires_at<=clock_timestamp() or delivery.expires_at<=clock_timestamp()
    or delivery.attempt_count>=delivery.max_attempts then return 'lease_lost';end if;
  if (delivery.notification_id,delivery.organization_id,delivery.user_id,delivery.channel,delivery.recipient_key,
      delivery.push_token_id,delivery.idempotency_key,delivery.leased_by) is distinct from
    (observed.notification_id,observed.organization_id,observed.user_id,observed.channel,observed.recipient_key,
      observed.push_token_id,observed.idempotency_key,observed.leased_by) then return 'lease_lost';end if;
  if not push_allowed then
    -- Match the original start's account/device revocation cancellation without
    -- re-opening a rejected gate or consuming an attempt after the wait.
    update private.notification_deliveries set status='cancelled',next_attempt_at=null,
      lease_token=null,leased_by=null,lease_expires_at=null,dependency_key=null,blocked_at=null,terminal_at=now(),
      last_error_code='push_recipient_or_device_revoked',last_error_message='The account, membership or device was revoked before provider start.',
      last_error_at=now(),updated_at=now() where id=p_delivery;
    return 'lease_lost';
  end if;
  select * into notification from public.notifications where id=delivery.notification_id
    and organization_id=delivery.organization_id and user_id=delivery.user_id;
  if not found then return 'queue_policy_changed';end if;
  -- The Go sender was prepared from this exact business snapshot. A newer valid
  -- notification must not authorize an older title/body/lead/metadata payload.
  if p_snapshot is distinct from jsonb_build_object('id',notification.id,'organization_id',notification.organization_id,
    'user_id',notification.user_id,'lead_id',notification.lead_id,'title',coalesce(notification.title,''),
    'content',coalesce(notification.content,notification.body,''),'type',coalesce(notification.type,'info'),
    'target_url',coalesce(notification.target_url,''),'metadata',coalesce(notification.metadata,'{}'::jsonb)
      -array['dispatch','whatsapp_dispatch','push_dispatch','email_dispatch']) then return 'queue_policy_changed';end if;
  event:=lower(btrim(coalesce(notification.metadata->>'event_key','')));
  if event in ('queue_pool_available','new_lead_received','lead_redistributed_received','lead_redistribution_warning')
    and (notification.lead_id is null or not coalesce(private.queue_notification_delivery_allowed(
      notification.organization_id,notification.lead_id,notification.user_id,event,notification.metadata),false)) then
    return 'queue_policy_changed';
  end if;
  if private.start_notification_delivery(p_delivery,p_lease,p_provider) then return 'started';end if;
  return 'lease_lost';
end;
$function$;
revoke all on function private.start_queue_authorized_notification_delivery(uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;
-- Workers connect through the existing owner-only gateway. No client grant.
-- Rollback is forward-only: retain the helper while any new API replica uses
-- it. Restore the clock definition only together with the reviewed API policy.
commit;
