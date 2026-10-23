import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
function evaluate(file, dependencies, globals = {}) {
  const source = ts.transpileModule(readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const testModule = { exports: {} };
  vm.runInNewContext(source, {
    module: testModule, exports: testModule.exports,
    require: name => {
      assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency ${name}`);
      return dependencies[name];
    },
    ...globals,
  }, { filename: file });
  return testModule.exports;
}
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};

// Execute actual hooks, generation fence and domain APIs. Only React's lifecycle,
// Query's scheduling, auth and transport are deterministic local substitutes.
function fixture() {
  let cursor = 0;
  const slots = [];
  const auth = {
    user: { id: 'actor-a' }, profile: { id: 'actor-a' },
    activeOrganization: { organizationId: 'org-a', status: 'ready' },
    tenantContext: { userId: 'actor-a', organizationId: 'org-a', permissions: ['property_manage'], enabledModules: ['properties'] },
    organization: {},
  };
  const requests = [], invalidations = [], messages = [];
  const state = { authBarrier: null, requestStarted: deferred(), uploadStarted: deferred(), uploadBarrier: null, failCreate: false, invalidateStarted: deferred(), invalidateBarrier: null, sessionId: null };
  const react = {
    useMemo(fn, deps) {
      const index = cursor++;
      const old = slots[index];
      if (!old || deps.some((dep, i) => dep !== old.deps[i])) slots[index] = { deps, value: fn() };
      return slots[index].value;
    },
    useCallback(fn, deps) { return react.useMemo(() => fn, deps); },
    useRef(value) {
      const index = cursor++;
      slots[index] ??= { current: value };
      return slots[index];
    },
    useLayoutEffect(fn, deps) {
      const index = cursor++;
      const old = slots[index];
      if (!old || deps.some((dep, i) => dep !== old.deps[i])) {
        old?.cleanup?.();
        slots[index] = { deps, cleanup: fn() };
      }
    },
  };
  const queryClient = { invalidateQueries: async ({ queryKey }) => {
    invalidations.push(queryKey);
    state.invalidateStarted.resolve();
    if (state.invalidateBarrier) await state.invalidateBarrier.promise;
  }, setQueryData: () => undefined };
  const query = {
    useQueryClient: () => queryClient,
    useQuery: () => ({}),
    useMutation(options) {
      const ref = react.useRef(null);
      ref.current ??= { options, variables: undefined };
      ref.current.options = options;
      const run = async (variables, callbacks) => {
        ref.current.variables = variables;
        // Query can yield before reading options, which a rerender may replace.
        await Promise.resolve();
        try {
          const data = await ref.current.options.mutationFn(variables);
          await ref.current.options.onSuccess?.(data, variables);
          callbacks?.onSuccess?.(data, variables, undefined, {});
          callbacks?.onSettled?.(data, null, variables, undefined, {});
          return data;
        } catch (error) {
          await ref.current.options.onError?.(error, variables);
          callbacks?.onError?.(error, variables, undefined, {});
          callbacks?.onSettled?.(undefined, error, variables, undefined, {});
          throw error;
        }
      };
      return { variables: ref.current.variables, mutateAsync: run, mutate: (variables, callbacks) => { void run(variables, callbacks).catch(() => undefined); } };
    },
  };
  const guard = evaluate('lib/property-media-execution.ts', {});
  const validations = { parseDomainInput: (_schema, input) => input, validateDomainResponse: (_schema, response) => response };
  const identity = {
    getVimobAPIAccessTokenUserId: () => auth.user.id,
    getVimobAPIAccessTokenSessionId: () => state.sessionId ?? `${auth.user.id}-session`,
  };
  const apiErrors = evaluate('lib/api/vimob-error.ts', {});
  const intent = evaluate('lib/api/property-mutation-intent.ts', { '@/lib/api/vimob-client': identity });
  const api = evaluate('lib/api/property-workspace.ts', {
    '@/lib/validation': validations,
    '@/lib/api/property-mutation-intent': intent,
    '@/lib/property-media-execution': guard,
    '@/lib/supabase/client': { supabase: { storage: { from: () => ({ uploadToSignedUrl: async () => {
      state.uploadStarted.resolve();
      if (state.uploadBarrier) await state.uploadBarrier.promise;
      return { error: null };
    } }) } } },
    './vimob-client': {
      ...identity,
      vimobAPIRequest: async (url, options) => {
        state.requestStarted.resolve();
        if (state.authBarrier) await state.authBarrier.promise;
        if (options.expectedUserId !== undefined && options.expectedUserId !== auth.user.id) throw new guard.PropertyMediaScopeChangedError();
        options.onRequestStart?.();
        requests.push({ url, ...options });
        if (state.failCreate && url.endsWith('/assets')) throw Object.assign(new Error('Create rejected'), { status: 400 });
        if (url.endsWith('/workspace')) return { data: { assets: [] } };
        return { data: url.endsWith('/upload-intents')
          ? { bucket: 'synthetic', storage_path: 'org-a/property-a/photo.jpg', token: 'synthetic-token' }
          : { id: 'asset-a' } };
      },
    },
  });
  const scope = evaluate('hooks/properties/use-property-form-scope.ts', { react });
  const toast = { success: text => messages.push(text), error: text => messages.push(text) };
  const mutation = evaluate('hooks/properties/use-property-asset-mutation.ts', {
    '@tanstack/react-query': query, sonner: { toast },
    '@/hooks/properties/use-property-form-scope': scope,
    '@/lib/api/vimob-error': { stringifyErrorMessage: error => error.message },
    '@/lib/api/vimob-client': identity,
    '@/lib/property-media-execution': guard,
  });
  class PersistenceError extends Error {
    constructor(error, assetIds, paths) {
      super(error.message); this.originalError = error;
      this.rollbackFailedAssetIds = assetIds; this.rollbackFailedUploadPaths = paths;
    }
  }
  const pendingRows = new Map();
  const recovery = evaluate('lib/properties/property-asset-create-recovery.ts', {
    '@/lib/validation/property-asset-recovery': { pendingPropertyAssetSchema: { parse: value => value, safeParse: value => ({ success: true, data: value }) } },
    '@/lib/property-media-execution': guard,
    '@/lib/property-media-persistence': { PropertyMediaPersistenceError: PersistenceError },
  }, { crypto: globalThis.crypto, localStorage: {
    getItem: key => pendingRows.get(key) ?? null, setItem: (key, value) => pendingRows.set(key, value), removeItem: key => pendingRows.delete(key),
  } });
  const propertyMutation = evaluate('hooks/properties/use-property-mutation.ts', {
    '@tanstack/react-query': query,
    '@/contexts/AuthContext': { useAuth: () => auth },
    '@/hooks/shared/use-tenant-query-access-signature': { useTenantQueryAccessSignature: () => JSON.stringify(auth) },
    '@/hooks/properties/use-property-form-scope': scope,
    '@/lib/api/property-mutation-intent': intent,
    '@/lib/api/vimob-client': identity,
    '@/lib/api/vimob-error': apiErrors,
  });
  const hooks = evaluate('hooks/properties/use-property-workspace.ts', {
    '@tanstack/react-query': query, sonner: { toast },
    '@/contexts/AuthContext': { useAuth: () => auth },
    '@/hooks/properties/use-property-asset-mutation': mutation,
    '@/hooks/properties/use-property-mutation': propertyMutation,
    '@/lib/access/tenant-query-cache': { createTenantQueryAccessSignature: value => JSON.stringify(value) },
    '@/lib/api/vimob-error': { stringifyErrorMessage: error => error.message },
    '@/lib/properties/property-asset-create-recovery': recovery,
    '@/lib/api/property-workspace': api,
  });
  const commandTransport = {
    ...identity,
    vimobAPIRequest: async (url, options) => {
      state.requestStarted.resolve();
      if (state.authBarrier) await state.authBarrier.promise;
      options.onRequestStart?.();
      requests.push({ url, ...options });
      return { data: { id: 'synthetic-id', development: { id: 'development-a' }, units: [], property: { id: 'property-a' }, replayed: false } };
    },
  };
  const commandBase = { '@/lib/validation': validations, './vimob-client': commandTransport, '@/lib/api/property-mutation-intent': intent };
  const developmentAPI = evaluate('lib/api/property-developments.ts', { ...commandBase, zod: require('zod') });
  const publicationAPI = evaluate('lib/api/property-publications.ts', commandBase, { crypto: globalThis.crypto });
  const hookBase = {
    react, '@tanstack/react-query': query, sonner: { toast },
    '@/contexts/AuthContext': { useAuth: () => auth },
    '@/hooks/properties/use-property-mutation': propertyMutation,
    '@/lib/access/tenant-query-cache': { createTenantQueryAccessSignature: value => JSON.stringify(value) },
    '@/lib/api/vimob-error': { VimobAPIError: class extends Error {}, stringifyErrorMessage: error => error.message, getPublicErrorMessage: error => error.message },
  };
  Object.assign(hooks, evaluate('hooks/properties/use-property-developments.ts', {
    ...hookBase, '@/lib/api/property-developments': developmentAPI,
  }, { crypto: globalThis.crypto }));
  Object.assign(hooks, evaluate('hooks/properties/use-property-publications.ts', {
    ...hookBase, '@/lib/api/property-publications': publicationAPI,
    '@/lib/utils/property-publication-polling': {}, './use-property-workspace': { propertyWorkspaceKeys: { detail: (...parts) => parts } },
  }));
  return {
    auth, requests, invalidations, messages, state,
    render(name, propertyId = 'property-a') { cursor = 0; return hooks[name](propertyId); },
    renderMutation(options) { cursor = 0; return propertyMutation.usePropertyMutation(options); },
    unmount() { slots.forEach(slot => slot?.cleanup?.()); },
  };
}

const commands = {
  useCreatePropertyAsset: { input: { asset_type: 'video', external_url: 'https://example.invalid/video' } },
  useUpdatePropertyAsset: { assetId: 'asset-a', input: { title: 'Photo' } },
  useDeletePropertyAsset: { assetId: 'asset-a', input: {} },
  useReorderPropertyAssets: { asset_ids: ['asset-a'] },
  useSetPrimaryPropertyAsset: { assetId: 'asset-a', input: {} },
};
for (const [hook, command] of Object.entries(commands)) {
  test(`${hook} stops actor A to B during token resolution`, async () => {
    const f = fixture();
    f.state.authBarrier = deferred();
    const pending = f.render(hook).mutateAsync(command);
    await f.state.requestStarted.promise;
    f.auth.user.id = 'actor-b';
    f.auth.tenantContext.userId = 'actor-b';
    f.render(hook);
    f.state.authBarrier.resolve();
    await assert.rejects(pending);
    assert.equal(f.requests.length, 0);
    assert.equal(f.messages.length, 0);
    assert.ok(f.invalidations.every(key => key[1] === 'org-a'));
  });
}

for (const change of ['tenant', 'rights', 'property', 'unmount', 'aba']) {
  test(`asset mutation stops ${change} change during token resolution`, async () => {
    const f = fixture();
    f.state.authBarrier = deferred();
    const pending = f.render('useDeletePropertyAsset').mutateAsync(commands.useDeletePropertyAsset);
    await f.state.requestStarted.promise;
    if (change === 'tenant') f.auth.tenantContext.organizationId = 'org-b';
    if (change === 'rights') f.auth.tenantContext.permissions = [];
    if (change === 'unmount') f.unmount();
    else f.render('useDeletePropertyAsset', change === 'property' ? 'property-b' : 'property-a');
    if (change === 'aba') {
      f.auth.activeOrganization.organizationId = 'org-b'; f.render('useDeletePropertyAsset');
      f.auth.activeOrganization.organizationId = 'org-a'; f.render('useDeletePropertyAsset');
    }
    f.state.authBarrier.resolve();
    await assert.rejects(pending);
    assert.equal(f.requests.length, 0);
    assert.equal(f.messages.length, 0);
  });
}

test('queued mutation keeps the click scope even if Query reads new options', async () => {
  const f = fixture();
  const pending = f.render('useDeletePropertyAsset').mutateAsync(commands.useDeletePropertyAsset);
  f.auth.user.id = 'actor-b'; f.auth.tenantContext.userId = 'actor-b';
  f.render('useDeletePropertyAsset');
  await assert.rejects(pending);
  assert.equal(f.requests.length, 0);
});

test('token actor change blocks request and toast before auth context rerenders', async () => {
  const f = fixture();
  f.state.authBarrier = deferred();
  const pending = f.render('useDeletePropertyAsset').mutateAsync(commands.useDeletePropertyAsset);
  await f.state.requestStarted.promise;
  f.auth.user.id = 'actor-b';
  f.state.authBarrier.resolve();
  await assert.rejects(pending);
  assert.equal(f.requests.length, 0);
  assert.equal(f.messages.length, 0);
});

const photo = { input: { asset_type: 'photo' }, file: new File(['synthetic'], 'photo.jpg', { type: 'image/jpeg' }) };
test('uploaded asset preserves orphan path and skips create/discard after scope loss', async () => {
  const f = fixture();
  f.state.uploadBarrier = deferred();
  const pending = f.render('useCreatePropertyAsset').mutateAsync(photo);
  await f.state.uploadStarted.promise;
  f.auth.user.id = 'actor-b'; f.auth.tenantContext.userId = 'actor-b';
  f.render('useCreatePropertyAsset');
  f.state.uploadBarrier.resolve();
  await assert.rejects(pending, error => {
    assert.deepEqual(Array.from(error.rollbackFailedUploadPaths ?? []), ['org-a/property-a/photo.jpg']);
    return true;
  });
  assert.equal(f.requests.filter(request => request.method === 'POST').length, 1);
  assert.equal(f.requests.filter(request => request.method === 'DELETE').length, 0);
  assert.equal(f.messages.length, 0);
});

test('create failure compensates only under original actor and tenant', async () => {
  const f = fixture();
  f.state.failCreate = true;
  await assert.rejects(f.render('useCreatePropertyAsset').mutateAsync(photo));
  const discard = f.requests.find(request => request.method === 'DELETE');
  assert.ok(discard);
  assert.equal(discard.expectedUserId, 'actor-a');
  assert.equal(discard.organizationId, 'org-a');
  assert.equal(discard.body.storage_path, 'org-a/property-a/photo.jpg');
});

test('scope loss during cache refresh suppresses success and caller callbacks', async () => {
  const f = fixture();
  f.state.invalidateBarrier = deferred();
  let callbackCount = 0;
  const pending = f.render('useUpdatePropertyAsset').mutateAsync(commands.useUpdatePropertyAsset, { onSuccess: () => callbackCount++ });
  await f.state.invalidateStarted.promise;
  f.auth.activeOrganization.organizationId = 'org-b'; f.auth.tenantContext.organizationId = 'org-b';
  f.render('useUpdatePropertyAsset');
  f.state.invalidateBarrier.resolve();
  await assert.rejects(pending);
  assert.equal(f.messages.length, 0);
  assert.equal(callbackCount, 0);
  assert.ok(f.invalidations.every(key => key[1] === 'org-a'));
});

test('normal editing returns the original data and command to callbacks', async () => {
  const f = fixture();
  let callbackCommand;
  const data = await f.render('useUpdatePropertyAsset').mutateAsync(commands.useUpdatePropertyAsset, { onSuccess: (_data, command) => { callbackCommand = command; } });
  assert.equal(data.id, 'asset-a');
  assert.equal(callbackCommand, commands.useUpdatePropertyAsset);
  assert.equal(f.messages.length, 1);
});

const nonMedia = {
  useUpsertPropertyOffer: { offerType: 'sale', input: { price: 100 } },
  useCreatePropertyKey: { label: 'Synthetic key' },
  useMovePropertyKey: { keyId: 'key-a', input: { movement_type: 'return' } },
  useCreatePropertyOwnership: { owner_id: 'owner-a' },
  useUpdatePropertyOwnership: { ownershipId: 'ownership-a', input: { ownership_percentage: 50 } },
  useEndPropertyOwnership: { ownershipId: 'ownership-a', input: { expected_updated_at: '2026-10-12T00:00:00Z' } },
};
for (const [hook, command] of Object.entries(nonMedia)) {
  test(`${hook} pins actor and suppresses callbacks after token-resolution scope loss`, async () => {
    const f = fixture(); f.state.authBarrier = deferred();
    let callbacks = 0;
    const pending = f.render(hook).mutateAsync(command, { onError: () => callbacks++ });
    await f.state.requestStarted.promise;
    f.auth.user.id = 'actor-b'; f.auth.tenantContext.userId = 'actor-b'; f.render(hook);
    f.state.authBarrier.resolve();
    await assert.rejects(pending);
    assert.equal(f.requests.length, 0); assert.equal(f.messages.length, 0); assert.equal(callbacks, 0);
  });
  test(`${hook} retains its normal successful operation and caller variables`, async () => {
    const f = fixture(); let variables;
    await f.render(hook).mutateAsync(command, { onSuccess: (_data, input) => { variables = input } });
    assert.equal(variables, command); assert.equal(f.requests.length, 1); assert.equal(f.messages.length, 1);
    assert.equal(f.requests[0].expectedUserId, 'actor-a'); assert.equal(f.requests[0].organizationId, 'org-a');
  });
}

for (const [hook, command] of [['useDeletePropertyAsset', commands.useDeletePropertyAsset], ['useUpsertPropertyOffer', nonMedia.useUpsertPropertyOffer]]) {
  test(`${hook} stops a new login session for the same actor before sending`, async () => {
    const f = fixture(); f.state.authBarrier = deferred();
    const pending = f.render(hook).mutateAsync(command);
    await f.state.requestStarted.promise;
    f.state.sessionId = 'another-session-for-actor-a';
    f.state.authBarrier.resolve();
    await assert.rejects(pending); assert.equal(f.requests.length, 0); assert.equal(f.messages.length, 0);
  });
}

const developmentCommands = {
  useCreatePropertyDevelopment: { name: 'Synthetic' },
  useCreatePropertyDevelopmentPhase: { name: 'Synthetic' },
  useCreatePropertyDevelopmentBuilding: { name: 'Synthetic' },
  useCreatePropertyDevelopmentFloorPlan: { name: 'Synthetic' },
  useBulkCreatePropertyDevelopmentUnits: { units: [] },
  useUpdatePropertyDevelopmentUnit: { unitId: 'unit-a', input: {} },
  useLinkPropertyDevelopmentUnit: { unitId: 'unit-a', input: { property_id: 'property-a' } },
  usePromotePropertyDevelopmentUnit: { unitId: 'unit-a', input: {} },
  useUnlinkPropertyDevelopmentUnit: { unitId: 'unit-a', input: {} },
  useActivatePropertyDevelopmentPriceTable: { priceTableId: 'table-a', expected_updated_at: '2026-10-12T00:00:00Z' },
  useCreatePropertyDevelopmentReservation: { unitId: 'unit-a', input: {} },
  useCancelPropertyDevelopmentReservation: { reservationId: 'reservation-a', input: {} },
  useConvertPropertyDevelopmentReservation: { reservationId: 'reservation-a', input: {} },
  useExtendPropertyDevelopmentReservation: { reservationId: 'reservation-a', input: {} },
  useUpdatePropertyDevelopmentUnitPrice: { unitId: 'unit-a', input: {} },
  usePublishPropertyOnSite: { expected_updated_at: '2026-10-12T00:00:00Z' },
  useUnpublishPropertyFromSite: { expected_updated_at: '2026-10-12T00:00:00Z' },
  useRetryPropertyPublication: { expected_updated_at: '2026-10-12T00:00:00Z' },
};
for (const [hook, input] of Object.entries(developmentCommands)) {
  test(`${hook}: Query yield cannot rebind a gesture to another actor`, async () => {
    const f = fixture(); const pending = f.render(hook).mutateAsync(input);
    f.auth.user.id = 'actor-b'; f.auth.tenantContext.userId = 'actor-b'; f.render(hook);
    await assert.rejects(pending); assert.equal(f.requests.length, 0); assert.equal(f.messages.length, 0);
  });
  test(`${hook}: new session blocks dispatch while the actor remains unchanged`, async () => {
    const f = fixture(); f.state.authBarrier = deferred(); const pending = f.render(hook).mutateAsync(input);
    await f.state.requestStarted.promise; f.state.sessionId = 'actor-a-new-login'; f.state.authBarrier.resolve();
    await assert.rejects(pending); assert.equal(f.requests.length, 0); assert.equal(f.messages.length, 0);
  });
  test(`${hook}: unchanged scope dispatches and returns original callback variables`, async () => {
    const f = fixture(); let variables;
    await f.render(hook).mutateAsync(input, { onSuccess: (_data, value) => { variables = value; } });
    assert.equal(variables, input); assert.equal(f.requests.length, 1); assert.equal(f.messages.length, 1);
    assert.equal(f.requests[0].expectedUserId, 'actor-a'); assert.equal(f.requests[0].expectedSessionId, 'actor-a-session');
  });
}
for (const hook of ['useCreatePropertyDevelopment', 'usePublishPropertyOnSite']) {
  test(`${hook}: scope loss during refresh suppresses all late callbacks`, async () => {
    const f = fixture(); f.state.invalidateBarrier = deferred(); let callbacks = 0;
    const pending = f.render(hook).mutateAsync(developmentCommands[hook], { onSuccess: () => callbacks++, onSettled: () => callbacks++ });
    await f.state.invalidateStarted.promise; f.state.sessionId = 'actor-a-new-login'; f.state.invalidateBarrier.resolve();
    await assert.rejects(pending); assert.equal(callbacks, 0); assert.equal(f.messages.length, 0);
  });
}
test('property mutation keeps the original session captured before preflight', async () => {
  const f = fixture(); f.state.sessionId = 'actor-a-new-login'; let dispatches = 0;
  const command = { requestIntent: { expectedUserId: 'actor-a', expectedSessionId: 'actor-a-session' } };
  await assert.rejects(f.renderMutation({ getRequestIntent: input => input.requestIntent,
    mutationFn: async () => { dispatches++; },
  }).mutateAsync(command));
  assert.equal(dispatches, 0);
});
test('property mutation forwards the original start callback once per dispatch', async () => {
  const f = fixture(); let starts = 0;
  const command = { requestIntent: { expectedUserId: 'actor-a', expectedSessionId: 'actor-a-session', onRequestStart: () => starts++ } };
  await f.renderMutation({ getRequestIntent: input => input.requestIntent,
    mutationFn: async (_input, scope) => { scope.requestIntent.onRequestStart(); return 'confirmed'; },
  }).mutateAsync(command);
  assert.equal(starts, 1);
});

test('post-commit scope error retains the original create key for a safe explicit retry', async () => {
  const f = fixture(); const z = require('zod').z;
  const creation = evaluate('lib/properties/property-creation-intent.ts', {
    zod: { z }, '@/lib/validation/properties': { propertyCreateInputSchema: z.object({ title: z.string(), tipo_de_imovel: z.string(), tipo_de_negocio: z.string() }) },
  });
  const rows = new Map(); const storage = { getItem: key => rows.get(key) ?? null, setItem: (key, value) => rows.set(key, value), removeItem: key => rows.delete(key) };
  const body = { title: 'Synthetic', tipo_de_imovel: 'Casa', tipo_de_negocio: 'Venda' };
  const originalKey = '11111111-1111-4111-8111-111111111111';
  const intent = creation.preparePropertyCreationIntent(storage, 'actor-a:org-a:create', body, () => originalKey);
  const committed = new Map();
  const send = async input => {
    committed.set(input.key, 'synthetic-created-id');
    f.state.sessionId = 'actor-a-new-login';
    return committed.get(input.key);
  };
  await assert.rejects(f.renderMutation({ mutationFn: send }).mutateAsync(intent), error => {
    assert.equal(error.code, 'property_action_scope_changed'); assert.equal(error.status, 409);
    if (creation.propertyCreationRejectionCanReset({ wasRetry: false, status: error.status, code: error.code })) {
      creation.forgetPropertyCreationIntent(storage, 'actor-a:org-a:create');
    }
    return true;
  });
  const retry = creation.preparePropertyCreationIntent(storage, 'actor-a:org-a:create', body,
    () => '22222222-2222-4222-8222-222222222222');
  assert.equal(retry.key, originalKey);
  await f.renderMutation({ mutationFn: send }).mutateAsync(retry);
  assert.equal(committed.size, 1);
});
