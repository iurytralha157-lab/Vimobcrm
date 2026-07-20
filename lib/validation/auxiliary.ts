import { z } from 'zod'
import { apiEnvelopeSchema, nonNegativeIntegerSchema, timestampSchema, uuidSchema } from './common'
import { dynamicRecordSchema, nonEmptyDynamicRecordSchema, safePathSegmentSchema } from './final-domains'

const nullableString = z.string().nullable()
const optionalNullableString = z.string().max(20_000).nullish()
const optionalUUID = uuidSchema.nullish()
const finiteNullableNumber = z.number().finite().nullable()

export const uuidListSchema = z.array(uuidSchema).min(1).max(1_000)
export const organizationIdSchema = uuidSchema
export const entityIdSchema = uuidSchema

export const auditLogFiltersSchema = z.object({
  organizationId: uuidSchema.optional(),
  userId: uuidSchema.optional(),
  action: z.string().trim().max(120).optional(),
  entityType: z.string().trim().max(120).optional(),
  startDate: timestampSchema.optional(),
  endDate: timestampSchema.optional(),
}).strict()
export const auditLogListInputSchema = z.object({
  filters: auditLogFiltersSchema.optional(),
  page: z.number().int().min(1).max(10_000).optional(),
  limit: z.number().int().min(1).max(200).optional(),
  organizationId: uuidSchema.nullish(),
}).strict()
export const auditLogCreateInputSchema = z.object({
  action: z.string().trim().min(1).max(120),
  entity_type: z.string().trim().min(1).max(120),
  entity_id: z.string().trim().min(1).max(160).optional(),
  old_data: dynamicRecordSchema.optional(),
  new_data: dynamicRecordSchema.optional(),
  organization_id: uuidSchema.optional(),
  user_agent: z.string().max(500).optional(),
}).strict()
const auditLogSchema = z.object({
  id: uuidSchema,
  organization_id: uuidSchema.nullish(),
  user_id: uuidSchema.nullish(),
  action: z.string(),
  entity_type: z.string(),
  entity_id: z.string().nullish(),
  old_data: dynamicRecordSchema.nullish(),
  new_data: dynamicRecordSchema.nullish(),
  diff: dynamicRecordSchema.nullish(),
  source: z.string().nullish(),
  metadata: dynamicRecordSchema.nullish(),
  ip_address: z.string().nullish(),
  user_agent: z.string().nullish(),
  created_at: timestampSchema,
}).passthrough()
export const apiAuditLogListResponseSchema = z.object({
  data: z.array(auditLogSchema),
  count: nonNegativeIntegerSchema,
  totalPages: nonNegativeIntegerSchema,
}).passthrough()

export const userActivitySessionStatusSchema = z.enum(['online', 'idle', 'offline'])
export const userActivitySessionMutationInputSchema = z.object({
  organizationId: uuidSchema,
  userId: uuidSchema,
  sessionId: z.string().trim().min(8).max(160),
  status: userActivitySessionStatusSchema.optional(),
  currentPath: z.string().trim().max(4_000).nullish(),
  currentPageTitle: z.string().trim().max(500).nullish(),
  userAgent: z.string().max(2_000).nullish(),
  metadata: dynamicRecordSchema.optional(),
}).strict()
export const userActivityPresenceSessionInputSchema = userActivitySessionMutationInputSchema.strip()
export const onlineUserActivityListInputSchema = z.object({
  organizationId: uuidSchema,
  activeWithinMinutes: z.number().int().min(1).max(24 * 60).optional(),
  limit: z.number().int().min(1).max(500).optional(),
}).strict()
export const auditFeedEventPayloadSchema = z.object({
  auditId: uuidSchema,
  organizationId: uuidSchema,
  actorUserId: uuidSchema.nullish(),
  action: z.string().trim().min(1).max(120),
  entityType: z.string().trim().min(1).max(120),
  entityId: z.string().trim().max(160).nullish(),
  createdAt: timestampSchema,
}).passthrough()

const conversationLeadDetailSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  phone: nullableString,
  email: nullableString,
  created_at: timestampSchema,
  deal_status: z.string(),
  tags: z.array(z.object({ tag: z.object({ id: uuidSchema, name: z.string(), color: z.string() }).passthrough() }).passthrough()),
}).passthrough()
export const apiConversationLeadDetailResponseSchema = apiEnvelopeSchema(conversationLeadDetailSchema)

