import assert from 'node:assert/strict';
import test from 'node:test';
import { hydrateLeadDetail, mergeLeadDetailMutation } from './hydrate-lead-detail';
import type { LeadDetailLead } from './types';

const snapshot = {
  id: 'lead', organization_id: 'org', name: 'Synthetic', stage_id: 'old',
  assigned_user_id: 'old-user', property_id: 'old-property', interest_property_id: 'old-property',
  tags: [{ id: 'old-tag', name: 'Old' }], stage: { id: 'old', name: 'Old stage' },
  assignee: { id: 'old-user', name: 'Old user' },
  property: { id: 'old-property', title: 'Old property' },
  interest_property: { id: 'old-property', title: 'Old property' },
} as LeadDetailLead;

test('fresh relations and an explicitly empty tag collection replace the board snapshot', () => {
  const incoming = { ...snapshot, tags: [], stage: { id: 'new', name: 'New stage' },
    stage_id: 'new', assignee: null, assigned_user_id: null } as LeadDetailLead;
  const result = hydrateLeadDetail(snapshot, incoming);
  assert.deepEqual(result.tags, []);
  assert.equal(result.stage?.name, 'New stage');
  assert.equal(result.assignee, null);
});

test('omitted relations reuse snapshots only when the foreign key is unchanged', () => {
  const incoming = { ...snapshot, stage: undefined, assignee: undefined, property: undefined,
    interest_property: undefined, tags: undefined } as LeadDetailLead;
  assert.equal(hydrateLeadDetail(snapshot, incoming).property, snapshot.property);
  const changed = hydrateLeadDetail(snapshot, { ...incoming, stage_id: 'new',
    assigned_user_id: 'new-user', property_id: 'new-property', interest_property_id: null });
  assert.equal(changed.stage, null);
  assert.equal(changed.assignee, null);
  assert.equal(changed.property, null);
  assert.equal(changed.interest_property, null);
  assert.equal(changed.tags, snapshot.tags);
});

test('explicit relation removal never revives an old property', () => {
  const result = hydrateLeadDetail(snapshot, { ...snapshot, property: null, interest_property: null });
  assert.equal(result.property, null);
  assert.equal(result.interest_property, null);
});

test('mutation responses retain newer realtime even within a millisecond', () => {
  const current = { ...snapshot, stage_id: 'realtime-stage', updated_at: '2026-10-12T10:00:00.123457Z' };
  const oldResponse = { ...snapshot, stage_id: 'response-stage', updated_at: '2026-10-12T10:00:00.123456Z' };
  assert.equal(mergeLeadDetailMutation(current, oldResponse), current);
});

test('canonical mutations clear stale relations when a foreign key changes', () => {
  const incoming = { ...snapshot, stage: undefined, assignee: undefined,
    stage_id: 'new-stage', assigned_user_id: 'new-user' } as LeadDetailLead;
  const result = mergeLeadDetailMutation(snapshot, incoming);
  assert.equal(result.stage, null);
  assert.equal(result.assignee, null);
  assert.equal(mergeLeadDetailMutation(snapshot, { ...incoming, id: 'other-lead' }), snapshot);
  assert.equal(mergeLeadDetailMutation(snapshot, { ...incoming, organization_id: 'other-org' }), snapshot);
});
