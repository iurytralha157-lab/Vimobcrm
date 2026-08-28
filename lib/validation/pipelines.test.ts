import assert from 'node:assert/strict'
import test from 'node:test'
import {
  apiStageSchema,
  apiPipelineListResponseSchema,
  pipelineBoardResponseSchema,
  pipelineCreateInputSchema,
  stageCreateInputSchema,
  stageHexColorInputSchema,
  stageUpdateInputSchema,
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

test('valida cor hexadecimal compativel com o seletor de etapa', () => {
  const validResult = stageHexColorInputSchema.safeParse('  #A1b2C3  ')

  assert.equal(validResult.success, true)
  if (validResult.success) assert.equal(validResult.data, '#A1b2C3')

  for (const color of ['#fff', '#11223344', 'red', '112233', '']) {
    assert.equal(stageHexColorInputSchema.safeParse(color).success, false)
  }
})

test('aplica a cor hexadecimal estrita em todas as mutacoes de etapa', () => {
  assert.equal(stageCreateInputSchema.safeParse({
    name: 'Entrada',
    color: '#A1b2C3',
  }).success, true)
  assert.equal(stageUpdateInputSchema.safeParse({ color: null }).success, true)
  assert.equal(stagesReorderInputSchema.safeParse({
    stages: [{ id: ID, name: 'Entrada', color: '#A1b2C3' }],
  }).success, true)

  for (const color of ['#', '#fff', '#11223344', 'red', '112233', '']) {
    assert.equal(stageCreateInputSchema.safeParse({ name: 'Entrada', color }).success, false)
    assert.equal(stageUpdateInputSchema.safeParse({ color }).success, false)
    assert.equal(stagesReorderInputSchema.safeParse({
      stages: [{ id: ID, name: 'Entrada', color }],
    }).success, false)
  }

  const invalidPatch = stageUpdateInputSchema.safeParse({ color: 'red' })
  assert.equal(invalidPatch.success, false)
  if (!invalidPatch.success) {
    assert.match(invalidPatch.error.issues[0]?.message || '', /#RRGGBB/)
  }
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
      is_qualified: true,
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
  if (result.success) assert.equal(result.data.data[0].is_qualified, true)
})

test('exige o marcador de qualificacao no board da pipeline', () => {
  const result = pipelineBoardResponseSchema.safeParse({
    data: [{
      id: ID,
      leads: [],
      total_lead_count: 0,
      has_more: false,
    }],
  })

  assert.equal(result.success, false)
})

test('preserva isQualified no patch e na resposta de etapa', () => {
  const patchResult = stageUpdateInputSchema.safeParse({ isQualified: false })
  assert.equal(patchResult.success, true)
  if (patchResult.success) assert.equal(patchResult.data.isQualified, false)

  const stageResult = apiStageSchema.safeParse({
    id: ID,
    organizationId: ORG_ID,
    pipelineId: ID,
    name: 'Qualificado',
    stageKey: 'qualified',
    position: 1,
    isWon: false,
    isLost: false,
    isQualified: true,
    isActive: true,
    createdAt: '2026-07-11T12:00:00Z',
    updatedAt: '2026-07-11T12:00:00Z',
  })

  assert.equal(stageResult.success, true)
  if (stageResult.success) assert.equal(stageResult.data.isQualified, true)
})

test('rejeita etapa qualificada terminal ou inativa', () => {
  for (const input of [
    { isQualified: true, isWon: true },
    { isQualified: true, isLost: true },
    { isQualified: true, isActive: false },
  ]) {
    assert.equal(stageUpdateInputSchema.safeParse(input).success, false)
  }
})
