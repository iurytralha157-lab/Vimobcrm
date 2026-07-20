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
    teamId: ORG_ID,
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

test('rejeita equipe invalida na criacao do lead', () => {
  assert.equal(leadCreateInputSchema.safeParse({
    name: 'Maria Silva',
    teamId: 'equipe-invalida',
  }).success, false)
})

test('aceita perfil, feedback e varios imoveis na criacao', () => {
  const result = leadCreateInputSchema.safeParse({
    name: 'Maria Silva',
    feedback: 'Busca apartamento para morar.',
    propertyId: ID,
    interestPropertyIds: [ID, ORG_ID],
    interestValue: '650000',
    profile: {
      personType: 'individual',
      gender: 'female',
      socialName: 'Maria',
      birthDate: '1990-04-10',
      cpf: '123.456.789-01',
      rg: '12.345.678-9',
    },
  })

  assert.equal(result.success, true)
})

test('rejeita perfil e lista de imoveis fora do contrato', () => {
  assert.equal(leadCreateInputSchema.safeParse({
    name: 'Empresa Exemplo',
    interestPropertyIds: ['imovel-invalido'],
    profile: { personType: 'company', gender: 'invalid' },
  }).success, false)
})

test('rejeita movimentacao para etapa invalida', () => {
  assert.equal(leadMoveStageInputSchema.safeParse({ stageId: 'etapa-invalida' }).success, false)
})

test('valida a ordem visual separada do relogio da etapa', () => {
  assert.equal(leadMoveStageInputSchema.safeParse({
    stageId: ID,
    boardOrderAt: '2026-07-12T15:30:00Z',
  }).success, true)
  assert.equal(leadMoveStageInputSchema.safeParse({
    stageId: ID,
    boardOrderAt: '',
  }).success, false)
  assert.equal(leadMoveStageInputSchema.safeParse({
    stageId: ID,
    stageEnteredAt: '2026-07-12T15:30:00Z',
  }).success, false)
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
