import { readFileSync } from 'node:fs'
import process from 'node:process'
import pg from 'pg'
import { createClient } from '@supabase/supabase-js'

const PROJECT_REF = 'iemalzlfnbouobyjwlwi'
const BUCKET = 'whatsapp-media'
const CUTOFF_DAYS = 15
const BATCH_SIZE = 1000
const CHECKPOINT_SIZE = 30_000
// A complete cross-table/JSON audit finished before the user's explicit
// deletion confirmation. Historical JSON was proven not to add references to
// the orphan set. Re-scan every reference created or changed since a
// conservative timestamp before that audit, plus all canonical/identity
// references, so execution does not repeatedly decompress the same ~111 GB
// historical webhook/message corpus.
const PRECONFIRMATION_FULL_AUDIT_BASELINE = '2026-08-12T15:00:00.000Z'
const AUTHORIZED_MAX_OBJECTS = 180_953
const AUTHORIZED_MAX_BYTES = 78_906_743_338n
const UUID_RE = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}'
const execute = process.argv.includes('--execute')
const executionConfirmed = process.argv.includes(`--confirm-permanent-delete=${PROJECT_REF}/${BUCKET}`)

if (execute && !executionConfirmed) {
  throw new Error(
    `Permanent deletion requires --confirm-permanent-delete=${PROJECT_REF}/${BUCKET} in addition to --execute`,
  )
}

