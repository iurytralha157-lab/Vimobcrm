import { createClient } from '@supabase/supabase-js'
import type { VimobCoreDatabase } from './vimob-core-types'
import { createSupabaseServiceFetch, resolveSupabaseServiceKey } from './service-auth'

export function createAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = resolveSupabaseServiceKey()

  if (!supabaseUrl) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL')
  }

  return createClient<VimobCoreDatabase>(supabaseUrl, serviceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: {
      fetch: createSupabaseServiceFetch(serviceKey),
    },
  })
}
