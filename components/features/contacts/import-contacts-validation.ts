export async function resolveImportRowTagsIfValid<T>(
  validationErrors: readonly string[],
  resolveTags: () => Promise<T>,
): Promise<T | undefined> {
  if (validationErrors.length > 0) return undefined;
  return resolveTags();
}

type ImportTag = { id: string; name: string; organization_id: string };
type ImportTagAdapter = { load: () => Promise<ImportTag[]>; create: (name: string) => Promise<ImportTag> };

function errorCode(error: unknown) {
  return error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
}

export function importTagOutcomeUnknown(error: unknown) {
  const code = errorCode(error);
  const status = error && typeof error === 'object' && 'status' in error ? Number(error.status) : undefined;
  const invalidResponse = error && typeof error === 'object' && 'direction' in error && error.direction === 'response';
  const aborted = error instanceof Error && error.name === 'AbortError';
  return ['tag_create_outcome_unknown', 'api_timeout', 'api_unavailable', 'invalid_api_response', 'api_response_invalid'].includes(code)
    || Boolean(invalidResponse) || aborted || status === 0 || (status !== undefined && status >= 500) || (!code && status === undefined);
}

/** Catalog refreshes are read-only. A create with an uncertain result is never replayed automatically. */
export function createImportTagResolver(organizationId: string, tags: readonly ImportTag[], adapter: ImportTagAdapter, onCreated?: () => void) {
  const normalize = (name: string) => name.trim().toLocaleLowerCase('pt-BR');
  const known = new Map<string, ImportTag>();
  const uncertain = new Set<string>();
  const add = (tag: ImportTag, target = known) => {
    if (tag.organization_id !== organizationId) throw new Error('O catálogo de tags pertence a outra organização');
    const key = normalize(tag.name);
    const existing = target.get(key);
    if (existing && existing.id !== tag.id) throw new Error(`A tag "${tag.name}" possui nomes duplicados no catálogo`);
    target.set(key, tag);
  };
  tags.forEach((tag) => add(tag));
  const refresh = async () => {
    const refreshed = await adapter.load();
    const snapshot = new Map<string, ImportTag>();
    refreshed.forEach((tag) => add(tag, snapshot));
    known.clear();
    snapshot.forEach((tag, key) => known.set(key, tag));
  };
  return async (names: readonly string[]) => {
    const ids: string[] = [];
    for (const name of names) {
      const key = normalize(name);
      let tag = known.get(key);
      if (!tag && uncertain.has(key)) {
        await refresh();
        tag = known.get(key);
        if (!tag) throw Object.assign(new Error(`Criação da tag "${name}" sem confirmação. Confira o catálogo antes de repetir.`), { code: 'tag_create_outcome_unknown' });
      }
      if (!tag) {
        try {
          tag = await adapter.create(name);
          add(tag);
          onCreated?.();
        } catch (error) {
          const conflict = ['tag_already_exists', 'tag_name_already_exists'].includes(errorCode(error));
          const unknown = importTagOutcomeUnknown(error);
          if (unknown) uncertain.add(key);
          if (conflict || unknown) {
            await refresh();
            tag = known.get(key);
          }
          if (!tag) {
            if (unknown) throw Object.assign(new Error(`Criação da tag "${name}" sem confirmação. Confira o catálogo antes de repetir.`), { code: 'tag_create_outcome_unknown' });
            throw error;
          }
        }
      }
      ids.push(tag.id);
    }
    return Array.from(new Set(ids));
  };
}
