begin;

-- The canonical outbox/worker owns all gamification writes.

do $contract$
begin
  if to_regclass('public.gamification_outbox') is null
     or to_regclass('public.gamification_events') is null
     or to_regclass('public.user_gamification_stats') is null then
    raise exception using
      errcode = '55000',
      message = 'cannot retire the legacy gamification event graph before the canonical engine is installed';
  end if;

  if to_regclass('public.prospecting_reports') is not null
     and not exists (
       select 1
       from pg_trigger as trigger_definition
       where trigger_definition.tgrelid = 'public.prospecting_reports'::regclass
         and trigger_definition.tgname = 'gamification_canonical_prospecting_enqueue'
         and trigger_definition.tgfoid = to_regprocedure(
           'private.enqueue_prospecting_report_gamification()'
         )
         and trigger_definition.tgenabled <> 'D'
         and not trigger_definition.tgisinternal
     ) then
    raise exception using
      errcode = '55000',
      message = 'cannot retire the legacy prospecting producer without the canonical outbox trigger';
  end if;

  if exists (
    select 1
    from pg_trigger as trigger_definition
    join pg_proc as procedure on procedure.oid = trigger_definition.tgfoid
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where not trigger_definition.tgisinternal
      and namespace.nspname = 'public'
      and procedure.proname = any(array[
        'handle_lead_gamification',
        'handle_call_gamification',
        'handle_schedule_gamification',
        'handle_activity_gamification',
        'handle_prospecting_report_points',
        'handle_prospecting_report_gamification',
        'handle_manual_gamification_entry'
      ])
      and not (
        trigger_definition.tgrelid = to_regclass('public.prospecting_reports')
        and trigger_definition.tgname = 'tr_prospecting_report_points'
        and procedure.proname = 'handle_prospecting_report_points'
      )
  ) then
    raise exception using
      errcode = '55000',
      message = 'unexpected live trigger still depends on the legacy gamification event graph';
  end if;
end
$contract$;

do $drop_legacy_prospecting_trigger$
begin
  if to_regclass('public.prospecting_reports') is not null then
    execute 'drop trigger if exists tr_prospecting_report_points on public.prospecting_reports';
  end if;
end
$drop_legacy_prospecting_trigger$;

drop function if exists public.handle_prospecting_report_gamification();
drop function if exists public.handle_prospecting_report_points();
drop function if exists public.handle_manual_gamification_entry();
drop function if exists public.handle_activity_gamification();
drop function if exists public.handle_schedule_gamification();
drop function if exists public.handle_call_gamification();
drop function if exists public.handle_lead_gamification();
drop function if exists public.award_gamification_points(uuid, uuid, text, uuid, jsonb);
drop function if exists public.process_gamification_event(uuid, uuid, text, integer, uuid, jsonb);

commit;
