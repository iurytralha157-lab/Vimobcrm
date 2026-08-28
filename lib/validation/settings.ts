import { z } from 'zod'
import { apiEnvelopeSchema, nonNegativeIntegerSchema, timestampSchema, uuidSchema } from './common'
import { isValidBrazilianTaxId } from './brazilian-tax-id'

const nullableText = (max: number) => z.string().trim().max(max).nullable().optional()
const optionalEmail = z.union([z.string().trim().email(), z.literal(''), z.null()]).optional()
const onlyDigits = (value: string) => value.replace(/\D/g, '')
const normalizeCardNumber = (value: string) => value.replace(/[\s-]/g, '')

function passesLuhnCheck(value: string) {
  let sum = 0
  let shouldDouble = false

  for (let index = value.length - 1; index >= 0; index -= 1) {
    let digit = Number(value[index])

    if (shouldDouble) {
      digit *= 2
      if (digit > 9) digit -= 9
    }

    sum += digit
    shouldDouble = !shouldDouble
  }

  return sum % 10 === 0
}

const subscriptionCardSchema = z.object({
  holder_name: z.string().trim().min(2, 'Informe o nome impresso no cartao').max(100).optional(),
  holder_cpf_cnpj: z.string().trim().refine(
    isValidBrazilianTaxId,
    'Informe um CPF ou CNPJ valido para o titular do cartao',
  ).optional(),
  number: z.string()
    .trim()
    .regex(/^[\d\s-]+$/, 'Informe somente os digitos do cartao')
    .transform(normalizeCardNumber)
    .refine((value) => value.length >= 13 && value.length <= 19, 'Informe um cartao entre 13 e 19 digitos')
    .refine(passesLuhnCheck, 'Informe um numero de cartao valido'),
  expiry_month: z.string().trim().regex(/^(0[1-9]|1[0-2])$/, 'Informe o mes no formato MM'),
  expiry_year: z.string().trim().regex(/^\d{4}$/, 'Informe o ano com quatro digitos'),
  ccv: z.string().trim().regex(/^\d{3,4}$/, 'Informe um codigo de seguranca valido'),
}).strict().superRefine((card, context) => {
  const now = new Date()
  const currentYear = now.getUTCFullYear()
  const currentMonth = now.getUTCMonth() + 1
  const expiryYear = Number(card.expiry_year)
  const expiryMonth = Number(card.expiry_month)

  if (expiryYear < currentYear || (expiryYear === currentYear && expiryMonth < currentMonth)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['expiry_year'],
      message: 'O cartao esta expirado',
    })
  }
})

