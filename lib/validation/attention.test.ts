import assert from 'node:assert/strict'
import test from 'node:test'

import {
  apiAttentionItemPageResponseSchema,
  apiAttentionPolicyResponseSchema,
  apiAttentionSettingsResponseSchema,
  createAttentionPolicyInputSchema,
  snoozeAttentionItemInputSchema,
  updateAttentionSettingsInputSchema,
  updateAttentionPolicyInputSchema,
} from './attention'

const ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const STAGE_ID = '33333333-3333-4333-8333-333333333333'

const basePolicyInput = {
  name: 'Primeiro contato em uma hora',
  policyType: 'first_contact' as const,
  status: 'shadow' as const,
  pipelineId: null,
  stageId: null,
  thresholdMinutes: 60,
  warningMinutes: 30,
  repeatMinutes: 1_440,
  escalationMinutes: 1_440,
  redistributionMinutes: null,
  businessHoursOnly: false,
  config: {},
}

test('politica de etapa exige etapa e aviso anterior ao limite', () => {
  assert.equal(createAttentionPolicyInputSchema.safeParse({
    ...basePolicyInput,
    policyType: 'stage_inactivity',
  }).success, false)

  assert.equal(createAttentionPolicyInputSchema.safeParse({
    ...basePolicyInput,
    policyType: 'stage_inactivity',
    stageId: STAGE_ID,
  }).success, true)

  assert.equal(createAttentionPolicyInputSchema.safeParse({
    ...basePolicyInput,
    warningMinutes: 90,
  }).success, false)

  assert.equal(createAttentionPolicyInputSchema.safeParse({
    ...basePolicyInput,
    warningMinutes: 60,
  }).success, false)
  assert.equal(updateAttentionPolicyInputSchema.safeParse({
    thresholdMinutes: 60,
    warningMinutes: 60,
  }).success, false)
})

test('adiamento respeita o intervalo operacional', () => {
  assert.equal(snoozeAttentionItemInputSchema.safeParse({ minutes: 4 }).success, false)
  assert.equal(snoozeAttentionItemInputSchema.safeParse({ minutes: 60 }).success, true)
  assert.equal(snoozeAttentionItemInputSchema.safeParse({ minutes: 43_201 }).success, false)
})

test('contrato aceita politica arquivada para auditoria', () => {
  const result = apiAttentionPolicyResponseSchema.safeParse({
    data: {
      id: ID,
      organizationId: ORG_ID,
      name: 'Versao antiga',
      policyType: 'first_contact',
      status: 'archived',
      version: 2,
      pipelineId: null,
      pipelineName: null,
      stageId: null,
      stageName: null,
      thresholdMinutes: 60,
      warningMinutes: 30,
      repeatMinutes: 1_440,
      escalationMinutes: null,
      redistributionMinutes: null,
      businessHoursOnly: false,
      config: {},
      createdBy: ID,
      createdAt: '2026-07-12T12:00:00Z',
      updatedAt: '2026-07-12T12:00:00Z',
    },
  })

  assert.equal(result.success, true)
})

test('pagina de atencao preserva cursor e contexto operacional', () => {
  const result = apiAttentionItemPageResponseSchema.safeParse({
    data: {
      nextCursor: 'cursor-2',
      items: [{
        id: ID,
        leadId: STAGE_ID,
        leadName: 'Maria Silva',
        policyId: ID,
        policyName: 'Primeiro contato',
        policyType: 'first_contact',
        policyStatus: 'shadow',
        policyVersion: 1,
        status: 'warning',
        assignedUserId: null,
        assignedUserName: null,
        pipelineId: null,
        pipelineName: null,
        stageId: null,
        stageName: null,
        baselineAt: '2026-07-12T12:00:00Z',
        dueAt: '2026-07-12T13:00:00Z',
        reminderCount: 0,
        metadata: { eligibility: 'post_deployment_non_manual' },
        updatedAt: '2026-07-12T12:30:00Z',
      }],
    },
  })

  assert.equal(result.success, true)
  if (result.success) assert.equal(result.data.data.nextCursor, 'cursor-2')
})

test('seguranca global inicia com redistribuicao bloqueada e aceita zero ilimitado', () => {
  const response = apiAttentionSettingsResponseSchema.safeParse({
    data: {
      engineMode: 'shadow',
      notificationsEnabled: false,
      redistributionEnabled: false,
      timezone: 'America/Sao_Paulo',
      defaultRepeatMinutes: 1_440,
      maxReminders: 0,
    },
  })

  assert.equal(response.success, true)
  assert.equal(updateAttentionSettingsInputSchema.safeParse({
    engineMode: 'enabled',
    redistributionEnabled: true,
    maxReminders: 0,
  }).success, true)
  assert.equal(updateAttentionSettingsInputSchema.safeParse({}).success, false)
})
