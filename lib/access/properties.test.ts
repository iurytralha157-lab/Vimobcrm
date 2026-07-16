import assert from 'node:assert/strict'
import test from 'node:test'

import {
  canAssignProperties,
  canDeleteProperties,
  canEditPropertyDetails,
  canManageProperties,
  canUpdatePropertyAvailability,
} from './properties'

const member = {
  userId: 'user-1',
  organizationId: 'org-1',
  memberRole: 'user',
  permissions: ['property_view'],
}

test('property_view nunca exibe controles de alteracao', () => {
  assert.equal(canManageProperties(member), false)
  assert.equal(canAssignProperties(member), false)
  assert.equal(canDeleteProperties(member), false)
  assert.equal(canEditPropertyDetails({ ...member, ownerIds: ['user-1'] }), false)
  assert.equal(canUpdatePropertyAvailability(member), false)
})

test('property_manage libera todas as operacoes do catalogo', () => {
  const manager = { ...member, permissions: ['property_view', 'property_manage'] }

  assert.equal(canManageProperties(manager), true)
  assert.equal(canAssignProperties(manager), true)
  assert.equal(canDeleteProperties(manager), true)
  assert.equal(canEditPropertyDetails(manager), true)
  assert.equal(canUpdatePropertyAvailability(manager), true)
})

test('papel manager nao ignora uma permissao efetiva negada', () => {
  assert.equal(canManageProperties({ ...member, memberRole: 'manager' }), false)
})
