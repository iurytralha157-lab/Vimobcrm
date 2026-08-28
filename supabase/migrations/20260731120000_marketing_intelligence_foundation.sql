-- Marketing intelligence foundation.
--
-- The legacy meta_campaign_insights table stores interval snapshots. Those
-- snapshots may overlap and cannot be summed safely. The tables below store
-- one immutable/upsertable fact per provider, account, entity, level and day.
-- This also creates the semantic "qualified" stage marker used by CRM
-- attribution and moves Meta access tokens to Supabase Vault on every write.

create extension if not exists supabase_vault with schema vault;

alter table public.stages
  add column if not exists is_qualified boolean not null default false;

comment on column public.stages.is_qualified is
  'A lead is qualified after entering this stage. Marketing analytics uses the stage history, not the stage name.';

-- The module controls the organization entitlement, while these permissions
-- control which people may view Marketing or operate Meta conversations. Keep
-- the catalog idempotent so role/user grants never silently insert zero rows.
insert into public.available_permissions (
  key,
  name,
  description,
  category,
  label,
  domain
)
values
  (
    'dashboard_campaigns_view',
    'Ver Marketing',
    'Acessar metricas e inteligencia de Marketing da organizacao.',
    'dashboard',
    'Ver Marketing',
    'dashboard'
  ),
  (
    'settings_integrations',
    'Gerenciar integracoes',
    'Conectar e configurar integracoes externas da organizacao.',
    'settings',
    'Gerenciar integracoes',
    'settings'
  ),
  (
    'whatsapp_view',
    'Ver conversas',
    'Visualizar conversas autorizadas nos canais habilitados.',
    'conversations',
    'Ver conversas',
    'conversations'
  ),
  (
    'whatsapp_operate',
    'Operar conversas',
    'Enviar mensagens e organizar conversas autorizadas.',
    'conversations',
    'Operar conversas',
    'conversations'
  )
on conflict (key) do update
set name = excluded.name,
    description = excluded.description,
    category = excluded.category,
    label = excluded.label,
    domain = excluded.domain;

create or replace function private.meta_legacy_plaintext_token(
  p_secret_ref text
)
returns text
language sql
immutable
strict
set search_path = pg_catalog
as $$
  select case
    when left(btrim(p_secret_ref), 6) = 'plain:'
      then nullif(btrim(substr(btrim(p_secret_ref), 7)), '')
    else null
  end;
$$;

create or replace function private.meta_legacy_vault_secret_id(
  p_secret_ref text
)
returns uuid
language sql
stable
strict
set search_path = pg_catalog, vault
as $$
  select secret.id
  from vault.secrets as secret
  where secret.id = case
    when btrim(p_secret_ref)
      ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then btrim(p_secret_ref)::uuid
    else null
  end;
$$;

revoke all on function private.meta_legacy_plaintext_token(text)
  from public, anon, authenticated, service_role;
revoke all on function private.meta_legacy_vault_secret_id(text)
  from public, anon, authenticated, service_role;

do $$
declare
  secret_ref_type text;
  ambiguous_ref_count bigint := 0;
  conflicting_plaintext_count bigint := 0;
  dangling_vault_ref_count bigint := 0;
begin
  select columns.udt_name
  into secret_ref_type
  from information_schema.columns
  where columns.table_schema = 'public'
    and columns.table_name = 'meta_integrations'
    and columns.column_name = 'access_token_secret_ref';

  if secret_ref_type is null then
    alter table public.meta_integrations
      add column access_token_secret_ref uuid;
  elsif secret_ref_type <> 'uuid' then
    -- The legacy plaintext column is an explicit credential source and is the
    -- path used by the existing production integrations. A text reference is
    -- accepted only when it points to a Vault row that exists, or when an
    -- operator deliberately marked it as `plain:`. Anything else aborts the
    -- migration rather than being guessed, promoted, or silently discarded.
    execute $migration$
      select count(*)
      from public.meta_integrations
      where nullif(btrim(access_token_secret_ref::text), '') is not null
        and private.meta_legacy_plaintext_token(
          access_token_secret_ref::text
        ) is null
        and private.meta_legacy_vault_secret_id(
          access_token_secret_ref::text
        ) is null
    $migration$
    into ambiguous_ref_count;

    if ambiguous_ref_count > 0 then
      raise exception using
        errcode = '22023',
        message = 'meta_legacy_secret_ref_requires_explicit_classification',
        detail = format(
          '%s Meta integration reference(s) are neither existing Vault UUIDs nor explicitly marked plaintext.',
          ambiguous_ref_count
        ),
        hint = 'Move intentional plaintext into access_token (preferred), prefix it with plain:, or restore the referenced Vault secret before retrying.';
    end if;

    execute $migration$
      select count(*)
      from public.meta_integrations
      where private.meta_legacy_plaintext_token(
          access_token_secret_ref::text
        ) is not null
        and nullif(btrim(access_token), '') is not null
        and btrim(access_token) is distinct from
          private.meta_legacy_plaintext_token(
            access_token_secret_ref::text
          )
    $migration$
    into conflicting_plaintext_count;

    if conflicting_plaintext_count > 0 then
      raise exception using
        errcode = '23514',
        message = 'meta_legacy_plaintext_sources_conflict',
        detail = format(
          '%s Meta integration row(s) contain different explicit plaintext credentials.',
          conflicting_plaintext_count
        ),
        hint = 'Keep the intended token in access_token and clear access_token_secret_ref, or make the explicit plain: value match before retrying.';
    end if;

    execute $migration$
      update public.meta_integrations
      set access_token = coalesce(
        nullif(btrim(access_token), ''),
        private.meta_legacy_plaintext_token(
          access_token_secret_ref::text
        )
      )
      where private.meta_legacy_plaintext_token(
        access_token_secret_ref::text
      ) is not null
    $migration$;

    execute $migration$
      alter table public.meta_integrations
      alter column access_token_secret_ref type uuid
      using (
        private.meta_legacy_vault_secret_id(
          access_token_secret_ref::text
        )
      )
    $migration$;
  end if;

  select count(*)
  into dangling_vault_ref_count
  from public.meta_integrations as integration
  where integration.access_token_secret_ref is not null
    and not exists (
      select 1
      from vault.secrets as secret
      where secret.id = integration.access_token_secret_ref
    );

  if dangling_vault_ref_count > 0 then
    raise exception using
      errcode = '23503',
      message = 'meta_access_token_vault_reference_missing',
      detail = format(
        '%s Meta integration row(s) reference a Vault secret that does not exist.',
        dangling_vault_ref_count
      ),
      hint = 'Restore each Vault secret or place the intended plaintext token in access_token before retrying.';
  end if;
