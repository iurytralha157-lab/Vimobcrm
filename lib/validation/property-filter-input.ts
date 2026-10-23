import { parseNumericFilter } from '@/lib/validation/numeric-filter'
import { uuidSchema } from '@/lib/validation/common'

export function getPropertyCatalogLocationId(location?: { id: string; catalog_source?: 'catalog' | 'property' } | null) {
  if (!location || location.catalog_source === 'property') return undefined
  const result = uuidSchema.safeParse(location.id)
  return result.success ? result.data : undefined
}

export const PROPERTY_NUMERIC_FILTER_LABELS = {
  valor_min: 'Valor mínimo', valor_max: 'Valor máximo',
  area_util_min: 'Área útil mínima', area_util_max: 'Área útil máxima',
  area_total_min: 'Área total mínima', area_total_max: 'Área total máxima',
} as const

type NumericField = keyof typeof PROPERTY_NUMERIC_FILTER_LABELS

/** An invalid populated filter must reach validation, never become an absent bound. */
export function propertyNumericFilterValue(value?: string) {
  if (!value?.trim()) return undefined
  return parseNumericFilter(value) ?? value.trim()
}

export function getPropertyNumericFilterErrors(filters: Partial<Record<NumericField, string>>) {
  const errors: Partial<Record<NumericField, string>> = {}
  for (const field of Object.keys(PROPERTY_NUMERIC_FILTER_LABELS) as NumericField[]) {
    if (filters[field]?.trim() && parseNumericFilter(filters[field]) === undefined) {
      errors[field] = `${PROPERTY_NUMERIC_FILTER_LABELS[field]}: informe um número igual ou maior que zero.`
    }
  }
  for (const prefix of ['valor', 'area_util', 'area_total'] as const) {
    const minField = `${prefix}_min` as NumericField
    const maxField = `${prefix}_max` as NumericField
    const min = parseNumericFilter(filters[minField])
    const max = parseNumericFilter(filters[maxField])
    if (min !== undefined && max !== undefined && min > max) {
      errors[minField] = `${PROPERTY_NUMERIC_FILTER_LABELS[minField]} deve ser menor ou igual ao máximo.`
    }
  }
  return errors
}
