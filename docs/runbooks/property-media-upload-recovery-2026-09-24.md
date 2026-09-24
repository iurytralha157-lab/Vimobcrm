# Recuperação do upload de fotos de imóveis — 24/09/2026

**Estado:** diagnóstico de produção confirmado; cutover SQL preparado localmente para revisão. Nenhuma mudança deste runbook foi aplicada em produção.

## Diagnóstico e escopo

- Na organização Vetter Core, o imóvel de teste AP0376 recebeu `500 property_operation_failed` no `POST /v1/properties/{id}/assets/upload-intents` (request ID `c72855106f5a3c5d21349d2a8c0063e4`). O log da API mostra `SQLSTATE 42P01: relation public.property_asset_upload_intents does not exist`. A falha ocorre antes do envio dos bytes ao Storage.
- Leitura de produção: `public.property_asset_upload_intents` e `public.property_asset_storage_cleanup_queue` ausentes; `public.properties` e `public.property_assets` presentes; `supabase_migrations.schema_migrations` ausente. O bucket `property-private` existe, é privado, tem limite de 10 MiB e admite JPEG/PNG/WebP/GIF/PDF. O índice único `properties_organization_id_id_uidx`, as colunas UUID necessárias, os índices de segurança de `property_assets`, o trigger `property_assets_enforce_storage_path` e o RLS relevante estão presentes. `storage.objects` tem RLS ativo e **zero policies de mutação** para PUBLIC/anon/authenticated; estes papéis têm ACL de mutação na tabela, mas o RLS sem policy mutante nega a operação.
- O backend consulta `property_asset_upload_intents` antes de solicitar a URL assinada. A ausência da tabela explica este `500`, mas ainda não prova que o fluxo completo de upload funciona após a correção do schema.

O cutover proposto é [`supabase/cutovers/20260924_restore_property_media_upload_intents.sql`](../../supabase/cutovers/20260924_restore_property_media_upload_intents.sql). Ele cria somente as duas tabelas, índices, funções/triggers da fila de limpeza e o RLS/grants de serviço copiados da migration `20260908000636_normalize_property_media_lifecycle.sql`. Roda em uma transação e aborta se objetos, tipos de coluna, limites do bucket ou fronteiras de segurança divergirem. **Não o executar via `db push` nem marcar a migration original como aplicada.**

A migration completa `20260908000636` também altera policies de Storage, normaliza/backfill de fotos legadas, impõe limite de 20 fotos e recria funções de espelhamento. A migration posterior `20260908113000_archive_provider_property_assets.sql` redefine as funções de limite/espelhamento; aplicar a primeira fora da ordem poderia substituí-las por versões antigas. Sem ledger de migrations em produção, não há base segura para `db push` cego. A reconciliação do histórico e das partes omitidas exige plano separado.

## Pré-checagem sem escrita

Executar na conexão **confirmada como produção** antes de considerar qualquer cutover. O bloco abaixo apenas lê catálogo e bucket; `ROLLBACK` encerra a transação read-only. Todas as colunas booleanas devem ser `true`; as duas consultas de privilégios em `property_assets` e a lista de policies mutantes em `storage.objects` devem devolver zero linhas. A última consulta documenta a ACL de Storage. Guardar o resultado para revisão e comparar com os guards do SQL.

