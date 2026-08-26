import { z } from 'zod'
import { apiEnvelopeSchema, nonNegativeIntegerSchema, timestampSchema, uuidSchema } from './common'

export const contactListQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  teamId: uuidSchema.optional(),
  pipelineId: uuidSchema.optional(),
  stageId: uuidSchema.optional(),
  assigneeId: uuidSchema.optional(),
  unassigned: z.boolean().optional(),
  tagId: uuidSchema.optional(),
  source: z.string().trim().max(120).optional(),
  campaignId: z.string().trim().max(255).optional(),
  adSetId: z.string().trim().max(255).optional(),
  adId: z.string().trim().max(255).optional(),
  dealStatus: z.enum(['open', 'won', 'lost']).optional(),
  createdFrom: z.string().trim().max(40).optional(),
  createdTo: z.string().trim().max(40).optional(),
  sortBy: z.enum(['created_at', 'name', 'last_interaction_at', 'stage']).optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
  page: z.number().int().min(1).optional(),
  limit: z.number().int().min(1).max(500).optional(),
  mode: z.enum(['compact', 'full', 'export']).default('compact'),
}).strict()
export const apiContactSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  created_at: timestampSchema,
  updated_at: timestampSchema,
  tags: z.array(z.object({
    id: uuidSchema,
    name: z.string(),
    color: z.string(),
  }).passthrough()),
  total_count: nonNegativeIntegerSchema,
}).passthrough()
export const apiContactListResponseSchema = apiEnvelopeSchema(z.array(apiContactSchema))

export const tagHexColorSchema = z.string().trim().regex(/^#[\da-f]{6}$/i, 'Use uma cor hexadecimal #RRGGBB')
const tagMutationShape = {
  name: z.string().trim().min(1).max(80),
  color: tagHexColorSchema,
  description: z.string().trim().max(300).optional(),
}
export const createTagInputSchema = z.object(tagMutationShape).strict()
export const updateTagInputSchema = z.object(tagMutationShape).strict()
export const apiTagSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  color: z.string(),
  description: z.string().nullable(),
  organization_id: uuidSchema,
  created_at: timestampSchema,
  lead_count: nonNegativeIntegerSchema.optional(),
}).passthrough()
export const apiTagListResponseSchema = apiEnvelopeSchema(z.array(apiTagSchema))
export const apiTagResponseSchema = apiEnvelopeSchema(apiTagSchema)

export const activityListQuerySchema = z.object({
  leadId: uuidSchema.optional(),
  limit: z.number().int().min(1).max(500).optional(),
}).strict()
export const createActivityInputSchema = z.object({
  lead_id: uuidSchema,
  type: z.string().trim().min(1).max(120),
  content: z.string().trim().max(2_000).optional(),
  metadata: z.unknown().optional(),
}).strict()
export const apiActivitySchema = z.object({
  id: uuidSchema,
  organization_id: uuidSchema,
  lead_id: uuidSchema,
  user_id: uuidSchema.nullable(),
  type: z.string(),
  content: z.string().nullable(),
  metadata: z.unknown(),
  created_at: timestampSchema,
}).passthrough()
export const apiActivityListResponseSchema = apiEnvelopeSchema(z.array(apiActivitySchema))
export const apiActivityResponseSchema = apiEnvelopeSchema(apiActivitySchema)

const availabilityDayInputShape = {
  day_of_week: z.number().int().min(0).max(6),
  start_time: z.string().trim().max(20).nullish(),
  end_time: z.string().trim().max(20).nullish(),
  is_all_day: z.boolean().optional(),
  is_active: z.boolean().optional(),
}

function validateAvailabilityTimeRange(
  input: {
    start_time?: string | null
    end_time?: string | null
    is_all_day?: boolean
    is_active?: boolean
  },
  ctx: z.RefinementCtx,
) {
  if (input.is_active === false || input.is_all_day) return

  const start = input.start_time?.slice(0, 5)
  const end = input.end_time?.slice(0, 5)
  const clockPattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/
  if (!start || !clockPattern.test(start)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['start_time'],
      message: 'Horario inicial invalido',
    })
  }
  if (!end || !clockPattern.test(end)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['end_time'],
      message: 'Horario final invalido',
    })
  }
  if (start && end && clockPattern.test(start) && clockPattern.test(end) && start >= end) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['end_time'],
      message: 'Horario final deve ser posterior ao horario inicial',
    })
  }
}

