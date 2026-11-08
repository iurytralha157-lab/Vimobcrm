import assert from "node:assert/strict";
import test from "node:test";

const modulePath = "./dashboard-kpi-model.ts";
const { dashboardCardsSpark, dashboardDelta, dashboardKpiRates } = await import(modulePath);

test("a zero trend is not shown, because it also means no previous period", () => {
  assert.equal(dashboardDelta(0), null);
  assert.equal(dashboardDelta(undefined), null);
  assert.equal(dashboardDelta(Number.NaN), null);
  assert.deepEqual(dashboardDelta(12), { text: "+12%", tone: "up" });
  assert.deepEqual(dashboardDelta(-6), { text: "-6%", tone: "down" });
  assert.deepEqual(dashboardDelta(4, { lowerIsBetter: true }), { text: "+4%", tone: "down" });
});

test("shares use the unique cards of the cohort and survive an empty cohort", () => {
  assert.deepEqual(dashboardKpiRates({ totalLeads: 0, openLeads: 3, lostLeads: 1, closedLeads: 1 }), { open: 0, lost: 0, won: 0 });
  const rates = dashboardKpiRates({ totalLeads: 200, openLeads: 150, lostLeads: 40, closedLeads: 10 });
  assert.deepEqual(rates, { open: 75, lost: 20, won: 5 });
});

test("the Leads sparkline sums the stacked evolution series", () => {
  assert.deepEqual(dashboardCardsSpark([{ abertos: 3, ganhos: 1, perdas: 2 }, { abertos: 0, ganhos: 0, perdas: 0 }]), [6, 0]);
});
