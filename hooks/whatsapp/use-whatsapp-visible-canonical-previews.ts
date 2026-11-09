'use client'

import { useCallback, useLayoutEffect, useMemo, useRef, useState, type RefCallback } from 'react'
import { whatsappAPI } from '@/lib/api/whatsapp'
import type { WhatsAppConversation } from '@/hooks/use-whatsapp-conversations'
import { WHATSAPP_MESSAGES_RECONCILE_EVENT, type WhatsAppQueryScope, type WhatsAppMessagesReconcileEventDetail } from '@/lib/whatsapp-query-cache'
import { captureWhatsAppCanonicalConversationPreview, projectWhatsAppCanonicalConversationPreview, type WhatsAppCanonicalConversationPreview } from '@/lib/whatsapp-canonical-conversation-preview'
import { isWhatsAppAccessUnavailable } from '@/lib/whatsapp-access-revocation'

const MAX_READS = 4
const MAX_WAITERS = 16
const MIN_REFRESH_GAP_MS = 300
const SNAPSHOT_REVALIDATE_MS = 30_000
const MAX_SNAPSHOTS = 128
const TEMPORARY_HTTP_CODES = new Set(['api_error', 'internal_error', 'internal_server_error',
  'service_unavailable', 'upstream_error', 'bad_gateway', 'gateway_timeout'])
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const uuid = (value: string | null | undefined) => value && UUID.test(value)
  && value !== '00000000-0000-0000-0000-000000000000' ? value.toLowerCase() : null

function isLocalPreviewHostname(hostname: string) {
  if (['localhost', '127.0.0.1', '::1', '[::1]'].includes(hostname)) return true
  const octets = hostname.split('.').map(Number)
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)
    || octets.some(value => value < 0 || value > 255)) return false
  return octets[0] === 10 || octets[0] === 192 && octets[1] === 168
    || octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31
}

// This limiter shares only leases, never identities, message data or previews.
let leasedReads = 0
const readWaiters: Array<{ signal: AbortSignal; start: () => void }> = []
function drainReadSlots() {
  while (leasedReads < MAX_READS && readWaiters.length) {
    const waiter = readWaiters.shift()!
    if (!waiter.signal.aborted) waiter.start()
  }
}
function acquireReadSlot(signal: AbortSignal): Promise<() => void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted || readWaiters.length >= MAX_WAITERS) {
      reject(new DOMException('Read unavailable', 'AbortError')); return
    }
    const abort = () => {
      const position = readWaiters.indexOf(waiter)
      if (position >= 0) readWaiters.splice(position, 1)
      reject(new DOMException('Read cancelled', 'AbortError'))
    }
    const waiter = { signal, start: () => {
      signal.removeEventListener('abort', abort)
      leasedReads++
      let released = false
      resolve(() => {
        if (released) return
        released = true; leasedReads--; drainReadSlots()
      })
    } }
    signal.addEventListener('abort', abort, { once: true })
    readWaiters.push(waiter); drainReadSlots()
  })
}

type Target = { card: WhatsAppConversation; binding: string; leadId: string; sessionId: string }
type Request = { controller: AbortController; binding: string; dirtyToken: object | undefined }
type Snapshot = { preview: WhatsAppCanonicalConversationPreview; refreshedAt: number }
type PreviewCache = {
  owner: object; targets: Map<string, Target>; entries: Map<string, Snapshot>
  lastStarted: Map<string, number>; dirty: Map<string, object>; blocked: boolean
}
type Runtime = {
  owner: object; live: boolean; visible: Set<string>
  requests: Map<string, Request>; pending: Set<string>
  observer: IntersectionObserver; timer: ReturnType<typeof setTimeout> | null
  drain: () => void; refresh: (ids?: readonly string[]) => void; pause: (id: string) => void
}

