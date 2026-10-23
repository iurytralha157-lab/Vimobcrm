import assert from "node:assert/strict";
import test from "node:test";
import { dashboardEvolutionTickLayout, dashboardEvolutionTickLines } from "./evolution-chart-model";

test("full years and repeated DST offsets survive splitting range tick labels", () => {
  assert.deepEqual(dashboardEvolutionTickLines("31/12/2025–02/01/2026"), ["31/12/2025", "– 02/01/2026"]);
  assert.deepEqual(dashboardEvolutionTickLines("01/11 01:00 -04:00–01/11 01:59 -05:00"), ["01/11 01:00 -04:00", "– 01/11 01:59 -05:00"]);
  assert.deepEqual(dashboardEvolutionTickLines("08:00", true), ["08h"]);
});

test("range tick count follows actual chart width instead of assuming short dates", () => {
  const short = Array.from({ length: 24 }, (_, index) => `${index + 1}/10`);
  const long = short.map(() => "31/12/2025–02/01/2026");
  const dst = short.map(() => "01/11 01:00 -04:00–01/11 01:59 -05:00");
  for (const width of [280, 350, 502, 674]) {
    const mobile = width < 400;
    const shortLayout = dashboardEvolutionTickLayout(short, width, mobile);
    const longLayout = dashboardEvolutionTickLayout(long, width, mobile);
    const dstLayout = dashboardEvolutionTickLayout(dst, width, mobile);
    assert.ok(longLayout.interval > shortLayout.interval);
    assert.ok(dstLayout.interval >= longLayout.interval);
    assert.equal(longLayout.height, 40);
    const shown = Math.ceil(dst.length / (dstLayout.interval + 1));
    assert.ok(shown === 1 || shown * (dstLayout.labelWidth + 16) <= width - (mobile ? 38 : 85));
  }
});
