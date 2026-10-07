import assert from 'node:assert/strict'
import test from 'node:test'

import {
	getWhatsAppConversationDraftKey,
	getWhatsAppConversationMessageScope,
  getWhatsAppMessageInputState,
  getWhatsAppSendSessionId,
	shouldOfferOwnWhatsAppStart,
	preserveWhatsAppConversationCardSnapshot,
	updateWhatsAppConversationDraft,
} from './whatsapp-message-input'

test('rascunhos sao isolados por tenant, conversa e snapshot do card', () => {
	const base = {
		tenantKey: 'user-a:org-a',
		conversationId: '50000000-0000-4000-8000-000000000001',
	}
	const cardAKey = getWhatsAppConversationDraftKey({
		...base,
		expectedLeadId: '60000000-0000-4000-8000-000000000001',
	})
	const cardBKey = getWhatsAppConversationDraftKey({
		...base,
		expectedLeadId: '60000000-0000-4000-8000-000000000002',
	})
	const unlinkedKey = getWhatsAppConversationDraftKey({
		...base,
		expectedLeadId: 'unlinked',
	})
	const unrelatedKey = getWhatsAppConversationDraftKey({
		...base,
		conversationId: '50000000-0000-4000-8000-000000000099',
		expectedLeadId: '60000000-0000-4000-8000-000000000001',
	})

	assert.ok(cardAKey)
	assert.ok(cardBKey)
	assert.ok(unlinkedKey)
	assert.ok(unrelatedKey)
	assert.notEqual(cardAKey, cardBKey)
	assert.notEqual(cardAKey, unlinkedKey)
	assert.notEqual(cardAKey, unrelatedKey)

	let drafts: Record<string, string> = {}
	drafts = updateWhatsAppConversationDraft(drafts, cardAKey, 'segredo do card A')
	assert.equal(drafts[cardAKey], 'segredo do card A')
	assert.equal(drafts[cardBKey], undefined)
	assert.equal(drafts[unlinkedKey], undefined)

	// A falha de um envio iniciado em A restaura somente A, mesmo que a tela
	// tenha mudado para B enquanto a requisicao estava em voo.
	drafts = updateWhatsAppConversationDraft(drafts, cardAKey, '')
	drafts = updateWhatsAppConversationDraft(drafts, cardBKey, 'novo texto do card B')
	drafts = updateWhatsAppConversationDraft(drafts, cardAKey, (current) => current || 'segredo do card A')
	assert.equal(drafts[cardAKey], 'segredo do card A')
	assert.equal(drafts[cardBKey], 'novo texto do card B')
})

test('chave de rascunho falha fechada sem tenant, conversa ou snapshot', () => {
	assert.equal(getWhatsAppConversationDraftKey({
		tenantKey: '',
		conversationId: 'conversation-a',
		expectedLeadId: 'unlinked',
	}), null)
	assert.equal(getWhatsAppConversationDraftKey({
		tenantKey: 'tenant-a',
		conversationId: '',
		expectedLeadId: 'unlinked',
	}), null)
	assert.equal(getWhatsAppConversationDraftKey({
		tenantKey: 'tenant-a',
		conversationId: 'conversation-a',
		expectedLeadId: null,
	}), null)
})

test('card antigo usa historico imutavel e nunca o canal operacional do card atual', () => {
	const scope = getWhatsAppConversationMessageScope({
		id: '50000000-0000-4000-8000-000000000001',
		lead_id: '60000000-0000-4000-8000-000000000001',
		historical_lead_view: true,
	})

	assert.deepEqual(scope, {
		expectedLeadId: '60000000-0000-4000-8000-000000000001',
		historyLeadId: '60000000-0000-4000-8000-000000000001',
		canMutate: false,
		canManage: false,
	})
	assert.deepEqual(getWhatsAppMessageInputState({
		lead_id: scope.expectedLeadId,
		historical_lead_view: true,
		session_id: '40000000-0000-4000-8000-000000000001',
		remote_jid: '5511999999999@s.whatsapp.net',
	}), {
		disabled: true,
		placeholder: 'Histórico deste card (somente leitura)',
	})
})

