import { z } from 'zod'
import { apiEnvelopeSchema, nonNegativeIntegerSchema, timestampSchema, uuidSchema } from './common'

export const automationTriggerTypeSchema = z.enum([
  'message_received',
  'scheduled',
  'lead_stage_changed',
  'lead_created',
  'tag_added',
  'inactivity',
  'manual',
])
export const automationNodeTypeSchema = z.enum(['trigger', 'action', 'condition', 'delay'])
export const automationMediaTypeSchema = z.enum(['image', 'audio', 'video'])
export const automationActionTypeSchema = z.enum([
  'send_whatsapp',
  'send_image',
  'send_audio',
  'send_video',
  'move_lead',
  'add_tag',
  'remove_tag',
  'assign_user',
  'webhook',
  'set_variable',
])

const automationNodePositionSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
}).strict()

const automationNodeBaseSchema = z.object({
  id: z.string().trim().min(1).max(200),
  position: automationNodePositionSchema,
})

const optionalConfigString = z.string().trim().max(10_000).nullish()
const httpsConfigURLSchema = z.string().trim().url().max(4_000)
  .refine((value) => new URL(value).protocol === 'https:', 'Use uma URL HTTPS publica')
const ianaTimezoneSchema = z.string().trim().min(1).max(100).refine((value) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format()
    return true
  } catch {
    return false
  }
}, 'Informe um fuso horario IANA valido')
const automationMediaPathSchema = z.string().trim().max(1_000).regex(
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/(images|audios|videos)\/[^/]+$/i,
  'Selecione um arquivo valido da galeria',
)

export const automationTriggerNodeConfigSchema = z.object({
  trigger_type: automationTriggerTypeSchema,
  tag_id: uuidSchema.nullish(),
  pipeline_id: uuidSchema.nullish(),
  to_stage_id: uuidSchema.nullish(),
  scheduled_at: z.string().datetime({ offset: true }).nullish(),
  timezone: ianaTimezoneSchema.nullish(),
  target_type: z.literal('lead').nullish(),
  target_lead_id: uuidSchema.nullish(),
  inactivity_value: z.number().int().min(1).nullish(),
  inactivity_unit: z.enum(['hours', 'days']).nullish(),
  source: z.string().trim().max(120).nullish(),
  meta_form_id: z.string().trim().max(255).nullish(),
  filter_user_id: z.union([uuidSchema, z.literal('__me__')]).nullish(),
}).passthrough().superRefine((config, ctx) => {
  if (config.trigger_type === 'tag_added' && !config.tag_id) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['tag_id'], message: 'Selecione a tag do gatilho' })
  }
  if (config.trigger_type === 'lead_stage_changed') {
    if (!config.pipeline_id) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['pipeline_id'], message: 'Selecione a pipeline do gatilho' })
    }
    if (!config.to_stage_id) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['to_stage_id'], message: 'Selecione a etapa do gatilho' })
    }
  }
  if (config.trigger_type === 'scheduled') {
    if (!config.scheduled_at) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['scheduled_at'], message: 'Informe a data e hora do disparo' })
    }
    if (!config.timezone) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['timezone'], message: 'Informe o fuso horario do disparo' })
    }
    if (config.target_type !== 'lead' || !config.target_lead_id) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['target_lead_id'], message: 'Selecione o lead que recebera o fluxo' })
    }
  }
  if (config.trigger_type === 'inactivity') {
    const maxValue = config.inactivity_unit === 'hours' ? 8760 : 365
    if (!config.inactivity_value) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['inactivity_value'], message: 'Informe o tempo de inatividade' })
    } else if (config.inactivity_value > maxValue) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['inactivity_value'], message: 'O periodo de inatividade nao pode ultrapassar um ano' })
    }
  }
})

export const automationDelayNodeConfigSchema = z.object({
  delay_type: z.enum(['seconds', 'minutes', 'hours', 'days']),
  delay_value: z.number().int().min(1),
  stop_on_reply: z.boolean().optional(),
  on_reply_message: optionalConfigString,
  on_reply_stage_id: uuidSchema.nullish(),
  on_reply_move_to_stage_id: uuidSchema.nullish(),
}).passthrough().superRefine((config, ctx) => {
  const maxByUnit = { seconds: 2_592_000, minutes: 43_200, hours: 720, days: 30 } as const
  if (config.delay_value > maxByUnit[config.delay_type]) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['delay_value'], message: 'A espera nao pode ultrapassar 30 dias' })
  }
})

