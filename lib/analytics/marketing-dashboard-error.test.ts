import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { getMarketingDashboardErrorState } from "./marketing-dashboard-error";

test("transforma schema ausente em estado acionável sem estimar métricas", () => {
  const state = getMarketingDashboardErrorState({
    code: "marketing_schema_unavailable",
    status: 503,
    requestId: "request-schema",
  });

  assert.equal(state.kind, "schema");
  assert.match(state.title, /Estrutura de Marketing/);
  assert.match(
    state.description,
    /administrador precisa concluir a atualização/,
  );
  assert.match(state.description, /request-schema/);
  assert.equal(state.shouldClearFilters, false);
});

test("distingue capacidade temporária de filtros inválidos", () => {
  const capacity = getMarketingDashboardErrorState({
    code: "marketing_capacity_unavailable",
    status: 503,
  });
  const filters = getMarketingDashboardErrorState({
    code: "invalid_analytics_filters",
    status: 400,
  });

  assert.equal(capacity.kind, "capacity");
  assert.match(capacity.description, /limite temporário de conexões/);
  assert.equal(filters.kind, "filters");
  assert.equal(filters.shouldClearFilters, true);
});

test("falha de contrato e indisponibilidade não reaproveitam números como resposta nova", () => {
  const contract = getMarketingDashboardErrorState({
    code: "domain_validation_error",
    direction: "response",
  });
  const service = getMarketingDashboardErrorState({
    code: "api_timeout",
    status: 0,
  });

  assert.equal(contract.kind, "contract");
  assert.match(contract.description, /Nenhuma métrica foi estimada/);
  assert.equal(service.kind, "service");
  assert.match(service.description, /nenhuma métrica foi estimada/i);
});

test("rotula como última sincronização somente um snapshot real de Marketing", () => {
  const hook = readFileSync(
    "hooks/marketing/use-marketing-dashboard.ts",
    "utf8",
  );

  assert.match(hook, /lastSyncAt:\s*insightsQuery\.data\?\.lastSync \?\? null/);
  assert.doesNotMatch(
    hook,
    /lastSyncAt:[\s\S]{0,160}integrationState\.lastIntegrationSyncAt/,
  );
  assert.match(
    hook,
    /analyticsConnection\?\.marketingTokenAvailable === true/,
  );
  assert.doesNotMatch(
    hook,
    /hasMarketingToken:[\s\S]{0,180}analyticsConnection\?\.isConnected === true/,
  );
});