export const leadAttachmentCreateInputSchema = z.object({
  lead_id: uuidSchema,
  file_name: z.string().trim().min(1).max(500),
  file_url: z.string().trim().url().max(4_000),
  file_type: z.string().trim().max(255).optional(),
  file_size: z.number().int().min(0).max(1024 * 1024 * 1024).optional(),
  message_id: uuidSchema.optional(),
}).strict()
const leadAttachmentSchema = z.object({
  id: uuidSchema,
  lead_id: uuidSchema,
  file_name: z.string(),
  file_url: z.string(),
  file_type: nullableString,
  file_size: z.number().int().min(0).nullable(),
  created_at: timestampSchema,
  created_by: uuidSchema.nullable(),
  message_id: uuidSchema.nullable(),
}).passthrough()
export const apiLeadAttachmentResponseSchema = apiEnvelopeSchema(leadAttachmentSchema)
export const apiLeadAttachmentListResponseSchema = apiEnvelopeSchema(z.array(leadAttachmentSchema))

const leadEnrichmentSchema = z.object({
  lead_id: uuidSchema,
  tags: z.array(z.object({ id: uuidSchema, name: nullableString, color: nullableString }).passthrough()),
  tasks_count: z.object({ pending: nonNegativeIntegerSchema, completed: nonNegativeIntegerSchema }).passthrough(),
  assignee: z.object({ id: uuidSchema, name: nullableString, avatar_url: nullableString }).passthrough().nullable(),
  interest_property: z.object({ id: uuidSchema, code: nullableString, title: nullableString, preco: finiteNullableNumber }).passthrough().nullable(),
  lead_meta: z.array(z.object({ lead_id: uuidSchema }).passthrough()),
}).passthrough()
export const apiLeadEnrichmentListResponseSchema = apiEnvelopeSchema(z.array(leadEnrichmentSchema))

const jsonValueSchema: z.ZodType<unknown> = z.lazy(() => z.union([
  z.string(), z.number(), z.boolean(), z.null(), z.array(jsonValueSchema), z.record(jsonValueSchema),
]))
const leadMetaSchema = z.object({
  id: uuidSchema,
  lead_id: uuidSchema,
  raw_payload: jsonValueSchema,
  created_at: timestampSchema,
}).passthrough()
export const apiLeadMetaResponseSchema = apiEnvelopeSchema(leadMetaSchema.nullable())

export const leadTaskTypeSchema = z.enum(['call', 'message', 'email', 'note'])
export const leadTaskCreateInputSchema = z.object({
  lead_id: uuidSchema,
  day_offset: z.number().int().min(0).max(3_650),
  type: leadTaskTypeSchema,
  title: z.string().trim().min(1).max(500),
  description: z.string().max(10_000).optional(),
  due_date: timestampSchema.optional(),
}).strict()
export const leadTaskPatchInputSchema = z.object({
  is_done: z.boolean().optional(),
  outcome: z.string().trim().max(500).optional(),
  outcome_notes: z.string().max(10_000).optional(),
  leadId: uuidSchema.optional(),
}).strict().refine((value) => Object.keys(value).length > 0, 'Informe ao menos uma alteracao')
export const cadenceTaskCompletionInputSchema = z.object({
  leadId: uuidSchema,
  templateTaskId: uuidSchema,
  dayOffset: z.number().int().min(0).max(3_650),
  type: leadTaskTypeSchema,
  title: z.string().trim().min(1).max(500),
  description: z.string().max(10_000).optional(),
  outcome: z.string().trim().max(500).optional(),
  outcomeNotes: z.string().max(10_000).optional(),
}).strict()
const leadTaskSchema = z.object({ id: uuidSchema, lead_id: uuidSchema }).passthrough()
export const apiLeadTaskResponseSchema = apiEnvelopeSchema(leadTaskSchema)
export const apiLeadTaskListResponseSchema = apiEnvelopeSchema(z.array(leadTaskSchema))
export const apiLeadVisibilityResponseSchema = apiEnvelopeSchema(z.object({
  canViewAll: z.boolean(),
  teamMemberIds: z.array(uuidSchema).optional(),
  userId: uuidSchema.optional(),
}).passthrough())

