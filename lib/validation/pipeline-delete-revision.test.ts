import assert from 'node:assert/strict'
import test from 'node:test'
import { stageDeleteInputSchema } from './pipelines'
import { stageAutomationDeleteInputSchema } from './stage-automation-revision'

const revision = '2026-10-16T15:00:00.123456Z'

test('persisted column and automation deletion require the exact confirmation revision', () => {
  for (const invalid of [undefined, null, '', 'today', '2026-10-16', '2026-10-16T15:00:00']) {
    assert.equal(stageDeleteInputSchema.safeParse({ expectedUpdatedAt: invalid }).success, false)
    assert.equal(stageAutomationDeleteInputSchema.safeParse({ expected_updated_at: invalid }).success, false)
  }
  assert.equal(stageDeleteInputSchema.safeParse({}).success, false)
  assert.equal(stageAutomationDeleteInputSchema.safeParse({}).success, false)
})

test('deletion validation preserves microseconds and offsets verbatim', () => {
  for (const exact of [revision, '2026-10-16T15:00:00.123457Z', '2026-10-16T12:00:00.123456-03:00']) {
    assert.equal(stageDeleteInputSchema.parse({ expectedUpdatedAt: exact }).expectedUpdatedAt, exact)
    assert.equal(stageAutomationDeleteInputSchema.parse({ expected_updated_at: exact }).expected_updated_at, exact)
  }
})

test('deletion bodies reject unrelated fields and the other endpoint revision vocabulary', () => {
  assert.equal(stageDeleteInputSchema.safeParse({ expected_updated_at: revision }).success, false)
  assert.equal(stageAutomationDeleteInputSchema.safeParse({ expectedUpdatedAt: revision }).success, false)
  assert.equal(stageDeleteInputSchema.safeParse({ expectedUpdatedAt: revision, force: true }).success, false)
  assert.equal(stageAutomationDeleteInputSchema.safeParse({ expected_updated_at: revision, force: true }).success, false)
})
