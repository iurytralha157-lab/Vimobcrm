import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { QueryClient } from '@tanstack/react-query';
import { createTenantQueryAccessSignature } from '../../lib/access/tenant-query-cache.ts';
import { activateQueryClientAccess, captureQueryClientAccess } from '../../lib/access/query-client-access.ts';
import { getGlobalSignOutSessionId } from '../../lib/auth/global-sign-out.ts';

// Execute the real provider's declarations and hook body. Only its final JSX
// return is replaced with an observation; this does not emulate React or DOM.
function productionProvider(dependencies) {
  const path = new URL('./query-provider.tsx', import.meta.url);
  const source = ts.createSourceFile(path.pathname, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declaration = name => source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  const provider = declaration('QueryProvider'), createClient = declaration('createTenantQueryClient');
  assert.ok(provider?.body && createClient, 'production provider and client factory must exist');
  const statements = provider.body.statements, finalReturn = statements.at(-1);
  assert.ok(ts.isReturnStatement(finalReturn) && ts.isParenthesizedExpression(finalReturn.expression)
    && ts.isJsxElement(finalReturn.expression.expression), 'only the terminal JSX return is omitted');
  const observation = ts.factory.createReturnStatement(ts.factory.createObjectLiteralExpression(
    ['queryClient', 'accessSignature', 'sessionId'].map(name => ts.factory.createShorthandPropertyAssignment(name)),
  ));
  const observedProvider = ts.factory.updateFunctionDeclaration(provider,
    provider.modifiers?.filter(modifier => modifier.kind !== ts.SyntaxKind.ExportKeyword), provider.asteriskToken,
    provider.name, provider.typeParameters, provider.parameters, provider.type,
    ts.factory.createBlock([...statements.slice(0, -1), observation], true));
  const constants = source.statements.filter(node => ts.isVariableStatement(node)
    && node.declarationList.declarations.some(item => ts.isIdentifier(item.name) && item.name.text.startsWith('DEFAULT_QUERY_')));
  assert.equal(constants.length, 2, 'read both production cache defaults');
  const printer = ts.createPrinter();
  const extracted = [...constants, createClient, observedProvider]
    .map(node => printer.printNode(ts.EmitHint.Unspecified, node, source)).join('\n');
  const code = ts.transpileModule(extracted, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None,
  } }).outputText;
  return Function(...Object.keys(dependencies), `${code}\nreturn QueryProvider;`)(...Object.values(dependencies));
}

function session(actor = 'actor-a', sid = 'sid-a', version = 1) {
  return { access_token: `synthetic.${Buffer.from(JSON.stringify({ sub: actor, session_id: sid, version })).toString('base64url')}.synthetic` };
}
function auth() {
  return {
    user: { id: 'actor-a' }, session: session(), profile: { id: 'actor-a' },
    activeOrganization: { organizationId: 'org-a' }, organization: {
      property_edit_policy: 'owner', property_owner_contact_visibility: 'owner',
    },
    tenantContext: { memberRole: 'broker', permissions: ['lead_operate', 'lead_view_own'], enabledModules: ['pipeline'],
      isTeamLeader: false, ledTeamIds: [], ledUserIds: [], ledPipelineIds: [], isSuperAdmin: false },
    isSuperAdmin: false, impersonating: null,
  };
}

function fixture() {
  const slots = [], clients = new Set(), retiredCleanups = [];
  let context = auth(), cursor = 0, pending = [], lifecycleChanges = 0;
  const changed = (previous, next) => !previous || previous.length !== next.length
    || next.some((value, index) => !Object.is(value, previous[index]));
  const Provider = productionProvider({ QueryClient, createTenantQueryAccessSignature,
    activateQueryClientAccess, getGlobalSignOutSessionId, useAuth: () => context,
    useMemo(factory, deps) {
      const index = cursor++, previous = slots[index];
      if (changed(previous?.deps, deps)) slots[index] = { deps: [...deps], value: factory() };
      return slots[index].value;
    },
    useLayoutEffect(setup, deps) {
      const index = cursor++, previous = slots[index];
      if (changed(previous?.deps, deps)) pending.push(() => {
        previous?.cleanup?.();
        if (previous?.cleanup) retiredCleanups.push(previous.cleanup);
        slots[index] = { deps: [...deps], cleanup: setup() };
      });
    },
  });
  return {
    render(next = context) {
      context = next; cursor = 0; pending = [];
      const result = Provider({ children: null });
      if (!clients.has(result.queryClient)) {
        clients.add(result.queryClient);
        for (const method of ['clear', 'resetQueries', 'removeQueries', 'cancelQueries']) {
          const original = result.queryClient[method].bind(result.queryClient);
          result.queryClient[method] = (...args) => { lifecycleChanges++; return original(...args); };
        }
      }
      pending.forEach(commit => commit());
      return result;
    },
    lifecycleChanges: () => lifecycleChanges,
    replayOldCleanups: () => retiredCleanups.forEach(cleanup => cleanup()),
    unmount: () => slots.forEach(slot => slot?.cleanup?.()),
    close() { this.unmount(); clients.forEach(client => client.clear()); },
  };
}

