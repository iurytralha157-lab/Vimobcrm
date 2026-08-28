import { readFileSync } from 'node:fs'
import process from 'node:process'
import { randomUUID } from 'node:crypto'
import pg from 'pg'

const PROJECT_REF = 'iemalzlfnbouobyjwlwi'
const RETENTION_DAYS = 15
const DEFAULT_BATCH_SIZE = 1000
const EXECUTION_GUARD = `${PROJECT_REF}/whatsapp_messages-and-empty-conversations`
const RUN_ID = randomUUID().replaceAll('-', '').slice(0, 12)

// DATABASE_URL currently points at Supavisor transaction mode (:6543). Session-local
// temporary tables are therefore unsafe across commits. Random, private UNLOGGED tables
// keep the audit snapshot available to whichever backend serves the next transaction.
const staging = Object.freeze({
  validLeads: `private.cleanup_whatsapp_${RUN_ID}_valid_leads`,
  protectedConversations: `private.cleanup_whatsapp_${RUN_ID}_protected_conversations`,
  protectedMessageConversations: `private.cleanup_whatsapp_${RUN_ID}_protected_message_conversations`,
  protectedMessages: `private.cleanup_whatsapp_${RUN_ID}_protected_messages`,
  messageVictims: `private.cleanup_whatsapp_${RUN_ID}_message_victims`,
  conversationVictims: `private.cleanup_whatsapp_${RUN_ID}_conversation_victims`,
})
const stagingTables = Object.values(staging)

function stagingIndex(suffix) {
  // CREATE INDEX places the index in the target table's schema and does not
  // accept a schema-qualified index name.
  return `cw_${RUN_ID}_${suffix}`
}

const execute = process.argv.includes('--execute')
const executionConfirmed = process.argv.includes(`--confirm-permanent-delete=${EXECUTION_GUARD}`)

function getIntegerArg(name, fallback) {
  const prefix = `--${name}=`
  const raw = process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length)
  if (raw === undefined) return fallback
  const parsed = Number(raw)
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`--${name} must be a positive integer`)
  }
  return parsed
}

const batchSize = getIntegerArg('batch-size', DEFAULT_BATCH_SIZE)
if (batchSize > 1000) {
  throw new Error('--batch-size cannot exceed 1000')
}

