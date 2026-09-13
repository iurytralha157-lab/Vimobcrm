import assert from 'node:assert/strict'
import test from 'node:test'

import {
  readRequestJSONWithLimit,
  readRequestTextWithLimit,
  RequestBodyTooLargeError,
} from './limited-request-body'

test('preserva os bytes UTF-8 exatos dentro do limite', async () => {
  const request = new Request('https://example.test/webhook', {
    method: 'POST',
    body: '{"texto":"olÃ¡"}',
  })

  assert.equal(
    await readRequestTextWithLimit(request, 256 * 1024),
    '{"texto":"olÃ¡"}',
  )
})

test('rejeita pelo Content-Length antes de ler o corpo', async () => {
  const request = new Request('https://example.test/webhook', {
    method: 'POST',
    headers: { 'content-length': String(256 * 1024 + 1) },
    body: 'x',
  })

  await assert.rejects(
    readRequestTextWithLimit(request, 256 * 1024),
    RequestBodyTooLargeError,
  )
})

test('conta bytes reais do stream e interrompe corpo sem tamanho declarado', async () => {
  const request = new Request('https://example.test/webhook', {
    method: 'POST',
    body: 'Ã©Ã©',
  })

  await assert.rejects(
    readRequestTextWithLimit(request, 3),
    RequestBodyTooLargeError,
  )
})

test('le e converte JSON dentro do limite', async () => {
  const request = new Request('https://example.test/onboarding', {
    method: 'POST',
    body: '{"email":"pessoa@example.test"}',
  })

  assert.deepEqual(await readRequestJSONWithLimit(request, 1024), {
    email: 'pessoa@example.test',
  })
})

test('preserva o erro de tamanho ao ler JSON', async () => {
  const request = new Request('https://example.test/onboarding', {
    method: 'POST',
    body: '{"value":"maior que o limite"}',
  })

  await assert.rejects(
    readRequestJSONWithLimit(request, 4),
    RequestBodyTooLargeError,
  )
})

test('preserva o erro nativo para JSON invalido', async () => {
  const request = new Request('https://example.test/onboarding', {
    method: 'POST',
    body: '{',
  })

  await assert.rejects(readRequestJSONWithLimit(request, 1024), SyntaxError)
})
