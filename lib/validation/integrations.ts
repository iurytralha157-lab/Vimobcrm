import { z } from 'zod'
import { apiEnvelopeSchema, nonNegativeIntegerSchema, uuidSchema } from './common'
import {
  propertyPublicationDesiredStateSchema,
  propertyPublicationObservedStateSchema,
} from './property-publications'

export const vistaIntegrationInputSchema = z.object({
  api_url: z.string().trim().url().max(2_000),
  api_key: z.string().trim().min(1).max(2_000),
}).strict()
export const imoviewIntegrationInputSchema = z.object({
  api_key: z.string().trim().min(1).max(2_000),
}).strict()
const optionalUUID = z.union([uuidSchema, z.literal(''), z.null()]).optional()

const grupoOLXSettingsSchema = z.object({
  contact_name: z.string().trim().max(200).optional(),
  contact_email: z.string().trim().max(320).refine(
    (value) => value === '' || z.string().email().safeParse(value).success,
    'Informe um e-mail valido',
  ).optional(),
  contact_phone: z.string().trim().max(80).optional(),
  detail_base_url: z.string().trim().max(2_048).refine((value) => {
    if (value === '') return true
    try {
      const url = new URL(value)
      return url.protocol === 'https:' && Boolean(url.hostname)
    } catch {
      return false
    }
  }, 'Use uma URL HTTPS publica').optional(),
}).strict()

export const grupoOLXIntegrationInputSchema = z.object({
  defaultPipelineId: optionalUUID,
  defaultStageId: optionalUUID,
  defaultAssignedUserId: optionalUUID,
  defaultRoundRobinId: optionalUUID,
  settings: grupoOLXSettingsSchema.optional(),
}).strict()

export const grupoOLXPublicationTypeSchema = z.enum([
  'STANDARD',
  'PREMIUM',
  'SUPER_PREMIUM',
  'PREMIERE_1',
  'PREMIERE_2',
  'TRIPLE',
])

export const grupoOLXPublicationInputSchema = z.object({
  propertyId: uuidSchema,
  clientListingId: z.string().trim().min(1).max(50).optional(),
  publicationType: grupoOLXPublicationTypeSchema.optional(),
}).strict()

export const grupoOLXPublicationsInputSchema = z.object({
  publications: z.array(grupoOLXPublicationInputSchema).max(1000),
}).strict()

const grupoOLXReportTimestampSchema = z.string().trim().datetime({ offset: true })

export const grupoOLXImportReportSchema = z.object({
  id: uuidSchema,
  report_id: z.string().trim().min(1).max(512),
  status: z.enum(['received', 'success', 'warning', 'error']),
  annotation_status: z.enum(['pending', 'retry', 'succeeded', 'dead']),
  annotation_attempts: z.number().int().min(0).max(12),
  annotation_next_attempt_at: grupoOLXReportTimestampSchema.nullable().optional(),
  annotation_processed_at: grupoOLXReportTimestampSchema.nullable().optional(),
  annotation_last_error: z.string().trim().max(4_000).nullable().optional(),
  provider_occurred_at: grupoOLXReportTimestampSchema.nullable().optional(),
  created_at: grupoOLXReportTimestampSchema,
}).strict()

export const apiGrupoOLXImportReportResponseSchema = apiEnvelopeSchema(grupoOLXImportReportSchema)
export const apiGrupoOLXImportReportListResponseSchema = apiEnvelopeSchema(
  z.array(grupoOLXImportReportSchema).max(100),
)

export type GrupoOLXImportReport = z.infer<typeof grupoOLXImportReportSchema>

const grupoOLXNullableTimestampSchema = z.string().trim().datetime({ offset: true }).nullable()