end;
$$;

-- Page tokens and long-lived user tokens serve different Meta APIs. Page
-- tokens remain the credential for lead/page/Messenger operations, while the
-- user token is isolated for Ads Insights. Both plaintext columns are
-- write-only and cleared before the row reaches storage.
alter table public.meta_integrations
  add column if not exists user_access_token text,
  add column if not exists user_access_token_secret_ref uuid,
  add column if not exists granted_scopes text[] not null
    default array[]::text[],
  add column if not exists subscribed_fields jsonb not null
    default '["leadgen"]'::jsonb,
  add column if not exists subscription_reconciled_at timestamptz;

update public.meta_integrations
set granted_scopes = array[]::text[]
where granted_scopes is null;

comment on column public.meta_integrations.granted_scopes is
  'Scopes confirmed by Meta for the stored user token. Used by the Go backend to decide whether module activation can proceed without OAuth.';
comment on column public.meta_integrations.subscribed_fields is
  'Provider webhook fields last reconciled by the Go backend. Leadgen remains active independently of advanced modules.';
comment on column public.meta_integrations.subscription_reconciled_at is
  'Last successful backend reconciliation of the Page subscribed_apps fields.';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.meta_integrations'::regclass
      and conname = 'meta_integrations_subscribed_fields_check'
  ) then
    alter table public.meta_integrations
      add constraint meta_integrations_subscribed_fields_check
      check (
        jsonb_typeof(subscribed_fields) = 'array'
        and subscribed_fields <@ '["leadgen", "messages", "messaging_postbacks"]'::jsonb
        and subscribed_fields @> '["leadgen"]'::jsonb
      ) not valid;
  end if;
end;
$$;

update public.meta_integrations
set subscribed_fields = '["leadgen"]'::jsonb
where subscribed_fields is null
   or jsonb_typeof(subscribed_fields) <> 'array'
   or not (subscribed_fields <@ '["leadgen", "messages", "messaging_postbacks"]'::jsonb)
   or not (subscribed_fields @> '["leadgen"]'::jsonb);

alter table public.meta_integrations
  validate constraint meta_integrations_subscribed_fields_check;

do $$
declare
  dangling_vault_ref_count bigint := 0;
begin
  select count(*)
  into dangling_vault_ref_count
  from public.meta_integrations as integration
  where integration.user_access_token_secret_ref is not null
    and not exists (
      select 1
      from vault.secrets as secret
      where secret.id = integration.user_access_token_secret_ref
    );

  if dangling_vault_ref_count > 0 then
    raise exception using
      errcode = '23503',
      message = 'meta_user_access_token_vault_reference_missing',
      detail = format(
        '%s Meta integration row(s) reference a user-token Vault secret that does not exist.',
        dangling_vault_ref_count
      ),
      hint = 'Restore each Vault secret or place the intended plaintext token in user_access_token before retrying.';
  end if;
end;
$$;

create or replace function private.meta_store_access_token()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private, vault
as $$
declare
  secret_id uuid;
  secret_name text;
  token_value text;