function loadEnvFile(path) {
  const env = {}
  for (const rawLine of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
    if (!match) continue
    let value = match[2].trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    env[match[1]] = value
  }
  return env
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function json(label, value) {
  process.stdout.write(`${label} ${JSON.stringify(value)}\n`)
}

function normalizedRows(rows) {
  return rows.map((row) => ({
    ...row,
    objects: row.objects === undefined ? undefined : Number(row.objects),
    bytes: row.bytes === undefined ? undefined : String(row.bytes),
  }))
}

const env = loadEnvFile('.env.local')
const projectUrl = env.SUPABASE_URL || env.SUPABASE_PROJECT_URL || env.NEXT_PUBLIC_SUPABASE_URL
const secretKey = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY
const fallbackKey = env.SUPABASE_SERVICE_ROLE_KEY
const databaseUrl = env.DATABASE_URL

if (!projectUrl || !secretKey || !databaseUrl) {
  throw new Error('Required production connection settings are missing from .env.local')
}

const parsedProjectUrl = new URL(projectUrl)
if (parsedProjectUrl.hostname !== `${PROJECT_REF}.supabase.co`) {
  throw new Error(`Project URL guard failed for ${parsedProjectUrl.hostname}`)
}

const databaseConnectionUrl = new URL(databaseUrl)
databaseConnectionUrl.searchParams.delete('sslmode')

const { Client } = pg
const db = new Client({
  connectionString: databaseConnectionUrl.toString(),
  connectionTimeoutMillis: 15_000,
  application_name: 'codex_orphan_whatsapp_media_cleanup_20260812',
  ssl: { rejectUnauthorized: false },
})

const textReferences = [
  ['message_content', 'whatsapp_messages', 'content'],
  ['message_media_url', 'whatsapp_messages', 'media_url'],
  ['lead_attachment_url', 'lead_attachments', 'file_url'],
  ['lead_avatar_url', 'leads', 'whatsapp_avatar_url'],
  ['conversation_picture', 'whatsapp_conversations', 'contact_picture'],
  ['group_picture', 'whatsapp_groups', 'picture_url'],
  ['session_picture', 'whatsapp_sessions', 'profile_picture'],
  ['legacy_outbox_content', 'outbox_messages', 'content'],
  ['legacy_outbox_media_url', 'outbox_messages', 'media_url'],
  ['ai_outbox_content', 'ai_outbox_messages', 'content'],
  ['chatbot_inbound_body', 'chatbot_inbound_messages', 'body'],
  ['activity_content', 'activities', 'content'],
  ['automation_template_content', 'automation_templates', 'content'],
  ['automation_template_media_url', 'automation_templates', 'media_url'],
  ['whatsapp_template_content', 'whatsapp_message_templates', 'content'],
  ['stage_whatsapp_template', 'stage_automations', 'whatsapp_template'],
  ['stage_alert_message', 'stage_automations', 'alert_message'],
  ['cadence_recommended_message', 'cadence_tasks_template', 'recommended_message'],
  ['cadence_message_template', 'cadence_tasks_template', 'message_template'],
]

const jsonReferences = [
  ['message_metadata', 'whatsapp_messages', 'metadata', null],
  ['conversation_metadata', 'whatsapp_conversations', 'metadata', null],
  ['group_metadata', 'whatsapp_groups', 'metadata', null],
  ['group_participants', 'whatsapp_groups', 'participants', null],
  ['session_advanced_settings', 'whatsapp_sessions', 'advanced_settings', null],
  ['whatsapp_outbox_payload', 'whatsapp_outbox', 'payload', null],
  ['media_job_message_key', 'media_jobs', 'message_key', null],
  ['ai_job_payload', 'ai_jobs', 'payload', null],
  ['ai_outbox_metadata', 'ai_outbox_messages', 'metadata', null],
  ['ai_preview_metadata', 'ai_preview_messages', 'metadata', null],
  ['generic_job_payload', 'jobs', 'payload', null],
  ['automation_flow_graph', 'automation_flow_versions', 'graph', null],
  ['automation_flow_trigger', 'automation_flow_versions', 'trigger_config', null],
  ['automation_node_config', 'automation_nodes', 'node_config', null],
  ['automation_definition', 'automations', 'flow_definition', null],
  ['automation_trigger', 'automations', 'trigger_config', null],
  ['automation_step_input', 'automation_execution_steps', 'input', null],
  ['automation_step_output', 'automation_execution_steps', 'output', null],
  ['automation_execution_data', 'automation_executions', 'execution_data', null],
  ['automation_dispatch_request', 'automation_effect_dispatches', 'request', null],
  ['automation_dispatch_response', 'automation_effect_dispatches', 'response', null],
  ['automation_event_payload', 'automation_event_outbox', 'payload', null],
  ['stage_automation_action', 'stage_automations', 'action_config', null],
  ['stage_automation_config', 'stage_automations', 'config', null],
  ['cadence_template_snapshot', 'cadence_enrollments', 'template_snapshot', null],
  ['cadence_task_metadata', 'cadence_tasks_template', 'metadata', null],
  ['lead_metadata', 'leads', 'metadata', null],
  ['lead_meta_payload', 'lead_meta', 'payload', null],
  ['lead_meta_raw_payload', 'lead_meta', 'raw_payload', null],
  ['lead_activity_metadata', 'activities', 'metadata', null],
  ['lead_timeline_metadata', 'lead_timeline_events', 'metadata', null],
  ['lead_event_metadata', 'lead_events', 'metadata', null],
  ['lead_entry_metadata', 'lead_entry_events', 'metadata', null],
  ['lead_entry_payload', 'lead_entry_events', 'payload', null],
  ['chatbot_inbound_payload', 'chatbot_inbound_messages', 'payload', null],
]

const tableColumns = new Map()
let auditStartedAt = null
let liveWebhookScanAfter = null

function quoteIdent(identifier) {
  if (!/^[a-z_][a-z0-9_]*$/.test(identifier)) throw new Error(`Unsafe SQL identifier: ${identifier}`)
  return `"${identifier}"`
}

function recentPredicate(tableName, alias = 'source') {
  const columns = tableColumns.get(tableName) || new Set()
  if (columns.has('updated_at') && columns.has('created_at')) {
    return `(${alias}.updated_at >= $2::timestamptz or ${alias}.created_at >= $2::timestamptz)`
  }
  if (columns.has('updated_at')) return `${alias}.updated_at >= $2::timestamptz`
  if (columns.has('created_at')) return `${alias}.created_at >= $2::timestamptz`
  if (columns.has('received_at')) return `${alias}.received_at >= $2::timestamptz`
  return 'true'
}

async function prepareCatalog() {
  const result = await db.query(`
    select table_name, column_name
    from information_schema.columns
    where table_schema = 'public'
  `)
  for (const row of result.rows) {
    if (!tableColumns.has(row.table_name)) tableColumns.set(row.table_name, new Set())
    tableColumns.get(row.table_name).add(row.column_name)
  }

  for (const [, tableName, columnName] of [...textReferences, ...jsonReferences]) {
    if (!tableColumns.get(tableName)?.has(columnName)) {
      throw new Error(`Expected reference column is missing: public.${tableName}.${columnName}`)
    }
  }
}

async function createTemporaryTables() {
  await db.query(`set statement_timeout = '30min'`)
  await db.query(`set lock_timeout = '5s'`)
  await db.query(`set idle_in_transaction_session_timeout = '10min'`)
  await db.query(`set work_mem = '64MB'`)
  auditStartedAt = (await db.query(`select clock_timestamp() as started_at`)).rows[0].started_at
  liveWebhookScanAfter = auditStartedAt

  await db.query(`
    drop table if exists tmp_orphan_media_victims;
    drop table if exists tmp_orphan_media_protected;
    drop table if exists tmp_orphan_media_parsed;
    drop table if exists tmp_orphan_media_requested;
    drop table if exists tmp_pending_webhook_keys;
    drop table if exists tmp_media_job_identities;
  `)

  await db.query(`
    create or replace function pg_temp.whatsapp_object_path(raw_value text)
    returns text
    language sql
    immutable
    parallel safe
    as $function$
      select case
        when nullif(btrim(raw_value), '') is null then null
        when raw_value like '%/whatsapp-media/%'
          then nullif(split_part(substring(raw_value from '/whatsapp-media/(.*)$'), '?', 1), '')
        when raw_value like 'whatsapp-media/%'
          then nullif(split_part(substring(raw_value from '^whatsapp-media/(.*)$'), '?', 1), '')
        when raw_value like 'orgs/%'
          then nullif(split_part(raw_value, '?', 1), '')
        when raw_value ~ '^[0-9a-fA-F-]{36}/'
          then nullif(split_part(raw_value, '?', 1), '')
        else null
      end
    $function$
  `)

  await db.query(`
    create temp table tmp_orphan_media_parsed on commit preserve rows as
    with recognized as (
      select
        o.name,
        o.created_at,
        o.updated_at,
        case when (o.metadata->>'size') ~ '^[0-9]+$' then (o.metadata->>'size')::bigint else 0 end as bytes,
        case
          when o.name ~ $2 then 'session_media'
          when o.name ~ $3 then 'session_incoming'
          when o.name ~ $4 then 'session_outgoing'
          when o.name ~ $5 then 'legacy'
        end as family
      from storage.objects o
      where o.bucket_id = $1
        and o.created_at < now() - make_interval(days => $6)
        and coalesce(o.updated_at, o.created_at) < now() - make_interval(days => $6)
        and position(chr(92) in o.name) = 0
        and o.name not like '%..%'
        and (o.name ~ $2 or o.name ~ $3 or o.name ~ $4 or o.name ~ $5)
    ), parts as (
      select
        recognized.*,
        case when family = 'legacy' then split_part(name, '/', 1)::uuid else split_part(name, '/', 2)::uuid end as organization_id,
        case when family = 'legacy' then null else split_part(name, '/', 4)::uuid end as session_id,
        case when family = 'legacy' then split_part(name, '/', 2)::uuid else null end as conversation_id,
        case when family = 'legacy' then split_part(name, '/', 3) else split_part(name, '/', 6) end as filename
      from recognized
    ), keys as (
      select parts.*, regexp_replace(filename, '\\.[^.]+$', '') as object_key
      from parts
    )
    select
      keys.*,
      regexp_replace(object_key, '_thumb$', '', 'i') as base_key,
      case
        when regexp_replace(object_key, '_thumb$', '', 'i') ~ $7
          then regexp_replace(object_key, '_thumb$', '', 'i')::uuid
        else null
      end as object_uuid
    from keys
  `, [
    BUCKET,
    `^orgs/${UUID_RE}/sessions/${UUID_RE}/media/[A-Za-z0-9_-]+\\.[A-Za-z0-9]{1,10}$`,
    `^orgs/${UUID_RE}/sessions/${UUID_RE}/incoming/[A-Za-z0-9_-]+\\.[A-Za-z0-9]{1,10}$`,
    `^orgs/${UUID_RE}/sessions/${UUID_RE}/outgoing/[A-Za-z0-9_-]+\\.[A-Za-z0-9]{1,10}$`,
    `^${UUID_RE}/${UUID_RE}/${UUID_RE}(?:_thumb)?\\.[A-Za-z0-9]{1,10}$`,
    CUTOFF_DAYS,
    `^${UUID_RE}$`,
  ])
  await db.query(`create unique index on tmp_orphan_media_parsed(name)`)
  await db.query(`create index on tmp_orphan_media_parsed(session_id, base_key)`)
  await db.query(`create index on tmp_orphan_media_parsed(object_uuid)`)
  await db.query(`create index on tmp_orphan_media_parsed(organization_id, family)`)
  await db.query(`analyze tmp_orphan_media_parsed`)

  await db.query(`
    create temp table tmp_orphan_media_protected (
      name text not null,
      reason text not null,
      primary key (name, reason)
    ) on commit preserve rows
  `)
  await db.query(`create index on tmp_orphan_media_protected(name)`)

  await db.query(`
    create temp table tmp_orphan_media_requested (
      name text primary key
    ) on commit preserve rows
  `)

  await db.query(`
    create temp table tmp_pending_webhook_keys on commit preserve rows as
    with candidate_scopes as (
      select distinct organization_id, session_id
      from tmp_orphan_media_parsed
    )
    select distinct
      source.organization_id,
      source.session_id,
      coalesce(
        source.payload #>> '{data,Info,ID}',
        source.payload #>> '{data,info,id}',
        source.payload #>> '{data,key,id}',
        source.payload #>> '{data,Key,ID}',
        source.payload #>> '{data,message,key,id}',
        source.payload #>> '{data,Message,key,id}',
        source.payload #>> '{data,messageId}',
        source.payload #>> '{data,message_id}',
        source.payload #>> '{message,key,id}',
        source.payload #>> '{key,id}',
        source.payload ->> 'messageId',
        source.payload ->> 'message_id',
        source.payload ->> 'id'
      ) as key,
      pg_temp.whatsapp_object_path(coalesce(
        source.payload #>> '{media_storage_path}',
        source.payload #>> '{mediaStoragePath}',
        source.payload #>> '{data,media_storage_path}',
        source.payload #>> '{data,mediaStoragePath}',
        source.payload #>> '{data,Message,media_storage_path}',
        source.payload #>> '{data,Message,mediaStoragePath}'
      )) as storage_path
    from public.whatsapp_webhook_inbox source
    join candidate_scopes scope
      on scope.organization_id = source.organization_id
     and (scope.session_id is null or scope.session_id = source.session_id)
    where source.status in ('pending', 'retry', 'processing')
      and source.event_type in ('message', 'sendmessage')
      and nullif(btrim(coalesce(
        source.payload #>> '{data,Info,ID}',
        source.payload #>> '{data,info,id}',
        source.payload #>> '{data,key,id}',
        source.payload #>> '{data,Key,ID}',
        source.payload #>> '{data,message,key,id}',
        source.payload #>> '{data,Message,key,id}',
        source.payload #>> '{data,messageId}',
        source.payload #>> '{data,message_id}',
        source.payload #>> '{message,key,id}',
        source.payload #>> '{key,id}',
        source.payload ->> 'messageId',
        source.payload ->> 'message_id',
        source.payload ->> 'id'
      )), '') is not null
  `)
  await db.query(`create index on tmp_pending_webhook_keys(session_id, key)`)
  await db.query(`create index on tmp_pending_webhook_keys(organization_id, key)`)
  await db.query(`create index on tmp_pending_webhook_keys(storage_path)`)
  await db.query(`analyze tmp_pending_webhook_keys`)

  // media_jobs is heavily bloated in production but has very few live rows.
  // Read it once, project only the identity columns, and join the compact temp
  // table below. This preserves every job reference without repeatedly scanning
  // the ~211 MB physical relation for each candidate/key variant.
  await db.query(`
    create temp table tmp_media_job_identities on commit preserve rows as
    select
      source.message_id,
      source.session_id,
      source.message_key->>'id' as key_id,
      source.message_key->>'message_id' as message_id_key,
      source.message_key#>>'{key,id}' as nested_key_id
    from public.media_jobs source
  `)
  await db.query(`create index on tmp_media_job_identities(message_id)`)
  await db.query(`create index on tmp_media_job_identities(session_id, key_id)`)
  await db.query(`create index on tmp_media_job_identities(session_id, message_id_key)`)
  await db.query(`create index on tmp_media_job_identities(session_id, nested_key_id)`)
  await db.query(`analyze tmp_media_job_identities`)
}

async function protectInitialReferences() {
  await db.query(`
    insert into tmp_orphan_media_protected(name, reason)
    select distinct candidate.name, 'whatsapp_messages.media_storage_path'
    from tmp_orphan_media_parsed candidate
    join public.whatsapp_messages source on source.media_storage_path = candidate.name
    on conflict do nothing
  `)

  for (const [reason, tableName, columnName] of textReferences) {
    const table = quoteIdent(tableName)
    const column = quoteIdent(columnName)
    await db.query(`
      insert into tmp_orphan_media_protected(name, reason)
      select distinct candidate.name, $1
      from public.${table} source
      join tmp_orphan_media_parsed candidate
        on candidate.name = pg_temp.whatsapp_object_path(source.${column})
      where source.${column} is not null
      on conflict do nothing
    `, [reason])
  }

  for (const [reason, tableName, columnName, additionalWhere] of jsonReferences) {
    const table = quoteIdent(tableName)
    const column = quoteIdent(columnName)
    const freshness = recentPredicate(tableName)
    const extra = additionalWhere ? `and (${additionalWhere})` : ''
    const parameters = freshness === 'true'
      ? [reason]
      : [reason, PRECONFIRMATION_FULL_AUDIT_BASELINE]
    await db.query(`
      insert into tmp_orphan_media_protected(name, reason)
      select distinct candidate.name, $1
      from public.${table} source
      cross join lateral jsonb_path_query(source.${column}, '$.** ? (@.type() == "string")') item
      join tmp_orphan_media_parsed candidate
        on candidate.name = pg_temp.whatsapp_object_path(item #>> '{}')
      where source.${column} is not null
        and (${freshness})
        ${extra}
      on conflict do nothing
    `, parameters)
  }

  await db.query(`
    insert into tmp_orphan_media_protected(name, reason)
    select distinct candidate.name, 'active_whatsapp_webhook_storage_path'
    from tmp_pending_webhook_keys source
    join tmp_orphan_media_parsed candidate
      on candidate.name = source.storage_path
    where source.storage_path is not null
    on conflict do nothing
  `)

  const identityStatements = [
    ['whatsapp_message_identity', `
      select distinct candidate.name
      from tmp_orphan_media_parsed candidate
      join public.whatsapp_messages source
        on source.id = candidate.object_uuid
      union
      select candidate.name
      from tmp_orphan_media_parsed candidate
      join public.whatsapp_messages source
        on source.session_id = candidate.session_id
       and source.message_id = candidate.object_key
      where candidate.session_id is not null
      union
      select candidate.name
      from tmp_orphan_media_parsed candidate
      join public.whatsapp_messages source
        on source.session_id = candidate.session_id
       and source.message_id = candidate.base_key
      where candidate.session_id is not null
        and candidate.base_key <> candidate.object_key
      union
      select candidate.name
      from tmp_orphan_media_parsed candidate
      join public.whatsapp_messages source
        on source.organization_id = candidate.organization_id
       and source.provider_message_id = candidate.object_key
      where candidate.session_id is not null
      union
      select candidate.name
      from tmp_orphan_media_parsed candidate
      join public.whatsapp_messages source
        on source.organization_id = candidate.organization_id
       and source.provider_message_id = candidate.base_key
      where candidate.session_id is not null
        and candidate.base_key <> candidate.object_key
      union
      select candidate.name
      from tmp_orphan_media_parsed candidate
      join public.whatsapp_messages source
        on source.organization_id = candidate.organization_id
       and source.session_id = candidate.session_id
       and source.client_message_id = candidate.object_key
      where candidate.session_id is not null
      union
      select candidate.name
      from tmp_orphan_media_parsed candidate
      join public.whatsapp_messages source
        on source.organization_id = candidate.organization_id
       and source.session_id = candidate.session_id
       and source.client_message_id = candidate.base_key
      where candidate.session_id is not null
        and candidate.base_key <> candidate.object_key
    `],
    ['media_job_identity', `
      select distinct candidate.name
      from tmp_orphan_media_parsed candidate
      join tmp_media_job_identities source
        on source.message_id = candidate.object_uuid
      union
      select candidate.name
      from tmp_orphan_media_parsed candidate
      join tmp_media_job_identities source
        on source.session_id = candidate.session_id
       and source.key_id = candidate.object_key
      where candidate.session_id is not null
      union
      select candidate.name
      from tmp_orphan_media_parsed candidate
      join tmp_media_job_identities source
        on source.session_id = candidate.session_id
       and source.key_id = candidate.base_key
      where candidate.session_id is not null
        and candidate.base_key <> candidate.object_key
      union
      select candidate.name
      from tmp_orphan_media_parsed candidate
      join tmp_media_job_identities source
        on source.session_id = candidate.session_id
       and source.message_id_key = candidate.object_key
      where candidate.session_id is not null
      union
      select candidate.name
      from tmp_orphan_media_parsed candidate
      join tmp_media_job_identities source
        on source.session_id = candidate.session_id
       and source.message_id_key = candidate.base_key
      where candidate.session_id is not null
        and candidate.base_key <> candidate.object_key
      union
      select candidate.name
      from tmp_orphan_media_parsed candidate
      join tmp_media_job_identities source
        on source.session_id = candidate.session_id
       and source.nested_key_id = candidate.object_key
      where candidate.session_id is not null
      union
      select candidate.name
      from tmp_orphan_media_parsed candidate
      join tmp_media_job_identities source
        on source.session_id = candidate.session_id
       and source.nested_key_id = candidate.base_key
      where candidate.session_id is not null
        and candidate.base_key <> candidate.object_key
    `],
    ['whatsapp_outbox_identity', `
      select distinct candidate.name
      from tmp_orphan_media_parsed candidate
      join public.whatsapp_outbox source
        on source.id = candidate.object_uuid
      union
      select candidate.name
      from tmp_orphan_media_parsed candidate
      join public.whatsapp_outbox source
        on source.message_id = candidate.object_uuid
      union
      select candidate.name
      from tmp_orphan_media_parsed candidate
      join public.whatsapp_outbox source
        on source.session_id = candidate.session_id
       and source.provider_message_id = candidate.object_key
      where candidate.session_id is not null
      union
      select candidate.name
      from tmp_orphan_media_parsed candidate
      join public.whatsapp_outbox source
        on source.session_id = candidate.session_id
       and source.provider_message_id = candidate.base_key
      where candidate.session_id is not null
        and candidate.base_key <> candidate.object_key
      union
      select candidate.name
      from tmp_orphan_media_parsed candidate
      join public.whatsapp_outbox source
        on source.session_id = candidate.session_id
       and source.client_message_id = candidate.object_key
      where candidate.session_id is not null
      union
      select candidate.name
      from tmp_orphan_media_parsed candidate
      join public.whatsapp_outbox source
        on source.session_id = candidate.session_id
       and source.client_message_id = candidate.base_key
      where candidate.session_id is not null
        and candidate.base_key <> candidate.object_key
    `],
    ['legacy_outbox_identity', `
      select distinct candidate.name
      from tmp_orphan_media_parsed candidate
      join public.outbox_messages source
        on source.id = candidate.object_uuid
      union
      select candidate.name
      from tmp_orphan_media_parsed candidate
      join public.outbox_messages source
        on source.session_id = candidate.session_id
       and source.sent_message_id = candidate.object_key
      where candidate.session_id is not null
      union
      select candidate.name
      from tmp_orphan_media_parsed candidate
      join public.outbox_messages source
        on source.session_id = candidate.session_id
       and source.sent_message_id = candidate.base_key
      where candidate.session_id is not null
        and candidate.base_key <> candidate.object_key
      union
      select candidate.name
      from tmp_orphan_media_parsed candidate
      join public.outbox_messages source
        on source.session_id = candidate.session_id
       and source.client_message_id = candidate.object_key
      where candidate.session_id is not null
      union
      select candidate.name
      from tmp_orphan_media_parsed candidate
      join public.outbox_messages source
        on source.session_id = candidate.session_id
       and source.client_message_id = candidate.base_key
      where candidate.session_id is not null
        and candidate.base_key <> candidate.object_key
    `],
    ['pending_webhook_identity', `
      select distinct candidate.name
      from tmp_orphan_media_parsed candidate
      join tmp_pending_webhook_keys source
        on source.organization_id = candidate.organization_id
       and source.session_id = candidate.session_id
       and source.key = candidate.object_key
      where candidate.session_id is not null
      union
      select candidate.name
      from tmp_orphan_media_parsed candidate
      join tmp_pending_webhook_keys source
        on source.organization_id = candidate.organization_id
       and source.session_id = candidate.session_id
       and source.key = candidate.base_key
      where candidate.session_id is not null
        and candidate.base_key <> candidate.object_key
      union
      select candidate.name
      from tmp_orphan_media_parsed candidate
      join tmp_pending_webhook_keys source
        on source.organization_id = candidate.organization_id
       and source.key = candidate.object_key
      where candidate.session_id is null
      union
      select candidate.name
      from tmp_orphan_media_parsed candidate
      join tmp_pending_webhook_keys source
        on source.organization_id = candidate.organization_id
       and source.key = candidate.base_key
      where candidate.session_id is null
        and candidate.base_key <> candidate.object_key
    `],
    ['chatbot_inbound_identity', `
      select distinct candidate.name
      from tmp_orphan_media_parsed candidate
      join public.chatbot_inbound_messages source
        on source.organization_id = candidate.organization_id
       and source.channel ilike 'whatsapp%'
       and source.external_id = candidate.object_key
      union
      select candidate.name
      from tmp_orphan_media_parsed candidate
      join public.chatbot_inbound_messages source
        on source.organization_id = candidate.organization_id
       and source.channel ilike 'whatsapp%'
       and source.external_id = candidate.base_key
      where candidate.base_key <> candidate.object_key
    `],
  ]

  for (const [reason, selectSql] of identityStatements) {
    await db.query(`
      insert into tmp_orphan_media_protected(name, reason)
      select candidate.name, $1
      from (${selectSql}) candidate(name)
      on conflict do nothing
    `, [reason])
  }

  await db.query(`
    create temp table tmp_orphan_media_victims on commit preserve rows as
    select candidate.*
    from tmp_orphan_media_parsed candidate
    where not exists (
      select 1
      from tmp_orphan_media_protected protected
      where protected.name = candidate.name
    )
  `)
  await db.query(`create unique index on tmp_orphan_media_victims(name)`)
  await db.query(`create index on tmp_orphan_media_victims(family)`)
}

async function audit() {
  const bucket = await db.query(`
    select count(*)::bigint objects,
           coalesce(sum(case when (metadata->>'size') ~ '^[0-9]+$' then (metadata->>'size')::bigint else 0 end), 0)::bigint bytes
    from storage.objects where bucket_id = $1
  `, [BUCKET])
  const candidates = await db.query(`select count(*)::bigint objects, coalesce(sum(bytes), 0)::bigint bytes from tmp_orphan_media_parsed`)
  const protectedRows = await db.query(`select count(distinct name)::bigint objects from tmp_orphan_media_protected`)
  const victims = await db.query(`select count(*)::bigint objects, coalesce(sum(bytes), 0)::bigint bytes from tmp_orphan_media_victims`)
  const families = await db.query(`select family, count(*)::bigint objects, coalesce(sum(bytes), 0)::bigint bytes from tmp_orphan_media_victims group by family order by family`)
  const age = await db.query(`select min(created_at) oldest, max(created_at) newest from tmp_orphan_media_victims`)
  const safety = await db.query(`
      select
        count(*) filter (
          where created_at >= now() - make_interval(days => $1)
             or coalesce(updated_at, created_at) >= now() - make_interval(days => $1)
        )::bigint cutoff_violations,
        count(*) filter (where family not in ('session_media','session_incoming','session_outgoing','legacy'))::bigint family_violations,
        count(*) filter (where name like '%..%' or position(chr(92) in name) > 0 or name like '/%' or name is null)::bigint unsafe_path_violations,
        count(*) filter (
          where exists (
            select 1
            from tmp_orphan_media_protected protected
            where protected.name = v.name
              and protected.reason = 'whatsapp_messages.media_storage_path'
          )
        )::bigint direct_reference_violations
    from tmp_orphan_media_victims v
  `, [CUTOFF_DAYS])
  const topOrganizations = await db.query(`
    select coalesce(o.name, v.organization_id::text) organization,
           count(*)::bigint objects,
           coalesce(sum(v.bytes), 0)::bigint bytes
    from tmp_orphan_media_victims v
    left join public.organizations o on o.id = v.organization_id
    group by coalesce(o.name, v.organization_id::text)
    order by sum(v.bytes) desc
    limit 15
  `)

  json('AUDIT_BUCKET_BEFORE', normalizedRows(bucket.rows))
  json('AUDIT_RECOGNIZED_OLDER_15D', normalizedRows(candidates.rows))
  json('AUDIT_PROTECTED', normalizedRows(protectedRows.rows))
  json('AUDIT_SAFE_ORPHANS', normalizedRows(victims.rows))
  json('AUDIT_SAFE_ORPHANS_BY_FAMILY', normalizedRows(families.rows))
  json('AUDIT_AGE_RANGE', age.rows)
  json('AUDIT_TOP_ORGANIZATIONS', normalizedRows(topOrganizations.rows))
  json('AUDIT_SAFETY', safety.rows)
  json('AUDIT_PROVENANCE', {
    preconfirmationFullAuditBaseline: PRECONFIRMATION_FULL_AUDIT_BASELINE,
    authorizedMaxObjects: AUTHORIZED_MAX_OBJECTS,
    authorizedMaxBytes: String(AUTHORIZED_MAX_BYTES),
  })

  const victimCount = Number(victims.rows[0].objects)
  const victimBytes = BigInt(victims.rows[0].bytes)
  const guard = safety.rows[0]
  if (
    Number(guard.cutoff_violations) !== 0 ||
    Number(guard.family_violations) !== 0 ||
    Number(guard.unsafe_path_violations) !== 0 ||
    Number(guard.direct_reference_violations) !== 0
  ) {
    throw new Error('Safety guard failed; no deletion performed')
  }
  if (
    victimCount < 1 ||
    victimCount > AUTHORIZED_MAX_OBJECTS ||
    victimBytes < 1n ||
    victimBytes > AUTHORIZED_MAX_BYTES
  ) {
    throw new Error(`Victim scope guard failed (${victimCount} objects / ${victimBytes} bytes)`)
  }
}

async function createStorageClient() {
  const options = {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      fetch: (input, init = {}) => fetch(input, { ...init, signal: AbortSignal.timeout(120_000) }),
    },
  }
  let client = createClient(projectUrl, secretKey, options)
  let probe = await client.storage.getBucket(BUCKET)
  if (probe.error && fallbackKey && fallbackKey !== secretKey) {
    client = createClient(projectUrl, fallbackKey, options)
    probe = await client.storage.getBucket(BUCKET)
  }
  if (probe.error) throw new Error(`Storage authentication probe failed: ${probe.error.message}`)
  return client
}

