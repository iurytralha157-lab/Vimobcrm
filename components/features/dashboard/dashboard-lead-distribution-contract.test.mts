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

test("dashboard renders responsive broker and team cards below the primary charts", () => {
  assert.match(dashboardSource, /dashboardQueryScope\.canViewLeadDistribution/);
  assert.match(dashboardSource, /<LeadDistributionSection/);
  assert.match(dashboardSource, /overflow-y-auto/);
  assert.match(distributionSource, /Leads por corretor/);
  assert.match(distributionSource, /Leads por equipe/);
  assert.match(distributionSource, /grid-cols-1 gap-3 lg:grid-cols-2/);
  assert.doesNotMatch(distributionSource, /<h2/);
  assert.doesNotMatch(distributionSource, /Responsáveis atuais e equipe registrada na atribuição/);
  assert.doesNotMatch(distributionSource, /Quantidade por responsável atual/);
  assert.doesNotMatch(distributionSource, /entradas diretas ficam em Sem equipe/);
  assert.doesNotMatch(distributionSource, /scopeLabel/);
  assert.match(distributionSource, /role="progressbar"/);
  assert.match(distributionSource, /filter\(\(row\) => row\.kind === "entity"\)/);
  assert.match(distributionSource, /teamEntityRanks\.get\(row\.id\)/);
  assert.doesNotMatch(dashboardSource, /scopeLabel=/);
});

test("lead distribution cache is invalidated by lead realtime events", () => {
  assert.match(leadRealtimeSource, /"dashboard-lead-distribution"/);
  assert.match(backendRealtimeSource, /"dashboard-lead-distribution"/);
  assert.match(teamsHookSource, /invalidateTeamScopeDependentQueries/);
  for (const queryKey of [
    "contacts-list",
    "enhanced-dashboard-stats",
    "funnel-data",
    "lead-sources-data",
    "deals-evolution",
    "dashboard-extra-counts",
    "dashboard-lead-distribution",
  ]) {
    assert.match(teamsHookSource, new RegExp(`"${queryKey}"`));
  }
});
