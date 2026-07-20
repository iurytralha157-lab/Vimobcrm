import assert from 'node:assert/strict'
import test from 'node:test'

import { commandSearchFilter, normalizeSearchText, searchTextEquals, searchTextIncludes } from './search-text'

test('normaliza acentos e caixa para buscas em portugues', () => {
  assert.equal(normalizeSearchText(' Márcia '), 'marcia')
  assert.equal(normalizeSearchText('CONDOMÍNIO'), 'condominio')
})

test('encontra texto com ou sem acento nos dois sentidos', () => {
  assert.equal(searchTextIncludes('Márcia Freitas', 'Marcia'), true)
  assert.equal(searchTextIncludes('Marcia Freitas', 'Márcia'), true)
  assert.equal(searchTextEquals('São Paulo', 'Sao Paulo'), true)
})

test('aplica a mesma regra nos seletores de comando', () => {
  assert.equal(commandSearchFilter('Márcia Freitas', 'Marcia'), 1)
  assert.equal(commandSearchFilter('outro', 'Sao', ['São Paulo']), 1)
  assert.equal(commandSearchFilter('Márcia Freitas', 'Joana'), 0)
})
