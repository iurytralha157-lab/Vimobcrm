import assert from 'node:assert/strict'
import test from 'node:test'

import {
	createWhatsAppTextSendGuard,
	getWhatsAppConversationDraftKey,
	getWhatsAppConversationMessageScope,
  getWhatsAppMessageInputState,
  getWhatsAppSendSessionId,
	preserveWhatsAppConversationCardSnapshot,
	updateWhatsAppConversationDraft,
} from './whatsapp-message-input'

test('duplo clique no mesmo rascunho inicia um unico envio', () => {
	const guard = createWhatsAppTextSendGuard()
	guard.observeDraft('lead-a', ' Primeira mensagem ')
	const first = guard.begin()
	assert.ok(first)
	assert.equal(first.text, 'Primeira mensagem')
	assert.equal(guard.begin(), null)
	guard.accepted(first)
	// Mesmo que um render atrasado ainda mostre o texto anterior, o mesmo
	// clique nao cria uma segunda intencao nem um novo clientMessageId.
	guard.observeDraft('lead-a', ' Primeira mensagem ')
	assert.equal(guard.begin(), null)
	guard.observeDraft('lead-a', '')
	assert.equal(guard.begin(), null)
})

test('um novo texto avanca antes da resposta do envio anterior', () => {
	const guard = createWhatsAppTextSendGuard()
	guard.observeDraft('lead-a', 'Primeira')
	const first = guard.begin()
	assert.ok(first)
	guard.accepted(first)
	guard.observeDraft('lead-a', '')
	guard.observeDraft('lead-a', 'Segunda')
	const second = guard.begin()
	assert.ok(second)
	assert.equal(second.text, 'Segunda')
	assert.notEqual(second.revision, first.revision)
	guard.accepted(second)
})

test('o mesmo texto digitado novamente depois de limpar e um novo envio legitimo', () => {
	const guard = createWhatsAppTextSendGuard()
	guard.observeDraft('lead-a', 'Oi')
	const first = guard.begin()
	assert.ok(first)
	guard.accepted(first)
	guard.observeDraft('lead-a', '')
	guard.observeDraft('lead-a', 'Oi')
	const second = guard.begin()
	assert.ok(second)
	assert.equal(second.text, 'Oi')
	assert.notEqual(second.revision, first.revision)
})

test('edicao durante confirmacao conserva o novo rascunho e cancelamento permite tentar de novo', () => {
	const guard = createWhatsAppTextSendGuard()
	guard.observeDraft('lead-a', 'Primeira')
	const first = guard.begin()
	assert.ok(first)
	guard.observeDraft('lead-a', 'Segunda')
	assert.equal(guard.begin(), null)
	guard.aborted(first)
	const second = guard.begin()
	assert.ok(second)
	assert.equal(second.text, 'Segunda')
	guard.accepted(second)
	guard.allowRetry(second)
	guard.observeDraft('lead-a', 'Segunda')
	assert.ok(guard.begin())
})

test('confirmacao antiga nao envia depois de trocar conversa ou organizacao', () => {
	const guard = createWhatsAppTextSendGuard()
	guard.observeDraft('org-a:lead-a', 'Mensagem antiga')
	const oldIntent = guard.begin()
	assert.ok(oldIntent)
	guard.observeDraft('org-b:lead-b', 'Mensagem nova')
	assert.equal(guard.accepted(oldIntent), false)
	const currentIntent = guard.begin()
	assert.ok(currentIntent)
	assert.equal(currentIntent.draftKey, 'org-b:lead-b')
})

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
    [{ id: '40000000-0000-4000-8000-000000000002' }],
  )

  assert.equal(result, undefined)
})

test('persisted conversation does not use a revoked session or another account', () => {
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

test('removed access disables the composer without choosing the user own number', () => {
  const state = getWhatsAppMessageInputState(
    {
      id: 'conversation-1',
      lead_id: 'lead-1',
      session_id: 'old-session',
      contact_phone: '5511999999999',
      session: { id: 'old-session', status: 'connected' },
    },
    'own-session',
    [{ id: 'own-session', status: 'connected', provider: 'evolution_go' }],
  )

  assert.equal(state.disabled, true)
  assert.equal(state.accessLost, true)
  assert.equal(state.sendSessionId, undefined)
})

test('new conversation draft may use the explicitly selected session', () => {
  const result = getWhatsAppSendSessionId(
    { session_id: null },
    '40000000-0000-4000-8000-000000000002',
    [{ id: '40000000-0000-4000-8000-000000000002' }],
  )

  assert.equal(result, '40000000-0000-4000-8000-000000000002')
})

test('usa o status atual da lista de integracoes no lugar do status antigo da conversa', () => {
  const state = getWhatsAppMessageInputState(
    {
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
    [{ id: 'session-1', status: 'connected', provider: 'evolution_go' }],
  )

  assert.deepEqual(state, {
    disabled: false,
    placeholder: 'Digite sua mensagem...',
    sendSessionId: 'session-1',
  })
})

test('deixa o backend validar uma unica integracao configurada que aparece desconectada', () => {
  const state = getWhatsAppMessageInputState(
    {
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
    [{ id: 'session-1', status: 'disconnected', provider: 'evolution_go' }],
  )

  assert.deepEqual(state, {
    disabled: false,
    placeholder: 'Digite sua mensagem...',
    sendSessionId: 'session-1',
  })
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
    [{ id: 'session-1', status: 'connected', provider: 'evolution_go' }],
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
