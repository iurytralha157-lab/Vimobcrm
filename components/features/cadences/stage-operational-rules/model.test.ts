import assert from 'node:assert/strict'
import test from 'node:test'

import type { AttentionPolicy } from '@/lib/api/attention'
import type { StageOperationalRules } from '@/lib/api/cadences'

import {
  MAX_OPERATIONAL_RULE_MINUTES,
  createTask,
  formatDuration,
  getAttentionPreviewCopy,
  normalizePositions,
  policySuppressesInherited,
  resolveEffectiveAttentionPolicies,
  toDraft,
  toPayload,
} from './model'

const STAGE_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_STAGE_ID = '22222222-2222-4222-8222-222222222222'
const PIPELINE_ID = '33333333-3333-4333-8333-333333333333'
const ORGANIZATION_ID = '44444444-4444-4444-8444-444444444444'

function rulesFixture(): StageOperationalRules {
  return {
    stage_id: STAGE_ID,
    pipeline_id: PIPELINE_ID,
    revision: 7,
    cadence: {
      enabled: true,
      tasks: [
        {
          id: '55555555-5555-4555-8555-555555555555',
          position: 2,
          type: 'message',
          title: 'Segunda ação',
          due_minutes: 1_440,
          is_required: true,
          outcome_required: true,
        },
        {
          id: '66666666-6666-4666-8666-666666666666',
          position: 0,
          type: 'call',
          title: 'Primeira ação',
          due_minutes: 60,
          warning_minutes: 30,
          is_required: true,
          outcome_required: true,
        },
      ],
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

function policyFixture(
  id: string,
  overrides: Partial<AttentionPolicy> = {},
): AttentionPolicy {
  return {
    id,
    organizationId: ORGANIZATION_ID,
    name: `Política ${id}`,
    policyType: 'first_contact',
    status: 'enabled',
    version: 1,
    pipelineId: null,
    pipelineName: null,
    stageId: null,
    stageName: null,
    thresholdMinutes: 60,
    warningMinutes: 30,
    repeatMinutes: null,
    escalationMinutes: null,
    redistributionMinutes: null,
    businessHoursOnly: false,
    createdBy: null,
    createdAt: '2026-09-01T10:00:00.000Z',
    updatedAt: '2026-09-01T10:00:00.000Z',
    ...overrides,
  }
}

test('ordena a cadência no rascunho e recompõe posições no payload', () => {
  const draft = toDraft(rulesFixture())

  assert.deepEqual(
    draft.cadence.tasks.map((task) => [task.title, task.position, task.clientKey]),
    [
      ['Primeira ação', 0, '66666666-6666-4666-8666-666666666666'],
      ['Segunda ação', 1, '55555555-5555-4555-8555-555555555555'],
    ],
  )

  const payload = toPayload({
    ...draft,
    cadence: {
      ...draft.cadence,
      tasks: [draft.cadence.tasks[1], draft.cadence.tasks[0]],
    },
  })

  assert.deepEqual(payload.cadence.tasks.map((task) => task.position), [0, 1])
  assert.equal('clientKey' in payload.cadence.tasks[0], false)
})

test('normaliza posições sem alterar a ordem recebida', () => {
  const draft = toDraft(rulesFixture())
  const reversed = [...draft.cadence.tasks].reverse()

  assert.deepEqual(
    normalizePositions(reversed).map((task) => [task.title, task.position]),
    [
      ['Segunda ação', 0],
      ['Primeira ação', 1],
    ],
  )
})

test('cria a próxima tarefa com defaults e respeita o limite operacional', () => {
  const first = createTask(0)
  const next = createTask(1, 60)
  const capped = createTask(2, MAX_OPERATIONAL_RULE_MINUTES)

  assert.equal(first.due_minutes, 60)
  assert.equal(next.due_minutes, 1_500)
  assert.equal(capped.due_minutes, MAX_OPERATIONAL_RULE_MINUTES)
  assert.match(first.clientKey, /^new-\d+-0$/)
})

test('formata limites da linha do tempo sem mudar unidades históricas', () => {
  assert.equal(formatDuration(undefined), 'Sem limite')
  assert.equal(formatDuration(0), 'Imediatamente')
  assert.equal(formatDuration(60), '1 hora')
  assert.equal(formatDuration(120), '2 horas')
  assert.equal(formatDuration(1_440), '1 dia')
  assert.equal(formatDuration(2_880), '2 dias')
  assert.equal(formatDuration(75), '75 min')
})

test('escolhe política por etapa, pipeline e organização nessa ordem', () => {
  const policies = [
    policyFixture('77777777-7777-4777-8777-777777777777', { version: 9 }),
    policyFixture('88888888-8888-4888-8888-888888888888', {
      pipelineId: PIPELINE_ID,
      status: 'shadow',
    }),
    policyFixture('99999999-9999-4999-8999-999999999999', {
      stageId: STAGE_ID,
      version: 2,
    }),
    policyFixture('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', {
      stageId: OTHER_STAGE_ID,
      version: 99,
    }),
  ]

  const firstContact = resolveEffectiveAttentionPolicies(
    policies,
    STAGE_ID,
    PIPELINE_ID,
  ).find(({ rule }) => rule.policyType === 'first_contact')

  assert.equal(firstContact?.effective?.source, 'stage')
  assert.equal(firstContact?.effective?.policy.id, '99999999-9999-4999-8999-999999999999')
})

test('override pausado bloqueia herança e prevalece no escopo mais específico', () => {
  const pausedOverride = policyFixture('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', {
    stageId: STAGE_ID,
    status: 'paused',
    config: { disabled_override: 'true' },
  })

  const firstContact = resolveEffectiveAttentionPolicies(
    [
      policyFixture('cccccccc-cccc-4ccc-8ccc-cccccccccccc'),
      pausedOverride,
    ],
    STAGE_ID,
    PIPELINE_ID,
  ).find(({ rule }) => rule.policyType === 'first_contact')

  assert.equal(policySuppressesInherited(pausedOverride), true)
  assert.equal(firstContact?.effective?.policy.id, pausedOverride.id)
})

test('texto da prévia mantém a precedência do estado global', () => {
  assert.equal(
    getAttentionPreviewCopy('inherit', 'enabled', {
      engineMode: 'enabled',
      notificationsEnabled: true,
      isLoading: true,
      isError: false,
    }),
    'Verificando como o motor global aplicará as políticas herdadas.',
  )
  assert.equal(
    getAttentionPreviewCopy('local', 'enabled', {
      engineMode: 'disabled',
      notificationsEnabled: true,
      isLoading: false,
      isError: false,
    }),
    'O motor global está desligado; esta regra local não gera itens.',
  )
  assert.equal(
    getAttentionPreviewCopy('local', 'enabled', {
      engineMode: 'enabled',
      notificationsEnabled: false,
      isLoading: false,
      isError: false,
    }),
    'Aparece em Prioridades e atenções, mas as notificações globais estão desativadas.',
  )
})
