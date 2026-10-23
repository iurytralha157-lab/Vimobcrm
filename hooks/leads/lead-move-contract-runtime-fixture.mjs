import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { z } from 'zod';
import { captureLeadRequestIntent } from '../../lib/lead-request-intent.ts';
import { getGlobalSignOutSessionId } from '../../lib/auth/global-sign-out.ts';
import { VimobAPIError } from '../../lib/api/vimob-error.ts';
import { parseDomainInput, validateDomainResponse } from '../../lib/validation/common.ts';
import { apiLeadResponseSchema, leadMoveStageInputSchema } from '../../lib/validation/leads.ts';
import { capturePipelineMoveRevision, resolvePipelineMoveRevision, PipelineMoveRevisionConflict } from '../../lib/pipeline-move-revision.ts';
import { getPipelineBoardOrderAtForIndex } from '../../lib/pipeline-board-order.ts';
import { applyPendingPipelineMoves, clearPendingPipelineMove, findPipelineLeadLocation, registerPendingPipelineMove, restorePipelineLeadSnapshot } from '../../lib/pipeline-board-cache.ts';
import { getOptimisticPipelineMoveOutcome, getPipelineStageOutcome } from '../../lib/pipeline-stage-outcome.ts';
import { createPipelineStageSnapshot } from '../../lib/pipeline-stage-snapshot.ts';
import { mergeLeadServerResponse } from '../../lib/merge-lead-server-response.ts';
import { shouldApplyVisualPendingMove } from '../../components/features/pipelines/pipeline-screen/pending-moves.ts';
import { getOptimisticDealStatusForStage, getOptimisticAutomationDealStatusForStage, getVisualPendingMoveKey, isPipelineDealStatus, isUnsafePartialStageDrop, mergeMovedLeadResponse, shouldKeepLeadForDealStatusFilter } from '../../components/features/pipelines/pipeline-screen/model.ts';
import { mergeLeadDetailMutation } from '../../components/features/leads/lead-detail/hydrate-lead-detail.ts';
import { leadFieldOptimismRuntime } from './lead-field-optimism-runtime-fixture.mjs';
import { deferred, evaluateProduction, leadHookRuntime, productionDeclaration } from './lead-request-runtime-fixture.mjs';

export const ids = {
  org: '11111111-1111-4111-8111-111111111111', otherOrg: '22222222-2222-4222-8222-222222222222',
  actor: '33333333-3333-4333-8333-333333333333', otherActor: '44444444-4444-4444-8444-444444444444',
  lead: '55555555-5555-4555-8555-555555555555', stage: '66666666-6666-4666-8666-666666666666',
  nextStage: '77777777-7777-4777-8777-777777777777',
};
export const revision = '2026-10-17T12:00:00.123456Z';
export const moveBody = () => ({ stageId: ids.nextStage, expectedStageId: ids.stage, expectedUpdatedAt: revision,
  boardOrderAt: '2026-10-17T12:01:00.000001Z', lostReason: 'Synthetic reason' });

function moduleSource(path) {
  const parsed = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
  return parsed.statements.filter(node => !ts.isImportDeclaration(node) && !ts.isExportDeclaration(node)).map(node => node.getText(parsed)).join('\n');
}

