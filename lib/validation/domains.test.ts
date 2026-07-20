import assert from 'node:assert/strict'
import test from 'node:test'
import {
  apiStartAutomationResponseSchema,
  apiAutomationMediaListResponseSchema,
  apiAutomationRuntimeIssuesResponseSchema,
  createAutomationInputSchema,
  saveAutomationFlowInputSchema,
} from './automations'
import { apiCadenceTemplateSchema, createCadenceTaskInputSchema } from './cadences'
import {
  financialCategoryInputSchema,
  financialContractCreateInputSchema,
  financialEntryCreateInputSchema,
} from './financial'
import { metaFormConfigInputSchema, vistaIntegrationInputSchema } from './integrations'
import { propertyCreateInputSchema, propertyListQuerySchema } from './properties'
import { createScheduleEventInputSchema, scheduleCommentInputSchema } from './schedule'
import { assignUserRoleInputSchema, changePasswordInputSchema, updateOrganizationInputSchema } from './settings'
import {
  addRoundRobinMemberInputSchema,
  availabilityInputSchema,
  contactListQuerySchema,
  dispatchNotificationInputSchema,
} from './crm-support'
import {
  aiAgentConfigSchema,
  aiRunInputSchema,
  adminModuleAccessInputSchema,
  analyticsQuerySchema,
  dashboardFiltersSchema,
  apiGamificationRuleSchema,
  gamificationActionTypeSchema,
  gamificationDecisionInputSchema,
  gamificationEventListQuerySchema,
  gamificationManualEntryInputSchema,
  gamificationMissionInputSchema,
  gamificationRankingQuerySchema,
  gamificationRuleInputSchema,
  safePathSegmentSchema,
} from './final-domains'
import {
  auditLogCreateInputSchema,
  paymentCheckoutQuerySchema,
  propertyCondominiumInputSchema,
  reportErrorEventInputSchema,
  searchFilterColumnsSchema,
  siteReorderInputSchema,
  userActivityPresenceSessionInputSchema,
  userActivitySessionMutationInputSchema,
  webhookCreateInputSchema,
} from './auxiliary'

const ID = '11111111-1111-4111-8111-111111111111'

const validAutomationFlow = {
  nodes: [
    {
      id: 'trigger-1',
      type: 'trigger' as const,
      position: { x: 0, y: 0 },
      config: { trigger_type: 'manual' },
    },
    {
      id: 'message-1',
      type: 'action' as const,
      action_type: 'send_whatsapp' as const,
      position: { x: 200, y: 0 },
      config: { session_id: ID, message: 'Olá {{lead.name}}' },
    },
  ],
  connections: [{ source: 'trigger-1', target: 'message-1' }],
  settings: {},
}

test('imovel exige titulo e filtros usam UUID valido', () => {
  assert.equal(propertyCreateInputSchema.safeParse({ status: 'active' }).success, false)
  assert.equal(propertyCreateInputSchema.safeParse({ title: 'Apartamento Centro', tipo_de_imovel: 'Apartamento', quartos: 2 }).success, true)
  assert.equal(propertyListQuerySchema.safeParse({ owner_id: 'invalido' }).success, false)
})

test('automacao pode nascer como rascunho ou publicar o fluxo atomicamente', () => {
  assert.equal(createAutomationInputSchema.safeParse({
    name: 'Primeiro atendimento',
    trigger_type: 'manual',
  }).success, true)
  assert.equal(createAutomationInputSchema.safeParse({
    name: 'Primeiro atendimento',
    trigger_type: 'manual',
    flow_definition: validAutomationFlow,
  }).success, true)
  assert.equal(createAutomationInputSchema.safeParse({
    name: 'Primeiro atendimento',
    trigger_type: 'manual',
    is_active: true,
  }).success, false)
  assert.equal(saveAutomationFlowInputSchema.safeParse({
    flowDefinition: { nodes: [], connections: [], settings: {} },
  }).success, false)
  assert.equal(saveAutomationFlowInputSchema.safeParse({
    flowDefinition: validAutomationFlow,
  }).success, true)
})

