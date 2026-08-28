import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getOrCreatePublicSignupAttemptId,
  persistPublicSignupCompletion,
  PUBLIC_SIGNUP_ATTEMPT_STORAGE_KEY,
  PUBLIC_SIGNUP_COMPLETION_STORAGE_KEY,
  PUBLIC_SIGNUP_COMPLETION_TTL_MS,
  readPublicSignupCompletion,
} from './signup-attempt'

class MemoryStorage {
  private readonly values = new Map<string, string>()

  getItem(key: string) {
    return this.values.get(key) ?? null
  }

  removeItem(key: string) {
    this.values.delete(key)
  }

  setItem(key: string, value: string) {
    this.values.set(key, value)
  }
}

const attemptId = '0f5ecbd9-c8c9-490c-b70a-3beb8ef44d6f'
const checkoutToken = '0123456789abcdef0123456789abcdef'
const recoveryCapability = `v1.${'a'.repeat(80)}.${'b'.repeat(43)}`

test('tentativa publica reutiliza o mesmo UUID durante toda a sessao', () => {
  const storage = new MemoryStorage()
  let generated = 0
  const createUUID = () => {
    generated += 1
    return attemptId
  }

  assert.equal(getOrCreatePublicSignupAttemptId(storage, createUUID), attemptId)
  assert.equal(getOrCreatePublicSignupAttemptId(storage, createUUID), attemptId)
  assert.equal(generated, 1)
})

test('resultado persistido permite recuperar checkout sem armazenar senha', () => {
  const storage = new MemoryStorage()
  getOrCreatePublicSignupAttemptId(storage, () => attemptId)
  const result = {
    ok: true as const,
    message: 'Cadastro criado com sucesso.',
    redirectTo: `/checkout/${checkoutToken}`,
    checkoutToken,
    organizationId: 'f46ce055-0b0a-480a-b956-8eaa2c16a5cd',
    requiresPayment: true,
    emailConfirmationRequired: true as const,
    recoveryCapability,
  }

  persistPublicSignupCompletion(storage, attemptId, 'ADMIN@EXAMPLE.COM', result)

  const raw = storage.getItem(PUBLIC_SIGNUP_COMPLETION_STORAGE_KEY)
  assert.ok(raw)
  assert.equal(raw.includes('password'), false)
  assert.equal(raw.includes('minha-senha'), false)

  const restored = readPublicSignupCompletion(storage)
  assert.equal(restored?.attemptId, attemptId)
  assert.equal(restored?.email, 'admin@example.com')
  assert.equal(restored?.redirectTo, `/checkout/${checkoutToken}`)
  assert.equal(restored?.requiresPayment, true)
})

test('resultado corrompido da sessao e descartado', () => {
  const storage = new MemoryStorage()
  storage.setItem(PUBLIC_SIGNUP_COMPLETION_STORAGE_KEY, '{invalid')

  assert.equal(readPublicSignupCompletion(storage), null)
  assert.equal(storage.getItem(PUBLIC_SIGNUP_COMPLETION_STORAGE_KEY), null)
})

test('resultado concluido expira e libera uma nova tentativa na mesma aba', () => {
  const storage = new MemoryStorage()
  getOrCreatePublicSignupAttemptId(storage, () => attemptId)
  const completion = persistPublicSignupCompletion(storage, attemptId, 'admin@example.com', {
    ok: true,
    message: 'Cadastro criado com sucesso.',
    redirectTo: `/checkout/${checkoutToken}`,
    checkoutToken,
    organizationId: 'f46ce055-0b0a-480a-b956-8eaa2c16a5cd',
    requiresPayment: true,
    emailConfirmationRequired: true,
    recoveryCapability,
  })
  const completedAt = Date.parse(completion.completedAt)

  assert.deepEqual(readPublicSignupCompletion(storage, completedAt + PUBLIC_SIGNUP_COMPLETION_TTL_MS), completion)
  assert.equal(readPublicSignupCompletion(storage, completedAt + PUBLIC_SIGNUP_COMPLETION_TTL_MS + 1), null)
  assert.equal(storage.getItem(PUBLIC_SIGNUP_COMPLETION_STORAGE_KEY), null)
  assert.equal(storage.getItem(PUBLIC_SIGNUP_ATTEMPT_STORAGE_KEY), null)
})
