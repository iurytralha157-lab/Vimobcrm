import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import ts from 'typescript';
import { QueryClient, QueryObserver, MutationObserver } from '@tanstack/query-core';
import { compareServerRevisions } from '../../lib/compare-server-revisions.ts';
import { canOperateLeadFromFreshRead } from '../../lib/lead-operation-capability.ts';
import { canReuseLeadReadOnMount, matchesVerifiedLeadReadScope } from '../../lib/lead-read-snapshot.ts';
import { handlePipelineSelectedLeadAccessFailure } from '../../lib/pipeline-selected-lead-access.ts';
import { isDefinitiveLeadReadDenial } from '../../lib/lead-read-access.ts';
import { getGlobalSignOutSessionId } from '../../lib/auth/global-sign-out.ts';
import { deferred, evaluateProduction, productionDeclaration, leadHookRuntime, turn } from '../leads/lead-request-runtime-fixture.mjs';

const consistency = existsSync('lib/lead-read-consistency.ts') ? await import('../../lib/lead-read-consistency.ts') : {};
export const revisions = ['2026-10-16T10:00:00.000001Z', '2026-10-16T10:00:00.000002Z', '2026-10-16T10:00:00.000003Z'];
export const leadSnapshot = (patch = {}) => ({ id: 'lead-a', organization_id: 'org-a', assigned_user_id: 'actor-a',
  team_id: 'team-a', can_operate: true, updated_at: revisions[0], deal_status: 'open', first_response_at: null, ...patch });
const token = (actor, sid) => `header.${Buffer.from(JSON.stringify({ sub: actor, session_id: sid })).toString('base64url')}.synthetic`;
const declaration = (path, name) => productionDeclaration(path, node => ts.isFunctionDeclaration(node) && node.name?.text === name);
const screenScopeSource = 'const ' + productionDeclaration('components/features/pipelines/PipelinesScreen.tsx',
  node => ts.isVariableDeclaration(node) && node.name.getText() === 'visibilityScopeKey');

