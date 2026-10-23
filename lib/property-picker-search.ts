/** Stop on an empty/short server page, even if a concurrent catalog change made total stale. */
export function nextPropertyPickerOffset(offset: number, pageSize: number, returned: number, total: number) {
  if (returned < pageSize || offset + returned >= total) return undefined
  return offset + returned
}

export function uniquePropertyPickerResults<T extends { id: string }>(pages: readonly (readonly T[])[]) {
  const seen = new Set<string>()
  return pages.flatMap((page) => page.filter((property) => {
    if (seen.has(property.id)) return false
    seen.add(property.id)
    return true
  }))
}
