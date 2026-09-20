import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import {
  capturePasswordRecoveryIntent,
  clearPasswordRecoveryEvidence,
  grantPasswordRecoveryProof,
  hasPasswordRecoveryAuthenticationMethod,
  hasPasswordRecoveryProof,
  isPasswordRecoveryAccessToken,
  isPasswordRecoveryIdentityMatch,
  readPasswordRecoveryUrlEvidence,
  type PasswordRecoveryStorage,
} from './password-recovery'
import { getSafeTelemetryLocation } from './telemetry-location'

const resetPasswordScreenSource = readFileSync(
  'components/features/auth/screens/ResetPasswordScreen.tsx',
  'utf8',
)
const resetPasswordPageSource = readFileSync(
  'app/(auth)/reset-password/page.tsx',
  'utf8',
)
const telemetryProviderSource = readFileSync(
  'components/providers/telemetry-provider.tsx',
  'utf8',
)
const recoveryEmailTemplateSource = readFileSync(
  'supabase/templates/recovery.html',
  'utf8',
)
const supabaseConfigSource = readFileSync('supabase/config.toml', 'utf8')
const selfHostedSupabaseReadmeSource = readFileSync(
  'deploy/supabase-self-hosted/README.md',
  'utf8',
)
const selfHostedAuthEmailComposeSource = readFileSync(
  'deploy/supabase-self-hosted/docker-compose.vimob-auth-email.yml',
  'utf8',
)
const selfHostedAuthEmailEnvExampleSource = readFileSync(
  'deploy/supabase-self-hosted/auth-email.env.example',
  'utf8',
)
const recoveryTemplateLink =
  '{{ .RedirectTo }}?token_hash={{ .TokenHash }}&amp;type=recovery'

function unsignedToken(payload: Record<string, unknown>) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `header.${encoded}.signature`
}

function memoryStorage(): PasswordRecoveryStorage {
  const values = new Map<string, string>()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value) },
    removeItem: (key) => { values.delete(key) },
  }
}

test('recognizes only explicit recovery URL formats on /reset-password', () => {
  assert.deepEqual(
    readPasswordRecoveryUrlEvidence(new URL('https://app.test/reset-password?code=pkce-code')),
    { kind: 'pkce', code: 'pkce-code' },
  )
  assert.deepEqual(
    readPasswordRecoveryUrlEvidence(new URL('https://app.test/reset-password?token_hash=hash&type=recovery')),
    { kind: 'token_hash', tokenHash: 'hash' },
  )
  assert.deepEqual(
    readPasswordRecoveryUrlEvidence(new URL('https://app.test/reset-password#access_token=access&refresh_token=refresh&type=recovery')),
    { kind: 'implicit', accessToken: 'access', refreshToken: 'refresh' },
  )

  assert.deepEqual(
    readPasswordRecoveryUrlEvidence(new URL('https://app.test/reset-password?token_hash=hash&type=email')),
    { kind: 'none' },
  )
  assert.deepEqual(
    readPasswordRecoveryUrlEvidence(new URL('https://app.test/reset-password#access_token=access&refresh_token=refresh&type=signup')),
    { kind: 'none' },
  )
  assert.deepEqual(
    readPasswordRecoveryUrlEvidence(new URL('https://app.test/login?code=pkce-code')),
    { kind: 'none' },
  )
})

test('rejects duplicate, conflicting or oversized recovery credentials', () => {
  const invalidURLs = [
    'https://app.test/reset-password?code=first&code=second',
    'https://app.test/reset-password?token_hash=hash&type=recovery&type=signup',
    'https://app.test/reset-password?code=pkce&token_hash=hash&type=recovery',
    'https://app.test/reset-password?code=pkce#access_token=access&refresh_token=refresh&type=recovery',
    'https://app.test/reset-password#access_token=first&access_token=second&refresh_token=refresh&type=recovery',
    `https://app.test/reset-password?code=${'x'.repeat((4 * 1024) + 1)}`,
    `https://app.test/reset-password#access_token=${'x'.repeat((16 * 1024) + 1)}&refresh_token=refresh&type=recovery`,
  ]

  for (const value of invalidURLs) {
    assert.deepEqual(
      readPasswordRecoveryUrlEvidence(new URL(value)),
      { kind: 'none' },
      value,
    )
  }
})

