-- Close organization-scoped tables that exist only in the production lineage.
do $$
begin
  if to_regclass('public.conversation_ai_state') is not null then
    alter table public.conversation_ai_state enable row level security;
  end if;

  if to_regclass('public.incident_20260701_pool_redistribution_backup') is not null then
    alter table public.incident_20260701_pool_redistribution_backup enable row level security;
    revoke all on table public.incident_20260701_pool_redistribution_backup from anon, authenticated;
  end if;
end
$$;
