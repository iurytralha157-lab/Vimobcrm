import assert from 'node:assert/strict';
import test from 'node:test';
import { getAgendaHistoryPresentation } from './agenda-history.ts';

const invalid = [
  '2026-02-29T12:00:00Z', '2026-02-30T12:00:00Z', '2026-02-31T12:00:00Z',
  '2026-04-31T12:00:00Z', '2026-06-31T12:00:00Z', '2026-09-31T12:00:00Z', '2026-11-31T12:00:00Z',
  '1900-02-29T12:00:00Z', '2100-02-29T12:00:00Z', '2026-00-01T12:00:00Z', '2026-13-01T12:00:00Z',
  '2026-01-00T12:00:00Z', '2026-01-32T12:00:00Z', '0000-01-01T12:00:00Z', '10000-01-01T12:00:00Z',
  '2026-01-01T24:00:00Z', '2026-01-01T12:60:00Z', '2026-01-01T12:00:60Z',
  '2026-01-01T12:00:00+24:00', '2026-01-01T12:00:00+00:60', '2026-01-01T12:00:00+99:99',
  '2026-01-01T12:00:00.1234567890Z', '2026-01-01 12:00:00Z', '2026-01-01T12:00Z',
  '2026-01-01T12:00:00', '2026-01-01', '01/01/2026 12:00', 'Infinity',
  '2026-01-01T12:00:00z', '2026-01-01t12:00:00Z', 'prefix2026-01-01T12:00:00Z',
  '2026-01-01T12:00:00Zsuffix', '2026-01-01T12:00:00+02', '2026-01-01T12:00:00+0200', '2026-01-01T12:00:00.Z',
];
for (const value of invalid) {
  test(`Agenda rejects invalid calendar/RFC3339 instant without normalization: ${value}`, () => {
    const result = getAgendaHistoryPresentation('agenda_created', { event_title: 'Appointment', start_time: value });
    assert.equal(result.content, 'Appointment');
  });
}
for (const [value, expected] of [
  ['2026-02-28T12:00:00Z', '28/02/2026 às 12:00'], ['2024-02-29T12:00:00Z', '29/02/2024 às 12:00'],
  ['2000-02-29T12:00:00Z', '29/02/2000 às 12:00'], ['1900-02-28T12:00:00Z', '28/02/1900 às 12:00'],
  ['2026-04-30T12:00:00Z', '30/04/2026 às 12:00'], ['2026-01-31T12:00:00Z', '31/01/2026 às 12:00'],
  ['2026-03-31T12:00:00Z', '31/03/2026 às 12:00'], ['2026-01-01T12:00:00.1Z', '01/01/2026 às 12:00'],
  ['2026-01-01T12:00:00.123Z', '01/01/2026 às 12:00'], ['2026-01-01T12:00:00.123456Z', '01/01/2026 às 12:00'],
  ['2026-01-01T12:00:00.123456789Z', '01/01/2026 às 12:00'], ['2026-01-01T12:00:00+03:00', '01/01/2026 às 09:00'],
  ['2026-01-01T12:00:00-03:00', '01/01/2026 às 15:00'], ['0001-06-15T12:00:00Z', '15/06/0001 às 12:00'],
  ['9999-06-15T12:00:00Z', '15/06/9999 às 12:00'],
]) {
  test(`Agenda preserves valid leap/boundary/offset/nanosecond instant: ${value}`, () => {
    const metadata = { event_title: 'Appointment', start_time: value, time_zone: 'UTC' }, before = structuredClone(metadata);
    assert.equal(getAgendaHistoryPresentation('agenda_created', metadata).content, `Appointment\n${expected}`);
    assert.deepEqual(metadata, before);
  });
}
test('Agenda presenter rejects unknown and prototype-named types', () => {
  for (const type of ['unknown', 'constructor', '__proto__', 'toString', 'agenda_unrecognized']) {
    assert.equal(getAgendaHistoryPresentation(type, { event_title: 'Private', start_time: '2026-01-01T12:00:00Z' }), null);
  }
});
