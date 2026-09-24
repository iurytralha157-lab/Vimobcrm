begin;

create extension if not exists pgtap with schema extensions;
select plan(24);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
select
  '00000000-0000-0000-0000-000000000000'::uuid,
  fixture.id::uuid,
  'authenticated',
  'authenticated',
  'lead-team-read-' || fixture.number::text || '@example.test',
  crypt('test-password', gen_salt('bf', 4)),
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb,
  now(), now(), '', '', '', ''
from (values
  ('f1020000-0000-4000-8000-000000000001', 1), -- broker
  ('f1020000-0000-4000-8000-000000000002', 2), -- leader A
  ('f1020000-0000-4000-8000-000000000003', 3), -- leader B
  ('f1020000-0000-4000-8000-000000000004', 4), -- leader C
  ('f1020000-0000-4000-8000-000000000005', 5), -- leader D
  ('f1020000-0000-4000-8000-000000000006', 6), -- unrelated leader E
  ('f1020000-0000-4000-8000-000000000007', 7)  -- admin
) as fixture(id, number);

insert into public.organizations (id, name, slug, is_active)
values
  ('f1010000-0000-4000-8000-000000000001', 'Lead Team Read Test', 'lead-team-read-test', true),
  ('f1010000-0000-4000-8000-000000000002', 'Broker Primary Organization', 'broker-primary-organization-test', true);

insert into public.users (id, organization_id, name, email, role, is_active)
select
  fixture.id::uuid,
  case when fixture.number = 1
    then 'f1010000-0000-4000-8000-000000000002'::uuid
    else 'f1010000-0000-4000-8000-000000000001'::uuid
  end,
  'Lead Team Read User ' || fixture.number::text,
  'lead-team-read-' || fixture.number::text || '@example.test',
  case when fixture.number = 7 then 'admin' else 'user' end,
  true
from (values
  ('f1020000-0000-4000-8000-000000000001', 1),
  ('f1020000-0000-4000-8000-000000000002', 2),
  ('f1020000-0000-4000-8000-000000000003', 3),
  ('f1020000-0000-4000-8000-000000000004', 4),
  ('f1020000-0000-4000-8000-000000000005', 5),
  ('f1020000-0000-4000-8000-000000000006', 6),
  ('f1020000-0000-4000-8000-000000000007', 7)
) as fixture(id, number);

insert into public.organization_members (organization_id, user_id, role, is_active)
select
  'f1010000-0000-4000-8000-000000000001'::uuid,
  fixture.id::uuid,
  case when fixture.number = 7 then 'admin' else 'user' end,
  true
from (values
  ('f1020000-0000-4000-8000-000000000001', 1),
  ('f1020000-0000-4000-8000-000000000002', 2),
  ('f1020000-0000-4000-8000-000000000003', 3),
  ('f1020000-0000-4000-8000-000000000004', 4),
  ('f1020000-0000-4000-8000-000000000005', 5),
  ('f1020000-0000-4000-8000-000000000006', 6),
  ('f1020000-0000-4000-8000-000000000007', 7)
) as fixture(id, number);

insert into public.teams (id, organization_id, name, created_by, is_active)
select
  fixture.id::uuid,
  'f1010000-0000-4000-8000-000000000001'::uuid,
  'Lead Team Read ' || fixture.name,
  'f1020000-0000-4000-8000-000000000007'::uuid,
  true
from (values
  ('f1030000-0000-4000-8000-000000000001', 'A'),
  ('f1030000-0000-4000-8000-000000000002', 'B'),
  ('f1030000-0000-4000-8000-000000000003', 'C'),
  ('f1030000-0000-4000-8000-000000000004', 'D'),
  ('f1030000-0000-4000-8000-000000000005', 'E')
) as fixture(id, name);

insert into public.team_members (team_id, user_id, organization_id, is_leader, is_active)
select
  fixture.team_id::uuid,
  'f1020000-0000-4000-8000-000000000001'::uuid,
  'f1010000-0000-4000-8000-000000000001'::uuid,
  false,
  true
from (values
  ('f1030000-0000-4000-8000-000000000001'),
  ('f1030000-0000-4000-8000-000000000002'),
  ('f1030000-0000-4000-8000-000000000003'),
  ('f1030000-0000-4000-8000-000000000004')
) as fixture(team_id);

insert into public.team_members (team_id, user_id, organization_id, is_leader, is_active)
select
  fixture.team_id::uuid,
  fixture.leader_id::uuid,
  'f1010000-0000-4000-8000-000000000001'::uuid,
  true,
  true
from (values
  ('f1030000-0000-4000-8000-000000000001', 'f1020000-0000-4000-8000-000000000002'),
  ('f1030000-0000-4000-8000-000000000002', 'f1020000-0000-4000-8000-000000000003'),
  ('f1030000-0000-4000-8000-000000000003', 'f1020000-0000-4000-8000-000000000004'),
  ('f1030000-0000-4000-8000-000000000004', 'f1020000-0000-4000-8000-000000000005'),
  ('f1030000-0000-4000-8000-000000000005', 'f1020000-0000-4000-8000-000000000006')
) as fixture(team_id, leader_id);

