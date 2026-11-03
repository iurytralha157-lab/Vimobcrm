import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resolvePostLoginDestination,
  shouldRedirectToSuperAdminHome,
  type PostLoginDestinationInput,
} from './post-login-destination';

const invitation = `/convite/${'a'.repeat(64)}`;
const base: PostLoginDestinationInput = {
  requestedPath: '/inicio',
  isSuperAdmin: false,
  isImpersonating: false,
  hasActiveOrganization: false,
  activeOrganizationCount: 0,
};
const navigate = (path: string) => ({ kind: 'navigate', path });
const select = (redirectTo: string) => ({ kind: 'select-organization', redirectTo });

const cases: Array<[string, Partial<PostLoginDestinationInput>, ReturnType<typeof navigate> | ReturnType<typeof select>]> = [
  ['one organization uses the default home', { activeOrganizationCount: 1 }, navigate('/inicio')],
  ['one organization keeps the requested route and query', { requestedPath: '/settings?tab=x', activeOrganizationCount: 1 }, navigate('/settings?tab=x')],
  ['many organizations go through selection', { requestedPath: '/pipeline?id=1', activeOrganizationCount: 2 }, select('/pipeline?id=1')],
  ['an active organization skips selection', { requestedPath: '/crm', hasActiveOrganization: true, activeOrganizationCount: 2 }, navigate('/crm')],
  ['no organization reaches the selection empty state', { activeOrganizationCount: 0 }, select('/inicio')],
  ['invitation wins for an account without organization', { requestedPath: invitation }, navigate(invitation)],
  ['super admin default goes to the panel', { isSuperAdmin: true }, navigate('/admin')],
  ['super admin with organization still goes to the panel by default', { isSuperAdmin: true, hasActiveOrganization: true, activeOrganizationCount: 1 }, navigate('/admin')],
  ['super admin with many organizations skips selection', { isSuperAdmin: true, activeOrganizationCount: 3 }, navigate('/admin')],
  ['super admin keeps an admin route and query', { isSuperAdmin: true, requestedPath: '/admin/users?page=2' }, navigate('/admin/users?page=2')],
  ['super admin without organization does not open an empty CRM route', { isSuperAdmin: true, requestedPath: '/settings' }, navigate('/admin')],
  ['super admin with organization may open a requested CRM route', { isSuperAdmin: true, hasActiveOrganization: true, requestedPath: '/settings?tab=x' }, navigate('/settings?tab=x')],
  ['super admin home with query still resolves to the panel', { isSuperAdmin: true, hasActiveOrganization: true, requestedPath: '/inicio?x=1' }, navigate('/admin')],
  ['a look-alike admin prefix is not treated as admin', { isSuperAdmin: true, requestedPath: '/administrativo' }, navigate('/admin')],
  ['impersonating super admin follows the tenant rule', { isSuperAdmin: true, isImpersonating: true, hasActiveOrganization: true }, navigate('/inicio')],
  ['super admin invitation still returns to the invitation', { isSuperAdmin: true, requestedPath: invitation }, navigate(invitation)],
];

for (const [name, input, expected] of cases) {
  test(`destination: ${name}`, () => {
    assert.deepEqual(resolvePostLoginDestination({ ...base, ...input }), expected);
  });
}

test('home guard only applies to a super admin without an organization on the user home', () => {
  const guard = (input: Partial<Parameters<typeof shouldRedirectToSuperAdminHome>[0]>) => shouldRedirectToSuperAdminHome({
    pathname: '/inicio', isSuperAdmin: true, isImpersonating: false, hasActiveOrganization: false, ...input,
  });
  assert.equal(guard({}), true);
  assert.equal(guard({ isImpersonating: true }), false);
  assert.equal(guard({ hasActiveOrganization: true }), false);
  assert.equal(guard({ isSuperAdmin: false }), false);
  assert.equal(guard({ pathname: '/settings' }), false);
  assert.equal(guard({ pathname: null }), false);
});
