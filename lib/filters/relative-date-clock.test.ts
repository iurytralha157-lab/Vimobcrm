import assert from 'node:assert/strict';
import test from 'node:test';
import { millisecondsUntilNextCivilDay, relativeDateClockKey } from './relative-date-clock';

test('a relative preset gets a new key when a suspended tab resumes on another day', () => {
  const before = new Date(2026, 9, 12, 23, 59, 59, 999);
  const after = new Date(2026, 9, 13, 0, 0, 1);
  assert.notEqual(relativeDateClockKey(before), relativeDateClockKey(after));
  assert.equal(relativeDateClockKey(after), relativeDateClockKey(new Date(2026, 9, 13, 18)));
});

test('the refresh follows the next local civil day rather than a fixed 24-hour interval', () => {
  const now = new Date(2026, 9, 12, 23, 59, 59, 900);
  const delay = millisecondsUntilNextCivilDay(now);
  const boundary = new Date(now.getTime() + delay);
  assert.equal(boundary.getDate(), 13);
  assert.equal(boundary.getHours(), 0);
  assert.equal(boundary.getMinutes(), 0);
  assert.ok(delay >= 50 && delay < 1000);
});
