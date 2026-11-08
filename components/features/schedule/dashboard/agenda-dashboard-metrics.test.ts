import assert from "node:assert/strict";
import test from "node:test";

import {
  buildHourRows,
  buildTeamSummary,
  buildWeekdayDistribution,
  buildWeeklyCompletion,
  countDelta,
  getPreviousPeriod,
  percentDelta,
  pointsDelta,
} from "./agenda-dashboard-metrics";

const day = (date: string, total: number, completed = 0, eligible?: number) => ({
  date,
  total,
  completed,
  eligible,
  open: 0,
  overdue: 0,
  cancelled: 0,
  no_show: 0,
});

test("dia da semana sai da data civil do relatório, sem depender do fuso do navegador", () => {
  const rows = buildWeekdayDistribution([
    day("2026-11-02", 3), // segunda
    day("2026-11-08", 2), // domingo
    day("2026-11-09", 4), // segunda
  ]);
  assert.deepEqual(rows.map((row) => row.label), ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"]);
  assert.equal(rows[0].total, 7);
  assert.equal(rows[6].total, 2);
  assert.equal(rows[1].total, 0);
});

test("taxa semanal usa a base elegível e não inventa semanas sem base", () => {
  const rows = buildWeeklyCompletion([
    day("2026-10-31", 1, 1, 1), // sábado da semana de 26/10
    day("2026-11-02", 2, 1, 2),
    day("2026-11-03", 2, 0, 2),
    day("2026-11-09", 3, 0, 0),
  ]);
  assert.deepEqual(rows.map((row) => row.label), ["31/10", "02 a 03/11"]);
  assert.equal(rows[1].rate, 25);
  assert.deepEqual(buildWeeklyCompletion([day("2026-11-02", 2, 1)]), []);
});

test("faixa horária mantém horas vazias entre as ocupadas e distingue réplica antiga", () => {
  assert.equal(buildHourRows({}), null);
  assert.deepEqual(buildHourRows({ hour_distribution: [{ hour: 1, total: 0 }] }), []);
  const rows = buildHourRows({
    hour_distribution: Array.from({ length: 24 }, (_, hour) => ({
      hour,
      total: hour === 8 || hour === 10 ? 2 : 0,
    })),
  });
  assert.deepEqual(rows?.map((row) => [row.label, row.total]), [["08h", 2], ["09h", 0], ["10h", 2]]);
});

test("período anterior tem o mesmo tamanho e termina na véspera", () => {
  assert.deepEqual(getPreviousPeriod("2026-11-02", "2026-11-08"), { dateFrom: "2026-10-26", dateTo: "2026-11-01" });
  assert.deepEqual(getPreviousPeriod("2026-03-01", "2026-03-01"), { dateFrom: "2026-02-28", dateTo: "2026-02-28" });
  assert.equal(getPreviousPeriod("2026-11-08", "2026-11-02"), null);
});

test("comparações não inventam variação sem base e respeitam o sentido bom", () => {
  assert.equal(percentDelta(10, 0), null);
  assert.equal(percentDelta(10, undefined), null);
  assert.deepEqual(percentDelta(15, 10), { label: "+50,0%", tone: "good" });
  assert.deepEqual(countDelta(3, 5, "down"), { label: "-2", tone: "good" });
  assert.deepEqual(countDelta(5, 5), { label: "0", tone: "neutral" });
  assert.equal(pointsDelta(50, 0, 0), null);
  assert.deepEqual(pointsDelta(8, 10, 20, "down"), { label: "-2,0 p.p.", tone: "good" });
});

test("resumo da equipe ignora quem não tem agenda", () => {
  const person = (name: string, total: number, completed: number, eligible: number) => ({
    user_id: name,
    name,
    avatar_url: null,
    total,
    eligible,
    appointments: 0,
    appointment_eligible: 0,
    open: 0,
    completed,
    no_show: 0,
    overdue: 0,
    completion_rate: eligible ? (completed / eligible) * 100 : 0,
    no_show_rate: 0,
  });
  const summary = buildTeamSummary(
    [person("A", 4, 2, 4), person("B", 6, 3, 3), person("C", 0, 0, 0)],
    [{ user_id: "A", name: "A", avatar_url: null, overdue: 2 }],
  );
  assert.equal(summary.activeCount, 2);
  assert.equal(summary.averagePerPerson, 5);
  assert.equal(summary.best?.name, "B");
  assert.equal(summary.worstOverdue?.name, "A");
});
