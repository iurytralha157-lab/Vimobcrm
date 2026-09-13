export type ActiveOrganizationResolvingReason =
  | 'auth'
  | 'organizations'
  | 'organization-switch'
  | 'identity-mismatch'

export type ActiveOrganizationMissingReason =
  | 'unauthenticated'
  | 'organization-load-failed'
  | 'no-active-organization'

export type ActiveOrganizationResolution =
  | {
      status: 'resolving'
      organizationId: null
      reason: ActiveOrganizationResolvingReason
    }
  | {
      status: 'ready'
      organizationId: string
      reason: null
    }
  | {
      status: 'missing'
      organizationId: null
      reason: ActiveOrganizationMissingReason
    }

export type ActiveOrganizationResolutionInput = {
  userId?: string | null
  authInitialized: boolean
  authLoading: boolean
  organizationsLoaded: boolean
  isInitializingOrganization: boolean
  organizationId?: string | null
  tenantOrganizationId?: string | null
  profileOrganizationId?: string | null
  impersonatedOrganizationId?: string | null
  organizationsError?: string | null
}

function normalizeOrganizationId(value: string | null | undefined) {
  const normalized = value?.trim()
  return normalized ? normalized : null
}

export function requireActiveOrganizationId(value?: string | null) {
  if (!value) throw new Error('Organização não selecionada.')
  return value
}

/**
 * Resolves the organization identity that may be used to scope frontend data.
 *
 * The organization and tenant context are authoritative once the auth flow is
 * stable. `profile.organization_id` remains a compatibility fallback only; it
 * is never exposed while auth, membership loading, or an organization switch
 * is in progress.
 */
export function resolveActiveOrganization(
  input: ActiveOrganizationResolutionInput,
): ActiveOrganizationResolution {
  if (!input.authInitialized || input.authLoading) {
    return { status: 'resolving', organizationId: null, reason: 'auth' }
  }

  if (!normalizeOrganizationId(input.userId)) {
    return { status: 'missing', organizationId: null, reason: 'unauthenticated' }
  }

  if (!input.organizationsLoaded) {
    return { status: 'resolving', organizationId: null, reason: 'organizations' }
  }

  if (input.isInitializingOrganization) {
    return { status: 'resolving', organizationId: null, reason: 'organization-switch' }
  }

  const organizationId = normalizeOrganizationId(input.organizationId)
  const tenantOrganizationId = normalizeOrganizationId(input.tenantOrganizationId)
  const impersonatedOrganizationId = normalizeOrganizationId(input.impersonatedOrganizationId)

  if (
    organizationId
    && tenantOrganizationId
    && organizationId !== tenantOrganizationId
  ) {
    return { status: 'resolving', organizationId: null, reason: 'identity-mismatch' }
  }

  if (
    impersonatedOrganizationId
    && (
      organizationId !== impersonatedOrganizationId
      || tenantOrganizationId !== impersonatedOrganizationId
    )
  ) {
    return { status: 'resolving', organizationId: null, reason: 'identity-mismatch' }
  }

  const resolvedOrganizationId =
    tenantOrganizationId
    ?? organizationId
    ?? normalizeOrganizationId(input.profileOrganizationId)

  if (resolvedOrganizationId) {
    return { status: 'ready', organizationId: resolvedOrganizationId, reason: null }
  }

  if (input.organizationsError) {
    return { status: 'missing', organizationId: null, reason: 'organization-load-failed' }
  }

  return { status: 'missing', organizationId: null, reason: 'no-active-organization' }
}
