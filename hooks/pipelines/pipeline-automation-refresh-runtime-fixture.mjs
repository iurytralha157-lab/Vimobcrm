import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { QueryClient, QueryObserver } from '@tanstack/query-core';
import { leadHookRuntime } from '../leads/lead-request-runtime-fixture.mjs';

const screenPath = process.env.PIPELINE_AUTOMATION_REFRESH_SCREEN_SOURCE || 'components/features/pipelines/PipelinesScreen.tsx';
const parse = file => ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true,
  file.endsWith('tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
function declaration(file, predicate) {
  const source = parse(file); let found;
  const visit = node => { if (predicate(node, source)) found = node.getText(source); ts.forEachChild(node, visit); };
  visit(source); assert(found, `missing production declaration in ${file}`); return found;
}
function functions(file, names) {
  const selected = new Set(names);
  const result = parse(file).statements.filter(node => ts.isFunctionDeclaration(node) && selected.has(node.name?.text));
  assert.equal(result.length, selected.size, `missing production functions in ${file}`);
  return result.map(node => node.getText()).join('\n');
}
function evaluate(source, dependencies, expression) {
  const code = ts.transpileModule(source.replace(/^export /gm, ''), { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None,
  } }).outputText;
  return Function(...Object.keys(dependencies), `${code};return ${expression};`)(...Object.values(dependencies));
}
const queryKey = evaluate(functions('lib/stage-automations-query-key.ts', ['stageAutomationsQueryKey']), {}, 'stageAutomationsQueryKey');
const accessSource = parse('lib/access/tenant-query-cache.ts').statements.map(node => node.getText()).join('\n');
const accessSignature = evaluate(accessSource, {}, 'createTenantQueryAccessSignature');
const modulesSource = declaration('config/constants.ts', node => ts.isVariableDeclaration(node) && node.name.getText() === 'SYSTEM_MODULES');
const systemModules = evaluate(`const ${modulesSource};`, {}, 'SYSTEM_MODULES');
const navigation = evaluate(functions('lib/access/tenant-navigation.ts', [
  'isTenantContextForOrganization', 'getTenantEnabledModules', 'getTenantPermissions',
]), { SYSTEM_MODULE_KEYS: new Set(systemModules.map(module => module.key)) },
'({isTenantContextForOrganization,getTenantEnabledModules,getTenantPermissions})');
const automationSource = functions('hooks/use-stage-automations.ts', [
  'isRecord', 'asString', 'asNumber', 'normalizeAutomation', 'selectStageAutomationRows', 'useStageAutomations', 'useStageAutomationList',
]);
const normalize = evaluate(functions('hooks/use-stage-automations.ts', ['isRecord', 'asString', 'asNumber', 'normalizeAutomation']), {}, 'normalizeAutomation');
const outcomeSource = parse('lib/pipeline-stage-outcome.ts').statements.map(node => node.getText()).join('\n');
const getPipelineStageOutcome = evaluate(outcomeSource, {}, 'getPipelineStageOutcome');
const outcome = evaluate(functions('components/features/pipelines/pipeline-screen/model.ts', [
  'getOptimisticAutomationDealStatusForStage',
]), { getPipelineStageOutcome }, 'getOptimisticAutomationDealStatusForStage');
const manualSource = `const ${declaration(screenPath, node => ts.isVariableDeclaration(node) && node.name.getText() === 'handleManualRefresh')};`;
const visibleSource = declaration(screenPath, (node, source) => ts.isCallExpression(node) &&
  node.expression.getText(source) === 'useEffect' && node.arguments[0]?.getText(source).includes('const reconcileVisibleBoard ='));
const automationBinding = `const ${declaration(screenPath, (node, source) => ts.isVariableDeclaration(node) &&
  node.initializer && ts.isCallExpression(node.initializer) && node.initializer.expression.getText(source) === 'useStageAutomations')};`;
