import assert from 'node:assert/strict'
import test from 'node:test'
import {
  apiLeadListResponseSchema,
  leadCreateInputSchema,
  leadMoveStageInputSchema,
} from './leads'

const ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'

test('aceita uma entrada valida de lead', () => {
  const result = leadCreateInputSchema.safeParse({
    name: 'Maria Silva',
    email: 'maria@example.com',
    pipelineId: ID,
    dealStatus: 'open',
  })

  assert.equal(result.success, true)
})

test('trata email vazio de importacao como ausente', () => {
  const result = leadCreateInputSchema.safeParse({
    name: 'Contato sem email',
    email: '',
  })

  assert.equal(result.success, true)
  if (result.success) assert.equal(result.data.email, undefined)
})

test('rejeita lead perdido sem motivo', () => {
  const result = leadCreateInputSchema.safeParse({
    name: 'Maria Silva',
    dealStatus: 'lost',
  })

  assert.equal(result.success, false)
})

test('rejeita movimentacao para etapa invalida', () => {
  assert.equal(leadMoveStageInputSchema.safeParse({ stageId: 'etapa-invalida' }).success, false)
})

test('valida o contrato da lista de leads', () => {
  const result = apiLeadListResponseSchema.safeParse({
    data: [{
      id: ID,
      organizationId: ORG_ID,
      name: 'Maria Silva',
      source: 'manual',
      status: 'new',
      dealStatus: 'open',
      priority: 'normal',
      reentryCount: 0,
      createdAt: '2026-07-11T12:00:00Z',
      updatedAt: '2026-07-11T12:00:00Z',
    }],
    total: 1,
    limit: 50,
    offset: 0,
  })

  assert.equal(result.success, true)
  assert.equal(apiLeadListResponseSchema.safeParse({ data: [], total: -1, limit: 50, offset: 0 }).success, false)
})
