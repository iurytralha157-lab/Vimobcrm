export const WHATSAPP_MESSAGE_ORDERING_VERSION = 2 as const

const UTC6_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/

export function isWhatsAppUTC6Timestamp(value: string): boolean {
  if (!UTC6_TIMESTAMP.test(value)) return false
  const instant = Date.parse(value)
  return Number.isFinite(instant)
    && new Date(instant).toISOString() === `${value.slice(0, 23)}Z`
}

function timestampKey(value?: string | null): string | null {
  const instant = Date.parse(value ?? '')
  if (!Number.isFinite(instant)) return null
  const utc = new Date(instant).toISOString()
  if (!/^\d{4}-/.test(utc)) return null
  // Date truncates to milliseconds. Keep the remaining provider/SQL fraction
  // while using Date only to convert the timezone to UTC.
  const fraction = value?.match(/\.(\d+)(?:Z|[+-]\d{2}:?\d{2})$/i)?.[1]
    ?? utc.slice(20, 23)
  return `${utc.slice(0, 19)}.${fraction.padEnd(6, '0').slice(0, 6)}Z`
}

function sortTimedRows<T>(rows: readonly T[], timestamp: (row: T) => string | null | undefined): T[] {
  const ordered = rows.map((row, position) => ({ row, position, time: timestampKey(timestamp(row)) }))
  const result: T[] = []
  let start = 0
  // A legacy row without an effective timestamp is a feed-position fence;
  // assigning epoch zero would invent chronology and move it across messages.
  for (let end = 0; end <= ordered.length; end += 1) {
    if (end < ordered.length && ordered[end].time !== null) continue
    const segment = ordered.slice(start, end).sort((left, right) => (
      left.time! < right.time! ? -1 : left.time! > right.time! ? 1 : left.position - right.position
    ))
    for (const { row } of segment) result.push(row)
    if (end < ordered.length) result.push(ordered[end].row)
    start = end + 1
  }
  return result
}

/**
 * V2 API pages carry authoritative order for equal instants. Keep that feed
 * position as the final tie instead of reconstructing order from random IDs.
 * Callers append optimistic rows after canonical rows before interleaving.
 */
export function sortWhatsAppMessages<T extends { sent_at?: string | null }>(messages: readonly T[]): T[] {
  return sortTimedRows(messages, (message) => message.sent_at)
}

export function sortWhatsAppTimelineItems<T extends { timestamp: string }>(items: readonly T[]): T[] {
  return sortTimedRows(items, (item) => item.timestamp)
}

export function isWhatsAppMessageCursorRebaseRequired(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const candidate = error as { status?: unknown; code?: unknown }
  return candidate.status === 409 && candidate.code === 'whatsapp_message_cursor_rebase_required'
}