test('automacao rejeita grafo desconectado, ciclico e acao desconhecida', () => {
  assert.equal(saveAutomationFlowInputSchema.safeParse({
    flowDefinition: {
      ...validAutomationFlow,
      nodes: [...validAutomationFlow.nodes, {
        id: 'orphan-1',
        type: 'action' as const,
        action_type: 'send_whatsapp' as const,
        position: { x: 400, y: 0 },
        config: { session_id: ID, message: 'Órfão' },
      }],
    },
  }).success, false)

  assert.equal(saveAutomationFlowInputSchema.safeParse({
    flowDefinition: {
      ...validAutomationFlow,
      connections: [
        ...validAutomationFlow.connections,
        { source: 'message-1', target: 'trigger-1' },
      ],
    },
  }).success, false)

  assert.equal(saveAutomationFlowInputSchema.safeParse({
    flowDefinition: {
      ...validAutomationFlow,
      nodes: validAutomationFlow.nodes.map((node) => node.id === 'message-1'
        ? { ...node, action_type: 'send_email' }
        : node),
    },
  }).success, false)

  assert.equal(saveAutomationFlowInputSchema.safeParse({
    flowDefinition: {
      ...validAutomationFlow,
      nodes: validAutomationFlow.nodes.map((node) => node.id === 'message-1'
        ? {
            ...node,
            action_type: 'set_variable' as const,
            config: { actionType: 'deal_status', deal_status: 'won' },
          }
      : node),
    },
  }).success, false)

  const unsupportedCrmActions = [
    { action_type: 'move_lead' as const, config: { pipeline_id: ID, stage_id: ID } },
    { action_type: 'assign_user' as const, config: { user_id: ID } },
    { action_type: 'set_variable' as const, config: { actionType: 'property_interest', property_id: ID } },
  ]
  for (const unsupportedAction of unsupportedCrmActions) {
    assert.equal(saveAutomationFlowInputSchema.safeParse({
      flowDefinition: {
        ...validAutomationFlow,
        nodes: validAutomationFlow.nodes.map((node) => node.id === 'message-1'
          ? { ...node, ...unsupportedAction }
          : node),
      },
    }).success, false)
  }
})

test('galeria de automacao pagina sem truncar silenciosamente', () => {
  assert.equal(apiAutomationMediaListResponseSchema.safeParse({
    data: { files: [], nextOffset: 50 },
  }).success, true)
  assert.equal(apiAutomationMediaListResponseSchema.safeParse({ data: [] }).success, false)
})

test('inicio de automacao aceita o estado real observado pelo backend', () => {
  const base = {
    executionId: ID,
    automationId: ID,
    automationName: 'Primeiro atendimento',
    executorStarted: true,
    dispatchPending: false,
  }

  for (const status of ['queued', 'running', 'waiting', 'completed', 'cancelled']) {
    assert.equal(apiStartAutomationResponseSchema.safeParse({ data: { ...base, status } }).success, true)
  }
  assert.equal(apiStartAutomationResponseSchema.safeParse({ data: { ...base, status: 'failed' } }).success, false)
})

test('saude das automacoes distingue retry seguro de efeito ambiguo', () => {
  assert.equal(apiAutomationRuntimeIssuesResponseSchema.safeParse({
    data: {
      summary: {
        deadLetters: 1,
        failedEvents: 0,
        failedEffects: 0,
        openCircuits: 0,
        duplicateDecisions: 0,
        unknownEffects: 1,
        staleSendingEffects: 0,
      },
      issues: [{
        id: ID,
        kind: 'ambiguous_effect',
        severity: 'error',
        status: 'unknown',
        automationId: ID,
        automationName: 'Primeiro atendimento',
        executionId: ID,
        leadId: ID,
        message: 'Resultado externo desconhecido',
        details: { effectType: 'send_whatsapp' },
        retryable: false,
        occurredAt: '2026-07-12T12:00:00Z',
      }],
    },
  }).success, true)
})

test('automacao exige audiencia e fuso validos no agendamento', () => {
  const scheduledFlow = {
    ...validAutomationFlow,
    nodes: validAutomationFlow.nodes.map((node) => node.id === 'trigger-1'
      ? {
          ...node,
          config: {
            trigger_type: 'scheduled',
            scheduled_at: '2030-01-01T10:00:00-03:00',
            timezone: 'America/Sao_Paulo',
            target_type: 'lead',
            target_lead_id: ID,
          },
        }
      : node),
  }
  assert.equal(saveAutomationFlowInputSchema.safeParse({ flowDefinition: scheduledFlow }).success, true)
  assert.equal(saveAutomationFlowInputSchema.safeParse({
    flowDefinition: {
      ...scheduledFlow,
      nodes: scheduledFlow.nodes.map((node) => node.id === 'trigger-1'
        ? { ...node, config: { ...node.config, target_lead_id: null } }
        : node),
    },
  }).success, false)
  assert.equal(saveAutomationFlowInputSchema.safeParse({
    flowDefinition: {
      ...scheduledFlow,
      nodes: scheduledFlow.nodes.map((node) => node.id === 'trigger-1'
        ? { ...node, config: { ...node.config, timezone: 'Fuso/Inexistente' } }
        : node),
    },
  }).success, false)
})

