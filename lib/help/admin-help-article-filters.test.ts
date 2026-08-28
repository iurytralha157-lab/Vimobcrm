import assert from 'node:assert/strict'
import test from 'node:test'

import {
  filterAdminHelpArticles,
  hasAdminHelpArticleFilters,
  type AdminHelpArticleFilters,
} from './admin-help-article-filters'

const ARTICLES = [
  {
    id: 'published-client',
    title: 'Configuração de imóveis',
    summary: 'Cadastre e publique imóveis.',
    category: 'Imóveis',
    slug: 'configuracao-de-imoveis',
    module_key: 'properties',
    search_keywords: ['anúncio', 'portal'],
    visibility: 'authenticated' as const,
    is_active: true,
  },
  {
    id: 'draft-public',
    title: 'Primeiros passos',
    summary: 'Prepare a conta para começar.',
    category: 'Introdução',
    slug: 'primeiros-passos',
    module_key: 'getting-started',
    search_keywords: ['início'],
    visibility: 'public' as const,
    is_active: false,
  },
]

const EMPTY_FILTERS: AdminHelpArticleFilters = {
  search: '',
  category: '',
  status: 'all',
  visibility: 'any',
}

test('busca administrativa ignora acentos e consulta palavras-chave', () => {
  assert.deepEqual(
    filterAdminHelpArticles(ARTICLES, { ...EMPTY_FILTERS, search: 'anuncio' }).map((item) => item.id),
    ['published-client'],
  )
})

test('filtros de categoria, publicação e audiência são combinados', () => {
  assert.deepEqual(
    filterAdminHelpArticles(ARTICLES, {
      search: 'passos',
      category: 'Introdução',
      status: 'draft',
      visibility: 'public',
    }).map((item) => item.id),
    ['draft-public'],
  )

  assert.equal(hasAdminHelpArticleFilters(EMPTY_FILTERS), false)
  assert.equal(hasAdminHelpArticleFilters({ ...EMPTY_FILTERS, status: 'published' }), true)
})
