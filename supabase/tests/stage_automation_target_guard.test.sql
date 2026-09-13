begin;

create extension if not exists pgtap with schema extensions;
select plan(9);

select function_returns(
  'public',
  'execute_stage_automations',
  array[]::text[],
  'trigger',
  'stage automation trigger remains installed with its canonical signature'
);

select function_privs_are(
  'public',
  'execute_stage_automations',
  array[]::text[],
  'anon',
  array[]::text[],
  'anonymous clients cannot invoke the trigger function directly'
);

select function_privs_are(
  'public',
  'execute_stage_automations',
  array[]::text[],
  'authenticated',
  array[]::text[],
  'authenticated clients cannot invoke the trigger function directly'
);

select ok(
  position(
    'target_user_text ~*' in pg_get_functiondef('public.execute_stage_automations()'::regprocedure)
  ) > 0,
  'target user text is checked before the uuid cast'
);

select ok(
  position('member.organization_id = new.organization_id' in pg_get_functiondef('public.execute_stage_automations()'::regprocedure)) > 0
  and position('coalesce(member.is_active, false) = true' in pg_get_functiondef('public.execute_stage_automations()'::regprocedure)) > 0
  and position('coalesce(app_user.is_active, false) = true' in pg_get_functiondef('public.execute_stage_automations()'::regprocedure)) > 0,
  'assignee automation requires an active user in the lead organization'
);

select ok(
  position('new.won_at := coalesce(old.won_at, new.won_at, now())' in pg_get_functiondef('public.execute_stage_automations()'::regprocedure)) > 0,
  'moving between won stages preserves the original won timestamp'
);

select ok(
  position('new.lost_at := coalesce(old.lost_at, new.lost_at, now())' in pg_get_functiondef('public.execute_stage_automations()'::regprocedure)) > 0,
  'moving between lost stages preserves the original lost timestamp'
);

insert into public.organizations (id, name, slug, is_active)
values (
  'a2000000-0000-4000-8000-000000000090',
  'Stage Automation Target Guard',
  'stage-automation-target-guard',
  true
);

insert into public.pipelines (id, organization_id, name, position, is_active)
values (
  'a3000000-0000-4000-8000-000000000090',
  'a2000000-0000-4000-8000-000000000090',
  'Stage Automation Guard Pipeline',
  1,
  true
);

insert into public.stages (id, organization_id, pipeline_id, name, stage_key, position, is_won, is_lost, is_active)
values
  ('a4000000-0000-4000-8000-000000000091', 'a2000000-0000-4000-8000-000000000090', 'a3000000-0000-4000-8000-000000000090', 'Won One', 'automation_guard_won_one', 1, true, false, true),
  ('a4000000-0000-4000-8000-000000000092', 'a2000000-0000-4000-8000-000000000090', 'a3000000-0000-4000-8000-000000000090', 'Won Two', 'automation_guard_won_two', 2, true, false, true),
  ('a4000000-0000-4000-8000-000000000093', 'a2000000-0000-4000-8000-000000000090', 'a3000000-0000-4000-8000-000000000090', 'Lost One', 'automation_guard_lost_one', 3, false, true, true),
  ('a4000000-0000-4000-8000-000000000094', 'a2000000-0000-4000-8000-000000000090', 'a3000000-0000-4000-8000-000000000090', 'Lost Two', 'automation_guard_lost_two', 4, false, true, true);

insert into public.stage_automations (
  id, organization_id, stage_id, trigger_type, action_type, automation_type, action_config, is_active
)
values
  ('a5000000-0000-4000-8000-000000000092', 'a2000000-0000-4000-8000-000000000090', 'a4000000-0000-4000-8000-000000000092', 'on_enter', 'change_deal_status', 'change_deal_status_on_enter', '{"deal_status":"won"}'::jsonb, true),
  ('a5000000-0000-4000-8000-000000000094', 'a2000000-0000-4000-8000-000000000090', 'a4000000-0000-4000-8000-000000000094', 'on_enter', 'change_deal_status', 'change_deal_status_on_enter', '{"deal_status":"lost"}'::jsonb, true);

insert into public.leads (
  id, organization_id, pipeline_id, stage_id, name, source, deal_status, won_at, lost_at, lost_reason
)
values
  ('a6000000-0000-4000-8000-000000000091', 'a2000000-0000-4000-8000-000000000090', 'a3000000-0000-4000-8000-000000000090', 'a4000000-0000-4000-8000-000000000091', 'Won Timestamp Lead', 'test', 'won', '2026-09-01 10:00:00+00', null, null),
  ('a6000000-0000-4000-8000-000000000093', 'a2000000-0000-4000-8000-000000000090', 'a3000000-0000-4000-8000-000000000090', 'a4000000-0000-4000-8000-000000000093', 'Lost Timestamp Lead', 'test', 'lost', null, '2026-09-02 11:00:00+00', 'Teste');

update public.leads
set stage_id = 'a4000000-0000-4000-8000-000000000092'
where id = 'a6000000-0000-4000-8000-000000000091';

update public.leads
set stage_id = 'a4000000-0000-4000-8000-000000000094'
where id = 'a6000000-0000-4000-8000-000000000093';

select is(
  (select won_at from public.leads where id = 'a6000000-0000-4000-8000-000000000091'),
  '2026-09-01 10:00:00+00'::timestamptz,
  'won-to-won stage movement keeps the original won_at'
);

select is(
  (select lost_at from public.leads where id = 'a6000000-0000-4000-8000-000000000093'),
  '2026-09-02 11:00:00+00'::timestamptz,
  'lost-to-lost stage movement keeps the original lost_at'
);

select * from finish();
rollback;
