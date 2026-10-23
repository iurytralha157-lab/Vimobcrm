import { z } from 'zod'
import { apiEnvelopeSchema, nonNegativeIntegerSchema, timestampSchema, uuidSchema } from './common'
import { filterTextSchema, MAX_LEAD_SOURCE_FILTER_LENGTH } from './filter-text'
import { queueOperatingScheduleSchema } from './queue-runtime'
import { manualActivityCreateInputSchema } from '@/lib/validation/manual-activities'
import { DISTRIBUTION_QUEUE_NAME_ERROR, isValidDistributionQueueName } from '@/lib/round-robin/queue-name'
import { countDistributionQueueInputCharacters } from '@/lib/round-robin/input-text'

export const contactListQuerySchema = z.object({
  search: filterTextSchema(180).optional(),
  teamId: uuidSchema.optional(),
  pipelineId: uuidSchema.optional(),
  stageId: uuidSchema.optional(),
  assigneeId: uuidSchema.optional(),
  unassigned: z.boolean().optional(),
  tagIds: z.array(uuidSchema).max(50).transform((tagIds) => Array.from(new Set(tagIds))).optional(),
  tagId: uuidSchema.optional(),
  source: filterTextSchema(MAX_LEAD_SOURCE_FILTER_LENGTH).optional(),
  pageId: filterTextSchema(255).optional(),
  campaignId: filterTextSchema(255).optional(),
  campaignIds: z.array(filterTextSchema(255, 1)).max(50).transform((ids) => [...new Set(ids)].sort()).optional(),
  adSetId: filterTextSchema(255).optional(),
  adId: filterTextSchema(255).optional(),
  dealStatus: z.enum(['open', 'won', 'lost']).optional(),
  createdFrom: z.string().trim().datetime({ offset: true }).optional(),
  createdTo: z.string().trim().datetime({ offset: true }).optional(),
  sortBy: z.enum(['created_at', 'name', 'last_interaction_at', 'stage']).optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
  page: z.number().int().min(1).max(10_000).optional(),
  limit: z.number().int().min(1).max(500).optional(),
  mode: z.enum(['compact', 'full', 'export']).default('compact'),
  responseMode: z.literal('page').optional(),
  expectedExportVersion: z.string().regex(/^[a-f0-9]{64}$/).optional(),
}).strict().superRefine((query, context) => {
  if (query.expectedExportVersion && (query.responseMode !== 'page' || query.mode === 'compact')) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['expectedExportVersion'], message: 'A versão de exportação exige a resposta paginada completa' })
  }
  if (Boolean(query.createdFrom) !== Boolean(query.createdTo)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['createdTo'], message: 'Informe o início e o fim do período' })
    return
  }
  if (!query.createdFrom || !query.createdTo) return
  const duration = Date.parse(query.createdTo) - Date.parse(query.createdFrom)
  if (duration < 0 || duration > 5 * 366 * 24 * 60 * 60 * 1000) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['createdTo'], message: 'Período inválido ou superior a cinco anos' })
  }
})
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
export const apiContactPageResponseSchema = z.object({
  data: z.array(apiContactSchema),
  total: nonNegativeIntegerSchema,
  page: z.number().int().min(1).max(10_000),
  limit: z.number().int().min(1).max(500),
  exportVersion: z.string().regex(/^[a-f0-9]{64}$/).optional(),
}).passthrough()

export const tagHexColorSchema = z.string().trim().regex(/^#[\da-f]{6}$/i, 'Use uma cor hexadecimal #RRGGBB')
const tagMutationShape = {
  name: z.string().trim().min(1).max(80),
  color: tagHexColorSchema,
  description: z.string().trim().max(300).optional(),
}
export const createTagInputSchema = z.object(tagMutationShape).strict()
export const updateTagInputSchema = z.object({
  ...tagMutationShape,
  expected_updated_at: z.string().trim().datetime({ offset: true }),
}).strict()
export const apiTagSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  color: z.string(),
  description: z.string().nullable(),
  organization_id: uuidSchema,
  created_at: timestampSchema,
  updated_at: timestampSchema,
  lead_count: nonNegativeIntegerSchema.optional(),
}).passthrough()
export const apiTagListResponseSchema = apiEnvelopeSchema(z.array(apiTagSchema))
export const apiTagResponseSchema = apiEnvelopeSchema(apiTagSchema)
export const apiTagUsageResponseSchema = apiEnvelopeSchema(z.object({
  updated_at: timestampSchema,
  lead_count: nonNegativeIntegerSchema,
  usages: z.array(z.object({
    kind: z.enum(['distribution_rule', 'distribution_auto_tags', 'automation', 'automation_execution', 'stage_automation', 'meta_form', 'webhook']),
    count: nonNegativeIntegerSchema,
  }).strict()),
}).strict())

