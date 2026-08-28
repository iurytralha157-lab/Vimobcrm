import publicHelpContentSnapshot from './help-content.public.snapshot.json'
import { createHelpContentRepository } from './help-content'

const publicHelpContent = createHelpContentRepository(
  publicHelpContentSnapshot,
  'public',
)

export function listBundledPublicHelpArticles() {
  return publicHelpContent.list()
}

export function getBundledPublicHelpArticle(slug: string) {
  return publicHelpContent.get(slug)
}

export function searchBundledPublicHelpArticles(query: string, limit: number) {
  return publicHelpContent.search(query, limit)
}
