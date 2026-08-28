import assert from 'node:assert/strict'
import test from 'node:test'

import { chunkUniqueTeamMemberIDs } from './member-availability-batches'

test('uses one unfiltered request when no member ids were supplied', () => {
  assert.deepEqual(chunkUniqueTeamMemberIDs(undefined), [undefined])
  assert.deepEqual(chunkUniqueTeamMemberIDs([]), [undefined])
})

test('deduplicates and splits large availability requests', () => {
  const ids = Array.from({ length: 205 }, (_, index) => `member-${index}`)
  ids.push('member-0', '  member-1  ', '')

  const batches = chunkUniqueTeamMemberIDs(ids)
  assert.deepEqual(batches.map((batch) => batch?.length), [100, 100, 5])
  assert.equal(batches[0]?.[0], 'member-0')
  assert.equal(batches[2]?.[4], 'member-204')
})