test('automacao limita inatividade e espera conforme a unidade', () => {
  const withInactivity = (value: number, unit: 'hours' | 'days') => ({
    ...validAutomationFlow,
    nodes: validAutomationFlow.nodes.map((node) => node.id === 'trigger-1'
      ? { ...node, config: { trigger_type: 'inactivity', inactivity_value: value, inactivity_unit: unit } }
      : node),
  })
  assert.equal(saveAutomationFlowInputSchema.safeParse({ flowDefinition: withInactivity(8760, 'hours') }).success, true)
  assert.equal(saveAutomationFlowInputSchema.safeParse({ flowDefinition: withInactivity(8761, 'hours') }).success, false)
  assert.equal(saveAutomationFlowInputSchema.safeParse({ flowDefinition: withInactivity(365, 'days') }).success, true)
  assert.equal(saveAutomationFlowInputSchema.safeParse({ flowDefinition: withInactivity(366, 'days') }).success, false)

  const withDelay = (days: number) => ({
    nodes: [validAutomationFlow.nodes[0], {
      id: 'delay-1',
      type: 'delay' as const,
      position: { x: 120, y: 0 },
      config: { delay_type: 'days', delay_value: days, stop_on_reply: false },
    }, validAutomationFlow.nodes[1]],
    connections: [
      { source: 'trigger-1', target: 'delay-1' },
      { source: 'delay-1', target: 'message-1', source_handle: 'no_reply', condition_branch: 'no_reply' },
    ],
    settings: {},
  })
  assert.equal(saveAutomationFlowInputSchema.safeParse({ flowDefinition: withDelay(30) }).success, true)
  assert.equal(saveAutomationFlowInputSchema.safeParse({ flowDefinition: withDelay(31) }).success, false)
})

test('cadencia rejeita dia negativo', () => {
  assert.equal(createCadenceTaskInputSchema.safeParse({
    cadence_template_id: ID,
    day_offset: -1,
    type: 'call',
    title: 'Ligar',
  }).success, false)
})

test('cadencia le tarefa historica negativa sem liberar escrita negativa', () => {
  assert.equal(apiCadenceTemplateSchema.safeParse({
    id: ID,
    organization_id: ID,
    pipeline_id: ID,
    stage_id: ID,
    stage_key: 'base',
    name: 'Base',
    is_active: true,
    created_at: '2026-07-12T00:00:00Z',
    tasks: [{
      id: ID,
      cadence_template_id: ID,
      day_offset: -1,
      title: 'Preparar atendimento',
      description: null,
      position: 0,
      type: 'note',
      observation: null,
      recommended_message: null,
    }],
  }).success, true)

  assert.equal(createCadenceTaskInputSchema.safeParse({
    cadence_template_id: ID,
    day_offset: -1,
    type: 'note',
    title: 'Preparar atendimento',
  }).success, false)
})

test('agenda rejeita horario invertido e comentario vazio', () => {
  assert.equal(createScheduleEventInputSchema.safeParse({
    title: 'Visita',
    start_time: '2026-07-12T15:00:00Z',
    end_time: '2026-07-12T14:00:00Z',
  }).success, false)
  assert.equal(scheduleCommentInputSchema.safeParse({ content: '   ' }).success, false)
})

test('financeiro valida categoria, lancamento e contrato', () => {
  assert.equal(financialCategoryInputSchema.safeParse({ name: 'Marketing', type: 'other' }).success, false)
  assert.equal(financialEntryCreateInputSchema.safeParse({ type: 'payable', category: 'Marketing' }).success, false)
  assert.equal(financialContractCreateInputSchema.safeParse({
    contract_type: 'sale',
    client_name: 'Maria Silva',
    value: 500_000,
    property_id: ID,
  }).success, true)
})

test('configuracoes rejeitam senha curta, percentual excessivo e papel invalido', () => {
  assert.equal(changePasswordInputSchema.safeParse({ password: '1234567' }).success, false)
  assert.equal(updateOrganizationInputSchema.safeParse({ default_commission_percentage: 101 }).success, false)
  assert.equal(assignUserRoleInputSchema.safeParse({ userId: ID, roleId: 'invalido' }).success, false)
})

