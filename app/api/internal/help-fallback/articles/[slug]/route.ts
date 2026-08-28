import {
  helpFallbackJSON,
  requireAuthenticatedHelpFallback,
  unauthorizedHelpFallbackResponse,
} from '@/lib/help/help-fallback-route.server'
import { getBundledAuthenticatedHelpArticle } from '@/lib/help/help-content.server'
import { helpArticleSlugSchema } from '@/lib/validation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type HelpFallbackArticleContext = {
  params: Promise<{ slug: string }>
}

export async function GET(
  _request: Request,
  context: HelpFallbackArticleContext,
) {
  if (!(await requireAuthenticatedHelpFallback())) {
    return unauthorizedHelpFallbackResponse()
  }

  const parsedSlug = helpArticleSlugSchema.safeParse((await context.params).slug)
  if (!parsedSlug.success) {
    return helpFallbackJSON({
      error: {
        code: 'invalid_help_input',
        message: 'Help article slug is invalid.',
      },
    }, 400)
  }

  const article = getBundledAuthenticatedHelpArticle(parsedSlug.data)
  if (!article) {
    return helpFallbackJSON({
      error: {
        code: 'help_article_not_found',
        message: 'Help article was not found.',
      },
    }, 404)
  }

  return helpFallbackJSON({ data: article })
}