const availabilityDayInputSchema = z
  .object(availabilityDayInputShape)
  .strict()
  .superRefine(validateAvailabilityTimeRange)

export const memberAvailabilityWeekInputSchema = z
  .array(availabilityDayInputSchema)
  .length(7)
  .superRefine((availability, ctx) => {
    const days = new Set(availability.map((entry) => entry.day_of_week))
    if (days.size !== 7 || [...Array(7)].some((_, day) => !days.has(day))) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'A escala deve conter exatamente os sete dias da semana',
      })
    }
    if (!availability.some((entry) => entry.is_active !== false)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'A escala deve ter ao menos um dia ativo',
      })
    }
  })

const teamMemberInputSchema = z.object({
  userId: uuidSchema,
  isLeader: z.boolean().optional(),
  availability: memberAvailabilityWeekInputSchema.optional(),
}).strict()
const teamMutationShape = {
  name: z.string().trim().min(1).max(120).optional(),
  memberIds: z.array(uuidSchema).max(500).optional(),
  members: z.array(teamMemberInputSchema).max(500).optional(),
  logo_url: z.string().trim().max(2_000).nullable().optional(),
  is_active: z.boolean().optional(),
  preserveLeadership: z.boolean().optional(),
}
export const createTeamInputSchema = z.object(teamMutationShape).strict().superRefine(
  (input, ctx) => {
    if (!input.name) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['name'],
        message: 'Nome e obrigatorio',
      })
    }
    if (input.memberIds?.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['memberIds'],
        message: 'Use members para informar a escala de cada membro',
      })
    }
    input.members?.forEach((member, index) => {
      if (!member.availability) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['members', index, 'availability'],
          message: 'A escala completa e obrigatoria ao criar uma equipe',
        })
      }
    })
  },
)
export const updateTeamBodySchema = z.object(teamMutationShape).strict().refine(
  (input) => Object.values(input).some((value) => value !== undefined),
  'Informe ao menos uma alteracao',
)
export const teamPipelineInputSchema = z.object({ teamId: uuidSchema, pipelineId: uuidSchema }).strict()
export const teamLeaderInputSchema = z.object({
  teamId: uuidSchema,
  userId: uuidSchema,
  isLeader: z.boolean(),
}).strict()
export const availabilityInputSchema = z
  .object({
    team_member_id: uuidSchema,
    ...availabilityDayInputShape,
  })
  .strict()
  .superRefine(validateAvailabilityTimeRange)
export const bulkAvailabilityInputSchema = z.object({
  availability: memberAvailabilityWeekInputSchema,
}).strict()

const apiTeamUserSchema = z.object({
  id: uuidSchema,
  name: z.string().nullable(),
  email: z.string().nullable().optional(),
  avatar_url: z.string().nullable().optional(),
}).passthrough()
export const apiTeamSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  organization_id: uuidSchema,
  created_at: timestampSchema,
  is_active: z.boolean().optional(),
  logo_url: z.string().nullable().optional(),
  created_by: uuidSchema.nullable().optional(),
  created_by_user: apiTeamUserSchema.nullable().optional(),
  members: z.array(z.object({
    id: uuidSchema,
    team_id: uuidSchema,
    user_id: uuidSchema,
    created_at: timestampSchema,
    is_leader: z.boolean().optional(),
    user: apiTeamUserSchema.nullable().optional(),
  }).passthrough()).optional(),
}).passthrough()
export const apiTeamPipelineSchema = z.object({
  id: uuidSchema,
  team_id: uuidSchema,
  pipeline_id: uuidSchema,
  created_at: timestampSchema,
  pipeline: z.object({ id: uuidSchema, name: z.string() }).passthrough().nullable(),
}).passthrough()
export const apiAvailabilitySchema = z.object({
  id: uuidSchema,
  team_member_id: uuidSchema,
  day_of_week: z.number().int().min(0).max(6),
  start_time: z.string().nullable(),
  end_time: z.string().nullable(),
  is_all_day: z.boolean(),
  is_active: z.boolean(),
  created_at: timestampSchema,
  updated_at: timestampSchema,
}).passthrough()
export const apiTeamListResponseSchema = apiEnvelopeSchema(z.array(apiTeamSchema))
export const apiTeamResponseSchema = apiEnvelopeSchema(apiTeamSchema)
export const apiTeamPipelineListResponseSchema = apiEnvelopeSchema(z.array(apiTeamPipelineSchema))
export const apiTeamPipelineResponseSchema = apiEnvelopeSchema(apiTeamPipelineSchema)
export const apiAvailabilityListResponseSchema = apiEnvelopeSchema(z.array(apiAvailabilitySchema))
export const apiAvailabilityResponseSchema = apiEnvelopeSchema(apiAvailabilitySchema)
export const apiTeamLogoResponseSchema = apiEnvelopeSchema(z.object({ url: z.string().min(1) }).passthrough())

