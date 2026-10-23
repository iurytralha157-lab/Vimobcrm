import assert from 'node:assert/strict'
import test from 'node:test'
import { propertyDevelopmentMaintenanceInputSchema } from './property-developments'

const version = '2026-10-12T12:00:00.123Z'

test('maintenance rejects unscoped and publication mutations', () => {
  const schema = propertyDevelopmentMaintenanceInputSchema('development')
  for (const field of ['organization_id', 'created_by', 'published_on_site', 'id']) {
    assert.equal(schema.safeParse({ expected_updated_at: version, changes: { [field]: 'forged' } }).success, false)
  }
})

test('maintenance requires a usable version and an explicit change', () => {
  const schema = propertyDevelopmentMaintenanceInputSchema('phase')
  for (const expected_updated_at of ['', ' ', 'invalid']) {
    assert.equal(schema.safeParse({ expected_updated_at, changes: { name: 'Fase corrigida' } }).success, false)
  }
  assert.equal(schema.safeParse({ expected_updated_at: version, changes: {} }).success, false)
  assert.equal(schema.safeParse({ expected_updated_at: version, changes: { name: 'Fase corrigida' } }).success, true)
})

test('maintenance distinguishes nullable attributes from required identity', () => {
  const schema = propertyDevelopmentMaintenanceInputSchema('floor_plan')
  assert.equal(schema.safeParse({ expected_updated_at: version, changes: { description: null } }).success, true)
  assert.equal(schema.safeParse({ expected_updated_at: version, changes: { name: null } }).success, false)
  assert.equal(schema.safeParse({ expected_updated_at: version, changes: { private_area: 0 } }).success, false)
  assert.equal(schema.safeParse({ expected_updated_at: version, changes: { status: 'archived' } }).success, true)
})
