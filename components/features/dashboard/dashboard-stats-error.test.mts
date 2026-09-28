import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Node's TypeScript stripping needs the extension; the app typecheck does not
// allow it in static import specifiers.
const {
  getDashboardStatsFailureState,
  getDashboardStatsErrorDescription,
  shouldDisplayCachedDashboardStats,
} = await import(new URL("./dashboard-stats-error.ts", import.meta.url).href);

test("a falha de contrato explica o problema sem expor a resposta técnica", () => {
  const description = getDashboardStatsErrorDescription({
    code: "domain_validation_error",
    direction: "response",
    message: "Invalid response: token=private-value",
  });

  assert.match(description, /incompatíveis com esta versão do CRM/);
  assert.doesNotMatch(description, /private-value|Invalid response/);
});

test("falhas de filtro, sessão e serviço dão caminhos distintos", () => {
  assert.match(getDashboardStatsErrorDescription({ direction: "input" }), /Revise os filtros/);
  assert.match(getDashboardStatsErrorDescription({ status: 401 }), /Entre novamente/);
  assert.match(getDashboardStatsErrorDescription({ code: "api_timeout", status: 0 }), /demorou/);
});

test("dados anteriores só podem continuar visíveis quando o acesso segue válido", () => {
  assert.equal(shouldDisplayCachedDashboardStats({ status: 502 }), true);
  assert.equal(shouldDisplayCachedDashboardStats({ direction: "response" }), true);
  assert.equal(shouldDisplayCachedDashboardStats({ status: 401 }), false);
  assert.equal(shouldDisplayCachedDashboardStats({ status: 403 }), false);
  assert.equal(shouldDisplayCachedDashboardStats({ code: "organization_required" }), false);
  assert.equal(getDashboardStatsFailureState(false, false, null), "none");
  assert.equal(getDashboardStatsFailureState(false, true, { status: 502 }), "unavailable");
  assert.equal(getDashboardStatsFailureState(true, true, { status: 502 }), "stale");
  assert.equal(getDashboardStatsFailureState(true, true, { status: 403 }), "unavailable");
});

test("desktop e mobile usam cards da coorte para taxas de status", () => {
  for (const filename of ["DashboardScreen.tsx", "KPICards.tsx"]) {
    const source = readFileSync(new URL(`./${filename}`, import.meta.url), "utf8");
    assert.match(source, /\(\(data\.openLeads \?\? 0\) \/ data\.totalLeads\)/);
    assert.match(source, /\(\(data\.lostLeads \?\? 0\) \/ data\.totalLeads\)/);
    assert.match(source, /data\.closedLeads \/ data\.totalLeads/);
    assert.doesNotMatch(source, /\/ data\.uniqueLeads/);
    assert.match(source, /entradas iniciais \+ \$\{data\.reentries/);
  }
});
