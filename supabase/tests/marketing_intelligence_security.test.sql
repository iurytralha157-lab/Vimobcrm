begin;

create extension if not exists pgtap with schema extensions;
select plan(55);

select is(
  (
    select count(*)
    from unnest(array[
      'marketing_accounts',
      'marketing_performance_daily',
      'marketing_social_daily',
      'marketing_media_assets',
      'marketing_sync_runs'
    ]) as expected(table_name)
    where to_regclass(format('public.%I', expected.table_name)) is not null
  ),
  5::bigint,
  'all Marketing intelligence tables exist'
);

select is(
  (
    select count(*)
    from pg_class as relation
    join pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = any(array[
        'marketing_accounts',
        'marketing_performance_daily',
        'marketing_social_daily',
        'marketing_media_assets',
        'marketing_sync_runs'
      ])
      and relation.relrowsecurity
  ),
  5::bigint,
  'RLS is enabled on every Marketing intelligence table'
);

select is(
  (
    select count(*)
    from pg_policies as policy
    where policy.schemaname = 'public'
      and policy.tablename = any(array[
        'marketing_accounts',
        'marketing_performance_daily',
        'marketing_social_daily',
        'marketing_media_assets',
        'marketing_sync_runs'
      ])
  ),
  0::bigint,
  'raw Marketing intelligence tables expose no Data API policy'
);

select ok(
  (
    select bool_and(
      not has_table_privilege(
        'anon',
        format('public.%I', target.table_name),
        privilege.name
      )
    )
    from unnest(array[
      'marketing_accounts',
      'marketing_performance_daily',
      'marketing_social_daily',
      'marketing_media_assets',
      'marketing_sync_runs'
    ]) as target(table_name)
    cross join unnest(array[
      'select',
      'insert',
      'update',
      'delete',
      'truncate',
      'references',
      'trigger'
    ]) as privilege(name)
  ),
  'anonymous clients have no Marketing table privilege'
);

select ok(
  (
    select bool_and(
      not has_table_privilege(
        'authenticated',
        format('public.%I', target.table_name),
        privilege.name
      )
    )
    from unnest(array[
      'marketing_accounts',
      'marketing_performance_daily',
      'marketing_social_daily',
      'marketing_media_assets',
      'marketing_sync_runs'
    ]) as target(table_name)
    cross join unnest(array[
      'select',
      'insert',
      'update',
      'delete',
      'truncate',
      'references',
      'trigger'
    ]) as privilege(name)
  ),
  'authenticated clients have no Marketing table privilege'
);

select ok(
  (
    select bool_and(
      not has_table_privilege(
        'service_role',
        format('public.%I', target.table_name),
        privilege.name
      )
    )
    from unnest(array[
      'marketing_accounts',
      'marketing_performance_daily',
      'marketing_social_daily',
      'marketing_media_assets',
      'marketing_sync_runs'
    ]) as target(table_name)
    cross join unnest(array[
      'select',
      'insert',
      'update',
      'delete'
    ]) as privilege(name)
  ),
  'service role cannot bypass the canonical Go backend for Marketing intelligence'
);

select is(
  (
    select count(*)
    from information_schema.column_privileges as privilege
    where privilege.table_schema = 'public'
      and privilege.table_name = any(array[
        'marketing_accounts',
        'marketing_performance_daily',
        'marketing_social_daily',
        'marketing_media_assets',
        'marketing_sync_runs'
      ])
      and privilege.grantee = any(array[
        'PUBLIC',
        'anon',
        'authenticated',
        'service_role'
      ])
      and privilege.privilege_type = 'SELECT'
  ),
  0::bigint,
  'Data API roles retain no column-level Marketing SELECT bypass'
);

select is(
  (
    select column_row.udt_name
    from information_schema.columns as column_row
    where column_row.table_schema = 'public'
      and column_row.table_name = 'meta_integrations'
      and column_row.column_name = 'access_token_secret_ref'
  ),
  'uuid',
  'Meta Vault references use the UUID type'
);