test('an existing session is never enough without a recovery proof', () => {
  const storage = memoryStorage()
  assert.equal(hasPasswordRecoveryProof(storage, 'existing-user', 1_000), false)
  assert.equal(isPasswordRecoveryIdentityMatch(null, 'existing-user', 'existing-user'), false)
})

test('PASSWORD_RECOVERY proof is granted only after a fresh recovery intent', () => {
  const storage = memoryStorage()
  const now = 10_000

  assert.equal(grantPasswordRecoveryProof(storage, 'user-1', now), false)
  assert.equal(
    capturePasswordRecoveryIntent(
      storage,
      new URL('https://app.test/reset-password?code=recovery-code'),
      now,
    ),
    true,
  )
  assert.equal(grantPasswordRecoveryProof(storage, 'user-1', now + 1), true)
  assert.equal(hasPasswordRecoveryProof(storage, 'user-1', now + 2), true)
  assert.equal(hasPasswordRecoveryProof(storage, 'other-user', now + 2), false)
})

test('recovery proof expires and can be explicitly cleared', () => {
  const storage = memoryStorage()
  const now = 20_000
  capturePasswordRecoveryIntent(
    storage,
    new URL('https://app.test/reset-password?token_hash=hash&type=recovery'),
    now,
  )
  grantPasswordRecoveryProof(storage, 'user-1', now)

  assert.equal(hasPasswordRecoveryProof(storage, 'user-1', now + (15 * 60 * 1000) + 1), false)

  capturePasswordRecoveryIntent(
    storage,
    new URL('https://app.test/reset-password?code=another-code'),
    now,
  )
  grantPasswordRecoveryProof(storage, 'user-1', now)
  clearPasswordRecoveryEvidence(storage)
  assert.equal(hasPasswordRecoveryProof(storage, 'user-1', now), false)
})

test('identity check binds submit to the user authenticated by recovery', () => {
  assert.equal(isPasswordRecoveryIdentityMatch('user-1', 'user-1', 'user-1'), true)
  assert.equal(isPasswordRecoveryIdentityMatch('user-1', 'user-2', 'user-1'), false)
  assert.equal(isPasswordRecoveryIdentityMatch('user-1', 'user-1', 'user-2'), false)
  assert.equal(isPasswordRecoveryIdentityMatch('user-1', null, 'user-1'), false)
})
test('recognizes recovery only from the signed authentication-method claim', () => {
  const recoveryClaims = {
    amr: [
      { method: 'otp', timestamp: 1 },
      { method: 'recovery', timestamp: 2 },
    ],
  }

  assert.equal(hasPasswordRecoveryAuthenticationMethod(recoveryClaims), true)
  assert.equal(isPasswordRecoveryAccessToken(unsignedToken(recoveryClaims)), true)
  assert.equal(isPasswordRecoveryAccessToken(unsignedToken({ amr: [{ method: 'password' }] })), false)
  assert.equal(isPasswordRecoveryAccessToken('not-a-jwt'), false)
  assert.equal(isPasswordRecoveryAccessToken('x'.repeat((16 * 1024) + 1)), false)
})

test('frontend telemetry strips every auth credential and the complete fragment', () => {
  const safeLocation = getSafeTelemetryLocation(new URL(
    'https://app.test/reset-password?code=pkce-secret&token_hash=otp-secret&type=recovery&page=2#access_token=jwt-secret&refresh_token=refresh-secret',
  ))

  assert.deepEqual(safeLocation, {
    url: 'https://app.test/reset-password?page=2',
    origin: 'https://app.test',
    pathname: '/reset-password',
    search: '?page=2',
  })
  assert.doesNotMatch(JSON.stringify(safeLocation), /pkce-secret|otp-secret|jwt-secret|refresh-secret/)
})

test('frontend telemetry uses a strict query allowlist and redacts invitation paths', () => {
  assert.deepEqual(
    getSafeTelemetryLocation(new URL(
      'https://app.test/crm?tab=kanban&view=mine&page=12&redirectTo=%2Fcrm%3Fcode%3Dsecret&search=cliente',
    )),
    {
      url: 'https://app.test/crm?tab=kanban&view=mine&page=12',
      origin: 'https://app.test',
      pathname: '/crm',
      search: '?tab=kanban&view=mine&page=12',
    },
  )

  const invitation = getSafeTelemetryLocation(
    new URL(`https://app.test/convite/${'a'.repeat(64)}?token=secret`),
  )
  assert.equal(invitation.pathname, '/convite/[token]')
  assert.equal(invitation.search, '')
  assert.doesNotMatch(invitation.url, /a{64}|secret/)
})

