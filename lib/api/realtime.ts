import { supabase } from '@/integrations/supabase/client'
import { buildAPIURL } from './vimob-client'
import { organizationIdSchema, parseDomainInput, realtimeEventSchema } from '@/lib/validation'
import { nextRealtimeCursor, realtimeReconnectDelay } from '@/lib/realtime-cursor'

export type BackendRealtimeEvent = {
  id: string
  type: string
  organizationId: string
  userId?: string
  data?: Record<string, unknown>
  createdAt: string
}

type ConnectRealtimeOptions = {
  organizationId: string
  onEvent: (event: BackendRealtimeEvent) => void
  onError?: (error: unknown) => void
}

export function connectBackendRealtime(options: ConnectRealtimeOptions) {
  const organizationId = parseDomainInput(organizationIdSchema, options.organizationId, 'realtime.connect.organization')
  let active = true
  let retryAttempt = 0
  let retryTimer: ReturnType<typeof setTimeout> | null = null
  let controller: AbortController | null = null
  let lastEventId: string | null = null

  const scheduleReconnect = () => {
    if (!active) return
    const delay = realtimeReconnectDelay(retryAttempt)
    retryAttempt += 1
    retryTimer = setTimeout(() => {
      retryTimer = null
      void openStream()
    }, delay)
  }

  const openStream = async () => {
    if (!active) return

    controller = new AbortController()

    try {
      const { data, error } = await supabase.auth.getSession()
      const token = data.session?.access_token
      if (error || !token) {
        throw error || new Error('Missing session for realtime stream.')
      }

      const headers: Record<string, string> = {
        Accept: 'text/event-stream',
        Authorization: `Bearer ${token}`,
        'X-Organization-ID': organizationId,
      }
      if (lastEventId) {
        headers['Last-Event-ID'] = lastEventId
      }

      const response = await fetch(buildAPIURL('/v1/realtime/events'), {
        method: 'GET',
        headers,
        signal: controller.signal,
      })

      if (!response.ok || !response.body) {
        throw new Error(`Realtime stream failed with status ${response.status}.`)
      }

      retryAttempt = 0
      await readSSEStream(response.body, (event) => {
        lastEventId = nextRealtimeCursor(lastEventId, event.id)
        options.onEvent(event)
      }, controller.signal)
      if (active && !controller.signal.aborted) {
        scheduleReconnect()
      }
    } catch (error) {
      if (active && !controller?.signal.aborted) {
        options.onError?.(error)
        scheduleReconnect()
      }
    }
  }

  void openStream()

  return () => {
    active = false
    if (retryTimer) clearTimeout(retryTimer)
    controller?.abort()
  }
}

async function readSSEStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: BackendRealtimeEvent) => void,
  signal: AbortSignal,
) {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (!signal.aborted) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      let separatorIndex = findEventSeparator(buffer)
      while (separatorIndex >= 0) {
        const rawEvent = buffer.slice(0, separatorIndex)
        buffer = buffer.slice(separatorIndex + eventSeparatorLength(buffer, separatorIndex))
        dispatchSSEEvent(rawEvent, onEvent)
        separatorIndex = findEventSeparator(buffer)
      }
    }
  } finally {
    reader.releaseLock()
  }
}

function dispatchSSEEvent(rawEvent: string, onEvent: (event: BackendRealtimeEvent) => void) {
  const lines = rawEvent.split(/\r?\n/)
  const dataLines: string[] = []

  for (const line of lines) {
    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trimStart())
    }
  }

  if (dataLines.length === 0) return

  try {
    const parsed = realtimeEventSchema.safeParse(JSON.parse(dataLines.join('\n')))
    if (parsed.success) {
      onEvent(parsed.data as BackendRealtimeEvent)
    }
  } catch {
    // Ignore malformed SSE payloads; the next event should still be readable.
  }
}

function findEventSeparator(value: string) {
  const lf = value.indexOf('\n\n')
  const crlf = value.indexOf('\r\n\r\n')
  if (lf === -1) return crlf
  if (crlf === -1) return lf
  return Math.min(lf, crlf)
}

function eventSeparatorLength(value: string, index: number) {
  return value.slice(index, index + 4) === '\r\n\r\n' ? 4 : 2
}
