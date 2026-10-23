import { pathToFileURL } from 'node:url'
import { MetricsCollector } from './load-metrics.mjs'

const dashboardReadRoutes = ['stats', 'funnel', 'sources', 'deals-evolution', 'extra-counts', 'campaigns', 'creatives']

function boundedInteger(environment, name, fallback, maximum) {
  const value = Number(environment[name] ?? fallback)
  if (!Number.isInteger(value) || value < 1 || value > maximum) throw new Error(`${name} must be between 1 and ${maximum}.`)
  return value
}

export function dashboardReadLoadConfig(environment = process.env) {
  if (environment.VIMOB_DASHBOARD_LOAD_CONFIRM !== 'LOCAL_READ_TEST') throw new Error('VIMOB_DASHBOARD_LOAD_CONFIRM=LOCAL_READ_TEST is required.')
  if (!environment.VIMOB_DASHBOARD_LOAD_BASE_URL) throw new Error('Set the explicit loopback VIMOB_DASHBOARD_LOAD_BASE_URL.')
  const base = new URL(environment.VIMOB_DASHBOARD_LOAD_BASE_URL)
  if (!['http:', 'https:'].includes(base.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname) || base.username || base.password || base.search || base.hash || base.pathname !== '/') throw new Error('The dashboard load target must be a loopback HTTP origin without credentials, query or path.')
  const token = environment.VIMOB_DASHBOARD_LOAD_TOKEN?.trim()
  const organizationId = environment.VIMOB_DASHBOARD_LOAD_ORGANIZATION_ID?.trim()
  if (!token) throw new Error('Set VIMOB_DASHBOARD_LOAD_TOKEN in the environment, never in command arguments.')
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(organizationId ?? '')) throw new Error('Set a valid local VIMOB_DASHBOARD_LOAD_ORGANIZATION_ID.')
  const query = new URLSearchParams()
  const from = environment.VIMOB_DASHBOARD_LOAD_DATE_FROM
  const to = environment.VIMOB_DASHBOARD_LOAD_DATE_TO
  if (Boolean(from) !== Boolean(to)) throw new Error('Provide both dashboard dates or neither.')
  if (from && to) {
    const duration = new Date(to).getTime() - new Date(from).getTime()
    if (!Number.isFinite(duration) || duration <= 0 || duration > 5 * 366 * 86400000) throw new Error('Dashboard dates must be valid, ordered and within five years.')
    query.set('dateFrom', new Date(from).toISOString())
    query.set('dateTo', new Date(to).toISOString())
  }
  const routes = [...dashboardReadRoutes]
  if (environment.VIMOB_DASHBOARD_LOAD_MANAGEMENT === 'true') routes.push('lead-distribution')
  return {
    baseUrl: base.origin,
    endpoints: routes.map((route) => `/v1/dashboard/${route}${query.size ? `?${query}` : ''}`),
    headers: { Authorization: `Bearer ${token}`, 'X-Organization-ID': organizationId, Accept: 'application/json' },
    concurrency: boundedInteger(environment, 'VIMOB_DASHBOARD_LOAD_CONCURRENCY', 5, 50),
    durationSeconds: boundedInteger(environment, 'VIMOB_DASHBOARD_LOAD_DURATION_SECONDS', 15, 120),
    maxRequests: boundedInteger(environment, 'VIMOB_DASHBOARD_LOAD_MAX_REQUESTS', 500, 5000),
    timeoutMs: boundedInteger(environment, 'VIMOB_DASHBOARD_LOAD_TIMEOUT_MS', 5000, 10000),
  }
}

export async function runDashboardReadLoad(config, fetchRequest = fetch) {
  const metrics = new MetricsCollector()
  const deadline = performance.now() + config.durationSeconds * 1000
  let scheduled = 0
  let responseBytes = 0
  async function worker() {
    while (performance.now() < deadline && scheduled < config.maxRequests) {
      const request = scheduled++
      const endpoint = config.endpoints[request % config.endpoints.length]
      const started = performance.now()
      let status = 0
      let ok = false
      try {
        const response = await fetchRequest(config.baseUrl + endpoint, { method: 'GET', headers: config.headers, redirect: 'error', signal: AbortSignal.timeout(config.timeoutMs) })
        status = response.status
        const reader = response.body?.getReader()
        let bytes = 0
        if (reader) {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            bytes += value.byteLength
            if (bytes > 4 * 1024 * 1024) { await reader.cancel(); throw new Error('Dashboard response exceeds the local load budget.') }
          }
        }
        responseBytes += bytes
        ok = response.ok
      } catch {
        // Report only aggregate statuses and latency, never tokens or response bodies.
      } finally {
        metrics.record(endpoint.split('?')[0], { durationMs: performance.now() - started, status, ok })
      }
    }
  }
  await Promise.all(Array.from({ length: config.concurrency }, worker))
  return { target: config.baseUrl, concurrency: config.concurrency, maxRequests: config.maxRequests, responseBytes, ...metrics.snapshot() }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await runDashboardReadLoad(dashboardReadLoadConfig())
  console.log(JSON.stringify(result, null, 2))
  if (result.errors > 0) process.exitCode = 1
}