test('integracoes validam URL e referencias da Meta', () => {
  assert.equal(vistaIntegrationInputSchema.safeParse({ api_url: 'nao-e-url', api_key: 'segredo' }).success, false)
  assert.equal(metaFormConfigInputSchema.safeParse({
    integrationId: ID,
    formId: 'form-123',
    propertyId: 'invalido',
  }).success, false)
  assert.equal(metaFormConfigInputSchema.safeParse({
    integrationId: ID,
    formId: 'form-123',
    defaultValues: {},
    fieldMapping: {},
  }).success, true)
})

test('suporte de CRM valida filtros, disponibilidade e distribuicao', () => {
  assert.equal(contactListQuerySchema.safeParse({ teamId: 'invalido' }).success, false)
  assert.equal(availabilityInputSchema.safeParse({
    team_member_id: ID,
    day_of_week: 7,
  }).success, false)
  assert.equal(addRoundRobinMemberInputSchema.safeParse({ weight: 1 }).success, false)
  assert.equal(addRoundRobinMemberInputSchema.safeParse({ userId: ID, weight: 0 }).success, false)
})

test('notificacao exige organizacao e canais conhecidos', () => {
  assert.equal(dispatchNotificationInputSchema.safeParse({
    organization_id: 'invalido',
    variables: {},
    channels: ['sms'],
  }).success, false)
  assert.equal(dispatchNotificationInputSchema.safeParse({
    organization_id: ID,
    variables: {},
    channels: ['system', 'push'],
  }).success, true)
})

test('IA limita temperatura e exige mensagem real', () => {
  assert.equal(aiAgentConfigSchema.safeParse({
    type: 'triage',
    prompt: 'Atenda o lead',
    model: 'gpt-5-mini',
    temperature: 2.1,
    allowedTools: [],
    handoffTargets: [],
    routingKeywords: [],
    isDefault: true,
  }).success, false)
  assert.equal(aiRunInputSchema.safeParse({ message: '   ' }).success, false)
})

test('gamificacao exige motivo ao rejeitar lancamento', () => {
  assert.equal(gamificationDecisionInputSchema.safeParse({ status: 'rejected' }).success, false)
  assert.equal(gamificationDecisionInputSchema.safeParse({ status: 'rejected', reason: 'Duplicado' }).success, true)
})

test('gamificacao usa catalogo fechado e nao aceita pontos negativos', () => {
  assert.equal(gamificationActionTypeSchema.safeParse('sale_closed').success, true)
  assert.equal(gamificationActionTypeSchema.safeParse('evento_inventado').success, false)
  assert.equal(gamificationRuleInputSchema.safeParse({ points: 0, isActive: true }).success, true)
  assert.equal(gamificationRuleInputSchema.safeParse({ points: -1, isActive: true }).success, false)
  assert.equal(gamificationManualEntryInputSchema.safeParse({
    actionKey: 'call_made',
    quantity: 100,
    notes: 'Relatorio anexado',
  }).success, true)
  assert.equal(gamificationManualEntryInputSchema.safeParse({
    actionKey: 'call_made',
    quantity: 101,
    notes: '',
  }).success, false)
  assert.equal(gamificationMissionInputSchema.safeParse({
    title: 'Desafio semanal',
    actionType: 'acao_inexistente',
    targetCount: 10,
    bonusPoints: 50,
    targetScope: 'organization',
  }).success, false)
})

test('ranking da gamificacao usa intervalo meio-aberto e acoes canonicas', () => {
  assert.equal(gamificationRankingQuerySchema.safeParse({
    from: '2026-07-01T03:00:00.000Z',
    to: '2026-08-01T03:00:00.000Z',
    actionTypes: ['call_made', 'message_sent'],
  }).success, true)
  assert.equal(gamificationRankingQuerySchema.safeParse({
    from: '2026-08-01T03:00:00.000Z',
    to: '2026-07-01T03:00:00.000Z',
    actionTypes: [],
  }).success, false)
  assert.equal(gamificationRankingQuerySchema.safeParse({ actionTypes: ['acao_inventada'] }).success, false)
  assert.equal(gamificationEventListQuerySchema.safeParse({ limit: 100, cursor: 'cursor-opaco' }).success, true)
  assert.equal(gamificationEventListQuerySchema.safeParse({ limit: 101 }).success, false)
})