const leadSourceMutationShape = {
  name: z.string().trim().min(1).max(80),
}
export const createLeadSourceInputSchema = z.object(leadSourceMutationShape).strict()
export const apiLeadSourceSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  organization_id: uuidSchema,
  created_at: timestampSchema,
}).passthrough()
export const apiLeadSourceListResponseSchema = apiEnvelopeSchema(z.array(apiLeadSourceSchema))
export const apiLeadSourceResponseSchema = apiEnvelopeSchema(apiLeadSourceSchema)

export const activityListQuerySchema = z.object({
  leadId: uuidSchema.optional(),
  limit: z.number().int().min(1).max(500).optional(),
}).strict()
export const createActivityInputSchema = manualActivityCreateInputSchema
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
  if (input.is_all_day) return

  const start = input.start_time
  const end = input.end_time
  const clockPattern = /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/
  const required = input.is_active !== false
  if ((required && !start) || (start != null && !clockPattern.test(start))) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['start_time'],
      message: 'Horario inicial invalido',
    })
  }
  if ((required && !end) || (end != null && !clockPattern.test(end))) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['end_time'],
      message: 'Horario final invalido',
    })
  }
  // start === end (a zero-length window) is invalid, but start > end is
  // allowed: it represents a shift that rolls over past midnight into the
  // next day (e.g. 22:00 to 06:00).
  const normalizedStart = start?.length === 5 ? `${start}:00` : start
  const normalizedEnd = end?.length === 5 ? `${end}:00` : end
  if (required && start && end && clockPattern.test(start) && clockPattern.test(end) && normalizedStart === normalizedEnd) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['end_time'],
      message: 'Horario final deve ser diferente do horario inicial',
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
const teamRevisionSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
export const createTeamInputSchema = z.object(teamMutationShape).strict().superRefine(
  (input, ctx) => {
    if (!input.name) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['name'],
        message: 'Nome e obrigatorio',
      })
    }
    if (input.members !== undefined && input.memberIds !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['memberIds'],
        message: 'Informe members ou memberIds, nao ambos',
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
export const updateTeamBodySchema = z.object({
  ...teamMutationShape,
  expected_revision: teamRevisionSchema,
  expected_member_ids: z.array(uuidSchema).max(500).optional(),
}).strict().superRefine((input, ctx) => {
  if (input.members !== undefined && input.memberIds !== undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['memberIds'],
      message: 'Informe members ou memberIds, nao ambos',
    })
  }
  if ((input.members !== undefined || input.memberIds !== undefined) && input.expected_member_ids === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['expected_member_ids'],
      message: 'Informe os membros observados na ultima leitura da equipe',
    })
  }
}).refine(
  (input) => Object.entries(input).some(
    ([key, value]) => !['expected_revision', 'expected_member_ids'].includes(key) && value !== undefined,
  ),
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
    expected_revision: teamRevisionSchema,
    ...availabilityDayInputShape,
  })
  .strict()
  .superRefine(validateAvailabilityTimeRange)
