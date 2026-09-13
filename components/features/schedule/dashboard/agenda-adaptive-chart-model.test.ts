import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAgendaAdaptiveChartModel,
  getAgendaSelectedDayCount,
  selectAgendaChartGranularity,
  type AgendaAdaptiveDailyPoint,
} from "./agenda-adaptive-chart-model";

const DAY_IN_MS = 24 * 60 * 60 * 1_000;

function calendarDateAt(start: string, offset: number) {
  return new Date(Date.parse(`${start}T00:00:00Z`) + offset * DAY_IN_MS)
    .toISOString()
    .slice(0, 10);
}

function buildDailyPoints(
  start: string,
  count: number,
): AgendaAdaptiveDailyPoint[] {
  return Array.from({ length: count }, (_, index) => ({
    date: calendarDateAt(start, index),
    total: index + 1,
    open: index % 3,
    overdue: index % 4,
    completed: index % 5,
    cancelled: index % 2,
    no_show: index % 6,
  }));
}

test("um único dia sempre gera as 24 horas, inclusive horas sem fatos", () => {
  const model = buildAgendaAdaptiveChartModel({
    dateFrom: "2026-09-12",
    dateTo: "2026-09-12",
    daily: [],
    hourly: [
      {
        hour: 9,
        total: 2,
        open: 1,
        overdue: 0,
        completed: 1,
        cancelled: 0,
        no_show: 0,
      },
      {
        hour: 18,
        total: 1,
        open: 1,
        overdue: 0,
        completed: 0,
        cancelled: 0,
        no_show: 0,
      },
    ],
  });

  assert.equal(model.granularity, "hourly");
  assert.equal(model.points.length, 24);
  assert.equal(model.points[0]?.key, "00");
  assert.equal(model.points[9]?.total, 2);
  assert.equal(model.points[23]?.key, "23");
});

test("sete dias preservam a série diária contínua", () => {
  const model = buildAgendaAdaptiveChartModel({
    dateFrom: "2026-09-01",
    dateTo: "2026-09-07",
    daily: [
      ...buildDailyPoints("2026-09-01", 1),
      ...buildDailyPoints("2026-09-07", 1),
    ],
    hourly: [],
  });

  assert.equal(model.granularity, "daily");
  assert.equal(model.points.length, 7);
  assert.deepEqual(
    model.points.map((point) => point.key),
    Array.from({ length: 7 }, (_, index) =>
      calendarDateAt("2026-09-01", index),
    ),
  );
  assert.equal(model.points[3]?.total, 0);
});

for (const dayCount of [30, 60]) {
  test(`${dayCount} dias mantêm todos os pontos e valores recebidos`, () => {
    const start = "2026-01-01";
    const daily = buildDailyPoints(start, dayCount);
    const dateTo = calendarDateAt(start, dayCount - 1);
    const model = buildAgendaAdaptiveChartModel({
      dateFrom: start,
      dateTo,
      daily,
      hourly: [],
    });

    assert.equal(model.granularity, "daily");
    assert.equal(model.points.length, dayCount);
    assert.deepEqual(
      model.points.map((point) => point.key),
      daily.map((point) => point.date),
    );
    assert.deepEqual(
      model.points.map((point) => point.total),
      daily.map((point) => point.total),
    );
  });
}

test("365 dias são agregados por mês sem perder os totais diários", () => {
  const daily = buildDailyPoints("2025-01-01", 365).map((point) => ({
    ...point,
    total: 1,
  }));
  const model = buildAgendaAdaptiveChartModel({
    dateFrom: "2025-01-01",
    dateTo: "2025-12-31",
    daily,
    hourly: [],
  });

  assert.equal(model.granularity, "monthly");
  assert.equal(model.points.length, 12);
  assert.equal(
    model.points.reduce((total, point) => total + point.total, 0),
    365,
  );
  assert.equal(model.points[0]?.key, "2025-01");
  assert.equal(model.points[0]?.total, 31);
  assert.equal(model.points[1]?.total, 28);
  assert.equal(model.points[11]?.key, "2025-12");
});

test("limites de granularidade seguem 1, 92 e 366 dias inclusivos", () => {
  assert.equal(getAgendaSelectedDayCount("2026-01-01", "2026-01-01"), 1);
  assert.equal(
    selectAgendaChartGranularity("2026-01-01", "2026-04-02"),
    "daily",
  );
  assert.equal(
    selectAgendaChartGranularity("2026-01-01", "2026-04-03"),
    "monthly",
  );
  assert.equal(
    selectAgendaChartGranularity("2025-01-01", "2026-01-01"),
    "monthly",
  );
});
