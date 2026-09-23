import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const readRepoFile = (relativePath: string) =>
  readFileSync(resolve(repositoryRoot, relativePath), "utf8");

const dashboardSource = readRepoFile("components/features/dashboard/DashboardScreen.tsx");
const distributionSource = readRepoFile(
  "components/features/dashboard/LeadDistributionSection.tsx",
);
const firstContactSource = readRepoFile(
  "components/features/dashboard/FirstContactDialog.tsx",
);
const mobileKpisSource = readRepoFile(
  "components/features/dashboard/KPICards.tsx",
);
const hookSource = readRepoFile("hooks/use-dashboard-stats.ts");
const apiSource = readRepoFile("lib/api/dashboard.ts");
const leadRealtimeSource = readRepoFile("contexts/LeadRealtimeBus.tsx");
const backendRealtimeSource = readRepoFile("contexts/BackendRealtimeBus.tsx");
const teamsHookSource = readRepoFile("hooks/use-teams.ts");

test("lead distribution is management-only and uses the complete dashboard filter key", () => {
  assert.match(hookSource, /normalizedMemberRole === "owner"/);
  assert.match(hookSource, /normalizedMemberRole === "admin"/);
  assert.match(hookSource, /currentTenantContext\?\.isTeamLeader === true/);
  assert.match(
    hookSource,
    /enabled:\s*isReady && canViewLeadDistribution && options\.enabled !== false/,
  );
  assert.match(
    hookSource,
    /"dashboard-lead-distribution"[\s\S]{0,180}accessSignature[\s\S]{0,80}filterKey/,
  );
  assert.match(apiSource, /'\/v1\/dashboard\/lead-distribution'/);
  assert.match(apiSource, /query: buildDashboardQuery\(filters\)/);
});

test("dashboard renders tall broker bars and a compact team chart on desktop and mobile", () => {
  assert.match(dashboardSource, /dashboardQueryScope\.canViewLeadDistribution/);
  assert.match(dashboardSource, /<LeadDistributionSection/);
  assert.match(dashboardSource, /overflow-y-auto/);
  assert.match(distributionSource, /Leads por corretor/);
  assert.match(distributionSource, /Leads por equipe/);
  assert.match(distributionSource, /grid-cols-1 gap-3 lg:grid-cols-12/);
  assert.match(distributionSource, /lg:col-span-8/);
  assert.match(distributionSource, /lg:col-span-4/);
  assert.match(distributionSource, /overflow-x-auto/);
  assert.match(distributionSource, /<Avatar/);
  assert.match(distributionSource, /<Tooltip/);
  assert.match(distributionSource, /aria-label=\{variant === "user" \? "Leads por corretor" : "Leads por equipe"\}/);
  assert.doesNotMatch(distributionSource, /<h2/);
  assert.doesNotMatch(distributionSource, /Responsáveis atuais e equipe registrada na atribuição/);
  assert.doesNotMatch(distributionSource, /Quantidade por responsável atual/);
  assert.doesNotMatch(distributionSource, /entradas diretas ficam em Sem equipe/);
  assert.doesNotMatch(distributionSource, /scopeLabel/);
  assert.match(distributionSource, /row\.kind === "entity"/);
  assert.doesNotMatch(dashboardSource, /scopeLabel=/);
});

test("visible team preference is separate from shared dashboard filters and survives reloads", () => {
  assert.match(distributionSource, /TEAM_SELECTION_STORAGE_PREFIX/);
  assert.match(distributionSource, /organizationId && currentUserId/);
  assert.match(distributionSource, /localStorage\.getItem\(storageKey\)/);
  assert.match(distributionSource, /localStorage\.setItem\(storageKey/);
  assert.match(distributionSource, /availableTeams\.map\(\(team\) => team\.id\)/);
  assert.match(distributionSource, /activeSelection\.includes\(team\.id\)/);
  assert.match(distributionSource, /counts\.get\(team\.id\) \?\? \(hasOther \? null : 0\)/);
  assert.match(distributionSource, /Escolher equipes exibidas/);
  assert.match(distributionSource, /<TeamPicker/);
  assert.match(distributionSource, /teamsError \? \(/);
  assert.match(distributionSource, /onRetryTeams/);
  assert.match(distributionSource, /Não foi possível carregar as equipes para editar a seleção/);
  assert.doesNotMatch(distributionSource, /onTeamChange|setTeamId/);
  assert.match(dashboardSource, /availableTeams=\{availableTeams\?\.filter/);
  assert.match(dashboardSource, /teamsError=\{teamsQuery\.isError\}/);
  assert.match(dashboardSource, /onRetryTeams=\{\(\) => void teamsQuery\.refetch\(\)\}/);
});

test("first contact KPI opens a filtered, management-only aggregate on both layouts", () => {
  assert.match(dashboardSource, /useDashboardFirstContact\(dashboardFilters/);
  assert.match(dashboardSource, /enabled: isFiltersHydrated && firstContactDialogOpen/);
  assert.match(dashboardSource, /<FirstContactDialog/);
  assert.match(dashboardSource, /onFirstContactClick=\{dashboardQueryScope\.canViewLeadDistribution/);
  assert.match(mobileKpisSource, /onFirstContactClick/);
  assert.match(hookSource, /"dashboard-first-contact"/);
  assert.match(apiSource, /'\/v1\/dashboard\/first-contact'/);
  assert.match(firstContactSource, /Por corretor/);
  assert.match(firstContactSource, /Por origem/);
  assert.doesNotMatch(firstContactSource, /deal\.name|lead\.name/);
});

test("lead distribution cache is invalidated by lead realtime events", () => {
  assert.match(leadRealtimeSource, /"dashboard-lead-distribution"/);
  assert.match(backendRealtimeSource, /"dashboard-lead-distribution"/);
  assert.match(leadRealtimeSource, /"dashboard-first-contact"/);
  assert.match(backendRealtimeSource, /"dashboard-first-contact"/);
  assert.match(teamsHookSource, /invalidateTeamScopeDependentQueries/);
  for (const queryKey of [
    "contacts-list",
    "enhanced-dashboard-stats",
    "funnel-data",
    "lead-sources-data",
    "deals-evolution",
    "dashboard-extra-counts",
    "dashboard-lead-distribution",
    "dashboard-first-contact",
  ]) {
    assert.match(teamsHookSource, new RegExp(`"${queryKey}"`));
  }
});
