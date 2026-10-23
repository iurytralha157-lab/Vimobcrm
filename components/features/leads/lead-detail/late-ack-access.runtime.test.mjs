import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { deferred, evaluateProduction, productionDeclaration, turn } from '../../../../hooks/leads/lead-request-runtime-fixture.mjs';
import { leadFieldOptimismRuntime } from '../../../../hooks/leads/lead-field-optimism-runtime-fixture.mjs';
import { captureLeadRequestIntent } from '../../../../lib/lead-request-intent.ts';
import { getGlobalSignOutSessionId } from '../../../../lib/auth/global-sign-out.ts';
import { capturePipelineMoveRevision } from '../../../../lib/pipeline-move-revision.ts';
import { mergeLeadServerResponse } from '../../../../lib/merge-lead-server-response.ts';
import { mergeLeadOperationCapability } from '../../../../lib/lead-operation-capability.ts';
import { applyScopedLeadStatusPatch, rollbackScopedLeadStatusPatch } from '../../../../lib/pipeline-status-cache.ts';
import { mergeLeadDetailMutation } from './hydrate-lead-detail.ts';
import { VimobAPIError } from '../../../../lib/api/vimob-error.ts';
import { activateQueryClientAccess, captureQueryClientAccess } from '../../../../lib/access/query-client-access.ts';

const detailSource = process.env.PIPELINE_DETAIL_SOURCE || 'components/features/leads/LeadDetailDialog.tsx';
const token = (actor, sid, version = 1) => `synthetic.${Buffer.from(JSON.stringify({ sub: actor, session_id: sid, version })).toString('base64url')}.signature`;
const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } } });

// Run the production request/detail/cache hooks together. Effect cleanup models
// close; a changed dependency models a new visit, including A -> B -> A.
function scopes(initialClient, events) {
  let client = initialClient, auth = { activeOrganization: { organizationId: 'org-a' }, user: { id: 'actor-a' }, session: { access_token: token('actor-a', 'sid-a') } };
  let cursor = 0;
  let retireProvider = activateQueryClientAccess(client);
  const retirements = [retireProvider];
  const slots = [], clients = new Set([client]);
  const changed = (old, next) => !old || next.some((value, index) => !Object.is(value, old[index]));
  const react = {
    useRef: value => { const i = cursor++; return slots[i] ??= { current: value }; },
    useMemo: (build, deps) => { const i = cursor++; if (changed(slots[i]?.deps, deps)) slots[i] = { deps, value: build() }; return slots[i].value; },
    useLayoutEffect: (setup, deps) => { const i = cursor++; if (changed(slots[i]?.deps, deps)) { slots[i]?.cleanup?.(); slots[i] = { deps, cleanup: setup() }; } },
  };
  const dependencies = { ...react, useAuth: () => auth, useQueryClient: () => client, captureLeadRequestIntent, getGlobalSignOutSessionId, captureQueryClientAccess,
    getVimobAPIAccessTokenUserId: () => auth.user?.id ?? null, getVimobAPIAccessTokenSessionId: () => getGlobalSignOutSessionId(auth.session),
    applyScopedLeadStatusPatch, rollbackScopedLeadStatusPatch, rollbackBySnapshot: new WeakMap(), notifyLeadRealtimeChange: event => events.push(event) };
  const load = (path, name) => evaluateProduction(productionDeclaration(path, node => ts.isFunctionDeclaration(node) && node.name?.text === name), dependencies, name);
  const request = load('hooks/leads/use-lead-request-scope.ts', 'useLeadRequestScope');
  const detail = load('hooks/leads/use-lead-detail-operation-scope.ts', 'useLeadDetailOperationScope');
  const cache = load('components/features/leads/lead-detail/use-lead-detail-pipeline-cache.ts', 'useLeadDetailPipelineCache');
  return {
    render: (leadId = 'lead-a') => { cursor = 0; return { requestScope: request(),
      captureDetailOperation: detail(leadId, auth.activeOrganization.organizationId, auth.user?.id, client, true, getGlobalSignOutSessionId(auth.session)), ...cache() }; },
    replace: ({ org = auth.activeOrganization.organizationId, actor = auth.user?.id, sid = getGlobalSignOutSessionId(auth.session), version = 1, replacementClient = client } = {}) => {
      client = replacementClient; clients.add(client);
      auth = { activeOrganization: { organizationId: org }, user: actor ? { id: actor } : null, session: actor ? { access_token: token(actor, sid, version) } : null };
    },
    auth: () => auth, client: () => client,
    retireProvider: () => retireProvider(),
    renewProvider: () => { retireProvider(); retireProvider = activateQueryClientAccess(client); retirements.push(retireProvider); },
    unmount: () => slots.forEach(slot => slot?.cleanup?.()),
    dispose: () => { slots.forEach(slot => slot?.cleanup?.()); retirements.forEach(retire => retire()); clients.forEach(value => value.clear()); },
  };
}

