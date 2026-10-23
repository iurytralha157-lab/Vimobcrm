begin;
create extension if not exists pgtap with schema extensions;
select plan(46);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
select '00000000-0000-0000-0000-000000000000'::uuid, fixture.id::uuid,
  'authenticated', 'authenticated', fixture.email, '', now(),
  '{}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', ''
from (values
  ('eb100000-0000-4000-8000-000000000001', 'generation-legacy-leader@example.test'),
  ('eb100000-0000-4000-8000-000000000002', 'generation-legacy-assignee@example.test'),
  ('eb100000-0000-4000-8000-000000000003', 'generation-other-leader@example.test')
) as fixture(id, email);

insert into public.organizations (id, name, slug, is_active)
values
  ('eb200000-0000-4000-8000-000000000001',
   'Generation Legacy Helpers', 'generation-legacy-helpers', true),
  ('eb200000-0000-4000-8000-000000000002',
   'Generation Identity Target', 'generation-identity-target', true);
update public.users
set organization_id = 'eb200000-0000-4000-8000-000000000001',
    name = case id
      when 'eb100000-0000-4000-8000-000000000001' then 'Leader'
      else 'Assignee'
    end,
    role = 'user',
    is_active = true
where id in (
  'eb100000-0000-4000-8000-000000000001',
  'eb100000-0000-4000-8000-000000000002'
);
update public.users
set organization_id = 'eb200000-0000-4000-8000-000000000002',
    name = 'Other organization leader',
    role = 'user',
    is_active = true
where id = 'eb100000-0000-4000-8000-000000000003';
insert into public.organization_members (organization_id, user_id, role, is_active)
values
  ('eb200000-0000-4000-8000-000000000001', 'eb100000-0000-4000-8000-000000000001', 'user', true),
  ('eb200000-0000-4000-8000-000000000001', 'eb100000-0000-4000-8000-000000000002', 'user', true),
  ('eb200000-0000-4000-8000-000000000002', 'eb100000-0000-4000-8000-000000000003', 'user', true)
on conflict (user_id, organization_id) do update
set role = excluded.role,
    is_active = true,
    deleted_at = null;
select throws_ok(
  $$update public.organization_members
      set organization_id = 'eb200000-0000-4000-8000-000000000002'
    where organization_id = 'eb200000-0000-4000-8000-000000000001'
      and user_id = 'eb100000-0000-4000-8000-000000000001'$$,
  '23514', 'organization_members_identity_immutable',
  'membership cannot move to another organization while retaining an old generation'
);
select throws_ok(
  $$update public.organization_members
      set user_id = 'eb100000-0000-4000-8000-000000000002'
    where organization_id = 'eb200000-0000-4000-8000-000000000001'
      and user_id = 'eb100000-0000-4000-8000-000000000001'$$,
  '23514', 'organization_members_identity_immutable',
  'membership cannot move to another user while retaining an old generation'
);
select is((select membership_generation from public.organization_members
           where organization_id = 'eb200000-0000-4000-8000-000000000001'
             and user_id = 'eb100000-0000-4000-8000-000000000001'),
          1::bigint, 'rejected membership identity changes preserve the generation');
insert into public.teams (id, organization_id, name, is_active)
values
  ('eb300000-0000-4000-8000-000000000001',
   'eb200000-0000-4000-8000-000000000001', 'Legacy team', true),
  ('eb300000-0000-4000-8000-000000000002',
   'eb200000-0000-4000-8000-000000000002', 'Other organization team', true);
insert into public.team_members (team_id, organization_id, user_id, is_leader, is_active)
values
  ('eb300000-0000-4000-8000-000000000001', 'eb200000-0000-4000-8000-000000000001',
   'eb100000-0000-4000-8000-000000000001', true, true),
  ('eb300000-0000-4000-8000-000000000001', 'eb200000-0000-4000-8000-000000000001',
   'eb100000-0000-4000-8000-000000000002', false, true),
  ('eb300000-0000-4000-8000-000000000002', 'eb200000-0000-4000-8000-000000000002',
   'eb100000-0000-4000-8000-000000000003', true, true);
