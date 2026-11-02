'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { ROUTES } from '@/config/constants'
import { supabase } from '@/lib/supabase/client'
import { setVimobAPIAccessToken } from '@/lib/api/vimob-client'
import {
  captureGlobalSignOutGuard, getGlobalSignOutSessionKey, trackGlobalSignOutSession,
  type GlobalSignOutLifecycle,
} from '@/lib/auth/global-sign-out'
import { exitPasswordRecovery, type PasswordRecoveryGuard } from '@/lib/auth/password-recovery-exit'
import {
  capturePasswordRecoveryIntent, clearPasswordRecoveryEvidence, getPasswordRecoveryStorage,
  grantPasswordRecoveryProof, hasPasswordRecoveryProof, isPasswordRecoveryAccessToken,
  readPasswordRecoveryUrlEvidence,
} from '@/lib/auth/password-recovery'

export type RecoveryState = 'checking' | 'ready' | 'invalid' | 'incomplete' | 'success'

function cleanRecoveryUrl() { window.history.replaceState({}, '', ROUTES.RESET_PASSWORD) }
const invalidLinkMessage = 'Este link de recuperação expirou ou não é válido. Solicite um novo link para redefinir sua senha.'
const changedSessionMessage = 'A sessão de recuperação mudou. Solicite um novo link para proteger sua conta.'