export const bulkAvailabilityInputSchema = z.object({
  expected_revision: teamRevisionSchema,
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
  revision: teamRevisionSchema,
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
export const apiTeamHistoryEventSchema = z.object({
  id: uuidSchema,
  action: z.string().min(1),
  entity_type: z.string().min(1),
  entity_id: uuidSchema,
  old_data: z.record(z.unknown()).nullable().optional(),
  new_data: z.record(z.unknown()).nullable().optional(),
  diff: z.record(z.unknown()).nullable().optional(),
  created_at: timestampSchema,
  user: apiTeamUserSchema.nullable().optional(),
  subject_user: apiTeamUserSchema.nullable().optional(),
}).passthrough()
export const apiTeamDistributionStatsSchema = z.object({
  totalEvents: nonNegativeIntegerSchema,
  uniqueLeads: nonNegativeIntegerSchema,
  redistributionEvents: nonNegativeIntegerSchema,
  coverage: z.enum(['complete', 'partial']),
  completeSince: timestampSchema,
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
export const apiTeamHistoryListResponseSchema = apiEnvelopeSchema(z.array(apiTeamHistoryEventSchema))
export const apiTeamDistributionStatsResponseSchema = apiEnvelopeSchema(apiTeamDistributionStatsSchema)
export const apiTeamPipelineListResponseSchema = apiEnvelopeSchema(z.array(apiTeamPipelineSchema))
export const apiTeamPipelineResponseSchema = apiEnvelopeSchema(apiTeamPipelineSchema)
export const apiAvailabilityListResponseSchema = apiEnvelopeSchema(z.array(apiAvailabilitySchema))
export const apiAvailabilityResponseSchema = apiEnvelopeSchema(apiAvailabilitySchema)
export const apiAvailabilitySnapshotResponseSchema = z.object({
  data: z.array(apiAvailabilitySchema),
  revision: teamRevisionSchema,
}).passthrough()
export const apiAvailabilityMutationResponseSchema = z.object({
  data: apiAvailabilitySchema,
  revision: teamRevisionSchema,
}).passthrough()
export const apiTeamLogoResponseSchema = apiEnvelopeSchema(z.object({ url: z.string().min(1) }).passthrough())

const roundRobinRuleInputSchema = z.object({
  id: uuidSchema.optional(),
  matchType: z.string().trim().min(1).max(80),
  // Unchanged snapshots identified by ID may exceed today's creation limit.
  // The server compares the persisted matcher before permitting that exception.
  matchValue: z.string(),
  match: z.record(z.unknown()).optional(),
  priority: nonNegativeIntegerSchema.max(2_147_483_647).optional(),
  isActive: z.boolean().optional(),
}).strict()
const roundRobinMemberInputSchema = z.object({
  id: uuidSchema.optional(),
  type: z.enum(['user', 'team']),
  entityId: uuidSchema,
  teamId: uuidSchema.optional(),
  weight: z.number().int().min(1).max(1_000).optional(),
  isActive: z.boolean().optional(),
}).strict()
const roundRobinConditionInputSchema = z.object({
  id: z.string().trim().max(200).optional(),
  priority: nonNegativeIntegerSchema.max(2_147_483_647).optional(),
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
const roundRobinSettingsSchema = z.object({
  operating_schedule: queueOperatingScheduleSchema.optional(),
  pool_notifications: z.object({ enabled: z.boolean() }).strict().optional(),
  auto_tag_ids: z.array(uuidSchema).max(50).transform((tagIds) => Array.from(new Set(tagIds))).optional(),
  enable_redistribution: z.boolean().optional(),
  redistribution_timeout_minutes: z.number().int().min(1).max(10_080).optional(),
  redistribution_warning_minutes: z.number().int().min(0).max(10_079).optional(),
  redistribution_max_attempts: z.number().int().min(0).max(1_000).optional(),
  whatsapp_distribution_auto_reply_enabled: z.boolean().optional(),
  whatsapp_distribution_auto_reply_message: z.string().trim().refine((value) => {
    const length = countDistributionQueueInputCharacters(value)
    return length >= 1 && length <= 4_000
  }, 'A mensagem deve conter entre 1 e 4000 caracteres.').optional(),
  whatsapp_distribution_auto_reply_delay_seconds: z.number().int().min(1).max(3_600).optional(),
}).passthrough().superRefine((settings, context) => {
  const timeout = settings.redistribution_timeout_minutes ?? 20;
  const warning = settings.redistribution_warning_minutes ?? (timeout <= 5 ? 0 : 5);
  if ((timeout <= 5 && warning !== 0) || (timeout > 5 && warning >= timeout)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['redistribution_warning_minutes'], message: timeout <= 5 ? 'Prazos de até 5 minutos não permitem aviso prévio.' : 'O aviso deve ocorrer antes do prazo de redistribuição.' });
  }
})
const roundRobinShape = {
  name: z.string().trim().refine(isValidDistributionQueueName, DISTRIBUTION_QUEUE_NAME_ERROR).optional(),
  strategy: z.enum(['simple', 'weighted']).optional(),
  targetPipelineId: uuidSchema.nullish(),
  targetStageId: uuidSchema.nullish(),
  isActive: z.boolean().nullish(),
  settings: roundRobinSettingsSchema.optional(),
  reentryBehavior: z.enum(['redistribute', 'keep_assignee']).optional(),
  conditions: z.array(roundRobinConditionInputSchema).optional(),
  rules: z.array(roundRobinRuleInputSchema).max(200).optional(),
  members: z.array(roundRobinMemberInputSchema).max(500).optional(),
}
export const createRoundRobinInputSchema = z.object(roundRobinShape).strict().refine(
  (input) => Boolean(input.name),
  { path: ['name'], message: 'Nome e obrigatorio' },
)
export const updateRoundRobinInputSchema = z.object({
  ...roundRobinShape,
  // The server accepts unchanged/reduced legacy snapshots above today's create
  // limits under the queue lock; it rejects additions or edits above those caps.
  rules: z.array(roundRobinRuleInputSchema).optional(),
  members: z.array(roundRobinMemberInputSchema).optional(),
  expectedRevision: teamRevisionSchema,
}).strict().refine(
  (input) => Object.entries(input).some(([key, value]) => key !== 'expectedRevision' && value !== undefined),
  'Informe ao menos uma alteracao',
)
export const createRoundRobinRuleInputSchema = roundRobinRuleInputSchema.extend({ expectedRevision: teamRevisionSchema, matchValue: z.string().max(18_099) })
export const updateRoundRobinRuleInputSchema = roundRobinRuleInputSchema.partial().extend({ expectedRevision: teamRevisionSchema }).refine(
  (input) => Object.entries(input).some(([key, value]) => key !== 'expectedRevision' && value !== undefined),
  'Informe ao menos uma alteracao',
)
export const addRoundRobinMemberInputSchema = z.object({
  expectedRevision: teamRevisionSchema,
  userId: uuidSchema.optional(),
  teamId: uuidSchema.optional(),
  weight: z.number().int().min(1).max(1_000).optional(),
  isActive: z.boolean().optional(),
}).strict().refine((input) => Boolean(input.userId || input.teamId), 'Informe usuario ou time')
export const updateRoundRobinMemberInputSchema = z.object({
  expectedRevision: teamRevisionSchema,
  weight: z.number().int().min(1).max(1_000).optional(),
  position: nonNegativeIntegerSchema.max(2_147_483_647).optional(),
  isActive: z.boolean().optional(),
}).strict().refine((input) => Object.keys(input).some((key) => key !== 'expectedRevision'), 'Informe ao menos uma alteracao')

export const apiRoundRobinRuleSchema = z.object({
  id: uuidSchema,
  roundRobinId: uuidSchema,
  queueRevision: teamRevisionSchema.optional(),
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
  queueRevision: teamRevisionSchema.optional(),
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
  revision: teamRevisionSchema,
  eligibleUserCount: nonNegativeIntegerSchema.optional(),
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
export const apiRoundRobinHistoryEventSchema = z.object({
  id: uuidSchema,
  action: z.string().min(1),
  entity_type: z.enum([
    'distribution_queue',
    'distribution_queue_rule',
    'distribution_queue_member',
  ]),
  entity_id: uuidSchema,
  old_data: z.record(z.unknown()).nullable().optional(),
  new_data: z.record(z.unknown()).nullable().optional(),
  diff: z.record(z.unknown()).nullable().optional(),
  created_at: timestampSchema,
  user: apiTeamUserSchema.nullable().optional(),
  subject_user: apiTeamUserSchema.nullable().optional(),
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
export const apiRoundRobinMetaFormOptionSchema = z.object({
  configId: uuidSchema,
  formId: z.string().trim().min(1),
  formName: z.string().optional(),
  pageId: z.string().trim().min(1).optional(),
  pageName: z.string().optional(),
  roundRobinId: uuidSchema.optional(),
  isActive: z.boolean(),
  integrationConnected: z.boolean(),
}).strict()
export const apiRoundRobinListResponseSchema = apiEnvelopeSchema(z.array(apiRoundRobinSchema))
export const apiRoundRobinResponseSchema = apiEnvelopeSchema(apiRoundRobinSchema)
export const apiRoundRobinHistoryListResponseSchema = apiEnvelopeSchema(
  z.array(apiRoundRobinHistoryEventSchema),
)
export const apiRoundRobinWhatsAppSessionOptionListResponseSchema = apiEnvelopeSchema(
  z.array(apiRoundRobinWhatsAppSessionOptionSchema),
)
export const apiRoundRobinMetaFormOptionListResponseSchema = apiEnvelopeSchema(
  z.array(apiRoundRobinMetaFormOptionSchema),
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
  queued: z.boolean(),
  notification: apiNotificationSchema.nullable().optional(),
  error: z.string().optional(),
}).passthrough()