insert into public.pipelines (id, organization_id, name, is_active)
values ('eb400000-0000-4000-8000-000000000001',
        'eb200000-0000-4000-8000-000000000001', 'Legacy pipeline', true);
insert into public.team_pipelines (organization_id, team_id, pipeline_id)
values ('eb200000-0000-4000-8000-000000000001',
        'eb300000-0000-4000-8000-000000000001',
        'eb400000-0000-4000-8000-000000000001');
insert into public.leads (id, organization_id, assigned_user_id, team_id, name, source)
values
  ('eb500000-0000-4000-8000-000000000001',
   'eb200000-0000-4000-8000-000000000001',
   'eb100000-0000-4000-8000-000000000002',
   'eb300000-0000-4000-8000-000000000001', 'Legacy scoped lead', 'manual'),
  ('eb500000-0000-4000-8000-000000000002',
   'eb200000-0000-4000-8000-000000000001',
   'eb100000-0000-4000-8000-000000000002',
   'eb300000-0000-4000-8000-000000000001', 'Stale leader queue lead', 'manual'),
  ('eb500000-0000-4000-8000-000000000003',
   'eb200000-0000-4000-8000-000000000001',
   'eb100000-0000-4000-8000-000000000002',
   'eb300000-0000-4000-8000-000000000001', 'Stale queue lead', 'manual'),
  ('eb500000-0000-4000-8000-000000000004',
   'eb200000-0000-4000-8000-000000000001',
   'eb100000-0000-4000-8000-000000000002',
   'eb300000-0000-4000-8000-000000000001', 'Reenrolled queue lead', 'manual');
insert into public.round_robins (id, organization_id, name, settings, is_active)
values ('eb510000-0000-4000-8000-000000000001',
        'eb200000-0000-4000-8000-000000000001',
        'Generation queue', '{"enable_redistribution":true}'::jsonb, true);
insert into public.round_robin_members (
  id, organization_id, round_robin_id, user_id, team_id, is_active
)
values
  ('eb520000-0000-4000-8000-000000000001',
   'eb200000-0000-4000-8000-000000000001',
   'eb510000-0000-4000-8000-000000000001',
   'eb100000-0000-4000-8000-000000000001',
   'eb300000-0000-4000-8000-000000000001', true),
  ('eb520000-0000-4000-8000-000000000002',
   'eb200000-0000-4000-8000-000000000001',
   'eb510000-0000-4000-8000-000000000001',
   'eb100000-0000-4000-8000-000000000002',
   'eb300000-0000-4000-8000-000000000001', true);
insert into public.round_robin_logs (
  id, round_robin_id, organization_id, lead_id, assigned_user_id, reason
)
values ('eb530000-0000-4000-8000-000000000001',
        'eb510000-0000-4000-8000-000000000001',
        'eb200000-0000-4000-8000-000000000001',
        'eb500000-0000-4000-8000-000000000001',
        'eb100000-0000-4000-8000-000000000002', 'canonical_round_robin');
select is((select count(*)::integer from public.lead_redistribution_jobs
           where lead_id = 'eb500000-0000-4000-8000-000000000001'), 1,
  'redistribution enrolls when two current queue candidates exist');

insert into public.available_permissions (id, key, name, category)
values ('eb610000-0000-4000-8000-000000000001',
        'lead_view_team', 'View team leads', 'leads')
on conflict (key) do nothing;
insert into public.organization_roles (id, organization_id, name, is_active)
values ('eb600000-0000-4000-8000-000000000001',
        'eb200000-0000-4000-8000-000000000001', 'Team view', true);
insert into public.organization_role_permissions (
  id, organization_role_id, permission_key, organization_id, role_id, permission_id
)
select 'eb700000-0000-4000-8000-000000000001',
       'eb600000-0000-4000-8000-000000000001', 'lead_view_team',
       'eb200000-0000-4000-8000-000000000001',
       'eb600000-0000-4000-8000-000000000001', permission.id
from public.available_permissions as permission
where permission.key = 'lead_view_team';
insert into public.organization_role_permissions (
  id, organization_role_id, permission_key, organization_id, role_id, permission_id
)
select 'eb700000-0000-4000-8000-000000000002',
       'eb600000-0000-4000-8000-000000000001', 'property_view',
       'eb200000-0000-4000-8000-000000000001',
       'eb600000-0000-4000-8000-000000000001', permission.id