test('gamificacao aceita ids temporarios apenas no contrato de regras', () => {
  assert.equal(apiGamificationRuleSchema.safeParse({
    id: 'default-call_made',
    actionType: 'call_made',
    points: 5,
    isActive: true,
    isTemp: true,
  }).success, true)
  assert.equal(apiGamificationRuleSchema.safeParse({
    id: 'default-evento_inventado',
    actionType: 'evento_inventado',
    points: 5,
    isActive: true,
    isTemp: true,
  }).success, false)
})

test('admin e dashboard rejeitam referencias inseguras', () => {
  assert.equal(safePathSegmentSchema.safeParse('../organizations').success, false)
  assert.equal(adminModuleAccessInputSchema.safeParse({ organizationId: ID, moduleName: 'crm', isEnabled: true }).success, true)
  assert.equal(dashboardFiltersSchema.safeParse({ teamId: 'invalido' }).success, false)
  assert.equal(dashboardFiltersSchema.safeParse({ userId: 'all', teamId: '', source: 'all' }).success, true)
  assert.equal(dashboardFiltersSchema.safeParse({ datePreset: 'last30days' }).success, false)
})

test('analytics aceita somente valores escalares na query', () => {
  assert.equal(analyticsQuerySchema.safeParse({ period: 30, source: 'meta', active: true }).success, true)
  assert.equal(analyticsQuerySchema.safeParse({ filters: { source: 'meta' } }).success, false)
})

test('auditoria exige acao e entidade consistentes', () => {
  assert.equal(auditLogCreateInputSchema.safeParse({ action: '', entity_type: 'lead' }).success, false)
  assert.equal(auditLogCreateInputSchema.safeParse({ action: 'lead.updated', entity_type: 'lead', entity_id: ID }).success, true)
  assert.equal(auditLogCreateInputSchema.safeParse({ action: 'webhook.received', entity_type: 'external', entity_id: 'meta-lead-123' }).success, true)
})

test('checkout publico exige token ou organizacao', () => {
  assert.equal(paymentCheckoutQuerySchema.safeParse({}).success, false)
  assert.equal(paymentCheckoutQuerySchema.safeParse({ organization_id: ID }).success, true)
})

test('condominio valida coordenadas geograficas', () => {
  assert.equal(propertyCondominiumInputSchema.safeParse({ name: 'Centro', latitude: 91 }).success, false)
  assert.equal(propertyCondominiumInputSchema.safeParse({ name: 'Centro', latitude: -23.5, longitude: -46.6 }).success, true)
})

test('site impede reordenacao vazia e posicao negativa', () => {
  assert.equal(siteReorderInputSchema.safeParse({ items: [] }).success, false)
  assert.equal(siteReorderInputSchema.safeParse({ items: [{ id: ID, position: -1 }] }).success, false)
  assert.equal(siteReorderInputSchema.safeParse({ items: [{ id: ID, position: 0 }] }).success, true)
})

test('webhook de saida exige URL valida', () => {
  assert.equal(webhookCreateInputSchema.safeParse({ name: 'CRM externo', type: 'outgoing' }).success, false)
  assert.equal(webhookCreateInputSchema.safeParse({ name: 'CRM externo', type: 'outgoing', webhook_url: 'https://crm.example.com/hook' }).success, true)
})

test('telemetria limita status HTTP e exige mensagem', () => {
  assert.equal(reportErrorEventInputSchema.safeParse({ message: 'Falha', httpStatus: 99 }).success, false)
  assert.equal(reportErrorEventInputSchema.safeParse({ message: 'Falha', httpStatus: 500 }).success, true)
})

test('presenca separa dados da sessao das opcoes do realtime', () => {
  const input = {
    organizationId: ID,
    userId: ID,
    sessionId: 'session_12345678',
    status: 'online' as const,
    heartbeatMs: 60_000,
    getPayload: () => ({ status: 'online' as const }),
    onError: () => undefined,
  }

  assert.equal(userActivitySessionMutationInputSchema.safeParse(input).success, false)
  const parsed = userActivityPresenceSessionInputSchema.parse(input)
  assert.deepEqual(Object.keys(parsed).sort(), ['organizationId', 'sessionId', 'status', 'userId'])
})

test('filtros de busca aceitam apenas nomes de coluna seguros', () => {
  assert.equal(searchFilterColumnsSchema.safeParse(['name', 'lead.email']).success, true)
  assert.equal(searchFilterColumnsSchema.safeParse(['name);drop table leads']).success, false)
})
