import assert from 'node:assert/strict'
import test from 'node:test'

import { getHelpFallbackDisposition } from './help-fallback-policy'

test('fallback rejeita abort mesmo quando a razao e um Error comum', () => {
  assert.equal(getHelpFallbackDisposition({
    errorName: 'Error',
    isVimobAPIError: false,
    signalAborted: true,
  }, { detailRequest: false }), 'reject')
})

test('fallback rejeita autenticacao, autorizacao e artigo ausente canonico', () => {
  for (const failure of [
    { isVimobAPIError: true, status: 401 },
    { isVimobAPIError: true, status: 403 },
    {
      code: 'help_article_not_found',
      isVimobAPIError: true,
      status: 404,
    },
  ]) {
    assert.equal(
      getHelpFallbackDisposition(failure, { detailRequest: true }),
      'reject',
    )
  }
})

test('fallback nao mascara erro desconhecido ou contrato invalido', () => {
  assert.equal(getHelpFallbackDisposition({
    errorName: 'ZodError',
    isVimobAPIError: false,
  }, { detailRequest: false }), 'reject')
})

test('404 generico exige prova de capability somente em detalhe', () => {
  const failure = {
    code: 'api_error',
    isVimobAPIError: true,
    status: 404,
  }

  assert.equal(
    getHelpFallbackDisposition(failure, { detailRequest: false }),
    'fallback',
  )
  assert.equal(
    getHelpFallbackDisposition(failure, { detailRequest: true }),
    'probe-capability',
  )
})

test('api_unavailable de detalhe tambem e sondado pois pode esconder 404 local', () => {
  assert.equal(getHelpFallbackDisposition({
    code: 'api_unavailable',
    isVimobAPIError: true,
    status: 0,
  }, { detailRequest: true }), 'probe-capability')
})

test('timeout e erro de servidor conhecidos permitem continuidade', () => {
  assert.equal(getHelpFallbackDisposition({
    code: 'api_timeout',
    isVimobAPIError: true,
    status: 0,
  }, { detailRequest: true }), 'fallback')
  assert.equal(getHelpFallbackDisposition({
    code: 'api_error',
    isVimobAPIError: true,
    status: 503,
  }, { detailRequest: true }), 'fallback')
})