if (execute && !executionConfirmed) {
  throw new Error(
    `Permanent deletion requires both --execute and --confirm-permanent-delete=${EXECUTION_GUARD}`,
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

function json(label, value) {
  process.stdout.write(`${label} ${JSON.stringify(value)}\n`)
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const env = loadEnvFile('.env.local')
const projectUrl = env.SUPABASE_URL || env.SUPABASE_PROJECT_URL || env.NEXT_PUBLIC_SUPABASE_URL
const databaseUrl = env.DATABASE_URL

if (!projectUrl || !databaseUrl) {
  throw new Error('SUPABASE_URL (or equivalent) and DATABASE_URL are required in .env.local')
}

const parsedProjectUrl = new URL(projectUrl)
if (parsedProjectUrl.hostname !== `${PROJECT_REF}.supabase.co`) {
  throw new Error(`Project URL guard failed for ${parsedProjectUrl.hostname}`)
}

const parsedDatabaseUrl = new URL(databaseUrl)
const databaseUsername = decodeURIComponent(parsedDatabaseUrl.username)
const isExpectedDirectHost = parsedDatabaseUrl.hostname === `db.${PROJECT_REF}.supabase.co`
const isExpectedPooler =
  databaseUsername === `postgres.${PROJECT_REF}` &&
  ['5432', '6543'].includes(parsedDatabaseUrl.port)
if (!isExpectedDirectHost && !isExpectedPooler) {
  throw new Error('DATABASE_URL guard failed: connection does not identify the expected project')
}
parsedDatabaseUrl.searchParams.delete('sslmode')

const { Client } = pg
const db = new Client({
  connectionString: parsedDatabaseUrl.toString(),
  connectionTimeoutMillis: 15_000,
  application_name: execute
    ? 'vimob_whatsapp_nonlead_cleanup_execute'
    : 'vimob_whatsapp_nonlead_cleanup_dry_run',
  ssl: { rejectUnauthorized: false },
})

const requiredColumns = new Map([
  [
    'whatsapp_messages',
    [
      'id',
      'organization_id',
      'conversation_id',
      'session_id',
      'lead_id',
      'message_id',
      'provider_message_id',
      'client_message_id',
      'message_type',
      'reaction_to_message_id',
      'created_at',
    ],
  ],
  [
    'whatsapp_conversations',
    [
      'id',
      'organization_id',
      'lead_id',
      'contact_phone',
      'remote_jid',
      'is_group',
      'assigned_user_id',
      'unread_count',
      'last_message_at',
      'created_at',
      'updated_at',
    ],
  ],
  ['leads', ['id', 'organization_id', 'phone']],
  ['lead_attachments', ['message_id']],
  ['media_jobs', ['organization_id', 'conversation_id', 'message_id']],
  ['outbox_messages', ['organization_id', 'conversation_id', 'sent_message_id', 'client_message_id']],
  ['whatsapp_outbox', ['organization_id', 'conversation_id', 'message_id']],
  ['chatbot_conversation_state', ['organization_id', 'conversation_id', 'automation_enabled']],
  ['ai_agent_conversations', ['conversation_id']],
  ['ai_conversation_states', ['organization_id', 'conversation_id']],
  ['ai_interaction_logs', ['organization_id', 'conversation_id']],
  ['ai_jobs', ['organization_id', 'conversation_id']],
  ['ai_outbox_messages', ['organization_id', 'conversation_id', 'sent_message_id']],
  ['conversation_ai_state', ['organization_id', 'conversation_id']],
  ['automation_event_outbox', ['organization_id', 'conversation_id']],
  ['automation_executions', ['organization_id', 'conversation_id']],
  ['whatsapp_chat_labels', ['conversation_id']],
  ['whatsapp_inbound_logs', ['organization_id', 'conversation_id']],
  [
    'whatsapp_message_reactions',
    [
      'organization_id',
      'session_id',
      'conversation_id',
      'target_message_id',
      'target_provider_message_id',
      'provider_reaction_message_id',
    ],
  ],
  [
    'chatbot_inbound_messages',
    ['organization_id', 'conversation_id', 'external_id', 'payload', 'received_at'],
  ],
  ['jobs', ['organization_id', 'status', 'payload']],
  ['automation_execution_steps', ['organization_id', 'status', 'input', 'output']],
  ['automation_effect_dispatches', ['organization_id', 'status', 'request', 'response']],
])

async function assertSchema() {
  const { rows } = await db.query(`
    select table_name, column_name
    from information_schema.columns
    where table_schema = 'public'
  `)
  const catalog = new Map()
  for (const row of rows) {
    if (!catalog.has(row.table_name)) catalog.set(row.table_name, new Set())
    catalog.get(row.table_name).add(row.column_name)
  }
  for (const [table, columns] of requiredColumns) {
    for (const column of columns) {
      if (!catalog.get(table)?.has(column)) {
        throw new Error(`Schema guard failed: public.${table}.${column} is missing`)
      }
    }
  }
}

async function dropStagingTables() {
  // Names contain only a locally generated hexadecimal UUID, so interpolation is safe.
  await db.query(`drop table if exists ${[...stagingTables].reverse().join(', ')}`)
}

async function prepareAudit() {
  await db.query(`set statement_timeout = '30min'`)
  await db.query(`set lock_timeout = '5s'`)
  await db.query(`set idle_in_transaction_session_timeout = '2min'`)

  const { rows: [params] } = await db.query(`
    select
      clock_timestamp() as audit_started_at,
      clock_timestamp() - make_interval(days => $1::int) as cutoff
  `, [RETENTION_DAYS])

  await db.query(`
    create unlogged table ${staging.validLeads} as
    select
      id,
      organization_id,
      public.normalize_phone(phone) as phone_key
    from public.leads;

    create unique index ${stagingIndex('valid_leads_id_org_idx')}
      on ${staging.validLeads} (id, organization_id);
    create index ${stagingIndex('valid_leads_phone_idx')}
      on ${staging.validLeads} (organization_id, phone_key)
      where phone_key is not null;

    create unlogged table ${staging.protectedConversations} (
      organization_id uuid not null,
      conversation_id uuid not null,
      reason text not null,
      primary key (organization_id, conversation_id, reason)
    );

    create unlogged table ${staging.protectedMessageConversations} (
      organization_id uuid not null,
      conversation_id uuid not null,
      reason text not null,
      primary key (organization_id, conversation_id, reason)
    );

    create unlogged table ${staging.protectedMessages} (
      message_id uuid not null,
      reason text not null,
      primary key (message_id, reason)
    );
  `)

  const protectConversationStatements = [
    [
      'conversation_valid_lead',
      `select c.organization_id, c.id
       from public.whatsapp_conversations c
       join ${staging.validLeads} l
         on l.id=c.lead_id and l.organization_id=c.organization_id`,
    ],
    [
      'phone_match',
      `select distinct c.organization_id, c.id
       from public.whatsapp_conversations c
       join ${staging.validLeads} l
         on l.organization_id=c.organization_id
        and l.phone_key is not null
        and l.phone_key=coalesce(
          public.normalize_phone(c.contact_phone),
          public.normalize_phone(split_part(c.remote_jid, '@', 1))
        )`,
    ],
    [
      'active_chatbot',
      `select distinct c.organization_id, c.id
       from public.chatbot_conversation_state s
       join public.whatsapp_conversations c
         on c.organization_id=s.organization_id
        and c.id::text=s.conversation_id
       where s.automation_enabled is true`,
    ],
    [
      'media_job',
      `select distinct c.organization_id, c.id
       from public.media_jobs x
       join public.whatsapp_conversations c
         on c.id=x.conversation_id and c.organization_id=x.organization_id`,
    ],
    [
      'legacy_outbox',
      `select distinct c.organization_id, c.id
       from public.outbox_messages x
       join public.whatsapp_conversations c
         on c.id=x.conversation_id and c.organization_id=x.organization_id`,
    ],
    [
      'whatsapp_outbox',
      `select distinct c.organization_id, c.id
       from public.whatsapp_outbox x
       join public.whatsapp_conversations c
         on c.id=x.conversation_id and c.organization_id=x.organization_id`,
    ],
    [
      'ai_agent_conversation',
      `select distinct c.organization_id, c.id
       from public.ai_agent_conversations x
       join public.whatsapp_conversations c on c.id=x.conversation_id`,
    ],
    [
      'ai_conversation_state',
      `select distinct c.organization_id, c.id
       from public.ai_conversation_states x
       join public.whatsapp_conversations c
         on c.id=x.conversation_id and c.organization_id=x.organization_id`,
    ],
    [
      'ai_interaction_log',
      `select distinct c.organization_id, c.id
       from public.ai_interaction_logs x
       join public.whatsapp_conversations c
         on c.id=x.conversation_id
        and (x.organization_id is null or c.organization_id=x.organization_id)
       where x.conversation_id is not null`,
    ],
    [
      'ai_job',
      `select distinct c.organization_id, c.id
       from public.ai_jobs x
       join public.whatsapp_conversations c
         on c.id=x.conversation_id and c.organization_id=x.organization_id
       where x.conversation_id is not null`,
    ],
    [
      'ai_outbox',
      `select distinct c.organization_id, c.id
       from public.ai_outbox_messages x
       join public.whatsapp_conversations c
         on c.id=x.conversation_id and c.organization_id=x.organization_id
       where x.conversation_id is not null`,
    ],
    [
      'conversation_ai_state',
      `select distinct c.organization_id, c.id
       from public.conversation_ai_state x
       join public.whatsapp_conversations c
         on c.id=x.conversation_id and c.organization_id=x.organization_id
       where x.conversation_id is not null`,
    ],
    [
      'automation_event_outbox',
      `select distinct c.organization_id, c.id
       from public.automation_event_outbox x
       join public.whatsapp_conversations c
         on c.id=x.conversation_id and c.organization_id=x.organization_id
       where x.conversation_id is not null`,
    ],
    [
      'automation_execution',
      `select distinct c.organization_id, c.id
       from public.automation_executions x
       join public.whatsapp_conversations c
         on c.id=x.conversation_id and c.organization_id=x.organization_id
       where x.conversation_id is not null`,
    ],
    [
      'active_chatbot_inbound',
      `select distinct c.organization_id, c.id
       from public.chatbot_inbound_messages x
       join public.whatsapp_conversations c
         on c.organization_id=x.organization_id
        and (
          c.id::text=x.conversation_id
          or x.payload @> jsonb_build_object('conversation_id', c.id::text)
        )
       where x.received_at >= $2::timestamptz`,
    ],
    [
      'active_generic_job',
      `select distinct c.organization_id, c.id
       from public.jobs x
       join public.whatsapp_conversations c
         on c.organization_id=x.organization_id
        and x.payload @> jsonb_build_object('conversation_id', c.id::text)
       where lower(x.status) not in ('completed', 'done', 'failed', 'dead', 'cancelled', 'canceled')`,
    ],
    [
      'active_automation_step',
      `select distinct c.organization_id, c.id
       from public.automation_execution_steps x
       join public.whatsapp_conversations c
         on c.organization_id=x.organization_id
        and (
          x.input @> jsonb_build_object('conversation_id', c.id::text)
          or x.output @> jsonb_build_object('conversation_id', c.id::text)
        )
       where lower(x.status) in ('running', 'waiting')`,
    ],
    [
      'active_automation_dispatch',
      `select distinct c.organization_id, c.id
       from public.automation_effect_dispatches x
       join public.whatsapp_conversations c
         on c.organization_id=x.organization_id
        and (
          x.request @> jsonb_build_object('conversation_id', c.id::text)
          or x.response @> jsonb_build_object('conversation_id', c.id::text)
        )
       where lower(x.status) in ('sending', 'unknown')`,
    ],
  ]

  const messageConversationReasons = new Set([
    'conversation_valid_lead',
    'phone_match',
    'active_chatbot',
    'active_chatbot_inbound',
  ])

  for (const [reason, selectSql] of protectConversationStatements) {
    const queryParams = selectSql.includes('$2')
      ? [reason, params.cutoff]
      : [reason]
    await db.query(`
      insert into ${staging.protectedConversations} (organization_id, conversation_id, reason)
      select protected.organization_id, protected.id, $1
      from (${selectSql}) protected
      on conflict do nothing
    `, queryParams)

    if (messageConversationReasons.has(reason)) {
      await db.query(`
        insert into ${staging.protectedMessageConversations} (
          organization_id,
          conversation_id,
          reason
        )
        select protected.organization_id, protected.id, $1
        from (${selectSql}) protected
        on conflict do nothing
      `, queryParams)
    }
  }

  const protectMessageStatements = [
    [
      'message_valid_lead',
      `select m.id
       from public.whatsapp_messages m
       join ${staging.validLeads} l
         on l.id=m.lead_id and l.organization_id=m.organization_id`,
    ],
    ['lead_attachment', `select message_id from public.lead_attachments where message_id is not null`],
    ['media_job', `select message_id from public.media_jobs where message_id is not null`],
    ['whatsapp_outbox', `select message_id from public.whatsapp_outbox where message_id is not null`],
    [
      'ai_outbox_sent_message',
      `select sent_message_id from public.ai_outbox_messages where sent_message_id is not null`,
    ],
    [
      'whatsapp_reaction_target',
      `select target_message_id
       from public.whatsapp_message_reactions
       where target_message_id is not null`,
    ],
    [
      'whatsapp_reaction_event',
      `select m.id
       from public.whatsapp_messages m
       where m.message_type = 'reaction'
          or m.reaction_to_message_id is not null`,
    ],
    [
      'whatsapp_reaction_provider_target',
      `select distinct m.id
       from public.whatsapp_message_reactions x
       join public.whatsapp_messages m
         on m.organization_id=x.organization_id
        and m.conversation_id=x.conversation_id
        and (x.session_id=m.session_id or m.session_id is null)
        and x.target_provider_message_id in (m.provider_message_id, m.message_id)`,
    ],
    [
      'whatsapp_reaction_provider_event',
      `select distinct m.id
       from public.whatsapp_message_reactions x
       join public.whatsapp_messages m
         on m.organization_id=x.organization_id
        and m.conversation_id=x.conversation_id
        and (x.session_id=m.session_id or m.session_id is null)
        and x.provider_reaction_message_id is not null
        and x.provider_reaction_message_id in (m.provider_message_id, m.message_id)`,
    ],
    [
      'legacy_outbox_message',
      `select distinct m.id
       from public.outbox_messages x
       join public.whatsapp_messages m
         on m.organization_id=x.organization_id
        and m.conversation_id=x.conversation_id
        and (
          (x.client_message_id is not null and x.client_message_id=m.client_message_id)
          or (x.sent_message_id is not null and x.sent_message_id in (m.provider_message_id, m.message_id))
        )`,
    ],
    [
      'active_generic_job_message',
      `select distinct m.id
       from public.jobs x
       join public.whatsapp_messages m
         on m.organization_id=x.organization_id
        and coalesce(x.payload->>'conversationId', x.payload->>'conversation_id')=m.conversation_id::text
        and coalesce(x.payload->>'messageId', x.payload->>'message_id') in (
          m.id::text,
          m.message_id,
          m.provider_message_id,
          m.client_message_id
        )
       where lower(x.status) not in ('completed', 'done', 'failed', 'dead', 'cancelled', 'canceled')`,
    ],
  ]

  for (const [reason, selectSql] of protectMessageStatements) {
    await db.query(`
      insert into ${staging.protectedMessages} (message_id, reason)
      select protected.id, $1
      from (${selectSql}) protected(id)
      on conflict do nothing
    `, [reason])
  }

  await db.query(`
    create index ${stagingIndex('protected_conversations_lookup_idx')}
      on ${staging.protectedConversations} (organization_id, conversation_id);
    create index ${stagingIndex('protected_message_conversations_lookup_idx')}
      on ${staging.protectedMessageConversations} (organization_id, conversation_id);
    create index ${stagingIndex('protected_messages_lookup_idx')}
      on ${staging.protectedMessages} (message_id);
    analyze ${staging.validLeads};
    analyze ${staging.protectedConversations};
    analyze ${staging.protectedMessageConversations};
    analyze ${staging.protectedMessages};
  `)

  await db.query(`
    create unlogged table ${staging.messageVictims} as
    select
      m.id as message_id,
      m.organization_id,
      m.conversation_id,
      m.created_at,
      coalesce(c.is_group, false) as is_group
    from public.whatsapp_messages m
    join public.whatsapp_conversations c
      on c.id=m.conversation_id
     and c.organization_id=m.organization_id
    where m.created_at < $1::timestamptz
      and not exists (
        select 1 from ${staging.protectedMessages} p where p.message_id=m.id
      )
      and not exists (
        select 1
        from ${staging.protectedMessageConversations} p
        where p.organization_id=m.organization_id
          and p.conversation_id=m.conversation_id
      )
  `, [params.cutoff])

  await db.query(`
    create unique index ${stagingIndex('message_victims_pk')}
      on ${staging.messageVictims} (message_id);
    create index ${stagingIndex('message_victims_order_idx')}
      on ${staging.messageVictims} (created_at, message_id);
    analyze ${staging.messageVictims};
  `)

  await db.query(`
    create unlogged table ${staging.conversationVictims} as
    select
      c.id as conversation_id,
      c.organization_id,
      c.created_at
    from public.whatsapp_conversations c
    where c.organization_id is not null
      and c.created_at < $1::timestamptz
      and coalesce(c.last_message_at, c.updated_at, c.created_at) < $1::timestamptz
      and c.assigned_user_id is null
      and coalesce(c.unread_count, 0)=0
      and not exists (
        select 1
        from ${staging.protectedConversations} p
        where p.organization_id=c.organization_id and p.conversation_id=c.id
      )
  `, [params.cutoff])

  await db.query(`
    create unique index ${stagingIndex('conversation_victims_pk')}
      on ${staging.conversationVictims} (conversation_id);
    create index ${stagingIndex('conversation_victims_order_idx')}
      on ${staging.conversationVictims} (created_at, conversation_id);
    analyze ${staging.conversationVictims};
  `)

  return params
}

async function auditSummary(params) {
  const { rows: [baseline] } = await db.query(`
    select
      (select count(*)::bigint from public.whatsapp_messages) as total_messages,
      (select count(*)::bigint from public.whatsapp_conversations) as total_conversations,
      (select count(*)::bigint from public.leads) as total_leads,
      (select count(*)::bigint from public.whatsapp_sessions) as total_sessions,
      (select count(*)::bigint from ${staging.messageVictims}) as deletable_messages,
      (select count(*)::bigint from ${staging.messageVictims} where is_group) as deletable_group,
      (select count(*)::bigint from ${staging.messageVictims} where not is_group) as deletable_individual,
      (select count(*)::bigint from ${staging.conversationVictims}) as eligible_conversations_before_message_delete
  `)

  const { rows: conversationProtections } = await db.query(`
    select reason, count(*)::bigint as conversations
    from ${staging.protectedConversations}
    group by reason
    order by reason
  `)
  const { rows: messageProtections } = await db.query(`
    select reason, count(*)::bigint as messages
    from ${staging.protectedMessages}
    group by reason
    order by reason
  `)

  const result = {
    projectRef: PROJECT_REF,
    mode: execute ? 'execute' : 'dry-run',
    retentionDays: RETENTION_DAYS,
    batchSize,
    auditStartedAt: params.audit_started_at,
    cutoff: params.cutoff,
    baseline,
    conversationProtections,
    messageProtections,
  }
  json('AUDIT', result)
  return result
}

const liveMessageGuard = `
  not exists (
    select 1 from live_leads l
    where l.id=m.lead_id and l.organization_id=m.organization_id
  )
  and not exists (
    select 1 from live_leads l
    where l.id=c.lead_id and l.organization_id=c.organization_id
  )
  and not exists (
    select 1 from live_leads l
    where l.organization_id=c.organization_id
      and l.phone_key is not null
      and l.phone_key=coalesce(
        public.normalize_phone(c.contact_phone),
        public.normalize_phone(split_part(c.remote_jid, '@', 1))
      )
  )
  and not exists (
    select 1 from public.chatbot_conversation_state x
    where x.organization_id=c.organization_id
      and x.conversation_id=c.id::text
      and x.automation_enabled is true
  )
  and not exists (
    select 1 from public.chatbot_inbound_messages x
    where x.organization_id=c.organization_id
      and x.received_at >= $1::timestamptz
      and (
        x.conversation_id=c.id::text
        or x.payload @> jsonb_build_object('conversation_id', c.id::text)
      )
  )
  and not exists (select 1 from public.lead_attachments x where x.message_id=m.id)
  and not exists (select 1 from public.media_jobs x where x.message_id=m.id)
  and not exists (select 1 from public.whatsapp_outbox x where x.message_id=m.id)
  and not exists (select 1 from public.ai_outbox_messages x where x.sent_message_id=m.id)
  and not exists (
    select 1 from public.whatsapp_message_reactions x where x.target_message_id=m.id
  )
  and not (m.message_type = 'reaction' or m.reaction_to_message_id is not null)
  and not exists (
    select 1
    from public.whatsapp_message_reactions x
    where x.organization_id=m.organization_id
      and x.conversation_id=m.conversation_id
      and (x.session_id=m.session_id or m.session_id is null)
      and (
        x.target_provider_message_id in (m.provider_message_id, m.message_id)
        or (
          x.provider_reaction_message_id is not null
          and x.provider_reaction_message_id in (m.provider_message_id, m.message_id)
        )
      )
  )
  and not exists (
    select 1
    from public.outbox_messages x
    where x.organization_id=m.organization_id
      and x.conversation_id=m.conversation_id
      and (
        (x.client_message_id is not null and x.client_message_id=m.client_message_id)
        or (x.sent_message_id is not null and x.sent_message_id in (m.provider_message_id, m.message_id))
      )
  )
  and not exists (
    select 1
    from public.jobs x
    where x.organization_id=m.organization_id
      and lower(x.status) not in ('completed', 'done', 'failed', 'dead', 'cancelled', 'canceled')
      and coalesce(x.payload->>'messageId', x.payload->>'message_id') in (
        m.id::text,
        m.message_id,
        m.provider_message_id,
        m.client_message_id
      )
  )
`

async function deleteMessageBatch(cutoff) {
  await db.query('begin')
  try {
    await db.query(`set local lock_timeout = '3s'`)
    await db.query(`set local statement_timeout = '45s'`)
    const { rows: [result] } = await db.query(`
      with live_leads as materialized (
        select
          id,
          organization_id,
          public.normalize_phone(phone) as phone_key
        from public.leads
      ),
      batch as materialized (
        select m.id
        from ${staging.messageVictims} v
        join public.whatsapp_messages m on m.id=v.message_id
        join public.whatsapp_conversations c
          on c.id=m.conversation_id and c.organization_id=m.organization_id
        where m.created_at < $1::timestamptz
          and ${liveMessageGuard}
        order by v.created_at, v.message_id
        limit $2
        for update of m skip locked
      ),
      deleted as (
        delete from public.whatsapp_messages m
        using batch b
        where m.id=b.id
        returning m.id
      )
      select count(*)::int as deleted from deleted
    `, [cutoff, batchSize])
    await db.query('commit')
    return result.deleted
  } catch (error) {
    await db.query('rollback')
    throw error
  }
}

const liveConversationGuard = `
  c.created_at < $1::timestamptz
  and coalesce(c.last_message_at, c.updated_at, c.created_at) < $1::timestamptz
  and c.assigned_user_id is null
  and coalesce(c.unread_count, 0)=0
  and not exists (
    select 1 from public.whatsapp_messages m where m.conversation_id=c.id
  )
  and not exists (
    select 1 from public.leads l
    where l.id=c.lead_id and l.organization_id=c.organization_id
  )
  and not exists (
    select 1 from public.leads l
    where l.organization_id=c.organization_id
      and public.normalize_phone(l.phone) is not null
      and public.normalize_phone(l.phone)=coalesce(
        public.normalize_phone(c.contact_phone),
        public.normalize_phone(split_part(c.remote_jid, '@', 1))
      )
  )
  and not exists (
    select 1 from public.chatbot_conversation_state x
    where x.organization_id=c.organization_id
      and x.conversation_id=c.id::text
      and x.automation_enabled is true
  )
  and not exists (
    select 1 from public.media_jobs x
    where x.organization_id=c.organization_id and x.conversation_id=c.id
  )
  and not exists (
    select 1 from public.outbox_messages x
    where x.organization_id=c.organization_id and x.conversation_id=c.id
  )
  and not exists (
    select 1 from public.whatsapp_outbox x
    where x.organization_id=c.organization_id and x.conversation_id=c.id
  )
  and not exists (select 1 from public.ai_agent_conversations x where x.conversation_id=c.id)
  and not exists (
    select 1 from public.ai_conversation_states x
    where x.organization_id=c.organization_id and x.conversation_id=c.id
  )
  and not exists (
    select 1 from public.ai_interaction_logs x
    where x.conversation_id=c.id
      and (x.organization_id is null or x.organization_id=c.organization_id)
  )
  and not exists (
    select 1 from public.ai_jobs x
    where x.organization_id=c.organization_id and x.conversation_id=c.id
  )
  and not exists (
    select 1 from public.ai_outbox_messages x
    where x.organization_id=c.organization_id and x.conversation_id=c.id
  )
  and not exists (
    select 1 from public.conversation_ai_state x
    where x.organization_id=c.organization_id and x.conversation_id=c.id
  )
  and not exists (
    select 1 from public.automation_event_outbox x
    where x.organization_id=c.organization_id and x.conversation_id=c.id
  )
  and not exists (
    select 1 from public.automation_executions x
    where x.organization_id=c.organization_id and x.conversation_id=c.id
  )
  and not exists (
    select 1 from public.chatbot_inbound_messages x
    where x.organization_id=c.organization_id
      and x.received_at >= $1::timestamptz
      and (
        x.conversation_id=c.id::text
        or x.payload @> jsonb_build_object('conversation_id', c.id::text)
      )
  )
  and not exists (
    select 1 from public.jobs x
    where x.organization_id=c.organization_id
      and lower(x.status) not in ('completed', 'done', 'failed', 'dead', 'cancelled', 'canceled')
      and x.payload @> jsonb_build_object('conversation_id', c.id::text)
  )
  and not exists (
    select 1 from public.automation_execution_steps x
    where x.organization_id=c.organization_id
      and lower(x.status) in ('running', 'waiting')
      and (
        x.input @> jsonb_build_object('conversation_id', c.id::text)
        or x.output @> jsonb_build_object('conversation_id', c.id::text)
      )
  )
  and not exists (
    select 1 from public.automation_effect_dispatches x
    where x.organization_id=c.organization_id
      and lower(x.status) in ('sending', 'unknown')
      and (
        x.request @> jsonb_build_object('conversation_id', c.id::text)
        or x.response @> jsonb_build_object('conversation_id', c.id::text)
      )
  )
  and not exists (select 1 from public.whatsapp_chat_labels x where x.conversation_id=c.id)
  and not exists (
    select 1 from public.whatsapp_inbound_logs x
    where x.organization_id=c.organization_id and x.conversation_id=c.id
  )
  and not exists (
    select 1 from public.whatsapp_message_reactions x
    where x.organization_id=c.organization_id and x.conversation_id=c.id
  )
`

async function deleteConversationBatch(cutoff) {
  await db.query('begin')
  try {
    await db.query(`set local lock_timeout = '3s'`)
    await db.query(`set local statement_timeout = '45s'`)
    const { rows: [result] } = await db.query(`
      with batch as materialized (
        select c.id
        from ${staging.conversationVictims} v
        join public.whatsapp_conversations c on c.id=v.conversation_id
        where ${liveConversationGuard}
        order by v.created_at, v.conversation_id
        limit $2
        for update of c skip locked
      ),
      deleted as (
        delete from public.whatsapp_conversations c
        using batch b
        where c.id=b.id
        returning c.id
      )
      select count(*)::int as deleted from deleted
    `, [cutoff, batchSize])
    await db.query('commit')
    return result.deleted
  } catch (error) {
    await db.query('rollback')
    throw error
  }
}

async function runBatches(kind, operation) {
  let total = 0
  let batch = 0
  for (;;) {
    let deleted
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      try {
        deleted = await operation()
        break
      } catch (error) {
        const retryable = ['55P03', '57014', '40P01', '40001'].includes(error.code)
        if (!retryable || attempt === 5) throw error
        json('RETRY', { kind, attempt, code: error.code })
        await sleep(250 * (2 ** (attempt - 1)))
      }
    }
    if (deleted === 0) break
    total += deleted
    batch += 1
    json('BATCH', { kind, batch, deleted, total })
    await sleep(100)
  }
  return total
}

try {
  await db.connect()
  await dropStagingTables()
  await assertSchema()
  const params = await prepareAudit()
  await auditSummary(params)

  if (!execute) {
    json('DRY_RUN_COMPLETE', {
      message: `No rows deleted. Execute requires --execute and --confirm-permanent-delete=${EXECUTION_GUARD}`,
    })
  } else {
    const deletedMessages = await runBatches(
      'whatsapp_messages',
      () => deleteMessageBatch(params.cutoff),
    )
    const deletedConversations = await runBatches(
      'whatsapp_conversations',
      () => deleteConversationBatch(params.cutoff),
    )
    const { rows: [remaining] } = await db.query(`
      select
        (select count(*)::bigint
         from ${staging.messageVictims} v
         join public.whatsapp_messages m on m.id=v.message_id) as snapshot_messages_remaining,
        (select count(*)::bigint
         from ${staging.conversationVictims} v
         join public.whatsapp_conversations c on c.id=v.conversation_id) as snapshot_conversations_remaining,
        (select count(*)::bigint from public.leads) as total_leads,
        (select count(*)::bigint from public.whatsapp_sessions) as total_sessions
    `)
    json('EXECUTION_COMPLETE', { deletedMessages, deletedConversations, remaining })
  }
} finally {
  await dropStagingTables().catch((error) => {
    json('STAGING_CLEANUP_FAILED', { runId: RUN_ID, message: error.message })
  })
  await db.end().catch(() => {})
}