test('telemetry provider sends only the sanitized browser location', () => {
  assert.match(telemetryProviderSource, /getSafeTelemetryLocation/)
  assert.match(telemetryProviderSource, /url: safeLocation\.url/)
  assert.match(telemetryProviderSource, /search: safeLocation\.search/)
  assert.doesNotMatch(telemetryProviderSource, /url: window\.location\.href/)
  assert.doesNotMatch(telemetryProviderSource, /search: window\.location\.search/)
})

test('reset screen maps external auth errors to fixed copy', () => {
  assert.match(resetPasswordScreenSource, /hashParams\?\.has\("error_description"\)/)
  assert.match(resetPasswordScreenSource, /Este link de recuperação expirou ou não é válido\./)
  assert.doesNotMatch(resetPasswordScreenSource, /markInvalid\(hashError\)/)
  assert.doesNotMatch(resetPasswordScreenSource, /hashParams\?\.get\("error_description"\)/)
})

test('recovery email keeps the exact reset contract inside the canonical brand shell', () => {
  const recoveryLinkOccurrences = recoveryEmailTemplateSource
    .split(recoveryTemplateLink)
    .length - 1
  const templateVariables = Array.from(
    recoveryEmailTemplateSource.matchAll(/{{\s*\.([A-Za-z][A-Za-z0-9]*)\s*}}/g),
    (match) => match[1],
  )

  assert.equal(recoveryLinkOccurrences, 3)
  assert.deepEqual(
    Array.from(new Set(templateVariables)).sort(),
    ['RedirectTo', 'TokenHash'],
  )
  assert.match(recoveryEmailTemplateSource, /<html lang="pt-BR">/)
  assert.match(recoveryEmailTemplateSource, /name="color-scheme" content="light"/)
  assert.match(
    recoveryEmailTemplateSource,
    /Use o link seguro abaixo para criar uma nova senha\./,
  )
  assert.match(
    recoveryEmailTemplateSource,
    /src="https:\/\/vimobcrm\.com\.br\/images\/logo-black\.png"/,
  )
  assert.match(recoveryEmailTemplateSource, /width="142" height="48"/)
  assert.match(recoveryEmailTemplateSource, /max-width:600px/)
  assert.match(recoveryEmailTemplateSource, /bgcolor="#ff4529" height="6"/)
  assert.match(recoveryEmailTemplateSource, /bgcolor="#d9341d"/)
  assert.match(recoveryEmailTemplateSource, /mso-padding-alt:15px 24px/)
  assert.match(recoveryEmailTemplateSource, /Não foi você\?/)
  assert.match(recoveryEmailTemplateSource, /copie e cole este endereço no navegador/)
  assert.match(
    recoveryEmailTemplateSource,
    /https:\/\/app\.vimobcrm\.com\.br\/termos-de-uso/,
  )
  assert.match(
    recoveryEmailTemplateSource,
    /https:\/\/app\.vimobcrm\.com\.br\/politica-de-privacidade/,
  )
  assert.doesNotMatch(recoveryEmailTemplateSource, /\.ConfirmationURL|\.SiteURL/)
  assert.doesNotMatch(recoveryEmailTemplateSource, /{{\s*\.Token\s*}}/)
  assert.doesNotMatch(
    recoveryEmailTemplateSource,
    /Reset Your Password|Reset password|Follow this link|Alternatively|enter the code/i,
  )
  assert.doesNotMatch(
    recoveryEmailTemplateSource,
    /https:\/\/vimobcrm\.com\.br\/(?:termos-de-uso|politica-de-privacidade)/,
  )
  assert.doesNotMatch(recoveryEmailTemplateSource, /#c9361f/i)
})

test('recovery template has an executable local and self-hosted Auth contract', () => {
  assert.match(
    supabaseConfigSource,
    /\[auth\.email\.template\.recovery\]\s+subject = "Redefina sua senha no Vimob CRM"\s+content_path = "\.\/supabase\/templates\/recovery\.html"/,
  )
  assert.match(
    selfHostedAuthEmailComposeSource,
    /GOTRUE_MAILER_TEMPLATES_RECOVERY:\s*http:\/\/templates-server\/recovery\.html/,
  )
  assert.match(
    selfHostedAuthEmailComposeSource,
    /GOTRUE_MAILER_SUBJECTS_RECOVERY:\s*Redefina sua senha no Vimob CRM/,
  )
  assert.match(
    selfHostedAuthEmailComposeSource,
    /templates-server:\s+[\s\S]*?image:\s*caddy:2\.11\.4-alpine@sha256:[0-9a-f]{64}/,
  )
  assert.match(
    selfHostedAuthEmailComposeSource,
    /templates-server:\s+[\s\S]*?condition:\s*service_healthy/,
  )
  assert.match(
    selfHostedAuthEmailComposeSource,
    /source:\s*\$\{AUTH_EMAIL_TEMPLATES_DIR:\?configure AUTH_EMAIL_TEMPLATES_DIR}/,
  )
  assert.match(selfHostedAuthEmailComposeSource, /read_only:\s*true/)
  assert.match(
    selfHostedAuthEmailComposeSource,
    /healthcheck:[\s\S]*?recovery\.html[\s\S]*?\{\{ \.RedirectTo \}\}[\s\S]*?\{\{ \.TokenHash \}\}[\s\S]*?type=recovery/,
  )
  assert.doesNotMatch(selfHostedAuthEmailComposeSource, /^\s+ports:/m)
  assert.match(
    selfHostedAuthEmailEnvExampleSource,
    /^SMTP_ADMIN_EMAIL=naoresponde@vimobcrm\.com\.br$/m,
  )
  assert.match(
    selfHostedAuthEmailEnvExampleSource,
    /^SMTP_SENDER_NAME=Vimob CRM$/m,
  )
  assert.match(
    selfHostedSupabaseReadmeSource,
    /ADDITIONAL_REDIRECT_URLS=https:\/\/app\.vimobcrm\.com\.br\/reset-password,https:\/\/app\.vimobcrm\.com\.br\/login\?emailConfirmation=success/,
  )
  assert.match(selfHostedSupabaseReadmeSource, /nunca substitua a allowlist inteira/)
  assert.match(selfHostedSupabaseReadmeSource, /config --quiet/)
  assert.match(selfHostedSupabaseReadmeSource, /--force-recreate templates-server auth/)
  assert.match(selfHostedSupabaseReadmeSource, /docker inspect "\$AUTH_CONTAINER_ID"/)
  assert.match(selfHostedSupabaseReadmeSource, /Os dois SHA-256 devem ser iguais/)
  assert.match(
    selfHostedSupabaseReadmeSource,
    /Reset Your Password[\s\S]*?Follow this link[\s\S]*?enter the code/,
  )
})

test('recovery exits are bounded and always navigate from a finally block', () => {
  const leaveStart = resetPasswordScreenSource.indexOf('async function leavePasswordRecovery')
  const finishStart = resetPasswordScreenSource.indexOf('async function finishPasswordRecovery')
  const passwordErrorStart = resetPasswordScreenSource.indexOf('function passwordErrorMessage')

  assert.notEqual(leaveStart, -1)
  assert.notEqual(finishStart, -1)
  assert.notEqual(passwordErrorStart, -1)

  const leaveSource = resetPasswordScreenSource.slice(leaveStart, finishStart)
  const finishSource = resetPasswordScreenSource.slice(finishStart, passwordErrorStart)
  assert.match(leaveSource, /runBestEffortAuthOperation/)
  assert.match(leaveSource, /finally \{\s*window\.location\.replace\(destination\)/)
  assert.match(finishSource, /signOutPasswordRecoverySession\("global"/)
  assert.match(finishSource, /signOutPasswordRecoverySession\("local"/)
  assert.match(finishSource, /finally \{[\s\S]*?window\.location\.replace/)
})

test('every recovery state is announced, focused and has a non-empty suspense fallback', () => {
  assert.match(resetPasswordScreenSource, /role="status" aria-live="polite" aria-atomic="true"/)
  assert.match(resetPasswordScreenSource, /recoveryState === "success"[\s\S]*?successHeadingRef\.current/)
  assert.match(resetPasswordScreenSource, /ref=\{recoveryHeadingRef\}/)
  assert.match(resetPasswordScreenSource, /ref=\{successHeadingRef\}/)
  assert.match(resetPasswordScreenSource, /heading\?\.focus\(\)/)
  assert.match(resetPasswordPageSource, /<Suspense[\s\S]*?fallback=\{\([\s\S]*?<VimobLoader/)
  assert.doesNotMatch(resetPasswordPageSource, /fallback=\{null\}/)
})
