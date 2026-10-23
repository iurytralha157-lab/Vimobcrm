import assert from 'node:assert/strict';
import test from 'node:test';
import { buildLeadHistory } from './build-history';
import type { LeadHistoryRaw } from './types';

// Synthetic reproduction of the observed producer contract: persisted timestamps
// match exactly, while the timeline's provider event_at precedes insertion.
const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const leadId = id(1), userId = id(2), queueId = id(3), distributionId = id(4);
const persisted = '2026-10-17T03:11:50.63272+00:00';
const provider = '2026-10-17T03:11:39+00:00';
const nextMicro = '2026-10-17T03:11:50.632721Z';
const formatters = { formatCurrency: String, formatPropertyCurrency: String, formatResponseTime: String };
function fixture(): LeadHistoryRaw {
  return {
    lead: { id: leadId, source: 'meta', created_at: persisted, assigned_at: persisted, assigned_user_id: userId },
    entryEvents: [{ id: id(5), lead_id: leadId, entry_type: 'initial', source: 'meta', provider: 'meta', created_at: persisted,
      metadata: { leadgen_id: 'synthetic-submission' } }],
    timelineEvents: [
      { id: id(6), event_type: 'lead_created', created_at: persisted, event_at: provider,
        metadata: { distribution_event_id: distributionId, source: 'meta', source_label: 'Meta Ads' } },
      { id: id(7), event_type: 'lead_assigned', created_at: persisted, event_at: provider,
        metadata: { distribution_event_id: distributionId, assigned_user_id: userId, queue_id: queueId,
          distribution_type: 'canonical_round_robin' } },
    ],
    activityEvents: [{ id: id(8), type: 'lead_created', created_at: persisted,
      metadata: { source: 'meta', source_type: 'meta_lead_ads', leadgen_id: 'synthetic-submission',
        form_name: 'Synthetic form', custom_fields: { objetivo: 'Morar' },
        creative_name: 'Synthetic creative', creative_url: 'https://example.invalid/creative.png' } }],
    distributionLogs: [{ id: id(9), created_at: persisted, round_robin_id: queueId, assigned_user_id: userId,
      reason: 'canonical_round_robin', metadata: { distribution_event_id: distributionId } }],
    assignmentLogs: [{ id: id(10), created_at: persisted, old_user_id: null, new_user_id: userId,
      round_robin_id: null, reason: 'canonical_round_robin' }],
    users: [{ id: userId, name: 'Synthetic recipient' }],
  };
}
const build = (raw: LeadHistoryRaw) => buildLeadHistory(raw, leadId, formatters);

test('initial Meta creation is shown once despite distinct provider event time and retains raw data and form/creative events', () => {
  const raw = fixture(); const before = structuredClone(raw);
  const history = build(raw);
  const created = history.filter(event => event.type === 'lead_created');
  assert.equal(created.length, 1);
  assert.equal(created[0].id, `timeline-${id(6)}`);
  assert.equal(created[0].timestamp, provider);
  assert.equal(history.some(event => event.type === 'meta_form_answer' && event.content === 'Morar'), true);
  assert.equal(history.some(event => event.type === 'meta_creative' && event.metadata?.creative_url === 'https://example.invalid/creative.png'), true);
  assert.deepEqual(raw, before);
});

test('initial assignment log uses the exact persisted bridge, leaving one canonical timeline event', () => {
  const raw = fixture(); const before = structuredClone(raw);
  const history = build(raw).filter(event => ['lead_assigned', 'assignee_changed'].includes(event.type));
  assert.deepEqual(history.map(event => event.id), [`timeline-${id(7)}`]);
  assert.equal(history[0].timestamp, provider);
  assert.deepEqual(raw, before);
});

test('equivalent timezone offsets and fractional padding preserve exact insertion identity', () => {
  const raw = fixture();
  raw.activityEvents![0].created_at = '2026-10-17T00:11:50.632720000-03:00';
  raw.assignmentLogs![0].created_at = '2026-10-17T03:11:50.632720Z';
  assert.equal(build(raw).filter(event => event.type === 'lead_created').length, 1);
  assert.equal(build(raw).some(event => event.id === `assignment-${id(10)}`), false);
});