from public.available_permissions as permission
where permission.key = 'property_view';
insert into public.user_organization_roles (
  id, user_id, organization_role_id, organization_id, role_id, is_active
)
values ('eb800000-0000-4000-8000-000000000001',
        'eb100000-0000-4000-8000-000000000001',
        'eb600000-0000-4000-8000-000000000001',
        'eb200000-0000-4000-8000-000000000001',
        'eb600000-0000-4000-8000-000000000001', true);

select is(private.automation_assign_lead_user(
  'eb200000-0000-4000-8000-000000000001',
  'eb500000-0000-4000-8000-000000000001',
  'eb100000-0000-4000-8000-000000000002',
  'eb100000-0000-4000-8000-000000000001',
  'eb900000-0000-4000-8000-000000000001', 'assign'
)->>'assignment_changed', 'false',
  'automation accepts current assignee without mutating lead');

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'eb100000-0000-4000-8000-000000000001', true);
select is((select count(*)::integer from public.leads
           where id = 'eb500000-0000-4000-8000-000000000001'), 1,
          'current leader reads the team lead through RLS');
select ok(private.can_read_lead('eb200000-0000-4000-8000-000000000001',
  'eb100000-0000-4000-8000-000000000002', 'eb300000-0000-4000-8000-000000000001'),
  'current leader passes canonical lead read helper');
select ok(private.can_access_lead('eb200000-0000-4000-8000-000000000001',
  'eb100000-0000-4000-8000-000000000002'),
  'current leader passes legacy Realtime lead helper');
select ok(public.can_access_lead('eb500000-0000-4000-8000-000000000001',
  'eb100000-0000-4000-8000-000000000001'),
  'current leader passes legacy lead-id wrapper');
select ok(public.is_team_leader('eb100000-0000-4000-8000-000000000001'),
  'current leader retains team leadership');
select ok(not public.is_team_leader('eb100000-0000-4000-8000-000000000003'),
  'leader status cannot be queried across organizations');
select is((select count(*)::integer from public.get_user_led_team_ids()), 1,
  'current leader receives their team id');
select is((select count(*)::integer from public.get_user_team_ids()), 1,
  'current member receives their team id');
select is((select count(*)::integer from public.get_user_led_pipeline_ids()), 1,
  'current leader receives their pipeline id');
select ok(public.is_user_in_led_team('eb100000-0000-4000-8000-000000000002',
  'eb100000-0000-4000-8000-000000000001'),
  'current leader sees current team member');
select ok(public.is_user_leader_of_team('eb300000-0000-4000-8000-000000000001',
  'eb100000-0000-4000-8000-000000000001'),
  'current leader passes scoped team check');
select ok(public.is_pipeline_in_led_team('eb400000-0000-4000-8000-000000000001',
  'eb100000-0000-4000-8000-000000000001'),
  'current leader passes scoped pipeline check');
select ok(private.can_view_property_record('eb200000-0000-4000-8000-000000000001',
  null, 'eb100000-0000-4000-8000-000000000002'),
  'current leader sees current broker property');

select set_config('request.jwt.claim.sub', 'eb100000-0000-4000-8000-000000000002', true);
select ok(not public.can_access_lead('eb500000-0000-4000-8000-000000000001',
  'eb100000-0000-4000-8000-000000000001'),
  'public wrapper cannot evaluate another user identity');

reset role;
update public.organization_members set is_active = false, deleted_at = now()
where organization_id = 'eb200000-0000-4000-8000-000000000001'
  and user_id = 'eb100000-0000-4000-8000-000000000001';
update public.organization_members set is_active = true, deleted_at = null
where organization_id = 'eb200000-0000-4000-8000-000000000001'
  and user_id = 'eb100000-0000-4000-8000-000000000001';
-- Removal deletes role assignments. Regrant while the old team row is still
-- stale so the denied reads below prove the generation fence itself.
insert into public.user_organization_roles (
  id, user_id, organization_role_id, organization_id, role_id, is_active
)
values ('eb800000-0000-4000-8000-000000000002',
        'eb100000-0000-4000-8000-000000000001',
        'eb600000-0000-4000-8000-000000000001',
        'eb200000-0000-4000-8000-000000000001',
        'eb600000-0000-4000-8000-000000000001', true);