const roundRobinRuleInputSchema = z.object({
  matchType: z.string().trim().min(1).max(80),
  matchValue: z.string().trim().max(600),
  match: z.record(z.unknown()).optional(),
  priority: nonNegativeIntegerSchema.optional(),
  isActive: z.boolean().optional(),
}).strict()
const roundRobinMemberInputSchema = z.object({
  id: uuidSchema.optional(),
  type: z.enum(['user', 'team']),
  entityId: uuidSchema,
  teamId: uuidSchema.optional(),
  weight: z.number().int().min(1).max(1_000).optional(),
}).strict()
const roundRobinConditionInputSchema = z.object({
  id: z.string().trim().max(200).optional(),
  type: z.string().trim().min(1).max(80),
  values: z.array(z.string().trim().max(180)).max(100),
  sessionId: uuidSchema.optional(),
}).strict().superRefine((condition, context) => {
  if (condition.type === 'whatsapp_message_contains' && !condition.sessionId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['sessionId'],
      message: 'Selecione a conexão do WhatsApp para esta campanha',
    })
  }
})
const roundRobinShape = {
  name: z.string().trim().min(2).max(120).optional(),
  strategy: z.enum(['simple', 'weighted']).optional(),
  targetPipelineId: uuidSchema.nullish(),
  targetStageId: uuidSchema.nullish(),
  isActive: z.boolean().nullish(),
  settings: z.record(z.unknown()).optional(),
  reentryBehavior: z.enum(['redistribute', 'keep_assignee']).optional(),
  conditions: z.array(roundRobinConditionInputSchema).optional(),
  rules: z.array(roundRobinRuleInputSchema).max(200).optional(),
  members: z.array(roundRobinMemberInputSchema).max(500).optional(),
}
export const createRoundRobinInputSchema = z.object(roundRobinShape).strict().refine(
  (input) => Boolean(input.name),
  { path: ['name'], message: 'Nome e obrigatorio' },
)
export const updateRoundRobinInputSchema = z.object(roundRobinShape).strict().refine(
  (input) => Object.values(input).some((value) => value !== undefined),
  'Informe ao menos uma alteracao',
)
export const createRoundRobinRuleInputSchema = roundRobinRuleInputSchema
export const updateRoundRobinRuleInputSchema = roundRobinRuleInputSchema.partial().refine(
  (input) => Object.values(input).some((value) => value !== undefined),
  'Informe ao menos uma alteracao',
)
export const addRoundRobinMemberInputSchema = z.object({
  userId: uuidSchema.optional(),
  teamId: uuidSchema.optional(),
  weight: z.number().int().min(1).max(1_000).optional(),
}).strict().refine((input) => Boolean(input.userId || input.teamId), 'Informe usuario ou time')
export const updateRoundRobinMemberInputSchema = z.object({
  weight: z.number().int().min(1).max(1_000).optional(),
  position: nonNegativeIntegerSchema.optional(),
  isActive: z.boolean().optional(),
}).strict().refine((input) => Object.keys(input).length > 0, 'Informe ao menos uma alteracao')

