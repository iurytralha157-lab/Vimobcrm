import assert from 'node:assert/strict'
import test from 'node:test'
import {
  apiPipelineListResponseSchema,
  pipelineBoardResponseSchema,
  pipelineCreateInputSchema,
  stagesReorderInputSchema,
} from './pipelines'

const ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'

test('normaliza e aceita pipeline valida', () => {
  const result = pipelineCreateInputSchema.safeParse({ name: '  Vendas  ', isDefault: true })

  assert.equal(result.success, true)
  if (result.success) assert.equal(result.data.name, 'Vendas')
})

test('rejeita etapas duplicadas na reordenacao', () => {
  const result = stagesReorderInputSchema.safeParse({
    stages: [
      { id: ID, name: 'Entrada' },
      { id: ID, name: 'Contato' },
    ],
  })

  assert.equal(result.success, false)
})

test('valida resposta de pipelines sem remover extensoes', () => {
  const result = apiPipelineListResponseSchema.safeParse({
    data: [{
      id: ID,
      organizationId: ORG_ID,
      name: 'Vendas',
      isDefault: true,
      isActive: true,
      position: 0,
      createdAt: '2026-07-11T12:00:00Z',
      updatedAt: '2026-07-11T12:00:00Z',
      futureField: 'preservado',
    }],
    futureMeta: true,
  })

  assert.equal(result.success, true)
  if (result.success) assert.equal(result.data.data[0].futureField, 'preservado')
})

test('valida os relogios separados no board da pipeline', () => {
  const result = pipelineBoardResponseSchema.safeParse({
    data: [{
      id: ID,
      leads: [{
        id: ID,
        board_order_at: '2026-07-12T15:30:00Z',
        stage_entered_at: '2026-07-12T14:00:00Z',
      }],
      total_lead_count: 1,
      has_more: false,
    }],
  })

  assert.equal(result.success, true)
})
