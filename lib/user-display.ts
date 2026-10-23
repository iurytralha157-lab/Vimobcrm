import { getDisplayGraphemes, getDisplayInitial, normalizeDisplayName } from '@/lib/display-name'

type UserDisplayValue = {
  name?: string | null
  email?: string | null
  is_active?: boolean | null
}

type InitialsOptions = {
  email?: string | null
  fallback?: string
  singleWordCharacters?: 1 | 2
  stripEmailDomain?: boolean
}

const ADMIN_MEMBER_ROLES = new Set(['owner', 'admin', 'super_admin'])

function normalizeMemberRole(role?: string | null) {
  return role?.trim().toLocaleLowerCase('pt-BR') ?? ''
}

export function getInitials(value?: string | null, options: InitialsOptions = {}) {
  let source = normalizeDisplayName(value || options.email)
  if (options.stripEmailDomain) source = source.replace(/@.*/, '')

  const parts = source.split(/\s+/).filter(Boolean)
  if (parts.length === 0) return options.fallback ?? ''

  if (parts.length === 1 && options.singleWordCharacters === 2) {
    return getDisplayGraphemes(parts[0]).slice(0, 2).join('').toLocaleUpperCase('pt-BR')
  }

  return getDisplayGraphemes(parts.map(getDisplayInitial).join('')).slice(0, 2).join('')
}

export function getOrganizationMemberRoleLabel(role?: string | null) {
  switch (normalizeMemberRole(role)) {
    case 'owner':
      return 'Proprietário'
    case 'admin':
    case 'super_admin':
      return 'Administrador'
    case 'manager':
      return 'Gestor'
    case 'leader':
      return 'Líder'
    default:
      return 'Usuário'
  }
}

export function getOrganizationMemberDisplayLabel(
  role?: string | null,
  isTeamLeader = false,
) {
  const normalizedRole = normalizeMemberRole(role)
  const roleLabel = getOrganizationMemberRoleLabel(normalizedRole)

  if (!isTeamLeader || ADMIN_MEMBER_ROLES.has(normalizedRole)) return roleLabel
  if (normalizedRole === 'manager') return 'Gestor e líder de equipe'
  return 'Líder de equipe'
}

export function getOrganizationMemberBadgeLabel(
  role?: string | null,
  isTeamLeader = false,
) {
  const normalizedRole = normalizeMemberRole(role)

  if (ADMIN_MEMBER_ROLES.has(normalizedRole)) return 'ADM'
  if (normalizedRole === 'manager' && isTeamLeader) return 'GESTOR/LÍDER'
  if (normalizedRole === 'manager') return 'GESTOR'
  if (isTeamLeader) return 'LÍDER'
  return 'USER'
}

export function isAdministrativeOrganizationRole(role?: string | null) {
  return ADMIN_MEMBER_ROLES.has(normalizeMemberRole(role))
}

export function getUserFilterLabel(user: UserDisplayValue) {
  const displayName = user.name?.trim() || user.email?.trim() || 'Usuário'
  return user.is_active === false ? `${displayName} (Desativado)` : displayName
}
