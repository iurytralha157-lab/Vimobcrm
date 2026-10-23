import assert from 'node:assert/strict';
import test from 'node:test';
import { auditVisibleKeys } from './audit';
import { buildLeadHistory } from './build-history';
import type { ActivityEventRow, AuditLogRow } from './types';

const time = '2026-10-18T12:00:00.000001Z';
const activity: ActivityEventRow = { id: 'property-selection', type: 'property_selected', user_id: 'actor-a',
  created_at: time, metadata: { property_id: 'property-a', property_price: '300000', commission_percentage: '5' } };
const audit = (patch: Partial<AuditLogRow> = {}): AuditLogRow => ({ id: 'audit-a', action: 'update', user_id: 'actor-a',
  created_at: '2026-10-18T12:00:05.000001Z', old_data: { valor_interesse: '300000', commission_percentage: '5' },
  new_data: { valor_interesse: '400000', commission_percentage: '6' }, ...patch });

test('a nearby property selection never hides a later value or commission edit', () => {
  for (const type of ['property_selected', 'property_linked']) {
    assert.deepEqual(auditVisibleKeys(audit(), [{ ...activity, type }]), ['commission_percentage', 'valor_interesse']);
  }
});

test('property metadata is not a replacement for audited before/after financial values', () => {
  const sameWrite = audit({ created_at: time, old_data: { property_id: 'old', valor_interesse: '200000', commission_percentage: '4' },
    new_data: { property_id: 'property-a', valor_interesse: '300000', commission_percentage: '5' } });
  assert.deepEqual(auditVisibleKeys(sameWrite, [activity]), ['commission_percentage', 'valor_interesse']);
});

test('clearing financial values and setting them to zero remain visible beside a property selection', () => {
  for (const value of [null, 0, '0']) {
    assert.deepEqual(auditVisibleKeys(audit({ new_data: { valor_interesse: value, commission_percentage: value } }), [activity]),
      ['commission_percentage', 'valor_interesse']);
  }
});

test('unified history keeps the property event and each distinct financial audit occurrence', () => {
  const history = buildLeadHistory({ activityEvents: [activity], auditLogs: [audit(), audit({ id: 'audit-b',
    created_at: '2026-10-18T12:00:06.000001Z', old_data: { valor_interesse: '400000', commission_percentage: '6' },
    new_data: { valor_interesse: '300000', commission_percentage: '5' } })] }, 'lead-a', {
    formatCurrency: value => `BRL ${value}`, formatPropertyCurrency: value => `BRL ${value}`, formatResponseTime: String,
  });
  assert.equal(history.filter(event => event.type === 'property_selected').length, 1);
  assert.match(history.find(event => event.id === 'audit-audit-a')?.content || '', /Comissão: 5 → 6/);
  assert.match(history.find(event => event.id === 'audit-audit-a')?.content || '', /BRL 300000 → BRL 400000/);
  assert.match(history.find(event => event.id === 'audit-audit-b')?.content || '', /Comissão: 6 → 5/);
  assert.match(history.find(event => event.id === 'audit-audit-b')?.content || '', /BRL 400000 → BRL 300000/);
});
