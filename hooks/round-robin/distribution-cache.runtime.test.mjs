import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as React from 'react';
import { QueryClient, QueryObserver } from '@tanstack/react-query';

const printer = ts.createPrinter();
const accessModule = { exports: {} };
vm.runInNewContext(ts.transpileModule(
  readFileSync(new URL('../../lib/access/query-client-access.ts', import.meta.url), 'utf8'),
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } },
).outputText, { module: accessModule, exports: accessModule.exports });
function productionClient() {
  const file = new URL('../../components/providers/query-provider.tsx', import.meta.url);
  const source = ts.createSourceFile(file.pathname, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declarations = source.statements.filter(node =>
    ts.isFunctionDeclaration(node) && node.name?.text === 'createTenantQueryClient' ||
    ts.isVariableStatement(node) && node.declarationList.declarations.some(item => ts.isIdentifier(item.name) && item.name.text.startsWith('DEFAULT_QUERY_')));
  assert.equal(declarations.length, 3);
  const code = ts.transpileModule(declarations.map(node => printer.printNode(ts.EmitHint.Unspecified, node, source)).join('\n'),
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  return Function('QueryClient', `${code}\nreturn createTenantQueryClient;`)(QueryClient)('synthetic-access');
}
function productionHooks(api) {
  const file = new URL('../use-round-robins.ts', import.meta.url);
  const code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
  } }).outputText;
  const evaluatedModule = { exports: {} };
  const dependencies = {
    'react': React,
    '@tanstack/react-query': { useQuery: options => options, useInfiniteQuery: options => options },
    'sonner': { toast: {} },
    '@/hooks/use-active-organization': { useActiveOrganizationId: () => 'org-a' },
    '@/lib/api/round-robins': { roundRobinsAPI: api },
    '@/lib/auth/active-organization': { requireActiveOrganizationId: value => value },
    '@/hooks/use-whatsapp-query-scope': { useWhatsAppQueryScope: () => ({ organizationId: 'org-a', userId: 'actor-a' }) },
    '@/lib/access/query-client-access': accessModule.exports,
  };
  vm.runInNewContext(code, { module: evaluatedModule, exports: evaluatedModule.exports, require: name => {
    assert.ok(Object.hasOwn(dependencies, name), `unreviewed dependency: ${name}`);
    return dependencies[name];
  } });
  return evaluatedModule.exports;
}
const tick = () => new Promise(resolve => setTimeout(resolve, 5));

for (const mode of ['detail', 'list']) {
  test(`production ${mode} hook reloads an inactive invalidated queue on return and deduplicates observers`, async () => {
    let revision = 1, reads = 0;
    const api = {
      getRoundRobin: async (_id, org) => { assert.equal(org, 'org-a'); reads++; return { id: 'queue-a', revision }; },
      getRoundRobins: async org => { assert.equal(org, 'org-a'); reads++; return [{ id: 'queue-a', revision }]; },
    };
    const hooks = productionHooks(api), client = productionClient();
    const options = mode === 'detail' ? hooks.useRoundRobin('queue-a') : hooks.useRoundRobins();
    const value = observer => mode === 'detail' ? observer.getCurrentResult().data?.revision : observer.getCurrentResult().data?.[0].revision;
    let observer, unsubscribe, secondUnsubscribe;
    try {
      observer = new QueryObserver(client, options); unsubscribe = observer.subscribe(() => {});
      await tick(); assert.equal(reads, 1); assert.equal(value(observer), 1);
      unsubscribe(); revision = 2;
      await client.invalidateQueries({ queryKey: options.queryKey, refetchType: 'active' });
      assert.equal(client.getQueryState(options.queryKey).isInvalidated, true);
      assert.equal(reads, 1);
      observer = new QueryObserver(client, options); unsubscribe = observer.subscribe(() => {});
      const second = new QueryObserver(client, options); secondUnsubscribe = second.subscribe(() => {});
      await tick(); assert.equal(reads, 2); assert.equal(value(observer), 2); assert.equal(value(second), 2);
    } finally { unsubscribe?.(); secondUnsubscribe?.(); client.clear(); }
  });
}

test('detail checks the current revision on a new visit even if the previous cache is fresh', async () => {
  const hooks = productionHooks({ getRoundRobin: async () => ({ id: 'queue-a', revision: 2 }) });
  const options = hooks.useRoundRobin('queue-a'), client = productionClient();
  client.setQueryData(options.queryKey, { id: 'queue-a', revision: 1 });
  const observer = new QueryObserver(client, options), unsubscribe = observer.subscribe(() => {});
  try {
    assert.equal(observer.getCurrentResult().isFetching, true);
    assert.equal(observer.getCurrentResult().isFetchedAfterMount, false);
    await tick();
    assert.equal(observer.getCurrentResult().data.revision, 2);
    assert.equal(observer.getCurrentResult().isFetchedAfterMount, true);
  } finally { unsubscribe(); client.clear(); }
});