const sameDependencies = (previous, next) => previous && previous.length === next.length && next.every((value, index) => Object.is(value, previous[index]));
const turn = () => new Promise(resolve => setTimeout(resolve, 0));
const rawAutomation = (status, org = 'org-a') => ({ id: 'rule-a', stage_id: 'stage-a', organization_id: org,
  trigger_type: 'on_enter', is_active: true, created_at: '2026-10-16T10:00:00Z', updated_at: '2026-10-16T11:00:00Z',
  config: { automation_type: 'change_deal_status_on_enter', action_type: 'change_deal_status_on_enter', action_config: { deal_status: status } } });

// Actual hook, key, authorization, normalization, outcome and Screen callbacks.
// QueryClient/QueryObserver own all cache/refetch behavior. Only Auth/transport,
// DOM events and clock/timer delivery are synthetic; no network or services run.
export function pipelineAutomationRefreshRuntime({ allowed = true, modules = ['crm', 'automations'], tenantOrg = 'org-a', org = 'org-a' } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: {
    retry: false, gcTime: Infinity, refetchOnMount: false, refetchOnWindowFocus: false,
  } } });
  const auth = { activeOrganization: { organizationId: org }, user: { id: 'actor-a' }, profile: { id: 'actor-a' },
    isSuperAdmin: false, impersonating: null, tenantContext: { organizationId: tenantOrg, memberRole: 'user',
      permissions: allowed ? ['automations_view'] : [], enabledModules: modules, isSuperAdmin: false } };
  const requests = [], notices = [], refreshing = [], referenceReads = [], window = new EventTarget(), document = new EventTarget();
  const access = leadHookRuntime(client), refreshSlots = [];
  let refreshCursor = 0;
  const refreshHooks = {
    useQueryClient: () => client,
    useLeadRequestScope: () => { access.switchTo(auth.activeOrganization.organizationId); return access.scope(); },
    useCallback: fn => fn,
    useRef: value => { const index = refreshCursor++; return refreshSlots[index] ??= { current: value }; },
    useMemo: (build, deps) => { const index = refreshCursor++; if (!sameDependencies(refreshSlots[index]?.deps, deps)) refreshSlots[index] = { deps, value: build() }; return refreshSlots[index].value; },
    useLayoutEffect: (setup, deps) => { const index = refreshCursor++; if (!sameDependencies(refreshSlots[index]?.deps, deps)) { refreshSlots[index]?.cleanup?.(); refreshSlots[index] = { deps, cleanup: setup() }; } },
    useState: value => { const index = refreshCursor++; refreshSlots[index] ??= { value }; return [refreshSlots[index].value, next => { refreshSlots[index].value = next; refreshing.push(next !== null); }]; },
  };
  refreshHooks.usePipelineEditorVisit = evaluate(functions('hooks/pipelines/use-pipeline-editor-visit.ts', ['usePipelineEditorVisit']), refreshHooks, 'usePipelineEditorVisit');
  const refreshHook = evaluate(functions('hooks/pipelines/use-pipeline-refresh.ts', ['usePipelineRefresh']), refreshHooks, 'usePipelineRefresh');
  document.visibilityState = 'visible';
  let serverStatus = 'lost', failure, observer, unsubscribe, options, query, now = 0, manual, callback, effect, intervalCursor = 0;
  const intervals = new Map();
  window.setInterval = (run, delay) => { const id = ++intervalCursor; intervals.set(id, { run, delay }); return id; };
  window.clearInterval = id => intervals.delete(id);
  const read = name => async () => { referenceReads.push(name); return { isError: false, data: [] }; };
  const referenceFunctions = Object.fromEntries(['refetch', 'refetchPipelines', 'refetchLeadVisibility', 'refetchTeams',
    'refetchLeadMetaFilters', 'refetchTags', 'refetchBaseStages'].map(name => [name, read(name)]));
  const hook = evaluate(automationSource, {
    ...navigation, stageAutomationsQueryKey: queryKey, createTenantQueryAccessSignature: accessSignature,
    useAuth: () => auth,
    stageConfigAPI: { listStageAutomations: async input => {
      requests.push(input); if (failure) throw failure; return { rows: [rawAutomation(serverStatus, input.organizationId)] };
    } },
    useQuery: input => {
      options = input;
      if (!client.getQueryState(input.queryKey)) client.setQueryData(input.queryKey, { rows: [normalize(rawAutomation('lost', input.queryKey[2]))] });
      if (!observer) { observer = new QueryObserver(client, input); unsubscribe = observer.subscribe(() => {}); }
      else observer.setOptions(input);
      return observer.getCurrentResult();
    },
  }, 'useStageAutomations');
  const dependencies = () => ({
    ...referenceFunctions, selectedPipelineId: 'pipeline-a', activeOrganizationId: auth.activeOrganization.organizationId,
    sharedFilters: { teamId: null }, shouldLoadFilterOptions: false, shouldLoadPipelineLeads: true,
    useStageAutomations: () => query,
    setIsRefreshing: value => refreshing.push(value), getPipelineErrorMessage: error => error?.message ?? String(error),
    toast: Object.fromEntries(['success', 'error'].map(kind => [kind, message => notices.push({ kind, message })])),
    useCallback: (fn, deps) => {
      if (!sameDependencies(callback?.deps, deps)) callback = { deps, value: fn };
      return callback.value;
    },
    useEffect: (setup, deps) => {
      if (!sameDependencies(effect?.deps, deps)) { effect?.cleanup?.(); effect = { deps, cleanup: setup() }; }
    },
    window, document, Date: { now: () => now },
  });
  function render(patch = {}) {
    if ('allowed' in patch) auth.tenantContext = { ...auth.tenantContext, permissions: patch.allowed ? ['automations_view'] : [] };
    if ('org' in patch) auth.activeOrganization = { organizationId: patch.org };
    if ('tenantOrg' in patch) auth.tenantContext = { ...auth.tenantContext, organizationId: patch.tenantOrg };
    if ('modules' in patch) auth.tenantContext = { ...auth.tenantContext, enabledModules: patch.modules };
    query = hook();
    const deps = dependencies();
    refreshCursor = 0;
    deps.runPipelineRefresh = refreshHook(JSON.stringify(options.queryKey)).run;
    manual = evaluate(`${automationBinding}\n${manualSource}\n${visibleSource};`, deps, 'handleManualRefresh');
    return query;
  }
  const keyFor = (organizationId, userId) => queryKey(undefined, organizationId, userId, accessSignature({
    userId, organizationId, memberRole: 'user', permissions: ['automations_view'], enabledModules: ['crm', 'automations'], isSuperAdmin: false,
  }));
  const sentinels = [keyFor('org-b', 'actor-a'), keyFor('org-a', 'actor-b')];
  for (const key of sentinels) client.setQueryData(key, { rows: [normalize(rawAutomation('lost', key[2]))] });
  render();
  const settled = async () => { for (let index = 0; index < 3 || observer.getCurrentResult().isFetching; index++) {
    assert(index < 30, 'synthetic refetch did not settle'); await turn();
  } render(); };
  return {
    client, auth, requests, notices, refreshing, referenceReads, render,
    query: () => observer.getCurrentResult(), options: () => options,
    outcome: () => outcome(observer.getCurrentResult().data, 'stage-a'),
    setServerStatus: status => { serverStatus = status; }, fail: error => { failure = error; },
    manual: async () => { await manual(); await settled(); },
    automatic: async (event, elapsed = 61_000) => {
      now += elapsed;
      if (event === 'interval') for (const interval of [...intervals.values()]) interval.run();
      else (event === 'visibilitychange' ? document : window).dispatchEvent(new Event(event));
      await settled();
    },
    visible: value => { document.visibilityState = value ? 'visible' : 'hidden'; },
    intervalDelays: () => [...intervals.values()].map(interval => interval.delay),
    sentinels: () => structuredClone(sentinels.map(key => ({ key, data: client.getQueryData(key),
      invalidated: client.getQueryState(key).isInvalidated, updatedAt: client.getQueryState(key).dataUpdatedAt }))),
    close: () => { refreshSlots.forEach(slot => slot?.cleanup?.()); access.close(); effect?.cleanup?.(); unsubscribe?.(); observer?.destroy(); client.clear(); },
  };
}
