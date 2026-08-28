import {
  helpFallbackJSON,
  requireAuthenticatedHelpFallback,
  unauthorizedHelpFallbackResponse,
} from '@/lib/help/help-fallback-route.server'
import { searchBundledAuthenticatedHelpArticles } from '@/lib/help/help-content.server'
import { helpSearchInputSchema } from '@/lib/validation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_SEARCH_BODY_BYTES = 8 * 1024

export async function POST(request: Request) {
  if (!(await requireAuthenticatedHelpFallback())) {
    return unauthorizedHelpFallbackResponse()
  }

  const rawBody = await request.text()
  if (new TextEncoder().encode(rawBody).byteLength > MAX_SEARCH_BODY_BYTES) {
    return helpFallbackJSON({
      error: {
        code: 'invalid_help_input',
        message: 'Help search payload is too large.',
      },
    }, 400)
  }

  let body: unknown
  try {
    body = JSON.parse(rawBody)
  } catch {
    return helpFallbackJSON({
      error: {
        code: 'invalid_json',
        message: 'Request body is invalid.',
      },
    }, 400)
  }

  const parsed = helpSearchInputSchema.safeParse(body)
  if (!parsed.success) {
    return helpFallbackJSON({
      error: {
        code: 'invalid_help_input',
        message: 'Help search input is invalid.',
      },
    }, 400)
  }

  return helpFallbackJSON({
    data: searchBundledAuthenticatedHelpArticles(
      parsed.data.query,
      parsed.data.limit,
    ),
  })
}