insert into public.leads (id, organization_id, assigned_user_id, team_id, name, source)
values
  ('f1040000-0000-4000-8000-000000000001', 'f1010000-0000-4000-8000-000000000001', 'f1020000-0000-4000-8000-000000000001', 'f1030000-0000-4000-8000-000000000001', 'Broker lead from A', 'manual'),
  ('f1040000-0000-4000-8000-000000000002', 'f1010000-0000-4000-8000-000000000001', 'f1020000-0000-4000-8000-000000000001', 'f1030000-0000-4000-8000-000000000002', 'Broker lead from B', 'manual'),
  ('f1040000-0000-4000-8000-000000000003', 'f1010000-0000-4000-8000-000000000001', 'f1020000-0000-4000-8000-000000000001', 'f1030000-0000-4000-8000-000000000003', 'Broker lead from C', 'manual'),
  ('f1040000-0000-4000-8000-000000000004', 'f1010000-0000-4000-8000-000000000001', 'f1020000-0000-4000-8000-000000000001', 'f1030000-0000-4000-8000-000000000004', 'Broker lead from D', 'manual'),
  ('f1040000-0000-4000-8000-000000000005', 'f1010000-0000-4000-8000-000000000001', null, 'f1030000-0000-4000-8000-000000000001', 'Unassigned lead in A', 'manual'),
  ('f1040000-0000-4000-8000-000000000006', 'f1010000-0000-4000-8000-000000000001', null, 'f1030000-0000-4000-8000-000000000005', 'Unassigned lead in E', 'manual');

insert into public.lead_attachments (lead_id, file_name, file_url)
values
  ('f1040000-0000-4000-8000-000000000001', 'broker-a.txt', 'test://broker-a'),
  ('f1040000-0000-4000-8000-000000000005', 'unassigned-a.txt', 'test://unassigned-a');

select ok(
  exists (
    select 1
    from public.users as broker
    join public.organization_members as target_membership
      on target_membership.user_id = broker.id
     and target_membership.organization_id = 'f1010000-0000-4000-8000-000000000001'
     and target_membership.is_active = true
     and target_membership.deleted_at is null
    where broker.id = 'f1020000-0000-4000-8000-000000000001'
      and broker.organization_id = 'f1010000-0000-4000-8000-000000000002'
      and broker.is_active = true
  ),
  'broker has a different primary organization and active membership in the lead organization'
);

select ok(
  not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'leads'
      and policyname = 'vimob_canonical_7f56115fb393f8ab9f4c78a7'
  ),
  'the pipeline and assignee permissive policy was removed'
);
select ok(
  exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'leads'
      and policyname = 'leads_select_active_broker_team'
      and cmd = 'SELECT' and permissive = 'PERMISSIVE'
  ),
  'the replacement read policy is installed'
);
select ok(
  exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'leads'
      and policyname = 'vimob_active_membership_guard'
      and cmd = 'SELECT' and permissive = 'RESTRICTIVE'
  ),
  'the existing restrictive membership guard remains installed'
);
select ok(
  has_table_privilege('authenticated', 'public.leads', 'SELECT')
    and not has_table_privilege('authenticated', 'public.leads', 'INSERT')
    and not has_table_privilege('authenticated', 'public.leads', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.leads', 'DELETE'),
  'client lead grants remain read-only'
);
select is(
  (
    select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'leads'
      and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
  ),
  0::bigint,
  'the migration does not reintroduce lead mutation policies'
);
select ok(
  has_function_privilege('authenticated', 'private.can_read_lead(uuid,uuid,uuid)', 'EXECUTE')
    and has_function_privilege('authenticated', 'private.can_read_lead_by_id(uuid)', 'EXECUTE')
    and not has_function_privilege('anon', 'private.can_read_lead(uuid,uuid,uuid)', 'EXECUTE')
    and not has_function_privilege('anon', 'private.can_read_lead_by_id(uuid)', 'EXECUTE'),
  'new read helpers are callable only by authenticated users and backend roles'
);

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'f1020000-0000-4000-8000-000000000002', true);

select is(
  (select count(*) from public.leads where id between 'f1040000-0000-4000-8000-000000000001' and 'f1040000-0000-4000-8000-000000000004'),
  4::bigint,
  'leader A reads all four leads owned by its broker across four teams'
);
select is(
  (select count(*) from public.leads where id = 'f1040000-0000-4000-8000-000000000005'),
  1::bigint,
  'leader A still reads an unassigned lead tagged to team A'
);
select is(
  (select count(*) from public.leads where id = 'f1040000-0000-4000-8000-000000000006'),
  0::bigint,
  'leader A cannot read team E unassigned lead'
);
select is(
  (select count(*) from public.lead_attachments where file_name in ('broker-a.txt', 'unassigned-a.txt')),
  2::bigint,
  'attachment SELECT follows the lead read scope, including unassigned team leads'
);

