import assert from "node:assert/strict";
import test from "node:test";

import {
  AGENDA_DASHBOARD_FALLBACK_TIME_ZONE,
  getAgendaDashboardPresetRange,
  getAgendaDashboardSharedPresetRange,
  validateAgendaDashboardCalendarRange,
} from "./agenda-dashboard-date-range";

test("shared dashboard shortcuts retain their meanings in the organization's civil timezone", () => {
  const now = new Date("2026-10-01T01:00:00Z");
  const zone = "America/Sao_Paulo";
  const expected = {
    today: ["2026-09-30", "2026-09-30"],
    yesterday: ["2026-09-29", "2026-09-29"],
    last7days: ["2026-09-24", "2026-09-30"],
    last30days: ["2026-09-01", "2026-09-30"],
    thisMonth: ["2026-09-01", "2026-09-30"],
    lastMonth: ["2026-08-01", "2026-08-31"],
    thisQuarter: ["2026-07-01", "2026-09-30"],
    thisYear: ["2026-01-01", "2026-09-30"],
  } as const;
  for (const preset of Object.keys(expected) as Array<keyof typeof expected>) {
    const [dateFrom, dateTo] = expected[preset];
    assert.deepEqual(getAgendaDashboardSharedPresetRange(preset, now, zone), { dateFrom, dateTo });
  }
  assert.deepEqual(getAgendaDashboardSharedPresetRange("thisMonth", now, "Pacific/Kiritimati"), { dateFrom: "2026-10-01", dateTo: "2026-10-01" });
  assert.deepEqual(getAgendaDashboardSharedPresetRange("lastMonth", new Date("2024-03-01T15:00:00Z"), zone), { dateFrom: "2024-02-01", dateTo: "2024-02-29" });
});

test("Agenda validates inclusive civil days without rejecting a DST-length interval", () => {
  assert.equal(validateAgendaDashboardCalendarRange({ from: new Date(2026, 0, 1), to: new Date(2027, 0, 1, 23, 59) }), null);
  assert.equal(validateAgendaDashboardCalendarRange({ from: new Date(2026, 0, 1), to: new Date(2027, 0, 2) }), "Selecione no máximo 366 dias.");
  assert.equal(validateAgendaDashboardCalendarRange({ from: new Date(2026, 0, 2), to: new Date(2026, 0, 1) }), "Selecione um período válido.");
  assert.equal(validateAgendaDashboardCalendarRange({ from: new Date(Number.NaN), to: new Date() }), "Selecione um período válido.");
  assert.equal(validateAgendaDashboardCalendarRange(null), null);
});

test("presets seguem o dia civil da organização, não o fuso do navegador", () => {
  const referenceDate = new Date("2026-09-14T01:30:00.000Z");

  assert.deepEqual(
    getAgendaDashboardPresetRange(
      "this_week",
      referenceDate,
      "America/Sao_Paulo",
    ),
    { dateFrom: "2026-09-07", dateTo: "2026-09-13" },
  );
  assert.deepEqual(
    getAgendaDashboardPresetRange("this_week", referenceDate, "Asia/Tokyo"),
    { dateFrom: "2026-09-14", dateTo: "2026-09-20" },
  );
});

test("presets preservam mês civil e janelas inclusivas de 30 dias", () => {
  const referenceDate = new Date("2026-10-01T01:00:00.000Z");

  assert.deepEqual(
    getAgendaDashboardPresetRange(
      "this_month",
      referenceDate,
      "America/Sao_Paulo",
    ),
    { dateFrom: "2026-09-01", dateTo: "2026-09-30" },
  );
  assert.deepEqual(
    getAgendaDashboardPresetRange(
      "last_30_days",
      referenceDate,
      "America/Sao_Paulo",
    ),
    { dateFrom: "2026-09-01", dateTo: "2026-09-30" },
  );
  assert.deepEqual(
    getAgendaDashboardPresetRange(
      "next_30_days",
      referenceDate,
      "America/Sao_Paulo",
    ),
    { dateFrom: "2026-09-30", dateTo: "2026-10-29" },
  );
});

test("fuso inválido recua para o fuso padrão do relatório", () => {
  const referenceDate = new Date("2026-09-14T01:30:00.000Z");

  assert.deepEqual(
    getAgendaDashboardPresetRange("today", referenceDate, "Invalid/Timezone"),
    getAgendaDashboardPresetRange(
      "today",
      referenceDate,
      AGENDA_DASHBOARD_FALLBACK_TIME_ZONE,
    ),
  );
});
