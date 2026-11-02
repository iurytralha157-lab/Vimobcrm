import assert from 'node:assert/strict'
import test from 'node:test'
import { GoTrueClient } from '@supabase/auth-js'
import {
  createPasswordRecoveryTransport,
  PASSWORD_RECOVERY_RESPONSE_MAX_BYTES,
  PASSWORD_RECOVERY_TRANSPORT_TIMEOUT_MS,
} from './password-recovery-transport.ts'
import { createPasswordRecoveryRequestCoordinator } from './password-recovery-request.ts'

const origin = 'https://synthetic.supabase.co'
const recoveryUrl = `${origin}/auth/v1/recover?redirect_to=https%3A%2F%2Fapp.test%2Freset-password`
const flush = () => new Promise(resolve => setImmediate(resolve))

function clock() {
  let now = 0, nextId = 0
  const pending = new Map()
  return {
    get now() { return now },
    get size() { return pending.size },
    setTimeout(callback, delay) { pending.set(++nextId, { at: now + delay, callback }); return nextId },
    clearTimeout(id) { pending.delete(id) },
    advance(duration) {
      const end = now + duration
      while (true) {
        const next = [...pending].filter(([, task]) => task.at <= end).sort((a, b) => a[1].at - b[1].at)[0]
        if (!next) break
        pending.delete(next[0]); now = next[1].at; next[1].callback()
      }
      now = end
    },
  }
}

function trackAbortListeners(signal) {
  const listeners = new Set()
  const add = signal.addEventListener.bind(signal), remove = signal.removeEventListener.bind(signal)
  signal.addEventListener = (event, listener, options) => {
    if (event === 'abort') listeners.add(listener)
    return add(event, listener, options)
  }
  signal.removeEventListener = (event, listener, options) => {
    if (event === 'abort') listeners.delete(listener)
    return remove(event, listener, options)
  }
  return () => listeners.size
}

// This transport mock rejects the actual pending headers/read on AbortSignal.
// The helper cannot pass these tests by racing a detached timeout promise.
function abortAwareFetch(stage = 'headers', { status = 200, payload = '{}' } = {}) {
  const calls = []
  const fetcher = (input, init) => new Promise((resolve, reject) => {
    const call = { input, init, aborts: 0, bodyAborted: false }
    calls.push(call)
    let bodyController
    const abort = () => {
      call.aborts += 1
      if (!bodyController) reject(init.signal.reason)
      else { call.bodyAborted = true; bodyController.error(init.signal.reason) }
    }
    if (init.signal.aborted) { abort(); return }
    init.signal.addEventListener('abort', abort, { once: true })
    if (stage === 'headers') return
    const body = new ReadableStream({ start(controller) {
      bodyController = controller
      if (stage === 'complete') {
        controller.enqueue(typeof payload === 'string' ? new TextEncoder().encode(payload) : payload)
        controller.close()
        init.signal.removeEventListener('abort', abort)
      } else if (stage === 'oversized') {
        controller.enqueue(new Uint8Array(PASSWORD_RECOVERY_RESPONSE_MAX_BYTES + 1))
      }
    } })
    resolve(new Response(body, { status, statusText: 'Synthetic response', headers: {
      'content-type': 'application/json', 'x-supabase-api-version': '2024-01-01',
    } }))
  })
  return { fetcher, calls }
}

test('the 30 second deadline aborts a real pending fetch before headers', async () => {
  const timers = clock(), network = abortAwareFetch()
  const fetcher = createPasswordRecoveryTransport(origin, network.fetcher, timers)
  const pending = fetcher(recoveryUrl, { method: 'POST' })
  const rejection = assert.rejects(pending, { name: 'TimeoutError' })
  timers.advance(PASSWORD_RECOVERY_TRANSPORT_TIMEOUT_MS - 1)
  assert.equal(network.calls[0].init.signal.aborted, false)
  timers.advance(1)
  await rejection
  assert.equal(network.calls[0].init.signal.aborted, true)
  assert.equal(network.calls[0].aborts, 1)
  assert.equal(timers.size, 0)
})

