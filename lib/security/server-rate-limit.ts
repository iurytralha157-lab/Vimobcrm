import { createHash } from 'node:crypto'
import { isIP } from 'node:net'

type RateLimitRule = {
  limit: number
  windowMs: number
}

type Bucket = {
  hits: number[]
  expiresAt: number
}

const buckets = new Map<string, Bucket>()
const MAX_BUCKETS = 5000
let lastCleanupAt = 0

export class ServerRateLimitError extends Error {
  constructor(public readonly retryAfterSeconds: number) {
    super('SERVER_RATE_LIMIT')
    this.name = 'ServerRateLimitError'
  }
}

function cleanupExpiredBuckets(now: number) {
  if (now - lastCleanupAt < 60_000 && buckets.size < MAX_BUCKETS) return

  for (const [key, bucket] of buckets.entries()) {
    if (bucket.expiresAt <= now) {
      buckets.delete(key)
    }
  }

  if (buckets.size > MAX_BUCKETS) {
    const overflow = buckets.size - MAX_BUCKETS
    const keysToDrop = Array.from(buckets.keys()).slice(0, overflow)
    keysToDrop.forEach((key) => buckets.delete(key))
  }

  lastCleanupAt = now
}

function parseForwardedAddresses(value: string | null) {
  if (!value) return []

  return value
    .split(',')
    .map((candidate) => candidate.trim())
    .filter((candidate) => isIP(candidate) !== 0)
}

/**
 * Preserve the whole proxy chain for the authoritative Go resolver. The
 * backend walks this list from right to left and only honors it when the
 * direct peer belongs to API_TRUSTED_PROXY_CIDRS.
 */
export function getForwardedForHeader(request: Request) {
  const addresses = parseForwardedAddresses(request.headers.get('x-forwarded-for'))
  return addresses.length > 0 ? addresses.join(', ') : null
}

/**
 * Best-effort identity for the process-local secondary limiter. Choosing the
 * rightmost valid hop prevents an attacker-controlled X-Forwarded-For prefix
 * from assigning requests to another user's bucket. The Go limiter remains
 * authoritative because a Web Request does not expose the transport peer.
 */
export function getRequestIp(request: Request) {
  const forwarded = parseForwardedAddresses(request.headers.get('x-forwarded-for'))
  const forwardedIp = forwarded[forwarded.length - 1]

  const connectingIp = [
    request.headers.get('cf-connecting-ip'),
    request.headers.get('x-real-ip'),
  ]
    .map((candidate) => candidate?.trim() || '')
    .find((candidate) => isIP(candidate) !== 0)

  return (
    forwardedIp ||
    connectingIp ||
    'unknown'
  )
}

/**
 * Stable, bounded key for the process-local defense. Hashing the complete
 * normalized chain keeps different clients behind the same upstream proxy in
 * different buckets. Prefix injection can only bypass this secondary layer;
 * it cannot target another client's bucket or bypass the backend limiter.
 */
export function getRequestRateLimitIdentity(request: Request) {
  const identity = getForwardedForHeader(request) || getRequestIp(request)
  return createHash('sha256').update(identity).digest('hex')
}

export function enforceServerRateLimit(actionKey: string, rules: readonly RateLimitRule[]) {
  const now = Date.now()
  cleanupExpiredBuckets(now)

  for (const rule of rules) {
    const bucketKey = `${actionKey}:${rule.windowMs}`
    const bucket = buckets.get(bucketKey) || { hits: [], expiresAt: now + rule.windowMs }
    const hits = bucket.hits.filter((hitAt) => now - hitAt < rule.windowMs)

    if (hits.length >= rule.limit) {
      const oldestHit = hits[0] ?? now
      const retryAfterMs = Math.max(1000, rule.windowMs - (now - oldestHit))

      buckets.set(bucketKey, {
        hits,
        expiresAt: now + retryAfterMs,
      })

      throw new ServerRateLimitError(Math.ceil(retryAfterMs / 1000))
    }

    hits.push(now)
    buckets.set(bucketKey, {
      hits,
      expiresAt: now + rule.windowMs,
    })
  }
}

export function rateLimitHeaders(error: ServerRateLimitError) {
  return {
    'Retry-After': String(error.retryAfterSeconds),
  }
}
