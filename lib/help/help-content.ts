import { z } from 'zod'

import {
  apiHelpArticleSchema,
  type HelpArticle,
  type HelpArticleSummary,
} from '@/lib/validation/help'

export type HelpContentAudience = 'authenticated' | 'public'

const helpContentArticleSchema = apiHelpArticleSchema.extend({
  visibility: z.enum(['public', 'authenticated', 'all']),
})

export type HelpContentArticle = z.infer<typeof helpContentArticleSchema>

function isVisibleForAudience(
  visibility: HelpContentArticle['visibility'],
  audience: HelpContentAudience,
) {
  if (audience === 'authenticated') {
    return visibility === 'authenticated' || visibility === 'all'
  }
  return visibility === 'public' || visibility === 'all'
}

function normalizeSearchText(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
}

function toSummary(
  article: HelpContentArticle,
): HelpArticleSummary {
  return {
    id: article.id,
    slug: article.slug,
    category: article.category,
    moduleKey: article.moduleKey,
    title: article.title,
    summary: article.summary,
    routeHref: article.routeHref,
    actionLabel: article.actionLabel,
    estimatedMinutes: article.estimatedMinutes,
    displayOrder: article.displayOrder,
    updatedAt: article.updatedAt,
  }
}

export type HelpContentRepository = {
  list(): HelpArticleSummary[]
  get(slug: string): HelpArticle | undefined
  search(rawQuery: string, limit: number): HelpArticleSummary[]
}

export function createHelpContentRepository(
  snapshot: unknown,
  audience: HelpContentAudience,
): HelpContentRepository {
  const articles = z.array(helpContentArticleSchema)
    .parse(snapshot)
    .filter((article) => isVisibleForAudience(article.visibility, audience))

  return {
    list() {
      return articles.map(toSummary)
    },

    get(slug) {
      const article = articles.find((candidate) => candidate.slug === slug)
      if (!article) return undefined
      return apiHelpArticleSchema.parse(article)
    },

    search(rawQuery, limit) {
      const terms = normalizeSearchText(rawQuery.trim()).split(/\s+/).filter(Boolean)
      if (terms.length === 0) return []

      return articles
        .filter((article) => {
          const searchable = normalizeSearchText([
            article.title,
            article.summary,
            article.category,
            article.moduleKey,
            article.content,
            article.searchKeywords.join(' '),
            article.steps.map((step) => `${step.title} ${step.body}`).join(' '),
          ].join(' '))

          return terms.every((term) => searchable.includes(term))
        })
        .slice(0, limit)
        .map(toSummary)
    },
  }
}
