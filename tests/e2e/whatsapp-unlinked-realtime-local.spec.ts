import crypto from 'node:crypto';
import { Client } from 'pg';
import { expect, test, type BrowserContext } from '@playwright/test';

import { authenticatedAPIRequest, fetchTenantContext, signInAs } from './support/auth';
import { E2E_LEADS, E2E_ORGANIZATION_ID, E2E_USERS, getE2EConfig } from './support/e2e-env';

function realtimeFrame(raw: string): { ref?: string; topic?: string; event?: string; payload?: { status?: string; event?: string } } | null {
  try {
    const frame = JSON.parse(raw) as unknown;
    if (Array.isArray(frame)) {
      return { ref: frame[1], topic: frame[2], event: frame[3], payload: frame[4] };
    }
    if (frame && typeof frame === 'object') {
      return frame as { ref?: string; topic?: string; event?: string; payload?: { status?: string; event?: string } };
    }
  } catch {
    // Ignore non-JSON frames from unrelated sockets.
  }
  return null;
}

test('mensagem sem lead atualiza lista e contador sem recarregar', async ({ page }) => {
  test.setTimeout(180_000);
  page.on('requestfailed', (request) => {
    console.log(`WhatsApp E2E request failed: ${request.method()} ${new URL(request.url()).pathname} ${request.failure()?.errorText ?? ''}`);
  });
  page.on('pageerror', (error) => {
    console.log(`WhatsApp E2E page error: ${error.message}`);
  });
  const database = new Client({ connectionString: getE2EConfig().databaseURL });
  const sessionId = crypto.randomUUID();
  const conversationId = crypto.randomUUID();
  const messageId = crypto.randomUUID();
  const suffix = Date.now().toString(36);
  const contactName = `Contato local ${suffix}`;
  const content = `Mensagem local ${suffix}`;
  const inboxTopic = `whatsapp:${E2E_ORGANIZATION_ID}:inbox`;
  const inboxWireTopic = `realtime:${inboxTopic}`;
  const inboxJoinRefs = new Set<string>();
  let inboxSubscribed = false;
  let inboxWakeReceived = false;

  page.on('websocket', (socket) => {
    socket.on('framesent', ({ payload }) => {
      const frame = realtimeFrame(payload.toString());
      if (frame?.event === 'phx_join' && frame.topic === inboxWireTopic && frame.ref) {
        inboxJoinRefs.add(frame.ref);
      }
    });
    socket.on('framereceived', ({ payload }) => {
      const frame = realtimeFrame(payload.toString());
      if (frame?.topic === inboxWireTopic && frame.event === 'broadcast'
        && frame.payload?.event === 'whatsapp.inbox.changed') {
        inboxWakeReceived = true;
      }
      if (frame?.event === 'phx_reply' && frame.topic === inboxWireTopic
        && frame.ref && inboxJoinRefs.has(frame.ref) && frame.payload?.status === 'ok') {
        inboxSubscribed = true;
      }
    });
  });

  await signInAs(page, 'admin');
  const { userId } = await fetchTenantContext(page);
  await database.connect();
  try {
    await database.query(
      `insert into public.whatsapp_sessions (
        id, organization_id, owner_user_id, instance_name,
        provider, status, is_active
      ) values ($1::uuid, $2::uuid, $3::uuid, $4,
                'evolution_go', 'connected', true)`,
      [sessionId, E2E_ORGANIZATION_ID, userId, `wa-ui-local-${suffix}`],
    );

    const isConversationListResponse = (response: { url(): string; request(): { method(): string }; ok(): boolean }) =>
      new URL(response.url()).pathname === '/v1/whatsapp/conversations'
      && response.request().method() === 'GET'
      && response.ok();
    const listLoaded = page.waitForResponse(isConversationListResponse);
    await page.getByRole('button', { name: /^Abrir chat do WhatsApp/ }).click();
    const chat = page.getByRole('dialog', { name: 'Chat do WhatsApp' });
    await expect(chat).toBeVisible();
    await listLoaded;
    await expect.poll(() => inboxSubscribed, { timeout: 20_000 }).toBe(true);
    // The hook does one extra reconciliation 1 s after joining the channel.
    await page.waitForTimeout(1_300);
    await expect(chat.getByText(contactName, { exact: true })).toHaveCount(0);

    inboxWakeReceived = false;
    let wakeBeforeRefreshedList = false;
    const refreshedList = page.waitForResponse(async (response) => {
      if (!isConversationListResponse(response)) return false;
      const wakeAtResponse = inboxWakeReceived;
      if (!(await response.text()).includes(conversationId)) return false;
      wakeBeforeRefreshedList = wakeAtResponse;
      return true;
    }, { timeout: 20_000 });

    // Commit one synthetic backend write while the private inbox is open.
    // The SQL fixtures separately validate webhook ingress and retention.
    await database.query('begin');
    try {
      await database.query(
        `insert into public.whatsapp_conversations (
          id, organization_id, session_id, lead_id, assigned_user_id,
          remote_jid, contact_phone, contact_name, is_group
        ) values (
          $1::uuid, $2::uuid, $3::uuid, null, null,
          '5511999997788@s.whatsapp.net', '5511999997788', $4, false
        )`,
        [conversationId, E2E_ORGANIZATION_ID, sessionId, contactName],
      );
      await database.query(
        `insert into public.whatsapp_messages (
          id, organization_id, conversation_id, session_id, lead_id,
          provider_message_id, message_id, from_me, direction,
          message_type, content, remote_jid, status, capture_state
        ) values (
          $1::uuid, $2::uuid, $3::uuid, $4::uuid, null,
          $5, $5, false, 'inbound', 'text', $6,
          '5511999997788@s.whatsapp.net', 'received', 'unlinked_ephemeral'
        )`,
        [messageId, E2E_ORGANIZATION_ID, conversationId, sessionId, `ui-${suffix}`, content],
      );
      await database.query(
        `update public.whatsapp_conversations
         set unread_count = 1
         where id = $1::uuid`,
        [conversationId],
      );
      await database.query('commit');
    } catch (error) {
      await database.query('rollback');
      throw error;
    }

    await refreshedList;
    expect(inboxWakeReceived, 'private inbox broadcast must arrive after the message insert').toBe(true);
    expect(wakeBeforeRefreshedList, 'private inbox broadcast must precede the refreshed API response').toBe(true);

    await expect(chat.getByText(contactName, { exact: true })).toBeVisible({ timeout: 20_000 });
    await chat.getByRole('button', { name: 'Fechar chat do WhatsApp' }).click();
    await expect(page.getByRole('button', {
      name: /^Abrir chat do WhatsApp, 1 mensagem não lida$/,
    })).toBeVisible();

    await page.getByRole('button', { name: /^Abrir chat do WhatsApp/ }).click();
    await chat.getByText(contactName, { exact: true }).click();
    await expect(chat.getByText(content, { exact: true })).toBeVisible();
    await expect(chat.getByRole('textbox', { name: 'Digite sua mensagem' })).toBeDisabled();
  } finally {
    await page.close();
    await database.query('delete from public.whatsapp_messages where id = $1::uuid', [messageId]);
    await database.query('delete from public.whatsapp_conversations where id = $1::uuid', [conversationId]);
    await database.query('delete from public.whatsapp_sessions where id = $1::uuid', [sessionId]);
    await database.end();
  }
});

