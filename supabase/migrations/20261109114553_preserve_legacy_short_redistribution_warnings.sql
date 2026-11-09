-- Keep already configured short warnings on legacy queues during API rollout.
-- All owner, membership, human-activity, deadline and settings checks remain.
begin;
set local lock_timeout='250ms';
set local statement_timeout='2500ms';
set local transaction_timeout='3s';
set local search_path=pg_catalog;

do $legacy_warning_delivery$
declare
  fn oid:=to_regprocedure('private.queue_notification_delivery_allowed(uuid,uuid,uuid,text,jsonb)');
  definition text;
begin
  if not exists(select 1 from pg_proc where oid=fn and proowner='postgres'::regrole
      and prosecdef and provolatile='s' and proconfig=array['search_path=""']::text[]
      and md5(prosrc) in ('2eb84b930b016c3465374a6e1fb2c38e','b0b832c8788aca02c44a15018563afe2'))
    or not has_function_privilege('service_role',fn,'EXECUTE')
    or has_function_privilege('anon',fn,'EXECUTE')
    or has_function_privilege('authenticated',fn,'EXECUTE') then
    raise exception using errcode='55000',message='queue_notification_unknown_warning_predecessor';
  end if;

  definition:=pg_get_functiondef(fn);
  definition:=replace(definition,'if not found or j.timeout_minutes<=5 or j.warning_minutes<=0',
    'if not found or j.timeout_minutes<1 or j.warning_minutes<=0');
  definition:=replace(definition,'if t<=5 or warning<=0 or warning>=t then return false; end if;',
    $policy$if t<1 or warning<=0 or warning>=t
    or (t<=5 and (j.id is null or r.lead_id is not null or q.settings ? 'operating_schedule')) then return false; end if;$policy$);
  execute definition;
end;
$legacy_warning_delivery$;
commit;
