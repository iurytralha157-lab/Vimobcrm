import assert from 'node:assert/strict';
import test from 'node:test';
import { getWhatsAppMessageGrouping, type WhatsAppGroupingMessage } from '@/lib/whatsapp-message-grouping';

const message = (id: string, patch: Partial<WhatsAppGroupingMessage> = {}): WhatsAppGroupingMessage => ({
  id, sent_at: '2026-10-12T12:00:00.000Z', from_me: false,
  conversation_id: 'conversation-a', session_id: 'session-a', lead_id: 'lead-a', sender_jid: 'contact-a', ...patch,
});

test('consecutive messages have first/middle/last without merging their identities', () => {
  const a = message('a'), b = message('b'), c = message('c');
  assert.equal(getWhatsAppMessageGrouping(null, a, b), 'first');
  assert.equal(getWhatsAppMessageGrouping(a, b, c), 'middle');
  assert.equal(getWhatsAppMessageGrouping(b, c, null), 'last');
});
test('routing, attendance, sender and temporal boundaries break a visual block', () => {
  for (const patch of [
    { conversation_id: 'conversation-b' }, { session_id: 'session-b' }, { lead_id: 'lead-b' },
    { sender_jid: 'contact-b' }, { from_me: true }, { message_type: 'attendance' },
    { sent_at: '2026-10-12T12:06:00.000Z' }, { sent_at: 'invalid' },
  ]) assert.equal(getWhatsAppMessageGrouping(message('a'), message('b', patch), null), 'single');
  assert.equal(getWhatsAppMessageGrouping(null, message('b'), null), 'single');
});
test('local day and reversed timestamps do not group', () => {
  const a = message('a', { sent_at: new Date(2026, 9, 12, 23, 59).toISOString() });
  const b = message('b', { sent_at: new Date(2026, 9, 13, 0, 1).toISOString() });
  assert.equal(getWhatsAppMessageGrouping(a, b, null), 'single');
  assert.equal(getWhatsAppMessageGrouping(message('a', { sent_at: '2026-10-12T12:01:00Z' }), message('b'), null), 'single');
});

test('different CRM authors do not merge even on the same WhatsApp and with equal names', () => {
  const a = message('a', { from_me: true, sender_user_id: 'broker-a', sender_name: 'João' });
  const b = message('b', { from_me: true, sender_user_id: 'broker-b', sender_name: 'João' });
  assert.equal(getWhatsAppMessageGrouping(a, b, null), 'single');
  assert.equal(getWhatsAppMessageGrouping(a, { ...b, sender_user_id: 'broker-a' }, null), 'last');
  assert.equal(getWhatsAppMessageGrouping(a, { ...b, sender_user_id: undefined }, null), 'single');
});
