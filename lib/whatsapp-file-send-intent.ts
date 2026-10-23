import { createClientId } from '@/lib/client-id'
import { getWhatsAppSendFailureStatus } from '@/lib/whatsapp-query-cache'
import type { WhatsAppQueryScope } from '@/lib/whatsapp-query-cache'

type FileIntent = { clientMessageId: string; state: 'sending' | 'unconfirmed' | 'checking' | 'settled' }
export type WhatsAppFileIntentStore = Map<string, FileIntent>
const MAX_SETTLED_FILE_INTENTS = 128
// This module is used by browser gestures. QueryProvider replaces QueryClient
// on permission revisions, so unresolved IDs must outlive that cache object.
// Retain only opaque IDs/fingerprints, never bytes or message content.
let activeStore: { scope: string; intents: WhatsAppFileIntentStore } | undefined

// Permission revisions invalidate requests, not the identity of an unresolved
// send. Its next lookup still checks current authorization on the server.
export function getWhatsAppFileIntentOwnerKey(scope: WhatsAppQueryScope): string {
  return JSON.stringify([scope.userId, scope.organizationId])
}

// Unresolved gestures and a bounded set of settled opaque IDs are retained.
// A preview's Verify action must still find its original ID when another UI
// performed the canonical lookup. A new explicit send can replace a settled ID.
export function getWhatsAppFileIntentStore(scope: string): WhatsAppFileIntentStore {
  const existing = activeStore
  if (existing?.scope === scope) return existing.intents
  existing?.intents.clear()
  const intents: WhatsAppFileIntentStore = new Map()
  activeStore = { scope, intents }
  return intents
}

export async function fingerprintWhatsAppFile(file: Blob & { name: string }): Promise<string> {
  const bytes = await file.arrayBuffer()
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  const content = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
  return JSON.stringify([file.name, file.type, file.size, content])
}

export function settleWhatsAppFileIntent(store: WhatsAppFileIntentStore, clientMessageId: string) {
  for (const intent of store.values()) if (intent.clientMessageId === clientMessageId) intent.state = 'settled'
  const settledKeys = [...store].filter(([, intent]) => intent.state === 'settled').map(([key]) => key)
  for (const key of settledKeys.slice(0, Math.max(0, settledKeys.length - MAX_SETTLED_FILE_INTENTS))) store.delete(key)
}

export async function runWhatsAppFileIntent<T>(store: WhatsAppFileIntentStore, key: string, options: {
  isCurrent: () => boolean
  send: (clientMessageId: string) => Promise<T>
  check: (clientMessageId: string) => Promise<'pending' | 'accepted' | 'failed' | 'cancelled'>
  isUnconfirmed: (result: T) => boolean
  /** A preview checking its original attempt may never create a new POST. */
  verificationOnly?: boolean
}): Promise<{ kind: 'sent'; result: T } | { kind: 'checked'; clientMessageId: string; resolution: 'pending' | 'accepted' | 'failed' | 'cancelled' }> {
  if (!options.isCurrent()) return { kind: 'checked', clientMessageId: '', resolution: 'cancelled' }
  let existing = store.get(key)
  if (existing?.state === 'settled' && !options.verificationOnly) {
    store.delete(key)
    existing = undefined
  }
  if (existing) {
    // A simultaneous selection cannot launch another check or POST either.
    if (existing.state === 'sending' || existing.state === 'checking') return { kind: 'checked', clientMessageId: existing.clientMessageId, resolution: 'pending' }
    existing.state = 'checking'
    try {
      const resolution = await options.check(existing.clientMessageId)
      if (!options.isCurrent()) return { kind: 'checked', clientMessageId: existing.clientMessageId, resolution: 'cancelled' }
      if (resolution === 'accepted' || resolution === 'failed') store.delete(key)
      return { kind: 'checked', clientMessageId: existing.clientMessageId, resolution }
    } finally {
      if (store.get(key) === existing && existing.state === 'checking') existing.state = 'unconfirmed'
    }
  }
  // Eviction, explicit cancellation, or a restored preview does not establish
  // the outcome of a previous send. Keep checking unavailable; never resend.
  if (options.verificationOnly) return { kind: 'checked', clientMessageId: '', resolution: 'pending' }
  const intent: FileIntent = { clientMessageId: createClientId('message'), state: 'sending' }
  store.set(key, intent)
  try {
    const result = await options.send(intent.clientMessageId)
    if (options.isUnconfirmed(result)) intent.state = 'unconfirmed'
    else if (store.get(key) === intent) store.delete(key)
    return { kind: 'sent', result }
  } catch (error) {
    if (getWhatsAppSendFailureStatus(error) === 'confirming') intent.state = 'unconfirmed'
    else if (store.get(key) === intent) store.delete(key)
    throw error
  }
}
