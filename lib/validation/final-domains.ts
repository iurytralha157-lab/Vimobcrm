import { z } from 'zod'
import { apiEnvelopeSchema, nonNegativeIntegerSchema, timestampSchema, uuidSchema } from './common'

export const dynamicRecordSchema = z.record(z.unknown())
export const nonEmptyDynamicRecordSchema = dynamicRecordSchema.refine(
  (input) => Object.keys(input).length > 0,
  'Informe ao menos um campo',
)
export const safePathSegmentSchema = z.string().trim().min(1).max(120).regex(/^[a-zA-Z0-9_-]+$/)
export const opaqueTokenSchema = z.string().trim().min(8).max(2_000)
export const invitationTokenSchema = z.string().length(64).regex(/^[a-f0-9]{64}$/)
export const apiDynamicRecordResponseSchema = apiEnvelopeSchema(dynamicRecordSchema)
export const apiDynamicRecordListResponseSchema = apiEnvelopeSchema(z.array(dynamicRecordSchema))
export const apiOptionalDynamicRecordResponseSchema = apiEnvelopeSchema(dynamicRecordSchema.nullable())
export const apiCountResponseSchema = z.object({ count: nonNegativeIntegerSchema }).passthrough()

export const adminOrganizationQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  status: z.string().trim().max(80).optional(),
  segment: z.string().trim().max(80).optional(),
}).strict()
export const adminFeatureRequestInputSchema = z.object({
  title: z.string().trim().min(2).max(180),
  description: z.string().trim().min(2).max(4_000),
  category: z.string().trim().max(120).optional(),
  priority: z.string().trim().max(40).optional(),
}).passthrough()
export const adminInvitationInputSchema = z.object({
  email: z.string().trim().email(),
  role: z.enum(['admin', 'manager', 'user']),
  organizationId: uuidSchema.optional(),
}).passthrough()
export const adminModuleAccessInputSchema = z.object({
  organizationId: uuidSchema,
  moduleName: z.string().trim().min(1).max(120),
  isEnabled: z.boolean(),
}).strict()
export const adminOrganizationAccessInputSchema = z.object({
  organizationUpdates: dynamicRecordSchema,
  modules: z.array(z.string().trim().min(1).max(120)).max(500),
}).strict()
export const adminOrganizationDeleteInputSchema = z.object({
  confirmation_name: z.string().trim().min(1).max(300),
}).strict()
export const adminPeriodSchema = z.number().int().min(1).max(3650)
export const adminListLimitSchema = z.number().int().min(1).max(500)
export const adminOrganizationMutationInputSchema = nonEmptyDynamicRecordSchema
export const adminUserMutationInputSchema = nonEmptyDynamicRecordSchema
const adminWriteOnlySecretSchema = z.object({
  action: z.enum(['unchanged', 'replace', 'clear']),
  value: z.string().max(4_096).optional(),
}).strict().superRefine((secret, context) => {
  if (secret.action === 'replace' && !secret.value?.trim()) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['value'], message: 'Informe o novo segredo' })
  }
  if (secret.action !== 'replace' && secret.value) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['value'], message: 'O valor e permitido apenas em replace' })
  }
})
export const adminNotificationDispatchSettingsSchema = z.object({
  enabled: z.boolean(),
  mode: z.enum(['webhook', 'evolution_go_instance']),
  instanceName: z.string().max(160),
  senderNumber: z.string().max(40),
  webhookUrl: z.string().max(2_048),
  headerName: z.string().max(120),
  timeoutSeconds: z.number().int().min(3).max(60),
  instanceTokenConfigured: z.boolean(),
  headerValueConfigured: z.boolean(),
  updatedAt: z.string().optional(),
}).strict()
export const adminNotificationDispatchSettingsInputSchema = adminNotificationDispatchSettingsSchema
  .omit({ instanceTokenConfigured: true, headerValueConfigured: true, updatedAt: true })
  .extend({
    instanceToken: adminWriteOnlySecretSchema,
    headerValue: adminWriteOnlySecretSchema,
  })
  .strict()
