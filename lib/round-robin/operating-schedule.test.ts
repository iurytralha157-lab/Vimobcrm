import assert from 'node:assert/strict';
import test from 'node:test';
import { createQueueOperatingSchedule, isQueueOperatingScheduleDraft, queueScheduleError, queueWarningMinutes } from './operating-schedule';
import { queueOperatingScheduleSchema } from '@/lib/validation/queue-runtime';
import { createRoundRobinInputSchema } from '@/lib/validation/crm-support';
import { hydrateDistributionQueueFormData } from './distribution-queue-form';

test('new draft chooses no timezone, weekday or hour and legacy read does not activate a calendar', () => {
  const draft = createQueueOperatingSchedule();
  assert.equal(draft.timezone, '');
  assert.equal(draft.days.length, 7);
  assert.ok(draft.days.every((day) => !day.is_active && day.start_time === null && day.end_time === null));
  assert.ok(queueScheduleError(draft));
  assert.equal(hydrateDistributionQueueFormData({ id: 'legacy', settings: {} }, []).settings.operating_schedule, undefined);
  assert.equal(hydrateDistributionQueueFormData({ id: 'legacy', settings: {} }, []).settings.pool_notifications, undefined);
  assert.equal(queueScheduleError(undefined), null);
  assert.ok(queueScheduleError(undefined, true));
});

test('pool notification opt-in is explicit, preserved and strictly boolean', () => {
  const form = hydrateDistributionQueueFormData({ id: 'managed', settings: { pool_notifications: { enabled: true } } }, []);
  assert.deepEqual(form.settings.pool_notifications, { enabled: true });
  assert.equal(createRoundRobinInputSchema.safeParse({ name: 'Fila QA', settings: { pool_notifications: { enabled: false } } }).success, true);
  assert.equal(createRoundRobinInputSchema.safeParse({ name: 'Fila QA', settings: { pool_notifications: { enabled: 'true' } } }).success, false);
});

test('weekly contract rejects missing/duplicate days, invalid timezone and ambiguous equal clocks', () => {
  const schedule = { ...createQueueOperatingSchedule(), timezone: 'America/Sao_Paulo' };
  assert.equal(queueScheduleError(schedule), null);
  assert.equal(queueOperatingScheduleSchema.safeParse({ ...schedule, days: schedule.days.slice(1) }).success, false);
  assert.equal(queueOperatingScheduleSchema.safeParse({ ...schedule, days: schedule.days.map(() => schedule.days[0]) }).success, false);
  assert.equal(queueOperatingScheduleSchema.safeParse({ ...schedule, timezone: 'invalid/zone' }).success, false);
  schedule.days[1] = { ...schedule.days[1], is_active: true, start_time: '10:00', end_time: '10:00' };
  assert.ok(queueScheduleError(schedule));
  assert.equal(isQueueOperatingScheduleDraft({ version: 1, timezone: 'UTC', days: null }), false);
});

test('overnight and explicit all-day retain their intended contract', () => {
  const schedule = { ...createQueueOperatingSchedule(), timezone: 'UTC' };
  schedule.days[6] = { ...schedule.days[6], is_active: true, start_time: '22:00', end_time: '06:00' };
  assert.equal(queueScheduleError(schedule), null);
  schedule.days[6] = { ...schedule.days[6], is_all_day: true };
  assert.ok(queueScheduleError(schedule));
  schedule.days[6] = { ...schedule.days[6], start_time: null, end_time: null };
  assert.equal(queueScheduleError(schedule), null);
});

test('timeout 1 through 5 stays allowed with warning zero; greater timeouts preserve optional warnings', () => {
  for (const timeout of [1, 4, 5]) {
    assert.equal(queueWarningMinutes(timeout, 5), 0);
    assert.equal(createRoundRobinInputSchema.safeParse({ name: 'Fila QA', settings: { enable_redistribution: true, redistribution_timeout_minutes: timeout, redistribution_warning_minutes: 0 } }).success, true);
    assert.equal(createRoundRobinInputSchema.safeParse({ name: 'Fila QA', settings: { redistribution_timeout_minutes: timeout, redistribution_warning_minutes: 1 } }).success, false);
  }
  assert.equal(queueWarningMinutes(6, 0), 0);
  assert.equal(queueWarningMinutes(6, 5), 5);
  assert.equal(createRoundRobinInputSchema.safeParse({ name: 'Fila QA', settings: { redistribution_timeout_minutes: 6, redistribution_warning_minutes: 6 } }).success, false);
});