select is(
  (
    select column_row.udt_name
    from information_schema.columns as column_row
    where column_row.table_schema = 'public'
      and column_row.table_name = 'meta_integrations'
      and column_row.column_name = 'user_access_token_secret_ref'
  ),
  'uuid',
  'Meta Ads user-token Vault references use the UUID type'
);

select is(
  (
    select count(*)
    from information_schema.columns as column_row
    where column_row.table_schema = 'public'
      and column_row.table_name = 'meta_integrations'
      and (
        (
          column_row.column_name = 'granted_scopes'
          and column_row.udt_name = '_text'
          and column_row.is_nullable = 'NO'
        )
        or (
          column_row.column_name = 'subscribed_fields'
          and column_row.udt_name = 'jsonb'
          and column_row.is_nullable = 'NO'
        )
        or (
          column_row.column_name = 'subscription_reconciled_at'
          and column_row.udt_name = 'timestamptz'
        )
      )
  ),
  3::bigint,
  'Meta connection capabilities and provider subscription state are durable'
);

select is(
  (
    select count(*)
    from information_schema.columns as column_row
    where column_row.table_schema = 'public'
      and column_row.table_name = 'meta_integrations_public'
      and column_row.column_name = any(array[
        'granted_scopes',
        'subscribed_fields',
        'subscription_reconciled_at'
      ])
  ),
  0::bigint,
  'Meta capability internals are absent from the browser-facing projection'
);

select is(
  private.meta_legacy_plaintext_token('  plain:  legacy-token  '),
  'legacy-token',
  'literal plain references are trimmed and recovered'
);

select is(
  private.meta_legacy_plaintext_token('PLAIN:must-not-migrate'),
  null::text,
  'the legacy plaintext marker is case-sensitive and literal'
);

create temporary table pgtap_marketing_vault_fixture (
  fixture_name text primary key,
  secret_id uuid not null
);

insert into pgtap_marketing_vault_fixture (fixture_name, secret_id)
values (
  'existing-secret',
  vault.create_secret('pgtap-existing-vault-token')
);

select is(
  private.meta_legacy_vault_secret_id(
    '  ' || (
      select secret_id::text
      from pgtap_marketing_vault_fixture
      where fixture_name = 'existing-secret'
    ) || '  '
  ),
  (
    select secret_id
    from pgtap_marketing_vault_fixture
    where fixture_name = 'existing-secret'
  ),
  'only an existing, trimmed Vault UUID reference is retained'
);

select is(
  private.meta_legacy_vault_secret_id(
    'ffffffff-ffff-ffff-ffff-ffffffffffff'
  ),
  null::uuid,
  'a UUID-shaped value without a Vault row is rejected'
);

select is(
  private.meta_legacy_vault_secret_id('arbitrary-invalid-value'),
  null::uuid,
  'the classifier refuses an invalid non-plain reference'
);

select is(
  (
    select count(*)
    from public.meta_integrations as integration
    where integration.access_token is not null
  ),
  0::bigint,
  'Meta plaintext access-token storage is always null after Vault migration'
);

select is(
  (
    select count(*)
    from public.meta_integrations as integration
    where integration.user_access_token is not null
  ),
  0::bigint,
  'Meta plaintext user-token storage is always null after Vault migration'
);

select ok(
  not has_function_privilege(
    'anon',
    'private.meta_legacy_plaintext_token(text)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'private.meta_legacy_plaintext_token(text)',
    'execute'
  )
  and not has_function_privilege(
    'service_role',
    'private.meta_legacy_plaintext_token(text)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'private.meta_legacy_vault_secret_id(text)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'private.meta_legacy_vault_secret_id(text)',
    'execute'
  )
  and not has_function_privilege(
    'service_role',
    'private.meta_legacy_vault_secret_id(text)',
    'execute'
  ),
  'Data API roles cannot invoke legacy credential classifiers'
);

create temporary table pgtap_meta_integration_fixture (
  integration_id uuid primary key,
  page_secret_id uuid,
  user_secret_id uuid
);

alter table public.meta_integrations
  disable trigger meta_store_access_token_before_write;
alter table public.meta_integrations
  disable trigger meta_store_user_access_token_before_write;

