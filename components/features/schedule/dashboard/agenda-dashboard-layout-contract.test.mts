import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

function readDashboardFile(fileName: string) {
  return readFileSync(
    resolve(process.cwd(), "components/features/schedule/dashboard", fileName),
    "utf8",
  );
}

const dashboardSource = readDashboardFile("AgendaDashboard.tsx");
const kpisSource = readDashboardFile("AgendaDashboardKpis.tsx");
const overviewSource = readDashboardFile("AgendaOverviewTab.tsx");
const appointmentsSource = readDashboardFile("AgendaAppointmentsTab.tsx");
const teamSource = readDashboardFile("AgendaTeamTab.tsx");
const resultsSource = readDashboardFile("AgendaResultsTab.tsx");
const nextEventSource = readDashboardFile("AgendaNextEventCard.tsx");
const adaptiveChartSource = readDashboardFile("AgendaAdaptiveChart.tsx");
const adaptiveModelSource = readDashboardFile("agenda-adaptive-chart-model.ts");
const overdueSource = readDashboardFile("AgendaOverduePanel.tsx");
const panelsSource = readDashboardFile("AgendaDashboardPanels.tsx");
const eventsSource = readDashboardFile("AgendaEventsPanel.tsx");
const responsibleSource = readDashboardFile(
  "AgendaResponsibleResultsPanel.tsx",
);
const dashboardHookSource = readFileSync(
  resolve(process.cwd(), "hooks/schedule/use-schedule-dashboard.ts"),
  "utf8",
);

test("dashboard mantém filtros no topo sem repetir título ou subtítulo", () => {
  assert.doesNotMatch(dashboardSource, /<h1[\s\S]{0,200}Dashboard da agenda/);
  assert.doesNotMatch(
    dashboardSource,
    /Acompanhe realização, atrasos, equipe e agenda futura/,
  );
  assert.match(
    dashboardSource,
    /justify-end[\s\S]{0,200}<AgendaDashboardFilters/,
  );
  assert.doesNotMatch(
    dashboardSource,
    /<AgendaDashboardFilters\s+key=\{effectiveFiltersKey\}/,
  );
  assert.match(
    dashboardSource,
    /<AgendaDashboardFilters\s+key=\{filterScopeKey\}/,
  );
  assert.match(dashboardSource, /resultsKey=\{effectiveFiltersKey\}/);
  assert.match(teamSource, /<AgendaResponsibleResultsPanel\s+key=\{resultsKey\}/);
  assert.match(dashboardSource, /previousDashboardIdentityRef/);
  assert.match(dashboardSource, /teamId: undefined/);
  assert.match(dashboardSource, /userId: undefined/);
  assert.match(dashboardSource, /source: undefined/);
});

test("dashboard distribui os painéis em quatro abas sem perder o recorte da lista", () => {
  for (const label of ["Visão geral", "Compromissos", "Equipe", "Resultados"]) {
    assert.match(dashboardSource, new RegExp(`label: "${label}"`));
  }
  assert.match(dashboardSource, /TAB_URL_KEY = "ad_tab"/);
  assert.match(overviewSource, /<AgendaAdaptiveChart/);
  assert.match(overviewSource, /hourly=\{data\.hourly\}/);
  assert.match(overviewSource, /daily=\{data\.daily\}/);
  assert.doesNotMatch(overviewSource, /weekly=\{data\.weekly\}/);
  assert.match(overviewSource, /<AgendaTypeDistributionPanel/);
  assert.match(overviewSource, /<AgendaSourceDistributionPanel/);
  assert.match(overviewSource, /<AgendaNextEventCard/);
  assert.match(appointmentsSource, /<AgendaEventsPanel/);
  assert.match(appointmentsSource, /filters=\{filters\}/);
  assert.match(appointmentsSource, /period=\{data\.period\}/);
  assert.match(
    dashboardSource,
    /eventsEnabled=\{!dashboardQuery\.isPlaceholderData\}/,
  );
  assert.match(appointmentsSource, /enabled=\{eventsEnabled\}/);
  assert.match(teamSource, /<AgendaResponsibleResultsPanel/);
  assert.match(teamSource, /<AgendaOverduePanel/);
  assert.match(resultsSource, /<AgendaOutcomeDistributionPanel/);
  assert.match(resultsSource, /<AgendaDataQualityNotice/);
  assert.doesNotMatch(dashboardSource, /Datas agrupadas no fuso/);
});

