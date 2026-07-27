import assert from 'node:assert/strict'
import test from 'node:test'
import { splitScheduleEventByDay } from './schedule-event-segments'

test('keeps a same-day event in one segment', () => {
  const segments = splitScheduleEventByDay({
    id: 'same-day',
    start_time: '2026-07-27T12:00:00',
    end_time: '2026-07-27T13:30:00',
  })

  assert.equal(segments.length, 1)
  assert.equal(segments[0]?.dateKey, '2026-07-27')
  assert.equal(segments[0]?.isFirst, true)
  assert.equal(segments[0]?.isLast, true)
})

test('splits an overnight event into the correct day columns', () => {
  const segments = splitScheduleEventByDay({
    id: 'overnight',
    start_time: '2026-07-27T12:00:00',
    end_time: '2026-07-28T08:45:00',
  })

  assert.deepEqual(segments.map((segment) => segment.dateKey), [
    '2026-07-27',
    '2026-07-28',
  ])
  assert.equal(segments[0]?.start.getHours(), 12)
  assert.equal(segments[0]?.end.getHours(), 0)
  assert.equal(segments[0]?.isLast, false)
  assert.equal(segments[1]?.start.getHours(), 0)
  assert.equal(segments[1]?.end.getHours(), 8)
  assert.equal(segments[1]?.end.getMinutes(), 45)
  assert.equal(segments[1]?.isFirst, false)
  assert.equal(segments[1]?.isLast, true)
})

test('does not create an empty segment when an event ends at midnight', () => {
  const segments = splitScheduleEventByDay({
    id: 'midnight-end',
    start_time: '2026-07-27T22:00:00',
    end_time: '2026-07-28T00:00:00',
  })

  assert.equal(segments.length, 1)
  assert.equal(segments[0]?.dateKey, '2026-07-27')
})

test('rejects invalid or non-positive intervals', () => {
  assert.deepEqual(splitScheduleEventByDay({
    id: 'invalid',
    start_time: 'invalid',
    end_time: '2026-07-28T00:00:00',
  }), [])

  assert.deepEqual(splitScheduleEventByDay({
    id: 'backwards',
    start_time: '2026-07-28T01:00:00',
    end_time: '2026-07-28T00:00:00',
  }), [])
})
