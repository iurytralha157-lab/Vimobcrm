export const LOCAL_READ_ONLY_ERROR_CODE = 'local_read_only'
export const LOCAL_READ_ONLY_ERROR_MESSAGE =
  'Este ambiente local usa dados reais somente para consulta. Alterações estão bloqueadas.'

export function isLocalReadOnlyMode(value = process.env.NEXT_PUBLIC_LOCAL_READ_ONLY) {
  return value?.trim().toLowerCase() === 'true'
}

export function shouldPersistOrganizationSelectionRemotely(
  readOnly = isLocalReadOnlyMode(),
) {
  return !readOnly
}

export function shouldBlockLocalMutation(
  method: string | undefined,
  readOnly = isLocalReadOnlyMode(),
) {
  if (!readOnly) return false

  const normalizedMethod = (method || 'GET').trim().toUpperCase()
  return !['GET', 'HEAD', 'OPTIONS'].includes(normalizedMethod)
}

export function isSupabaseAuthenticationRequest(url: string) {
  try {
    return new URL(url).pathname.startsWith('/auth/v1/')
  } catch {
    return false
  }
}
