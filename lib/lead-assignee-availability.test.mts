import assert from 'node:assert/strict';
import test from 'node:test';
import { getLeadAssigneeAvailability } from './lead-assignee-availability';
import type { MemberAvailability } from './api/teams';

const entry = (day: number, start: string, end: string) => ({
  id: 'synthetic', team_member_id: 'member', day_of_week: day,
  start_time: start, end_time: end, is_all_day: false, is_active: true,
  created_at: '2026-10-12T00:00:00Z', updated_at: '2026-10-12T00:00:00Z',
}) satisfies MemberAvailability;

test('availability uses the business timezone at a UTC day boundary', () => {
  const result = getLeadAssigneeAvailability([entry(0, '22:00:00', '23:00:00')], 'member', new Date('2026-10-12T01:30:00Z'));
  assert.equal(result.available, true);
  assert.equal(result.today?.day_of_week, 0);
});

test('overnight availability carries into the following civil day', () => {
  assert.equal(getLeadAssigneeAvailability([entry(0, '22:00:00', '02:00:00')], 'member', new Date('2026-10-12T04:00:00Z')).available, true);
  assert.equal(getLeadAssigneeAvailability([entry(0, '22:00:00', '02:00:00')], 'member', new Date('2026-10-12T05:01:00Z')).available, false);
});

test('inactive and foreign membership schedules never grant availability', () => {
  const now = new Date('2026-10-12T15:00:00Z');
  assert.equal(getLeadAssigneeAvailability([{ ...entry(1, '09:00:00', '18:00:00'), is_active: false }], 'member', now).available, false);
  assert.equal(getLeadAssigneeAvailability([entry(1, '09:00:00', '18:00:00')], 'other-member', now).available, false);
});
