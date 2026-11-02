import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import { NextRequest, NextResponse } from 'next/server.js'
import ts from 'typescript'

// Run the real proxy, policy and Next response handling without a provider.
const repo = new URL('../../', import.meta.url)
const releaseSha = 'a'.repeat(40)
function load(relative, dependencies = {}) {
  const record = { exports: {} }
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL(relative, repo), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    module: record, exports: record.exports, URL, URLSearchParams,
    process: { env: {
      NEXT_PUBLIC_VIMOB_RELEASE_SHA: releaseSha,
      NEXT_PUBLIC_SUPABASE_URL: 'https://synthetic.supabase.co',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'synthetic-public-key',
    } },
    require: name => {
      assert(name in dependencies, `Unexpected dependency: ${name}`)
      return dependencies[name]
    },
  })
  return record.exports
}
const postLogin = load('lib/auth/post-login-redirect.ts')
const recovery = load('lib/auth/password-recovery.ts', { './post-login-redirect': postLogin })
const release = load('config/release.ts')

function harness(claims) {
  const calls = []
  const { proxy } = load('proxy.ts', {
    '@supabase/ssr': { createServerClient: (_url, _key, options) => ({ auth: {
      getClaims: async () => {
        calls.push('getClaims')
        options.cookies.setAll([
          { name: 'synthetic-session', value: 'synthetic-refreshed', options: { path: '/', httpOnly: true } },
        ], { 'cache-control': 'private, no-store' })
        return { data: { claims } }
      },
      signOut: async () => { calls.push('signOut'); throw new Error('Unexpected session revocation') },
    } }) },
    'next/server': { NextResponse },
    '@/config/constants': { DEFAULT_AUTHENTICATED_ROUTE: '/inicio' },
    '@/config/release': release,
    '@/lib/auth/post-login-redirect': postLogin,
    '@/lib/auth/password-recovery': recovery,
  })
  return {
    calls,
    request: (path, method = 'GET') => proxy(new NextRequest(`https://app.test${path}`, { method })),
  }
}

const recoveryClaims = { sub: 'synthetic-user', amr: [{ method: 'recovery' }] }
test('passive public auth and protected requests preserve recovery instead of requesting cancellation', async () => {
  const h = harness(recoveryClaims)
  for (const method of ['GET', 'HEAD']) {
    for (const path of ['/login', '/login?passwordReset=success', '/cadastro', '/onboarding', '/dashboard', '/settings/account']) {
      const response = await h.request(path, method)
      assert.equal(response.status, 307)
      assert.equal(response.headers.get('location'), 'https://app.test/reset-password')
      assert.equal(response.cookies.get('synthetic-session')?.value, 'synthetic-refreshed')
      assert.equal(response.headers.get('cache-control'), 'private, no-store')
      assert.equal(response.headers.get('x-vimob-release-sha'), releaseSha)
    }
  }
  assert(h.calls.every(call => call === 'getClaims'))
})

test('recovery redirects discard cancellation parameters supplied on a public auth URL', async () => {
  const h = harness(recoveryClaims)
  const response = await h.request('/login?cancel=1&next=%2Fcadastro')
  assert.equal(response.headers.get('location'), 'https://app.test/reset-password')
  assert.deepEqual(h.calls, ['getClaims'])
})

test('recovery reaches reset and legal pages without a redirect loop', async () => {
  const h = harness(recoveryClaims)
  for (const path of ['/reset-password', '/reset-password?code=synthetic-code', '/termos-de-uso', '/politica-de-privacidade']) {
    const response = await h.request(path)
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('location'), null)
    assert.equal(response.headers.get('x-middleware-next'), '1')
  }
  const first = await h.request('/login')
  const nextPath = new URL(first.headers.get('location')).pathname
  assert.equal((await h.request(nextPath)).headers.get('location'), null)
})

for (const method of ['password', 'otp']) {
  test(`normal ${method} claims keep the existing login and protected route behavior`, async () => {
    const h = harness({ sub: 'synthetic-user', amr: [{ method }] })
    for (const path of ['/login', '/cadastro', '/onboarding']) {
      assert.equal((await h.request(path)).headers.get('location'), 'https://app.test/inicio')
    }
    for (const path of ['/dashboard', '/reset-password', '/termos-de-uso', '/politica-de-privacidade']) {
      assert.equal((await h.request(path)).headers.get('location'), null)
    }
    assert(h.calls.every(call => call === 'getClaims'))
  })
}

test('unauthenticated protected requests still require login and public pages remain available', async () => {
  const h = harness(null)
  const response = await h.request('/dashboard?view=synthetic')
  const destination = new URL(response.headers.get('location'))
  assert.equal(destination.pathname, '/login')
  assert.equal(destination.searchParams.get('redirectTo'), '/dashboard?view=synthetic')
  for (const path of ['/login', '/reset-password', '/termos-de-uso']) {
    assert.equal((await h.request(path)).headers.get('location'), null)
  }
})