async function refreshLiveReferences(paths) {
  await db.query(`truncate tmp_orphan_media_requested`)
  await db.query(`insert into tmp_orphan_media_requested(name) select unnest($1::text[]) on conflict do nothing`, [paths])

  await db.query(`
    insert into tmp_orphan_media_protected(name, reason)
    select distinct requested.name, 'live_whatsapp_messages.media_storage_path'
    from tmp_orphan_media_requested requested
    join public.whatsapp_messages source on source.media_storage_path = requested.name
    on conflict do nothing
  `)

  for (const [reason, tableName, columnName] of textReferences) {
    const table = quoteIdent(tableName)
    const column = quoteIdent(columnName)
    const freshness = recentPredicate(tableName)
    const parameters = freshness === 'true'
      ? [`live_${reason}`]
      : [`live_${reason}`, auditStartedAt]
    await db.query(`
      insert into tmp_orphan_media_protected(name, reason)
      select distinct requested.name, $1
      from public.${table} source
      join tmp_orphan_media_requested requested
        on requested.name = pg_temp.whatsapp_object_path(source.${column})
      where source.${column} is not null
        and (${freshness})
      on conflict do nothing
    `, parameters)
  }

  // The historical JSON corpus is materialized once. During execution, only rows
  // created or updated after the audit began are scanned so a newly-added
  // reference cannot race with deletion without repeatedly reading old TOAST.
  for (const [reason, tableName, columnName, additionalWhere] of jsonReferences) {
    const table = quoteIdent(tableName)
    const column = quoteIdent(columnName)
    const freshness = recentPredicate(tableName)
    const extra = additionalWhere ? `and (${additionalWhere})` : ''
    const parameters = freshness === 'true'
      ? [`live_${reason}`]
      : [`live_${reason}`, auditStartedAt]
    await db.query(`
      insert into tmp_orphan_media_protected(name, reason)
      select distinct requested.name, $1
      from public.${table} source
      cross join lateral jsonb_path_query(source.${column}, '$.** ? (@.type() == "string")') item
      join tmp_orphan_media_requested requested
        on requested.name = pg_temp.whatsapp_object_path(item #>> '{}')
      where source.${column} is not null
        and (${freshness})
        ${extra}
      on conflict do nothing
    `, parameters)
  }

  // Protect media identities or explicit paths introduced by webhook events that
  // arrived after the initial active-webhook snapshot. Scan only the interval
  // since the previous batch (with a five-minute overlap) and drive the lookup
  // by session_id so Postgres can use whatsapp_webhook_inbox_session_created_idx.
  const liveWebhookScanUntil = (await db.query(`select clock_timestamp() as scan_until`)).rows[0].scan_until
  await db.query(`
    insert into tmp_orphan_media_protected(name, reason)
    with requested_candidates as materialized (
      select candidate.*
      from tmp_orphan_media_requested requested
      join tmp_orphan_media_parsed candidate on candidate.name = requested.name
    ), modern_scopes as materialized (
      select distinct organization_id, session_id
      from requested_candidates
      where session_id is not null
    ), modern_sources as materialized (
      select scope.organization_id, scope.session_id, source.payload
      from modern_scopes scope
      cross join lateral (
        select event.payload
        from public.whatsapp_webhook_inbox event
        where event.session_id = scope.session_id
          and event.organization_id = scope.organization_id
          and event.created_at >= $1::timestamptz - interval '5 minutes'
          and event.created_at < $2::timestamptz
          and event.status in ('pending', 'retry', 'processing')
          and event.event_type in ('message', 'sendmessage')
        offset 0
      ) source
    ), legacy_scopes as materialized (
      select distinct organization_id
      from requested_candidates
      where session_id is null
    ), legacy_sources as materialized (
      select scope.organization_id, source.payload
      from legacy_scopes scope
      cross join lateral (
        select event.payload
        from public.whatsapp_webhook_inbox event
        where event.organization_id = scope.organization_id
          and event.created_at >= $1::timestamptz - interval '5 minutes'
          and event.created_at < $2::timestamptz
          and event.status in ('pending', 'retry', 'processing')
          and event.event_type in ('message', 'sendmessage')
        offset 0
      ) source
    ), matches as (
      select candidate.name
      from requested_candidates candidate
      join modern_sources source
        on source.organization_id = candidate.organization_id
       and source.session_id = candidate.session_id
      where candidate.name = pg_temp.whatsapp_object_path(coalesce(
              source.payload #>> '{media_storage_path}',
              source.payload #>> '{mediaStoragePath}',
              source.payload #>> '{data,media_storage_path}',
              source.payload #>> '{data,mediaStoragePath}',
              source.payload #>> '{data,Message,media_storage_path}',
              source.payload #>> '{data,Message,mediaStoragePath}'
            ))
         or coalesce(
              source.payload #>> '{data,Info,ID}',
              source.payload #>> '{data,info,id}',
              source.payload #>> '{data,key,id}',
              source.payload #>> '{data,Key,ID}',
              source.payload #>> '{data,message,key,id}',
              source.payload #>> '{data,Message,key,id}',
              source.payload #>> '{data,messageId}',
              source.payload #>> '{data,message_id}',
              source.payload #>> '{message,key,id}',
              source.payload #>> '{key,id}',
              source.payload ->> 'messageId',
              source.payload ->> 'message_id',
              source.payload ->> 'id'
            ) in (candidate.object_key, candidate.base_key)
      union
      select candidate.name
      from requested_candidates candidate
      join legacy_sources source on source.organization_id = candidate.organization_id
      where candidate.session_id is null
        and (
          candidate.name = pg_temp.whatsapp_object_path(coalesce(
            source.payload #>> '{media_storage_path}',
            source.payload #>> '{mediaStoragePath}',
            source.payload #>> '{data,media_storage_path}',
            source.payload #>> '{data,mediaStoragePath}',
            source.payload #>> '{data,Message,media_storage_path}',
            source.payload #>> '{data,Message,mediaStoragePath}'
          ))
          or coalesce(
            source.payload #>> '{data,Info,ID}',
            source.payload #>> '{data,info,id}',
            source.payload #>> '{data,key,id}',
            source.payload #>> '{data,Key,ID}',
            source.payload #>> '{data,message,key,id}',
            source.payload #>> '{data,Message,key,id}',
            source.payload #>> '{data,messageId}',
            source.payload #>> '{data,message_id}',
            source.payload #>> '{message,key,id}',
            source.payload #>> '{key,id}',
            source.payload ->> 'messageId',
            source.payload ->> 'message_id',
            source.payload ->> 'id'
          ) in (candidate.object_key, candidate.base_key)
        )
    )
    select distinct name, 'live_active_whatsapp_webhook' from matches
    on conflict do nothing
  `, [liveWebhookScanAfter, liveWebhookScanUntil])
  liveWebhookScanAfter = liveWebhookScanUntil
}