with fixture_organization as (
  insert into public.organizations (name)
  values ('pgTAP Marketing Vault fixture')
  returning id
), fixture_integration as (
  insert into public.meta_integrations (
    organization_id,
    page_id,
    page_name,
    access_token,
    user_access_token,
    is_connected
  )
  select
    fixture_organization.id,
    'pgtap-marketing-page-' || fixture_organization.id::text,
    'pgTAP Marketing page',
    '  pgtap-page-token  ',
    '  pgtap-user-token  ',
    false
  from fixture_organization
  returning id
)
insert into pgtap_meta_integration_fixture (
  integration_id
)
select id
from fixture_integration;

alter table public.meta_integrations
  enable trigger meta_store_access_token_before_write;
alter table public.meta_integrations
  enable trigger meta_store_user_access_token_before_write;

-- Reproduce the migration's normalization of the production-era plaintext
-- columns. This is the compatibility path used by the 17 known legacy rows.
update public.meta_integrations as integration
set access_token = btrim(integration.access_token),
    user_access_token = btrim(integration.user_access_token)
from pgtap_meta_integration_fixture as fixture
where integration.id = fixture.integration_id;

update pgtap_meta_integration_fixture as fixture
set page_secret_id = integration.access_token_secret_ref,
    user_secret_id = integration.user_access_token_secret_ref
from public.meta_integrations as integration
where integration.id = fixture.integration_id;

update public.meta_integrations as integration
set access_token = '   ',
    user_access_token = '   '
from pgtap_meta_integration_fixture as fixture
where integration.id = fixture.integration_id;

select ok(
  (
    select integration.access_token is null
      and integration.user_access_token is null
      and integration.access_token_secret_ref = fixture.page_secret_id
      and integration.user_access_token_secret_ref = fixture.user_secret_id
    from public.meta_integrations as integration
    join pgtap_meta_integration_fixture as fixture
      on fixture.integration_id = integration.id
  ),
  'blank credential writes clear plaintext and cannot replace Vault references'
);

select is(
  (
    select jsonb_build_object(
      'page', page_secret.decrypted_secret,
      'user', user_secret.decrypted_secret
    )
    from pgtap_meta_integration_fixture as fixture
    join vault.decrypted_secrets as page_secret
      on page_secret.id = fixture.page_secret_id
    join vault.decrypted_secrets as user_secret
      on user_secret.id = fixture.user_secret_id
  ),
  jsonb_build_object(
    'page', 'pgtap-page-token',
    'user', 'pgtap-user-token'
  ),
  'Vault stores btrim-normalized Page and user credentials'
);

create temporary table pgtap_meta_multi_page_fixture (
  integration_id uuid primary key,
  user_secret_id uuid not null
);

with fixture_organization as (
  insert into public.organizations (name)
  values ('pgTAP Meta multi-page fixture')
  returning id
), inserted as (
  insert into public.meta_integrations (
    organization_id,
    page_id,
    page_name,
    facebook_user_id,
    access_token,
    user_access_token,
    is_connected
  )
  select
    fixture_organization.id,
    page.page_id,
    page.page_name,
    'shared-facebook-user',
    'page-token-' || page.page_id,
    'shared-user-token',
    false
  from fixture_organization
  cross join (
    values
      ('pgtap-page-a', 'pgTAP page A'),
      ('pgtap-page-b', 'pgTAP page B')
  ) as page(page_id, page_name)
  returning id, user_access_token_secret_ref
)
insert into pgtap_meta_multi_page_fixture (
  integration_id,
  user_secret_id
)
select id, user_access_token_secret_ref
from inserted;

select is(
  (
    select count(distinct fixture.user_secret_id)
    from pgtap_meta_multi_page_fixture as fixture
    join vault.decrypted_secrets as secret
      on secret.id = fixture.user_secret_id
    where secret.name like 'meta-user:%:shared-facebook-user:pgtap-page-%'
      and secret.decrypted_secret = 'shared-user-token'
  ),
  2::bigint,
  'one Meta user can connect multiple pages with distinct Vault secret names'
);

select ok(
  exists (
    select 1
    from pg_trigger as trigger_row
    where trigger_row.tgrelid = 'public.meta_integrations'::regclass
      and trigger_row.tgname = 'meta_store_user_access_token_before_write'
      and not trigger_row.tgisinternal
      and trigger_row.tgenabled <> 'D'
  ),
  'Meta Ads user tokens are protected by an enabled Vault trigger'
);

