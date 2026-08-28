import assert from 'node:assert/strict'
import test from 'node:test'
import { getUserFilterLabel } from './user-display'

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
