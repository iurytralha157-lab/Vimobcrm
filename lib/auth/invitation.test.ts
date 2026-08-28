import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import {
  createInvitationPath,
  getInvitationLookupState,
  isConfirmedInvitationAcceptance,
  isInvitationLookupRetryable,
  normalizeInvitationToken,
} from './invitation'

const TOKEN = 'a'.repeat(64)
const invitationScreenSource = readFileSync(
  'components/features/auth/invitation-screen.tsx',
  'utf8',
)

test('aceita somente o token canonico realmente gerado pelo backend', () => {
  assert.equal(normalizeInvitationToken(TOKEN), TOKEN)
  assert.equal(createInvitationPath(TOKEN), `/convite/${TOKEN}`)

  for (const invalid of [
    '',
    'a'.repeat(63),
    'a'.repeat(65),
    'A'.repeat(64),
    ` ${TOKEN}`,
    `${TOKEN} `,
    `${'a'.repeat(63)}/`,
    'g'.repeat(64),
  ]) {
    assert.equal(normalizeInvitationToken(invalid), null, invalid)
    assert.equal(createInvitationPath(invalid), null, invalid)
  }
})

test('distingue link invalido, convite expirado e servico indisponivel', () => {
  assert.equal(getInvitationLookupState({ token: 'curto', hasInvitation: false, isPending: false, error: null }), 'invalid')
  assert.equal(getInvitationLookupState({ token: TOKEN, hasInvitation: false, isPending: true, error: null }), 'loading')
  assert.equal(getInvitationLookupState({ token: TOKEN, hasInvitation: true, isPending: false, error: null }), 'available')
  assert.equal(getInvitationLookupState({ token: TOKEN, hasInvitation: false, isPending: false, error: null }), 'expired')
  assert.equal(getInvitationLookupState({ token: TOKEN, hasInvitation: false, isPending: false, error: { status: 503 } }), 'unavailable')
})

test('repete automaticamente apenas falhas transitorias de consulta', () => {
  assert.equal(isInvitationLookupRetryable({ status: 0, code: 'api_unavailable' }), true)
  assert.equal(isInvitationLookupRetryable({ status: 429, code: 'api_error' }), true)
  assert.equal(isInvitationLookupRetryable({ status: 503, code: 'api_error' }), true)
  assert.equal(isInvitationLookupRetryable({ status: 404, code: 'admin_resource_not_found' }), false)
  assert.equal(isInvitationLookupRetryable(new Error('entrada invalida')), false)
})

test('so considera o convite confirmado quando o aceite terminou no backend', () => {
  assert.equal(isConfirmedInvitationAcceptance({ success: true, requiresLogin: false }), true)
  assert.equal(isConfirmedInvitationAcceptance({ success: false, requiresLogin: true }), false)
  assert.equal(isConfirmedInvitationAcceptance({ success: true, requiresLogin: true }), false)
  assert.equal(isConfirmedInvitationAcceptance(null), false)
})

test('links juridicos do convite nao alternam o consentimento do checkbox', () => {
  const helperStart = invitationScreenSource.indexOf('function InvitationConsentCheckbox')
  const helperEnd = invitationScreenSource.indexOf('export function InvitationScreen')

  assert.notEqual(helperStart, -1)
  assert.notEqual(helperEnd, -1)

  const consentHelper = invitationScreenSource.slice(helperStart, helperEnd)
  assert.doesNotMatch(consentHelper, /<label(?:(?!<\/label>)[\s\S])*<Link/)
  assert.equal(
    invitationScreenSource.match(/<InvitationConsentCheckbox\b/g)?.length,
    4,
  )
  assert.match(consentHelper, /href=\{href\}/)
  assert.match(consentHelper, /target="_blank"/)
  assert.match(consentHelper, /rel="noopener noreferrer"/)
})

test('superficie ativa do convite preserva o contrato visual da Home', () => {
  assert.doesNotMatch(invitationScreenSource, /#[0-9a-f]{3,8}\b/i)
  assert.doesNotMatch(invitationScreenSource, /\bbg-(?:black|white)(?:\/(?:\[[^\]]+\]|\d+))?/)
  assert.doesNotMatch(invitationScreenSource, /\bbackdrop-blur/)
  assert.doesNotMatch(invitationScreenSource, /\bshadow-(?:lg|xl|2xl)\b|shadow-\[/)
  assert.doesNotMatch(
    invitationScreenSource,
    /\brounded-(?:xl|2xl|3xl)\b|rounded-\[(?:1[0-9]|[2-9][0-9])px\]/,
  )
  assert.doesNotMatch(
    invitationScreenSource,
    /\bfont-(?:thin|extralight|medium|semibold|bold|extrabold|black)\b|\buppercase\b|\btracking-(?:wide|wider|widest)\b/,
  )
})
