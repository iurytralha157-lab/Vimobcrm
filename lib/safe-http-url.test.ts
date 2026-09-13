import assert from 'node:assert/strict'
import test from 'node:test'

import { getSafeHttpUrl } from './safe-http-url'

test('accepts absolute HTTP URLs and normalizes them through URL', () => {
  assert.equal(getSafeHttpUrl('https://vimob.example/imovel?id=1'), 'https://vimob.example/imovel?id=1')
  assert.equal(getSafeHttpUrl('http://localhost:3000/path'), 'http://localhost:3000/path')
})

test('accepts internal paths while rejecting protocol-relative and unsafe URLs', () => {
  assert.equal(getSafeHttpUrl('/imoveis/123'), '/imoveis/123')
  assert.equal(getSafeHttpUrl('//evil.example/path'), null)
  assert.equal(getSafeHttpUrl('javascript:alert(1)'), null)
  assert.equal(getSafeHttpUrl('data:text/html,unsafe'), null)
})

test('rejects missing and malformed URLs', () => {
  assert.equal(getSafeHttpUrl(null), null)
  assert.equal(getSafeHttpUrl(undefined), null)
  assert.equal(getSafeHttpUrl(''), null)
  assert.equal(getSafeHttpUrl('not a URL'), null)
})
