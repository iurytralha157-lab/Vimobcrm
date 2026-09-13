export async function resolveImportRowTagsIfValid<T>(
  validationErrors: readonly string[],
  resolveTags: () => Promise<T>,
): Promise<T | undefined> {
  if (validationErrors.length > 0) return undefined;
  return resolveTags();
}
