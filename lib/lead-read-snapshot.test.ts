import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canReuseLeadReadOnMount,
  hasVerifiedLeadReadInCache,
  LEAD_READ_HANDOFF_MAX_AGE_MS,
  matchesVerifiedLeadReadScope,
  type VerifiedLeadRead,
} from './lead-read-snapshot';
import { canOperateLeadFromFreshRead } from './lead-operation-capability';

const read: VerifiedLeadRead = {
  data: { id: 'lead-a', organization_id: 'org-a', assigned_user_id: 'user-a', team_id: 'team-a', can_operate: true },
  organizationId: 'org-a', selectionVersion: 2, visibilityScopeKey: 'user-a:own', confirmedAt: 1_000,
};
const scope = { organizationId: 'org-a', leadId: 'lead-a', selectionVersion: 2, visibilityScopeKey: 'user-a:own' };
const cache = { data: read.data, dataUpdatedAt: 1_000, organizationId: 'org-a', leadId: 'lead-a' };

test('handoff is bound to lead, organization, selection and visibility identity', () => {
  assert.equal(matchesVerifiedLeadReadScope(read, scope), true);
  for (const change of [
    { organizationId: 'org-b' }, { leadId: 'lead-b' }, { selectionVersion: 3 },
    { visibilityScopeKey: 'user-b:own' }, { visibilityScopeKey: 'user-a:team' },
  ]) assert.equal(matchesVerifiedLeadReadScope(read, { ...scope, ...change }), false);
  assert.equal(matchesVerifiedLeadReadScope({ ...read, data: { ...read.data, organization_id: 'org-b' } }, scope), false);
  assert.equal(matchesVerifiedLeadReadScope({ ...read, confirmedAt: NaN }, scope), false);
  assert.equal(matchesVerifiedLeadReadScope(undefined, scope), false);
});

test('old cache and expired or future handoffs require a new mount read', () => {
  assert.equal(canReuseLeadReadOnMount(read, cache, 1_001), true);
  assert.equal(canReuseLeadReadOnMount(read, cache, 1_000 + LEAD_READ_HANDOFF_MAX_AGE_MS), true);
  assert.equal(canReuseLeadReadOnMount(read, cache, 1_001 + LEAD_READ_HANDOFF_MAX_AGE_MS), false);
  assert.equal(canReuseLeadReadOnMount(read, cache, 999), false);
  assert.equal(canReuseLeadReadOnMount(read, { ...cache, dataUpdatedAt: 999 }, 1_001), false);
  assert.equal(canReuseLeadReadOnMount(read, { ...cache, data: undefined }, 1_001), false);
  assert.equal(canReuseLeadReadOnMount(undefined, cache, 1_001), false);
});

test('transfers, tenant changes and revoked capabilities invalidate the handed-off read', () => {
  for (const change of [
    { id: 'lead-b' }, { organization_id: 'org-b' }, { assigned_user_id: 'user-b' },
    { team_id: 'team-b' }, { can_operate: false }, { can_operate: undefined },
  ]) assert.equal(hasVerifiedLeadReadInCache(read, { ...cache, data: { ...read.data, ...change }, dataUpdatedAt: 2_000 }), false);
});

test('verified pre-mount read enables actions only on its matching successful current query', () => {
  const query = { isSuccess: true, isFetchedAfterMount: false, isFetching: false, dataUpdatedAt: cache.dataUpdatedAt, data: read.data };
  assert.equal(canOperateLeadFromFreshRead(true, query), false);
  assert.equal(canOperateLeadFromFreshRead(true, query, read), true);
  assert.equal(canOperateLeadFromFreshRead(false, query, read), false);
  assert.equal(canOperateLeadFromFreshRead(true, { ...query, isFetching: true }, read), false);
  assert.equal(canOperateLeadFromFreshRead(true, { ...query, isSuccess: false }, read), false);
  assert.equal(canOperateLeadFromFreshRead(true, { ...query, data: { ...read.data, assigned_user_id: 'user-b' } }, read), false);
  const denied = { ...read, data: { ...read.data, can_operate: false } };
  assert.equal(canOperateLeadFromFreshRead(true, { ...query, data: denied.data }, denied), false);
});
