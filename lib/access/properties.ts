type PropertyAccessInput = {
  userId?: string | null
  organizationId?: string | null
  isSuperAdmin?: boolean
  memberRole?: string | null
  permissions?: readonly string[] | null
  ownerIds?: Array<string | null | undefined>
  propertyEditPolicy?: string | null
  propertyOwnerContactVisibility?: string | null
}

type PropertyEditAccessReadinessInput = {
  isEditing: boolean
  propertyOrganizationId?: string | null
  activeOrganizationId?: string | null
  loadedOrganizationId?: string | null
  tenantOrganizationId?: string | null
  propertyEditPolicy?: string | null
}

const PROPERTY_MANAGER_ROLES = new Set(['owner', 'admin', 'super_admin'])
const PROPERTY_EDIT_MANAGER_ROLES = new Set([
  ...PROPERTY_MANAGER_ROLES,
  'manager',
])

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

export function isPropertyEditAccessReady(
  input: PropertyEditAccessReadinessInput,
) {
  if (!input.isEditing) return true

  const propertyOrganizationId = input.propertyOrganizationId?.trim()
  if (!propertyOrganizationId || !input.propertyEditPolicy?.trim()) return false

  return [
    input.activeOrganizationId,
    input.loadedOrganizationId,
    input.tenantOrganizationId,
  ].every((organizationId) => organizationId?.trim() === propertyOrganizationId)
}

export function canManageProperties(input: PropertyAccessInput) {
  if (input.isSuperAdmin) return true
  if (!isOrganizationMember(input)) return false

  const memberRole = normalizeRole(input.memberRole)
  return PROPERTY_MANAGER_ROLES.has(memberRole) || hasPermission(input.permissions, 'property_manage')
}

export function canDeleteProperties(input: PropertyAccessInput) {
  return canManageProperties(input)
}

export function canUpdatePropertyAvailability(input: PropertyAccessInput) {
  return canManageProperties(input)
}

export function canAssignProperties(input: PropertyAccessInput) {
  return canManageProperties(input)
}

export function canEditPropertyDetails(input: PropertyAccessInput) {
  if (canManageProperties(input)) return true
  if (!isOrganizationMember(input)) return false

  const memberRole = normalizeRole(input.memberRole)
  if (PROPERTY_EDIT_MANAGER_ROLES.has(memberRole)) return true
  if (!hasPermission(input.permissions, 'property_view')) return false

  if (input.propertyEditPolicy === 'everyone') return true
  if (input.propertyEditPolicy !== 'responsible_or_admin') return false

  const userId = input.userId?.trim()
  return Boolean(
    userId && input.ownerIds?.some((ownerId) => ownerId?.trim() === userId),
  )
}

export function canViewPropertyOwnerContacts(input: PropertyAccessInput) {
  if (canManageProperties(input)) return true
  if (!isOrganizationMember(input)) return false

  return input.propertyOwnerContactVisibility === 'visible'
}
