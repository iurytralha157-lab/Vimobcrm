const SAFE_QUERY_VALUE = /^[a-zA-Z0-9_-]{1,64}$/
const SAFE_PAGE_VALUE = /^\d{1,6}$/

const TELEMETRY_QUERY_ALLOWLIST: Readonly<Record<string, RegExp>> = {
  page: SAFE_PAGE_VALUE,
  tab: SAFE_QUERY_VALUE,
  view: SAFE_QUERY_VALUE,
}

function redactSensitiveAuthPath(pathname: string) {
  return pathname.replace(
    /^(\/convite\/)[^/]+/i,
    '$1[token]',
  )
}

export type SafeTelemetryLocation = {
  url: string
  origin: string
  pathname: string
  search: string
}

/**
 * Builds the only browser-location shape allowed in frontend telemetry.
 * Hashes are intentionally ignored and query parameters are deny-by-default,
 * so Supabase credentials and auth return parameters never leave the browser.
 */
export function getSafeTelemetryLocation(url: URL): SafeTelemetryLocation {
  const pathname = redactSensitiveAuthPath(url.pathname)
  const safeParams = new URLSearchParams()

  for (const [key, value] of url.searchParams) {
    const rule = TELEMETRY_QUERY_ALLOWLIST[key]
    if (rule?.test(value)) {
      safeParams.append(key, value)
    }
  }

  const serializedSearch = safeParams.toString()
  const search = serializedSearch ? `?${serializedSearch}` : ''

  return {
    url: `${url.origin}${pathname}${search}`,
    origin: url.origin,
    pathname,
    search,
  }
}