test('headers do not finish the deadline: an unfinished response body is actually aborted', async () => {
  const timers = clock(), network = abortAwareFetch('body')
  const fetcher = createPasswordRecoveryTransport(origin, network.fetcher, timers)
  let completed = false
  const pending = fetcher(recoveryUrl, { method: 'POST' }).then(response => { completed = true; return response })
  const rejection = assert.rejects(pending, { name: 'TimeoutError' })
  await flush()
  assert.equal(completed, false)
  assert.equal(timers.size, 1)
  timers.advance(PASSWORD_RECOVERY_TRANSPORT_TIMEOUT_MS)
  await rejection
  assert.equal(network.calls[0].bodyAborted, true)
  assert.equal(timers.size, 0)
})

test('a completed body preserves the SDK status, headers and JSON contract and cleans resources', async () => {
  const timers = clock(), network = abortAwareFetch('complete', { status: 429, payload: '{"code":"synthetic_limit"}' })
  const original = new AbortController(), listenerCount = trackAbortListeners(original.signal)
  const response = await createPasswordRecoveryTransport(origin, network.fetcher, timers)(recoveryUrl, {
    method: 'POST', signal: original.signal, headers: { 'x-synthetic': 'test' },
  })
  assert.equal(response.status, 429)
  assert.equal(response.statusText, 'Synthetic response')
  assert.equal(response.ok, false)
  assert.equal(response.headers.get('x-supabase-api-version'), '2024-01-01')
  assert.deepEqual(await response.clone().json(), { code: 'synthetic_limit' })
  assert.deepEqual(await response.json(), { code: 'synthetic_limit' })
  assert.equal(network.calls[0].init.headers['x-synthetic'], 'test')
  assert.equal(listenerCount(), 0)
  assert.equal(timers.size, 0)
  original.abort()
  timers.advance(60_000)
  assert.equal(network.calls[0].init.signal.aborted, false)
})

for (const stage of ['headers', 'body']) {
  test(`an original Request signal cancels the ${stage} stage and is cleaned up`, async () => {
    const timers = clock(), network = abortAwareFetch(stage)
    const original = new AbortController()
    const input = new Request(recoveryUrl, { method: 'POST', signal: original.signal })
    const listenerCount = trackAbortListeners(input.signal)
    const pending = createPasswordRecoveryTransport(origin, network.fetcher, timers)(input)
    const rejection = assert.rejects(pending, { name: 'AbortError', message: 'Synthetic cancellation' })
    await flush()
    original.abort(new DOMException('Synthetic cancellation', 'AbortError'))
    await rejection
    assert.equal(network.calls[0].input, input)
    assert.equal(network.calls[0].init.signal.aborted, true)
    assert.equal(network.calls[0].aborts, 1)
    assert.equal(listenerCount(), 0)
    assert.equal(timers.size, 0)
  })
}

test('init.signal overrides a Request signal with the native fetch precedence', async () => {
  const timers = clock(), network = abortAwareFetch()
  const requestController = new AbortController(), initController = new AbortController()
  const listenerCount = trackAbortListeners(initController.signal)
  const input = new Request(recoveryUrl, { method: 'POST', signal: requestController.signal })
  const pending = createPasswordRecoveryTransport(origin, network.fetcher, timers)(input, { signal: initController.signal })
  const rejection = assert.rejects(pending, { name: 'AbortError' })
  requestController.abort()
  assert.equal(network.calls[0].init.signal.aborted, false)
  initController.abort()
  await rejection
  assert.equal(listenerCount(), 0)
  assert.equal(timers.size, 0)
})

test('an already aborted input never starts a network request and leaves no timer', async () => {
  const timers = clock(), network = abortAwareFetch()
  const original = new AbortController()
  original.abort()
  await assert.rejects(createPasswordRecoveryTransport(origin, network.fetcher, timers)(recoveryUrl, {
    method: 'POST', signal: original.signal,
  }), { name: 'AbortError' })
  assert.equal(network.calls.length, 0)
  assert.equal(timers.size, 0)
})

