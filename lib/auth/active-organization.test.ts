import assert from 'node:assert/strict'
import test from 'node:test'

import { requireActiveOrganizationId, resolveActiveOrganization } from './active-organization'

const readyInput = {
  userId: 'user-a',
  authInitialized: true,
  authLoading: false,
  organizationsLoaded: true,
  isInitializingOrganization: false,
  organizationId: 'organization-a',
  tenantOrganizationId: 'organization-a',
  profileOrganizationId: 'organization-a',
  organizationsError: null,
}

test('falha fechada quando uma mutacao nao tem organizacao ativa', () => {
  assert.equal(requireActiveOrganizationId('organization-a'), 'organization-a')
  assert.throws(() => requireActiveOrganizationId(null), /Organização não selecionada\./)
  assert.throws(() => requireActiveOrganizationId(undefined), /Organização não selecionada\./)
})

test('does not expose a cached tenant before auth and memberships are stable', () => {
  assert.deepEqual(
    resolveActiveOrganization({ ...readyInput, authInitialized: false }),
    { status: 'resolving', organizationId: null, reason: 'auth' },
  )
  assert.deepEqual(
    resolveActiveOrganization({ ...readyInput, organizationsLoaded: false }),
    { status: 'resolving', organizationId: null, reason: 'organizations' },
  )
})

test('hides the previous tenant for the entire organization switch', () => {
  assert.deepEqual(
    resolveActiveOrganization({
      ...readyInput,
      isInitializingOrganization: true,
      organizationId: 'organization-a',
      tenantOrganizationId: 'organization-a',
      profileOrganizationId: 'organization-a',
    }),
    { status: 'resolving', organizationId: null, reason: 'organization-switch' },
  )
})

test('uses the backend tenant context and rejects conflicting authoritative identities', () => {
  assert.deepEqual(resolveActiveOrganization(readyInput), {
    status: 'ready',
    organizationId: 'organization-a',
    reason: null,
  })
  assert.deepEqual(
    resolveActiveOrganization({
      ...readyInput,
      organizationId: 'organization-a',
      tenantOrganizationId: 'organization-b',
    }),
    { status: 'resolving', organizationId: null, reason: 'identity-mismatch' },
  )
  assert.deepEqual(
    resolveActiveOrganization({
      ...readyInput,
      impersonatedOrganizationId: 'organization-b',
    }),
    { status: 'resolving', organizationId: null, reason: 'identity-mismatch' },
  )
})

test('uses the profile tenant only as a stable compatibility fallback', () => {
  assert.deepEqual(
    resolveActiveOrganization({
      ...readyInput,
      organizationId: null,
      tenantOrganizationId: null,
      profileOrganizationId: 'organization-legacy',
    }),
    { status: 'ready', organizationId: 'organization-legacy', reason: null },
  )
})

test('distinguishes unauthenticated, failed, and absent organization states', () => {
  assert.deepEqual(
    resolveActiveOrganization({ ...readyInput, userId: null }),
    { status: 'missing', organizationId: null, reason: 'unauthenticated' },
  )
  assert.deepEqual(
    resolveActiveOrganization({
      ...readyInput,
      organizationId: null,
      tenantOrganizationId: null,
      profileOrganizationId: null,
      organizationsError: 'failed',
    }),
    { status: 'missing', organizationId: null, reason: 'organization-load-failed' },
  )
  assert.deepEqual(
    resolveActiveOrganization({
      ...readyInput,
      organizationId: null,
      tenantOrganizationId: null,
      profileOrganizationId: null,
    }),
    { status: 'missing', organizationId: null, reason: 'no-active-organization' },
  )
})