select set_config('request.jwt.claim.sub', 'f1020000-0000-4000-8000-000000000003', true);
select is(
  (select count(*) from public.leads where id between 'f1040000-0000-4000-8000-000000000001' and 'f1040000-0000-4000-8000-000000000004'),
  4::bigint,
  'leader B also reads all four broker leads despite different lead team IDs'
);
select is(
  (select count(*) from public.lead_attachments where file_name = 'broker-a.txt'),
  1::bigint,
  'leader B reads an attachment on a lead distributed through team A'
);
select is(
  (select count(*) from public.leads where id = 'f1040000-0000-4000-8000-000000000005'),
  0::bigint,
  'leader B cannot read the unassigned team A lead'
);

select set_config('request.jwt.claim.sub', 'f1020000-0000-4000-8000-000000000004', true);
select is(
  (select count(*) from public.leads where id between 'f1040000-0000-4000-8000-000000000001' and 'f1040000-0000-4000-8000-000000000004'),
  4::bigint,
  'leader C also reads all four broker leads'
);

select set_config('request.jwt.claim.sub', 'f1020000-0000-4000-8000-000000000005', true);
select is(
  (select count(*) from public.leads where id between 'f1040000-0000-4000-8000-000000000001' and 'f1040000-0000-4000-8000-000000000004'),
  4::bigint,
  'leader D also reads all four broker leads'
);

reset role;
insert into public.user_permission_overrides (
  organization_id, user_id, permission_key, allowed
)
values (
  'f1010000-0000-4000-8000-000000000001',
  'f1020000-0000-4000-8000-000000000004',
  'lead_view_team',
  false
);
set local role authenticated;
select set_config('request.jwt.claim.sub', 'f1020000-0000-4000-8000-000000000004', true);
select is(
  (select count(*) from public.leads where id between 'f1040000-0000-4000-8000-000000000001' and 'f1040000-0000-4000-8000-000000000004'),
  0::bigint,
  'explicit lead_view_team denial removes the leader read scope'
);

select set_config('request.jwt.claim.sub', 'f1020000-0000-4000-8000-000000000006', true);
select is(
  (select count(*) from public.leads where id between 'f1040000-0000-4000-8000-000000000001' and 'f1040000-0000-4000-8000-000000000004'),
  0::bigint,
  'leader E sees none of the broker leads because the broker is not in E'
);

select set_config('request.jwt.claim.sub', 'f1020000-0000-4000-8000-000000000001', true);
select is(
  (select count(*) from public.leads where id between 'f1040000-0000-4000-8000-000000000001' and 'f1040000-0000-4000-8000-000000000004'),
  4::bigint,
  'the broker retains all four own leads'
);

select set_config('request.jwt.claim.sub', 'f1020000-0000-4000-8000-000000000007', true);
select is(
  (select count(*) from public.leads where organization_id = 'f1010000-0000-4000-8000-000000000001'),
  6::bigint,
  'the administrator retains organization-wide read access'
);

reset role;
update public.organization_members
set is_active = false
where organization_id = 'f1010000-0000-4000-8000-000000000001'
  and user_id = 'f1020000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub', 'f1020000-0000-4000-8000-000000000002', true);
select is(
  (select count(*) from public.leads where id between 'f1040000-0000-4000-8000-000000000001' and 'f1040000-0000-4000-8000-000000000004'),
  1::bigint,
  'inactive broker membership in the lead organization blocks cross-team reads'
);

reset role;
update public.organization_members
set is_active = true
where organization_id = 'f1010000-0000-4000-8000-000000000001'
  and user_id = 'f1020000-0000-4000-8000-000000000001';
update public.users
set is_active = false
where id = 'f1020000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub', 'f1020000-0000-4000-8000-000000000002', true);
select is(
  (select count(*) from public.leads where id between 'f1040000-0000-4000-8000-000000000001' and 'f1040000-0000-4000-8000-000000000004'),
  1::bigint,
  'inactive broker user blocks cross-team reads'
);

reset role;
update public.users
set is_active = true
where id = 'f1020000-0000-4000-8000-000000000001';
update public.team_members
set is_active = false
where team_id = 'f1030000-0000-4000-8000-000000000001'
  and user_id = 'f1020000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub', 'f1020000-0000-4000-8000-000000000002', true);
select is(
  (select count(*) from public.leads where id between 'f1040000-0000-4000-8000-000000000001' and 'f1040000-0000-4000-8000-000000000004'),
  1::bigint,
  'inactive broker membership stops cross-team reads but keeps the team A lead'
);

reset role;
update public.team_members
set is_active = false
where team_id = 'f1030000-0000-4000-8000-000000000002'
  and user_id = 'f1020000-0000-4000-8000-000000000003';
set local role authenticated;
select set_config('request.jwt.claim.sub', 'f1020000-0000-4000-8000-000000000003', true);
select is(
  (select count(*) from public.leads where id between 'f1040000-0000-4000-8000-000000000001' and 'f1040000-0000-4000-8000-000000000004'),
  0::bigint,
  'inactive leader membership removes team read access'
);

select * from finish();
rollback;
