import assert from 'node:assert/strict';
import test from 'node:test';
import { dashboardVisitSchema, dashboardVisitsSchema } from '@/lib/validation/dashboard-visits';

test('visit sources preserve distinct historical identities with the same long prefix', () => {
  const prefix = 'Origem importada '.repeat(40);
  const sources = [{ source: prefix + 'A', count: 2 }, { source: prefix + 'B', count: 3 }];
  const report = dashboardVisitsSchema.parse({ reportTimezone: 'America/Sao_Paulo', total: 5,
    upcoming: 0, overdue: 0, visits: [], visitsTruncated: true, upcomingVisits: [], overdueVisits: [],
    creators: [], sources });
  assert.deepEqual(report.sources, sources);
  assert.notEqual(report.sources[0].source, report.sources[1].source);
});

const visit = {
  id: '11111111-1111-4111-8111-111111111111', title: 'Visita QA', event_type: 'visit', status: 'cancelled',
  created_at: null, start_time: '2026-11-16T22:45:00Z', end_time: '2026-11-16T23:45:00Z',
  lead_id: '22222222-2222-4222-8222-222222222222', lead_name: 'Lead QA', source: 'Origem QA',
  created_by_id: null, created_by_name: 'Autor QA', created_by_avatar: null,
  owner_id: '33333333-3333-4333-8333-333333333333', owner_name: 'Responsável QA',
  is_upcoming: false, is_overdue: false,
};
test('visit outcome is additive, nullable and preserves canonical or historical results', () => {
  assert.equal(dashboardVisitSchema.parse(visit).outcome, undefined);
  for (const outcome of [null, 'rescheduled', 'cancelled', 'historical_result']) {
    assert.equal(dashboardVisitSchema.parse({ ...visit, outcome }).outcome, outcome);
  }
});
test('visit outcome rejects malformed values without weakening the existing visit contract', () => {
  for (const outcome of [{ value: 'rescheduled' }, 1, 'x'.repeat(81)]) {
    assert.equal(dashboardVisitSchema.safeParse({ ...visit, outcome }).success, false);
  }
  assert.equal(dashboardVisitSchema.safeParse({ ...visit, id: 'invalid', outcome: 'rescheduled' }).success, false);
});
