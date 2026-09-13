import assert from "node:assert/strict";
import test from "node:test";

import type { ScheduleDashboardPerformerRanking } from "../../../../lib/validation/schedule-dashboard";
import {
  getAgendaDashboardTotalLabels,
  getAgendaPerformanceHighlights,
} from "./agenda-dashboard-model";

const performer = (
  overrides: Partial<ScheduleDashboardPerformerRanking>,
): ScheduleDashboardPerformerRanking => ({
  user_id: "00000000-0000-4000-8000-000000000001",
  name: "Ana",
  avatar_url: null,
  total: 10,
  eligible: 10,
  appointments: 4,
  appointment_eligible: 4,
  open: 0,
  completed: 8,
  no_show: 1,
  overdue: 0,
  completion_rate: 80,
  no_show_rate: 25,
  ...overrides,
});

test("rótulos do total acompanham a base temporal do relatório", () => {
  assert.deepEqual(getAgendaDashboardTotalLabels("start_time"), {
    chart: "Agendados",
    period: "Agendamentos no período",
  });
  assert.deepEqual(getAgendaDashboardTotalLabels("created_at"), {
    chart: "Criados",
    period: "Criados no período",
  });
  assert.deepEqual(getAgendaDashboardTotalLabels("completed_at"), {
    chart: "Com desfecho",
    period: "Desfechos no período",
  });
});

test("destaques preservam denominadores e ignoram quem só tem agenda futura", () => {
  const highlights = getAgendaPerformanceHighlights([
    performer({
      user_id: "00000000-0000-4000-8000-000000000002",
      name: "Somente agenda futura",
      total: 5,
      eligible: 0,
      appointments: 0,
      appointment_eligible: 0,
      open: 5,
      completed: 0,
      no_show: 0,
      completion_rate: 0,
    }),
    performer({
      user_id: "00000000-0000-4000-8000-000000000003",
      name: "Bruno",
      total: 4,
      eligible: 4,
      completed: 4,
      completion_rate: 100,
    }),
    performer({
      user_id: "00000000-0000-4000-8000-000000000004",
      name: "Carla",
      total: 20,
      eligible: 20,
      completed: 10,
      completion_rate: 50,
    }),
  ]);

  assert.equal(highlights.best?.name, "Bruno");
  assert.equal(highlights.best?.total, 4);
  assert.equal(highlights.attention?.name, "Carla");
  assert.equal(highlights.attention?.total, 20);
  assert.equal(highlights.comparableCount, 2);
  assert.equal(highlights.sameRate, false);
});

test("um único responsável com volume não gera pior artificial", () => {
  const highlights = getAgendaPerformanceHighlights([
    performer({}),
    performer({
      user_id: "00000000-0000-4000-8000-000000000002",
      name: "Sem volume",
      total: 0,
      eligible: 0,
      appointments: 0,
      appointment_eligible: 0,
      completed: 0,
      completion_rate: 0,
    }),
  ]);

  assert.equal(highlights.best?.name, "Ana");
  assert.equal(highlights.attention, null);
  assert.equal(highlights.comparableCount, 1);
});
