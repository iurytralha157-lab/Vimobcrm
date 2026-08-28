import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  getForwardedForHeader,
  getRequestIp,
  getRequestRateLimitIdentity,
} from '../security/server-rate-limit'
import { isValidBrazilianTaxId, normalizeBrazilianTaxId } from './brazilian-tax-id'
import {
  CURRENT_PRIVACY_VERSION,
  CURRENT_TERMS_VERSION,
  onboardingEmailConfirmationResendResponseSchema,
  onboardingEmailConfirmationResendSchema,
  onboardingAccessStepSchema,
  onboardingOrganizationStepSchema,
  onboardingSignupResponseSchema,
  onboardingSignupRecoveryResponseSchema,
  onboardingSignupRecoverySchema,
  onboardingSignupSchema,
  onboardingStepValidationRequestSchema,
  onboardingStepValidationResponseSchema,
} from './onboarding'

const validSignup = {
  attemptId: '0f5ecbd9-c8c9-490c-b70a-3beb8ef44d6f',
  companyName: 'Vimob Imoveis',
  documentNumber: '04.252.011/0001-10',
  brokersCount: 25,
  adminName: 'Andre Silva',
  phoneCountryCode: '+55' as const,
  phone: '(11) 99999-9999',
  email: 'ANDRE@EXAMPLE.COM',
  password: '12345678',
  signupPath: 'paid' as const,
  planSlug: 'pro',
  termsAccepted: true as const,
  privacyAccepted: true as const,
  termsVersion: CURRENT_TERMS_VERSION,
  privacyVersion: CURRENT_PRIVACY_VERSION,
}

const recoveryCapability = `v1.${'a'.repeat(80)}.${'b'.repeat(43)}`

test('validador brasileiro aceita CPF/CNPJ reais e rejeita digitos verificadores invalidos', () => {
  assert.equal(isValidBrazilianTaxId('529.982.247-25'), true)
  assert.equal(isValidBrazilianTaxId('04.252.011/0001-10'), true)
  assert.equal(isValidBrazilianTaxId('529.982.247-24'), false)
  assert.equal(isValidBrazilianTaxId('04.252.011/0001-11'), false)
  assert.equal(isValidBrazilianTaxId('111.111.111-11'), false)
  assert.equal(isValidBrazilianTaxId('11.111.111/1111-11'), false)
  assert.equal(isValidBrazilianTaxId(''), false)
})

test('normalizacao de CPF/CNPJ remove apenas a mascara', () => {
  assert.equal(normalizeBrazilianTaxId(' 04.252.011/0001-10 '), '04252011000110')
  assert.equal(normalizeBrazilianTaxId('529.982.247-25'), '52998224725')
})

test('cadastro publico exige documento valido e entrega dados canonicos ao backend', () => {
  const parsed = onboardingSignupSchema.parse(validSignup)

  assert.equal(parsed.documentNumber, '04252011000110')
  assert.equal(parsed.email, 'andre@example.com')
  assert.equal(parsed.companyName, 'Vimob Imoveis')

  for (const documentNumber of ['', '123.456.789-01', '11.111.111/1111-11', '04abc252011000110']) {
    assert.equal(onboardingSignupSchema.safeParse({ ...validSignup, documentNumber }).success, false)
  }
})

test('etapa da organizacao valida e normaliza antes de consultar disponibilidade', () => {
  const parsed = onboardingOrganizationStepSchema.parse({
    companyName: ' Vimob Imoveis ',
    documentNumber: '04.252.011/0001-10',
    brokersCount: '25',
  })

  assert.equal(parsed.companyName, 'Vimob Imoveis')
  assert.equal(parsed.documentNumber, '04252011000110')
  assert.equal(parsed.brokersCount, 25)
  assert.equal(onboardingOrganizationStepSchema.safeParse({ ...parsed, documentNumber: '529.982.247-24' }).success, false)
  assert.equal(onboardingOrganizationStepSchema.safeParse({ ...parsed, companyName: 'A' }).success, false)
  assert.equal(onboardingOrganizationStepSchema.safeParse({ ...parsed, brokersCount: 501 }).success, false)
})

