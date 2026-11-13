import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { QueryClient, QueryObserver } from '@tanstack/query-core';
import ts from 'typescript';

test('creating in the visual editor refreshes the list when it mounts again', async () => {
  const source = ts.createSourceFile(
    'use-automations.ts',
    readFileSync(new URL('../use-automations.ts', import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  const selected = new Set(['useAutomations', 'useCreateAutomation']);
  const functions = source.statements.filter((node) => ts.isFunctionDeclaration(node) && selected.has(node.name?.text));
  assert.equal(functions.length, selected.size);
  const compiled = ts.transpileModule(functions.map((node) => node.getText().replace(/^export /, '')).join('\n'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  const useHooks = new Function(
    'useAuth', 'useQuery', 'useMutation', 'useQueryClient', 'automationsAPI', 'requireOrganizationId',
    compiled + '\nreturn { useAutomations, useCreateAutomation };',
  );

  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: 600_000, gcTime: Infinity, refetchOnMount: false, retry: false } },
  });
  const org = 'test-org';
  const queryKey = ['automations', org];
  let reads = 0;
  let automations = [{ id: 'existing' }];
  const { useAutomations, useCreateAutomation } = useHooks(
    () => ({ activeOrganization: { organizationId: org } }),
    (options) => options, (options) => options, () => client,
    {
      listAutomations: async () => {
        reads++;
        return automations;
      },
      createAutomation: async () => {
        const created = { id: 'created-in-builder' };
        automations = [created, ...automations];
        return created;
      },
    },
    (value) => value,
  );
  client.setQueryData(queryKey, automations);
  const freshList = new QueryObserver(client, useAutomations());
  const openBuilder = freshList.subscribe(() => {});
  openBuilder();
  assert.equal(reads, 0, 'mounting a fresh list does not refetch');

  const create = useCreateAutomation();
  await create.mutationFn({ name: 'New automation' });
  await create.onSuccess();
  assert.equal(reads, 0, 'the builder has no active list to refetch');
  assert.equal(client.getQueryState(queryKey)?.isInvalidated, true);

  const reopenedList = new QueryObserver(client, useAutomations());
  const closeList = reopenedList.subscribe(() => {});
  try {
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(reads, 1, 'remount revalidates the invalidated list once');
    assert.deepEqual(reopenedList.getCurrentResult().data.map(({ id }) => id), ['created-in-builder', 'existing']);
  } finally {
    closeList();
    client.clear();
  }
});