async function liveRevalidate(paths) {
  await refreshLiveReferences(paths)
  return db.query(`
      select victim.name, victim.bytes
      from tmp_orphan_media_requested requested
      join tmp_orphan_media_victims victim on victim.name = requested.name
      join storage.objects object on object.bucket_id = $1 and object.name = victim.name
      where object.created_at < now() - make_interval(days => $2)
        and coalesce(object.updated_at, object.created_at) < now() - make_interval(days => $2)
        and position(chr(92) in object.name) = 0
        and object.name not like '%..%'
        and not exists (
          select 1 from tmp_orphan_media_protected protected where protected.name = victim.name
        )
        and not exists (
          select 1
          from public.whatsapp_messages source
          where source.id = victim.object_uuid
        )
        and not exists (
          select 1
          from public.whatsapp_messages source
          where victim.session_id is not null
            and source.session_id = victim.session_id
            and source.message_id in (victim.object_key, victim.base_key)
        )
        and not exists (
          select 1
          from public.whatsapp_messages source
          where source.organization_id = victim.organization_id
            and source.provider_message_id in (victim.object_key, victim.base_key)
        )
        and not exists (
          select 1
          from public.whatsapp_messages source
          where victim.session_id is not null
            and source.organization_id = victim.organization_id
            and source.session_id = victim.session_id
            and source.client_message_id in (victim.object_key, victim.base_key)
        )
        and not exists (
          select 1
          from tmp_media_job_identities source
          where source.message_id = victim.object_uuid
        )
        and not exists (
          select 1
          from tmp_media_job_identities source
          where victim.session_id is not null
            and source.session_id = victim.session_id
            and (
              source.key_id in (victim.object_key, victim.base_key)
              or source.message_id_key in (victim.object_key, victim.base_key)
              or source.nested_key_id in (victim.object_key, victim.base_key)
            )
        )
        and not exists (
          select 1
          from public.media_jobs source
          where source.message_id = victim.object_uuid
            and (source.updated_at >= $3::timestamptz or source.created_at >= $3::timestamptz)
        )
        and not exists (
          select 1
          from public.whatsapp_outbox source
          where source.id = victim.object_uuid
        )
        and not exists (
          select 1
          from public.whatsapp_outbox source
          where source.message_id = victim.object_uuid
        )
        and not exists (
          select 1
          from public.whatsapp_outbox source
          where victim.session_id is not null
            and source.session_id = victim.session_id
            and source.provider_message_id in (victim.object_key, victim.base_key)
        )
        and not exists (
          select 1
          from public.whatsapp_outbox source
          where victim.session_id is not null
            and source.session_id = victim.session_id
            and source.client_message_id in (victim.object_key, victim.base_key)
        )
        and not exists (
          select 1
          from public.outbox_messages source
          where source.id = victim.object_uuid
        )
        and not exists (
          select 1
          from public.outbox_messages source
          where victim.session_id is not null
            and source.session_id = victim.session_id
            and source.sent_message_id in (victim.object_key, victim.base_key)
        )
        and not exists (
          select 1
          from public.outbox_messages source
          where victim.session_id is not null
            and source.session_id = victim.session_id
            and source.client_message_id in (victim.object_key, victim.base_key)
        )
        and not exists (
          select 1
          from public.chatbot_inbound_messages source
          where source.organization_id = victim.organization_id
            and source.channel ilike 'whatsapp%'
            and source.external_id in (victim.object_key, victim.base_key)
        )
      order by victim.name
    `, [BUCKET, CUTOFF_DAYS, auditStartedAt]).then((result) => result.rows)
}

