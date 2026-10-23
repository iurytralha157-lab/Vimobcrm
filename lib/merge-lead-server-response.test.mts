import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mergeLeadServerResponse } from '@/lib/merge-lead-server-response';

type CachedLead = {
  id: string;
  organization_id: string;
  updated_at: string;
  assigned_user_id: string | null;
  team_id: string | null;
  stage_id: string | null;
  can_operate?: boolean;
  assignee?: { id: string; name: string } | null;
  stage?: { id: string; name: string } | null;
  tags?: { id: string }[];
  name?: string;
};

const current: CachedLead = { id: 'lead', organization_id: 'org', updated_at: '2026-10-12T10:00:00.123457Z',
  assigned_user_id: 'owner', team_id: 'team', stage_id: 'stage', can_operate: true,
  assignee: { id: 'owner', name: 'Owner' }, stage: { id: 'stage', name: 'Stage' },
  tags: [{ id: 'tag' }], name: 'Current' };

test('older canonical response cannot overwrite a newer read', () => {
  assert.equal(mergeLeadServerResponse(current, { ...current, name: 'Old', updated_at: '2026-10-12T10:00:00.123456Z' }), current);
});

test('omitted read relations and fields remain available for unchanged foreign keys', () => {
  const response = { ...current, updated_at: '2026-10-12T10:00:01Z', assignee: undefined, stage: undefined, tags: undefined, name: undefined };
  const result = mergeLeadServerResponse(current, response);
  assert.equal(result.assignee, current.assignee);
  assert.equal(result.stage, current.stage);
  assert.equal(result.tags, current.tags);
  assert.equal(result.name, current.name);
});

test('foreign key changes clear stale relations and read capability', () => {
  const response = { ...current, updated_at: '2026-10-12T10:00:01Z', stage_id: 'new-stage',
    assigned_user_id: 'new-owner', assignee: undefined, stage: undefined, can_operate: undefined };
  const result = mergeLeadServerResponse(current, response);
  assert.equal(result.assignee, undefined);
  assert.equal(result.stage, undefined);
  assert.equal(result.can_operate, undefined);
});

test('explicit relation removal and empty tags are canonical', () => {
  const response = { ...current, updated_at: '2026-10-12T10:00:01Z', assignee: null, tags: [], can_operate: false };
  const result = mergeLeadServerResponse(current, response);
  assert.equal(result.assignee, null);
  assert.deepEqual(result.tags, []);
  assert.equal(result.can_operate, false);
});

test('a different lead or organization cannot replace a cached read', () => {
  assert.equal(mergeLeadServerResponse(current, { ...current, id: 'other' }), current);
  assert.equal(mergeLeadServerResponse(current, { ...current, organization_id: 'other' }), current);
});