```sql
begin read only;

select
  to_regclass('public.property_asset_upload_intents') is null as intents_absent,
  to_regclass('public.property_asset_storage_cleanup_queue') is null as cleanup_queue_absent,
  to_regclass('public.property_asset_upload_intents_expiry_idx') is null as intent_expiry_index_absent,
  to_regclass('public.property_asset_upload_intents_property_idx') is null as intent_property_index_absent,
  to_regclass('public.property_asset_storage_cleanup_due_idx') is null as cleanup_due_index_absent,
  to_regprocedure('private.queue_property_asset_storage_cleanup()') is null as asset_cleanup_function_absent,
  to_regprocedure('private.queue_property_asset_upload_cleanup_on_cascade()') is null as cascade_cleanup_function_absent,
  not exists (
    select 1 from pg_trigger
    where tgrelid = to_regclass('public.property_assets')
      and tgname = 'property_assets_queue_storage_cleanup'
  ) as asset_cleanup_trigger_absent,
  to_regclass('supabase_migrations.schema_migrations') is null as migration_ledger_absent,
  to_regclass('public.properties') is not null as properties_present,
  to_regclass('public.property_assets') is not null as property_assets_present,
  to_regnamespace('private') is not null as private_schema_present,
  to_regprocedure('gen_random_uuid()') is not null as uuid_function_present;

with required(relation_name, column_name, data_type) as (
  values
    ('public.organizations', 'id', 'uuid'),
    ('public.users', 'id', 'uuid'),
    ('public.properties', 'id', 'uuid'),
    ('public.properties', 'organization_id', 'uuid'),
    ('public.property_assets', 'id', 'uuid'),
    ('public.property_assets', 'organization_id', 'uuid'),
    ('public.property_assets', 'property_id', 'uuid'),
    ('public.property_assets', 'storage_path', 'text')
)
select bool_and(coalesce(a.atttypid = to_regtype(r.data_type), false)) as required_columns_match
from required r
left join pg_attribute a
  on a.attrelid = to_regclass(r.relation_name)
 and a.attname = r.column_name
 and a.attnum > 0
 and not a.attisdropped;

select
  exists (
    select 1 from pg_index
    where indexrelid = to_regclass('public.properties_organization_id_id_uidx')
      and indrelid = to_regclass('public.properties')
      and indisunique and indisvalid
  ) as property_tenant_key_ready,
  exists (
    select 1 from pg_index
    where indexrelid = to_regclass('public.property_assets_storage_locator_uidx')
      and indrelid = to_regclass('public.property_assets')
      and indisunique and indisvalid
  ) as asset_locator_index_ready,
  exists (
    select 1 from pg_index
    where indexrelid = to_regclass('public.property_assets_primary_photo_uidx')
      and indrelid = to_regclass('public.property_assets')
      and indisunique and indisvalid
  ) as primary_photo_index_ready,
  exists (
    select 1 from pg_trigger
    where tgrelid = to_regclass('public.property_assets')
      and tgname = 'property_assets_enforce_storage_path' and tgenabled <> 'D'
  ) as asset_path_trigger_ready,
  exists (
    select 1 from storage.buckets
    where id = 'property-private' and public = false
      and file_size_limit = 10485760
      and allowed_mime_types @> array[
        'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'
      ]::text[]
  ) as private_bucket_ready,
  (select relrowsecurity from pg_class where oid = to_regclass('storage.objects')) as storage_rls_enabled,
  (select relrowsecurity from pg_class where oid = to_regclass('public.property_assets')) as asset_rls_enabled,
  not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and cmd in ('ALL', 'INSERT', 'UPDATE', 'DELETE')
      and roles && array['public', 'anon', 'authenticated']::name[]
  ) as no_browser_storage_mutation_policy;

select browser_role.role_name, privilege_name.name as unexpected_asset_privilege
from (values ('anon'), ('authenticated')) as browser_role(role_name)
cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) as privilege_name(name)
where has_table_privilege(browser_role.role_name, 'public.property_assets', privilege_name.name);

select privilege_name.name as missing_asset_service_privilege
from (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) as privilege_name(name)
where not has_table_privilege('service_role', 'public.property_assets', privilege_name.name);

select policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'storage' and tablename = 'objects'
  and cmd in ('ALL', 'INSERT', 'UPDATE', 'DELETE')
  and roles && array['public', 'anon', 'authenticated']::name[]
order by policyname;

select browser_role.role_name, privilege_name.name as storage_object_privilege
from (values ('anon'), ('authenticated')) as browser_role(role_name)
cross join (values ('INSERT'), ('UPDATE'), ('DELETE')) as privilege_name(name)
where has_table_privilege(browser_role.role_name, 'storage.objects', privilege_name.name);

rollback;
```

