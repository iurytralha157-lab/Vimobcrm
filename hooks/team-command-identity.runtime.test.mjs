import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { test } from 'node:test';
import ts from 'typescript';
import { MutationCache, MutationObserver, QueryClient } from '@tanstack/query-core';
import { activateQueryClientAccess, captureQueryClientAccess } from '../lib/access/query-client-access.ts';

// Actual hooks, API methods and management identity checks; only React lifecycle,
// authentication, response validation and transport are synthetic. No network/DB.
const root = path.resolve(import.meta.dirname, '..');
const sourceRoot = process.env.VIMOB_TEAM_COMMAND_BEFORE_DIR || root;
const org = '11111111-1111-4111-8111-111111111111';
const otherOrg = '22222222-2222-4222-8222-222222222222';
const teamId = '33333333-3333-4333-8333-333333333333';
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

function evaluate(source, imports = {}) {
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const record = { exports: {} };
  vm.runInNewContext(compiled, { module: record, exports: record.exports, AbortController, require(name) {
    assert.ok(name in imports, `unexpected real import: ${name}`);
    return imports[name];
  } });
  return record.exports;
}

function apiMethods() {
  const source = readFileSync(path.join(sourceRoot, 'lib/api/teams.ts'), 'utf8');
  const ast = ts.createSourceFile('teams.ts', source, ts.ScriptTarget.Latest, true);
  const methods = [];
  const visit = node => {
    if (ts.isMethodDeclaration(node) && ['deleteTeam', 'updateTeamStatus'].includes(node.name.getText(ast))) methods.push(node.getText(ast));
    ts.forEachChild(node, visit);
  };
  visit(ast);
  assert.equal(methods.length, 2);
  return `export const teamsAPI = { ${methods.join(',')} };`;
}

