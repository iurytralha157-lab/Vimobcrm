import assert from 'node:assert/strict';
import test from 'node:test';
import { auditContent, auditVisibleKeys } from './audit';
import { buildLeadHistory } from './build-history';
import type { ActivityEventRow, AuditLogRow, HistoryMetadata, LeadHistoryRaw } from './types';

const at = '2026-10-19T10:01:10.000Z';
const previous = '2026-10-19T10:01:00.000Z';
const protectedValue = '[valor protegido]';
const operationId = '11111111-1111-4111-8111-111111111111';
const requestId = '22222222-2222-4222-8222-222222222222';
const formatters = { formatCurrency: String, formatPropertyCurrency: String, formatResponseTime: String };
const transitions = [['open', 'lost'], ['lost', 'open'], ['open', 'won'], ['won', 'open'], ['won', 'lost'], ['lost', 'won']];
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { Object.freeze(value); Object.values(value).forEach(freeze); }
  return value;
}
function audit(patch: Partial<AuditLogRow> = {}): AuditLogRow {
  return { id: 'reason-change', action: 'update', user_id: 'actor-a', created_at: at,
    old_data: { lost_reason: 'Motivo A' }, new_data: { lost_reason: 'Motivo B' }, ...patch };
}
function activity(metadata: HistoryMetadata = {}, patch: Partial<ActivityEventRow> = {}): ActivityEventRow {
  return { id: 'status-activity', type: 'status_change', user_id: 'actor-a', created_at: previous,
    content: 'Lead marcado como perdido', metadata: { from_status: 'open', to_status: 'lost', ...metadata }, ...patch };
}
function statusAudit(from = 'open', to = 'lost', bridge: HistoryMetadata = {}): AuditLogRow {
  return audit({ old_data: { deal_status: from, lost_reason: protectedValue },
    new_data: { deal_status: to, lost_reason: protectedValue, ...bridge } });
}
function keys(row: AuditLogRow, activities: ActivityEventRow[]) {
  const before = structuredClone({ row, activities }); freeze(row); freeze(activities);
  const result = auditVisibleKeys(row, activities);
  assert.deepEqual({ row, activities }, before, 'audit correlation never mutates source data'); return result;
}
function project(raw: LeadHistoryRaw) {
  const before = structuredClone(raw); freeze(raw);
  const result = buildLeadHistory(raw, 'lead-a', formatters);
  assert.deepEqual(raw, before, 'the full history projection keeps its raw sources intact'); return result;
}

for (const complete of [true, false]) test(`an independent reason edit ten seconds after status remains in ${complete ? 'complete' : 'partial'} history`, () => {
  const rows = project({ historyCoverage: { complete }, auditLogs: [audit()], activityEvents: [activity()], users: [{ id: 'actor-a', name: 'Synthetic actor' }] });
  assert.ok(rows.some(row => row.id === 'activity-status-activity'));
  const changed = rows.find(row => row.id === 'audit-reason-change'); assert.ok(changed);
  assert.match(changed.content || '', /Motivo A.*Motivo B/);
  assert.equal(changed.type, 'lead_updated');
});

for (const [oldReason, newReason, description] of [
  ['Motivo A', 'Motivo B', 'updated'],
  [protectedValue, protectedValue, 'protected update'],
  [null, protectedValue, 'protected addition'],
  [protectedValue, null, 'protected removal'],
  [protectedValue, '', 'empty removal'],
  [null, 'Motivo B', 'plain addition'],
] as const) test(`lost_reason always survives nearby status activity: ${description}`, () => {
  const row = audit({ old_data: { lost_reason: oldReason }, new_data: { lost_reason: newReason } });
  assert.deepEqual(keys(row, [activity({ operation_id: operationId })]), ['lost_reason']);
  const content = auditContent(row.action, ['lost_reason'], row.old_data || {}, row.new_data || {}, String);
  assert.match(content || '', /Motivo de perda/); assert.equal(content?.includes(protectedValue), false);
});

for (const [from, to] of transitions) {
  test(`${from} -> ${to}: matching actor and status pair without a durable ID keep both audit keys`, () => {
    assert.deepEqual(keys(statusAudit(from, to), [activity({ from_status: from, to_status: to })]), ['deal_status', 'lost_reason']);
  });
  for (const idKey of ['operation_id', 'request_id']) test(`${from} -> ${to}: exact ${idKey} bridge suppresses status only, even outside fifteen seconds`, () => {
    const row = statusAudit(from, to, { [idKey]: operationId });
    const meta = { [idKey]: operationId, from_status: from, previous_status: from, old_status: from, to_status: to, new_status: to };
    assert.deepEqual(keys(row, [activity(meta, { created_at: '2026-10-18T10:01:00.000Z' })]), ['lost_reason']);
  });
}

