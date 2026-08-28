import assert from 'node:assert/strict'
import test from 'node:test'
import { getValidatedEmailConfirmationURL } from './email-confirmation-link'

function encode(value: string) {
  return Buffer.from(value, 'utf8').toString('base64url')
}

const projectURL = 'https://project.supabase.co'
const appOrigin = 'https://app.vimobcrm.com.br'
const actionURL = `${projectURL}/auth/v1/verify?type=signup&token=0123456789abcdef0123456789abcdef&redirect_to=${encodeURIComponent(`${appOrigin}/login?emailConfirmation=success`)}`

test('landing aceita somente o action link esperado do Supabase', () => {
  const hash = `#confirmation_url=${encode(actionURL)}`
  assert.equal(getValidatedEmailConfirmationURL(hash, projectURL, appOrigin), actionURL)
})

test('landing rejeita origem, redirect, tipo, token ou fragmento ambiguo', () => {
  const cases = [
    actionURL.replace(projectURL, 'https://attacker.example'),
    actionURL.replace('emailConfirmation%3Dsuccess', 'emailConfirmation%3Drequired'),
    actionURL.replace('type=signup', 'type=recovery'),
    actionURL.replace('0123456789abcdef0123456789abcdef', 'short'),
    `${actionURL}&next=https://attacker.example`,
  ]

  for (const value of cases) {
    assert.equal(getValidatedEmailConfirmationURL(`#confirmation_url=${encode(value)}`, projectURL, appOrigin), null)
  }
  assert.equal(
    getValidatedEmailConfirmationURL(
      `#confirmation_url=${encode(actionURL)}&confirmation_url=${encode(actionURL)}`,
      projectURL,
      appOrigin,
    ),
    null,
  )
})
