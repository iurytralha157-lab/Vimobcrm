import assert from 'node:assert/strict'
import test from 'node:test'
import { buildUniquePipelineStageKey, PIPELINE_STAGE_KEY_MAX_LENGTH } from './pipeline-stage-key'
import { stageOrderItemInputSchema, stagesReorderInputSchema, stageUpdateInputSchema } from './validation/pipelines'

const id = '11111111-1111-4111-8111-111111111111'
const version = '2026-10-20T10:00:00.123456Z'

for (const length of [2, 79, 80, 81, 120]) test(`stage key generation bounds an ASCII name of ${length} characters`, () => {
  const key = buildUniquePipelineStageKey('a'.repeat(length), [])
  assert.equal(PIPELINE_STAGE_KEY_MAX_LENGTH, 80)
  assert.equal(key, 'a'.repeat(Math.min(length, 80)))
  assert.equal(stageOrderItemInputSchema.safeParse({ id, name: 'a'.repeat(length), stageKey: key, isNew: true }).success, true)
})

for (const [name, key] of [
  ['  Qualificação & Atenção  ', 'qualificacao_atencao'],
  ['Ação 🏠 São Paulo', 'acao_sao_paulo'],
  ['🏠🔥', 'coluna'],
  ['---', 'coluna'],
  ['Á'.repeat(120), 'a'.repeat(80)],
]) test(`stage key retains established browser normalization for ${name.slice(0, 24)}`, () => {
  assert.equal(buildUniquePipelineStageKey(name, []), key)
})

for (const nextSuffix of [2, 10, 100]) test(`stage key reserves the complete suffix _${nextSuffix}`, () => {
  const base = 'a'.repeat(80)
  const taken = new Set([base])
  for (let suffix = 2; suffix < nextSuffix; suffix++) {
    const ending = `_${suffix}`
    taken.add(`${base.slice(0, 80 - ending.length)}${ending}`)
  }
  const before = [...taken]
  const ending = `_${nextSuffix}`
  assert.equal(buildUniquePipelineStageKey(base, taken), `${base.slice(0, 80 - ending.length)}${ending}`)
  assert.deepEqual([...taken], before)
})

test('different long names with a shared truncated prefix remain unique', () => {
  const first = buildUniquePipelineStageKey(`${'a'.repeat(80)}x`, [])
  const second = buildUniquePipelineStageKey(`${'a'.repeat(80)}y`, [first])
  assert.equal(second, `${'a'.repeat(78)}_2`)
  assert.notEqual(first, second)
})

test('fallback collisions include existing and archived keys without rewriting them', () => {
  const existing = ['coluna', 'coluna_2', 'historical_'.repeat(12)]
  assert.equal(buildUniquePipelineStageKey('🏠', existing), 'coluna_3')
  assert.equal(existing[2], 'historical_'.repeat(12))
})

test('preserveStageKeys is optional for legacy schema consumers but only literal true is accepted', () => {
  const input = { stages: [{ id, name: 'Renamed stage', expectedUpdatedAt: version }] }
  assert.equal(stagesReorderInputSchema.safeParse(input).success, true)
  assert.equal(stagesReorderInputSchema.safeParse({ ...input, preserveStageKeys: true }).success, true)
  for (const flag of [false, 1, 'true', null]) {
    assert.equal(stagesReorderInputSchema.safeParse({ ...input, preserveStageKeys: flag }).success, false)
  }
})

test('existing identity can be omitted without weakening exact CAS or explicit key validation', () => {
  const existing = { id, name: 'Renamed stage', expectedUpdatedAt: version }
  const parsed = stagesReorderInputSchema.parse({ preserveStageKeys: true, stages: [existing] })
  assert.equal(parsed.stages[0].expectedUpdatedAt, version)
  assert.equal(Object.hasOwn(parsed.stages[0], 'stageKey'), false)
  assert.equal(stagesReorderInputSchema.safeParse({ preserveStageKeys: true, stages: [{ id, name: 'Renamed stage' }] }).success, false)
  assert.equal(stagesReorderInputSchema.safeParse({ preserveStageKeys: true, stages: [{ ...existing, stageKey: 'x'.repeat(81) }] }).success, false)
  assert.equal(stageUpdateInputSchema.safeParse({ expectedUpdatedAt: version, stageKey: 'x'.repeat(80) }).success, true)
  assert.equal(stageUpdateInputSchema.safeParse({ expectedUpdatedAt: version, stageKey: 'x'.repeat(81) }).success, false)
})
