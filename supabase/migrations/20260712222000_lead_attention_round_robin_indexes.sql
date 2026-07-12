-- Cover the remaining round-robin membership foreign keys used by the
-- attention redistribution worker.

create index if not exists idx_round_robin_members_organization_fk
  on public.round_robin_members (organization_id);

create index if not exists idx_round_robin_members_user_fk
  on public.round_robin_members (user_id)
  where user_id is not null;
