import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

import ts from 'typescript'
import { z } from 'zod'

const clientSourcePath = process.env.VIMOB_CLIENT_TEST_SOURCE || new URL('./vimob-client.ts', import.meta.url)
const authContextSourcePath = new URL('../../contexts/AuthContext.tsx', import.meta.url)
const globalSignOutSourcePath = new URL('../auth/global-sign-out.ts', import.meta.url)

// Use the same public JWT-session parser as the request boundary. The generic
// tests deliberately keep their legacy opaque tokens when no SID is pinned.
const globalSignOutModule = { exports: {} }
vm.runInNewContext(ts.transpileModule(readFileSync(globalSignOutSourcePath, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  fileName: 'global-sign-out.ts',
}).outputText, {
  atob, exports: globalSignOutModule.exports, module: globalSignOutModule,
}, { filename: 'global-sign-out.js' })

class TestVimobAPIError extends Error {
  constructor(message, options) {
    super(message)
    this.name = 'VimobAPIError'
    this.code = options.code
    this.status = options.status
    this.requestId = options.requestId
  }
}

function authResult(session, error = null) {
  return { data: { session }, error }
}

function session(token, userId) {
  return {
    access_token: token,
    user: { id: userId },
  }
}

function deferred() {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function loadVimobClient({
  getSession,
  refreshSession,
  isPasswordRecoveryAccessToken = () => false,
  shouldBlockLocalMutation = () => false,
  fetchResponse,
}) {
  const fetchCalls = []
  const source = readFileSync(clientSourcePath, 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: 'vimob-client.ts',
  }).outputText

  const supabase = {
    auth: {
      getSession,
      refreshSession,
    },
  }
  const moduleRecord = { exports: {} }
  const sandbox = {
    AbortController,
    DOMException,
    FormData,
    Headers,
    Request,
    Response,
    URL,
    clearTimeout,
    console,
    exports: moduleRecord.exports,
    fetch: async (url, init) => {
      const headers = new Headers(init?.headers)
      fetchCalls.push({
        authorization: headers.get('Authorization'),
        keepalive: init?.keepalive ?? false,
        url: String(url),
      })
      if (fetchResponse) return fetchResponse(url, init, fetchCalls.length)
      return new Response('{"ok":true}', {
        headers: { 'Content-Type': 'application/json' },
        status: 200,
      })
    },
    module: moduleRecord,
    process: {
      env: {
        NEXT_PUBLIC_VIMOB_API_URL: 'https://api.example.test',
        NODE_ENV: 'production',
      },
    },
    require: (specifier) => {
      if (specifier === '@/lib/supabase/client') return { supabase }
      if (specifier === '@/lib/auth/global-sign-out') return globalSignOutModule.exports
      if (specifier === '@/lib/api/vimob-error') {
        return {
          VimobAPIError: TestVimobAPIError,
          getTechnicalErrorMessage: (error) => error.message,
        }
      }
      if (specifier === '@/lib/auth/password-recovery') {
        return { isPasswordRecoveryAccessToken }
      }
      if (specifier === '@/lib/local-read-only') {
        return {
          LOCAL_READ_ONLY_ERROR_CODE: 'local_read_only',
          LOCAL_READ_ONLY_ERROR_MESSAGE:
            'Este ambiente local usa dados reais somente para consulta. Alterações estão bloqueadas.',
          shouldBlockLocalMutation,
        }
      }
      if (specifier === '@/lib/utils/json') {
        return {
          parseJSONOrNull: (value) => {
            try {
              return JSON.parse(value)
            } catch {
              return null
            }
          },
        }
      }
      throw new Error(`Unexpected test import: ${specifier}`)
    },
    setTimeout,
  }

  vm.runInNewContext(compiled, sandbox, { filename: 'vimob-client.js' })

  return {
    client: moduleRecord.exports,
    fetchCalls,
  }
}

