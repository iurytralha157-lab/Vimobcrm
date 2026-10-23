import assert from 'node:assert/strict'
import test from 'node:test'
import { apiCreateLeadResponseSchema, apiLeadResponseSchema } from './leads'

const ID = '11111111-1111-4111-8111-111111111111'
const OTHER_ID = '22222222-2222-4222-8222-222222222222'
const lead = {
  id: ID, organizationId: OTHER_ID, name: 'Contato sintético', source: 'spreadsheet',
  status: 'new', dealStatus: 'open', priority: 'normal', reentryCount: 0,
  createdAt: '2026-10-12T18:00:00Z', updatedAt: '2026-10-12T18:00:00Z',
}
const receipt = { data: null, leadId: ID, leadVisible: false, reentry: false, distributionOutcome: 'assigned' }

test('criação aceita recibo de persistência fora do escopo sem fabricar um Lead', () => {
  const parsed = apiCreateLeadResponseSchema.parse(receipt)
  assert.equal(parsed.leadId, ID)
  assert.equal(parsed.leadVisible, false)
  assert.equal(parsed.data, null)
  assert.equal(apiCreateLeadResponseSchema.safeParse({ ...receipt, reentry: true }).success, true)
})

test('criação continua aceitando resposta anterior com Lead visível sem novos campos', () => {
  const parsed = apiCreateLeadResponseSchema.parse({ data: lead, reentry: false, distributionOutcome: 'skipped' })
  assert.equal(parsed.leadId, ID)
  assert.equal(parsed.leadVisible, true)
  assert.deepEqual(parsed.data, lead)
})

test('criação rejeita recibos contraditórios ou sem identificação confiável', () => {
  for (const invalid of [
    { ...receipt, leadId: undefined },
    { ...receipt, leadId: 'not-a-uuid' },
    { ...receipt, leadVisible: true },
    { ...receipt, leadVisible: undefined },
    { ...receipt, data: lead },
    { data: lead, leadId: OTHER_ID, leadVisible: true },
    { ...receipt, distributionOutcome: 'unknown' },
  ]) assert.equal(apiCreateLeadResponseSchema.safeParse(invalid).success, false)
})

test('recibo restrito rejeita dados pessoais e nome do responsável', () => {
  for (const extra of [{ assignedUserName: 'Corretor sintético' }, { email: 'synthetic@example.com' }, { name: 'Conteúdo protegido' }]) {
    assert.equal(apiCreateLeadResponseSchema.safeParse({ ...receipt, ...extra }).success, false)
  }
})

test('detalhe e atualização continuam exigindo Lead completo', () => {
  assert.equal(apiLeadResponseSchema.safeParse(receipt).success, false)
  assert.equal(apiLeadResponseSchema.safeParse({ data: { id: ID } }).success, false)
  assert.equal(apiLeadResponseSchema.safeParse({ data: lead }).success, true)
})