export const automationConditionNodeConfigSchema = z.object({
  condition_type: z.string().trim().min(1).max(80),
  variable: z.string().trim().max(255).optional(),
  operator: z.string().trim().max(80).optional(),
  value: z.unknown().optional(),
  positive_keywords: z.string().trim().max(5_000).optional(),
  negative_keywords: z.string().trim().max(5_000).optional(),
}).passthrough().superRefine((config, ctx) => {
  if (config.condition_type === 'custom') {
    if (!config.variable) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['variable'], message: 'Selecione a variavel da condicao' })
    }
    if (!config.operator) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['operator'], message: 'Selecione o operador da condicao' })
    }
  }
  if (config.condition_type === 'response_sentiment' && !config.positive_keywords && !config.negative_keywords) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['positive_keywords'], message: 'Informe ao menos uma palavra-chave' })
  }
})

const automationActionConfigSchemas = {
  send_whatsapp: z.object({ session_id: uuidSchema, message: z.string().trim().min(1).max(4_000) }).passthrough(),
  send_image: z.object({ session_id: uuidSchema, media_bucket: z.literal('automation-media'), media_path: automationMediaPathSchema, caption: optionalConfigString }).passthrough(),
  send_audio: z.object({ session_id: uuidSchema, media_bucket: z.literal('automation-media'), media_path: automationMediaPathSchema }).passthrough(),
  send_video: z.object({ session_id: uuidSchema, media_bucket: z.literal('automation-media'), media_path: automationMediaPathSchema }).passthrough(),
  webhook: z.object({
    webhook_url: httpsConfigURLSchema,
    method: z.enum(['POST', 'PUT', 'PATCH']),
  }).passthrough(),
  add_tag: z.object({ tag_id: uuidSchema }).passthrough(),
  remove_tag: z.object({ tag_id: uuidSchema }).passthrough(),
  move_lead: z.object({ pipeline_id: uuidSchema, stage_id: uuidSchema }).passthrough(),
  assign_user: z.object({ user_id: uuidSchema }).passthrough(),
  set_variable: z.record(z.unknown()).superRefine((config, ctx) => {
    if (config.actionType === 'property_interest') {
      if (!uuidSchema.safeParse(config.property_id).success) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['property_id'], message: 'Selecione o imovel' })
      }
      return
    }
    if (config.actionType === 'deal_status') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['actionType'],
        message: 'Alterar o status do negócio ainda não está disponível neste construtor; remova esta ação do fluxo',
      })
      return
    }
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['actionType'], message: 'A variavel configurada nao e suportada' })
  }),
} as const

const automationTriggerFlowNodeSchema = automationNodeBaseSchema.extend({
  type: z.literal('trigger'),
  action_type: z.null().optional(),
  config: automationTriggerNodeConfigSchema,
}).strict()

const automationDelayFlowNodeSchema = automationNodeBaseSchema.extend({
  type: z.literal('delay'),
  action_type: z.null().optional(),
  config: automationDelayNodeConfigSchema,
}).strict()

const automationConditionFlowNodeSchema = automationNodeBaseSchema.extend({
  type: z.literal('condition'),
  action_type: z.null().optional(),
  config: automationConditionNodeConfigSchema,
}).strict()

const automationActionFlowNodeSchema = automationNodeBaseSchema.extend({
  type: z.literal('action'),
  action_type: automationActionTypeSchema,
  config: z.record(z.unknown()),
}).strict()

export const automationFlowNodeSchema = z.discriminatedUnion('type', [
  automationTriggerFlowNodeSchema,
  automationActionFlowNodeSchema,
  automationConditionFlowNodeSchema,
  automationDelayFlowNodeSchema,
]).superRefine((node, ctx) => {
  if (node.type !== 'action') return

  const unsupportedCrmAction = node.action_type === 'move_lead'
    || node.action_type === 'assign_user'
    || (node.action_type === 'set_variable'
      && (node.config.actionType === 'property_interest' || node.config.actionType === 'deal_status'))
  if (unsupportedCrmAction) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['action_type'],
      message: 'Esta acao depende do servico canonico do CRM e ainda nao pode ser publicada',
    })
    return
  }

  const schema = automationActionConfigSchemas[node.action_type as keyof typeof automationActionConfigSchemas]
  if (!schema) return

  const parsed = schema.safeParse(node.config)
  if (parsed.success) return

  parsed.error.issues.forEach((issue) => {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['config', ...issue.path],
      message: issue.message,
    })
  })
})

export const automationFlowConnectionSchema = z.object({
  source: z.string().trim().min(1).max(200),
  target: z.string().trim().min(1).max(200),
  source_handle: z.string().trim().max(100).nullable().optional(),
  condition_branch: z.string().trim().max(100).nullable().optional(),
}).strict()

