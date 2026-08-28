import 'server-only'

import authenticatedHelpContentSnapshot from './help-content.authenticated.snapshot.json'
import { createHelpContentRepository } from './help-content'

const authenticatedHelpContent = createHelpContentRepository(
  authenticatedHelpContentSnapshot,
  'authenticated',
)

export function listBundledAuthenticatedHelpArticles() {
  return authenticatedHelpContent.list()
}

export function getBundledAuthenticatedHelpArticle(slug: string) {
  return authenticatedHelpContent.get(slug)
}

export function searchBundledAuthenticatedHelpArticles(query: string, limit: number) {
  return authenticatedHelpContent.search(query, limit)
}
