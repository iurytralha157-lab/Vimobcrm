import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

import ts from 'typescript'

const clientSourcePath = new URL('./vimob-client.ts', import.meta.url)
const authContextSourcePath = new URL('../../contexts/AuthContext.tsx', import.meta.url)

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
        url: String(url),
      })
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
      if (specifier === '@/integrations/supabase/client') return { supabase }
      if (specifier === '@/lib/api/vimob-error') {
        return {
          VimobAPIError: TestVimobAPIError,
          getTechnicalErrorMessage: (error) => error.message,
        }
      }
      if (specifier === '@/lib/auth/password-recovery') {
        return { isPasswordRecoveryAccessToken }
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
