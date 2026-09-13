const META_FILTER_AFFECTING_LEAD_EVENTS = new Set([
  'lead.created',
  'lead.assigned',
  'lead.deleted',
  'lead.meta_webhook_received',
  'lead.reentered',
  'lead.redistributed',
  'lead.stage_moved',
  'lead.updated',
  'lead.webhook_received',
])

function normalizeReasons(reasons: Iterable<string>) {
  return [...reasons]
    .map((reason) => reason.trim().toLowerCase())
    .filter(Boolean)
}

export function isWhatsAppOnlyLeadRealtimeBatch(reasons: Iterable<string>) {
  const normalizedReasons = normalizeReasons(reasons)
  return normalizedReasons.length > 0 && normalizedReasons.every(
    (reason) => reason === 'lead.whatsapp_activity' || reason.startsWith('whatsapp.'),
  )
}

export function shouldRefreshLeadMetaFilters(reasons: Iterable<string>) {
  const normalizedReasons = normalizeReasons(reasons)
  if (normalizedReasons.length === 0) return true

  return normalizedReasons.some((reason) => META_FILTER_AFFECTING_LEAD_EVENTS.has(reason))
}