async function currentExisting(paths) {
  if (paths.length === 0) return []
  const result = await db.query(`
    select object.name
    from storage.objects object
    where object.bucket_id = $1 and object.name = any($2::text[])
    order by object.name
  `, [BUCKET, paths])
  return result.rows.map((row) => row.name)
}

async function checkpoint(state, totalVictims) {
  const bucket = await db.query(`
    select count(*)::bigint objects,
           coalesce(sum(case when (metadata->>'size') ~ '^[0-9]+$' then (metadata->>'size')::bigint else 0 end), 0)::bigint bytes
    from storage.objects where bucket_id = $1
  `, [BUCKET])
  const remaining = await db.query(`
    select count(*)::bigint objects, coalesce(sum(v.bytes), 0)::bigint bytes
    from tmp_orphan_media_victims v
    join storage.objects o on o.bucket_id = $1 and o.name = v.name
  `, [BUCKET])
  json('DELETE_CHECKPOINT', {
    confirmedRemoved: state.confirmedRemoved,
    confirmedBytes: String(state.confirmedBytes),
    skippedByLiveGuard: state.skippedByLiveGuard,
    totalVictims,
    bucket: normalizedRows(bucket.rows)[0],
    snapshotVictimsRemaining: normalizedRows(remaining.rows)[0],
  })
}