// This evaluates the exact production domain module and API method. Only auth,
// clock and transport are deterministic adapters. No CRM request is dispatched.
export function contractAPIRuntime() {
  const state = { actor: ids.actor, sid: 'sid-a', base: 'https://synthetic-api.invalid', now: 1_792_238_400_000 };
  const requests = [];
  let beforeDispatch;
  let response = async path => path === '/v1/leads/capabilities/move-stage' ? { data: { contract: 'revision-v1' } } : { data: {
    id: ids.lead, organizationId: ids.org, canOperate: true, name: 'Synthetic lead', source: 'manual', status: 'new',
    priority: 'normal', dealStatus: 'open', reentryCount: 0, stageId: ids.nextStage,
    createdAt: revision, updatedAt: '2026-10-17T12:01:00.123456Z',
  } };
  class Clock extends Date { static now() { return state.now; } }
  const dependencies = { z, Date: Clock, VimobAPIError, parseDomainInput, validateDomainResponse,
    leadMoveStageInputSchema, apiLeadResponseSchema, captureLeadRequestIntent,
    getAPIBaseURL: () => state.base,
    getVimobAPIAccessTokenUserId: () => state.actor,
    getVimobAPIAccessTokenSessionId: () => state.sid,
    vimobAPIRequest: async (path, options) => {
      await beforeDispatch?.(path, options);
      options.onRequestStart?.();
      requests.push({ path, options }); return response(path, options);
    },
  };
  dependencies.captureCurrentLeadRequestIntent = evaluateProduction(moduleSource('lib/api/lead-request-intent.ts'), dependencies, 'captureCurrentLeadRequestIntent');
  Object.assign(dependencies, evaluateProduction(moduleSource('lib/validation/lead-move-contract.ts'), dependencies,
    '({ LEAD_MOVE_STAGE_CONTRACT, leadMoveStageCapabilitiesSchema })'));
  const contract = evaluateProduction(moduleSource('lib/api/lead-move-contract.ts'), dependencies,
    '({ getLeadMoveStageContract, isLeadMoveStageContractCurrent, assertLeadMoveStageContractCurrent, invalidateLeadMoveStageContract, LeadMoveContractError, LEAD_MOVE_CONTRACT_FRESH_MS })');
  Object.assign(dependencies, contract);
  dependencies.toLegacyLead = value => value;
  const method = productionDeclaration('lib/api/leads.ts', node => ts.isMethodDeclaration(node) && node.name.getText() === 'moveLeadStage');
  const api = evaluateProduction(`const leadsAPI = {${method}}`, dependencies, 'leadsAPI');
  const intent = () => ({ expectedUserId: state.actor, expectedSessionId: state.sid });
  return { state, requests, contract, api, dependencies, intent,
    respond: callback => { response = callback; },
    beforeDispatch: callback => { beforeDispatch = callback; },
    proof: () => contract.getLeadMoveStageContract(ids.org, intent()),
    move: (proof, body = moveBody(), org = ids.org, requestIntent = intent()) => api.moveLeadStage(ids.lead, body, org, requestIntent, proof),
    posts: () => requests.filter(request => request.options.method === 'POST'),
  };
}

const uiDependencies = {
  ts, QueryObserver, deferred, leadHookRuntime, productionDeclaration,
  captureLeadRequestIntent, getGlobalSignOutSessionId, capturePipelineMoveRevision, resolvePipelineMoveRevision, PipelineMoveRevisionConflict,
  getPipelineBoardOrderAtForIndex, applyPendingPipelineMoves, clearPendingPipelineMove, findPipelineLeadLocation,
  registerPendingPipelineMove, restorePipelineLeadSnapshot, getOptimisticPipelineMoveOutcome, createPipelineStageSnapshot,
  VimobAPIError, shouldApplyVisualPendingMove, getOptimisticDealStatusForStage, getOptimisticAutomationDealStatusForStage,
  getVisualPendingMoveKey, isPipelineDealStatus, isUnsafePartialStageDrop, mergeMovedLeadResponse, shouldKeepLeadForDealStatusFilter,
  getPipelineStageOutcome, mergeLeadServerResponse, mergeLeadDetailMutation, leadFieldOptimismRuntime,
};

