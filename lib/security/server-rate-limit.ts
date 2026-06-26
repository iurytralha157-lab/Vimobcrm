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

export function getRequestIp(request: Request) {
  const forwardedFor = request.headers.get('x-forwarded-for')
  const forwardedIp = forwardedFor?.split(',')[0]?.trim()

  return (
    forwardedIp ||
    request.headers.get('cf-connecting-ip') ||
    request.headers.get('x-real-ip') ||
    'unknown'
  )
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