export const grupoOLXIntegrationSchema = z.object({
  id: uuidSchema,
  organization_id: uuidSchema,
  portal: z.literal('grupo_olx'),
  status: z.enum(['draft', 'pending_setup', 'connected', 'paused', 'error']),
  is_active: z.boolean(),
  feed_token: z.string().trim().min(32).max(256).nullable(),
  webhook_token: z.string().trim().min(32).max(256).nullable(),
  default_pipeline_id: uuidSchema.nullable(),
  default_stage_id: uuidSchema.nullable(),
  default_assigned_user_id: uuidSchema.nullable(),
  default_round_robin_id: uuidSchema.nullable(),
  settings: grupoOLXSettingsSchema,
  last_feed_accessed_at: grupoOLXNullableTimestampSchema,
  last_lead_received_at: grupoOLXNullableTimestampSchema,
  last_import_report_at: grupoOLXNullableTimestampSchema,
  last_sync_status: z.string().trim().max(64).nullable(),
  last_error: z.string().trim().max(4_000).nullable(),
  created_at: grupoOLXReportTimestampSchema,
  updated_at: grupoOLXReportTimestampSchema,
}).strict()

const grupoOLXPublicationPropertySchema = z.object({
  id: uuidSchema,
  code: z.unknown(),
  title: z.unknown(),
  status: z.unknown(),
  tipo_de_negocio: z.unknown(),
  tipo_de_imovel: z.unknown(),
  cidade: z.unknown(),
  bairro: z.unknown(),
  preco: z.unknown(),
  valor_locacao: z.unknown(),
  imagem_principal: z.unknown(),
}).strict()

export const grupoOLXPublicationSchema = z.object({
  id: uuidSchema,
  integration_id: uuidSchema,
  property_id: uuidSchema,
  canonical_managed: z.boolean(),
  desired_state: propertyPublicationDesiredStateSchema.nullable(),
  observed_state: propertyPublicationObservedStateSchema.nullable(),
  canonical_desired_state: propertyPublicationDesiredStateSchema.nullable(),
  canonical_observed_state: propertyPublicationObservedStateSchema.nullable(),
  canonical_published_version: z.number().int().min(1).nullable(),
  client_listing_id: z.string().trim().min(1).max(50),
  publication_type: grupoOLXPublicationTypeSchema,
  is_enabled: z.boolean(),
  status: z.string().trim().max(64).nullable(),
  validation_errors: z.array(z.unknown()).max(1_000),
  last_exported_at: grupoOLXNullableTimestampSchema,
  last_seen_in_feed_at: grupoOLXNullableTimestampSchema,
  last_error: z.string().trim().max(4_000).nullable(),
  created_at: grupoOLXReportTimestampSchema,
  updated_at: grupoOLXReportTimestampSchema,
  canonical_updated_at: grupoOLXNullableTimestampSchema,
  property: grupoOLXPublicationPropertySchema,
}).strict()

export const apiGrupoOLXIntegrationResponseSchema = apiEnvelopeSchema(grupoOLXIntegrationSchema)
export const apiOptionalGrupoOLXIntegrationResponseSchema = apiEnvelopeSchema(grupoOLXIntegrationSchema.nullable())
export const apiGrupoOLXPublicationListResponseSchema = apiEnvelopeSchema(
  z.array(grupoOLXPublicationSchema).max(50_000),
)

export type GrupoOLXIntegration = z.infer<typeof grupoOLXIntegrationSchema>
export type GrupoOLXPublication = z.infer<typeof grupoOLXPublicationSchema>
export const metaFormConfigInputSchema = z.object({
  integrationId: uuidSchema,
  formId: z.string().trim().min(1).max(255),
  formName: z.string().trim().max(255).nullish(),
  propertyId: uuidSchema.nullish(),
  roundRobinId: uuidSchema.nullish(),
  purpose: z.string().trim().max(120).nullish(),
  source: z.string().trim().max(120).nullish(),
  sourceDetails: z.string().trim().max(500).nullish(),
  defaultValues: z.record(z.unknown()).optional(),
  autoTags: z.array(z.string().trim().min(1).max(120)).max(100).optional(),
  fieldMapping: z.record(z.string()).optional(),
  customFieldsConfig: z.array(z.string()).max(200).optional(),
  isActive: z.boolean().optional(),
}).strict()
export const toggleMetaFormConfigInputSchema = z.object({
  integrationId: uuidSchema,
  formId: z.string().trim().min(1).max(255),
  isActive: z.boolean(),
}).strict()
export const deleteMetaFormConfigInputSchema = toggleMetaFormConfigInputSchema.omit({ isActive: true })
export const sendMetaMessageInputSchema = z.object({
  text: z.string().trim().min(1).max(2_000),
  idempotencyKey: uuidSchema,
}).strict()

