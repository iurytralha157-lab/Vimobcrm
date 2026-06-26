import { supabase } from '@/integrations/supabase/client'
import { buildAPIURL } from './vimob-client'

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
  let active = true
  let retryAttempt = 0
  let retryTimer: ReturnType<typeof setTimeout> | null = null
  let controller: AbortController | null = null

  const scheduleReconnect = () => {
    if (!active) return
    const delay = Math.min(1000 * 2 ** retryAttempt, 15000)
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

      const response = await fetch(buildAPIURL('/v1/realtime/events'), {
        method: 'GET',
        headers: {
          Accept: 'text/event-stream',
          Authorization: `Bearer ${token}`,
          'X-Organization-ID': options.organizationId,
        },
        signal: controller.signal,
      })

      if (!response.ok || !response.body) {
        throw new Error(`Realtime stream failed with status ${response.status}.`)
      }

      retryAttempt = 0
      await readSSEStream(response.body, options.onEvent, controller.signal)
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
    const parsed = JSON.parse(dataLines.join('\n')) as BackendRealtimeEvent
    if (parsed?.type && parsed?.organizationId) {
      onEvent(parsed)
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