export const apiAdminNotificationDispatchSettingsResponseSchema = apiEnvelopeSchema(adminNotificationDispatchSettingsSchema)
export const apiAdminOrganizationMutationResponseSchema = z.object({
  organization: dynamicRecordSchema,
}).passthrough()

export const aiAgentStatusSchema = z.enum(['draft', 'active', 'paused'])
export const aiAgentConfigSchema = z.object({
  type: z.string().trim().min(1).max(80),
  prompt: z.string().max(50_000),
  model: z.string().trim().min(1).max(120),
  temperature: z.number().finite().min(0).max(2),
  allowedTools: z.array(z.string().trim().min(1).max(120)).max(100),
  handoffTargets: z.array(z.string().trim().min(1).max(120)).max(100),
  routingKeywords: z.array(z.string().trim().min(1).max(180)).max(500),
  isDefault: z.boolean(),
}).strict()
export const aiSettingsInputSchema = z.object({
  isEnabled: z.boolean().optional(),
  maxAgents: z.number().int().min(0).max(100).optional(),
  maxSessions: z.number().int().min(0).max(10_000).optional(),
  monthlyTokenLimit: z.number().int().min(0).optional(),
  defaultTriageAgentId: uuidSchema.nullish(),
  triagePrompt: z.string().max(50_000).optional(),
  allowedTools: z.array(z.string().trim().min(1).max(120)).max(100).optional(),
  guardrails: dynamicRecordSchema.optional(),
}).strict().refine((input) => Object.keys(input).length > 0, 'Informe ao menos uma alteracao')
export const aiAgentInputSchema = z.object({
  organizationId: uuidSchema.optional(),
  name: z.string().trim().min(2).max(180),
  description: z.string().trim().max(2_000).optional(),
  status: aiAgentStatusSchema,
  config: aiAgentConfigSchema,
}).strict()
export const aiRoutingConditionsSchema = z.object({
  sessionIds: z.array(uuidSchema).max(500).optional(),
  pipelineIds: z.array(uuidSchema).max(500).optional(),
  stageIds: z.array(uuidSchema).max(500).optional(),
  pipelineNames: z.array(z.string().trim().max(180)).max(500).optional(),
  sources: z.array(z.string().trim().max(180)).max(500).optional(),
  messageContains: z.array(z.string().trim().max(500)).max(500).optional(),
}).strict()
export const aiRoutingRuleInputSchema = z.object({
  agentId: uuidSchema,
  name: z.string().trim().min(2).max(180),
  priority: z.number().int().min(0).max(100_000),
  isEnabled: z.boolean().optional(),
  action: z.enum(['route_to_agent', 'handoff_to_agent', 'require_human', 'ignore']),
  conditions: aiRoutingConditionsSchema,
}).strict()
export const aiRunInputSchema = z.object({
  message: z.string().trim().min(1).max(20_000),
  agentId: uuidSchema.optional(),
  leadId: uuidSchema.optional(),
  conversationId: uuidSchema.optional(),
  sessionId: uuidSchema.optional(),
  source: z.string().trim().max(120).optional(),
}).strict()
export const apiAISettingsSchema = z.object({
  organizationId: uuidSchema,
  isEnabled: z.boolean(),
  maxAgents: nonNegativeIntegerSchema,
  maxSessions: nonNegativeIntegerSchema,
  monthlyTokenLimit: nonNegativeIntegerSchema,
  defaultTriageAgentId: uuidSchema.optional(),
  triagePrompt: z.string(),
  allowedTools: z.array(z.string()),
  guardrails: dynamicRecordSchema,
  agentCount: nonNegativeIntegerSchema,
  activeSessionCount: nonNegativeIntegerSchema,
}).passthrough()
export const apiAIAgentSchema = z.object({
  id: uuidSchema,
  organizationId: uuidSchema.optional(),
  name: z.string(),
  description: z.string().optional(),
  status: aiAgentStatusSchema,
  config: aiAgentConfigSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
}).passthrough()
export const apiAIRoutingRuleSchema = z.object({
  id: uuidSchema,
  organizationId: uuidSchema,
  agentId: uuidSchema,
  name: z.string(),
  priority: z.number().int(),
  isEnabled: z.boolean(),
  action: z.enum(['route_to_agent', 'handoff_to_agent', 'require_human', 'ignore']),
  conditions: aiRoutingConditionsSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
}).passthrough()
export const apiAIRunResponseSchema = z.object({
  mode: z.enum(['openai', 'simulated', 'routed']),
  agent: z.object({ id: uuidSchema, name: z.string(), type: z.string() }).passthrough(),
  output: z.string(),
  toolsUsed: z.array(z.object({ name: z.string(), data: z.unknown() }).passthrough()),
}).passthrough()
export const apiAIMetricsSchema = z.object({
  leadsReceived: nonNegativeIntegerSchema,
  leadsAttended: nonNegativeIntegerSchema,
  followUpsActive: nonNegativeIntegerSchema,
  series: z.array(z.object({
    date: z.string(),
    label: z.string(),
    leadsReceived: nonNegativeIntegerSchema,
    leadsAttended: nonNegativeIntegerSchema,
    followUpsActive: nonNegativeIntegerSchema,
  }).passthrough()),
}).passthrough()
export const apiAIEventSchema = z.object({
  id: uuidSchema,
  eventType: z.string(),
  status: z.string(),
  payload: dynamicRecordSchema,
  createdAt: timestampSchema,
  processedAt: timestampSchema.optional(),
}).passthrough()
export const apiAISettingsResponseSchema = apiEnvelopeSchema(apiAISettingsSchema)
export const apiAIAgentListResponseSchema = apiEnvelopeSchema(z.array(apiAIAgentSchema))
export const apiAIAgentResponseSchema = apiEnvelopeSchema(apiAIAgentSchema)
export const apiAIRoutingRuleListResponseSchema = apiEnvelopeSchema(z.array(apiAIRoutingRuleSchema))
export const apiAIRoutingRuleResponseSchema = apiEnvelopeSchema(apiAIRoutingRuleSchema)
export const apiAIRunEnvelopeSchema = apiEnvelopeSchema(apiAIRunResponseSchema)
export const apiAIMetricsResponseSchema = apiEnvelopeSchema(apiAIMetricsSchema)
export const apiAIEventListResponseSchema = apiEnvelopeSchema(z.array(apiAIEventSchema))