test('serializa campanhas repetidas sem dividir IDs que contêm vírgula', () => {
  const { client } = loadVimobClient({
    getSession: async () => authResult(null),
    refreshSession: async () => authResult(null),
  })
  const url = new URL(client.buildAPIURL('/v1/dashboard/stats', {
    campaignIds: ['Promo, Setembro', 'promo', 'Promo, Setembro'],
    pageId: 'page-1',
  }))

  assert.deepEqual(url.searchParams.getAll('campaignIds'), [
    'Promo, Setembro', 'promo', 'Promo, Setembro',
  ])
  assert.equal(url.searchParams.get('pageId'), 'page-1')
  assert.equal(url.searchParams.has('campaignId'), false)
})

test('troca de identidade substitui o token usado pela API imediatamente', async () => {
  let getSessionCalls = 0
  const { client, fetchCalls } = loadVimobClient({
    getSession: async () => {
      getSessionCalls += 1
      return authResult(null)
    },
    refreshSession: async () => authResult(null),
  })

  client.setVimobAPIAccessToken('token-user-a', 'user-a')
  await client.vimobAPIRequest('/v1/test-a', { retry: false, skipTelemetry: true })

  client.setVimobAPIAccessToken('token-user-b', 'user-b')
  await client.vimobAPIRequest('/v1/test-b', { retry: false, skipTelemetry: true })

  assert.equal(getSessionCalls, 0)
  assert.deepEqual(
    fetchCalls.map((call) => call.authorization),
    ['Bearer token-user-a', 'Bearer token-user-b'],
  )
})

test('public request forwards keepalive for lifecycle analytics flushes', async () => {
  const { client, fetchCalls } = loadVimobClient({
    getSession: async () => authResult(null),
    refreshSession: async () => authResult(null),
  })

  await client.vimobPublicAPIRequest('/v1/public/tracking/events', {
    body: { event_type: 'page_duration' },
    keepalive: true,
    method: 'POST',
  })

  assert.equal(fetchCalls.length, 1)
  assert.equal(fetchCalls[0].keepalive, true)
})

test('resolucao antiga nao repopula o cache nem envia token da sessao anterior', async () => {
  const firstSession = deferred()
  let getSessionCalls = 0
  const { client, fetchCalls } = loadVimobClient({
    getSession: async () => {
      getSessionCalls += 1
      return firstSession.promise
    },
    refreshSession: async () => authResult(null),
  })

  const request = client.vimobAPIRequest('/v1/during-switch', {
    retry: false,
    skipTelemetry: true,
  })
  await Promise.resolve()

  client.setVimobAPIAccessToken('token-user-b', 'user-b')
  firstSession.resolve(authResult(session('token-user-a', 'user-a')))

  await request
  await client.vimobAPIRequest('/v1/after-switch', {
    retry: false,
    skipTelemetry: true,
  })

  assert.equal(getSessionCalls, 1)
  assert.deepEqual(
    fetchCalls.map((call) => call.authorization),
    ['Bearer token-user-b', 'Bearer token-user-b'],
  )
})

test('ausencia de sessao invalida uma resolucao antiga antes do fetch', async () => {
  const firstSession = deferred()
  let getSessionCalls = 0
  const { client, fetchCalls } = loadVimobClient({
    getSession: async () => {
      getSessionCalls += 1
      if (getSessionCalls === 1) return firstSession.promise
      return authResult(null)
    },
    refreshSession: async () => authResult(null),
  })

  const request = client.vimobAPIRequest('/v1/after-sign-out', {
    retry: false,
    skipTelemetry: true,
  })
  await Promise.resolve()

  client.setVimobAPIAccessToken(null, null)
  firstSession.resolve(authResult(session('token-user-a', 'user-a')))

  await assert.rejects(request, (error) => error?.code === 'missing_session')
  assert.equal(fetchCalls.length, 0)
})