// Actual read hooks and consistency/capability policies; actual QueryCore
// cancellation, cache and mutation callbacks. Only React lifecycle/auth/HTTP
// are deterministic in memory. No browser, database or application service.
export function pipelineLeadReadRaceRuntime() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: 600_000,
    refetchOnMount: false, refetchOnWindowFocus: false }, mutations: { retry: false } } });
  const firstRuntime = leadHookRuntime(client);
  const auth = { activeOrganization: { organizationId: 'org-a' }, user: { id: 'actor-a' },
    session: { access_token: token('actor-a', 'sid-a') }, tenantContext: { permissions: ['lead_operate'], enabledModules: ['crm'] } };
  const slots = [], requests = [], detailRequests = [], writes = [], subscriptions = [], mutationObservers = [];
  let cursor = 0, mounted = true, accessObserver, accessResult, detailObserver, server = leadSnapshot();
  let deferredDetails = false;
  const screenScopeKey = () => evaluateProduction(screenScopeSource, {
    useMemo: build => build(), profile: { id: auth.user.id }, user: auth.user,
    selectedLeadSessionId: getGlobalSignOutSessionId(auth.session),
    leadVisibility: { canViewAll: false }, scopedVisibleUserIds: auth.tenantContext.permissions.length ? [auth.user.id] : [],
    tenantContext: { ledTeamIds: [] },
  }, 'visibilityScopeKey');
  let params = { organizationId: 'org-a', leadId: 'lead-a', selectionVersion: 1, visibilityScopeKey: screenScopeKey(), enabled: true };
  const changed = (old, next) => !old || next.some((value, index) => !Object.is(value, old[index]));
  const react = {
    useRef: value => { const index = cursor++; return slots[index] ??= { current: value }; },
    useMemo: (build, deps) => { const index = cursor++; if (changed(slots[index]?.deps, deps)) slots[index] = { deps, value: build() }; return slots[index].value; },
    useLayoutEffect: (setup, deps) => { const index = cursor++; if (changed(slots[index]?.deps, deps)) { slots[index]?.cleanup?.(); slots[index] = { deps, cleanup: setup() }; } },
    useState: initial => { const index = cursor++; slots[index] ??= { value: typeof initial === 'function' ? initial() : initial };
      return [slots[index].value, value => { slots[index].value = typeof value === 'function' ? value(slots[index].value) : value; }]; },
  };
  react.useEffect = react.useLayoutEffect;
  react.useCallback = (callback, deps) => react.useMemo(() => callback, deps);
  const queryRead = kind => async (id, organizationId, signal, intent) => {
    if (kind === 'detail' && !deferredDetails) return { data: structuredClone(server), error: null };
    const reply = deferred();
    const list = kind === 'detail' ? detailRequests : requests;
    const request = { kind, id, organizationId, signal, intent, reply, settled: false, index: list.length };
    list.push(request);
    // The transport deliberately ignores AbortSignal. Production must still
    // reject a response whose selection/access was retired while awaiting it.
    return await reply.promise;
  };
  const common = { ...react, ...consistency, compareServerRevisions, canReuseLeadReadOnMount, isDefinitiveLeadReadDenial,
    getGlobalSignOutSessionId, useAuth: () => auth, useQueryClient: () => client,
    getVimobAPIAccessTokenUserId: () => auth.user?.id ?? null,
    getVimobAPIAccessTokenSessionId: () => getGlobalSignOutSessionId(auth.session),
    useUserPermissions: () => ({ hasPermission: () => auth.tenantContext.permissions.includes('lead_operate') }),
  };
  const accessHook = evaluateProduction(declaration(process.env.PIPELINE_SELECTED_ACCESS_SOURCE || 'hooks/pipelines/use-selected-lead-access.ts', 'useSelectedPipelineLeadAccess'), {
    ...common, leadsAPI: { getLead: queryRead('access') },
    useQuery: options => {
      if (!accessObserver) {
        accessObserver = new QueryObserver(client, options);
        subscriptions.push(accessObserver.subscribe(() => {}));
      } else accessObserver.setOptions(options);
      return { ...accessObserver.getCurrentResult(), refetch: settings => accessObserver.refetch(settings) };
    },
  }, 'useSelectedPipelineLeadAccess');
  const detailHook = evaluateProduction(declaration(process.env.PIPELINE_LEAD_READ_SOURCE || 'hooks/use-leads.ts', 'useLead'), {
    ...common, leadsAPI: { getLead: queryRead('detail') }, useQuery: options => options,
  }, 'useLead');
  const cacheKey = (org = 'org-a', id = 'lead-a') => ['lead', org, id];
  subscriptions.push(client.getQueryCache().subscribe(event => {
    if (event.type === 'updated' && event.action.type === 'success' && event.query.queryKey[0] === 'lead') {
      writes.push({ key: event.query.queryKey, data: event.query.state.data });
    }
  }));
  const render = (patch = {}) => {
    assert(mounted, 'fixture already unmounted');
    if ('org' in patch) { auth.activeOrganization.organizationId = patch.org; params.organizationId = patch.org; }
    if ('actor' in patch) auth.user = { id: patch.actor };
    if ('actor' in patch || 'sid' in patch) auth.session = { access_token: token(auth.user.id, patch.sid ?? getGlobalSignOutSessionId(auth.session)) };
    if ('allowed' in patch) auth.tenantContext.permissions = patch.allowed ? ['lead_operate'] : [];
    if (['actor', 'sid', 'allowed'].some(key => key in patch)) params.visibilityScopeKey = screenScopeKey();
    params = { ...params, ...Object.fromEntries(Object.entries(patch).filter(([key]) => key in params)) };
    cursor = 0; accessResult = accessHook(params); return accessResult;
  };
  const result = () => { cursor = 0; accessResult = accessHook(params); return accessResult; };
  const resolve = (request, data) => { request.settled = true; request.reply.resolve({ data, error: null }); };
  const reject = (request, status) => { request.settled = true; request.reply.reject(Object.assign(new Error('Synthetic denied read'), { status })); };
  const drainAccess = async data => {
    for (let count = 0; count < 24; count++) {
      for (const request of requests.filter(item => !item.settled)) resolve(request, typeof data === 'function' ? data(request) : data);
      await turn();
      if (accessObserver?.getCurrentResult().fetchStatus === 'idle') return result();
    }
    assert.fail('access read did not settle after bounded replies');
  };
  const drainDetail = async data => {
    for (let count = 0; count < 24; count++) {
      for (const request of detailRequests.filter(item => !item.settled)) resolve(request, typeof data === 'function' ? data(request) : data);
      await turn();
      if (detailObserver?.getCurrentResult().fetchStatus === 'idle') return detailObserver.getCurrentResult();
    }
    assert.fail('detail read did not settle after bounded replies');
  };
  const openDetail = verifiedRead => {
    const options = detailHook('lead-a', { freshOnMount: true, verifiedRead });
    detailObserver = new QueryObserver(client, options);
    subscriptions.push(detailObserver.subscribe(() => {}));
    return detailObserver;
  };
  const verifiedRead = data => ({ data, organizationId: data.organization_id, selectionVersion: params.selectionVersion,
    visibilityScopeKey: params.visibilityScopeKey, confirmedAt: client.getQueryState(cacheKey(data.organization_id, data.id))?.dataUpdatedAt || Date.now() });
  const canOperate = () => {
    const access = result();
    const verified = access.isSuccess && !access.isError && matchesVerifiedLeadReadScope(access.data, params) ? access.data : undefined;
    const cached = client.getQueryState(cacheKey(params.organizationId, params.leadId));
    return Boolean(verified && !access.isFetching && canOperateLeadFromFreshRead(auth.tenantContext.permissions.includes('lead_operate'), {
      isSuccess: cached?.status === 'success', isFetchedAfterMount: false, isFetching: cached?.fetchStatus === 'fetching',
      data: cached?.data, dataUpdatedAt: cached?.dataUpdatedAt,
    }, verified));
  };
  const recordFirstResponse = async (saved, wait = deferred()) => {
    firstRuntime.respond(async (method) => {
      assert.equal(method, 'recordFirstResponse'); await wait.promise; server = saved; return { recorded: true };
    });
    const options = firstRuntime.render('hooks/use-first-response.ts', 'useRecordFirstResponse');
    const observer = new MutationObserver(client, options); mutationObservers.push(observer);
    const pending = observer.mutate({ leadId: 'lead-a', organizationId: 'org-a', channel: 'phone', actorUserId: 'actor-a' });
    for (let count = 0; count < 12 && firstRuntime.requests.length === 0; count++) await turn();
    assert.equal(firstRuntime.requests.length, 1);
    return { pending, release: () => wait.resolve() };
  };
  return { client, auth, requests, detailRequests, writes, render, result, resolve, reject, drainAccess, drainDetail, cacheKey, canOperate, openDetail,
    verifiedRead, recordFirstResponse, firstEvents: firstRuntime.events,
    deferDetails: () => { deferredDetails = true; }, detailRefetch: () => detailObserver.refetch(), detailResult: () => detailObserver.getCurrentResult(),
    seed: data => client.setQueryData(cacheKey(data.organization_id, data.id), data),
    read: (org, id) => client.getQueryData(cacheKey(org, id)), server: data => { server = data; },
    refetch: () => accessObserver.refetch(),
    denyConsumer: status => handlePipelineSelectedLeadAccessFailure({ queryClient: client, organizationId: params.organizationId,
      leadId: params.leadId, status, closeDetail() {} }),
    unmount: () => { mounted = false; slots.forEach(slot => slot?.cleanup?.()); subscriptions.splice(0).forEach(off => off()); },
    close() { if (mounted) this.unmount(); mutationObservers.forEach(observer => observer.reset()); firstRuntime.close(); client.clear(); },
  };
}