test('etapa de acesso informa email, senha e WhatsApp invalidos antes do plano', () => {
  const validAccess = {
    adminName: 'Andre Silva',
    phoneCountryCode: '+55' as const,
    phone: '(11) 99999-9999',
    email: ' ANDRE@EXAMPLE.COM ',
    password: 'Senha@2026',
    legalAccepted: true,
  }
  const parsed = onboardingAccessStepSchema.parse(validAccess)

  assert.equal(parsed.email, 'andre@example.com')
  assert.equal(onboardingAccessStepSchema.safeParse({ ...validAccess, email: 'invalido' }).success, false)
  assert.equal(onboardingAccessStepSchema.safeParse({ ...validAccess, password: 'senhafraca' }).success, false)
  assert.equal(onboardingAccessStepSchema.safeParse({ ...validAccess, phone: '(11) 9999-9999' }).success, false)
  assert.equal(onboardingAccessStepSchema.safeParse({ ...validAccess, legalAccepted: false }).success, false)
})

test('pre-validacao publica aceita somente os dois passos e respostas canonicas', () => {
  const organization = onboardingStepValidationRequestSchema.parse({
    step: 'organization',
    companyName: 'Vimob Imoveis',
    documentNumber: '04.252.011/0001-10',
  })
  assert.equal(organization.step, 'organization')
  if (organization.step !== 'organization') throw new Error('etapa de organizacao nao foi preservada')
  assert.equal(organization.documentNumber, '04252011000110')
  assert.equal(onboardingStepValidationRequestSchema.safeParse({ step: 'access', email: 'invalido' }).success, false)
  assert.equal(onboardingStepValidationResponseSchema.safeParse({ ok: true, valid: true }).success, true)
  assert.equal(onboardingStepValidationResponseSchema.safeParse({
    ok: false,
    valid: false,
    field: 'email',
    code: 'signup_email_exists',
    message: 'E-mail ja cadastrado.',
  }).success, true)
  assert.equal(onboardingStepValidationResponseSchema.safeParse({ ok: true, valid: false }).success, false)
})

test('cadastro publico limita nomes, senha e quantidade de corretores', () => {
  const invalidOverrides = [
    { attemptId: '' },
    { attemptId: 'not-a-uuid' },
    { companyName: 'A' },
    { companyName: 'A'.repeat(161) },
    { adminName: 'A' },
    { adminName: 'A'.repeat(141) },
    { password: '1'.repeat(7) },
    { password: '1'.repeat(129) },
    { brokersCount: 0 },
    { brokersCount: 501 },
    { brokersCount: 1.5 },
  ]

  for (const override of invalidOverrides) {
    assert.equal(onboardingSignupSchema.safeParse({ ...validSignup, ...override }).success, false)
  }
})

test('cadastro publico aceita somente as versoes legais exibidas', () => {
  assert.equal(onboardingSignupSchema.safeParse(validSignup).success, true)
  assert.equal(onboardingSignupSchema.safeParse({ ...validSignup, termsVersion: '' }).success, false)
  assert.equal(onboardingSignupSchema.safeParse({ ...validSignup, termsVersion: '2025-01-01' }).success, false)
  assert.equal(onboardingSignupSchema.safeParse({ ...validSignup, privacyVersion: '' }).success, false)
  assert.equal(onboardingSignupSchema.safeParse({ ...validSignup, privacyVersion: '2025-01-01' }).success, false)
})

test('cadastro publico valida o WhatsApp conforme o pais selecionado', () => {
  const validPhones = [
    ['+55', '(11) 99999-9999'],
    ['+1', '202 555 0123'],
    ['+351', '912 345 678'],
    ['+54', '11 2345 6789'],
    ['+56', '9 1234 5678'],
    ['+598', '9123 4567'],
    ['+595', '981 234 567'],
  ] as const

  for (const [phoneCountryCode, phone] of validPhones) {
    assert.equal(onboardingSignupSchema.safeParse({ ...validSignup, phoneCountryCode, phone }).success, true)
  }

  assert.equal(onboardingSignupSchema.safeParse({ ...validSignup, phone: '(11) 9999-9999' }).success, false)
  assert.equal(onboardingSignupSchema.safeParse({ ...validSignup, phone: '(11) abcde-fghi' }).success, false)
  assert.equal(onboardingSignupSchema.safeParse({ ...validSignup, phoneCountryCode: '+999' }).success, false)
})

