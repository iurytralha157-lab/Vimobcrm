import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';
import { DASHBOARD_SOURCE_SLICE_LIMIT } from './lead-sources-model.ts';
import { findDashboardSourceLabel } from '../../../lib/analytics/dashboard-source-label.ts';

const require = createRequire(import.meta.url);
const { computePieSectors } = require('recharts/lib/polar/Pie');
const url = new URL('./DashboardScreen.tsx', import.meta.url);
const source = readFileSync(url, 'utf8');
const parsed = ts.createSourceFile(url.pathname, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = new Set(['getSourceLabel', 'buildWonSourceBuckets']);
const functions = parsed.statements.filter((node) => ts.isFunctionDeclaration(node) && names.has(node.name?.text)).map((node) => node.getText(parsed)).join('\n');
assert.equal(functions.length > 0, true);
const compiled = ts.transpileModule(functions, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const buildBuckets = new Function('findDashboardSourceLabel', 'DASHBOARD_CHART_COLORS', 'DASHBOARD_SOURCE_SLICE_LIMIT', `${compiled}\nreturn buildWonSourceBuckets;`)(findDashboardSourceLabel, ['red', 'green', 'blue'], DASHBOARD_SOURCE_SLICE_LIMIT);

test('custom prototype names remain text in won sources without changing counts or raw records', () => {
  const deals = ['manual', '__proto__', 'constructor', 'toString', 'hasOwnProperty', ' Facebook '].map((source) => ({ source }));
  const snapshot = structuredClone(deals);
  const buckets = buildBuckets(deals, deals.length);
  assert.equal(buckets.length, deals.length);
  assert.equal(buckets.reduce((sum, bucket) => sum + bucket.count, 0), deals.length);
  assert.deepEqual(new Set(buckets.map((bucket) => bucket.label)), new Set(['Manual', '__proto__', 'constructor', 'toString', 'hasOwnProperty', 'Meta Ads']));
  assert.deepEqual(deals, snapshot);
});

test('100 won sources render eight positive sectors and preserve every displayed deal', () => {
  const deals = Array.from({ length: 100 }, (_, index) => ({ source: `Imported ${index}` }));
  const snapshot = structuredClone(deals);
  const buckets = buildBuckets(deals, deals.length);
  assert.equal(buckets.length, 8);
  assert.equal(buckets.at(-1).label, 'Outras origens');
  assert.equal(buckets.at(-1).count, 93);
  assert.equal(buckets.reduce((sum, bucket) => sum + bucket.count, 0), 100);
  assert.ok(Math.abs(buckets.reduce((sum, bucket) => sum + bucket.percentage, 0) - 100) < 1e-9);
  const sectors = computePieSectors({ displayedData: buckets, cells: [], offset: { width: 190, height: 180, left: 0, top: 0 }, pieSettings: {
    cx: '50%', cy: '50%', innerRadius: '52%', outerRadius: '76%', dataKey: 'count', nameKey: 'label', startAngle: 0, endAngle: 360, minAngle: 0, paddingAngle: 3, cornerRadius: 0,
  } });
  assert.equal(sectors.length, 8);
  assert.ok(sectors.every((sector) => sector.endAngle > sector.startAngle));
  assert.ok(Math.abs(sectors.reduce((sum, sector) => sum + sector.endAngle - sector.startAngle, 0) - 336) < 1e-9);
  assert.deepEqual(deals, snapshot);
});

test('the real Outras origens and aggregate retain separate identities without changing the percentage base', () => {
  const deals = [{ source: 'Outras origens' }, { source: 'Outras origens' }, ...Array.from({ length: 9 }, (_, index) => ({ source: `Source ${index}` }))];
  const buckets = buildBuckets(deals, 22);
  const others = buckets.filter((bucket) => bucket.label === 'Outras origens');
  assert.equal(others.length, 2);
  assert.equal(new Set(others.map((bucket) => bucket.key)).size, 2);
  assert.equal(buckets.reduce((sum, bucket) => sum + bucket.count, 0), 11);
  assert.ok(Math.abs(buckets.reduce((sum, bucket) => sum + bucket.percentage, 0) - 50) < 1e-9);
  assert.deepEqual(buildBuckets([], 0), []);
});