Se aparecer qualquer policy mutante de browser em `storage.objects`, parar para revisão; o cutover exige **zero**, cobrindo inclusive policies gerais ou dinâmicas. Se qualquer outro guard divergir, parar e diagnosticar o schema. O cutover também bloqueia colisões de nomes de índices/triggers e a presença inesperada de um ledger de migrations.

## Pós-checagem sem escrita, após aplicação explicitamente aprovada

O responsável pela operação executa o arquivo SQL inteiro em uma única sessão e registra sucesso ou erro da transação. Em seguida, a primeira consulta abaixo deve retornar `true` em todas as colunas, e as duas últimas, **zero linhas**.

```sql
begin read only;

select
  to_regclass('public.property_asset_upload_intents') is not null as intents_present,
  to_regclass('public.property_asset_storage_cleanup_queue') is not null as cleanup_queue_present,
  to_regclass('public.property_asset_upload_intents_expiry_idx') is not null as expiry_index_present,
  to_regclass('public.property_asset_upload_intents_property_idx') is not null as property_index_present,
  to_regclass('public.property_asset_storage_cleanup_due_idx') is not null as cleanup_index_present,
  to_regprocedure('private.queue_property_asset_storage_cleanup()') is not null as asset_cleanup_function_present,
  to_regprocedure('private.queue_property_asset_upload_cleanup_on_cascade()') is not null as cascade_cleanup_function_present,
  (select relrowsecurity from pg_class where oid = to_regclass('public.property_asset_upload_intents')) as intents_rls_enabled,
  (select relrowsecurity from pg_class where oid = to_regclass('public.property_asset_storage_cleanup_queue')) as cleanup_rls_enabled,
  exists (
    select 1 from storage.buckets
    where id = 'property-private' and public = false
  ) as private_bucket_still_private,
  not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and cmd in ('ALL', 'INSERT', 'UPDATE', 'DELETE')
      and roles && array['public', 'anon', 'authenticated']::name[]
  ) as no_browser_storage_mutation_policy,
  exists (
    select 1 from pg_trigger
    where tgrelid = to_regclass('public.property_assets')
      and tgname = 'property_assets_queue_storage_cleanup' and tgenabled <> 'D'
  ) as asset_cleanup_trigger_enabled,
  exists (
    select 1 from pg_trigger
    where tgrelid = to_regclass('public.property_asset_upload_intents')
      and tgname = 'property_asset_upload_intents_queue_cleanup_on_cascade' and tgenabled <> 'D'
  ) as cascade_cleanup_trigger_enabled;

select target.table_name, browser_role.role_name, privilege_name.name
from (values
  ('public.property_asset_upload_intents'),
  ('public.property_asset_storage_cleanup_queue')
) as target(table_name)
cross join (values ('anon'), ('authenticated')) as browser_role(role_name)
cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) as privilege_name(name)
where has_table_privilege(browser_role.role_name, target.table_name, privilege_name.name);

select target.table_name, privilege_name.name as missing_service_privilege
from (values
  ('public.property_asset_upload_intents'),
  ('public.property_asset_storage_cleanup_queue')
) as target(table_name)
cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) as privilege_name(name)
where not has_table_privilege('service_role', target.table_name, privilege_name.name);

rollback;
```

Depois do schema, reiniciar a API de modo controlado: o worker de limpeza testa a existência das duas tabelas **somente na inicialização** e fica desabilitado até um novo start. Verificar logs sem erros de limpeza. Por fim, fazer um upload canário de uma foto pequena no imóvel de teste autorizado, confirmar resposta de intent, transferência ao Storage, finalização e leitura da foto no imóvel. A checagem SQL sozinha não valida Storage nem a interface; não repetir em massa enquanto o canário falhar.