async function deleteVictims() {
  let storage = await createStorageClient()
  const result = await db.query(`select name, bytes from tmp_orphan_media_victims order by name`)
  const victims = result.rows
  const bytesByPath = new Map(victims.map((row) => [row.name, BigInt(row.bytes)]))
  const state = {
    confirmedRemoved: 0,
    confirmedBytes: 0n,
    skippedByLiveGuard: 0,
    batches: 0,
    nextCheckpoint: CHECKPOINT_SIZE,
  }

  for (let offset = 0; offset < victims.length; offset += BATCH_SIZE) {
    const proposed = victims.slice(offset, offset + BATCH_SIZE).map((row) => row.name)
    const approvedRows = await liveRevalidate(proposed)
    const approved = approvedRows.map((row) => row.name)
    state.skippedByLiveGuard += proposed.length - approved.length
    if (approved.length === 0) continue

    let remaining = await currentExisting(approved)
    let lastError = null
    const chunkSizes = [remaining.length, 500, 250, 100]
    for (const chunkSize of chunkSizes) {
      if (remaining.length === 0) break
      const round = [...remaining]
      for (let index = 0; index < round.length; index += Math.max(1, chunkSize)) {
        let subRemaining = await currentExisting(round.slice(index, index + Math.max(1, chunkSize)))
        for (let attempt = 1; attempt <= 4 && subRemaining.length > 0; attempt += 1) {
          const response = await storage.storage.from(BUCKET).remove(subRemaining)
          lastError = response.error || null
          if (lastError) {
            await sleep(Math.min(15_000, 1_000 * (2 ** (attempt - 1))))
            if (attempt === 2) storage = await createStorageClient()
          } else {
            await sleep(100)
          }
          subRemaining = await currentExisting(subRemaining)
        }
      }
      remaining = await currentExisting(remaining)
    }
    if (remaining.length > 0) {
      throw new Error(`Storage remove failed after adaptive retries: ${lastError?.message || 'objects still present'}; ${remaining.length} objects remain in batch`)
    }

    state.confirmedRemoved += approved.length
    for (const path of approved) state.confirmedBytes += bytesByPath.get(path) || 0n
    state.batches += 1

    if (state.confirmedRemoved >= state.nextCheckpoint) {
      await checkpoint(state, victims.length)
      while (state.confirmedRemoved >= state.nextCheckpoint) state.nextCheckpoint += CHECKPOINT_SIZE
    }
    await sleep(75)
  }

  await checkpoint(state, victims.length)
  json('DELETE_API_COMPLETE', {
    batches: state.batches,
    confirmedRemoved: state.confirmedRemoved,
    confirmedBytes: String(state.confirmedBytes),
    skippedByLiveGuard: state.skippedByLiveGuard,
  })
}