test('a response beyond 64 KiB aborts transport, while the exact limit is accepted', async () => {
  const timers = clock(), network = abortAwareFetch('oversized')
  await assert.rejects(createPasswordRecoveryTransport(origin, network.fetcher, timers)(recoveryUrl, {
    method: 'POST',
  }), { name: 'AbortError' })
  assert.equal(network.calls[0].init.signal.aborted, true)
  assert.equal(network.calls[0].bodyAborted, true)
  assert.equal(timers.size, 0)
  const bounded = abortAwareFetch('complete', { payload: new Uint8Array(PASSWORD_RECOVERY_RESPONSE_MAX_BYTES) })
  const response = await createPasswordRecoveryTransport(origin, bounded.fetcher, timers)(recoveryUrl, { method: 'POST' })
  assert.equal((await response.arrayBuffer()).byteLength, PASSWORD_RECOVERY_RESPONSE_MAX_BYTES)
  assert.equal(timers.size, 0)
})

test('other origins, endpoints, path suffixes, methods and relative URLs pass through unchanged', async () => {
  const timers = clock(), calls = [], original = new AbortController()
  const fetcher = (input, init) => { calls.push({ input, init }); return Promise.resolve(new Response('{}')) }
  const transport = createPasswordRecoveryTransport(origin, fetcher, timers)
  for (const [input, method] of [
    [`${origin}/auth/v1/token?grant_type=password`, 'POST'],
    [`${origin}/auth/v1/user`, 'PUT'],
    ['https://other.supabase.co/auth/v1/recover', 'POST'],
    [`${origin}/auth/v1/recover/`, 'POST'],
    [recoveryUrl, 'GET'],
    ['/auth/v1/recover', 'POST'],
  ]) {
    const init = { method, signal: original.signal }
    await transport(input, init)
    assert.equal(calls.at(-1).input, input)
    assert.equal(calls.at(-1).init, init)
  }
  assert.equal(calls.length, 6)
  assert.equal(timers.size, 0)
  assert.equal(original.signal.aborted, false)
})

test('real auth-js settles after body abort and only then releases the coordinator lock', async () => {
  const timers = clock(), network = abortAwareFetch('body')
  const coordinator = createPasswordRecoveryRequestCoordinator({ now: () => timers.now })
  const client = new GoTrueClient({
    url: `${origin}/auth/v1`, fetch: createPasswordRecoveryTransport(origin, network.fetcher, timers),
    autoRefreshToken: false, persistSession: false, detectSessionInUrl: false,
  })
  let sdkResult
  const logs = [], originalConsoleError = console.error
  console.error = error => logs.push(String(error))
  try {
    const ticket = coordinator.start(async () => { sdkResult = await client.resetPasswordForEmail('synthetic@example.invalid'); return sdkResult })
    await flush()
    assert.equal(coordinator.getSnapshot().pending, true)
    assert.equal(coordinator.start(async () => ({})), null)
    timers.advance(PASSWORD_RECOVERY_TRANSPORT_TIMEOUT_MS)
    await ticket.settled
    assert.equal(network.calls[0].bodyAborted, true)
    assert.equal(sdkResult.error?.status, 0)
    assert.equal(coordinator.getSnapshot().pending, false)
    assert.equal(coordinator.getSnapshot().remainingSeconds, 30)
    assert.equal(coordinator.start(async () => ({})), null)
    timers.advance(30_000); coordinator.tick()
    const retry = coordinator.start(async () => ({}))
    assert.ok(retry); await retry.settled
    assert.equal(network.calls.length, 1)
    assert.equal(timers.size, 0)
    assert.doesNotMatch(logs.join(' '), /synthetic@example|token|redirect_to/)
  } finally { console.error = originalConsoleError }
})