export const gamificationActionTypeSchema = z.enum([
  'call_made',
  'message_sent',
  'contact_made',
  'visit_scheduled',
  'visit_confirmed',
  'meeting_scheduled',
  'meeting_held',
  'proposal_sent',
  'sale_closed',
  'contract_signed',
  'lost_lead_recovered',
  'lead_created',
  'lead_created_manual',
  'property_created',
  'prospecting_report',
])
export type GamificationActionType = z.infer<typeof gamificationActionTypeSchema>

export const gamificationRankingQuerySchema = z.object({
  from: timestampSchema.optional(),
  to: timestampSchema.optional(),
  actionTypes: z.array(gamificationActionTypeSchema).max(20).default([]),
}).strict().superRefine((input, ctx) => {
  if (input.from && input.to && new Date(input.from) >= new Date(input.to)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['to'], message: 'O fim do período precisa ser posterior ao início' })
  }
})

export const gamificationEventListQuerySchema = z.object({
  from: timestampSchema.optional(),
  to: timestampSchema.optional(),
  userId: uuidSchema.optional(),
  limit: z.number().int().min(1).max(100).default(50),
  cursor: z.string().trim().min(1).max(1_024).optional(),
}).strict().superRefine((input, ctx) => {
  if (input.from && input.to && new Date(input.from) >= new Date(input.to)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['to'], message: 'O fim do período precisa ser posterior ao início' })
  }
})

