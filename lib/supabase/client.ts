'use client'

import { createBrowserClient } from '@supabase/ssr'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { createPasswordRecoveryTransport } from '@/lib/auth/password-recovery-transport'
import {
  capturePasswordRecoveryIntent,
  getPasswordRecoveryStorage,
  grantPasswordRecoveryProof,
  isPasswordRecoveryPath,
  readPasswordRecoveryFragmentIdentity,
  readPasswordRecoveryUrlEvidence,
  type PasswordRecoveryFragment,
} from '@/lib/auth/password-recovery'
import type { Database } from './types'
import {
  LOCAL_READ_ONLY_ERROR_MESSAGE,
  isSupabaseAuthenticationRequest,
  shouldBlockLocalMutation,
} from '@/lib/local-read-only'

if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
  throw new Error('Missing env.NEXT_PUBLIC_SUPABASE_URL')
}

if (!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
  throw new Error('Missing env.NEXT_PUBLIC_SUPABASE_ANON_KEY')
}

const recoveryTransport = createPasswordRecoveryTransport(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  (input, init) => fetch(input, init),
)

const guardedSupabaseFetch: typeof fetch = (input, init) => {
  const url = typeof input === 'string' || input instanceof URL ? String(input) : input.url
  const method = init?.method || (input instanceof Request ? input.method : 'GET')

  if (shouldBlockLocalMutation(method) && !isSupabaseAuthenticationRequest(url)) {
    return Promise.reject(new Error(LOCAL_READ_ONLY_ERROR_MESSAGE))
  }

  return recoveryTransport(input, init)
}

// The Supabase client consumes PKCE/hash parameters during initialization.
// Capture only the presence/type of recovery evidence before creating it; the
// tokens themselves are never persisted by this helper.
const browserUrl = typeof window === 'undefined' ? null : new URL(window.location.href)
if (browserUrl) {
  const storage = getPasswordRecoveryStorage()
  if (storage) capturePasswordRecoveryIntent(storage, browserUrl)
}

export const supabase = createBrowserClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  {
    auth: {
      detectSessionInUrl: Boolean(browserUrl && (!isPasswordRecoveryPath(browserUrl.pathname)
        || readPasswordRecoveryUrlEvidence(browserUrl).kind === 'pkce')),
    },
    global: {
      fetch: guardedSupabaseFetch,
    },
  },
)

// Kept as a compatibility API for hooks that used the former factory. Returning
// the singleton prevents duplicate auth listeners and realtime connections.
export const createClient = () => supabase

// Administrative recovery links are issued without a PKCE verifier. Validate
// both credentials in memory before the shared browser client can see either.
export async function preparePasswordRecoveryFragment(fragment: PasswordRecoveryFragment) {
  const original = readPasswordRecoveryFragmentIdentity(fragment.accessToken)
  if (!original) return null

  const { auth } = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
        storageKey: 'vimob-password-recovery-verification:' + crypto.randomUUID(),
      },
      global: { fetch: guardedSupabaseFetch },
    },
  )
  try {
    const verified = await auth.getUser(fragment.accessToken)
    if (verified.error || verified.data.user?.id !== original.userId) return null

    const { data, error } = await auth.refreshSession({ refresh_token: fragment.refreshToken })
    if (error || data.session?.user.id !== original.userId || !data.session.refresh_token) return null

    const renewed = readPasswordRecoveryFragmentIdentity(data.session.access_token)
    if (renewed?.userId !== original.userId || renewed.sessionId !== original.sessionId) return null
    return { access_token: data.session.access_token, refresh_token: data.session.refresh_token }
  } finally {
    await auth.dispose()
  }
}

if (typeof window !== 'undefined') {
  supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'PASSWORD_RECOVERY' && session?.user.id) {
      const storage = getPasswordRecoveryStorage()
      if (storage) grantPasswordRecoveryProof(storage, session.user.id)
    }
  })
}