function fixture(kind, { waitForAvailability = false, waitForRequestStart = false } = {}) {
  const client = newClient(), events = [], requests = [], notices = [], cacheCalls = [], restores = [];
  const life = scopes(client, events), reply = deferred(), availability = deferred();
  const requestStart = deferred(), observers = [];
  const lead = { id: 'lead-a', organization_id: 'org-a', name: 'Synthetic A', can_operate: true, tags: [],
    assigned_user_id: 'actor-a', assignee: { id: 'actor-a', name: 'Synthetic A' }, deal_status: 'open',
    stage_id: 'stage-a', updated_at: '2026-10-19T10:00:00.000001Z' };
  let localLead = { ...lead }, updating = false, closed = false;
  const key = ['lead', 'org-a', lead.id], boardKey = ['stages-with-leads', 'org-a', 'pipeline-a'];
  client.setQueryData(key, lead); client.setQueryData(boardKey, [{ id: 'stage-a', leads: [lead] }, { id: 'stage-b', leads: [] }]);
  const setLocalLead = value => { localLead = typeof value === 'function' ? value(localLead) : value; };
  const fields = leadFieldOptimismRuntime({ client, lead, getLead: () => localLead, setLead: setLocalLead });
  const dependencies = {
    lead, activeOrganization: life.auth().activeOrganization, user: life.auth().user, session: life.auth().session,
    captureLeadRequestIntent, getGlobalSignOutSessionId, capturePipelineMoveRevision, mergeLeadServerResponse, mergeLeadDetailMutation, mergeLeadOperationCapability,
    VimobAPIError, getErrorMessage: error => error.message, queryClient: client, fieldOptimism: fields.render(), isDefiniteLeadFieldRejection: fields.isDefiniteLeadFieldRejection,
    canTransferLead: true, canUnassignLead: true, canOperateLead: true, assignableUsers: [{ id: 'actor-b', name: 'Synthetic B' }],
    teams: waitForAvailability ? [{ members: [{ id: 'member-b', user_id: 'actor-b' }] }] : [],
    loadAssigneeAvailability: () => availability.promise, getLeadAssigneeAvailability: () => ({ available: true, today: null }),
    assigneeUpdatingRef: { current: false }, assigneeSelectionRef: { current: null }, stageMovePendingRef: { current: false }, statusSubmittingRef: { current: false },
    setLocalLead, setIsUpdatingAssignee: value => { updating = value; }, setAssigneePopoverOpen() {}, setAssigneeScheduleConfirmation() {},
    setStageMovePending() {}, setPendingLostStageMove() {}, setLostReasonDialogOpen() {}, handleCloseLeadDetail: () => { closed = true; },
    fullLeadQuery: { refetch: async () => undefined }, getLeadStatusFinancialReviewMessage: () => null,
    toast: Object.fromEntries(['success', 'error', 'warning'].map(name => [name, value => notices.push([name, value])])),
    stages: [{ id: 'stage-a' }, { id: 'stage-b' }], moveContract: { getCurrent: () => ({ contract: 'revision-v1' }) },
    leadsAPI: Object.fromEntries(['assignLead', 'moveLeadStage'].map(name => [name, async (...args) => {
      // The server may persist before cancellation. Intentionally deliver its
      // late ACK even when the request signal has since been aborted.
      const intent = args[3];
      if (waitForRequestStart) await requestStart.promise;
      intent?.onRequestStart?.(); requests.push({ name, args }); return reply.promise;
    }])),
  };
  function render(leadId = localLead.id) {
    const current = life.render(leadId); Object.assign(dependencies, current);
    for (const name of ['updatePipelineLeadCache', 'updatePipelineAssigneeCache', 'refreshPipelineInBackground']) {
      dependencies[name] = (...args) => { cacheCalls.push(name); return current[name](...args); };
    }
    dependencies.restorePipelineCache = (...args) => { restores.push(args); return current.restorePipelineCache(...args); };
    dependencies.fieldOptimism = fields.render({ leadId, organizationId: life.auth().activeOrganization.organizationId,
      actorId: life.auth().user?.id, sessionId: getGlobalSignOutSessionId(life.auth().session), client: life.client() });
  }
  render();
  const handler = name => evaluateProduction('const ' + productionDeclaration(detailSource,
    node => ts.isVariableDeclaration(node) && node.name.getText() === name), { ...dependencies, localLead, isUpdatingAssignee: updating }, name);
  return {
    client, key, boardKey, lead, events, requests, notices, cacheCalls, restores,
    start: () => kind === 'assignment' ? handler('handleAssignUser')('actor-b') : handler('persistMoveToStage')(handler('captureStageMove')('stage-b')),
    captureMove: () => handler('captureStageMove')('stage-b'), persistMove: move => handler('persistMoveToStage')(move),
    resolve: (patch = {}) => reply.resolve({ data: { ...lead, assigned_user_id: kind === 'assignment' ? 'actor-b' : 'actor-a',
      stage_id: kind === 'stage' ? 'stage-b' : 'stage-a', updated_at: '2026-10-19T10:01:00.000001Z', ...patch }, error: null }),
    reject: (error = new VimobAPIError('Synthetic denied', { status: 403 })) => reply.reject(error),
    releaseRequestStart: () => requestStart.resolve(),
    allowAvailability: () => availability.resolve([]),
    replace: (options, nextLead) => { life.replace(options); if (nextLead) localLead = nextLead; render(); },
    replaceTransportBeforeRender: options => life.replace(options),
    retireProvider: () => life.retireProvider(),
    replaceProvider: options => { life.replace(options); life.renewProvider(); },
    closePopup: () => { closed = true; life.unmount(); fields.close(); },
    state: () => ({ localLead, closed }),
    observeCanonicalReads: () => {
      const reads = { lead: 0, board: 0 };
      for (const [name, queryKey] of [['lead', key], ['board', boardKey]]) {
        const canonical = structuredClone(client.getQueryData(queryKey));
        const observer = new QueryObserver(client, { queryKey, staleTime: Infinity,
          queryFn: async () => { reads[name]++; return structuredClone(canonical); } });
        observers.push(observer.subscribe(() => undefined));
      }
      return reads;
    },
    dispose: () => { observers.forEach(unsubscribe => unsubscribe()); fields.close(); life.dispose(); },
  };
}

