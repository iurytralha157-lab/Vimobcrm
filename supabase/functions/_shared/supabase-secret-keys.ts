const MIN_SECRET_LENGTH = 32;
const MAX_SECRET_LENGTH = 4096;
const MAX_NAMED_SECRET_KEYS = 64;
const MAX_NAMED_SECRET_KEYS_JSON_LENGTH = 64 * 1024;

export type SupabaseSecretKeyEnvironment = {
  SUPABASE_SECRET_KEYS?: string;
  SUPABASE_SECRET_KEY?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
};

export type ParsedSupabaseSecretKeys = {
  namedKeysConfigured: boolean;
  namedKeys: Array<{ name: string; value: string }>;
  localSecretKey: string | null;
  legacyServiceRoleKey: string | null;
};

function validConfiguredSecret(value: unknown): value is string {
  return typeof value === "string" &&
    value.length >= MIN_SECRET_LENGTH &&
    value.length <= MAX_SECRET_LENGTH &&
    value === value.trim();
}

export function readSupabaseSecretKeyEnvironment(): SupabaseSecretKeyEnvironment {
  return {
    SUPABASE_SECRET_KEYS: Deno.env.get("SUPABASE_SECRET_KEYS"),
    SUPABASE_SECRET_KEY: Deno.env.get("SUPABASE_SECRET_KEY"),
    SUPABASE_SERVICE_ROLE_KEY: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
  };
}

export function parseSupabaseSecretKeys(
  environment: SupabaseSecretKeyEnvironment,
): ParsedSupabaseSecretKeys | null {
  const namedKeysJson = environment.SUPABASE_SECRET_KEYS;
  const namedKeys: Array<{ name: string; value: string }> = [];

  if (namedKeysJson !== undefined) {
    if (
      namedKeysJson.length === 0 ||
      namedKeysJson.length > MAX_NAMED_SECRET_KEYS_JSON_LENGTH
    ) return null;

    let parsed: unknown;
    try {
      parsed = JSON.parse(namedKeysJson);
    } catch {
      return null;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }

    const entries = Object.entries(parsed as Record<string, unknown>);
    if (entries.length === 0 || entries.length > MAX_NAMED_SECRET_KEYS) {
      return null;
    }
    for (const [name, value] of entries) {
      if (
        !name || name !== name.trim() || name.length > 128 ||
        !validConfiguredSecret(value)
      ) return null;
      namedKeys.push({ name, value });
    }
  }

  const localSecretKey = environment.SUPABASE_SECRET_KEY;
  if (localSecretKey !== undefined && !validConfiguredSecret(localSecretKey)) {
    return null;
  }

  const legacyServiceRoleKey = environment.SUPABASE_SERVICE_ROLE_KEY;
  if (
    legacyServiceRoleKey !== undefined &&
    !validConfiguredSecret(legacyServiceRoleKey)
  ) return null;

  return {
    namedKeysConfigured: namedKeysJson !== undefined,
    namedKeys,
    localSecretKey: localSecretKey || null,
    legacyServiceRoleKey: legacyServiceRoleKey || null,
  };
}

export function allSupabaseServiceApiKeys(
  environment: SupabaseSecretKeyEnvironment,
) {
  const parsed = parseSupabaseSecretKeys(environment);
  if (!parsed) return null;

  const keys = parsed.namedKeys.map((entry) => entry.value);
  if (parsed.localSecretKey) keys.push(parsed.localSecretKey);
  if (parsed.legacyServiceRoleKey) keys.push(parsed.legacyServiceRoleKey);
  return keys.length > 0 ? keys : null;
}

/** Selects one deterministic RLS-bypassing key for the admin client. */
export function selectSupabaseAdminSecretKey(
  environment: SupabaseSecretKeyEnvironment,
) {
  const parsed = parseSupabaseSecretKeys(environment);
  if (!parsed) return null;

  if (parsed.namedKeysConfigured) {
    const defaultKey = parsed.namedKeys.find((entry) =>
      entry.name === "default"
    );
    if (defaultKey) return defaultKey.value;
    return parsed.namedKeys.length === 1 ? parsed.namedKeys[0].value : null;
  }

  if (parsed.localSecretKey) return parsed.localSecretKey;
  return parsed.legacyServiceRoleKey;
}
