begin;

create extension if not exists pgtap with schema extensions;
select plan(10);

select ok(
  to_regclass('public.gamification_rules_organization_id_action_type_key') is null,
  'legacy gamification rules duplicate index is removed'
);
select ok(
  to_regclass('public.gamification_rules_org_action_canonical_key') is not null,
  'canonical gamification rules unique index remains'
);
select ok(
  to_regclass('public.uq_active_season_per_org') is null,
  'legacy active season duplicate index is removed'
);
select ok(
  to_regclass('public.gamification_seasons_one_active_canonical_idx') is not null,
  'canonical active season unique index remains'
);
select ok(
  to_regclass('public.organization_members_user_org_unique') is null,
  'redundant organization membership constraint index is removed'
);
select ok(
  to_regclass('public.organization_members_user_id_organization_id_key') is not null,
  'referenced organization membership unique index remains'
);
select ok(
  to_regclass('public.idx_round_robin_members_team') is null,
  'legacy round-robin team index is removed'
);
select ok(
  to_regclass('public.idx_round_robin_members_team_fk') is not null,
  'round-robin team foreign-key index remains'
);
select ok(
  to_regclass('public.idx_round_robin_members_user') is null,
  'legacy round-robin user index is removed'
);
select ok(
  to_regclass('public.idx_round_robin_members_user_fk') is not null,
  'round-robin user foreign-key index remains'
);

select * from finish();
rollback;
