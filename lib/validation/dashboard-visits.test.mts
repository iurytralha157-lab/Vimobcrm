import assert from 'node:assert/strict';
import test from 'node:test';
import { dashboardVisitsSchema } from '@/lib/validation/dashboard-visits';

test('visit sources preserve distinct historical identities with the same long prefix', () => {
  const prefix = 'Origem importada '.repeat(40);
  const sources = [{ source: prefix + 'A', count: 2 }, { source: prefix + 'B', count: 3 }];
  const report = dashboardVisitsSchema.parse({ reportTimezone: 'America/Sao_Paulo', total: 5,
    upcoming: 0, overdue: 0, visits: [], visitsTruncated: true, upcomingVisits: [], overdueVisits: [],
    creators: [], sources });
  assert.deepEqual(report.sources, sources);
  assert.notEqual(report.sources[0].source, report.sources[1].source);
});