export const gamificationRuleInputSchema = z.object({
  points: z.number().int().min(0).max(100_000),
  isActive: z.boolean().optional(),
}).strict()
export const gamificationParticipantInputSchema = z.object({ participates: z.boolean() }).strict()
export const gamificationMissionInputSchema = z.object({
  title: z.string().trim().min(2).max(180),
  description: z.string().trim().max(2_000).nullish(),
  actionType: gamificationActionTypeSchema.nullish(),
  targetCount: z.number().int().min(1).max(1_000_000),
  bonusPoints: z.number().int().min(0).max(1_000_000),
  period: z.string().trim().max(80).nullish(),
  targetScope: z.enum(['organization', 'user']),
  targetUserId: uuidSchema.nullish(),
  isActive: z.boolean().optional(),
}).strict().superRefine((input, ctx) => {
  if (input.targetScope === 'user' && !input.targetUserId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['targetUserId'], message: 'Usuário é obrigatório' })
  }
})
export const gamificationManualEntryInputSchema = z.object({
  actionKey: gamificationActionTypeSchema,
  quantity: z.number().int().min(1).max(100),
  notes: z.string().trim().max(2_000),
}).strict()
export const gamificationDecisionInputSchema = z.object({
  status: z.enum(['approved', 'rejected']),
  reason: z.string().trim().max(2_000).optional(),
}).strict().superRefine((input, ctx) => {
  if (input.status === 'rejected' && !input.reason) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['reason'], message: 'Motivo e obrigatorio' })
  }
})
export const gamificationSeasonInputSchema = z.object({
  name: z.string().trim().min(2).max(180),
  reason: z.string().trim().min(2).max(2_000),
}).strict()
const apiGamificationEventSchema = z.object({
  id: uuidSchema,
  userId: uuidSchema.nullable(),
  userName: z.string(),
  eventType: z.string(),
  points: z.number().int(),
  createdAt: timestampSchema.nullable(),
  details: z.string().nullable(),
  source: z.string().nullable(),
}).passthrough()
const apiGamificationRankingEntrySchema = z.object({
  userId: uuidSchema,
  name: z.string(),
  avatarUrl: z.string().nullable(),
  points: z.number().int(),
  xp: nonNegativeIntegerSchema,
  level: nonNegativeIntegerSchema,
  rank: z.string(),
  streakDays: nonNegativeIntegerSchema,
  xpCurrentLevel: nonNegativeIntegerSchema,
  xpNextLevel: nonNegativeIntegerSchema,
  lastActivityAt: timestampSchema.nullable(),
  position: nonNegativeIntegerSchema,
  isCurrentUser: z.boolean(),
}).passthrough()
export const apiGamificationMissionSchema = z.object({
  id: uuidSchema,
  title: z.string(),
  description: z.string().nullable(),
  actionType: gamificationActionTypeSchema.nullable(),
  targetCount: nonNegativeIntegerSchema,
  currentProgress: nonNegativeIntegerSchema,
  bonusPoints: nonNegativeIntegerSchema,
  isActive: z.boolean(),
  targetScope: z.string(),
  targetUserId: uuidSchema.nullable(),
  period: z.string().nullable(),
  createdAt: timestampSchema.nullable(),
  updatedAt: timestampSchema.nullable(),
}).passthrough()
export const apiGamificationRuleSchema = z.object({
  id: z.union([uuidSchema, z.string().regex(/^default-[a-z0-9_-]+$/)]),
  actionType: gamificationActionTypeSchema,
  points: z.number().int(),
  isActive: z.boolean(),
  isTemp: z.boolean(),
}).passthrough()
export const apiGamificationParticipantSchema = z.object({
  userId: uuidSchema,
  name: z.string(),
  email: z.string(),
  role: z.string(),
  isActive: z.boolean(),
  participates: z.boolean(),
  points: z.number().int(),
}).passthrough()
export const apiGamificationSeasonSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  resetReason: z.string().nullable(),
  isActive: z.boolean(),
  startedAt: timestampSchema.nullable(),
  endedAt: timestampSchema.nullable(),
  createdAt: timestampSchema.nullable(),
}).passthrough()
export const apiGamificationManualEntrySchema = z.object({
  id: uuidSchema,
  userId: uuidSchema,
  userName: z.string(),
  actionKey: gamificationActionTypeSchema,
  quantity: z.number().int(),
  notes: z.string().nullable(),
  status: z.enum(['pending', 'approved', 'rejected']),
  approvedBy: uuidSchema.nullable(),
  approvedAt: timestampSchema.nullable(),
  rejectionReason: z.string().nullable(),
  awardedAt: timestampSchema.nullable(),
  awardStatus: z.enum(['pending', 'processing', 'completed', 'skipped', 'dead']).nullable(),
  createdAt: timestampSchema.nullable(),
}).passthrough()
const apiGamificationPerformanceSchema = z.object({
  chartData: z.array(z.object({
    name: z.string(),
    points: z.number().int(),
    actions: nonNegativeIntegerSchema,
  }).passthrough()),
  metrics: z.object({
    points: z.number().int(),
    growth: z.number().finite(),
    avgActionsPerDay: z.number().finite(),
    totalActions: nonNegativeIntegerSchema,
    efficiency: z.number().finite(),
    consistency: z.number().finite(),
  }).passthrough(),
  distribution: z.array(z.object({
    label: z.string(),
    value: nonNegativeIntegerSchema,
  }).passthrough()),
}).passthrough()
export const apiGamificationOverviewResponseSchema = apiEnvelopeSchema(z.object({
  ranking: z.array(apiGamificationRankingEntrySchema),
  recentEvents: z.array(apiGamificationEventSchema),
  history: z.array(apiGamificationEventSchema),
  missions: z.array(apiGamificationMissionSchema),
  performance: apiGamificationPerformanceSchema,
  totalPoints: z.number().int(),
  activeUsers: nonNegativeIntegerSchema,
  totalEvents: nonNegativeIntegerSchema,
  myPosition: nonNegativeIntegerSchema.nullable(),
}).passthrough())
export const apiGamificationRankingResponseSchema = apiEnvelopeSchema(z.array(apiGamificationRankingEntrySchema))
export const apiGamificationEventPageResponseSchema = apiEnvelopeSchema(z.object({
  events: z.array(apiGamificationEventSchema),
  total: nonNegativeIntegerSchema,
  nextCursor: z.string().nullable(),
}).passthrough())
export const apiGamificationAdminResponseSchema = apiEnvelopeSchema(z.object({
  rules: z.array(apiGamificationRuleSchema),
  missions: z.array(apiGamificationMissionSchema),
  participants: z.array(apiGamificationParticipantSchema),
  seasons: z.array(apiGamificationSeasonSchema),
  myManualEntries: z.array(apiGamificationManualEntrySchema),
  pendingManualEntries: z.array(apiGamificationManualEntrySchema),
  users: z.array(z.object({ id: uuidSchema, name: z.string() }).passthrough()),
  canManage: z.boolean(),
}).passthrough())
export const apiGamificationRuleResponseSchema = apiEnvelopeSchema(apiGamificationRuleSchema)
export const apiGamificationParticipantResponseSchema = apiEnvelopeSchema(apiGamificationParticipantSchema)
export const apiGamificationMissionResponseSchema = apiEnvelopeSchema(apiGamificationMissionSchema)
export const apiGamificationManualEntryResponseSchema = apiEnvelopeSchema(apiGamificationManualEntrySchema)
export const apiGamificationSeasonResponseSchema = apiEnvelopeSchema(apiGamificationSeasonSchema)