const tenantContextSchema = z.object({
  userId: uuidSchema,
  userRole: z.string(),
  organizationId: uuidSchema.optional(),
  permissions: z.array(z.string()),
  enabledModules: z.array(z.string()),
  isSuperAdmin: z.boolean(),
}).passthrough()
const meResponseSchema = z.object({
  user: z.object({ id: uuidSchema, email: z.string().email().optional() }).passthrough(),
  context: tenantContextSchema,
}).passthrough()
export const apiMeResponseSchema = meResponseSchema
export const apiMeProfileResponseSchema = meResponseSchema.extend({
  profile: z.object({ id: uuidSchema, name: z.string(), email: z.string().email(), is_active: z.boolean() }).passthrough(),
  organization: z.object({ id: uuidSchema, name: z.string() }).passthrough().nullable(),
})

export const messageTemplateCreateInputSchema = z.object({
  name: z.string().trim().min(1).max(180),
  content: z.string().trim().min(1).max(20_000),
  category: z.string().trim().max(120).optional(),
  variables: z.array(z.string().trim().min(1).max(120)).max(100).optional(),
}).strict()
export const messageTemplateUpdateInputSchema = messageTemplateCreateInputSchema.partial()
  .omit({ variables: true })
  .refine((value) => Object.keys(value).length > 0, 'Informe ao menos uma alteracao')
const messageTemplateSchema = z.object({
  id: uuidSchema,
  organization_id: uuidSchema,
  name: z.string(),
  content: z.string(),
  category: z.string(),
  variables: z.array(z.string()),
  created_at: timestampSchema,
  updated_at: timestampSchema,
}).passthrough()
export const apiMessageTemplateResponseSchema = apiEnvelopeSchema(messageTemplateSchema)
export const apiMessageTemplateListResponseSchema = apiEnvelopeSchema(z.array(messageTemplateSchema))

export const paymentCheckoutQuerySchema = z.object({
  token: z.string().trim().min(8).max(2_000).nullish(),
  organization_id: uuidSchema.nullish(),
}).strict().refine((value) => Boolean(value.token || value.organization_id), 'Informe token ou organização')
export const paymentStatusQuerySchema = z.object({
  payment_id: safePathSegmentSchema,
  checkout_token: z.string().trim().min(8).max(2_000),
}).strict()
export const paymentMutationInputSchema = nonEmptyDynamicRecordSchema

export const propertyCatalogCreateInputSchema = z.object({
  name: z.string().trim().min(1).max(180),
  icon: z.string().trim().max(255).nullish(),
}).strict()
export const propertyCatalogSeedInputSchema = z.object({
  names: z.array(z.string().trim().min(1).max(180)).min(1).max(500),
}).strict()
const propertyCatalogItemSchema = z.object({ id: uuidSchema, organization_id: uuidSchema, name: z.string() }).passthrough()
export const apiPropertyCatalogResponseSchema = apiEnvelopeSchema(propertyCatalogItemSchema)
export const apiPropertyCatalogListResponseSchema = apiEnvelopeSchema(z.array(propertyCatalogItemSchema))
export const apiPropertyImageResponseSchema = apiEnvelopeSchema(z.object({
  url: z.string().url(), path: z.string().min(1), bucket: z.string().min(1), contentType: z.string().min(1), size: nonNegativeIntegerSchema,
}).passthrough())

