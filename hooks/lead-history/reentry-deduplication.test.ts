import assert from 'node:assert/strict';
import test from 'node:test';
import { buildLeadHistory } from './build-history';
import type { ActivityEventRow, LeadEntryEventRow, LeadHistoryRaw } from './types';

const leadId = 'lead-reentry';
const queueId = '11111111-1111-4111-8111-111111111111';
const pipelineId = '22222222-2222-4222-8222-222222222222';
const stageId = '33333333-3333-4333-8333-333333333333';
const entryA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const entryB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const unrelatedEntry = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const orphanEntry = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const time = '2026-10-16T22:20:15.313805+00:00';
const formatters = { formatCurrency: String, formatPropertyCurrency: String, formatResponseTime: String };

function entry(id = entryA): LeadEntryEventRow {
  return { id, lead_id: leadId, entry_type: 'reentry', provider: 'manual', source: 'manual',
    created_at: time, pipeline_id: pipelineId, stage_id: stageId,
    metadata: { origin: 'vimob_api', state_preserved: true, intake_scope_key: `queue:${queueId}`,
      origin_round_robin_id: queueId, new_data: { deal_status: 'open' } } };
}

function activity(id = 'activity-a'): ActivityEventRow {
  return { id, type: 'lead_reentry', created_at: time, user_id: 'actor-a',
    user: { id: 'actor-a', name: 'Corretor sintético' }, content: 'Retorno registrado e responsável preservado.',
    metadata: { entry_type: 'manual_reentry', source: 'manual', actor_id: 'actor-a',
      intake_scope_key: `queue:${queueId}`, pipeline_id: pipelineId, stage_id: stageId, deal_status: 'open' } };
}

function projected(raw: LeadHistoryRaw) {
  return buildLeadHistory(raw, leadId, formatters).filter(event => event.type === 'lead_reentry');
}

const complete = (value: boolean) => ({ complete: value,
  canonicalPresence: { leadCreated: false, firstResponse: false, assignment: false } });

test('an explicit entry identity renders one detailed activity and leaves both raw audit sources intact', () => {
  const a = activity();
  a.metadata!.entry_event_id = entryA;
  const raw: LeadHistoryRaw = { entryEvents: [entry()], activityEvents: [a] };
  const before = structuredClone(raw);
  const result = projected(raw);
  assert.deepEqual(result.map(event => event.id), ['activity-activity-a']);
  assert.equal(result[0].content, a.content);
  assert.equal(result[0].actor?.id, 'actor-a');
  assert.equal(result[0].metadata?.entry_event_id, entryA);
  assert.deepEqual(raw, before);
});

test('three correlated sources retain the detailed activity as the only displayed occurrence', () => {
  const a = activity(); a.metadata!.entry_event_id = entryA;
  const raw: LeadHistoryRaw = { entryEvents: [entry()], activityEvents: [a], timelineEvents: [{
    id: 'same-timeline', event_type: 'lead_reentry', created_at: time,
    metadata: { entry_event_id: entryA, source: 'manual' },
  }] };
  assert.deepEqual(projected(raw).map(event => event.id), ['activity-activity-a']);
  delete raw.entryEvents;
  assert.deepEqual(projected(raw).map(event => event.id), ['activity-activity-a']);
});

test('two explicitly identified returns remain two occurrences even with equal text and timestamp', () => {
  const a = activity('a'); const b = activity('b');
  a.metadata!.entry_event_id = entryA; b.metadata!.entry_event_id = entryB;
  assert.deepEqual(projected({ entryEvents: [entry(entryB), entry(entryA)], activityEvents: [b, a] })
    .map(event => event.id), ['activity-b', 'activity-a']);
});

test('explicit entry identity also works on an incomplete page and does not depend on timestamp proximity', () => {
  const a = activity(); a.metadata!.entry_event_id = entryA;
  a.created_at = '2026-10-16T22:30:00.000Z';
  assert.deepEqual(projected({ entryEvents: [entry()], activityEvents: [a], historyCoverage: complete(false) })
    .map(event => event.id), ['activity-activity-a']);
});

