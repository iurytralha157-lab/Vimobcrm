type UnknownRecord = Record<string, unknown>

function isUnknownRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isMissingOrBlankText(value: unknown) {
  return value === null || value === undefined || (
    typeof value === 'string' && value.trim() === ''
  )
}

function sanitizeMetaOptions(value: unknown, requiredFields: string[]) {
  if (!Array.isArray(value)) return value

  return value.filter((item) => {
    if (item === null || item === undefined) return false
    if (!isUnknownRecord(item)) return true

    return !requiredFields.some((field) => isMissingOrBlankText(item[field]))
  })
}

function filterReferentialOrphans(
  value: unknown,
  hasParent: (item: UnknownRecord) => boolean,
) {
  if (!Array.isArray(value)) return value

  return value.filter((item) => {
    if (!isUnknownRecord(item)) return true
    return hasParent(item)
  })
}

function sanitizePageOptions(value: unknown) {
  if (!Array.isArray(value)) return value

  return value.flatMap((item) => {
    if (item === null || item === undefined) return []
    if (!isUnknownRecord(item)) return [item]

    const id = typeof item.id === 'string' ? item.id.trim() : ''
    if (!id) return []
    const name = typeof item.name === 'string' ? item.name.trim() : ''
    return [{ ...item, id, name: name || id }]
  })
}

export function sanitizeLeadMetaFiltersEnvelope(response: unknown): unknown {
  if (!isUnknownRecord(response) || !isUnknownRecord(response.data)) return response

  const data = response.data
  const campaigns = sanitizeMetaOptions(data.campaigns, ['id', 'name'])
  const campaignIds = Array.isArray(campaigns)
    ? new Set(campaigns.flatMap((item) => (
      isUnknownRecord(item) && typeof item.id === 'string' ? [item.id] : []
    )))
    : null
  const sanitizedAdsets = sanitizeMetaOptions(data.adsets, ['id', 'name', 'campaignId'])
  const adsets = campaignIds
    ? filterReferentialOrphans(sanitizedAdsets, (item) => (
      typeof item.campaignId !== 'string' || campaignIds.has(item.campaignId)
    ))
    : sanitizedAdsets
  const adsetParents = Array.isArray(adsets)
    ? new Set(adsets.flatMap((item) => (
      isUnknownRecord(item) &&
      typeof item.campaignId === 'string' &&
      typeof item.id === 'string'
        ? [`${item.campaignId}\u0000${item.id}`]
        : []
    )))
    : null
  const sanitizedAds = sanitizeMetaOptions(data.ads, ['id', 'name', 'adsetId', 'campaignId'])
  const ads = campaignIds && adsetParents
    ? filterReferentialOrphans(sanitizedAds, (item) => {
      if (typeof item.campaignId !== 'string' || typeof item.adsetId !== 'string') return true
      return campaignIds.has(item.campaignId) &&
        adsetParents.has(`${item.campaignId}\u0000${item.adsetId}`)
    })
    : sanitizedAds

  return {
    ...response,
    data: {
      ...data,
      sources: Array.isArray(data.sources)
        ? data.sources.filter((source) => !isMissingOrBlankText(source))
        : data.sources,
      // Keep rolling deployments compatible with an API version that predates
      // page options, while still rejecting malformed non-array values.
      pages: data.pages === undefined ? [] : sanitizePageOptions(data.pages),
      campaigns,
      adsets,
      ads,
    },
  }
}
