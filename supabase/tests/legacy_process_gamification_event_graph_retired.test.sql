begin;

create extension if not exists pgtap with schema extensions;
select plan(5);

select ok(
  to_regprocedure(
    'public.process_gamification_event(uuid,uuid,text,integer,uuid,jsonb)'
  ) is null,
  'the legacy direct gamification event processor is retired'
);

select ok(
  to_regprocedure(
    'public.award_gamification_points(uuid,uuid,text,uuid,jsonb)'
  ) is null,
  'the legacy direct award wrapper is retired'
);

select is(
  (
    select count(*)
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname = any(array[
        'handle_lead_gamification',
        'handle_call_gamification',
        'handle_schedule_gamification',
        'handle_activity_gamification',
        'handle_prospecting_report_points',
        'handle_prospecting_report_gamification',
        'handle_manual_gamification_entry'
      ])
  ),
  0::bigint,
  'all legacy trigger wrappers are retired'
);

select ok(
  to_regclass('public.prospecting_reports') is null
  or not exists (
    select 1
    from pg_trigger as trigger_definition
    where trigger_definition.tgrelid = 'public.prospecting_reports'::regclass
      and trigger_definition.tgname = 'tr_prospecting_report_points'
      and not trigger_definition.tgisinternal
  ),
  'the duplicate legacy prospecting trigger is retired'
);

select ok(
  to_regclass('public.prospecting_reports') is null
  or exists (
    select 1
    from pg_trigger as trigger_definition
    where trigger_definition.tgrelid = 'public.prospecting_reports'::regclass
      and trigger_definition.tgname = 'gamification_canonical_prospecting_enqueue'
      and trigger_definition.tgfoid = to_regprocedure(
        'private.enqueue_prospecting_report_gamification()'
      )
      and trigger_definition.tgenabled <> 'D'
      and not trigger_definition.tgisinternal
  ),
  'the canonical prospecting outbox trigger remains active'
);

select * from finish();
rollback;