function emptyOrAllToNull(value: unknown) {
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  return trimmed === '' || trimmed === 'all' ? null : trimmed
}

function emptyToNull(value: unknown) {
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

const dashboardNumberSchema = z.number().finite()
const dashboardNonNegativeNumberSchema = dashboardNumberSchema.min(0)
const dashboardPercentageSchema = dashboardNumberSchema.min(0).max(100)
const dashboardTrendSchema = z.number().int().finite()
const dashboardTextSchema = (max: number) => z.string().trim().min(1).max(max)
const dashboardNullableTextSchema = (max: number) => dashboardTextSchema(max).nullable()
const dashboardTimestampSchema = z.string().trim().datetime({ offset: true })
const dashboardOptionalUuidFilterSchema = z.preprocess(emptyOrAllToNull, uuidSchema.nullish())
const dashboardOptionalTextFilterSchema = (max: number) => z.preprocess(emptyOrAllToNull, z.string().trim().max(max).nullish())
const dashboardSearchSchema = z.preprocess(emptyToNull, z.string().trim().max(180).nullish())
const dashboardDealStatusSchema = z.preprocess(
  emptyOrAllToNull,
  z.enum(['open', 'won', 'lost']).nullish(),
)
const dashboardMaxDateRangeMs = 5 * 366 * 24 * 60 * 60 * 1_000

export const dashboardDateRangeSchema = z.object({
  from: z.date(),
  to: z.date(),
}).strict().superRefine((range, context) => {
  const durationMs = range.to.getTime() - range.from.getTime()
  if (durationMs <= 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['to'],
      message: 'A data final deve ser posterior a data inicial',
    })
    return
  }
  if (durationMs > dashboardMaxDateRangeMs) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['to'],
      message: 'O periodo do dashboard nao pode exceder cinco anos',
    })
  }
})