async function verifyAfter() {
  const remaining = await db.query(`
    select v.family, count(*)::bigint objects, coalesce(sum(v.bytes), 0)::bigint bytes
    from tmp_orphan_media_victims v
    join storage.objects o on o.bucket_id = $1 and o.name = v.name
    group by v.family order by v.family
  `, [BUCKET])
  const bucket = await db.query(`
    select count(*)::bigint objects,
           coalesce(sum(case when (metadata->>'size') ~ '^[0-9]+$' then (metadata->>'size')::bigint else 0 end), 0)::bigint bytes
    from storage.objects where bucket_id = $1
  `, [BUCKET])
  const protectedStillPresent = await db.query(`
    select count(distinct p.name)::bigint objects,
           coalesce(sum(distinct case when (o.metadata->>'size') ~ '^[0-9]+$' then (o.metadata->>'size')::bigint else 0 end), 0)::bigint approximate_bytes
    from tmp_orphan_media_protected p
    join storage.objects o on o.bucket_id = $1 and o.name = p.name
  `, [BUCKET])
  json('VERIFY_SNAPSHOT_VICTIMS_REMAINING', normalizedRows(remaining.rows))
  json('VERIFY_PROTECTED_STILL_PRESENT', normalizedRows(protectedStillPresent.rows))
  json('VERIFY_BUCKET_AFTER', normalizedRows(bucket.rows))
}

