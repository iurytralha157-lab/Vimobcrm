import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test, type Page, type Response } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Client } from 'pg';

import { apiCreateLeadResponseSchema, apiLeadResponseSchema, leadMoveStageInputSchema } from '@/lib/validation/leads';
import { apiScheduleEventResponseSchema, createScheduleEventInputSchema } from '@/lib/validation/schedule';
import { sendWhatsAppMessageResponseSchema, whatsAppAttendanceResponseSchema, whatsAppHistoryResponseSchema } from '@/lib/validation/whatsapp';
import { E2E_ORGANIZATION_ID, E2E_PASSWORD, E2E_USERS } from './support/e2e-env';
import { getAuthenticatedAccessToken, signInAs } from './support/auth';

const PHONE = '5511977001234';
const OTHER_ORGANIZATION = 'c64af6ba-ebb1-4b89-9b5b-587751960005';

function readTarget() {
  const file = process.env.E2E_RELEASE_MANIFEST;
  if (!file) throw new Error('The release journey requires its disposable fixture launcher.');
  return JSON.parse(readFileSync(file, 'utf8')) as {
    run: string; revision: string; app: string; api: string; supabase: string;
  };
}

function requireStatus(response: { status(): number }, code: number, context: string) {
  expect(response.status(), context).toBe(code);
}

function responseTo(page: Page, origin: string, method: string, pathname: string): Promise<Response> {
  return page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.origin === origin && url.pathname === pathname && response.request().method() === method;
  });
}

