import assert from 'node:assert/strict'
import test from 'node:test'

import { apiAutomationNodeSchema } from './automations'
import { stageOperationalCadenceTaskSchema } from './cadences'
import { apiRecordEnvelopeSchema, apiUnknownEnvelopeSchema, uuidSchema } from './common'
import { createHomePublicationInputSchema, updateHomePublicationInputSchema } from './home'
import { publicSiteContactSchema } from './public-site'
import { scheduleDashboardQuerySchema } from './schedule-dashboard'

test('PostgreSQL UUID shape remains compatible with nil and historical non-RFC fixtures', () => {
  for (const id of [
    '00000000-0000-0000-0000-000000000000',
    '11111111-1111-1111-1111-111111111111',
    '11111111-1111-4111-8111-111111111111',
    'FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF',
  ]) {
    assert.equal(uuidSchema.parse(`  ${id}  `), id)
  }
  for (const id of ['', 'not-a-uuid', '11111111-1111-1111-1111-11111111111z', '11111111-1111-1111-1111-111111111111-extra']) {
    assert.equal(uuidSchema.safeParse(id).success, false)
  }
})

test('opaque optional fields remain omittable while record envelopes still require objects', () => {
  assert.deepEqual(apiUnknownEnvelopeSchema.parse({}), {})
  const data = { nullable: null, nested: { enabled: true }, absentValue: undefined }
  assert.deepEqual(apiRecordEnvelopeSchema.parse({ data }), { data })
  assert.equal(apiRecordEnvelopeSchema.safeParse({}).success, false)
  assert.equal(apiRecordEnvelopeSchema.safeParse({ data: [] }).success, false)
  const node = apiAutomationNodeSchema.parse({
    id: '11111111-1111-4111-8111-111111111111',
    automation_id: '22222222-2222-4222-8222-222222222222',
    node_type: 'action', action_type: null, position_x: 0, position_y: 0,
    created_at: '2026-10-24T12:00:00Z',
  })
  assert.equal(Object.prototype.hasOwnProperty.call(node, 'config'), false)
})

test('publication PATCH does not inject creation defaults or accept an empty edit', () => {
  assert.equal(updateHomePublicationInputSchema.safeParse({}).success, false)
  assert.deepEqual(updateHomePublicationInputSchema.parse({ title: '  Nova chamada  ' }), { title: 'Nova chamada' })
  assert.deepEqual(updateHomePublicationInputSchema.parse({ isActive: false }), { isActive: false })
  const created = createHomePublicationInputSchema.parse({
    title: 'Nova chamada', body: 'Texto de teste', ctaLabel: 'Abrir Pipeline', ctaHref: '/crm/pipelines',
  })
  assert.equal(created.cardSize, 'half')
  assert.equal(created.isActive, true)
  assert.equal(created.targetType, 'all')
  assert.deepEqual(created.targetOrganizationIds, [])
})

test('cadence optional text remains an optional key after normalization', () => {
  const input = { position: 0, type: 'call', title: 'Contato', due_minutes: 60, is_required: false, outcome_required: false }
  const task = stageOperationalCadenceTaskSchema.parse(input)
  assert.deepEqual(task, input)
  assert.equal(stageOperationalCadenceTaskSchema.safeParse({ ...input, description: 'x'.repeat(2_001) }).success, false)
})

test('dashboard enum normalization retains its finite literal values', () => {
  const range = { dateFrom: '2026-10-01', dateTo: '2026-10-24' }
  assert.equal(scheduleDashboardQuerySchema.parse({ ...range, eventType: ' VISIT ' }).eventType, 'visit')
  assert.equal(scheduleDashboardQuerySchema.safeParse({ ...range, eventType: 'unexpected' }).success, false)
})

test('privacy consent keeps its exact user-facing message and requires true', () => {
  const consent = publicSiteContactSchema.shape.privacy_accepted
  assert.equal(consent.parse(true), true)
  for (const value of [false, undefined, 'true']) {
    const result = consent.safeParse(value)
    assert.equal(result.success, false)
    if (!result.success) assert.equal(result.error.issues[0].message, 'Aceite a politica de privacidade para continuar')
  }
})
