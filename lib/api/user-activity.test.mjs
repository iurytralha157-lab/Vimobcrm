import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

import ts from 'typescript'

const SESSION_INPUT = {
  organizationId: '25415af4-ee44-4b0d-a1a6-895699450251',
  userId: 'f4e86159-26f4-4420-ad63-36683fa45bca',
  sessionId: 'activity-recovery-session',
  status: 'online',
}

function loadUserActivityModule(fakeSupabase) {
  const source = readFileSync(new URL('./user-activity.ts', import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: 'user-activity.ts',
  }).outputText
  const commonJSModule = { exports: {} }
  const validationStub = {
    auditFeedEventPayloadSchema: {},
    parseDomainInput: (_schema, input) => input,
    userActivitySessionMutationInputSchema: {},
    uuidSchema: {},
  }
  const requireStub = (specifier) => {
    if (specifier === '@/lib/supabase/client') {
      return { supabase: fakeSupabase }
    }
    if (specifier === '@/lib/validation') {
      return validationStub
    }
    throw new Error(`Unexpected test import: ${specifier}`)
  }

  const wrapper = vm.runInNewContext(
    `(function (exports, require, module) { ${compiled}\n })`,
    { Error, JSON },
  )
  wrapper(commonJSModule.exports, requireStub, commonJSModule)
  return commonJSModule.exports
}

test('heartbeat recupera start sem enviar relogio do cliente ou ler a linha', async () => {
  const calls = []
  const fakeSupabase = {
    from(table) {
      assert.equal(table, 'user_activity_sessions')
      return {
        async upsert(row, options) {
          calls.push({
            row: JSON.parse(JSON.stringify(row)),
            options: { ...options },
          })
          if (calls.length === 1) {
            return {
              data: null,
              error: { message: 'temporary start failure' },
            }
          }
          return { data: null, error: null }
        },
      }
    },
  }
  const {
    startUserActivitySession,
    touchUserActivitySession,
  } = loadUserActivityModule(fakeSupabase)

  await assert.rejects(
    startUserActivitySession(SESSION_INPUT),
    /temporary start failure/,
  )
  assert.equal(await touchUserActivitySession(SESSION_INPUT), undefined)
  assert.equal(
    await touchUserActivitySession({ ...SESSION_INPUT, status: 'idle' }),
    undefined,
  )

  assert.equal(calls.length, 3)
  assert.equal(calls[2].row.status, 'idle')
  for (const call of calls) {
    assert.equal(
      call.options.onConflict,
      'organization_id,user_id,session_id',
    )
    assert.equal(Object.hasOwn(call.row, 'connected_at'), false)
    assert.equal(Object.hasOwn(call.row, 'last_seen_at'), false)
    assert.equal(Object.hasOwn(call.row, 'disconnected_at'), false)
  }
})

test('encerramento grava somente estado e contexto da propria sessao', async () => {
  let updatedRow
  const filters = []
  const updateBuilder = {
    eq(column, value) {
      filters.push([column, value])
      return this
    },
    then(resolve, reject) {
      return Promise.resolve({ data: null, error: null }).then(resolve, reject)
    },
  }
  const fakeSupabase = {
    from(table) {
      assert.equal(table, 'user_activity_sessions')
      return {
        update(row) {
          updatedRow = JSON.parse(JSON.stringify(row))
          return updateBuilder
        },
      }
    },
  }
  const { endUserActivitySession } = loadUserActivityModule(fakeSupabase)

  assert.equal(await endUserActivitySession(SESSION_INPUT), undefined)
  assert.equal(updatedRow.status, 'offline')
  assert.equal(Object.hasOwn(updatedRow, 'connected_at'), false)
  assert.equal(Object.hasOwn(updatedRow, 'last_seen_at'), false)
  assert.equal(Object.hasOwn(updatedRow, 'disconnected_at'), false)
  assert.deepEqual(filters, [
    ['organization_id', SESSION_INPUT.organizationId],
    ['user_id', SESSION_INPUT.userId],
    ['session_id', SESSION_INPUT.sessionId],
  ])
})
