import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const readRepoFile = (relativePath: string) =>
  readFileSync(resolve(repositoryRoot, relativePath), "utf8");

const sharedFiltersSource = readRepoFile("components/shared/SharedFilters.tsx");
const sharedHookSource = readRepoFile("hooks/use-shared-filters.ts");
const dashboardSource = readRepoFile("components/features/dashboard/DashboardScreen.tsx");
const pipelineSource = readRepoFile("components/features/pipelines/PipelinesScreen.tsx");
const pipelineToolbarSource = readRepoFile(
  "components/features/pipelines/pipeline-screen/PipelineToolbar.tsx",
);
const contactsSource = readRepoFile("components/features/contacts/ContactsScreen.tsx");
const filterContextSource = readRepoFile("contexts/FilterContext.tsx");

test("persisted user selection waits for authoritative options before validation", () => {
  assert.match(sharedFiltersSource, /isHydrated: isFiltersHydrated/);
  assert.match(sharedFiltersSource, /hasPersistedScopeSelection/);
  assert.match(sharedFiltersSource, /!shouldLoadScopeOptions/);
  assert.match(sharedFiltersSource, /!teamsQuery\.isSuccess/);
  assert.match(sharedFiltersSource, /!usersQuery\.isSuccess/);
  assert.match(sharedHookSource, /hasHydratedDynamicSelection/);
  assert.match(
    sharedHookSource,
    /\(userId && userId !== 'all' && userId !== 'unassigned'\)/,
  );
});

test("dashboard pipeline and contacts consume one shared lead period", () => {
  assert.match(dashboardSource, /const dashboardDateRange = filters\.dateRange/);
  assert.match(pipelineSource, /const pipelineDateRange = sharedFilters\.dateRange/);
  assert.match(contactsSource, /const contactsDateRange = sharedFilters\.dateRange/);
  assert.doesNotMatch(dashboardSource, /dashboardDatePreset/);
  assert.doesNotMatch(pipelineSource, /pipelineDatePreset/);
  assert.doesNotMatch(contactsSource, /contactsDatePreset/);
});

test("the shared lead period defaults to all data and clears back to no range", () => {
  assert.match(filterContextSource, /version: 2,/);
  assert.match(filterContextSource, /datePreset: null,/);
  assert.match(filterContextSource, /activeDateRange: \{ from: Date; to: Date \} \| null/);
  assert.match(filterContextSource, /if \(!datePreset\) return null/);
  assert.match(filterContextSource, /const clearDateFilter = useCallback\(\(\) => \{[\s\S]{0,80}setDatePreset\(null\)/);
  assert.match(sharedHookSource, /dateRange: \{ from: Date; to: Date \} \| null/);
  assert.match(sharedHookSource, /Boolean\(effectiveDateRange\)/);
  assert.match(dashboardSource, /defaultDatePreset=\{null\}/);
  assert.match(pipelineToolbarSource, /defaultDatePreset=\{null\}/);
  assert.match(contactsSource, /defaultDatePreset: null/);
  assert.doesNotMatch(dashboardSource, /setDatePreset\(["']last30days["']\)/);
  assert.doesNotMatch(pipelineSource, /setDatePreset\(["']last30days["']\)/);
  assert.doesNotMatch(contactsSource, /setDatePreset\(["']last30days["']\)/);
});

test("legacy sessions migrate only the implicit period while preserving other filters", () => {
  assert.match(
    filterContextSource,
    /parsed\.version === DEFAULT_FILTER_STATE\.version[\s\S]{0,100}normalizeDatePreset\(parsed\.datePreset\)[\s\S]{0,30}: null/,
  );
  assert.match(filterContextSource, /teamId: normalizeNullable\(parsed\.teamId\)/);
  assert.match(filterContextSource, /userId: normalizeNullable\(parsed\.userId\)/);
});

test("dashboard exposes shared search and supports the unassigned sentinel", () => {
  assert.doesNotMatch(dashboardSource, /hideSearch/);
  assert.match(dashboardSource, /includeUnassignedUserOption/);
});

test("the three linked lead views preserve and expose the unassigned sentinel", () => {
  assert.match(dashboardSource, /includeUnassignedUserOption/);
  assert.match(pipelineToolbarSource, /includeUnassignedUserOption/);
  assert.match(contactsSource, /includeUnassignedUserOption: true/);
});

test("corrupted persisted date presets fall back to all data", () => {
  assert.match(filterContextSource, /function normalizeDatePreset/);
  assert.match(filterContextSource, /DATE_PRESET_VALUES\.has/);
  assert.match(
    filterContextSource,
    /parsedDatePreset === 'custom' && !hasValidCustomRange/,
  );
});