export const dashboardFiltersSchema = z.object({
  dateRange: dashboardDateRangeSchema.nullable().optional(),
  granularity: z.enum(['hour', 'day', 'week', 'month']).nullable().optional(),
  teamId: dashboardOptionalUuidFilterSchema,
  userId: dashboardOptionalUuidFilterSchema,
  source: dashboardOptionalTextFilterSchema(180),
  campaignId: dashboardOptionalTextFilterSchema(255),
  adSetId: dashboardOptionalTextFilterSchema(255),
  adId: dashboardOptionalTextFilterSchema(255),
  tagId: dashboardOptionalUuidFilterSchema,
  dealStatus: dashboardDealStatusSchema,
  searchQuery: dashboardSearchSchema,
}).strict()
export const dashboardOptionalIdSchema = dashboardOptionalUuidFilterSchema
export const dashboardLimitSchema = z.number().int().min(1).max(50).optional()

export const apiDashboardWonConversionBucketSchema = z.object({
  key: dashboardTextSchema(80),
  label: dashboardTextSchema(160),
  count: nonNegativeIntegerSchema,
  percentage: dashboardPercentageSchema,
  value: dashboardNonNegativeNumberSchema,
  color: dashboardTextSchema(64),
}).passthrough()

export const apiDashboardWonDealSchema = z.object({
  id: uuidSchema,
  name: dashboardTextSchema(300),
  phone: dashboardNullableTextSchema(80),
  source: dashboardNullableTextSchema(180),
  value: dashboardNonNegativeNumberSchema,
  createdAt: dashboardTimestampSchema.nullable(),
  wonAt: dashboardTimestampSchema.nullable(),
  conversionDays: nonNegativeIntegerSchema.nullable(),
  assignedUserName: dashboardTextSchema(300),
}).passthrough()

export const apiDashboardLostReasonBucketSchema = z.object({
  key: dashboardTextSchema(180),
  label: dashboardTextSchema(300),
  count: nonNegativeIntegerSchema,
  percentage: dashboardPercentageSchema,
  color: dashboardTextSchema(64),
}).passthrough()

export const apiDashboardLostDealSchema = z.object({
  id: uuidSchema,
  name: dashboardTextSchema(300),
  phone: dashboardNullableTextSchema(80),
  source: dashboardNullableTextSchema(180),
  lostReason: dashboardTextSchema(500),
  lostReasonGroup: dashboardTextSchema(300),
  createdAt: dashboardTimestampSchema.nullable(),
  lostAt: dashboardTimestampSchema.nullable(),
  assignedUserName: dashboardTextSchema(300),
}).passthrough()

