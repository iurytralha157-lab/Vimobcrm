import type { WhatsAppQueryScope } from '@/lib/whatsapp-query-cache'

// All hook instances share a physical-route FIFO. Opaque file IDs survive only
// for gestures already reserved when that file finished; never bytes, results
// or a retry policy. A later deliberate reuse may create a fresh intent.
type FileReceipt = { clientMessageId: string; owner: number; through?: number }
type Lane = { tail?: Promise<void>; sequence: number; files: Map<string, FileReceipt> }
const admissions = new Map<string, Lane>()

export function reserveWhatsAppSendAdmission(
  scope: WhatsAppQueryScope,
  sessionId: string | null | undefined,
  conversationId: string,
) {
  const key = JSON.stringify([scope.organizationId, scope.userId, scope.accessScope, sessionId, conversationId])
  const lane = admissions.get(key) ?? { sequence: 0, files: new Map<string, FileReceipt>() }
  const previous = lane.tail
  const sequence = ++lane.sequence
  let release!: () => void
  const completed = new Promise<void>(resolve => { release = resolve })
  const tail = previous ? previous.then(() => completed) : completed
  lane.tail = tail
  admissions.set(key, lane)
  void tail.then(() => { if (lane.tail === tail) admissions.delete(key) })
  return {
    queued: Boolean(previous),
    wait: () => previous ?? Promise.resolve(),
    fileIntent: (fingerprint: string) => {
      const receipt = lane.files.get(fingerprint)
      return receipt && sequence > receipt.owner && sequence <= (receipt.through ?? 0) ? receipt.clientMessageId : undefined
    },
    rememberFileIntent: (fingerprint: string, clientMessageId: string) => {
      lane.files.set(fingerprint, { clientMessageId, owner: sequence })
    },
    release: () => {
      for (const receipt of lane.files.values()) {
        if (receipt.owner === sequence && receipt.through === undefined) receipt.through = lane.sequence
      }
      release()
    },
  }
}
