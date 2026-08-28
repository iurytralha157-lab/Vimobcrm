import { isTechnicalServiceError } from '../api/vimob-error'
import { invitationTokenSchema } from '../validation/final-domains'

export type InvitationLookupState =
  | 'loading'
  | 'available'
  | 'invalid'
  | 'expired'
  | 'unavailable'

type InvitationLookupInput = {
  token: string | null | undefined
  hasInvitation: boolean
  isPending: boolean
  error: unknown
}

const RETRYABLE_INVITATION_STATUSES = new Set([408, 429, 500, 502, 503, 504, 520, 522, 524])

export function normalizeInvitationToken(value: unknown) {
  const parsed = invitationTokenSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

export function createInvitationPath(value: unknown) {
  const token = normalizeInvitationToken(value)
  return token ? `/convite/${encodeURIComponent(token)}` : null
}

export function getInvitationLookupState({
  token,
  hasInvitation,
  isPending,
  error,
}: InvitationLookupInput): InvitationLookupState {
  if (!normalizeInvitationToken(token)) return 'invalid'
  if (isPending) return 'loading'
  if (error) return 'unavailable'
  return hasInvitation ? 'available' : 'expired'
}

export function isInvitationLookupRetryable(error: unknown) {
  if (isTechnicalServiceError(error)) return true
  if (!error || typeof error !== 'object') return false

  const status = 'status' in error && typeof error.status === 'number'
    ? error.status
    : null
  return status !== null && RETRYABLE_INVITATION_STATUSES.has(status)
}

export function isConfirmedInvitationAcceptance(value: unknown): value is {
  success: true
  requiresLogin: false
} {
  if (!value || typeof value !== 'object') return false
  const result = value as { success?: unknown; requiresLogin?: unknown }
  return result.success === true && result.requiresLogin === false
}
