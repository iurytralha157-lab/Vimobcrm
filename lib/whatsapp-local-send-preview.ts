import type { WhatsAppQueryScope } from '@/lib/whatsapp-query-cache'

type Card = { id: string; session_id: string | null; lead_id: string | null; lead?: { id: string } | null;
  last_message: string | null; last_message_at: string | null; last_message_id?: string | null;
  last_message_sent_at?: string | null; last_message_from_me?: boolean | null; last_message_status?: string | null;
  historical_lead_view?: boolean; supervisory_lead_view?: boolean; platform?: string | null; is_group?: boolean }
export type SendPreviewOwner = { scope: WhatsAppQueryScope; active: boolean }
export type SendPreviewToken = { owner: SendPreviewOwner; sequence: number; conversationId: string; clientId: string }
export function getWhatsAppLocalSendPreviewText(content: string | null | undefined, kind = 'text') {
  const media: Record<string, string> = { image: '[Imagem]', video: '[Video]', audio: '[Audio]', document: '[Documento]', sticker: '[Figurinha]' }
  return content || media[kind] || '[Mensagem]'
}
type Entry = { token: SendPreviewToken; sessionId: string; leadId: string; base: Card; preview: string;
  status: string; sentAt: string; messageId: string | null; expiresAt: number; detached?: boolean;
  predecessors: Map<SendPreviewToken, Set<string>>; canonicalReceipt?: boolean }
const TTL_MS = 120_000
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const statusRank: Record<string, number> = { pending: 0, queued: 0, sending: 0, confirming: 0, unconfirmed: 0,
  failed: 0, error: 0, sent: 2, delivered: 3, read: 4, played: 4 }
const scopeKey = (scope: WhatsAppQueryScope) => JSON.stringify([scope.organizationId, scope.userId, scope.accessScope])
const key = (scope: WhatsAppQueryScope, id: string) => JSON.stringify([scopeKey(scope), id])
const time = (value?: string | null) => value ? Date.parse(value) : NaN
const headKey = (card: Card) => JSON.stringify([card.last_message_id ?? null, card.last_message_at,
  card.last_message, card.last_message_from_me ?? null])
const nextStatus = (previous: string, next?: string | null) => next && next in statusRank
  && statusRank[next] >= statusRank[previous] ? next : previous