const retirements = {
  logout: f => f.replace({ actor: null, sid: null }),
  'SID replacement': f => f.replace({ sid: 'sid-b' }),
  'actor replacement': f => f.replace({ actor: 'actor-c' }),
  'organization replacement': f => f.replace({ org: 'org-b' }),
  'QueryClient replacement': f => f.replace({ replacementClient: newClient() }),
  'organization ABA': f => { f.replace({ org: 'org-b' }); f.replace({ org: 'org-a' }); },
  'SID ABA': f => { f.replace({ sid: 'sid-b' }); f.replace({ sid: 'sid-a' }); },
  'actor ABA': f => { f.replace({ actor: 'actor-c' }); f.replace({ actor: 'actor-a' }); },
  'QueryClient ABA': f => { f.replace({ replacementClient: newClient() }); f.replace({ replacementClient: f.client }); },
  'full access ABA': f => { f.replace({ org: 'org-b', actor: 'actor-c', sid: 'sid-b' }); f.replace({ org: 'org-a', actor: 'actor-a', sid: 'sid-a' }); },
  'logout before React renders': f => f.replaceTransportBeforeRender({ actor: null, sid: null }),
  'SID replacement before React renders': f => f.replaceTransportBeforeRender({ sid: 'sid-b' }),
};

// A closed popup no longer observes React auth/tenant changes. Reproduce the
// provider's actual ownership cleanup independently of that child lifecycle.
const retirementsAfterClose = {
  'provider unmount': f => f.retireProvider(),
  'provider client replacement': f => f.replaceProvider({ replacementClient: newClient() }),
  'organization replacement': f => f.replaceProvider({ org: 'org-b', replacementClient: newClient() }),
  'permission replacement': f => f.replaceProvider({ replacementClient: newClient() }),
  'SID ABA': f => { f.replaceProvider({ sid: 'sid-b' }); f.replaceProvider({ sid: 'sid-a' }); },
  'organization ABA': f => { f.replaceProvider({ org: 'org-b', replacementClient: newClient() }); f.replaceProvider({ org: 'org-a', replacementClient: f.client }); },
  'permission ABA': f => { f.replaceProvider({ replacementClient: newClient() }); f.replaceProvider({ replacementClient: f.client }); },
  'provider cleanup and reactivation': f => { f.retireProvider(); f.replaceProvider({}); },
};

