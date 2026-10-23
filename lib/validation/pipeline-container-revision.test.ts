import assert from 'node:assert/strict'
import test from 'node:test'
import { apiPipelineSchema, pipelineDeleteInputSchema, pipelineUpdateInputSchema } from './pipelines'

const revision = '0123456789abcdef'.repeat(4)

test('pipeline writes require an exact opaque revision, never a timestamp or normalized token', () => {
  for (const expectedRevision of [undefined, null, '', '2026-10-16T12:00:00Z', 'a'.repeat(63), 'a'.repeat(65), revision.toUpperCase(), ` ${revision}`]) {
    assert.equal(pipelineDeleteInputSchema.safeParse({ expectedRevision }).success, false)
    assert.equal(pipelineUpdateInputSchema.safeParse({ expectedRevision, name: 'Vendas' }).success, false)
  }
  assert.deepEqual(pipelineDeleteInputSchema.parse({ expectedRevision: revision }), { expectedRevision: revision })
})

test('a revision alone is not an edit; false default and a real rename are edits', () => {
  assert.equal(pipelineUpdateInputSchema.safeParse({ expectedRevision: revision }).success, false)
  assert.equal(pipelineUpdateInputSchema.safeParse({ expectedRevision: revision, isDefault: false }).success, true)
  assert.equal(pipelineUpdateInputSchema.safeParse({ expectedRevision: revision, name: 'Vendas' }).success, true)
})

test('pipeline DELETE rejects extra fields and the child stage revision vocabulary', () => {
  assert.equal(pipelineDeleteInputSchema.safeParse({ expectedUpdatedAt: revision }).success, false)
  assert.equal(pipelineDeleteInputSchema.safeParse({ expectedRevision: revision, name: 'Other' }).success, false)
  assert.equal(pipelineUpdateInputSchema.safeParse({ expectedRevision: revision, name: 'Vendas', isWon: true }).success, false)
})

test('legacy list data stays readable, but a malformed advertised revision fails closed', () => {
  const pipeline = { id: '11111111-1111-4111-8111-111111111111', organizationId: '22222222-2222-4222-8222-222222222222',
    name: 'Vendas', isDefault: true, isActive: true, position: 0,
    createdAt: '2026-10-16T12:00:00Z', updatedAt: '2026-10-16T12:00:00Z' }
  assert.equal(apiPipelineSchema.safeParse(pipeline).success, true)
  assert.equal(apiPipelineSchema.safeParse({ ...pipeline, revision }).success, true)
  assert.equal(apiPipelineSchema.safeParse({ ...pipeline, revision: 'malformed' }).success, false)
})
