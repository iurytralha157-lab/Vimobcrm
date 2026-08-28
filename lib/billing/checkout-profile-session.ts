import {
  checkoutBillingDraftSessionSchema,
  checkoutBillingProfileSessionSchema,
} from '@/lib/validation'

const CHECKOUT_PROFILE_KEY = 'vimob:checkout-billing-profile'
const CHECKOUT_PROFILE_MAX_AGE_MS = 30 * 60 * 1000
const CHECKOUT_DRAFT_KEY_PREFIX = 'vimob:checkout-billing-draft:'
const CHECKOUT_DRAFT_MAX_AGE_MS = 2 * 60 * 60 * 1000

export type CheckoutBillingProfile = {
  name: string
  email: string
  cpf_cnpj: string
  phone: string
}

type CheckoutBillingProfileSession = CheckoutBillingProfile & {
  organization_id: string
  created_at: number
}

export type CheckoutBillingDraft = CheckoutBillingProfile & {
  country: 'BR'
  postal_code: string
  address: string
  address_number: string
  address_complement: string
  neighborhood: string
  city: string
  state: string
}

function checkoutDraftKey(checkoutToken: string) {
  return `${CHECKOUT_DRAFT_KEY_PREFIX}${checkoutToken}`
}

export function parseCheckoutBillingProfileSession(
  rawValue: string | null,
  organizationId: string,
  now = Date.now(),
): CheckoutBillingProfile | null {
  if (!rawValue) return null

  try {
    const parsed = checkoutBillingProfileSessionSchema.safeParse(JSON.parse(rawValue))
    if (!parsed.success) return null
    if (parsed.data.organization_id !== organizationId) return null
    if (now - parsed.data.created_at > CHECKOUT_PROFILE_MAX_AGE_MS) return null

    return {
      name: parsed.data.name,
      email: parsed.data.email,
      cpf_cnpj: parsed.data.cpf_cnpj,
      phone: parsed.data.phone,
    }
  } catch {
    return null
  }
}

export function saveCheckoutBillingProfileSession(
  organizationId: string,
  profile: CheckoutBillingProfile,
) {
  if (typeof window === 'undefined') return

  const value: CheckoutBillingProfileSession = {
    organization_id: organizationId,
    ...profile,
    created_at: Date.now(),
  }
  const parsed = checkoutBillingProfileSessionSchema.safeParse(value)
  if (!parsed.success) return

  try {
    window.sessionStorage.setItem(CHECKOUT_PROFILE_KEY, JSON.stringify(parsed.data))
  } catch {
    // The authenticated billing profile remains the fallback when storage is unavailable.
  }
}

export function consumeCheckoutBillingProfileSession(organizationId: string) {
  if (typeof window === 'undefined') return null

  try {
    const rawValue = window.sessionStorage.getItem(CHECKOUT_PROFILE_KEY)
    window.sessionStorage.removeItem(CHECKOUT_PROFILE_KEY)
    return parseCheckoutBillingProfileSession(rawValue, organizationId)
  } catch {
    return null
  }
}

export function parseCheckoutBillingDraftSession(
  rawValue: string | null,
  checkoutToken: string,
  organizationId: string,
  now = Date.now(),
): CheckoutBillingDraft | null {
  if (!rawValue) return null

  try {
    const parsed = checkoutBillingDraftSessionSchema.safeParse(JSON.parse(rawValue))
    if (!parsed.success) return null
    if (parsed.data.checkout_token !== checkoutToken) return null
    if (parsed.data.organization_id !== organizationId) return null
    if (now - parsed.data.updated_at > CHECKOUT_DRAFT_MAX_AGE_MS) return null

    return {
      name: parsed.data.name,
      email: parsed.data.email,
      cpf_cnpj: parsed.data.cpf_cnpj,
      phone: parsed.data.phone,
      country: parsed.data.country,
      postal_code: parsed.data.postal_code,
      address: parsed.data.address,
      address_number: parsed.data.address_number,
      address_complement: parsed.data.address_complement,
      neighborhood: parsed.data.neighborhood,
      city: parsed.data.city,
      state: parsed.data.state,
    }
  } catch {
    return null
  }
}

export function loadCheckoutBillingDraftSession(checkoutToken: string, organizationId: string) {
  if (typeof window === 'undefined') return null

  try {
    const key = checkoutDraftKey(checkoutToken)
    const rawValue = window.sessionStorage.getItem(key)
    const draft = parseCheckoutBillingDraftSession(rawValue, checkoutToken, organizationId)
    if (!draft && rawValue) window.sessionStorage.removeItem(key)
    return draft
  } catch {
    return null
  }
}

export function saveCheckoutBillingDraftSession(
  checkoutToken: string,
  organizationId: string,
  draft: CheckoutBillingDraft,
) {
  if (typeof window === 'undefined') return

  const value = {
    checkout_token: checkoutToken,
    organization_id: organizationId,
    ...draft,
    updated_at: Date.now(),
  }
  const parsed = checkoutBillingDraftSessionSchema.safeParse(value)
  if (!parsed.success) return

  try {
    window.sessionStorage.setItem(checkoutDraftKey(checkoutToken), JSON.stringify(parsed.data))
  } catch {
    // The server-side billing profile remains the fallback when storage is unavailable.
  }
}

export function clearCheckoutBillingDraftSession(checkoutToken: string) {
  if (typeof window === 'undefined') return

  try {
    window.sessionStorage.removeItem(checkoutDraftKey(checkoutToken))
  } catch {
    // Nothing else is required when storage is unavailable.
  }
}
