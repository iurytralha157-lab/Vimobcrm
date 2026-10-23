import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { apiActivitySchema, createActivityInputSchema } from './crm-support';

const leadId = '30000000-0000-4000-8000-000000000001';
const input = (type = 'note', metadata?: unknown) => ({ lead_id: leadId, type, content: 'Synthetic activity', metadata });

for (const type of ['status_change', 'stage_change', 'stage_changed', 'lead_created', 'lead_assigned', 'assignee_changed',
  'task_completed', 'first_response', 'property_selected', 'commission_created', 'document_attached', 'agenda_created',
  'whatsapp_message_sent', 'lead_reentry', 'automation_message', 'note_created', 'proposal_sent', 'custom_unknown', 'Call', 'call\u0000']) {
  test(`reject reserved or unsupported manual activity type ${JSON.stringify(type)}`, () => {
    assert.equal(createActivityInputSchema.safeParse(input(type)).success, false);
  });
}
for (const metadata of [{ origin: 'vimob_api' }, { origin: 'manual_activity' }, { kind: 'feedback' }, { event_kind: 'feedback' },
  { is_automation: true }, { operation_id: 'operation-a' }, { request_id: 'request-a' }, { task_id: 'task-a' },
  { from_status: 'open', to_status: 'won' }, { old_data: {}, new_data: {} }, { timeline_event_id: 'event-a' },
  { channel: { toString: null } }, { kind: { toString: null } }, [], 'metadata', true, 12]) {
  test(`reject forbidden or non-flat note metadata ${JSON.stringify(metadata)}`, () => {
    assert.equal(createActivityInputSchema.safeParse(input('note', metadata)).success, false);
  });
}
test('real call initiation contract stays valid with phone and channel', () => {
  const value = input('call_initiated', { phone: '+55 (11) 00000-0000', channel: 'phone' });
  assert.deepEqual(createActivityInputSchema.parse(value), value);
});
for (const [type, metadata] of [
  ['note', {}], ['call_initiated', {}], ['call', { phone: '', channel: 'phone', outcome: 'answered', notes: '' }],
  ['email', { channel: 'email', outcome: 'bounced', notes: 'Manual email result' }],
  ['message', { channel: 'whatsapp', outcome: 'seen_no_reply', notes: 'Manual message result' }],
] as const) test(`manual ${type} accepts its flat typed metadata`, () => {
  assert.equal(createActivityInputSchema.safeParse(input(type, metadata)).success, true);
});
test('content and flat metadata normalize without mutating the caller', () => {
  const original = { lead_id: ` ${leadId.toUpperCase()} `, type: ' call ', content: ' \n ',
    metadata: { phone: ' +55 ', channel: ' phone ', outcome: ' answered ', notes: '  Written manually  ' } };
  const before = structuredClone(original);
  assert.deepEqual(createActivityInputSchema.parse(original), { lead_id: leadId, type: 'call', content: null,
    metadata: { phone: '+55', channel: 'phone', outcome: 'answered', notes: 'Written manually' } });
  assert.deepEqual(original, before);
});
for (const metadata of [undefined, null]) test(`empty metadata ${String(metadata)} normalizes to object`, () => {
  assert.deepEqual(createActivityInputSchema.parse({ lead_id: leadId, type: 'note', metadata }),
    { lead_id: leadId, type: 'note', content: null, metadata: {} });
});
for (const field of ['content', 'notes', 'phone']) {
  test(`${field} rejects NUL and over-limit Unicode without truncating`, () => {
    const limit = field === 'phone' ? 80 : 2000;
    const value = (text: string) => field === 'content' ? { ...input('call'), content: text }
      : input('call', { [field]: text });
    assert.equal(createActivityInputSchema.safeParse(value('🧡'.repeat(limit))).success, true);
    assert.equal(createActivityInputSchema.safeParse(value('🧡'.repeat(limit + 1))).success, false);
    assert.equal(createActivityInputSchema.safeParse(value('Invalid\u0000text')).success, false);
  });
}
for (const [type, metadata] of [
  ['call', { outcome: 'replied' }], ['email', { outcome: 'answered' }], ['message', { outcome: 'busy' }],
  ['call_initiated', { outcome: 'answered' }], ['email', { phone: '5511000000000' }],
  ['call', { channel: 'whatsapp' }], ['message', { channel: 'email' }], ['email', { notes: null }],
  ['message', { notes: { toString: null } }], ['call', { phone: 5511000000000 }],
] as const) test(`metadata belongs to its manual type: ${type} ${JSON.stringify(metadata)}`, () => {
  assert.equal(createActivityInputSchema.safeParse(input(type, metadata)).success, false);
});
test('shared Go/frontend JSON vectors agree without letting the browser send server origin', () => {
  const fixture = JSON.parse(readFileSync('apps/api/internal/leads/testdata/manual_activity_cases.json', 'utf8'));
  assert.equal(fixture.version, 1); assert.ok(fixture.cases.length > 0);
  for (const vector of fixture.cases) {
    const parsed = createActivityInputSchema.safeParse(vector.input);
    assert.equal(parsed.success, vector.valid, vector.name);
    if (parsed.success) {
      const { origin, ...metadata } = vector.normalized.metadata;
      assert.equal(origin, 'manual_activity', vector.name);
      assert.deepEqual(parsed.data, { ...vector.normalized, metadata }, vector.name);
      assert.equal(Object.hasOwn(parsed.data.metadata, 'origin'), false, vector.name);
    }
  }
});
for (const type of ['status_change', 'task_completed', 'note', 'automation_message', 'agenda_created', 'custom_legacy']) {
  test(`historical read schema keeps ${type} data permissive`, () => {
    const value = { id: leadId, organization_id: leadId, lead_id: leadId, user_id: null, type,
      content: 'Historical fact', metadata: { origin: 'vimob_api', kind: 'feedback', nested: { safe: true } }, created_at: '2026-10-19T12:00:00Z' };
    assert.deepEqual(apiActivitySchema.parse(value), value);
  });
}