export const checkoutBillingDetailsSchema = z.object({
  name: z.string().trim().min(2, 'Informe o nome ou a razão social').max(200),
  email: z.string().trim().email('Informe um e-mail válido').max(320),
  cpf_cnpj: z.string().trim().refine(
    isValidBrazilianTaxId,
    'Informe um CPF ou CNPJ válido',
  ),
  phone: z.string().trim().refine(
    (value) => {
      const digits = onlyDigits(value)
      return digits.length >= 10 && digits.length <= 13
    },
    'Informe um celular válido',
  ),
  country: z.literal('BR'),
  postal_code: z.string().trim().refine(
    (value) => onlyDigits(value).length === 8,
    'Informe um CEP válido',
  ),
  address: z.string().trim().min(3, 'Informe o endereço').max(200),
  address_number: z.string().trim().min(1, 'Informe o número').max(40),
  address_complement: z.string().trim().max(120),
  neighborhood: z.string().trim().min(2, 'Informe o bairro').max(120),
  city: z.string().trim().min(2, 'Informe a cidade').max(120),
  state: z.string().trim().length(2, 'Informe a UF').transform((value) => value.toUpperCase()),
}).strict()

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
  vapidPublicKey: z.string().trim().min(1).max(500).nullish(),
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
export const subscriptionChargeInputSchema = z.object({
  idempotency_key: uuidSchema.optional(),
  organization_id: uuidSchema.optional(),
  checkout_token: z.string().trim().min(20).max(500).optional(),
  billing_type: z.enum(['PIX', 'BOLETO', 'CREDIT_CARD']),
  billing_profile_mode: z.enum(['manual', 'stored']).default('manual'),
  billing_period_months: z.union([z.literal(1), z.literal(6), z.literal(12)]).optional(),
  expected_plan_id: uuidSchema.optional(),
  expected_monthly_price: z.number().finite().positive().max(10_000_000).optional(),
  holder_email: z.string().trim().email().max(320).optional(),
  holder_cpf_cnpj: z.string().trim().min(11).max(30).optional(),
  holder_name: z.string().trim().min(2).max(200).optional(),
  holder_phone: z.string().trim().max(40).optional(),
  holder_postal_code: z.string().trim().max(20).optional(),
  holder_address: z.string().trim().max(200).optional(),
  holder_address_number: z.string().trim().max(40).optional(),
  holder_address_complement: z.string().trim().max(120).optional(),
  holder_neighborhood: z.string().trim().max(120).optional(),
  holder_city: z.string().trim().max(120).optional(),
  holder_state: z.string().trim().max(2).optional(),
  holder_country: z.literal('BR').optional(),
  card: subscriptionCardSchema.optional(),
}).strict().superRefine((input, context) => {
  if (!input.organization_id && !input.checkout_token) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Informe a organizacao ou o token do checkout',
    })
  }

  if (input.card && input.billing_type !== 'CREDIT_CARD') {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['card'],
      message: 'Dados de cartao sao aceitos somente para pagamento com cartao de credito',
    })
  }

  if (input.billing_type === 'CREDIT_CARD' && !input.card) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['card'],
      message: 'Informe os dados do cartao para concluir o pagamento dentro da Vimob',
    })
  }

  if (input.billing_type === 'CREDIT_CARD' && !input.idempotency_key) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['idempotency_key'],
      message: 'Identificador idempotente do pagamento com cartao e obrigatorio',
    })
  }

  if (input.billing_profile_mode === 'manual') {
    const requiredBillingFields: Array<[keyof typeof input, string]> = [
      ['holder_name', 'Informe o nome ou a razão social'],
      ['holder_email', 'Informe o e-mail de faturamento'],
      ['holder_cpf_cnpj', 'Informe o CPF ou CNPJ'],
      ['holder_phone', 'Informe o celular'],
      ['holder_postal_code', 'Informe o CEP'],
      ['holder_address', 'Informe o endereço'],
      ['holder_address_number', 'Informe o número'],
      ['holder_neighborhood', 'Informe o bairro'],
      ['holder_city', 'Informe a cidade'],
      ['holder_state', 'Informe a UF'],
    ]
    for (const [field, message] of requiredBillingFields) {
      if (!String(input[field] ?? '').trim()) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [field],
          message,
        })
      }
    }
  }
})
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
export const apiPublicPushConfigSchema = z.object({
  enabled: z.boolean(),
  publicKey: z.string().trim().max(500),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
}).strict()
export const apiPaymentHistoryItemSchema = z.object({
  id: uuidSchema,
  asaas_payment_id: z.string().trim().min(1).max(180),
  asaas_subscription_id: z.string().trim().max(180).nullable(),
  billing_intent_id: uuidSchema.nullable().default(null),
  plan_id: uuidSchema.nullable().default(null),
  plan_name: z.string().trim().max(120).nullable().default(null),
  billing_type: z.string().trim().max(40).nullable(),
  status: z.string().trim().max(80).nullable(),
  value: z.coerce.number().finite().nonnegative().nullable(),
  due_date: z.string().date().nullable(),
  payment_date: z.string().date().nullable(),
  bank_slip_registration_cancelled: z.boolean().default(false),
  checkout_url: z.string().regex(/^\/checkout\/[a-f0-9]{64}$/).nullable().default(null),
  receipt_path: z.string()
    .regex(/^\/comprovantes\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    .nullable()
    .default(null),
  sync_state: z.enum(['cached', 'current', 'provider_unavailable']).default('cached'),
  created_at: timestampSchema,
  updated_at: timestampSchema,
}).strict()
export const apiPaymentHistoryItemResponseSchema = apiEnvelopeSchema(apiPaymentHistoryItemSchema)
export const apiSubscriptionOverviewSchema = z.object({
  org: z.record(z.unknown()).nullable(),
  plan: z.record(z.unknown()).nullable(),
  pendingPlan: z.record(z.unknown()).nullable().default(null),
  planChange: z.object({
    id: uuidSchema,
    from_plan_id: uuidSchema,
    target_plan_id: uuidSchema,
    status: z.enum(['provider_updating', 'scheduled']),
    billing_period_months: z.union([z.literal(1), z.literal(6), z.literal(12)]),
    amount: z.coerce.number().positive(),
    effective_on: z.string().date().nullable(),
    requested_at: timestampSchema,
    provider_updated_at: timestampSchema.nullable(),
  }).nullable().default(null),
  availablePlans: z.array(z.record(z.unknown())),
  history: z.array(apiPaymentHistoryItemSchema),
  billingCheckoutReady: z.boolean().default(false),
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
export const apiPublicPushConfigResponseSchema = apiEnvelopeSchema(apiPublicPushConfigSchema)
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
