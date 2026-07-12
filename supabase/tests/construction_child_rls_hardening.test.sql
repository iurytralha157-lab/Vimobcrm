begin;

create extension if not exists pgtap with schema extensions;
select plan(10);

select ok(
  (select count(*) from pg_policies where schemaname='public' and tablename='construction_purchase_order_items' and policyname like 'construction purchase items tenant %') in (0,4),
  'purchase item tenant policy set is complete or not required'
);
select ok(
  not exists (select 1 from pg_policies where schemaname='public' and tablename='construction_purchase_order_items' and policyname like 'construction purchase items tenant %' and cmd='ALL'),
  'purchase item policies are command-specific'
);
select ok(
  not exists (select 1 from pg_policies where schemaname='public' and tablename='construction_purchase_order_items' and policyname like 'construction purchase items tenant %' and roles <> array['authenticated']::name[]),
  'purchase item policies target authenticated users'
);
select ok(
  not exists (
    select 1 from pg_policies where schemaname='public' and tablename='construction_purchase_order_items'
      and policyname='construction purchase items tenant select'
      and position('private.is_org_member' in coalesce(qual,'')) = 0
  ),
  'purchase item reads are tenant-scoped'
);
select ok(
  not exists (
    select 1 from pg_policies where schemaname='public' and tablename='construction_purchase_order_items'
      and policyname='construction purchase items tenant insert'
      and position('private.has_org_role' in coalesce(with_check,'')) = 0
  ),
  'purchase item writes require tenant admin access'
);

select ok(
  (select count(*) from pg_policies where schemaname='public' and tablename='construction_team_members' and policyname like 'construction team members tenant %') in (0,4),
  'team member tenant policy set is complete or not required'
);
select ok(
  not exists (select 1 from pg_policies where schemaname='public' and tablename='construction_team_members' and policyname like 'construction team members tenant %' and cmd='ALL'),
  'team member policies are command-specific'
);
select ok(
  not exists (select 1 from pg_policies where schemaname='public' and tablename='construction_team_members' and policyname like 'construction team members tenant %' and roles <> array['authenticated']::name[]),
  'team member policies target authenticated users'
);
select ok(
  not exists (
    select 1 from pg_policies where schemaname='public' and tablename='construction_team_members'
      and policyname='construction team members tenant select'
      and position('private.is_org_member' in coalesce(qual,'')) = 0
  ),
  'team member reads are tenant-scoped'
);
select ok(
  not exists (
    select 1 from pg_policies where schemaname='public' and tablename='construction_team_members'
      and policyname='construction team members tenant insert'
      and position('private.has_org_role' in coalesce(with_check,'')) = 0
  ),
  'team member writes require tenant admin access'
);

select * from finish();
rollback;
