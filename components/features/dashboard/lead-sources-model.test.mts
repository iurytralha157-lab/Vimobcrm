import assert from "node:assert/strict";
import test from "node:test";
import { buildDashboardSourcesModel, filterDashboardSources, formatDashboardSourcePercentage, formatDashboardSourceTotal } from "./lead-sources-model";

test("547 imported source categories keep exact totals in eight positive pie sectors", () => {
  const data = Array.from({ length: 547 }, (_, index) => ({ name: `Origem ${index}`, rawSource: `import:${index}`, value: index + 1 }));
  const snapshot = structuredClone(data);
  const model = buildDashboardSourcesModel(data);
  assert.equal(model.sources.length, 547);
  assert.equal(model.slices.length, 8);
  assert.equal(model.otherSourceCount, 540);
  assert.equal(model.slices.reduce((sum, source) => sum + source.value, 0), model.total);
  assert.ok(360 - model.slices.length * 3 > 0);
  assert.equal(model.slices.at(-1)?.isOther, true);
  assert.equal(model.slices.at(-1)?.rawSource, undefined);
  assert.deepEqual(data, snapshot);
});

test("real source named Outras origens remains distinct from the synthetic aggregate", () => {
  const model = buildDashboardSourcesModel([
    { name: "Outras origens", rawSource: "real-source", value: 99 },
    { name: "Não informada", rawSource: "", value: 1 },
    { name: "Sem movimento", rawSource: "zero", value: 0 },
  ], 1);
  assert.equal(model.total, 100);
  assert.equal(model.sources.length, 3);
  assert.equal(model.slices[0].rawSource, "real-source");
  assert.equal(model.slices[0].isOther, false);
  assert.notEqual(model.slices[0].key, model.slices[1].key);
  assert.equal(model.sources[1].rawSource, "");
  assert.equal(model.slices[1].value, 1);
});

test("search finds raw source and accented display labels without changing filter identity", () => {
  const { sources } = buildDashboardSourcesModel([{ name: "Indicação", rawSource: "Exact,Case/Id", value: 1 }]);
  assert.equal(filterDashboardSources(sources, "indicacao")[0].rawSource, "Exact,Case/Id");
  assert.equal(filterDashboardSources(sources, "exact,case").length, 1);
  assert.equal(filterDashboardSources(sources, "absent").length, 0);
});

test("small nonzero source shares remain readable and empty totals are safe", () => {
  assert.equal(formatDashboardSourcePercentage(1, 7242), "0,01%");
  assert.equal(formatDashboardSourcePercentage(1, 1_000_000), "<0,01%");
  assert.equal(formatDashboardSourcePercentage(1, 2), "50%");
  assert.equal(formatDashboardSourcePercentage(0, 0), "0%");
  assert.deepEqual(buildDashboardSourcesModel([]).slices, []);
  assert.equal(formatDashboardSourceTotal(7242), "7.242");
  assert.equal(formatDashboardSourceTotal(1_000_000), "1\u00a0mi");
});
