\set ON_ERROR_STOP on
\pset pager off
-- Required: direction=apply|rollback, effective_from_utc, expected_result_md5.
-- Rollback restores the priority rule and retains the cutoff for old notices.
begin;
set local lock_timeout = '500ms';
set local statement_timeout = '10s';
select set_config('vimob_away_priority.direction', :'direction', true);
select set_config('vimob_away_priority.effective_from_utc', :'effective_from_utc', true);
select set_config('vimob_away_priority.expected_result_md5', :'expected_result_md5', true);

do $guard$
declare
  target constant regprocedure := to_regprocedure('private.materialize_notification_deliveries(uuid,boolean)');
  prior_md5 constant text := 'bdc53407925669636c3d5f0ee6f7fd03';
  next_md5 constant text := current_setting('vimob_away_priority.expected_result_md5');
  direction constant text := current_setting('vimob_away_priority.direction');
  effective constant text := current_setting('vimob_away_priority.effective_from_utc');
  anchor constant text := $a$        when v_channel = 'whatsapp' and not p_backfill
          and v_notification.created_at >= timestamptz '2026-11-11T04:31:52Z'
          and lower(coalesce(v_notification.metadata ->> 'event_key', '')) in (
            'lead_redistributed_received', 'lead_redistribution_warning'
          ) then 250$a$;
  addition text;
  from_text text;
  to_text text;
  original text;
  definition text;
  attributes jsonb;
  next_body text;
begin
  if target is null or current_user <> 'postgres' or current_user <> session_user
     or direction not in ('apply', 'rollback') or next_md5 !~ '^[a-f0-9]{32}$'
     or next_md5 = prior_md5 or effective !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{6})?Z$'
     or not isfinite(effective::timestamptz) then
    raise exception 'away_priority_invalid_preflight';
  end if;
  addition := format($a$
        when v_channel = 'whatsapp' and not p_backfill
          and v_notification.created_at >= timestamptz %L
          and lower(coalesce(v_notification.metadata ->> 'event_key', '')) = 'lead_redistributed_away'
          then 250$a$, effective);

  perform pg_advisory_xact_lock(target::oid::bigint);
  select replace(p.prosrc, chr(13), ''), replace(pg_get_functiondef(p.oid), chr(13), ''),
    to_jsonb(p) - array['prosrc', 'prosqlbody']
  into original, definition, attributes
  from pg_proc p where p.oid = target and p.proowner = 'postgres'::regrole
    and p.prosecdef and p.provolatile = 'v' and p.proconfig = array['search_path=""'];
  if original is null or md5(original) is distinct from
       (case when direction = 'apply' then prior_md5 else next_md5 end) then
    raise exception 'away_priority_preimage_drift';
  end if;
  from_text := case when direction = 'apply' then anchor else anchor || addition end;
  to_text := case when direction = 'apply' then anchor || addition else anchor end;
  if length(original) - length(replace(original, from_text, '')) <> length(from_text)
     or length(definition) - length(replace(definition, from_text, '')) <> length(from_text) then
    raise exception 'away_priority_anchor_drift';
  end if;
  next_body := replace(original, from_text, to_text);
  if md5(next_body) is distinct from (case when direction = 'apply' then next_md5 else prior_md5 end) then
    raise exception 'away_priority_result_drift';
  end if;
  execute replace(definition, from_text, to_text);
  if not exists (select from pg_proc p where p.oid = target
    and replace(p.prosrc, chr(13), '') = next_body
    and to_jsonb(p) - array['prosrc', 'prosqlbody'] = attributes) then
    raise exception 'away_priority_postcondition_failed';
  end if;
end;
$guard$;

select md5(replace(p.prosrc, chr(13), '')) as materializer_md5
from pg_proc p where p.oid = 'private.materialize_notification_deliveries(uuid,boolean)'::regprocedure;
commit;
