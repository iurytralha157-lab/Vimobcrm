export const PASSWORD_RECOVERY_TRANSPORT_TIMEOUT_MS = 30_000
export const PASSWORD_RECOVERY_RESPONSE_MAX_BYTES = 64 * 1024

type TransportTimers = {
  setTimeout: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>
  clearTimeout: (timer: ReturnType<typeof setTimeout>) => void
}

const defaultTimers: TransportTimers = {
  setTimeout: (callback, delay) => globalThis.setTimeout(callback, delay),
  clearTimeout: timer => globalThis.clearTimeout(timer),
}

/** Bound only recovery email transport, including receipt of its small JSON body. */
export function createPasswordRecoveryTransport(
  supabaseUrl: string,
  fetcher: typeof fetch,
  timers: TransportTimers = defaultTimers,
): typeof fetch {
  const origin = new URL(supabaseUrl).origin

  const recover = async (input: RequestInfo | URL, init?: RequestInit) => {
    const controller = new AbortController()
    const originalSignal = init?.signal === undefined && input instanceof Request ? input.signal : init?.signal
    const abortFromOriginal = () => controller.abort(originalSignal?.reason)
    if (originalSignal?.aborted) abortFromOriginal()
    else originalSignal?.addEventListener('abort', abortFromOriginal, { once: true })

    const timer = timers.setTimeout(() => controller.abort(new DOMException(
      'A solicitação de recuperação excedeu o tempo limite.', 'TimeoutError',
    )), PASSWORD_RECOVERY_TRANSPORT_TIMEOUT_MS)

    try {
      controller.signal.throwIfAborted()
      const response = await fetcher(input, { ...init, signal: controller.signal })
      if (!response.body) return response

      // fetch() resolves at headers. Keep the signal/deadline until the body is
      // consumed; otherwise a stalled response.json() would still own the lock.
      const reader = response.body.getReader()
      const chunks: Uint8Array[] = []
      let size = 0
      try {
        while (true) {
          controller.signal.throwIfAborted()
          const chunk = await reader.read()
          if (chunk.done) break
          size += chunk.value.byteLength
          if (size > PASSWORD_RECOVERY_RESPONSE_MAX_BYTES) {
            const error = new DOMException('A resposta da recuperação excedeu o limite permitido.', 'AbortError')
            controller.abort(error)
            throw error
          }
          chunks.push(chunk.value)
        }
      } finally {
        reader.releaseLock()
      }
      controller.signal.throwIfAborted()
      const body = new Uint8Array(size)
      let offset = 0
      for (const chunk of chunks) {
        body.set(chunk, offset)
        offset += chunk.byteLength
      }
      // auth-js consumes only status/ok, headers and json() for /recover. A
      // buffered Response preserves that contract without extending the timer.
      return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers })
    } finally {
      timers.clearTimeout(timer)
      originalSignal?.removeEventListener('abort', abortFromOriginal)
    }
  }

  return (input, init) => {
    const rawUrl = typeof input === 'string' || input instanceof URL ? String(input) : input.url
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET')
    let url: URL
    try { url = new URL(rawUrl) } catch { return fetcher(input, init) }
    if (method.toUpperCase() !== 'POST' || url.origin !== origin || url.pathname !== '/auth/v1/recover') {
      return fetcher(input, init)
    }
    return recover(input, init)
  }
}