test('refresh A para B preserva A como historico e bloqueia mutacoes', () => {
	const cardA = {
		id: '50000000-0000-4000-8000-000000000001',
		lead_id: '60000000-0000-4000-8000-000000000001',
		unread_count: 4,
	}
	const cardB = {
		id: cardA.id,
		lead_id: '60000000-0000-4000-8000-000000000002',
		unread_count: 9,
	}

	const resolved = preserveWhatsAppConversationCardSnapshot(cardA, cardB)
	assert.equal(resolved.lead_id, cardA.lead_id)
	assert.equal(resolved.historical_lead_view, true)
	assert.equal(resolved.unread_count, 0)
	assert.deepEqual(getWhatsAppConversationMessageScope(resolved), {
		expectedLeadId: cardA.lead_id,
		historyLeadId: cardA.lead_id,
		canMutate: false,
		canManage: false,
	})
})

test('unlinked conversation uses an explicit snapshot and fails closed after a link refresh', () => {
	const unlinked: {
		id: string;
		lead_id: string | null;
		unread_count: number;
	} = {
		id: '50000000-0000-4000-8000-000000000001',
		lead_id: null,
		unread_count: 3,
	}
	assert.deepEqual(getWhatsAppConversationMessageScope(unlinked), {
		expectedLeadId: 'unlinked',
		historyLeadId: null,
		canMutate: false,
		canManage: true,
	})

	const linked = {
		...unlinked,
		lead_id: '60000000-0000-4000-8000-000000000002',
	}
	const staleSnapshot = preserveWhatsAppConversationCardSnapshot(unlinked, linked)
	assert.equal(staleSnapshot.lead_id, null)
	assert.equal(staleSnapshot.historical_lead_view, true)
	assert.equal(staleSnapshot.unread_count, 0)
	assert.deepEqual(getWhatsAppConversationMessageScope(staleSnapshot), {
		expectedLeadId: 'unlinked',
		historyLeadId: null,
		canMutate: false,
		canManage: false,
	})
})

test('historical conversation without a trusted session cannot fall back to another account', () => {
  const result = getWhatsAppSendSessionId(
    { id: '50000000-0000-4000-8000-000000000001', session_id: null },
    '40000000-0000-4000-8000-000000000002',
    [{ id: '40000000-0000-4000-8000-000000000002', can_send: true }],
  )

  assert.equal(result, undefined)
})

test('conversa antiga sem sessao mostra caminho pelo numero proprio sem reutilizar canal legado', () => {
  const historical = {
    id: 'conversation-old', lead_id: 'lead-1', session_id: null,
    contact_phone: '5511999999999', is_group: false,
  }
  const ownSession = {
    id: 'session-own', owner_user_id: 'user-1', status: 'connected', can_send: true,
    provider: 'evolution_go',
  }
  assert.equal(getWhatsAppSendSessionId(historical, 'session-own', [ownSession], 'user-1'), undefined)
  assert.equal(getWhatsAppMessageInputState(historical, null, [ownSession], 'user-1').disabled, true)
  assert.equal(shouldOfferOwnWhatsAppStart(historical, [ownSession], 'user-1'), true)
  assert.equal(shouldOfferOwnWhatsAppStart({ ...historical, session_id: undefined }, [ownSession], 'user-1'), true)
  assert.equal(shouldOfferOwnWhatsAppStart({ ...historical, is_group: true }, [ownSession], 'user-1'), false)
  assert.equal(shouldOfferOwnWhatsAppStart({ ...historical, lead_id: null }, [ownSession], 'user-1'), false)
  assert.equal(getWhatsAppSendSessionId(
    { lead_id: 'lead-1', session_id: null, contact_phone: historical.contact_phone },
    'session-own', [ownSession], 'user-1',
  ), 'session-own')
})

test('conversation from a session absent from the authorized list is not sendable', () => {
  const result = getWhatsAppSendSessionId(
    {
      id: '50000000-0000-4000-8000-000000000001',
      session_id: '40000000-0000-4000-8000-000000000001',
    },
    null,
    [{ id: '40000000-0000-4000-8000-000000000002' }],
  )

  assert.equal(result, undefined)
})

test('conversation from another session cannot silently send through the selected account', () => {
  const state = getWhatsAppMessageInputState(
    {
      id: '50000000-0000-4000-8000-000000000001',
      lead_id: 'lead-1',
      session_id: 'session-other',
      contact_phone: '5511999999999',
      session: { id: 'session-other', status: 'connected' },
    },
    'session-own',
    [{ id: 'session-own', status: 'connected', provider: 'evolution_go', can_send: true }],
  )

  assert.equal(state.disabled, true)
  assert.equal(state.sendSessionId, undefined)
  assert.match(state.placeholder, /Inicie pelo seu número/)
})