select ok(
  to_regprocedure(
    'private.meta_oauth_flow_transient_secret_id(jsonb)'
  ) is not null,
  'Meta OAuth transient Vault references have a strict parser'
);

select is(
  (
    select count(*)
    from pg_trigger as trigger_row
    where trigger_row.tgrelid = 'public.meta_oauth_flows'::regclass
      and trigger_row.tgname in (
        'meta_oauth_flow_secret_before_payload_clear',
        'meta_oauth_flow_secret_before_delete'
      )
      and not trigger_row.tgisinternal
      and trigger_row.tgenabled <> 'D'
  ),
  2::bigint,
  'Meta OAuth flow cleanup guards both payload clearing and row deletion'
);

select is(
  (
    select count(*)
    from public.meta_oauth_flows as flow
    where jsonb_typeof(flow.payload) = 'object'
      and flow.payload ? 'user_token'
  ),
  0::bigint,
  'Meta OAuth flow JSONB never retains a plaintext user token'
);

create temporary table pgtap_meta_oauth_flow_secret_fixture (
  id uuid primary key,
  secret_id uuid not null,
  payload jsonb
);

with fixture as (
  select gen_random_uuid() as flow_id
), secret as (
  select
    fixture.flow_id,
    vault.create_secret(
      'pgtap-transient-oauth-token',
      'meta-oauth-flow:' || fixture.flow_id::text,
      'pgTAP transient OAuth cleanup fixture'
    ) as secret_id
  from fixture
)
insert into pgtap_meta_oauth_flow_secret_fixture (
  id,
  secret_id,
  payload
)
select
  secret.flow_id,
  secret.secret_id,
  jsonb_build_object(
    'success', true,
    'user_token_secret_ref', secret.secret_id::text
  )
from secret;

create trigger pgtap_meta_oauth_flow_secret_before_payload_clear
before update of payload on pgtap_meta_oauth_flow_secret_fixture
for each row
execute function private.meta_delete_oauth_flow_transient_secret();

update pgtap_meta_oauth_flow_secret_fixture
set payload = null;

select ok(
  (
    select fixture.payload is null
      and not exists (
        select 1
        from vault.secrets as secret
        where secret.id = fixture.secret_id
      )
    from pgtap_meta_oauth_flow_secret_fixture as fixture
  ),
  'clearing an OAuth flow payload atomically deletes its transient Vault secret'
);

select ok(
  not has_function_privilege(
    'anon',
    'private.meta_oauth_flow_transient_secret_id(jsonb)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'private.meta_oauth_flow_transient_secret_id(jsonb)',
    'execute'
  )
  and not has_function_privilege(
    'service_role',
    'private.meta_oauth_flow_transient_secret_id(jsonb)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'private.meta_delete_oauth_flow_transient_secret()',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'private.meta_delete_oauth_flow_transient_secret()',
    'execute'
  )
  and not has_function_privilege(
    'service_role',
    'private.meta_delete_oauth_flow_transient_secret()',
    'execute'
  ),
  'Data API roles cannot resolve or delete transient OAuth secrets'
);

select ok(
  to_regprocedure(
    'private.purge_expired_meta_oauth_flows(timestamptz)'
  ) is not null,
  'expired Meta OAuth payload cleanup exists'
);

select ok(
  not has_function_privilege(
    'anon',
    'private.purge_expired_meta_oauth_flows(timestamptz)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'private.purge_expired_meta_oauth_flows(timestamptz)',
    'execute'
  )
  and not has_function_privilege(
    'service_role',
    'private.purge_expired_meta_oauth_flows(timestamptz)',
    'execute'
  ),
  'browser and service roles cannot invoke OAuth payload cleanup'
);

select ok(
  (
    select bool_and(
      not has_table_privilege(
        role_name,
        'public.meta_oauth_flows',
        privilege_name
      )
    )
    from unnest(array['anon', 'authenticated', 'service_role'])
      as role(role_name)
    cross join unnest(array[
      'select',
      'insert',
      'update',
      'delete',
      'truncate',
      'references',
      'trigger'
    ]) as privilege(privilege_name)
  ),
  'OAuth payloads are inaccessible through every Data API role'
);