select ok((select om.membership_generation > tm.membership_generation
           from public.organization_members om
           join public.team_members tm on tm.organization_id = om.organization_id
             and tm.user_id = om.user_id
           where om.organization_id = 'eb200000-0000-4000-8000-000000000001'
             and om.user_id = 'eb100000-0000-4000-8000-000000000001'),
  'reinvite leaves prior leader team row stale');
insert into public.round_robin_logs (
  id, round_robin_id, organization_id, lead_id, assigned_user_id, reason
)
values ('eb530000-0000-4000-8000-000000000002',
        'eb510000-0000-4000-8000-000000000001',
        'eb200000-0000-4000-8000-000000000001',
        'eb500000-0000-4000-8000-000000000002',
        'eb100000-0000-4000-8000-000000000002', 'canonical_round_robin');
select is((select count(*)::integer from public.lead_redistribution_jobs
           where lead_id = 'eb500000-0000-4000-8000-000000000002'), 0,
  'redistribution skips stale second queue candidate');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'eb100000-0000-4000-8000-000000000001', true);
select is((select count(*)::integer from public.leads
           where id = 'eb500000-0000-4000-8000-000000000001'), 0,
          'stale leader cannot read lead through RLS');
select ok(not private.can_access_lead('eb200000-0000-4000-8000-000000000001',
  'eb100000-0000-4000-8000-000000000002'),
  'stale leader cannot access lead through Realtime helper');
select ok(not public.can_access_lead('eb500000-0000-4000-8000-000000000001',
  'eb100000-0000-4000-8000-000000000001'),
  'stale leader cannot access lead-id wrapper');
select ok(not public.is_team_leader('eb100000-0000-4000-8000-000000000001'),
  'stale leader loses team leadership');
select is((select count(*)::integer from public.get_user_led_team_ids()), 0,
  'stale leader receives no led team ids');
select is((select count(*)::integer from public.get_user_led_pipeline_ids()), 0,
  'stale leader receives no led pipeline ids');
select ok(not public.is_user_in_led_team('eb100000-0000-4000-8000-000000000002',
  'eb100000-0000-4000-8000-000000000001'),
  'stale leader cannot claim current team member');
select ok(not public.is_user_leader_of_team('eb300000-0000-4000-8000-000000000001',
  'eb100000-0000-4000-8000-000000000001'),
  'stale leader fails scoped team check');
select ok(not public.is_pipeline_in_led_team('eb400000-0000-4000-8000-000000000001',
  'eb100000-0000-4000-8000-000000000001'),
  'stale leader fails scoped pipeline check');
select ok(not private.can_view_property_record('eb200000-0000-4000-8000-000000000001',
  null, 'eb100000-0000-4000-8000-000000000002'),
  'stale leader cannot inherit broker property');

reset role;
update public.team_members set is_active = true
where organization_id = 'eb200000-0000-4000-8000-000000000001'
  and user_id = 'eb100000-0000-4000-8000-000000000001';
insert into public.round_robin_logs (
  id, round_robin_id, organization_id, lead_id, assigned_user_id, reason
)
values ('eb530000-0000-4000-8000-000000000003',
        'eb510000-0000-4000-8000-000000000001',
        'eb200000-0000-4000-8000-000000000001',
        'eb500000-0000-4000-8000-000000000003',
        'eb100000-0000-4000-8000-000000000002', 'canonical_round_robin');
select is((select count(*)::integer from public.lead_redistribution_jobs
           where lead_id = 'eb500000-0000-4000-8000-000000000003'), 0,
  'restored team row alone does not revive stale queue candidate');
update public.round_robin_members set is_active = true
where organization_id = 'eb200000-0000-4000-8000-000000000001'
  and user_id = 'eb100000-0000-4000-8000-000000000001';
insert into public.round_robin_logs (
  id, round_robin_id, organization_id, lead_id, assigned_user_id, reason
)
values ('eb530000-0000-4000-8000-000000000004',
        'eb510000-0000-4000-8000-000000000001',
        'eb200000-0000-4000-8000-000000000001',
        'eb500000-0000-4000-8000-000000000004',
        'eb100000-0000-4000-8000-000000000002', 'canonical_round_robin');
