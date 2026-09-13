import assert from 'node:assert/strict'
import test from 'node:test'

import {
  adminCreateOrganizationInputSchema,
  adminUpdateOrganizationInputSchema,
  adminUpdateUserInputSchema,
} from './admin'

const ID = '11111111-1111-4111-8111-111111111111'

test('admin organization creation accepts only the backend contract', () => {
  assert.equal(
    adminCreateOrganizationInputSchema.safeParse({
      name: 'Imobiliaria Central',
      segment: 'imobiliario',
      adminEmail: 'admin@example.com',
      adminName: 'Administrador',
      planId: ID,
    }).success,
    true,
  )
  assert.equal(
    adminCreateOrganizationInputSchema.safeParse({
      name: 'Imobiliaria Central',
      adminEmail: 'admin@example.com',
      adminName: 'Administrador',
      arbitraryPrivilege: true,
    }).success,
    false,
  )
})

test('admin organization update validates fields and clear flags', () => {
  assert.equal(
    adminUpdateOrganizationInputSchema.safeParse({
      plan_id: null,
      clear_plan_id: true,
      billing_day: 15,
    }).success,
    true,
  )
  assert.equal(adminUpdateOrganizationInputSchema.safeParse({ billing_day: 32 }).success, false)
  assert.equal(adminUpdateOrganizationInputSchema.safeParse({}).success, false)
  assert.equal(adminUpdateOrganizationInputSchema.safeParse({ unknown: 'field' }).success, false)
})

test('admin user update cannot silently accept an unsupported payload', () => {
  assert.equal(adminUpdateUserInputSchema.safeParse({ is_active: false }).success, true)
  assert.equal(adminUpdateUserInputSchema.safeParse({ organization_id: ID }).success, true)
  assert.equal(adminUpdateUserInputSchema.safeParse({ organization_id: null }).success, false)
  assert.equal(adminUpdateUserInputSchema.safeParse({ role: 'super_admin' }).success, false)
})
