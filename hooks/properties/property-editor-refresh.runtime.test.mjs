import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const root = resolve(import.meta.dirname, '../..');
const require = createRequire(import.meta.url);
const ts = require('typescript');
const query = require('@tanstack/react-query');
const { QueryObserver } = query;
const tick = () => new Promise(done => setTimeout(done, 0));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

function declaration(file, name) {
  const source = readFileSync(resolve(root, file), 'utf8');
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const node = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(node, `real declaration ${name} must exist`);
  return node.getText(ast).replace(/^export /, '');
}
function evaluate(source, bindings) {
  const evaluatedModule = { exports: {} };
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText, { module: evaluatedModule, exports: evaluatedModule.exports, ...bindings });
  return evaluatedModule.exports;
}
function signatureModule() {
  return evaluate(readFileSync(resolve(root, 'lib/access/tenant-query-cache.ts'), 'utf8'), {});
}

// Owning provider/hook declarations and tenant signatures are unchanged source;
// QueryClient/QueryObserver are real. Auth and transport are synthetic, no HTTP.
function fixture() {
  const auth = { user: { id: 'actor-a' }, profile: { id: 'actor-a' },
    activeOrganization: { organizationId: 'org-a', status: 'ready' }, organization: {},
    tenantContext: { userId: 'actor-a', organizationId: 'org-a', memberRole: 'user',
      permissions: ['property_view', 'property_manage'], enabledModules: ['properties'] } };
  const signatures = signatureModule();
  const signature = () => signatures.createTenantQueryAccessSignature({
    userId: auth.user?.id ?? auth.profile?.id, organizationId: auth.activeOrganization.organizationId,
    memberRole: auth.tenantContext.memberRole, permissions: auth.tenantContext.permissions,
    enabledModules: auth.tenantContext.enabledModules,
  });
  const provider = readFileSync(resolve(root, 'components/providers/query-provider.tsx'), 'utf8');
  const defaults = [...provider.matchAll(/^const DEFAULT_QUERY_(?:STALE|GC)_TIME_MS = .*$/gm)].map(match => match[0]).join('\n');
  let client, options;
  const reads = [], server = new Map(), gates = new Map();
  const functions = evaluate(defaults + '\n'
    + declaration('components/providers/query-provider.tsx', 'createTenantQueryClient') + '\n'
    + declaration('hooks/use-properties.ts', 'useProperty')
    + '\nmodule.exports = { createTenantQueryClient, useProperty };', {
    QueryClient: query.QueryClient,
    useOrganizationId: () => auth.activeOrganization.organizationId,
    useAuth: () => auth,
    useUserPermissions: () => ({ hasPermission: permission => auth.tenantContext.permissions.includes(permission) }),
    useTenantQueryAccessSignature: signature,
    useOrganizationModules: () => ({ hasModule: module => auth.tenantContext.enabledModules.includes(module) }),
    useQuery: value => { options = value; return { data: client.getQueryData(value.queryKey) }; },
    propertiesAPI: { getProperty: async (propertyId, organizationId) => {
      reads.push({ propertyId, organizationId, actorId: auth.user?.id });
      if (gates.has(organizationId)) await gates.get(organizationId).promise;
      return { data: server.get(organizationId), error: null };
    } },
  });
  client = functions.createTenantQueryClient(signature());
  const current = (propertyId = 'property-a') => { const hook = functions.useProperty(propertyId); return { hook, options }; };
  const key = () => current().options.queryKey;
  const seed = (revision = 'old') => {
    const organizationId = auth.activeOrganization.organizationId;
    const property = { id: 'property-a', organization_id: organizationId, updated_at: revision };
    client.setQueryData(key(), property); server.set(organizationId, { ...property, updated_at: 'fresh-' + organizationId });
    return property;
  };
  const observe = () => {
    const observer = new QueryObserver(client, current().options);
    const unsubscribe = observer.subscribe(() => {});
    return { observer, unsubscribe };
  };
  const changeScope = (actorId, organizationId) => {
    auth.user = { id: actorId }; auth.profile = { id: actorId };
    auth.activeOrganization.organizationId = organizationId;
    auth.tenantContext = { ...auth.tenantContext, userId: actorId, organizationId };
  };
  const publication = () => evaluate(readFileSync(resolve(root, 'hooks/properties/use-property-publications.ts'), 'utf8'), {
    require: name => {
      const modules = {
        react: { useRef: value => ({ current: value }) },
        '@tanstack/react-query': { ...query, useQueryClient: () => client },
        sonner: { toast: { success() {} } }, '@/contexts/AuthContext': { useAuth: () => auth },
        '@/lib/access/tenant-query-cache': signatures,
        '@/lib/api/property-publications': {
          createPropertyPublicationIdempotencyKey: () => 'synthetic-key',
          propertyPublicationsAPI: Object.fromEntries(['publishChannel', 'unpublishChannel', 'retryChannel'].map(name => [name, async () => ({ data: { publications: [] } })])),
        },
        '@/lib/api/vimob-error': {}, '@/lib/utils/property-publication-polling': {},
        './use-property-workspace': { propertyWorkspaceKeys: { detail: (org, access, id) => ['property-workspace', org, access, id] } },
        '@/hooks/properties/use-property-mutation': { usePropertyMutation: config => ({ mutateAsync: async input => {
          const scope = { requestIntent: {}, isCurrent: () => true };
          const data = await config.mutationFn(input, scope); await config.onSuccess(data, input, scope); return data;
        } }) },
      };
      assert.ok(Object.hasOwn(modules, name), `unexpected publication dependency ${name}`);
      return modules[name];
    },
  });
  return { auth, client, reads, server, gates, current, key, seed, observe, changeScope, publication };
}

