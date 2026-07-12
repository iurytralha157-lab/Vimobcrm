import { FEATURES, type SystemModuleKey } from '../../config/constants'

export interface NavigationAccessItem {
  path: string
  module?: SystemModuleKey
  permission?: string
  anyPermissions?: string[]
  adminOnly?: boolean
  superAdminOnly?: boolean
  feature?: keyof typeof FEATURES
  children?: NavigationAccessItem[]
}

export type NavigationAccess = {
  isSuperAdmin: boolean
  canAccessAdminItems: boolean
  canAccessFinancialModule: boolean
  isTeamLeader: boolean
  hasModule: (moduleName: SystemModuleKey) => boolean
  hasPermission: (permission: string) => boolean
}

const TEAM_LEADER_MANAGEMENT_PATHS = new Set([
  '/crm/management',
  '/crm/management?tab=teams',
  '/crm/management?tab=distribution',
])

function canAccessItem(item: NavigationAccessItem, access: NavigationAccess) {
  if (item.feature && !FEATURES[item.feature]) return false
  if (item.superAdminOnly && !access.isSuperAdmin) return false
  if (item.module === 'financial' && !access.canAccessFinancialModule) return false
  if (item.module && !access.hasModule(item.module)) return false
  if (item.adminOnly && !access.canAccessAdminItems) return false
  if (item.permission && !access.hasPermission(item.permission)) return false

  if (item.anyPermissions && !item.anyPermissions.some(access.hasPermission)) {
    return access.isTeamLeader && TEAM_LEADER_MANAGEMENT_PATHS.has(item.path)
  }

  return true
}

export function filterNavigationItems<T extends NavigationAccessItem>(
  items: readonly T[],
  access: NavigationAccess,
): T[] {
  return items.flatMap((item) => {
    if (!canAccessItem(item, access)) return []

    const filteredChildren = item.children
      ? filterNavigationItems(item.children, access)
      : undefined

    return [{
      ...item,
      children: filteredChildren?.length ? filteredChildren : undefined,
    } as T]
  })
}
