import { z } from 'zod'
import {
  CURRENT_PRIVACY_VERSION,
  CURRENT_TERMS_VERSION,
} from '../../config/legal-documents'
import { isValidBrazilianTaxId, normalizeBrazilianTaxId } from './brazilian-tax-id'

export { CURRENT_PRIVACY_VERSION, CURRENT_TERMS_VERSION }

const optionalTrimmedString = z
  .string()
  .trim()
  .optional()
  .transform((value) => value || undefined)

const onboardingStepDocumentSchema = z.string()
  .trim()
  .min(1, 'Informe o CPF ou CNPJ')
  .regex(/^[\d./\-\s]+$/, 'Informe somente os dígitos e a máscara do CPF ou CNPJ')
  .transform(normalizeBrazilianTaxId)
  .refine(isValidBrazilianTaxId, 'Informe um CPF ou CNPJ válido')

const onboardingStepEmailSchema = z.string()
  .trim()
  .email('Informe um e-mail válido')
  .max(180)
  .transform((value) => value.toLowerCase())

const onboardingStepPhoneCountryCodeSchema = z.enum(['+55', '+1', '+351', '+54', '+56', '+598', '+595'])
const onboardingStepPhoneDigits: Record<z.infer<typeof onboardingStepPhoneCountryCodeSchema>, number> = {
  '+55': 11,
  '+1': 10,
  '+351': 9,
  '+54': 10,
  '+56': 9,
  '+598': 8,
  '+595': 9,
}

function validateOnboardingStepPhone(
  input: { phoneCountryCode: z.infer<typeof onboardingStepPhoneCountryCodeSchema>; phone: string },
  context: z.RefinementCtx,
) {
  const phoneDigits = input.phone.replace(/\D/g, '')
  if (
    !/^[\d\s()-]+$/.test(input.phone) ||
    phoneDigits.length !== onboardingStepPhoneDigits[input.phoneCountryCode]
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['phone'],
      message: 'Informe um WhatsApp válido para o país selecionado',
    })
  }
}

export const onboardingOrganizationStepSchema = z.object({
  companyName: z.string().trim().min(2, 'Informe o nome da imobiliária').max(160),
  documentNumber: onboardingStepDocumentSchema,
  brokersCount: z.coerce
    .number()
    .int('Informe uma quantidade inteira de corretores')
    .min(1, 'Informe pelo menos um corretor')
    .max(500, 'Informe no máximo 500 corretores'),
})

export const onboardingAccessStepSchema = z.object({
  adminName: z.string().trim().min(2, 'Informe o nome completo do gestor').max(140),
  phoneCountryCode: onboardingStepPhoneCountryCodeSchema,
  phone: z.string().trim().min(1, 'Informe o WhatsApp').max(32),
  email: onboardingStepEmailSchema,
  password: z.string()
    .min(8, 'Use pelo menos 8 caracteres')
    .max(128, 'Use no máximo 128 caracteres')
    .regex(/[A-Z]/, 'Inclua pelo menos uma letra maiúscula')
    .regex(/[^A-Za-z0-9]/, 'Inclua pelo menos um caractere especial'),
  legalAccepted: z.boolean().refine((value) => value, {
    message: 'Aceite os Termos de Uso e a Política de Privacidade',
  }),
}).superRefine(validateOnboardingStepPhone)

export const onboardingStepValidationRequestSchema = z.discriminatedUnion('step', [
  z.object({
    step: z.literal('organization'),
    companyName: z.string().trim().min(2).max(160),
    documentNumber: onboardingStepDocumentSchema,
  }),
  z.object({
    step: z.literal('access'),
    email: onboardingStepEmailSchema,
  }),
])

export const onboardingStepValidationResponseSchema = z.union([
  z.object({
    ok: z.literal(true),
    valid: z.literal(true),
  }),
  z.object({
    ok: z.literal(false),
    valid: z.literal(false).optional(),
    field: z.enum(['documentNumber', 'email']).optional(),
    code: z.string().trim().min(1).max(100),
    message: z.string().trim().min(1).max(500),
  }),
])

export const onboardingSignupSchema = z.object({
  attemptId: z.string().uuid(),
  companyName: z.string().trim().min(2).max(160),
  documentNumber: z.string()
    .trim()
    .min(1, 'Informe o CPF ou CNPJ')
    .regex(/^[\d./\-\s]+$/, 'Informe somente os digitos e a mascara do CPF ou CNPJ')
    .transform(normalizeBrazilianTaxId)
    .refine(isValidBrazilianTaxId, 'Informe um CPF ou CNPJ valido'),
  brokersCount: z.coerce.number().int().min(1).max(500).default(1),
  adminName: z.string().trim().min(2).max(140),
  phoneCountryCode: z.enum(['+55', '+1', '+351', '+54', '+56', '+598', '+595']).default('+55'),
  phone: z.string().trim().min(1).max(32),
  email: z.string().trim().email().max(180).transform((value) => value.toLowerCase()),
  password: z.string().min(8).max(128),
  signupPath: z.enum(['trial', 'paid']).default('trial'),
  planSlug: optionalTrimmedString,
  termsAccepted: z.literal(true),
  privacyAccepted: z.literal(true),
  termsVersion: z.literal(CURRENT_TERMS_VERSION),
  privacyVersion: z.literal(CURRENT_PRIVACY_VERSION),
}).superRefine((input, context) => {
  const expectedPhoneDigits: Record<typeof input.phoneCountryCode, number> = {
    '+55': 11,
    '+1': 10,
    '+351': 9,
    '+54': 10,
    '+56': 9,
    '+598': 8,
    '+595': 9,
  }
  const phoneDigits = input.phone.replace(/\D/g, '')

  if (!/^[\d\s()-]+$/.test(input.phone) || phoneDigits.length !== expectedPhoneDigits[input.phoneCountryCode]) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['phone'],
      message: 'Informe um WhatsApp valido para o pais selecionado',
    })
  }
})

