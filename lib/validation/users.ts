import { z } from 'zod'
import { apiEnvelopeSchema, nonNegativeIntegerSchema, timestampSchema, uuidSchema } from './common'

export const userRoleSchema = z.enum(['super_admin', 'admin', 'manager', 'user'])

export const createUserInputSchema = z.object({
  name: z.string().trim().min(2).max(180),
  email: z.string().trim().email().max(254),
  phone: z.string().trim().max(40).nullish(),
  whatsapp: z.string().trim().max(40).nullish(),
  endereco: z.string().trim().max(200).nullish(),
  role: z.enum(['admin', 'manager', 'user']),
}).strict()

export const updateUserInputSchema = z.object({
  id: uuidSchema,
  name: z.string().trim().min(2).max(180).optional(),
  role: z.enum(['admin', 'manager', 'user']).optional(),
  is_active: z.boolean().optional(),
  avatar_url: z.string().trim().url().nullable().optional(),
  whatsapp: z.string().trim().max(40).nullable().optional(),
}).strict().refine(
  (input) => Object.entries(input).some(([key, value]) => key !== 'id' && value !== undefined),
  'Informe ao menos uma alteracao',
)

export const deleteUserInputSchema = z.object({
  userId: uuidSchema,
  transferLeadsToUserId: uuidSchema.nullish(),
  transferPropertiesToUserId: uuidSchema.nullish(),
}).strict()

export const apiUserSchema = z.object({
  id: uuidSchema,
  organization_id: uuidSchema.nullable(),
  name: z.string().min(1),
  email: z.string().email(),
  role: z.string().min(1),
  avatar_url: z.string().nullable(),
  is_active: z.boolean(),
  whatsapp: z.string().nullable(),
  created_at: timestampSchema,
  updated_at: timestampSchema,
}).passthrough()

export const apiUserOrganizationSchema = z.object({
  organization_id: uuidSchema,
  organization_name: z.string().min(1),
  organization_logo: z.string().nullable(),
  member_role: z.string().min(1),
  is_active: z.boolean(),
  joined_at: timestampSchema,
  last_accessed_at: timestampSchema.nullable(),
}).passthrough()

export const apiUserListResponseSchema = apiEnvelopeSchema(z.array(apiUserSchema))
export const apiUserOrganizationListResponseSchema = apiEnvelopeSchema(z.array(apiUserOrganizationSchema))

export const apiCreateUserResponseSchema = z.object({
  success: z.boolean(),
  user: apiUserSchema,
  generatedPassword: z.string().optional(),
  whatsappSent: z.boolean(),
  wasMultiOrg: z.boolean(),
  wasOrphan: z.boolean(),
  message: z.string().optional(),
}).passthrough()

export const apiUpdateUserResponseSchema = z.object({
  success: z.boolean(),
  user: apiUserSchema,
}).passthrough()

export const apiDeleteUserImpactSchema = z.object({
  leads: nonNegativeIntegerSchema,
  properties: nonNegativeIntegerSchema,
  whatsapp_sessions: nonNegativeIntegerSchema,
}).passthrough()

export const apiDeleteUserImpactResponseSchema = apiEnvelopeSchema(apiDeleteUserImpactSchema)
export const apiDeleteUserResponseSchema = z.object({
  success: z.boolean(),
  impact: apiDeleteUserImpactSchema,
}).passthrough()
