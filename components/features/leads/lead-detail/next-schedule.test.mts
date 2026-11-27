import assert from 'node:assert/strict';
import { test } from 'node:test';
const source = './next-schedule.ts';
const { pickNextScheduleEvent, describeScheduleCountdown } = await import(source) as typeof import('./next-schedule');

const now = Date.parse('2026-11-27T12:00:00.000Z');
const at = (minutes: number) => new Date(now + minutes * 60_000).toISOString();

test('next appointment skips final statuses and invalid dates, keeps overdue ones', () => {
  const events = [
    { id: 'done', start_time: at(-600), status: 'completed' },
    { id: 'late', start_time: at(-30), status: 'scheduled' },
    { id: 'later', start_time: at(90), status: 'scheduled' },
    { id: 'bad', start_time: 'x', status: 'scheduled' },
    { id: 'none', start_time: null, status: 'scheduled' },
  ];
  assert.equal(pickNextScheduleEvent(events)?.id, 'late');
  assert.equal(pickNextScheduleEvent(events.filter((event) => event.id !== 'late'))?.id, 'later');
  assert.equal(pickNextScheduleEvent([{ id: 'c', start_time: at(5), status: 'cancelled' }]), null);
});

test('countdown turns red one hour before and while overdue', () => {
  assert.deepEqual(describeScheduleCountdown(at(3 * 24 * 60), now), { label: 'em 3 dias', alert: false });
  assert.deepEqual(describeScheduleCountdown(at(125), now), { label: 'em 2h 5min', alert: false });
  assert.deepEqual(describeScheduleCountdown(at(61), now), { label: 'em 1h 1min', alert: false });
  assert.deepEqual(describeScheduleCountdown(at(60), now), { label: 'em 1h', alert: true });
  assert.deepEqual(describeScheduleCountdown(at(40), now), { label: 'em 40 min', alert: true });
  assert.deepEqual(describeScheduleCountdown(at(0), now), { label: 'agora', alert: true });
  assert.deepEqual(describeScheduleCountdown(at(-20), now), { label: 'atrasado há 20 min', alert: true });
  assert.deepEqual(describeScheduleCountdown(at(-26 * 60), now), { label: 'atrasado há 1 dia', alert: true });
});