export const apiRoundRobinRuleSchema = z.object({
  id: uuidSchema,
  roundRobinId: uuidSchema,
  matchType: z.string(),
  matchValue: z.string(),
  match: z.record(z.unknown()).optional(),
  priority: nonNegativeIntegerSchema,
  isActive: z.boolean(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
}).passthrough()
export const apiRoundRobinMemberSchema = z.object({
  id: uuidSchema,
  roundRobinId: uuidSchema,
  userId: uuidSchema.nullish(),
  teamId: uuidSchema.optional(),
  position: nonNegativeIntegerSchema,
  weight: z.number().int().min(1),
  isActive: z.boolean(),
  leadsCount: nonNegativeIntegerSchema,
}).passthrough()
export const apiRoundRobinSchema = z.object({
  id: uuidSchema,
  organizationId: uuidSchema,
  name: z.string(),
  isActive: z.boolean(),
  lastAssignedIndex: z.number().int(),
  strategy: z.string(),
  leadsDistributed: nonNegativeIntegerSchema,
  rules: z.array(apiRoundRobinRuleSchema),
  members: z.array(apiRoundRobinMemberSchema),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
}).passthrough()
export const apiRoundRobinWhatsAppSessionOptionSchema = z.object({
  id: uuidSchema,
  instanceName: z.string(),
  displayName: z.string().optional(),
  phoneNumber: z.string().optional(),
  status: z.string(),
  provider: z.literal('evolution_go'),
  isActive: z.boolean(),
}).strict()
export const apiRoundRobinListResponseSchema = apiEnvelopeSchema(z.array(apiRoundRobinSchema))
export const apiRoundRobinResponseSchema = apiEnvelopeSchema(apiRoundRobinSchema)
export const apiRoundRobinWhatsAppSessionOptionListResponseSchema = apiEnvelopeSchema(
  z.array(apiRoundRobinWhatsAppSessionOptionSchema),
)
export const apiRoundRobinRuleListResponseSchema = apiEnvelopeSchema(z.array(apiRoundRobinRuleSchema))
export const apiRoundRobinRuleResponseSchema = apiEnvelopeSchema(apiRoundRobinRuleSchema)
export const apiRoundRobinMemberListResponseSchema = apiEnvelopeSchema(z.array(apiRoundRobinMemberSchema))
export const apiRoundRobinMemberResponseSchema = apiEnvelopeSchema(apiRoundRobinMemberSchema)

export const createNotificationInputSchema = z.object({
  user_id: uuidSchema,
  organization_id: uuidSchema,
  title: z.string().trim().min(1).max(180),
  content: z.string().trim().max(2_000).optional(),
  type: z.string().trim().max(120).optional(),
  lead_id: uuidSchema.optional(),
  metadata: z.record(z.unknown()).optional(),
}).strict()
export const dispatchNotificationInputSchema = z.object({
  event_key: z.string().trim().max(180).optional(),
  template_slug: z.string().trim().max(180).optional(),
  organization_id: uuidSchema,
  user_id: uuidSchema.optional(),
  recipient: z.string().trim().max(500).optional(),
  title: z.string().trim().max(180).optional(),
  content: z.string().trim().max(4_000).optional(),
  variables: z.record(z.unknown()),
  lead_id: uuidSchema.optional(),
  dedupe_key: z.string().trim().max(255).optional(),
  is_test: z.boolean().optional(),
  channels: z.array(z.enum(['system', 'whatsapp', 'email', 'push'])).max(4).optional(),
}).strict()
export const apiNotificationSchema = z.object({
  id: uuidSchema,
  user_id: uuidSchema,
  organization_id: uuidSchema,
  title: z.string(),
  content: z.string().nullable(),
  type: z.string(),
  is_read: z.boolean(),
  lead_id: uuidSchema.nullable(),
  target_url: z.string().nullable().optional(),
  metadata: z.record(z.unknown()).nullable().optional(),
  created_at: timestampSchema,
}).passthrough()
export const apiNotificationListResponseSchema = apiEnvelopeSchema(z.array(apiNotificationSchema)).extend({
  next_cursor: z.string().trim().min(1).max(512).nullable().optional(),
})
export const apiNotificationResponseSchema = apiEnvelopeSchema(apiNotificationSchema)
export const apiUnreadCountResponseSchema = z.object({ count: nonNegativeIntegerSchema }).passthrough()
export const apiDispatchNotificationResponseSchema = z.object({
  success: z.boolean(),
  notification: apiNotificationSchema.nullable().optional(),
  error: z.string().optional(),
}).passthrough()
