\set ON_ERROR_STOP on
\pset pager off
-- Required: effective_from_utc. Repeat with the same cutoff to reconcile pending rows.
-- The claim fence prevents late materialization from reopening historical sends.
begin;
set local lock_timeout = '500ms';
set local statement_timeout = '12s';
select set_config('vimob_away_cancel.effective_from_utc', :'effective_from_utc', true);

do $guard$
declare
  target constant regprocedure := to_regprocedure('private.claim_notification_deliveries(text,integer,interval,text[])');
  prior_md5 constant text := '1485f814373e69b56797041fb01a8140';
  effective constant text := current_setting('vimob_away_cancel.effective_from_utc');
  anchor constant text := $a$              and least(source_notice.created_at, delivery.created_at) <= clock_timestamp() - interval '1 hour'
              and source_notice.metadata->>'event_key' in (
                'new_lead_received', 'lead_redistributed_received', 'lead_redistribution_warning',
                'lead_redistributed_away', 'queue_pool_available',
                'lead_duplicate_existing', 'lead_reentry'
              )$a$;
  replacement text;
  original text;
  definition text;
  attributes jsonb;
  next_body text;
begin
  if target is null or current_user <> 'postgres' or current_user <> session_user
     or effective !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{6})?Z$'
     or not isfinite(effective::timestamptz) or effective::timestamptz > clock_timestamp()
     or (select md5(replace(p.prosrc, chr(13), '')) from pg_proc p
       where p.oid = to_regprocedure('private.start_queue_authorized_notification_delivery(uuid,uuid,text,jsonb)'))
       is distinct from 'bbc21bb2c6938f6c2b102cca08e35c67'
     or not exists (select from public.system_settings s where s.key = 'notifications'
       and s.value #> '{notification_dispatch,whatsapp,enabled}' = 'true'::jsonb
       and s.value #> '{notification_dispatch,whatsapp,standard_failover,enabled}' = 'false'::jsonb) then
    raise exception 'away_cancel_invalid_preflight';
  end if;

  replacement := format($a$              and (
                (source_notice.metadata->>'event_key' = 'lead_redistributed_away'
                  and source_notice.created_at < timestamptz %L)
                or (
                  least(source_notice.created_at, delivery.created_at) <= clock_timestamp() - interval '1 hour'
                  and source_notice.metadata->>'event_key' in (
                    'new_lead_received', 'lead_redistributed_received', 'lead_redistribution_warning',
                    'lead_redistributed_away', 'queue_pool_available',
                    'lead_duplicate_existing', 'lead_reentry'
                  )
                )
              )$a$, effective);

  perform pg_advisory_xact_lock(target::oid::bigint);
  select replace(p.prosrc, chr(13), ''), replace(pg_get_functiondef(p.oid), chr(13), ''),
    to_jsonb(p) - array['prosrc', 'prosqlbody']
  into original, definition, attributes
  from pg_proc p where p.oid = target and p.proowner = 'postgres'::regrole
    and p.prosecdef and p.provolatile = 'v' and p.proconfig = array['search_path=""'];
  if original is null then
    raise exception 'away_cancel_function_attributes_drift';
  end if;
  if md5(original) <> prior_md5 then
    if length(original) - length(replace(original, replacement, '')) <> length(replacement)
       or md5(replace(original, replacement, anchor)) <> prior_md5 then
      raise exception 'away_cancel_function_source_drift';
    end if;
    return;
  end if;
  if length(original) - length(replace(original, anchor, '')) <> length(anchor)
     or length(definition) - length(replace(definition, anchor, '')) <> length(anchor) then
    raise exception 'away_cancel_function_anchor_drift';
  end if;
  next_body := replace(original, anchor, replacement);
  execute replace(definition, anchor, replacement);
  if not exists (select from pg_proc p where p.oid = target
    and replace(p.prosrc, chr(13), '') = next_body
    and to_jsonb(p) - array['prosrc', 'prosqlbody'] = attributes) then
    raise exception 'away_cancel_function_postcondition_failed';
  end if;
end;
$guard$;

with targets as materialized (
  select d.id, d.status, clock_timestamp() as changed_at
  from private.notification_deliveries d
  join public.notifications n on n.id = d.notification_id and n.organization_id = d.organization_id
  where d.channel = 'whatsapp'
    and d.metadata->>'event_key' = 'lead_redistributed_away'
    and n.metadata->>'event_key' = 'lead_redistributed_away'
    and n.created_at < :'effective_from_utc'::timestamptz
    and d.status in ('queued', 'retry_wait', 'blocked_dependency')
    and d.accepted_at is null and d.delivered_at is null
  for update of d
), changed as (
  update private.notification_deliveries d
  set status = 'cancelled', next_attempt_at = null, dependency_key = null, blocked_at = null,
      terminal_at = t.changed_at, updated_at = t.changed_at, last_error_at = t.changed_at,
      last_error_code = 'redistribution_away_cancelled_before_cutoff',
      last_error_message = 'Previous-assignee WhatsApp notification cancelled by operator.'
  from targets t
  where d.id = t.id and d.status = t.status
  returning d.id, t.status, t.changed_at
), audited as (
  insert into private.notification_delivery_attempts
    (delivery_id, event_type, from_status, outcome, worker_id, completed_at, error_code, metadata, created_at)
  select id, 'sweep', status, 'cancelled', 'vimob-operator:away-notification-cutoff', changed_at,
    'redistribution_away_cancelled_before_cutoff',
    jsonb_build_object('event_key', 'lead_redistributed_away', 'cutoff', :'effective_from_utc'::timestamptz), changed_at
  from changed
  returning delivery_id
)
select (select count(*) from targets) as matched,
       (select count(*) from changed) as cancelled,
       (select count(*) from audited) as audited,
       (select count(*) from targets) = (select count(*) from changed)
         and (select count(*) from changed) = (select count(*) from audited) as audit_ok
\gset
\if :audit_ok
  select :matched as matched, :cancelled as cancelled, :audited as audited;
\else
  do $guard$ begin raise exception 'away_cancel_audit_count_mismatch'; end $guard$;
\endif

commit;