select is(
  (
    select count(*)
    from cron.job as job
    where job.jobname = 'purge-expired-meta-oauth-flows'
      and job.schedule = '*/5 * * * *'
  ),
  1::bigint,
  'expired Meta OAuth payload cleanup is scheduled every five minutes'
);

select ok(
  exists (
    select 1
    from pg_constraint as constraint_row
    where constraint_row.conrelid = 'public.meta_integrations'::regclass
      and constraint_row.conname =
        'meta_integrations_id_organization_unique'
      and constraint_row.contype = 'u'
      and (
        select array_agg(attribute.attname::text order by key.ordinality)
        from unnest(constraint_row.conkey) with ordinality
          as key(attnum, ordinality)
        join pg_attribute as attribute
          on attribute.attrelid = constraint_row.conrelid
         and attribute.attnum = key.attnum
      ) = array['id', 'organization_id']::text[]
  ),
  'Meta integrations expose the composite tenant key'
);

select is(
  (
    select count(*)
    from pg_constraint as constraint_row
    where constraint_row.conrelid = any(array[
        'public.marketing_accounts'::regclass,
        'public.marketing_performance_daily'::regclass,
        'public.marketing_social_daily'::regclass,
        'public.marketing_media_assets'::regclass,
        'public.marketing_sync_runs'::regclass
      ])
      and constraint_row.confrelid =
        'public.meta_integrations'::regclass
      and constraint_row.contype = 'f'
      and (
        select array_agg(attribute.attname::text order by key.ordinality)
        from unnest(constraint_row.conkey) with ordinality
          as key(attnum, ordinality)
        join pg_attribute as attribute
          on attribute.attrelid = constraint_row.conrelid
         and attribute.attnum = key.attnum
      ) = array['integration_id', 'organization_id']::text[]
      and (
        select array_agg(attribute.attname::text order by key.ordinality)
        from unnest(constraint_row.confkey) with ordinality
          as key(attnum, ordinality)
        join pg_attribute as attribute
          on attribute.attrelid = constraint_row.confrelid
         and attribute.attnum = key.attnum
      ) = array['id', 'organization_id']::text[]
  ),
  5::bigint,
  'every Marketing integration reference is tenant-scoped'
);

select is(
  (
    select count(*)
    from pg_constraint as constraint_row
    where constraint_row.conrelid = any(array[
        'public.marketing_accounts'::regclass,
        'public.marketing_performance_daily'::regclass,
        'public.marketing_social_daily'::regclass,
        'public.marketing_media_assets'::regclass,
        'public.marketing_sync_runs'::regclass
      ])
      and constraint_row.confrelid =
        'public.meta_integrations'::regclass
      and constraint_row.contype = 'f'
      and constraint_row.convalidated
      and (
        select array_agg(attribute.attname::text order by key.ordinality)
        from unnest(constraint_row.conkey) with ordinality
          as key(attnum, ordinality)
        join pg_attribute as attribute
          on attribute.attrelid = constraint_row.conrelid
         and attribute.attnum = key.attnum
      ) = array['integration_id', 'organization_id']::text[]
  ),
  5::bigint,
  'every tenant-scoped Marketing integration foreign key is validated'
);

select is(
  (
    select count(*)
    from pg_constraint as constraint_row
    where constraint_row.conrelid = any(array[
        'public.marketing_accounts'::regclass,
        'public.marketing_performance_daily'::regclass,
        'public.marketing_social_daily'::regclass,
        'public.marketing_media_assets'::regclass,
        'public.marketing_sync_runs'::regclass
      ])
      and constraint_row.confrelid =
        'public.meta_integrations'::regclass
      and constraint_row.contype = 'f'
      and cardinality(constraint_row.conkey) = 1
  ),
  0::bigint,
  'no Marketing table retains a tenant-blind integration foreign key'
);