test('resposta de cadastro exige resultado autoritativo e redirect interno coerente', () => {
  const checkoutToken = '0123456789abcdef0123456789abcdef'
  const paidResult = {
    ok: true as const,
    message: 'Cadastro criado com sucesso.',
    redirectTo: `/checkout/${checkoutToken}`,
    checkoutToken,
    organizationId: 'f46ce055-0b0a-480a-b956-8eaa2c16a5cd',
    requiresPayment: true,
    emailConfirmationRequired: true as const,
    recoveryCapability,
  }

  assert.equal(onboardingSignupResponseSchema.safeParse(paidResult).success, true)
  assert.equal(onboardingSignupResponseSchema.safeParse({ ...paidResult, emailConfirmationRequired: false }).success, false)
  assert.equal(onboardingSignupResponseSchema.safeParse({ ...paidResult, recoveryCapability: '' }).success, false)
  assert.equal(onboardingSignupResponseSchema.safeParse({ ...paidResult, checkoutToken: null }).success, false)
  assert.equal(onboardingSignupResponseSchema.safeParse({ ...paidResult, redirectTo: '/select-organization' }).success, false)
  assert.equal(onboardingSignupResponseSchema.safeParse({ ...paidResult, redirectTo: '//attacker.example' }).success, false)
  assert.equal(onboardingSignupResponseSchema.safeParse({ ...paidResult, checkoutToken: checkoutToken.toUpperCase() }).success, false)
  assert.equal(onboardingSignupResponseSchema.safeParse({ ...paidResult, checkoutToken: checkoutToken.slice(1) }).success, false)
  assert.equal(onboardingSignupResponseSchema.safeParse({ ...paidResult, checkoutToken: `${checkoutToken.slice(0, 31)}\\` }).success, false)
  assert.equal(onboardingSignupResponseSchema.safeParse({ ...paidResult, redirectTo: `/checkout/${checkoutToken}\n` }).success, false)
  assert.equal(onboardingSignupResponseSchema.safeParse({
    ...paidResult,
    requiresPayment: false,
    checkoutToken: null,
    redirectTo: '/select-organization',
  }).success, true)
  assert.equal(onboardingSignupResponseSchema.safeParse({
    ...paidResult,
    requiresPayment: false,
    checkoutToken: null,
    redirectTo: `/checkout/${checkoutToken}`,
  }).success, false)
  assert.equal(onboardingSignupResponseSchema.safeParse({
    ...paidResult,
    requiresPayment: false,
    redirectTo: '/select-organization',
  }).success, false)
  assert.equal(onboardingSignupResponseSchema.safeParse({ ok: false, message: 'Tente novamente.' }).success, true)
})

test('recuperacao do cadastro vincula capacidade, e-mail atual, acao e destino', () => {
  const correction = onboardingSignupRecoverySchema.parse({
    capability: recoveryCapability,
    action: 'correct_email',
    currentEmail: ' OLD@EXAMPLE.COM ',
    newEmail: ' NEW@EXAMPLE.COM ',
  })
  assert.equal(correction.action, 'correct_email')
  if (correction.action !== 'correct_email') throw new Error('acao de correcao nao foi preservada')
  assert.equal(correction.currentEmail, 'old@example.com')
  assert.equal(correction.newEmail, 'new@example.com')
  assert.equal(onboardingSignupRecoverySchema.safeParse({ ...correction, newEmail: correction.currentEmail }).success, false)
  assert.equal(onboardingSignupRecoverySchema.safeParse({ ...correction, capability: 'tampered' }).success, false)
  assert.equal(onboardingSignupRecoverySchema.safeParse({
    capability: recoveryCapability,
    action: 'cancel_and_restart',
    currentEmail: 'old@example.com',
  }).success, true)
  assert.equal(onboardingSignupRecoveryResponseSchema.safeParse({
    ok: true,
    action: 'correct_email',
    message: 'E-mail corrigido.',
    email: 'new@example.com',
    redirectTo: '/select-organization',
    checkoutToken: null,
    requiresPayment: false,
  }).success, true)

  const route = readFileSync('app/api/onboarding/signup/recovery/route.ts', 'utf8')
  assert.match(route, /onboardingSignupRecoverySchema\.safeParse/)
  assert.match(route, /getForwardedForHeader\(request\)/)
  assert.match(route, /\/v1\/public\/onboarding\/signup\/recovery/)
  assert.match(route, /cache: 'no-store'/)
})