export const automationFlowDefinitionSchema = z.object({
  nodes: z.array(automationFlowNodeSchema).max(250),
  connections: z.array(automationFlowConnectionSchema).max(500),
  settings: z.record(z.unknown()).default({}),
}).strict().superRefine((flow, ctx) => {
  const nodeIds = new Set<string>()
  flow.nodes.forEach((node, index) => {
    if (nodeIds.has(node.id)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['nodes', index, 'id'], message: 'O identificador do no deve ser unico' })
    }
    nodeIds.add(node.id)
  })

  const triggers = flow.nodes.filter((node) => node.type === 'trigger')
  if (flow.nodes.length > 0 && triggers.length !== 1) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['nodes'], message: 'O fluxo precisa ter exatamente um gatilho' })
  }

  const outgoing = new Map<string, string[]>()
  const incoming = new Map<string, number>()
  const branchNames = new Map<string, Set<string>>()
  const connectionKeys = new Set<string>()
  flow.connections.forEach((connection, index) => {
    if (!nodeIds.has(connection.source)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['connections', index, 'source'], message: 'O no de origem nao existe no fluxo' })
    }
    if (!nodeIds.has(connection.target)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['connections', index, 'target'], message: 'O no de destino nao existe no fluxo' })
    }
    if (connection.source === connection.target) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['connections', index], message: 'Um no nao pode apontar para ele mesmo' })
    }
    const branch = connection.condition_branch || connection.source_handle || ''
    const key = `${connection.source}:${branch}:${connection.target}`
    if (connectionKeys.has(key)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['connections', index], message: 'A conexao esta duplicada' })
    }
    connectionKeys.add(key)
    outgoing.set(connection.source, [...(outgoing.get(connection.source) ?? []), connection.target])
    incoming.set(connection.target, (incoming.get(connection.target) ?? 0) + 1)
    if (branch) {
      const sourceBranches = branchNames.get(connection.source) ?? new Set<string>()
      if (sourceBranches.has(branch)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['connections', index, 'condition_branch'], message: 'Cada saida precisa ter um nome unico' })
      }
      sourceBranches.add(branch)
      branchNames.set(connection.source, sourceBranches)
    }
  })

  const trigger = triggers[0]
  if (!trigger) return

  flow.nodes.forEach((node, index) => {
    const outputCount = outgoing.get(node.id)?.length ?? 0
    const inputCount = incoming.get(node.id) ?? 0
    const branches = branchNames.get(node.id) ?? new Set<string>()

    if (node.type === 'trigger') {
      if (inputCount !== 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['nodes', index], message: 'O gatilho nao pode ter conexoes de entrada' })
      }
      if (outputCount !== 1) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['nodes', index], message: 'O gatilho precisa ter exatamente uma saida' })
      }
    } else if (node.type === 'action' && outputCount > 1) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['nodes', index], message: 'Uma acao pode ter no maximo uma saida' })
    } else if (node.type === 'condition') {
      if (outputCount !== 2 || branches.size !== 2 || !branches.has('true') || !branches.has('false')) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['nodes', index], message: 'A condicao precisa das saidas true e false' })
      }
    } else if (node.type === 'delay') {
      if (node.config.stop_on_reply) {
        const hasExpectedBranches = branches.has('no_reply') && branches.has('replied')
        if (outputCount !== 2 || branches.size !== 2 || !hasExpectedBranches) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['nodes', index], message: 'A espera com resposta precisa das saidas no_reply e replied' })
        }
      } else if (outputCount > 1) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['nodes', index], message: 'Uma espera pode ter no maximo uma saida' })
      }
    }
  })

  const hasTerminalNode = flow.nodes.some((node) => node.type !== 'trigger' && (outgoing.get(node.id)?.length ?? 0) === 0)
  if (!hasTerminalNode) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['nodes'], message: 'O fluxo precisa ter ao menos um no terminal' })
  }

  const reachable = new Set<string>()
  const visiting = new Set<string>()
  const visited = new Set<string>()
  let hasCycle = false
  const walk = (nodeId: string) => {
    reachable.add(nodeId)
    if (visiting.has(nodeId)) {
      hasCycle = true
      return
    }
    if (visited.has(nodeId)) return
    visiting.add(nodeId)
    ;(outgoing.get(nodeId) ?? []).forEach(walk)
    visiting.delete(nodeId)
    visited.add(nodeId)
  }
  walk(trigger.id)

  flow.nodes.forEach((node, index) => {
    if (!reachable.has(node.id)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['nodes', index], message: 'O no nao esta conectado ao gatilho' })
    }
  })
  if (hasCycle) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['connections'], message: 'O fluxo nao pode conter ciclos' })
  }
})

