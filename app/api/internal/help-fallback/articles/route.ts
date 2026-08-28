import {
  helpFallbackJSON,
  requireAuthenticatedHelpFallback,
  unauthorizedHelpFallbackResponse,
} from '@/lib/help/help-fallback-route.server'
import { listBundledAuthenticatedHelpArticles } from '@/lib/help/help-content.server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  if (!(await requireAuthenticatedHelpFallback())) {
    return unauthorizedHelpFallbackResponse()
  }

  return helpFallbackJSON({
    data: listBundledAuthenticatedHelpArticles(),
  })
}
