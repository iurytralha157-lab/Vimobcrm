const MAX_ENCODED_CONFIRMATION_URL_LENGTH = 16_384
const ALLOWED_VERIFY_QUERY_KEYS = new Set(['redirect_to', 'token', 'type'])

function decodeBase64URL(value: string) {
  if (
    value.length === 0
    || value.length > MAX_ENCODED_CONFIRMATION_URL_LENGTH
    || !/^[A-Za-z0-9_-]+$/.test(value)
  ) {
    return null
  }

  try {
    const standard = value.replace(/-/g, '+').replace(/_/g, '/')
    const padded = standard.padEnd(Math.ceil(standard.length / 4) * 4, '=')
    const bytes = Uint8Array.from(globalThis.atob(padded), (character) => character.charCodeAt(0))
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return null
  }
}

export function getValidatedEmailConfirmationURL(
  hash: string,
  supabaseURL: string,
  appOrigin: string,
) {
  try {
    const fragment = hash.startsWith('#') ? hash.slice(1) : hash
    const fragmentParams = new URLSearchParams(fragment)
    const encodedValues = fragmentParams.getAll('confirmation_url')
    if (encodedValues.length !== 1 || [...fragmentParams.keys()].some((key) => key !== 'confirmation_url')) {
      return null
    }

    const decoded = decodeBase64URL(encodedValues[0])
    if (!decoded || decoded !== decoded.trim() || /[\u0000-\u001F\u007F]/.test(decoded)) {
      return null
    }

    const action = new URL(decoded)
    const project = new URL(supabaseURL)
    const application = new URL(appOrigin)
    const expectedVerifyPath = `${project.pathname.replace(/\/$/, '')}/auth/v1/verify`
    const expectedRedirect = new URL('/login?emailConfirmation=success', application.origin).toString()

    if (
      action.username
      || action.password
      || action.hash
      || action.origin !== project.origin
      || action.pathname !== expectedVerifyPath
    ) {
      return null
    }

    const actionKeys = [...action.searchParams.keys()]
    if (
      actionKeys.some((key) => !ALLOWED_VERIFY_QUERY_KEYS.has(key))
      || action.searchParams.getAll('type').length !== 1
      || action.searchParams.getAll('token').length !== 1
      || action.searchParams.getAll('redirect_to').length !== 1
      || action.searchParams.get('type') !== 'signup'
      || action.searchParams.get('redirect_to') !== expectedRedirect
    ) {
      return null
    }

    const token = action.searchParams.get('token') || ''
    if (token.length < 16 || token.length > 4_096 || !/^[A-Za-z0-9_-]+$/.test(token)) {
      return null
    }

    return action.toString()
  } catch {
    return null
  }
}
