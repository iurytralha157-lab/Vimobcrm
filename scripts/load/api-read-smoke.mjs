const baseUrl = (process.env.VIMOB_LOAD_BASE_URL || 'https://api.vimobcrm.com.br').replace(/\/$/, '')
const token = process.env.VIMOB_LOAD_TOKEN?.trim()
const organizationId = process.env.VIMOB_LOAD_ORGANIZATION_ID?.trim()
const concurrency = positiveInteger('VIMOB_LOAD_CONCURRENCY', 25)
const durationSeconds = positiveInteger('VIMOB_LOAD_DURATION_SECONDS', 30)
const requestTimeoutMs = positiveInteger('VIMOB_LOAD_REQUEST_TIMEOUT_MS', 10_000)
const maxP95Ms = positiveInteger('VIMOB_LOAD_MAX_P95_MS', 2_000)
const maxErrorRate = numberInRange('VIMOB_LOAD_MAX_ERROR_RATE', 0.01, 0, 1)
const endpoints = (process.env.VIMOB_LOAD_ENDPOINTS || [
  '/v1/me',
  '/v1/pipelines',
  '/v1/pipeline-board?limit=12',
  '/v1/contacts?limit=25',
  '/v1/whatsapp/conversations?limit=20',
].join(','))
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean)

if (!token) {
  throw new Error('VIMOB_LOAD_TOKEN is required. Pass a short-lived user access token through the environment.')
}
if (endpoints.length === 0) {
  throw new Error('At least one VIMOB_LOAD_ENDPOINTS entry is required.')
}

const headers = {
  Authorization: `Bearer ${token}`,
  Accept: 'application/json',
  'User-Agent': 'vimob-read-load-test/1.0',
}
if (organizationId) headers['X-Organization-ID'] = organizationId

const deadline = Date.now() + durationSeconds * 1_000
const latencies = []
const statuses = new Map()
const endpointStats = new Map(endpoints.map((endpoint) => [endpoint, { requests: 0, errors: 0 }]))
let requestCount = 0
let errorCount = 0

async function worker(workerId) {
  let index = workerId % endpoints.length
  while (Date.now() < deadline) {
    const endpoint = endpoints[index]
    index = (index + 1) % endpoints.length
    const startedAt = performance.now()
    let status = 0
    try {
      const response = await fetch(`${baseUrl}${endpoint}`, {
        headers,
        signal: AbortSignal.timeout(requestTimeoutMs),
      })
      status = response.status
      await response.arrayBuffer()
      if (!response.ok) errorCount += 1
    } catch {
      errorCount += 1
    } finally {
      const latency = performance.now() - startedAt
      latencies.push(latency)
      requestCount += 1
      statuses.set(status, (statuses.get(status) || 0) + 1)
      const endpointStat = endpointStats.get(endpoint)
      endpointStat.requests += 1
      if (status < 200 || status >= 400) endpointStat.errors += 1
    }
  }
}

const startedAt = performance.now()
await Promise.all(Array.from({ length: concurrency }, (_, index) => worker(index)))
const elapsedSeconds = (performance.now() - startedAt) / 1_000
latencies.sort((left, right) => left - right)

const result = {
  baseUrl,
  concurrency,
  durationSeconds,
  requests: requestCount,
  requestsPerSecond: round(requestCount / elapsedSeconds),
  errors: errorCount,
  errorRate: round(requestCount === 0 ? 1 : errorCount / requestCount, 4),
  latencyMs: {
    average: round(latencies.reduce((sum, value) => sum + value, 0) / Math.max(latencies.length, 1)),
    p50: round(percentile(latencies, 0.5)),
    p95: round(percentile(latencies, 0.95)),
    p99: round(percentile(latencies, 0.99)),
    max: round(latencies.at(-1) || 0),
  },
  statuses: Object.fromEntries([...statuses.entries()].sort(([left], [right]) => left - right)),
  endpoints: Object.fromEntries(endpointStats),
  thresholds: { maxP95Ms, maxErrorRate },
}

console.log(JSON.stringify(result, null, 2))

if (result.latencyMs.p95 > maxP95Ms || result.errorRate > maxErrorRate) {
  process.exitCode = 1
}

function positiveInteger(name, fallback) {
  const value = Number(process.env[name] || fallback)
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer.`)
  return value
}

function numberInRange(name, fallback, minimum, maximum) {
  const value = Number(process.env[name] || fallback)
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}.`)
  }
  return value
}

function percentile(values, fraction) {
  if (values.length === 0) return 0
  return values[Math.min(values.length - 1, Math.ceil(values.length * fraction) - 1)]
}

function round(value, digits = 2) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}
