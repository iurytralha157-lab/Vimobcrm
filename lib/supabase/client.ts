'use client'

import { createBrowserClient, isChunkLike, parseCookieHeader, serializeCookieHeader } from '@supabase/ssr'
import type { Session } from '@supabase/supabase-js'
import { createPasswordRecoveryTransport } from '@/lib/auth/password-recovery-transport'
import {
  isPasswordRecoveryPath,
  readPasswordRecoverySessionIdentity,
  type PasswordRecoveryUrlEvidence,
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

const pendingRecoveryPromotions = new Map<string, () => boolean>()
const authUserEndpoint = new URL('auth/v1/user', process.env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/?$/, '/')).href

async function checkRecoveryPromotion(response: Promise<Response>, isCurrent: () => boolean) {
  const result = await response
  return isCurrent() ? result : Response.json({ message: 'Password recovery session changed.' }, { status: 409 })
}

const guardedSupabaseFetch: typeof fetch = (input, init) => {
  const url = typeof input === 'string' || input instanceof URL ? String(input) : input.url
  const method = init?.method || (input instanceof Request ? input.method : 'GET')

  if (shouldBlockLocalMutation(method) && !isSupabaseAuthenticationRequest(url)) {
    return Promise.reject(new Error(LOCAL_READ_ONLY_ERROR_MESSAGE))
  }

  const response = recoveryTransport(input, init)
  if (pendingRecoveryPromotions.size && url === authUserEndpoint && method === 'GET') {
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
    const isCurrent = pendingRecoveryPromotions.get(headers.get('authorization') ?? '')
    if (isCurrent) return checkRecoveryPromotion(response, isCurrent)
  }
  return response
}

const authCookieName = `sb-${new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname.split('.')[0]}-auth-token`
const recoveryCookieName = `${authCookieName}-recovery`
const verifierSuffix = '-code-verifier'
const recoveryVerifierCookieName = recoveryCookieName + verifierSuffix
const detectSessionInUrl = typeof window !== 'undefined'
  && !isPasswordRecoveryPath(new URL(window.location.href).pathname)

export const supabase = createBrowserClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  {
    // The recovery hook validates its link before the SDK can write a cookie.
    auth: { detectSessionInUrl },
    cookieOptions: { name: authCookieName },
    global: {
      fetch: guardedSupabaseFetch,
    },
  },
)

// Kept as a compatibility API for hooks that used the former factory. Returning
// the singleton prevents duplicate auth listeners and realtime connections.
export const createClient = () => supabase

export async function requestPasswordRecovery(email: string, redirectTo: string) {
  // A normal sign-in or token refresh clears the SDK's shared PKCE verifier.
  const { auth } = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      isSingleton: false,
      auth: { autoRefreshToken: false, detectSessionInUrl: false },
      cookieOptions: { name: recoveryCookieName },
      global: { fetch: guardedSupabaseFetch },
    },
  )
  try {
    return await auth.resetPasswordForEmail(email, { redirectTo })
  } finally {
    await auth.dispose()
  }
}

function readCookies(key: string) {
  return parseCookieHeader(document.cookie).filter(({ name }) => isChunkLike(name, key))
}

type PreparedPasswordRecovery = {
  session: Session
  verifierIsCurrent: () => boolean
  clearVerifier: () => void
}

export async function installPasswordRecoverySession(
  recovery: PreparedPasswordRecovery,
  isCurrent: () => boolean,
) {
  const { session, verifierIsCurrent } = recovery
  const authorization = `Bearer ${session.access_token}`
  if (!isCurrent() || !verifierIsCurrent() || pendingRecoveryPromotions.has(authorization)) return null

  // setSession looks up the user before writing. Discard that response when
  // a visible session change occurs during the request.
  const snapshot = JSON.stringify(readCookies(authCookieName))
  pendingRecoveryPromotions.set(authorization, () => isCurrent() && verifierIsCurrent()
    && JSON.stringify(readCookies(authCookieName)) === snapshot)
  try {
    const { data, error } = await supabase.auth.setSession(session)
    if (!error && data.session) recovery.clearVerifier()
    return error ? null : data.session
  } finally {
    pendingRecoveryPromotions.delete(authorization)
  }
}

