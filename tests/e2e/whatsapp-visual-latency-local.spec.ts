import crypto from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { Client } from 'pg';
import { RealtimeClient } from '@supabase/realtime-js';
import { expect, test, type Response } from '@playwright/test';

import { authenticatedAPIRequest, fetchTenantContext, signInAs } from './support/auth';
import { E2E_ORGANIZATION_ID, getE2EConfig } from './support/e2e-env';

type Sample = {
  ackMs: number;
  frameMs: number;
  listMs: number;
  domMs: number;
  ackToDomMs: number;
};

async function completedResponseContains(response: Response, content: string) {
  // Reconciliation can cancel an obsolete GET after its headers arrived.
  // Measure a complete replacement response, not an interrupted body.
  if (await response.finished()) return false;
  try {
    return (await response.text()).includes(content);
  } catch (error) {
    if (response.request().failure()
      || (error instanceof Error && error.message.includes('No data found for resource with given identifier'))) return false;
    throw error;
  }
}

function percentile95(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * 0.95) - 1];
}

type WireFrame = {
  join_ref?: string | null;
  ref?: string | null;
  topic?: string;
  event?: string;
  payload?: { status?: string; event?: string };
};

// Decoder only: this client never connects. Use the installed SDK's binary
// broadcast decoder instead of silently treating a valid Buffer as JSON text.
const frameSerializer = new RealtimeClient('ws://127.0.0.1:58021/realtime/v1', {
  params: { apikey: 'local-decoder-only-never-connected' },
}).serializer;

function frameInfo(raw: string | Buffer): WireFrame | null {
  try {
    if (typeof raw === 'string') {
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return parsed as WireFrame;
    }
    let frame: WireFrame | null = null;
    frameSerializer.decode(typeof raw === 'string' ? raw : new Uint8Array(raw).buffer,
      (decoded: WireFrame | undefined) => { frame = decoded ?? null; });
    return frame;
  } catch {
    return null;
  }
}

