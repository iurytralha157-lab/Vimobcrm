import assert from 'node:assert/strict'
import test from 'node:test'
import {
  apiCreateUserResponseSchema,
  createUserInputSchema,
  deleteUserInputSchema,
  updateUserInputSchema,
} from './users'

const ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'

test('aceita cadastro de corretor valido', () => {
  assert.equal(createUserInputSchema.safeParse({
    name: 'Lucas Almeida',
    email: 'lucas@example.com',
    role: 'user',
  }).success, true)
})

test('rejeita email e papel invalidos', () => {
  assert.equal(createUserInputSchema.safeParse({
    name: 'Lucas Almeida',
    email: 'invalido',
    role: 'owner',
  }).success, false)
})

test('preserva o papel de gestor no cadastro e na atualizacao', () => {
  assert.equal(createUserInputSchema.safeParse({
    name: 'Gestora Maria',
    email: 'maria@example.com',
    role: 'manager',
  }).success, true)
  assert.equal(updateUserInputSchema.safeParse({ id: ID, role: 'manager' }).success, true)
})

test('rejeita atualizacao vazia e transferencia invalida', () => {
  assert.equal(updateUserInputSchema.safeParse({ id: ID }).success, false)
  assert.equal(deleteUserInputSchema.safeParse({ userId: ID, transferLeadsToUserId: 'invalido' }).success, false)
})

test('valida resposta de criacao de usuario', () => {
  const result = apiCreateUserResponseSchema.safeParse({
    success: true,
    user: {
      id: ID,
      organization_id: ORG_ID,
      name: 'Lucas Almeida',
      email: 'lucas@example.com',
      role: 'user',
      avatar_url: null,
      is_active: true,
      whatsapp: null,
      created_at: '2026-07-11T12:00:00Z',
      updated_at: '2026-07-11T12:00:00Z',
    },
    whatsappSent: false,
    wasMultiOrg: false,
    wasOrphan: false,
  })

  assert.equal(result.success, true)
})
