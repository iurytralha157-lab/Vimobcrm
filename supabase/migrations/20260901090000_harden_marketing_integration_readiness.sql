-- Complete the FK support and Vault invariant required by the canonical
-- Go-based Marketing integration. These indexes are intentionally aligned
-- with the exact leading columns of each foreign key so deletes/updates of a
-- Meta integration cannot degrade into tenant-wide table scans.

create index if not exists marketing_accounts_integration_organization_fk_idx
  on public.marketing_accounts (integration_id, organization_id)
  where integration_id is not null;

create index if not exists marketing_performance_daily_integration_organization_fk_idx
  on public.marketing_performance_daily (integration_id, organization_id)
  where integration_id is not null;

create index if not exists marketing_social_daily_integration_organization_fk_idx
  on public.marketing_social_daily (integration_id, organization_id)
  where integration_id is not null;

create index if not exists marketing_media_assets_integration_organization_fk_idx
  on public.marketing_media_assets (integration_id, organization_id)
  where integration_id is not null;

create index if not exists marketing_sync_runs_integration_organization_fk_idx
  on public.marketing_sync_runs (integration_id, organization_id)
  where integration_id is not null;

create index if not exists marketing_sync_runs_created_by_fk_idx
  on public.marketing_sync_runs (created_by)
  where created_by is not null;

do $validate_marketing_vault_contract$
begin
  if exists (
    select 1
    from pg_constraint
    where conrelid = 'public.meta_integrations'::regclass
      and conname = 'meta_integrations_access_token_vault_check'
      and not convalidated
  ) then
    execute 'alter table public.meta_integrations validate constraint meta_integrations_access_token_vault_check';
  end if;
end;
$validate_marketing_vault_contract$;
