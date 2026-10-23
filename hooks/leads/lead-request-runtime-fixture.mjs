import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { QueryClient } from '@tanstack/react-query';
import { captureLeadRequestIntent } from '../../lib/lead-request-intent.ts';
import { getGlobalSignOutSessionId } from '../../lib/auth/global-sign-out.ts';
import { mergeLeadServerResponse } from '../../lib/merge-lead-server-response.ts';
import { applyScopedLeadStatusPatch } from '../../lib/pipeline-status-cache.ts';
import { canClaimQueuePool } from '../../lib/queue-pool.ts';
import { queuePoolClaimAttemptKey, reserveQueuePoolClaimAttempt } from '../../lib/queue-pool-claim-attempt.ts';
import { createUUID } from '../../lib/client-id.ts';
import { hasCachedQueuePoolClaim, queuePoolAccessVersion } from '../../lib/queue-pool-cache.ts';
import { contactImportScopeKey, createLeadImportScope } from '../../lib/lead-import-scope.ts';
import { runLeadImportBatch } from '../../lib/lead-import-batch.ts';
import { countImportDistributionOutcome, createEmptyImportDistributionSummary, resolveImportDistributionOutcome } from '../../lib/lead-distribution-outcome.ts';
import { getLeadStatusFinancialReviewMessage } from '../../lib/lead-financial-review.ts';
import { compareServerRevisions } from '../../lib/compare-server-revisions.ts';
import { captureQueryClientAccess } from '../../lib/access/query-client-access.ts';
import { manualActivityCreateInputSchema } from '../../lib/validation/manual-activities.ts';
import { parseDomainInput } from '../../lib/validation/common.ts';
import { assertLeadFinancialFields } from '../../lib/validation/lead-financial-values.ts';