const metaConversionFeedbackTextSchema = (maximumLength: number) =>
  z.string().trim().max(maximumLength).refine(
    (value) => !/[\u0000-\u001F\u007F]/.test(value),
    'Control characters are not allowed',
  )

export const metaConversionFeedbackInputSchema = z.object({
  integrationId: uuidSchema,
  datasetId: z.string().trim().regex(/^\d{5,30}$/).nullish(),
  datasetName: metaConversionFeedbackTextSchema(160).nullish(),
  datasetAccessToken: metaConversionFeedbackTextSchema(8_192).nullish(),
  enabled: z.boolean(),
  replayRecentFacts: z.boolean(),
  testEventCode: metaConversionFeedbackTextSchema(255).pipe(z.string().min(1)).optional(),
}).strict().superRefine((input, context) => {
  if (input.enabled && !input.datasetId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['datasetId'],
      message: 'CRM Dataset ID is required when conversion feedback is enabled',
    })
  }
  if (input.replayRecentFacts && !input.enabled) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['replayRecentFacts'],
      message: 'Recent facts can only be replayed while conversion feedback is enabled',
    })
  }
  if (input.testEventCode && !input.replayRecentFacts) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['testEventCode'],
      message: 'Meta test event code is only allowed during an explicit replay',
    })
  }
})

const metaProviderIdSchema = z.string().trim().min(1).max(255)
const metaOptionalTextSchema = z.string().trim().max(255).nullish()
const metaNullableTextSchema = z.string().trim().max(255).nullable()

export const metaOAuthAdAccountSchema = z.object({
  id: metaProviderIdSchema,
  account_id: metaOptionalTextSchema,
  name: metaOptionalTextSchema,
  account_status: z.number().int().nullish(),
  currency: metaOptionalTextSchema,
  timezone_name: metaOptionalTextSchema,
}).strict()

export const metaOAuthPageSchema = z.object({
  id: metaProviderIdSchema,
  name: z.string().trim().min(1).max(255),
  picture: z.object({
    data: z.object({
      url: z.string().url().max(2_000),
    }).strict(),
  }).strict().optional(),
  instagram_business_account: z.object({
    id: metaProviderIdSchema,
    username: metaOptionalTextSchema,
  }).strict().nullish(),
  facebook_user_id: metaOptionalTextSchema,
  facebook_user_name: metaOptionalTextSchema,
}).strict()

export const metaOAuthPayloadSchema = z.object({
  flow_id: uuidSchema,
  success: z.boolean().optional(),
  pages: z.array(metaOAuthPageSchema).max(250),
  ad_accounts: z.array(metaOAuthAdAccountSchema).max(250).optional(),
  adAccountId: metaOptionalTextSchema,
  ad_account_id: metaOptionalTextSchema,
  facebook_user_id: metaOptionalTextSchema,
  facebook_user_name: metaOptionalTextSchema,
}).strict()

export const metaOAuthFlowResultSchema = z.object({
  id: uuidSchema,
  organization_id: uuidSchema,
  user_id: uuidSchema,
  status: z.string().trim().min(1).max(32),
  payload: metaOAuthPayloadSchema.nullish(),
  error_message: z.string().trim().max(255).nullish(),
  expires_at: z.string().trim().max(64).nullish(),
  consumed_at: z.string().trim().max(64).nullish(),
  created_at: z.string().trim().max(64).optional(),
  updated_at: z.string().trim().max(64).optional(),
}).strict()