test('new conversation draft may use the explicitly selected session', () => {
  const result = getWhatsAppSendSessionId(
    { session_id: null },
    '40000000-0000-4000-8000-000000000002',
    [{ id: '40000000-0000-4000-8000-000000000002', owner_user_id: 'user-1', status: 'connected', can_send: true }],
    'user-1',
  )

  assert.equal(result, '40000000-0000-4000-8000-000000000002')
})

test('old API without can_send still permits an owned connected session', () => {
  const state = getWhatsAppMessageInputState(
    { lead_id: 'lead-1', session_id: null, contact_phone: '5511999999999' },
    null,
    [{ id: 'session-own', owner_user_id: 'user-1', status: 'connected', provider: 'evolution_go' }],
    'user-1',
  )
  assert.equal(state.disabled, false)
  assert.equal(state.sendSessionId, 'session-own')
})

test('a shared view-only session cannot confirm attendance or start a new chat', () => {
  const shared = {
    id: 'session-shared', owner_user_id: 'other-user', status: 'connected',
    provider: 'evolution_go', can_send: false,
  }
  const existing = getWhatsAppMessageInputState(
    { id: 'conversation-1', lead_id: 'lead-1', session_id: shared.id, contact_phone: '5511999999999' },
    null,
    [shared],
    'user-1',
  )
  assert.equal(existing.disabled, true)
  assert.equal(existing.sendSessionId, undefined)

  const newChat = getWhatsAppSendSessionId(
    { lead_id: 'lead-1', session_id: null, contact_phone: '5511999999999' },
    shared.id,
    [shared],
    'user-1',
  )
  assert.equal(newChat, undefined)
})

test('a shared send grant permits an existing assigned conversation but not a new chat', () => {
  const shared = {
    id: 'session-shared', owner_user_id: 'other-user', status: 'connected',
    provider: 'evolution_go', can_send: true,
  }
  assert.equal(getWhatsAppSendSessionId(
    { id: 'conversation-1', lead_id: 'lead-1', session_id: shared.id, lead: { id: 'lead-1', assignee: { id: 'user-1' } } },
    null,
    [shared],
    'user-1',
  ), shared.id)
  assert.equal(getWhatsAppSendSessionId(
    { lead_id: 'lead-1', session_id: null },
    shared.id,
    [shared],
    'user-1',
  ), undefined)
})

test('admin com grant ve historico de lead alheio, mas nao pode enviar pelo numero compartilhado', () => {
  const shared = {
    id: 'session-shared', owner_user_id: 'other-user', status: 'connected',
    provider: 'evolution_go', can_send: true,
  }
  const conversation = {
    id: 'conversation-1', lead_id: 'lead-1', session_id: shared.id,
    contact_phone: '5511999999999',
    lead: { id: 'lead-1', assignee: { id: 'assigned-user' } },
  }
  const blocked = getWhatsAppMessageInputState(conversation, null, [shared], 'admin-user')
  assert.equal(blocked.disabled, true)
  assert.equal(blocked.sendSessionId, undefined)
  assert.match(blocked.placeholder, /sob sua responsabilidade/)

  const assigned = getWhatsAppMessageInputState(
    { ...conversation, lead: { id: 'lead-1', assignee: { id: 'admin-user' } } },
    null, [shared], 'admin-user',
  )
  assert.equal(assigned.disabled, false)
  assert.equal(assigned.sendSessionId, shared.id)
})

test('revogacao em chat aberto bloqueia envio anterior e permite iniciar pelo numero proprio', () => {
  const conversation = {
    id: 'conversation-shared', lead_id: 'lead-1', session_id: 'session-shared',
    contact_phone: '5511999999999',
    lead: { id: 'lead-1', assignee: { id: 'user-1' } },
  }
  const shared = {
    id: 'session-shared', owner_user_id: 'other-user', status: 'connected',
    provider: 'evolution_go', can_send: true,
  }
  const own = {
    id: 'session-own', owner_user_id: 'user-1', status: 'connected',
    provider: 'evolution_go', can_send: true,
  }
  assert.equal(getWhatsAppMessageInputState(conversation, null, [shared, own], 'user-1').disabled, false)

  const revokedState = getWhatsAppMessageInputState(
    conversation, null, [{ ...shared, can_send: false }, own], 'user-1',
  )
  assert.equal(revokedState.disabled, true)
  assert.equal(revokedState.sendSessionId, undefined)

  const ownDraft = getWhatsAppMessageInputState(
    { lead_id: 'lead-1', session_id: null, contact_phone: '5511999999999' },
    'session-own', [{ ...shared, can_send: false }, own], 'user-1',
  )
  assert.equal(ownDraft.disabled, false)
  assert.equal(ownDraft.sendSessionId, own.id)
})

