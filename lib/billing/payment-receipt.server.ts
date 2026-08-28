import 'server-only'

import { createClient } from '@supabase/supabase-js'

import {
  normalizeReceiptVerificationToken,
  parsePublicBillingPaymentReceipt,
  type PublicBillingPaymentReceipt,
} from '@/lib/billing/payment-receipt'
import type { VimobCoreDatabase } from '@/lib/supabase/vimob-core-types'

export type PublicReceiptLookupResult =
  | { status: 'valid'; receipt: PublicBillingPaymentReceipt }
  | { status: 'invalidated'; receipt: PublicBillingPaymentReceipt }
  | { status: 'invalid' }
  | { status: 'unavailable' }

export async function verifyPublicBillingPaymentReceipt(
  rawToken: unknown,
): Promise<PublicReceiptLookupResult> {
  const token = normalizeReceiptVerificationToken(rawToken)
  if (!token) return { status: 'invalid' }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim()

  if (!supabaseUrl || !anonKey) {
    console.error('[billing-receipt] Supabase public client is not configured.')
    return { status: 'unavailable' }
  }

  try {
    const supabase = createClient<VimobCoreDatabase>(supabaseUrl, anonKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    })
    const { data, error } = await supabase.rpc(
      'verify_billing_payment_receipt',
      { p_verification_token: token },
    )

    if (error) {
      console.error('[billing-receipt] Public verification RPC failed.', {
        code: error.code,
      })
      return { status: 'unavailable' }
    }

    const receipt = parsePublicBillingPaymentReceipt(data)
    if (!receipt) return { status: 'invalid' }
    return receipt.valid
      ? { status: 'valid', receipt }
      : { status: 'invalidated', receipt }
  } catch (error) {
    console.error('[billing-receipt] Public verification failed.', { error })
    return { status: 'unavailable' }
  }
}