for (const [name, mutate] of [
  ['activity one microsecond later', (raw: LeadHistoryRaw) => { raw.activityEvents![0].created_at = nextMicro; }],
  ['timeline one microsecond later', (raw: LeadHistoryRaw) => { raw.timelineEvents![0].created_at = nextMicro; }],
  ['initial entry one microsecond later', (raw: LeadHistoryRaw) => { raw.entryEvents![0].created_at = nextMicro; }],
  ['missing immutable lead', (raw: LeadHistoryRaw) => { raw.lead = undefined; }],
  ['entry belongs to another lead', (raw: LeadHistoryRaw) => { raw.entryEvents![0].lead_id = id(99); }],
  ['conflicting source', (raw: LeadHistoryRaw) => { raw.activityEvents![0].metadata!.source = 'webhook'; }],
  ['conflicting entry identity', (raw: LeadHistoryRaw) => { raw.activityEvents![0].metadata!.entry_event_id = id(99); }],
  ['conflicting provider submission', (raw: LeadHistoryRaw) => { raw.activityEvents![0].metadata!.leadgen_id = 'another-submission'; }],
  ['conflicting distribution identity', (raw: LeadHistoryRaw) => { raw.activityEvents![0].metadata!.distribution_event_id = id(99); }],
  ['ambiguous two initial activities', (raw: LeadHistoryRaw) => { raw.activityEvents!.push({ ...raw.activityEvents![0], id: id(18) }); }],
] as const) {
  test(`creation preserves independent evidence: ${name}`, () => {
    const raw = fixture(); mutate(raw);
    assert.equal(build(raw).some(event => event.id === `activity-${id(8)}`), true);
  });
}

test('reentries and later creation records are preserved with their own Meta form/creative facts', () => {
  const raw = fixture();
  raw.activityEvents!.push({ ...raw.activityEvents![0], id: id(18), type: 'lead_reentry', created_at: nextMicro,
    metadata: { ...raw.activityEvents![0].metadata, leadgen_id: 'reentry-submission', custom_fields: { objetivo: 'Investir' } } },
  { ...raw.activityEvents![0], id: id(19), created_at: '2026-10-17T04:00:00Z' });
  const history = build(raw);
  assert.equal(history.some(event => event.id === `activity-${id(18)}`), true);
  assert.equal(history.some(event => event.id === `activity-${id(19)}`), true);
  assert.equal(history.some(event => event.type === 'meta_form_answer' && event.content === 'Investir'), true);
});

for (const [name, mutate] of [
  ['manual transfer', (raw: LeadHistoryRaw) => { raw.assignmentLogs![0].reason = 'manual_transfer'; }],
  ['assignment one microsecond later', (raw: LeadHistoryRaw) => { raw.assignmentLogs![0].created_at = nextMicro; }],
  ['prior owner present', (raw: LeadHistoryRaw) => { raw.assignmentLogs![0].old_user_id = id(99); }],
  ['different recipient', (raw: LeadHistoryRaw) => { raw.assignmentLogs![0].new_user_id = id(99); }],
  ['distinct distribution ID', (raw: LeadHistoryRaw) => { raw.distributionLogs![0].metadata!.distribution_event_id = id(99); }],
  ['distribution insertion one microsecond later', (raw: LeadHistoryRaw) => { raw.distributionLogs![0].created_at = nextMicro; }],
  ['missing distribution bridge', (raw: LeadHistoryRaw) => { raw.distributionLogs = []; }],
  ['unknown distribution reason', (raw: LeadHistoryRaw) => { raw.distributionLogs![0].reason = 'another-operation'; }],
  ['conflicting recipient aliases', (raw: LeadHistoryRaw) => { raw.timelineEvents![1].metadata!.to_user_id = id(99); }],
  ['conflicting queue aliases', (raw: LeadHistoryRaw) => { raw.timelineEvents![1].metadata!.distribution_queue_id = id(99); }],
  ['explicit redistribution marker', (raw: LeadHistoryRaw) => { raw.distributionLogs![0].metadata!.is_initial_distribution = false; }],
  ['multiple distribution bridges', (raw: LeadHistoryRaw) => { raw.distributionLogs!.push({ ...raw.distributionLogs![0], id: id(29) }); }],
  ['one microsecond later with identical display time', (raw: LeadHistoryRaw) => {
    raw.assignmentLogs![0].created_at = nextMicro; raw.timelineEvents![1].event_at = persisted;
  }],
] as const) {
  test(`assignment preserves independent evidence: ${name}`, () => {
    const raw = fixture(); mutate(raw);
    assert.equal(build(raw).some(event => event.id === `assignment-${id(10)}`), true);
  });
}

for (const identity of ['operation_id', 'entry_event_id', 'request_id', 'distribution_event_id', 'timeline_event_id', 'activity_id']) {
  test(`explicit creation ${identity} remains consolidated without an initial entry in the loaded window`, () => {
    const raw = fixture(); raw.lead = undefined; raw.entryEvents = [];
    const activity = raw.activityEvents![0], timeline = raw.timelineEvents![0];
    if (identity === 'timeline_event_id') activity.metadata![identity] = timeline.id;
    else if (identity === 'activity_id') timeline.metadata![identity] = activity.id;
    else activity.metadata![identity] = timeline.metadata![identity] = id(40);
    assert.equal(build(raw).some(event => event.id === `activity-${id(8)}`), false);
  });
}

test('conflicting explicit creation identities remain separate even at the same displayed time', () => {
  const raw = fixture(); raw.timelineEvents![0].event_at = persisted;
  raw.activityEvents![0].metadata!.operation_id = id(40);
  raw.timelineEvents![0].metadata!.operation_id = id(41);
  assert.equal(build(raw).some(event => event.id === `activity-${id(8)}`), true);
});
