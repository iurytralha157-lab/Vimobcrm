export function mergePreservingDefinedFields<T extends object>(
  snapshot: T,
  incoming: Partial<T>,
  preserveKeys: readonly (keyof T)[],
): T {
  const merged = { ...snapshot, ...incoming } as T;

  for (const key of preserveKeys) {
    if (incoming[key] == null && snapshot[key] != null) {
      merged[key] = snapshot[key];
    }
  }

  return merged;
}
