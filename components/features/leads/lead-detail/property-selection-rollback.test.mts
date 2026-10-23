import assert from 'node:assert/strict';
import test from 'node:test';
import { replaceOwnedPropertyDraft, rollbackLeadPropertySelection } from './property-selection-rollback';
import type { LeadDetailLead } from './types';

test('property failure restores only its fields and preserves additional contact input', () => {
  const old = { name: 'Old', property_id: 'old', valor_interesse: '100', commission_percentage: '5' };
  const owned = { property_id: 'selected', valor_interesse: '200', commission_percentage: '6' };
  const current = { ...old, ...owned, name: 'New draft', commission_percentage: '7' };
  assert.deepEqual(replaceOwnedPropertyDraft(current, owned, old), {
    name: 'New draft', property_id: 'old', valor_interesse: '100', commission_percentage: '7',
  });
});
test('property rollback never replaces newer realtime or a different scope', () => {
  const previous = { id: 'a', organization_id: 'org', property_id: 'old', updated_at: '2026-10-12T10:00:00.000001Z' } as LeadDetailLead;
  for (const patch of [{ updated_at: '2026-10-12T10:00:00.000002Z' }, { id: 'b' }, { organization_id: 'other' }]) {
    const current = { ...previous, property_id: 'selected', ...patch };
    assert.equal(rollbackLeadPropertySelection(current, previous, { property_id: 'selected' }), current);
  }
});
test('rollback keeps unrelated optimistic changes even at the same revision', () => {
  const previous = { id: 'a', organization_id: 'org', name: 'Old', property_id: 'old', commission_percentage: 5 } as LeadDetailLead;
  const current = { ...previous, name: 'New name', property_id: 'selected', commission_percentage: 7 };
  const result = rollbackLeadPropertySelection(current, previous, { property_id: 'selected', commission_percentage: 6 });
  assert.equal(result.name, 'New name'); assert.equal(result.property_id, 'old'); assert.equal(result.commission_percentage, 7);
});
