import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

function renderCatalog(marketingQuery, props = {}, googleQuery = {}) {
  const calls = [];
  const cache = new Map();
  const query = { data: [], isLoading: false, isError: false, refetch() {} };
  const element = (tag) => function TestElement({ children, ...attributes }) {
    delete attributes.asChild;
    delete attributes.unoptimized;
    return React.createElement(tag, attributes, children);
  };
  const ui = new Proxy({}, { get: (_, key) => element(key === 'Button' ? 'button' : key === 'Card' ? 'article' : 'div') });
  const emptyComponents = new Proxy({}, { get: () => () => null });
  const hooks = new Proxy({}, { get: (_, name) => (options) => {
    if (name === 'useMarketingConnections') {
      calls.push(options);
      return { ...query, ...marketingQuery };
    }
    if (['useGoogleAnalyticsIntegration', 'useGoogleTagManagerIntegration', 'useGoogleSearchConsoleIntegration'].includes(name)) {
      return { ...query, ...googleQuery };
    }
    return query;
  } });

  function load(path) {
    const filename = extname(path) ? path : `${path}.ts`;
    if (cache.has(filename)) return cache.get(filename).exports;
    const compiledModule = { exports: {} };
    cache.set(filename, compiledModule);
    const source = ts.transpileModule(readFileSync(filename, 'utf8'), {
      fileName: filename,
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText;
    const imports = (name) => {
      if (name === 'next/navigation') return { useRouter: () => ({ push() {} }) };
      if (name === 'next/image') return element('img');
      if (name === 'lucide-react') return emptyComponents;
      if (name.startsWith('@/components/ui/')) return ui;
      if (name.startsWith('@/components/features/')) return emptyComponents;
      if (name.startsWith('@/hooks/')) return hooks;
      if (name === '@/lib/api/google-calendar') return { isGoogleCalendarServiceUnavailable: () => false };
      if (name === '@/lib/api') return { isChavesNaMaoHomologationRequired: () => false };
      if (name === '@/config/constants') return { FEATURES: { ENABLE_GOOGLE_CALENDAR_INTEGRATION: true } };
      if (name === '@/config/integrations') return load(resolve(root, 'config/integrations/index.ts'));
      if (name.startsWith('@/')) return load(resolve(root, name.slice(2)));
      if (name.startsWith('.')) return load(resolve(dirname(filename), name));
      return require(name);
    };
    new Function('require', 'module', 'exports', source)(imports, compiledModule, compiledModule.exports);
    return compiledModule.exports;
  }

  const { IntegrationsTab } = load(resolve(root, 'components/features/settings/IntegrationsTab.tsx'));
  const html = renderToStaticMarkup(React.createElement(IntegrationsTab, {
    hasWhatsAppModule: true, hasAIModule: true, hasWebhooksModule: true, hasAPIModule: true,
    hasPortalsModule: true, hasSiteModule: true, hasCampaignsModule: true,
    canManageIntegrations: true, canViewWhatsApp: true, canManageAI: true, canManageSite: true,
    search: '', ...props,
  }));
  const card = (title) => [...html.matchAll(/<article\b[\s\S]*?<\/article>/g)].map(([text]) => text).find((text) => text.includes(`>${title}<`));
  return { card, calls };
}

for (const [data, detail] of [
  [{ enabled: false, meta_configured: true, connections: [] }, 'Ainda não liberado para esta organização'],
  [{ enabled: true, meta_configured: false, connections: [] }, 'O app da Meta para Marketing ainda não foi configurado neste ambiente'],
]) {
  test(`Meta Marketing disables configuration when ${detail}`, () => {
    const { card } = renderCatalog({ data });
    assert.match(card('Meta Marketing'), new RegExp(detail));
    assert.match(card('Meta Marketing'), /<button[^>]*disabled/);
    assert.doesNotMatch(card('Meta Marketing'), />Configurar<|>Pendente</);
  });
}

test('Meta Marketing distinguishes unconnected, active and expired logins after availability succeeds', () => {
  for (const [connections, label, action] of [[[], 'Pendente', 'Configurar'], [[{ status: 'active' }], 'Conectado', 'Gerenciar'], [[{ status: 'expired' }], 'Ação necessária', 'Corrigir configuração']]) {
    const { card } = renderCatalog({ data: { enabled: true, meta_configured: true, connections } });
    assert.match(card('Meta Marketing'), new RegExp(`>${label}<`));
    assert.match(card('Meta Marketing'), new RegExp(`${action}</button>`));
    assert.doesNotMatch(card('Meta Marketing'), /<button[^>]*disabled/);
  }
});

test('Meta Marketing waits for availability and preserves a failed lookup as an error', () => {
  const loading = renderCatalog({ isLoading: true, data: undefined }).card('Meta Marketing');
  assert.match(loading, /Verificando/);
  assert.match(loading, /<button[^>]*disabled/);
  const failed = renderCatalog({ isError: true, data: { enabled: false, meta_configured: false, connections: [] } }).card('Meta Marketing');
  assert.match(failed, /Status indisponível|Status não verificado/);
  assert.match(failed, /Tentar novamente/);
  assert.doesNotMatch(failed, /Ainda não liberado|>Pendente</);
});

test('Meta Marketing requires the campaigns module and integration permission before requesting availability', () => {
  for (const props of [{ hasCampaignsModule: false }, { canManageIntegrations: false }]) {
    const { card, calls } = renderCatalog({ data: undefined }, props);
    assert.deepEqual(calls, [{ enabled: false }]);
    assert.match(card('Meta Marketing'), /Módulo indisponível|Sem acesso/);
    assert.match(card('Meta Marketing'), /<button[^>]*disabled/);
  }
});

test('Google site cards keep shared configuration failures visible instead of reporting an empty configuration', () => {
  const { card } = renderCatalog({ data: { enabled: true, meta_configured: true, connections: [] } }, {}, { data: undefined, isError: true });
  for (const title of ['Google Analytics', 'Google Tag Manager', 'Google Search Console']) {
    assert.match(card(title), /Status indisponível/);
    assert.match(card(title), /Tentar novamente/);
    assert.doesNotMatch(card(title), />Pendente</);
  }
});
