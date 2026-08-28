import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

export type RateLimitRule = {
  name: string;
  limit: number;
  windowSeconds: number;
};

export type RateLimitResult = {
  response: Response | null;
};

type RateLimitOptions = {
  identifier?: string;
};

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hashBuf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function getClientIp(req: Request): string {
  const forwardedFor = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return (
    req.headers.get('cf-connecting-ip') ||
    req.headers.get('x-real-ip') ||
    forwardedFor ||
    'unknown'
  );
}

export async function enforceRateLimit(
  supabase: SupabaseClient,
  req: Request,
  scope: string,
  rules: RateLimitRule[],
  corsHeaders: Record<string, string>,
  options: RateLimitOptions = {},
): Promise<RateLimitResult> {
  const identifierHash = await sha256Hex(options.identifier || getClientIp(req));

  for (const rule of rules) {
    const { data, error } = await supabase.rpc('check_edge_rate_limit', {
      p_scope: `${scope}:${rule.name}`,
      p_identifier_hash: identifierHash,
      p_limit: rule.limit,
      p_window_seconds: rule.windowSeconds,
    });

    if (error) {
      console.error('[rate-limit] Failed to check limit:', error);
      continue;
    }

    const result = Array.isArray(data) ? data[0] : data;
    if (!result?.allowed) {
      const retryAfter = String(result?.retry_after_seconds || rule.windowSeconds);
      return {
        response: new Response(
          JSON.stringify({
            error: 'Muitas requisições. Tente novamente em instantes.',
            code: 'rate_limit_exceeded',
          }),
          {
            status: 429,
            headers: {
              ...corsHeaders,
              'Content-Type': 'application/json',
              'Retry-After': retryAfter,
              'X-RateLimit-Limit': String(rule.limit),
              'X-RateLimit-Remaining': String(result?.remaining || 0),
            },
          },
        ),
      };
    }
  }

  return { response: null };
}
