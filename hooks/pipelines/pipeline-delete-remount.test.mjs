import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { QueryClient, QueryObserver } from '@tanstack/query-core';
import { buildPipelineStageRestorePlans } from '../../lib/pipeline-pagination-state.ts';

// Execute the actual production query options/queryFn with real QueryObserver.
// Auth and APIs are synthetic; the global cache policy remains refetchOnMount:false.
function productionQueryOptions(file, hook, dependencies) {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const declaration = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === hook);
  assert(declaration, hook);
  let options;
  const visit = node => {
    if (ts.isCallExpression(node) && node.expression.getText(source) === 'useQuery') options = node.arguments[0];
    ts.forEachChild(node, visit);
  };
  visit(declaration); assert(options, `${hook} useQuery options`);
  const compiled = ts.transpileModule(`const options = ${options.getText(source)};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  return new Function(...Object.keys(dependencies), `${compiled}; return options;`)(...Object.values(dependencies));
}

for (const [hook, file, family] of [
  ['usePipelines', 'hooks/use-stages.ts', 'pipelines'],
  ['useStages', 'hooks/use-stages.ts', 'stages'],
  ['useStagesWithLeads', 'hooks/use-stages.ts', 'stages-with-leads'],
  ['useStageAutomations', 'hooks/use-stage-automations.ts', 'stage-automations'],
]) test(`${hook} refetches an invalidated deletion cache when reopened despite provider mount policy`, async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, refetchOnMount: false } } });
  const queryKey = [family, 'org-a', 'pipeline-a']; let reads = 0;
  const get = async () => { reads++; return []; };
  const options = productionQueryOptions(file, hook, {
    organizationId: 'org-a', pipelineId: 'pipeline-a', stageId: 'stage-a', currentUserId: 'actor-a', accessSignature: 'scope-a',
    queryKey, isBoardEnabled: true, canViewStageAutomations: true,
    PIPELINE_REFERENCE_STALE_TIME_MS: 600_000, PIPELINE_BOARD_STALE_TIME_MS: 600_000, PIPELINE_CACHE_TIME_MS: 3_600_000, LEADS_PER_STAGE: 12,
    pipelinesAPI: { getPipelines: get, getStages: get }, stageConfigAPI: { listStageAutomations: get }, getPipelineBoard: get,
    normalizeAutomation: row => row, stageAutomationsQueryKey: () => queryKey,
    shouldRetryPipelineQuery: () => false, reusePreviousDataWhenKeyPartsMatch: previous => previous,
    reconcilePipelineBoardSnapshot: (_old, next) => next, getPendingPipelineMoves: () => [],
    setRestoreError: () => {}, queryClient: client, paginationStorageKey: null, queryKeyId: 'synthetic',
    buildPipelineStageRestorePlans,
    readPipelineStageLoadedCounts: () => ({}), mergePipelineStageLoadedCounts: () => ({}), restoreIdentity: {},
    getPipelineStageLoadedCountsFromBoard: () => ({}), backgroundRestoreStateRef: { current: null }, filterUserId: undefined, filters: undefined,
  });
  const key = options.queryKey;
  let unsubscribe;
  try {
    assert.equal(client.getDefaultOptions().queries.refetchOnMount, false);
    client.setQueryData(key, [{ id: 'removed-remotely' }]);
    const first = new QueryObserver(client, options); unsubscribe = first.subscribe(() => {});
    assert.equal(reads, 0, 'fresh cache is reused before leaving'); unsubscribe(); unsubscribe = undefined;
    // Accepted DELETE arrives after unmount: invalidate only, without a hidden GET.
    await client.invalidateQueries({ queryKey: key, exact: true, refetchType: 'none' });
    assert.equal(reads, 0); assert.equal(client.getQueryState(key).isInvalidated, true);
    const reopened = new QueryObserver(client, options);
    await new Promise((resolve, reject) => {
      unsubscribe = reopened.subscribe(result => {
        if (result.isError) reject(result.error);
        if (result.isSuccess && result.fetchStatus === 'idle' && result.data.length === 0) resolve();
      });
    });
    assert.equal(reads, 1, 'reopening reconciles the stale projection through its actual queryFn');
    assert.deepEqual(client.getQueryData(key), []); assert.equal(client.getQueryState(key).isInvalidated, false);
  } finally { unsubscribe?.(); client.clear(); }
});