test('chat sem lead aberto fecha no limite de sete dias e consulta expirada não retorna histórico', async ({ page }) => {
  test.setTimeout(180_000);
  const initialBrowserTime = Date.now();
  await page.clock.install({ time: new Date(initialBrowserTime) });
  await signInAs(page, 'admin');
  const { userId } = await fetchTenantContext(page);

  const database = new Client({ connectionString: getE2EConfig().databaseURL });
  const sessionId = crypto.randomUUID();
  const conversationId = crypto.randomUUID();
  const messageId = crypto.randomUUID();
  const suffix = Date.now().toString(36);
  const contactName = `Contato prazo local ${suffix}`;
  const content = `Histórico prazo local ${suffix}`;
  const expiresAt = initialBrowserTime + 5 * 60_000;
  const createdAt = new Date(expiresAt - 7 * 24 * 60 * 60 * 1000);
  const messagePath = `/v1/whatsapp/conversations/${conversationId}/messages`;

  await database.connect();
  try {
    await database.query(
      `insert into public.whatsapp_sessions (
        id, organization_id, owner_user_id, instance_name,
        provider, status, is_active
      ) values ($1::uuid, $2::uuid, $3::uuid, $4,
                'evolution_go', 'connected', true)`,
      [sessionId, E2E_ORGANIZATION_ID, userId, `wa-expiry-local-${suffix}`],
    );
    await database.query(
      `insert into public.whatsapp_conversations (
        id, organization_id, session_id, lead_id, assigned_user_id,
        remote_jid, contact_phone, contact_name, is_group,
        created_at, unlinked_retention_v1
      ) values (
        $1::uuid, $2::uuid, $3::uuid, null, null,
        '5511999997799@s.whatsapp.net', '5511999997799', $4, false,
        $5::timestamptz, true
      )`,
      [conversationId, E2E_ORGANIZATION_ID, sessionId, contactName, createdAt],
    );
    await database.query(
      `insert into public.whatsapp_messages (
        id, organization_id, conversation_id, session_id, lead_id,
        provider_message_id, message_id, from_me, direction,
        message_type, content, remote_jid, status, capture_state
      ) values (
        $1::uuid, $2::uuid, $3::uuid, $4::uuid, null,
        $5, $5, false, 'inbound', 'text', $6,
        '5511999997799@s.whatsapp.net', 'received', 'unlinked_ephemeral'
      )`,
      [messageId, E2E_ORGANIZATION_ID, conversationId, sessionId, `expiry-ui-${suffix}`, content],
    );

    const listLoaded = page.waitForResponse(async (response) =>
      new URL(response.url()).pathname === '/v1/whatsapp/conversations'
      && response.request().method() === 'GET'
      && response.ok()
      && (await response.text()).includes(conversationId));
    await page.getByRole('button', { name: /^Abrir chat do WhatsApp/ }).click();
    const chat = page.getByRole('dialog', { name: 'Chat do WhatsApp' });
    await listLoaded;
    await expect(chat.getByText(contactName, { exact: true })).toBeVisible();

    const initialMessages = page.waitForResponse((response) =>
      new URL(response.url()).pathname === messagePath
      && response.request().method() === 'GET'
      && response.ok());
    await chat.getByText(contactName, { exact: true }).click();
    await initialMessages;
    await expect(chat.getByText(content, { exact: true })).toBeVisible();

    await page.clock.pauseAt(new Date(expiresAt - 1));
    await expect(chat.getByRole('button', { name: 'Voltar à lista de conversas' })).toBeVisible();
    await expect(chat.getByText(content, { exact: true })).toBeVisible();

    // Server time is independent of the browser clock. Cross the same
    // fixture's database boundary just before firing the browser deadline.
    await database.query(
      `update public.whatsapp_conversations
       set created_at = clock_timestamp() - interval '7 days'
       where id = $1::uuid`,
      [conversationId],
    );
    const expiredListRefresh = page.waitForResponse(async (response) =>
      new URL(response.url()).pathname === '/v1/whatsapp/conversations'
      && response.request().method() === 'GET'
      && response.ok()
      && !(await response.text()).includes(conversationId));
    const unreadRefresh = page.waitForResponse((response) =>
      new URL(response.url()).pathname === '/v1/whatsapp/conversations/unread-count'
      && response.request().method() === 'GET'
      && response.ok());
    await page.clock.fastForward(1);
    await page.clock.resume();
    await Promise.all([expiredListRefresh, unreadRefresh]);
    await expect(chat.getByRole('button', { name: 'Voltar à lista de conversas' })).toHaveCount(0);
    await expect(chat.getByRole('textbox', { name: 'Digite sua mensagem' })).toHaveCount(0);
    await expect(chat.getByText(contactName, { exact: true })).toHaveCount(0);

    const expiredMessages = await authenticatedAPIRequest(
      page, 'GET', `${messagePath}?expectedLeadId=unlinked&limit=50`,
    );
    expect([404, 410]).toContain(expiredMessages.status());
    const expiredList = await authenticatedAPIRequest(page, 'GET', '/v1/whatsapp/conversations?limit=50');
    expect(expiredList.ok()).toBe(true);
    expect(await expiredList.text()).not.toContain(conversationId);
  } finally {
    await page.close();
    await database.query('delete from public.whatsapp_messages where id = $1::uuid', [messageId]);
    await database.query('delete from public.whatsapp_conversations where id = $1::uuid', [conversationId]);
    await database.query('delete from public.whatsapp_sessions where id = $1::uuid', [sessionId]);
    await database.end();
  }
});

