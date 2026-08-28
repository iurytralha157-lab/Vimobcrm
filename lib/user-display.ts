type UserDisplayValue = {
  name?: string | null
  email?: string | null
  is_active?: boolean | null
}

export function getUserFilterLabel(user: UserDisplayValue) {
  const displayName = user.name?.trim() || user.email?.trim() || 'Usuário'
  return user.is_active === false ? `${displayName} (Desativado)` : displayName
}