export const metaAdAccountsActionResponseSchema = z.object({
  success: z.literal(true),
  ad_accounts: z.array(metaOAuthAdAccountSchema).max(250),
}).strict()

export const metaPublicIntegrationSchema = z.object({
  id: uuidSchema,
  organization_id: uuidSchema,
  page_id: metaNullableTextSchema,
  page_name: metaNullableTextSchema,
  page_picture_url: z.string().url().max(2_000).nullable(),
  facebook_user_id: metaNullableTextSchema,
  facebook_user_name: metaNullableTextSchema,
  is_connected: z.boolean().nullable(),
  integration_type: metaNullableTextSchema,
  instagram_business_account_id: metaNullableTextSchema,
  instagram_username: metaNullableTextSchema,
  ad_account_id: metaNullableTextSchema,
  selected_ad_accounts: z.unknown(),
  pipeline_id: uuidSchema.nullable(),
  stage_id: uuidSchema.nullable(),
  // Explicit compatibility with the older tokenless public view. These fields
  // are routing metadata only; credential/scopes fields remain rejected by the
  // strict object boundary below.
  assigned_user_id: uuidSchema.nullish(),
  form_ids: z.array(metaProviderIdSchema).max(1_000).nullish(),
  field_mapping: z.record(z.unknown()).nullish(),
  campaign_property_mapping: z.record(z.unknown()).nullish(),
  default_status: metaNullableTextSchema,
  leads_received: nonNegativeIntegerSchema.nullable(),
  last_lead_at: z.string().trim().max(64).nullable(),
  last_sync_at: z.string().trim().max(64).nullable(),
  last_error: z.string().trim().max(255).nullable(),
  health_status: metaNullableTextSchema,
  token_status: metaNullableTextSchema,
  token_expires_at: z.string().trim().max(64).nullable(),
  last_validated_at: z.string().trim().max(64).nullable(),
  webhook_subscribed_at: z.string().trim().max(64).nullable(),
  created_at: z.string().trim().min(1).max(64),
  updated_at: z.string().trim().min(1).max(64),
  crm_dataset_id: z.string().trim().regex(/^\d{5,30}$/).nullish(),
  crm_dataset_name: z.string().trim().max(160).nullish(),
  conversion_feedback_enabled: z.boolean().optional().default(false),
  conversion_feedback_status: z.enum([
    "not_configured",
    "active",
    "paused",
    "error",
  ]).optional().default("not_configured"),
  conversion_feedback_last_sent_at: z.string().trim().max(64).nullish(),
  conversion_feedback_last_validated_at: z.string().trim().max(64).nullish(),
  conversion_feedback_last_error: z.string().trim().max(2_000).nullish(),
  // Backward compatible with integrations listed by the pre-marketing backend.
  // Missing must fail closed: advanced data stays unavailable until the Go API
  // explicitly proves that the durable user token and required scopes exist.
  marketing_token_available: z.boolean().optional().default(false),
}).strict()

export type MetaOAuthAdAccount = z.infer<typeof metaOAuthAdAccountSchema>
export type MetaOAuthPage = z.infer<typeof metaOAuthPageSchema>
export type MetaOAuthFlowResult = z.infer<typeof metaOAuthFlowResultSchema>
export type MetaPublicIntegration = z.infer<typeof metaPublicIntegrationSchema>

export const apiIntegrationRecordSchema = z.record(z.unknown())
export const apiOptionalIntegrationResponseSchema = apiEnvelopeSchema(apiIntegrationRecordSchema.nullable())
export const apiIntegrationResponseSchema = apiEnvelopeSchema(apiIntegrationRecordSchema)
export const apiIntegrationListResponseSchema = apiEnvelopeSchema(z.array(apiIntegrationRecordSchema))
export const apiMetaWebhookHealthResponseSchema = apiEnvelopeSchema(z.object({
  counts: z.record(nonNegativeIntegerSchema),
  lastError: z.string().nullable(),
  missing: z.boolean(),
}).passthrough())
