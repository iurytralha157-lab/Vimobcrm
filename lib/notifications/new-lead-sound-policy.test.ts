import assert from 'node:assert/strict';
import test from 'node:test';
import { createNewLeadSoundGate } from './new-lead-sound-policy';
import type { Notification } from '../api/notifications';

const started = 1_000_000;
const scope = { userId: 'recipient-a', organizationId: 'org-a' };
function notice(id: string, changes: Partial<Notification> = {}): Notification {
  return { id, user_id: scope.userId, organization_id: scope.organizationId, title: 'Fixture',
    content: null, type: 'lead', is_read: false, lead_id: 'lead-a',
    metadata: { event_key: 'new_lead_received' }, created_at: new Date(started + 1000).toISOString(), ...changes };
}

test('initial snapshot is silent; subsequent canonical recipient notification is new once', () => {
  const gate = createNewLeadSoundGate(scope, started);
  assert.deepEqual(gate([notice('baseline')], started), []);
  assert.deepEqual(gate([notice('new'), notice('baseline')], started + 2000).map(item => item.id), ['new']);
  assert.deepEqual(gate([notice('new'), notice('baseline')], started + 3000), []);
  assert.deepEqual(gate([notice('new', { is_read: true })], started + 4000), []);
});

test('type or title alone never authorizes sound and other recipients/organizations stay silent', () => {
  const gate = createNewLeadSoundGate(scope, started);
  gate([], started);
  const rejected = [notice('other-user', { user_id: 'recipient-b' }), notice('other-org', { organization_id: 'org-b' }),
    notice('reentry', { metadata: { event_key: 'lead_reentry' } }), notice('generic-lead', { metadata: null }),
    notice('legacy-label', { type: 'new_lead', metadata: null }), notice('read', { is_read: true }), notice('no-lead', { lead_id: null })];
  assert.deepEqual(gate(rejected, started + 2000), []);
  assert.deepEqual(gate([notice('assigned', { type: 'lead_assigned' })], started + 2000).map(item => item.id), ['assigned']);
});

test('old backlog, invalid dates, future clocks and pre-session arrivals are rejected', () => {
  const gate = createNewLeadSoundGate(scope, started);
  gate([], started);
  const dated = (id: string, offset: number) => notice(id, { created_at: new Date(started + offset).toISOString() });
  assert.deepEqual(gate([dated('before-session', -6000), dated('future', 20_000), notice('invalid', { created_at: 'invalid' })], started + 1000), []);
  assert.deepEqual(gate([dated('old-disconnect', 1000)], started + 92_000), []);
  assert.deepEqual(gate([dated('minute-poll', 2000)], started + 61_000).map(item => item.id), ['minute-poll']);
});

test('a notification seen while muted or audio-blocked cannot become backlog on enabling', () => {
  const gate = createNewLeadSoundGate(scope, started);
  gate([], started);
  assert.equal(gate([notice('muted-arrival')], started + 2000).length, 1);
  assert.deepEqual(gate([notice('muted-arrival')], started + 3000), []);
});
