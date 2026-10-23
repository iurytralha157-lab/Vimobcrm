import assert from 'node:assert/strict';
import test from 'node:test';
import { formatPipelineOrderMicros, getPipelineBoardOrderAtForIndex, parsePipelineOrderMicros } from './pipeline-board-order';

const now = 1_792_137_600_000;
const lead = (board_order_at: string) => ({ board_order_at });

test('middle insertion preserves PostgreSQL microseconds instead of rounding below both neighbors', () => {
  const above = '2026-10-16T12:00:00.001800Z';
  const below = '2026-10-16T12:00:00.001200Z';
  const result = getPipelineBoardOrderAtForIndex([lead(above), lead(below)], 1, now);
  assert.equal(result, '2026-10-16T12:00:00.001500Z');
  assert.ok(parsePipelineOrderMicros(above)! > parsePipelineOrderMicros(result)!);
  assert.ok(parsePipelineOrderMicros(result)! > parsePipelineOrderMicros(below)!);
});

test('ties, one-microsecond intervals and invalid neighbors fail closed', () => {
  for (const below of ['2026-10-16T12:00:00.001800Z', '2026-10-16T12:00:00.001799Z', '2026-10-16T12:00:00.001801Z', 'invalid']) {
    assert.equal(getPipelineBoardOrderAtForIndex([lead('2026-10-16T12:00:00.001800Z'), lead(below)], 1, now), null);
  }
  assert.equal(getPipelineBoardOrderAtForIndex([lead('invalid')], 1, now), null);
  assert.equal(getPipelineBoardOrderAtForIndex([lead('invalid')], 0, now), null);
});

test('empty, top, future top and bottom each produce a representable strict position', () => {
  assert.equal(parsePipelineOrderMicros(getPipelineBoardOrderAtForIndex([], 0, now)), BigInt(now) * BigInt(1000));
  const future = '2099-01-01T00:00:00.000999Z';
  assert.equal(getPipelineBoardOrderAtForIndex([lead(future)], 0, now), '2099-01-01T00:00:00.001000Z');
  assert.equal(getPipelineBoardOrderAtForIndex([lead(future)], 1, now), '2098-12-31T23:59:58.000999Z');
  assert.equal(getPipelineBoardOrderAtForIndex([lead('2026-10-16T12:00:00.000002Z'), lead('2026-10-16T12:00:00.000000Z')], 1, now), '2026-10-16T12:00:00.000001Z');
});

test('RFC3339 offset and Gregorian dates roundtrip independently of local timezone and milliseconds', () => {
  for (const value of ['0001-01-01T00:00:00.000000Z', '1969-12-31T23:59:59.999999Z', '1970-01-01T00:00:00.000001Z', '2000-02-29T12:30:59.123456Z', '9999-12-31T23:59:59.999999Z']) {
    assert.equal(formatPipelineOrderMicros(parsePipelineOrderMicros(value)!), value);
  }
  assert.equal(formatPipelineOrderMicros(parsePipelineOrderMicros('2026-10-16T09:00:00.123456-03:00')!), '2026-10-16T12:00:00.123456Z');
  assert.equal(formatPipelineOrderMicros(parsePipelineOrderMicros('2026-10-16T12:00:00.123456000Z')!), '2026-10-16T12:00:00.123456Z');
  for (const value of ['2025-02-29T00:00:00Z', '2026-13-01T00:00:00Z', '2026-10-16T24:00:00Z', '2026-10-16T12:00:00.123456789Z']) assert.equal(parsePipelineOrderMicros(value), null);
});
