import assert from 'node:assert/strict'
import test from 'node:test'

import {
  apiLeadCadenceStateResponseSchema,
  leadCadenceStateSchema,
} from './lead-cadence-state'
import { cadenceTaskCompletionInputSchema } from './auxiliary'

const LEAD_ID = '11111111-1111-4111-8111-111111111111'
const STAGE_ID = '22222222-2222-4222-8222-222222222222'
const CYCLE_ID = '33333333-3333-4333-8333-333333333333'
const ENROLLMENT_ID = '44444444-4444-4444-8444-444444444444'
const TEMPLATE_ID = '55555555-5555-4555-8555-555555555555'
const TASK_ID = '66666666-6666-4666-8666-666666666666'

const currentCycleState = {
  lead_id: LEAD_ID,
  deal_status: 'open',
  stage_id: STAGE_ID,
  stage_name: 'Atendimento',
  stage_cycle_id: CYCLE_ID,
  stage_entered_at: '2026-07-31T12:00:00Z',
  cadence_enabled: true,
  enrollment: {
    id: ENROLLMENT_ID,
    template_id: TEMPLATE_ID,
    template_name: 'Atendimento',
    status: 'active',
    started_at: '2026-07-31T12:00:00Z',
  },
  tasks: [{
    id: TASK_ID,
    template_task_id: null,
    position: 0,
    type: 'call',
    title: 'Fazer primeiro contato',
    due_at: '2026-07-31T14:00:00Z',
    status: 'pending',
    is_done: false,
    is_required: true,
    outcome_required: true,
  }],
  summary: {
    total: 1,
    completed: 0,
    pending: 1,
    overdue: 0,
    next_task_id: TASK_ID,
  },
}

test('aceita somente o estado materializado do ciclo atual', () => {
  assert.equal(leadCadenceStateSchema.safeParse(currentCycleState).success, true)
  assert.equal(apiLeadCadenceStateResponseSchema.safeParse({ data: currentCycleState }).success, true)
})

test('aceita etapa sem obrigacao materializada', () => {
  assert.equal(leadCadenceStateSchema.safeParse({
    ...currentCycleState,
    cadence_enabled: false,
    enrollment: null,
    tasks: [],
    summary: {
      total: 0,
      completed: 0,
      pending: 0,
      overdue: 0,
      next_task_id: null,
    },
  }).success, true)
})

test('rejeita tarefa sem id materializado', () => {
  const invalidTask = { ...currentCycleState.tasks[0] } as Record<string, unknown>
  delete invalidTask.id

  assert.equal(leadCadenceStateSchema.safeParse({
    ...currentCycleState,
    tasks: [invalidTask],
  }).success, false)
})

test('conclusao aceita a id exata sem depender de titulo, dia ou tipo', () => {
  const result = cadenceTaskCompletionInputSchema.safeParse({
    leadId: LEAD_ID,
    taskId: TASK_ID,
    outcome: 'answered',
    outcomeNotes: 'Contato realizado',
  })

  assert.equal(result.success, true)
  if (result.success) assert.equal(result.data.dayOffset, undefined)
})

test('conclusao rejeita requisicao sem referencia estavel', () => {
  assert.equal(cadenceTaskCompletionInputSchema.safeParse({
    leadId: LEAD_ID,
    outcome: 'answered',
  }).success, false)
})
