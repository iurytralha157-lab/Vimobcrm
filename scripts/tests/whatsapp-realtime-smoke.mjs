import { createClient } from '@supabase/supabase-js'
import crypto from 'node:crypto'
import pg from 'pg'

const { Client } = pg
const url = process.env.SUPABASE_URL || 'http://127.0.0.1:54321'
const anonKey = process.env.SUPABASE_ANON_KEY
const databaseUrl = process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

if (!anonKey) throw new Error('SUPABASE_ANON_KEY is required')

const id = () => crypto.randomUUID()
const suffix = Date.now().toString(36)
const password = `Realtime-${crypto.randomBytes(12).toString('hex')}!`
const assignedEmail = `wa-realtime-assigned-${suffix}@example.invalid`
const deniedEmail = `wa-realtime-denied-${suffix}@example.invalid`
const foreignEmail = `wa-realtime-foreign-${suffix}@example.invalid`
const assigned = createClient(url, anonKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
    storageKey: `wa-realtime-assigned-${suffix}`,
  },
})
const denied = createClient(url, anonKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
    storageKey: `wa-realtime-denied-${suffix}`,
  },
})
const foreign = createClient(url, anonKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
    storageKey: `wa-realtime-foreign-${suffix}`,
  },
})
const anonymous = createClient(url, anonKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
    storageKey: `wa-realtime-anonymous-${suffix}`,
  },
})
const database = new Client({ connectionString: databaseUrl })

const organizationId = id()
const foreignOrganizationId = id()
const assignedUserId = id()
const deniedUserId = id()
const foreignUserId = id()
const leadId = id()
const sessionId = id()
const conversationId = id()

const waitForStatus = (channel, accepted, timeoutMs = 10_000) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`Realtime status timeout; wanted ${[...accepted].join(', ')}`)), timeoutMs)
  channel.subscribe((status, error) => {
    if (!accepted.has(status)) return
    clearTimeout(timer)
    if (error) reject(error)
    else resolve(status)
  })
})

const waitForUnauthorized = (channel, label, timeoutMs = 10_000) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('Denied Realtime subscription did not return Unauthorized')), timeoutMs)
  channel.subscribe((status, error) => {
    if (status === 'SUBSCRIBED') {
      clearTimeout(timer)
      reject(new Error(`${label} subscribed to an unauthorized private topic`))
      return
    }
    if (status !== 'CHANNEL_ERROR') return
    clearTimeout(timer)
    if (!error || !/unauthorized|permissions/i.test(error.message)) {
      reject(error || new Error('Denied Realtime subscription failed without an authorization error'))
      return
    }
    resolve(status)
  })
})

await database.connect()

