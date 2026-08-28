import assert from 'node:assert/strict'
import test from 'node:test'

import {
  MetricsCollector,
  evaluateMetricGates,
  percentile,
  runWorkerPool,
  summarizeLatencies,
} from './load-metrics.mjs'

test('percentile uses nearest-rank without mutating the input', () => {
  const values = [40, 10, 30, 20]

  assert.equal(percentile(values, 0.5), 20)
  assert.equal(percentile(values, 0.95), 40)
  assert.deepEqual(values, [40, 10, 30, 20])
})

test('summarizeLatencies returns stable empty and populated summaries', () => {
  assert.deepEqual(summarizeLatencies([]), {
    average: 0,
    p50: 0,
    p95: 0,
    p99: 0,
    max: 0,
  })
  assert.deepEqual(summarizeLatencies([10, 20, 30, 40]), {
    average: 25,
    p50: 20,
    p95: 40,
    p99: 40,
    max: 40,
  })
})

test('MetricsCollector reports latency and errors per endpoint', () => {
  let now = 0
  const collector = new MetricsCollector({ clock: () => now })
  collector.record('GET /a', { durationMs: 10, status: 200, ok: true })
  collector.record('GET /a', { durationMs: 30, status: 503, ok: false })
  collector.record('GET /b', { durationMs: 20, status: 200, ok: true })
  now = 1_000

  const summary = collector.snapshot()

  assert.equal(summary.requests, 3)
  assert.equal(summary.errors, 1)
  assert.equal(summary.serverErrors, 1)
  assert.equal(summary.requestsPerSecond, 3)
  assert.equal(summary.endpoints['GET /a'].requests, 2)
  assert.equal(summary.endpoints['GET /a'].latencyMs.p95, 30)
  assert.deepEqual(summary.endpoints['GET /a'].statuses, { 200: 1, 503: 1 })
})

test('runWorkerPool preserves order and enforces the concurrency ceiling', async () => {
  let active = 0
  let maximumActive = 0
  const values = Array.from({ length: 20 }, (_, index) => index)

  const results = await runWorkerPool(values, 3, async (value) => {
    active += 1
    maximumActive = Math.max(maximumActive, active)
    await new Promise((resolve) => setTimeout(resolve, 2))
    active -= 1
    return value * 2
  })

  assert.equal(maximumActive, 3)
  assert.deepEqual(results, values.map((value) => value * 2))
})

test('runWorkerPool drains in-flight workers before rejecting and stops scheduling new work', async () => {
  const started = []
  const completed = []
  let releaseSlowWorker
  const slowWorker = new Promise((resolve) => {
    releaseSlowWorker = resolve
  })

  const run = runWorkerPool([0, 1, 2, 3], 2, async (value) => {
    started.push(value)
    if (value === 0) throw new Error('expected worker failure')
    if (value === 1) {
      await slowWorker
      completed.push(value)
    }
    return value
  })

  await new Promise((resolve) => setTimeout(resolve, 5))
  let settled = false
  void run.catch(() => {
    settled = true
  })
  await new Promise((resolve) => setTimeout(resolve, 5))
  assert.equal(settled, false)

  releaseSlowWorker()
  await assert.rejects(run, /expected worker failure/)
  assert.deepEqual(started.sort(), [0, 1])
  assert.deepEqual(completed, [1])
})

test('evaluateMetricGates identifies global and endpoint regressions', () => {
  const summary = {
    errorRate: 0.02,
    serverErrors: 1,
    endpoints: {
      intake: {
        errorRate: 0.01,
        latencyMs: { p95: 800, p99: 1_600 },
      },
    },
  }

  const failures = evaluateMetricGates(summary, {
    maxErrorRate: 0.005,
    endpointThresholds: {
      intake: { maxErrorRate: 0, maxP95Ms: 750, maxP99Ms: 1_500 },
      dashboard: { maxP95Ms: 500 },
    },
  })

  assert.deepEqual(
    failures.map((failure) => failure.gate),
    [
      'overall_error_rate',
      'http_5xx',
      'intake:error_rate',
      'intake:p95',
      'intake:p99',
      'dashboard:present',
    ],
  )
})
