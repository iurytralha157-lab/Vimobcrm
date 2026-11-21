import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

function readDashboardFile(fileName: string) {
  return readFileSync(resolve(process.cwd(), "components/features/schedule/dashboard", fileName), "utf8");
}

const dashboardSource = readDashboardFile("AgendaDashboard.tsx");
const kpisSource = readDashboardFile("AgendaDashboardKpis.tsx");
const overviewSource = readDashboardFile("AgendaOverviewTab.tsx");
const dailyChartSource = readDashboardFile("AgendaDailyChart.tsx");
const eventsSource = readDashboardFile("AgendaEventsPanel.tsx");
const dashboardHookSource = readFileSync(resolve(process.cwd(), "hooks/schedule/use-schedule-dashboard.ts"), "utf8");

test("dashboard mantém filtros no topo e limpa o recorte ao trocar de organização", () => {
  assert.doesNotMatch(dashboardSource, /<h1[\s\S]{0,200}Dashboard da agenda/);
  assert.match(dashboardSource, /justify-end[\s\S]{0,200}<AgendaDashboardFilters/);
  assert.match(dashboardSource, /<AgendaDashboardFilters\s+key=\{filterScopeKey\}/);
  assert.match(dashboardSource, /previousDashboardIdentityRef/);
  for (const key of ["teamId", "userId", "source"]) {
    assert.ok(dashboardSource.includes(key + ": undefined"));
  }
});

test("visão geral e compromissos usam o mesmo escopo com dois períodos explícitos", () => {
  for (const label of ["Visão geral", "Compromissos"]) {
    assert.ok(dashboardSource.includes('label: "' + label + '"'));
  }
  assert.doesNotMatch(dashboardSource, /label: "(Equipe|Resultados)"/);
  assert.match(dashboardSource, /TAB_URL_KEY = "ad_tab"/);
  assert.match(dashboardSource, /<AgendaEventsPanel\s+filters=\{effectiveFilters\}\s+period=\{data\.period\}/);
  assert.match(dashboardSource, /enabled=\{!dashboardQuery\.isPlaceholderData\}/);
  assert.match(overviewSource, /getAgendaDashboardPresetRange\("today", new Date\(\), data\.report_timezone\)/);
  assert.match(overviewSource, /variant="today"/);
  assert.match(overviewSource, /filters=\{filters\}/);
  assert.match(overviewSource, /period=\{\{ date_from: today, date_to: today, date_basis: "start_time" \}\}/);
  assert.match(overviewSource, /<AgendaCreatorRanking creators=\{data\.creator_ranking\}/);
  assert.match(overviewSource, /<AgendaDataQualityNotice/);
  assert.match(eventsSource, /Compromissos de hoje/);
  assert.match(eventsSource, /fetchNextPage/);
  assert.match(eventsSource, /formatEventTime\(event\.start_time, reportTimezone\)/);
});

test("dados temporários do dashboard nunca atravessam organização ou acesso", () => {
  assert.doesNotMatch(dashboardHookSource, /placeholderData:\s*keepPreviousData/);
  assert.match(dashboardHookSource, /previousKey\[1\] !== organizationId/);
  assert.match(dashboardHookSource, /previousKey\[2\] !== currentUserId/);
  assert.match(dashboardHookSource, /previousKey\[3\] !== accessSignature/);
});

test("KPIs são acionáveis e informam o que contam em cada base de data", () => {
  for (const label of ["Reuniões", "Visitas", "Em atraso"]) {
    assert.ok(kpisSource.includes('label="' + label + '"'));
  }
  assert.match(kpisSource, /<KpiRow>/);
  assert.match(kpisSource, /dateBasis === "start_time" \? "Compromissos" : getAgendaDashboardTotalLabels\(dateBasis\)\.period/);
  assert.match(kpisSource, /onTypeSelect\("visit"\)/);
  assert.match(kpisSource, /onTypeSelect\("meeting"\)/);
  assert.match(kpisSource, /onStatusSelect\("overdue"\)/);
});

test("gráfico diário usa o volume da API e distingue atrasos de realizações", () => {
  assert.match(overviewSource, /<AgendaDailyChart\s+data=\{data\.daily\}/);
  assert.match(dailyChartSource, /Compromissos por dia/);
  assert.match(dailyChartSource, /remaining: total - completed - overdue/);
  assert.match(dailyChartSource, /dataKey="completed" stackId="daily"/);
  assert.match(dailyChartSource, /dataKey="overdue" stackId="daily"/);
  assert.match(dailyChartSource, /getPeak\(series, "completed"\)/);
  assert.match(dailyChartSource, /getPeak\(series, "overdue"\)/);
  for (const source of [overviewSource, dailyChartSource, kpisSource]) {
    assert.doesNotMatch(source, /\bINK\b|bg-black|bg-neutral-9|#000|#111|#151515/);
  }
});
