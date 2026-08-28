type SupabaseServiceEnvironment = Readonly<Record<string, string | undefined>>

export function resolveSupabaseServiceKey(
  environment: SupabaseServiceEnvironment = process.env,
): string {
  const secretKey = environment.SUPABASE_SECRET_KEY?.trim()
  if (secretKey) return secretKey

  const legacyServiceRoleKey = environment.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (legacyServiceRoleKey) return legacyServiceRoleKey

  throw new Error('Missing SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY')
}

export function createSupabaseServiceFetch(
  apiKey: string,
  delegate: typeof fetch = fetch,
): typeof fetch {
  const opaqueSecret = apiKey.startsWith('sb_secret_')

  return async (input, init) => {
    const headers = new Headers(init?.headers)
    if (!headers.has('apikey')) {
      headers.set('apikey', apiKey)
    }

    if (opaqueSecret && headers.get('Authorization') === `Bearer ${apiKey}`) {
      headers.delete('Authorization')
    }

    return delegate(input, { ...init, headers })
  }
}
