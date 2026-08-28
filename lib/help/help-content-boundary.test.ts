import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'

type SnapshotArticle = {
  relatedSlugs: string[]
  slug: string
  visibility: 'all' | 'authenticated' | 'public'
}

function readSnapshot(fileName: string) {
  return JSON.parse(
    readFileSync(resolve(process.cwd(), 'lib/help', fileName), 'utf8'),
  ) as SnapshotArticle[]
}

function assertRelationshipsStayInsideSnapshot(articles: SnapshotArticle[]) {
  const slugs = new Set(articles.map((article) => article.slug))

  for (const article of articles) {
    assert.equal(
      article.relatedSlugs.every((slug) => slugs.has(slug)),
      true,
      `${article.slug} referencia artigo fora de sua audiencia`,
    )
  }
}

test('snapshot publico nunca contem artigo authenticated', () => {
  const articles = readSnapshot('help-content.public.snapshot.json')

  assert.ok(articles.length > 0)
  assert.equal(
    articles.some((article) => article.visibility === 'authenticated'),
    false,
  )
  assert.equal(
    articles.every((article) => (
      article.visibility === 'public' || article.visibility === 'all'
    )),
    true,
  )
  assertRelationshipsStayInsideSnapshot(articles)
})

test('snapshot autenticado nunca contem artigo exclusivamente public', () => {
  const articles = readSnapshot('help-content.authenticated.snapshot.json')

  assert.ok(articles.length > 0)
  assert.equal(
    articles.some((article) => article.visibility === 'public'),
    false,
  )
  assert.equal(
    articles.every((article) => (
      article.visibility === 'authenticated' || article.visibility === 'all'
    )),
    true,
  )
  assertRelationshipsStayInsideSnapshot(articles)
})

test('snapshot legado misto nao pode voltar ao repositorio', () => {
  assert.equal(
    existsSync(resolve(process.cwd(), 'lib/help/help-content.snapshot.json')),
    false,
  )
})