export function productionDeclaration(path, predicate) {
  const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, path.endsWith('tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  let result;
  function visit(node) { if (predicate(node, source)) result = node.getText(source); ts.forEachChild(node, visit); }
  visit(source); assert.ok(result, path); return result;
}
export function evaluateProduction(source, dependencies, expression) {
  const code = ts.transpileModule(source.replace(/^export /gm, ''), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  return Function(...Object.keys(dependencies), `${code};return ${expression};`)(...Object.values(dependencies));
}
export function deferred() {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}
export const turn = () => new Promise(resolve => setImmediate(resolve));
const token = (user, sid, version = 1) => `header.${Buffer.from(JSON.stringify({ sub: user, session_id: sid, version })).toString('base64url')}.synthetic`;

export function leadHookRuntime(queryClient) {
  const client = queryClient ?? new QueryClient({ defaultOptions: { mutations: { retry: false }, queries: { retry: false, gcTime: Infinity } } });
  const auth = { activeOrganization: { organizationId: 'org-a' }, user: { id: 'actor-a' }, session: { access_token: token('actor-a', 'sid-a') } };
  const slots = []; let cursor = 0;
  const requests = [], notices = [], events = [], cachePatches = [];
  let response = async (method, args) => method === 'createLead'
    ? { leadId: 'lead-a', leadVisible: true, data: { id: 'lead-a' }, error: null }
    : method === 'updateLead' ? { data: { ...authorizedLead, ...args[1] }, error: null }
      : method === 'getLead' ? { data: authorizedLead, error: null }
        : method === 'recordFirstResponse' ? { recorded: true } : { id: 'item-a', lead_id: 'lead-a', error: null };
  const authorizedLead = { id: 'lead-a', organization_id: 'org-a', assigned_user_id: 'actor-a', team_id: null,
    can_operate: true, deal_status: 'open', updated_at: '2026-10-13T10:00:00.000001Z', tags: [] };
  const changed = (a, b) => !a || b.some((value, index) => value !== a[index]);
  const react = {
    useRef: value => { const index = cursor++; return slots[index] ??= { current: value }; },
    useState: value => { const index = cursor++; slots[index] ??= { value: typeof value === 'function' ? value() : value }; return [slots[index].value, next => { slots[index].value = typeof next === 'function' ? next(slots[index].value) : next; }]; },
    useMemo: (build, deps) => { const index = cursor++; if (changed(slots[index]?.deps, deps)) slots[index] = { deps, value: build() }; return slots[index].value; },
    useLayoutEffect: (setup, deps) => { const index = cursor++; if (changed(slots[index]?.deps, deps)) { slots[index]?.cleanup?.(); slots[index] = { deps, cleanup: setup() }; } },
  };
  const api = method => async (...args) => { requests.push({ method, args }); return response(method, args); };
  const dependencies = {
    ...react, useQueryClient: () => client, useAuth: () => auth, useMutation: options => options, useQuery: options => options,
    captureLeadRequestIntent, getGlobalSignOutSessionId, captureQueryClientAccess,
    manualActivityCreateInputSchema, parseDomainInput, assertLeadFinancialFields,
    getVimobAPIAccessTokenUserId: () => auth.user?.id ?? null,
    getVimobAPIAccessTokenSessionId: () => getGlobalSignOutSessionId(auth.session),
    enforceClientActionRateLimit() {}, getClientRateLimitMessage: () => null,
    toast: Object.fromEntries(['success', 'error', 'warning', 'info'].map(kind => [kind, text => notices.push({ kind, text })])),
    notifyLeadRealtimeChange: value => events.push(value), invalidateLeadSourceOptions() {}, invalidateTagCounts() {},
    invalidateLeadHistorySoon() {}, getErrorMessage: error => error.message, getErrorCode: error => error.code,
    appendOptimisticLeadHistoryEvent: () => 'optimistic', removeOptimisticLeadHistoryEvent() {},
    appendOptimisticHistoryEvent: (previous, event) => [...(previous ?? []), event],
    useUserPermissions: () => ({ hasPermission: () => true }),
    lostReasonSchema: { parse: value => { if (!value) throw Error('Missing reason'); return value; } },
    compareServerRevisions, formatBRLCurrencyWithDefaultDecimals: String,
    getLeadStatusFinancialReviewMessage,
    mergeLeadServerResponse,
    canClaimQueuePool, queuePoolClaimAttemptKey, reserveQueuePoolClaimAttempt, createUUID,
    hasCachedQueuePoolClaim, queuePoolAccessVersion,
    contactImportScopeKey, createLeadImportScope, runLeadImportBatch, countImportDistributionOutcome, createEmptyImportDistributionSummary, resolveImportDistributionOutcome,
    applyScopedLeadStatusPatch: (...args) => { cachePatches.push(args); return applyScopedLeadStatusPatch(...args); },
    rollbackScopedLeadStatusPatch() {}, invalidateScopedLeadStatus() {},
    VimobAPIError: class extends Error {},
    leadsAPI: Object.fromEntries(['createLead', 'addLeadTag', 'removeLeadTag', 'recordFirstResponse', 'updateLead', 'getLead', 'redistributeLeadRoundRobin', 'claimQueuePool'].map(method => [method, api(method)])),
    activitiesAPI: { create: api('activity.create') },
    leadTasksAPI: { create: api('task.create'), patch: api('task.patch'), completeCadence: api('task.complete') },
  };
  const scopeSource = productionDeclaration('hooks/leads/use-lead-request-scope.ts', node => ts.isFunctionDeclaration(node) && node.name?.text === 'useLeadRequestScope');
  dependencies.useLeadRequestScope = evaluateProduction(scopeSource, dependencies, 'useLeadRequestScope');
  const cacheSource = productionDeclaration('hooks/leads/use-lead-update-cache.ts', node => ts.isFunctionDeclaration(node) && node.name?.text === 'useLeadUpdateCache');
  dependencies.useLeadUpdateCache = evaluateProduction(cacheSource, dependencies, 'useLeadUpdateCache');
  const detailSource = productionDeclaration('hooks/leads/use-lead-detail-operation-scope.ts', node => ts.isFunctionDeclaration(node) && node.name?.text === 'useLeadDetailOperationScope');
  const detailScope = evaluateProduction(detailSource, dependencies, 'useLeadDetailOperationScope');
  const modules = new Map();
  function render(path, name) {
    if (!modules.has(path)) {
      const raw = readFileSync(path, 'utf8'); const parsed = ts.createSourceFile(path, raw, ts.ScriptTarget.Latest, true);
      const source = parsed.statements.filter(node => !ts.isImportDeclaration(node) && !ts.isExportDeclaration(node)).map(node => node.getText(parsed)).join('\n');
      const names = parsed.statements.filter(node => ts.isFunctionDeclaration(node) && node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)).map(node => node.name.text);
      const declared = new Set(parsed.statements.flatMap(node => ts.isVariableStatement(node)
        ? node.declarationList.declarations.filter(item => ts.isIdentifier(item.name)).map(item => item.name.text)
        : ts.isFunctionDeclaration(node) && node.name ? [node.name.text] : []));
      const imported = Object.fromEntries(Object.entries(dependencies).filter(([name]) => !declared.has(name)));
      modules.set(path, evaluateProduction(source, imported, `{${names.join(',')}}`));
    }
    cursor = 0; return modules.get(path)[name]();
  }
  return {
    auth, requests, notices, events, cachePatches, authorizedLead, render,
    scope: () => { cursor = 0; return dependencies.useLeadRequestScope(); },
    distributionScope: (leadId = 'lead-a') => {
      cursor = 0;
      return { request: dependencies.useLeadRequestScope(), captureResource: detailScope(leadId, auth.activeOrganization.organizationId,
        auth.user?.id, client, true, getGlobalSignOutSessionId(auth.session)) };
    },
    detailScope: (leadId = 'lead-a') => { cursor = 0; return detailScope(leadId, auth.activeOrganization.organizationId, auth.user?.id, client, true, getGlobalSignOutSessionId(auth.session)); },
    respond: callback => { response = callback; },
    switchTo: (org = 'org-a', user = 'actor-a', sid = 'sid-a', version = 1) => {
      auth.activeOrganization.organizationId = org; auth.user = user ? { id: user } : null;
      auth.session = user ? { access_token: token(user, sid, version) } : null;
    },
    client: () => client,
    unmount: () => slots.forEach(slot => slot?.cleanup?.()),
    close: () => { slots.forEach(slot => slot?.cleanup?.()); client.clear(); },
  };
}
