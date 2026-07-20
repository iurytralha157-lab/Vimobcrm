export function normalizeSearchText(value: unknown) {
  return String(value ?? '')
    .normalize('NFD')
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

export function commandSearchFilter(value: string, search: string, keywords?: string[]) {
  const searchableText = [value, ...(keywords ?? [])].join(' ')
  return searchTextIncludes(searchableText, search) ? 1 : 0
}
