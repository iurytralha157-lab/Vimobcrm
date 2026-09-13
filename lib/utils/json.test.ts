import assert from 'node:assert/strict'
import test from 'node:test'

import { parseJSONOrNull } from './json'

test('preserva qualquer valor JSON valido', () => {
  assert.deepEqual(parseJSONOrNull('{"ok":true}'), { ok: true })
  assert.equal(parseJSONOrNull('null'), null)
  assert.equal(parseJSONOrNull('42'), 42)
})

test('devolve null para JSON invalido', () => {
  assert.equal(parseJSONOrNull(''), null)
  assert.equal(parseJSONOrNull('{'), null)
})