/** Owns this page's effects; does not start cleanup after observing a replacement. */
export function usePasswordRecoverySession(searchParams: { get: (key: string) => string | null }) {
  const [recoveryState, setRecoveryState] = useState<RecoveryState>('checking')
  const [validationMessage, setValidationMessage] = useState<string | null>(null)
  const [recoveryIdentity, setRecoveryIdentity] = useState<string | null>(null)
  const recoverySessionRef = useRef<Session | null>(null)
  const recoveryGuardRef = useRef<PasswordRecoveryGuard | null>(null)
  const visitRef = useRef(0)
  const closingRef = useRef(false)
  const lifecycleRef = useRef<GlobalSignOutLifecycle>({
    mounted: false, generation: 0, sessionKey: null, userId: null, pendingPush: new Set(),
  })

  useLayoutEffect(() => {
    const lifecycle = lifecycleRef.current
    lifecycle.mounted = true
    return () => {
      lifecycle.mounted = false
      lifecycle.generation += 1
      visitRef.current += 1
      lifecycle.pendingPush?.forEach(controller => controller.abort())
      lifecycle.pendingPush?.clear()
    }
  }, [])

  const captureGuard = useCallback((): PasswordRecoveryGuard | null => {
    if (recoveryGuardRef.current) return recoveryGuardRef.current
    const session = recoverySessionRef.current
    if (!session) return null
    const visit = visitRef.current
    const guard = captureGlobalSignOutGuard(session, session.user.id, lifecycleRef.current)
    recoveryGuardRef.current = { ...guard, isCurrent: () => visit === visitRef.current && guard.isCurrent() }
    return recoveryGuardRef.current
  }, [])

  const captureRequest = useCallback((guard: PasswordRecoveryGuard) => {
    const controller = new AbortController()
    closingRef.current = true
    lifecycleRef.current.pendingPush?.add(controller)
    if (!guard.isCurrent()) controller.abort()
    return { signal: controller.signal, finish: () => {
      lifecycleRef.current.pendingPush?.delete(controller)
      if (guard.isCurrent()) closingRef.current = false
    } }
  }, [])

  const exitTo = useCallback(async (destination: string, guard: PasswordRecoveryGuard, revokeGlobal = false, messageWaitMs = 0) => {
    if (!guard.isCurrent()) return
    closingRef.current = true
    try {
      const result = await exitPasswordRecovery({
        guard, destination, revokeGlobal, messageWaitMs,
        operations: {
          getSession: () => supabase.auth.getSession(),
          revokeGlobal: token => supabase.auth.admin.signOut(token, 'global'),
          clearLocal: () => supabase.auth.signOut({ scope: 'local' }),
        },
        effects: {
          clear: () => {
            const storage = getPasswordRecoveryStorage()
            if (storage) clearPasswordRecoveryEvidence(storage)
            setVimobAPIAccessToken(null, null)
            cleanRecoveryUrl()
          },
          navigate: destination => window.location.replace(destination),
          wait: milliseconds => new Promise<void>(resolve => window.setTimeout(resolve, milliseconds)),
        },
      })
      if (result === 'incomplete' && guard.isCurrent()) {
        setRecoveryState('incomplete')
        setValidationMessage('Não foi possível encerrar a sessão de recuperação. Verifique sua conexão e tente voltar ao login novamente.')
      }
    } finally { if (guard.isCurrent()) closingRef.current = false }
  }, [])

  const leavePasswordRecovery = useCallback(async (destination: string) => {
    const guard = captureGuard()
    if (guard) { await exitTo(destination, guard); return }
    // An invalid link has no recovery identity to revoke. Navigation must not
    // clear a normal session that happens to be open in this browser.
    const visit = visitRef.current, generation = lifecycleRef.current.generation
    if (lifecycleRef.current.mounted && visit === visitRef.current && generation === lifecycleRef.current.generation) {
      window.location.replace(destination)
    }
  }, [captureGuard, exitTo])

  const finishPasswordRecovery = useCallback((outcome: 'success' | 'unverified', guard: PasswordRecoveryGuard) =>
    exitTo(`${ROUTES.LOGIN}?passwordReset=${outcome}`, guard, outcome === 'unverified', 1_600), [exitTo])

  useEffect(() => {
    let mounted = true
    const lifecycle = lifecycleRef.current
    const visit = ++visitRef.current
    recoveryGuardRef.current = null
    closingRef.current = false
    const current = () => mounted && lifecycleRef.current.mounted && visitRef.current === visit
    if (readPasswordRecoveryUrlEvidence(new URL(window.location.href)).kind !== 'none') {
      recoverySessionRef.current = null
      recoveryGuardRef.current = null
    }
    let candidateKey = getGlobalSignOutSessionKey(recoverySessionRef.current)
    let establishing = true
    const timers = new Set<number>()
    const invalid = (message: string, invalidateVisit = false) => {
      if (!current()) return
      recoverySessionRef.current = null
      recoveryGuardRef.current = null
      setRecoveryIdentity(null)
      setRecoveryState('invalid')
      setValidationMessage(message)
      if (invalidateVisit) visitRef.current += 1
    }
    const authorize = async (session: Session, requireRecordedProof = false) => {
      if (!current()) return false
      const key = getGlobalSignOutSessionKey(session)
      if (!isPasswordRecoveryAccessToken(session.access_token) || (candidateKey && candidateKey !== key)) return false
      const fresh = await supabase.auth.getSession()
      if (!current() || fresh.error || getGlobalSignOutSessionKey(fresh.data.session) !== key) return false
      const storage = getPasswordRecoveryStorage()
      if (requireRecordedProof && (!storage || !hasPasswordRecoveryProof(storage, session.user.id))) return false
      // These effects must follow both the visit check and the fresh SDK check.
      if (!current()) return false
      if (storage) grantPasswordRecoveryProof(storage, session.user.id)
      cleanRecoveryUrl()
      candidateKey = key
      trackGlobalSignOutSession(lifecycleRef.current, fresh.data.session)
      recoverySessionRef.current = fresh.data.session
      recoveryGuardRef.current = null
      captureGuard()
      setRecoveryIdentity(key)
      setRecoveryState('ready')
      setValidationMessage(null)
      return true
    }
    const recordedRecovery = async () => {
      const { data, error } = await supabase.auth.getSession()
      if (!current() || error || !data.session) return false
      // URL sanitization can rerun this effect in the same mounted page. Its
      // already-verified identity remains valid even when browser storage is denied.
      const verifiedHere = recoverySessionRef.current &&
        getGlobalSignOutSessionKey(recoverySessionRef.current) === getGlobalSignOutSessionKey(data.session)
      return authorize(data.session, !verifiedHere)
    }
    const establish = async () => {
      if (!current()) return
      setRecoveryState('checking')
      setValidationMessage(null)
      if (searchParams.get('cancel') === '1') {
        const { data } = await supabase.auth.getSession()
        if (!current()) return
        if (data.session && isPasswordRecoveryAccessToken(data.session.access_token)) {
          trackGlobalSignOutSession(lifecycleRef.current, data.session)
          recoverySessionRef.current = data.session
          const guard = captureGuard()
          if (guard) await exitTo(searchParams.get('next') === ROUTES.SIGNUP ? ROUTES.SIGNUP : ROUTES.LOGIN, guard)
        } else window.location.replace(ROUTES.LOGIN)
        return
      }
      const url = new URL(window.location.href)
      const evidence = readPasswordRecoveryUrlEvidence(url)
      const storage = getPasswordRecoveryStorage()
      if (storage) capturePasswordRecoveryIntent(storage, url)
      const hash = new URLSearchParams(url.hash.replace(/^#/, ''))
      if (hash.has('error') || hash.has('error_description')) {
        if (!current()) return
        if (storage) clearPasswordRecoveryEvidence(storage)
        cleanRecoveryUrl()
        invalid(invalidLinkMessage)
        return
      }
      try {
        let session: Session | null = null
        if (evidence.kind === 'pkce') {
          const { data, error } = await supabase.auth.exchangeCodeForSession(evidence.code)
          if (!current()) return
          if (error || !('redirectType' in data) || data.redirectType !== 'recovery') throw error || new Error('invalid_recovery')
          session = data.session
        } else if (evidence.kind === 'token_hash') {
          const { data, error } = await supabase.auth.verifyOtp({ token_hash: evidence.tokenHash, type: 'recovery' })
          if (!current()) return
          if (error) throw error
          session = data.session
        } else if (evidence.kind === 'implicit') {
          const { data, error } = await supabase.auth.setSession({ access_token: evidence.accessToken, refresh_token: evidence.refreshToken })
          if (!current()) return
          if (error) throw error
          session = data.session
        }
        if (!current()) return
        if (session && await authorize(session)) return
        if (!current()) return
        if (await recordedRecovery()) return
        if (current()) invalid(invalidLinkMessage)
      } catch {
        if (!current()) return
        if (await recordedRecovery().catch(() => false)) return
        if (!current()) return
        if (storage) clearPasswordRecoveryEvidence(storage)
        cleanRecoveryUrl()
        invalid(invalidLinkMessage)
      } finally { if (current()) establishing = false }
    }
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!current()) return
      const key = getGlobalSignOutSessionKey(session)
      trackGlobalSignOutSession(lifecycleRef.current, session)
      if (event === 'INITIAL_SESSION') return
      if (event === 'SIGNED_OUT') {
        if (!closingRef.current) invalid(changedSessionMessage, true)
        return
      }
      if (!session) return
      if (!isPasswordRecoveryAccessToken(session.access_token) || (candidateKey && candidateKey !== key)) {
        invalid(changedSessionMessage, true)
        return
      }
      candidateKey = key
      if (event === 'TOKEN_REFRESHED' && recoverySessionRef.current) recoverySessionRef.current = session
      if (event === 'PASSWORD_RECOVERY' && !establishing) {
        const timer = window.setTimeout(() => {
          timers.delete(timer)
          if (current()) void authorize(session, true).catch(() => {
            if (current()) invalid(invalidLinkMessage)
          })
        }, 0)
        timers.add(timer)
      }
    })
    void establish().catch(() => {
      if (current()) invalid(invalidLinkMessage)
    })
    return () => {
      mounted = false
      visitRef.current += 1
      lifecycle.pendingPush?.forEach(controller => controller.abort())
      lifecycle.pendingPush?.clear()
      timers.forEach(timer => window.clearTimeout(timer))
      subscription.unsubscribe()
    }
  }, [searchParams, captureGuard, exitTo])

  return { recoveryState, setRecoveryState, validationMessage, setValidationMessage,
    recoveryIdentity, recoverySessionRef,
    captureGuard, captureRequest, leavePasswordRecovery, finishPasswordRecovery }
}