test('a timeline identity can represent its own entry without hiding an unrelated automatic return', () => {
  const raw: LeadHistoryRaw = { entryEvents: [{ ...entry(), provider: 'whatsapp', source: 'whatsapp' },
    { ...entry(unrelatedEntry), provider: 'meta', source: 'meta' }], timelineEvents: [{
    id: 'timeline-return', event_type: 'lead_reentry', created_at: time, is_automation: true,
    metadata: { source: 'whatsapp', entry_event_id: entryA },
  }] };
  const result = projected(raw);
  assert.deepEqual(result.map(event => event.id), ['timeline-timeline-return', `entry-${unrelatedEntry}`]);
  assert.equal(result[0].isAutomation, true);
  assert.equal(result[1].label, '3ª Entrada');
});

test('a unique legacy manual producer pair uses its exact PostgreSQL transaction timestamp', () => {
  assert.deepEqual(projected({ entryEvents: [entry()], activityEvents: [activity()] })
    .map(event => event.id), ['activity-activity-a']);
});

test('the legacy timestamp key normalizes offsets without discarding PostgreSQL fractional precision', () => {
  const e = entry(); e.created_at = '2026-10-16T19:20:15.313805-03:00';
  assert.deepEqual(projected({ entryEvents: [e], activityEvents: [activity()] })
    .map(event => event.id), ['activity-activity-a']);
  e.created_at = '2026-10-16T22:20:15.100000+00:00';
  const a = activity(); a.created_at = '2026-10-16T22:20:15.1Z';
  assert.equal(projected({ entryEvents: [e], activityEvents: [a] }).length, 1);
});

test('different PostgreSQL microseconds in the same JavaScript millisecond never collapse', () => {
  const e = entry(); e.created_at = '2026-10-16T22:20:15.313806+00:00';
  assert.equal(new Date(e.created_at).getTime(), new Date(time).getTime());
  assert.equal(projected({ entryEvents: [e], activityEvents: [activity()] }).length, 2);
});

test('distinct legacy returns within one JavaScript millisecond keep one row per exact occurrence', () => {
  const e = entry(entryB); e.created_at = '2026-10-16T22:20:15.313806+00:00';
  const a = activity('activity-b'); a.created_at = e.created_at;
  assert.deepEqual(projected({ entryEvents: [entry(), e], activityEvents: [activity(), a] })
    .map(event => event.id), ['activity-activity-a', 'activity-activity-b']);
});

test('nearby times, equal text, and invalid or missing timestamps never establish a legacy identity', () => {
  for (const value of ['2026-10-16T22:20:15.314805+00:00', '2026-10-16T22:20:16.313805+00:00',
    '2026-10-16T22:20:15', '2026-02-30T22:20:15.313805Z', 'not-a-timestamp']) {
    const e = entry(); e.created_at = value;
    assert.equal(projected({ entryEvents: [e], activityEvents: [activity()] }).length, 2, value);
  }
});

test('legacy fallback waits for complete history and becomes eligible after both sources are fully loaded', () => {
  const raw: LeadHistoryRaw = { entryEvents: [entry()], activityEvents: [activity()], historyCoverage: complete(false) };
  assert.equal(projected(raw).length, 2);
  assert.equal(projected({ ...raw, historyCoverage: complete(true) }).length, 1);
});

test('ambiguous legacy matches are preserved on either side and independently of input ordering', () => {
  for (const reversed of [false, true]) {
    const entries = [entry(entryA), entry(entryB)];
    const activities = [activity('activity-a'), activity('activity-b')];
    if (reversed) { entries.reverse(); activities.reverse(); }
    assert.equal(projected({ entryEvents: entries, activityEvents: [activity()] }).length, 3);
    assert.equal(projected({ entryEvents: [entry()], activityEvents: activities }).length, 3);
    assert.equal(projected({ entryEvents: entries, activityEvents: activities }).length, 4);
  }
});

test('an explicit marker never falls back when its value is divergent, empty or malformed', () => {
  for (const value of [entryB, 'different-entry', '', ' ', null, 7, {}]) {
    const a = activity(); a.metadata!.entry_event_id = value;
    assert.equal(projected({ entryEvents: [entry()], activityEvents: [a] }).length, 2, JSON.stringify(value));
  }
});