const replacements = [
  ['actor', value => { value.user.id = 'actor-b'; value.profile.id = 'actor-b'; value.session = session('actor-b', 'sid-b'); }],
  ['organization', value => { value.activeOrganization.organizationId = 'org-b'; }],
  ['permissions', value => { value.tenantContext.permissions = ['lead_view_own']; }],
  ['modules', value => { value.tenantContext.enabledModules = []; }],
  ['role', value => { value.tenantContext.memberRole = 'admin'; }],
  ['leadership', value => { value.tenantContext.isTeamLeader = true; value.tenantContext.ledTeamIds = ['team-a']; }],
  ['impersonation', value => { value.impersonating = { orgId: 'org-b' }; }],
  ['property policy', value => { value.organization.property_edit_policy = 'team'; }],
];
for (const [name, replace] of replacements) {
  test(`production QueryProvider retires its client lease after ${name} changes`, () => {
    const f = fixture();
    try {
      const original = f.render(), captured = captureQueryClientAccess(original.queryClient);
      assert.equal(captured(), true);
      original.queryClient.setQueryData(['synthetic'], { retained: true });
      const replacement = auth(); replace(replacement);
      const next = f.render(replacement);
      assert.notEqual(next.accessSignature, original.accessSignature);
      assert.notEqual(next.queryClient, original.queryClient);
      assert.equal(captured(), false);
      assert.equal(captureQueryClientAccess(next.queryClient)(), true);
      assert.deepEqual(original.queryClient.getQueryData(['synthetic']), { retained: true });
      assert.equal(next.queryClient.getQueryData(['synthetic']), undefined);
      assert.equal(f.lifecycleChanges(), 0, 'lease retirement must not clear/reset/remove/cancel queries');
    } finally { f.close(); }
  });
}

test('production QueryProvider retires a SID visit on the same client and never revives it after SID ABA', () => {
  const f = fixture();
  try {
    const first = f.render(), capturedA = captureQueryClientAccess(first.queryClient);
    const replacement = auth(); replacement.session = session('actor-a', 'sid-b');
    const second = f.render(replacement), capturedB = captureQueryClientAccess(second.queryClient);
    assert.equal(first.accessSignature, second.accessSignature);
    assert.equal(first.queryClient, second.queryClient);
    assert.equal(second.sessionId, 'sid-b'); assert.equal(capturedA(), false); assert.equal(capturedB(), true);
    f.render(auth()); f.replayOldCleanups();
    assert.equal(capturedA(), false); assert.equal(capturedB(), false);
    assert.equal(captureQueryClientAccess(first.queryClient)(), true, 'obsolete cleanup cannot retire the new visit');
    assert.equal(f.lifecycleChanges(), 0);
  } finally { f.close(); }
});

test('production QueryProvider preserves its lease and client through token refresh with the same SID', () => {
  const f = fixture();
  try {
    const first = f.render(), captured = captureQueryClientAccess(first.queryClient);
    const refreshed = auth(); refreshed.session = session('actor-a', 'sid-a', 2);
    const next = f.render(refreshed);
    assert.notEqual(refreshed.session.access_token, auth().session.access_token);
    assert.equal(next.queryClient, first.queryClient); assert.equal(captured(), true);
    assert.equal(next.sessionId, 'sid-a'); assert.equal(f.lifecycleChanges(), 0);
  } finally { f.close(); }
});

test('production QueryProvider unmount and permission ABA cannot revive an old lease', () => {
  const f = fixture();
  try {
    const first = f.render(), old = captureQueryClientAccess(first.queryClient);
    const revoked = auth(); revoked.tenantContext.permissions = [];
    const middle = f.render(revoked), revokedVisit = captureQueryClientAccess(middle.queryClient);
    const restored = f.render(auth()), current = captureQueryClientAccess(restored.queryClient);
    assert.equal(restored.accessSignature, first.accessSignature);
    assert.notEqual(restored.queryClient, first.queryClient);
    assert.equal(old(), false); assert.equal(revokedVisit(), false); assert.equal(current(), true);
    f.replayOldCleanups(); assert.equal(current(), true);
    f.unmount(); assert.equal(current(), false);
    assert.equal(captureQueryClientAccess(restored.queryClient)(), false);
    assert.equal(f.lifecycleChanges(), 0);
  } finally { f.close(); }
});

test('production QueryProvider preserves client defaults and ignores ordering-only access changes', () => {
  const f = fixture();
  try {
    const value = auth(); value.tenantContext.enabledModules = ['pipeline', 'agenda'];
    const first = f.render(value), captured = captureQueryClientAccess(first.queryClient);
    const reordered = structuredClone(value);
    reordered.tenantContext.permissions.reverse(); reordered.tenantContext.enabledModules.reverse();
    const next = f.render(reordered);
    assert.equal(next.accessSignature, first.accessSignature); assert.equal(next.queryClient, first.queryClient);
    assert.equal(captured(), true);
    assert.deepEqual(first.queryClient.getDefaultOptions(), {
      queries: { gcTime: 3_600_000, staleTime: 600_000, retry: 1, refetchOnMount: false, refetchOnWindowFocus: false },
      mutations: { retry: false },
    });
    assert.equal(f.lifecycleChanges(), 0);
  } finally { f.close(); }
});
