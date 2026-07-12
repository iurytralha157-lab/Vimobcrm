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

export const automationFlowNodeSchema = z.object({
  id: z.string().trim().min(1).max(200),
  type: automationNodeTypeSchema,
  action_type: z.string().trim().max(80).nullable().optional(),
  position: z.object({ x: z.number().finite(), y: z.number().finite() }).strict(),
  config: z.record(z.unknown()),
}).strict()

export const automationFlowConnectionSchema = z.object({
  source: z.string().trim().min(1).max(200),
  target: z.string().trim().min(1).max(200),
  source_handle: z.string().trim().max(100).nullable().optional(),
  condition_branch: z.string().trim().max(100).nullable().optional(),
}).strict()

export const automationFlowDefinitionSchema = z.object({
  nodes: z.array(automationFlowNodeSchema).max(500),
  connections: z.array(automationFlowConnectionSchema).max(1_000),
  settings: z.record(z.unknown()).default({}),
}).strict()

const savedAutomationFlowDefinitionSchema = automationFlowDefinitionSchema.refine(
  (flow) => flow.nodes.length > 0,
  { path: ['nodes'], message: 'O fluxo precisa ter ao menos um no' },
)

export const createAutomationInputSchema = z.object({
  name: z.string().trim().min(1).max(180),
  description: z.string().trim().max(2_000).nullish(),
  trigger_type: automationTriggerTypeSchema.default('manual'),
  trigger_config: z.record(z.unknown()).optional(),
  flow_definition: automationFlowDefinitionSchema.nullish(),
}).strict()

export const updateAutomationBodySchema = z.object({
  name: z.string().trim().min(1).max(180).optional(),
  description: z.string().trim().max(2_000).nullish(),
  is_active: z.boolean().optional(),
  trigger_type: automationTriggerTypeSchema.optional(),
  trigger_config: z.record(z.unknown()).optional(),
  flow_definition: automationFlowDefinitionSchema.nullish(),
}).strict().refine(
  (input) => Object.values(input).some((value) => value !== undefined),
  'Informe ao menos uma alteracao',
)

export const saveAutomationFlowInputSchema = z.object({
  flowDefinition: savedAutomationFlowDefinitionSchema,
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
export const apiAutomationMediaListResponseSchema = apiEnvelopeSchema(z.array(apiAutomationMediaFileSchema))
export const apiAutomationMediaResponseSchema = apiEnvelopeSchema(apiAutomationMediaFileSchema)
export const apiStartAutomationResponseSchema = apiEnvelopeSchema(z.object({
  executionId: uuidSchema,
  automationId: uuidSchema,
  automationName: z.string(),
  executorStarted: z.boolean(),
}).passthrough())
