import assert from 'node:assert/strict'
import test from 'node:test'

import {
  isLocalReadOnlyMode,
  isSupabaseAuthenticationRequest,
  shouldBlockLocalMutation,
  shouldPersistOrganizationSelectionRemotely,
} from './local-read-only'

test('local read-only mode is explicit and opt-in', () => {
  assert.equal(isLocalReadOnlyMode(undefined), false)
  assert.equal(isLocalReadOnlyMode('false'), false)
  assert.equal(isLocalReadOnlyMode(' TRUE '), true)
})

test('local read-only mode blocks mutations but preserves reads', () => {
  assert.equal(shouldBlockLocalMutation(undefined, true), false)
  assert.equal(shouldBlockLocalMutation('GET', true), false)
  assert.equal(shouldBlockLocalMutation('HEAD', true), false)
  assert.equal(shouldBlockLocalMutation('POST', true), true)
  assert.equal(shouldBlockLocalMutation('PATCH', true), true)
  assert.equal(shouldBlockLocalMutation('DELETE', true), true)
  assert.equal(shouldBlockLocalMutation('POST', false), false)
})

test('organization selection stays client-side only in local read-only mode', () => {
  assert.equal(shouldPersistOrganizationSelectionRemotely(true), false)
  assert.equal(shouldPersistOrganizationSelectionRemotely(false), true)
})

test('Supabase authentication remains available in read-only local mode', () => {
  assert.equal(
    isSupabaseAuthenticationRequest('https://example.supabase.co/auth/v1/token?grant_type=refresh_token'),
    true,
  )
  assert.equal(
    isSupabaseAuthenticationRequest('https://example.supabase.co/rest/v1/properties'),
    false,
  )
})
