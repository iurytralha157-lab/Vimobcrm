begin;

create extension if not exists pgtap with schema extensions;
select plan(17);

select ok(to_regclass('public.site_lead_submissions') is not null,
  'public-site lead idempotency table exists');
select ok(to_regclass('public.user_activity_sessions') is not null,
  'durable user activity table exists');
select ok(to_regclass('public.idx_schedule_events_reminder_due') is not null,
  'schedule reminder worker has a covering partial index');
select ok(to_regclass('public.idx_site_analytics_events_lead_fk') is not null,
  'site analytics lead foreign key is indexed');
select ok(to_regclass('public.idx_site_analytics_events_property_fk') is not null,
  'site analytics property foreign key is indexed');
select ok(to_regclass('public.idx_site_lead_submissions_lead_fk') is not null,
  'site lead submission foreign key is indexed');
select ok(
  pg_get_indexdef('public.idx_schedule_events_reminder_due'::regclass) not ilike '%make_interval%',
  'schedule reminder index uses only immutable index expressions'
);

select ok(to_regprocedure('private.current_audit_actor_id()') is not null,
  'audit actor helper exists');
select ok(to_regprocedure('private.audit_jsonb_diff(jsonb,jsonb,text[])') is not null,
  'audit diff helper exists');
select ok(to_regprocedure('private.write_audit_log_for_row()') is not null,
  'audit row trigger helper exists');
select ok(to_regprocedure('private.broadcast_audit_log_change()') is not null,
  'audit broadcast trigger helper exists');
select ok(
  position('can_receive_audit_broadcast' in (
    select prosrc from pg_proc
    where oid = 'private.can_receive_whatsapp_broadcast(text)'::regprocedure
  )) > 0,
  'managed private broadcast policy also authorizes audit topics'
);

select ok(
  has_table_privilege('authenticated', 'public.user_activity_sessions', 'select'),
  'authenticated users can read authorized activity sessions'
);
select ok(
  not has_table_privilege('authenticated', 'public.site_lead_submissions', 'select'),
  'browser cannot read public-site lead idempotency records'
);
select ok(
  has_table_privilege('service_role', 'public.site_lead_submissions', 'select'),
  'service backend can use public-site lead idempotency records'
);
select is(
  pg_get_function_result('public.is_user_available_for_distribution(uuid,uuid,integer,time without time zone)'::regprocedure),
  'TABLE(is_available boolean, reason text, team_member_id uuid)',
  'availability helper preserves its three-column contract'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.is_user_available_for_distribution(uuid,uuid,integer,time without time zone)',
    'execute'
  ),
  'availability helper remains backend-only'
);

select * from finish();
rollback;
