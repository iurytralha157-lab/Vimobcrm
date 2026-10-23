export function normalizeSearchText(value: unknown) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .trim()
}

export function searchTextIncludes(value: unknown, query: unknown) {
  return normalizeSearchText(value).includes(normalizeSearchText(query))
}

export function searchTextEquals(value: unknown, query: unknown) {
  return normalizeSearchText(value) === normalizeSearchText(query)
}

/** Match the API's phone digit search without changing the stored phone. */
export function searchPhoneIncludes(value: unknown, query: unknown) {
  const text = normalizeSearchText(query)
  const phone = normalizeSearchText(value)
  if (text && phone.includes(text)) return true
  if (!/^[0-9 +().\-\t\r\n]+$/.test(text)) return false
  const digits = text.replace(/\D/g, '')
  return digits.length >= 4 && phone.replace(/\D/g, '').includes(digits)
}

export function commandSearchFilter(value: string, search: string, keywords?: string[]) {
  const searchableText = [value, ...(keywords ?? [])].join(' ')
  return searchTextIncludes(searchableText, search) ? 1 : 0
}
