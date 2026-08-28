import assert from 'node:assert/strict'
import test from 'node:test'

import {
  apiStageOperationalRulesResponseSchema,
  updateStageOperationalRulesInputSchema,
  type UpdateStageOperationalRulesInput,
} from './cadences'

const STAGE_ID = '11111111-1111-4111-8111-111111111111'
const PIPELINE_ID = '22222222-2222-4222-8222-222222222222'

function validRules(): UpdateStageOperationalRulesInput {
  return {
    stage_id: STAGE_ID,
    pipeline_id: PIPELINE_ID,
    revision: 0,
    cadence: {
      enabled: true,
      tasks: [{
        position: 0,
        type: 'call',
        title: 'Primeira ligacao',
        due_minutes: 60,
        warning_minutes: 30,
        is_required: true,
        outcome_required: true,
      }],
    },
    attention: {
      source_mode: 'inherit',
      mode: 'shadow',
      first_outreach_minutes: 60,
      warning_minutes: 30,
      business_hours_only: true,
    },
    lifecycle: {
      on_stage_move: 'skip_pending',
      on_won: 'cancel_pending',
      on_lost: 'cancel_pending',
      on_reopen: 'new_cycle',
    },
  }
}

test('aceita etapa sem cadencia e sem obrigacoes', () => {
  const input = validRules()
  input.cadence = { enabled: false, tasks: [] }
  input.attention = {
    source_mode: 'local',
    mode: 'disabled',
    warning_minutes: 0,
    business_hours_only: false,
  }

  assert.equal(updateStageOperationalRulesInputSchema.safeParse(input).success, true)
})

test('exige revisao para impedir sobrescrita concorrente', () => {
  const input = validRules()
  const withoutRevision = { ...input } as Partial<UpdateStageOperationalRulesInput>
  delete withoutRevision.revision

  assert.equal(
    updateStageOperationalRulesInputSchema.safeParse(withoutRevision).success,
    false,
  )
})

test('rejeita aviso de tarefa maior que o prazo', () => {
  const input = validRules()
  input.cadence.tasks[0].warning_minutes = 90

  const result = updateStageOperationalRulesInputSchema.safeParse(input)
  assert.equal(result.success, false)
  if (!result.success) {
    assert.deepEqual(
      result.error.issues[0].path,
      ['cadence', 'tasks', 0, 'warning_minutes'],
    )
  }
})

test('rejeita resultado obrigatorio em tarefa de anotacao', () => {
  const input = validRules()
  input.cadence.tasks[0].type = 'note'

  const result = updateStageOperationalRulesInputSchema.safeParse(input)

  assert.equal(result.success, false)
  if (!result.success) {
    assert.deepEqual(
      result.error.issues[0].path,
      ['cadence', 'tasks', 0, 'outcome_required'],
    )
  }
})

test('rejeita aviso positivo exatamente no prazo', () => {
  const taskInput = validRules()
  taskInput.cadence.tasks[0].warning_minutes = 60
  assert.equal(updateStageOperationalRulesInputSchema.safeParse(taskInput).success, false)

  const attentionInput = validRules()
  attentionInput.attention.warning_minutes = 60
  assert.equal(updateStageOperationalRulesInputSchema.safeParse(attentionInput).success, false)

  const noWarningInput = validRules()
  noWarningInput.cadence.tasks[0].due_minutes = 0
  noWarningInput.cadence.tasks[0].warning_minutes = 0
  noWarningInput.attention.warning_minutes = 0
  assert.equal(updateStageOperationalRulesInputSchema.safeParse(noWarningInput).success, true)
})

test('rejeita posicoes duplicadas na linha do tempo', () => {
  const input = validRules()
  input.cadence.tasks.push({
    ...input.cadence.tasks[0],
    title: 'Segunda ligacao',
  })

  const result = updateStageOperationalRulesInputSchema.safeParse(input)
  assert.equal(result.success, false)
  if (!result.success) {
    assert.deepEqual(
      result.error.issues[0].path,
      ['cadence', 'tasks', 1, 'position'],
    )
  }
})

test('rejeita aviso geral maior que um limite ativo', () => {
  const input = validRules()
  input.attention.warning_minutes = 120

  const result = updateStageOperationalRulesInputSchema.safeParse(input)
  assert.equal(result.success, false)
  if (!result.success) {
    assert.deepEqual(result.error.issues[0].path, ['attention', 'warning_minutes'])
  }
})

test('valida o envelope de resposta das regras operacionais', () => {
  const rules = validRules()
  rules.cadence.template_id = '33333333-3333-4333-8333-333333333333'
  const result = apiStageOperationalRulesResponseSchema.safeParse({
    data: rules,
  })

  assert.equal(result.success, true)
})

test('assume heranca quando source_mode nao vem de um contrato antigo', () => {
  const input = validRules()
  delete input.attention.source_mode

  const result = updateStageOperationalRulesInputSchema.safeParse(input)

  assert.equal(result.success, true)
  if (result.success) {
    assert.equal(result.data.attention.source_mode, 'inherit')
  }
})

test('aceita configuracao local explicita', () => {
  const input = validRules()
  input.attention.source_mode = 'local'
  input.attention.mode = 'enabled'

  const result = updateStageOperationalRulesInputSchema.safeParse(input)

  assert.equal(result.success, true)
  if (result.success) {
    assert.equal(result.data.attention.source_mode, 'local')
  }
})