export const propertyCityInputSchema = z.object({
  name: z.string().trim().min(1).max(180),
  uf: z.string().trim().length(2).toUpperCase().optional(),
}).strict()
export const propertyNeighborhoodInputSchema = z.object({ name: z.string().trim().min(1).max(180), city_id: uuidSchema }).strict()
export const propertyCondominiumInputSchema = z.object({
  name: z.string().trim().min(1).max(180),
  city_id: uuidSchema.optional(),
  neighborhood_id: uuidSchema.optional(),
  address: z.string().trim().max(500).optional(),
  photo_url: z.string().url().optional(),
  cep: z.string().trim().max(20).optional(),
  number: z.string().trim().max(40).optional(),
  complement: z.string().trim().max(180).optional(),
  default_condominium_fee: z.number().finite().min(0).optional(),
  has_concierge: z.boolean().optional(),
  concierge_type: z.string().trim().max(120).optional(),
  notes: z.string().max(10_000).optional(),
  latitude: z.number().finite().min(-90).max(90).optional(),
  longitude: z.number().finite().min(-180).max(180).optional(),
}).strict()
const propertyCitySchema = z.object({ id: uuidSchema, organization_id: uuidSchema, name: z.string(), uf: nullableString, is_active: z.boolean(), created_at: timestampSchema }).passthrough()
const propertyNeighborhoodSchema = z.object({ id: uuidSchema, organization_id: uuidSchema, city_id: uuidSchema.nullable(), name: z.string(), is_active: z.boolean(), created_at: timestampSchema }).passthrough()
const propertyCondominiumSchema = z.object({ id: uuidSchema, organization_id: uuidSchema, name: z.string(), is_active: z.boolean(), created_at: timestampSchema }).passthrough()
export const apiPropertyCityResponseSchema = apiEnvelopeSchema(propertyCitySchema)
export const apiPropertyCityListResponseSchema = apiEnvelopeSchema(z.array(propertyCitySchema))
export const apiPropertyNeighborhoodResponseSchema = apiEnvelopeSchema(propertyNeighborhoodSchema)
export const apiPropertyNeighborhoodListResponseSchema = apiEnvelopeSchema(z.array(propertyNeighborhoodSchema))
export const apiPropertyCondominiumResponseSchema = apiEnvelopeSchema(propertyCondominiumSchema)
export const apiPropertyCondominiumListResponseSchema = apiEnvelopeSchema(z.array(propertyCondominiumSchema))

export const propertyOwnerInputSchema = z.object({
  name: z.string().trim().min(1).max(180),
  phone_residential: z.string().trim().max(40).optional(),
  phone_commercial: z.string().trim().max(40).optional(),
  cellphone: z.string().trim().max(40).optional(),
  email: z.string().trim().email().optional(),
  media_source: z.string().trim().max(180).optional(),
  notify_email: z.boolean().optional(),
  notes: z.string().max(10_000).optional(),
}).strict()
const propertyOwnerSchema = z.object({ id: uuidSchema, organization_id: uuidSchema, name: z.string(), is_active: z.boolean(), created_at: timestampSchema, updated_at: timestampSchema }).passthrough()
export const apiPropertyOwnerResponseSchema = apiEnvelopeSchema(propertyOwnerSchema)
export const apiPropertyOwnerListResponseSchema = apiEnvelopeSchema(z.array(propertyOwnerSchema))
const propertyCaptorSchema = z.object({ id: uuidSchema, name: nullableString, email: nullableString, whatsapp: nullableString, avatar_url: nullableString }).passthrough()
const propertySiteInfoSchema = z.object({ subdomain: nullableString, custom_domain: nullableString, domain_verified: z.boolean().nullable() }).passthrough()
const propertySummarySchema = z.object({ id: uuidSchema, code: nullableString, title: nullableString, preco: finiteNullableNumber }).passthrough()
export const apiPropertyCaptorResponseSchema = apiEnvelopeSchema(propertyCaptorSchema.nullable())
export const apiPropertySiteInfoResponseSchema = apiEnvelopeSchema(propertySiteInfoSchema.nullable())
export const apiPropertySummaryListResponseSchema = apiEnvelopeSchema(z.array(propertySummarySchema))