test('candidate revision journey writes real lead, appointment and linked WhatsApp-scoped history', async ({ page, browser }) => {
  const target = readTarget();
  expect(target.run).toMatch(/^vimob-release-[a-f0-9]{12}$/);
  expect(target.revision).toMatch(/^[a-f0-9]{40}$/);
  expect(target.app).toBe('http://127.0.0.1:58730');
  expect(target.api).toBe('http://127.0.0.1:58731');
  expect(target.supabase).toBe('http://127.0.0.1:58732');
  const databaseURL = new URL(process.env.E2E_RELEASE_DB ?? '');
  expect(databaseURL.origin).toBe('null');
  expect(`${databaseURL.protocol}//${databaseURL.host}${databaseURL.pathname}`)
    .toBe('postgresql://127.0.0.1:58733/vimob_release_gate');
  const guard = await page.request.get(`${target.api}/__release_fixture`);
  expect(guard.status()).toBe(200);
  expect(await guard.json()).toEqual({ run: target.run, evolutionRequests: 0 });
  for (const endpoint of [`${target.app}/login`, `${target.api}/readyz`]) {
    const candidate = await page.request.get(endpoint, { maxRedirects: 0 });
    expect(candidate.status()).toBe(200);
    expect(candidate.headers()['x-vimob-release-sha']).toBe(target.revision);
  }

  const db = new Client({ connectionString: databaseURL.href, connectionTimeoutMillis: 5_000, statement_timeout: 6_000 });
  await db.connect();
  const foreign = await browser.newContext({ baseURL: target.app, serviceWorkers: 'block' });
  try {
    const { rows } = await db.query<{ run_id: string }>('select run_id from vimob_release_fixture.target');
    expect(rows).toEqual([{ run_id: target.run }]);

    const explicitServiceKey = process.env.E2E_RELEASE_SERVICE;
    if (!explicitServiceKey) throw new Error('Synthetic fixture Auth admin key is missing.');
    const auth = createClient(target.supabase, explicitServiceKey,
      { auth: { autoRefreshToken: false, persistSession: false } });
    const adminId = await seedAccount(db, auth, 'admin', E2E_ORGANIZATION_ID);
    await seedAccount(db, auth, 'user', OTHER_ORGANIZATION);
    const pipelineId = randomUUID();
    const firstStage = randomUUID();
    const nextStage = randomUUID();
    const stageName = 'Em atendimento E2E';
    await db.query(`insert into public.pipelines (id, organization_id, name, position, is_default, is_active)
      values ($1, $2, 'Pipeline de publicação E2E', 0, true, true)`, [pipelineId, E2E_ORGANIZATION_ID]);
    await db.query(`insert into public.stages (id, organization_id, pipeline_id, name, stage_key, color, position, is_active)
      values ($1, $3, $4, 'Novos E2E', 'new', '#f97316', 0, true),
             ($2, $3, $4, $5, 'contacted', '#f97316', 1, true)`,
    [firstStage, nextStage, E2E_ORGANIZATION_ID, pipelineId, stageName]);

    const allowedOrigins = new Set([target.app, target.api, target.supabase]);
    for (const context of [page.context(), foreign]) {
      await context.route('**/*', route => {
        if (allowedOrigins.has(new URL(route.request().url()).origin)) return route.continue();
        return route.abort();
      });
    }
    const journeyName = `Lead publicação ${target.run}`;
    await signInAs(page, 'admin');
    await page.goto('/crm/pipelines');
    await page.getByRole('button', { name: 'Novo Lead', exact: true }).click();
    const createDialog = page.getByRole('dialog', { name: 'Novo Lead', exact: true });
    await createDialog.getByLabel('Nome completo *', { exact: true }).fill(journeyName);
    await createDialog.getByLabel('Telefone', { exact: true }).fill('11977001234');
    await createDialog.getByLabel('Email', { exact: true }).fill(`${target.run}@example.test`);
    for (const tab of ['Pessoa', 'Interesse', 'Gestão']) {
      await createDialog.getByRole('button', { name: 'Avançar', exact: true }).click();
      await expect(createDialog.getByRole('tab', { name: tab, exact: true })).toHaveAttribute('data-state', 'active');
    }
    const leadResponse = responseTo(page, target.api, 'POST', '/v1/leads');
    await createDialog.getByRole('button', { name: 'Criar Lead', exact: true }).click();
    const created = await leadResponse;
    requireStatus(created, 201, 'create lead through Pipeline');
    const { leadId, leadVisible } = apiCreateLeadResponseSchema.parse(await created.json());
    expect(leadVisible).toBe(true);
    await expect(createDialog).toBeHidden();
    await page.reload();
    const card = page.getByRole('button', { name: new RegExp(`^(?:Abrir detalhes do lead ${journeyName}|${journeyName}:)`) });
    await card.click();
    const detail = page.locator('[data-tour="lead-detail-dialog"]');
    const move = responseTo(page, target.api, 'POST', `/v1/leads/${leadId}/move-stage`);
    await detail.getByRole('button', { name: `Mover para ${stageName}`, exact: true }).click();
    await detail.getByRole('alertdialog', { name: 'Confirmar mudança de etapa' }).getByRole('button', { name: 'Mover lead', exact: true }).click();
    const moved = await move;
    requireStatus(moved, 200, 'move lead through Pipeline');
    expect(leadMoveStageInputSchema.parse(moved.request().postDataJSON())).toMatchObject({ stageId: nextStage, expectedStageId: firstStage });
    expect(apiLeadResponseSchema.parse(await moved.json()).data.stageId).toBe(nextStage);
    expect((await db.query('select stage_id::text from public.leads where id=$1 and organization_id=$2',
      [leadId, E2E_ORGANIZATION_ID])).rows).toEqual([{ stage_id: nextStage }]);

    await detail.getByRole('button', { name: 'Agendar', exact: true }).click();
    const sheet = page.locator('[data-tour="agenda-event-sheet"]');
    await sheet.getByRole('combobox', { name: 'Tipo da atividade' }).click();
    await page.getByRole('option', { name: 'Reunião', exact: true }).click();
    const title = `Reunião ${target.run}`;
    await sheet.getByRole('textbox', { name: 'Título da atividade' }).fill(title);
    const eventResponse = responseTo(page, target.api, 'POST', '/v1/schedule/events');
    await sheet.getByRole('button', { name: 'Adicionar', exact: true }).click();
    const scheduled = await eventResponse;
    requireStatus(scheduled, 201, 'schedule meeting from lead');
    expect(createScheduleEventInputSchema.parse(scheduled.request().postDataJSON())).toMatchObject({ lead_id: leadId, event_type: 'meeting' });
    const event = apiScheduleEventResponseSchema.parse(await scheduled.json()).data;
    expect((await db.query('select lead_id::text, title from public.schedule_events where id=$1 and organization_id=$2',
      [event.id, E2E_ORGANIZATION_ID])).rows).toEqual([{ lead_id: leadId, title }]);
    await page.goto(`/agenda?event=${event.id}`);
    await expect(sheet.getByRole('heading', { name: title, exact: true })).toBeVisible();

    const sessionId = randomUUID();
    const conversationId = randomUUID();
    const providerToken = process.env.E2E_RELEASE_PROVIDER_SECRET;
    if (!providerToken) throw new Error('Synthetic Evolution token is missing.');
    await db.query(`insert into public.whatsapp_sessions
      (id, organization_id, owner_user_id, instance_name, instance_id, provider, status, is_active, advanced_settings)
      values ($1, $2, $3, $4, $4, 'evolution_go', 'connected', true,
      jsonb_build_object('token', $5::text, 'webhook_token', $5::text))`,
    [sessionId, E2E_ORGANIZATION_ID, adminId, target.run, providerToken]);
    await db.query(`insert into private.whatsapp_webhook_session_cutovers (session_id, active_epoch, cutover_at)
      values ($1, 1, clock_timestamp())`, [sessionId]);
    await db.query(`insert into public.whatsapp_conversations
      (id, organization_id, session_id, assigned_user_id, remote_jid, contact_phone, contact_name)
      values ($1, $2, $3, $4, $5, $6, $7)`,
    [conversationId, E2E_ORGANIZATION_ID, sessionId, adminId, `${PHONE}@s.whatsapp.net`, PHONE, journeyName]);
    expect((await db.query<{ ok: boolean }>(`select (public.activate_whatsapp_conversation_lead_binding(
      $1::uuid, $2::uuid, $3::uuid, null)->>'success')::boolean as ok`,
    [E2E_ORGANIZATION_ID, conversationId, leadId])).rows).toEqual([{ ok: true }]);

    const request = (clientPage: Page, endpoint: string, method = 'GET', data?: unknown, org = E2E_ORGANIZATION_ID) =>
      clientPage.request.fetch(`${target.api}${endpoint}`, { method, data, maxRedirects: 0, headers: {
        Authorization: `Bearer ${getAuthenticatedAccessToken(clientPage)}`, 'X-Organization-ID': org,
      } });
    const conversation = `/v1/whatsapp/conversations/${conversationId}`;
    const attendance = await request(page, `${conversation}/attendance`, 'POST',
      { expectedLeadId: leadId, sendSessionId: sessionId });
    requireStatus(attendance, 201, 'start linked attendance');
    expect(whatsAppAttendanceResponseSchema.parse(await attendance.json()).data)
      .toMatchObject({ joined: true, created: true });
    const outbound = `release-outbound-${target.run}`;
    const clientMessageId = randomUUID();
    const send = await request(page, `${conversation}/send-message`, 'POST',
      { expectedLeadId: leadId, sendSessionId: sessionId, clientMessageId, text: outbound });
    requireStatus(send, 200, 'queue real outbound delivery');
    expect(sendWhatsAppMessageResponseSchema.parse(await send.json())).toMatchObject({ clientMessageId, status: 'queued' });
    await expect.poll(async () => (await (await page.request.get(`${target.api}/__release_fixture`)).json()).evolutionRequests,
      { timeout: 25_000, message: 'Go outbox reaches the synthetic Evolution provider exactly once' }).toBe(1);
    await expect.poll(async () => (await db.query<{ status: string }>(`select status from public.whatsapp_outbox
      where organization_id=$1 and client_message_id=$2`, [E2E_ORGANIZATION_ID, clientMessageId])).rows[0]?.status,
    { timeout: 25_000, message: 'the outbox persisted the synthetic provider acknowledgement' }).toBe('sent');
    const incoming = `release-inbound-${target.run}`;
    const providerId = 'RELEASE' + randomUUID().replaceAll('-', '').toUpperCase();
    const webhook = await page.request.post(`${target.api}/v1/whatsapp/webhook/evolution-go?session_id=${sessionId}&instance_id=${target.run}`, {
      headers: { 'X-Webhook-Token': providerToken },
      data: { event: 'messages.upsert', instanceId: target.run, instanceToken: providerToken, data: { messages: [{
        Info: { ID: providerId, Chat: `${PHONE}@s.whatsapp.net`, SenderPN: `${PHONE}@s.whatsapp.net`,
          IsFromMe: false, PushName: journeyName, Timestamp: new Date().toISOString() },
        Message: { conversation: incoming },
      }] } },
    });
    requireStatus(webhook, 202, 'receive through the real Evolution ingress');
    const history = `/v1/whatsapp/history?leadId=${leadId}&conversationId=${conversationId}&limit=20`;
    await expect.poll(async () => {
      const response = await request(page, history);
      if (response.status() !== 200) return [];
      const payload = whatsAppHistoryResponseSchema.parse(await response.json());
      return payload.data.messages.map(message => message.content);
    }, { timeout: 30_000, message: 'linked history contains both directions' }).toEqual(expect.arrayContaining([incoming, outbound]));
    expect((await db.query(`select content, from_me from public.whatsapp_messages
      where organization_id=$1 and lead_id=$2 and content=any($3::text[]) order by from_me`,
    [E2E_ORGANIZATION_ID, leadId, [incoming, outbound]])).rows).toEqual([
      { content: incoming, from_me: false }, { content: outbound, from_me: true },
    ]);
    const outsider = await foreign.newPage();
    await signInAs(outsider, 'user');
    for (const route of [`/v1/leads/${leadId}`, `/v1/schedule/events?eventId=${event.id}`, history]) {
      requireStatus(await request(outsider, route), 403, 'another organization cannot use the owner scope');
    }
    const otherLead = await request(outsider, `/v1/leads/${leadId}`, 'GET', undefined, OTHER_ORGANIZATION);
    expect([403, 404], 'a valid foreign scope cannot read this lead').toContain(otherLead.status());
    const foreignHistory = await request(outsider, history, 'GET', undefined, OTHER_ORGANIZATION);
    requireStatus(foreignHistory, 400, 'a valid foreign scope cannot read this linked history');
    expect(await foreignHistory.json()).toMatchObject({ error: { code: 'invalid_whatsapp_reference' } });
    const foreignMessage = { expectedLeadId: leadId, sendSessionId: sessionId, clientMessageId: randomUUID(), text: outbound };
    requireStatus(await request(outsider, `${conversation}/send-message`, 'POST', foreignMessage),
      403, 'another organization cannot enqueue delivery using the owner scope');
    const foreignSend = await request(outsider, `${conversation}/send-message`, 'POST', foreignMessage, OTHER_ORGANIZATION);
    expect([403, 404], 'a valid foreign scope cannot enqueue delivery from this conversation').toContain(foreignSend.status());
    expect((await db.query('select id from public.whatsapp_outbox where client_message_id=$1', [foreignMessage.clientMessageId])).rows)
      .toEqual([]);
    expect(await (await page.request.get(`${target.api}/__release_fixture`)).json())
      .toEqual({ run: target.run, evolutionRequests: 1 });
  } finally {
    await foreign.close();
    await db.end();
  }
});