function harness(kind, { holdMutation = false, holdResponse = false } = {}) {
  const gate = deferred(), entered = deferred(), response = deferred();
  const auth = { activeOrganization: { organizationId: org }, user: { id: 'actor-a' }, session: { sid: 'sid-a' } };
  const token = { user: 'actor-a', sid: 'sid-a' };
  const requests = [], toasts = [], pending = [], slots = [];
  let cursor = 0, effects = [], facade, hook, disposed = false;
  const client = new QueryClient({ mutationCache: new MutationCache({ onMutate: async () => {
    entered.resolve();
    if (holdMutation) await gate.promise;
  } }) });
  let retire = activateQueryClientAccess(client);
  class APIError extends Error { constructor(message, details) { super(message); Object.assign(this, details); } }
  const identityAPI = {
    getVimobAPIAccessTokenUserId: () => token.user,
    getVimobAPIAccessTokenSessionId: () => token.sid,
    vimobAPIRequest: async (route, options) => {
      if (options.expectedUserId !== token.user || options.expectedSessionId !== token.sid) throw new APIError('identity changed', { code: 'api_request_identity_changed', status: 409 });
      requests.push({ route, ...options });
      if (holdResponse) await response.promise;
      return { data: { id: teamId, organization_id: options.organizationId, is_active: options.body?.is_active } };
    },
  };
  const management = evaluate(readFileSync(path.join(sourceRoot, 'lib/api/management-request.ts'), 'utf8'), {
    '@/lib/api/vimob-client': identityAPI, '@/lib/api/vimob-error': { VimobAPIError: APIError },
  });
  const methods = ts.transpileModule(apiMethods(), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const apiRecord = { exports: {} };
  vm.runInNewContext(methods, { module: apiRecord, exports: apiRecord.exports, managementAPIRequest: management.managementAPIRequest, validateDomainResponse() {}, apiTeamResponseSchema: {} });
  const slot = init => { const index = cursor++; return slots[index] ??= init(); };
  const changed = (a, b) => !a || !b || a.length !== b.length || a.some((value, index) => value !== b[index]);
  const effect = (callback, dependencies) => {
    const record = slot(() => ({ dependencies: undefined, cleanup: undefined }));
    if (changed(record.dependencies, dependencies)) effects.push(() => {
      record.cleanup?.();
      record.dependencies = dependencies;
      record.cleanup = callback();
    });
  };
  const react = {
    useRef: value => slot(() => ({ current: value })),
    useMemo: (create, dependencies) => {
      const record = slot(() => ({}));
      if (changed(record.dependencies, dependencies)) { record.dependencies = dependencies; record.value = create(); }
      return record.value;
    },
    useEffect: effect, useLayoutEffect: effect,
  };
  const useMutation = options => {
    const record = slot(() => {
      const observer = new MutationObserver(client, options);
      const unsubscribe = observer.subscribe(() => {});
      return { observer, cleanup: unsubscribe };
    });
    record.observer.setOptions(options);
    return {
      ...record.observer.getCurrentResult(),
      mutate: (variables, callbacks) => {
        const promise = record.observer.mutate(variables, callbacks);
        pending.push(promise);
        promise.catch(() => {});
      },
      mutateAsync: (variables, callbacks) => record.observer.mutate(variables, callbacks),
    };
  };
  const hooks = evaluate(readFileSync(path.join(sourceRoot, 'hooks/use-teams.ts'), 'utf8'), {
    '@/hooks/shared/use-query-data-trust': {},
    '@tanstack/react-query': { useQueryClient: () => client, useMutation },
    '@/lib/api/teams': apiRecord.exports,
    sonner: { toast: { success: message => toasts.push(message), error: message => toasts.push(message) } },
    react,
    '@/contexts/AuthContext': { useAuth: () => auth },
    '@/lib/api/management-request': management,
    '@/lib/access/query-client-access': { captureQueryClientAccess },
    '@/lib/auth/global-sign-out': { getGlobalSignOutSessionId: session => session?.sid },
    '@/lib/pipeline-reliability': {}, '@/lib/teams/team-editor-snapshot': {},
  });
  hook = kind === 'delete' ? hooks.useDeleteTeam : hooks.useUpdateTeamStatus;
  function render() { cursor = 0; effects = []; facade = hook(); effects.forEach(run => run()); return facade; }
  function unmount() { if (disposed) return; disposed = true; slots.forEach(record => record.cleanup?.()); }
  render();
  return {
    client, auth, token, requests, toasts, entered, gate, response, pending, render,
    get mutation() { return facade; },
    input: () => ({ id: teamId, organizationId: org, ...(kind === 'status' ? { is_active: false } : {}) }),
    replace(mode) {
      if (mode === 'actor') { auth.user = { id: 'actor-b' }; token.user = 'actor-b'; }
      if (mode === 'sid') { auth.session = { sid: 'sid-b' }; token.sid = 'sid-b'; }
      if (mode === 'organization') auth.activeOrganization = { organizationId: otherOrg };
      if (mode === 'access') { retire(); retire = activateQueryClientAccess(client); }
      if (mode === 'unmount') { unmount(); return; }
      render();
    },
    restore() {
      auth.user = { id: 'actor-a' }; auth.session = { sid: 'sid-a' }; auth.activeOrganization = { organizationId: org };
      token.user = 'actor-a'; token.sid = 'sid-a'; render();
    },
    dispose() { unmount(); retire(); gate.resolve(); response.resolve(); client.clear(); },
  };
}

for (const kind of ['delete', 'status']) {
  for (const method of ['mutate', 'mutateAsync']) for (const replacement of ['actor', 'sid', 'organization', 'access', 'unmount']) {
    test(`${kind}/${method}: ${replacement} replacement during real MutationObserver wait sends no command`, async () => {
      const h = harness(kind, { holdMutation: true }), callbacks = [];
      try {
        const options = Object.fromEntries(['onSuccess', 'onError', 'onSettled'].map(key => [key, () => callbacks.push(key)]));
        const result = h.mutation[method](h.input(), options);
        const pending = method === 'mutate' ? h.pending.at(-1) : result;
        pending.catch(() => {});
        await h.entered.promise;
        h.replace(replacement);
        h.gate.resolve();
        await assert.rejects(pending);
        assert.equal(h.requests.length, 0, 'replacement actor must never receive the old command');
        assert.deepEqual(callbacks, []);
        assert.deepEqual(h.toasts, []);
      } finally { h.dispose(); }
    });
  }

  test(`${kind}: retained callback cannot revive after actor A to B to A`, async () => {
    const h = harness(kind), old = h.mutation.mutateAsync;
    try {
      h.replace('actor'); h.restore();
      assert.throws(() => old(h.input()), /acesso mudou/);
      assert.equal(h.requests.length, 0);
    } finally { h.dispose(); }
  });

  test(`${kind}: token replacement before the next render fails closed`, () => {
    const h = harness(kind);
    try {
      h.token.user = 'actor-b'; h.token.sid = 'sid-b';
      assert.throws(() => h.mutation.mutate(h.input()), /sessão mudou/);
      assert.equal(h.requests.length, 0);
    } finally { h.dispose(); }
  });

  test(`${kind}: another tenant input fails before MutationObserver`, () => {
    const h = harness(kind);
    try {
      assert.throws(() => h.mutation.mutate({ ...h.input(), organizationId: otherOrg }), /acesso mudou/);
      assert.equal(h.requests.length, 0);
    } finally { h.dispose(); }
  });

  test(`${kind}: same-SID refresh preserves identity and snapshots the original command`, async () => {
    const h = harness(kind, { holdMutation: true });
    try {
      const input = h.input(), callbacks = [];
      const pending = h.mutation.mutateAsync(input, { onSuccess: () => callbacks.push('success') });
      await h.entered.promise;
      input.id = 'replacement-team'; input.organizationId = otherOrg; input.is_active = true;
      h.auth.session = { sid: 'sid-a', access_token: 'synthetic-refreshed-token' }; h.render();
      h.gate.resolve(); await pending;
      assert.equal(h.requests.length, 1);
      assert.equal(h.requests[0].expectedUserId, 'actor-a');
      assert.equal(h.requests[0].expectedSessionId, 'sid-a');
      assert.equal(h.requests[0].organizationId, org);
      assert.ok(h.requests[0].route.includes(teamId));
      if (kind === 'status') assert.equal(h.requests[0].body.is_active, false);
      assert.deepEqual(callbacks, ['success']);
      assert.equal(h.toasts.length, 1);
    } finally { h.dispose(); }
  });

  test(`${kind}: accepted old completion cannot affect replacement actor cache or callbacks`, async () => {
    const h = harness(kind, { holdResponse: true }), callbacks = [];
    try {
      h.client.setQueryData(['teams', org], [{ id: teamId, name: 'before' }]);
      const pending = h.mutation.mutateAsync(h.input(), { onSuccess: () => callbacks.push('success'), onError: () => callbacks.push('error') });
      pending.catch(() => {});
      await h.entered.promise;
      while (h.requests.length === 0) await new Promise(resolve => setImmediate(resolve));
      h.replace('actor');
      h.client.setQueryData(['teams', org], [{ id: teamId, name: 'new actor data' }]);
      h.response.resolve(); await assert.rejects(pending);
      assert.equal(h.client.getQueryState(['teams', org]).isInvalidated, false);
      assert.equal(h.client.getQueryData(['teams', org])[0].name, 'new actor data');
      assert.deepEqual(callbacks, []); assert.deepEqual(h.toasts, []);
    } finally { h.dispose(); }
  });

  test(`${kind}: accepted completion after close invalidates only its owner and retires UI callbacks`, async () => {
    const h = harness(kind, { holdResponse: true }), callbacks = [];
    try {
      h.client.setQueryData(['teams', org], [{ id: teamId }]);
      h.client.setQueryData(['teams', otherOrg], [{ id: 'foreign-team' }]);
      const pending = h.mutation.mutateAsync(h.input(), { onSuccess: () => callbacks.push('success'), onSettled: () => callbacks.push('settled') });
      await h.entered.promise;
      while (h.requests.length === 0) await new Promise(resolve => setImmediate(resolve));
      h.replace('unmount'); h.response.resolve(); await pending;
      assert.equal(h.client.getQueryState(['teams', org]).isInvalidated, true);
      assert.equal(h.client.getQueryState(['teams', otherOrg]).isInvalidated, false);
      assert.deepEqual(callbacks, []); assert.deepEqual(h.toasts, []);
    } finally { h.dispose(); }
  });
}