test('reenvio de confirmacao normaliza o e-mail e exige resposta publica generica', () => {
  const request = onboardingEmailConfirmationResendSchema.parse({ email: ' ANDRE@EXAMPLE.COM ' })
  assert.equal(request.email, 'andre@example.com')
  assert.equal(onboardingEmailConfirmationResendSchema.safeParse({ email: 'invalido' }).success, false)
  assert.equal(onboardingEmailConfirmationResendResponseSchema.safeParse({
    ok: true,
    message: 'Se existir um cadastro pendente, enviaremos um novo link.',
  }).success, true)
  assert.equal(onboardingEmailConfirmationResendResponseSchema.safeParse({ ok: true }).success, false)

  const route = readFileSync('app/api/onboarding/email-confirmation/resend/route.ts', 'utf8')
  assert.match(route, /onboardingEmailConfirmationResendSchema\.safeParse/)
  assert.match(route, /getForwardedForHeader\(request\)/)
  assert.match(route, /\/v1\/public\/onboarding\/email-confirmation\/resend/)
  assert.match(route, /AbortSignal\.timeout\(RESEND_BACKEND_TIMEOUT_MS\)/)
  assert.doesNotMatch(route, /'X-Forwarded-For': clientIp/)

  const login = readFileSync('components/features/auth/login-form.tsx', 'utf8')
  assert.match(login, /Reenviar e-mail de confirma(?:ç|c)(?:ã|a)o/)
  assert.match(login, /authAPI\.resendSignupEmailConfirmation/)

  const authAPI = readFileSync('lib/api/auth.ts', 'utf8')
  assert.match(authAPI, /\/api\/onboarding\/email-confirmation\/resend/)
  assert.match(authAPI, /onboardingEmailConfirmationResendResponseSchema\.safeParse/)
})

test('proxy de pre-validacao limita, normaliza e nunca encaminha senha', () => {
  const route = readFileSync('app/api/onboarding/validate-step/route.ts', 'utf8')
  assert.match(route, /onboardingStepValidationRequestSchema\.safeParse/)
  assert.match(route, /onboardingStepValidationResponseSchema\.safeParse/)
  assert.match(route, /getForwardedForHeader\(request\)/)
  assert.match(route, /\/v1\/public\/onboarding\/validate-step/)
  assert.match(route, /cache: 'no-store'/)
  assert.match(route, /AbortSignal\.timeout\(VALIDATION_BACKEND_TIMEOUT_MS\)/)
  assert.match(route, /onboarding-validate-step:ip:/)
  assert.match(route, /sensitiveIdentity\(valueIdentity\)/)
  assert.doesNotMatch(route, /service_role|SUPABASE_SERVICE_ROLE_KEY/)
  assert.doesNotMatch(route, /password/)
})

