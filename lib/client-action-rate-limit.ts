type RateLimitRule = {
  limit: number;
  windowMs: number;
};

const actionBuckets = new Map<string, number[]>();

export class ClientActionRateLimitError extends Error {
  constructor(public readonly userMessage = 'Aguarde um instante antes de tentar novamente.') {
    super('CLIENT_ACTION_RATE_LIMIT');
    this.name = 'ClientActionRateLimitError';
  }
}

export function enforceClientActionRateLimit(actionKey: string, rules: RateLimitRule[]) {
  const now = Date.now();

  for (const rule of rules) {
    const bucketKey = `${actionKey}:${rule.windowMs}`;
    const recent = (actionBuckets.get(bucketKey) || []).filter((time) => now - time < rule.windowMs);

    if (recent.length >= rule.limit) {
      actionBuckets.set(bucketKey, recent);
      throw new ClientActionRateLimitError();
    }

    recent.push(now);
    actionBuckets.set(bucketKey, recent);
  }
}

export function getClientRateLimitMessage(error: unknown) {
  if (error instanceof ClientActionRateLimitError) return error.userMessage;
  return null;
}
