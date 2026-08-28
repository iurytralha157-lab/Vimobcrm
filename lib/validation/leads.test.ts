import assert from 'node:assert/strict'
import test from 'node:test'
import {
  apiLeadListResponseSchema,
  apiLeadSensitiveProfileResponseSchema,
  leadCreateInputSchema,
  leadMoveStageInputSchema,
  leadUpdateInputSchema,
} from './leads'
import {
  formatPhoneForDisplay,
  formatPhoneForWhatsApp,
  formatPhoneFromParts,
  isValidE164Phone,
  normalizePhoneToE164,
  parsePhoneInput,
} from '../phone-utils'

const ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'

test('normaliza telefone brasileiro local e legado para E.164', () => {
  assert.equal(normalizePhoneToE164('(11) 99999-8888'), '+5511999998888')
  assert.equal(normalizePhoneToE164('5511999998888'), '+5511999998888')
})

test('preserva telefones internacionais explicitos e aceita prefixo 00', () => {
  assert.equal(normalizePhoneToE164('+1 (415) 555-2671'), '+14155552671')
  assert.equal(normalizePhoneToE164('00351 912 345 678'), '+351912345678')
  assert.equal(formatPhoneForWhatsApp('+1 (415) 555-2671'), '14155552671')
  assert.equal(formatPhoneForWhatsApp('+351 912 345 678'), '351912345678')
})

test('phone input emite e interpreta valores E.164', () => {
  assert.equal(formatPhoneFromParts('1', '', '4155552671'), '+14155552671')
  assert.deepEqual(parsePhoneInput('+14155552671'), {
    countryCode: '1',
    ddd: '',
    number: '4155552671',
  })
  assert.deepEqual(parsePhoneInput('+351912345678'), {
    countryCode: '351',
    ddd: '',
    number: '912345678',
  })
})

test('exibe DDI conhecido ou desconhecido sem aplicar o prefixo brasileiro', () => {
  assert.equal(formatPhoneForDisplay('+1 415 555 2671'), '🇺🇸 +1 4155552671')
  assert.equal(formatPhoneForDisplay('+351 912 345 678'), '🇵🇹 +351 912345678')
  assert.equal(formatPhoneForDisplay('+61 412 345 678'), '+61412345678')
  assert.deepEqual(parsePhoneInput('+61412345678'), {
    countryCode: '',
    ddd: '',
    number: '61412345678',
  })
})

test('rejeita telefone estruturalmente invalido e falha fechado para WhatsApp', () => {
  assert.equal(isValidE164Phone('+1234567'), false)
  assert.equal(isValidE164Phone('+0123456789'), false)
  assert.equal(isValidE164Phone('+1234567890123456'), false)
  assert.equal(isValidE164Phone('+55 11 99999-9999 ramal 2'), false)
  assert.equal(normalizePhoneToE164('+55 (11 99999-9999'), null)
  assert.equal(isValidE164Phone('+55 ((11)) 99999-9999'), false)
  assert.equal(formatPhoneForWhatsApp('+55 (11 99999-9999'), '')
})

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

test('normaliza telefones brasileiros e internacionais na criacao', () => {
  const brazilian = leadCreateInputSchema.safeParse({
    name: 'Contato brasileiro',
    phone: '(11) 99999-8888',
  })
  const northAmerican = leadCreateInputSchema.safeParse({
    name: 'Contato internacional',
    phone: '+1 (415) 555-2671',
  })
  const portugueseImport = leadCreateInputSchema.safeParse({
    name: 'Contato importado',
    phone: '00351 912 345 678',
    importMode: true,
  })

  assert.equal(brazilian.success, true)
  assert.equal(northAmerican.success, true)
  assert.equal(portugueseImport.success, true)
  if (brazilian.success) assert.equal(brazilian.data.phone, '+5511999998888')
  if (northAmerican.success) assert.equal(northAmerican.data.phone, '+14155552671')
  if (portugueseImport.success) assert.equal(portugueseImport.data.phone, '+351912345678')
})

test('rejeita telefone fora do contrato E.164', () => {
  assert.equal(leadCreateInputSchema.safeParse({
    name: 'Contato invalido',
    phone: '+1234567',
  }).success, false)
  assert.equal(leadCreateInputSchema.safeParse({
    name: 'Contato invalido',
    phone: '+1234567890123456',
  }).success, false)
  assert.equal(leadUpdateInputSchema.safeParse({
    phone: '+55 11 99999-9999 ramal 2',
  }).success, false)
  assert.equal(leadCreateInputSchema.safeParse({
    name: 'Contato invalido',
    phone: '+55 (11 99999-9999',
  }).success, false)
})

test('preserva null ao remover telefone na edicao', () => {
  const result = leadUpdateInputSchema.safeParse({ phone: null })

  assert.equal(result.success, true)
  if (result.success) assert.equal(result.data.phone, null)
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

test('aceita perfil, equipe e varios imoveis na edicao', () => {
  const result = leadUpdateInputSchema.safeParse({
    teamId: ORG_ID,
    propertyId: ID,
    interestPropertyIds: [ID, ORG_ID],
    profile: {
      personType: 'company',
      corporateName: 'Vimob Negocios Imobiliarios',
      cnpj: '12.345.678/0001-90',
    },
  })

  assert.equal(result.success, true)
  assert.equal(leadUpdateInputSchema.safeParse({
    interestPropertyIds: ['imovel-invalido'],
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

test('valida o contrato protegido de CPF e RG', () => {
  assert.equal(apiLeadSensitiveProfileResponseSchema.safeParse({
    data: { cpf: '12345678901', rg: '123456789' },
  }).success, true)
  assert.equal(apiLeadSensitiveProfileResponseSchema.safeParse({
    data: { cpf: '12345678901', unexpected: 'leak' },
  }).success, false)
})
