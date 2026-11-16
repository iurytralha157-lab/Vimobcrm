import assert from 'node:assert/strict';
import test from 'node:test';
import { auditVisibleKeys } from './audit';
import { buildLeadHistory } from './build-history';
import type { AuditLogRow, LeadHistoryRaw } from './types';

const at = '2026-11-15T23:48:52.380643Z';
const formatters = { formatCurrency: String, formatPropertyCurrency: String, formatResponseTime: String };
const snapshot = { stage_id: 'stage-b', pipeline_id: 'pipeline-a', assigned_user_id: 'owner-b',
  deal_status: 'open', interest_property_id: 'property-a' };
function audit(patch: Partial<AuditLogRow> = {}): AuditLogRow {
  return { id: 'tag-snapshot', action: 'automation_add_tag', user_id: 'actor-a', created_at: at,
    old_data: { ...snapshot }, new_data: { ...snapshot, origin: 'automation', execution_id: 'execution-a',
      node_key: 'tag-node', effect_key: 'tag-effect' }, ...patch };
}
function freeze(value: unknown) {
  if (value && typeof value === 'object') { Object.freeze(value); Object.values(value).forEach(freeze); }
}
function project(raw: LeadHistoryRaw) {
  const before = structuredClone(raw); freeze(raw);
  const history = buildLeadHistory(raw, 'lead-a', formatters);
  assert.deepEqual(raw, before, 'projection never mutates the stored evidence');
  return history;
}

test('an automation tag snapshot cannot manufacture an owner transfer after a stage move', () => {
  const history = project({ users: [{ id: 'owner-b', name: 'Synthetic owner' }], auditLogs: [audit()],
    activityEvents: [
      { id: 'stage', type: 'stage_change', user_id: 'actor-a', created_at: '2026-11-15T23:48:51.206371Z',
        metadata: { old_stage_id: 'stage-a', new_stage_id: 'stage-b' } },
      { id: 'tag', type: 'automation_add_tag', user_id: 'actor-a', created_at: at,
        content: 'Acao executada pela automacao: add_tag', metadata: { origin: 'automation' } },
    ] });
  assert.equal(history.some(event => event.type === 'assignee_changed'), false);
  assert.equal(history.some(event => event.id === 'audit-tag-snapshot'), false);
  assert.ok(history.find(event => event.id === 'activity-stage'));
  assert.ok(history.find(event => event.id === 'activity-tag'));
});

test('a snapshot with no field changes stays hidden without nearby activities too', () => {
  assert.deepEqual(auditVisibleKeys(audit(), []), []);
  assert.deepEqual(project({ auditLogs: [audit()] }), []);
});

test('a real owner change retains its transfer label and only its changed detail', () => {
  const row = audit({ action: 'update', old_data: { ...snapshot, assigned_user_id: 'owner-a' } });
  assert.deepEqual(auditVisibleKeys(row, []), ['assigned_user_id']);
  const changed = project({ auditLogs: [row], users: [{ id: 'owner-b', name: 'Synthetic owner' }] })[0];
  assert.equal(changed?.type, 'assignee_changed');
  assert.equal(changed?.label, 'Lead transferido para Synthetic owner');
  assert.equal(changed?.content, 'Responsável: owner-a → owner-b');
});

test('a stage-only snapshot remains a stage event without equal owner/status/property details', () => {
  const row = audit({ action: 'move_stage', old_data: { ...snapshot, stage_id: 'stage-a' } });
  assert.deepEqual(auditVisibleKeys(row, []), ['stage_id']);
  const changed = project({ auditLogs: [row] })[0];
  assert.equal(changed?.type, 'stage_change');
  assert.equal(changed?.content, 'Etapa: stage-a → stage-b');
});

for (const oldData of [undefined, null, {}, { deal_status: 'open' }]) {
  test(`unknown old owner preserves legacy audit evidence: ${JSON.stringify(oldData)}`, () => {
    const row = audit({ action: 'update', old_data: oldData, new_data: { assigned_user_id: null } });
    assert.deepEqual(auditVisibleKeys(row, []), ['assigned_user_id']);
    assert.equal(project({ auditLogs: [row] })[0]?.type, 'assignee_changed');
  });
}

for (const [oldValue, newValue, equal] of [
  [null, null, true], ['', '', true], [false, false, true], [0, 0, true],
  [null, '', false], [0, '0', false], [false, 0, false],
  [{ text: 'a', values: [1, null, { b: true, a: 2 }] }, { values: [1, null, { a: 2, b: true }], text: 'a' }, true],
  [[1, 2], [2, 1], false], [[1], [1, 2], false], [{ a: null }, {}, false],
  [[], {}, false], [{ a: 1 }, { a: 2 }, false],
] as const) {
  test(`only proven JSON equality hides an audited value: ${JSON.stringify([oldValue, newValue])}`, () => {
    const row = audit({ old_data: { feedback: oldValue }, new_data: { feedback: newValue } });
    const before = structuredClone(row); freeze(row);
    assert.deepEqual(auditVisibleKeys(row, []), equal ? [] : ['feedback']);
    assert.deepEqual(row, before);
  });
}

for (const value of ['[valor protegido]', { nested: '[valor protegido]' }, ['[valor protegido]']]) {
  test(`redaction never proves equality: ${JSON.stringify(value)}`, () => {
    const row = audit({ old_data: { lost_reason: value }, new_data: { lost_reason: structuredClone(value) } });
    assert.deepEqual(auditVisibleKeys(row, []), ['lost_reason']);
  });
}

test('snapshot filtering preserves changed protected fields and ignores internal metadata', () => {
  const row = audit({ old_data: { ...snapshot, lost_reason: '[valor protegido]' },
    new_data: { ...snapshot, lost_reason: '[valor protegido]', origin: 'automation',
      execution_id: 'execution-a', arbitrary_secret: 'not-visible' } });
  const changed = project({ auditLogs: [row] })[0];
  assert.equal(changed?.type, 'lead_updated');
  assert.equal(changed?.content, 'Motivo de perda atualizado');
  assert.equal(JSON.stringify(changed).includes('arbitrary_secret'), false);
  assert.equal(JSON.stringify(changed).includes('not-visible'), false);
});

for (const action of ['create', 'delete']) test(`${action} remains an event even with equal values`, () => {
  const history = project({ auditLogs: [audit({ action })] });
  assert.equal(history.length, 1);
  assert.equal(history[0]?.type, action === 'create' ? 'lead_created' : 'lead_deleted');
});

test('a move with a real status/loss change keeps those details beside its stage activity', () => {
  const row = audit({ action: 'move_stage', old_data: { ...snapshot, stage_id: 'stage-a', lost_reason: null },
    new_data: { ...snapshot, deal_status: 'lost', lost_reason: '[valor protegido]' } });
  const history = project({ auditLogs: [row], activityEvents: [{ id: 'stage', type: 'stage_change',
    user_id: 'actor-a', created_at: at, metadata: { old_stage_id: 'stage-a', new_stage_id: 'stage-b' } }] });
  assert.ok(history.find(event => event.id === 'activity-stage'));
  const changed = history.find(event => event.id === 'audit-tag-snapshot');
  assert.ok(changed);
  assert.match(changed.content || '', /Status: open → lost/);
  assert.match(changed.content || '', /Motivo de perda adicionado/);
  assert.doesNotMatch(changed.content || '', /Responsável|Imóvel/);
});
