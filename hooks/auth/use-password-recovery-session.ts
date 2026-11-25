'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { ROUTES } from '@/config/constants'
import { installPasswordRecoverySession, preparePasswordRecoverySession, supabase } from '@/lib/supabase/client'
import { setVimobAPIAccessToken } from '@/lib/api/vimob-client'
import {
  captureGlobalSignOutGuard, getGlobalSignOutSessionKey, trackGlobalSignOutSession,
  type GlobalSignOutLifecycle,
} from '@/lib/auth/global-sign-out'
import { exitPasswordRecovery, type PasswordRecoveryGuard } from '@/lib/auth/password-recovery-exit'
import {
  capturePasswordRecoveryIntent, clearPasswordRecoveryEvidence, getPasswordRecoveryStorage,
  grantPasswordRecoveryProof, hasPasswordRecoveryProof, isPasswordRecoveryAccessToken,
  readPasswordRecoverySessionIdentity, readPasswordRecoveryUrlEvidence,
} from '@/lib/auth/password-recovery'

export type RecoveryState = 'checking' | 'ready' | 'invalid' | 'incomplete' | 'success'

function cleanRecoveryUrl() { window.history.replaceState({}, '', ROUTES.RESET_PASSWORD) }
const invalidLinkMessage = 'Cada link só pode ser usado uma vez. Se o formulário já abriu, volte àquela aba. Solicite um novo link se precisar recomeçar e abra o e-mail mais recente no navegador em que fez o pedido.'
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
    // This explicit click may exit an unproven recovery, but cannot authorize a
    // password change or take ownership of a replacement observed after it.
    const lifecycle = lifecycleRef.current
    const visit = visitRef.current, generation = lifecycle.generation, key = lifecycle.sessionKey
    const current = () => lifecycle.mounted && visit === visitRef.current
      && generation === lifecycle.generation && key === lifecycle.sessionKey
    let session: Session | null
    try {
      const { data, error } = await supabase.auth.getSession()
      if (!current()) return
      if (error) throw error
      if (getGlobalSignOutSessionKey(data.session) !== key) return
      session = data.session
    } catch {
      if (current()) setValidationMessage('Não foi possível conferir a sessão. Tente voltar ao login novamente.')
      return
    }
    if (session && isPasswordRecoveryAccessToken(session.access_token)) {
      const exitGuard = captureGlobalSignOutGuard(session, session.user.id, lifecycle)
      await exitTo(destination, { ...exitGuard,
        isCurrent: () => visit === visitRef.current && exitGuard.isCurrent(),
      })
      return
    }
    if (current()) window.location.replace(destination)
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
    const url = new URL(window.location.href)
    const currentUrl = () => current() && window.location.href === url.href
    const evidence = readPasswordRecoveryUrlEvidence(url)
    let awaitingInitialSession = evidence.kind !== 'none'
    let baselineKey: string | null = null
    if (evidence.kind !== 'none') {
      recoverySessionRef.current = null
    }
    let candidateKey = getGlobalSignOutSessionKey(recoverySessionRef.current)
    const invalid = (message: string, invalidateVisit = false) => {
      if (!current()) return
      recoverySessionRef.current = null
      recoveryGuardRef.current = null
      setRecoveryIdentity(null)
      setRecoveryState('invalid')
      setValidationMessage(message)
      if (invalidateVisit) visitRef.current += 1
    }
    const authorize = async (session: Session, requireRecordedProof: boolean) => {
      if (!currentUrl()) return false
      const key = getGlobalSignOutSessionKey(session)
      const identity = readPasswordRecoverySessionIdentity(session.access_token)
      if (!identity || session.user.id !== identity.userId || (candidateKey && candidateKey !== key)) return false
      const fresh = await supabase.auth.getSession()
      if (!currentUrl() || fresh.error || getGlobalSignOutSessionKey(fresh.data.session) !== key) return false
      const storage = getPasswordRecoveryStorage()
      if (requireRecordedProof && (!storage || !hasPasswordRecoveryProof(storage, identity))) return false
      if (storage) grantPasswordRecoveryProof(storage, identity)
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
      const storage = getPasswordRecoveryStorage()
      if (storage) capturePasswordRecoveryIntent(storage, url)
      const hash = new URLSearchParams(url.hash.replace(/^#/, ''))
      const providerError = [url.searchParams, hash].some(params =>
        ['error', 'error_code', 'error_description'].some(key => params.has(key)))
      const malformedLink = evidence.kind === 'none' && [url.searchParams, hash].some(params =>
        ['code', 'token_hash', 'access_token', 'refresh_token'].some(key => params.has(key)))
      try {
        if (providerError || malformedLink) throw new Error('invalid_recovery')
        if (evidence.kind === 'none') {
          if (!await recordedRecovery() && currentUrl()) invalid(invalidLinkMessage)
          return
        }

        const initial = await supabase.auth.getSession()
        if (!currentUrl()) return
        baselineKey = getGlobalSignOutSessionKey(initial.data.session)
        if (initial.error || (lifecycle.sessionKey !== null && lifecycle.sessionKey !== baselineKey)) {
          throw new Error('invalid_recovery')
        }
        trackGlobalSignOutSession(lifecycle, initial.data.session)
        awaitingInitialSession = false
        const generation = lifecycle.generation
        const verified = await preparePasswordRecoverySession(evidence, initial.data.session?.user.id)
        if (!currentUrl()) return
        if (!verified) throw new Error('invalid_recovery')

        const latest = await supabase.auth.getSession()
        if (!currentUrl()) return
        if (latest.error || lifecycle.generation !== generation
          || getGlobalSignOutSessionKey(latest.data.session) !== baselineKey) throw new Error('invalid_recovery')

        candidateKey = getGlobalSignOutSessionKey(verified.session)
        const session = await installPasswordRecoverySession(verified, () =>
          currentUrl() && lifecycle.generation === generation)
        if (!currentUrl()) return
        if (!session || !await authorize(session, false)) throw new Error('invalid_recovery')
      } catch {
        if (!currentUrl()) return
        if (storage) clearPasswordRecoveryEvidence(storage)
        if (evidence.kind !== 'none' || providerError || malformedLink) cleanRecoveryUrl()
        invalid(invalidLinkMessage)
      }
    }
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      // A closed validation visit must still observe replacements while this
      // effect is mounted, so an explicit exit cannot act on a later identity.
      if (!mounted || !lifecycleRef.current.mounted) return
      const key = getGlobalSignOutSessionKey(session)
      trackGlobalSignOutSession(lifecycleRef.current, session)
      if (!current()) return
      if (event === 'INITIAL_SESSION') return
      if (event === 'SIGNED_OUT') {
        if (!closingRef.current) invalid(changedSessionMessage, true)
        return
      }
      if (!session) return
      // SDK startup and refresh can announce the unchanged cookie during a
      // private exchange. Another session must invalidate that exchange.
      if (evidence.kind !== 'none' && !candidateKey) {
        if (!awaitingInitialSession && key !== baselineKey) invalid(changedSessionMessage, true)
        return
      }
      if (!isPasswordRecoveryAccessToken(session.access_token) || (candidateKey && candidateKey !== key)) {
        invalid(changedSessionMessage, true)
        return
      }
      candidateKey = key
      if (event === 'TOKEN_REFRESHED' && recoverySessionRef.current) recoverySessionRef.current = session
    })
    void establish().catch(() => {
      if (current()) invalid(invalidLinkMessage)
    })
    return () => {
      mounted = false
      visitRef.current += 1
      lifecycle.pendingPush?.forEach(controller => controller.abort())
      lifecycle.pendingPush?.clear()
      subscription.unsubscribe()
    }
  }, [searchParams, captureGuard, exitTo])

  return { recoveryState, setRecoveryState, validationMessage, setValidationMessage,
    recoveryIdentity, recoverySessionRef,
    captureGuard, captureRequest, leavePasswordRecovery, finishPasswordRecovery }
}
