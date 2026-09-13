import assert from "node:assert/strict";
import test from "node:test";

import {
  AGENDA_DASHBOARD_FALLBACK_TIME_ZONE,
  getAgendaDashboardPresetRange,
} from "./agenda-dashboard-date-range";

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
