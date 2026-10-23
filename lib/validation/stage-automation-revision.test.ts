import assert from 'node:assert/strict'
import test from 'node:test'
import { stageAutomationInputSchema } from './auxiliary'
import { stageAutomationStatusInputSchema, stageAutomationUpdateInputSchema } from './stage-automation-revision'

const revision = '2026-10-16T15:00:00.123456Z'
const changes = { automation_type: 'change_deal_status_on_enter', deal_status: 'won' }

test('automation edits and status changes require the original exact server revision', () => {
  for (const invalid of [undefined, null, '', 'today', '2026-10-16', '2026-10-16T15:00:00']) {
    assert.equal(stageAutomationUpdateInputSchema.safeParse({ ...changes, expected_updated_at: invalid }).success, false)
    assert.equal(stageAutomationStatusInputSchema.safeParse({ is_active: false, expected_updated_at: invalid }).success, false)
  }
  assert.equal(stageAutomationUpdateInputSchema.safeParse({ expected_updated_at: revision }).success, false)
  assert.equal(stageAutomationStatusInputSchema.safeParse({ expected_updated_at: revision }).success, false)
})

test('revision schemas preserve microseconds and timezone offsets without Date conversion', () => {
  for (const expected_updated_at of [revision, '2026-10-16T15:00:00.123457Z', '2026-10-16T12:00:00.123456-03:00']) {
    assert.equal(stageAutomationUpdateInputSchema.parse({ ...changes, expected_updated_at }).expected_updated_at, expected_updated_at)
    assert.deepEqual(stageAutomationStatusInputSchema.parse({ is_active: false, expected_updated_at }), { is_active: false, expected_updated_at })
  }
})

test('creation keeps its existing contract while revisioned mutations reject extra fields', () => {
  assert.deepEqual(stageAutomationInputSchema.parse(changes), changes)
  assert.equal(stageAutomationInputSchema.safeParse({ ...changes, expected_updated_at: revision }).success, false)
  assert.equal(stageAutomationUpdateInputSchema.safeParse({ ...changes, expected_updated_at: revision, actor_id: 'other' }).success, false)
  assert.equal(stageAutomationStatusInputSchema.safeParse({ is_active: true, expected_updated_at: revision, automation_type: changes.automation_type }).success, false)
  assert.equal(stageAutomationStatusInputSchema.safeParse({ is_active: 'false', expected_updated_at: revision }).success, false)
})