test('webhook local aparece no Realtime, lista e DOM para lead e sem lead', async ({ page }, testInfo) => {
  test.skip(process.env.E2E_LOCAL_WHATSAPP_WEBHOOK_WORKER !== 'true',
    'Run only with the isolated local webhook worker opt-in.');
  test.setTimeout(300_000);

  const config = getE2EConfig();
  expect(new URL(config.supabaseURL).port).toBe(process.env.E2E_EXPECT_SUPABASE_PORT || '57721');
  expect(new URL(config.databaseURL).port).toBe(process.env.E2E_EXPECT_DATABASE_PORT || '57722');
  expect(new URL(config.apiURL).port).toBe('8181');
  const database = new Client({ connectionString: config.databaseURL });
  const suffix = Date.now().toString(36);
  const sessionId = crypto.randomUUID();
  const leadId = crypto.randomUUID();
  const leadConversationId = crypto.randomUUID();
  const instanceId = `wa-visual-${suffix}`;
  const leadName = `Lead visual ${suffix}`;
  const unlinkedName = `Sem lead visual ${suffix}`;
  const number = Math.floor(Math.random() * 100_000_000).toString().padStart(8, '0');
  const leadPhone = `55117${number}`;
  const unlinkedPhone = `55118${number}`;
  const webhookToken = `local-token-${suffix}`;
  const instanceToken = `local-instance-${suffix}`;
  const wireTopic = `realtime:whatsapp:${E2E_ORGANIZATION_ID}:inbox`;
  const wakes: number[] = [];
  const inboxSockets = new Map<number, { joins: Map<string, { ref: string; joined: boolean }>; seen: boolean }>();
  const inboxLifecycle: Array<{ at: number; socket: number; event: string }> = [];
  const wireCounts = { text: 0, binary: 0, unrecognized: 0, binaryKinds: {} as Record<number, number> };
  const inboxReady = () => [...inboxSockets.values()].some(socket =>
    [...socket.joins.values()].some(join => join.joined));
  const recordInbox = (socket: number, event: string) => {
    inboxLifecycle.push({ at: performance.now(), socket, event });
    if (inboxLifecycle.length > 100) inboxLifecycle.shift();
  };
  let markReadPosts = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/mark-read')) markReadPosts += 1;
  });

  page.on('websocket', (socket) => {
    const socketId = inboxSockets.size + 1;
    const state = { joins: new Map<string, { ref: string; joined: boolean }>(), seen: false };
    inboxSockets.set(socketId, state);
    socket.on('framesent', ({ payload }) => {
      const frame = frameInfo(payload);
      if (frame?.topic === wireTopic && frame.event === 'phx_join' && frame.ref) {
        state.seen = true;
        state.joins.set(frame.join_ref ?? frame.ref, { ref: frame.ref, joined: false });
        recordInbox(socketId, 'join-sent');
      } else if (frame?.topic === wireTopic && frame.event === 'phx_leave') {
        if (frame.join_ref) state.joins.delete(frame.join_ref);
        else state.joins.clear();
        recordInbox(socketId, 'leave-sent');
      }
    });
    socket.on('framereceived', ({ payload }) => {
      if (typeof payload === 'string') wireCounts.text += 1;
      else {
        wireCounts.binary += 1;
        wireCounts.binaryKinds[payload[0]] = (wireCounts.binaryKinds[payload[0]] ?? 0) + 1;
      }
      const frame = frameInfo(payload);
      if (!frame) wireCounts.unrecognized += 1;
      if (frame?.topic !== wireTopic) return;
      const join = frame.ref ? state.joins.get(frame.join_ref ?? frame.ref) : undefined;
      if (frame.event === 'phx_reply' && join && frame.ref === join.ref) {
        join.joined = frame.payload?.status === 'ok';
        recordInbox(socketId, join.joined ? 'join-ok' : 'join-error');
      } else if (frame.event === 'phx_error' || frame.event === 'phx_close') {
        if (frame.join_ref) state.joins.delete(frame.join_ref);
        else state.joins.clear();
        recordInbox(socketId, frame.event);
      }
      if (frame.event === 'broadcast' && frame.payload?.event === 'whatsapp.inbox.changed') {
        wakes.push(performance.now());
      }
    });
    socket.on('close', () => {
      state.joins.clear();
      if (state.seen) recordInbox(socketId, 'socket-close');
    });
    socket.on('socketerror', () => {
      state.joins.clear();
      if (state.seen) recordInbox(socketId, 'socket-error');
    });
  });

  await signInAs(page, 'admin');
  const { userId } = await fetchTenantContext(page);
  await database.connect();
  try {
    const unfinished = await database.query<{ n: number }>(
      `select count(*)::int as n from public.whatsapp_webhook_inbox
       where status in ('pending', 'retry', 'processing')`,
    );
    expect(unfinished.rows[0].n, 'the global local worker must not own another fixture').toBe(0);

    await database.query(
      `insert into public.whatsapp_sessions (
         id, organization_id, owner_user_id, instance_name, instance_id,
         provider, status, is_active, advanced_settings
       ) values ($1::uuid, $2::uuid, $3::uuid, $4, $4,
         'evolution_go', 'connected', true,
         jsonb_build_object('token', $5::text, 'webhook_token', $6::text))`,
      [sessionId, E2E_ORGANIZATION_ID, userId, instanceId, instanceToken, webhookToken],
    );
    await database.query(
      `insert into private.whatsapp_webhook_session_cutovers
         (session_id, cutoff_at, active_epoch, cutover_at, activated_at)
       values ($1::uuid, clock_timestamp(), 1, clock_timestamp(), clock_timestamp())`,
      [sessionId],
    );
    await database.query(
      `insert into public.leads (id, organization_id, assigned_user_id, name, phone, source)
       values ($1::uuid, $2::uuid, $3::uuid, $4, $5, 'whatsapp')`,
      [leadId, E2E_ORGANIZATION_ID, userId, leadName, leadPhone],
    );
    await database.query(
      `insert into public.whatsapp_conversations (
         id, organization_id, session_id, assigned_user_id,
         remote_jid, contact_phone, contact_name, last_message, last_message_at
       ) values ($1::uuid, $2::uuid, $3::uuid, $4::uuid,
         $5, $6, $7, 'Base visual', clock_timestamp())`,
      [leadConversationId, E2E_ORGANIZATION_ID, sessionId, userId,
        `${leadPhone}@s.whatsapp.net`, leadPhone, leadName],
    );
    const binding = await database.query<{ success: boolean }>(
      `select (public.activate_whatsapp_conversation_lead_binding(
         $1::uuid, $2::uuid, $3::uuid, null
       )->>'success')::boolean as success`,
      [E2E_ORGANIZATION_ID, leadConversationId, leadId],
    );
    expect(binding.rows[0]?.success).toBe(true);

    const listLoaded = page.waitForResponse((response) =>
      new URL(response.url()).pathname === '/v1/whatsapp/conversations'
      && response.request().method() === 'GET' && response.ok());
    await page.getByRole('button', { name: /^Abrir chat do WhatsApp/ }).click();
    const chat = page.getByRole('dialog', { name: 'Chat do WhatsApp' });
    await listLoaded;
    await expect.poll(inboxReady, { timeout: 20_000 }).toBe(true);
    await expect.poll(async () => {
      const ready = await database.query<{ published: boolean; slot_active: boolean }>(
        `select
           exists(
             select 1 from pg_publication publication
             join pg_publication_rel member on member.prpubid = publication.oid
             join pg_class relation on relation.oid = member.prrelid
             join pg_namespace schema on schema.oid = relation.relnamespace
             where publication.pubname = 'supabase_realtime_messages_publication'
               and schema.nspname = 'realtime' and relation.relname = 'messages'
           ) as published,
           exists(select 1 from pg_replication_slots where active and plugin = 'pgoutput'
             and database = current_database()
             and slot_name like 'supabase_realtime_messages_replication_slot_%') as slot_active`,
      );
      return ready.rows[0]?.published && ready.rows[0]?.slot_active;
    }, { timeout: 30_000, message: 'local private Realtime publication and slot must be warm' }).toBe(true);
    await expect(chat.getByText(leadName, { exact: true })).toBeVisible();
    const leadHistory = page.waitForResponse((response) =>
      new URL(response.url()).pathname === `/v1/whatsapp/conversations/${leadConversationId}/messages`
      && response.request().method() === 'GET' && response.ok());
    await chat.getByText(leadName, { exact: true }).click();
    await leadHistory;
    await page.waitForTimeout(1_300);

    const postEnvelope = (kind: 'lead' | 'unlinked', phone: string, contents: string[], providerIds: string[]) => {
      const timestamp = Math.floor(Date.now() / 1000);
      return page.request.post(
        `${config.apiURL}/v1/whatsapp/webhook/evolution-go?session_id=${sessionId}&instance_id=${instanceId}`,
        {
          headers: { 'X-Webhook-Token': webhookToken },
          data: {
            event: 'messages.upsert', instanceId, instanceToken,
            data: { messages: contents.map((content, index) => ({
              Info: {
                ID: providerIds[index], Chat: `${phone}@s.whatsapp.net`, SenderPN: `${phone}@s.whatsapp.net`,
                IsFromMe: false, PushName: kind === 'lead' ? leadName : unlinkedName,
                Timestamp: timestamp,
              },
              Message: { conversation: content },
            })) },
          },
        },
      );
    };

    const postCallback = (kind: 'lead' | 'unlinked', phone: string, content: string, providerId: string) =>
      postEnvelope(kind, phone, [content], [providerId]);

    const sample = async (kind: 'lead' | 'unlinked', phone: string, index: number, historyOpen: boolean): Promise<Sample> => {
      await expect.poll(inboxReady, { timeout: 20_000, message: `current inbox join must be ready before ${kind} sample ${index}` }).toBe(true);
      const content = `Visual ${kind} ${suffix} ${index}`;
      const providerId = `visual-${kind}-${suffix}-${index}`;
      const wakeIndex = wakes.length;
      const readCountBeforeSample = markReadPosts;
      let listAt = 0;
      let detailAt = 0;
      const listResponse = page.waitForResponse(async (response) => {
        if (new URL(response.url()).pathname !== '/v1/whatsapp/conversations'
          || response.request().method() !== 'GET' || !response.ok()) return false;
        if (!(await completedResponseContains(response, content))) return false;
        listAt = performance.now();
        return true;
      }, { timeout: 65_000 });
      const detailResponse = historyOpen
        ? page.waitForResponse(async (response) => {
          if (new URL(response.url()).pathname.endsWith('/messages')
            && response.request().method() === 'GET' && response.ok()
            && await completedResponseContains(response, content)) {
            detailAt = performance.now();
            return true;
          }
          return false;
        }, { timeout: 65_000 })
        : null;
      const started = performance.now();
      // Observe the DOM independently of the HTTP guards: waiting for a later
      // canonical read must not inflate the time at which content was visible.
      const visibleDOM = expect(chat.getByText(content, { exact: true }))
        .toBeVisible({ timeout: 65_000 }).then(() => performance.now());
      // A callback/HTTP guard may fail first; its finally still closes the page.
      void visibleDOM.catch(() => undefined);
      const response = await postCallback(kind, phone, content, providerId);
      const ackAt = performance.now();
      expect(response.status(), `${kind} webhook ACK`).toBe(202);
      const receipt = await response.json() as { receipt?: { status?: string; duplicate?: boolean } };
      expect(receipt.receipt?.status).toBe('pending');
      expect(receipt.receipt?.duplicate).toBe(false);
      await listResponse;
      if (detailResponse) await detailResponse;
      await expect.poll(() => wakes.length > wakeIndex, { timeout: 65_000 }).toBe(true).catch(async error => {
        console.log(`INBOX_FRAME_FAILURE ${JSON.stringify({ kind, index, ready: inboxReady(), wireCounts, lifecycle: inboxLifecycle.slice(-20) })}`);
        const proof = await database.query(
          `select message.capture_state, message.status, conversation.unread_count,
             (conversation.last_message=$3) as preview_matches
           from public.whatsapp_messages message
           join public.whatsapp_conversations conversation on conversation.id=message.conversation_id
           where message.session_id=$1::uuid and message.provider_message_id=$2`,
          [sessionId, providerId, content],
        );
        console.log(`INBOX_FRAME_PERSISTENCE ${JSON.stringify(proof.rows)}`);
        throw error;
      });
      const frameAt = wakes[wakeIndex];
      expect(frameAt, `${kind} private frame must precede list refresh`).toBeLessThanOrEqual(listAt);
      // The floating widget renders one surface at a time: conversation
      // history while selected, otherwise its list.
      const domAt = await visibleDOM;
      if (detailResponse) expect(detailAt).toBeGreaterThanOrEqual(frameAt);
      if (historyOpen) {
        await expect.poll(async () => {
          const state = await database.query<{ unread_count: number }>(
            'select unread_count from public.whatsapp_conversations where session_id=$1::uuid and remote_jid=$2',
            [sessionId, `${phone}@s.whatsapp.net`],
          );
          return state.rows[0]?.unread_count;
        }, { timeout: 10_000, message: 'automatic CRM read must clear the durable counter' }).toBe(0);
        expect(markReadPosts - readCountBeforeSample, 'one incoming message must not create a read feedback loop').toBeLessThanOrEqual(3);
        const afterRead = markReadPosts;
        await page.waitForTimeout(250);
        expect(markReadPosts, 'idle mutation/cache renders must not repeat the read').toBe(afterRead);
      }
      return {
        ackMs: ackAt - started,
        frameMs: frameAt - started,
        listMs: listAt - started,
        domMs: domAt - started,
        ackToDomMs: domAt - ackAt,
      };
    };

    const leadSamples: Sample[] = [];
    for (let index = 0; index < 5; index++) {
      leadSamples.push(await sample('lead', leadPhone, index, true));
    }

    await chat.getByRole('button', { name: 'Voltar à lista de conversas' }).click();
    const unlinkedSamples: Sample[] = [];
    unlinkedSamples.push(await sample('unlinked', unlinkedPhone, 0, false));
    await expect(chat.getByText(unlinkedName, { exact: true })).toBeVisible();
    const unlinkedHistory = page.waitForResponse((response) =>
      new URL(response.url()).pathname.endsWith('/messages')
      && response.request().method() === 'GET' && response.ok());
    await chat.getByText(unlinkedName, { exact: true }).click();
    await unlinkedHistory;
    await page.waitForTimeout(1_300);
    for (let index = 1; index < 5; index++) {
      unlinkedSamples.push(await sample('unlinked', unlinkedPhone, index, true));
    }

    const visualBudgets: Array<{ kind: string; p95: number; max: number }> = [];
    for (const [kind, values] of [['lead', leadSamples], ['unlinked', unlinkedSamples]] as const) {
      const dom = values.map((value) => value.domMs);
      const mean = dom.reduce((sum, value) => sum + value, 0) / dom.length;
      const p95 = percentile95(dom);
      const max = Math.max(...dom);
      console.log(`VISUAL_LATENCY ${kind} n=${values.length} POST→DOM mean=${mean.toFixed(0)}ms p95=${p95.toFixed(0)}ms max=${max.toFixed(0)}ms; ` +
        `ACK→DOM p95=${percentile95(values.map((value) => value.ackToDomMs)).toFixed(0)}ms; ` +
        `POST→frame p95=${percentile95(values.map((value) => value.frameMs)).toFixed(0)}ms; ` +
        `POST→list p95=${percentile95(values.map((value) => value.listMs)).toFixed(0)}ms`);
      visualBudgets.push({ kind, p95, max });
    }

    // Persistence must survive a new page, beyond the already-observed wake.
    const reloadList = page.waitForResponse(async (response) =>
      new URL(response.url()).pathname === '/v1/whatsapp/conversations'
      && response.request().method() === 'GET' && response.ok()
      && await completedResponseContains(response, unlinkedName));
    await page.reload();
    await expect(page.locator('aside.app-sidebar')).toBeVisible({ timeout: 180_000 });
    if (!(await chat.isVisible())) await page.getByRole('button', { name: /^Abrir chat do WhatsApp/ }).click();
    await reloadList;
    await expect(chat.getByText(unlinkedName, { exact: true })).toBeVisible();
    const persistedHistory = page.waitForResponse(async (response) =>
      new URL(response.url()).pathname.endsWith('/messages')
      && response.request().method() === 'GET' && response.ok()
      && await completedResponseContains(response, `Visual unlinked ${suffix} 4`));
    await chat.getByText(unlinkedName, { exact: true }).click();
    await persistedHistory;
    await expect(chat.getByText(`Visual unlinked ${suffix} 4`, { exact: true })).toBeVisible();
    await expect(chat.getByRole('textbox', { name: 'Digite sua mensagem' })).toBeDisabled();
    await chat.getByRole('button', { name: 'Voltar à lista de conversas' }).click();
    await chat.getByText(leadName, { exact: true }).click();

    // Enter attendance through the real authenticated API, then admit a burst
    // while only this synthetic session is held against the worker's claim.
    const joined = await authenticatedAPIRequest(page, 'POST',
      `/v1/whatsapp/conversations/${leadConversationId}/attendance`,
      { expectedLeadId: leadId, sendSessionId: sessionId });
    expect(joined.ok(), await joined.text()).toBe(true);
    const attendance = await joined.json() as {
      data?: { joined?: boolean; currentEntry?: { id?: string; userId?: string; joinedAt?: string } };
    };
    expect(attendance.data?.joined).toBe(true);
    expect(attendance.data?.currentEntry?.userId).toBe(userId);
    expect(attendance.data?.currentEntry?.id).toBeTruthy();
    // Provider timestamps have second precision. Do not manufacture a future
    // event, or incorrectly put a post-join event before its capture boundary.
    const joinedSecond = Math.ceil(Date.parse(attendance.data!.currentEntry!.joinedAt!) / 1000) * 1000;
    await expect.poll(() => Math.floor(Date.now() / 1000) * 1000,
      { timeout: 5_000, intervals: [50, 100] }).toBeGreaterThanOrEqual(joinedSecond);
    const burstIds = [0, 1, 2].map(index => `visual-captured-${suffix}-${index}`);
    const burstContent = [0, 1, 2].map(index => `Capturada visual ${suffix} ${index}`);
    await database.query('begin');
    try {
      await database.query('select id from public.whatsapp_sessions where id = $1::uuid for share', [sessionId]);
      for (let index = 0; index < 3; index++) {
        const response = await postCallback('lead', leadPhone, burstContent[index], burstIds[index]);
        expect(response.status(), 'consecutive captured callback ACK').toBe(202);
        const receipt = await response.json() as { receipt?: { status?: string; duplicate?: boolean } };
        expect(receipt.receipt?.status).toBe('pending');
        expect(receipt.receipt?.duplicate).toBe(false);
      }
      const pending = await database.query<{ n: number; inherited: number; all_pending: boolean }>(
        `select count(*)::int as n,
           count(*) filter (where route.target_mode = 'inherit_predecessor')::int as inherited,
           bool_and(inbox.status = 'pending' and inbox.attempts = 0) as all_pending
         from public.whatsapp_webhook_routing_snapshots route
         join public.whatsapp_webhook_inbox inbox on inbox.organization_id = route.organization_id
           and inbox.session_id = route.session_id and inbox.event_key = route.inbox_event_key
         where route.organization_id = $1::uuid and route.session_id = $2::uuid
           and route.provider_message_id = any($3::text[])`,
        [E2E_ORGANIZATION_ID, sessionId, burstIds],
      );
      expect(pending.rows[0].n).toBe(3);
      expect(pending.rows[0].inherited).toBeGreaterThanOrEqual(2);
      expect(pending.rows[0].all_pending).toBe(true);
      await database.query('commit');
    } catch (error) {
      await database.query('rollback');
      throw error;
    }
    await expect.poll(async () => {
      const result = await database.query<{ proof: Record<string, number> }>(
        `with captured as (
           select id, capture_state, from_me, direction, lead_id
           from public.whatsapp_messages where organization_id = $1::uuid and session_id = $2::uuid
             and provider_message_id = any($3::text[])
         ), alerts as (
           select id, user_id from public.notifications where organization_id = $1::uuid
             and metadata->>'event_key' = 'whatsapp_inbound_attendant'
             and metadata->>'whatsapp_session_id' = $2::text
         ), hints as (
           select event.user_id, event.audience_user_id from private.realtime_events event
           where event.organization_id = $1::uuid and (
             (event.event_type = 'whatsapp.message.created'
               and event.data->>'messageId' in (select id::text from captured))
             or (event.event_type = 'notification.created'
               and event.data->>'notificationId' in (select id::text from alerts))
           )
         ) select jsonb_build_object(
           'messages', (select count(*) from captured),
           'captured', (select count(*) from captured where capture_state = 'captured'
             and from_me = false and direction = 'inbound' and lead_id = $4::uuid),
           'notifications', (select count(*) from alerts),
           'targetedNotifications', (select count(*) from alerts where user_id = $5::uuid),
           'sseRows', (select count(*) from hints),
           'targetedSSE', (select count(*) from hints where user_id = $5::uuid and audience_user_id = $5::uuid),
           'processedCallbacks', (select count(*) from public.whatsapp_webhook_routing_snapshots route
             join public.whatsapp_webhook_inbox inbox on inbox.organization_id = route.organization_id
               and inbox.session_id = route.session_id and inbox.event_key = route.inbox_event_key
             where route.organization_id = $1::uuid and route.session_id = $2::uuid
               and route.provider_message_id = any($3::text[]) and inbox.status = 'processed')
         ) as proof`,
        [E2E_ORGANIZATION_ID, sessionId, burstIds, leadId, userId],
      );
      return result.rows[0].proof;
    }, { timeout: 65_000, message: 'three real captured callbacks must commit exactly three alerts and six targeted SSE rows' })
      .toEqual({ messages: 3, captured: 3, notifications: 3, targetedNotifications: 3, sseRows: 6, targetedSSE: 6, processedCallbacks: 3 });
    // Feed order, including ties, must survive a new canonical head and reload.
    // Compare actual DOM positions with the authoritative API and frozen route
    // IDs; never infer order from the nominal callback labels alone.
    const assertOrder = async (contents: string[], providerIds: string[], phase: string) => {
      const response = await authenticatedAPIRequest(page, 'GET',
        `/v1/whatsapp/conversations/${leadConversationId}/messages?expectedLeadId=${leadId}&limit=100&includeMediaUrls=false&orderingVersion=2`);
      expect(response.ok(), await response.text()).toBe(true);
      const payload = await response.json() as { data: { messages: Array<{
        id: string; message_id: string; content: string | null; metadata?: Record<string, unknown>;
      }> } };
      const canonical = payload.data.messages.filter(message => providerIds.includes(message.message_id));
      expect(canonical.map(message => message.message_id), `${phase} canonical API order`).toEqual(providerIds);
      expect(canonical.map(message => message.content)).toEqual(contents);
      for (const message of canonical) {
        // Go omits an empty map; any populated metadata would still fail.
        if (message.metadata !== undefined) expect(message.metadata).toEqual({});
      }
      for (const content of contents) await expect(chat.getByText(content, { exact: true })).toBeVisible({ timeout: 65_000 });
      const positions = await Promise.all(contents.map(content => chat.getByText(content, { exact: true })
        .evaluate(element => Array.from(element.ownerDocument.querySelectorAll('*')).indexOf(element))));
      expect(positions, `${phase} actual DOM order`).toEqual([...positions].sort((a, b) => a - b));
      console.log(`CANONICAL_ORDER ${phase} providerIds=${JSON.stringify(providerIds)} messageIds=${JSON.stringify(canonical.map(message => message.id))} DOM=${JSON.stringify(contents)}`);
    };
    const refreshLeadHead = async () => {
      await chat.getByRole('button', { name: 'Voltar à lista de conversas' }).click();
      const history = page.waitForResponse(response =>
        new URL(response.url()).pathname === `/v1/whatsapp/conversations/${leadConversationId}/messages`
        && new URL(response.url()).searchParams.get('orderingVersion') === '2'
        && response.request().method() === 'GET' && response.ok());
      await chat.getByText(leadName, { exact: true }).click();
      // Reopening a warm cache need not refetch. The existing native focus
      // listener requests a canonical head; no response/cache is synthesized.
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await history;
    };
    const reloadLeadHistory = async () => {
      const list = page.waitForResponse(response =>
        new URL(response.url()).pathname === '/v1/whatsapp/conversations'
        && response.request().method() === 'GET' && response.ok());
      await page.reload();
      await expect(page.locator('aside.app-sidebar')).toBeVisible({ timeout: 180_000 });
      if (!(await chat.isVisible())) await page.getByRole('button', { name: /^Abrir chat do WhatsApp/ }).click();
      await list;
      const history = page.waitForResponse(response =>
        new URL(response.url()).pathname === `/v1/whatsapp/conversations/${leadConversationId}/messages`
        && new URL(response.url()).searchParams.get('orderingVersion') === '2'
        && response.request().method() === 'GET' && response.ok());
      await chat.getByText(leadName, { exact: true }).click();
      await history;
    };
    const screenshotThree = async (contents: string[], filename: string) => {
      await page.setViewportSize({ width: 1440, height: 1100 });
      await chat.getByText(contents[2], { exact: true }).scrollIntoViewIfNeeded();
      await expect.poll(async () => {
        const viewport = await chat.locator('[data-radix-scroll-area-viewport]').boundingBox();
        const boxes = await Promise.all(contents.map(content => chat.getByText(content, { exact: true }).boundingBox()));
        return Boolean(viewport && boxes.every(box => box && box.y >= viewport.y
          && box.y + box.height <= viewport.y + viewport.height));
      }, { timeout: 10_000, message: 'all three message bodies must be fully visible in the screenshot' }).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(filename) });
    };
    await assertOrder(burstContent, burstIds, 'captured-burst');
    await refreshLeadHead();
    await assertOrder(burstContent, burstIds, 'captured-burst-head');
    await reloadLeadHistory();
    await assertOrder(burstContent, burstIds, 'captured-burst-reload');
    console.log('UNLINKED_RELOAD owner history persisted; CAPTURED_BURST messages=3 alerts=3 targetedSSE=6 processedCallbacks=3');
    await screenshotThree(burstContent, 'whatsapp-captured-burst.png');

    // One recognized provider envelope fans out atomically to three durable
    // admissions. Each member is processed in its own native transaction;
    // sent_at ties, while the actual created_at cardinality is measured below.
    const batchIds = [0, 1, 2].map(index => `visual-batch-${suffix}-${index}`);
    const batchContent = [0, 1, 2].map(index => `Lote capturado ${suffix} ${index}`);
    const batch = await postEnvelope('lead', leadPhone, batchContent, batchIds);
    expect(batch.status(), 'three-message envelope ACK').toBe(202);
    const batchReceipt = await batch.json() as { receipt?: { status?: string; duplicate?: boolean } };
    expect(batchReceipt.receipt?.status).toBe('pending');
    expect(batchReceipt.receipt?.duplicate).toBe(false);
    type EnvelopeProof = { n: number; created_times: number; sent_times: number; events: number; processed: number; ordered_ids: string[] | null };
    let lastEnvelopeProof: EnvelopeProof | undefined;
    try {
      await expect.poll(async () => {
        const result = await database.query<EnvelopeProof>(
        `select count(*)::int as n, count(distinct message.created_at)::int as created_times,
           count(distinct message.sent_at)::int as sent_times, count(distinct route.inbox_event_key)::int as events,
           count(*) filter (where inbox.status = 'processed')::int as processed,
           array_agg(route.provider_message_id order by route.ingress_sequence) as ordered_ids
         from public.whatsapp_messages message
         join public.whatsapp_webhook_routing_snapshots route on route.organization_id = message.organization_id
           and route.session_id = message.session_id and route.provider_message_id = message.provider_message_id
         join public.whatsapp_webhook_inbox inbox on inbox.organization_id = route.organization_id
           and inbox.session_id = route.session_id and inbox.event_key = route.inbox_event_key
         where message.organization_id = $1::uuid and message.session_id = $2::uuid
           and message.provider_message_id = any($3::text[]) and message.lead_id = $4::uuid
           and message.capture_state = 'captured' and message.from_me = false
           and route.created_at <= message.created_at`,
        [E2E_ORGANIZATION_ID, sessionId, batchIds, leadId]);
        lastEnvelopeProof = result.rows[0];
        return lastEnvelopeProof;
      }, { timeout: 65_000, message: 'one real provider POST must fan out to three captured, processed admissions in immutable order' })
        .toEqual({ n: 3, created_times: expect.any(Number), sent_times: 1, events: 3, processed: 3, ordered_ids: batchIds });
      expect(lastEnvelopeProof?.created_times).toBeGreaterThanOrEqual(1);
      expect(lastEnvelopeProof?.created_times).toBeLessThanOrEqual(3);
    } finally {
      // Preserve the actual final read even if a later assertion/cleanup fails.
      console.log(`NATIVE_ENVELOPE_COUNTS onePOST=true actual=${JSON.stringify(lastEnvelopeProof ?? null)}`);
    }
    await assertOrder(batchContent, batchIds, 'native-envelope');
    await refreshLeadHead();
    await assertOrder(batchContent, batchIds, 'native-envelope-head');
    await reloadLeadHistory();
    await assertOrder(batchContent, batchIds, 'native-envelope-reload');
    await screenshotThree(batchContent, 'whatsapp-captured-envelope.png');
    console.log(`MARK_READ_EFFECT totalPOST=${markReadPosts}; per-message bounded and idle stable`);
    // Follow the actual durable push target against the authenticated API/page.
    // OS transport is covered separately by the service worker harness.
    const pushTarget = await database.query<{ target_url: string }>(
      `select notification.target_url from public.notifications notification
       join public.whatsapp_messages message on message.id::text = notification.metadata->>'whatsapp_message_id'
       where message.organization_id=$1::uuid and message.session_id=$2::uuid
         and message.provider_message_id=$3 and notification.user_id=$4::uuid`,
      [E2E_ORGANIZATION_ID, sessionId, batchIds[2], userId],
    );
    expect(pushTarget.rows[0]?.target_url).toBe(`/crm/conversas?conversation=${leadConversationId}&lead=${leadId}`);
    // Inspect the actual intermediate-width loading overlay while its real GET
    // is held. Release the request before checking the loaded panel and history.
    let releaseLead = () => {};
    const leadGate = new Promise<void>(resolve => { releaseLead = resolve; });
    const leadPath = `/v1/leads/${leadId}/conversation-detail`;
    const leadRoute = (url: URL) => url.pathname === leadPath;
    let heldLeadRequests = 0;
    await page.route(leadRoute, async route => {
      if (route.request().method() !== 'GET') {
        await route.continue();
        return;
      }
      heldLeadRequests += 1;
      await leadGate;
      await route.continue();
    });
    try {
      await page.setViewportSize({ width: 900, height: 900 });
      await page.goto(pushTarget.rows[0].target_url);
      await expect.poll(() => heldLeadRequests, { timeout: 15_000 }).toBeGreaterThan(0);
      const loadingPanel = page.getByText('Carregando dados do lead', { exact: true }).locator('..');
      await expect(loadingPanel).toBeVisible({ timeout: 15_000 });
      await expect(page.locator('.lead-detail-v2')).toHaveCount(0);
      const background = await loadingPanel.evaluate(element => getComputedStyle(element).backgroundColor);
      expect(background).not.toBe('rgba(0, 0, 0, 0)');
      expect(background).not.toBe('transparent');
      await page.screenshot({ path: testInfo.outputPath('whatsapp-lead-loading-900.png'), animations: 'disabled' });
      await expect(loadingPanel).toBeVisible();
      console.log(`WHATSAPP_LOADING_PROOF width=900 heldGET=${heldLeadRequests} background=${background}`);
    } finally {
      releaseLead();
      await page.unrouteAll({ behavior: 'wait' });
    }
    const messageLog = page.locator('main [data-whatsapp-message-log]');
    await expect(messageLog.getByText(batchContent[2], { exact: true })).toBeVisible({ timeout: 65_000 });
    await expect(page.locator('.lead-detail-v2')).toBeVisible({ timeout: 65_000 });
    for (const width of [1440, 900, 390]) {
      await page.setViewportSize({ width, height: 900 });
      const tail = messageLog.getByText(batchContent[2], { exact: true });
      await expect(tail).toBeInViewport({ timeout: 5_000 });
      await expect.poll(() => tail.evaluate(element => {
        const viewport = element.closest('[data-radix-scroll-area-viewport]');
        if (!viewport) return false;
        const bounds = element.getBoundingClientRect();
        const visible = viewport.getBoundingClientRect();
        return bounds.top >= visible.top && bounds.bottom <= visible.bottom;
      }), { timeout: 5_000, message: `latest message must fit inside the scroll viewport at ${width}px without manual scrolling` }).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `conversation page must fit width ${width}`).toBe(true);
      const replyLayout = await tail.evaluate(element => {
        const row = element.closest('[data-message-id]');
        const reply = row?.querySelector('[data-message-reply-outside]');
        const reaction = row?.querySelector('[data-message-reaction-outside]');
        const body = row?.querySelector('[data-message-metadata]')?.parentElement?.parentElement;
        if (!reply || !reaction || !body) return null;
        const replyBounds = reply.getBoundingClientRect();
        const reactionBounds = reaction.getBoundingClientRect();
        const bodyBounds = body.getBoundingClientRect();
        return {
          outside: !body.contains(reply),
          besideReaction: replyBounds.left >= reactionBounds.right - 1,
          besideBubble: replyBounds.left >= bodyBounds.right - 1,
          centered: Math.abs(replyBounds.top + replyBounds.height / 2 - (bodyBounds.top + bodyBounds.height / 2)) <= 1,
          fitsWidth: replyBounds.right <= window.innerWidth && replyBounds.left >= 0,
          iconOnly: reply.textContent?.trim() === '',
        };
      });
      expect(replyLayout, `reply icon must sit beside reaction and outside the incoming bubble at ${width}px`).toEqual({
        outside: true, besideReaction: true, besideBubble: true, centered: true, fitsWidth: true, iconOnly: true,
      });
      console.log(`WHATSAPP_REPLY_SIDE_PROOF width=${width} ${JSON.stringify(replyLayout)}`);
      await page.screenshot({ path: testInfo.outputPath(`whatsapp-conversation-${width}.png`), animations: 'disabled' });
      if (width !== 390) {
        const panelStyle = await page.locator('.lead-detail-v2').evaluate(element => {
          const style = getComputedStyle(element);
          return { background: style.backgroundColor, opacity: style.opacity };
        });
        expect(panelStyle.background).not.toBe('rgba(0, 0, 0, 0)');
        expect(panelStyle.background).not.toBe('transparent');
        expect(panelStyle.opacity).toBe('1');
        console.log(`WHATSAPP_VIEWPORT_PROOF width=${width} latestVisible=true leadPanel=${JSON.stringify(panelStyle)}`);
        if (width === 900) {
          // At this width the existing lead panel overlays the conversation.
          // Close it through the real control and verify the message is also
          // readable, rather than treating viewport intersection as hit testing.
          await page.locator('.lead-detail-v2').getByRole('button', { name: 'Fechar painel do lead', exact: true }).click();
          await expect(page.locator('.lead-detail-v2')).toHaveCount(0);
          await expect.poll(() => tail.evaluate(element => {
            const bounds = element.getBoundingClientRect();
            const hit = document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
            return hit !== null && (hit === element || element.contains(hit));
          }), { timeout: 5_000 }).toBe(true);
          await page.screenshot({ path: testInfo.outputPath('whatsapp-conversation-900-panel-closed.png'), animations: 'disabled' });
          console.log('WHATSAPP_VIEWPORT_PROOF width=900 panelClosed=true latestUnoccluded=true');
        }
      } else {
        console.log(`WHATSAPP_VIEWPORT_PROOF width=${width} latestVisible=true`);
      }
    }
    const quotedRow = messageLog.locator('[data-message-id]').filter({ hasText: batchContent[2] });
    await quotedRow.getByRole('button', { name: 'Responder citando esta mensagem', exact: true }).click();
    await expect(page.getByText(`Respondendo: ${batchContent[2]}`, { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Cancelar resposta citada', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Cancelar resposta citada', exact: true })).toHaveCount(0);
    console.log('WHATSAPP_REPLY_SIDE_PROOF mobile real quote selected and cancelled');
    // Keep the latency gate strict, after the independent persistence/capture
    // proof so a slow sample does not hide a separate routing regression.
    for (const { kind, p95, max } of visualBudgets) {
      expect(p95, `${kind} visual p95 must stay within 15 s locally`).toBeLessThanOrEqual(15_000);
      expect(max, `${kind} visual maximum must stay within 60 s locally`).toBeLessThanOrEqual(60_000);
    }
  } finally {
    console.log(`INBOX_WIRE_OBSERVER ${JSON.stringify({ ready: inboxReady(), wireCounts, lifecycle: inboxLifecycle.slice(-20) })}`);
    await page.close();
    await database.query('begin');
    try {
      await database.query("set local lock_timeout = '5s'; set local statement_timeout = '10s'");
      // Fence a failing/unfinished synthetic callback before deleting its
      // message and notification effects. The native processor holds SHARE and
      // the claim holds NO KEY UPDATE on this same session; no network locks.
      await database.query('select id from public.whatsapp_sessions where id = $1::uuid for update', [sessionId]);
      await database.query(`delete from private.realtime_events where organization_id = $1::uuid and (
        data->>'sessionId' = $2::text or data->>'notificationId' in (
          select id::text from public.notifications where organization_id = $1::uuid
            and metadata->>'whatsapp_session_id' = $2::text))`, [E2E_ORGANIZATION_ID, sessionId]);
      await database.query(`delete from private.notification_deliveries where notification_id in (
        select id from public.notifications where organization_id = $1::uuid
          and metadata->>'whatsapp_session_id' = $2::text)`, [E2E_ORGANIZATION_ID, sessionId]);
      await database.query(`delete from public.notifications where organization_id = $1::uuid
        and metadata->>'whatsapp_session_id' = $2::text`, [E2E_ORGANIZATION_ID, sessionId]);
      await database.query('delete from public.whatsapp_attendance_marker_confirmations where session_id = $1::uuid', [sessionId]);
      await database.query('delete from public.whatsapp_attendance_entries where session_id = $1::uuid', [sessionId]);
      await database.query('delete from public.whatsapp_webhook_routing_snapshots where session_id = $1::uuid', [sessionId]);
      await database.query('delete from public.whatsapp_webhook_inbox where session_id = $1::uuid', [sessionId]);
      await database.query('delete from public.whatsapp_messages where session_id = $1::uuid', [sessionId]);
      await database.query('delete from public.whatsapp_conversation_lead_bindings where conversation_id in (select id from public.whatsapp_conversations where session_id = $1::uuid)', [sessionId]);
      await database.query('delete from public.whatsapp_conversations where session_id = $1::uuid', [sessionId]);
      await database.query('delete from private.whatsapp_webhook_session_cutovers where session_id = $1::uuid', [sessionId]);
      await database.query('delete from public.whatsapp_sessions where id = $1::uuid', [sessionId]);
      await database.query('delete from public.leads where id = $1::uuid', [leadId]);
      await database.query('commit');
    } catch (error) {
      await database.query('rollback');
      throw error;
    } finally {
      await database.end();
    }
  }
});
