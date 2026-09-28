import assert from 'node:assert/strict'
import { test } from 'node:test'

import { dashboardLeadEntriesResponseSchema } from './dashboard-lead-entries'

const leadId = 'f6a27332-dc07-4309-8256-ac16b9268317'
const entry = {
  entryId: `initial:${leadId}`,
  leadId,
  name: 'TESTE META — NÃO ATENDER',
  occurredAt: '2026-09-27T12:30:00Z',
  source: 'meta',
  campaignName: null,
  pipelineId: '38262880-9dd2-4c81-8b85-fb0ad58c4945',
  pipelineName: 'teste',
  entryType: 'initial',
  leadUrl: `/crm/pipelines?lead=${leadId}`,
}

test('dashboard lista entradas e reentradas com links locais para o card', () => {
  const result = dashboardLeadEntriesResponseSchema.safeParse({
    data: { total: 2, items: [entry, { ...entry, entryId: '38262880-9dd2-4c81-8b85-fb0ad58c4945', entryType: 'reentry' }], hasMore: false, nextCursor: null },
  })
  assert.equal(result.success, true)
})

test('dashboard rejeita link externo e paginação sem cursor', () => {
  assert.equal(dashboardLeadEntriesResponseSchema.safeParse({
    data: { total: 1, items: [{ ...entry, leadUrl: 'https://example.com' }], hasMore: false, nextCursor: null },
  }).success, false)
  assert.equal(dashboardLeadEntriesResponseSchema.safeParse({
    data: { total: 2, items: [entry], hasMore: true, nextCursor: null },
  }).success, false)
})
