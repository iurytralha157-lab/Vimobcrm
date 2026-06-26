import { z } from 'zod'

const optionalTrimmedString = z
  .string()
  .trim()
  .optional()
  .transform((value) => value || undefined)

export const onboardingSignupSchema = z.object({
  companyName: z.string().trim().min(2).max(160),
  documentNumber: optionalTrimmedString,
  brokersCount: z.coerce.number().int().min(1).max(500).default(1),
  adminName: z.string().trim().min(2).max(140),
  phoneCountryCode: z.string().trim().min(2).max(8).default('+55'),
  phone: z.string().trim().min(6).max(32),
  email: z.string().trim().email().max(180).transform((value) => value.toLowerCase()),
  password: z.string().min(8).max(128),
  signupPath: z.enum(['trial', 'paid']).default('trial'),
  planSlug: optionalTrimmedString,
  termsAccepted: z.literal(true),
  privacyAccepted: z.literal(true),
  termsVersion: z.string().trim().min(1).max(40).default('2026-06-15'),
  privacyVersion: z.string().trim().min(1).max(40).default('2026-06-15'),
})

export type OnboardingSignupInput = z.input<typeof onboardingSignupSchema>
export type ParsedOnboardingSignupInput = z.infer<typeof onboardingSignupSchema>