export const publicDomainSchema = z.string().trim().min(1).max(253).transform((value) => value.toLowerCase())
export const publicSiteQuerySchema = z.record(z.union([z.string(), z.number().finite(), z.boolean(), z.null(), z.undefined()]))
export const publicContactInputSchema = nonEmptyDynamicRecordSchema
export const publicTrackingInputSchema = nonEmptyDynamicRecordSchema
export const apiPublicSiteResolveResponseSchema = z.object({ found: z.boolean(), site_config: dynamicRecordSchema.optional() }).passthrough()
export const apiPublicDataResponseSchema = z.unknown()
export const publicSiteConfigSchema = z.object({
  id: uuidSchema,
  organization_id: uuidSchema,
  is_active: z.boolean(),
  subdomain: nullableString,
  custom_domain: nullableString,
  site_title: nullableString,
  site_description: nullableString,
  primary_color: nullableString,
  secondary_color: nullableString,
  accent_color: nullableString,
}).passthrough()
export const publicPropertySchema = z.object({
  id: uuidSchema,
  codigo: z.string(),
  titulo: nullableString,
  valor_venda: finiteNullableNumber,
  valor_aluguel: finiteNullableNumber,
  destaque: z.boolean().nullable(),
}).passthrough()
export const publicHomeDataSchema = z.object({
  featured: z.array(publicPropertySchema),
  exclusive: z.array(publicPropertySchema),
  latest: z.array(publicPropertySchema),
  types: z.array(z.string()),
  cities: z.array(z.string()),
}).passthrough()
export const publicPropertiesDataSchema = z.object({
  properties: z.array(publicPropertySchema),
  total: nonNegativeIntegerSchema,
  page: z.number().int().min(1),
  limit: z.number().int().min(1),
  totalPages: nonNegativeIntegerSchema,
  types: z.array(z.string()),
  cities: z.array(z.string()),
  neighborhoods: z.array(z.string()),
  condominiums: z.array(z.string()),
  purposes: z.array(z.string()),
}).passthrough()
export const publicPropertyDataSchema = z.object({ property: publicPropertySchema.nullable() }).passthrough()
export const publicSiteResolveServerSchema = z.object({ found: z.boolean().optional(), site_config: publicSiteConfigSchema.optional() }).passthrough()
export const publicMenuItemListEnvelopeSchema = apiEnvelopeSchema(z.array(z.object({
  id: uuidSchema, organization_id: uuidSchema, label: z.string(), link_type: z.string(), href: z.string(),
  position: nonNegativeIntegerSchema, open_in_new_tab: z.boolean(), is_active: z.boolean(),
}).passthrough())).partial({ data: true })
export const publicSearchFilterListEnvelopeSchema = apiEnvelopeSchema(z.array(z.object({
  filter_key: z.string(), label: z.string(), position: nonNegativeIntegerSchema,
}).passthrough())).partial({ data: true })

export const realtimeEventSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  organizationId: uuidSchema,
  userId: uuidSchema.optional(),
  data: dynamicRecordSchema.optional(),
  createdAt: timestampSchema,
}).passthrough()

const siteAssetTypeSchema = z.enum(['logo', 'favicon', 'about', 'hero', 'banner', 'watermark'])
const browserFileSchema = z.custom<File>(
  (value) => typeof File !== 'undefined' && value instanceof File,
  'Arquivo invalido',
)
export const siteAssetInputSchema = z.object({ file: browserFileSchema, type: siteAssetTypeSchema }).strict()
const organizationSiteSchema = z.object({
  id: uuidSchema, organization_id: uuidSchema, is_active: z.boolean(), subdomain: nullableString,
  custom_domain: nullableString, domain_verified: z.boolean(), site_theme: z.string(),
  background_color: z.string(), text_color: z.string(), card_color: z.string(), created_at: timestampSchema, updated_at: timestampSchema,
}).passthrough()
export const organizationSiteMutationSchema = organizationSiteSchema.omit({ id: true, organization_id: true, created_at: true, updated_at: true }).partial()
  .refine((value) => Object.keys(value).length > 0, 'Informe ao menos uma alteracao')
