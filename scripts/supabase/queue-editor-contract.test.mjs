import assert from 'node:assert/strict';
import test from 'node:test';
import { assertQueueEditorResponse } from './queue-editor-contract.mjs';

test('real editor schemas accept closed days with null clocks and reject API null-stripping', () => {
  const id = '10000000-0000-4000-8000-000000000001';
  const response = { data: { id, organizationId: id, revision: 1, name: 'Synthetic closed queue', isActive: true,
    lastAssignedIndex: 0, strategy: 'simple', leadsDistributed: 0, rules: [], members: [],
    createdAt: '2026-10-15T00:00:00Z', updatedAt: '2026-10-15T00:00:00Z', settings: { operating_schedule: {
      version: 1, timezone: 'America/Sao_Paulo', days: Array.from({ length: 7 }, (_, day_of_week) => ({
        day_of_week, is_active: false, is_all_day: false, start_time: null, end_time: null,
      })),
    } } } };
  assert.equal(assertQueueEditorResponse(response), response.data);
  const broken = structuredClone(response);
  for (const day of broken.data.settings.operating_schedule.days) { delete day.start_time; delete day.end_time; }
  assert.throws(() => assertQueueEditorResponse(broken), error => error.issues.some(issue => issue.path.join('.') === 'days.0.start_time'));
  const nullRules = structuredClone(response); nullRules.data.rules = null;
  assert.throws(() => assertQueueEditorResponse(nullRules), error => error.issues.some(issue => issue.path.join('.') === 'data.rules'));
});