begin
  token_value := nullif(btrim(new.access_token), '');

  if token_value is null then
    -- The reference is server-managed. A browser role that may update its own
    -- integration row cannot swap in another tenant's Vault UUID.
    if tg_op = 'UPDATE' then
      new.access_token_secret_ref := old.access_token_secret_ref;
    else
      new.access_token_secret_ref := null;
    end if;
    new.access_token := null;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    secret_id := old.access_token_secret_ref;
  end if;

  secret_name := format(
    'meta:%s:%s',
    new.organization_id::text,
    coalesce(nullif(new.page_id, ''), new.id::text)
  );

  if secret_id is null then
    secret_id := vault.create_secret(
      token_value,
      secret_name,
      'Meta access token managed by Vimob CRM'
    );
  else
    perform vault.update_secret(
      secret_id,
      token_value,
      secret_name,
      'Meta access token managed by Vimob CRM'
    );
  end if;

  new.access_token_secret_ref := secret_id;
  new.access_token := null;
  return new;
end;
$$;

create or replace function private.meta_store_user_access_token()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private, vault
as $$
declare
  secret_id uuid;
  secret_name text;
  token_value text;
begin
  token_value := nullif(btrim(new.user_access_token), '');

  if token_value is null then
    if tg_op = 'UPDATE' then
      new.user_access_token_secret_ref := old.user_access_token_secret_ref;
    else
      new.user_access_token_secret_ref := null;
    end if;
    new.user_access_token := null;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    secret_id := old.user_access_token_secret_ref;
  end if;

  secret_name := format(
    'meta-user:%s:%s:%s',
    new.organization_id::text,
    coalesce(nullif(new.facebook_user_id, ''), 'unknown-user'),
    coalesce(nullif(new.page_id, ''), new.id::text)
  );

  if secret_id is null then
    secret_id := vault.create_secret(
      token_value,
      secret_name,
      'Meta long-lived user token for Ads Insights'
    );
  else
    perform vault.update_secret(
      secret_id,
      token_value,
      secret_name,
      'Meta long-lived user token for Ads Insights'
    );
  end if;

  new.user_access_token_secret_ref := secret_id;
  new.user_access_token := null;
  return new;
end;
$$;

create or replace function private.meta_delete_access_token()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private, vault
as $$
begin
  if old.access_token_secret_ref is not null then
    delete from vault.secrets where id = old.access_token_secret_ref;
  end if;
  if old.user_access_token_secret_ref is not null
     and old.user_access_token_secret_ref is distinct from old.access_token_secret_ref then
    delete from vault.secrets where id = old.user_access_token_secret_ref;
  end if;
  return old;
end;
$$;

drop trigger if exists meta_store_access_token_before_write on public.meta_integrations;
create trigger meta_store_access_token_before_write
before insert or update of access_token, access_token_secret_ref
on public.meta_integrations
for each row
execute function private.meta_store_access_token();

drop trigger if exists meta_store_user_access_token_before_write on public.meta_integrations;
create trigger meta_store_user_access_token_before_write
before insert or update of user_access_token, user_access_token_secret_ref
on public.meta_integrations
for each row
execute function private.meta_store_user_access_token();

drop trigger if exists meta_delete_access_token_after_delete on public.meta_integrations;
create trigger meta_delete_access_token_after_delete
after delete on public.meta_integrations
for each row
execute function private.meta_delete_access_token();

-- Run existing plaintext values through the write-only Vault trigger.
update public.meta_integrations
set access_token = btrim(access_token)
where access_token is not null;

update public.meta_integrations
set user_access_token = btrim(user_access_token)
where user_access_token is not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.meta_integrations'::regclass
      and conname = 'meta_integrations_access_token_vault_check'
  ) then
    alter table public.meta_integrations
      add constraint meta_integrations_access_token_vault_check
      check (
        coalesce(is_connected, false) = false
        or access_token_secret_ref is not null
      ) not valid;
  end if;
end;
$$;

comment on column public.meta_integrations.access_token_secret_ref is
  'Reference to the encrypted Meta Page token in Supabase Vault. The plaintext column is write-only and cleared by trigger.';

comment on column public.meta_integrations.user_access_token is
  'Write-only long-lived Meta user token. Cleared by the Vault trigger before storage.';

comment on column public.meta_integrations.user_access_token_secret_ref is
  'Reference to the encrypted long-lived Meta user token used only for Ads Insights.';

-- The callback portfolio may remain available for a few minutes while the
-- browser asks the backend to connect a selected Page. Its long-lived user
-- token is never stored in JSONB: payload contains only this transient Vault
-- UUID, and every path that removes the reference also removes the secret.
create or replace function private.meta_oauth_flow_transient_secret_id(
  p_payload jsonb
)
returns uuid
language sql
immutable
strict
set search_path = pg_catalog
as $$
  select case
    when jsonb_typeof(p_payload) = 'object'
      and nullif(p_payload->>'user_token_secret_ref', '')
        ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then (p_payload->>'user_token_secret_ref')::uuid
    else null
  end;
$$;

create or replace function private.meta_delete_oauth_flow_transient_secret()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private, vault
as $$
declare
  old_secret_id uuid;
  new_secret_id uuid;
