import { z } from 'zod'
import type {
  ParsedOnboardingSignupRecoveryResponse,
  ParsedOnboardingSignupSuccessResponse,
} from '../validation/onboarding'

export const PUBLIC_SIGNUP_ATTEMPT_STORAGE_KEY = 'vimob:public-signup:attempt:v1'
export const PUBLIC_SIGNUP_COMPLETION_STORAGE_KEY = 'vimob:public-signup:completion:v1'
export const PUBLIC_SIGNUP_RETRY_STORAGE_KEY = 'vimob:public-signup:retry:v1'
export const PUBLIC_SIGNUP_COMPLETION_TTL_MS = 2 * 60 * 60 * 1_000

const MAX_COMPLETION_CLOCK_SKEW_MS = 5 * 60 * 1_000

type SignupStorage = Pick<Storage, 'getItem' | 'removeItem' | 'setItem'>

const signupAttemptIdSchema = z.string().uuid()
const canonicalCheckoutTokenSchema = z.string().regex(/^[0-9a-f]{32}$/)
const recoveryCapabilitySchema = z.string().min(120).max(4096).regex(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)

const publicSignupCompletionSchema = z.object({
  attemptId: signupAttemptIdSchema,
  email: z.string().email(),
  organizationId: z.string().uuid(),
  redirectTo: z.string().min(1).max(512).refine((value) => value.startsWith('/') && !value.startsWith('//')),
  checkoutToken: canonicalCheckoutTokenSchema.nullable(),
  requiresPayment: z.boolean(),
  emailConfirmationRequired: z.literal(true),
  recoveryCapability: recoveryCapabilitySchema.optional(),
  completedAt: z.string().datetime(),
}).superRefine((completion, context) => {
  if (completion.requiresPayment) {
    if (!completion.checkoutToken || completion.redirectTo !== `/checkout/${completion.checkoutToken}`) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['redirectTo'],
        message: 'Stored checkout result is inconsistent',
      })
    }
    return
  }

  if (completion.checkoutToken !== null || completion.redirectTo !== '/select-organization') {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['redirectTo'],
      message: 'Stored trial result is inconsistent',
    })
  }
})

const publicSignupRetrySchema = z.object({
  attemptId: signupAttemptIdSchema,
  email: z.string().email(),
  reason: z.literal('document_conflict'),
})

export type StoredPublicSignupCompletion = z.infer<typeof publicSignupCompletionSchema>
export type StoredPublicSignupRetry = z.infer<typeof publicSignupRetrySchema>

export function getOrCreatePublicSignupAttemptId(
  storage: SignupStorage,
  createUUID: () => string = () => globalThis.crypto.randomUUID(),
) {
  const existing = storage.getItem(PUBLIC_SIGNUP_ATTEMPT_STORAGE_KEY)
  const parsedExisting = signupAttemptIdSchema.safeParse(existing)
  if (parsedExisting.success) return parsedExisting.data

  const generated = signupAttemptIdSchema.parse(createUUID())
  storage.setItem(PUBLIC_SIGNUP_ATTEMPT_STORAGE_KEY, generated)
  return generated
}

/**
 * Starts a fresh idempotency scope after the API has definitively rejected the
 * previous identity (for example, an attempt/email ownership conflict). The
 * completion record is removed first so a stale successful redirect can never
 * be restored under the new attempt.
 */
export function rotatePublicSignupAttemptId(
  storage: SignupStorage,
  createUUID: () => string = () => globalThis.crypto.randomUUID(),
) {
  const generated = signupAttemptIdSchema.parse(createUUID())
  storage.removeItem(PUBLIC_SIGNUP_COMPLETION_STORAGE_KEY)
  storage.removeItem(PUBLIC_SIGNUP_RETRY_STORAGE_KEY)
  storage.setItem(PUBLIC_SIGNUP_ATTEMPT_STORAGE_KEY, generated)
  return generated
}

