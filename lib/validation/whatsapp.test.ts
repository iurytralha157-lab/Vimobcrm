import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  createWhatsAppSessionInputSchema,
  linkWhatsAppConversationLeadInputSchema,
  whatsAppConversationLinkPreviewResponseSchema,
  whatsAppConversationLinkResultResponseSchema,
  reactWhatsAppMessageInputSchema,
  reactWhatsAppMessageResponseSchema,
  sendWhatsAppMessageResponseSchema,
  sendWhatsAppMessageInputSchema,
  startWhatsAppConversationInputSchema,
  whatsAppConversationResponseSchema,
  whatsAppAttendanceRequestSchema,
  whatsAppAttendanceResponseSchema,
  whatsAppHistoryResponseSchema,
  whatsAppMessagesResponseSchema,
  whatsAppSessionStatusesResponseSchema,
  whatsAppSessionsResponseSchema,
  whatsAppUnreadCountResponseSchema,
  whatsAppMessageSchema,
  whatsAppSendStatusQuerySchema,
  whatsAppSendStatusResponseSchema,
} from './whatsapp'
import {
  formatPhoneForDisplay,
  formatWhatsAppContactLabel,
  formatWhatsAppContactPhoneForDisplay,
  normalizePhoneToE164,
  normalizeWhatsAppContactPhoneToE164,
} from '../phone-utils'

const ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const USER_ID = '33333333-3333-4333-8333-333333333333'
const floatingChatContextSource = readFileSync('contexts/FloatingChatContext.tsx', 'utf8')
const floatingChatSource = readFileSync('components/features/chat/FloatingChat.tsx', 'utf8')

const safeMessage = {
  id: ID, conversation_id: ORG_ID, session_id: USER_ID, message_id: 'provider-fixture',
  client_message_id: 'intent-fixture', from_me: true, content: 'Hello', message_type: 'text',
  media_url: null, media_mime_type: null, status: 'queued', sent_at: '2026-10-11T12:00:00Z',
  delivered_at: null, read_at: null, sender_jid: null, sender_name: null,
}

test('send-status requires exact lead and bounded intent and excludes provider data', () => {
  assert.equal(whatsAppSendStatusQuerySchema.safeParse({ expectedLeadId: ID, clientMessageId: 'intent-fixture' }).success, true)
  for (const invalid of [{ clientMessageId: 'x' }, { expectedLeadId: ID, clientMessageId: '' }, { expectedLeadId: ID, clientMessageId: 'x'.repeat(201) }]) {
    assert.equal(whatsAppSendStatusQuerySchema.safeParse(invalid).success, false)
  }
  const response = { clientMessageId: 'intent-fixture', conversationId: ORG_ID, status: 'queued', message: safeMessage }
  assert.equal(whatsAppSendStatusResponseSchema.safeParse(response).success, true)
  assert.equal(whatsAppSendStatusResponseSchema.safeParse({ ...response, providerData: { raw: 'private' } }).success, false)
})

test('structured presentation bounds fields and unavailable quotes cannot carry prior content', () => {
  assert.equal(whatsAppMessageSchema.safeParse({ ...safeMessage,
    contacts: [{ display_name: 'Portaria', phones: ['+5511999999999'] }],
    location: { latitude: -23.5, longitude: -46.6 },
    media_filename: 'Proposta.pdf', quoted_message: { message_id: 'target', available: true, id: ID, content: 'Captured' },
  }).success, true)
  for (const extra of [
    { quoted_message: { message_id: 'target', available: false, content: 'Before attendance' } },
    { quoted_message: { message_id: 'target', available: true, content: 'No canonical ID' } },
    { contacts: [{ display_name: 'Portaria', vcard: 'private' }] },
    { contacts: Array(6).fill({ display_name: 'Too many' }) },
    { location: { latitude: 91, longitude: 0 } },
    { location: { latitude: 0, longitude: 181 } },
    { media_filename: 'x'.repeat(256) },
  ]) assert.equal(whatsAppMessageSchema.safeParse({ ...safeMessage, ...extra }).success, false)
})