test("nenhum cartão ou gráfico da agenda usa preenchimento preto", () => {
  for (const source of [nextEventSource, overviewSource, adaptiveChartSource, panelsSource, teamSource, resultsSource, kpisSource]) {
    assert.doesNotMatch(source, /\bINK\b|bg-black|bg-neutral-9|#000|#111|#151515/);
  }
});

test("próximos compromissos não dependem do período selecionado nem ignoram os filtros de escopo", () => {
  assert.match(dashboardSource, /status: "upcoming"/);
  assert.match(dashboardSource, /dateFrom: upcomingWindow\.today/);
  for (const key of ["teamId", "userId", "source", "eventType"]) {
    assert.match(dashboardSource, new RegExp(`${key}: effectiveFilters\\.${key}`));
  }
});

test("dados temporários do dashboard nunca atravessam organização ou acesso", () => {
  assert.doesNotMatch(
    dashboardHookSource,
    /placeholderData:\s*keepPreviousData/,
  );
  assert.match(dashboardHookSource, /previousKey\[1\] !== organizationId/);
  assert.match(dashboardHookSource, /previousKey\[2\] !== currentUserId/);
  assert.match(dashboardHookSource, /previousKey\[3\] !== accessSignature/);
});

test("KPIs ficam em quatro por linha e dizem o que contam em cada base de data", () => {
  for (const label of ["Taxa de realização", "Não compareceu", "Atrasados"]) {
    assert.match(kpisSource, new RegExp(`label="${label}"`));
  }
  assert.match(kpisSource, /<KpiRow>/);
  assert.match(kpisSource, /getAgendaDashboardTotalLabels\(dateBasis\)/);
  assert.match(kpisSource, /dateBasis === "start_time" \? "Compromissos" : totalLabels\.period/);
  assert.match(dashboardSource, /@container\/agenda-dashboard/);
  // Filtering by status from a KPI remains available.
  assert.match(kpisSource, /onStatusSelect\("overdue"\)/);
  assert.match(kpisSource, /onStatusSelect\("no_show"\)/);
});

test("evolução adapta horas, dias e meses sem seletor manual", () => {
  assert.match(adaptiveChartSource, /buildAgendaAdaptiveChartModel/);
  assert.match(adaptiveChartSource, /Compromissos por hora/);
  assert.match(adaptiveChartSource, /Compromissos por dia/);
  assert.match(adaptiveChartSource, /Compromissos por mês/);
  assert.doesNotMatch(adaptiveChartSource, /aria-pressed/);
  assert.match(adaptiveModelSource, /dayCount <= 1/);
  assert.match(adaptiveModelSource, /dayCount <= 92/);
  assert.match(adaptiveModelSource, /Array\.from\(\{ length: 24 \}/);
  assert.match(adaptiveModelSource, /buildMonthlySeries/);
});

test("lista de atrasos mantém todos os responsáveis em rolagem interna", () => {
  assert.match(overdueSource, /overflow-y-auto/);
  assert.doesNotMatch(overdueSource, /slice\(0,\s*8\)/);
});

test("painéis preservam origem, tipo e lista do período", () => {
  assert.match(panelsSource, /title=["']De onde veio o lead["']/);
  assert.match(panelsSource, /title=["']Por tipo["']/);
  assert.match(panelsSource, /title=["']Realizados por origem do lead["']/);
  assert.match(panelsSource, /__unknown__: ["']Outro["']/);
  // Every source stays reachable.
  assert.match(panelsSource, /SCROLL_LIST = "max-h-\[220px\][^"\n]*overflow-y-auto/);
  assert.doesNotMatch(panelsSource, /visible\.slice\(0, \d+\)\.map/);
  assert.match(eventsSource, />\s*Lista de compromissos\s*</);
  assert.doesNotMatch(eventsSource, /Próximos agendamentos/);
  assert.match(eventsSource, /overflow-y-auto/);
  assert.match(eventsSource, /fetchNextPage/);
});

test("resultado por responsável ocupa painel próprio sem auditoria ou autoria", () => {
  for (const label of [
    "Compromissos",
    "Realizados",
    "Em aberto",
    "Atrasados",
    "Não compareceu",
    "Taxa de realização",
  ]) {
    assert.match(responsibleSource, new RegExp(label));
  }

  assert.doesNotMatch(responsibleSource, /Desempenho da equipe/);
  assert.doesNotMatch(responsibleSource, /Volume observado por autor/);
  assert.doesNotMatch(responsibleSource, /Cobertura parcial de autoria/);
  assert.doesNotMatch(responsibleSource, /Elegíveis para realização/);
});

test("resultado por responsável pagina internamente sem limitar o ranking", () => {
  assert.match(dashboardSource, /data\.performer_ranking\.length > 0/);
  assert.match(responsibleSource, /AGENDA_RESPONSIBLE_RESULTS_PAGE_SIZE/);
  assert.match(responsibleSource, /paginateAgendaResponsibleResults/);
  assert.match(responsibleSource, /pagination\.items\.map/);
  assert.match(responsibleSource, /pagination\.startIndex \+ index/);
  assert.match(
    responsibleSource,
    /aria-label="Paginação do resultado por responsável"/,
  );
  assert.match(responsibleSource, /setRequestedPage/);
  assert.doesNotMatch(responsibleSource, /orderedPerformers\.slice\(0,/);
});