const siteMenuItemSchema = z.object({ id: uuidSchema, organization_id: uuidSchema, label: z.string(), link_type: z.enum(['page', 'filter', 'external']), href: z.string(), position: nonNegativeIntegerSchema, open_in_new_tab: z.boolean(), is_active: z.boolean() }).passthrough()
export const siteMenuItemInputSchema = siteMenuItemSchema.omit({ id: true, organization_id: true }).partial({ open_in_new_tab: true, is_active: true }).strict()
export const siteMenuItemUpdateSchema = siteMenuItemSchema.partial().extend({ id: uuidSchema }).strict()
const siteSearchFilterSchema = z.object({ id: uuidSchema, organization_id: uuidSchema, filter_key: z.string(), label: z.string(), position: nonNegativeIntegerSchema, is_active: z.boolean() }).passthrough()
export const siteSearchFilterInputSchema = siteSearchFilterSchema.pick({ filter_key: true, label: true, position: true, is_active: true }).strict()
export const siteSearchFilterUpdateSchema = siteSearchFilterSchema.partial().extend({ id: uuidSchema }).strict()
export const siteReorderInputSchema = z.object({ items: z.array(z.object({ id: uuidSchema, position: nonNegativeIntegerSchema }).strict()).min(1).max(500) }).strict()
export const apiOrganizationSiteResponseSchema = apiEnvelopeSchema(organizationSiteSchema)
export const apiOptionalOrganizationSiteResponseSchema = apiEnvelopeSchema(organizationSiteSchema.nullable())
export const apiSiteMenuItemResponseSchema = apiEnvelopeSchema(siteMenuItemSchema)
export const apiSiteMenuItemListResponseSchema = apiEnvelopeSchema(z.array(siteMenuItemSchema))
export const apiSiteSearchFilterResponseSchema = apiEnvelopeSchema(siteSearchFilterSchema)
export const apiSiteSearchFilterListResponseSchema = apiEnvelopeSchema(z.array(siteSearchFilterSchema))
export const apiSiteAssetResponseSchema = apiEnvelopeSchema(z.object({ url: z.string().url() }).passthrough())