export function persistPublicSignupRetry(
  storage: SignupStorage,
  attemptId: string,
  email: string,
) {
  const retry = publicSignupRetrySchema.parse({
    attemptId,
    email: email.trim().toLowerCase(),
    reason: 'document_conflict',
  })
  storage.setItem(PUBLIC_SIGNUP_ATTEMPT_STORAGE_KEY, retry.attemptId)
  storage.setItem(PUBLIC_SIGNUP_RETRY_STORAGE_KEY, JSON.stringify(retry))
  return retry
}

export function readPublicSignupRetry(storage: SignupStorage) {
  const raw = storage.getItem(PUBLIC_SIGNUP_RETRY_STORAGE_KEY)
  if (!raw) return null

  try {
    const retry = publicSignupRetrySchema.safeParse(JSON.parse(raw))
    const attempt = signupAttemptIdSchema.safeParse(
      storage.getItem(PUBLIC_SIGNUP_ATTEMPT_STORAGE_KEY),
    )
    if (retry.success && attempt.success && retry.data.attemptId === attempt.data) {
      return retry.data
    }
  } catch {
    // Invalid session data is discarded below.
  }

  storage.removeItem(PUBLIC_SIGNUP_RETRY_STORAGE_KEY)
  return null
}

export function persistPublicSignupCompletion(
  storage: SignupStorage,
  attemptId: string,
  email: string,
  result: ParsedOnboardingSignupSuccessResponse,
) {
  const completion = publicSignupCompletionSchema.parse({
    attemptId,
    email: email.trim().toLowerCase(),
    organizationId: result.organizationId,
    redirectTo: result.redirectTo,
    checkoutToken: result.checkoutToken,
    requiresPayment: result.requiresPayment,
    emailConfirmationRequired: result.emailConfirmationRequired,
    recoveryCapability: result.recoveryCapability,
    completedAt: new Date().toISOString(),
  })
  storage.removeItem(PUBLIC_SIGNUP_RETRY_STORAGE_KEY)
  storage.setItem(PUBLIC_SIGNUP_COMPLETION_STORAGE_KEY, JSON.stringify(completion))
  return completion
}

export function readPublicSignupCompletion(storage: SignupStorage, now = Date.now()) {
  const raw = storage.getItem(PUBLIC_SIGNUP_COMPLETION_STORAGE_KEY)
  if (!raw) return null

  try {
    const parsed = publicSignupCompletionSchema.safeParse(JSON.parse(raw))
    if (parsed.success) {
      const completedAt = Date.parse(parsed.data.completedAt)
      const age = now - completedAt
      if (age >= -MAX_COMPLETION_CLOCK_SKEW_MS && age <= PUBLIC_SIGNUP_COMPLETION_TTL_MS) {
        return parsed.data
      }
    }
  } catch {
    // Invalid session data is discarded below.
  }

  clearPublicSignupAttempt(storage)
  return null
}

export function applyPublicSignupEmailCorrection(
  storage: SignupStorage,
  result: Extract<ParsedOnboardingSignupRecoveryResponse, { ok: true }>,
) {
  if (result.action !== 'correct_email' || !result.email) return null
  const completion = readPublicSignupCompletion(storage)
  if (!completion) return null
  const updated = publicSignupCompletionSchema.parse({
    ...completion,
    email: result.email,
    redirectTo: result.redirectTo,
    checkoutToken: result.checkoutToken ?? null,
    requiresPayment: result.requiresPayment ?? completion.requiresPayment,
    recoveryCapability: undefined,
  })
  storage.setItem(PUBLIC_SIGNUP_COMPLETION_STORAGE_KEY, JSON.stringify(updated))
  return updated
}

export function clearPublicSignupAttempt(storage: SignupStorage) {
  storage.removeItem(PUBLIC_SIGNUP_ATTEMPT_STORAGE_KEY)
  storage.removeItem(PUBLIC_SIGNUP_COMPLETION_STORAGE_KEY)
  storage.removeItem(PUBLIC_SIGNUP_RETRY_STORAGE_KEY)
}