select is(
  (
    select count(*)
    from information_schema.columns as column_row
    where column_row.table_schema = 'public'
      and column_row.table_name = any(array[
        'marketing_accounts',
        'marketing_performance_daily',
        'marketing_social_daily',
        'marketing_media_assets',
        'marketing_sync_runs'
      ])
      and column_row.column_name = 'integration_id'
      and column_row.is_nullable = 'YES'
  ),
  5::bigint,
  'Marketing integration references remain nullable for safe disconnects'
);

select is(
  (
    select count(*)
    from pg_constraint as constraint_row
    where constraint_row.conrelid = any(array[
        'public.marketing_accounts'::regclass,
        'public.marketing_performance_daily'::regclass,
        'public.marketing_social_daily'::regclass,
        'public.marketing_media_assets'::regclass,
        'public.marketing_sync_runs'::regclass
      ])
      and constraint_row.confrelid =
        'public.meta_integrations'::regclass
      and constraint_row.contype = 'f'
      and constraint_row.confdeltype = 'n'
  ),
  5::bigint,
  'deleting a Meta integration nulls its Marketing references'
);

select is(
  (
    select count(*)
    from pg_constraint as constraint_row
    where constraint_row.conrelid = any(array[
        'public.marketing_accounts'::regclass,
        'public.marketing_performance_daily'::regclass,
        'public.marketing_social_daily'::regclass,
        'public.marketing_media_assets'::regclass,
        'public.marketing_sync_runs'::regclass
      ])
      and constraint_row.confrelid =
        'public.meta_integrations'::regclass
      and constraint_row.contype = 'f'
      and (
        select array_agg(attribute.attname::text order by key.ordinality)
        from unnest(constraint_row.confdelsetcols) with ordinality
          as key(attnum, ordinality)
        join pg_attribute as attribute
          on attribute.attrelid = constraint_row.conrelid
         and attribute.attnum = key.attnum
      ) = array['integration_id']::text[]
  ),
  5::bigint,
  'ON DELETE preserves the tenant id and clears only integration_id'
);

select ok(
  to_regprocedure('public.meta_marketing_sync_targets(uuid)') is null,
  'no public Marketing token bridge is exposed through PostgREST'
);

select ok(
  to_regprocedure('private.meta_marketing_sync_targets(uuid)') is null,
  'Marketing sync exposes no database token helper; Go reads Vault directly'
);

select ok(
  (
    select bool_and(
      not has_table_privilege(
        role_name,
        'public.meta_integrations',
        privilege_name
      )
    )
    from unnest(array['anon', 'authenticated']) as role(role_name)
    cross join unnest(array[
      'insert',
      'update',
      'delete',
      'truncate'
    ]) as privilege(privilege_name)
  ),
  'browser roles cannot mutate Meta credentials or account selections directly'
);

select is(
  (
    select count(*)
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'meta_messages'
      and column_name = any(array[
        'client_request_id',
        'provider_attempted_at',
        'completed_at',
        'delivery_error_code'
      ])
  ),
  4::bigint,
  'Meta outbound reservation columns exist'
);

select ok(
  exists (
    select 1
    from pg_index as index_row
    join pg_class as index_relation
      on index_relation.oid = index_row.indexrelid
    where index_row.indrelid = 'public.meta_messages'::regclass
      and index_relation.relname =
        'uq_meta_messages_conversation_client_request'
      and index_row.indisunique
      and (
        select array_agg(attribute.attname::text order by key.ordinality)
        from unnest(index_row.indkey) with ordinality
          as key(attnum, ordinality)
        join pg_attribute as attribute
          on attribute.attrelid = index_row.indrelid
         and attribute.attnum = key.attnum
      ) = array['conversation_id', 'client_request_id']::text[]
  ),
  'Meta outbound client request UUID is unique per conversation'
);

select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'public.meta_messages'::regclass
      and conname = 'meta_messages_client_request_outbound_check'
      and convalidated
  ),
  'Meta outbound reservation constraint is validated'
);

select ok(
  (
    select bool_and(
      not has_table_privilege(
        role_name,
        'public.meta_messages',
        privilege_name
      )
    )
    from unnest(array['anon', 'authenticated', 'service_role']) as role(role_name)
    cross join unnest(array[
      'insert',
      'update',
      'delete',
      'truncate'
    ]) as privilege(privilege_name)
  ),
  'Data API roles cannot create or advance Meta outbound reservations'
);

