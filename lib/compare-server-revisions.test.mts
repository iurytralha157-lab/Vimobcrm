import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compareServerRevisions } from '@/lib/compare-server-revisions';

test('orders PostgreSQL revisions within the same millisecond', () => {
  const first = '2026-10-12T10:01:00.123456Z';
  const second = '2026-10-12T10:01:00.123457Z';
  assert.equal(Date.parse(first), Date.parse(second));
  assert.equal(compareServerRevisions(second, first), 1);
  assert.equal(compareServerRevisions(first, second), -1);
});

test('supports nanoseconds without rounding or altering CAS strings', () => {
  assert.equal(compareServerRevisions('2026-10-12T10:01:00.000000002Z', '2026-10-12T10:01:00.000000001Z'), 1);
  assert.equal(compareServerRevisions('2026-10-12T10:01:00.1Z', '2026-10-12T10:01:00.100000000Z'), 0);
});

test('compares equivalent instants with offsets and optional fractions', () => {
  assert.equal(compareServerRevisions('2026-10-12T07:01:00.123457-03:00', '2026-10-12T10:01:00.123456Z'), 1);
  assert.equal(compareServerRevisions('2026-10-12T07:01:00-03:00', '2026-10-12T10:01:00.000Z'), 0);
  assert.equal(compareServerRevisions('2026-10-12T10:00:59.999999Z', '2026-10-12T10:01:00Z'), -1);
});

test('unknown revisions do not claim relative freshness', () => {
  for (const value of [undefined, null, '', 'invalid', '2026-10-12', '2026-10-12T10:00:00.1234567890Z']) {
    assert.equal(compareServerRevisions(value, '2026-10-12T10:01:00Z'), null);
    assert.equal(compareServerRevisions('2026-10-12T10:01:00Z', value), null);
  }
});
