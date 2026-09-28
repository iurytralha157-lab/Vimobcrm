import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

test('source chart opts into entries only when the stats API advertises them', () => {
  const screen = read('components/features/dashboard/DashboardScreen.tsx');
  const api = read('lib/api/dashboard.ts');
  const hooks = read('hooks/use-dashboard-stats.ts');
  const chart = read('components/features/dashboard/LeadSourcesChart.tsx');

  assert.match(screen, /countEntries: stats\?\.entryBreakdownAvailable === true/);
  assert.equal(screen.match(/countEntries=\{stats\?\.entryBreakdownAvailable === true\}/g)?.length, 2);
  assert.match(api, /countEntries: params\.countEntries \? true : undefined/);
  assert.match(hooks, /options\.countEntries === true \? "entries" : "cards"/);
  assert.match(chart, /const title = 'Origem dos leads'/);
  assert.match(chart, /const unit = 'Leads'/);
  assert.match(chart, /value === 1 \? 'lead' : 'leads'/);
  assert.doesNotMatch(chart, /'Origem das entradas'|'Origem dos cards'/);
  assert.match(chart, /const canFilter = Boolean\(rawSource && onSourceChange\)/);
});
