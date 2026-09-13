import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getInitials,
  getOrganizationMemberBadgeLabel,
  getOrganizationMemberDisplayLabel,
  getOrganizationMemberRoleLabel,
  getUserFilterLabel,
  isAdministrativeOrganizationRole,
} from './user-display'

test('gera iniciais com perfis explicitos sem misturar fallbacks', () => {
  assert.equal(getInitials('Maria da Silva'), 'MD')
  assert.equal(getInitials('  Maria   Silva  '), 'MS')
  assert.equal(getInitials('Vimob', { singleWordCharacters: 2 }), 'VI')
  assert.equal(getInitials(null, { fallback: 'US' }), 'US')
  assert.equal(
    getInitials(null, { email: 'andre@example.com', stripEmailDomain: true, fallback: 'U' }),
    'A',
  )
})

test('identifica usuario desativado sem perder o nome usado no filtro', () => {
  assert.equal(getUserFilterLabel({ name: 'Maria Silva', is_active: false }), 'Maria Silva (Desativado)')
  assert.equal(getUserFilterLabel({ name: 'Maria Silva', is_active: true }), 'Maria Silva')
})

test('usa email como fallback no filtro de responsavel', () => {
  assert.equal(
    getUserFilterLabel({ name: '  ', email: 'maria@example.com', is_active: false }),
    'maria@example.com (Desativado)',
  )
})

test('diferencia os papeis da organizacao da lideranca de equipe', () => {
  assert.equal(getOrganizationMemberRoleLabel('manager'), 'Gestor')
  assert.equal(getOrganizationMemberRoleLabel('owner'), 'Proprietário')
  assert.equal(getOrganizationMemberDisplayLabel('user', true), 'Líder de equipe')
  assert.equal(getOrganizationMemberDisplayLabel('manager', true), 'Gestor e líder de equipe')
})

test('mantem gestor visivel nos selos compactos da presenca', () => {
  assert.equal(getOrganizationMemberBadgeLabel('manager'), 'GESTOR')
  assert.equal(getOrganizationMemberBadgeLabel('manager', true), 'GESTOR/LÍDER')
  assert.equal(getOrganizationMemberBadgeLabel('user', true), 'LÍDER')
  assert.equal(getOrganizationMemberBadgeLabel('admin', true), 'ADM')
})

test('identifica somente os papeis administrativos da organizacao', () => {
  assert.equal(isAdministrativeOrganizationRole('owner'), true)
  assert.equal(isAdministrativeOrganizationRole('admin'), true)
  assert.equal(isAdministrativeOrganizationRole('manager'), false)
})
