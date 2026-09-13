import assert from 'node:assert/strict'
import test from 'node:test'

import {
  canViewOrganizationPresence,
  getTenantEnabledModules,
  getTenantPermissions,
  hasDefaultModule,
  isTenantContextForOrganization,
  type TenantNavigationContext,
} from './tenant-navigation'

const context: TenantNavigationContext = {
  organizationId: 'organization-a',
  memberRole: 'user',
  permissions: ['automations_view'],
  enabledModules: ['crm', 'properties', 'automations', 'unknown-module'],
  isSuperAdmin: false,
}

test('reaproveita apenas o contexto da organizacao ativa', () => {
  assert.equal(isTenantContextForOrganization('organization-a', context), true)
  assert.equal(isTenantContextForOrganization('organization-b', context), false)
  assert.equal(isTenantContextForOrganization(undefined, context), false)
})

test('preserva modulos validos, inclusive os que nao sao padrao', () => {
  assert.deepEqual(getTenantEnabledModules(context), ['crm', 'properties', 'automations'])
  assert.equal(hasDefaultModule('agenda'), true)
  assert.equal(hasDefaultModule('properties'), false)
  assert.equal(hasDefaultModule('automations'), false)
})

test('mantem permissoes explicitas e concede wildcard apenas a administradores', () => {
  assert.deepEqual(getTenantPermissions(context), ['automations_view'])
  assert.deepEqual(getTenantPermissions({ ...context, memberRole: 'owner' }), ['*'])
  assert.deepEqual(getTenantPermissions({ ...context, memberRole: 'admin' }), ['*'])
  assert.deepEqual(getTenantPermissions({ ...context, isSuperAdmin: true }), ['*'])
})

test('libera presenca somente para identidade elegivel no tenant ativo e com permissao', () => {
  const withPresenceGrant = {
    ...context,
    permissions: ['users_presence_view'],
  }

  assert.equal(
    canViewOrganizationPresence('organization-a', withPresenceGrant, true),
    false,
  )
  assert.equal(
    canViewOrganizationPresence(
      'organization-a',
      { ...withPresenceGrant, isTeamLeader: true },
      true,
    ),
    true,
  )
  assert.equal(
    canViewOrganizationPresence(
      'organization-a',
      { ...withPresenceGrant, memberRole: 'admin' },
      true,
    ),
    true,
  )
  assert.equal(
    canViewOrganizationPresence(
      'organization-a',
      { ...withPresenceGrant, memberRole: 'owner' },
      true,
    ),
    true,
  )
  assert.equal(
    canViewOrganizationPresence(
      'organization-a',
      { ...withPresenceGrant, isSuperAdmin: true },
      true,
    ),
    true,
  )
  assert.equal(
    canViewOrganizationPresence(
      'organization-b',
      { ...withPresenceGrant, isTeamLeader: true },
      true,
    ),
    false,
  )
  assert.equal(
    canViewOrganizationPresence(
      'organization-a',
      { ...withPresenceGrant, isTeamLeader: true },
      false,
    ),
    false,
  )
})