export const stageAutomationInputSchema = z.object({
  stage_id: uuidSchema.optional(), automation_type: z.string().trim().max(120).optional(), trigger_days: z.number().int().min(0).max(3_650).nullish(),
  target_stage_id: optionalUUID, whatsapp_template: optionalNullableString, alert_message: optionalNullableString,
  target_user_id: optionalUUID, deal_status: z.enum(['open', 'won', 'lost']).nullish(), action_config: dynamicRecordSchema.nullish(), is_active: z.boolean().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, 'Informe ao menos um campo')
export const stageOperationalConfigInputSchema = z.object({
  id: uuidSchema.optional(), stage_id: uuidSchema, operation_context: z.string().max(180).optional(), responsible_sector: optionalNullableString,
  sla_hours: z.number().int().min(0).max(100_000).optional(), automatic_tasks: jsonValueSchema.optional(), automatic_notifications: jsonValueSchema.optional(),
  automatic_operational_requests: jsonValueSchema.optional(), checklist_template: jsonValueSchema.optional(), approval_flow: jsonValueSchema.optional(),
  dashboard_destination: optionalNullableString, visibility_rules: jsonValueSchema.optional(),
}).strict()
export const pipelineSLAInputSchema = z.object({
  pipeline_id: uuidSchema, stage_id: optionalUUID, warning_hours: z.number().int().min(0).max(100_000).optional(),
  critical_hours: z.number().int().min(0).max(100_000).optional(), sla_start_field: z.string().trim().max(120).optional(),
}).strict()
const stageAutomationSchema = z.object({ id: uuidSchema, organization_id: uuidSchema, trigger_type: z.string(), is_active: z.boolean().nullable() }).passthrough()
const stageOperationalConfigSchema = z.object({ organization_id: uuidSchema, stage_id: uuidSchema, operation_context: z.string(), sla_hours: nonNegativeIntegerSchema }).passthrough()
const pipelineSLASchema = z.object({ id: uuidSchema, organization_id: uuidSchema, pipeline_id: uuidSchema }).passthrough()
export const apiStageAutomationResponseSchema = apiEnvelopeSchema(stageAutomationSchema)
export const apiStageAutomationListResponseSchema = apiEnvelopeSchema(z.array(stageAutomationSchema))
export const apiStageOperationalResponseSchema = apiEnvelopeSchema(stageOperationalConfigSchema)
export const apiStageOperationalListResponseSchema = apiEnvelopeSchema(z.array(stageOperationalConfigSchema))
export const apiPipelineSLAResponseSchema = apiEnvelopeSchema(pipelineSLASchema)
export const apiPipelineSLAListResponseSchema = apiEnvelopeSchema(z.array(pipelineSLASchema))

export const errorSeveritySchema = z.enum(['debug', 'info', 'warning', 'error', 'critical'])
export const errorSourceSchema = z.enum(['frontend', 'backend', 'api'])
export const reportErrorEventInputSchema = z.object({
  organizationId: uuidSchema.nullish(), requestId: z.string().max(255).optional(), source: errorSourceSchema.optional(), severity: errorSeveritySchema.optional(),
  category: z.string().max(180).optional(), message: z.string().trim().min(1).max(20_000), errorCode: z.string().max(180).optional(),
  httpStatus: z.number().int().min(100).max(599).optional(), method: z.string().max(20).optional(), path: z.string().max(4_000).optional(),
  route: z.string().max(4_000).optional(), component: z.string().max(500).optional(), stack: z.string().max(100_000).optional(),
  stackHash: z.string().max(255).optional(), fingerprint: z.string().max(500).optional(), url: z.string().max(4_000).optional(),
  userAgent: z.string().max(2_000).optional(), browserContext: dynamicRecordSchema.optional(), metadata: dynamicRecordSchema.optional(),
}).strict()
export const errorEventFiltersSchema = z.object({
  limit: z.number().int().min(1).max(500).optional(), offset: z.number().int().min(0).max(1_000_000).optional(), search: z.string().trim().max(180).optional(),
  severity: z.union([errorSeveritySchema, z.literal('all')]).optional(), source: z.union([errorSourceSchema, z.literal('all')]).optional(),
  organizationId: uuidSchema.optional(), fingerprint: z.string().max(500).optional(), unresolved: z.boolean().optional(),
}).strict()
const errorEventSchema = z.object({ id: uuidSchema, source: errorSourceSchema, severity: errorSeveritySchema, message: z.string(), fingerprint: z.string(), browserContext: dynamicRecordSchema, metadata: dynamicRecordSchema, createdAt: timestampSchema }).passthrough()
export const apiErrorEventResponseSchema = apiEnvelopeSchema(errorEventSchema)
export const apiErrorEventListResponseSchema = z.object({ data: z.array(errorEventSchema), total: nonNegativeIntegerSchema, limit: nonNegativeIntegerSchema, offset: nonNegativeIntegerSchema }).passthrough()

const userSummarySchema = z.object({ id: uuidSchema, name: nullableString, avatar_url: nullableString }).passthrough()
export const apiUserSummaryListResponseSchema = apiEnvelopeSchema(z.array(userSummarySchema))

const webhookMutationSchema = z.object({
  name: z.string().trim().min(1).max(180), type: z.enum(['incoming', 'outgoing']), target_pipeline_id: optionalUUID,
  target_team_id: optionalUUID, target_stage_id: optionalUUID, target_tag_ids: z.array(uuidSchema).max(500).optional(),
  target_property_id: optionalUUID, field_mapping: z.record(z.string()).optional(), webhook_url: z.string().url().nullish(),
  trigger_events: z.array(z.string().trim().min(1).max(120)).max(100).optional(),
}).strict()
export const webhookCreateInputSchema = webhookMutationSchema.superRefine((input, ctx) => {
  if (input.type === 'outgoing' && !input.webhook_url) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['webhook_url'], message: 'URL obrigatoria para webhook de saida' })
})
export const webhookUpdateInputSchema = webhookMutationSchema.partial().extend({ id: uuidSchema, is_active: z.boolean().optional() })
  .refine((value) => Object.keys(value).length > 1, 'Informe ao menos uma alteracao')
const webhookSchema = z.object({ id: uuidSchema, organization_id: uuidSchema, name: z.string(), type: z.enum(['incoming', 'outgoing']), api_token: z.string(), is_active: z.boolean(), leads_received: nonNegativeIntegerSchema, created_at: timestampSchema, updated_at: timestampSchema }).passthrough()
export const apiWebhookResponseSchema = apiEnvelopeSchema(webhookSchema)
export const apiWebhookListResponseSchema = apiEnvelopeSchema(z.array(webhookSchema))

export const metaCampaignListSchema = z.array(z.object({
  id: z.string().min(1), name: z.string(), kind: z.enum(['lead_form', 'whatsapp', 'site']), status: z.enum(['ACTIVE', 'PAUSED', 'ARCHIVED', 'LEARNING']),
  adSets: z.array(z.object({ id: z.string().min(1), creatives: z.array(z.object({ id: z.string().min(1) }).passthrough()) }).passthrough()),
}).passthrough())

export const searchFilterColumnsSchema = z.array(
  z.string().trim().min(1).max(120).regex(/^[a-zA-Z_][a-zA-Z0-9_.]*$/),
).min(1).max(100)
export const searchFilterMaxLengthSchema = z.number().int().min(1).max(10_000)