begin
  old_secret_id := private.meta_oauth_flow_transient_secret_id(old.payload);
  if tg_op = 'UPDATE' then
    new_secret_id := private.meta_oauth_flow_transient_secret_id(new.payload);
  end if;

  if old_secret_id is not null
     and old_secret_id is distinct from new_secret_id then
    delete from vault.secrets as secret
    where secret.id = old_secret_id
      and secret.name = 'meta-oauth-flow:' || old.id::text;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function private.meta_oauth_flow_transient_secret_id(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function private.meta_delete_oauth_flow_transient_secret()
  from public, anon, authenticated, service_role;

drop trigger if exists meta_oauth_flow_secret_before_payload_clear
  on public.meta_oauth_flows;
create trigger meta_oauth_flow_secret_before_payload_clear
before update of payload on public.meta_oauth_flows
for each row
execute function private.meta_delete_oauth_flow_transient_secret();

drop trigger if exists meta_oauth_flow_secret_before_delete
  on public.meta_oauth_flows;
create trigger meta_oauth_flow_secret_before_delete
before delete on public.meta_oauth_flows
for each row
execute function private.meta_delete_oauth_flow_transient_secret();

-- Active callbacks from the pre-Vault implementation are intentionally
-- invalidated during cutover instead of retaining their plaintext user token.
update public.meta_oauth_flows as flow
set status = 'error',
    payload = null,
    error_message = 'oauth_flow_reconnect_required',
    updated_at = now()
where jsonb_typeof(flow.payload) = 'object'
  and flow.payload ? 'user_token';

comment on table public.meta_oauth_flows is
  'Short-lived Meta OAuth portfolio metadata. Long-lived user tokens live only in transient Vault secrets; payload stores a non-browser-visible UUID reference.';

create or replace function private.purge_expired_meta_oauth_flows(
  p_now timestamptz default clock_timestamp()
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, private, vault
as $$
declare
  cleared_count integer := 0;
  deleted_count integer := 0;
begin
  with cleared as (
    update public.meta_oauth_flows as flow
    set payload = null,
        status = case
          when flow.status in ('pending', 'success') then 'error'
          else flow.status
        end,
        error_message = case
          when flow.status in ('pending', 'success') then 'oauth_flow_expired'
          else flow.error_message
        end,
        updated_at = p_now
    where flow.expires_at <= p_now
      and flow.payload is not null
    returning 1
  )
  select count(*)::integer into cleared_count from cleared;

  with removed as (
    delete from public.meta_oauth_flows as flow
    where flow.expires_at < p_now - interval '24 hours'
    returning 1
  )
  select count(*)::integer into deleted_count from removed;

  return cleared_count + deleted_count;
end;
$$;

revoke all on function private.purge_expired_meta_oauth_flows(timestamptz)
  from public, anon, authenticated, service_role;

-- OAuth callback payloads contain portfolio metadata and only a transient
-- Vault UUID until the Go backend atomically consumes the flow. Keep both the
-- reference and metadata outside the Data API, including service-role calls;
-- the direct database owner used by the backend retains access.
revoke all on table public.meta_oauth_flows
  from public, anon, authenticated, service_role;

do $schedule_meta_oauth_cleanup$
declare
  existing_job_id bigint;
begin
  if pg_catalog.to_regclass('cron.job') is null
     or pg_catalog.to_regprocedure('cron.schedule(text,text,text)') is null
     or pg_catalog.to_regprocedure('cron.unschedule(bigint)') is null then
    raise exception using
      errcode = '55000',
      message = 'meta_oauth_cleanup_cron_unavailable';
  end if;

  for existing_job_id in
    select job.jobid
    from cron.job as job
    where job.jobname = 'purge-expired-meta-oauth-flows'
  loop
    perform cron.unschedule(existing_job_id);
  end loop;

  perform cron.schedule(
    'purge-expired-meta-oauth-flows',
    '*/5 * * * *',
    'select private.purge_expired_meta_oauth_flows();'
  );
end
$schedule_meta_oauth_cleanup$;

-- Meta connection/configuration/content tables are BFF-only. RLS remains
-- enabled as defense in depth, but browser roles cannot bypass Go module and
-- per-user permission checks through PostgREST.
revoke all on table public.meta_integrations
  from public, anon, authenticated;

-- Outbound Meta sends use a durable client request UUID as a write-ahead
-- reservation. The Go backend commits the reservation before contacting Meta;
-- a retry with the same UUID can therefore return the existing delivery state
-- without calling the provider twice, including after an ambiguous timeout.
alter table public.meta_messages
  add column if not exists client_request_id uuid,
  add column if not exists provider_attempted_at timestamptz,
  add column if not exists completed_at timestamptz,
  add column if not exists delivery_error_code text;

create unique index if not exists uq_meta_messages_conversation_client_request
  on public.meta_messages (conversation_id, client_request_id);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.meta_messages'::regclass
      and conname = 'meta_messages_client_request_outbound_check'
  ) then
    alter table public.meta_messages
      add constraint meta_messages_client_request_outbound_check
      check (
        client_request_id is null
        or coalesce(from_me, false) = true
      ) not valid;
  end if;
end;
$$;

alter table public.meta_messages
  validate constraint meta_messages_client_request_outbound_check;

comment on column public.meta_messages.client_request_id is
  'Frontend-generated UUID that reserves exactly one outbound Meta provider attempt per conversation.';
comment on column public.meta_messages.provider_attempted_at is
  'Set immediately before the backend calls Meta; a pending row with this value may have reached the provider.';
comment on column public.meta_messages.completed_at is
  'Time when the outbound reservation reached a definitive sent or failed state.';
comment on column public.meta_messages.delivery_error_code is
  'Non-sensitive backend delivery classification; never contains a provider token or raw provider response.';

-- Reads continue through the existing tenant RLS policy. Only the trusted Go
-- database connection may create or advance outbound delivery reservations.
alter table public.meta_messages enable row level security;
revoke insert, update, delete, truncate, references, trigger, maintain
  on table public.meta_messages
  from anon, authenticated, service_role;

revoke all on table public.meta_form_configs
  from public, anon, authenticated;
revoke all on table public.meta_conversations
  from public, anon, authenticated;
revoke all on table public.meta_messages
  from public, anon, authenticated;
revoke all on table public.meta_webhook_events
  from public, anon, authenticated;
revoke all on table public.meta_campaign_insights
  from public, anon, authenticated;

-- Table-level revokes do not erase grants made directly on columns.
do $revoke_meta_browser_column_access$
declare
  target_table text;
  selected_columns text;
begin
  foreach target_table in array array[
    'meta_integrations',
    'meta_form_configs',
    'meta_conversations',
    'meta_messages',
    'meta_webhook_events',
    'meta_campaign_insights'
  ]
  loop
    select string_agg(quote_ident(column_row.column_name), ', ')
    into selected_columns
    from information_schema.columns as column_row
    where column_row.table_schema = 'public'
      and column_row.table_name = target_table;

    if selected_columns is not null then
      execute format(
        'revoke select (%s) on table public.%I from public, anon, authenticated',
        selected_columns,
        target_table
      );
    end if;
  end loop;
end
$revoke_meta_browser_column_access$;

create or replace function private.purge_meta_webhook_events(
  p_now timestamptz default clock_timestamp(),
  p_retention interval default interval '30 days'
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  deleted_count integer := 0;
begin
  if p_retention < interval '1 day' then
    raise exception using
      errcode = '22023',
      message = 'meta_webhook_retention_too_short';
  end if;

  delete from public.meta_webhook_events as event
  where coalesce(event.received_at, event.created_at) < p_now - p_retention;
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

revoke all on function private.purge_meta_webhook_events(timestamptz, interval)
  from public, anon, authenticated, service_role;

do $schedule_meta_webhook_retention$
declare
  existing_job_id bigint;
begin
  if pg_catalog.to_regclass('cron.job') is null
     or pg_catalog.to_regprocedure('cron.schedule(text,text,text)') is null
     or pg_catalog.to_regprocedure('cron.unschedule(bigint)') is null then
    raise exception using
      errcode = '55000',
      message = 'meta_webhook_retention_cron_unavailable';
  end if;

  for existing_job_id in
    select job.jobid
    from cron.job as job
    where job.jobname = 'purge-meta-webhook-events'
  loop
    perform cron.unschedule(existing_job_id);
  end loop;

  perform cron.schedule(
    'purge-meta-webhook-events',
    '23 3 * * *',
    'select private.purge_meta_webhook_events();'
  );
end
$schedule_meta_webhook_retention$;

do $$
begin
  if exists (
    select 1
    from pg_constraint as constraint_row
    where constraint_row.conrelid = 'public.meta_integrations'::regclass
      and constraint_row.conname =
        'meta_integrations_id_organization_unique'
      and not (
        constraint_row.contype = 'u'
        and (
          select array_agg(
            attribute.attname::text
            order by key.ordinality
          )
          from unnest(constraint_row.conkey) with ordinality
            as key(attnum, ordinality)
          join pg_attribute as attribute
            on attribute.attrelid = constraint_row.conrelid
           and attribute.attnum = key.attnum
        ) = array['id', 'organization_id']::text[]
      )
  ) then
    alter table public.meta_integrations
      drop constraint meta_integrations_id_organization_unique;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.meta_integrations'::regclass
      and conname = 'meta_integrations_id_organization_unique'
  ) then
    alter table public.meta_integrations
      add constraint meta_integrations_id_organization_unique
      unique (id, organization_id);
  end if;
end;
$$;

-- Webhook payloads carry only provider asset ids, not an organization id. A
-- connected Page/Instagram account therefore has exactly one tenant owner;
-- otherwise routing must fail closed and lead delivery would stop for both.
do $validate_meta_asset_ownership$
declare
  duplicate_page_count bigint := 0;
  duplicate_instagram_count bigint := 0;
begin
  select count(*)
  into duplicate_page_count
  from (
    select btrim(page_id)
    from public.meta_integrations
    where coalesce(is_connected, false) = true
      and nullif(btrim(page_id), '') is not null
    group by btrim(page_id)
    having count(*) > 1
  ) as duplicate_page;

  select count(*)
  into duplicate_instagram_count
  from (
    select btrim(instagram_business_account_id)
    from public.meta_integrations
    where coalesce(is_connected, false) = true
      and nullif(btrim(instagram_business_account_id), '') is not null
    group by btrim(instagram_business_account_id)
    having count(*) > 1
  ) as duplicate_instagram;

  if duplicate_page_count > 0 or duplicate_instagram_count > 0 then
    raise exception using
      errcode = '23505',
      message = 'meta_connected_asset_has_multiple_tenant_owners',
      detail = format(
        '%s duplicate Page id(s), %s duplicate Instagram account id(s).',
        duplicate_page_count,
        duplicate_instagram_count
      ),
      hint = 'Disconnect the duplicate tenant rows before applying this migration.';
  end if;
end
$validate_meta_asset_ownership$;

create unique index if not exists uq_meta_integrations_connected_page_owner
  on public.meta_integrations (btrim(page_id))
  where coalesce(is_connected, false) = true
    and nullif(btrim(page_id), '') is not null;

create unique index if not exists uq_meta_integrations_connected_instagram_owner
  on public.meta_integrations (btrim(instagram_business_account_id))
  where coalesce(is_connected, false) = true
    and nullif(btrim(instagram_business_account_id), '') is not null;

create table if not exists public.marketing_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  integration_id uuid,
  provider text not null,
  external_account_id text not null,
  name text,
  currency text,
  timezone_name text,
  account_status text,
  is_active boolean not null default true,
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint marketing_accounts_provider_check
    check (provider in ('meta', 'google', 'tiktok', 'linkedin')),
  constraint marketing_accounts_external_id_check
    check (length(btrim(external_account_id)) > 0),
  constraint marketing_accounts_org_provider_external_unique
    unique (organization_id, provider, external_account_id),
  constraint marketing_accounts_integration_organization_fkey
    foreign key (integration_id, organization_id)
    references public.meta_integrations(id, organization_id)
    on delete set null (integration_id)
);

