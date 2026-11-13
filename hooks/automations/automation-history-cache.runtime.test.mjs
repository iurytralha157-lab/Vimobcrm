import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { QueryClient, QueryObserver } from '@tanstack/query-core';
import ts from 'typescript';

test('open execution steps refresh once when the execution becomes terminal', async () => {
  const source = ts.createSourceFile(
    'use-automations.ts',
    readFileSync(new URL('../use-automations.ts', import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  const hook = source.statements.find(
    (node) => ts.isFunctionDeclaration(node) && node.name?.text === 'useAutomationExecutionSteps',
  );
  assert.ok(hook);
  const compiled = ts.transpileModule(hook.getText().replace(/^export /, ''), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;

  let reads = 0;
  let status = 'waiting';
  const readStepQueryOptions = new Function(
    'useAuth', 'useQuery', 'automationsAPI',
    compiled + '\nreturn useAutomationExecutionSteps;',
  )(
    () => ({ activeOrganization: { organizationId: 'test-org' } }),
    (options) => options,
    {
      listExecutionSteps: async () => {
        reads++;
        return [{ status }];
      },
    },
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const options = (isExecutionActive, enabled = true) =>
    readStepQueryOptions('test-execution', { enabled, isExecutionActive });
  const observer = new QueryObserver(client, options(true));
  const closeHistory = observer.subscribe(() => {});

  try {
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(reads, 1);
    assert.equal(observer.getCurrentResult().data[0].status, 'waiting');

    status = 'succeeded';
    observer.setOptions(options(false));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(reads, 2);
    assert.equal(observer.getCurrentResult().data[0].status, 'succeeded');

    observer.setOptions(options(false));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(reads, 2, 'unchanged terminal status does not trigger another read');

    observer.setOptions(options(true, false));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(reads, 2, 'collapsed steps do not fetch');
  } finally {
    closeHistory();
    client.clear();
  }
});