const safeInternalRedirectSchema = z.string()
  .min(1)
  .max(512)
  .refine((value) => value.startsWith('/') && !value.startsWith('//'), 'Redirect interno invalido')

const canonicalCheckoutTokenSchema = z.string().regex(/^[0-9a-f]{32}$/, 'Token de checkout invalido')
const signupRecoveryCapabilitySchema = z.string().min(120).max(4096).regex(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)

export const onboardingSignupSuccessResponseSchema = z.object({
  ok: z.literal(true),
  message: z.string().min(1).max(500),
  redirectTo: safeInternalRedirectSchema,
  checkoutToken: canonicalCheckoutTokenSchema.nullable(),
  organizationId: z.string().uuid(),
  requiresPayment: z.boolean(),
  emailConfirmationRequired: z.literal(true),
  recoveryCapability: signupRecoveryCapabilitySchema,
}).superRefine((result, context) => {
  if (result.requiresPayment) {
    if (!result.checkoutToken) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['checkoutToken'],
        message: 'Checkout obrigatorio sem token',
      })
      return
    }

    if (result.redirectTo !== `/checkout/${result.checkoutToken}`) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['redirectTo'],
        message: 'Redirect de checkout inconsistente',
      })
    }
    return
  }

  if (result.redirectTo !== '/select-organization') {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['redirectTo'],
      message: 'Redirect de acesso inconsistente',
    })
  }
  if (result.checkoutToken !== null) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['checkoutToken'],
      message: 'Cadastro sem pagamento nao deve expor token de checkout',
    })
  }
})

export const onboardingSignupErrorResponseSchema = z.object({
  ok: z.literal(false),
  code: z.string().trim().min(1).max(100).optional(),
  message: z.string().min(1).max(500),
})

export const onboardingSignupResponseSchema = z.union([
  onboardingSignupSuccessResponseSchema,
  onboardingSignupErrorResponseSchema,
])

export const onboardingEmailConfirmationResendSchema = z.object({
  email: z.string().trim().email().max(180).transform((value) => value.toLowerCase()),
})

export const onboardingEmailConfirmationResendResponseSchema = z.object({
  ok: z.boolean(),
  message: z.string().min(1).max(500),
})

const onboardingSignupRecoveryBaseSchema = z.object({
  capability: signupRecoveryCapabilitySchema,
  currentEmail: z.string().trim().email().max(180).transform((value) => value.toLowerCase()),
})

export const onboardingSignupRecoverySchema = z.discriminatedUnion('action', [
  onboardingSignupRecoveryBaseSchema.extend({
    action: z.literal('correct_email'),
    newEmail: z.string().trim().email().max(180).transform((value) => value.toLowerCase()),
  }),
  onboardingSignupRecoveryBaseSchema.extend({
    action: z.literal('cancel_and_restart'),
  }),
]).superRefine((value, context) => {
  if (value.action === 'correct_email' && value.currentEmail === value.newEmail) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['newEmail'], message: 'Informe um e-mail diferente' })
  }
})

const onboardingSignupRecoverySuccessSchema = z.object({
  ok: z.literal(true),
  action: z.enum(['correct_email', 'cancel_and_restart']),
  message: z.string().min(1).max(500),
  redirectTo: safeInternalRedirectSchema,
  email: z.string().email().optional(),
  checkoutToken: canonicalCheckoutTokenSchema.nullable().optional(),
  requiresPayment: z.boolean().optional(),
  restartAllowed: z.boolean().optional(),
})

export const onboardingSignupRecoveryResponseSchema = z.union([
  onboardingSignupRecoverySuccessSchema,
  onboardingSignupErrorResponseSchema,
])

export type OnboardingSignupInput = z.input<typeof onboardingSignupSchema>
export type ParsedOnboardingOrganizationStep = z.infer<typeof onboardingOrganizationStepSchema>
export type ParsedOnboardingAccessStep = z.infer<typeof onboardingAccessStepSchema>
export type ParsedOnboardingStepValidationRequest = z.infer<typeof onboardingStepValidationRequestSchema>
export type ParsedOnboardingStepValidationResponse = z.infer<typeof onboardingStepValidationResponseSchema>
export type ParsedOnboardingSignupInput = z.infer<typeof onboardingSignupSchema>
export type ParsedOnboardingSignupResponse = z.infer<typeof onboardingSignupResponseSchema>
export type ParsedOnboardingSignupSuccessResponse = z.infer<typeof onboardingSignupSuccessResponseSchema>
export type ParsedOnboardingEmailConfirmationResend = z.infer<typeof onboardingEmailConfirmationResendSchema>
export type ParsedOnboardingSignupRecovery = z.infer<typeof onboardingSignupRecoverySchema>
export type ParsedOnboardingSignupRecoveryResponse = z.infer<typeof onboardingSignupRecoveryResponseSchema>
