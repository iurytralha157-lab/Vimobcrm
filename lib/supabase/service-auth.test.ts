import assert from 'node:assert/strict'
import test from 'node:test'
import { createSupabaseServiceFetch, resolveSupabaseServiceKey } from './service-auth'

test('prefers the new server-only Supabase secret key', () => {
  assert.equal(
    resolveSupabaseServiceKey({
      SUPABASE_SECRET_KEY: ' sb_secret_new ',
      SUPABASE_SERVICE_ROLE_KEY: 'legacy.jwt.signature',
    }),
    'sb_secret_new',
  )
  assert.equal(
    resolveSupabaseServiceKey({ SUPABASE_SERVICE_ROLE_KEY: ' legacy.jwt.signature ' }),
    'legacy.jwt.signature',
  )
  assert.throws(() => resolveSupabaseServiceKey({}), /SUPABASE_SECRET_KEY/)
})

test('never sends an opaque Supabase secret as Bearer', async () => {
  let capturedHeaders = new Headers()
  const delegate: typeof fetch = async (_input, init) => {
    capturedHeaders = new Headers(init?.headers)
    return new Response(null, { status: 204 })
  }
  const serviceFetch = createSupabaseServiceFetch('sb_secret_new', delegate)

  await serviceFetch('https://project.supabase.co/rest/v1/rpc/example', {
    headers: { Authorization: 'Bearer sb_secret_new' },
  })

  assert.equal(capturedHeaders.get('apikey'), 'sb_secret_new')
  assert.equal(capturedHeaders.get('Authorization'), null)
})

test('preserves JWT compatibility and real user access tokens', async () => {
  const captures: Headers[] = []
  const delegate: typeof fetch = async (_input, init) => {
    captures.push(new Headers(init?.headers))
    return new Response(null, { status: 204 })
  }

  await createSupabaseServiceFetch('header.payload.signature', delegate)('https://project.supabase.co', {
    headers: { Authorization: 'Bearer header.payload.signature' },
  })
  await createSupabaseServiceFetch('sb_secret_new', delegate)('https://project.supabase.co', {
    headers: { Authorization: 'Bearer user-access-token' },
  })

  assert.equal(captures[0]?.get('Authorization'), 'Bearer header.payload.signature')
  assert.equal(captures[1]?.get('Authorization'), 'Bearer user-access-token')
})
