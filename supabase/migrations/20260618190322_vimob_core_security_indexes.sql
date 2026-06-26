alter function private.set_updated_at() set search_path = private, pg_temp;

revoke execute on function public.rls_auto_enable() from public;
revoke execute on function public.rls_auto_enable() from anon;
revoke execute on function public.rls_auto_enable() from authenticated;

create index if not exists idx_legal_consents_organization_id
  on public.legal_consents(organization_id);

create index if not exists idx_organizations_created_by
  on public.organizations(created_by);

create index if not exists idx_organizations_plan_id
  on public.organizations(plan_id);

create index if not exists idx_subscriptions_plan_id
  on public.subscriptions(plan_id);