async function seedAccount(db: Client, auth: SupabaseClient, key: 'admin' | 'user', organizationId: string) {
  const account = E2E_USERS[key];
  const orgName = `Organização da publicação ${key}`;
  await db.query(`insert into public.organizations (id,name,logo_url,is_active,subscription_status,subscription_type,segment,email)
    values ($1,$2,null,true,'active','paid','imobiliario',$3)`, [organizationId, orgName, account.email]);
  const { data, error } = await auth.auth.admin.createUser({ email: account.email, password: E2E_PASSWORD, email_confirm: true });
  expect(error, 'local GoTrue creates the synthetic account').toBeNull();
  const userId = data.user?.id;
  expect(userId).toBeTruthy();
  await db.query(`insert into public.users (id,organization_id,name,email,role,is_active,language,theme_mode)
    values ($1,$2,$3,$4,$5,true,'pt-BR','system') on conflict (id) do update set
    organization_id=excluded.organization_id, name=excluded.name, email=excluded.email, role=excluded.role, is_active=true`,
  [userId, organizationId, account.name, account.email, account.userRole]);
  await db.query(`insert into public.organization_members(organization_id,user_id,role,is_active)
    values($1,$2,$3,true) on conflict (organization_id,user_id) do update set role=excluded.role, is_active=true`,
  [organizationId, userId, account.memberRole]);
  await db.query(`insert into public.organization_modules(organization_id,module_name,is_enabled)
    select $1::uuid,module_name,true from unnest(array['crm','agenda','whatsapp']) as module_name
    on conflict (organization_id,module_name) do update set is_enabled=true`, [organizationId]);
  return userId;
}
