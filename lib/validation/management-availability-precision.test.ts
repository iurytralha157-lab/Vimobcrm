import assert from 'node:assert/strict';
import test from 'node:test';
import { availabilityInputSchema } from './crm-support';

const day = {
  team_member_id: '11111111-1111-4111-8111-111111111111',
  expected_revision: 1,
  day_of_week: 1,
  is_active: true,
  is_all_day: false,
};

test('availability keeps a valid window within the same minute at second precision', () => {
  const result = availabilityInputSchema.parse({ ...day, start_time: '08:00:01', end_time: '08:00:02' });
  assert.equal(result.start_time, '08:00:01');
  assert.equal(result.end_time, '08:00:02');
});

test('the same clock remains an empty window across minute and second formats', () => {
  assert.equal(availabilityInputSchema.safeParse({ ...day, start_time: '08:00', end_time: '08:00:00' }).success, false);
  assert.equal(availabilityInputSchema.safeParse({ ...day, start_time: '08:00:01', end_time: '08:00:01' }).success, false);
});

test('overnight precision is preserved and malformed inactive clocks are rejected', () => {
  const result = availabilityInputSchema.parse({ ...day, start_time: '22:15:30', end_time: '06:15:45' });
  assert.equal(result.end_time, '06:15:45');
  assert.equal(availabilityInputSchema.safeParse({ ...day, is_active: false, start_time: '08:99:01', end_time: null }).success, false);
});
