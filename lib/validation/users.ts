import { z } from 'zod'
import { apiEnvelopeSchema, nonNegativeIntegerSchema, timestampSchema, uuidSchema } from './common'

export const userRoleSchema = z.enum(['super_admin', 'admin', 'manager', 'user'])

export const MAX_ORGANIZATION_INVITATIONS_PER_BATCH = 10

export const organizationInvitationRoleSchema = z.enum(['admin', 'manager', 'user'])

export const organizationInvitationInputSchema = z.object({
  email: z.string().trim().min(1, 'Informe o e-mail').email('Informe um e-mail válido').max(254),
  role: organizationInvitationRoleSchema,
}).strict()

export const organizationInvitationRoleInputSchema = z.object({
  role: organizationInvitationRoleSchema,
}).strict()

export const organizationInvitationBatchSchema = z
  .array(organizationInvitationInputSchema)
  .min(1, 'Adicione ao menos um convite')
  .max(
    MAX_ORGANIZATION_INVITATIONS_PER_BATCH,
    `Envie no máximo ${MAX_ORGANIZATION_INVITATIONS_PER_BATCH} convites por vez`,
  )
  .superRefine((invitations, context) => {
    const seenEmails = new Set<string>()

    invitations.forEach((invitation, index) => {
      const normalizedEmail = invitation.email.toLowerCase()
      if (seenEmails.has(normalizedEmail)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, 'email'],
          message: 'Este e-mail está repetido na lista',
        })
        return
      }

      seenEmails.add(normalizedEmail)
    })
  })

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
  home_organization_id: uuidSchema.nullable().optional(),
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

export const apiUpdateUserResponseSchema = z.object({
  success: z.boolean(),
  user: apiUserSchema,
}).passthrough()

export const apiDeleteUserImpactSchema = z.object({
  leads: nonNegativeIntegerSchema,
  properties: nonNegativeIntegerSchema,
  whatsapp_sessions: nonNegativeIntegerSchema,
  teams: nonNegativeIntegerSchema,
  custom_roles: nonNegativeIntegerSchema,
  permission_overrides: nonNegativeIntegerSchema,
  round_robin_entries: nonNegativeIntegerSchema,
}).passthrough()

export const apiDeleteUserImpactResponseSchema = apiEnvelopeSchema(apiDeleteUserImpactSchema)
export const apiDeleteUserResponseSchema = z.object({
  success: z.boolean(),
  impact: apiDeleteUserImpactSchema,
}).passthrough()