create table if not exists public.marketing_performance_daily (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  integration_id uuid,
  provider text not null,
  external_account_id text not null,
  level text not null,
  entity_id text not null,
  metric_date date not null,
  campaign_id text,
  campaign_name text,
  adset_id text,
  adset_name text,
  ad_id text,
  ad_name text,
  status text,
  objective text,
  optimization_goal text,
  buying_type text,
  budget numeric(16, 4),
  budget_type text,
  currency text,
  timezone_name text,
  spend numeric(16, 4) not null default 0,
  impressions bigint not null default 0,
  reach bigint not null default 0,
  clicks bigint not null default 0,
  link_clicks bigint not null default 0,
  leads_reported bigint not null default 0,
  conversations_reported bigint not null default 0,
  conversions_reported bigint not null default 0,
  video_views bigint not null default 0,
  video_three_second_views bigint not null default 0,
  video_thruplays bigint not null default 0,
  ctr numeric(16, 6),
  cpc numeric(16, 6),
  cpm numeric(16, 6),
  cpl numeric(16, 6),
  frequency numeric(16, 6),
  hook_rate numeric(16, 6),
  creative_id text,
  creative_url text,
  creative_video_url text,
  creative_permalink_url text,
  thumbnail_url text,
  raw_actions jsonb not null default '{}'::jsonb,
  fetched_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint marketing_performance_provider_check
    check (provider in ('meta', 'google', 'tiktok', 'linkedin')),
  constraint marketing_performance_level_check
    check (level in ('account', 'campaign', 'adset', 'ad')),
  constraint marketing_performance_entity_id_check
    check (length(btrim(entity_id)) > 0),
  constraint marketing_performance_nonnegative_check
    check (
      spend >= 0
      and impressions >= 0
      and reach >= 0
      and clicks >= 0
      and link_clicks >= 0
      and leads_reported >= 0
      and conversations_reported >= 0
      and conversions_reported >= 0
      and video_views >= 0
      and video_three_second_views >= 0
      and video_thruplays >= 0
    ),
  constraint marketing_performance_daily_unique
    unique (
      organization_id,
      provider,
      external_account_id,
      level,
      entity_id,
      metric_date
    ),
  constraint marketing_performance_daily_integration_organization_fkey
    foreign key (integration_id, organization_id)
    references public.meta_integrations(id, organization_id)
    on delete set null (integration_id)
);

