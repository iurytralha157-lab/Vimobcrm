export const LEAD_HISTORY_RENDER_PAGE_SIZE = 100;

export function leadThreadInitialLoading(itemCount: number, historyPending: boolean, messagesPending: boolean) {
  return itemCount === 0 && (historyPending || messagesPending);
}

export function leadThreadWindow<T>(items: readonly T[], visibleCount: number) {
  const start = Math.max(0, items.length - Math.max(LEAD_HISTORY_RENDER_PAGE_SIZE, visibleCount));
  return { hiddenCount: start, items: items.slice(start) };
}
