import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

function readRepoFile(relativePath: string) {
  return readFileSync(resolve(repositoryRoot, relativePath), 'utf8');
}

const dashboardScreenSource = readRepoFile(
  'components/features/dashboard/DashboardScreen.tsx',
);
const dashboardHooksSource = readRepoFile('hooks/use-dashboard-stats.ts');
const dashboardApiSource = readRepoFile('lib/api/dashboard.ts');
const funnelSource = readRepoFile(
  'components/features/dashboard/SalesFunnelWithPipeline.tsx',
);

test('dashboard starts without an implicit period and applies origin only explicitly', () => {
  assert.match(
    dashboardScreenSource,
    /useState<DatePreset \| null>\(null\)/,
  );
  assert.match(dashboardScreenSource, /dateRangeOverride: dashboardDateRange/);
  assert.match(
    dashboardScreenSource,
    /dateMode: dashboardDateRange \? "origin" : undefined/,
  );
  assert.match(dashboardScreenSource, /defaultDatePreset=\{null\}/);
  assert.match(dashboardScreenSource, /"Todo o período"/);
});

test('dashboard waits for persisted non-date filters before any aggregate query', () => {
  assert.match(
    dashboardScreenSource,
    /useEnhancedDashboardStats\(dashboardFilters, \{[\s\S]{0,100}enabled: isFiltersHydrated/,
  );
  assert.match(
    dashboardScreenSource,
    /useDealsEvolutionData\(dashboardFilters, \{ enabled: isFiltersHydrated \}\)/,
  );
  assert.match(
    dashboardScreenSource,
    /useLeadSourcesData\(dashboardFilters, undefined, \{[\s\S]{0,100}enabled: isFiltersHydrated/,
  );
  assert.match(
    dashboardScreenSource,
    /enabled: dashboardQueryScope\.isReady && isFiltersHydrated/,
  );
  assert.match(
    funnelSource,
    /useFunnelData\([\s\S]{0,160}\{ enabled \}/,
  );
  assert.equal(
    dashboardHooksSource.match(
      /enabled: isReady && options\.enabled !== false/g,
    )?.length,
    4,
  );
});

test('dashboard keeps lead details out of the initial request and loads them on demand', () => {
  assert.match(
    dashboardHooksSource,
    /includeDetails \? "details" : "summary"/,
  );
  assert.match(
    dashboardApiSource,
    /includeDetails: params\.includeDetails \? true : undefined/,
  );
  assert.match(
    dashboardScreenSource,
    /isFiltersHydrated && \(lostDialogOpen \|\| wonDialogOpen\)/,
  );
  assert.match(
    dashboardScreenSource,
    /enabled: shouldLoadDealDetails,[\s\S]{0,80}includeDetails: true/,
  );
});
