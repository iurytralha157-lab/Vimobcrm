import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import ts from 'typescript';
import { evaluateProduction, productionDeclaration, leadHookRuntime } from '../../../hooks/leads/lead-request-runtime-fixture.mjs';

const cleanups = [];
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); });

function criticalRetry(dependencies) {
  const access = leadHookRuntime();
  const slots = []; let cursor = 0;
  const changed = (previous, next) => !previous || next.some((value, index) => value !== previous[index]);
  const hooks = {
    useQueryClient: () => access.client(), useLeadRequestScope: () => access.scope(), useCallback: fn => fn,
    useRef: value => { const index = cursor++; return slots[index] ??= { current: value }; },
    useMemo: (build, deps) => { const index = cursor++; if (changed(slots[index]?.deps, deps)) slots[index] = { deps, value: build() }; return slots[index].value; },
    useLayoutEffect: (setup, deps) => { const index = cursor++; if (changed(slots[index]?.deps, deps)) { slots[index]?.cleanup?.(); slots[index] = { deps, cleanup: setup() }; } },
    useState: initial => {
      const index = cursor++; slots[index] ??= { value: initial };
      return [slots[index].value, value => { slots[index].value = value; dependencies.setIsRefreshing(value !== null); }];
    },
  };
  hooks.usePipelineEditorVisit = evaluateProduction(productionDeclaration('hooks/pipelines/use-pipeline-editor-visit.ts',
    node => ts.isFunctionDeclaration(node) && node.name?.text === 'usePipelineEditorVisit'), hooks, 'usePipelineEditorVisit');
  const usePipelineCriticalLoadRetry = evaluateProduction(productionDeclaration('hooks/pipelines/use-pipeline-critical-load-retry.ts',
    node => ts.isFunctionDeclaration(node) && node.name?.text === 'usePipelineCriticalLoadRetry'), hooks, 'usePipelineCriticalLoadRetry');
  // Read the actual Screen options as well as the extracted production hook.
  const call = productionDeclaration('components/features/pipelines/PipelinesScreen.tsx',
    node => ts.isCallExpression(node) && node.expression.getText() === 'usePipelineCriticalLoadRetry');
  const retry = evaluateProduction('const { retry } = ' + call, {
    ...dependencies, usePipelineCriticalLoadRetry,
    activeOrganizationId: access.auth.activeOrganization.organizationId,
    pipelineBoardQueryKeyId: 'synthetic-critical-recovery', pipelinesError: dependencies.pipelinesLoadingError, leadsError: undefined,
    leadsRefetchError: false,
  }, 'retry');
  cleanups.push(() => { slots.forEach(slot => slot?.cleanup?.()); access.close(); });
  return retry;
}

function handler(name, dependencies) {
  if (name === 'handleCriticalLoadRetry') return criticalRetry(dependencies);
  return evaluateProduction('const ' + productionDeclaration('components/features/pipelines/PipelinesScreen.tsx',
    node => ts.isVariableDeclaration(node) && node.name.getText() === name), { useCallback: fn => fn, ...dependencies }, name);
}

for (const status of [401, 403]) test(`critical retry actually revalidates a ${status} refetch failure and reports a persistent denial`, async () => {
  const requests = [], notices = [], busy = [];
  let denied = true;
  const retry = handler('handleCriticalLoadRetry', {
    boardAccessRevoked: true, leadsLoadingError: false, shouldLoadPipelineLeads: true,
    pipelinesLoadingError: false, leadVisibilityError: false, teamScopeError: false, selectedPipelineId: 'pipeline-a', baseStages: [{}],
    refetch: async () => { requests.push('board'); return denied ? { isError: true, error: { message: `Denied ${status}` } } : { isError: false }; },
    refetchBaseStages: () => assert.fail('Unexpected stages request'), refetchLeadVisibility: () => assert.fail('Unexpected visibility request'),
    refetchPipelines: () => assert.fail('Unexpected pipelines request'), refetchTeams: () => assert.fail('Unexpected teams request'),
    setIsRefreshing: value => busy.push(value), toast: { error: value => notices.push(value) }, getPipelineErrorMessage: error => error.message,
  });
  await retry(); assert.deepEqual(requests, ['board']); assert.match(notices[0], new RegExp(`Denied ${status}`));
  denied = false; await retry(); assert.deepEqual(requests, ['board', 'board']); assert.equal(notices.length, 1);
  assert.deepEqual(busy, [true, false, true, false]);
});

test('an exhausted pagination snapshot cannot dispatch even through a stale click handler', () => {
  handler('handleLoadMore', { selectedPipelineId: 'pipeline-a', loadMoreLeads: { isPending: false, mutate: () => assert.fail('Unexpected page request') },
    stages: [{ id: 'stage-a', has_more: false, total_lead_count: 13, leads: [{ id: 'lead-a' }] }],
    effectivePipelineFilterUser: undefined, pipelineBoardFilters: {}, getPipelineLeadPageCursor: () => assert.fail('Unexpected cursor'),
  })('stage-a');
});
