import assert from 'node:assert/strict';
import { test } from 'node:test';
const source = './lead-detail-metrics.ts';
const { daysSince, formatElapsedShort, isContactStale } = await import(source) as typeof import('./lead-detail-metrics');

const now = Date.parse('2026-11-27T12:00:00.000Z');
const ago = (days: number) => new Date(now - days * 24 * 60 * 60 * 1000).toISOString();

test('missing or invalid dates produce no label instead of a fake value', () => {
  assert.equal(daysSince(null, now), null);
  assert.equal(daysSince('not a date', now), null);
  assert.equal(formatElapsedShort(undefined, now), null);
  assert.equal(isContactStale(null, now), false);
});

test('labels stay short and use Portuguese singular and plural', () => {
  assert.equal(formatElapsedShort(ago(0), now), 'hoje');
  assert.equal(formatElapsedShort(ago(1), now), '1 dia');
  assert.equal(formatElapsedShort(ago(29), now), '29 dias');
  assert.equal(formatElapsedShort(ago(30), now), '1 mês');
  assert.equal(formatElapsedShort(ago(274), now), '9 meses');
  assert.equal(formatElapsedShort(ago(400), now), '1 ano');
  assert.equal(formatElapsedShort(ago(800), now), '2 anos');
});

test('a future timestamp (clock skew) counts as today, never negative', () => {
  assert.equal(daysSince(ago(-2), now), 0);
  assert.equal(formatElapsedShort(ago(-2), now), 'hoje');
});

test('contact becomes stale only after the threshold', () => {
  assert.equal(isContactStale(ago(7), now), false);
  assert.equal(isContactStale(ago(8), now), true);
});
