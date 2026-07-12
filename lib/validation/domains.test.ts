import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createAutomationInputSchema,
  saveAutomationFlowInputSchema,
} from './automations'
import { createCadenceTaskInputSchema } from './cadences'
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
  gamificationDecisionInputSchema,
  safePathSegmentSchema,
} from './final-domains'
import {
  auditLogCreateInputSchema,
  paymentCheckoutQuerySchema,
  propertyCondominiumInputSchema,
  reportErrorEventInputSchema,
  searchFilterColumnsSchema,
  siteReorderInputSchema,
  webhookCreateInputSchema,
} from './auxiliary'

const ID = '11111111-1111-4111-8111-111111111111'

test('imovel exige titulo e filtros usam UUID valido', () => {
  assert.equal(propertyCreateInputSchema.safeParse({ status: 'active' }).success, false)
  assert.equal(propertyCreateInputSchema.safeParse({ title: 'Apartamento Centro', quartos: 2 }).success, true)
  assert.equal(propertyListQuerySchema.safeParse({ owner_id: 'invalido' }).success, false)
})

test('automacao pode nascer sem nos, mas nao salvar fluxo vazio', () => {
  assert.equal(createAutomationInputSchema.safeParse({
    name: 'Primeiro atendimento',
    trigger_type: 'manual',
    flow_definition: { nodes: [], connections: [], settings: {} },
  }).success, true)
  assert.equal(saveAutomationFlowInputSchema.safeParse({
    flowDefinition: { nodes: [], connections: [], settings: {} },
  }).success, false)
  assert.equal(saveAutomationFlowInputSchema.safeParse({
    flowDefinition: {
      nodes: [{
        id: 'trigger-1',
        type: 'trigger',
        position: { x: 0, y: 0 },
        config: {},
      }],
      connections: [],
      settings: {},
    },
  }).success, true)
})

test('cadencia rejeita dia negativo', () => {
  assert.equal(createCadenceTaskInputSchema.safeParse({
    cadence_template_id: ID,
    day_offset: -1,
    type: 'call',
    title: 'Ligar',
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

test('admin e dashboard rejeitam referencias inseguras', () => {
  assert.equal(safePathSegmentSchema.safeParse('../organizations').success, false)
  assert.equal(adminModuleAccessInputSchema.safeParse({ organizationId: ID, moduleName: 'crm', isEnabled: true }).success, true)
  assert.equal(dashboardFiltersSchema.safeParse({ teamId: 'invalido' }).success, false)
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

test('filtros de busca aceitam apenas nomes de coluna seguros', () => {
  assert.equal(searchFilterColumnsSchema.safeParse(['name', 'lead.email']).success, true)
  assert.equal(searchFilterColumnsSchema.safeParse(['name);drop table leads']).success, false)
})