test('AuthContext sincroniza cada evento e protege o resultado inicial atrasado', () => {
  const source = readFileSync(authContextSourcePath, 'utf8')
  const listenerStart = source.indexOf('supabase.auth.onAuthStateChange')
  const listenerEnd = source.indexOf('return () => {', listenerStart)
  const listener = source.slice(listenerStart, listenerEnd)
  const syncIndex = listener.indexOf('setVimobAPIAccessToken(')

  assert.ok(syncIndex >= 0, 'auth listener must synchronize the API token')
  for (const event of [
    'INITIAL_SESSION',
    'SIGNED_IN',
    'SIGNED_OUT',
    'USER_UPDATED',
    'TOKEN_REFRESHED',
  ]) {
    assert.ok(
      syncIndex < listener.indexOf(`'${event}'`),
      `API token must be synchronized before handling ${event}`,
    )
  }
  assert.match(
    source,
    /const clearAllStates = \(\) => \{[\s\S]*?setVimobAPIAccessToken\(null, null\);/,
  )
  assert.match(
    source,
    /if \(initialAPITokenGeneration === apiTokenAuthEventGeneration\) \{[\s\S]*?setVimobAPIAccessToken\(session\.access_token, session\.user\.id\);/,
  )
  assert.doesNotMatch(
    listener.slice(Math.max(0, syncIndex - 20), syncIndex + 180),
    /await\s+setVimobAPIAccessToken/,
  )
})

test('sessao recovery acessa somente o POST exato de troca de senha', async () => {
  const { client, fetchCalls } = loadVimobClient({
    getSession: async () => authResult(null),
    refreshSession: async () => authResult(null),
    isPasswordRecoveryAccessToken: (token) => token === 'recovery-token',
  })

  client.setVimobAPIAccessToken('recovery-token', 'recovery-user')

  await assert.rejects(
    () => client.vimobAPIRequest('/v1/settings/password', { retry: false, skipTelemetry: true }),
    (error) => error?.code === 'recovery_session_restricted' && error?.status === 403,
  )
  await assert.rejects(
    () => client.vimobAPIRequest('/v1/leads', { method: 'POST', retry: false, skipTelemetry: true }),
    (error) => error?.code === 'recovery_session_restricted' && error?.status === 403,
  )

  await client.vimobAPIRequest('/v1/settings/password', {
    body: { password: 'new-password', source: 'recovery' },
    method: 'POST',
    retry: false,
    skipTelemetry: true,
  })

  assert.equal(fetchCalls.length, 1)
  assert.match(fetchCalls[0].url, /\/v1\/settings\/password$/)
})

test('expected user blocks a POST if deferred authentication changes fromA toB', async () => {
  const pending = deferred()
  const { client, fetchCalls } = loadVimobClient({ getSession: () => pending.promise, refreshSession: async () => authResult(null) })
  const request = client.vimobAPIRequest('/v1/whatsapp/send-synthetic', {
    method: 'POST', body: { text: 'DraftA' }, expectedUserId: 'user-a', retry: false, skipTelemetry: true,
  })
  await Promise.resolve()
  client.setVimobAPIAccessToken('token-user-b', 'user-b')
  pending.resolve(authResult(session('token-user-a', 'user-a')))
  await assert.rejects(request, error => error?.status === 409 && error.code === 'api_request_identity_changed')
  assert.equal(fetchCalls.length, 0)
})

test('expected user blocks a second POST if401 refresh changes fromA toB', async () => {
  const pending = deferred(), started = deferred()
  const { client, fetchCalls } = loadVimobClient({ getSession: async () => authResult(null),
    refreshSession: () => { started.resolve(); return pending.promise },
    fetchResponse: (_url, _options, call) => new Response(call === 1 ? '{"error":{"code":"invalid_token"}}' : '{"ok":true}', { status: call === 1 ? 401 : 200 }),
  })
  client.setVimobAPIAccessToken('token-user-a', 'user-a')
  const request = client.vimobAPIRequest('/v1/whatsapp/send-synthetic', {
    method: 'POST', body: { text: 'DraftA' }, expectedUserId: 'user-a', retry: false, skipTelemetry: true,
  })
  await started.promise
  client.setVimobAPIAccessToken('token-user-b', 'user-b')
  pending.resolve(authResult(session('token-user-a-renewed', 'user-a')))
  await assert.rejects(request, error => error?.status === 409 && error.code === 'api_request_identity_changed')
  assert.deepEqual(fetchCalls.map(call => call.authorization), ['Bearer token-user-a'])
})

test('expected user permits a renewed token for the same actor after401', async () => {
  let starts = 0
  const { client, fetchCalls } = loadVimobClient({ getSession: async () => authResult(null),
    refreshSession: async () => authResult(session('token-user-a-renewed', 'user-a')),
    fetchResponse: (_url, _options, call) => new Response('{"ok":true}', { status: call === 1 ? 401 : 200 }),
  })
  client.setVimobAPIAccessToken('token-user-a', 'user-a')
  await client.vimobAPIRequest('/v1/whatsapp/send-synthetic', { method: 'POST', expectedUserId: 'user-a', retry: false, skipTelemetry: true, onRequestStart: () => { starts += 1 } })
  assert.deepEqual(fetchCalls.map(call => call.authorization), ['Bearer token-user-a', 'Bearer token-user-a-renewed'])
  assert.equal(starts, 2)
})

test('no expected user preserves the generic401 refresh identity behavior', async () => {
  const pending = deferred(), started = deferred()
  const { client, fetchCalls } = loadVimobClient({ getSession: async () => authResult(null),
    refreshSession: () => { started.resolve(); return pending.promise },
    fetchResponse: (_url, _options, call) => new Response('{"ok":true}', { status: call === 1 ? 401 : 200 }),
  })
  client.setVimobAPIAccessToken('token-user-a', 'user-a')
  const request = client.vimobAPIRequest('/v1/generic-synthetic', { method: 'POST', retry: false, skipTelemetry: true })
  await started.promise
  client.setVimobAPIAccessToken('token-user-b', 'user-b')
  pending.resolve(authResult(session('token-user-a-renewed', 'user-a')))
  await request
  assert.deepEqual(fetchCalls.map(call => call.authorization), ['Bearer token-user-a', 'Bearer token-user-b'])
})

test('onRequestStart can cancel a stale gesture before the actual HTTP boundary', async () => {
  const { client, fetchCalls } = loadVimobClient({ getSession: async () => authResult(null), refreshSession: async () => authResult(null) })
  client.setVimobAPIAccessToken('token-user-a', 'user-a')
  let starts = 0
  await assert.rejects(client.vimobAPIRequest('/v1/whatsapp/send-synthetic', {
    method: 'POST', expectedUserId: 'user-a', retry: false, skipTelemetry: true,
    onRequestStart: () => { starts += 1; throw new TestVimobAPIError('Gesture changed', { status: 409, code: 'synthetic_scope_changed' }) },
  }), error => error?.code === 'synthetic_scope_changed')
  assert.equal(starts, 1)
  assert.equal(fetchCalls.length, 0)
})

function managementJWT(userId, sessionId, marker = '') {
  return `${Buffer.from('{}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: userId, session_id: sessionId, marker })).toString('base64url')}.signature`
}

function loadManagementModule(name, imports) {
  const record = { exports: {} }
  const source = ts.transpileModule(readFileSync(new URL(name, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }, fileName: name,
  }).outputText
  vm.runInNewContext(source, {
    exports: record.exports, module: record, URL, AbortController, FormData,
    require(specifier) {
      if (Object.hasOwn(imports, specifier)) return imports[specifier]
      throw new Error(`Unexpected management test import: ${specifier}`)
    },
  }, { filename: name })
  return record.exports
}

function managementDomain(name, client) {
  const request = loadManagementModule('management-request.ts', {
    '@/lib/api/vimob-client': client, '@/lib/api/vimob-error': { VimobAPIError: TestVimobAPIError },
  })
  // This is a transport test. Domain validation has its own real-schema tests;
  // bypass only validation here to exercise the actual domain calls and retry.
  const validation = new Proxy({}, { get: (_target, key) => {
    if (key === 'parseDomainInput') return (_schema, input) => input
    if (key === 'validateDomainResponse') return (_schema, response) => response
    return undefined
  } })
  return loadManagementModule(name, {
    './vimob-client': client, '@/lib/api/management-request': request,
    '@/lib/validation': validation,
    '@/lib/validation/tag-catalog': loadManagementModule('../validation/tag-catalog.ts', {
      zod: { z },
      '@/lib/validation/common': loadManagementModule('../validation/common.ts', { zod: { z } }),
    }),
    '@/lib/teams/member-availability-batches': { chunkUniqueTeamMemberIDs: ids => [ids] },
    '@/lib/pipeline-reliability': { PIPELINE_READ_TIMEOUT_MS: 1000 },
    '@/lib/client-id': { createUUID: () => '11111111-1111-4111-8111-111111111111' },
  })
}

test('actual management PATCH/PUT/DELETE calls cannot retry as another actor or login session', async (t) => {
  const sidA = '11111111-1111-4111-8111-111111111111'
  const sidB = '22222222-2222-4222-8222-222222222222'
  const calls = [
    ['teams.ts', api => api.teamsAPI.updateTeam({ id: sidA, name: 'Team', expected_revision: 1 }, sidA)],
    ['teams.ts', api => api.teamsAPI.replaceMemberAvailability({ teamMemberId: sidA, expected_revision: 1, availability: [] }, sidA)],
    ['round-robins.ts', api => api.roundRobinsAPI.updateRoundRobin(sidA, { name: 'Queue', expectedRevision: 1 }, sidA)],
    ['tags.ts', api => api.tagsAPI.delete(sidA, '2026-10-13T00:00:00Z', sidA)],
  ]
  for (const nextUser of ['user-b', 'user-a']) for (const [name, invoke] of calls) {
    await t.test(`${name} -> ${nextUser} new session`, async () => {
      const refresh = deferred()
      const { client, fetchCalls } = loadVimobClient({
        getSession: async () => authResult(null), refreshSession: () => refresh.promise,
        fetchResponse: () => new Response('{"error":{"code":"invalid_token"}}', { status: 401 }),
      })
      client.setVimobAPIAccessToken(managementJWT('user-a', sidA), 'user-a')
      const request = invoke(managementDomain(name, client))
      while (fetchCalls.length === 0) await new Promise(resolve => setTimeout(resolve, 0))
      client.setVimobAPIAccessToken(managementJWT(nextUser, sidB), nextUser)
      refresh.resolve(authResult(session(managementJWT(nextUser, sidB, 'refreshed'), nextUser)))
      await assert.rejects(request, error => error?.code === 'api_request_identity_changed')
      assert.equal(fetchCalls.length, 1)
    })
  }
})

test('management accepts token renewal in the original session and rejects stale successful completion', async () => {
  const sidA = '11111111-1111-4111-8111-111111111111'
  const result = deferred()
  const { client, fetchCalls } = loadVimobClient({
    getSession: async () => authResult(null),
    refreshSession: async () => authResult(session(managementJWT('user-a', sidA, 'renewed'), 'user-a')),
    fetchResponse: (_url, _init, count) => count === 1 ? new Response('{}', { status: 401 }) : result.promise,
  })
  client.setVimobAPIAccessToken(managementJWT('user-a', sidA), 'user-a')
  const api = loadManagementModule('management-request.ts', {
    '@/lib/api/vimob-client': client, '@/lib/api/vimob-error': { VimobAPIError: TestVimobAPIError },
  })
  const request = api.managementAPIRequest('/v1/tags', { method: 'POST', skipTelemetry: true })
  while (fetchCalls.length < 2) await new Promise(resolve => setTimeout(resolve, 0))
  client.setVimobAPIAccessToken(managementJWT('user-b', '22222222-2222-4222-8222-222222222222'), 'user-b')
  result.resolve(new Response('{"ok":true}', { status: 200 }))
  await assert.rejects(request, error => error?.code === 'api_request_identity_changed')
  assert.equal(fetchCalls.length, 2)
})
