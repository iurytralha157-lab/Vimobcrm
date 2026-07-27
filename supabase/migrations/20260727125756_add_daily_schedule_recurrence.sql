alter table public.schedule_events
  add constraint schedule_events_recurrence_rule_daily_check
  check (
    recurrence_rule is null
    or recurrence_rule = any (array['daily'::text, 'weekly'::text, 'monthly'::text, 'yearly'::text])
  )
  not valid;

alter table public.schedule_events
  validate constraint schedule_events_recurrence_rule_daily_check;

alter table public.schedule_events
  drop constraint schedule_events_recurrence_rule_check;

alter table public.schedule_events
  rename constraint schedule_events_recurrence_rule_daily_check
  to schedule_events_recurrence_rule_check;
