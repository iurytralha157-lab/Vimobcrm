import assert from 'node:assert/strict'
import test from 'node:test'

import {
  BACKEND_REALTIME_RESET_DEBOUNCE_MS,
  BACKEND_REALTIME_RESET_MIN_INTERVAL_MS,
  getBackendRealtimeResetDelay,
  getPipelineRealtimeRefreshDelay,
  PIPELINE_READ_TIMEOUT_MS,
  PIPELINE_REALTIME_RECONCILE_MAX_WAIT_MS,
  PIPELINE_REALTIME_REFRESH_INTERVAL_MS,
  shouldRetryPipelineQuery,
} from './pipeline-reliability'

test('usa um prazo de leitura compatível com a API em vez do corte de quatro segundos', () => {
  assert.equal(PIPELINE_READ_TIMEOUT_MS, 12_000)
})

test('repete somente uma vez falhas transitórias da pipeline', () => {
  assert.equal(shouldRetryPipelineQuery(0, { code: 'api_timeout', status: 0 }), true)
  assert.equal(shouldRetryPipelineQuery(0, { code: 'api_unavailable', status: 503 }), true)
  assert.equal(shouldRetryPipelineQuery(0, { code: 'api_error', status: 503 }), true)
  assert.equal(shouldRetryPipelineQuery(1, { code: 'api_timeout', status: 0 }), false)
  assert.equal(shouldRetryPipelineQuery(0, { code: 'permission_denied', status: 403 }), false)
  assert.equal(shouldRetryPipelineQuery(0, { name: 'AbortError' }), false)
  assert.equal(shouldRetryPipelineQuery(0, new Error('resposta inválida')), false)
})

test('limita rajadas do realtime e respeita a janela otimista de movimentação', () => {
  const nowMs = 20_000

  assert.equal(getPipelineRealtimeRefreshDelay(nowMs, null), 0)
  assert.equal(
    getPipelineRealtimeRefreshDelay(nowMs, nowMs - 1_000),
    PIPELINE_REALTIME_REFRESH_INTERVAL_MS - 1_000,
  )
  assert.equal(getPipelineRealtimeRefreshDelay(nowMs, nowMs - 6_000), 0)
  assert.equal(getPipelineRealtimeRefreshDelay(nowMs, nowMs - 1_000, 4_500), 4_500)
  assert.equal(
    getPipelineRealtimeRefreshDelay(
      nowMs + PIPELINE_REALTIME_RECONCILE_MAX_WAIT_MS - 500,
      nowMs,
      4_500,
      nowMs,
    ),
    500,
  )
})

test('agrupa resets do backend e limita reconciliações globais repetidas', () => {
  const nowMs = 30_000

  assert.equal(getBackendRealtimeResetDelay(nowMs, null), BACKEND_REALTIME_RESET_DEBOUNCE_MS)
  assert.equal(
    getBackendRealtimeResetDelay(nowMs, nowMs - 2_000),
    BACKEND_REALTIME_RESET_MIN_INTERVAL_MS - 2_000,
  )
  assert.equal(
    getBackendRealtimeResetDelay(nowMs, nowMs - BACKEND_REALTIME_RESET_MIN_INTERVAL_MS),
    BACKEND_REALTIME_RESET_DEBOUNCE_MS,
  )
})
