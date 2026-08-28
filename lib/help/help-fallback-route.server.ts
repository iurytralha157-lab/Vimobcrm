import 'server-only'

import { createClient } from '@/lib/supabase/server'

const PRIVATE_NO_STORE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
  Expires: '0',
  Pragma: 'no-cache',
  Vary: 'Cookie',
}

export function helpFallbackJSON(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: PRIVATE_NO_STORE_HEADERS,
  })
}

export async function requireAuthenticatedHelpFallback() {
  try {
    const supabase = await createClient()
    const { data, error } = await supabase.auth.getUser()
    return !error && Boolean(data.user)
  } catch {
    return false
  }
}

export function unauthorizedHelpFallbackResponse() {
  return helpFallbackJSON({
    error: {
      code: 'unauthorized',
      message: 'Authentication is required.',
    },
  }, 401)
}
