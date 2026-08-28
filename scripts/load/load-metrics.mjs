import { performance } from 'node:perf_hooks'

export function percentile(values, fraction) {
  if (!Array.isArray(values)) throw new TypeError('values must be an array')
  if (!Number.isFinite(fraction) || fraction < 0 || fraction > 1) {
    throw new RangeError('fraction must be between 0 and 1')
  }
  if (values.length === 0) return 0

  const sorted = [...values].sort((left, right) => left - right)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1))
  return sorted[index]
}

export function round(value, digits = 2) {
  if (!Number.isFinite(value)) return 0
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

export function summarizeLatencies(values) {
  const samples = values.filter(Number.isFinite)
  if (samples.length === 0) {
    return { average: 0, p50: 0, p95: 0, p99: 0, max: 0 }
  }

  return {
    average: round(samples.reduce((sum, value) => sum + value, 0) / samples.length),
    p50: round(percentile(samples, 0.5)),
    p95: round(percentile(samples, 0.95)),
    p99: round(percentile(samples, 0.99)),
    max: round(Math.max(...samples)),
  }
}

export class MetricsCollector {
  constructor({ clock = () => performance.now() } = {}) {
    this.clock = clock
    this.startedAt = this.clock()
    this.entries = new Map()
  }

  /**
   * @param {string} endpoint
   * @param {{ durationMs?: number, status?: number, ok?: boolean }} [sample]
   */
  record(endpoint, { durationMs, status = 0, ok = false } = {}) {
    if (typeof endpoint !== 'string' || endpoint.trim() === '') {
      throw new TypeError('endpoint must be a non-empty string')
    }
    if (!Number.isFinite(durationMs) || durationMs < 0) {
      throw new RangeError('durationMs must be a non-negative finite number')
    }

    const key = endpoint.trim()
    const entry = this.entries.get(key) || {
      requests: 0,
      errors: 0,
      serverErrors: 0,
      statuses: new Map(),
      latencies: [],
    }
    entry.requests += 1
    if (!ok) entry.errors += 1
    if (status >= 500 && status <= 599) entry.serverErrors += 1
    entry.statuses.set(status, (entry.statuses.get(status) || 0) + 1)
    entry.latencies.push(durationMs)
    this.entries.set(key, entry)
  }

  snapshot({ elapsedMs } = {}) {
    const resolvedElapsedMs = Number.isFinite(elapsedMs)
      ? Math.max(0, elapsedMs)
      : Math.max(0, this.clock() - this.startedAt)
    const endpointResults = {}
    const aggregateLatencies = []
    const aggregateStatuses = new Map()
    let requests = 0
    let errors = 0
    let serverErrors = 0

    for (const [endpoint, entry] of [...this.entries.entries()].sort(([left], [right]) =>
      left.localeCompare(right),
    )) {
      requests += entry.requests
      errors += entry.errors
      serverErrors += entry.serverErrors
      aggregateLatencies.push(...entry.latencies)
      for (const [status, count] of entry.statuses) {
        aggregateStatuses.set(status, (aggregateStatuses.get(status) || 0) + count)
      }

      endpointResults[endpoint] = {
        requests: entry.requests,
        errors: entry.errors,
        serverErrors: entry.serverErrors,
        errorRate: round(entry.requests === 0 ? 0 : entry.errors / entry.requests, 4),
        latencyMs: summarizeLatencies(entry.latencies),
        statuses: sortedStatusObject(entry.statuses),
      }
    }

    const elapsedSeconds = resolvedElapsedMs / 1_000
    return {
      elapsedMs: round(resolvedElapsedMs),
      requests,
      requestsPerSecond: round(elapsedSeconds === 0 ? 0 : requests / elapsedSeconds),
      errors,
      serverErrors,
      errorRate: round(requests === 0 ? 0 : errors / requests, 4),
      latencyMs: summarizeLatencies(aggregateLatencies),
      statuses: sortedStatusObject(aggregateStatuses),
      endpoints: endpointResults,
    }
  }
}

/**
 * @template TItem, TResult
 * @param {TItem[]} items
 * @param {number} concurrency
 * @param {(item: TItem, index: number, workerIndex: number) => TResult | Promise<TResult>} worker
 * @returns {Promise<TResult[]>}
 */
export async function runWorkerPool(items, concurrency, worker) {
  if (!Array.isArray(items)) throw new TypeError('items must be an array')
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new RangeError('concurrency must be a positive integer')
  }
  if (typeof worker !== 'function') throw new TypeError('worker must be a function')
  if (items.length === 0) return []

  const results = new Array(items.length)
  let nextIndex = 0
  let stopScheduling = false
  const failures = []
  const workerCount = Math.min(concurrency, items.length)

  async function run(workerIndex) {
    while (true) {
      if (stopScheduling) return
      const itemIndex = nextIndex
      nextIndex += 1
      if (itemIndex >= items.length) return
      try {
        results[itemIndex] = await worker(items[itemIndex], itemIndex, workerIndex)
      } catch (error) {
        stopScheduling = true
        failures.push(error)
        return
      }
    }
  }

  await Promise.all(Array.from({ length: workerCount }, (_, workerIndex) => run(workerIndex)))
  if (failures.length === 1) throw failures[0]
  if (failures.length > 1) {
    throw new AggregateError(failures, 'worker pool failed after draining in-flight work')
  }
  return results
}

export function evaluateMetricGates(summary, {
  maxErrorRate = 0.005,
  requireNoServerErrors = true,
  endpointThresholds = {},
} = {}) {
  const failures = []
  if (!summary || typeof summary !== 'object') {
    return [{ gate: 'metrics_summary', actual: summary, expected: 'metrics summary object' }]
  }

  if (summary.errorRate > maxErrorRate) {
    failures.push({
      gate: 'overall_error_rate',
      actual: summary.errorRate,
      expected: `<= ${maxErrorRate}`,
    })
  }
  if (requireNoServerErrors && summary.serverErrors > 0) {
    failures.push({
      gate: 'http_5xx',
      actual: summary.serverErrors,
      expected: 0,
    })
  }

  for (const [endpoint, thresholds] of Object.entries(endpointThresholds)) {
    const metrics = summary.endpoints?.[endpoint]
    if (!metrics) {
      failures.push({ gate: `${endpoint}:present`, actual: 'missing', expected: 'present' })
      continue
    }

    if (Number.isFinite(thresholds.maxErrorRate) && metrics.errorRate > thresholds.maxErrorRate) {
      failures.push({
        gate: `${endpoint}:error_rate`,
        actual: metrics.errorRate,
        expected: `<= ${thresholds.maxErrorRate}`,
      })
    }
    for (const percentileName of ['p95', 'p99']) {
      const thresholdKey = `max${percentileName.toUpperCase()}Ms`
      const threshold = thresholds[thresholdKey]
      if (Number.isFinite(threshold) && metrics.latencyMs[percentileName] > threshold) {
        failures.push({
          gate: `${endpoint}:${percentileName}`,
          actual: metrics.latencyMs[percentileName],
          expected: `<= ${threshold} ms`,
        })
      }
    }
  }

  return failures
}

function sortedStatusObject(statuses) {
  return Object.fromEntries([...statuses.entries()].sort(([left], [right]) => Number(left) - Number(right)))
}