for (const fromKey of ['from_status', 'previous_status', 'old_status']) for (const toKey of ['to_status', 'new_status']) {
  test(`consistent status aliases ${fromKey}/${toKey} confirm an identified occurrence`, () => {
    const meta = { operation_id: operationId, [fromKey]: 'open', [toKey]: 'lost' };
    assert.deepEqual(keys(statusAudit('open', 'lost', { operation_id: operationId }), [activity({}, { metadata: meta })]), ['lost_reason']);
  });
}

const bridges: Array<[string, HistoryMetadata, HistoryMetadata, boolean]> = [
  ['both IDs agree', { operation_id: operationId, request_id: requestId }, { operation_id: operationId, request_id: requestId }, true],
  ['one exact shared operation', { operation_id: operationId, request_id: requestId }, { operation_id: operationId }, true],
  ['one exact shared request', { request_id: requestId }, { operation_id: operationId, request_id: requestId }, true],
  ['different operations', { operation_id: operationId }, { operation_id: requestId }, false],
  ['operation agrees but request conflicts', { operation_id: operationId, request_id: requestId }, { operation_id: operationId, request_id: operationId }, false],
  ['request agrees but operation conflicts', { request_id: requestId, operation_id: operationId }, { request_id: requestId, operation_id: requestId }, false],
  ['cross-field equality is no bridge', { operation_id: operationId }, { request_id: operationId }, false],
  ['activity lacks IDs', { operation_id: operationId }, {}, false],
  ['audit lacks IDs', {}, { operation_id: operationId }, false],
];
for (const [name, auditBridge, activityBridge, duplicate] of bridges) test(`durable occurrence identity: ${name}`, () => {
  assert.deepEqual(keys(statusAudit('open', 'lost', auditBridge), [activity(activityBridge)]), duplicate ? ['lost_reason'] : ['deal_status', 'lost_reason']);
});
for (const value of [protectedValue, '', '   ', 42, false, { id: operationId }, [operationId]]) {
  for (const idKey of ['operation_id', 'request_id']) test(`${idKey}=${JSON.stringify(value)} cannot stand in for a durable ID`, () => {
    assert.deepEqual(keys(statusAudit('open', 'lost', { [idKey]: value }), [activity({ [idKey]: value })]), ['deal_status', 'lost_reason']);
  });
}
for (const idKey of ['operation_id', 'request_id']) for (const [auditId, activityId] of [
  [` ${operationId}`, operationId], [operationId, `${operationId} `], [` ${operationId} `, ` ${operationId} `],
]) test(`${idKey} must match byte-for-byte: ${JSON.stringify([auditId, activityId])}`, () => {
  assert.deepEqual(keys(statusAudit('open', 'lost', { [idKey]: auditId }), [activity({ [idKey]: activityId })]), ['deal_status', 'lost_reason']);
});
for (const side of ['old', 'new']) test(`array-valued ${side} audit status cannot coerce into a valid transition`, () => {
  const row = statusAudit('open', 'lost', { operation_id: operationId });
  if (side === 'old') row.old_data = { ...row.old_data, deal_status: ['open'] };
  else row.new_data = { ...row.new_data, deal_status: ['lost'] };
  assert.deepEqual(keys(row, [activity({ operation_id: operationId })]), ['deal_status', 'lost_reason']);
});

for (const [auditActor, activityActor, duplicate] of [
  ['actor-a', 'actor-a', true], ['actor-a', 'actor-b', false],
  [null, 'actor-a', true], ['actor-a', null, true], [null, null, true],
] as const) test(`known actor conflict vetoes the durable bridge: ${auditActor}/${activityActor}`, () => {
  const row = { ...statusAudit('open', 'lost', { operation_id: operationId }), user_id: auditActor };
  assert.deepEqual(keys(row, [activity({ operation_id: operationId }, { user_id: activityActor })]), duplicate ? ['lost_reason'] : ['deal_status', 'lost_reason']);
});
for (const actors of [[null, null], [null, 'actor-a'], ['actor-a', null], ['actor-a', 'actor-a']]) {
  test(`legacy missing-ID correlation never gains authority from actor ${actors.join('/')}`, () => {
    assert.deepEqual(keys({ ...statusAudit(), user_id: actors[0] }, [activity({}, { user_id: actors[1] })]), ['deal_status', 'lost_reason']);
  });
}

