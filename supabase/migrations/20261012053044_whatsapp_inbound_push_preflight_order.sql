begin;
set local lock_timeout = '5s';
set local statement_timeout = '5min';

-- A real push token is required by the generic outbox. Track the absence of a
-- device separately; never fabricate a token or a provider attempt. The
-- existing notification claim transaction also drains this bounded queue.
create table private.whatsapp_inbound_push_waiting (
  notification_id uuid primary key references public.notifications(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  expires_at timestamptz not null,
  next_check_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index whatsapp_inbound_push_waiting_due_idx
on private.whatsapp_inbound_push_waiting(next_check_at,notification_id);
create index whatsapp_inbound_push_waiting_expiry_idx
on private.whatsapp_inbound_push_waiting(expires_at,notification_id);
create index whatsapp_inbound_push_waiting_org_idx
on private.whatsapp_inbound_push_waiting(organization_id,notification_id);
alter table private.whatsapp_inbound_push_waiting enable row level security;
revoke all on private.whatsapp_inbound_push_waiting from public, anon, authenticated, service_role;

create or replace function private.expire_whatsapp_inbound_push_waiting(p_limit integer default 100)
returns integer language plpgsql security definer set search_path = ''
as $$
declare v_count integer;
begin
  if p_limit is null or p_limit<1 or p_limit>100 then raise exception 'invalid WhatsApp waiting expiry batch'; end if;
  with expired as (
    select notification_id from private.whatsapp_inbound_push_waiting
    where expires_at<=now() order by expires_at,notification_id limit p_limit for update skip locked
  ) delete from private.whatsapp_inbound_push_waiting waiting using expired
    where waiting.notification_id=expired.notification_id;
  get diagnostics v_count=row_count;
  return v_count;
end;
$$;
revoke all on function private.expire_whatsapp_inbound_push_waiting(integer) from public, anon, authenticated;
grant execute on function private.expire_whatsapp_inbound_push_waiting(integer) to service_role;

-- A resumable cursor examines pre-migration notifications in bounded pages.
-- New inserts register directly, so this is finite and cannot replay history.
create table private.whatsapp_inbound_push_waiting_seed (
  singleton boolean primary key default true check(singleton),
  created_after timestamptz not null,
  created_until timestamptz not null,
  cursor_created_at timestamptz,
  cursor_notification_id uuid,
  completed boolean not null default false
);
alter table private.whatsapp_inbound_push_waiting_seed enable row level security;
revoke all on private.whatsapp_inbound_push_waiting_seed from public, anon, authenticated, service_role;
insert into private.whatsapp_inbound_push_waiting_seed(created_after,created_until)
values(now()-interval '3 days',now());
create index notifications_whatsapp_inbound_waiting_seed_idx
on public.notifications(created_at,id) where metadata->>'event_key'='whatsapp_inbound_attendant';

create or replace function private.register_whatsapp_inbound_push_waiting(p_notification_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_notification public.notifications%rowtype; v_expiry timestamptz;
begin
  select * into v_notification from public.notifications where id=p_notification_id;
  if not found or v_notification.metadata->>'event_key' is distinct from 'whatsapp_inbound_attendant'
    or not private.notification_dispatch_required(v_notification.metadata#>'{dispatch,push,required}')
    or v_notification.metadata->>'whatsapp_inbound_provider_started'='true'
    or exists(select 1 from private.notification_deliveries where notification_id=p_notification_id and channel='push') then
    delete from private.whatsapp_inbound_push_waiting where notification_id=p_notification_id;
    return;
  end if;
  v_expiry:=private.notification_delivery_expiry(v_notification.created_at,v_notification.metadata,
    coalesce(v_notification.metadata#>'{dispatch,push}','{}'::jsonb));
  if v_expiry<=now() then
    delete from private.whatsapp_inbound_push_waiting where notification_id=p_notification_id;
    return;
  end if;
  if exists(select 1 from public.notifications sibling where sibling.organization_id=v_notification.organization_id
    and sibling.metadata->>'event_key'='whatsapp_inbound_attendant'
    and sibling.metadata->>'whatsapp_message_id'=v_notification.metadata->>'whatsapp_message_id'
    and (sibling.metadata->>'whatsapp_inbound_provider_started'='true'
      or exists(select 1 from private.notification_deliveries attempted where attempted.notification_id=sibling.id
        and attempted.channel='push' and (attempted.attempt_count>0 or attempted.status in ('sending','accepted','delivered'))))) then
    delete from private.whatsapp_inbound_push_waiting where notification_id=p_notification_id;
    return;
  end if;
  insert into private.whatsapp_inbound_push_waiting(notification_id,organization_id,expires_at)
  select v_notification.id,v_notification.organization_id,v_expiry
  from public.whatsapp_messages message where message.id=private.safe_uuid(v_notification.metadata->>'whatsapp_message_id')
    and message.organization_id=v_notification.organization_id and message.capture_state='captured'
    and message.lead_id is not null and message.direction='inbound' and message.from_me is false
    and message.message_type not in ('reaction','system','deleted')
  on conflict(notification_id) do update set expires_at=least(whatsapp_inbound_push_waiting.expires_at,excluded.expires_at);
end;
$$;
revoke all on function private.register_whatsapp_inbound_push_waiting(uuid)
from public, anon, authenticated, service_role;

create or replace function private.seed_whatsapp_inbound_push_waiting(p_limit integer default 100)
returns integer language plpgsql security definer set search_path = ''
as $$
declare v_seed private.whatsapp_inbound_push_waiting_seed%rowtype; v_notification record; v_count integer:=0;
begin
  if p_limit is null or p_limit<1 or p_limit>100 then raise exception 'invalid WhatsApp waiting seed batch'; end if;
  select * into v_seed from private.whatsapp_inbound_push_waiting_seed
    where singleton and not completed for update skip locked;
  if not found then return 0; end if;
  for v_notification in
    select notification.id,notification.created_at from public.notifications notification
    where notification.metadata->>'event_key'='whatsapp_inbound_attendant'
      and notification.created_at>=v_seed.created_after and notification.created_at<=v_seed.created_until
      and (v_seed.cursor_created_at is null
        or (notification.created_at,notification.id)>(v_seed.cursor_created_at,v_seed.cursor_notification_id))
    order by notification.created_at,notification.id limit p_limit
  loop
    perform private.register_whatsapp_inbound_push_waiting(v_notification.id);
    v_seed.cursor_created_at:=v_notification.created_at;
    v_seed.cursor_notification_id:=v_notification.id;
    v_count:=v_count+1;
  end loop;
  update private.whatsapp_inbound_push_waiting_seed
    set cursor_created_at=v_seed.cursor_created_at,cursor_notification_id=v_seed.cursor_notification_id,
      completed=(v_count<p_limit) where singleton;
  return v_count;
end;
$$;
revoke all on function private.seed_whatsapp_inbound_push_waiting(integer)
from public, anon, authenticated, service_role;

-- Eligibility here schedules an authorization check, never a device send.
-- The dispatcher still locks and revalidates current attendance before its
-- durable provider-start marker. All non-WhatsApp deliveries keep their rules.
create or replace function private.whatsapp_inbound_push_is_unstarted(
  p_delivery private.notification_deliveries
)
returns boolean language sql stable security definer set search_path = ''
as $$
  select p_delivery.channel='push' and p_delivery.attempt_count=0
    and p_delivery.status in ('queued','leased','retry_wait','blocked_dependency')
    and exists (
      select 1 from public.notifications notification
      join public.whatsapp_messages message on message.organization_id=notification.organization_id
        and message.id=private.safe_uuid(notification.metadata->>'whatsapp_message_id')
      where notification.id=p_delivery.notification_id
        and notification.organization_id=p_delivery.organization_id
        and notification.metadata->>'event_key'='whatsapp_inbound_attendant'
        and coalesce(notification.metadata->>'whatsapp_inbound_provider_started','false') <> 'true'
        and message.capture_state='captured' and message.from_me is false
        and message.direction='inbound' and message.lead_id is not null
        and message.message_type not in ('reaction','system','deleted')
        and not exists (
          select 1 from public.notifications sibling
          where sibling.organization_id=notification.organization_id
            and sibling.metadata->>'event_key'='whatsapp_inbound_attendant'
            and sibling.metadata->>'whatsapp_message_id'=message.id::text
            and (sibling.metadata->>'whatsapp_inbound_provider_started'='true'
              or exists (select 1 from private.notification_deliveries attempted
                where attempted.notification_id=sibling.id and attempted.channel='push'
                  and (attempted.attempt_count>0 or attempted.status in ('sending','accepted','delivered'))))
        )
    )
$$;
revoke all on function private.whatsapp_inbound_push_is_unstarted(private.notification_deliveries)
from public, anon, authenticated, service_role;

-- Wake a blocked job only when authorization changed. Missing configuration
-- for the same recipient remains blocked instead of spinning every worker tick.
create or replace function private.whatsapp_inbound_push_needs_reassignment(
  p_delivery private.notification_deliveries
)
returns boolean language sql stable security definer set search_path = ''
as $$
  select private.whatsapp_inbound_push_is_unstarted(p_delivery) and not exists (
    select 1 from public.notifications notification
    join public.whatsapp_messages message on message.organization_id=notification.organization_id
      and message.id=private.safe_uuid(notification.metadata->>'whatsapp_message_id')
    cross join lateral private.whatsapp_inbound_push_recipient(message.organization_id,message.id) recipient
    where notification.id=p_delivery.notification_id
      and notification.organization_id=p_delivery.organization_id
      and recipient.user_id=notification.user_id
      and recipient.attendance_entry_id::text=notification.metadata->>'attendance_entry_id'
      and recipient.binding_id::text=notification.metadata->>'binding_id'
      and coalesce(recipient.grant_id::text,'')=coalesce(notification.metadata->>'grant_id','')
  )
$$;
revoke all on function private.whatsapp_inbound_push_needs_reassignment(private.notification_deliveries)
from public, anon, authenticated, service_role;

-- Forward-only changes to existing dispatch functions preserve unrelated
-- migrations and their ACLs. Fail closed if the expected clauses have drifted.
do $patch$
declare v_definition text; v_old text; v_new text;
begin
  select replace(pg_catalog.pg_get_functiondef('private.materialize_notification_deliveries(uuid,boolean)'::regprocedure),E'\r\n',E'\n')
    into v_definition;
  v_old := 'and delivery.channel = ''push''
        and delivery.status in (';
  v_new := 'and delivery.channel = ''push''
        and not private.whatsapp_inbound_push_is_unstarted(delivery)
        and delivery.status in (';
  if (length(v_definition)-length(replace(v_definition,v_old,'')))/length(v_old) <> 1 then
    raise exception 'whatsapp_push_materialize_source_drift';
  end if;
  execute replace(v_definition,v_old,v_new);

  select replace(pg_catalog.pg_get_functiondef('private.materialize_notification_deliveries(uuid,boolean)'::regprocedure),E'\r\n',E'\n')
    into v_definition;
  v_old := 'return v_inserted;';
  v_new := 'if not p_backfill then perform private.register_whatsapp_inbound_push_waiting(p_notification_id); end if;
  return v_inserted;';
  if (length(v_definition)-length(replace(v_definition,v_old,'')))/length(v_old) <> 1 then
    raise exception 'whatsapp_push_materialize_waiting_source_drift';
  end if;
  execute replace(v_definition,v_old,v_new);

  select replace(pg_catalog.pg_get_functiondef('private.create_whatsapp_inbound_attendant_notification(uuid,uuid,uuid,uuid,uuid,uuid,uuid)'::regprocedure),E'\r\n',E'\n')
    into v_definition;
  v_old := 'select min(delivery.expires_at) into v_expiry from private.notification_deliveries delivery
    join public.notifications notification on notification.id=delivery.notification_id
    where notification.organization_id=p_organization_id
      and notification.metadata->>''event_key''=''whatsapp_inbound_attendant''
      and notification.metadata->>''whatsapp_message_id''=p_message_id::text and delivery.channel=''push'';';
  v_new := 'select min(pending.expires_at) into v_expiry from (
      select delivery.notification_id,delivery.expires_at from private.notification_deliveries delivery where delivery.channel=''push''
      union all select waiting.notification_id,waiting.expires_at from private.whatsapp_inbound_push_waiting waiting
    ) pending join public.notifications notification on notification.id=pending.notification_id
    where notification.organization_id=p_organization_id
      and notification.metadata->>''event_key''=''whatsapp_inbound_attendant''
      and notification.metadata->>''whatsapp_message_id''=p_message_id::text;';
  if (length(v_definition)-length(replace(v_definition,v_old,'')))/length(v_old) <> 1 then
    raise exception 'whatsapp_push_waiting_expiry_source_drift';
  end if;
  execute replace(v_definition,v_old,v_new);

  select replace(pg_catalog.pg_get_functiondef('private.prepare_whatsapp_inbound_attendant_push(uuid)'::regprocedure),E'\r\n',E'\n')
    into v_definition;
  v_old := 'and delivery.attempt_count=0 and delivery.expires_at>now()) then';
  v_new := 'and delivery.attempt_count=0 and delivery.expires_at>now())
    and not exists(select 1 from private.whatsapp_inbound_push_waiting waiting
      where waiting.notification_id=v_notification.id and waiting.organization_id=v_message.organization_id and waiting.expires_at>now()) then';
  if (length(v_definition)-length(replace(v_definition,v_old,'')))/length(v_old) <> 1 then
    raise exception 'whatsapp_push_waiting_prepare_source_drift';
  end if;
  execute replace(v_definition,v_old,v_new);

  select replace(pg_catalog.pg_get_functiondef('private.claim_notification_deliveries(text,integer,interval,text[])'::regprocedure),E'\r\n',E'\n')
    into v_definition;
  v_old := 'where delivery.status in (''queued'', ''retry_wait'')
        and delivery.next_attempt_at <= now()';
  v_new := 'where ((delivery.status in (''queued'', ''retry_wait'') and delivery.next_attempt_at <= now())
          or (delivery.status=''blocked_dependency'' and private.whatsapp_inbound_push_needs_reassignment(delivery)))';
  if (length(v_definition)-length(replace(v_definition,v_old,'')))/length(v_old) <> 1 then
    raise exception 'whatsapp_push_claim_status_source_drift';
  end if;
  v_definition := replace(v_definition,v_old,v_new);
  v_old := 'delivery.channel <> ''push''
          or exists (';
  v_new := 'delivery.channel <> ''push''
          or private.whatsapp_inbound_push_is_unstarted(delivery)
          or exists (';
  if (length(v_definition)-length(replace(v_definition,v_old,'')))/length(v_old) <> 1 then
    raise exception 'whatsapp_push_claim_token_source_drift';
  end if;
  v_definition := replace(v_definition,v_old,v_new);
  v_old := 'for v_delivery in';
  v_new := 'if p_channels is null or ''push''=any(p_channels) then
    perform private.seed_whatsapp_inbound_push_waiting(100);
    perform private.recover_whatsapp_inbound_push_waiting(v_batch_size);
  end if;
  for v_delivery in';
  if (length(v_definition)-length(replace(v_definition,v_old,'')))/length(v_old) <> 1 then
    raise exception 'whatsapp_push_waiting_claim_source_drift';
  end if;
  execute replace(v_definition,v_old,v_new);
end;
$patch$;

create or replace function private.recover_whatsapp_inbound_push_waiting(p_limit integer default 25)
returns integer language plpgsql security definer set search_path = ''
as $$
declare v_candidate record; v_waiting private.whatsapp_inbound_push_waiting%rowtype;
  v_outcome text; v_count integer:=0;
begin
  if p_limit is null or p_limit<1 or p_limit>100 then raise exception 'invalid WhatsApp waiting batch'; end if;
  for v_candidate in
    select waiting.notification_id,message.organization_id,message.id as message_id
    from private.whatsapp_inbound_push_waiting waiting
    join public.notifications notification on notification.id=waiting.notification_id and notification.organization_id=waiting.organization_id
    join public.whatsapp_messages message on message.organization_id=waiting.organization_id
      and message.id=private.safe_uuid(notification.metadata->>'whatsapp_message_id')
    where waiting.next_check_at<=now() or waiting.expires_at<=now()
    order by waiting.next_check_at,waiting.notification_id limit p_limit
  loop
    -- Match the dispatcher's message-advisory -> parent -> attendance order.
    -- Queue writes come afterwards, avoiding a notification-trigger inversion
    -- when two old/new recipient queue entries coexist for the same message.
    if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended(
      'whatsapp-inbound-push:'||v_candidate.organization_id::text||':'||v_candidate.message_id::text,0)) then continue; end if;
    -- Do not hold a queue lock before parent authorization locks: notification
    -- UPDATE triggers register this row while already holding the notification.
    select * into v_waiting from private.whatsapp_inbound_push_waiting
      where notification_id=v_candidate.notification_id;
    if not found then continue; end if;
    if v_waiting.expires_at<=now() then
      delete from private.whatsapp_inbound_push_waiting where notification_id=v_waiting.notification_id;
      continue;
    end if;
    if exists(select 1 from public.notifications sibling where sibling.organization_id=v_candidate.organization_id
      and sibling.metadata->>'event_key'='whatsapp_inbound_attendant'
      and sibling.metadata->>'whatsapp_message_id'=v_candidate.message_id::text
      and (sibling.metadata->>'whatsapp_inbound_provider_started'='true'
        or exists(select 1 from private.notification_deliveries attempted where attempted.notification_id=sibling.id
          and attempted.channel='push' and (attempted.attempt_count>0 or attempted.status in ('sending','accepted','delivered'))))) then
      delete from private.whatsapp_inbound_push_waiting where notification_id=v_waiting.notification_id;
      continue;
    end if;
    v_outcome:=private.prepare_whatsapp_inbound_attendant_push(v_waiting.notification_id);
    if v_outcome='authorized' then
      perform private.materialize_notification_deliveries(v_waiting.notification_id,false);
      update private.whatsapp_inbound_push_waiting set next_check_at=now()+interval '1 minute'
        where notification_id=v_waiting.notification_id;
    else
      delete from private.whatsapp_inbound_push_waiting where notification_id=v_waiting.notification_id;
    end if;
    v_count:=v_count+1;
  end loop;
  return v_count;
end;
$$;
revoke all on function private.recover_whatsapp_inbound_push_waiting(integer)
from public, anon, authenticated, service_role;

-- At most 100 existing notification rows are examined during migration. The
-- normal claim resumes this finite cursor; HTTP always remains in Go dispatch.
select private.seed_whatsapp_inbound_push_waiting(100);
commit;
