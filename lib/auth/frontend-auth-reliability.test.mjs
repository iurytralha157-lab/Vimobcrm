import assert from 'node:assert/strict';
import { test } from 'node:test';

import { resolveNoMembershipAccountEntry } from './frontend-auth-reliability.ts';

test('active account without memberships enters the empty organization state', () => {
  assert.equal(resolveNoMembershipAccountEntry({
    profileExists: true,
    globallyActive: true,
    isSuperAdmin: false,
  }), 'no_organization');
});

test('global suspension and missing profile never enter the empty organization state', () => {
  assert.equal(resolveNoMembershipAccountEntry({
    profileExists: true,
    globallyActive: false,
    isSuperAdmin: false,
  }), 'globally_suspended');
  assert.equal(resolveNoMembershipAccountEntry({
    profileExists: false,
    globallyActive: false,
    isSuperAdmin: false,
  }), 'missing_profile');
});

test('super administrator without memberships still loads the profile', () => {
  assert.equal(resolveNoMembershipAccountEntry({
    profileExists: true,
    globallyActive: true,
    isSuperAdmin: true,
  }), 'load_super_admin_profile');
});