const savedAutomationFlowDefinitionSchema = automationFlowDefinitionSchema.refine(
  (flow) => flow.nodes.length > 0,
  { path: ['nodes'], message: 'O fluxo precisa ter ao menos um no' },
)

export const createAutomationInputSchema = z.object({
  name: z.string().trim().min(1).max(180),
  description: z.string().trim().max(2_000).nullish(),
  trigger_type: automationTriggerTypeSchema.default('manual'),
  trigger_config: z.record(z.unknown()).optional(),
  flow_definition: savedAutomationFlowDefinitionSchema.optional(),
  is_active: z.boolean().optional(),
}).strict().superRefine((input, ctx) => {
  if (input.is_active && !input.flow_definition) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['flow_definition'],
      message: 'Publique o fluxo na mesma operação antes de ativar a automação',
    })
  }
})

export const updateAutomationBodySchema = z.object({
  name: z.string().trim().min(1).max(180).optional(),
  description: z.string().trim().max(2_000).nullish(),
  is_active: z.boolean().optional(),
}).strict().refine(
  (input) => Object.values(input).some((value) => value !== undefined),
  'Informe ao menos uma alteracao',
)

export const saveAutomationFlowInputSchema = z.object({
  flowDefinition: savedAutomationFlowDefinitionSchema,
  name: z.string().trim().min(1).max(180).optional(),
  description: z.string().trim().max(2_000).nullish(),
  isActive: z.boolean().optional(),
}).strict()

export const startAutomationInputSchema = z.object({
  leadId: uuidSchema,
  conversationId: uuidSchema.nullish(),
}).strict()

export const createAutomationTemplateInputSchema = z.object({
  name: z.string().trim().min(1).max(180),
  content: z.string().trim().min(1).max(10_000),
  media_url: z.string().trim().max(4_000).nullish(),
  media_type: z.string().trim().max(80).nullish(),
}).strict()

export const apiAutomationSchema = z.object({
  id: uuidSchema,
  organization_id: uuidSchema,
  name: z.string().min(1),
  description: z.string().nullable(),
  is_active: z.boolean(),
  trigger_type: automationTriggerTypeSchema,
  trigger_config: z.unknown(),
  flow_definition: z.unknown().optional(),
  created_by: uuidSchema.nullable(),
  created_at: timestampSchema,
  updated_at: timestampSchema,
}).passthrough()

export const apiAutomationNodeSchema = z.object({
  id: uuidSchema,
  automation_id: uuidSchema,
  node_type: automationNodeTypeSchema,
  action_type: z.string().nullable(),
  config: z.unknown(),
  position_x: z.number().finite(),
  position_y: z.number().finite(),
  created_at: timestampSchema,
}).passthrough()

export const apiAutomationConnectionSchema = z.object({
  id: uuidSchema,
  automation_id: uuidSchema,
  source_node_id: uuidSchema,
  target_node_id: uuidSchema,
  source_handle: z.string().nullable(),
  condition_branch: z.string().nullable(),
}).passthrough()

export const apiAutomationWithNodesSchema = apiAutomationSchema.extend({
  nodes: z.array(apiAutomationNodeSchema),
  connections: z.array(apiAutomationConnectionSchema),
})

export const apiAutomationTemplateSchema = z.object({
  id: uuidSchema,
  organization_id: uuidSchema,
  name: z.string(),
  content: z.string(),
  media_url: z.string().nullable(),
  media_type: z.string().nullable(),
  created_by: uuidSchema.nullable(),
  created_at: timestampSchema,
  updated_at: timestampSchema,
}).passthrough()

export const apiAutomationExecutionSchema = z.object({
  id: uuidSchema,
  automation_id: uuidSchema.nullable(),
  lead_id: uuidSchema.nullable(),
  conversation_id: uuidSchema.nullable(),
  organization_id: uuidSchema,
  status: z.string(),
  current_node_id: z.string().nullable(),
  started_at: timestampSchema,
  completed_at: timestampSchema.nullable(),
  error_message: z.string().nullable(),
  execution_data: z.unknown(),
  next_execution_at: timestampSchema.nullable(),
}).passthrough()

