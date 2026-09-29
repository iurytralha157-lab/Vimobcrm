import assert from "node:assert/strict";
import test from "node:test";

import { campaignBarHeight, campaignChartRows } from "./campaign-chart-model.ts";

test("campaign bars keep readable thickness without growing a single row", () => {
  assert.equal(campaignBarHeight(1), 22);
  assert.equal(campaignBarHeight(2), 22);
  assert.equal(campaignBarHeight(3), 26);
  assert.equal(campaignBarHeight(4), 30);
  assert.equal(campaignBarHeight(500), 30);
});

test("campaign rows remain complete, distinct and visible with very uneven counts", () => {
  const campaigns = [
    { key: "large", name: "Lançamento", leadCount: 1000 },
    { key: "small", name: "Lançamento", leadCount: 1 },
    { key: "zero", name: "Outra", leadCount: 0 },
  ];
  const rows = campaignChartRows(campaigns);

  assert.deepEqual(rows.map((row) => row.key), ["large", "small", "zero"]);
  assert.deepEqual(rows.map((row) => row.barPercent), [100, 2, 0]);
  assert.equal(campaigns[0].leadCount, 1000);

  const many = Array.from({ length: 500 }, (_, index) => ({
    key: `campaign-${index}`,
    name: `Campanha ${index}`,
    leadCount: index + 1,
  }));
  assert.equal(campaignChartRows(many).length, 500);
});