create table if not exists public.marketing_social_daily (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  integration_id uuid,
  provider text not null,
  profile_id text not null,
  profile_name text,
  metric_date date not null,
  -- A profile endpoint exposes the current follower snapshot, not a truthful
  -- historical series. NULL means that no snapshot is known for that day;
  -- storing zero would fabricate a drop to zero on historical syncs.
  followers bigint,
  follower_growth bigint not null default 0,
  posts bigint not null default 0,
  impressions bigint not null default 0,
  reach bigint not null default 0,
  interactions bigint not null default 0,
  likes bigint not null default 0,
  comments bigint not null default 0,
  saves bigint not null default 0,
  shares bigint not null default 0,
  profile_views bigint not null default 0,
  website_clicks bigint not null default 0,
  video_views bigint not null default 0,
  raw_metrics jsonb not null default '{}'::jsonb,
  fetched_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint marketing_social_provider_check
    check (provider in ('instagram', 'facebook', 'tiktok', 'linkedin')),
  constraint marketing_social_profile_id_check
    check (length(btrim(profile_id)) > 0),
  constraint marketing_social_daily_unique
    unique (organization_id, provider, profile_id, metric_date),
  constraint marketing_social_daily_integration_organization_fkey
    foreign key (integration_id, organization_id)
    references public.meta_integrations(id, organization_id)
    on delete set null (integration_id)
);

