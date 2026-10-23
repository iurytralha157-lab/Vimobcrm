import assert from 'node:assert/strict'
import test from 'node:test'
import {
  MAX_ORGANIZATION_INVITATIONS_PER_BATCH,
  apiUserListResponseSchema,
  deleteUserInputSchema,
  organizationInvitationBatchSchema,
  organizationInvitationRoleInputSchema,
  updateUserInputSchema,
} from './users'

const ID = '11111111-1111-4111-8111-111111111111'

test('catalogue keeps membership and original organization distinct while older user responses remain compatible', () => {
  const home = '22222222-2222-4222-8222-222222222222'
  const user = { id: ID, organization_id: ID, name: 'Synthetic member', email: 'member@example.test', role: 'user', avatar_url: null, is_active: true, whatsapp: null, created_at: '2026-10-12T00:00:00Z', updated_at: '2026-10-12T00:00:00Z' }
  const result = apiUserListResponseSchema.parse({ data: [{ ...user, home_organization_id: home }] })
  assert.equal(result.data[0].organization_id, ID)
  assert.equal(result.data[0].home_organization_id, home)
  assert.equal(apiUserListResponseSchema.safeParse({ data: [user] }).success, true)
  assert.equal(apiUserListResponseSchema.safeParse({ data: [{ ...user, home_organization_id: null }] }).success, true)
  assert.equal(apiUserListResponseSchema.safeParse({ data: [{ ...user, home_organization_id: 'invalid' }] }).success, false)
})

test('preserva o papel de gestor na atualizacao', () => {
  assert.equal(updateUserInputSchema.safeParse({ id: ID, role: 'manager' }).success, true)
})

test('rejeita atualizacao vazia e transferencia invalida', () => {
  assert.equal(updateUserInputSchema.safeParse({ id: ID }).success, false)
  assert.equal(deleteUserInputSchema.safeParse({ userId: ID, transferLeadsToUserId: 'invalido' }).success, false)
})

test('valida e normaliza um lote de convites da organizacao', () => {
  const result = organizationInvitationBatchSchema.safeParse([
    { email: '  maria@example.com  ', role: 'manager' },
    { email: 'joao@example.com', role: 'user' },
  ])

  assert.equal(result.success, true)
  if (result.success) {
    assert.equal(result.data[0]?.email, 'maria@example.com')
  }
})

test('rejeita emails repetidos e lotes acima do limite', () => {
  assert.equal(organizationInvitationBatchSchema.safeParse([
    { email: 'Maria@example.com', role: 'user' },
    { email: 'maria@example.com', role: 'admin' },
  ]).success, false)

  assert.equal(organizationInvitationBatchSchema.safeParse(
    Array.from({ length: MAX_ORGANIZATION_INVITATIONS_PER_BATCH + 1 }, (_, index) => ({
      email: `usuario-${index}@example.com`,
      role: 'user' as const,
    })),
  ).success, false)
})

test('aceita somente papel editavel em convite pendente', () => {
  assert.equal(organizationInvitationRoleInputSchema.safeParse({ role: 'manager' }).success, true)
  assert.equal(organizationInvitationRoleInputSchema.safeParse({ role: 'owner' }).success, false)
  assert.equal(
    organizationInvitationRoleInputSchema.safeParse({ role: 'user', expires_at: new Date().toISOString() }).success,
    false,
  )
})
