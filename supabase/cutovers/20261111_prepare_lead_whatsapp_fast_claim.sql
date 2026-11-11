\set ON_ERROR_STOP on
\pset pager off
-- Run in autocommit with direction=apply|rollback. The current API keeps using
-- the existing claim path. The marker and function changes publish together.
select :'direction' = 'apply' as applying, :'direction' = 'rollback' as rolling_back
\gset
\if :applying
  set lock_timeout = '2s';
  set statement_timeout = '2min';
  create index concurrently if not exists notification_deliveries_lead_whatsapp_due_idx
    on private.notification_deliveries (priority desc, next_attempt_at, created_at, id)
    where channel = 'whatsapp' and status in ('queued', 'retry_wait')
      and metadata->>'event_key' in (
        'new_lead_received', 'lead_redistribution_warning', 'lead_redistributed_received', 'lead_redistributed_away'
      );
\else
  \if :rolling_back
  \else
    do $guard$ begin raise exception 'lead_whatsapp_fast_claim_invalid_direction'; end $guard$;
  \endif
\endif

begin;
set local lock_timeout = '500ms';
set local statement_timeout = '10s';
select set_config('vimob_lead_whatsapp_fast.direction', :'direction', true);

do $guard$
declare
  target constant regprocedure := to_regprocedure('private.claim_notification_deliveries(text,integer,interval,text[])');
  prior_md5 constant text := '521340b7d64ff3401faefaa73fc7f16a';
  direction constant text := current_setting('vimob_lead_whatsapp_fast.direction');
  dispatch_anchor constant text := $a$  if right(p_worker_id,11)='|wa_push_v2' and (p_channels is null or 'push'=any(p_channels)) then$a$;
  fast_branch constant text := $a$  if right(p_worker_id, 42) = '|lead_wa_fast_v1|push_device_v3|wa_push_v2' then
    if p_channels is distinct from array['whatsapp']::text[] then
      raise exception 'invalid lead WhatsApp notification worker channels';
    end if;

    return query
      with candidates as (
        select delivery.id
        from private.notification_deliveries delivery
        join public.notifications source_notice on source_notice.id = delivery.notification_id
          and source_notice.organization_id = delivery.organization_id
        where delivery.channel = 'whatsapp'
          and delivery.status in ('queued', 'retry_wait')
          and delivery.metadata->>'event_key' in (
            'new_lead_received', 'lead_redistribution_warning', 'lead_redistributed_received', 'lead_redistributed_away'
          )
          and source_notice.metadata->>'event_key' = delivery.metadata->>'event_key'
          and least(source_notice.created_at, delivery.created_at) > clock_timestamp() - interval '1 hour'
          and (source_notice.metadata->>'event_key' <> 'lead_redistributed_away'
            or source_notice.created_at >= timestamptz '2026-11-11T09:41:53.714357Z')
          and delivery.next_attempt_at <= now()
          and delivery.expires_at > now()
          and delivery.attempt_count < delivery.max_attempts
        order by delivery.priority desc, delivery.next_attempt_at, delivery.created_at, delivery.id
        limit v_batch_size
        for update of delivery skip locked
      )
      update private.notification_deliveries delivery
      set status = 'leased', next_attempt_at = null, lease_token = gen_random_uuid(),
          leased_by = btrim(p_worker_id), lease_expires_at = now() + v_lease_for,
          dependency_key = null, blocked_at = null, updated_at = now()
      from candidates
      where delivery.id = candidates.id
      returning delivery.*;
    return;
  end if;

$a$;
  general_anchor constant text := $a$        and (p_channels is null or delivery.channel = any(p_channels))$a$;
  general_filter constant text := $a$
        and (
          right(p_worker_id, 45) <> '|lead_wa_general_v1|push_device_v3|wa_push_v2'
          or delivery.channel <> 'whatsapp'
          or coalesce(delivery.metadata->>'event_key', '') not in (
            'new_lead_received', 'lead_redistribution_warning', 'lead_redistributed_received', 'lead_redistributed_away'
          )
          or not exists (
            select 1 from public.notifications lead_notice
            where lead_notice.id = delivery.notification_id
              and lead_notice.organization_id = delivery.organization_id
              and lead_notice.metadata->>'event_key' = delivery.metadata->>'event_key'
          )
        )$a$;
  old_dispatch text;
  new_dispatch text;
  old_general text;
  new_general text;
  original text;
  definition text;
  attributes jsonb;
  next_body text;
begin
  if target is null or current_user <> 'postgres' or current_user <> session_user
     or (direction = 'apply' and not exists (
       select from pg_index where indexrelid = to_regclass('private.notification_deliveries_lead_whatsapp_due_idx')
         and indrelid = 'private.notification_deliveries'::regclass and indisvalid and indisready
     )) then
    raise exception 'lead_whatsapp_fast_claim_invalid_preflight';
  end if;
  perform pg_advisory_xact_lock(target::oid::bigint);
  select replace(p.prosrc, chr(13), ''), replace(pg_get_functiondef(p.oid), chr(13), ''),
    to_jsonb(p) - array['prosrc', 'prosqlbody']
  into original, definition, attributes
  from pg_proc p where p.oid = target and p.proowner = 'postgres'::regrole
    and p.prosecdef and p.provolatile = 'v' and p.proconfig = array['search_path=""'];
  if original is null
     or (direction = 'apply' and md5(original) <> prior_md5)
     or (direction = 'rollback' and md5(replace(replace(original,
       fast_branch || dispatch_anchor, dispatch_anchor), general_anchor || general_filter, general_anchor)) <> prior_md5) then
    raise exception 'lead_whatsapp_fast_claim_preimage_drift';
  end if;
  old_dispatch := case when direction = 'apply' then dispatch_anchor else fast_branch || dispatch_anchor end;
  new_dispatch := case when direction = 'apply' then fast_branch || dispatch_anchor else dispatch_anchor end;
  old_general := case when direction = 'apply' then general_anchor else general_anchor || general_filter end;
  new_general := case when direction = 'apply' then general_anchor || general_filter else general_anchor end;
  if length(original) - length(replace(original, old_dispatch, '')) <> length(old_dispatch)
     or length(original) - length(replace(original, old_general, '')) <> length(old_general) then
    raise exception 'lead_whatsapp_fast_claim_anchor_drift';
  end if;
  next_body := replace(replace(original, old_dispatch, new_dispatch), old_general, new_general);
  execute replace(replace(definition, old_dispatch, new_dispatch), old_general, new_general);
  if not exists (select from pg_proc p where p.oid = target
    and replace(p.prosrc, chr(13), '') = next_body
    and to_jsonb(p) - array['prosrc', 'prosqlbody'] = attributes) then
    raise exception 'lead_whatsapp_fast_claim_postcondition_failed';
  end if;
end;
$guard$;

\if :applying
  create function private.notification_lead_whatsapp_fast_claim_v1()
    returns boolean language sql immutable set search_path = '' as 'select true';
  revoke all on function private.notification_lead_whatsapp_fast_claim_v1() from public, anon, authenticated, service_role;
\else
  drop function private.notification_lead_whatsapp_fast_claim_v1();
\endif
commit;

\if :rolling_back
  drop index concurrently private.notification_deliveries_lead_whatsapp_due_idx;
\endif
