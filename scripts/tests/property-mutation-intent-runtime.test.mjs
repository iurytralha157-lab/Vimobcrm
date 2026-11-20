import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import test from 'node:test';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
function evaluate(file, dependencies, globals = {}) {
  const source = ts.transpileModule(readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const compiledModule = { exports: {} };
  vm.runInNewContext(source, { module: compiledModule, exports: compiledModule.exports,
    require: name => { assert.ok(Object.hasOwn(dependencies, name), name); return dependencies[name]; },
    ...globals,
  }, { filename: file });
  return compiledModule.exports;
}

function fixture(expired = true) {
  let now = 0, finishSession;
  const requests = [];
  class FakeDate extends Date { static now() { return now; } }
  const error = evaluate('lib/api/vimob-error.ts', {});
  const client = evaluate('lib/api/vimob-client.ts', {
    '@/lib/supabase/client': { supabase: { auth: {
      getSession: () => new Promise(resolve => { finishSession = resolve; }),
      refreshSession: async () => ({ data: { session: null }, error: null }),
    } } },
    '@/lib/auth/global-sign-out': { getGlobalSignOutSessionId: session => ['token-b', 'token-a-new-session'].includes(session?.access_token) ? 'session-b' : 'session-a' },
    '@/lib/api/vimob-error': error,
    '@/lib/auth/password-recovery': { isPasswordRecoveryAccessToken: () => false },
    '@/lib/local-read-only': { shouldBlockLocalMutation: () => false },
    '@/lib/utils/json': { parseJSONOrNull: value => { try { return JSON.parse(value) } catch { return null } } },
  }, { Headers, URL, AbortController, DOMException, Date: FakeDate, setTimeout, clearTimeout,
    process: { env: { NODE_ENV: 'production', NEXT_PUBLIC_VIMOB_API_URL: 'https://inert.example' } },
    fetch: async (url, options) => {
      const body = options.body ? JSON.parse(options.body) : undefined;
      requests.push({ url, method: options.method, body, actor: options.headers.get('Authorization'), organization: options.headers.get('X-Organization-ID') });
      if (String(url).endsWith('/deletion-impact')) {
        return new Response(JSON.stringify({ data: { linked_leads_count: 2 } }), { status: 200 });
      }
      return new Response(JSON.stringify({ data: { id: 'synthetic-id', units: [] } }), { status: 200 });
    },
  });
  client.setVimobAPIAccessToken('token-a', 'actor-a');
  if (expired) now = 60001;
  const intent = evaluate('lib/api/property-mutation-intent.ts', { '@/lib/api/vimob-client': client });
  const validation = { parseDomainInput: (_schema, input) => input, validateDomainResponse: (_schema, data) => data,
    propertyDevelopmentMaintenanceInputSchema: () => require('zod').z.unknown(), propertyDevelopmentSchema: require('zod').z.unknown() };
  const base = { '@/lib/validation': validation, './vimob-client': client, '@/lib/api/property-mutation-intent': intent };
  const properties = evaluate('lib/api/properties.ts', base).propertiesAPI;
  const workspace = evaluate('lib/api/property-workspace.ts', { ...base,
    '@/lib/supabase/client': { supabase: {} },
    '@/lib/property-media-execution': evaluate('lib/property-media-execution.ts', {}),
  }).propertyWorkspaceAPI;
  const locations = evaluate('lib/api/property-locations.ts', base).propertyLocationsAPI;
  const owners = evaluate('lib/api/property-owners.ts', base).propertyOwnersAPI;
  const catalog = evaluate('lib/api/property-catalog.ts', base).propertyCatalogAPI;
  const developments = evaluate('lib/api/property-developments.ts', { ...base, zod: require('zod') }).propertyDevelopmentsAPI;
  const publications = evaluate('lib/api/property-publications.ts', base).propertyPublicationsAPI;
  return { requests, properties, workspace, locations, owners, catalog, developments, publications,
    switchActor() { client.setVimobAPIAccessToken('token-b', 'actor-b'); finishSession({ data: { session: { access_token: 'token-a', user: { id: 'actor-a' } } }, error: null }) },
    switchSession() { client.setVimobAPIAccessToken('token-a-new-session', 'actor-a'); finishSession({ data: { session: { access_token: 'token-a', user: { id: 'actor-a' } } }, error: null }) },
    refreshToken() { finishSession({ data: { session: { access_token: 'token-a-refreshed', user: { id: 'actor-a' } } }, error: null }) },
  };
}

const commands = {
  delete: f => f.properties.deleteProperty('property-a', { expected_updated_at: '2026-10-12T00:00:00Z' }, 'org-a'),
  update: f => f.properties.updateProperty('property-a', { title: 'Synthetic' }, 'org-a'),
  offer: f => f.workspace.upsertOffer('org-a', 'property-a', 'sale', { price: 100 }),
  key: f => f.workspace.createKey('org-a', 'property-a', { label: 'Synthetic' }),
  keyMovement: f => f.workspace.moveKey('org-a', 'property-a', 'key-a', { movement_type: 'return' }, 'synthetic-key'),
  ownership: f => f.workspace.createOwnership('org-a', 'property-a', { owner_id: 'owner-a' }),
  ownershipEdit: f => f.workspace.updateOwnership('org-a', 'property-a', 'ownership-a', { ownership_percentage: 50 }),
  ownershipEnd: f => f.workspace.endOwnership('org-a', 'property-a', 'ownership-a', {}),
  city: f => f.locations.createCity('org-a', { name: 'Synthetic' }),
  neighborhood: f => f.locations.createNeighborhood('org-a', { name: 'Synthetic', city_id: 'city-a' }),
  condominium: f => f.locations.createCondominium('org-a', { name: 'Synthetic' }),
  owner: f => f.owners.createOwner('org-a', { name: 'Synthetic' }),
  ownerEdit: f => f.owners.updateOwner('org-a', 'owner-a', { name: 'Synthetic', expected_updated_at: '2026-10-12T00:00:00Z' }),
  ownerDeactivate: f => f.owners.deactivateOwner('org-a', 'owner-a', '2026-10-12T00:00:00Z'),
  type: f => f.catalog.createType('org-a', 'Synthetic'),
  feature: f => f.catalog.createFeature('org-a', 'Synthetic'),
  proximity: f => f.catalog.createProximity('org-a', 'Synthetic'),
  seed: f => f.catalog.seedFeatures('org-a', ['Synthetic']),
  development: f => f.developments.create('org-a', { name: 'Synthetic' }),
  phase: f => f.developments.createPhase('org-a', 'development-a', { name: 'Synthetic' }),
  building: f => f.developments.createBuilding('org-a', 'development-a', { name: 'Synthetic' }),
  floorPlan: f => f.developments.createFloorPlan('org-a', 'development-a', { name: 'Synthetic' }),
  bulkUnits: f => f.developments.bulkCreateUnits('org-a', 'development-a', { units: [] }),
  unit: f => f.developments.updateUnit('org-a', 'development-a', 'unit-a', { label: 'Synthetic' }),
  unitLink: f => f.developments.linkUnitProperty('org-a', 'development-a', 'unit-a', {}, 'synthetic-key'),
  unitPromote: f => f.developments.promoteUnitProperty('org-a', 'development-a', 'unit-a', {}, 'synthetic-key'),
  unitUnlink: f => f.developments.unlinkUnitProperty('org-a', 'development-a', 'unit-a', {}, 'synthetic-key'),
  priceActivation: f => f.developments.activatePriceTable('org-a', 'development-a', 'table-a', { expected_updated_at: '2026-10-12T00:00:00Z' }),
  reservation: f => f.developments.createReservation('org-a', 'development-a', 'unit-a', {}, 'synthetic-key'),
  reservationCancel: f => f.developments.cancelReservation('org-a', 'development-a', 'reservation-a', {}),
  reservationConvert: f => f.developments.convertReservation('org-a', 'development-a', 'reservation-a', {}),
  reservationExtend: f => f.developments.extendReservation('org-a', 'development-a', 'reservation-a', {}),
  unitPrice: f => f.developments.updateUnitPrice('org-a', 'development-a', 'unit-a', {}),
  maintenance: f => f.developments.updateMaintenance('org-a', 'development-a', 'development', 'development-a', { name: 'Synthetic' }),
  publishChannel: f => f.publications.publishChannel('org-a', 'property-a', 'site', {}, 'synthetic-key'),
  unpublishChannel: f => f.publications.unpublishChannel('org-a', 'property-a', 'grupo_olx', {}, 'synthetic-key'),
  retryChannel: f => f.publications.retryChannel('org-a', 'property-a', 'site', {}, 'synthetic-key'),
  publishSite: f => f.publications.publishSite('org-a', 'property-a', {}, 'synthetic-key'),
  unpublishSite: f => f.publications.unpublishSite('org-a', 'property-a', {}, 'synthetic-key'),
  retrySite: f => f.publications.retrySite('org-a', 'property-a', {}, 'synthetic-key'),
  publishOLX: f => f.publications.publishGrupoOLX('org-a', 'property-a', {}, 'synthetic-key'),
  unpublishOLX: f => f.publications.unpublishGrupoOLX('org-a', 'property-a', {}, 'synthetic-key'),
  retryOLX: f => f.publications.retryGrupoOLX('org-a', 'property-a', {}, 'synthetic-key'),
};
for (const [name, run] of Object.entries(commands)) {
  test(`${name}: domain API pins the original actor even without an explicit intent`, async () => {
    const f = fixture(); const pending = run(f); f.switchActor();
    await assert.rejects(pending, error => error.code === 'api_request_identity_changed');
    assert.equal(f.requests.length, 0);
  });
  test(`${name}: unchanged actor still sends the original organization and operation`, async () => {
    const f = fixture(false); await run(f);
    assert.equal(f.requests.length, 1); assert.equal(f.requests[0].actor, 'Bearer token-a');
    assert.equal(f.requests[0].organization, 'org-a');
  });
  test(`${name}: new login for the same actor cannot inherit a pending command`, async () => {
    const f = fixture(); const pending = run(f); f.switchSession();
    await assert.rejects(pending, error => error.code === 'api_request_identity_changed');
    assert.equal(f.requests.length, 0);
  });
  test(`${name}: token refresh within the same session preserves the command`, async () => {
    const f = fixture(); const pending = run(f); f.refreshToken(); await pending;
    assert.equal(f.requests.length, 1); assert.equal(f.requests[0].actor, 'Bearer token-a-refreshed');
    assert.equal(f.requests[0].organization, 'org-a');
  });
}

test('property recovery read forwards an explicitly pinned session without a callback guard', async () => {
  const f = fixture();
  const pending = f.properties.getProperty('property-a', 'org-a', { expectedUserId: 'actor-a', expectedSessionId: 'session-a', creationRecovery: true });
  f.switchSession();
  await assert.rejects(pending, error => error.code === 'api_request_identity_changed');
  assert.equal(f.requests.length, 0);
});

test('property deletion carries the checked lead count and keeps the fallback without a count', async () => {
  const f = fixture(false);
  const impact = await f.properties.getPropertyDeletionImpact('property-a', 'org-a', {
    expectedUserId: 'actor-a', expectedSessionId: 'session-a',
  });
  assert.equal(impact.linked_leads_count, 2);
  assert.match(String(f.requests[0].url), /\/v1\/properties\/property-a\/deletion-impact$/);
  assert.equal(f.requests[0].method, 'GET');
  assert.equal(f.requests[0].organization, 'org-a');
  const version = { expected_updated_at: '2026-10-12T00:00:00Z' };
  await f.properties.deleteProperty('property-a', { ...version, expected_linked_leads_count: 2 }, 'org-a');
  await f.properties.deleteProperty('property-a', { ...version, expected_linked_leads_count: 0 }, 'org-a');
  await f.properties.deleteProperty('property-a', version, 'org-a');
  assert.deepEqual(f.requests.slice(1).map(request => request.body), [
    { ...version, expected_linked_leads_count: 2 }, { ...version, expected_linked_leads_count: 0 }, version,
  ]);
});

test('property deletion confirms only a successful impact lookup', async () => {
  const calls = [];
  let impact = { isPending: true, isFetching: true };
  const alertComponents = Object.fromEntries(
    ['AlertDialog', 'AlertDialogAction', 'AlertDialogCancel', 'AlertDialogContent',
      'AlertDialogDescription', 'AlertDialogFooter', 'AlertDialogHeader', 'AlertDialogTitle']
      .map(name => [name, name]),
  );
  const { PropertyDeleteDialog } = evaluate('components/features/properties/PropertyDeleteDialog.tsx', {
    'react/jsx-runtime': require('react/jsx-runtime'),
    'lucide-react': { Loader2: 'Loader2' },
    '@/components/ui/alert-dialog': alertComponents,
    '@/components/ui/button': { Button: 'Button' },
    '@/hooks/use-properties': {
      usePropertyDeletionImpact: () => impact,
      useDeleteProperty: () => ({ isPending: false, mutateAsync: async input => { calls.push(JSON.parse(JSON.stringify(input))); } }),
    },
    '@/lib/property-concurrency': { isPropertyWorkspaceConflict: () => false },
  });
  function descendants(node) {
    if (!node || typeof node !== 'object') return [];
    return [node, ...[node.props?.children].flat().flatMap(descendants)];
  }
  const render = () => descendants(PropertyDeleteDialog({
    property: { id: 'property-a', code: 'A', updated_at: '2026-10-12T00:00:00Z' },
    onClose: () => calls.push('closed'),
  }));
  const action = () => render().find(node => node.type === 'AlertDialogAction');
  const status = () => render().find(node => node.props.role === 'status').props.children;
  const confirm = () => action().props.onClick({ preventDefault() {} });
  assert.equal(action().props.disabled, true);
  confirm();
  assert.deepEqual(calls, []);
  impact = { isError: true, refetch: async () => calls.push('retried') };
  assert.equal(action(), undefined);
  render().find(node => node.type === 'Button').props.onClick();
  assert.deepEqual(calls, ['retried']);
  impact = { isSuccess: true, data: 1 };
  assert.match(status(), /1 lead vinculado/);
  impact = { isSuccess: true, data: 2 };
  assert.match(status(), /2 leads vinculados/);
  impact = { isSuccess: true, isFetching: true, data: 2 };
  assert.equal(action().props.disabled, true);
  impact = { isSuccess: true, data: 0 };
  assert.equal(status(), null);
  assert.equal(action().props.disabled, false);
  confirm();
  await new Promise(setImmediate);
  assert.deepEqual(calls, ['retried', {
    id: 'property-a', expected_updated_at: '2026-10-12T00:00:00Z', expected_linked_leads_count: 0,
  }, 'closed']);
});