export async function preparePasswordRecoverySession(
  evidence: Exclude<PasswordRecoveryUrlEvidence, { kind: 'none' }>,
  currentUserId: string | undefined,
): Promise<PreparedPasswordRecovery | null> {
  const fragmentIdentity = evidence.kind === 'implicit'
    ? readPasswordRecoverySessionIdentity(evidence.accessToken)
    : null
  if (evidence.kind === 'implicit' && (!fragmentIdentity || (currentUserId && currentUserId !== fragmentIdentity.userId))) return null

  const privateCookieName = `vimob-recovery-${crypto.randomUUID()}`
  const cookies = new Map<string, string>()
  const recentVerifier = readCookies(recoveryVerifierCookieName)
  // Links already sent still use the old shared cookie until a new request is made.
  const sourceCookieName = recentVerifier.length ? recoveryCookieName : authCookieName
  const verifierCookieName = sourceCookieName + verifierSuffix
  const verifierCookies = recentVerifier.length ? recentVerifier : readCookies(verifierCookieName)
  const verifierSnapshot = JSON.stringify(verifierCookies)
  if (evidence.kind === 'pkce') {
    for (const { name, value } of verifierCookies) {
      if (value) cookies.set(privateCookieName + name.slice(sourceCookieName.length), value)
    }
  }
  const verifierIsCurrent = () => JSON.stringify(readCookies(verifierCookieName)) === verifierSnapshot
    && (sourceCookieName === recoveryCookieName || !readCookies(recoveryVerifierCookieName).length)
  // The SDK may save a session even when the response has ordinary login AMR.
  // This adapter keeps all those writes in memory under a private namespace.
  const { auth } = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      isSingleton: false,
      auth: { autoRefreshToken: false, detectSessionInUrl: false },
      cookieOptions: { name: privateCookieName },
      cookies: {
        getAll: () => Array.from(cookies, ([name, value]) => ({ name, value })),
        setAll: entries => {
          for (const { name, value } of entries) {
            if (value) cookies.set(name, value)
            else cookies.delete(name)
          }
        },
      },
      global: { fetch: guardedSupabaseFetch },
    },
  )
  try {
    const exchange = async () => {
      if (evidence.kind === 'pkce') {
        const result = await auth.exchangeCodeForSession(evidence.code)
        return 'redirectType' in result.data && result.data.redirectType === 'recovery' ? result : null
      }
      if (evidence.kind === 'token_hash') {
        return auth.verifyOtp({ type: 'recovery', token_hash: evidence.tokenHash })
      }
      const original = await auth.getUser(evidence.accessToken)
      if (original.error || original.data.user?.id !== fragmentIdentity?.userId) return null
      return auth.refreshSession({ refresh_token: evidence.refreshToken })
    }
    const result = await exchange()
    const session = result?.data.session
    if (result?.error || !session?.refresh_token) return null

    const identity = readPasswordRecoverySessionIdentity(session.access_token)
    if (!identity || session.user.id !== identity.userId || (currentUserId && currentUserId !== identity.userId)
      || (fragmentIdentity && (fragmentIdentity.userId !== identity.userId || fragmentIdentity.sessionId !== identity.sessionId))) return null

    return {
      session,
      verifierIsCurrent,
      clearVerifier: () => {
        if (evidence.kind !== 'pkce' || sourceCookieName !== recoveryCookieName || !verifierIsCurrent()) return
        for (const { name } of verifierCookies) {
          document.cookie = serializeCookieHeader(name, '', { path: '/', maxAge: 0 })
        }
      },
    }
  } finally {
    await auth.dispose()
    cookies.clear()
  }
}
