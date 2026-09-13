'use client'

import { createBrowserClient } from '@supabase/ssr'
import {
  capturePasswordRecoveryIntent,
  grantPasswordRecoveryProof,
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

const guardedSupabaseFetch: typeof fetch = (input, init) => {
  const url = typeof input === 'string' || input instanceof URL ? String(input) : input.url
  const method = init?.method || (input instanceof Request ? input.method : 'GET')

  if (shouldBlockLocalMutation(method) && !isSupabaseAuthenticationRequest(url)) {
    return Promise.reject(new Error(LOCAL_READ_ONLY_ERROR_MESSAGE))
  }

  return fetch(input, init)
}

// The Supabase client consumes PKCE/hash parameters during initialization.
// Capture only the presence/type of recovery evidence before creating it; the
// tokens themselves are never persisted by this helper.
if (typeof window !== 'undefined') {
  capturePasswordRecoveryIntent(window.sessionStorage, new URL(window.location.href))
}

export const supabase = createBrowserClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  {
    global: {
      fetch: guardedSupabaseFetch,
    },
  },
)

// Kept as a compatibility API for hooks that used the former factory. Returning
// the singleton prevents duplicate auth listeners and realtime connections.
export const createClient = () => supabase

if (typeof window !== 'undefined') {
  supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'PASSWORD_RECOVERY' && session?.user.id) {
      grantPasswordRecoveryProof(window.sessionStorage, session.user.id)
    }
  })
}