test('exibe telefone WhatsApp digits-only como country-inclusive', () => {
  assert.equal(normalizeWhatsAppContactPhoneToE164('14155552671'), '+14155552671')
  assert.equal(
    formatWhatsAppContactPhoneForDisplay('14155552671'),
    '🇺🇸 +1 4155552671',
  )
  assert.equal(
    formatWhatsAppContactPhoneForDisplay('5511999999999'),
    '🇧🇷 +55 (11) 99999-9999',
  )
  assert.equal(
    formatWhatsAppContactPhoneForDisplay(null, '351912345678@s.whatsapp.net'),
    '🇵🇹 +351 912345678',
  )
  assert.equal(formatPhoneForDisplay('11999998888'), '🇧🇷 +55 (11) 99999-8888')
})

test('usa JID individual como fallback sem exibir identidades opacas ou de grupo', () => {
  assert.equal(
    normalizeWhatsAppContactPhoneToE164(null, '14155552671:18@c.us'),
    '+14155552671',
  )
  assert.equal(normalizeWhatsAppContactPhoneToE164(null, '123456789@lid'), null)
  assert.equal(normalizeWhatsAppContactPhoneToE164(null, '120363123456789@g.us'), null)
})

test('troca nome tecnico igual ao telefone ou JID pelo telefone formatado', () => {
  assert.equal(
    formatWhatsAppContactLabel('14155552671', '14155552671', '14155552671@s.whatsapp.net'),
    '🇺🇸 +1 4155552671',
  )
  assert.equal(
    formatWhatsAppContactLabel(
      '351912345678@s.whatsapp.net',
      null,
      '351912345678@s.whatsapp.net',
    ),
    '🇵🇹 +351 912345678',
  )
  assert.equal(
    formatWhatsAppContactLabel('Maria', '14155552671', '14155552671@s.whatsapp.net'),
    'Maria',
  )
  assert.equal(
    formatWhatsAppContactLabel('177807384645887@lid', null, '177807384645887@lid'),
    'Contato sem identificação',
  )
})