let configured = false
let inDatabaseTransaction = false
try {
  await db.connect()
  const identity = await db.query(`
    select current_database() database_name,
           exists(select 1 from storage.buckets where id = $1) bucket_exists,
           (select count(*)::bigint from storage.objects where bucket_id = $1) bucket_objects
  `, [BUCKET])
  if (!identity.rows[0]?.bucket_exists || Number(identity.rows[0]?.bucket_objects || 0) < 1) {
    throw new Error('Database target guard failed')
  }
  json('TARGET_GUARD', { projectRef: PROJECT_REF, bucketObjects: Number(identity.rows[0].bucket_objects) })

  // DATABASE_URL points at the transaction pooler. Keeping one explicit
  // READ COMMITTED transaction pins this client to one backend so all temp
  // tables survive for the audit and per-batch live guards. Only temp tables
  // are written here; permanent object deletion still goes through Storage API.
  await db.query('begin isolation level read committed')
  inDatabaseTransaction = true
  await prepareCatalog()
  await createTemporaryTables()
  configured = true
  await protectInitialReferences()
  await audit()

  if (!execute) {
    json('DRY_RUN_COMPLETE', { deletionPerformed: false })
  } else {
    await deleteVictims()
    await verifyAfter()
  }
  await db.query('commit')
  inDatabaseTransaction = false
} catch (error) {
  json('CLEANUP_ERROR', { message: error instanceof Error ? error.message : String(error) })
  if (configured && execute) {
    try { await verifyAfter() } catch { /* best-effort partial verification */ }
  }
  if (inDatabaseTransaction) {
    await db.query('rollback').catch(() => {})
    inDatabaseTransaction = false
  }
  process.exitCode = 1
} finally {
  await db.end().catch(() => {})
}
