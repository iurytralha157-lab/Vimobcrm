import { z } from 'zod'
import { apiEnvelopeSchema, nonNegativeIntegerSchema, timestampSchema, uuidSchema } from './common'

const nullableText = (max: number) => z.string().trim().max(max).nullable().optional()
const optionalEmail = z.union([z.string().trim().email(), z.literal(''), z.null()]).optional()

export const updateProfileInputSchema = z.object({
  name: nullableText(180),
  whatsapp: nullableText(40),
  cpf: nullableText(20),
  theme_mode: z.enum(['light', 'dark', 'system']).nullable().optional(),
  language: nullableText(20),
}).strict().refine((input) => Object.keys(input).length > 0, 'Informe ao menos uma alteracao')

export const updateOrganizationInputSchema = z.object({
  name: nullableText(180),
  cnpj: nullableText(30),
  creci: nullableText(60),
  inscricao_estadual: nullableText(60),
  razao_social: nullableText(200),
  nome_fantasia: nullableText(200),
  cep: nullableText(20),
  endereco: nullableText(200),
  numero: nullableText(40),
  complemento: nullableText(120),
  bairro: nullableText(120),
  cidade: nullableText(120),
  uf: nullableText(2),
  telefone: nullableText(40),
  whatsapp: nullableText(40),
  email: optionalEmail,
  website: nullableText(500),
  default_commission_percentage: z.number().finite().min(0).max(100).nullable().optional(),
  property_edit_policy: z.enum(['everyone', 'responsible_or_admin']).nullable().optional(),
  property_owner_contact_visibility: z.enum(['visible', 'hidden']).nullable().optional(),
}).strict().refine((input) => Object.keys(input).length > 0, 'Informe ao menos uma alteracao')

export const changePasswordInputSchema = z.object({
  password: z.string().min(8).max(256),
  source: z.string().trim().max(80).optional(),
}).strict()
export const setupGuideProgressInputSchema = z.object({
  completed_steps: z.record(z.boolean()).optional(),
  skipped: z.boolean().optional(),
}).strict().refine((input) => Object.keys(input).length > 0, 'Informe ao menos uma alteracao')
export const pushTokenInputSchema = z.object({
  endpoint: z.string().trim().min(1).max(4_000),
  p256dh: z.string().trim().max(1_000).nullish(),
  auth: z.string().trim().max(1_000).nullish(),
  userAgent: z.string().trim().max(1_000).nullish(),
  syncOnly: z.boolean().optional(),
}).strict()
export const createApiKeyInputSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
}).strict()
export const subscriptionBillingInputSchema = z.object({
  razao_social: nullableText(200),
  cnpj: nullableText(30),
  cep: nullableText(20),
  endereco: nullableText(200),
  numero: nullableText(40),
  complemento: nullableText(120),
  bairro: nullableText(120),
  cidade: nullableText(120),
  uf: nullableText(2),
  email: optionalEmail,
  telefone: nullableText(40),
}).strict().refine((input) => Object.keys(input).length > 0, 'Informe ao menos uma alteracao')
export const selectSubscriptionPlanInputSchema = z.object({ plan_id: uuidSchema }).strict()
export const replaceRolePermissionsInputSchema = z.object({
  permissions: z.array(z.string().trim().min(1).max(180)).max(500),
}).strict()
export const replaceUserPermissionsInputSchema = z.object({
  permissions: z.record(z.boolean()),
}).strict()
export const assignUserRoleInputSchema = z.object({
  userId: uuidSchema,
  roleId: uuidSchema.nullable(),
}).strict()
export const settingsRoleInputSchema = z.record(z.unknown()).refine(
  (input) => Object.keys(input).length > 0,
  'Informe ao menos uma alteracao',
)
export const deactivatePushTokenInputSchema = z.object({
  endpoint: z.string().trim().min(1).max(4_000).nullish(),
}).strict()
export const permissionKeySchema = z.string().trim().min(1).max(180)

export const apiAssetUploadSchema = z.object({
  url: z.string().min(1),
  path: z.string().min(1),
  bucket: z.string().min(1),
  contentType: z.string().min(1),
  size: nonNegativeIntegerSchema,
}).passthrough()
export const apiOrganizationApiKeySchema = z.object({
  id: uuidSchema,
  organization_id: uuidSchema,
  name: z.string(),
  key_prefix: z.string(),
  is_active: z.boolean(),
  last_used_at: timestampSchema.nullable(),
  created_by: uuidSchema.nullable(),
  created_at: timestampSchema,
  updated_at: timestampSchema,
}).passthrough()
export const apiOrganizationModuleSchema = z.object({
  id: uuidSchema,
  organization_id: uuidSchema,
  module_name: z.string(),
  is_enabled: z.boolean(),
  created_at: timestampSchema,
  updated_at: timestampSchema,
}).passthrough()
export const apiSetupGuideProgressSchema = z.object({
  completed_steps: z.record(z.boolean()),
  skipped: z.boolean(),
}).passthrough()
export const apiSubscriptionOverviewSchema = z.object({
  org: z.record(z.unknown()).nullable(),
  plan: z.record(z.unknown()).nullable(),
  availablePlans: z.array(z.record(z.unknown())),
  history: z.array(z.record(z.unknown())),
}).passthrough()
export const apiUserPermissionItemSchema = z.object({
  key: permissionKeySchema,
  label: z.string(),
  description: z.string(),
  domain: z.string(),
  allowed: z.boolean(),
  defaultAllowed: z.boolean(),
  override: z.boolean().nullable(),
}).strict()
export const apiUserPermissionProfileSchema = z.object({
  userId: uuidSchema,
  profile: z.string(),
  locked: z.boolean(),
  permissions: z.array(apiUserPermissionItemSchema),
}).strict()
export const apiUserPermissionProfileResponseSchema = apiEnvelopeSchema(apiUserPermissionProfileSchema)

export const apiAssetUploadResponseSchema = apiEnvelopeSchema(apiAssetUploadSchema)
export const apiOrganizationApiKeyListResponseSchema = apiEnvelopeSchema(z.array(apiOrganizationApiKeySchema))
export const apiOrganizationModuleListResponseSchema = apiEnvelopeSchema(z.array(apiOrganizationModuleSchema))
export const apiSetupGuideProgressResponseSchema = apiEnvelopeSchema(apiSetupGuideProgressSchema)
export const apiCreateApiKeyResponseSchema = apiEnvelopeSchema(z.object({
  apiKey: z.string().min(1),
  key: apiOrganizationApiKeySchema,
}).passthrough())
export const apiSubscriptionOverviewResponseSchema = apiEnvelopeSchema(apiSubscriptionOverviewSchema)
export const apiBooleanResponseSchema = apiEnvelopeSchema(z.boolean())
export const apiChangePasswordResponseSchema = z.object({
  allowed: z.boolean(),
  message: z.string(),
  emailNotificationSent: z.boolean().optional(),
}).passthrough()
