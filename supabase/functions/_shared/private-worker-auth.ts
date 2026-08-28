import { constantTimeTextEqual } from "./asaas-webhook.ts";
import {
  allSupabaseServiceApiKeys,
  readSupabaseSecretKeyEnvironment,
  type SupabaseSecretKeyEnvironment,
} from "./supabase-secret-keys.ts";

export type PrivateWorkerAuthEnvironment = SupabaseSecretKeyEnvironment;

function bearerToken(request: Request) {
  const value = request.headers.get("authorization")?.trim() || "";
  return value.toLowerCase().startsWith("bearer ") ? value.slice(7).trim() : "";
}

function isLegacyJwtSecret(value: string) {
  const segments = value.split(".");
  return segments.length === 3 &&
    segments.every((segment) => segment.length > 0);
}

function matchesAnySecret(candidate: string, secrets: string[]) {
  // Evaluate every configured key so rotation order or the matching key's
  // position cannot create an early-exit timing oracle.
  let matched = 0;
  for (const secret of secrets) {
    matched |= constantTimeTextEqual(candidate, secret) ? 1 : 0;
  }
  return matched !== 0;
}

/**
 * Authorizes a server-to-server Edge Function invocation.
 *
 * Hosted Supabase secret keys are exposed as the `SUPABASE_SECRET_KEYS` JSON
 * dictionary and are sent only through `apikey`. Local development may expose
 * `SUPABASE_SECRET_KEY`. A JWT-shaped legacy service-role key remains a
 * Bearer-only compatibility fallback during migration.
 */
export function authorizePrivateWorkerRequest(
  request: Request,
  environment = readSupabaseSecretKeyEnvironment(),
) {
  const apiKeys = allSupabaseServiceApiKeys(environment);
  if (!apiKeys) return false;

  const apiKey = request.headers.get("apikey");
  if (apiKey !== null) {
    // An explicit API key is authoritative. Never downgrade to a valid legacy
    // Bearer token when an invalid API key was supplied alongside it.
    return matchesAnySecret(apiKey, apiKeys);
  }

  const legacyServiceRole = environment.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!legacyServiceRole || !isLegacyJwtSecret(legacyServiceRole)) return false;
  return constantTimeTextEqual(bearerToken(request), legacyServiceRole);
}