create table if not exists public.marketing_media_assets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  integration_id uuid,
  provider text not null,
  external_account_id text,
  external_media_id text not null,
  source_kind text not null,
  media_type text,
  title text,
  caption text,
  campaign_id text,
  campaign_name text,
  adset_id text,
  adset_name text,
  ad_id text,
  ad_name text,
  creative_id text,
  thumbnail_url text,
  media_url text,
  video_url text,
  permalink_url text,
  published_at timestamptz,
  metrics jsonb not null default '{}'::jsonb,
  raw_metadata jsonb not null default '{}'::jsonb,
  last_synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint marketing_media_provider_check
    check (provider in ('meta', 'instagram', 'facebook', 'google', 'tiktok', 'linkedin')),
  constraint marketing_media_source_kind_check
    check (source_kind in ('paid', 'organic')),
  constraint marketing_media_external_id_check
    check (length(btrim(external_media_id)) > 0),
  constraint marketing_media_asset_unique
    unique (organization_id, provider, external_media_id),
  constraint marketing_media_assets_integration_organization_fkey
    foreign key (integration_id, organization_id)
    references public.meta_integrations(id, organization_id)
    on delete set null (integration_id)
);

create table if not exists public.marketing_sync_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  integration_id uuid,
  provider text not null,
  status text not null default 'running',
  date_from date,
  date_to date,
  rows_synced integer not null default 0,
  media_synced integer not null default 0,
  social_rows_synced integer not null default 0,
  error_code text,
  error_message text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint marketing_sync_runs_provider_check
    check (provider in ('meta', 'instagram', 'facebook', 'google', 'tiktok', 'linkedin')),
  constraint marketing_sync_runs_status_check
    check (status in ('running', 'succeeded', 'partial', 'failed')),
  constraint marketing_sync_runs_integration_organization_fkey
    foreign key (integration_id, organization_id)
    references public.meta_integrations(id, organization_id)
    on delete set null (integration_id)
);

-- Upgrade installations where this migration was applied before the
-- organization-scoped foreign keys were introduced. Cross-tenant legacy
-- references are detached before the canonical constraints are validated.
do $$
declare
  target record;
  foreign_key record;
  target_relation regclass;
begin
  for target in
    select *
    from (
      values
        (
          'marketing_accounts',
          'marketing_accounts_integration_organization_fkey'
        ),
        (
          'marketing_performance_daily',
          'marketing_performance_daily_integration_organization_fkey'
        ),
        (
          'marketing_social_daily',
          'marketing_social_daily_integration_organization_fkey'
        ),
        (
          'marketing_media_assets',
          'marketing_media_assets_integration_organization_fkey'
        ),
        (
          'marketing_sync_runs',
          'marketing_sync_runs_integration_organization_fkey'
        )
    ) as targets(table_name, constraint_name)
  loop
    target_relation := to_regclass(format('public.%I', target.table_name));
    if target_relation is null then
      continue;
    end if;

    -- Replace every tenant-blind or stale Meta integration relationship. This
    -- also makes re-running the SQL converge on one canonical FK definition.
    for foreign_key in
      select constraint_row.conname
      from pg_constraint as constraint_row
      where constraint_row.conrelid = target_relation
        and constraint_row.confrelid = 'public.meta_integrations'::regclass
        and constraint_row.contype = 'f'
        and exists (
          select 1
          from unnest(constraint_row.conkey) as key(attnum)
          join pg_attribute as attribute
            on attribute.attrelid = constraint_row.conrelid
           and attribute.attnum = key.attnum
          where attribute.attrelid = constraint_row.conrelid
            and attribute.attname = 'integration_id'
        )
    loop
      execute format(
        'alter table public.%I drop constraint %I',
        target.table_name,
        foreign_key.conname
      );
    end loop;

    execute format(
      $cleanup$
        update public.%1$I as marketing_row
        set integration_id = null
        where marketing_row.integration_id is not null
          and not exists (
            select 1
            from public.meta_integrations as integration
            where integration.id = marketing_row.integration_id
              and integration.organization_id = marketing_row.organization_id
          )
      $cleanup$,
      target.table_name
    );

    execute format(
      $constraint$
        alter table public.%1$I
        add constraint %2$I
        foreign key (integration_id, organization_id)
        references public.meta_integrations(id, organization_id)
        on delete set null (integration_id)
        not valid
      $constraint$,
      target.table_name,
      target.constraint_name
    );

    execute format(
      'alter table public.%I validate constraint %I',
      target.table_name,
      target.constraint_name
    );
  end loop;