select is((select count(*)::integer from public.lead_redistribution_jobs
           where lead_id = 'eb500000-0000-4000-8000-000000000004'), 1,
  'explicit queue reenrollment restores redistribution alternatives');
set local role authenticated;
select is((select count(*)::integer from public.leads
           where id = 'eb500000-0000-4000-8000-000000000001'), 1,
          'explicit leader reenrollment restores lead visibility');
select ok(private.can_access_lead('eb200000-0000-4000-8000-000000000001',
  'eb100000-0000-4000-8000-000000000002'),
  'explicit leader reenrollment restores Realtime scope');
select ok(private.can_view_property_record('eb200000-0000-4000-8000-000000000001',
  null, 'eb100000-0000-4000-8000-000000000002'),
  'explicit leader reenrollment restores broker property scope');

reset role;
update public.organization_members set is_active = false, deleted_at = now()
where organization_id = 'eb200000-0000-4000-8000-000000000001'
  and user_id = 'eb100000-0000-4000-8000-000000000002';
update public.organization_members set is_active = true, deleted_at = null
where organization_id = 'eb200000-0000-4000-8000-000000000001'
  and user_id = 'eb100000-0000-4000-8000-000000000002';
select throws_ok(
  $$select private.automation_assign_lead_user(
    'eb200000-0000-4000-8000-000000000001',
    'eb500000-0000-4000-8000-000000000001',
    'eb100000-0000-4000-8000-000000000002',
    'eb100000-0000-4000-8000-000000000001',
    'eb900000-0000-4000-8000-000000000001', 'assign'
  )$$,
  'P0001', 'automation_assignee_not_in_lead_team',
  'automation rejects broker with stale team membership'
);
set local role authenticated;
select ok(not private.can_read_lead('eb200000-0000-4000-8000-000000000001',
  'eb100000-0000-4000-8000-000000000002', null),
  'leader cannot inherit unassigned-team lead through stale assignee team row');
select ok(not private.can_access_lead('eb200000-0000-4000-8000-000000000001',
  'eb100000-0000-4000-8000-000000000002'),
  'legacy Realtime helper rejects stale assignee team row');
select ok(not public.can_access_lead('eb500000-0000-4000-8000-000000000001',
  'eb100000-0000-4000-8000-000000000001'),
  'legacy lead-id wrapper rejects stale assignee team row');
select ok(not public.is_user_in_led_team('eb100000-0000-4000-8000-000000000002',
  'eb100000-0000-4000-8000-000000000001'),
  'leader no longer claims stale assignee team row');
select ok(not private.can_view_property_record('eb200000-0000-4000-8000-000000000001',
  null, 'eb100000-0000-4000-8000-000000000002'),
  'leader cannot inherit stale broker property');

reset role;
update public.team_members set is_active = true
where organization_id = 'eb200000-0000-4000-8000-000000000001'
  and user_id = 'eb100000-0000-4000-8000-000000000002';
select is(private.automation_assign_lead_user(
  'eb200000-0000-4000-8000-000000000001',
  'eb500000-0000-4000-8000-000000000001',
  'eb100000-0000-4000-8000-000000000002',
  'eb100000-0000-4000-8000-000000000001',
  'eb900000-0000-4000-8000-000000000001', 'assign'
)->>'assignment_changed', 'false',
  'automation accepts broker after explicit team reenrollment');
set local role authenticated;
select ok(private.can_access_lead('eb200000-0000-4000-8000-000000000001',
  'eb100000-0000-4000-8000-000000000002'),
  'explicit assignee reenrollment restores legacy Realtime scope');
select ok(public.can_access_lead('eb500000-0000-4000-8000-000000000001',
  'eb100000-0000-4000-8000-000000000001'),
  'explicit assignee reenrollment restores legacy lead-id wrapper');
select ok(private.can_view_property_record('eb200000-0000-4000-8000-000000000001',
  null, 'eb100000-0000-4000-8000-000000000002'),
  'explicit broker reenrollment restores property scope');

reset role;
select * from finish();
rollback;
