-- Remove redundant indexes reported by the Supabase performance advisor.
-- The retained indexes enforce the same keys/predicates and are the canonical
-- names used by the current gamification and foreign-key migrations.

alter table public.gamification_rules
  drop constraint if exists gamification_rules_organization_id_action_type_key;

drop index if exists public.uq_active_season_per_org;

alter table public.organization_members
  drop constraint if exists organization_members_user_org_unique;

drop index if exists public.idx_round_robin_members_team;
drop index if exists public.idx_round_robin_members_user;
