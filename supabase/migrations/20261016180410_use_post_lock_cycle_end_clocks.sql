-- Close attendance cycles with the post-lock clock. A current cycle may
-- have started after transaction_timestamp() during a lock wait or a previous
-- legitimate assignment in the same transaction. No eligibility/fact/rule or
-- historical row is changed. Keep every other predecessor statement intact.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $cycle_clock$
declare definition text; anchor text; replacement text; item record;
begin
  if not exists(select 1 from pg_proc where oid=to_regprocedure('private.capture_lead_cycles()')
    and md5(regexp_replace(prosrc,'\s','','g'))='5565feaad6a6d3496712d1d242a3745a'
    and prosecdef and proowner='postgres'::regrole and 'search_path=""'=any(proconfig)) then
    raise exception using errcode='55000',message='queue_cycle_clock_unknown_predecessor';end if;
  select pg_get_functiondef(to_regprocedure('private.capture_lead_cycles()')) into definition;
  for item in select * from(values
    ('set ended_at = now(),','set ended_at = clock_timestamp(),'),
    ('set exited_at = now(),','set exited_at = clock_timestamp(),'),
    ('set ended_at = coalesce(ended_at, now()),','set ended_at = coalesce(ended_at, clock_timestamp()),'),
    ('set exited_at = coalesce(exited_at, now()),','set exited_at = coalesce(exited_at, clock_timestamp()),')) replacements(anchor,replacement) loop
    anchor:=item.anchor;replacement:=item.replacement;
    if length(definition)-length(replace(definition,anchor,''))<>length(anchor) then
      raise exception using errcode='55000',message='queue_cycle_clock_anchor_mismatch';end if;
    definition:=replace(definition,anchor,replacement);
  end loop;
  execute definition;
end;
$cycle_clock$;
-- A forward rollback must preserve end>=start; restoring now() reinstates the
-- demonstrated lock-wait bug. No data backfill or constraint weakening.
commit;
