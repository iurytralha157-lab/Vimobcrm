import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const organizationId = '11111111-1111-4111-8111-111111111111';
const brokerId = '22222222-2222-4222-8222-222222222222';
const element = (tag) => function MockElement({ children, ...props }) {
  return React.createElement(tag, props, children);
};
let request;
const mocks = {
  '@/components/ui/card': { Card: element('div'), CardContent: element('div'), CardHeader: element('div'), CardTitle: element('h3') },
  '@/components/ui/avatar': { Avatar: element('span'), AvatarImage: element('img'), AvatarFallback: element('span') },
  '@/components/ui/skeleton': { Skeleton: element('span') },
  './vimob-client': { vimobAPIRequest: (...args) => request(...args) },
};
const loaded = new Map();
function loadSource(relativePath) {
  const path = resolve(root, relativePath);
  if (loaded.has(path)) return loaded.get(path).exports;
  const compiledModule = { exports: {} };
  loaded.set(path, compiledModule);
  const compiled = ts.transpileModule(readFileSync(path, 'utf8'), {
    fileName: path,
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  function loadImport(specifier) {
    if (mocks[specifier]) return mocks[specifier];
    if (specifier.startsWith('@/') || specifier.startsWith('.')) {
      const base = specifier.startsWith('@/') ? resolve(root, specifier.slice(2)) : resolve(dirname(path), specifier);
      return loadSource(existsSync(`${base}.tsx`) ? `${base}.tsx` : `${base}.ts`);
    }
    return require(specifier);
  }
  new Function('require', 'module', 'exports', compiled)(loadImport, compiledModule, compiledModule.exports);
  return compiledModule.exports;
}

mocks['@/lib/validation'] = {
  ...loadSource('lib/validation/common.ts'),
  ...loadSource('lib/validation/final-domains.ts'),
};
const { getDashboardTopBrokers } = loadSource('lib/api/dashboard.ts');
const { analyticsAPI } = loadSource('lib/api/analytics.ts');
const { TopBrokersWidget } = loadSource('components/features/dashboard/TopBrokersWidget.tsx');

function broker(totalCommissions) {
  return { id: brokerId, name: 'Corretor sintético', avatar_url: null, closedLeads: 2, salesValue: 900_000, totalCommissions };
}

test('top-brokers accepts withheld commission without inventing zero or hiding the ranking', async () => {
  request = async (path) => {
    assert.equal(path, '/v1/dashboard/top-brokers');
    return { data: { brokers: [broker(null)], isFallbackMode: false } };
  };
  const result = await getDashboardTopBrokers({ organizationId });
  assert.equal(result.brokers[0].totalCommissions, null);
  const html = renderToStaticMarkup(React.createElement(TopBrokersWidget, result));
  assert.match(html, /Corretor sintético/);
  assert.match(html, /2 vendas/);
  assert.doesNotMatch(html, /Com:|NaN|undefined/);
});

test('top-brokers keeps legacy numeric commissions and distinguishes authorized zero from withheld', async () => {
  for (const amount of [0, 18_000]) {
    request = async () => ({ data: { brokers: [broker(amount)], isFallbackMode: false } });
    const result = await getDashboardTopBrokers({ organizationId });
    assert.equal(result.brokers[0].totalCommissions, amount);
    const html = renderToStaticMarkup(React.createElement(TopBrokersWidget, result));
    assert.equal(html.includes('Com:'), amount > 0);
    if (amount > 0) assert.match(html, /18\.000/);
  }
});

test('nullable commission contract still rejects malformed amounts', async () => {
  for (const amount of [-1, '18000', undefined]) {
    request = async () => ({ data: { brokers: [broker(amount)], isFallbackMode: false } });
    await assert.rejects(getDashboardTopBrokers({ organizationId }), { code: 'domain_validation_error' });
  }
});

test('vgv-by-broker preserves null and numeric commissions from the protected API', async () => {
  for (const amount of [null, 0, 18_000]) {
    request = async (path) => {
      assert.equal(path, '/v1/analytics/vgv-by-broker');
      return { data: [{ user_id: brokerId, user_name: 'Corretor sintético', total_commission: amount }] };
    };
    const result = await analyticsAPI.vgvByBroker({});
    assert.equal(result[0].total_commission, amount);
  }
});

test('enterprise-kpis propagates financial denial instead of returning zero-valued indicators', async () => {
  const denied = Object.assign(new Error('Forbidden'), { status: 403, code: 'permission_denied' });
  request = async (path) => {
    assert.equal(path, '/v1/analytics/enterprise-kpis');
    throw denied;
  };
  await assert.rejects(analyticsAPI.enterpriseKPIs({}), (error) => error === denied);
});