for (const invalidate of [false, true]) test(`editor reopening fetches the current revision with inactive cache (invalidated=${invalidate})`, async () => {
  const f = fixture(); let subscription;
  try {
    f.seed();
    if (invalidate) await f.client.invalidateQueries({ queryKey: ['property', 'org-a', 'property-a'] });
    subscription = f.observe(); await tick(); await tick();
    assert.equal(f.reads.length, 1);
    assert.equal(subscription.observer.getCurrentResult().data.updated_at, 'fresh-org-a');
    assert.equal(f.client.getDefaultOptions().queries.refetchOnMount, false, 'global policy remains unchanged');
    subscription.unsubscribe();
    f.server.set('org-a', { ...f.server.get('org-a'), updated_at: 'second-revision' });
    subscription = f.observe(); await tick(); await tick();
    assert.equal(f.reads.length, 2); assert.equal(subscription.observer.getCurrentResult().data.updated_at, 'second-revision');
  } finally { subscription?.unsubscribe(); f.client.clear(); }
});

for (const command of ['usePublishPropertyOnSite', 'useUnpublishPropertyFromSite', 'useRetryPropertyPublication']) {
  test(`${command}: real publication invalidation reaches an inactive editor and reopen refetches`, async () => {
    const f = fixture(); let subscription;
    try {
      f.seed();
      await f.publication()[command]('property-a').mutateAsync({ expected_property_updated_at: 'old', expected_publication_updated_at: null });
      assert.equal(f.client.getQueryState(f.key()).isInvalidated, true);
      assert.equal(f.reads.length, 0, 'invalidating an inactive query does not fetch it');
      subscription = f.observe(); await tick(); await tick();
      assert.deepEqual(f.reads, [{ propertyId: 'property-a', organizationId: 'org-a', actorId: 'actor-a' }]);
      assert.equal(subscription.observer.getCurrentResult().data.updated_at, 'fresh-org-a');
    } finally { subscription?.unsubscribe(); f.client.clear(); }
  });
}

test('late read of the previous actor/tenant cannot replace the current property key', async () => {
  const f = fixture(); const subscriptions = [];
  try {
    f.seed(); const keyA = f.key(); const oldGate = deferred(); f.gates.set('org-a', oldGate);
    const a = f.observe(); subscriptions.push(a.unsubscribe); await tick();
    assert.equal(f.reads.length, 1); a.unsubscribe();
    f.changeScope('actor-b', 'org-b'); f.seed(); const keyB = f.key();
    const b = f.observe(); subscriptions.push(b.unsubscribe); await tick(); await tick();
    assert.notDeepEqual(keyA, keyB);
    assert.equal(b.observer.getCurrentResult().data.organization_id, 'org-b');
    assert.equal(b.observer.getCurrentResult().data.updated_at, 'fresh-org-b');
    oldGate.resolve(); await tick(); await tick();
    assert.equal(b.observer.getCurrentResult().data.organization_id, 'org-b');
    assert.equal(f.client.getQueryData(keyA).organization_id, 'org-a');
    f.changeScope('actor-c', 'org-b'); const keyC = f.key();
    assert.notDeepEqual(keyB, keyC, 'same organization with another actor remains a separate cache key');
  } finally { subscriptions.forEach(unsubscribe => unsubscribe()); f.client.clear(); }
});

for (const denied of ['module', 'permission', 'user']) test(`denied ${denied} does not fetch or expose cached property data`, async () => {
  const f = fixture(); let subscription;
  try {
    if (denied === 'module') f.auth.tenantContext.enabledModules = [];
    if (denied === 'permission') f.auth.tenantContext.permissions = [];
    if (denied === 'user') f.auth.user = null;
    f.seed();
    assert.equal(f.current().hook.data, null);
    subscription = f.observe(); await tick(); await tick();
    assert.equal(f.reads.length, 0);
    assert.equal(f.current().hook.data, null);
  } finally { subscription?.unsubscribe(); f.client.clear(); }
});
