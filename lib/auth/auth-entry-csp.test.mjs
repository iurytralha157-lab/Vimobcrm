import assert from 'node:assert/strict'
import test from 'node:test'
import { unstable_getResponseFromNextConfig } from 'next/experimental/testing/server.js'
import nextConfig from '../../next.config.ts'

const privateAuthPaths = [
  '/reset-password?code=synthetic',
  '/confirmar-email', '/convite/synthetic', '/checkout/synthetic',
  '/checkout/organizacao/synthetic',
]

const authEntryPaths = ['/login', '/cadastro', '/onboarding', ...privateAuthPaths]
const privateLinkPaths = [...privateAuthPaths, '/comprovantes/synthetic']

async function headersFor(path) {
  const response = await unstable_getResponseFromNextConfig({
    url: `https://vimob.test${path}`, nextConfig,
  })
  return response.headers
}

test('auth and checkout block inline event attributes and keep script elements in report-only mode', async () => {
  for (const path of authEntryPaths) {
    const headers = await headersFor(path)
    assert.equal(headers.get('x-frame-options'), 'DENY', path)
    assert.equal(headers.get('x-content-type-options'), 'nosniff', path)
    assert.equal(headers.get('content-security-policy'), "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; script-src-attr 'none'", path)
    assert.equal(headers.get('content-security-policy-report-only'), "script-src 'self'", path)
  }
})

test('private auth and checkout links preserve cache and referrer headers', async () => {
  for (const path of privateLinkPaths) {
    const headers = await headersFor(path)
    assert.equal(headers.get('referrer-policy'), 'no-referrer', path)
    assert.equal(headers.get('cache-control'), 'private, no-store, max-age=0, must-revalidate', path)
    assert.equal(headers.get('pragma'), 'no-cache', path)
  }
})

test('admin, public routes, webhooks and the service worker keep their own policies', async () => {
  for (const [path, policy] of [
    ['/admin', "frame-ancestors 'none'"],
    ['/admin/usuarios', "frame-ancestors 'none'"],
    ['/sw.js', "default-src 'self'; script-src 'self'"],
    ['/termos-de-uso', null],
    ['/api/onboarding/signup', null],
  ]) {
    const headers = await headersFor(path)
    assert.equal(headers.get('content-security-policy'), policy, path)
    assert.equal(headers.get('content-security-policy-report-only'), null, path)
  }
})
