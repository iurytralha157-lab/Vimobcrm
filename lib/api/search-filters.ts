const FILTER_SYNTAX_CHARS = /[%,()]/g
const EXACT_FILTER_SYNTAX_CHARS = /[%,()]/g

export function sanitizeSearchTerm(value: string | null | undefined, maxLength = 80) {
  return (value || '')
    .normalize('NFKC')
    .replace(FILTER_SYNTAX_CHARS, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
}

export function sanitizeFilterValue(value: string | null | undefined, maxLength = 140) {
  const sanitized = (value || '')
    .normalize('NFKC')
    .replace(EXACT_FILTER_SYNTAX_CHARS, '')
    .trim()
    .slice(0, maxLength)

  return sanitized || null
}

export function buildIlikeOrFilter(columns: readonly string[], value: string | null | undefined) {
  const search = sanitizeSearchTerm(value)

  if (search.length < 2) return null

  return columns.map((column) => `${column}.ilike.%${search}%`).join(',')
}

export function buildIlikeAnyOrFilter(
  columns: readonly string[],
  values: readonly (string | null | undefined)[],
  minLength = 2,
) {
  const sanitizedValues = Array.from(
    new Set(values.map((value) => sanitizeSearchTerm(value)).filter((value) => value.length >= minLength)),
  )

  if (sanitizedValues.length === 0) return null

  return sanitizedValues
    .flatMap((value) => columns.map((column) => `${column}.ilike.%${value}%`))
    .join(',')
}

export function buildEqualsOrFilter(columns: readonly string[], value: string | null | undefined) {
  const search = sanitizeFilterValue(value, 140)

  if (!search) return null

  return columns.map((column) => `${column}.eq.${search}`).join(',')
}

export function buildInFilter(column: string, values: readonly (string | null | undefined)[]) {
  const sanitizedValues = Array.from(new Set(values.map((value) => sanitizeFilterValue(value)).filter(Boolean)))

  if (sanitizedValues.length === 0) return null

  return `${column}.in.(${sanitizedValues.join(',')})`
}
