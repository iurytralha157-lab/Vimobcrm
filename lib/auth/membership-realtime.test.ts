import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getTargetedMembershipAccessChange,
  reconcileMembershipAccessChange,
} from './membership-realtime';

const baseEvent = {
  type: 'access.membership.changed',
  organizationId: 'organization-a',
  userId: 'user-a',
  data: {
    targetUserId: 'user-a',
    isActive: false,
    deleted: false,
    revoked: true,
  },
};

test('accepts only membership changes targeted to the current tenant user', () => {
  assert.equal(
    getTargetedMembershipAccessChange(baseEvent, 'user-b', 'organization-a'),
    null,
  );
  assert.equal(
    getTargetedMembershipAccessChange(baseEvent, 'user-a', 'organization-b'),
    null,
  );
  assert.equal(
    getTargetedMembershipAccessChange(
      { ...baseEvent, type: 'access.permissions.changed' },
      'user-a',
      'organization-a',
    ),
    null,
  );
});

test('normalizes disabled, deleted, and reactivated membership states', () => {
  assert.deepEqual(
    getTargetedMembershipAccessChange(baseEvent, 'user-a', 'organization-a'),
    {
      organizationId: 'organization-a',
      targetUserId: 'user-a',
      isActive: false,
      deleted: false,
      revoked: true,
    },
  );

  const deleted = getTargetedMembershipAccessChange({
    ...baseEvent,
    data: { targetUserId: 'user-a', deleted: true },
  }, 'user-a', 'organization-a');
  assert.equal(deleted?.revoked, true);

  const reactivated = getTargetedMembershipAccessChange({
    ...baseEvent,
    data: { targetUserId: 'user-a', isActive: true, revoked: false },
  }, 'user-a', 'organization-a');
  assert.equal(reactivated?.revoked, false);
  assert.equal(reactivated?.isActive, true);
});

test('revocation refreshes organizations and redirects even when refresh fails', async () => {
  const change = getTargetedMembershipAccessChange(baseEvent, 'user-a', 'organization-a');
  assert.ok(change);

  const calls: string[] = [];
  await reconcileMembershipAccessChange(change, {
    invalidateOrganizations: () => calls.push('invalidate-organizations'),
    refreshOrganizations: () => {
      calls.push('refresh-organizations');
      throw new Error('offline');
    },
    refreshAccess: () => calls.push('refresh-access'),
    redirectToOrganizationSelection: () => calls.push('redirect'),
  });

  assert.deepEqual(calls, [
    'invalidate-organizations',
    'refresh-organizations',
    'redirect',
  ]);
});

test('active membership changes refresh access without redirecting', async () => {
  const change = getTargetedMembershipAccessChange({
    ...baseEvent,
    data: { targetUserId: 'user-a', isActive: true, revoked: false },
  }, 'user-a', 'organization-a');
  assert.ok(change);

  const calls: string[] = [];
  await reconcileMembershipAccessChange(change, {
    invalidateOrganizations: () => calls.push('invalidate-organizations'),
    refreshOrganizations: () => calls.push('refresh-organizations'),
    refreshAccess: () => calls.push('refresh-access'),
    redirectToOrganizationSelection: () => calls.push('redirect'),
  });

  assert.deepEqual(calls, [
    'invalidate-organizations',
    'refresh-organizations',
    'refresh-access',
  ]);
});