for (const meta of [
  {}, { from_status: 'open' }, { to_status: 'lost' },
  { from_status: 'won', to_status: 'lost' }, { from_status: 'open', to_status: 'won' },
  { from_status: 'open', previous_status: 'won', to_status: 'lost' },
  { from_status: 'open', old_status: null, to_status: 'lost' },
  { from_status: 'open', old_status: '', to_status: 'lost' },
  { from_status: 'open', to_status: 'lost', new_status: 'won' },
  { from_status: protectedValue, to_status: 'lost' },
]) test(`incomplete or conflicting activity status aliases preserve the audit: ${JSON.stringify(meta)}`, () => {
  assert.deepEqual(keys(statusAudit('open', 'lost', { operation_id: operationId }),
    [activity({}, { metadata: { ...meta, operation_id: operationId } })]), ['deal_status', 'lost_reason']);
});
for (const [from, to] of [['lost', 'lost'], [protectedValue, 'lost'], ['open', protectedValue], ['', 'lost']]) {
  test(`unchanged or noncanonical audit status is never deduplicated: ${from}/${to}`, () => {
    assert.deepEqual(keys(statusAudit(from, to, { request_id: requestId }), [activity({ request_id: requestId, from_status: from, to_status: to })]), ['deal_status', 'lost_reason']);
  });
}

test('a repeated same-actor status cycle cannot absorb the next reason-only edit by time or pair', () => {
  const activities = [activity(), activity({ from_status: 'lost', to_status: 'open' }, { id: 'reopen', created_at: '2026-10-19T10:01:05.000Z' }),
    activity({}, { id: 'second-loss', created_at: '2026-10-19T10:01:08.000Z' })];
  assert.deepEqual(keys(statusAudit(), activities), ['deal_status', 'lost_reason']);
  const rows = project({ activityEvents: activities, auditLogs: [audit()], users: [{ id: 'actor-a', name: 'Synthetic actor' }] });
  assert.ok(rows.find(row => row.id === 'audit-reason-change')?.content?.includes('Motivo B'));
});

for (const includeStatusActivity of [false, true]) test(`stage-move duplicate cannot erase remaining reason/status keys; identified status=${includeStatusActivity}`, () => {
  const row = audit({ action: 'move_stage', old_data: { stage_id: 'stage-a', deal_status: 'open', lost_reason: null },
    new_data: { stage_id: 'stage-b', deal_status: 'lost', lost_reason: protectedValue, operation_id: operationId } });
  const activities: ActivityEventRow[] = [{ id: 'stage-activity', type: 'stage_change', user_id: 'actor-a', created_at: at,
    metadata: { old_stage_id: 'stage-a', new_stage_id: 'stage-b' } }];
  if (includeStatusActivity) activities.push(activity({ operation_id: operationId }, { created_at: at }));
  const rows = project({ auditLogs: [row], activityEvents: activities, users: [{ id: 'actor-a', name: 'Synthetic actor' }] });
  const changed = rows.find(item => item.id === 'audit-reason-change'); assert.ok(changed);
  assert.match(changed.content || '', /Motivo de perda adicionado/);
  assert.equal(changed.content?.includes(protectedValue), false);
  assert.equal(changed.content?.includes('Status'), !includeStatusActivity);
});
test('a stage-move duplicate with status only is preserved without an occurrence bridge', () => {
  const rows = project({ auditLogs: [audit({ action: 'move_stage', old_data: { stage_id: 'stage-a', deal_status: 'open' },
    new_data: { stage_id: 'stage-b', deal_status: 'lost' } })], activityEvents: [{ id: 'stage', type: 'stage_change', user_id: 'actor-a', created_at: at,
      metadata: { old_stage_id: 'stage-a', new_stage_id: 'stage-b' } }] });
  assert.match(rows.find(row => row.id === 'audit-reason-change')?.content || '', /Status/);
});
test('a pure stage duplicate retains the existing suppression contract', () => {
  const rows = project({ auditLogs: [audit({ action: 'move_stage', old_data: { stage_id: 'stage-a' }, new_data: { stage_id: 'stage-b' } })],
    activityEvents: [{ id: 'stage', type: 'stage_change', user_id: 'actor-a', created_at: at, metadata: { old_stage_id: 'stage-a', new_stage_id: 'stage-b' } }] });
  assert.equal(rows.some(row => row.id === 'audit-reason-change'), false);
});