/** Loopback/LAN development compatibility for visible legacy cards; never a production N+1 path. */
export function useWhatsAppVisibleCanonicalPreviews({ conversations, scope, listRevision, enabled, sourceKey, pausedConversationId }: {
  conversations: readonly WhatsAppConversation[]
  scope: WhatsAppQueryScope
  listRevision: number
  enabled: boolean
  sourceKey: string
  pausedConversationId?: string | null
}) {
  const localDevelopment = process.env.NODE_ENV === 'development' && typeof window !== 'undefined'
    && isLocalPreviewHostname(window.location.hostname)
  const targets = useMemo(() => {
    const result = new Map<string, Target>()
    for (const card of conversations) {
      const id = uuid(card.id), sessionId = uuid(card.session_id), leadId = uuid(card.lead_id || card.lead?.id)
      if (!id || !sessionId || !leadId || card.is_group || card.historical_lead_view || card.supervisory_lead_view
        || ('platform' in card && card.platform)
        || Object.hasOwn(card, 'last_message_from_me') || Object.hasOwn(card, 'last_message_status')
        || (card.lead_id && card.lead?.id && uuid(card.lead_id) !== uuid(card.lead.id))) continue
      result.set(id, { card, sessionId, leadId, binding: JSON.stringify([id, sessionId, leadId]) })
    }
    return result
  }, [conversations])
  const active = localDevelopment && enabled && Boolean(scope.organizationId && scope.userId && scope.accessScope)
    && targets.size > 0 && typeof IntersectionObserver !== 'undefined'
  const readScope = useMemo(() => ({ organizationId: scope.organizationId, userId: scope.userId, accessScope: scope.accessScope }),
    [scope.organizationId, scope.userId, scope.accessScope])
  // A visual pause is not a new authorization. Scope/surface ABA still creates
  // a new owner object and retires every former callback and private snapshot.
  const owner = useMemo(() => ({ readScope, sourceKey }), [readScope, sourceKey])
  const runtimeRef = useRef<Runtime | null>(null)
  const pausedId = uuid(pausedConversationId)
  const pausedIdRef = useRef(pausedId)
  const cacheRef = useRef<PreviewCache | null>(null)
  const nodesRef = useRef(new Set<HTMLDivElement>())
  const registrationsRef = useRef(new WeakMap<HTMLDivElement, object>())
  const [state, setState] = useState<{ owner: object; previews: Map<string, WhatsAppCanonicalConversationPreview> }>({ owner, previews: new Map() })
  const publishCache = useCallback((cache: PreviewCache) => {
    if (cacheRef.current !== cache) return
    setState({ owner: cache.owner, previews: new Map([...cache.entries].map(([id, entry]) => [id, entry.preview])) })
  }, [])

  useLayoutEffect(() => {
    let cache = cacheRef.current
    if (!cache || cache.owner !== owner) {
      cache = { owner, targets: new Map(), entries: new Map(), lastStarted: new Map(), dirty: new Map(), blocked: false }
      cacheRef.current = cache
    }
    const runtime = runtimeRef.current?.owner === owner ? runtimeRef.current : null
    pausedIdRef.current = pausedId
    if (pausedId) {
      runtime?.pending.delete(pausedId)
      runtime?.requests.get(pausedId)?.controller.abort()
    }
    const previousTargets = new Map(cache.targets)
    cache.targets.clear()
    for (const [id, target] of targets) cache.targets.set(id, target)
    let changed = false
    for (const [id, previous] of previousTargets) {
      const target = targets.get(id)
      if (target?.binding === previous.binding) continue
      changed = cache.entries.delete(id) || changed
      cache.lastStarted.delete(id); cache.dirty.delete(id)
      runtime?.requests.get(id)?.controller.abort()
      if (target) cache.dirty.set(id, {})
      else { runtime?.pending.delete(id); runtime?.visible.delete(id) }
    }
    for (const [id, entry] of cache.entries) {
      const card = targets.get(id)?.card
      const original = card ? [card] : null
      if (original && projectWhatsAppCanonicalConversationPreview(original, entry.preview, readScope) !== original) continue
      cache.entries.delete(id); cache.lastStarted.delete(id)
      if (card) cache.dirty.set(id, {})
      changed = true
    }
    if (changed) publishCache(cache)
    if (active) runtime?.refresh()
  }, [active, listRevision, owner, pausedId, publishCache, readScope, targets])

  // Revocation must also retire retained cards while the UI/runtime is paused.
  useLayoutEffect(() => {
    if (!localDevelopment || !readScope.organizationId || !readScope.userId || !readScope.accessScope) return
    const hint = (event: Event) => {
      const cache = cacheRef.current
      if (!cache || cache.owner !== owner) return
      const detail = (event as CustomEvent<WhatsAppMessagesReconcileEventDetail>).detail
      if (detail?.scope && (detail.scope.organizationId !== readScope.organizationId || detail.scope.userId !== readScope.userId
        || detail.scope.accessScope !== readScope.accessScope)) return
      const ids = [...cache.targets.keys()].filter(id => (!detail?.conversationIds?.length || detail.conversationIds.includes(id))
        && (!detail?.leadIds?.length || detail.leadIds.includes(cache.targets.get(id)?.leadId || '')))
      const runtime = runtimeRef.current?.owner === owner ? runtimeRef.current : null
      let changed = false
      for (const id of ids) {
        cache.dirty.set(id, {})
        if (detail?.authorizationChanged) {
          cache.lastStarted.delete(id); changed = cache.entries.delete(id) || changed
          runtime?.requests.get(id)?.controller.abort()
        }
      }
      if (changed) publishCache(cache)
      if (ids.length) runtime?.refresh(ids)
    }
    window.addEventListener(WHATSAPP_MESSAGES_RECONCILE_EVENT, hint)
    return () => window.removeEventListener(WHATSAPP_MESSAGES_RECONCILE_EVENT, hint)
  }, [localDevelopment, owner, publishCache, readScope])

  useLayoutEffect(() => {
    if (!active) return
    const cache = cacheRef.current!
    const publish = (id: string, preview: WhatsAppCanonicalConversationPreview | null, dirtyToken?: object) => {
      if (!runtime.live || runtimeRef.current !== runtime || cacheRef.current !== cache) return
      cache.entries.delete(id)
      if (preview) {
        cache.entries.set(id, { preview, refreshedAt: Date.now() })
        // A receipt hint arriving after this GET started still requires its
        // trailing read; the older response may consume only its own token.
        if (cache.dirty.get(id) === dirtyToken) cache.dirty.delete(id)
        while (cache.entries.size > MAX_SNAPSHOTS) {
          const oldest = cache.entries.keys().next().value!
          cache.entries.delete(oldest); cache.lastStarted.delete(oldest)
        }
      }
      publishCache(cache)
    }
    const runtime: Runtime = {
      owner, live: true, visible: new Set(), requests: new Map(), pending: new Set(),
      observer: null as unknown as IntersectionObserver, timer: null, drain: () => {}, refresh: () => {}, pause: () => {},
    }
    runtimeRef.current = runtime
    runtime.pause = id => {
      runtime.visible.delete(id); runtime.pending.delete(id)
      runtime.requests.get(id)?.controller.abort()
    }
    const needsRead = (id: string) => cache.dirty.has(id) || !cache.entries.has(id)
      || Date.now() - cache.entries.get(id)!.refreshedAt >= SNAPSHOT_REVALIDATE_MS
    runtime.drain = () => {
      if (!runtime.live || runtimeRef.current !== runtime || cacheRef.current !== cache || cache.blocked
        || document.visibilityState !== 'visible') return
      if (runtime.timer !== null) { clearTimeout(runtime.timer); runtime.timer = null }
      let remainingGap = Infinity
      for (const id of runtime.pending) {
        if (runtime.requests.size >= MAX_READS) break
        const target = cache.targets.get(id)
        if (id === pausedIdRef.current) { runtime.pending.delete(id); continue }
        if (!target || !runtime.visible.has(id)) { runtime.pending.delete(id); continue }
        if (runtime.requests.has(id)) continue
        if (!needsRead(id)) { runtime.pending.delete(id); continue }
        const gap = MIN_REFRESH_GAP_MS - (Date.now() - (cache.lastStarted.get(id) ?? -Infinity))
        if (gap > 0) { remainingGap = Math.min(remainingGap, gap); continue }
        runtime.pending.delete(id); cache.lastStarted.set(id, Date.now())
        const request = { controller: new AbortController(), binding: target.binding, dirtyToken: cache.dirty.get(id) }
        runtime.requests.set(id, request)
        const isCurrent = () => runtime.live && runtimeRef.current === runtime && cacheRef.current === cache
          && !cache.blocked && !request.controller.signal.aborted
          && id !== pausedIdRef.current
          && runtime.visible.has(id) && cache.targets.get(id)?.binding === request.binding
          && runtime.requests.get(id) === request
        void (async () => {
          let release: (() => void) | undefined
          try {
            release = await acquireReadSlot(request.controller.signal)
            if (!isCurrent()) return
            const page = await whatsappAPI.getMessages({ organizationId: readScope.organizationId, conversationId: id,
              expectedLeadId: target.leadId, cursor: null, limit: 10, includeMediaUrls: false },
            { expectedUserId: readScope.userId, signal: request.controller.signal })
            if (!isCurrent()) return
            const preview = captureWhatsAppCanonicalConversationPreview(page.messages, { scope: readScope,
              conversationId: id, expectedLeadId: target.leadId, expectedSessionId: target.sessionId })
            const card = cache.targets.get(id)!.card, original = [card]
            publish(id, preview && projectWhatsAppCanonicalConversationPreview(original, preview, readScope) !== original ? preview : null, request.dirtyToken)
          } catch (error) {
            if (isCurrent()) {
              const failure = error as { status?: number; code?: string } | null
              if (failure?.status === 401 || failure?.code === 'api_request_identity_changed') {
                cache.blocked = true; cache.entries.clear(); cache.dirty.clear(); runtime.pending.clear()
                runtime.requests.forEach(value => value.controller.abort()); publishCache(cache)
              } else {
                const temporary = failure?.status === 0 && ['api_timeout', 'api_unavailable'].includes(failure.code || '')
                  || typeof failure?.status === 'number' && failure.status >= 500 && failure.status <= 599
                    && TEMPORARY_HTTP_CODES.has(failure.code || '')
                if (isWhatsAppAccessUnavailable(error) || !temporary) publish(id, null)
              }
              // Transient failure retains the previously authorized whole tuple.
              // A newer list head or authorization event already invalidates it.
            }
          } finally {
            // An aborted transport may still settle late: keep its global lease
            // until settlement, and fence its data separately from cancellation.
            release?.()
            if (runtime.requests.get(id) === request) runtime.requests.delete(id)
            runtime.drain()
          }
        })()
      }
      if (remainingGap !== Infinity && runtime.live) runtime.timer = setTimeout(runtime.drain, remainingGap)
    }
    runtime.refresh = ids => {
      for (const id of runtime.visible) if (id !== pausedIdRef.current && (!ids?.length || ids.includes(id)) && needsRead(id)) runtime.pending.add(id)
      runtime.drain()
    }
    runtime.observer = new IntersectionObserver(entries => {
      if (!runtime.live || runtimeRef.current !== runtime) return
      for (const entry of entries) {
        const id = uuid((entry.target as HTMLDivElement).dataset.conversationId)
        if (!id || !cache.targets.has(id)) continue
        if (entry.isIntersecting) {
          runtime.visible.add(id)
          const cached = cache.entries.get(id)
          if (cached) { cache.entries.delete(id); cache.entries.set(id, cached) }
          if (id !== pausedIdRef.current && needsRead(id)) runtime.pending.add(id)
        }
        else runtime.pause(id)
      }
      runtime.drain()
    }, { rootMargin: '96px' })
    for (const node of nodesRef.current) runtime.observer.observe(node)
    const visibility = () => {
      if (document.visibilityState === 'visible') runtime.refresh()
      else for (const request of runtime.requests.values()) request.controller.abort()
    }
    document.addEventListener('visibilitychange', visibility)
    return () => {
      runtime.live = false; runtime.observer.disconnect()
      if (runtime.timer !== null) clearTimeout(runtime.timer)
      runtime.pending.clear(); runtime.requests.forEach(request => request.controller.abort())
      document.removeEventListener('visibilitychange', visibility)
      if (runtimeRef.current === runtime) runtimeRef.current = null
    }
  }, [active, owner, publishCache, readScope])

  const previewCardRef: RefCallback<HTMLDivElement> = useCallback(node => {
    if (!node || !active) return
    const registration = {}
    registrationsRef.current.set(node, registration); nodesRef.current.add(node)
    const runtime = runtimeRef.current
    if (runtime?.owner === owner) runtime.observer.observe(node)
    const id = uuid(node.dataset.conversationId)
    return () => {
      if (registrationsRef.current.get(node) !== registration) return
      registrationsRef.current.delete(node); nodesRef.current.delete(node)
      const current = runtimeRef.current
      if (current?.owner !== owner) return
      current.observer.unobserve(node)
      if (id) current.pause(id)
    }
  }, [active, owner])
  const previews = useMemo(() => !active || state.owner !== owner ? [] : [...state.previews.values()].filter(preview => {
    const card = targets.get(preview.conversationId)?.card
    if (!card) return false
    const original = [card]
    return projectWhatsAppCanonicalConversationPreview(original, preview, scope) !== original
  }), [active, owner, scope, state, targets])
  return { previews: previews as readonly WhatsAppCanonicalConversationPreview[], previewCardRef: active ? previewCardRef : undefined }
}
