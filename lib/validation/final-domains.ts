import { z } from 'zod'
import { apiEnvelopeSchema, nonNegativeIntegerSchema, timestampSchema, uuidSchema } from './common'

export const dynamicRecordSchema = z.record(z.unknown())
export const nonEmptyDynamicRecordSchema = dynamicRecordSchema.refine(
  (input) => Object.keys(input).length > 0,
  'Informe ao menos um campo',
)
export const safePathSegmentSchema = z.string().trim().min(1).max(120).regex(/^[a-zA-Z0-9_-]+$/)
export const opaqueTokenSchema = z.string().trim().min(8).max(2_000)
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
  role: z.string().trim().min(1).max(80),
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
export const adminPeriodSchema = z.number().int().min(1).max(3650)
export const adminListLimitSchema = z.number().int().min(1).max(500)
export const adminOrganizationMutationInputSchema = nonEmptyDynamicRecordSchema
export const adminUserMutationInputSchema = nonEmptyDynamicRecordSchema
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

const dashboardNumberSchema = z.number().finite()
export const dashboardFiltersSchema = z.object({
  dateRange: z.object({ from: z.date(), to: z.date() }).nullable().optional(),
  granularity: z.enum(['hour', 'day', 'week', 'month']).nullable().optional(),
  teamId: uuidSchema.nullish(),
  userId: uuidSchema.nullish(),
  source: z.string().trim().max(180).nullish(),
  campaignId: z.string().trim().max(255).nullish(),
  adSetId: z.string().trim().max(255).nullish(),
  adId: z.string().trim().max(255).nullish(),
  tagId: uuidSchema.nullish(),
  dealStatus: z.string().trim().max(80).nullish(),
  searchQuery: z.string().trim().max(180).nullish(),
}).strict()
export const dashboardOptionalIdSchema = uuidSchema.nullish()
export const dashboardLimitSchema = z.number().int().min(1).max(500).optional()
export const apiDashboardStatsSchema = z.object({
  totalLeads: nonNegativeIntegerSchema,
  leadsInProgress: nonNegativeIntegerSchema,
  leadsClosed: nonNegativeIntegerSchema,
  leadsLost: nonNegativeIntegerSchema,
  conversionRate: dashboardNumberSchema,
  totalSalesValue: dashboardNumberSchema,
  pendingCommissions: dashboardNumberSchema,
  wonConversionBuckets: z.array(z.record(z.unknown())),
  wonDeals: z.array(z.record(z.unknown())),
  lostReasonBuckets: z.array(z.record(z.unknown())),
  lostDeals: z.array(z.record(z.unknown())),
}).passthrough()
export const apiDashboardFunnelSchema = z.array(z.object({
  name: z.string(), value: dashboardNumberSchema, percentage: dashboardNumberSchema, stage_key: z.string(),
}).passthrough())
export const apiDashboardSourceSchema = z.array(z.object({
  name: z.string(), value: dashboardNumberSchema, rawSource: z.string(),
}).passthrough())
export const apiDashboardTopBrokersSchema = z.object({
  brokers: z.array(z.record(z.unknown())),
  isFallbackMode: z.boolean(),
}).passthrough()
export const apiDashboardUpcomingTasksSchema = z.array(z.object({
  id: uuidSchema,
  title: z.string(),
  type: z.enum(['call', 'email', 'meeting', 'message', 'task']),
  due_date: timestampSchema,
  lead_name: z.string(),
  lead_id: uuidSchema,
}).passthrough())
export const apiDashboardDealsEvolutionSchema = z.array(z.object({
  date: z.string(), ganhos: dashboardNumberSchema, perdas: dashboardNumberSchema, abertos: dashboardNumberSchema,
}).passthrough())
export const apiDashboardExtraCountsSchema = z.object({
  propertyCount: nonNegativeIntegerSchema,
  siteVisits: nonNegativeIntegerSchema,
  scheduledVisits: nonNegativeIntegerSchema,
}).passthrough()
export const apiDashboardRecentActivitiesSchema = z.array(z.object({
  id: z.string().min(1),
  type: z.string(),
  content: z.string().nullable(),
  created_at: timestampSchema,
  lead_name: z.string(),
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
