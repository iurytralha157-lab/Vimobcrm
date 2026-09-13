import {
  DEFAULT_ENABLED_MODULE_KEYS,
  SYSTEM_MODULES,
  type SystemModuleKey,
} from '../../config/constants'

export type TenantNavigationContext = {
  organizationId?: string
  memberRole?: string
  permissions: string[]
  enabledModules: string[]
  isTeamLeader?: boolean
  isSuperAdmin: boolean
}

const SYSTEM_MODULE_KEYS = new Set<string>(SYSTEM_MODULES.map((module) => module.key))

export function isTenantContextForOrganization(
  organizationId: string | null | undefined,
  context: TenantNavigationContext | null | undefined,
) {
  return Boolean(organizationId && context?.organizationId === organizationId)
}

export function getTenantEnabledModules(context: TenantNavigationContext): SystemModuleKey[] {
  return context.enabledModules.filter(
    (moduleName): moduleName is SystemModuleKey => SYSTEM_MODULE_KEYS.has(moduleName),
  )
}

export function getTenantPermissions(context: TenantNavigationContext): string[] {
  if (
    context.isSuperAdmin ||
    context.memberRole === 'owner' ||
    context.memberRole === 'admin'
  ) {
    return ['*']
  }

  return context.permissions
}

export function canViewOrganizationPresence(
  organizationId: string | null | undefined,
  context: TenantNavigationContext | null | undefined,
  hasPresencePermission: boolean,
) {
  if (!hasPresencePermission || !isTenantContextForOrganization(organizationId, context)) {
    return false
  }

  const memberRole = context?.memberRole?.trim().toLowerCase()
  return Boolean(
    context?.isSuperAdmin ||
    memberRole === 'owner' ||
    memberRole === 'admin' ||
    context?.isTeamLeader,
  )
}

export function hasDefaultModule(moduleName: SystemModuleKey) {
  return DEFAULT_ENABLED_MODULE_KEYS.includes(moduleName)
}
