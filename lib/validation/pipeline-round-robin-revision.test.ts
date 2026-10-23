import assert from 'node:assert/strict'
import test from 'node:test'
import { pipelineRoundRobinInputSchema } from './pipelines'

const expectedRevision = '0123456789abcdef'.repeat(4)
const roundRobinId = '22222222-2222-4222-8222-222222222222'

test('pipeline fallback assignment and removal require the original opaque revision', () => {
  assert.deepEqual(pipelineRoundRobinInputSchema.parse({ expectedRevision, roundRobinId }), { expectedRevision, roundRobinId })
  assert.deepEqual(pipelineRoundRobinInputSchema.parse({ expectedRevision, roundRobinId: null }), { expectedRevision, roundRobinId: null })
  for (const revision of [undefined, null, '', expectedRevision.toUpperCase(), `${expectedRevision} `, '2026-10-16T12:00:00Z']) {
    assert.equal(pipelineRoundRobinInputSchema.safeParse({ expectedRevision: revision, roundRobinId }).success, false)
  }
})

test('pipeline fallback does not accept omission, extra fields or a stage revision token', () => {
  for (const body of [{ expectedRevision }, { expectedRevision, roundRobinId: '' }, { expectedRevision, roundRobinId: 'invalid' },
    { expectedUpdatedAt: expectedRevision, roundRobinId }, { expectedRevision, roundRobinId, force: true }]) {
    assert.equal(pipelineRoundRobinInputSchema.safeParse(body).success, false)
  }
})
