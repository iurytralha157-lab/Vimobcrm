-- Store Vista credentials encrypted at rest while preserving a write-only
-- api_key compatibility column for the currently deployed API version.
alter table public.vista_integrations
  add column if not exists api_key_secret_ref uuid,
  add column if not exists status text not null default 'connected',
  add column if not exists last_error text,
  add column if not exists created_by uuid references public.users(id) on delete set null;

alter table public.vista_integrations
  alter column api_key drop not null,
  alter column is_active set default true,
  alter column import_inactive set default false,
  alter column total_synced set default 0,
  alter column created_at set default now(),
  alter column updated_at set default now();

update public.vista_integrations
set
  status = case
    when jsonb_typeof(sync_log->'errors') = 'array'
      and jsonb_array_length(sync_log->'errors') > 0 then 'error'
    else 'connected'
  end,
  last_error = case
    when jsonb_typeof(sync_log->'errors') = 'array'
      then nullif(sync_log->'errors'->>0, '')
    else null
  end,
  is_active = coalesce(is_active, true),
  import_inactive = coalesce(import_inactive, false),
  total_synced = coalesce(total_synced, 0),
  created_at = coalesce(created_at, now()),
  updated_at = coalesce(updated_at, now());

alter table public.vista_integrations
  alter column is_active set not null,
  alter column import_inactive set not null,
  alter column total_synced set not null,
  alter column created_at set not null,
  alter column updated_at set not null;

do $backfill$
declare
  integration record;
  secret_id uuid;
  secret_name text;
begin
  for integration in
    select id, organization_id, api_key, api_key_secret_ref
    from public.vista_integrations
    for update
  loop
    secret_name := 'vimob_vista_api_key_' || integration.organization_id::text;
    secret_id := integration.api_key_secret_ref;

    if secret_id is null then
      select s.id
      into secret_id
      from vault.secrets s
      where s.name = secret_name;
    end if;

    if nullif(btrim(integration.api_key), '') is not null then
      if secret_id is null then
        secret_id := vault.create_secret(
          integration.api_key,
          secret_name,
          'Vista API key for organization ' || integration.organization_id::text
        );
      else
        perform vault.update_secret(
          secret_id,
          integration.api_key,
          secret_name,
          'Vista API key for organization ' || integration.organization_id::text
        );
      end if;
    end if;

    if secret_id is null then
      raise exception 'Vista integration % has no credential to migrate', integration.id;
    end if;

    update public.vista_integrations
    set api_key_secret_ref = secret_id,
        api_key = null
    where id = integration.id;
  end loop;
end;
$backfill$;

alter table public.vista_integrations
  drop constraint if exists vista_integrations_status_check,
  drop constraint if exists vista_integrations_total_synced_check,
  drop constraint if exists vista_integrations_api_key_write_only_check,
  drop constraint if exists vista_integrations_api_key_secret_ref_fkey;

alter table public.vista_integrations
  add constraint vista_integrations_status_check
    check (status in ('pending', 'connected', 'syncing', 'error', 'disabled')),
  add constraint vista_integrations_total_synced_check
    check (total_synced >= 0),
  add constraint vista_integrations_api_key_write_only_check
    check (api_key is null),
  add constraint vista_integrations_api_key_secret_ref_fkey
    foreign key (api_key_secret_ref) references vault.secrets(id) on delete restrict;

alter table public.vista_integrations
  alter column api_key_secret_ref set not null;

create or replace function private.vista_store_api_key()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, vault, private
as $function$
declare
  secret_value text := nullif(btrim(new.api_key), '');
  secret_id uuid := new.api_key_secret_ref;
  secret_name text := 'vimob_vista_api_key_' || new.organization_id::text;
begin
  if secret_id is null then
    select v.api_key_secret_ref
    into secret_id
    from public.vista_integrations v
    where v.organization_id = new.organization_id
    limit 1;
  end if;

  if secret_id is null then
    select s.id
    into secret_id
    from vault.secrets s
    where s.name = secret_name;
  end if;

  if secret_value is not null then
    if secret_id is null then
      secret_id := vault.create_secret(
        secret_value,
        secret_name,
        'Vista API key for organization ' || new.organization_id::text
      );
    else
      perform vault.update_secret(
        secret_id,
        secret_value,
        secret_name,
        'Vista API key for organization ' || new.organization_id::text
      );
    end if;
  end if;

  if secret_id is null then
    raise exception 'Vista API key is required';
  end if;

  new.api_key_secret_ref := secret_id;
  new.api_key := null;
  return new;
end;
$function$;

create or replace function private.vista_delete_api_key()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, vault, private
as $function$
begin
  if old.api_key_secret_ref is not null then
    delete from vault.secrets where id = old.api_key_secret_ref;
  end if;
  return old;
end;
$function$;

revoke all on function private.vista_store_api_key() from public, anon, authenticated;
revoke all on function private.vista_delete_api_key() from public, anon, authenticated;

drop trigger if exists vista_store_api_key_before_write on public.vista_integrations;
create trigger vista_store_api_key_before_write
before insert or update of organization_id, api_key, api_key_secret_ref
on public.vista_integrations
for each row execute function private.vista_store_api_key();

drop trigger if exists vista_delete_api_key_after_delete on public.vista_integrations;
create trigger vista_delete_api_key_after_delete
after delete on public.vista_integrations
for each row execute function private.vista_delete_api_key();

alter table public.vista_integrations enable row level security;
drop policy if exists "Users can manage own org vista integration" on public.vista_integrations;
drop policy if exists "members read vista_integrations" on public.vista_integrations;
drop policy if exists "property admins manage vista_integrations" on public.vista_integrations;

revoke all on public.vista_integrations from public, anon, authenticated;
grant select, insert, update, delete on public.vista_integrations to service_role;

revoke all on vault.decrypted_secrets from public, anon, authenticated;
grant usage on schema vault to service_role;
grant select on vault.decrypted_secrets to service_role;

create or replace view public.vista_integrations_service
with (security_invoker = true)
as
select
  v.id,
  v.organization_id,
  v.api_url,
  secrets.decrypted_secret as api_key,
  v.is_active,
  v.import_inactive,
  v.status,
  v.last_sync_at,
  v.last_error,
  v.total_synced,
  v.sync_log,
  v.created_by,
  v.created_at,
  v.updated_at
from public.vista_integrations v
join vault.decrypted_secrets secrets on secrets.id = v.api_key_secret_ref;

revoke all on public.vista_integrations_service from public, anon, authenticated;
grant select on public.vista_integrations_service to service_role;

comment on column public.vista_integrations.api_key is
  'Write-only compatibility input. A BEFORE trigger moves values to Vault and stores NULL.';
comment on column public.vista_integrations.api_key_secret_ref is
  'Reference to the encrypted Vista API key in Supabase Vault.';
comment on view public.vista_integrations_service is
  'Service-role-only Vista integration projection with the Vault secret decrypted at query time.';
