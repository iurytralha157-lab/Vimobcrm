import assert from 'node:assert/strict'
import test from 'node:test'

import {
  applyOutboxSnapshotFilters,
  isAmbiguousProviderFailure,
  makeClaimedLeaseMarker,
  makeDispatchingLeaseMarker,
  makeOutcomeUnknownLeaseMarker,
  parseLeaseMarker,
  planPendingClaim,
  planStaleRecovery,
  planUncertainOutcome,
} from '../../supabase/functions/message-sender/lease.ts'

function candidate(overrides = {}) {
  return {
    id: 'outbox-1',
    attempts: 1,
    max_attempts: 3,
    processed_at: '2026-08-16T10:00:00.000Z',
    error_message: null,
    ...overrides,
  }
}

test('happy path reserves one attempt and produces parseable lease boundaries', () => {
  const pending = candidate({ attempts: 0, processed_at: null })
  assert.deepEqual(planPendingClaim(pending), { kind: 'claim', nextAttempts: 1 })

  const claimed = makeClaimedLeaseMarker('worker-a')
  assert.deepEqual(parseLeaseMarker(claimed), {
    state: 'claimed',
    token: 'worker-a',
  })

  const dispatching = makeDispatchingLeaseMarker(
    'evolution_go',
    'worker-a',
    'ABCDEF0123456789ABCDEF0123456789',
  )
  assert.deepEqual(parseLeaseMarker(dispatching), {
    state: 'dispatching',
    provider: 'evolution_go',
    token: 'worker-a',
    providerRequestId: 'ABCDEF0123456789ABCDEF0123456789',
  })
})

test('crash before provider resumes the already-reserved final attempt', () => {
  const stale = candidate({
    attempts: 3,
    max_attempts: 3,
    error_message: makeClaimedLeaseMarker('crashed-worker'),
  })
  assert.deepEqual(planStaleRecovery(stale), {
    kind: 'recover',
    nextAttempts: 3,
    reason: 'crash-before-provider',
  })
})

test('corrupt stale claims beyond max_attempts are exhausted instead of recovered', () => {
  const stale = candidate({
    attempts: 4,
    max_attempts: 3,
    error_message: makeClaimedLeaseMarker('over-attempt-worker'),
  })
  assert.deepEqual(planStaleRecovery(stale), {
    kind: 'quarantine',
    reason: 'stale-attempts-exhausted',
  })
})

test('stale Evolution Go dispatch is terminal because its id is correlation, not a receipt', () => {
  const providerId = '11111111111111111111111111111111'
  const stale = candidate({
    error_message: makeOutcomeUnknownLeaseMarker(
      'evolution_go',
      'old-worker',
      providerId,
    ),
  })
  assert.deepEqual(planStaleRecovery(stale), {
    kind: 'quarantine',
    reason: 'evolution-go-provider-ambiguous',
  })
  assert.equal(parseLeaseMarker(stale.error_message)?.providerRequestId, providerId)
})

test('legacy and unmarked processing states are terminal manual reconciliation', () => {
  const legacy = candidate({
    error_message: makeDispatchingLeaseMarker(
      'evolution',
      'old-worker',
      '22222222222222222222222222222222',
    ),
  })
  assert.deepEqual(planStaleRecovery(legacy), {
    kind: 'quarantine',
    reason: 'legacy-provider-ambiguous',
  })
  assert.deepEqual(planStaleRecovery(candidate({ error_message: 'old worker error' })), {
    kind: 'quarantine',
    reason: 'unmarked-processing-state',
  })
  assert.deepEqual(planUncertainOutcome('evolution'), {
    kind: 'quarantine',
    reason: 'legacy-provider-outcome-unknown',
  })
  assert.equal(
    parseLeaseMarker('vimob-message-sender:v1:dispatching:evolution_go:worker:not-a-provider-id'),
    null,
  )
})

test('exhausted pending and ambiguous Evolution Go work both fail closed', () => {
  assert.deepEqual(planPendingClaim(candidate({ attempts: 3, max_attempts: 3 })), {
    kind: 'quarantine',
    reason: 'attempts-exhausted',
  })
  const exhaustedGo = candidate({
    attempts: 3,
    max_attempts: 3,
    error_message: makeDispatchingLeaseMarker(
      'evolution_go',
      'old-worker',
      '33333333333333333333333333333333',
    ),
  })
  assert.deepEqual(planStaleRecovery(exhaustedGo), {
    kind: 'quarantine',
    reason: 'evolution-go-provider-ambiguous',
  })
  assert.deepEqual(planUncertainOutcome('evolution_go'), {
    kind: 'quarantine',
    reason: 'evolution-go-provider-outcome-unknown',
  })
})

test('ProviderOutcomeUnknown policy is terminal for every provider', () => {
  assert.deepEqual(planUncertainOutcome('evolution_go'), {
    kind: 'quarantine',
    reason: 'evolution-go-provider-outcome-unknown',
  })
  assert.equal(JSON.stringify(planUncertainOutcome('evolution_go')).includes('pending'), false)
  assert.equal(JSON.stringify(planUncertainOutcome('evolution')).includes('retry'), false)
})

test('timeouts and server failures after the provider boundary are ambiguous', () => {
  assert.equal(isAmbiguousProviderFailure(408), true)
  assert.equal(isAmbiguousProviderFailure(500), true)
  assert.equal(isAmbiguousProviderFailure(503), true)
  assert.equal(isAmbiguousProviderFailure(400), false)
  assert.equal(isAmbiguousProviderFailure(429), false)
})

test('stale concurrent recovery CAS includes timestamp, marker, attempts and max_attempts', () => {
  const calls = []
  const query = {
    eq(column, value) {
      calls.push(['eq', column, value])
      return this
    },
    is(column, value) {
      calls.push(['is', column, value])
      return this
    },
  }
  const snapshot = candidate({
    error_message: makeClaimedLeaseMarker('old-worker'),
  })
  applyOutboxSnapshotFilters(query, snapshot)
  assert.deepEqual(calls, [
    ['eq', 'attempts', 1],
    ['eq', 'max_attempts', 3],
    ['eq', 'processed_at', '2026-08-16T10:00:00.000Z'],
    ['eq', 'error_message', makeClaimedLeaseMarker('old-worker')],
  ])

  // Competing workers generate different replacement markers. Because the old
  // marker is a CAS precondition, the second update cannot match after the first.
  assert.notEqual(
    makeClaimedLeaseMarker('replacement-worker-a'),
    makeClaimedLeaseMarker('replacement-worker-b'),
  )
})
