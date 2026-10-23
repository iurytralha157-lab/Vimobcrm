-- ONLY a fresh disposable test database. No production bootstrap.
do $roles$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then create role authenticator nologin noinherit; end if;
end $roles$;
grant anon, authenticated, service_role to authenticator;
create schema private;
create schema vault;
create table vault.secrets(id uuid primary key default gen_random_uuid(), secret text, name text, description text);
create view vault.decrypted_secrets as select id, secret as decrypted_secret, name from vault.secrets;
create function vault.create_secret(value text, secret_name text, secret_description text) returns uuid language sql as $$
  insert into vault.secrets(secret,name,description) values(value,secret_name,secret_description) returning id;
$$;
create function vault.update_secret(secret_id uuid, value text, secret_name text, secret_description text)
returns void language sql as $$ update vault.secrets set secret=value,name=secret_name,description=secret_description where id=secret_id $$;
create table public.organizations(id uuid primary key);
create table public.users(id uuid primary key, organization_id uuid, role text, is_active boolean);
create table public.organization_members(organization_id uuid,user_id uuid,is_active boolean,deleted_at timestamptz);
create table public.schedule_events(id uuid primary key, organization_id uuid not null,user_id uuid not null,
  updated_at timestamptz default now(),google_sync_status text,google_sync_error text,
  constraint synthetic_atomic_error_rejection check (google_sync_error is distinct from 'synthetic-atomic-reject'));
grant select, insert, delete, update on public.schedule_events to service_role;
create table public.google_calendar_tokens(id uuid primary key default gen_random_uuid(), organization_id uuid not null,
  user_id uuid not null, token_secret_ref uuid, sync_enabled boolean default true, sync_status text default 'connected',
  disconnected_at timestamptz,sync_token text,watch_expires_at timestamptz,last_error text,created_at timestamptz default now());
create table public.google_calendar_sync_jobs(id uuid primary key default gen_random_uuid(),organization_id uuid not null,
  connection_id uuid, schedule_event_id uuid references public.schedule_events(id) on delete set null,
  action text not null,status text not null default 'queued', attempts integer not null default 0,max_attempts integer not null default 5,
  next_run_at timestamptz not null default now(),locked_at timestamptz,locked_by text,last_error text,
  payload jsonb not null default '{}'::jsonb,created_by uuid,created_at timestamptz default now(),updated_at timestamptz default now());
create table public.google_calendar_event_links(id uuid primary key default gen_random_uuid(),organization_id uuid,
  connection_id uuid,deleted_at timestamptz,last_error text);
create table public.google_calendar_channels(id uuid primary key default gen_random_uuid());
create table public.google_calendar_oauth_states(state_hash text primary key);
-- Prior claim signatures are intentionally present for revocation assertions.
create function public.google_calendar_claim_outbound_sync_jobs(integer,text)
returns setof public.google_calendar_sync_jobs language sql as $$ select * from public.google_calendar_sync_jobs where false $$;
create function public.google_calendar_claim_sync_jobs(integer,text)
returns setof public.google_calendar_sync_jobs language sql as $$ select * from public.google_calendar_sync_jobs where false $$;
grant execute on function public.google_calendar_claim_outbound_sync_jobs(integer,text),
  public.google_calendar_claim_sync_jobs(integer,text) to anon,authenticated,service_role;
-- An unverified legacy job must remain reviewable, never silently terminalized.
insert into public.google_calendar_sync_jobs(id,organization_id,action,payload) values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','push_upsert','{}');
