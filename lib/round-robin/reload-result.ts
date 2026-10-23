/** Cached data is not a successful response to an explicit reload. */
export function requireSuccessfulQueueReload<T>(result: { data: T | undefined; isError?: boolean; error?: unknown }): T {
  if (result.isError || result.error || result.data == null) {
    throw result.error instanceof Error ? result.error : new Error('Não foi possível carregar a fila. Seu rascunho foi mantido.');
  }
  return result.data;
}