test('legacy source, scope, destination, status, producer and actor mismatches preserve both records', () => {
  const changes: Array<[string, (e: LeadEntryEventRow, a: ActivityEventRow) => void]> = [
    ['source', e => { e.source = 'meta'; }],
    ['scope', e => { e.metadata!.intake_scope_key = 'unscoped'; }],
    ['origin queue', e => { e.metadata!.origin_round_robin_id = 'other-queue'; }],
    ['pipeline', e => { e.pipeline_id = 'other-pipeline'; }],
    ['stage', e => { e.stage_id = 'other-stage'; }],
    ['property', e => { e.property_id = 'other-property'; }],
    ['status', e => { e.metadata!.new_data = { deal_status: 'won' }; }],
    ['provider', e => { e.provider = 'meta'; }],
    ['origin', e => { e.metadata!.origin = 'another-producer'; }],
    ['state preservation', e => { e.metadata!.state_preserved = false; }],
    ['lead', e => { e.lead_id = 'another-lead'; }],
    ['actor', (_e, a) => { a.metadata!.actor_id = 'another-actor'; }],
    ['automation', (_e, a) => { a.metadata!.is_automation = true; }],
    ['activity type', (_e, a) => { a.metadata!.entry_type = 'provider_reentry'; }],
  ];
  for (const [name, change] of changes) {
    const e = entry(); const a = activity(); change(e, a);
    assert.equal(projected({ entryEvents: [e], activityEvents: [a] }).length, 2, name);
  }
});

test('missing legacy contract fields and orphan sources remain visible', () => {
  const missing: Array<(e: LeadEntryEventRow, a: ActivityEventRow) => void> = [
    e => { delete e.provider; }, e => { delete e.metadata; }, e => { delete e.lead_id; },
    e => { delete e.pipeline_id; }, e => { delete e.stage_id; }, e => { delete e.source; },
    e => { delete e.metadata!.state_preserved; }, e => { delete e.metadata!.intake_scope_key; },
    e => { delete e.metadata!.new_data; },
    (_e, a) => { delete a.metadata!.actor_id; }, (_e, a) => { delete a.metadata!.intake_scope_key; },
  ];
  for (const remove of missing) {
    const e = entry(); const a = activity(); remove(e, a);
    assert.equal(projected({ entryEvents: [e], activityEvents: [a] }).length, 2);
  }
  assert.deepEqual(projected({ entryEvents: [entry()] }).map(event => event.id), [`entry-${entryA}`]);
  assert.deepEqual(projected({ activityEvents: [activity()] }).map(event => event.id), ['activity-activity-a']);
});

test('a represented explicit entry cannot absorb a second legacy orphan activity', () => {
  const a = activity('identified'); a.metadata!.entry_event_id = entryA;
  const result = projected({ entryEvents: [entry()], activityEvents: [a, activity('orphan')] });
  assert.deepEqual(result.map(event => event.id), ['activity-identified', 'activity-orphan']);
});

test('distinct audit activities sharing an explicit identity and raw IDs cannot absorb an orphan entry', () => {
  const a = activity('first'); const b = activity('second');
  a.metadata!.entry_event_id = entryA; b.metadata!.entry_event_id = entryA;
  const entries = [entry(), entry(), entry(orphanEntry)];
  const raw: LeadHistoryRaw = { entryEvents: entries, activityEvents: [a, b] };
  assert.deepEqual(projected(raw).map(event => event.id), ['activity-first', 'activity-second', `entry-${orphanEntry}`]);
  assert.equal(raw.entryEvents?.length, 3);
  assert.equal(raw.activityEvents?.length, 2);
});

test('matching malformed identity strings never merge independent timeline and activity records', () => {
  const a = activity(); a.metadata!.entry_event_id = 'unknown';
  const raw: LeadHistoryRaw = { entryEvents: [entry()], activityEvents: [a], timelineEvents: [{
    id: 'unknown-timeline', event_type: 'lead_reentry', created_at: time,
    metadata: { entry_event_id: 'unknown' },
  }] };
  assert.equal(projected(raw).length, 3);
});

test('unidentified Meta reentries and their form answers survive legacy manual consolidation', () => {
  const a = activity('meta-activity');
  a.metadata = { source: 'meta', source_type: 'meta_lead_ads', field_data: { objetivo_compra: { value: 'Morar' } } };
  const raw: LeadHistoryRaw = { entryEvents: [{ ...entry(), provider: 'meta', source: 'meta' }], activityEvents: [a] };
  const result = buildLeadHistory(raw, leadId, formatters);
  assert.equal(result.filter(event => event.type === 'lead_reentry').length, 2);
  assert.ok(result.some(event => event.type === 'meta_form_answer'));
});
