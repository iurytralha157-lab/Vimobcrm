import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

const compile = path => ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const recoveryCode = compile('../auth/password-recovery.ts')
const transportCode = compile('../auth/password-recovery-transport.ts')
const clientCode = compile('./client.ts')

function loadClient(browser) {
  let sdkCreations = 0
  let sdkOptions
  const globals = {
    URL,
    URLSearchParams,
    Request,
    atob,
    ...(browser ? { window: browser } : {}),
    fetch: () => { throw new Error('Network is forbidden in this regression test') },
    process: { env: {
      NEXT_PUBLIC_SUPABASE_URL: 'https://synthetic.supabase.co',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'synthetic-public-key',
    } },
  }
  const recovery = { ...globals, exports: {}, require: () => ({ isProtectedAppPath: () => false }) }
  vm.runInNewContext(recoveryCode, recovery)
  const transport = { ...globals, exports: {}, AbortController, DOMException, Response, setTimeout, clearTimeout }
  vm.runInNewContext(transportCode, transport)
  const client = {
    ...globals,
    exports: {},
    require: id => {
      if (id === '@supabase/ssr') return { createBrowserClient: (_url, _key, options) => {
        sdkCreations += 1
        sdkOptions = options
        return { auth: {} }
      } }
      if (id === '@/lib/auth/password-recovery') return recovery.exports
      if (id === '@/lib/auth/password-recovery-transport') return transport.exports
      if (id === '@/lib/local-read-only') return {
        shouldBlockLocalMutation: () => false,
        isSupabaseAuthenticationRequest: () => true,
      }
      throw new Error(`Unexpected dependency: ${id}`)
    },
  }
  vm.runInNewContext(clientCode, client)
  return { client: client.exports, sdkCreations, sdkOptions }
}

test('initialization never captures a recovery URL into the shared session or touches sessionStorage', () => {
  let getterReads = 0
  const browser = {
    location: { href: 'https://app.test/reset-password?code=synthetic-code' },
    get sessionStorage() {
      getterReads += 1
      throw new DOMException('Browser storage denied', 'SecurityError')
    },
  }
  const result = loadClient(browser)
  assert.equal(result.sdkCreations, 1)
  assert.equal(result.client.createClient(), result.client.supabase)
  assert.equal(result.sdkOptions.auth.detectSessionInUrl, false)
  assert.equal(getterReads, 0)
})

test('server initialization does not access browser storage or register browser listeners', () => {
  const result = loadClient()
  assert.equal(result.sdkCreations, 1)
  assert.equal(result.sdkOptions.auth.detectSessionInUrl, false)
})

test('existing email confirmation callbacks retain SDK URL handling', () => {
  const result = loadClient({ location: { href: 'https://app.test/login?emailConfirmation=success' } })
  assert.equal(result.sdkOptions.auth.detectSessionInUrl, true)
})