for (const kind of ['assignment', 'stage']) {
  test(`${kind}: a dispatched POST pins actor/SID without a popup abort signal and preserves its ACK after close`, async () => {
    const f = fixture(kind);
    try {
      const pending = f.start(); await turn(); assert.equal(f.requests.length, 1);
      const intent = f.requests[0].args[3];
      assert.equal(intent.expectedUserId, 'actor-a'); assert.equal(intent.expectedSessionId, 'sid-a');
      assert.equal(intent.signal, undefined); assert.equal(typeof intent.onRequestStart, 'function');
      f.closePopup(); f.resolve(); await pending;
      assert.equal(f.client.getQueryData(f.key).updated_at, '2026-10-19T10:01:00.000001Z');
      assert.equal(f.events.length, 1); assert.deepEqual(f.notices, []);
    } finally { f.dispose(); }
  });

  for (const [name, retire] of [['popup close', f => f.closePopup()], ['provider retirement', f => f.retireProvider()]]) {
    test(`${kind}: onRequestStart blocks POST after ${name} during token preparation`, async () => {
      const f = fixture(kind, { waitForRequestStart: true });
      try {
        const pending = f.start(); await turn(); assert.equal(f.requests.length, 0);
        retire(f); const local = f.state().localLead; f.releaseRequestStart(); f.resolve(); await pending;
        assert.equal(f.requests.length, 0); assert.equal(f.state().localLead, local);
        assert.deepEqual(f.notices, []); assert.deepEqual(f.events, []);
      } finally { f.dispose(); }
    });
  }

  for (const validAccess of [true, false]) for (const failure of ['definitive', 'unknown']) {
    test(`${kind}: ${failure} failure after close ${validAccess ? 'reconciles active reads' : 'never fetches retired access'}`, async () => {
      const f = fixture(kind);
      try {
        const reads = f.observeCanonicalReads(), pending = f.start(); await turn(); assert.deepEqual(reads, { lead: 0, board: 0 });
        f.closePopup(); if (!validAccess) f.retireProvider(); const local = f.state().localLead;
        f.reject(failure === 'unknown' ? new TypeError('Synthetic connection lost') : undefined); await pending; await turn();
        assert.deepEqual(reads, validAccess ? { lead: 1, board: 1 } : { lead: 0, board: 0 });
        assert.equal(f.state().localLead, local); assert.equal(f.state().closed, true);
        assert.equal(f.requests.length, 1); assert.deepEqual(f.events, []); assert.deepEqual(f.notices, []);
        if (validAccess) assert.equal(f.client.getQueryData(f.boardKey)[0].leads[0].assigned_user_id, 'actor-a');
      } finally { f.dispose(); }
    });
  }

  for (const [name, patch] of [['another lead ID', { id: 'lead-b' }], ['another organization', { organization_id: 'org-b' }]]) {
    test(`${kind}: a current ACK carrying ${name} never hydrates or patches its response`, async () => {
      const f = fixture(kind);
      try {
        const pending = f.start(); await turn(); assert.equal(f.requests.length, 1);
        const local = f.state().localLead, cached = f.client.getQueryData(f.key), board = f.client.getQueryData(f.boardKey), beforeCalls = f.cacheCalls.length;
        f.resolve(patch); await pending; await turn();
        assert.equal(f.client.getQueryData(f.key), cached); assert.equal(f.client.getQueryData(f.boardKey), board);
        assert.equal(f.state().localLead, local); assert.equal(f.cacheCalls.length, beforeCalls);
        assert.equal(f.client.getQueryData(['lead', 'org-a', 'lead-b']), undefined);
        assert.equal(f.client.getQueryData(['lead', 'org-b', f.lead.id]), undefined);
        assert.deepEqual(f.events, []); assert.deepEqual(f.restores, []);
        assert.equal(f.notices.length, 1); assert.equal(f.notices[0][0], 'error'); assert.match(f.notices[0][1], /Não foi possível/);
      } finally { f.dispose(); }
    });
  }

  for (const [name, retire] of Object.entries(retirementsAfterClose)) {
    for (const outcome of ['ACK', 'definitive rejection']) test(`${kind}: ${outcome} after popup close and ${name} cannot recreate retired cache`, async () => {
      const f = fixture(kind);
      try {
        const pending = f.start(); await turn(); assert.equal(f.requests.length, 1);
        f.closePopup(); retire(f); f.client.clear(); const beforeCalls = f.cacheCalls.length, local = f.state().localLead;
        if (outcome === 'ACK') f.resolve(); else f.reject();
        await pending; await turn();
        assert.equal(f.client.getQueryData(f.key), undefined); assert.equal(f.client.getQueryData(f.boardKey), undefined);
        assert.equal(f.state().localLead, local); assert.equal(f.state().closed, true);
        assert.equal(f.cacheCalls.length, beforeCalls); assert.deepEqual(f.restores, []);
        assert.deepEqual(f.events, []); assert.deepEqual(f.notices, []);
      } finally { f.dispose(); }
    });
  }

  for (const [name, retire] of Object.entries(retirements)) {
    for (const outcome of ['ACK', 'definitive rejection']) test(`${kind}: ${outcome} after ${name} cannot recreate or mutate retired cache`, async () => {
      const f = fixture(kind);
      try {
        const pending = f.start(); await turn(); assert.equal(f.requests.length, 1);
        retire(f); f.client.clear();
        const sentinel = { ...f.lead, organization_id: 'org-b', name: 'Replacement tenant', assigned_user_id: 'actor-c' };
        const sentinelKey = ['lead', 'org-b', f.lead.id]; f.client.setQueryData(sentinelKey, sentinel);
        const local = f.state().localLead, beforeCalls = f.cacheCalls.length;
        if (outcome === 'ACK') f.resolve(); else f.reject();
        await pending; await turn();
        assert.equal(f.client.getQueryData(f.key), undefined);
        assert.equal(f.client.getQueryData(f.boardKey), undefined);
        assert.equal(f.client.getQueryData(sentinelKey), sentinel);
        assert.equal(f.state().localLead, local);
        assert.equal(f.cacheCalls.length, beforeCalls); assert.deepEqual(f.restores, []);
        assert.deepEqual(f.events, []); assert.deepEqual(f.notices, []);
      } finally { f.dispose(); }
    });
  }

  test(`${kind}: closing normally reconciles the persisted ACK without reopening or toasting`, async () => {
    const f = fixture(kind);
    try {
      const pending = f.start(); await turn(); f.closePopup(); const local = f.state().localLead;
      f.resolve(); await pending;
      const saved = f.client.getQueryData(f.key);
      assert.equal(saved.updated_at, '2026-10-19T10:01:00.000001Z');
      assert.equal(saved[kind === 'assignment' ? 'assigned_user_id' : 'stage_id'], kind === 'assignment' ? 'actor-b' : 'stage-b');
      assert.equal(f.state().localLead, local); assert.equal(f.state().closed, true);
      assert.equal(f.events.length, 1); assert.deepEqual(f.notices, []);
    } finally { f.dispose(); }
  });

  test(`${kind}: token refresh within the same SID keeps the response current`, async () => {
    const f = fixture(kind);
    try {
      const pending = f.start(); await turn(); f.replace({ version: 2 }); f.resolve(); await pending;
      assert.equal(f.client.getQueryData(f.key).updated_at, '2026-10-19T10:01:00.000001Z');
      assert.equal(f.state().localLead.updated_at, '2026-10-19T10:01:00.000001Z');
      assert.equal(f.events.length, 1); assert.equal(f.notices.length, 1);
    } finally { f.dispose(); }
  });

  test(`${kind}: cache clearing alone still permits a canonical ACK with unchanged access`, async () => {
    const f = fixture(kind);
    try {
      const pending = f.start(); await turn(); f.client.clear(); f.resolve(); await pending;
      assert.equal(f.client.getQueryData(f.key).updated_at, '2026-10-19T10:01:00.000001Z');
      assert.equal(f.state().localLead.updated_at, '2026-10-19T10:01:00.000001Z');
      assert.equal(f.events.length, 1);
    } finally { f.dispose(); }
  });

  test(`${kind}: closing and clearing with unchanged access still reconciles the persisted ACK`, async () => {
    const f = fixture(kind);
    try {
      const pending = f.start(); await turn(); f.closePopup(); f.client.clear(); const local = f.state().localLead;
      f.resolve(); await pending;
      assert.equal(f.client.getQueryData(f.key).updated_at, '2026-10-19T10:01:00.000001Z');
      assert.equal(f.state().localLead, local); assert.equal(f.state().closed, true); assert.deepEqual(f.notices, []);
    } finally { f.dispose(); }
  });

  test(`${kind}: another opened lead receives no local hydration from the old ACK`, async () => {
    const f = fixture(kind);
    try {
      const pending = f.start(); await turn(); const replacement = { ...f.lead, id: 'lead-b', name: 'Synthetic B' };
      f.replace({}, replacement); f.resolve(); await pending;
      assert.equal(f.state().localLead, replacement);
      assert.equal(f.client.getQueryData(f.key).updated_at, '2026-10-19T10:01:00.000001Z');
      assert.deepEqual(f.notices, []);
    } finally { f.dispose(); }
  });

  test(`${kind}: same lead ID in another tenant cannot receive the old ACK`, async () => {
    const f = fixture(kind);
    try {
      const pending = f.start(); await turn(); const replacement = { ...f.lead, organization_id: 'org-b', name: 'Other tenant' };
      f.replace({ org: 'org-b' }, replacement); f.client.clear();
      f.client.setQueryData(['lead', 'org-b', f.lead.id], replacement); f.resolve(); await pending;
      assert.equal(f.state().localLead, replacement); assert.equal(f.client.getQueryData(f.key), undefined);
      assert.equal(f.client.getQueryData(['lead', 'org-b', f.lead.id]), replacement); assert.deepEqual(f.notices, []);
    } finally { f.dispose(); }
  });
}

test('a stage selection made before an access ABA cannot dispatch after the visit returns', async () => {
  const f = fixture('stage');
  try {
    const move = f.captureMove(); f.replace({ org: 'org-b' }); f.replace({ org: 'org-a' });
    assert.equal(await f.persistMove(move), false); assert.equal(f.requests.length, 0);
  } finally { f.dispose(); }
});

test('assignment waiting on availability cannot dispatch after its access retires', async () => {
  const f = fixture('assignment', { waitForAvailability: true });
  try {
    const pending = f.start(); await turn(); assert.equal(f.requests.length, 0);
    f.replace({ sid: 'sid-b' }); f.allowAvailability(); await pending; assert.equal(f.requests.length, 0);
  } finally { f.dispose(); }
});
