import assert from 'node:assert/strict'
import test from 'node:test'
import { dashboardReadLoadConfig, runDashboardReadLoad } from './dashboard-read-local.mjs'

const localEnvironment = {
  VIMOB_DASHBOARD_LOAD_CONFIRM: 'LOCAL_READ_TEST',
  VIMOB_DASHBOARD_LOAD_BASE_URL: 'http://127.0.0.1:8081',
  VIMOB_DASHBOARD_LOAD_TOKEN: 'synthetic-local-token',
  VIMOB_DASHBOARD_LOAD_ORGANIZATION_ID: '11111111-1111-4111-8111-111111111111',
  VIMOB_DASHBOARD_LOAD_MAX_REQUESTS: '14',
}

test('dashboard load refuses omitted, remote, credentialed and redirected-origin targets', () => {
  for (const value of [undefined, 'https://api.vimobcrm.com.br', 'http://127.0.0.1.example', 'http://token@localhost:8081', 'http://localhost:8081/api', 'http://localhost:8081/?token=abc']) assert.throws(() => dashboardReadLoadConfig({ ...localEnvironment, VIMOB_DASHBOARD_LOAD_BASE_URL: value }))
  assert.throws(() => dashboardReadLoadConfig({ ...localEnvironment, VIMOB_DASHBOARD_LOAD_CONFIRM: undefined }))
  for (const [name, value] of [['VIMOB_DASHBOARD_LOAD_CONCURRENCY', '51'], ['VIMOB_DASHBOARD_LOAD_DURATION_SECONDS', '121'], ['VIMOB_DASHBOARD_LOAD_MAX_REQUESTS', '5001']]) assert.throws(() => dashboardReadLoadConfig({ ...localEnvironment, [name]: value }))
})

test('bounded load performs only approved GET dashboard queries and never logs user data or tokens', async () => {
  const config = dashboardReadLoadConfig(localEnvironment)
  const calls = []
  const result = await runDashboardReadLoad(config, async (url, options) => {
    calls.push({ url, options })
    return new Response('{"data":{"private":"synthetic-data"}}', { status: 200 })
  })
  assert.equal(calls.length, 14)
  assert.equal(result.requests, 14)
  assert.equal(result.errors, 0)
  assert.equal(Object.keys(result.endpoints).length, 7)
  assert.ok(calls.every(({ url, options }) => url.startsWith('http://127.0.0.1:8081/v1/dashboard/') && options.method === 'GET' && options.redirect === 'error'))
  assert.doesNotMatch(JSON.stringify(result), /synthetic-local-token|synthetic-data|Authorization/)
})

test('load reports non-success responses without retaining their content', async () => {
  const config = dashboardReadLoadConfig({ ...localEnvironment, VIMOB_DASHBOARD_LOAD_MAX_REQUESTS: '2' })
  const result = await runDashboardReadLoad(config, async () => new Response('private service detail', { status: 503 }))
  assert.equal(result.errors, 2)
  assert.equal(result.serverErrors, 2)
  assert.doesNotMatch(JSON.stringify(result), /private service detail/)
})
