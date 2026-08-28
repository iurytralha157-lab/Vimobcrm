import { readFileSync } from 'node:fs'
import process from 'node:process'
import pg from 'pg'

const PROJECT_REF = 'iemalzlfnbouobyjwlwi'
const DEFAULT_BATCH_SIZE = 1000
const EXECUTION_GUARD = `${PROJECT_REF}/whatsapp_webhook_inbox-safe-retention`

const execute = process.argv.includes('--execute')
const executionConfirmed = process.argv.includes(
  `--confirm-permanent-delete=${EXECUTION_GUARD}`,
)

function getIntegerArg(name, fallback) {
  const prefix = `--${name}=`
  const raw = process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length)
  if (raw === undefined) return fallback
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`--${name} must be a positive integer`)
  }
  return value
}

const batchSize = getIntegerArg('batch-size', DEFAULT_BATCH_SIZE)
if (batchSize > 1000) throw new Error('--batch-size cannot exceed 1000')
if (execute && !executionConfirmed) {
  throw new Error(
    `Permanent deletion requires --execute and --confirm-permanent-delete=${EXECUTION_GUARD}`,
  )
}

function loadEnvFile(path) {
  const result = {}
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
    result[match[1]] = value
  }
  return result
}

function output(label, value) {
  process.stdout.write(`${label} ${JSON.stringify(value)}\n`)
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const env = loadEnvFile('.env.local')
const projectUrl = env.SUPABASE_URL || env.SUPABASE_PROJECT_URL || env.NEXT_PUBLIC_SUPABASE_URL
const databaseUrl = env.DATABASE_URL
if (!projectUrl || !databaseUrl) {
  throw new Error('SUPABASE_URL and DATABASE_URL are required in .env.local')
}

if (new URL(projectUrl).hostname !== `${PROJECT_REF}.supabase.co`) {
  throw new Error('Project URL guard failed')
}
const parsedDatabaseUrl = new URL(databaseUrl)
const databaseUsername = decodeURIComponent(parsedDatabaseUrl.username)
const directHost = parsedDatabaseUrl.hostname === `db.${PROJECT_REF}.supabase.co`
const guardedPooler =
  databaseUsername === `postgres.${PROJECT_REF}` &&
  ['5432', '6543'].includes(parsedDatabaseUrl.port)
if (!directHost && !guardedPooler) {
  throw new Error('DATABASE_URL guard failed')
}
parsedDatabaseUrl.searchParams.delete('sslmode')

const { Client } = pg
const db = new Client({
  connectionString: parsedDatabaseUrl.toString(),
  connectionTimeoutMillis: 15_000,
  application_name: execute
    ? 'vimob_webhook_inbox_safe_cleanup_execute'
    : 'vimob_webhook_inbox_safe_cleanup_dry_run',
  ssl: { rejectUnauthorized: false },
})

const classDefinitions = Object.freeze({
  stale_qrcode: {
    predicate: `
      event_type = 'qrcode'
      and status in ('pending', 'retry')
      and created_at < $1::timestamptz
    `,
    order: 'created_at, id',
    cutoffKey: 'qrcode_cutoff',
  },
  processed_older_24h: {
    predicate: `
      status = 'processed'
      and processed_at < $1::timestamptz
    `,
    order: 'processed_at, id',
    cutoffKey: 'processed_cutoff',
  },
})

async function assertSchema() {
  const { rows } = await db.query(`
    select column_name
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'whatsapp_webhook_inbox'
  `)
  const columns = new Set(rows.map((row) => row.column_name))
  for (const required of [
    'id',
    'event_type',
    'status',
    'created_at',
    'processed_at',
    'dead_lettered_at',
  ]) {
    if (!columns.has(required)) throw new Error(`Schema guard failed: ${required} is missing`)
  }
}

async function audit() {
  const { rows: [cutoffs] } = await db.query(`
    select
      clock_timestamp() as audit_started_at,
      clock_timestamp() - interval '2 minutes' as qrcode_cutoff,
      clock_timestamp() - interval '24 hours' as processed_cutoff,
      clock_timestamp() - interval '24 hours' as dead_cutoff
  `)

  const { rows: [counts] } = await db.query(`
    select
      count(*)::bigint as total_rows,
      count(*) filter (where status = 'pending')::bigint as pending_rows,
      count(*) filter (where status = 'retry')::bigint as retry_rows,
      count(*) filter (where status = 'processing')::bigint as processing_rows,
      count(*) filter (where status = 'processed')::bigint as processed_rows,
      count(*) filter (where status = 'dead')::bigint as dead_rows,
      count(*) filter (
        where event_type = 'qrcode'
          and status in ('pending', 'retry')
          and created_at < $1::timestamptz
      )::bigint as stale_qrcode,
      count(*) filter (
        where status = 'processed'
          and processed_at < $2::timestamptz
      )::bigint as processed_older_24h,
      count(*) filter (
        where status = 'dead'
          and dead_lettered_at < $3::timestamptz
          and lower(event_type) not like '%message%'
      )::bigint as dead_nonmessage_older_24h,
      count(*) filter (
        where status = 'dead'
          and dead_lettered_at < $3::timestamptz
          and lower(event_type) like '%message%'
      )::bigint as protected_dead_message_older_24h,
      count(*) filter (
        where status in ('pending', 'retry', 'processing')
          and lower(event_type) like '%message%'
      )::bigint as protected_unfinished_message
    from public.whatsapp_webhook_inbox
  `, [cutoffs.qrcode_cutoff, cutoffs.processed_cutoff, cutoffs.dead_cutoff])

  const { rows: [sizes] } = await db.query(`
    select
      pg_database_size(current_database())::bigint as database_bytes,
      pg_total_relation_size('public.whatsapp_webhook_inbox')::bigint as inbox_total_bytes,
      pg_relation_size('public.whatsapp_webhook_inbox')::bigint as inbox_heap_bytes,
      pg_indexes_size('public.whatsapp_webhook_inbox')::bigint as inbox_index_bytes
  `)

  const result = { projectRef: PROJECT_REF, mode: execute ? 'execute' : 'dry-run', batchSize, cutoffs, counts, sizes }
  output('AUDIT', result)
  return result
}

async function deleteBatch(definition, cutoff) {
  await db.query('begin')
  try {
    await db.query(`set local lock_timeout = '3s'`)
    await db.query(`set local statement_timeout = '60s'`)
    const { rows: [result] } = await db.query(`
      with candidates as materialized (
        select id
        from public.whatsapp_webhook_inbox
        where ${definition.predicate}
        order by ${definition.order}
        limit $2
        for update skip locked
      ), deleted as (
        delete from public.whatsapp_webhook_inbox inbox
        using candidates
        where inbox.id = candidates.id
        returning inbox.id
      )
      select count(*)::integer as deleted from deleted
    `, [cutoff, batchSize])
    await db.query('commit')
    return result.deleted
  } catch (error) {
    await db.query('rollback').catch(() => {})
    throw error
  }
}

async function drainClass(name, definition, cutoffs) {
  let total = 0
  let batch = 0
  for (;;) {
    let deleted
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      try {
        deleted = await deleteBatch(definition, cutoffs[definition.cutoffKey])
        break
      } catch (error) {
        const retryable = ['55P03', '57014', '40P01', '40001'].includes(error.code)
        if (!retryable || attempt === 5) throw error
        output('RETRY', { name, attempt, code: error.code })
        await sleep(250 * (2 ** (attempt - 1)))
      }
    }
    if (deleted === 0) break
    batch += 1
    total += deleted
    output('BATCH', { name, batch, deleted, total })
    await sleep(100)
  }
  return total
}

try {
  await db.connect()
  await assertSchema()
  const baseline = await audit()
  if (!execute) {
    output('DRY_RUN_COMPLETE', {
      message: `No rows deleted. Execute requires --execute and --confirm-permanent-delete=${EXECUTION_GUARD}`,
    })
  } else {
    const deleted = {}
    for (const [name, definition] of Object.entries(classDefinitions)) {
      deleted[name] = await drainClass(name, definition, baseline.cutoffs)
    }
    const verification = await audit()
    output('EXECUTION_COMPLETE', { deleted, verification })
  }
} finally {
  await db.end().catch(() => {})
}
