import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const readRepoFile = (relativePath: string) =>
  readFileSync(resolve(repositoryRoot, relativePath), "utf8");

const sharedFiltersSource = readRepoFile("components/shared/SharedFilters.tsx");
const sharedUserSource = readRepoFile("components/shared/SharedUserFilter.tsx");
const sharedHookSource = readRepoFile("hooks/use-shared-filters.ts");
const dashboardSource = readRepoFile("components/features/dashboard/DashboardScreen.tsx");
const pipelineSource = readRepoFile("components/features/pipelines/PipelinesScreen.tsx");
const pipelineToolbarSource = readRepoFile(
  "components/features/pipelines/pipeline-screen/PipelineToolbar.tsx",
);
const contactsSource = readRepoFile("components/features/contacts/ContactsScreen.tsx");
const filterContextSource = readRepoFile("contexts/FilterContext.tsx");

test("active in-memory user selection loads its options and remains removable when absent", () => {
  assert.match(sharedFiltersSource, /isHydrated: isFiltersHydrated/);
  assert.match(sharedFiltersSource, /hasActiveScopeSelection/);
  assert.match(sharedFiltersSource, /loadDynamicOptions \|\| hasActiveScopeSelection/);
  assert.doesNotMatch(sharedFiltersSource, /if \(!availableUsers\.some/);
  assert.match(sharedFiltersSource, /addChip\("user"[\s\S]{0,300}onUserChange\(null\)/);
  assert.match(sharedUserSource, /Corretor indisponível/);
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

test("shared filters and board selection never read or write browser storage", () => {
  for (const source of [filterContextSource, pipelineSource, readRepoFile("hooks/use-filter-options-pipeline-id.ts")]) {
    assert.doesNotMatch(source, /sessionStorage|localStorage|vimob_period_filter_|vimob:pipelines:selected/);
  }
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

test("in-memory snapshots are validated before application", () => {
  assert.match(filterContextSource, /sharedFilterSnapshotSchema.safeParse\(snapshot\)/);
  assert.match(filterContextSource, /if \(!result.success\) return false/);
});