export const apiDashboardStatsSchema = z.object({
  totalLeads: nonNegativeIntegerSchema,
  leadsInProgress: nonNegativeIntegerSchema,
  leadsClosed: nonNegativeIntegerSchema,
  leadsLost: nonNegativeIntegerSchema,
  openLeads: nonNegativeIntegerSchema,
  lostLeads: nonNegativeIntegerSchema,
  conversionRate: dashboardPercentageSchema,
  closedLeads: nonNegativeIntegerSchema,
  wonAverageConversionDays: nonNegativeIntegerSchema.nullable(),
  wonConversionBuckets: z.array(apiDashboardWonConversionBucketSchema),
  wonDeals: z.array(apiDashboardWonDealSchema),
  lostReasonBuckets: z.array(apiDashboardLostReasonBucketSchema),
  lostDeals: z.array(apiDashboardLostDealSchema),
  avgResponseTime: dashboardTextSchema(32),
  totalSalesValue: dashboardNonNegativeNumberSchema,
  pendingCommissions: dashboardNonNegativeNumberSchema,
  leadsTrend: dashboardTrendSchema,
  openTrend: dashboardTrendSchema,
  lostTrend: dashboardTrendSchema,
  conversionTrend: dashboardTrendSchema,
  closedTrend: dashboardTrendSchema,
  totalReceivables: dashboardNonNegativeNumberSchema,
  totalPayables: dashboardNonNegativeNumberSchema,
  overdueReceivables: dashboardNonNegativeNumberSchema,
  overduePayables: dashboardNonNegativeNumberSchema,
  paidCommissions: dashboardNonNegativeNumberSchema,
}).passthrough()
export const apiDashboardFunnelSchema = z.array(z.object({
  name: dashboardTextSchema(300),
  value: nonNegativeIntegerSchema,
  percentage: dashboardPercentageSchema,
  stage_key: dashboardTextSchema(180),
}).passthrough())
export const apiDashboardSourceSchema = z.array(z.object({
  name: dashboardTextSchema(300),
  value: nonNegativeIntegerSchema,
  rawSource: z.string().trim().max(180),
}).passthrough())
export const apiDashboardTopBrokerSchema = z.object({
  id: uuidSchema,
  name: dashboardTextSchema(300),
  avatar_url: z.string().trim().max(2_048).nullable(),
  closedLeads: nonNegativeIntegerSchema,
  salesValue: dashboardNonNegativeNumberSchema,
  totalCommissions: dashboardNonNegativeNumberSchema,
}).passthrough()
export const apiDashboardTopBrokersSchema = z.object({
  brokers: z.array(apiDashboardTopBrokerSchema),
  isFallbackMode: z.boolean(),
}).passthrough()
export const apiDashboardUpcomingTasksSchema = z.array(z.object({
  id: uuidSchema,
  title: dashboardTextSchema(500),
  type: z.enum(['call', 'email', 'meeting', 'message', 'task']),
  due_date: dashboardTimestampSchema,
  lead_name: dashboardTextSchema(300),
  lead_id: uuidSchema,
}).passthrough())
export const apiDashboardDealsEvolutionSchema = z.array(z.object({
  date: dashboardTextSchema(80),
  ganhos: nonNegativeIntegerSchema,
  perdas: nonNegativeIntegerSchema,
  abertos: nonNegativeIntegerSchema,
}).passthrough())
export const apiDashboardExtraCountsSchema = z.object({
  propertyCount: nonNegativeIntegerSchema,
  siteVisits: nonNegativeIntegerSchema,
  scheduledVisits: nonNegativeIntegerSchema,
}).passthrough()
export const apiDashboardRecentActivitiesSchema = z.array(z.object({
  id: uuidSchema,
  type: dashboardTextSchema(120),
  content: z.string().max(10_000).nullable(),
  created_at: dashboardTimestampSchema,
  lead_name: dashboardTextSchema(300),
  user_name: z.string().trim().max(300).nullable().optional(),
}).passthrough())
export const apiDashboardStatsResponseSchema = apiEnvelopeSchema(apiDashboardStatsSchema)
export const apiDashboardFunnelResponseSchema = apiEnvelopeSchema(apiDashboardFunnelSchema)
export const apiDashboardSourceResponseSchema = apiEnvelopeSchema(apiDashboardSourceSchema)
export const apiDashboardTopBrokersResponseSchema = apiEnvelopeSchema(apiDashboardTopBrokersSchema)
export const apiDashboardUpcomingTasksResponseSchema = apiEnvelopeSchema(apiDashboardUpcomingTasksSchema)
export const apiDashboardDealsEvolutionResponseSchema = apiEnvelopeSchema(apiDashboardDealsEvolutionSchema)
export const apiDashboardExtraCountsResponseSchema = apiEnvelopeSchema(apiDashboardExtraCountsSchema)
export const apiDashboardRecentActivitiesResponseSchema = apiEnvelopeSchema(apiDashboardRecentActivitiesSchema)
export const apiDashboardTeamLeadIdsSchema = z.object({ leadIds: z.array(uuidSchema) }).passthrough()

export const analyticsQuerySchema = z.record(z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
  z.null(),
  z.undefined(),
]))
