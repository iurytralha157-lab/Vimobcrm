function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? String(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(",")}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));

  return `{${
    entries
      .map(([key, item]) => `${JSON.stringify(key)}:${stableSerialize(item)}`)
      .join(",")
  }}`;
}

export async function buildDistributionIdempotencyKey(
  namespace: string,
  identity: unknown,
): Promise<string> {
  const normalizedNamespace = namespace.trim().toLowerCase().replace(
    /[^a-z0-9_-]+/g,
    "-",
  );
  if (!normalizedNamespace || normalizedNamespace.length > 64) {
    throw new Error("invalid_distribution_idempotency_namespace");
  }

  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(stableSerialize(identity)),
  );
  const hex = Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");

  return `${normalizedNamespace}:${hex}`;
}