end;
$$;

create index if not exists marketing_accounts_org_provider_idx
  on public.marketing_accounts (organization_id, provider, is_active);

create index if not exists marketing_performance_org_date_idx
  on public.marketing_performance_daily (organization_id, metric_date desc);

create index if not exists marketing_performance_campaign_idx
  on public.marketing_performance_daily (
    organization_id,
    campaign_id,
    metric_date desc
  )
  where campaign_id is not null;

create index if not exists marketing_performance_adset_idx
  on public.marketing_performance_daily (
    organization_id,
    adset_id,
    metric_date desc
  )
  where adset_id is not null;

create index if not exists marketing_performance_ad_idx
  on public.marketing_performance_daily (
    organization_id,
    ad_id,
    metric_date desc
  )
  where ad_id is not null;

create index if not exists marketing_social_org_date_idx
  on public.marketing_social_daily (organization_id, metric_date desc);

create index if not exists marketing_media_org_published_idx
  on public.marketing_media_assets (organization_id, published_at desc);

create index if not exists marketing_media_campaign_idx
  on public.marketing_media_assets (organization_id, campaign_id)
  where campaign_id is not null;

create index if not exists marketing_sync_runs_org_started_idx
  on public.marketing_sync_runs (organization_id, started_at desc);

alter table public.marketing_accounts enable row level security;
alter table public.marketing_performance_daily enable row level security;
alter table public.marketing_social_daily enable row level security;
alter table public.marketing_media_assets enable row level security;
alter table public.marketing_sync_runs enable row level security;

drop policy if exists "organization members read marketing accounts"
  on public.marketing_accounts;

drop policy if exists "organization members read marketing performance"
  on public.marketing_performance_daily;

drop policy if exists "organization members read marketing social"
  on public.marketing_social_daily;

drop policy if exists "organization members read marketing media"
  on public.marketing_media_assets;

drop policy if exists "organization members read marketing sync runs"
  on public.marketing_sync_runs;

-- Marketing analytics is served by the permission-checked BFF. Browser roles
-- receive neither Data API privileges nor RLS policies on these raw facts.
revoke all on table public.marketing_accounts
  from public, anon, authenticated;
revoke all on table public.marketing_performance_daily
  from public, anon, authenticated;
revoke all on table public.marketing_social_daily
  from public, anon, authenticated;
revoke all on table public.marketing_media_assets
  from public, anon, authenticated;
revoke all on table public.marketing_sync_runs
  from public, anon, authenticated;

-- A table-level REVOKE does not erase grants made on individual columns.
-- Remove legacy column SELECT grants as well so authenticated users cannot
-- bypass the Go DashboardCampaignsView authorization via PostgREST.
do $$
declare
  target_table text;
  selected_columns text;
begin
  foreach target_table in array array[
    'marketing_accounts',
    'marketing_performance_daily',
    'marketing_social_daily',
    'marketing_media_assets',
    'marketing_sync_runs'
  ]
  loop
    select string_agg(quote_ident(column_row.column_name), ', ')
    into selected_columns
    from information_schema.columns as column_row
    where column_row.table_schema = 'public'
      and column_row.table_name = target_table;

    if selected_columns is not null then
      execute format(
        'revoke select (%s) on table public.%I from public, anon, authenticated, service_role',
        selected_columns,
        target_table
      );
    end if;
  end loop;
end;
$$;

-- The canonical Go backend uses a trusted direct Postgres connection. The raw
-- facts do not need a second write path through PostgREST/service_role.
revoke all on table public.marketing_accounts from service_role;
revoke all on table public.marketing_performance_daily from service_role;
revoke all on table public.marketing_social_daily from service_role;
revoke all on table public.marketing_media_assets from service_role;
revoke all on table public.marketing_sync_runs from service_role;

drop function if exists public.meta_marketing_sync_targets(uuid);
drop function if exists private.meta_marketing_sync_targets(uuid);

-- A Page-scoped external sender id is not globally unique across tenants or
-- channels. The backend derives the organization from the signed webhook and
-- must be able to upsert the same sender independently for Messenger and
-- Instagram without either colliding with another organization or silently
-- attaching to its conversation.
drop index if exists public.uq_meta_conversations_page_external;

create unique index if not exists uq_meta_conversations_tenant_channel_external
  on public.meta_conversations (
    organization_id,
    platform,
    page_id,
    external_id
  )
  where organization_id is not null
    and platform is not null
    and page_id is not null
    and external_id is not null;