test('inbox próprio e compartilhado respeita atribuição, histórico respeita acesso ao lead e sem lead é privado', async ({ browser }) => {
  test.setTimeout(240_000);
  const database = new Client({ connectionString: getE2EConfig().databaseURL });
  const contexts: BrowserContext[] = [];
  const adminSessionId = crypto.randomUUID();
  const userSessionId = crypto.randomUUID();
  const sharedGrantId = crypto.randomUUID();
  const teamConversationId = crypto.randomUUID();
  const sharedTeamConversationId = crypto.randomUUID();
  const outsideConversationId = crypto.randomUUID();
  const unlinkedConversationId = crypto.randomUUID();
  const teamMessageId = crypto.randomUUID();
  const sharedTeamMessageId = crypto.randomUUID();
  const outsideMessageId = crypto.randomUUID();
  const unlinkedMessageId = crypto.randomUUID();
  const suffix = Date.now().toString(36);
  const teamName = `Lead equipe local ${suffix}`;
  const outsideName = `Lead externo local ${suffix}`;
  const unlinkedName = `Sem lead próprio local ${suffix}`;
  const teamDisplayName = 'Lead da Equipe E2E';
  const outsideDisplayName = 'Lead Externo E2E';
  const teamContent = `Histórico equipe no número próprio ${suffix}`;
  const sharedTeamContent = `Histórico equipe no número compartilhado ${suffix}`;
  const outsideContent = `Histórico externo exclusivo ${suffix}`;
  const unlinkedContent = `Histórico sem lead privado ${suffix}`;

  await database.connect();
  try {
    const users = await database.query<{ id: string; email: string }>(
      `select id::text, email from public.users
       where organization_id = $1::uuid and email = any($2::text[])`,
      [E2E_ORGANIZATION_ID, [E2E_USERS.admin.email, E2E_USERS.user.email]],
    );
    const userIds = new Map(users.rows.map((row) => [row.email, row.id]));
    expect(userIds.size).toBe(2);

    for (const [sessionId, ownerId, label] of [
      [adminSessionId, userIds.get(E2E_USERS.admin.email), 'admin'],
      [userSessionId, userIds.get(E2E_USERS.user.email), 'user'],
    ]) {
      await database.query(
        `insert into public.whatsapp_sessions (
          id, organization_id, owner_user_id, instance_name,
          provider, status, is_active
        ) values ($1::uuid, $2::uuid, $3::uuid, $4,
                  'evolution_go', 'connected', true)`,
        [sessionId, E2E_ORGANIZATION_ID, ownerId, `wa-matrix-${label}-${suffix}`],
      );
    }

    await database.query(
      `insert into public.whatsapp_session_access (
        id, organization_id, session_id, user_id, granted_by,
        can_view, can_read, can_send, only_leads_access, access_mode,
        grant_scope, grant_team_id
      ) values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid,
                true, true, true, true, 'assigned_leads_only', 'organization', null)`,
      [sharedGrantId, E2E_ORGANIZATION_ID, adminSessionId,
        userIds.get(E2E_USERS.user.email), userIds.get(E2E_USERS.admin.email)],
    );

    for (const [conversationId, sessionId, remoteJid, contactName, retention] of [
      [teamConversationId, userSessionId, '5511999997701@s.whatsapp.net', teamName, false],
      [sharedTeamConversationId, adminSessionId, '5511999997701@s.whatsapp.net', teamName, false],
      [outsideConversationId, adminSessionId, '5511999997702@s.whatsapp.net', outsideName, false],
      [unlinkedConversationId, userSessionId, '5511999997703@s.whatsapp.net', unlinkedName, true],
    ] as const) {
      await database.query(
        `insert into public.whatsapp_conversations (
          id, organization_id, session_id, remote_jid, contact_name,
          last_message, last_message_at, unlinked_retention_v1
        ) values ($1::uuid, $2::uuid, $3::uuid, $4, $5,
                  'prévia local', clock_timestamp(), $6)`,
        [conversationId, E2E_ORGANIZATION_ID, sessionId, remoteJid, contactName, retention],
      );
    }
    for (const [conversationId, leadId] of [
      [teamConversationId, E2E_LEADS.team],
      [sharedTeamConversationId, E2E_LEADS.team],
      [outsideConversationId, E2E_LEADS.outside],
    ]) {
      const binding = await database.query<{ success: boolean }>(
        `select (public.activate_whatsapp_conversation_lead_binding(
          $1::uuid, $2::uuid, $3::uuid, null
        )->>'success')::boolean as success`,
        [E2E_ORGANIZATION_ID, conversationId, leadId],
      );
      expect(binding.rows[0]?.success).toBe(true);
    }

    // Synthetic external messages exercise the real history API without joining
    // attendance or creating send/push work. Linked rows use the canonical RPC
    // binding above; the unlinked row remains in its owner's private quarantine.
    for (const [messageId, conversationId, sessionId, leadId, remoteJid, content] of [
      [teamMessageId, teamConversationId, userSessionId, E2E_LEADS.team, '5511999997701@s.whatsapp.net', teamContent],
      [sharedTeamMessageId, sharedTeamConversationId, adminSessionId, E2E_LEADS.team, '5511999997701@s.whatsapp.net', sharedTeamContent],
      [outsideMessageId, outsideConversationId, adminSessionId, E2E_LEADS.outside, '5511999997702@s.whatsapp.net', outsideContent],
      [unlinkedMessageId, unlinkedConversationId, userSessionId, null, '5511999997703@s.whatsapp.net', unlinkedContent],
    ] as const) {
      await database.query(
        `insert into public.whatsapp_messages (
          id, organization_id, conversation_id, session_id, lead_id,
          provider_message_id, message_id, from_me, direction,
          message_type, content, remote_jid, status, capture_state
        ) values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid,
                  $6, $6, $7, $8, 'text', $9, $10, $11, $12)`,
        [messageId, E2E_ORGANIZATION_ID, conversationId, sessionId, leadId,
          `matrix-${suffix}-${messageId}`, leadId !== null,
          leadId === null ? 'inbound' : 'outbound', content, remoteJid,
          leadId === null ? 'received' : 'sent',
          leadId === null ? 'unlinked_ephemeral' : 'observed_unattended'],
      );
    }

    for (const role of [
      { key: 'admin', present: [sharedTeamConversationId, outsideConversationId], absent: [teamConversationId, unlinkedConversationId], visible: [teamDisplayName, outsideDisplayName], hidden: [unlinkedName] },
      { key: 'leader', present: [], absent: [teamConversationId, sharedTeamConversationId, outsideConversationId, unlinkedConversationId], visible: [], hidden: [teamDisplayName, outsideDisplayName, unlinkedName] },
      { key: 'user', present: [teamConversationId, sharedTeamConversationId, unlinkedConversationId], absent: [outsideConversationId], visible: [teamDisplayName, unlinkedName], hidden: [outsideDisplayName] },
    ] as const) {
      const context = await browser.newContext({
        baseURL: getE2EConfig().baseURL,
        viewport: { width: 1366, height: 768 },
      });
      contexts.push(context);
      const rolePage = await context.newPage();
      await signInAs(rolePage, role.key);
      const tenant = await fetchTenantContext(rolePage);
      expect(tenant.organizationId).toBe(E2E_ORGANIZATION_ID);
      expect(tenant.isTeamLeader).toBe(role.key === 'leader');

      const apiList = await authenticatedAPIRequest(rolePage, 'GET', '/v1/whatsapp/conversations?limit=100');
      expect(apiList.ok()).toBe(true);
      const apiBody = await apiList.text();
      for (const id of role.present) expect(apiBody).toContain(id);
      for (const id of role.absent) expect(apiBody).not.toContain(id);

      // Lead scope is broader than the operational inbox: admin and leader can
      // read this team's immutable history across another user's physical number.
      // The user is the team's assigned broker and also reads both sessions.
      const teamHistory = await authenticatedAPIRequest(
        rolePage, 'GET', `/v1/whatsapp/history?leadId=${E2E_LEADS.team}&limit=100`,
      );
      const teamHistoryBody = await teamHistory.text();
      expect(teamHistory.status(), teamHistoryBody).toBe(200);
      const teamHistoryPayload = JSON.parse(teamHistoryBody) as {
        data: { messages: Array<{ id: string; conversation_id: string; content: string | null }> };
      };
      expect(teamHistoryPayload.data.messages).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: teamMessageId, conversation_id: teamConversationId, content: teamContent }),
        expect.objectContaining({ id: sharedTeamMessageId, conversation_id: sharedTeamConversationId, content: sharedTeamContent }),
      ]));
      expect(teamHistoryBody).not.toContain(outsideContent);
      expect(teamHistoryBody).not.toContain(unlinkedContent);

      const outsideHistory = await authenticatedAPIRequest(
        rolePage, 'GET', `/v1/whatsapp/history?leadId=${E2E_LEADS.outside}&limit=100`,
      );
      const outsideHistoryBody = await outsideHistory.text();
      if (role.key === 'admin') {
        expect(outsideHistory.status(), outsideHistoryBody).toBe(200);
        const outsideHistoryPayload = JSON.parse(outsideHistoryBody) as {
          data: { messages: Array<{ id: string; conversation_id: string; content: string | null }> };
        };
        expect(outsideHistoryPayload.data.messages).toEqual(expect.arrayContaining([
          expect.objectContaining({ id: outsideMessageId, conversation_id: outsideConversationId, content: outsideContent }),
        ]));
      } else {
        // The existing reference guard intentionally denies without revealing
        // whether an out-of-scope lead exists; a 200 empty history is not a pass.
        expect(outsideHistory.status(), outsideHistoryBody).toBe(400);
        expect(outsideHistoryBody).toContain('invalid_whatsapp_reference');
        expect(outsideHistoryBody).not.toContain(outsideMessageId);
        expect(outsideHistoryBody).not.toContain(outsideContent);
      }

      const unlinkedMessages = await authenticatedAPIRequest(
        rolePage, 'GET', `/v1/whatsapp/conversations/${unlinkedConversationId}/messages?expectedLeadId=unlinked&limit=100`,
      );
      const unlinkedMessagesBody = await unlinkedMessages.text();
      if (role.key === 'user') {
        expect(unlinkedMessages.status(), unlinkedMessagesBody).toBe(200);
        const unlinkedPayload = JSON.parse(unlinkedMessagesBody) as {
          data: { messages: Array<{ id: string; content: string | null }> };
        };
        expect(unlinkedPayload.data.messages).toEqual(expect.arrayContaining([
          expect.objectContaining({ id: unlinkedMessageId, content: unlinkedContent }),
        ]));
      } else {
        expect(unlinkedMessages.status(), unlinkedMessagesBody).toBe(404);
        expect(unlinkedMessagesBody).not.toContain(unlinkedMessageId);
        expect(unlinkedMessagesBody).not.toContain(unlinkedContent);
      }

      // A user with no accessible sessions resolves the empty inbox locally;
      // the hook intentionally makes no conversations request in that case.
      const listLoaded = role.present.length > 0 ? rolePage.waitForResponse((response) =>
        new URL(response.url()).pathname === '/v1/whatsapp/conversations'
        && response.request().method() === 'GET' && response.ok()) : null;
      await rolePage.getByRole('button', { name: /^Abrir chat do WhatsApp/ }).click();
      const chat = rolePage.getByRole('dialog', { name: 'Chat do WhatsApp' });
      await expect(chat).toBeVisible();
      await listLoaded;
      if (role.key === 'leader') {
        await expect(chat.getByText('Nenhum WhatsApp conectado', { exact: true })).toBeVisible();
      }
      for (const name of role.visible) await expect(chat.getByText(name, { exact: true }).first()).toBeVisible();
      for (const name of role.hidden) await expect(chat.getByText(name, { exact: true })).toHaveCount(0);
    }
  } finally {
    await Promise.allSettled(contexts.map((context) => context.close()));
    await database.query('delete from public.whatsapp_session_access where id = $1::uuid', [sharedGrantId]);
    await database.query(
      'delete from public.whatsapp_messages where id = any($1::uuid[])',
      [[teamMessageId, sharedTeamMessageId, outsideMessageId, unlinkedMessageId]],
    );
    await database.query(
      'delete from public.whatsapp_conversations where id = any($1::uuid[])',
      [[teamConversationId, sharedTeamConversationId, outsideConversationId, unlinkedConversationId]],
    );
    await database.query(
      'delete from public.whatsapp_sessions where id = any($1::uuid[])',
      [[adminSessionId, userSessionId]],
    );
    await database.end();
  }
});
