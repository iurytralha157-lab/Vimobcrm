import { normalizeSearchText } from '../search-text'

export type AdminHelpArticleStatusFilter = 'all' | 'published' | 'draft'
export type AdminHelpArticleVisibility = 'authenticated' | 'public' | 'all'
export type AdminHelpArticleVisibilityFilter = 'any' | AdminHelpArticleVisibility

export type AdminHelpArticleFilters = {
  search: string
  category: string
  status: AdminHelpArticleStatusFilter
  visibility: AdminHelpArticleVisibilityFilter
}

type FilterableHelpArticle = {
  title: string
  summary: string
  category: string
  slug: string
  module_key: string
  search_keywords: string[]
  visibility: AdminHelpArticleVisibility
  is_active: boolean
}

export function hasAdminHelpArticleFilters(filters: AdminHelpArticleFilters) {
  return Boolean(normalizeSearchText(filters.search.trim()))
    || filters.category !== ''
    || filters.status !== 'all'
    || filters.visibility !== 'any'
}

export function filterAdminHelpArticles<Article extends FilterableHelpArticle>(
  articles: Article[],
  filters: AdminHelpArticleFilters,
) {
  const normalizedSearch = normalizeSearchText(filters.search.trim())

  return articles.filter((article) => {
    const matchesSearch = !normalizedSearch || normalizeSearchText([
      article.title,
      article.summary,
      article.category,
      article.slug,
      article.module_key,
      ...article.search_keywords,
    ].join(' ')).includes(normalizedSearch)
    const matchesCategory = filters.category === ''
      || article.category === filters.category
    const matchesStatus = filters.status === 'all'
      || (filters.status === 'published' ? article.is_active : !article.is_active)
    const matchesVisibility = filters.visibility === 'any'
      || article.visibility === filters.visibility

    return matchesSearch && matchesCategory && matchesStatus && matchesVisibility
  })
}
