import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { MutationCache, MutationObserver, QueryClient } from '@tanstack/query-core';
import * as schemas from '../../lib/validation/pipelines.ts';
import * as common from '../../lib/validation/common.ts';
import { VimobAPIError, getStructuredErrorMessage } from '../../lib/api/vimob-error.ts';
import { getGlobalSignOutSessionId } from '../../lib/auth/global-sign-out.ts';
import { captureQueryClientAccess } from '../../lib/access/query-client-access.ts';
import { deferred, evaluateProduction, productionDeclaration } from '../leads/lead-request-runtime-fixture.mjs';

export const ids = { pipeline: '11111111-1111-4111-8111-111111111111', queue: '22222222-2222-4222-8222-222222222222',
  org: '33333333-3333-4333-8333-333333333333', actor: '44444444-4444-4444-8444-444444444444', otherOrg: '55555555-5555-4555-8555-555555555555' };
export const revision = 'a'.repeat(64), nextRevision = 'b'.repeat(64);
const token = (actor, sid, nonce = 0) => `header.${Buffer.from(JSON.stringify({ sub: actor, session_id: sid, nonce })).toString('base64url')}.synthetic`;

function moduleSource(path) {
  const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
  return source.statements.filter(node => !ts.isImportDeclaration(node) && !ts.isExportDeclaration(node)).map(node => node.getText(source)).join('\n');
}

// Actual API/Zod, mutation/access hooks and MutationCache scheduling. Auth and
// HTTP are synthetic; no app services, browser or operational database needed.
export function pipelineRoundRobinRuntime() {
  const globalWait = deferred(); let globalGate = false, cursor = 0, active = true, reply, failure, responsePatch;
  const slots = [], requests = [], notices = [], invalidations = [], options = [], observers = [];
  const auth = { activeOrganization: { organizationId: ids.org }, user: { id: ids.actor }, session: { access_token: token(ids.actor, 'sid-a') },
    tenantContext: { permissions: ['pipeline_manage'], enabledModules: ['crm'] }, impersonating: null };
  let server = { id: ids.pipeline, organizationId: ids.org, name: 'Synthetic pipeline', isDefault: false, isActive: true,
    position: 0, revision, createdAt: '2026-10-16T10:00:00Z', updatedAt: '2026-10-16T10:00:00Z' };
  let client = new QueryClient({ mutationCache: new MutationCache({ onMutate: () => globalGate ? globalWait.promise : undefined }),
    defaultOptions: { mutations: { retry: false }, queries: { retry: false, gcTime: Infinity } } });
  const clients = [client];
  for (const org of [ids.org, ids.otherOrg]) for (const family of ['pipelines', 'stages', 'stages-with-leads', 'filtered-stage-counts', 'round-robins']) client.setQueryData([family, org], []);
  const trackedClient = client, invalidate = client.invalidateQueries.bind(client);
  client.invalidateQueries = (filters, settings) => {
    invalidations.push({ refetchType: filters.refetchType, keys: trackedClient.getQueryCache().findAll(filters).map(query => query.queryKey) });
    return invalidate(filters, settings);
  };
  const changed = (old, next) => !old || next.some((value, index) => !Object.is(value, old[index]));
  const react = {
    useRef: value => { const index = cursor++; return slots[index] ??= { current: value }; },
    useMemo: (build, deps) => { const index = cursor++; if (changed(slots[index]?.deps, deps)) slots[index] = { deps, value: build() }; return slots[index].value; },
    useLayoutEffect: (setup, deps) => { const index = cursor++; if (changed(slots[index]?.deps, deps)) { slots[index]?.cleanup?.(); slots[index] = { deps, cleanup: setup() }; } },
  };
  const transport = async (url, input) => {
    requests.push({ url, input });
    if (failure) throw failure;
    if (input.body.expectedRevision !== server.revision) throw new VimobAPIError('Changed pipeline', { status: 409, code: 'pipeline_changed' });
    const result = { ...server, defaultRoundRobinId: input.body.roundRobinId ?? undefined, revision: nextRevision, ...responsePatch };
    if (reply) await reply.promise;
    server = result; return { data: result };
  };
  const api = evaluateProduction(moduleSource(process.env.PIPELINE_RR_API_SOURCE || 'lib/api/pipelines.ts'),
    { ...schemas, ...common, PIPELINE_READ_TIMEOUT_MS: 12000, vimobAPIRequest: transport }, 'pipelinesAPI');
  const deps = { ...react, useQueryClient: () => client, useAuth: () => auth, getGlobalSignOutSessionId, captureQueryClientAccess, VimobAPIError,
    pipelinesAPI: api, getStructuredErrorMessage,
    toast: Object.fromEntries(['success', 'error', 'warning'].map(kind => [kind, message => notices.push({ kind, message })])),
    useMutation: input => {
      options.push(input); const observer = new MutationObserver(client, input); observers.push(observer);
      return { isPending: false, mutateAsync: variables => observer.mutate(variables), mutate: variables => { void observer.mutate(variables).catch(() => {}); } };
    } };
  deps.usePipelineMutationIntent = evaluateProduction(moduleSource('hooks/pipelines/use-stage-delete-intent.ts'), deps, 'usePipelineMutationIntent');
  const hook = evaluateProduction(moduleSource(process.env.PIPELINE_RR_HOOK_SOURCE || 'hooks/use-pipeline-round-robin.ts'), deps, 'useUpdatePipelineRoundRobin');
  const render = patch => {
    if (!active) throw Error('Fixture unmounted');
    if (patch) {
      if ('org' in patch) auth.activeOrganization.organizationId = patch.org;
      if ('actor' in patch) auth.user = { id: patch.actor };
      if ('sid' in patch || 'actor' in patch || 'nonce' in patch) auth.session = { access_token: token(auth.user.id, patch.sid ?? getGlobalSignOutSessionId(auth.session), patch.nonce ?? 0) };
      if ('allowed' in patch) auth.tenantContext = { ...auth.tenantContext, permissions: patch.allowed ? ['pipeline_manage'] : [] };
    }
    cursor = 0; return hook();
  };
  const unmount = () => { active = false; slots.forEach(slot => slot?.cleanup?.()); };
  return { client, api, ids, requests, notices, invalidations, options, render, auth,
    input: () => ({ pipelineId: ids.pipeline, roundRobinId: ids.queue, expectedRevision: revision }),
    server: () => server, patchServer: patch => { server = { ...server, ...patch }; },
    fail: error => { failure = error; }, patchResponse: patch => { responsePatch = patch; },
    waitGlobal: () => { globalGate = true; }, releaseGlobal: () => globalWait.resolve(), deferReply: () => reply = deferred(),
    manager: dependencies => evaluateProduction('const ' + productionDeclaration('components/features/round-robin/PipelineRoundRobinManager.tsx',
      node => ts.isVariableDeclaration(node) && node.name.getText() === 'handleChange'),
      { ...deps, pipelineRevisionSchema: schemas.pipelineRevisionSchema, updatePipelineRR: render(), ...dependencies }, 'handleChange'),
    replaceClient: () => { client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity }, mutations: { retry: false } } }); clients.push(client); },
    unmount, close: () => { if (active) unmount(); observers.forEach(observer => observer.reset()); clients.forEach(item => item.clear()); },
  };
}
