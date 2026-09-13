import { searchTextEquals } from '@/lib/search-text'
import { leadCustomSourceNameSchema } from '@/lib/validation/leads'

export const LEAD_SOURCE_NONE_VALUE = '__none__'
export const LEAD_SOURCE_CREATE_VALUE = '__create_lead_source__'

export type LeadSourceOption = {
  value: string
  label: string
}

export const DEFAULT_LEAD_SOURCE_OPTIONS: readonly LeadSourceOption[] = [
  { value: 'manual', label: 'Manual' },
  { value: 'site', label: 'Site' },
  { value: 'indicacao', label: 'Indicação' },
  { value: 'portais', label: 'Portais' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'facebook', label: 'Facebook' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'google', label: 'Google' },
  { value: 'google_ads', label: 'Google Ads' },
  { value: 'meta', label: 'Meta Ads' },
  { value: 'import', label: 'Importação' },
  { value: 'webhook', label: 'Webhook' },
  { value: 'outros', label: 'Outros' },
] as const

const RESERVED_SOURCE_NAMES = [
  'all',
  'custom',
  LEAD_SOURCE_NONE_VALUE,
  LEAD_SOURCE_CREATE_VALUE,
]

export type ResolvedLeadSource =
  | { success: true; value: string; label: string; isCustom: boolean }
  | { success: false; error: string }

export function resolveLeadSourceInput(input: string): ResolvedLeadSource {
  const parsed = leadCustomSourceNameSchema.safeParse(input)
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message || 'Origem inválida',
    }
  }

  const normalized = parsed.data
  if (RESERVED_SOURCE_NAMES.some((reserved) => searchTextEquals(reserved, normalized))) {
    return { success: false, error: 'Escolha outro nome para a origem' }
  }

  const existing = DEFAULT_LEAD_SOURCE_OPTIONS.find((option) => (
    searchTextEquals(option.value, normalized)
    || searchTextEquals(option.label, normalized)
  ))

  if (existing) {
    return { success: true, ...existing, isCustom: false }
  }

  return {
    success: true,
    value: normalized,
    label: normalized,
    isCustom: true,
  }
}

export function buildLeadSourceOptions(currentSource?: string | null) {
  const source = currentSource?.trim()
  if (!source || DEFAULT_LEAD_SOURCE_OPTIONS.some((option) => option.value === source)) {
    return [...DEFAULT_LEAD_SOURCE_OPTIONS]
  }

  return [
    ...DEFAULT_LEAD_SOURCE_OPTIONS,
    { value: source, label: source },
  ]
}
