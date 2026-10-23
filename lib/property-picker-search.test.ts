import assert from 'node:assert/strict'
import test from 'node:test'
import { nextPropertyPickerOffset, uniquePropertyPickerResults } from './property-picker-search'

test('picker continues past the former first thousand records', () => {
  assert.equal(nextPropertyPickerOffset(984, 24, 24, 2352), 1008)
  assert.equal(nextPropertyPickerOffset(1008, 24, 24, 2352), 1032)
})

test('picker stops after a final or empty page when total became stale', () => {
  assert.equal(nextPropertyPickerOffset(24, 24, 0, 100), undefined)
  assert.equal(nextPropertyPickerOffset(24, 24, 3, 100), undefined)
  assert.equal(nextPropertyPickerOffset(24, 24, 24, 48), undefined)
})

test('picker retains server matches and deduplicates changing page boundaries', () => {
  assert.deepEqual(uniquePropertyPickerResults([[{ id: 'a', title: 'server code match' }], [{ id: 'a', title: 'duplicate' }, { id: 'b', title: 'legacy reference' }]]), [
    { id: 'a', title: 'server code match' }, { id: 'b', title: 'legacy reference' },
  ])
})
