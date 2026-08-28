import assert from 'node:assert/strict'
import test from 'node:test'

import {
  apiHelpArticleResponseSchema,
  helpArticleStepSchema,
  helpSearchInputSchema,
} from './help'

const ARTICLE_ID = '11111111-1111-4111-8111-111111111111'

test('passo de ajuda exige mídia local, texto alternativo e ação completa', () => {
  const baseStep = {
    id: 'step-1',
    title: 'Abra o Pipeline',
    body: 'Use o menu lateral para abrir o Pipeline.',
  }

  assert.equal(helpArticleStepSchema.safeParse(baseStep).success, true)
  assert.equal(helpArticleStepSchema.safeParse({
    ...baseStep,
    imageUrl: '/help/screenshots/pipeline.png',
    imageAlt: 'Pipeline do Vimob',
    annotations: [{ x: 92, y: 8, label: '1', title: 'Novo lead' }],
  }).success, true)
  assert.equal(helpArticleStepSchema.safeParse({
    ...baseStep,
    imageUrl: 'https://tracker.example/screenshot.png',
    imageAlt: 'Captura externa',
  }).success, false)
  assert.equal(helpArticleStepSchema.safeParse({
    ...baseStep,
    imageUrl: '/help/screenshots/pipeline.png',
  }).success, false)
  assert.equal(helpArticleStepSchema.safeParse({
    ...baseStep,
    actionHref: '/crm/pipelines',
  }).success, false)
})

test('busca determinística limita pergunta e quantidade de resultados', () => {
  const parsed = helpSearchInputSchema.parse({ query: '  criar automação  ' })
  assert.deepEqual(parsed, { query: 'criar automação', limit: 8 })

  assert.equal(helpSearchInputSchema.safeParse({ query: 'a' }).success, false)
  assert.equal(helpSearchInputSchema.safeParse({ query: 'lead', limit: 13 }).success, false)
})

test('contrato de artigo aceita conteúdo estruturado e links internos', () => {
  assert.equal(apiHelpArticleResponseSchema.safeParse({
    data: {
      id: ARTICLE_ID,
      slug: 'como-criar-um-lead',
      category: 'Pipeline',
      moduleKey: 'pipeline',
      title: 'Como criar um lead?',
      summary: 'Cadastre uma oportunidade no Pipeline.',
      routeHref: '/crm/pipelines?new=lead',
      actionLabel: 'Criar lead',
      estimatedMinutes: 4,
      displayOrder: 10,
      updatedAt: '2026-07-29T12:00:00Z',
      content: 'Abra o formulário e informe os dados essenciais.',
      searchKeywords: ['criar lead', 'novo lead'],
      relatedSlugs: [],
      imageUrl: null,
      videoUrl: null,
      lastReviewedAt: '2026-07-29T12:00:00Z',
      steps: [{
        id: 'lead-1',
        title: 'Abra o formulário',
        body: 'Use Novo lead.',
        actionLabel: 'Criar lead',
        actionHref: '/crm/pipelines?new=lead',
      }],
    },
  }).success, true)
})

