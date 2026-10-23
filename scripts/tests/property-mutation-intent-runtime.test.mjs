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
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
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
      requests.push({ url, method: options.method, actor: options.headers.get('Authorization'), organization: options.headers.get('X-Organization-ID') });
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
  delete: f => f.properties.deleteProperty('property-a', '2026-10-12T00:00:00Z', 'org-a'),
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
