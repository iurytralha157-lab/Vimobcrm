type PropertyAccessInput = {
  userId?: string | null
  organizationId?: string | null
  isSuperAdmin?: boolean
  memberRole?: string | null
  permissions?: readonly string[] | null
  ownerIds?: Array<string | null | undefined>
}

const PROPERTY_MANAGER_ROLES = new Set(['owner', 'admin', 'manager', 'super_admin'])
const PROPERTY_DELETE_ROLES = new Set(['owner', 'admin', 'super_admin'])

function normalizeRole(value?: string | null) {
  const role = (value || '').trim().toLowerCase()

  switch (role) {
    case 'administrador':
    case 'administrator':
      return 'admin'
    case 'gestor':
    case 'gerente':
      return 'manager'
    case 'proprietario':
      return 'owner'
    case 'usuario':
    case 'membro':
    case 'corretor':
    case 'broker':
    case 'agent':
      return 'user'
    default:
      return role
  }
}

function hasPermission(permissions: readonly string[] | null | undefined, permission: string) {
  return Boolean(permissions?.some((candidate) => candidate === '*' || candidate === permission))
}

function isOrganizationMember(input: PropertyAccessInput) {
  return Boolean(input.userId && input.organizationId)
}

export function canManageProperties(input: PropertyAccessInput) {
  if (input.isSuperAdmin) return true
  if (!isOrganizationMember(input)) return false

  const memberRole = normalizeRole(input.memberRole)
  return PROPERTY_MANAGER_ROLES.has(memberRole) || hasPermission(input.permissions, 'property_manage')
}

export function canDeleteProperties(input: PropertyAccessInput) {
  if (input.isSuperAdmin) return true
  if (!isOrganizationMember(input)) return false

  const memberRole = normalizeRole(input.memberRole)
  return PROPERTY_DELETE_ROLES.has(memberRole) || hasPermission(input.permissions, 'property_delete')
}

export function canUpdatePropertyAvailability(input: PropertyAccessInput) {
  return isOrganizationMember(input)
}

export function canAssignProperties(input: PropertyAccessInput) {
  return canManageProperties(input) || hasPermission(input.permissions, 'property_assign')
}

export function canEditPropertyDetails(input: PropertyAccessInput) {
  if (canManageProperties(input)) return true
  if (!isOrganizationMember(input)) return false

  return Boolean(input.ownerIds?.some((ownerId) => ownerId && ownerId === input.userId))
}
