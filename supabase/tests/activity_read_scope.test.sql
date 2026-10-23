-- Executed by scripts/supabase/test-activity-read-scope-postgres.mjs against
-- its exclusive ephemeral container, after real policies and the new migration.
set role authenticated;
select fixture.actor(1);
select fixture.check(exists(select 1 from public.activities where id=fixture.id(211)), 'ordinary user reads own lead history');
select fixture.check(exists(select 1 from public.activities where id=fixture.id(234)), 'visible lead preserves legacy null activity tenant');
select fixture.check(not exists(select 1 from public.activities where id=fixture.id(212)), 'ordinary user cannot read another broker history');
select fixture.check(not exists(select 1 from public.activities where id=fixture.id(213)), 'ordinary user cannot cross organizations');
select fixture.check(not exists(select 1 from public.activities where id=fixture.id(215)), 'private pool ceiling still denies an otherwise owned lead');
select fixture.check(exists(select 1 from public.activities where id=fixture.id(231)), 'organization-only activity preserves prior authorized contract');
select fixture.check(not exists(select 1 from public.activities where id=fixture.id(232)), 'organization-only activity stays tenant-scoped');
with changed as (update public.activities set content='authorized update' where id=fixture.id(211) returning id)
select fixture.check((select count(*)=1 from changed), 'own activity UPDATE RETURNING remains compatible');
with changed as (update public.activities set content='forbidden update' where id=fixture.id(212) returning id)
select fixture.check((select count(*)=0 from changed), 'out-of-scope UPDATE RETURNING sees no rows');

select fixture.actor(2);
select fixture.check(exists(select 1 from public.activities where id=fixture.id(212)), 'leader sees active broker history');
select fixture.check(exists(select 1 from public.activities where id=fixture.id(214)), 'leader sees unassigned lead recorded in their team');
select fixture.check(not exists(select 1 from public.activities where id=fixture.id(216)), 'recorded team does not expose another current team broker');
select fixture.check(not exists(select 1 from public.activities where id=fixture.id(211)), 'leader cannot see unrelated broker history');
select fixture.check(not exists(select 1 from public.activities where id=fixture.id(213)), 'leader cannot cross organizations');
reset role;
insert into public.user_permission_overrides values(fixture.id(1001),fixture.id(2),'lead_view_team',false);
set role authenticated;
select fixture.check(not exists(select 1 from public.activities where id=fixture.id(212)), 'explicit team permission denial applies to activities');
reset role;
delete from public.user_permission_overrides;
insert into public.user_permission_overrides values(fixture.id(1001),fixture.id(1),'lead_view_own',false);
set role authenticated;
select fixture.actor(1);
select fixture.check(not exists(select 1 from public.activities where id=fixture.id(211)), 'explicit own permission denial applies to activities');
reset role;
delete from public.user_permission_overrides;
update public.organization_members set is_active=false where user_id=fixture.id(1);
set role authenticated;
select fixture.check(not exists(select 1 from public.activities), 'inactive member cannot read lead or organization activity');
reset role;
update public.organization_members set is_active=true,deleted_at=now() where user_id=fixture.id(1);
set role authenticated;
select fixture.check(not exists(select 1 from public.activities), 'deleted membership cannot read activities');
reset role;
update public.organization_members set deleted_at=null where user_id=fixture.id(1);
update public.organization_members set membership_generation=2 where user_id=fixture.id(3);
set role authenticated;
select fixture.actor(2);
select fixture.check(not exists(select 1 from public.activities where id=fixture.id(212)), 'stale broker team membership generation cannot grant history');
reset role;
update public.organization_members set membership_generation=1 where user_id=fixture.id(3);

set role authenticated;
select fixture.actor(4);
select fixture.check((select count(*)=8 from public.activities), 'admin reads authorized organization and legacy activity including pool');
select fixture.check(not exists(select 1 from public.activities where id in(fixture.id(213),fixture.id(232),fixture.id(233))), 'admin cannot cross tenant or read mismatched activity parent');
select fixture.actor(5);
select fixture.check((select count(*)=2 from public.activities), 'second tenant user sees only own lead and organization activity');
reset role;

-- The event author is deliberately user 6. History follows current lead owner.
set role authenticated;
select fixture.actor(1);
select fixture.check(exists(select 1 from public.activities where id=fixture.id(217)), 'newly assigned owner sees prior author history');
reset role;
update public.leads set assigned_user_id=fixture.id(6) where id=fixture.id(17);
set role authenticated;
select fixture.check(not exists(select 1 from public.activities where id=fixture.id(217)), 'former owner loses history immediately after transfer');
select fixture.actor(6);
select fixture.check(exists(select 1 from public.activities where id=fixture.id(217)), 'new owner receives complete existing history');

select fixture.actor(1,'recovery');
select fixture.check(not exists(select 1 from public.activities), 'recovery session cannot read any activity');
with changed as (update public.activities set content='recovery' where id=fixture.id(211) returning id)
select fixture.check((select count(*)=0 from changed), 'recovery UPDATE RETURNING cannot reveal or modify activity');
select fixture.actor(1);
select set_config('request.jwt.claims','{"session_id":"invalid"}',false);
select fixture.check(not exists(select 1 from public.activities), 'malformed session claim fails closed');
select set_config('request.jwt.claims','{}',false);
select fixture.check(not exists(select 1 from public.activities), 'missing session claim fails closed');
select fixture.actor(1);
reset role;
delete from auth.sessions where user_id=fixture.id(1);
set role authenticated;
select fixture.check(not exists(select 1 from public.activities), 'revoked user JWT loses lead and organization activity');
select fixture.actor(4);
reset role;
delete from auth.sessions where user_id=fixture.id(4);
set role authenticated;
select fixture.check(not exists(select 1 from public.activities), 'revoked admin JWT loses organization-wide activity');
reset role;
select set_config('request.jwt.claim.sub','',false);
select set_config('request.jwt.claims','{}',false);
set role anon;
do $$ begin
  begin
    if exists(select 1 from public.activities) then raise exception 'anon exposed activity'; end if;
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS: anonymous Data API role cannot read activity rows';
end $$;
reset role;
set role service_role;
select fixture.check((select count(*)=11 from public.activities), 'trusted backend role retains its existing RLS bypass');
reset role;
select fixture.check((select count(*)=1 from pg_policies where schemaname='public' and tablename='activities'
  and policyname='activities_select_requires_visible_lead_and_session' and permissive='RESTRICTIVE' and cmd='SELECT'),
  'new guard is restrictive SELECT and cannot OR-open legacy policies');
