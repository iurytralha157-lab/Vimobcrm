import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getWhatsAppReplacementCandidateDecision,
  getWhatsAppReplacementPlan,
} from './whatsapp-replacement-flow';

const source = {
  id: '50000000-0000-4000-8000-000000000001',
  lead_id: '60000000-0000-4000-8000-000000000001',
  session_id: '40000000-0000-4000-8000-000000000001',
  contact_phone: '+55 22 97406-3727',
  remote_jid: '5522974063727@s.whatsapp.net',
};

const ownedSessions = [
  { id: source.session_id, status: 'connected', provider: 'evolution_go' },
  { id: '40000000-0000-4000-8000-000000000002', status: 'connected', provider: 'evolution_go' },
  { id: '40000000-0000-4000-8000-000000000003', status: 'disconnected', provider: 'evolution_go' },
  { id: '40000000-0000-4000-8000-000000000004', status: 'connected', provider: 'evolution' },
];

test('historical card offers only a different owned connected GO session', () => {
  assert.deepEqual(getWhatsAppReplacementPlan({
    ...source,
    historical_lead_view: true,
  }, ownedSessions), {
    reason: 'historical',
    leadId: source.lead_id,
    phone: '+5522974063727',
    sourceConversationId: source.id,
    sourceSessionId: source.session_id,
    connectedSessionIds: ['40000000-0000-4000-8000-000000000002'],
  });
});

test('disconnected and removed physical sessions can offer another owned account', () => {
  for (const status of ['disconnected', 'deleted']) {
    const plan = getWhatsAppReplacementPlan({
      ...source,
      session: { id: source.session_id, status },
    }, ownedSessions.slice(1));
    assert.equal(plan?.reason, 'unavailable-session');
    assert.deepEqual(plan?.connectedSessionIds, ['40000000-0000-4000-8000-000000000002']);
  }
});

test('no replacement for current connected chat, group, or unlinked conversation', () => {
  assert.equal(getWhatsAppReplacementPlan(source, ownedSessions), null);
  assert.equal(getWhatsAppReplacementPlan({ ...source, is_group: true, historical_lead_view: true }, ownedSessions), null);
  assert.equal(getWhatsAppReplacementPlan({ ...source, lead_id: null, historical_lead_view: true }, ownedSessions), null);
});

test('phone JID is exact fallback; a LID cannot become a recipient', () => {
  const historical = { ...source, historical_lead_view: true, contact_phone: null };
  assert.equal(getWhatsAppReplacementPlan(historical, ownedSessions)?.phone, '+5522974063727');
  assert.equal(getWhatsAppReplacementPlan({ ...historical, remote_jid: '12345@lid' }, ownedSessions)?.phone, null);
  assert.equal(getWhatsAppReplacementPlan({ ...historical, contact_phone: '+5511999999999' }, ownedSessions)?.phone, '+5511999999999');
  assert.equal(getWhatsAppReplacementPlan({ ...source, session: { id: source.session_id, status: 'disconnected' }, contact_phone: '+5511999999999' }, ownedSessions.slice(1))?.phone, null);
});

test('candidate preflight never reuses source or silently moves another lead', () => {
  const request = {
    leadId: source.lead_id,
    phone: '+5522974063727',
    sourceConversationId: source.id,
    sessionId: ownedSessions[1].id,
  };
  const candidate = { ...source, id: '50000000-0000-4000-8000-000000000002', session_id: request.sessionId };
  assert.deepEqual(getWhatsAppReplacementCandidateDecision(null, request), { action: 'start' });
  assert.deepEqual(getWhatsAppReplacementCandidateDecision(source, request), {
    action: 'blocked', reason: 'source-conversation',
  });
  assert.deepEqual(getWhatsAppReplacementCandidateDecision({ ...candidate, lead_id: 'another-lead' }, request), {
    action: 'blocked', reason: 'another-lead',
  });
  assert.deepEqual(getWhatsAppReplacementCandidateDecision({ ...candidate, lead_id: null, lead: { id: 'another-lead' } }, request), {
    action: 'blocked', reason: 'another-lead',
  });
  assert.deepEqual(getWhatsAppReplacementCandidateDecision({ ...candidate, contact_phone: '+5511999999999' }, request), {
    action: 'blocked', reason: 'identity-mismatch',
  });
  assert.deepEqual(getWhatsAppReplacementCandidateDecision({ ...candidate, lead_id: null }, request), {
    action: 'start',
  });
  assert.deepEqual(getWhatsAppReplacementCandidateDecision(candidate, request), {
    action: 'open', conversationId: candidate.id,
  });
});
