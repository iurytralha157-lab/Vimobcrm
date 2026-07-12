import { z } from 'zod'
import { apiEnvelopeSchema, uuidSchema } from './common'

const optionalText = z.string().trim().max(4_000).nullish()
const optionalUUID = z.union([uuidSchema, z.literal(''), z.null()]).optional()
const moneySchema = z.union([z.number().finite().min(0), z.string().trim().regex(/^\d+(\.\d+)?$/)])

export const financialCategoryInputSchema = z.object({
  name: z.string().trim().min(1).max(180),
  type: z.enum(['income', 'expense']),
  category_group: optionalText,
}).strict()

const financialEntryShape = {
  type: z.enum(['receivable', 'payable']).optional(),
  category: z.string().trim().min(1).max(180).optional(),
  category_group: optionalText,
  contract_id: optionalUUID,
  lead_id: optionalUUID,
  broker_id: optionalUUID,
  description: z.string().trim().min(1).max(2_000).optional(),
  amount: moneySchema.optional(),
  paid_amount: moneySchema.nullish(),
  paid_value: moneySchema.nullish(),
  due_date: z.string().trim().min(1).max(40).optional(),
  paid_date: z.string().trim().max(40).nullish(),
  payment_method: optionalText,
  status: z.string().trim().max(80).optional(),
  notes: optionalText,
  created_by: optionalUUID,
  installment_number: z.number().int().min(1).nullish(),
  total_installments: z.number().int().min(1).max(360).nullish(),
  is_recurring: z.boolean().optional(),
  recurring_type: z.enum(['monthly', 'weekly', 'yearly']).nullish(),
  parent_entry_id: optionalUUID,
}

export const financialEntryCreateInputSchema = z.object(financialEntryShape).passthrough().superRefine((input, ctx) => {
  for (const key of ['type', 'category', 'description', 'amount', 'due_date'] as const) {
    if (input[key] === undefined || input[key] === '') {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: 'Campo obrigatorio' })
    }
  }
})
export const financialEntryUpdateInputSchema = z.object(financialEntryShape).passthrough().refine(
  (input) => Object.keys(input).length > 0,
  'Informe ao menos uma alteracao',
)

const contractShape = {
  contract_number: optionalText,
  contract_type: z.string().trim().min(1).max(80).optional(),
  status: z.string().trim().max(80).optional(),
  property_id: optionalUUID,
  lead_id: optionalUUID,
  value: moneySchema.optional(),
  commission_percentage: moneySchema.nullish(),
  commission_value: moneySchema.nullish(),
  client_name: z.string().trim().min(1).max(180).optional(),
  client_email: z.union([z.string().trim().email(), z.literal(''), z.null()]).optional(),
  client_phone: optionalText,
  client_document: optionalText,
  down_payment: moneySchema.nullish(),
  installments: z.number().int().min(1).max(360).nullish(),
  payment_conditions: optionalText,
  start_date: z.string().trim().max(40).nullish(),
  end_date: z.string().trim().max(40).nullish(),
  signing_date: z.string().trim().max(40).nullish(),
  closing_date: z.string().trim().max(40).nullish(),
  notes: optionalText,
  attachments: z.unknown().optional(),
  created_by: optionalUUID,
}

export const financialContractCreateInputSchema = z.object(contractShape).passthrough().superRefine((input, ctx) => {
  for (const key of ['contract_type', 'client_name', 'value'] as const) {
    if (input[key] === undefined || input[key] === '') {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: 'Campo obrigatorio' })
    }
  }
})
export const financialContractUpdateInputSchema = z.object(contractShape).passthrough().refine(
  (input) => Object.keys(input).length > 0,
  'Informe ao menos uma alteracao',
)

const commissionRuleShape = {
  name: z.string().trim().min(1).max(180).optional(),
  business_type: z.string().trim().max(80).optional(),
  commission_type: z.string().trim().max(80).optional(),
  commission_value: moneySchema.nullish(),
  percentage: moneySchema.nullish(),
  is_active: z.boolean().optional(),
}
export const commissionRuleCreateInputSchema = z.object(commissionRuleShape).passthrough().refine(
  (input) => Boolean(input.name),
  { path: ['name'], message: 'Nome e obrigatorio' },
)
export const commissionRuleUpdateInputSchema = z.object(commissionRuleShape).passthrough().refine(
  (input) => Object.keys(input).length > 0,
  'Informe ao menos uma alteracao',
)

export const contractActivationInputSchema = z.object({ skipCommissions: z.boolean().optional() }).strict()
export const financialActionInputSchema = z.record(z.unknown())
export const contractDocumentInputSchema = z.object({ path: z.string().trim().min(1).max(1_000) }).strict()
export const dreMappingInputSchema = z.object({
  category: z.string().trim().min(1).max(180),
  entry_type: z.enum(['payable', 'receivable']),
  group_id: uuidSchema,
}).passthrough()
export const apiSignedUrlResponseSchema = apiEnvelopeSchema(z.object({
  signedUrl: z.string().min(1),
}).passthrough())
