import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

async function loadAccessRefreshCoordinator() {
  const source = readFileSync(new URL('./BackendRealtimeBus.tsx', import.meta.url), 'utf8')
  const functionStart = source.indexOf('export function createCoalescedAccessRefresh')
  const functionEnd = source.indexOf('\nexport function BackendRealtimeBus', functionStart)

  assert.ok(functionStart >= 0 && functionEnd > functionStart)

  const compiled = ts.transpileModule(source.slice(functionStart, functionEnd), {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText

  return import(`data:text/javascript,${encodeURIComponent(compiled)}`)
}

test('coalesce uma rajada em uma leitura atual e uma unica leitura final', async () => {
  const { createCoalescedAccessRefresh } = await loadAccessRefreshCoordinator()
  let refreshCalls = 0
  let releaseFirstRefresh = () => {}
  const firstRefresh = new Promise((resolve) => {
    releaseFirstRefresh = resolve
  })
  const coordinator = createCoalescedAccessRefresh({
    isCurrentScope: () => true,
    refresh: () => {
      refreshCalls += 1
      return refreshCalls === 1 ? firstRefresh : Promise.resolve()
    },
  })

  const drained = coordinator.request()
  const burst = Array.from({ length: 25 }, () => coordinator.request())

  assert.equal(refreshCalls, 1)
  releaseFirstRefresh()
  await Promise.all([drained, ...burst])
  assert.equal(refreshCalls, 2)
})

test('descarta trailing refresh e fallback quando o escopo deixa de ser atual', async () => {
  const { createCoalescedAccessRefresh } = await loadAccessRefreshCoordinator()
  let currentScope = true
  let refreshCalls = 0
  let failureCalls = 0
  let rejectRefresh = () => {}
  const blockedRefresh = new Promise((_, reject) => {
    rejectRefresh = reject
  })
  const coordinator = createCoalescedAccessRefresh({
    isCurrentScope: () => currentScope,
    refresh: () => {
      refreshCalls += 1
      return blockedRefresh
    },
  })

  const drained = coordinator.request()
  void coordinator.request(() => {
    failureCalls += 1
  })
  currentScope = false
  coordinator.dispose()
  rejectRefresh(new Error('escopo antigo'))

  await drained
  await coordinator.request()
  assert.equal(refreshCalls, 1)
  assert.equal(failureCalls, 0)
})
