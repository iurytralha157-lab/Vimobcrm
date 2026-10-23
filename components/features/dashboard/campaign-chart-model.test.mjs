import assert from "node:assert/strict";
import test from "node:test";

import { campaignBarHeight, campaignChartPage, campaignChartRows, campaignChartSearchRows } from "./campaign-chart-model.ts";

test("campaign bars keep readable thickness without growing a single row", () => {
  assert.equal(campaignBarHeight(1), 22);
  assert.equal(campaignBarHeight(2), 22);
  assert.equal(campaignBarHeight(3), 26);
  assert.equal(campaignBarHeight(4), 30);
  assert.equal(campaignBarHeight(500), 30);
});

test("campaign pagination mounts a bounded page while preserving all exact campaign totals", () => {
  const rows = campaignChartRows(Array.from({ length: 334 }, (_, index) => ({ key: `id:${index}`, campaignId: `${index}`, name: `Campanha ${index}`, leadCount: index + 1 })));
  const first = campaignChartPage(rows, 1);
  const last = campaignChartPage(rows, 99);
  assert.equal(first.items.length, 25);
  assert.equal(first.total, 334);
  assert.equal(first.items[0].leadCount, 334);
  assert.equal(last.page, 14);
  assert.equal(last.items.length, 9);
  assert.equal(last.end, 334);
  assert.equal(rows.length, 334);
  assert.equal(campaignChartPage([], 2).start, 0);
});

test("campaign search matches full names, accents and IDs without changing global bar scale", () => {
  const rows = campaignChartRows([{ key: "id:1", campaignId: "123", name: "Lançamento São Paulo", leadCount: 100 }, { key: "id:2", campaignId: "456", name: "Outra campanha", leadCount: 2 }]);
  assert.equal(campaignChartSearchRows(rows, "lancamento sao")[0].key, "id:1");
  assert.equal(campaignChartSearchRows(rows, "456")[0].barPercent, 2);
  assert.equal(campaignChartSearchRows(rows, "ausente").length, 0);
  assert.equal(campaignChartSearchRows(rows, ""), rows);
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
