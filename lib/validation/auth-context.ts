import { z } from 'zod'

import { uuidSchema } from './common'

export const userProfileRoleSchema = z.preprocess(
  (value) => (value === null ? 'user' : value),
  z.enum(['admin', 'user', 'super_admin']),
)

export const userProfileSchema = z
  .object({
    id: uuidSchema,
    organization_id: uuidSchema.nullable(),
    name: z.string().min(1, 'Name is required'),
    email: z.string().email('Invalid email'),
    role: userProfileRoleSchema,
    avatar_url: z.string().nullable(),
    is_active: z.boolean(),
    language: z.string().nullable(),
    theme_mode: z.enum(['light', 'dark', 'system']).nullable(),
    whatsapp: z.string().nullable(),
    cpf: z.string().nullable(),
  })
  .passthrough()

export type UserProfile = z.infer<typeof userProfileSchema>

const organizationSegmentAliases: Record<
  string,
  'imobiliario' | 'telecom' | 'servicos'
> = {
  imobiliario: 'imobiliario',
  imobiliaria: 'imobiliario',
  'imobiliária': 'imobiliario',
  'imobiliário': 'imobiliario',
  telecom: 'telecom',
  servico: 'servicos',
  'serviço': 'servicos',
  servicos: 'servicos',
  'serviços': 'servicos',
}

export const organizationSegmentSchema = z.preprocess(
  (value) => {
    if (typeof value !== 'string') return value

    const normalizedValue = value.trim().toLocaleLowerCase('pt-BR')
    return organizationSegmentAliases[normalizedValue] ?? normalizedValue
  },
  z.enum(['imobiliario', 'telecom', 'servicos']).nullable(),
)

const nullableOrganizationTextSchema = z.string().nullable()
const optionalBillingTimestampSchema = z
  .string()
  .datetime({ offset: true })
  .nullable()
  .optional()

export const organizationSchema = z
  .object({
    id: uuidSchema,
    name: z.string().min(1, 'Organization name is required'),
    logo_url: nullableOrganizationTextSchema,
    theme_mode: z.string(),
    accent_color: z.string(),
    is_active: z.boolean(),
    subscription_status: z.string(),
    subscription_type: z.enum(['trial', 'paid', 'free']).nullable().optional(),
    trial_ends_at: optionalBillingTimestampSchema,
    billing_grace_until: optionalBillingTimestampSchema,
    segment: organizationSegmentSchema,
    cnpj: nullableOrganizationTextSchema,
    creci: nullableOrganizationTextSchema,
    inscricao_estadual: nullableOrganizationTextSchema,
    razao_social: nullableOrganizationTextSchema,
    nome_fantasia: nullableOrganizationTextSchema,
    cep: nullableOrganizationTextSchema,
    endereco: nullableOrganizationTextSchema,
    numero: nullableOrganizationTextSchema,
    complemento: nullableOrganizationTextSchema,
    bairro: nullableOrganizationTextSchema,
    cidade: nullableOrganizationTextSchema,
    uf: nullableOrganizationTextSchema,
    telefone: nullableOrganizationTextSchema,
    whatsapp: nullableOrganizationTextSchema,
    email: nullableOrganizationTextSchema,
    website: nullableOrganizationTextSchema,
    default_commission_percentage: z.number().finite().nullable(),
    property_edit_policy: z.enum(['everyone', 'responsible_or_admin']),
    property_owner_contact_visibility: z.enum(['visible', 'hidden']),
    updated_at: z.string().trim().datetime({ offset: true }),
  })
  .passthrough()

export type Organization = z.infer<typeof organizationSchema>

const tenantBillingTimestampSchema = z.string().datetime({ offset: true })

export const tenantContextSchema = z
  .object({
    userId: uuidSchema,
    userRole: z.string(),
    organizationId: uuidSchema.optional(),
    organizationName: z.string().optional(),
    organizationLogo: z.string().optional(),
    subscriptionStatus: z.string().optional(),
    subscriptionType: z.enum(['trial', 'paid', 'free']).optional(),
    trialEndsAt: tenantBillingTimestampSchema.optional(),
    billingGraceUntil: tenantBillingTimestampSchema.optional(),
    memberRole: z.string().optional(),
    permissions: z.array(z.string()),
    enabledModules: z.array(z.string()),
    isTeamLeader: z.boolean(),
    ledTeamIds: z.array(uuidSchema).optional(),
    ledUserIds: z.array(uuidSchema).optional(),
    ledPipelineIds: z.array(uuidSchema).optional(),
    isSuperAdmin: z.boolean(),
  })
  .passthrough()

export type TenantContext = z.infer<typeof tenantContextSchema>

export const meUserSchema = z
  .object({
    id: uuidSchema,
    email: z.string().email().optional(),
    role: z.string().optional(),
    sessionId: z.string().optional(),
    authenticationMethods: z
      .array(
        z
          .object({
            method: z.string(),
            timestamp: z.number().int(),
          })
          .passthrough(),
      )
      .optional(),
  })
  .passthrough()

export const apiMeResponseSchema = z
  .object({
    user: meUserSchema,
    context: tenantContextSchema,
  })
  .passthrough()

export type MeResponse = z.infer<typeof apiMeResponseSchema>

export const apiMeProfileResponseSchema = apiMeResponseSchema.extend({
  profile: userProfileSchema,
  organization: organizationSchema.nullable(),
})

export type MeProfileResponse = z.infer<typeof apiMeProfileResponseSchema>

export const cachedAuthSnapshotSchema = z.object({
  version: z.number().int().positive(),
  cachedAt: z.number().int().nonnegative(),
  profile: userProfileSchema,
  organization: organizationSchema.nullable(),
  tenantContext: tenantContextSchema.nullable(),
  isSuperAdmin: z.boolean(),
})

export type CachedAuthSnapshot = z.infer<typeof cachedAuthSnapshotSchema>