select ok(
  (
    select relation.relrowsecurity
    from pg_class as relation
    where relation.oid = 'public.meta_messages'::regclass
  ),
  'RLS remains enabled on Meta messages'
);

select ok(
  to_regclass('public.uq_meta_conversations_page_external') is null,
  'legacy tenant-blind Meta conversation unique index is removed'
);

select ok(
  exists (
    select 1
    from pg_index as index_row
    join pg_class as index_relation
      on index_relation.oid = index_row.indexrelid
    where index_row.indrelid = 'public.meta_conversations'::regclass
      and index_relation.relname =
        'uq_meta_conversations_tenant_channel_external'
      and index_row.indisunique
      and (
        select array_agg(attribute.attname::text order by key.ordinality)
        from unnest(index_row.indkey) with ordinality
          as key(attnum, ordinality)
        join pg_attribute as attribute
          on attribute.attrelid = index_row.indrelid
         and attribute.attnum = key.attnum
      ) = array[
        'organization_id',
        'platform',
        'page_id',
        'external_id'
      ]::text[]
  ),
  'Meta conversation uniqueness is tenant and channel scoped'
);

select is(
  (
    select count(*)
    from public.available_permissions
    where key = any(array[
      'dashboard_campaigns_view',
      'settings_integrations',
      'whatsapp_view',
      'whatsapp_operate'
    ])
  ),
  4::bigint,
  'Meta module and per-user permissions exist in the canonical catalog'
);

select ok(
  (
    select bool_and(
      not has_table_privilege(
        role_name,
        format('public.%I', target.table_name),
        privilege_name
      )
    )
    from unnest(array['anon', 'authenticated']) as role(role_name)
    cross join unnest(array[
      'meta_integrations',
      'meta_form_configs',
      'meta_conversations',
      'meta_messages',
      'meta_webhook_events',
      'meta_campaign_insights'
    ]) as target(table_name)
    cross join unnest(array[
      'select',
      'insert',
      'update',
      'delete',
      'truncate',
      'references',
      'trigger'
    ]) as privilege(privilege_name)
  ),
  'browser roles cannot bypass the Go backend for Meta data'
);

select is(
  (
    select count(*)
    from information_schema.column_privileges as privilege
    where privilege.table_schema = 'public'
      and privilege.table_name = any(array[
        'meta_integrations',
        'meta_form_configs',
        'meta_conversations',
        'meta_messages',
        'meta_webhook_events',
        'meta_campaign_insights'
      ])
      and privilege.grantee = any(array['PUBLIC', 'anon', 'authenticated'])
      and privilege.privilege_type = 'SELECT'
  ),
  0::bigint,
  'browser roles retain no column-level Meta SELECT bypass'
);

select ok(
  to_regprocedure(
    'private.purge_meta_webhook_events(timestamptz,interval)'
  ) is not null
  and not has_function_privilege(
    'anon',
    'private.purge_meta_webhook_events(timestamptz,interval)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'private.purge_meta_webhook_events(timestamptz,interval)',
    'execute'
  )
  and not has_function_privilege(
    'service_role',
    'private.purge_meta_webhook_events(timestamptz,interval)',
    'execute'
  ),
  'Meta webhook retention is private to the database scheduler/backend'
);

select is(
  (
    select count(*)
    from cron.job as job
    where job.jobname = 'purge-meta-webhook-events'
      and job.schedule = '23 3 * * *'
  ),
  1::bigint,
  'Meta webhook payload retention runs every day'
);

select is(
  (
    select count(*)
    from pg_index as index_row
    join pg_class as index_relation
      on index_relation.oid = index_row.indexrelid
    where index_row.indrelid = 'public.meta_integrations'::regclass
      and index_relation.relname = any(array[
        'uq_meta_integrations_connected_page_owner',
        'uq_meta_integrations_connected_instagram_owner'
      ])
      and index_row.indisunique
      and index_row.indpred is not null
  ),
  2::bigint,
  'connected Meta Page and Instagram assets have one tenant owner'
);

select * from finish();
rollback;