test('preserva E.164 no contexto e usa o telefone canonico ao iniciar conversa', () => {
  assert.equal(normalizePhoneToE164('+1 (415) 555-2671'), '+14155552671')
  assert.equal(normalizePhoneToE164('00351 912 345 678'), '+351912345678')
  assert.match(floatingChatContextSource, /normalizePhoneToE164\(phone\)/)
  assert.doesNotMatch(floatingChatContextSource, /phone\.replace\(\/\\D\/g/)
  assert.match(floatingChatSource, /const canonicalPhone = normalizePhoneToE164\(phone\)/)
  assert.match(floatingChatSource, /findConversation\(\{\s*phone: canonicalPhone/)
  assert.match(floatingChatSource, /handleStartConversationWithSession\(canonicalPhone,/)
})

test('aceita sessao Evolution GO e rejeita provider legado', () => {
  assert.equal(createWhatsAppSessionInputSchema.safeParse({
    displayName: 'Atendimento',
    provider: 'evolution_go',
  }).success, true)
  assert.equal(createWhatsAppSessionInputSchema.safeParse({
    displayName: 'Atendimento',
    provider: 'evolution',
  }).success, false)
})

test('exige snapshot anterior nos vinculos manuais de conversa', () => {
  const startInput = {
    phone: '5511999999999',
    sessionId: ORG_ID,
    leadId: ID,
  }
  assert.equal(startWhatsAppConversationInputSchema.safeParse({
    ...startInput,
    expectedPreviousLeadId: 'unlinked',
  }).success, true)
  assert.equal(startWhatsAppConversationInputSchema.safeParse({
    ...startInput,
    expectedPreviousLeadId: USER_ID,
  }).success, true)
  assert.equal(startWhatsAppConversationInputSchema.safeParse(startInput).success, false)
  assert.equal(startWhatsAppConversationInputSchema.safeParse({
    ...startInput,
    expectedPreviousLeadId: 'invalid',
  }).success, false)

  assert.equal(linkWhatsAppConversationLeadInputSchema.safeParse({
    leadId: ID,
    expectedPreviousLeadId: 'unlinked',
  }).success, true)
  assert.equal(linkWhatsAppConversationLeadInputSchema.safeParse({
    leadId: ID,
    expectedPreviousLeadId: USER_ID,
  }).success, true)
  assert.equal(linkWhatsAppConversationLeadInputSchema.safeParse({ leadId: ID }).success, false)
  assert.equal(linkWhatsAppConversationLeadInputSchema.safeParse({ leadId: ID, expectedPreviousLeadId: 'unlinked', futureOnly: true }).success, true)
  assert.equal(linkWhatsAppConversationLeadInputSchema.safeParse({ leadId: ID, expectedPreviousLeadId: USER_ID, futureOnly: true }).success, false)
})

test('explicit attendance requires the current lead on an own session and no phone change', () => {
  const ownRoute = { phone: '5511999999999', sessionId: ORG_ID, leadId: ID,
    expectedPreviousLeadId: ID, ownSessionOnly: true, startAttendance: true }
  assert.equal(startWhatsAppConversationInputSchema.safeParse(ownRoute).success, true)
  for (const change of [{ ownSessionOnly: false }, { sessionId: undefined }, { expectedPreviousLeadId: 'unlinked' },
    { confirmPhoneChange: true, expectedPreviousConversationId: USER_ID }]) {
    assert.equal(startWhatsAppConversationInputSchema.safeParse({ ...ownRoute, ...change }).success, false)
  }
})

test('previa do vinculo aceita apenas resumo sem conteudo e resultado auditavel', () => {
  const preview = {
    data: {
      conversationId: ID,
      sessionId: ORG_ID,
      sessionDisplayName: 'WhatsApp de teste',
      contactDisplayName: 'Contato de teste',
      leadId: null,
      expectedPreviousLeadId: 'unlinked',
      bindingMode: 'active',
      eligibleMessageCount: 2,
      firstEligibleAt: '2026-10-01T12:00:00.000Z',
      lastEligibleAt: '2026-10-02T12:00:00.000Z',
      expiresAt: '2026-10-08T12:00:00.000Z',
    },
  }
  assert.equal(whatsAppConversationLinkPreviewResponseSchema.safeParse(preview).success, true)
  const futureOnly = { ...preview.data, futureOnly: true, eligibleMessageCount: 0, firstEligibleAt: null, lastEligibleAt: null, expiresAt: null }
  assert.equal(whatsAppConversationLinkPreviewResponseSchema.safeParse({ data: futureOnly }).success, true)
  assert.equal(whatsAppConversationLinkPreviewResponseSchema.safeParse({ data: { ...preview.data, futureOnly: true } }).success, false)
  assert.equal(whatsAppConversationLinkPreviewResponseSchema.safeParse({ data: { ...futureOnly, bindingMode: 'history_only' } }).success, false)
  assert.equal(whatsAppConversationLinkPreviewResponseSchema.safeParse({
    data: { ...preview.data, eligibleMessageCount: -1 },
  }).success, false)
  assert.equal(whatsAppConversationLinkPreviewResponseSchema.safeParse({
    data: { ...preview.data, content: 'Não expor mensagem na prévia' },
  }).success, false)
  assert.equal(whatsAppConversationLinkResultResponseSchema.safeParse({
    ok: true,
    data: { bindingMode: 'history_only', attachedMessageCount: 2 },
  }).success, true)
  assert.equal(whatsAppConversationLinkResultResponseSchema.safeParse({
    ok: true,
    data: { bindingMode: 'history_only', attachedMessageCount: -1 },
  }).success, false)
})

test('exige texto ou midia no envio', () => {
	assert.equal(sendWhatsAppMessageInputSchema.safeParse({ text: 'Ola', expectedLeadId: ID }).success, true)
	assert.equal(sendWhatsAppMessageInputSchema.safeParse({ text: '', mediaUrl: 'https://example.com/foto.jpg', expectedLeadId: ID }).success, true)
	assert.equal(sendWhatsAppMessageInputSchema.safeParse({ text: '', expectedLeadId: ID }).success, false)
	assert.equal(sendWhatsAppMessageInputSchema.safeParse({ text: 'Ola' }).success, false)
})

test('valida consulta e entrada no atendimento por card e sessao', () => {
	const emojiDisplayName = '😀'.repeat(180)
	assert.equal(whatsAppAttendanceRequestSchema.safeParse({
		expectedLeadId: ID,
		sendSessionId: ORG_ID,
	}).success, true)
	assert.equal(whatsAppAttendanceRequestSchema.safeParse({
		expectedLeadId: ID,
	}).success, false)

	assert.equal(whatsAppAttendanceResponseSchema.safeParse({
		data: {
			joined: true,
			currentEntry: {
				id: ID,
				userId: USER_ID,
				userName: emojiDisplayName,
				sessionId: ORG_ID,
				joinedAt: '2026-09-23T12:00:00.000Z',
				entrySource: 'manual',
				markerAt: null,
				markerKind: null,
			},
			entries: [{
				id: ID,
				userId: USER_ID,
				userName: emojiDisplayName,
				sessionId: ORG_ID,
				joinedAt: '2026-09-23T12:00:00.000Z',
				entrySource: 'manual',
				markerAt: '2026-09-23T12:00:04.000Z',
				markerKind: 'started',
			}],
			created: true,
		},
	}).success, true)
})

test('aceita a origem de atendimento retornada pela API antes de enviar', () => {
	for (const entrySource of ['manual', 'implicit', 'ctwa_auto'] as const) {
		const entry = {
			id: ID,
			userId: USER_ID,
			userName: 'Andre',
			sessionId: ORG_ID,
			joinedAt: '2026-10-05T13:00:00.000Z',
			entrySource,
		}
		assert.equal(whatsAppAttendanceResponseSchema.safeParse({
			data: { joined: true, currentEntry: entry, entries: [entry] },
		}).success, true)
	}
	assert.equal(whatsAppAttendanceResponseSchema.safeParse({
		data: { joined: false, currentEntry: null, entries: [] },
	}).success, true)
})

test('valida lista de sessoes e cota', () => {
  const result = whatsAppSessionsResponseSchema.safeParse({
    data: [{
      id: ID,
      organization_id: ORG_ID,
      owner_user_id: USER_ID,
      instance_name: 'org-atendimento',
      display_name: 'Atendimento',
      instance_id: null,
      status: 'connected',
      phone_number: '5511999999999',
      profile_name: null,
      profile_picture: null,
      is_active: true,
      provider: 'evolution_go',
      created_at: '2026-07-11T12:00:00Z',
      updated_at: '2026-07-11T12:00:00Z',
      last_connected_at: null,
    }],
    meta: { maxSessions: 2, currentSessions: 1, canCreate: true },
  })

  assert.equal(result.success, true)
})

test('aceita apenas o DTO minimo e escopado de status das sessoes', () => {
  const safeStatus = {
    data: [{
      id: ID,
      display_name: 'Atendimento',
      status: 'connected',
      phone_number: '5511999999999',
      profile_name: 'Vimob',
      last_connected_at: '2026-09-12T12:00:00Z',
      updated_at: '2026-09-12T12:00:01Z',
      owner: { id: USER_ID, name: 'Maria', avatar_url: null },
      capabilities: {
        can_manage: false,
        can_set_notification_sender: false,
      },
    }],
    meta: { scope: 'team' },
  }

  assert.equal(whatsAppSessionStatusesResponseSchema.safeParse(safeStatus).success, true)
  assert.equal(
    whatsAppSessionStatusesResponseSchema.safeParse({
      ...safeStatus,
      data: [{
        ...safeStatus.data[0],
        instance_name: 'private-provider-key',
      }],
    }).success,
    false,
  )
  assert.equal(
    whatsAppSessionStatusesResponseSchema.safeParse({
      ...safeStatus,
      data: [{
        ...safeStatus.data[0],
        owner: { ...safeStatus.data[0].owner, email: 'private@example.com' },
      }],
    }).success,
    false,
  )
})

test('valida contador leve de mensagens WhatsApp nao lidas', () => {
  assert.equal(whatsAppUnreadCountResponseSchema.safeParse({ count: 12 }).success, true)
  assert.equal(whatsAppUnreadCountResponseSchema.safeParse({ count: -1 }).success, false)
  assert.equal(whatsAppUnreadCountResponseSchema.safeParse({ count: 1.5 }).success, false)
})

test('aceita conversa historica sem sessao confiavel e valida recibo aditivo da previa', () => {
  const response = {
    data: {
      id: ID,
      session_id: null,
      lead_id: ORG_ID,
      remote_jid: '5511999999999@s.whatsapp.net',
      contact_name: 'Historico legado',
      contact_phone: '5511999999999',
      contact_picture: null,
      contact_presence: null,
      presence_updated_at: null,
      last_message: 'Mensagem historica',
      last_message_at: '2026-07-12T12:00:00Z',
      unread_count: 0,
      is_group: false,
      archived_at: null,
      deleted_at: null,
      created_at: '2026-07-12T12:00:00Z',
      updated_at: '2026-07-12T12:00:00Z',
    },
  }

  assert.equal(whatsAppConversationResponseSchema.safeParse(response).success, true)
  for (const summary of [
    { last_message_from_me: true, last_message_status: 'read' },
    { last_message_from_me: false, last_message_status: 'received' },
    { last_message_from_me: null, last_message_status: null },
  ]) {
    const parsed = whatsAppConversationResponseSchema.safeParse({ data: { ...response.data, ...summary } })
    assert.equal(parsed.success, true)
    if (parsed.success) {
      assert.equal(parsed.data.data.last_message_from_me, summary.last_message_from_me)
      assert.equal(parsed.data.data.last_message_status, summary.last_message_status)
    }
  }
  for (const summary of [
    { last_message_from_me: 'true', last_message_status: 'read' },
    { last_message_from_me: true, last_message_status: { raw: 'provider' } },
    { last_message_id: 'not-a-message-uuid' },
    { last_message_sent_at: 'not-an-iso-instant' },
    { last_message_sent_at: '2026-02-30T10:00:00Z' },
  ]) {
    assert.equal(whatsAppConversationResponseSchema.safeParse({ data: { ...response.data, ...summary } }).success, false)
  }
  for (const identity of [
    { last_message_id: ID, last_message_sent_at: '2026-10-18T10:01:00.123456Z' },
    { last_message_id: null, last_message_sent_at: null },
  ]) {
    const parsed = whatsAppConversationResponseSchema.safeParse({ data: { ...response.data, ...identity } })
    assert.equal(parsed.success, true)
    if (parsed.success) {
      assert.equal(parsed.data.data.last_message_id, identity.last_message_id)
      assert.equal(parsed.data.data.last_message_sent_at, identity.last_message_sent_at)
    }
  }
})

test('rejeita pagina de mensagens com contador negativo', () => {
  const result = whatsAppMessagesResponseSchema.safeParse({
    data: {
      messages: [{
        id: ID,
        conversation_id: ORG_ID,
        session_id: USER_ID,
        message_id: 'provider-message-id',
        from_me: false,
        content: null,
        message_type: 'audio',
        media_url: null,
        media_mime_type: null,
        media_size: -1,
        status: 'received',
        sent_at: '2026-07-11T12:00:00Z',
        delivered_at: null,
        read_at: null,
        sender_jid: null,
        sender_name: null,
      }],
      nextCursor: null,
    },
  })

  assert.equal(result.success, false)
})

test('aceita cursor composto de mensagens e rejeita desempate invalido', () => {
  const base = {
    data: {
      messages: [],
      nextCursor: `2026-07-12T12:00:00.123456Z|${ID}`,
    },
  }

  assert.equal(whatsAppMessagesResponseSchema.safeParse(base).success, true)
  assert.equal(whatsAppMessagesResponseSchema.safeParse({
    data: { messages: [], nextCursor: '2026-07-12T12:00:00Z|not-a-uuid' },
  }).success, false)
})

test('valida cursor composto no historico paginado do lead', () => {
  assert.equal(whatsAppHistoryResponseSchema.safeParse({
    data: {
      messages: [],
      nextCursor: `2026-07-12T12:00:00.123456Z|${ID}`,
    },
  }).success, true)
  assert.equal(whatsAppHistoryResponseSchema.safeParse({
    data: {
      messages: [],
      nextCursor: '2026-07-12T12:00:00Z|not-a-uuid',
    },
  }).success, false)

  assert.equal(whatsAppHistoryResponseSchema.safeParse({
    data: {
      messages: [{
        id: ID,
        conversation_id: ORG_ID,
        session_id: null,
        message_id: 'legacy-message-without-trusted-session',
        from_me: false,
        content: 'Historico legado',
        message_type: 'text',
        media_url: null,
        media_mime_type: null,
        status: 'received',
        sent_at: '2026-07-12T12:00:00Z',
        delivered_at: null,
        read_at: null,
        sender_jid: null,
        sender_name: null,
      }],
      nextCursor: null,
    },
  }).success, true)
})

test('aceita cursor v2 sem contador e preserva os formatos legados', () => {
  const cursor = `v2|2026-10-11T12:00:00.123456Z|2026-10-11T12:00:00.654321Z|${ID.toLowerCase()}`
  for (const nextCursor of [cursor, '2026-10-11T12:00:00Z', `2026-10-11T12:00:00Z|${ID}`]) {
    assert.equal(whatsAppMessagesResponseSchema.safeParse({ data: { messages: [], nextCursor } }).success, true)
    assert.equal(whatsAppHistoryResponseSchema.safeParse({ data: { messages: [], nextCursor } }).success, true)
  }
  for (const nextCursor of [
    cursor.replace('v2|', 'v3|'),
    cursor.replace('.123456Z', '.123Z'),
    cursor.replace('2026-10-11T12:00:00.123456Z', '2026-02-30T12:00:00.123456Z'),
    `${cursor}|00000000000000000001`,
    cursor.replace(ID.toLowerCase(), 'not-a-uuid'),
  ]) {
    assert.equal(whatsAppMessagesResponseSchema.safeParse({ data: { messages: [], nextCursor } }).success, false)
  }
})

test('valida resposta de envio com mensagem canonica na fila', () => {
  const result = sendWhatsAppMessageResponseSchema.safeParse({
    clientMessageId: 'client-message-id',
    conversationId: ORG_ID,
    status: 'queued',
    message: {
      id: ID,
      conversation_id: ORG_ID,
      session_id: USER_ID,
      message_id: 'client-message-id',
      client_message_id: 'client-message-id',
      from_me: true,
      content: 'Ola',
      message_type: 'text',
      media_url: null,
      media_mime_type: null,
      status: 'queued',
      sent_at: '2026-07-12T12:00:00Z',
      delivered_at: null,
      read_at: null,
      sender_jid: null,
      sender_name: 'Corretor',
    },
  })

  assert.equal(result.success, true)
})

test('reacao exige chave idempotente e aceita remocao com emoji vazio', () => {
	assert.equal(reactWhatsAppMessageInputSchema.safeParse({
		emoji: '',
		clientReactionId: 'reaction-client-1',
		expectedLeadId: ID,
	}).success, true)
	assert.equal(reactWhatsAppMessageInputSchema.safeParse({ emoji: '👍', expectedLeadId: ID }).success, false)
	assert.equal(reactWhatsAppMessageInputSchema.safeParse({
		emoji: '👍'.repeat(65),
		clientReactionId: 'reaction-client-2',
		expectedLeadId: ID,
	}).success, false)
	assert.equal(reactWhatsAppMessageInputSchema.safeParse({ emoji: '👍', clientReactionId: 'reaction-client-3' }).success, false)
})

test('valida resposta canonica da reacao enfileirada', () => {
  assert.equal(reactWhatsAppMessageResponseSchema.safeParse({
    clientReactionId: 'reaction-client-1',
    conversationId: ORG_ID,
    targetMessageId: ID,
    targetProviderMessageId: 'provider-target-1',
    status: 'queued',
    reaction: {
      id: ID,
      conversation_id: ORG_ID,
      session_id: USER_ID,
      message_id: 'reaction-provider-id',
      client_message_id: 'reaction-client-1',
      from_me: true,
      content: '👍',
      message_type: 'reaction',
      media_url: null,
      media_mime_type: null,
      reaction_to_message_id: 'provider-target-1',
      reaction_emoji: '👍',
      status: 'queued',
      sent_at: '2026-07-12T12:00:00Z',
      delivered_at: null,
      read_at: null,
      sender_jid: null,
      sender_name: 'Corretor',
    },
  }).success, true)
})
