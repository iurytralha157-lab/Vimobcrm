-- Store Imoview credentials in Vault. The nullable api_key column remains as
-- a write-only compatibility input and is forced back to NULL by the trigger.
alter table public.imoview_integrations
  add column if not exists api_key_secret_ref uuid,
  add column if not exists status text not null default 'connected',
  add column if not exists last_error text,
  add column if not exists created_by uuid references public.users(id) on delete set null;

alter table public.imoview_integrations
  alter column api_key drop not null,
  alter column is_active set default true,
  alter column total_synced set default 0,
  alter column created_at set default now(),
  alter column updated_at set default now();

update public.imoview_integrations
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
  total_synced = coalesce(total_synced, 0),
  created_at = coalesce(created_at, now()),
  updated_at = coalesce(updated_at, now());

alter table public.imoview_integrations
  alter column is_active set not null,
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
    from public.imoview_integrations
    for update
  loop
    secret_name := 'vimob_imoview_api_key_' || integration.organization_id::text;
    secret_id := integration.api_key_secret_ref;

    if secret_id is null then
      select s.id into secret_id
      from vault.secrets s
      where s.name = secret_name;
    end if;

    if nullif(btrim(integration.api_key), '') is not null then
      if secret_id is null then
        secret_id := vault.create_secret(
          integration.api_key,
          secret_name,
          'Imoview API key for organization ' || integration.organization_id::text
        );
      else
        perform vault.update_secret(
          secret_id,
          integration.api_key,
          secret_name,
          'Imoview API key for organization ' || integration.organization_id::text
        );
      end if;
    end if;

    if secret_id is null then
      raise exception 'Imoview integration % has no credential to migrate', integration.id;
    end if;

    update public.imoview_integrations
    set api_key_secret_ref = secret_id,
        api_key = null
    where id = integration.id;
  end loop;
end;
$backfill$;

alter table public.imoview_integrations
  drop constraint if exists imoview_integrations_status_check,
  drop constraint if exists imoview_integrations_total_synced_check,
  drop constraint if exists imoview_integrations_api_key_write_only_check,
  drop constraint if exists imoview_integrations_api_key_secret_ref_fkey;

alter table public.imoview_integrations
  add constraint imoview_integrations_status_check
    check (status in ('pending', 'connected', 'syncing', 'error', 'disabled')),
  add constraint imoview_integrations_total_synced_check
    check (total_synced >= 0),
  add constraint imoview_integrations_api_key_write_only_check
    check (api_key is null),
  add constraint imoview_integrations_api_key_secret_ref_fkey
    foreign key (api_key_secret_ref) references vault.secrets(id) on delete restrict;

alter table public.imoview_integrations
  alter column api_key_secret_ref set not null;

create or replace function private.imoview_store_api_key()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, vault, private
as $function$
declare
  secret_value text := nullif(btrim(new.api_key), '');
  secret_id uuid := new.api_key_secret_ref;
  secret_name text := 'vimob_imoview_api_key_' || new.organization_id::text;
begin
  perform pg_advisory_xact_lock(hashtextextended('imoview_api_key:' || new.organization_id::text, 0));

  if secret_id is null then
    select i.api_key_secret_ref into secret_id
    from public.imoview_integrations i
    where i.organization_id = new.organization_id
    limit 1;
  end if;

  if secret_id is null then
    select s.id into secret_id
    from vault.secrets s
    where s.name = secret_name;
  end if;

  if secret_value is not null then
    if secret_id is null then
      secret_id := vault.create_secret(
        secret_value,
        secret_name,
        'Imoview API key for organization ' || new.organization_id::text
      );
    else
      perform vault.update_secret(
        secret_id,
        secret_value,
        secret_name,
        'Imoview API key for organization ' || new.organization_id::text
      );
    end if;
  end if;

  if secret_id is null then
    raise exception 'Imoview API key is required';
  end if;

  new.api_key_secret_ref := secret_id;
  new.api_key := null;
  return new;
end;
$function$;

create or replace function private.imoview_delete_api_key()
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

revoke all on function private.imoview_store_api_key() from public, anon, authenticated;
revoke all on function private.imoview_delete_api_key() from public, anon, authenticated;

drop trigger if exists imoview_store_api_key_before_write on public.imoview_integrations;
create trigger imoview_store_api_key_before_write
before insert or update of organization_id, api_key, api_key_secret_ref
on public.imoview_integrations
for each row execute function private.imoview_store_api_key();

drop trigger if exists imoview_delete_api_key_after_delete on public.imoview_integrations;
create trigger imoview_delete_api_key_after_delete
after delete on public.imoview_integrations
for each row execute function private.imoview_delete_api_key();

alter table public.imoview_integrations enable row level security;
drop policy if exists "Users can manage own org imoview integration" on public.imoview_integrations;
drop policy if exists "members read imoview_integrations" on public.imoview_integrations;
drop policy if exists "property admins manage imoview_integrations" on public.imoview_integrations;

revoke all on public.imoview_integrations from public, anon, authenticated;
grant select, insert, update, delete on public.imoview_integrations to service_role;

revoke all on vault.decrypted_secrets from public, anon, authenticated;
grant usage on schema vault to service_role;
grant select on vault.decrypted_secrets to service_role;

create or replace view public.imoview_integrations_service
with (security_invoker = true)
as
select
  i.id,
  i.organization_id,
  secrets.decrypted_secret as api_key,
  i.is_active,
  i.status,
  i.last_sync_at,
  i.last_error,
  i.total_synced,
  i.sync_log,
  i.created_by,
  i.created_at,
  i.updated_at
from public.imoview_integrations i
join vault.decrypted_secrets secrets on secrets.id = i.api_key_secret_ref;

revoke all on public.imoview_integrations_service from public, anon, authenticated;
grant select on public.imoview_integrations_service to service_role;

comment on column public.imoview_integrations.api_key is
  'Write-only compatibility input. A BEFORE trigger moves values to Vault and stores NULL.';
comment on column public.imoview_integrations.api_key_secret_ref is
  'Reference to the encrypted Imoview API key in Supabase Vault.';
comment on view public.imoview_integrations_service is
  'Service-role-only Imoview integration projection with the Vault secret decrypted at query time.';