test('usa o status atual da lista de integracoes no lugar do status antigo da conversa', () => {
  const state = getWhatsAppMessageInputState(
    {
      id: 'conversation-1',
      lead_id: 'lead-1',
      session_id: 'session-1',
      contact_phone: '5511999999999',
      remote_jid: '5511999999999@s.whatsapp.net',
      session: {
        id: 'session-1',
        status: 'disconnected',
        provider: 'evolution_go',
      },
    },
    null,
    [{ id: 'session-1', owner_user_id: 'user-1', status: 'connected', provider: 'evolution_go', can_send: true }],
    'user-1',
  )

  assert.deepEqual(state, {
    disabled: false,
    placeholder: 'Digite sua mensagem...',
    sendSessionId: 'session-1',
  })
})

test('nao oferece envio quando o backend marca a integracao desconectada sem can_send', () => {
  const state = getWhatsAppMessageInputState(
    {
      id: 'conversation-1',
      lead_id: 'lead-1',
      session_id: 'session-1',
      contact_phone: '5511999999999',
      remote_jid: '5511999999999@s.whatsapp.net',
      session: {
        id: 'session-1',
        status: 'connected',
        provider: 'evolution_go',
      },
    },
    null,
    [{ id: 'session-1', owner_user_id: 'user-1', status: 'disconnected', provider: 'evolution_go', can_send: false }],
    'user-1',
  )

  assert.equal(state.disabled, true)
  assert.equal(state.sendSessionId, undefined)
  assert.match(state.placeholder, /desconectado/)
})

test('nao oferece envio por sessao desconectada mesmo com can_send verdadeiro', () => {
  const state = getWhatsAppMessageInputState(
    {
      id: 'conversation-1',
      lead_id: 'lead-1',
      session_id: 'session-1',
      contact_phone: '5511999999999',
      session: { id: 'session-1', status: 'connected' },
    },
    null,
    [{ id: 'session-1', owner_user_id: 'user-1', status: 'disconnected', provider: 'evolution_go', can_send: true }],
    'user-1',
  )

  assert.equal(state.disabled, true)
  assert.equal(state.sendSessionId, undefined)
  assert.match(state.placeholder, /desconectado/)
})

test('permite iniciar conversa no detalhe de um lead ainda sem historico', () => {
  const state = getWhatsAppMessageInputState(
    {
      lead_id: 'lead-1',
      session_id: null,
      contact_phone: '5511999999999',
      remote_jid: null,
      is_group: false,
      session: null,
    },
    null,
    [{ id: 'session-1', owner_user_id: 'user-1', status: 'connected', provider: 'evolution_go', can_send: true }],
    'user-1',
  )

  assert.deepEqual(state, {
    disabled: false,
    placeholder: 'Digite sua mensagem...',
    sendSessionId: 'session-1',
  })
})

test('nao escolhe uma conta arbitraria quando ha varias integracoes desconectadas', () => {
  const state = getWhatsAppMessageInputState(
    {
      lead_id: 'lead-1',
      session_id: null,
      contact_phone: '5511999999999',
      remote_jid: null,
      is_group: false,
      session: null,
    },
    null,
    [
      { id: 'session-1', status: 'disconnected', provider: 'evolution_go' },
      { id: 'session-2', status: 'disconnected', provider: 'evolution_go' },
    ],
  )

  assert.equal(state.disabled, true)
  assert.equal(state.sendSessionId, undefined)
})

test('exige selecao quando ha varias integracoes conectadas e a conversa antiga esta offline', () => {
  const state = getWhatsAppMessageInputState(
    {
      lead_id: 'lead-1',
      session_id: 'session-old',
      contact_phone: '5511999999999',
      remote_jid: '5511999999999@s.whatsapp.net',
      session: {
        id: 'session-old',
        status: 'disconnected',
        provider: 'evolution_go',
      },
    },
    null,
    [
      { id: 'session-old', status: 'disconnected', provider: 'evolution_go' },
      { id: 'session-1', status: 'connected', provider: 'evolution_go' },
      { id: 'session-2', status: 'connected', provider: 'evolution_go' },
    ],
  )

  assert.equal(state.disabled, true)
  assert.equal(state.sendSessionId, undefined)
})
