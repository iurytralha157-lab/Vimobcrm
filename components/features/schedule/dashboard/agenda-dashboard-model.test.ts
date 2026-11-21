import assert from "node:assert/strict";
import test from "node:test";

import { getAgendaDashboardTotalLabels } from "./agenda-dashboard-model";

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