/** Ephemeral presentation only: it never edits a canonical list, inserts a card or changes inbox order. */
export class WhatsAppLocalSendPreviewStore {
  private entries = new Map<string, Entry>()
  private listeners = new Set<() => void>()
  private version = 0
  private sequence = 0
  private activeScope: string | null = null
  constructor(private now = () => Date.now()) {}
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  snapshot = () => this.version
  private changed() { this.version++; this.listeners.forEach(listener => listener()) }
  synchronizeScope(scope: WhatsAppQueryScope) {
    const next = scopeKey(scope)
    if (this.activeScope === next) return
    this.activeScope = next
    if (this.entries.size) {
      for (const entry of this.entries.values()) entry.token.owner.active = false
      this.entries.clear(); this.changed()
    }
  }
  createOwner(scope: WhatsAppQueryScope): SendPreviewOwner { this.synchronizeScope(scope); return { scope: { ...scope }, active: true } }
  retireOwner(owner: SendPreviewOwner, preserveOnClose = false) {
    owner.active = false
    let changed = false
    for (const [id, entry] of this.entries) if (entry.token.owner === owner) {
      if (preserveOnClose) this.entries.set(id, { ...entry, detached: true })
      else this.entries.delete(id)
      changed = true
    }
    if (changed) this.changed()
  }
  discard(token: SendPreviewToken | undefined) {
    if (token && this.entries.get(key(token.owner.scope, token.conversationId))?.token === token) {
      this.entries.delete(key(token.owner.scope, token.conversationId)); this.changed()
    }
  }
  clear(scope: WhatsAppQueryScope, conversationIds?: readonly string[], leadIds?: readonly string[]) {
    let changed = false
    for (const [id, entry] of this.entries) if (scopeKey(entry.token.owner.scope) === scopeKey(scope)
      && (!conversationIds?.length || conversationIds.includes(entry.token.conversationId))
      && (!leadIds?.length || leadIds.includes(entry.leadId))) { this.entries.delete(id); changed = true }
    if (changed) this.changed()
  }
  begin(owner: SendPreviewOwner, card: Card, input: { clientId: string; sessionId: string; preview: string; sentAt: string }) {
    const leadId = card.lead_id || card.lead?.id
    if (!owner.active || !owner.scope.organizationId || !owner.scope.userId || !owner.scope.accessScope
      || !UUID.test(card.id) || !leadId || !UUID.test(leadId) || !UUID.test(input.sessionId)
      || card.session_id !== input.sessionId || !input.clientId || !Number.isFinite(time(input.sentAt))
      || card.is_group || card.historical_lead_view || card.supervisory_lead_view || card.platform
      || (card.lead_id && card.lead?.id && card.lead_id !== card.lead.id)) return undefined
    const token: SendPreviewToken = { owner, sequence: ++this.sequence, conversationId: card.id, clientId: input.clientId }
    const previous = this.entries.get(key(owner.scope, card.id))
    const predecessors = previous && previous.sessionId === input.sessionId && previous.leadId === leadId
      ? new Map(previous.predecessors) : new Map<SendPreviewToken, Set<string>>()
    if (previous && previous.sessionId === input.sessionId && previous.leadId === leadId) {
      predecessors.set(previous.token, new Set([previous.token.clientId, ...(previous.messageId ? [previous.messageId] : [])]))
      while (predecessors.size > 32) predecessors.delete(predecessors.keys().next().value!)
    }
    this.entries.set(key(owner.scope, card.id), { token, sessionId: input.sessionId, leadId, base: { ...card },
      preview: input.preview, status: 'pending', sentAt: input.sentAt, messageId: null, expiresAt: this.now() + TTL_MS, predecessors })
    while (this.entries.size > 64) this.entries.delete(this.entries.keys().next().value!)
    this.changed()
    return token
  }
  advance(token: SendPreviewToken | undefined, update: { status: string; messageId?: string; conversationId?: string;
    sessionId?: string | null; sentAt?: string; fromMe?: boolean; canonical?: boolean; clientId?: string }) {
    if (!token) return
    const entry = this.entries.get(key(token.owner.scope, token.conversationId))
    if (!entry || this.activeScope !== scopeKey(token.owner.scope) || entry.expiresAt <= this.now()
      || (update.conversationId && update.conversationId !== token.conversationId)
      || (update.sessionId && update.sessionId !== entry.sessionId)
      || (update.clientId && update.clientId !== token.clientId) || update.fromMe === false) return
    if (entry.token !== token) {
      const predecessor = entry.predecessors.get(token)
      if (predecessor && update.messageId && UUID.test(update.messageId) && !predecessor.has(update.messageId)) {
        const predecessors = new Map(entry.predecessors)
        predecessors.set(token, new Set([...predecessor, update.messageId]))
        this.entries.set(key(token.owner.scope, token.conversationId), { ...entry, predecessors }); this.changed()
      }
      return
    }
    if (!token.owner.active && !entry.detached) return
    if (entry.canonicalReceipt && !update.canonical && statusRank[update.status] === 0) return
    const status = nextStatus(entry.status, update.status)
    const messageId = update.messageId && UUID.test(update.messageId) ? update.messageId : entry.messageId
    const sentAt = update.sentAt && Number.isFinite(time(update.sentAt)) ? update.sentAt : entry.sentAt
    const canonicalReceipt = entry.canonicalReceipt || Boolean(update.canonical && messageId)
    if (status === entry.status && messageId === entry.messageId && sentAt === entry.sentAt && canonicalReceipt === entry.canonicalReceipt) return
    this.entries.set(key(token.owner.scope, token.conversationId), { ...entry, status, messageId, sentAt, canonicalReceipt })
    this.changed()
  }
  private decision(card: Card, entry: Entry): 'own' | 'same' | 'retire' {
    if ((!entry.token.owner.active && !entry.detached) || entry.expiresAt <= this.now() || card.session_id !== entry.sessionId
      || (card.lead_id || card.lead?.id) !== entry.leadId || card.platform || card.historical_lead_view || card.supervisory_lead_view || card.is_group
      || (card.lead_id && card.lead?.id && card.lead_id !== card.lead.id)) return 'retire'
    if (entry.messageId && card.last_message_id === entry.messageId) return card.last_message_from_me === true ? 'same' : 'retire'
    if (card.last_message_id && card.last_message_id === entry.token.clientId) return card.last_message_from_me === true ? 'same' : 'retire'
    if (card.last_message_id && [...entry.predecessors.values()].some(ids => ids.has(card.last_message_id!))) return card.last_message_from_me === true ? 'own' : 'retire'
    if (headKey(card) === headKey(entry.base)) return 'own'
    const headAt = time(card.last_message_sent_at || card.last_message_at)
    const baseAt = time(entry.base.last_message_sent_at || entry.base.last_message_at)
    // Older in-flight snapshots cannot replace an acknowledged local tuple.
    if (Number.isFinite(headAt) && Number.isFinite(baseAt) && headAt < baseAt) return 'own'
    // A changed head without a matching immutable ID is never given this send's receipt.
    return 'retire'
  }
  project<T extends Card>(cards: T[], scope: WhatsAppQueryScope): T[] {
    let changed = false
    const rows = cards.map(card => {
      const entry = this.entries.get(key(scope, card.id))
      if (!entry) return card
      const decision = this.decision(card, entry)
      if (decision === 'retire') return card
      if (decision === 'same') {
        const status = nextStatus(entry.status, card.last_message_status)
        if (status === card.last_message_status) return card
        changed = true; return { ...card, last_message_status: status }
      }
      changed = true
      return { ...card, last_message: entry.preview, last_message_from_me: true, last_message_status: entry.status,
        last_message_id: entry.messageId || entry.token.clientId, last_message_sent_at: entry.sentAt, last_message_at: entry.sentAt }
    })
    return changed ? rows : cards
  }
  reconcile(cards: readonly Card[], scope: WhatsAppQueryScope) {
    let changed = false
    for (const card of cards) {
      const id = key(scope, card.id), entry = this.entries.get(id)
      if (!entry) continue
      const decision = this.decision(card, entry)
      if (decision === 'retire') { this.entries.delete(id); changed = true }
      else if (decision === 'same') {
        const status = nextStatus(entry.status, card.last_message_status)
        if (status !== entry.status || !entry.canonicalReceipt) { this.entries.set(id, { ...entry, status, canonicalReceipt: true }); changed = true }
      }
    }
    if (changed) this.changed()
  }
  expire() {
    let changed = false
    for (const [id, entry] of this.entries) if (entry.expiresAt <= this.now()) { this.entries.delete(id); changed = true }
    if (changed) this.changed()
  }
  nextExpiry(scope: WhatsAppQueryScope) {
    return Math.min(...[...this.entries.values()].filter(entry => scopeKey(entry.token.owner.scope) === scopeKey(scope)).map(entry => entry.expiresAt))
  }
}
const stores = new WeakMap<object, WhatsAppLocalSendPreviewStore>()
export function getWhatsAppLocalSendPreviewStore(client: object) {
  let store = stores.get(client)
  if (!store) { store = new WhatsAppLocalSendPreviewStore(); stores.set(client, store) }
  return store
}