// Reuse the existing real-handler fixtures, injecting only the new contract
// dependency at their AST evaluation boundary. Optimistic caches and handlers
// are production code; the preflight is controllable so negative cases can
// assert that zero optimistic writes happen before a compatible contract.
export function contractUIRuntime(kind, { contractError, pending = false, warm = false, delayDispatch = false, ...options } = {}) {
  const gate = deferred(), tokenGate = deferred(), probes = [], optimisticWrites = [], dispatches = [];
  let scopeRuntime;
  const moveContract = { getCurrent: () => warm ? { contract: 'revision-v1' } : undefined, ensureCompatible: async operation => {
    probes.push(operation);
    if (pending) return gate.promise;
    if (contractError) throw contractError;
    return { contract: 'revision-v1' };
  } };
  const path = kind === 'board' ? 'components/features/pipelines/pipeline-move-session.runtime.test.mjs'
    : 'components/features/leads/lead-detail/stage-move.runtime.test.mjs';
  const source = productionDeclaration(path, node => ts.isFunctionDeclaration(node) && node.name?.text === 'fixture');
  const adapter = evaluateProduction(source, { ...uiDependencies,
    leadHookRuntime: () => {
      const runtime = leadHookRuntime(), client = runtime.client(), write = client.setQueryData.bind(client);
      scopeRuntime = runtime;
      client.setQueryData = (key, update, ...args) => {
        const previous = client.getQueryData(key);
        const before = Array.isArray(previous) ? findPipelineLeadLocation(previous, 'lead-a') : undefined;
        const result = write(key, update, ...args);
        const next = client.getQueryData(key);
        const after = Array.isArray(next) ? findPipelineLeadLocation(next, 'lead-a') : undefined;
        if (before && after && before.stageId !== after.stageId) optimisticWrites.push({ before: before.stageId, after: after.stageId });
        return result;
      };
      return runtime;
    },
    leadFieldOptimismRuntime: options => {
      const runtime = leadFieldOptimismRuntime(options), render = runtime.render;
      runtime.render = (...args) => {
        const fields = render(...args), apply = fields.apply;
        return { ...fields, apply: receipt => { optimisticWrites.push({ receipt }); return apply(receipt); } };
      };
      return runtime;
    },
    evaluateProduction: (raw, dependencies, expression) => {
      const bindings = { ...dependencies, getPipelineBoardOrderAtForIndex, moveContract };
      if (delayDispatch && dependencies.leadsAPI?.moveLeadStage) {
        bindings.leadsAPI = { ...dependencies.leadsAPI, moveLeadStage: async (...args) => {
          await tokenGate.promise;
          args[3]?.onRequestStart?.();
          dispatches.push(args);
          return dependencies.leadsAPI.moveLeadStage(...args);
        } };
      }
      return evaluateProduction(raw, bindings, expression);
    },
  }, 'fixture');
  const ui = adapter(kind === 'board' ? { holdFirst: false, ...options } : options);
  return { ui, probes, gate, optimisticWrites, dispatches, tokenGate, runtime: scopeRuntime,
    start: () => { if (kind === 'board') { ui.start(); return ui.drop(); } return ui.move(); },
    stage: () => kind === 'board' ? findPipelineLeadLocation(ui.board(), 'lead-a')?.stageId : ui.state().localLead.stage_id,
    close: () => ui.close(),
  };
}

export function contractHookRuntime() {
  const h = contractAPIRuntime(), observers = [];
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const auth = { activeOrganization: { organizationId: ids.org }, user: { id: ids.actor }, session: null };
  let hook, generation = 0;
  const dependencies = { ...h.dependencies, ...h.contract, getGlobalSignOutSessionId,
    useAuth: () => auth, useQueryClient: () => client,
    useMemo: build => build(), useCallback: callback => callback,
    useQuery: options => {
      const observer = new QueryObserver(client, options), unsubscribe = observer.subscribe(() => undefined);
      observers.push({ observer, unsubscribe }); return observer.getCurrentResult();
    },
  };
  const adapter = evaluateProduction(moduleSource('hooks/leads/use-lead-move-contract.ts'), dependencies, 'useLeadMoveContract');
  const render = (patch = {}, enabled = true) => {
    if (Object.entries(patch).some(([key, value]) => value !== (key === 'org' ? auth.activeOrganization.organizationId : h.state[key]))) generation++;
    if ('org' in patch) auth.activeOrganization.organizationId = patch.org;
    Object.assign(h.state, Object.fromEntries(Object.entries(patch).filter(([key]) => key !== 'org')));
    auth.user = h.state.actor ? { id: h.state.actor } : null;
    auth.session = h.state.actor ? { access_token: `header.${Buffer.from(JSON.stringify({ sub: h.state.actor, session_id: h.state.sid })).toString('base64url')}.synthetic` } : null;
    hook = adapter(enabled); return hook;
  };
  render();
  return { ...h, client, render, hook: () => hook,
    operation: () => { const captured = generation; return { organizationId: auth.activeOrganization.organizationId,
      intent: h.intent(), isCurrent: () => generation === captured }; },
    close: () => { observers.forEach(({ observer, unsubscribe }) => { unsubscribe(); observer.destroy(); }); client.clear(); },
  };
}
