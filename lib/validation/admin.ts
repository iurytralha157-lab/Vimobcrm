import { z } from 'zod'

import { timestampSchema, uuidSchema } from './common'

const optionalText = (max: number) => z.string().trim().max(max).optional()
const nullableText = (max: number) => z.string().trim().max(max).nullable().optional()
const nullableDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Data invalida')
  .nullable()
  .optional()

export const adminCreateOrganizationInputSchema = z
  .object({
    name: z.string().trim().min(2).max(300),
    segment: z.enum(['imobiliario', 'telecom', 'servicos']).optional(),
    adminEmail: z.string().trim().email().max(320),
    adminName: z.string().trim().min(2).max(300),
    whatsapp: optionalText(40),
    phone: optionalText(40),
    cnpj: optionalText(32),
    creci: optionalText(80),
    planId: uuidSchema.nullable().optional(),
    address: optionalText(500),
    city: optionalText(180),
    neighborhood: optionalText(180),
    number: optionalText(80),
    complement: optionalText(300),
  })
  .strict()

export const adminUpdateOrganizationInputSchema = z
  .object({
    name: z.string().trim().min(2).max(300).optional(),
    is_active: z.boolean().optional(),
    subscription_status: optionalText(80),
    subscription_type: nullableText(80),
    max_users: z.number().int().min(1).max(1_000_000).optional(),
    admin_notes: nullableText(10_000),
    plan_id: uuidSchema.nullable().optional(),
    subscription_value: z.number().finite().nonnegative().nullable().optional(),
    billing_day: z.number().int().min(1).max(31).nullable().optional(),
    next_billing_date: nullableDateSchema,
    trial_ends_at: nullableDateSchema,
    creci: nullableText(80),
    max_whatsapp_sessions_override: z.number().int().nonnegative().nullable().optional(),
    clear_plan_id: z.boolean().optional(),
    clear_next_billing_date: z.boolean().optional(),
    clear_trial_ends_at: z.boolean().optional(),
  })
  .strict()
  .refine((input) => Object.keys(input).length > 0, 'Informe ao menos um campo')

export const adminUpdateUserInputSchema = z
  .object({
    is_active: z.boolean().optional(),
    organization_id: uuidSchema.optional(),
  })
  .strict()
  .refine((input) => Object.keys(input).length > 0, 'Informe ao menos um campo')

export const adminOrganizationSummarySchema = z
  .object({
    id: uuidSchema,
    name: z.string(),
    email: z.string().nullable().optional(),
    cnpj: z.string().nullable().optional(),
    logo_url: z.string().nullable(),
    is_active: z.boolean(),
    subscription_status: z.string(),
    subscription_type: z.string().nullable().optional(),
    segment: z.string().nullable().optional(),
    max_users: z.number().int().nonnegative(),
    admin_notes: z.string().nullable(),
    created_at: timestampSchema,
    last_access_at: timestampSchema.nullable(),
    user_count: z.number().int().nonnegative(),
    lead_count: z.number().int().nonnegative(),
    automation_count: z.number().int().nonnegative(),
    mrr: z.number().finite(),
    health_score: z.number().finite(),
    days_trial_left: z.number().int(),
    overdue_amount: z.number().finite(),
    plan_id: uuidSchema.nullable(),
    plan_name: z.string().nullable(),
    subscription_value: z.number().finite().nullable(),
    billing_day: z.number().int().nullable(),
    next_billing_date: z.string().nullable(),
    asaas_customer_id: z.string().nullable(),
    asaas_subscription_id: z.string().nullable(),
    creci: z.string().nullable(),
    max_whatsapp_sessions_override: z.number().int().nonnegative().nullable(),
  })
  .passthrough()

export const adminUserSummarySchema = z
  .object({
    id: uuidSchema,
    name: z.string(),
    email: z.string().email(),
    avatar_url: z.string().nullable(),
    role: z.string(),
    organization_id: uuidSchema.nullable(),
    organization_name: z.string().nullable(),
    is_active: z.boolean(),
    created_at: timestampSchema,
  })
  .passthrough()

export const adminOrganizationInvitationSchema = z
  .object({
    id: uuidSchema,
    email: z.string().email(),
    role: z.literal('admin'),
    expires_at: timestampSchema,
    email_sent: z.boolean(),
    existing_account: z.boolean(),
    accepted: z.boolean(),
    used_at: timestampSchema.optional(),
    email_status: z.string().optional(),
    email_provider_message_id: z.string().optional(),
    recoverable: z.boolean().optional(),
  })
  .passthrough()

export const adminCreatedOrganizationSchema = z
  .object({
    id: uuidSchema,
    name: z.string(),
    is_active: z.boolean(),
    admin_invitation: adminOrganizationInvitationSchema,
    creation_recovered: z.boolean(),
  })
  .passthrough()

export const apiAdminOrganizationListResponseSchema = z
  .object({ data: z.array(adminOrganizationSummarySchema) })
  .strict()

export const apiAdminUserListResponseSchema = z
  .object({ data: z.array(adminUserSummarySchema) })
  .strict()

export const apiAdminCreateOrganizationResponseSchema = z
  .object({ organization: adminCreatedOrganizationSchema })
  .strict()

export type AdminCreateOrganizationInput = z.infer<typeof adminCreateOrganizationInputSchema>
export type AdminUpdateOrganizationInput = z.infer<typeof adminUpdateOrganizationInputSchema>
export type AdminUpdateUserInput = z.infer<typeof adminUpdateUserInputSchema>
export type AdminOrganizationSummary = z.infer<typeof adminOrganizationSummarySchema>
export type AdminUserSummary = z.infer<typeof adminUserSummarySchema>
export type AdminCreatedOrganization = z.infer<typeof adminCreatedOrganizationSchema>