test('proxy e formulario preservam idempotencia e obedecem o redirect do backend', () => {
  const proxy = readFileSync('app/api/onboarding/signup/route.ts', 'utf8')
  assert.match(proxy, /AbortSignal\.timeout\(SIGNUP_BACKEND_TIMEOUT_MS\)/)
  assert.match(proxy, /onboardingSignupResponseSchema\.safeParse\(rawPayload\)/)
  assert.match(proxy, /getForwardedForHeader\(request\)/)
  assert.match(proxy, /headers\.set\('X-Forwarded-For', forwardedFor\)/)
  assert.doesNotMatch(proxy, /'X-Forwarded-For': clientIp/)

  const form = readFileSync('components/features/onboarding/onboarding-form.tsx', 'utf8')
  const submitStart = form.indexOf('async function handleSubmit')
  const renderStart = form.indexOf('  return (', submitStart)
  assert.notEqual(submitStart, -1)
  assert.notEqual(renderStart, -1)
  const submit = form.slice(submitStart, renderStart)

  assert.match(submit, /getOrCreatePublicSignupAttemptId\(window\.sessionStorage\)/)
  assert.match(submit, /persistPublicSignupCompletion\(/)
  assert.match(submit, /if \(result\.requiresPayment\)/)
  assert.match(submit, /router\.replace\(result\.redirectTo\)/)
  assert.match(submit, /if \(signupCompleted\) \{\s*setStep\(4\)/)
  assert.doesNotMatch(submit, /selectedPlan\?\.signupPath/)

  assert.doesNotMatch(submit, /signIn\(/, 'public signup must not log in before proving email ownership')
})

test('formularios publicos nao degradam para GET nem registram o e-mail de recuperacao', () => {
  const form = readFileSync('components/features/onboarding/onboarding-form.tsx', 'utf8')
  assert.match(form, /<form method="post" noValidate onSubmit=\{handleSubmit\}/)

  const authAPI = readFileSync('lib/api/auth.ts', 'utf8')
  const resetStart = authAPI.indexOf('async resetPassword')
  const resetEnd = authAPI.indexOf('async resendSignupEmailConfirmation', resetStart)
  assert.notEqual(resetStart, -1)
  assert.notEqual(resetEnd, -1)

  const resetPassword = authAPI.slice(resetStart, resetEnd)
  assert.doesNotMatch(resetPassword, /console\.(?:log|info|debug)\(/)
  assert.doesNotMatch(resetPassword, /Resetting password for/)
})

test('proxies publicos limitam o corpo antes do parse e nunca permitem cache sensivel', () => {
  const routes = [
    'app/api/onboarding/validate-step/route.ts',
    'app/api/onboarding/signup/route.ts',
    'app/api/onboarding/signup/recovery/route.ts',
    'app/api/onboarding/email-confirmation/resend/route.ts',
    'app/api/onboarding/checkout-plan/route.ts',
  ]

  for (const path of routes) {
    const route = readFileSync(path, 'utf8')
    assert.match(route, /readRequestTextWithLimit\(request, [A-Z_]+MAX_BODY_BYTES\)/, path)
    assert.match(route, /RequestBodyTooLargeError/, path)
    assert.match(route, /'Cache-Control', 'no-store'/, path)
    assert.doesNotMatch(route, /await request\.json\(\)/, path)
  }

  const checkoutPlan = readFileSync('app/api/onboarding/checkout-plan/route.ts', 'utf8')
  assert.match(checkoutPlan, /checkoutPlanResponseSchema\.safeParse/)
  assert.match(checkoutPlan, /cache: 'no-store'/)
  assert.match(checkoutPlan, /AbortSignal\.timeout\(CHECKOUT_PLAN_BACKEND_TIMEOUT_MS\)/)
})

test('login consome marcadores de confirmacao sem afirmar sucesso antes da sessao', () => {
  const login = readFileSync('components/features/auth/login-form.tsx', 'utf8')
  assert.match(login, /url\.searchParams\.delete\("emailConfirmation"\)/)
  assert.match(login, /Confirmação recebida\. Estamos validando seu acesso\./)
  assert.match(login, /Confirmação processada\. Entre para continuar\./)
  assert.doesNotMatch(login, /E-mail confirmado\. Estamos preparando seu acesso\./)
})

test('proxy preserva a cadeia e limita pelo hop valido mais a direita', () => {
  const request = new Request('https://app.vimobcrm.com.br/api/onboarding/signup', {
    headers: {
      'x-forwarded-for': '203.0.113.250, invalid, 198.51.100.44',
      'x-real-ip': '192.0.2.99',
    },
  })

  assert.equal(getForwardedForHeader(request), '203.0.113.250, 198.51.100.44')
  assert.equal(getRequestIp(request), '198.51.100.44')

  const otherClient = new Request('https://app.vimobcrm.com.br/api/onboarding/signup', {
    headers: { 'x-forwarded-for': '203.0.113.251, 198.51.100.44' },
  })
  assert.notEqual(
    getRequestRateLimitIdentity(request),
    getRequestRateLimitIdentity(otherClient),
    'clients behind the same rightmost proxy must not share the local bucket',
  )
})

test('proxy nao encaminha uma cadeia X-Forwarded-For totalmente malformada', () => {
  const request = new Request('https://app.vimobcrm.com.br/api/onboarding/signup', {
    headers: {
      'x-forwarded-for': 'victim.example, unknown',
      'x-real-ip': '198.51.100.81',
    },
  })

  assert.equal(getForwardedForHeader(request), null)
  assert.equal(getRequestIp(request), '198.51.100.81')
})