export const apiAutomationExecutionStepSchema = z.object({
  id: uuidSchema,
  execution_id: uuidSchema,
  node_key: z.string().trim().min(1).max(200),
  node_type: automationNodeTypeSchema,
  action_type: automationActionTypeSchema.nullable(),
  status: z.string().trim().min(1).max(80),
  attempt: nonNegativeIntegerSchema,
  started_at: timestampSchema,
  completed_at: timestampSchema.nullable(),
  error_message: z.string().nullable(),
}).passthrough()

export const apiAutomationExecutionSummarySchema = z.object({
  automationId: uuidSchema,
  total: nonNegativeIntegerSchema,
  queued: nonNegativeIntegerSchema,
  running: nonNegativeIntegerSchema,
  waiting: nonNegativeIntegerSchema,
  completed: nonNegativeIntegerSchema,
  failed: nonNegativeIntegerSchema,
  cancelled: nonNegativeIntegerSchema,
  activeExecutionIds: z.array(uuidSchema),
  activeIdsTruncated: z.boolean(),
  lastStartedAt: timestampSchema.nullable(),
}).passthrough()

export const automationRuntimeIssueKindSchema = z.enum([
  'dead_letter',
  'failed_event',
  'circuit_decision',
  'duplicate_decision',
  'ambiguous_effect',
  'circuit_open',
])

export const apiAutomationRuntimeIssueSchema = z.object({
  id: uuidSchema,
  kind: automationRuntimeIssueKindSchema,
  severity: z.enum(['info', 'warning', 'error']),
  status: z.string().trim().min(1).max(80),
  automationId: uuidSchema.nullable(),
  automationName: z.string().nullable(),
  executionId: uuidSchema.nullable(),
  leadId: uuidSchema.nullable(),
  message: z.string().nullable(),
  details: z.unknown(),
  retryable: z.boolean(),
  occurredAt: timestampSchema,
}).passthrough()

export const apiAutomationMediaFileSchema = z.object({
  name: z.string().min(1),
  path: z.string().min(1),
  bucket: z.string().min(1),
  publicUrl: z.string().min(1),
  contentType: z.string().nullable(),
  size: nonNegativeIntegerSchema.nullable(),
  metadata: z.record(z.unknown()),
  createdAt: timestampSchema.nullable(),
  updatedAt: timestampSchema.nullable(),
}).passthrough()

export const apiAutomationListResponseSchema = apiEnvelopeSchema(z.array(apiAutomationSchema))
export const apiAutomationResponseSchema = apiEnvelopeSchema(apiAutomationSchema)
export const apiAutomationWithNodesResponseSchema = apiEnvelopeSchema(apiAutomationWithNodesSchema)
export const apiAutomationNodesResponseSchema = apiEnvelopeSchema(z.object({
  nodes: z.array(apiAutomationNodeSchema),
}).passthrough())
export const apiAutomationTemplateListResponseSchema = apiEnvelopeSchema(z.array(apiAutomationTemplateSchema))
export const apiAutomationTemplateResponseSchema = apiEnvelopeSchema(apiAutomationTemplateSchema)
export const apiAutomationExecutionListResponseSchema = apiEnvelopeSchema(z.array(apiAutomationExecutionSchema))
export const apiAutomationExecutionStepListResponseSchema = apiEnvelopeSchema(z.array(apiAutomationExecutionStepSchema))
export const apiAutomationExecutionSummaryListResponseSchema = apiEnvelopeSchema(z.array(apiAutomationExecutionSummarySchema))
export const apiAutomationRuntimeIssuesResponseSchema = apiEnvelopeSchema(z.object({
  summary: z.object({
    deadLetters: nonNegativeIntegerSchema,
    failedEvents: nonNegativeIntegerSchema,
    openCircuits: nonNegativeIntegerSchema,
    duplicateDecisions: nonNegativeIntegerSchema,
    unknownEffects: nonNegativeIntegerSchema,
    staleSendingEffects: nonNegativeIntegerSchema,
  }).strict(),
  issues: z.array(apiAutomationRuntimeIssueSchema),
}).strict())
export const apiAutomationMediaListResponseSchema = apiEnvelopeSchema(z.object({
  files: z.array(apiAutomationMediaFileSchema),
  nextOffset: nonNegativeIntegerSchema.nullable(),
}).strict())
export const apiAutomationMediaResponseSchema = apiEnvelopeSchema(apiAutomationMediaFileSchema)
export const apiStartAutomationResponseSchema = apiEnvelopeSchema(z.object({
  executionId: uuidSchema,
  automationId: uuidSchema,
  automationName: z.string(),
  executorStarted: z.boolean(),
  status: z.enum(['queued', 'running', 'waiting', 'completed', 'cancelled', 'canceled']),
  dispatchPending: z.boolean(),
}).passthrough())
