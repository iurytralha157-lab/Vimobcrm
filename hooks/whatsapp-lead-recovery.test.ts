import assert from 'node:assert/strict';
import test from 'node:test';

import { findInaccessibleLeadHistoryConversation } from './whatsapp-lead-recovery';

const revoked = {
  id: 'conversation-revoked',
  lead_id: 'lead-1',
  session_id: 'session-revoked',
  historical_lead_view: true,
};

test('histórico de lead revogado exige nova escolha do WhatsApp', () => {
  assert.equal(findInaccessibleLeadHistoryConversation({
    leadId: 'lead-1',
    conversations: [revoked],
    accessibleSessionIds: ['session-own'],
    hasSelectedConversation: false,
    sessionsLoading: false,
  }), revoked);
});

test('histórico antigo sem acesso não bloqueia conversa atual acessível', () => {
  assert.equal(findInaccessibleLeadHistoryConversation({
    leadId: 'lead-1',
    conversations: [revoked, {
      id: 'conversation-current',
      lead_id: 'lead-1',
      session_id: 'session-own',
      historical_lead_view: false,
    }],
    accessibleSessionIds: ['session-own'],
    hasSelectedConversation: false,
    sessionsLoading: false,
  }), null);
});

test('não confunde outro lead, sessão sem ID ou sessões carregando com revogação', () => {
  const input = {
    leadId: 'lead-1',
    conversations: [
      { ...revoked, lead_id: 'lead-2' },
      { ...revoked, id: 'redacted', session_id: null },
    ],
    accessibleSessionIds: ['session-own'],
    hasSelectedConversation: false,
    sessionsLoading: false,
  };
  assert.equal(findInaccessibleLeadHistoryConversation(input), null);
  assert.equal(findInaccessibleLeadHistoryConversation({
    ...input,
    conversations: [revoked],
    sessionsLoading: true,
  }), null);
  assert.equal(findInaccessibleLeadHistoryConversation({
    ...input,
    conversations: [revoked],
    hasSelectedConversation: true,
  }), null);
});