try {
  await database.query('begin')
  await database.query(
    `insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, email_change, email_change_token_new, recovery_token
    ) values
      ('00000000-0000-0000-0000-000000000000', $1::uuid, 'authenticated', 'authenticated', $2, crypt($3, gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', ''),
      ('00000000-0000-0000-0000-000000000000', $4::uuid, 'authenticated', 'authenticated', $5, crypt($3, gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', ''),
      ('00000000-0000-0000-0000-000000000000', $6::uuid, 'authenticated', 'authenticated', $7, crypt($3, gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', '')`,
    [assignedUserId, assignedEmail, password, deniedUserId, deniedEmail, foreignUserId, foreignEmail],
  )
  await database.query(
    `insert into public.organizations (id, name, slug) values
      ($1::uuid, $2, $3),
      ($4::uuid, $5, $6)`,
    [
      organizationId, `WA Realtime ${suffix}`, `wa-realtime-${suffix}`,
      foreignOrganizationId, `WA Realtime Foreign ${suffix}`, `wa-realtime-foreign-${suffix}`,
    ],
  )
  await database.query(
    `insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at) values
      ($1::uuid::text, $1::uuid, jsonb_build_object('sub', $1::uuid::text, 'email', $2::text, 'email_verified', true), 'email', now(), now(), now()),
      ($3::uuid::text, $3::uuid, jsonb_build_object('sub', $3::uuid::text, 'email', $4::text, 'email_verified', true), 'email', now(), now(), now()),
      ($5::uuid::text, $5::uuid, jsonb_build_object('sub', $5::uuid::text, 'email', $6::text, 'email_verified', true), 'email', now(), now(), now())`,
    [assignedUserId, assignedEmail, deniedUserId, deniedEmail, foreignUserId, foreignEmail],
  )
  await database.query(
    `insert into public.users (id, organization_id, name, email, role, is_active) values
      ($1::uuid, $4::uuid, 'Assigned', $5, 'user', true),
      ($2::uuid, $4::uuid, 'Denied', $6, 'user', true),
      ($3::uuid, $7::uuid, 'Foreign', $8, 'user', true)`,
    [assignedUserId, deniedUserId, foreignUserId, organizationId, assignedEmail, deniedEmail, foreignOrganizationId, foreignEmail],
  )
  await database.query(
    `insert into public.organization_members (organization_id, user_id, role, is_active) values
      ($1::uuid, $2::uuid, 'user', true),
      ($1::uuid, $3::uuid, 'user', true),
      ($4::uuid, $5::uuid, 'user', true)`,
    [organizationId, assignedUserId, deniedUserId, foreignOrganizationId, foreignUserId],
  )
  await database.query(
    `insert into public.leads (id, organization_id, assigned_user_id, name, source)
     values ($1::uuid, $2::uuid, $3::uuid, 'Realtime Lead', 'meta_ads')`,
    [leadId, organizationId, assignedUserId],
  )
  await database.query(
    `insert into public.whatsapp_sessions (
      id, organization_id, owner_user_id, name, instance_name, provider, status, is_active
    ) values ($1::uuid, $2::uuid, $3::uuid, $4, $4, 'evolution_go', 'connected', true)`,
    [sessionId, organizationId, assignedUserId, `wa-realtime-${suffix}`],
  )
  await database.query(
    `insert into public.whatsapp_conversations (
      id, organization_id, session_id, lead_id, assigned_user_id, remote_jid, contact_name
    ) values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, '5511999990001@s.whatsapp.net', 'Realtime Lead')`,
    [conversationId, organizationId, sessionId, leadId, assignedUserId],
  )
  await database.query('commit')

  const assignedLogin = await assigned.auth.signInWithPassword({ email: assignedEmail, password })
  if (assignedLogin.error) throw assignedLogin.error
  const deniedLogin = await denied.auth.signInWithPassword({ email: deniedEmail, password })
  if (deniedLogin.error) throw deniedLogin.error
  const foreignLogin = await foreign.auth.signInWithPassword({ email: foreignEmail, password })
  if (foreignLogin.error) throw foreignLogin.error
  await assigned.realtime.setAuth(assignedLogin.data.session.access_token)
  await denied.realtime.setAuth(deniedLogin.data.session.access_token)
  await foreign.realtime.setAuth(foreignLogin.data.session.access_token)

  const topic = `whatsapp:${organizationId}:lead:${leadId}`
  const inboxTopic = `whatsapp:${organizationId}:inbox`
  await database.query('begin')
  try {
    const probeMessage = await database.query(
      `insert into realtime.messages (topic, extension, private)
       values ($1, 'broadcast', true)
       returning id`,
      [topic],
    )
    await database.query(
      `select
        set_config('role', 'authenticated', true),
        set_config('request.jwt.claims', $1, true),
        set_config('request.jwt.claim.sub', $2, true),
        set_config('request.jwt.claim.role', 'authenticated', true),
        set_config('realtime.topic', $3, true)`,
      [JSON.stringify(assignedLogin.data.session.user), assignedUserId, topic],
    )
    const authorizationProbe = await database.query(
      `select
        auth.uid()::text as user_id,
        realtime.topic() as topic,
        private.can_access_lead($1::uuid, $2::uuid) as can_access_lead,
        private.can_receive_whatsapp_broadcast(realtime.topic()) as can_receive,
        exists (
          select 1
          from realtime.messages
          where id = $3::uuid
            and extension = 'broadcast'
        ) as can_select_broadcast`,
      [organizationId, assignedUserId, probeMessage.rows[0].id],
    )
    const probe = authorizationProbe.rows[0]
    if (probe.user_id !== assignedUserId || probe.topic !== topic || !probe.can_access_lead || !probe.can_receive || !probe.can_select_broadcast) {
      throw new Error(`Database authorization probe failed: ${JSON.stringify(probe)}`)
    }
  } finally {
    await database.query('rollback')
  }

  let received
  const assignedChannel = assigned
    .channel(topic, { config: { private: true } })
    .on('broadcast', { event: 'whatsapp.message.changed' }, ({ payload }) => {
      received = payload
    })
  await waitForStatus(assignedChannel, new Set(['SUBSCRIBED']))

  const deniedChannel = denied.channel(topic, { config: { private: true } })
  await waitForUnauthorized(deniedChannel, 'Unassigned same-organization broker')

  let assignedInboxReceived
  let deniedInboxReceived
  const assignedInboxChannel = assigned
    .channel(inboxTopic, { config: { private: true } })
    .on('broadcast', { event: 'whatsapp.inbox.changed' }, ({ payload }) => {
      assignedInboxReceived = payload
    })
  await waitForStatus(assignedInboxChannel, new Set(['SUBSCRIBED']))

  const deniedInboxChannel = denied
    .channel(inboxTopic, { config: { private: true } })
    .on('broadcast', { event: 'whatsapp.inbox.changed' }, ({ payload }) => {
      deniedInboxReceived = payload
    })
  await waitForStatus(deniedInboxChannel, new Set(['SUBSCRIBED']))

  const foreignInboxChannel = foreign.channel(inboxTopic, { config: { private: true } })
  await waitForUnauthorized(foreignInboxChannel, 'Cross-organization broker')

  const anonymousInboxChannel = anonymous.channel(inboxTopic, { config: { private: true } })
  await waitForUnauthorized(anonymousInboxChannel, 'Anonymous client')

  // A locally-idle Realtime tenant can acknowledge the Phoenix channel a few
  // milliseconds before its database replication stream is ready. Warm the
  // complete DB -> private broadcast path before asserting application events;
  // production clients still refetch canonical history on subscribe/reconnect.
  const warmupDeadline = Date.now() + 10_000
  while ((!received || !assignedInboxReceived || !deniedInboxReceived) && Date.now() < warmupDeadline) {
    await database.query(
      `select realtime.send(
        jsonb_build_object('operation', 'PROBE', 'conversationId', $2::uuid),
        'whatsapp.message.changed',
        $1,
        true
      )`,
      [topic, conversationId],
    )
    await database.query(
      `select realtime.send(
        jsonb_build_object('scope', 'conversations'),
        'whatsapp.inbox.changed',
        $1,
        true
      )`,
      [inboxTopic],
    )
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  if (!received) throw new Error('Private Realtime database broadcast path did not become ready')
  if (!assignedInboxReceived || !deniedInboxReceived) {
    throw new Error('Organization inbox Realtime broadcast path did not become ready for all active members')
  }
  received = undefined
  assignedInboxReceived = undefined
  deniedInboxReceived = undefined

  const messageId = id()
  await database.query(
    `insert into public.whatsapp_messages (
      id, organization_id, conversation_id, session_id, lead_id, message_id,
      from_me, direction, message_type, content, status, sent_at
    ) values (
      $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6,
      false, 'inbound', 'text', 'sensitive-content-must-not-be-broadcast', 'received', now()
    )`,
    [messageId, organizationId, conversationId, sessionId, leadId, `provider-${suffix}`],
  )

  const deadline = Date.now() + 10_000
  while ((!received || !assignedInboxReceived || !deniedInboxReceived) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  if (!received) throw new Error('Authorized broker did not receive the WhatsApp broadcast')
  if (!assignedInboxReceived || !deniedInboxReceived) {
    throw new Error('Active organization members did not receive the WhatsApp inbox wake-up signal')
  }
  if (received.messageId !== messageId || received.conversationId !== conversationId) {
    throw new Error(`Unexpected broadcast payload: ${JSON.stringify(received)}`)
  }
  if ('content' in received || JSON.stringify(received).includes('sensitive-content')) {
    throw new Error('Broadcast leaked message content')
  }
  for (const inboxPayload of [assignedInboxReceived, deniedInboxReceived]) {
    if (JSON.stringify(inboxPayload) !== JSON.stringify({ scope: 'conversations' })) {
      throw new Error(`Inbox wake-up leaked identifiers or message data: ${JSON.stringify(inboxPayload)}`)
    }
  }

  received = undefined
  await database.query(
    `update public.whatsapp_messages
     set content = 'edited-sensitive-content-must-not-be-broadcast',
         reaction_emoji = '👍'
     where id = $1::uuid`,
    [messageId],
  )
  const updateDeadline = Date.now() + 10_000
  while (!received && Date.now() < updateDeadline) {
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  if (!received) throw new Error('Authorized broker did not receive the WhatsApp edit/reaction broadcast')
  if (received.messageId !== messageId || received.conversationId !== conversationId) {
    throw new Error(`Unexpected edit/reaction broadcast payload: ${JSON.stringify(received)}`)
  }
  if ('content' in received || 'reactionEmoji' in received || JSON.stringify(received).includes('sensitive-content')) {
    throw new Error('Edit/reaction broadcast leaked message content or reaction data')
  }

  console.log('WhatsApp private Realtime smoke: PASS')
} finally {
  await assigned.removeAllChannels()
  await denied.removeAllChannels()
  await foreign.removeAllChannels()
  await anonymous.removeAllChannels()
  await database.query('delete from public.organizations where id = any($1::uuid[])', [[organizationId, foreignOrganizationId]]).catch(() => {})
  await database.query('delete from auth.users where id = any($1::uuid[])', [[assignedUserId, deniedUserId, foreignUserId]]).catch(() => {})
  await database.end()
}
