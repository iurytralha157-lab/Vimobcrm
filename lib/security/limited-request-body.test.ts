import assert from 'node:assert/strict'
import test from 'node:test'

import {
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
