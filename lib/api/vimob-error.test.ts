import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DEFAULT_PUBLIC_ERROR_MESSAGE,
  VimobAPIError,
  getPublicErrorMessage,
  getTechnicalErrorMessage,
} from './vimob-error'

const TECHNICAL_COPY =
  'A Vimob API demorou para responder em http://127.0.0.1:8081. Inicie apps/api ou ajuste NEXT_PUBLIC_VIMOB_API_URL.'

test('oculta detalhes de timeout e preserva o diagnóstico interno', () => {
  const error = new VimobAPIError(TECHNICAL_COPY, {
    code: 'api_timeout',
    status: 0,
    requestId: 'request-1',
  })

  assert.equal(error.message, DEFAULT_PUBLIC_ERROR_MESSAGE)
  assert.equal(error.technicalMessage, TECHNICAL_COPY)
  assert.equal(getTechnicalErrorMessage(error), TECHNICAL_COPY)
  assert.equal(error.code, 'api_timeout')
  assert.equal(error.status, 0)
  assert.equal(error.requestId, 'request-1')
  assert.doesNotMatch(
    error.message,
    /API|timeout|localhost|127\.0\.0\.1|https?:\/\/|apps\/api|NEXT_PUBLIC_|fetch|ECONN/i,
  )
})

test('oculta indisponibilidade, falhas de rede e respostas 5xx', () => {
  const examples: unknown[] = [
    new VimobAPIError('A Vimob API não está acessível.', {
      code: 'api_unavailable',
      status: 0,
    }),
    new Error('A API do Vimob não está acessível para concluir a ação.'),
    new Error('A Vimob API demorou para responder em http://localhost:8081.'),
    new Error('Erro ao falar com a API do Vimob.'),
    new TypeError('Failed to fetch'),
    new Error('NetworkError when attempting to fetch resource.'),
    new Error('Request timed out'),
    { message: 'connect ECONNREFUSED 127.0.0.1:8081' },
    { message: 'Internal server error', status: 503 },
  ]

  for (const example of examples) {
    assert.equal(getPublicErrorMessage(example), DEFAULT_PUBLIC_ERROR_MESSAGE)
  }
})

test('mantém mensagens acionáveis de negócio', () => {
  const examples = [
    new VimobAPIError('Já existe um lead com este telefone.', {
      code: 'lead_phone_conflict',
      status: 409,
    }),
    new VimobAPIError('Você não tem permissão para editar este lead.', {
      code: 'permission_denied',
      status: 403,
    }),
    new VimobAPIError('Regularize o pagamento para continuar.', {
      code: 'billing_access_required',
      status: 402,
    }),
    new VimobAPIError('Muitas solicitações. Aguarde um instante.', {
      code: 'rate_limit_exceeded',
      status: 429,
    }),
  ]

  for (const error of examples) {
    assert.equal(error.message, error.technicalMessage)
  }
})

test('telemetria usa a mensagem normal quando não existe detalhe técnico', () => {
  assert.equal(
    getTechnicalErrorMessage(new Error('Falha comum')),
    'Falha comum',
  )
})
