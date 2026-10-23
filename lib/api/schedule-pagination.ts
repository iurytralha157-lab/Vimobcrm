export type SchedulePage<T> = {
  data: T[];
  pagination?: { limit: number; offset: number; has_more: boolean };
};

export const SCHEDULE_LIST_PAGE_SIZE = 200;
const MAX_SCHEDULE_LIST_PAGES = 100;

/**
 * Read every offset page, including during an API-first rollout. This is not
 * an atomic snapshot: concurrent moves/deletes can shift later offsets. A
 * schedule change received during this read must trigger another full read.
 */
export async function collectSchedulePages<T extends { id: string }>(
  readPage: (offset: number, limit: number) => Promise<SchedulePage<T>>,
  signal?: AbortSignal,
): Promise<T[]> {
  const events = new Map<string, T>();
  let offset = 0;
  for (let pageIndex = 0; pageIndex < MAX_SCHEDULE_LIST_PAGES; pageIndex += 1) {
    signal?.throwIfAborted();
    const page = await readPage(offset, SCHEDULE_LIST_PAGE_SIZE);
    signal?.throwIfAborted();
    const previousCount = events.size;
    for (const event of page.data) events.set(event.id, event);
    if (page.pagination && (page.pagination.offset !== offset || page.data.length > page.pagination.limit)) {
      throw new Error("Nao foi possivel carregar toda a agenda. Atualize a lista.");
    }
    // Older API replicas return the whole array without pagination metadata.
    if (!page.pagination || !page.pagination.has_more) return [...events.values()];
    if (
      page.data.length === 0 ||
      events.size === previousCount
    ) {
      throw new Error("Nao foi possivel carregar toda a agenda. Atualize a lista.");
    }
    offset += page.data.length;
  }
  throw new Error("O periodo tem muitas atividades. Selecione um periodo menor.");
}
