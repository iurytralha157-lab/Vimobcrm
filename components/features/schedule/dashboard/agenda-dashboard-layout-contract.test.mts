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
  assert.match(
    dashboardSource,
    /<AgendaResponsibleResultsPanel\s+key=\{effectiveFiltersKey\}/,
  );
  assert.match(dashboardSource, /previousDashboardIdentityRef/);
  assert.match(dashboardSource, /teamId: undefined/);
  assert.match(dashboardSource, /userId: undefined/);
  assert.match(dashboardSource, /source: undefined/);
});

test("dashboard renderiza apenas os painéis definidos para a leitura executiva", () => {
  assert.match(dashboardSource, /<AgendaAdaptiveChart/);
  assert.match(dashboardSource, /hourly=\{data\.hourly\}/);
  assert.match(dashboardSource, /daily=\{data\.daily\}/);
  assert.doesNotMatch(dashboardSource, /weekly=\{data\.weekly\}/);
  assert.match(dashboardSource, /<AgendaEventsPanel/);
  assert.match(dashboardSource, /filters=\{effectiveFilters\}/);
  assert.match(dashboardSource, /period=\{data\.period\}/);
  assert.match(
    dashboardSource,
    /enabled=\{!dashboardQuery\.isPlaceholderData\}/,
  );
  assert.match(dashboardSource, /<AgendaTypeDistributionPanel/);
  assert.match(dashboardSource, /<AgendaSourceDistributionPanel/);
  assert.match(dashboardSource, /<AgendaResponsibleResultsPanel/);
  assert.doesNotMatch(dashboardSource, /<AgendaOutcomeDistributionPanel/);
  assert.doesNotMatch(dashboardSource, /<AgendaTeamPerformancePanel/);
  assert.doesNotMatch(dashboardSource, /Datas agrupadas no fuso/);
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

test("KPIs ficam em duas linhas de seis sem textos explicativos superiores", () => {
  for (const label of [
    "Realizados",
    "Em aberto",
    "Em atraso",
    "No-show",
    "Próximos agendamentos",
    "Visitas",
    "Reuniões",
    "Ligações",
    "E-mail",
    "Mensagem",
    "Tarefa",
  ]) {
    assert.match(kpisSource, new RegExp(`label: ['\"]${label}['\"]`));
  }

  assert.match(kpisSource, /getAgendaDashboardTotalLabels\(dateBasis\)/);
  assert.match(kpisSource, /label: totalLabels\.period/);
  assert.match(kpisSource, /byType\?: ScheduleDashboardBreakdown\[]/);
  assert.equal(kpisSource.match(/xl:grid-cols-6/g)?.length, 2);
  assert.doesNotMatch(kpisSource, /Todos os compromissos do recorte/);
  assert.doesNotMatch(kpisSource, /Aguardando um desfecho/);
  assert.doesNotMatch(kpisSource, /Agenda futura em aberto/);
  assert.doesNotMatch(kpisSource, /label: ['\"]Cancelados['\"]/);
});

test("evolução adapta horas, dias e meses sem seletor manual", () => {
  assert.match(adaptiveChartSource, /buildAgendaAdaptiveChartModel/);
  assert.match(adaptiveChartSource, /Evolução dos agendamentos/);
  assert.match(adaptiveChartSource, /Por hora/);
  assert.match(adaptiveChartSource, /Por dia/);
  assert.match(adaptiveChartSource, /Por mês/);
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

test("painéis preservam origem, tipo e lista do período, sem recolocar Resultados", () => {
  assert.match(panelsSource, /title=["']Origem do lead["']/);
  assert.match(panelsSource, /title=["']Distribuição por tipo["']/);
  assert.match(panelsSource, /__unknown__: ["']Outro["']/);
  assert.match(panelsSource, /otherCount/);
  assert.match(panelsSource, /h-\[190px\]/);
  assert.match(panelsSource, /max-h-\[178px\][^"\n]*overflow-y-auto/);
  assert.doesNotMatch(dashboardSource, /AgendaOutcomeDistributionPanel/);
  assert.match(eventsSource, />\s*Agendamentos\s*</);
  assert.doesNotMatch(eventsSource, /Próximos agendamentos/);
  assert.match(eventsSource, /overflow-y-auto/);
  assert.match(eventsSource, /fetchNextPage/);
});

test("resultado por responsável ocupa painel próprio sem auditoria ou autoria", () => {
  for (const label of [
    "Agendamentos",
    "Realizados",
    "Em aberto",
    "Em atraso",
    "No-show",
    "Realização",
    "Taxa de no-show",
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
