import assert from "node:assert/strict";
import test from "node:test";
import { apiDashboardSourceSchema, dashboardFiltersSchema } from "@/lib/validation/final-domains";
import { getSourceFilterUnavailableReason } from "@/lib/validation/dashboard-filter-text";
import { sharedFilterSnapshotSchema } from "@/lib/validation/shared-filter-presets";
import { contactListQuerySchema } from "@/lib/validation/crm-support";

test("long historical origin remains selectable and keeps its complete aggregate label", () => {
  const source = "Origem histórica ".repeat(40).trim();
  assert.equal(dashboardFiltersSchema.parse({ source }).source, source);
  const rows = apiDashboardSourceSchema.parse([{ name: source, rawSource: source, value: 6533 }]);
  assert.equal(rows[0].name, source);
  assert.equal(rows[0].rawSource, source);
  assert.equal(rows[0].value, 6533);
});

test("origin response accepts a legacy value beyond the bounded filter contract", () => {
  const source = "ã".repeat(5000);
  const rows = apiDashboardSourceSchema.parse([{ name: source, rawSource: source, value: 1 }]);
  assert.equal(rows[0].rawSource, source);
  assert.equal(dashboardFiltersSchema.safeParse({ source }).success, false);
  assert.match(getSourceFilterUnavailableReason(source) ?? '', /Somente|disponível para consulta/);
});

test("historical sources at the query bound survive shared session snapshots", () => {
  const source = "🏠".repeat(4096);
  assert.equal(dashboardFiltersSchema.parse({ source }).source, source);
  assert.equal(getSourceFilterUnavailableReason(source), null);
  assert.equal(contactListQuerySchema.parse({ source }).source, source);
  assert.notEqual(getSourceFilterUnavailableReason(source + "🏠"), null);
  const snapshot = sharedFilterSnapshotSchema.parse({ version: 2, source });
  assert.equal(sharedFilterSnapshotSchema.parse(JSON.parse(JSON.stringify(snapshot))).source, source);
});

test("dashboard text filters use Go-compatible Unicode boundaries and reject NUL", () => {
  const searchQuery = '🏠'.repeat(180);
  assert.equal(dashboardFiltersSchema.parse({ searchQuery }).searchQuery, searchQuery);
  assert.equal(dashboardFiltersSchema.safeParse({ searchQuery: searchQuery + '🏠' }).success, false);
  const campaignId = '🏠'.repeat(255);
  assert.deepEqual(dashboardFiltersSchema.parse({ campaignIds: [campaignId] }).campaignIds, [campaignId]);
  assert.equal(dashboardFiltersSchema.safeParse({ campaignIds: [campaignId + '🏠'] }).success, false);
  for (const field of ['source', 'searchQuery', 'pageId', 'campaignId', 'adSetId', 'adId']) {
    assert.equal(dashboardFiltersSchema.safeParse({ [field]: 'unsafe\0text' }).success, false);
  }
  assert.notEqual(getSourceFilterUnavailableReason('all'), null);
  assert.notEqual(getSourceFilterUnavailableReason('  Facebook  '), null);
  assert.equal(getSourceFilterUnavailableReason('Facebook'), null);
});
